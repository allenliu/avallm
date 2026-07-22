// Agent definitions — the agent library. An agent is a CONFIG: identity
// (name/version/author/about/badge) + an engine. For llm engines the config
// owns the model and prompt LAYERS (personality, per-role strategy
// overrides); the output contracts, rules digest, injection guard, and view
// rendering stay engine-owned so a custom agent can't break parsing or leak
// hidden information.
//
// Built-ins: one agent per roster model (baseline prompts) + Autopilot (the
// heuristic player). Custom agents are JSON files in data/agents/ — created
// via POST /api/agents (llm engines only) or dropped in by hand (stdio
// engines are file-drop ONLY: accepting commands over HTTP would be RCE).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROSTER, rosterById } from '../llm/roster.ts'
import type { Role } from '../engine/types.ts'

export interface LlmEngine {
  type: 'llm'
  model: string // roster id
  personality?: string
  roleGuidance?: Partial<Record<Role, string>>
}

export type AgentEngine =
  | LlmEngine
  | { type: 'heuristic' }
  | { type: 'stdio'; cmd: string; args: string[] }

export interface AgentDef {
  id: string
  name: string
  version?: string
  author?: string
  about?: string
  badge?: { color?: string; monogram?: string }
  engine: AgentEngine
  custom?: boolean
}

// What the client sees (never raw stdio commands).
export interface AgentPublicInfo {
  id: string
  name: string
  version?: string
  author?: string
  about?: string
  model: string          // display name of the model, or 'rule-based' / 'external'
  color: string
  monogram: string
  personality?: string   // shown for transparency in the library
  custom: boolean
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const USER_AGENTS_DIR = path.join(__dirname, '..', '..', 'data', 'agents')

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
    version: '1.0',
    about: r.blurb,
    badge: r.badge,
    engine: { type: 'llm', model: r.id },
  }))
  return [
    ...models,
    {
      id: 'autopilot',
      name: 'Autopilot',
      author: 'built-in',
      version: '1.0',
      about: 'The rule-based player from the strategy playbook. Free, instant, and unimaginative.',
      badge: { color: '#5a5f73', monogram: 'AP' },
      engine: { type: 'heuristic' },
    },
  ]
}

export function validateDef(raw: unknown): AgentDef {
  const d = raw as Partial<AgentDef>
  if (!d || typeof d !== 'object') throw new Error('agent def must be an object')
  if (typeof d.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(d.id)) {
    throw new Error('agent id must be a short kebab-case slug')
  }
  if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 40) {
    throw new Error('agent name required (max 40 chars)')
  }
  const e = d.engine as AgentEngine | undefined
  if (!e || typeof e !== 'object') throw new Error('agent engine required')
  if (e.type === 'llm') {
    rosterById(e.model) // throws on unknown model
    if (e.personality !== undefined && (typeof e.personality !== 'string' || e.personality.length > 2000)) {
      throw new Error('personality must be a string (max 2000 chars)')
    }
    if (e.roleGuidance !== undefined) {
      for (const [role, text] of Object.entries(e.roleGuidance)) {
        if (typeof text !== 'string' || text.length > 2000) {
          throw new Error(`roleGuidance.${role} must be a string (max 2000 chars)`)
        }
      }
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

export function loadAgentLibrary(): AgentDef[] {
  const lib = builtinDefs()
  const seen = new Set(lib.map((d) => d.id))
  if (fs.existsSync(USER_AGENTS_DIR)) {
    for (const file of fs.readdirSync(USER_AGENTS_DIR).filter((f) => f.endsWith('.json')).sort()) {
      try {
        const def = validateDef(JSON.parse(fs.readFileSync(path.join(USER_AGENTS_DIR, file), 'utf8')))
        if (seen.has(def.id)) continue // built-ins win; first file wins among dupes
        seen.add(def.id)
        lib.push({ ...def, custom: true })
      } catch (err) {
        console.warn(`[agents] skipping ${file}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }
  return lib
}

export function saveCustomDef(def: AgentDef): void {
  fs.mkdirSync(USER_AGENTS_DIR, { recursive: true })
  fs.writeFileSync(path.join(USER_AGENTS_DIR, `${def.id}.json`), JSON.stringify(def, null, 2))
}

export function publicInfo(def: AgentDef): AgentPublicInfo {
  // The OpenRouter slug, not a marketing name — "deepseek/deepseek-v4-flash"
  // tells you exactly what you're playing against.
  const model = def.engine.type === 'llm'
    ? rosterById(def.engine.model).slug
    : def.engine.type === 'heuristic' ? 'rule-based' : 'external'
  return {
    id: def.id,
    name: def.name,
    version: def.version,
    author: def.author,
    about: def.about,
    model,
    color: def.badge?.color ?? hashColor(def.id),
    monogram: def.badge?.monogram ?? monogramOf(def.name),
    personality: def.engine.type === 'llm' ? def.engine.personality : undefined,
    custom: def.custom ?? false,
  }
}
