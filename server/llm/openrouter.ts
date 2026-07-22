// OpenRouter client + spend accounting, ported from datingsim
// game/lib/openrouter.cjs. One chokepoint for every paid LLM call:
//   - live OPENROUTER_API_KEY read per call
//   - AbortController timeout (default 60s / OPENROUTER_TIMEOUT_MS)
//   - per-tag spend map using OpenRouter's real usage.cost
//   - spend ceiling OPENROUTER_MAX_SPEND_USD -> refuse-before-call (.status=429)
//   - reasoning suppressed by default via reasoning-policy (per-family flags)
//   - provider prefs via provider-policy; violation + reasoning-leak counters
//   - blank-content-under-json retry (drop response_format, retry once)

import { providerPrefsFor, providerServedOutsidePolicy } from './provider-policy.ts'
import { suppressionFor } from './reasoning-policy.ts'

export interface CallOpts {
  tag?: string
  temperature?: number
  max_tokens?: number
  response_format?: { type: string }
  reasoning?: Record<string, unknown>
  allowReasoning?: boolean
  provider?: Record<string, unknown>
}

export interface SpendEntry {
  cost: number
  calls: number
  prompt: number
  completion: number
  reasoning: number
  reasoningLeakCalls: number
  providerViolationCalls: number
  model: string
  providers: Record<string, number>
}

export interface Msg {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export class SpendCeilingError extends Error {
  code = 'SPEND_CEILING'
  status = 429
}

export interface OpenRouterClient {
  call(model: string, messages: Msg[], opts?: CallOpts): Promise<string>
  getSpend(): Record<string, SpendEntry>
  getTotalCost(): number
}

export function createOpenRouter(opts: { timeoutMs?: number; quiet?: boolean } = {}): OpenRouterClient {
  const TIMEOUT_MS = opts.timeoutMs
    ?? (process.env.OPENROUTER_TIMEOUT_MS ? Number(process.env.OPENROUTER_TIMEOUT_MS) : 60_000)
  const quiet = opts.quiet ?? false
  const SPEND: Record<string, SpendEntry> = {}
  const isBlank = (s: unknown) => typeof s !== 'string' || s.trim() === ''
  const wantsNoReasoning = (r: Record<string, unknown> | undefined) =>
    !!r && (r.effort === 'none' || r.enabled === false)

  function maxSpendUsd(): number | null {
    const v = Number(process.env.OPENROUTER_MAX_SPEND_USD)
    return Number.isFinite(v) && v > 0 ? v : null
  }

  function getTotalCost(): number {
    return Object.values(SPEND).reduce((s, e) => s + (e.cost || 0), 0)
  }

  // Enforced at the dispatch chokepoint (issue), so EVERY outbound call —
  // including the blank-under-json retry — is gated, never just the first.
  // This is refuse-before-call: the crossing call still completes and
  // concurrent in-flight calls can overshoot, so the cap is best-effort, not
  // a hard guarantee (no pre-call price is available to reserve against).
  function enforceCeiling(tag: string): void {
    const cap = maxSpendUsd()
    if (cap != null && getTotalCost() >= cap) {
      if (!quiet) {
        console.warn(`[openrouter] SPEND CEILING $${cap} reached — refusing ${tag}`)
      }
      throw new SpendCeilingError(`spend ceiling $${cap} reached`)
    }
  }

  function recordSpend(
    tag: string, model: string, usage: any, leaked: boolean,
    provider: string | undefined, providerViolated: boolean,
  ): void {
    SPEND[tag] ??= {
      cost: 0, calls: 0, prompt: 0, completion: 0, reasoning: 0,
      reasoningLeakCalls: 0, providerViolationCalls: 0, model, providers: {},
    }
    const s = SPEND[tag]
    s.model = model
    s.calls++
    if (usage) {
      s.cost += Number(usage.cost) || 0
      s.prompt += Number(usage.prompt_tokens) || 0
      s.completion += Number(usage.completion_tokens) || 0
      s.reasoning += Number(usage.completion_tokens_details?.reasoning_tokens) || 0
    }
    if (leaked) s.reasoningLeakCalls++
    if (provider) s.providers[provider] = (s.providers[provider] || 0) + 1
    if (providerViolated) s.providerViolationCalls++
  }

  async function issue(
    model: string, messages: Msg[], callOpts: CallOpts,
    { omitResponseFormat = false } = {},
  ): Promise<string> {
    enforceCeiling(callOpts.tag || 'other')
    const key = process.env.OPENROUTER_API_KEY
    if (!key) throw new Error('OPENROUTER_API_KEY not set')
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
    const policy = suppressionFor(model)
    const resolvedReasoning =
      callOpts.reasoning != null ? callOpts.reasoning
      : callOpts.allowReasoning ? null
      : policy.value
    const resolvedProvider = callOpts.provider != null ? callOpts.provider : providerPrefsFor(model)
    let res: Response
    try {
      res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'application/json',
          'X-Title': 'AvaLLM',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: callOpts.temperature ?? 0.7,
          max_tokens: callOpts.max_tokens ?? 400,
          usage: { include: true },
          ...(callOpts.response_format && !omitResponseFormat
            ? { response_format: callOpts.response_format }
            : {}),
          ...(resolvedReasoning ? { reasoning: resolvedReasoning } : {}),
          ...(resolvedProvider ? { provider: resolvedProvider } : {}),
        }),
        signal: ctrl.signal,
      })
    } catch (e: any) {
      if (e && e.name === 'AbortError') throw new Error(`OpenRouter timeout after ${TIMEOUT_MS}ms`)
      throw e
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) {
      const t = await res.text()
      throw new Error('OpenRouter ' + res.status + ': ' + t.slice(0, 300))
    }
    const data: any = await res.json()
    const tag = callOpts.tag || 'other'
    const rt = Number(data.usage?.completion_tokens_details?.reasoning_tokens) || 0
    const allowedReasoning =
      callOpts.allowReasoning === true ||
      (callOpts.reasoning != null && !wantsNoReasoning(callOpts.reasoning))
    const leaked = rt > 0 && !allowedReasoning && policy.canSuppress
    const providerViolated =
      callOpts.provider == null &&
      providerServedOutsidePolicy(resolvedProvider as any, data.provider)
    recordSpend(tag, model, data.usage, leaked, data.provider, providerViolated)
    if (leaked && !quiet) {
      console.warn(`[openrouter] ${model} (${tag}) emitted ${rt} reasoning tokens despite suppression`)
    }
    if (providerViolated && !quiet) {
      console.warn(`[openrouter] ${model} (${tag}) served outside its provider allowlist by '${data.provider}'`)
    }
    return data.choices?.[0]?.message?.content || ''
  }

  async function call(model: string, messages: Msg[], callOpts: CallOpts = {}): Promise<string> {
    // Ceiling is enforced inside issue() so the retry below is gated too.
    const content = await issue(model, messages, callOpts)
    // Blank under json_object is never valid; retry once without response_format
    // (re-routes providers and removes the known deepseek json×non-think trap).
    if (callOpts.response_format && isBlank(content)) {
      if (!quiet) {
        console.warn(`[openrouter] ${model} (${callOpts.tag}) returned BLANK under response_format — retrying without it`)
      }
      return issue(model, messages, callOpts, { omitResponseFormat: true })
    }
    return content
  }

  return { call, getSpend: () => SPEND, getTotalCost }
}
