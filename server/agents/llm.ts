// The LLM-driven agent. Ladder per decision (design doc §3):
//   1. call -> tolerant parse -> legality check
//   2. on failure: ONE retry with the error appended
//   3. on second failure: throw — the runner substitutes the heuristic and
//      records the decision as degraded (never silent, never stalls).
// Scratchpad: before deciding, if a quest resolved since the last reflect,
// run a reflect call and fold the result into persistent private notes.

import { CALL_PARAMS } from '../llm/call-params.ts'
import type { LlmCallKind } from '../llm/call-params.ts'
import { rosterById } from '../llm/roster.ts'
import type { OpenRouterClient, Msg } from '../llm/openrouter.ts'
import { buildMessages } from './prompts.ts'
import type { AskExtra, PromptOverrides } from './prompts.ts'
import { legalityError, parseDecision } from './parse.ts'
import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'
import type { AvalonAgent } from './types.ts'

export interface LlmAgentOpts {
  modelId: string           // roster id, e.g. 'deepseek'
  client: OpenRouterClient
  agentId?: string          // library agent id, used for spend tags (defaults to modelId)
  label?: string            // display label for degrade attribution, e.g. 'Merlin Hunter v2'
                            // (two custom agents can share a model — the model name is ambiguous)
  prompts?: PromptOverrides // agent-config prompt layers
  temperature?: number      // agent-config override of the per-kind default, [0, 1]
}

// A short, whitespace-collapsed, quoted view of a failed raw reply, for the
// degrade record. Empty output is common on truncation, so name that case.
function rawSnippet(raw: string): string {
  const clean = raw.replace(/\s+/g, ' ').trim()
  if (!clean) return '(empty)'
  return JSON.stringify(clean.length > 200 ? `${clean.slice(0, 200)}…` : clean)
}

export function createLlmAgent(opts: LlmAgentOpts): AvalonAgent {
  const entry = rosterById(opts.modelId)
  const { client } = opts
  const tagId = opts.agentId ?? entry.id
  const label = opts.label ?? entry.displayName
  const overrides = opts.prompts ?? {}
  let scratchpad = ''
  let reflectedQuests = 0
  let pendingNotes: string | null = null

  async function callKind(
    kind: LlmCallKind, view: PlayerView,
    correction?: { prior: string; error: string }, extra?: AskExtra,
  ): Promise<string> {
    const params = CALL_PARAMS[kind]
    const messages: Msg[] = buildMessages(kind, view, scratchpad, overrides, extra)
    if (correction) {
      messages.push(
        { role: 'assistant', content: correction.prior },
        { role: 'user', content: `Your reply was not usable: ${correction.error}. Answer again with ONLY the required JSON object.` },
      )
    }
    return client.call(entry.slug, messages, {
      tag: `${tagId}/${kind}`,
      temperature: opts.temperature ?? params.temperature,
      max_tokens: params.max_tokens,
      response_format: params.json ? { type: 'json_object' } : undefined,
    })
  }

  async function maybeReflect(view: PlayerView): Promise<void> {
    const resolved = view.quests.filter((q) => q.result !== undefined).length
    if (resolved <= reflectedQuests) return
    reflectedQuests = resolved
    try {
      const content = await callKind('reflect', view)
      const parsed = parseDecision('reflect', content, view)
      if (!parsed.parseFailed && parsed.scratchpad) {
        scratchpad = parsed.scratchpad
        pendingNotes = parsed.scratchpad // ride the next decision into the log
      }
    } catch {
      // Reflection is best-effort; a failed reflect never blocks a decision.
    }
  }

  return {
    async decide(req: DecisionRequest, view: PlayerView): Promise<Decision> {
      await maybeReflect(view)
      // Good's quest card is forced (the engine coerces fail -> success), so
      // a call would buy nothing. Skipping it is unobservable at the table:
      // bot decisions resolve as a batch behind one broadcast, so per-seat
      // latency never shows.
      if (req.kind === 'quest' && view.alignment === 'good') {
        const decision: Decision = { kind: 'quest', card: 'success' }
        if (pendingNotes) {
          decision.notes = pendingNotes
          pendingNotes = null
        }
        return decision
      }
      const kind = req.kind as LlmCallKind
      const first = await callKind(kind, view)
      let parsed = parseDecision(kind, first, view)
      let error = parsed.parseFailed
        ? parsed.error!
        : parsed.decision && legalityError(parsed.decision, view)
      if (error) {
        const second = await callKind(kind, view, { prior: first, error })
        parsed = parseDecision(kind, second, view)
        error = parsed.parseFailed
          ? parsed.error!
          : parsed.decision && legalityError(parsed.decision, view)
        if (error) {
          // Carry the actual model output into the degrade record so a
          // truncated/malformed reply is diagnosable from the copy log, not
          // guessed. The runner/server both surface err.message verbatim, and
          // that text is already full-reveal-only, so the snippet leaks nothing
          // the transcript doesn't. Whitespace-collapsed + clipped short.
          throw new Error(
            `${label} failed ${kind} twice: ${error}. Raw output` +
            ` (1st: ${rawSnippet(first)}; 2nd: ${rawSnippet(second)})`,
          )
        }
      }
      const decision = parsed.decision!
      if (pendingNotes) {
        decision.notes = pendingNotes
        pendingNotes = null
      }
      // Commit-then-explain: the team is locked before the pitch is written,
      // so the speech can never contradict the action. Best-effort — a failed
      // pitch call just means a silent proposal.
      if (decision.kind === 'propose') {
        try {
          const content = await callKind('pitch', view, undefined, { chosenTeam: decision.team })
          const pitchParsed = parseDecision('pitch', content, view)
          if (!pitchParsed.parseFailed && pitchParsed.pitch) {
            decision.pitch = pitchParsed.pitch
            if (pitchParsed.thinking) {
              decision.thinking = [decision.thinking, pitchParsed.thinking].filter(Boolean).join(' / ')
            }
          }
        } catch {
          // silent proposal — the table will notice
        }
      }
      return decision
    },
  }
}
