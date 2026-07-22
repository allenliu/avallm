// kind -> call params, one checked-in table shared by the live server and
// any headless harness so they can't drift (datingsim v2-call-params pattern).
// reflect is the scratchpad-update call (not an engine decision kind).

export type LlmCallKind = 'discuss' | 'propose' | 'vote' | 'quest' | 'assassinate' | 'reflect'

export interface CallParams {
  temperature: number
  max_tokens: number
  json: boolean
}

export const CALL_PARAMS: Record<LlmCallKind, CallParams> = {
  discuss: { temperature: 0.8, max_tokens: 300, json: true },
  propose: { temperature: 0.6, max_tokens: 350, json: true },
  vote: { temperature: 0.4, max_tokens: 220, json: true },
  quest: { temperature: 0.3, max_tokens: 180, json: true },
  assassinate: { temperature: 0.4, max_tokens: 300, json: true },
  reflect: { temperature: 0.5, max_tokens: 350, json: true },
}
