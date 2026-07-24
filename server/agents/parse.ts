// Tolerant parsing of LLM decision output (datingsim parse-json philosophy:
// salvage first, explicit parseFailed distinct from empty). Legality beyond
// shape (team size, seat ranges) is checked by the agent/engine, not here.

import { teamsEqual } from '../engine/rules.ts'
import type { Decision, PlayerView, Seat } from '../engine/types.ts'
import type { LlmCallKind } from '../llm/call-params.ts'

export interface ParsedDecision {
  decision?: Decision
  scratchpad?: string   // reflect only
  pitch?: string        // pitch only
  thinking: string
  parseFailed: boolean
  error?: string
}

const THINKING_MAX_CHARS = 2000
const SAY_MAX_CHARS = 400

// The scratchpad is the bot's persistent memory — it is re-injected into every
// later prompt (llm.ts keeps it; prompts.ts renders it under "YOUR PRIVATE
// NOTES"). These are generous backstops, NOT functional limits: truncation
// happens post-generation, so a low cap saves no tokens — it only discards
// reasoning the model already produced, then feeds the clipped version back in.
// Sized so a full 10-player scratchpad (9 reads + a plan) never re-clips.
const READ_MAX_CHARS = 400        // one seat's suspicion read
const PLAN_MAX_CHARS = 600        // the plan for the coming round
const DEDUCTION_MAX_CHARS = 400   // one standing logical inference (was 240,
                                  // which clipped multi-clause deductions mid-
                                  // conclusion; matched to READ_MAX_CHARS)
const DEDUCTIONS_MAX = 6          // how many inferences to carry
const SCRATCHPAD_MAX_CHARS = 7000 // the whole assembled pad. Never binds in
                                  // practice: the pad is REPLACED each reflect
                                  // (not accumulated) and reflect's max_tokens
                                  // caps one reply well under this.

// Exported for eval tooling (probe/judge), which parses non-decision JSON
// replies with the same salvage tolerance.
export function extractObject(content: string): Record<string, unknown> | null {
  const tryParse = (s: string) => {
    try {
      const o = JSON.parse(s)
      return o && typeof o === 'object' && !Array.isArray(o) ? o : null
    } catch {
      return null
    }
  }
  const direct = tryParse(content.trim())
  if (direct) return direct
  // Greedy first-{ to last-} so trailing prose doesn't truncate the object.
  const m = content.match(/\{[\s\S]*\}/)
  if (m) {
    const fenced = tryParse(m[0])
    if (fenced) return fenced
  }
  return null
}

const thinkingOf = (o: Record<string, unknown> | null): string =>
  typeof o?.thinking === 'string' ? o.thinking.trim().slice(0, THINKING_MAX_CHARS) : ''

export function parseDecision(kind: LlmCallKind, content: string, view: PlayerView): ParsedDecision {
  const o = extractObject(content)
  const thinking = thinkingOf(o)
  const fail = (error: string): ParsedDecision => ({ thinking, parseFailed: true, error })

  switch (kind) {
    case 'discuss': {
      const leanRaw = typeof o?.lean === 'string' ? o.lean.toLowerCase() : undefined
      const lean = leanRaw === 'approve' || leanRaw === 'reject' || leanRaw === 'unsure'
        ? leanRaw : undefined
      if (o && typeof o.say === 'string') {
        return { decision: { kind: 'discuss', say: o.say.trim().slice(0, SAY_MAX_CHARS), lean, thinking }, thinking, parseFailed: false }
      }
      // Salvage: a model that answered in prose is still speech — but JSON-ish
      // debris is not.
      const raw = content.trim()
      if (raw && !raw.includes('{') && !raw.includes('"say"')) {
        return { decision: { kind: 'discuss', say: raw.slice(0, SAY_MAX_CHARS), thinking }, thinking, parseFailed: false }
      }
      return fail('expected {"thinking": "...", "say": "...", "lean": "..."}')
    }

    case 'pitch': {
      if (o && typeof o.pitch === 'string' && o.pitch.trim()) {
        return { pitch: o.pitch.trim().slice(0, SAY_MAX_CHARS), thinking, parseFailed: false }
      }
      const raw = content.trim()
      if (raw && !raw.includes('{')) {
        return { pitch: raw.slice(0, SAY_MAX_CHARS), thinking, parseFailed: false }
      }
      return fail('expected {"thinking": "...", "pitch": "..."}')
    }

    case 'propose': {
      const team = Array.isArray(o?.team) ? o.team : null
      if (team && team.every((s) => Number.isInteger(s))) {
        // Tolerate models that still bundle a pitch with the team.
        const pitch = typeof o?.pitch === 'string' ? o.pitch.trim().slice(0, SAY_MAX_CHARS) : undefined
        return { decision: { kind: 'propose', team: team as Seat[], pitch, thinking }, thinking, parseFailed: false }
      }
      // Salvage: pull seat numbers out of the text in order.
      const size = view.quests[view.round - 1].teamSize
      const nums = [...content.matchAll(/\b\d+\b/g)]
        .map((m) => Number(m[0]))
        .filter((n) => n >= 0 && n < view.playerCount)
      const distinct = [...new Set(nums)]
      if (distinct.length >= size) {
        return { decision: { kind: 'propose', team: distinct.slice(0, size), thinking }, thinking, parseFailed: false }
      }
      return fail(`expected {"team": [${size} seat numbers]}`)
    }

    case 'finalize': {
      const stickRaw = o?.stick
      const stick = stickRaw === true || stickRaw === 'true' ? true
        : stickRaw === false || stickRaw === 'false' ? false : undefined
      if (stick === true) {
        return { decision: { kind: 'finalize', stick: true, thinking }, thinking, parseFailed: false }
      }
      if (stick === false) {
        const team = Array.isArray(o?.team) ? o.team : null
        if (team && team.length > 0 && team.every((s) => Number.isInteger(s))) {
          const reason = typeof o?.reason === 'string' && o.reason.trim()
            ? o.reason.trim().slice(0, SAY_MAX_CHARS) : undefined
          return {
            decision: { kind: 'finalize', stick: false, team: team as Seat[], reason, thinking },
            thinking, parseFailed: false,
          }
        }
        // stick:false with no usable team is closer to indecision than to a
        // revision — do not silently coerce to stick; ask again.
        return fail('"stick" is false but "team" is missing — give the revised team as seat numbers, or reply {"stick": true}')
      }
      return fail('expected {"stick": true} or {"stick": false, "team": [<seats>], "reason": "..."}')
    }

    case 'vote': {
      const v = typeof o?.vote === 'string' ? o.vote.toLowerCase() : ''
      if (v === 'approve' || v === 'reject') {
        return { decision: { kind: 'vote', vote: v, thinking }, thinking, parseFailed: false }
      }
      const m = content.toLowerCase().match(/\b(approve|reject)\b/g)
      if (m) {
        const last = m[m.length - 1] as 'approve' | 'reject'
        return { decision: { kind: 'vote', vote: last, thinking }, thinking, parseFailed: false }
      }
      return fail('expected {"vote": "approve"|"reject"}')
    }

    case 'quest': {
      const c = typeof o?.card === 'string' ? o.card.toLowerCase() : ''
      if (c === 'success' || c === 'fail') {
        return { decision: { kind: 'quest', card: c, thinking }, thinking, parseFailed: false }
      }
      const m = content.toLowerCase().match(/\b(success|fail)\b/g)
      if (m) {
        const last = m[m.length - 1] as 'success' | 'fail'
        return { decision: { kind: 'quest', card: last, thinking }, thinking, parseFailed: false }
      }
      return fail('expected {"card": "success"|"fail"}')
    }

    case 'assassinate': {
      const t = o?.target
      if (Number.isInteger(t)) {
        return { decision: { kind: 'assassinate', target: t as Seat, thinking }, thinking, parseFailed: false }
      }
      // Salvage: a named player, else the first in-range seat number that isn't self.
      for (const p of view.players) {
        if (p.seat !== view.seat && content.includes(p.name)) {
          return { decision: { kind: 'assassinate', target: p.seat, thinking }, thinking, parseFailed: false }
        }
      }
      const num = [...content.matchAll(/\b\d+\b/g)]
        .map((m) => Number(m[0]))
        .find((n) => n >= 0 && n < view.playerCount && n !== view.seat)
      if (num !== undefined) {
        return { decision: { kind: 'assassinate', target: num, thinking }, thinking, parseFailed: false }
      }
      return fail('expected {"target": <seat number>}')
    }

    case 'reflect': {
      // The scratchpad is the bot's own memory — any coherent text will do,
      // but empty output is a failure so the previous scratchpad survives.
      if (o && (Array.isArray(o.suspicions) || Array.isArray(o.deductions) || typeof o.plan === 'string')) {
        const susp = Array.isArray(o.suspicions)
          ? o.suspicions
              .filter((s: any) => s && Number.isInteger(s.seat))
              .map((s: any) => `seat ${s.seat}: ${String(s.read ?? '').slice(0, READ_MAX_CHARS)} (${Number(s.confidence) || 0}%)`)
              .join('; ')
          : ''
        // Deductions are the bot's running logical model — chains of inference
        // ("X, therefore Y") that outlive a single turn's `thinking`.
        const deductions = Array.isArray(o.deductions)
          ? o.deductions
              .filter((d: any) => typeof d === 'string' && d.trim())
              .slice(0, DEDUCTIONS_MAX)
              .map((d: string) => `- ${d.trim().slice(0, DEDUCTION_MAX_CHARS)}`)
              .join('\n')
          : ''
        const plan = typeof o.plan === 'string' ? o.plan.slice(0, PLAN_MAX_CHARS) : ''
        const pad = [
          susp,
          deductions && `Deductions:\n${deductions}`,
          plan && `Plan: ${plan}`,
        ].filter(Boolean).join('\n').slice(0, SCRATCHPAD_MAX_CHARS)
        if (pad) return { scratchpad: pad, thinking, parseFailed: false }
      }
      const raw = content.trim().slice(0, SCRATCHPAD_MAX_CHARS)
      if (raw && !raw.includes('"suspicions"')) return { scratchpad: raw, thinking, parseFailed: false }
      return fail('expected {"suspicions": [...], "plan": "..."}')
    }
  }
}

// Shape-level legality the agent can check before handing to the engine, so
// the correction retry gets a specific error message.
export function legalityError(d: Decision, view: PlayerView): string | null {
  if (d.kind === 'propose' || (d.kind === 'finalize' && d.stick === false)) {
    const size = view.quests[view.round - 1].teamSize
    if (d.team.length !== size) return `team must have exactly ${size} members, got ${d.team.length}`
    if (new Set(d.team).size !== d.team.length) return 'team has duplicate seats'
    if (d.team.some((s) => s < 0 || s >= view.playerCount)) return 'team has an invalid seat number'
  }
  if (d.kind === 'finalize' && d.stick === false) {
    if (teamsEqual(d.team, view.currentTeam ?? [])) {
      return 'revised team is identical to the current proposal — reply {"stick": true} instead'
    }
  }
  if (d.kind === 'assassinate') {
    if (d.target < 0 || d.target >= view.playerCount) return 'target is not a valid seat'
    if (d.target === view.seat) return 'you cannot target yourself'
  }
  return null
}
