// Agent definitions — the agent library. An agent is a CONFIG: identity
// (name/version/author/about/badge) + an engine. For llm engines the config
// owns the prompt LAYERS (strategy, personality, per-role and
// per-decision-kind guidance, temperature) and may SUGGEST a model; which
// model actually plays is a seat-time decision (resolveModel: lobby override
// > def suggestion > DEFAULT_MODEL — the host pays the bill, so the host gets
// the final say). The output contracts, rules digest, injection guard, and
// view rendering stay engine-owned so a custom agent can't break parsing or
// leak hidden information. Design: docs/design-custom-agents.md.
//
// Three tiers, earlier wins on id collision (collisions are surfaced, not
// silent — see loadAgentLibrary):
//   builtin — one agent per roster model (baseline prompts) + Autopilot
//   curated — checked-in agents/*.json, version with the repo, read-only
//   user    — data/agents/*.json, created via POST/PUT /api/agents (llm
//             engines only) or dropped in by hand (stdio engines are
//             file-drop ONLY: accepting commands over HTTP would be RCE)

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MODEL, ROSTER, rosterById } from '../llm/roster.ts'
import { CALL_PARAMS } from '../llm/call-params.ts'
import type { LlmCallKind } from '../llm/call-params.ts'
import { ROLE_ALIGNMENT, nameIsReserved } from '../engine/rules.ts'
import type { Role } from '../engine/types.ts'

export interface LlmEngine {
  type: 'llm'
  model?: string // roster id — a SUGGESTION; seat-time override wins, DEFAULT_MODEL backstops
  personality?: string
  strategy?: string
  roleGuidance?: Partial<Record<Role, string>>
  // 'replace' (default) swaps out the baseline guidance for that role;
  // 'append' layers the custom text under it, so the agent still rides
  // baseline strategy improvements.
  roleGuidanceMode?: 'replace' | 'append'
  kindGuidance?: Partial<Record<LlmCallKind, string>>
  temperature?: number // global sampling override, must be in [0, 1]
}

export type AgentEngine =
  | LlmEngine
  | { type: 'heuristic' }
  | { type: 'stdio'; cmd: string; args: string[] }

export type AgentTier = 'builtin' | 'curated' | 'user'

export interface AgentDef {
  id: string
  name: string
  version?: number
  author?: string
  about?: string
  badge?: { color?: string; monogram?: string }
  engine: AgentEngine
  tier?: AgentTier        // assigned at load, not persisted
  unavailable?: string    // reason this agent can't be seated (assigned at load)
}

// A library-load problem worth showing users, not just console logs
// (corrupt file, cross-tier id shadowing).
export interface LibraryProblem {
  file: string
  reason: string
}

// What the client sees (never raw stdio commands). Custom prompt configs are
// deliberately public — transparency is part of the premise, and secrecy is
// unenforceable under a shared invite code (design doc §4).
export interface AgentPublicInfo {
  id: string
  name: string
  version?: number
  author?: string
  about?: string
  model: string          // display name of the model, or 'rule-based' / 'external'
  color: string
  monogram: string
  personality?: string
  strategy?: string
  roleGuidance?: Partial<Record<Role, string>>
  roleGuidanceMode?: 'replace' | 'append'
  kindGuidance?: Partial<Record<LlmCallKind, string>>
  temperature?: number
  suggestedModel?: string // the def's RAW model suggestion (roster id), if any —
                          // `model` above is always the resolved display slug
  tunedChars: number     // aggregate custom prompt text, 0 for baseline agents
  custom: boolean        // editable (user tier)
  tier: AgentTier
  unavailable?: string
}

// One seat at a lobby table: which agent plays it, and (optionally) which
// model it runs on — a host-side, per-lobby choice that outranks the def's own
// suggestion. Model resolution order: seat override > def.engine.model >
// DEFAULT_MODEL.
export interface TableSeat {
  agent: string
  model?: string // roster id
}

export function resolveModel(def: AgentDef, override?: string): string {
  if (def.engine.type !== 'llm') throw new Error(`agent ${def.id} has no model (${def.engine.type} engine)`)
  return override ?? def.engine.model ?? DEFAULT_MODEL
}

// The one place that maps an llm engine config to the prompt layers
// buildMessages consumes. Every path that renders a def's prompt — live play
// (registry.ts), the editor preview (server.ts), and eval bank replay
// (server/eval/bank.ts) — MUST go through this, or a new prompt layer added
// to LlmEngine silently reaches some paths and not others (bank replay would
// then exercise a different prompt than the live game, invalidating its
// verdicts). Adding a layer here updates all callers at once.
export function promptOverridesOf(engine: LlmEngine): {
  personality?: string
  strategy?: string
  roleGuidance?: Partial<Record<Role, string>>
  roleGuidanceMode?: 'replace' | 'append'
  kindGuidance?: Partial<Record<LlmCallKind, string>>
} {
  return {
    personality: engine.personality,
    strategy: engine.strategy,
    roleGuidance: engine.roleGuidance,
    roleGuidanceMode: engine.roleGuidanceMode,
    kindGuidance: engine.kindGuidance,
  }
}

// Wire format for lobby tables: a bare agent id (legacy) or {agent, model?}.
// Throws on unknown agents/models and on model overrides for non-llm engines,
// so a bad table is rejected at lobby creation, never at game start.
export function parseTableSeat(raw: unknown, agentById: (id: string) => AgentDef): TableSeat {
  const t: Partial<TableSeat> | null = typeof raw === 'string' ? { agent: raw } : raw as Partial<TableSeat>
  if (!t || typeof t !== 'object' || typeof t.agent !== 'string') {
    throw new Error('table entry must be an agent id or {agent, model?}')
  }
  const def = agentById(t.agent) // throws on unknown agent
  if (t.model !== undefined) {
    if (typeof t.model !== 'string') throw new Error('seat model must be a roster id')
    rosterById(t.model) // throws on unknown model
    if (def.engine.type !== 'llm') {
      throw new Error(`agent ${def.id} is ${def.engine.type} — it does not take a model`)
    }
  } else if (def.unavailable) {
    // A stale model suggestion is curable by a seat override; without one the
    // seat is rejected here, at lobby creation — never at game start.
    throw new Error(`agent "${def.name}" cannot be seated: ${def.unavailable}`)
  }
  return t.model === undefined ? { agent: t.agent } : { agent: t.agent, model: t.model }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Curated agents ship WITH the repo — read-only, always baked into the deploy
// image, so their home is fixed at the repo-relative path.
export const CURATED_AGENTS_DIR = path.join(__dirname, '..', '..', 'agents')

// User agents are LIVE STATE created at runtime. On a PaaS the container
// filesystem is ephemeral (wiped every redeploy), so the store can be pointed
// at a mounted persistent disk. The composition root (server startup) resolves
// the target from the environment AFTER .env has loaded and calls useDataDir
// ONCE; the whole module then reads this single value, so the boot library scan
// and every later save/delete agree on one directory. Tests and the sim never
// call the setter, so they always use the repo-local default regardless of any
// ambient RAILWAY_*/AVALON_* vars in the developer's shell.
let userAgentsDirPath = path.join(__dirname, '..', '..', 'data', 'agents')

export function userAgentsDir(): string {
  return userAgentsDirPath
}

// Point the user-agents store under `base` (…/agents is appended). Called once
// at startup; an undefined/empty base keeps the repo-local default.
export function useDataDir(base: string | undefined): void {
  if (base) userAgentsDirPath = path.join(base, 'agents')
}

// Exported so the API payload can serve them — the client meter must display
// the same caps the server enforces, not a hardcoded copy.
export const FIELD_CAP = 2000
export const AGGREGATE_CAP = 10_000

function hashColor(s: string): string {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return `hsl(${h % 360} 55% 48%)`
}

function monogramOf(name: string): string {
  const words = name.trim().split(/\s+/)
  return ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase()
}

export function builtinDefs(): AgentDef[] {
  const models: AgentDef[] = ROSTER.map((r) => ({
    id: r.id,
    name: r.displayName,
    author: 'built-in',
    version: 1,
    about: r.blurb,
    badge: r.badge,
    engine: { type: 'llm', model: r.id },
    tier: 'builtin' as const,
  }))
  return [
    ...models,
    {
      id: 'autopilot',
      name: 'Autopilot',
      author: 'built-in',
      version: 1,
      about: 'The rule-based player from the strategy playbook. Free, instant, and unimaginative.',
      badge: { color: '#5a5f73', monogram: 'AP' },
      engine: { type: 'heuristic' },
      tier: 'builtin',
    },
  ]
}

// Windows textareas paste \r\n, which inflates char caps and puts stray \r
// into prompts — normalize every custom text field at the validation boundary.
const normText = (s: string) => s.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

export function customChars(e: AgentEngine): number {
  if (e.type !== 'llm') return 0
  return (e.strategy?.length ?? 0)
    + (e.personality?.length ?? 0)
    + Object.values(e.roleGuidance ?? {}).reduce((n, t) => n + (t?.length ?? 0), 0)
    + Object.values(e.kindGuidance ?? {}).reduce((n, t) => n + (t?.length ?? 0), 0)
}

function validateGuidanceMap(
  map: Record<string, unknown>, field: string, noun: string, validKeys: (k: string) => boolean,
): void {
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    throw new Error(`${field} must be an object of ${noun} -> text`)
  }
  // validKeys callers must use Object.hasOwn, never `in`: `in` walks the
  // prototype chain, so "toString"/"__proto__" would pass as valid keys.
  for (const [key, text] of Object.entries(map)) {
    if (!validKeys(key)) throw new Error(`${field}: unknown ${noun} "${key}"`)
    if (typeof text !== 'string' || text.length > FIELD_CAP) {
      throw new Error(`${field}.${key} must be a string (max ${FIELD_CAP} chars)`)
    }
  }
}

export interface ValidateOpts {
  // Lenient library-load mode: accept defs whose roster model id has
  // disappeared so they can be surfaced as `unavailable` instead of silently
  // skipped. POST/PUT always validate strictly.
  allowUnknownModel?: boolean
}

export function validateDef(raw: unknown, opts: ValidateOpts = {}): AgentDef {
  const d = raw as Partial<AgentDef> & { version?: number | string }
  if (!d || typeof d !== 'object') throw new Error('agent def must be an object')
  if (typeof d.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(d.id)) {
    throw new Error('agent id must be a short kebab-case slug')
  }
  // Agent names become bot table names, injected verbatim into every player's
  // prompt — they get the same treatment as human names (CLAUDE.md): strip
  // prompt-structure markup, collapse whitespace, reject reserved identity
  // words ("You", "system", ...). Enforced HERE so every ingest path (POST,
  // PUT, file-drop, curated) is covered.
  if (typeof d.name !== 'string') throw new Error('agent name required (max 40 chars)')
  d.name = d.name.replace(/[<>{}[\]|\\]/g, '').replace(/\s+/g, ' ').trim()
  if (!d.name || d.name.length > 40) throw new Error('agent name required (max 40 chars)')
  if (nameIsReserved(d.name)) throw new Error(`"${d.name}" can't be used as an agent name — it's a reserved word`)
  // Legacy defs carry version: '1.0' — read any string as its leading number.
  if (typeof d.version === 'string') d.version = Math.trunc(parseFloat(d.version)) || 1
  if (d.version !== undefined && (typeof d.version !== 'number' || !Number.isInteger(d.version) || d.version < 1)) {
    throw new Error('version must be a positive integer')
  }
  const e = d.engine as AgentEngine | undefined
  if (!e || typeof e !== 'object') throw new Error('agent engine required')
  if (e.type === 'llm') {
    // The model is an optional SUGGESTION (resolveModel backstops).
    if (e.model !== undefined) {
      if (typeof e.model !== 'string') throw new Error('model must be a roster id')
      if (!opts.allowUnknownModel) rosterById(e.model) // throws on unknown model
    }
    for (const field of ['personality', 'strategy'] as const) {
      const v = e[field]
      if (v !== undefined) {
        if (typeof v !== 'string' || v.length > FIELD_CAP) {
          throw new Error(`${field} must be a string (max ${FIELD_CAP} chars)`)
        }
        e[field] = normText(v)
      }
    }
    if (e.roleGuidance !== undefined) {
      validateGuidanceMap(e.roleGuidance, 'roleGuidance', 'role', (k) => Object.hasOwn(ROLE_ALIGNMENT, k))
      for (const k of Object.keys(e.roleGuidance)) {
        e.roleGuidance[k as Role] = normText(e.roleGuidance[k as Role]!)
      }
    }
    if (e.roleGuidanceMode !== undefined && e.roleGuidanceMode !== 'replace' && e.roleGuidanceMode !== 'append') {
      throw new Error(`roleGuidanceMode must be "replace" or "append"`)
    }
    if (e.kindGuidance !== undefined) {
      validateGuidanceMap(e.kindGuidance, 'kindGuidance', 'kind', (k) => Object.hasOwn(CALL_PARAMS, k))
      for (const k of Object.keys(e.kindGuidance)) {
        e.kindGuidance[k as LlmCallKind] = normText(e.kindGuidance[k as LlmCallKind]!)
      }
    }
    if (e.temperature !== undefined) {
      if (typeof e.temperature !== 'number' || !Number.isFinite(e.temperature)
        || e.temperature < 0 || e.temperature > 1) {
        throw new Error('temperature must be a number in [0, 1]')
      }
    }
    if (customChars(e) > AGGREGATE_CAP) {
      throw new Error(`custom prompt text exceeds ${AGGREGATE_CAP} chars total`)
    }
  } else if (e.type === 'stdio') {
    if (typeof e.cmd !== 'string' || !Array.isArray(e.args)) {
      throw new Error('stdio engine needs cmd + args')
    }
  } else if (e.type !== 'heuristic') {
    throw new Error(`unknown engine type: ${String((e as any).type)}`)
  }
  return d as AgentDef
}

export interface AgentLibrary {
  agents: AgentDef[]
  problems: LibraryProblem[]
}

function loadTier(
  dir: string, tier: AgentTier, seen: Set<string>,
  agents: AgentDef[], problems: LibraryProblem[],
): void {
  if (!fs.existsSync(dir)) return
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    try {
      const def = validateDef(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), { allowUnknownModel: true })
      // Filename must equal the internal id: saveCustomDef/deleteCustomDef
      // address defs as `${id}.json`, so a mismatched hand-dropped file would
      // make PUT write a duplicate and DELETE a silent no-op. Enforce the
      // invariant at the load boundary instead of trusting every writer.
      if (def.id !== file.slice(0, -'.json'.length)) {
        throw new Error(`file name must match its id — rename to ${def.id}.json`)
      }
      if (seen.has(def.id)) {
        // Earlier tiers win, but a vanished agent is a bug report, not a shrug.
        const reason = `id "${def.id}" is shadowed by a ${agents.find((a) => a.id === def.id)?.tier} agent — rename the file's id to restore it`
        console.warn(`[agents] ${file}: ${reason}`)
        problems.push({ file: `${tier}/${file}`, reason })
        continue
      }
      seen.add(def.id)
      // Only a STALE suggestion is a problem; no suggestion at all is fine
      // (the seat override or DEFAULT_MODEL backstops it).
      const suggested = def.engine.type === 'llm' ? def.engine.model : undefined
      if (suggested !== undefined && !ROSTER.some((r) => r.id === suggested)) {
        def.unavailable = `model "${suggested}" is no longer in the roster — pick a new model`
      }
      agents.push({ ...def, tier })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(`[agents] skipping ${file}: ${reason}`)
      problems.push({ file: `${tier}/${file}`, reason: `unreadable (${reason})` })
    }
  }
}

export function loadAgentLibrary(): AgentLibrary {
  const agents = builtinDefs()
  const problems: LibraryProblem[] = []
  const seen = new Set(agents.map((d) => d.id))
  loadTier(CURATED_AGENTS_DIR, 'curated', seen, agents, problems)
  loadTier(userAgentsDir(), 'user', seen, agents, problems)
  return { agents, problems }
}

// Atomic write (temp + rename): a Railway redeploy mid-write must not leave
// truncated JSON that silently drops the agent from the next boot's library.
export function saveCustomDef(def: AgentDef): void {
  const dir = userAgentsDir()
  fs.mkdirSync(dir, { recursive: true })
  const { tier, unavailable, ...persisted } = def
  const file = path.join(dir, `${def.id}.json`)
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(persisted, null, 2))
  fs.renameSync(tmp, file)
}

export function deleteCustomDef(id: string): void {
  fs.rmSync(path.join(userAgentsDir(), `${id}.json`), { force: true })
}

// Whether ANY file (including corrupt/skipped ones that never made it into
// the library) already claims this id on disk — id allocation must not
// silently clobber a broken file the user was told to fix.
export function customDefFileExists(id: string): boolean {
  return fs.existsSync(path.join(userAgentsDir(), `${id}.json`))
}

export function publicInfo(def: AgentDef, modelOverride?: string): AgentPublicInfo {
  // The OpenRouter slug, not a marketing name — "deepseek/deepseek-v4-flash"
  // tells you exactly what you're playing against. Always the RESOLVED model
  // (seat override > def suggestion > default), so the badge never lies about
  // which model is actually answering; a stale suggestion renders as
  // "<id> (unavailable)" instead of throwing so the library can list it.
  const e = def.engine
  let model = 'external'
  if (e.type === 'heuristic') model = 'rule-based'
  else if (e.type === 'llm') {
    // resolveModel owns the precedence; it can't throw inside the llm branch.
    const resolved = resolveModel(def, modelOverride)
    model = ROSTER.find((r) => r.id === resolved)?.slug ?? `${resolved} (unavailable)`
  }
  return {
    id: def.id,
    name: def.name,
    version: def.version,
    author: def.author,
    about: def.about,
    model,
    color: def.badge?.color ?? hashColor(def.id),
    monogram: def.badge?.monogram ?? monogramOf(def.name),
    personality: e.type === 'llm' ? e.personality : undefined,
    strategy: e.type === 'llm' ? e.strategy : undefined,
    roleGuidance: e.type === 'llm' ? e.roleGuidance : undefined,
    roleGuidanceMode: e.type === 'llm' ? e.roleGuidanceMode : undefined,
    kindGuidance: e.type === 'llm' ? e.kindGuidance : undefined,
    temperature: e.type === 'llm' ? e.temperature : undefined,
    suggestedModel: e.type === 'llm' ? e.model : undefined,
    tunedChars: customChars(e),
    custom: def.tier === 'user',
    tier: def.tier ?? 'user',
    unavailable: def.unavailable,
  }
}
