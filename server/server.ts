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
//   GET  /api/game/:id/valid?token=   (200 live seat / 403 wrong token / 404 no game)
//   GET  /api/game/:id/events?token=  (SSE: that seat's view; spectators get public-only)
//   POST /api/game/:id/decide         {token, decision}
//   GET  /api/game/:id/reveal         (gameOver only)
//   GET  /api/game/:id/transcript?token=&raw=  (copyable debug transcript; full reveal when final or solo-vs-bots, else scoped to the seat)
//   GET/POST /api/agents, GET /api/usage
// Static: client/dist

import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createGame, applyDecision, expectedDecisions, renamePlayer } from './engine/game.ts'
import { viewFor, viewForSpectator } from './engine/view.ts'
import { heuristicDecide } from './agents/heuristic.ts'
import { createAgentFromDef } from './agents/registry.ts'
import { AGGREGATE_CAP, FIELD_CAP, customDefFileExists, deleteCustomDef, loadAgentLibrary, parseTableSeat, promptOverridesOf, publicInfo, saveCustomDef, useDataDir, validateDef } from './agents/defs.ts'
import { loadEnv } from './llm/env.ts'
import type { AgentDef, AgentPublicInfo, LibraryProblem, LlmEngine, TableSeat } from './agents/defs.ts'
import { RULES_DIGEST, ROLE_GUIDANCE, TABLE_TALK_NORMS, OUTPUT_CONTRACTS, buildMessages } from './agents/prompts.ts'
import { CALL_PARAMS } from './llm/call-params.ts'
import type { LlmCallKind } from './llm/call-params.ts'
import { getClient } from './llm/client.ts'
import { ROSTER, DEFAULT_TABLE, DEFAULT_MODEL } from './llm/roster.ts'
import { ROLE_ALIGNMENT, nameIsReserved, validateRoles } from './engine/rules.ts'
import type { AvalonAgent } from './agents/types.ts'
import type { Decision, DecisionRequest, Game, GameEvent, Role, Seat } from './engine/types.ts'
import { renderTranscript, type TranscriptSeat } from './transcript.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'client', 'dist')
// Railway (and most PaaS) inject PORT; AVALON_PORT wins for local overrides.
const PORT = Number(process.env.AVALON_PORT || process.env.PORT) || 8787

// Dev-only: artificial pause on the "acting" state so the screenshot harness
// can capture the transient thinking / sealing-ballot UI. Unset (0) in prod.
const BOT_DELAY_MS = Number(process.env.AVALON_BOT_DELAY_MS) || 0

// Dev-only (off unless AVALON_DEV_SEVER=1): lets the screenshot harness force a
// seat's SSE stream to drop so it can capture the client's reconnect banner —
// the one transient state the harness otherwise can't reach (there's no natural
// way to sever a live stream mid-shoot). When the flag is on, POST .../dev/sever
// closes the seat's live stream AND records the token so its reconnect is refused
// (503), keeping the banner up long enough to shoot. Both the route and the refusal
// are gated on the flag, so in prod the route 404s and no stream is ever severed.
const DEV_SEVER = process.env.AVALON_DEV_SEVER === '1'
const severedTokens = new Set<string>()

// Public-deployment gate: when AVALON_INVITE_CODE is set, creating anything
// that can spend money or write disk (lobbies, games, custom agents) requires
// the code. Joining an existing lobby by URL is deliberately NOT gated —
// invitees were invited by the person who had the code. Read live so an env
// edit takes effect without a restart.
const inviteCode = () => process.env.AVALON_INVITE_CODE || ''
const inviteOk = (body: any) => !inviteCode() || body?.invite === inviteCode()

// Resolve where user-created agents live BEFORE the first library scan. Load
// .env up front (the LLM client also loads it lazily, but the boot scan and
// later saves must agree on one directory — real env vars still win, so this is
// idempotent) and point the store at a persistent disk if one is configured.
// AVALON_DATA_DIR wins, else Railway's injected RAILWAY_VOLUME_MOUNT_PATH.
loadEnv(__dirname)
const dataDirBase = process.env.AVALON_DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH
if (dataDirBase && !fs.existsSync(dataDirBase)) {
  // A configured base that doesn't exist means the volume almost certainly
  // isn't mounted — mkdirSync would silently create it in the ephemeral
  // container fs, so agents would "save" and then vanish on redeploy. Surface
  // it instead of masking it.
  console.warn(`[agents] data dir "${dataDirBase}" does not exist — is the persistent volume mounted? Custom agents written there will be LOST on redeploy.`)
}
useDataDir(dataDirBase)

let library: AgentDef[] = []
let libraryProblems: LibraryProblem[] = []
function reloadLibrary(): void {
  const lib = loadAgentLibrary()
  library = lib.agents
  libraryProblems = lib.problems
}
reloadLibrary()

const libById = (id: string): AgentDef => {
  const def = library.find((d) => d.id === id)
  if (!def) throw new Error(`unknown agent: ${id}`)
  return def
}

const newToken = () => crypto.randomBytes(16).toString('hex')
const newId = () => crypto.randomBytes(5).toString('hex')

// Read llm-engine prompt fields from a request body. PUT semantics when
// `base` is given: absent field = keep prior value; null or empty = clear.
// A present-but-wrong-typed value THROWS (handlers turn it into a 400) —
// coercing a type error into "clear this field" would silently destroy
// stored config. Key names, caps, and ranges still validate in validateDef.
function engineFrom(body: any, base?: LlmEngine): LlmEngine {
  const text = (key: string) => (v: unknown): string | undefined => {
    if (v === null || v === undefined) return undefined
    if (typeof v !== 'string') throw new Error(`${key} must be a string (or null to clear)`)
    return v.trim() || undefined
  }
  const guidanceMap = (key: string) => (v: unknown): Record<string, string> | undefined => {
    if (v === null || v === undefined) return undefined
    if (typeof v !== 'object' || Array.isArray(v)) throw new Error(`${key} must be an object of key -> text`)
    const out: Record<string, string> = {}
    for (const [k, t] of Object.entries(v)) {
      if (typeof t !== 'string') throw new Error(`${key}.${k} must be a string`)
      if (t.trim()) out[k] = t.trim() // blank entry = clear it (the editor's mechanism)
    }
    return Object.keys(out).length ? out : undefined
  }
  const pick = <T>(key: string, parse: (v: unknown) => T | undefined, prior: T | undefined) =>
    (body && key in body ? parse(body[key]) : prior)
  return {
    type: 'llm',
    model: pick('model', text('model'), base?.model),
    personality: pick('personality', text('personality'), base?.personality),
    strategy: pick('strategy', text('strategy'), base?.strategy),
    roleGuidance: pick('roleGuidance', guidanceMap('roleGuidance'), base?.roleGuidance) as LlmEngine['roleGuidance'],
    roleGuidanceMode: pick('roleGuidanceMode', (v) => {
      if (v === null || v === undefined || v === '') return undefined
      if (v === 'append' || v === 'replace') return v
      throw new Error('roleGuidanceMode must be "replace" or "append"')
    }, base?.roleGuidanceMode),
    kindGuidance: pick('kindGuidance', guidanceMap('kindGuidance'), base?.kindGuidance) as LlmEngine['kindGuidance'],
    temperature: pick('temperature', (v) => {
      if (v === null || v === undefined) return undefined
      if (typeof v !== 'number') throw new Error('temperature must be a number (or null to clear)')
      return v
    }, base?.temperature),
  }
}

// Preview fixture: a real engine-generated mid-game state — createGame with a
// fixed seed, heuristic-driven into quest 2's table talk. Handcrafted views
// would get privateInfo consistency wrong (design doc §7). Built lazily once.
const FIXTURE_SCRATCHPAD = 'Q1 succeeded with Ada/Circe/Fergus. Brutus rejected a clean team — watching him. Elaine is quiet.'
let fixtureCache: Game | null = null
function fixtureGame(): Game {
  if (fixtureCache) return fixtureCache
  const game = createGame({
    seed: 'agent-preview-fixture', playerCount: 7,
    names: ['Ada', 'Brutus', 'Circe', 'Dagonet', 'Elaine', 'Fergus', 'Gwen'],
    talk: { preProposal: 1, postProposal: 1 },
  })
  let guard = 0
  while (!(game.round >= 2 && game.phase === 'discussion') && game.phase !== 'gameOver' && guard++ < 800) {
    const [req] = expectedDecisions(game)
    if (!req) break
    applyDecision(game, req.seat, heuristicDecide(req, viewFor(game, req.seat), game.seed))
  }
  fixtureCache = game
  return game
}

// Structural cleanup only — strips prompt-injection markup and clamps length.
function sanitizeName(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '')
    .replace(/[<>{}[\]|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
}

// A safe canonical name, or the fallback when empty or a reserved word (a
// pronoun/game term that would poison other players' prompts — see rules.ts).
function cleanName(raw: unknown, fallback: string): string {
  const name = sanitizeName(raw)
  return name && !nameIsReserved(name) ? name : fallback
}

// ---------- lobbies ----------

interface Lobby {
  id: string
  config: {
    playerCount: number
    humanSeats: number
    table: TableSeat[]     // bot seats (agent + optional model override), length playerCount - humanSeats
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
    // Agent id + name + resolved model per bot seat, so invitees see exactly
    // what's playing (a custom agent's name alone doesn't reveal its model).
    // The id lets the client pick the same celestial glyph the in-game seat
    // uses (celestialFor keys on the agent id, not the display name).
    table: l.config.table.map((t) => {
      const info = publicInfo(seatDef(t), t.model)
      return { id: info.id, name: info.name, model: info.model }
    }),
  }
}

// Resolve a lobby seat to a seatable def — NEVER throws. An agent deleted (or
// model-orphaned) after lobby creation falls back to Autopilot, visibly. This
// is the one chokepoint for "is this seat playable"; lobbyPayload runs inside
// the start path (lobbyBroadcast), so a throwing lookup there would strand a
// just-started session before its first pump.
function seatDef(t: TableSeat): AgentDef {
  const def = library.find((d) => d.id === t.agent)
  // A seat model override cures a stale def suggestion (parseTableSeat rule).
  if (def && !(def.unavailable && t.model === undefined)) return def
  console.warn(`[agents] seat fallback: "${t.agent}" ${def ? def.unavailable : 'no longer exists'} — seating Autopilot`)
  return libById('autopilot')
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
    if (!Array.isArray(body.roles) || !body.roles.every((r: unknown) => typeof r === 'string' && Object.hasOwn(ROLE_ALIGNMENT, r))) {
      throw new Error('roles must be an array of valid role names')
    }
    roles = body.roles as Role[]
    // Validate the full set now (count + evil balance), not later in
    // startLobby — a throw there would 500 the joiner who fills the lobby and
    // leave it permanently stuck 'open' with no free seats.
    validateRoles(playerCount, roles)
  }

  const botCount = playerCount - humanSeats
  let table: TableSeat[]
  if (body.table !== undefined) {
    if (!Array.isArray(body.table)) throw new Error('table must be an array of agent ids or {agent, model?}')
    if (body.table.length !== botCount) throw new Error(`table must have exactly ${botCount} agents`)
    // Validate everything now (unknown agents/models, model on a non-llm
    // engine, unavailable agents without a curing override) — same fail-early
    // reasoning as roles above; parseTableSeat owns the rules.
    table = body.table.map((t: unknown) => parseTableSeat(t, libById))
  } else {
    const pool = [...DEFAULT_TABLE, ...ROSTER.map((r) => r.id).filter((rid) => !DEFAULT_TABLE.includes(rid))]
    table = Array.from({ length: botCount }, (_, i) => ({ agent: pool[i % pool.length] }))
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
  const { playerCount, table } = l.config
  const defs = table.map(seatDef)

  // Shuffle humans across the whole table (no "host is always seat 0" tell).
  const seats = Array.from({ length: playerCount }, (_, i) => i)
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[seats[i], seats[j]] = [seats[j], seats[i]]
  }
  const humanSeatList = seats.slice(0, l.members.length).sort((a, b) => a - b)
  const botSeatList = seats.slice(l.members.length).sort((a, b) => a - b)

  // Names, seat-indexed; bot names reserved first, then humans deduped around
  // them (so a name collision suffixes the human, protecting the bot's identity).
  const names = new Array<string>(playerCount)
  const nameCount = new Map<string, number>()
  const reserve = (want: string): string => {
    const n = (nameCount.get(want) ?? 0) + 1
    nameCount.set(want, n)
    return n === 1 ? want : `${want} ${n}`
  }
  const botInfo: Record<number, AgentPublicInfo> = {}
  const agents = new Map<Seat, AvalonAgent>()
  // Deep-copy each seat's def PLUS its seat model override: the reveal (and,
  // later, session snapshots) must serve the config that actually played, so
  // a PUT or DELETE mid-game only affects future games (design doc §5). The
  // def is kept raw — overwriting engine.model would erase the distinction
  // between "def suggested X" and "host overrode to X".
  const agentDefs: Record<number, { def: AgentDef; model?: string }> = {}
  const seed = `web-${newId()}`
  // Reserve bot (roster) names FIRST, so a human who picks an in-play bot's
  // name is the one demoted to "<name> 2" — never the bot. Names are injected
  // verbatim into every player's prompt, so an unsuffixed impostor could
  // otherwise pose as the model to the humans and the other bots alike.
  botSeatList.forEach((seat, i) => {
    const def = defs[i]
    names[seat] = reserve(def.name)
    // publicInfo gets the seat's model override so the in-game badge shows
    // the model that actually answers, never just the def's suggestion.
    botInfo[seat] = { ...publicInfo(def, table[i].model), name: names[seat] }
    agentDefs[seat] = { def: structuredClone(def), model: table[i].model }
  })
  const humans = new Map<Seat, { token: string; name: string }>()
  l.members.forEach((m, i) => {
    const seat = humanSeatList[i]
    names[seat] = reserve(m.name)
    humans.set(seat, { token: m.token, name: names[seat] })
  })

  const game = createGame({
    seed, playerCount, names, roles: l.config.roles,
    talk: { preProposal: 1, postProposal: 2 },
  })
  botSeatList.forEach((seat, i) => {
    agents.set(seat, createAgentFromDef(defs[i], { seed, seat }, table[i].model))
  })

  const id = newId()
  const session: Session = {
    game, agents, humans, botInfo, agentDefs,
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
  agentDefs: Record<number, { def: AgentDef; model?: string }>  // def snapshots + seat overrides, taken at game start
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
      // Dev-only: hold the "acting" state briefly so the screenshot harness can
      // snapshot the transient thinking / sealing-ballot UI (autopilot bots
      // otherwise decide in zero frames). Never set in production.
      if (BOT_DELAY_MS > 0) await new Promise((r) => setTimeout(r, BOT_DELAY_MS))
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
        const hb = setInterval(() => res.write(': hb\n\n'), 25_000)
        req.on('close', () => { clearInterval(hb); lobby.listeners.delete(res) })
        return
      }
      if (req.method === 'POST' && parts[3] === 'rename') {
        const body = await readBody(req)
        const token = typeof body.token === 'string' ? body.token : ''
        const member = lobby.members.find((m) => m.token === token)
          ?? lobby.spectators.find((sp) => sp.token === token)
        if (!member) return json(res, 403, { error: 'not in this lobby' })
        const name = sanitizeName(body.name)
        if (!name) return json(res, 400, { error: 'name must not be empty' })
        if (nameIsReserved(name)) return json(res, 400, { error: `"${name}" can't be used as a name — it's a reserved word` })
        const taken = [...lobby.members, ...lobby.spectators]
          .some((m) => m.token !== token && m.name.toLowerCase() === name.toLowerCase())
        if (taken) return json(res, 409, { error: `the name "${name}" is already taken in this lobby` })
        member.name = name
        lobbyBroadcast(lobby)
        json(res, 200, { ok: true, name })
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
        // Solo default is 'Human' (a plain, non-pronoun identity), not the
        // lobby path's 'Host'. It must never be 'You': that pronoun, injected
        // into the bots' prompts, reads as second-person and makes every bot
        // think it is the leader. The human's own view renders "You" for their
        // seat client-side, so the on-screen label is unchanged.
        name: cleanName(body.humanName, 'Human'),
        playerCount: body.playerCount, humanSeats: 1,
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
      // Cheap liveness/seat check for reconnecting clients: EventSource can't
      // read HTTP status, so the browser probes this before opening the stream
      // to tell "game gone / not my seat" (404/403) from a live reconnect (200).
      if (req.method === 'GET' && parts[3] === 'valid') {
        const token = url.searchParams.get('token') ?? ''
        if (seatOf(s, token) === null) return json(res, 403, { error: 'not a player or spectator in this game' })
        return json(res, 200, { ok: true })
      }
      // Dev-only sever hook (see DEV_SEVER): drop this seat's live stream now and
      // record its token so the reconnect below is refused — the client's banner
      // then stays up for the screenshot. The whole route is absent in prod.
      if (DEV_SEVER && req.method === 'POST' && parts[3] === 'dev' && parts[4] === 'sever') {
        const token = url.searchParams.get('token') ?? ''
        if (seatOf(s, token) === null) return json(res, 403, { error: 'not a player or spectator in this game' })
        severedTokens.add(token)
        for (const l of [...s.listeners]) if (l.token === token) { s.listeners.delete(l); l.res.end() }
        return json(res, 200, { ok: true, severed: true })
      }
      if (req.method === 'GET' && parts[3] === 'events') {
        const token = url.searchParams.get('token') ?? ''
        if (seatOf(s, token) === null) return json(res, 403, { error: 'not a player or spectator in this game' })
        // A severed token (dev only) gets a hard error so EventSource gives up
        // (readyState CLOSED, no more retries) and the reconnect banner holds still.
        if (DEV_SEVER && severedTokens.has(token)) return json(res, 503, { error: 'stream severed (dev)' })
        sse(res)
        res.write(`data: ${JSON.stringify(payloadFor(s, token))}\n\n`)
        const listener = { res, token }
        s.listeners.add(listener)
        // Heartbeat comments keep idle streams alive through proxies (Railway
        // edge culls quiet connections — mail-chess games idle for hours).
        const hb = setInterval(() => res.write(': hb\n\n'), 25_000)
        req.on('close', () => { clearInterval(hb); s.listeners.delete(listener) })
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
      if (req.method === 'POST' && parts[3] === 'rename') {
        const body = await readBody(req)
        const who = seatOf(s, typeof body.token === 'string' ? body.token : '')
        if (who === null || who === 'spectator') {
          return json(res, 403, { error: 'only seated players can rename' })
        }
        if (s.game.phase === 'gameOver') return json(res, 400, { error: 'the game is over' })
        try {
          renamePlayer(s.game, who, typeof body.name === 'string' ? body.name : '')
        } catch (err) {
          return json(res, 400, { error: err instanceof Error ? err.message : String(err) })
        }
        const human = s.humans.get(who)
        if (human) human.name = s.game.players[who].name
        broadcast(s)
        json(res, 200, { ok: true, name: s.game.players[who].name })
        return
      }
      if (req.method === 'GET' && parts[3] === 'reveal') {
        if (s.game.phase !== 'gameOver') return json(res, 403, { error: 'game still running' })
        json(res, 200, {
          players: s.game.players.map((p) => ({ seat: p.seat, name: p.name, role: p.role, alignment: p.alignment })),
          log: s.game.log,
          degraded: s.degraded,
          // The configs that actually played (def snapshots from game start,
          // immune to library edits/deletes) — full transparency post-game.
          agents: Object.fromEntries(
            Object.entries(s.agentDefs).map(([seat, snap]) => [seat, publicInfo(snap.def, snap.model)]),
          ),
        })
        return
      }
      // ---- copyable debug transcript (mid-game or final) ----
      // Fidelity honors the hidden-information invariant: a FULL reveal (roles +
      // every bot's private reasoning) is only produced once the game is over
      // (public anyway, like /reveal) OR when a lone human is playing against
      // bots — nobody else can be cheated in a solo table, and that is the
      // debugging case. Any other mid-game request is SCOPED to the requester's
      // own view (public events + their own private events), so no bot roles or
      // reasoning ever leak into a multi-human game.
      if (req.method === 'GET' && parts[3] === 'transcript') {
        const token = url.searchParams.get('token') ?? ''
        const who = seatOf(s, token)
        const over = s.game.phase === 'gameOver'
        // Mid-game, require a participant (seat or spectator), mirroring /events;
        // /reveal-equivalent openness applies only once the game is finished.
        if (!over && who === null) return json(res, 403, { error: 'not a player or spectator in this game' })
        const full = over || (s.humans.size === 1 && typeof who === 'number')
        const log: GameEvent[] = full
          ? s.game.log
          : typeof who === 'number'
            ? viewFor(s.game, who).events
            : viewForSpectator(s.game).events
        const seats: TranscriptSeat[] = s.game.players.map((p) => ({
          seat: p.seat,
          name: p.name,
          agent: s.humans.has(p.seat) ? 'human' : (s.botInfo[p.seat]?.model ?? 'bot'),
          ...(full ? { role: p.role, alignment: p.alignment } : {}),
        }))
        const text = renderTranscript({
          id: s.game.id, seed: s.game.seed, playerCount: s.game.config.playerCount,
          phase: s.game.phase, round: s.game.round, proposalNum: s.game.proposalNum,
          leaderSeat: s.game.leaderSeat, quests: s.game.quests, seats, log,
          // Only a full reveal carries the per-seat degraded entries (seat/kind/
          // raw error text). A scoped transcript omits them — payloadFor hands a
          // live client only a bare count — so a co-player in a multi-human game
          // gets no bot error detail the UI otherwise withholds.
          degraded: full ? s.degraded : undefined,
          winner: s.game.winner, winReason: s.game.winReason,
          revealed: full,
          scopedTo: full ? undefined : (typeof who === 'number' ? who : 'spectator'),
          capturedAt: new Date().toISOString(),
          includeRaw: url.searchParams.get('raw') !== '0',
        })
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(text)
        return
      }
    }

    // ---- agents / usage ----
    if (req.method === 'GET' && url.pathname === '/api/agents') {
      json(res, 200, {
        // Wrap, don't pass publicInfo to .map directly: .map supplies the
        // index as the 2nd arg, which publicInfo now reads as a model override.
        agents: library.map((d) => publicInfo(d)),
        problems: libraryProblems,
        models: ROSTER.map((r) => ({ id: r.id, name: r.displayName, slug: r.slug, tier: r.tier })),
        defaultTable: DEFAULT_TABLE,
        defaultModel: DEFAULT_MODEL,
        // The prompt anatomy the agent editor shows read-only: what surrounds
        // an author's custom layers (design doc §5).
        baseline: {
          rulesDigest: RULES_DIGEST,
          roleGuidance: ROLE_GUIDANCE,
          tableTalkNorms: TABLE_TALK_NORMS,
          outputContracts: OUTPUT_CONTRACTS,
          kinds: Object.keys(CALL_PARAMS),
          // Roles actually present in the preview fixture — the editor's role
          // picker must not offer roles that can only ever 400.
          previewRoles: [...new Set(fixtureGame().players.map((p) => p.role))],
          // The caps the server enforces; the client meter displays these
          // rather than hardcoding its own copy.
          caps: { field: FIELD_CAP, aggregate: AGGREGATE_CAP },
        },
        gated: !!inviteCode(),
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/api/agents') {
      const body = await readBody(req)
      if (!inviteOk(body)) return json(res, 403, { error: 'invite code required', gated: true })
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      // The id regex needs >= 2 chars, so a 1-char slug ('Q' -> 'q') falls
      // back to 'agent' like the empty case does.
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30)
      const stem = base.length >= 2 ? base : 'agent'
      // Dedupe against files on disk too, not just loaded agents — a corrupt
      // (load-skipped) file still owns its id; clobbering it would destroy
      // the very content the problems list told the user to fix.
      let id = stem
      for (let i = 2; library.some((d) => d.id === id) || customDefFileExists(id); i++) id = `${stem}-${i}`
      let def: AgentDef
      try {
        def = validateDef({
          id,
          name,
          version: 1,
          author: typeof body.author === 'string' && body.author.trim() ? body.author.trim().slice(0, 60) : 'local',
          about: typeof body.about === 'string' && body.about.trim() ? body.about.slice(0, 300) : undefined,
          // engineFrom reads all prompt layers; the model stays optional (a
          // personality-only agent rides the seat/server default).
          engine: engineFrom(body),
        })
      } catch (err) {
        return json(res, 400, { error: err instanceof Error ? err.message : String(err) })
      }
      saveCustomDef(def)
      reloadLibrary()
      json(res, 200, { agent: publicInfo(libById(def.id)) })
      return
    }
    // Free iteration loop: render the exact messages buildMessages would
    // produce for a draft config against a real engine-generated fixture
    // game — no LLM call, no save (design doc §7).
    if (req.method === 'POST' && url.pathname === '/api/agents/preview') {
      const body = await readBody(req)
      if (!inviteOk(body)) return json(res, 403, { error: 'invite code required', gated: true })
      const game = fixtureGame()
      const rolesInPlay = [...new Set(game.players.map((p) => p.role))]
      // Object.hasOwn, not `in` (prototype keys like "__proto__" would pass);
      // an unknown kind is a 400, never a silent coercion — a typo'd kind
      // must not render a discuss prompt presented as the requested one.
      const rawKind = typeof body.kind === 'string' && body.kind ? body.kind : 'discuss'
      if (!Object.hasOwn(CALL_PARAMS, rawKind)) {
        return json(res, 400, { error: `unknown kind "${rawKind}"`, kinds: Object.keys(CALL_PARAMS) })
      }
      const kind = rawKind as LlmCallKind
      const role = typeof body.role === 'string' && body.role ? body.role : 'servant'
      const player = game.players.find((p) => p.role === role)
      if (!player) return json(res, 400, { error: `role "${role}" is not in the preview game`, rolesInPlay })
      // Validate the draft layers exactly like a save would, minus the model
      // requirement (a half-filled form should still preview).
      let engine: LlmEngine
      try {
        const def = validateDef({
          id: 'preview', name: 'Preview',
          engine: engineFrom(body),
        }, { allowUnknownModel: true })
        engine = def.engine as LlmEngine
      } catch (err) {
        return json(res, 400, { error: err instanceof Error ? err.message : String(err) })
      }
      const messages = buildMessages(kind, viewFor(game, player.seat), FIXTURE_SCRATCHPAD, promptOverridesOf(engine))
      const chars = messages.reduce((n, m) => n + m.content.length, 0)
      json(res, 200, { messages, rolesInPlay, kinds: Object.keys(CALL_PARAMS), tokenEstimate: Math.round(chars / 4) })
      return
    }
    if (parts[0] === 'api' && parts[1] === 'agents' && parts[2]
      && (req.method === 'PUT' || req.method === 'DELETE')) {
      const def = library.find((d) => d.id === parts[2])
      if (!def) return json(res, 404, { error: 'no such agent' })
      if (def.tier !== 'user') {
        return json(res, 403, { error: `${def.tier} agents cannot be edited or deleted` })
      }
      const body = await readBody(req)
      if (!inviteOk(body)) return json(res, 403, { error: 'invite code required', gated: true })
      if (req.method === 'DELETE') {
        deleteCustomDef(def.id)
        reloadLibrary()
        // Running games keep their def snapshots; open lobbies stay alive
        // because every seat lookup goes through the non-throwing seatDef
        // (payloads show Autopilot, and the game starts with Autopilot).
        json(res, 200, { ok: true })
        return
      }
      if (def.engine.type !== 'llm') {
        return json(res, 400, { error: 'only llm agents are editable over HTTP' })
      }
      // Identity fields use the same rules as POST — validateDef is the
      // arbiter (an over-long name 400s here exactly as it does on create,
      // never a silent truncation).
      let updated: AgentDef
      try {
        updated = validateDef({
          id: def.id,
          name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : def.name,
          version: (def.version ?? 1) + 1,
          author: typeof body.author === 'string' && body.author.trim() ? body.author.trim().slice(0, 60) : def.author,
          about: 'about' in body
            ? (typeof body.about === 'string' && body.about.trim() ? body.about.slice(0, 300) : undefined)
            : def.about,
          badge: def.badge,
          engine: engineFrom(body, def.engine),
        })
      } catch (err) {
        return json(res, 400, { error: err instanceof Error ? err.message : String(err) })
      }
      saveCustomDef(updated)
      reloadLibrary()
      json(res, 200, { agent: publicInfo(libById(def.id)) })
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

// Bind a port only when run as the entry point (`node server/server.ts`), so
// tests can import the handler and drive it on an ephemeral port of their own.
export { server }

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  server.listen(PORT, () => {
    console.log(`AvaLLM server listening on http://localhost:${PORT}`)
    console.log(`client dist: ${fs.existsSync(path.join(DIST, 'index.html')) ? 'found' : 'NOT BUILT'}`)
  })
}
