// Thin authoritative game server (plain node:http, zero deps).
// Owns game state, drives bot decisions, serves the human's filtered view
// only — hidden roles and prompts never reach the browser.
//
//   POST /api/game/new {playerCount?, seed?, bots?: 'llm'|'heuristic'}
//   GET  /api/game/:id/events   (SSE: {view, ask, acting, degraded})
//   POST /api/game/:id/decide   {decision}
//   GET  /api/game/:id/reveal   (gameOver only: roles + full log)
//   GET  /api/usage
// Static: client/dist

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGame, applyDecision, expectedDecisions } from './engine/game.ts'
import { viewFor, eventVisibleTo } from './engine/view.ts'
import { heuristicDecide, createHeuristicAgent } from './agents/heuristic.ts'
import { createLlmAgent } from './agents/llm.ts'
import { getClient } from './llm/client.ts'
import { ROSTER, DEFAULT_TABLE, rosterById } from './llm/roster.ts'
import type { AvalonAgent } from './agents/types.ts'
import type { Decision, DecisionRequest, Game, Seat } from './engine/types.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'client', 'dist')
const PORT = Number(process.env.AVALON_PORT) || 8787
const HUMAN: Seat = 0

interface Session {
  game: Game
  agents: Map<Seat, AvalonAgent>
  botIds: Record<number, string> // seat -> roster id ('' for heuristic bots)
  waiting: DecisionRequest[]
  acting: Seat[]
  degraded: { seat: Seat; kind: string; error: string }[]
  listeners: Set<http.ServerResponse>
  pumping: boolean
}

const sessions = new Map<string, Session>()

function humanPayload(s: Session) {
  return {
    view: viewFor(s.game, HUMAN),
    ask: s.waiting,
    acting: s.acting,
    degraded: s.degraded.length,
    bots: s.botIds,
  }
}

function broadcast(s: Session): void {
  const data = `data: ${JSON.stringify(humanPayload(s))}\n\n`
  for (const res of s.listeners) res.write(data)
}

async function pump(s: Session): Promise<void> {
  if (s.pumping) return
  s.pumping = true
  try {
    while (s.game.phase !== 'gameOver') {
      const reqs = expectedDecisions(s.game)
      const botReqs = reqs.filter((r) => r.seat !== HUMAN)
      if (botReqs.length === 0) {
        s.waiting = reqs
        s.acting = []
        broadcast(s)
        return // resumes when the human POSTs a decision
      }
      s.acting = botReqs.map((r) => r.seat)
      s.waiting = reqs.filter((r) => r.seat === HUMAN)
      broadcast(s)
      const decisions = await Promise.all(botReqs.map(async (req) => {
        const view = viewFor(s.game, req.seat)
        const agent = s.agents.get(req.seat)!
        try {
          return { req, decision: await agent.decide(req, view) }
        } catch (err) {
          s.degraded.push({
            seat: req.seat, kind: req.kind,
            error: err instanceof Error ? err.message : String(err),
          })
          return { req, decision: heuristicDecide(req, view, s.game.seed) }
        }
      }))
      for (const { req, decision } of decisions) {
        try {
          applyDecision(s.game, req.seat, decision)
        } catch (err) {
          s.degraded.push({
            seat: req.seat, kind: req.kind,
            error: err instanceof Error ? err.message : String(err),
          })
          applyDecision(s.game, req.seat, heuristicDecide(req, viewFor(s.game, req.seat), s.game.seed))
        }
        broadcast(s)
      }
    }
    s.waiting = []
    s.acting = []
    broadcast(s)
  } finally {
    s.pumping = false
  }
}

function newSession(opts: { playerCount?: number; seed?: string; bots?: string }): { id: string; session: Session } {
  const playerCount = opts.playerCount ?? 7
  if (playerCount < 5 || playerCount > 9) throw new Error('playerCount must be 5-9')
  const seed = opts.seed || `web-${Math.random().toString(36).slice(2, 10)}`
  const botMode = opts.bots === 'heuristic' ? 'heuristic' : 'llm'

  // Seat 0 is the human; bots fill the rest from the default table then roster.
  const tableIds = [...DEFAULT_TABLE, ...ROSTER.map((r) => r.id).filter((id) => !DEFAULT_TABLE.includes(id))]
  const botIds: Record<number, string> = {}
  const names = ['You']
  for (let seat = 1; seat < playerCount; seat++) {
    const id = tableIds[(seat - 1) % tableIds.length]
    botIds[seat] = botMode === 'llm' ? id : ''
    names.push(botMode === 'llm' ? rosterById(id).displayName : `Bot ${seat}`)
  }

  // Up to 1 talk round before a proposal, 2 reaction rounds after it —
  // rounds end early once a full round passes silently.
  const game = createGame({ seed, playerCount, names, talk: { preProposal: 1, postProposal: 2 } })
  const agents = new Map<Seat, AvalonAgent>()
  for (let seat = 1; seat < playerCount; seat++) {
    agents.set(seat, botMode === 'llm'
      ? createLlmAgent({ modelId: botIds[seat], client: getClient() })
      : createHeuristicAgent({ seed, seat }))
  }

  const id = Math.random().toString(36).slice(2, 10)
  const session: Session = {
    game, agents, botIds, waiting: [], acting: [], degraded: [],
    listeners: new Set(), pumping: false,
  }
  sessions.set(id, session)
  return { id, session }
}

// ---- http plumbing ----

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(s)
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1)
  const file = path.join(DIST, path.normalize(rel))
  if (!file.startsWith(DIST) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    // SPA: unknown paths get index.html if it exists.
    const index = path.join(DIST, 'index.html')
    if (fs.existsSync(index)) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      fs.createReadStream(index).pipe(res)
    } else {
      res.writeHead(404)
      res.end('client not built — run: npm --prefix client install && npm --prefix client run build')
    }
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)
  try {
    if (req.method === 'POST' && url.pathname === '/api/game/new') {
      const body = await readBody(req)
      const { id, session } = newSession(body)
      void pump(session)
      json(res, 200, { id, ...humanPayload(session) })
      return
    }
    if (parts[0] === 'api' && parts[1] === 'game' && parts[2]) {
      const s = sessions.get(parts[2])
      if (!s) return json(res, 404, { error: 'no such game' })
      if (req.method === 'GET' && parts[3] === 'events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        res.write(`data: ${JSON.stringify(humanPayload(s))}\n\n`)
        s.listeners.add(res)
        req.on('close', () => s.listeners.delete(res))
        return
      }
      if (req.method === 'POST' && parts[3] === 'decide') {
        const body = await readBody(req)
        const decision = body.decision as Decision
        const match = s.waiting.find((w) => w.kind === decision?.kind)
        if (!match) return json(res, 400, { error: `not waiting for a ${decision?.kind} from you` })
        try {
          applyDecision(s.game, HUMAN, decision)
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        }
        s.waiting = []
        broadcast(s)
        void pump(s)
        json(res, 200, { ok: true })
        return
      }
      if (req.method === 'GET' && parts[3] === 'reveal') {
        if (s.game.phase !== 'gameOver') return json(res, 403, { error: 'game still running' })
        json(res, 200, {
          players: s.game.players.map((p) => ({ seat: p.seat, name: p.name, role: p.role, alignment: p.alignment })),
          log: s.game.log,
          degraded: s.degraded,
        })
        return
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/usage') {
      try {
        const client = getClient()
        json(res, 200, { total: client.getTotalCost(), tags: client.getSpend() })
      } catch {
        json(res, 200, { total: 0, tags: {} })
      }
      return
    }
    if (req.method === 'GET') {
      serveStatic(res, url.pathname)
      return
    }
    json(res, 404, { error: 'not found' })
  } catch (err) {
    json(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
})

server.listen(PORT, () => {
  console.log(`avalon server listening on http://localhost:${PORT}`)
  console.log(`client dist: ${fs.existsSync(path.join(DIST, 'index.html')) ? 'found' : 'NOT BUILT'}`)
})
