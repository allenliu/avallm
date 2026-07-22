// Thin authoritative game server (plain node:http, zero deps).
// Owns game state, drives bot decisions, serves each human seat its own
// filtered view — hidden roles and prompts never reach any browser.
//
// Multiplayer (MP1): lobby -> join URL -> auto-start when the last human
// seat fills. Seat identity is an opaque bearer token minted at join; the
// join URL names only the lobby. No timers — correspondence pacing.
//
//   POST /api/lobby                    {name, playerCount, humanSeats, table?, roles?}
//   GET  /api/lobby/:id/preview
//   GET  /api/lobby/:id/events        (SSE, public lobby state)
//   POST /api/lobby/:id/join          {name, mode: 'play'|'spectate'}
//   POST /api/game/new                (solo sugar: a humanSeats=1 lobby, auto-started)
//   GET  /api/game/:id/events?token=  (SSE: that seat's view; spectators get public-only)
//   POST /api/game/:id/decide         {token, decision}
//   GET  /api/game/:id/reveal         (gameOver only)
//   GET/POST /api/agents, GET /api/usage
// Static: client/dist

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGame, applyDecision, expectedDecisions } from './engine/game.ts'
import { viewFor, viewForSpectator } from './engine/view.ts'
import { heuristicDecide } from './agents/heuristic.ts'
import { createAgentFromDef } from './agents/registry.ts'
import { loadAgentLibrary, publicInfo, saveCustomDef, validateDef } from './agents/defs.ts'
import type { AgentDef, AgentPublicInfo } from './agents/defs.ts'
import { RULES_DIGEST, ROLE_GUIDANCE } from './agents/prompts.ts'
import { getClient } from './llm/client.ts'
import { ROSTER, DEFAULT_TABLE } from './llm/roster.ts'
import { ROLE_ALIGNMENT, validateRoles } from './engine/rules.ts'
import type { AvalonAgent } from './agents/types.ts'
import type { Decision, DecisionRequest, Game, Role, Seat } from './engine/types.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'client', 'dist')
// Railway (and most PaaS) inject PORT; AVALON_PORT wins for local overrides.
const PORT = Number(process.env.AVALON_PORT || process.env.PORT) || 8787

// Public-deployment gate: when AVALON_INVITE_CODE is set, creating anything
// that can spend money or write disk (lobbies, games, custom agents) requires
// the code. Joining an existing lobby by URL is deliberately NOT gated —
// invitees were invited by the person who had the code. Read live so an env
// edit takes effect without a restart.
const inviteCode = () => process.env.AVALON_INVITE_CODE || ''
const inviteOk = (body: any) => !inviteCode() || body?.invite === inviteCode()

let library: AgentDef[] = loadAgentLibrary()
const libById = (id: string): AgentDef => {
  const def = library.find((d) => d.id === id)
  if (!def) throw new Error(`unknown agent: ${id}`)
  return def
}

const newToken = () => crypto.randomBytes(16).toString('hex')
const newId = () => crypto.randomBytes(5).toString('hex')

function cleanName(raw: unknown, fallback: string): string {
  return (typeof raw === 'string' ? raw : '')
    .replace(/[<>{}[\]|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24) || fallback
}

// ---------- lobbies ----------

interface Lobby {
  id: string
  config: {
    playerCount: number
    humanSeats: number
    table: string[]        // bot agent ids, length playerCount - humanSeats
    roles?: Role[]
  }
  members: { token: string; name: string }[]     // members[0] is the host
  spectators: { token: string; name: string }[]
  status: 'open' | 'started'
  gameId?: string
  listeners: Set<http.ServerResponse>
}

const lobbies = new Map<string, Lobby>()

function lobbyPayload(l: Lobby) {
  return {
    id: l.id,
    status: l.status,
    gameId: l.gameId,
    playerCount: l.config.playerCount,
    humanSeats: l.config.humanSeats,
    openSeats: l.status === 'open' ? l.config.humanSeats - l.members.length : 0,
    members: l.members.map((m) => m.name),
    spectators: l.spectators.length,
    hostName: l.members[0]?.name ?? '?',
    table: l.config.table.map((id) => publicInfo(libById(id)).name),
  }
}

function lobbyBroadcast(l: Lobby): void {
  const data = `data: ${JSON.stringify(lobbyPayload(l))}\n\n`
  for (const res of l.listeners) res.write(data)
}

function createLobby(body: any): { lobby: Lobby; token: string } {
  const playerCount = Number(body.playerCount) || 7
  if (playerCount < 5 || playerCount > 9) throw new Error('playerCount must be 5-9')
  const humanSeats = Number(body.humanSeats) || 1
  if (humanSeats < 1 || humanSeats > playerCount) throw new Error('humanSeats must be 1..playerCount')

  let roles: Role[] | undefined
  if (body.roles !== undefined) {
    if (!Array.isArray(body.roles) || !body.roles.every((r: unknown) => typeof r === 'string' && r in ROLE_ALIGNMENT)) {
      throw new Error('roles must be an array of valid role names')
    }
    roles = body.roles as Role[]
    // Validate the full set now (count + evil balance), not later in
    // startLobby — a throw there would 500 the joiner who fills the lobby and
    // leave it permanently stuck 'open' with no free seats.
    validateRoles(playerCount, roles)
  }

  const botCount = playerCount - humanSeats
  let table: string[]
  if (body.table !== undefined) {
    if (!Array.isArray(body.table) || !body.table.every((t: unknown) => typeof t === 'string')) {
      throw new Error('table must be an array of agent ids')
    }
    if (body.table.length !== botCount) throw new Error(`table must have exactly ${botCount} agents`)
    body.table.forEach(libById)
    table = body.table
  } else {
    const pool = [...DEFAULT_TABLE, ...ROSTER.map((r) => r.id).filter((rid) => !DEFAULT_TABLE.includes(rid))]
    table = Array.from({ length: botCount }, (_, i) => pool[i % pool.length])
  }

  const token = newToken()
  const lobby: Lobby = {
    id: newId(),
    config: { playerCount, humanSeats, table, roles },
    members: [{ token, name: cleanName(body.name, 'Host') }],
    spectators: [],
    status: 'open',
    listeners: new Set(),
  }
  lobbies.set(lobby.id, lobby)
  if (lobby.members.length === humanSeats) startLobby(lobby)
  return { lobby, token }
}

function startLobby(l: Lobby): void {
  const { playerCount } = l.config
  const defs = l.config.table.map(libById)

  // Shuffle humans across the whole table (no "host is always seat 0" tell).
  const seats = Array.from({ length: playerCount }, (_, i) => i)
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[seats[i], seats[j]] = [seats[j], seats[i]]
  }
  const humanSeatList = seats.slice(0, l.members.length).sort((a, b) => a - b)
  const botSeatList = seats.slice(l.members.length).sort((a, b) => a - b)

  // Names, seat-indexed; human names reserved first, then bots deduped.
  const names = new Array<string>(playerCount)
  const nameCount = new Map<string, number>()
  const reserve = (want: string): string => {
    const n = (nameCount.get(want) ?? 0) + 1
    nameCount.set(want, n)
    return n === 1 ? want : `${want} ${n}`
  }
  const humans = new Map<Seat, { token: string; name: string }>()
  l.members.forEach((m, i) => {
    const seat = humanSeatList[i]
    names[seat] = reserve(m.name)
    humans.set(seat, { token: m.token, name: names[seat] })
  })
  const botInfo: Record<number, AgentPublicInfo> = {}
  const agents = new Map<Seat, AvalonAgent>()
  const seed = `web-${newId()}`
  botSeatList.forEach((seat, i) => {
    const def = defs[i]
    names[seat] = reserve(def.name)
    botInfo[seat] = { ...publicInfo(def), name: names[seat] }
  })

  const game = createGame({
    seed, playerCount, names, roles: l.config.roles,
    talk: { preProposal: 1, postProposal: 2 },
  })
  botSeatList.forEach((seat, i) => {
    agents.set(seat, createAgentFromDef(defs[i], { seed, seat }))
  })

  const id = newId()
  const session: Session = {
    game, agents, humans, botInfo,
    spectators: new Set(l.spectators.map((s) => s.token)),
    waiting: [], acting: [], degraded: [], degradedSeqs: [],
    listeners: new Set(), pumping: false,
  }
  sessions.set(id, session)
  l.status = 'started'
  l.gameId = id
  lobbyBroadcast(l)
  void pump(session)
}

// ---------- game sessions ----------

interface Session {
  game: Game
  agents: Map<Seat, AvalonAgent>                       // bot seats
  humans: Map<Seat, { token: string; name: string }>
  spectators: Set<string>                              // spectator tokens
  botInfo: Record<number, AgentPublicInfo>
  waiting: DecisionRequest[]                           // pending HUMAN asks (any seat)
  acting: Seat[]
  degraded: { seat: Seat; kind: string; error: string }[]
  degradedSeqs: number[]
  listeners: Set<{ res: http.ServerResponse; token: string }>
  pumping: boolean
}

const sessions = new Map<string, Session>()

// token -> seat number, 'spectator', or null (unknown).
function seatOf(s: Session, token: string): Seat | 'spectator' | null {
  for (const [seat, h] of s.humans) if (h.token === token) return seat
  if (s.spectators.has(token)) return 'spectator'
  return null
}

function payloadFor(s: Session, token: string) {
  const who = seatOf(s, token)
  const spectator = who === 'spectator' || who === null
  const view = spectator ? viewForSpectator(s.game) : viewFor(s.game, who as Seat)
  return {
    view,
    ask: spectator ? [] : s.waiting.filter((w) => w.seat === who),
    acting: s.acting,
    waitingOn: s.waiting.map((w) => s.humans.get(w.seat)?.name ?? `seat ${w.seat}`),
    degraded: s.degraded.length,
    degradedSeqs: s.degradedSeqs,
    bots: s.botInfo,
    spectator,
  }
}

function broadcast(s: Session): void {
  for (const l of s.listeners) {
    l.res.write(`data: ${JSON.stringify(payloadFor(s, l.token))}\n\n`)
  }
}

async function pump(s: Session): Promise<void> {
  if (s.pumping) return
  s.pumping = true
  try {
    while (s.game.phase !== 'gameOver') {
      const reqs = expectedDecisions(s.game)
      const botReqs = reqs.filter((r) => s.agents.has(r.seat))
      s.waiting = reqs.filter((r) => !s.agents.has(r.seat))
      if (botReqs.length === 0) {
        s.acting = []
        broadcast(s)
        return // resumes when a human POSTs a decision
      }
      s.acting = botReqs.map((r) => r.seat)
      broadcast(s)
      const decisions = await Promise.all(botReqs.map(async (req) => {
        const view = viewFor(s.game, req.seat)
        const agent = s.agents.get(req.seat)!
        try {
          return { req, decision: await agent.decide(req, view), fallback: false }
        } catch (err) {
          s.degraded.push({
            seat: req.seat, kind: req.kind,
            error: err instanceof Error ? err.message : String(err),
          })
          return { req, decision: heuristicDecide(req, view, s.game.seed), fallback: true }
        }
      }))
      for (const { req, decision, fallback } of decisions) {
        const seqStart = s.game.log.length
        let wasFallback = fallback
        try {
          applyDecision(s.game, req.seat, decision)
        } catch (err) {
          s.degraded.push({
            seat: req.seat, kind: req.kind,
            error: err instanceof Error ? err.message : String(err),
          })
          applyDecision(s.game, req.seat, heuristicDecide(req, viewFor(s.game, req.seat), s.game.seed))
          wasFallback = true
        }
        if (wasFallback) {
          for (let seq = seqStart; seq < s.game.log.length; seq++) s.degradedSeqs.push(seq)
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

// ---------- http plumbing ----------

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  let raw = ''
  for await (const chunk of req) raw += chunk
  return raw ? JSON.parse(raw) : {}
}

function sse(res: http.ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
}

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1)
  const file = path.join(DIST, path.normalize(rel))
  if (!file.startsWith(DIST) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
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
    // ---- lobbies ----
    if (req.method === 'POST' && url.pathname === '/api/lobby') {
      const body = await readBody(req)
      if (!inviteOk(body)) return json(res, 403, { error: 'invite code required', gated: true })
      const { lobby, token } = createLobby(body)
      json(res, 200, { lobbyId: lobby.id, token, ...lobbyPayload(lobby) })
      return
    }
    if (parts[0] === 'api' && parts[1] === 'lobby' && parts[2]) {
      const lobby = lobbies.get(parts[2])
      if (!lobby) return json(res, 404, { error: 'no such lobby' })
      if (req.method === 'GET' && parts[3] === 'preview') {
        json(res, 200, lobbyPayload(lobby))
        return
      }
      if (req.method === 'GET' && parts[3] === 'events') {
        sse(res)
        res.write(`data: ${JSON.stringify(lobbyPayload(lobby))}\n\n`)
        lobby.listeners.add(res)
        req.on('close', () => lobby.listeners.delete(res))
        return
      }
      if (req.method === 'POST' && parts[3] === 'join') {
        const body = await readBody(req)
        const name = cleanName(body.name, 'Player')
        const token = newToken()
        if (body.mode === 'spectate') {
          lobby.spectators.push({ token, name })
          if (lobby.status === 'started' && lobby.gameId) {
            sessions.get(lobby.gameId)?.spectators.add(token)
          }
          lobbyBroadcast(lobby)
          json(res, 200, { token, mode: 'spectate', ...lobbyPayload(lobby) })
          return
        }
        if (lobby.status !== 'open') {
          return json(res, 409, { error: 'game already started — you can still spectate', spectateAvailable: true })
        }
        if (lobby.members.length >= lobby.config.humanSeats) {
          return json(res, 409, { error: 'all player seats are taken — you can still spectate', spectateAvailable: true })
        }
        lobby.members.push({ token, name })
        if (lobby.members.length === lobby.config.humanSeats) startLobby(lobby)
        else lobbyBroadcast(lobby)
        json(res, 200, { token, mode: 'play', ...lobbyPayload(lobby) })
        return
      }
    }

    // ---- solo sugar: a humanSeats=1 lobby, auto-started ----
    if (req.method === 'POST' && url.pathname === '/api/game/new') {
      const body = await readBody(req)
      if (!inviteOk(body)) return json(res, 403, { error: 'invite code required', gated: true })
      const { lobby, token } = createLobby({
        name: body.humanName, playerCount: body.playerCount, humanSeats: 1,
        table: body.table, roles: body.roles,
      })
      const session = sessions.get(lobby.gameId!)!
      json(res, 200, { id: lobby.gameId, token, ...payloadFor(session, token) })
      return
    }

    // ---- game sessions ----
    if (parts[0] === 'api' && parts[1] === 'game' && parts[2]) {
      const s = sessions.get(parts[2])
      if (!s) return json(res, 404, { error: 'no such game' })
      if (req.method === 'GET' && parts[3] === 'events') {
        const token = url.searchParams.get('token') ?? ''
        if (seatOf(s, token) === null) return json(res, 403, { error: 'not a player or spectator in this game' })
        sse(res)
        res.write(`data: ${JSON.stringify(payloadFor(s, token))}\n\n`)
        const listener = { res, token }
        s.listeners.add(listener)
        req.on('close', () => s.listeners.delete(listener))
        return
      }
      if (req.method === 'POST' && parts[3] === 'decide') {
        const body = await readBody(req)
        const who = seatOf(s, typeof body.token === 'string' ? body.token : '')
        if (who === null || who === 'spectator') {
          return json(res, 403, { error: 'spectators cannot act' })
        }
        const decision = body.decision as Decision
        const match = s.waiting.find((w) => w.seat === who && w.kind === decision?.kind)
        if (!match) return json(res, 400, { error: `not waiting for a ${decision?.kind} from you` })
        try {
          applyDecision(s.game, who, decision)
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        }
        s.waiting = s.waiting.filter((w) => w !== match)
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

    // ---- agents / usage ----
    if (req.method === 'GET' && url.pathname === '/api/agents') {
      json(res, 200, {
        agents: library.map(publicInfo),
        models: ROSTER.map((r) => ({ id: r.id, name: r.displayName, slug: r.slug, tier: r.tier })),
        baseline: { rulesDigest: RULES_DIGEST, roleGuidance: ROLE_GUIDANCE },
        gated: !!inviteCode(),
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/agents') {
      const body = await readBody(req)
      if (!inviteOk(body)) return json(res, 403, { error: 'invite code required', gated: true })
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'agent'
      let id = base
      for (let i = 2; library.some((d) => d.id === id); i++) id = `${base}-${i}`
      const def = validateDef({
        id,
        name,
        version: '1.0',
        author: typeof body.author === 'string' ? body.author.slice(0, 60) : 'local',
        about: typeof body.about === 'string' ? body.about.slice(0, 300) : undefined,
        engine: {
          type: 'llm',
          model: body.model,
          personality: typeof body.personality === 'string' && body.personality.trim()
            ? body.personality.trim() : undefined,
        },
      })
      saveCustomDef(def)
      library = loadAgentLibrary()
      json(res, 200, { agent: publicInfo({ ...def, custom: true }) })
      return
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
  console.log(`AvaLLM server listening on http://localhost:${PORT}`)
  console.log(`client dist: ${fs.existsSync(path.join(DIST, 'index.html')) ? 'found' : 'NOT BUILT'}`)
})
