// kind -> call params, one checked-in table shared by the live server and
// any headless harness so they can't drift (datingsim v2-call-params pattern).
// reflect is the scratchpad-update call (not an engine decision kind).

// 'pitch' is the second half of proposing: the team is chosen first, then
// the pitch is generated with the team locked — so the speech can never
// contradict the action.
export type LlmCallKind = 'discuss' | 'propose' | 'pitch' | 'vote' | 'quest' | 'assassinate' | 'reflect'

export interface CallParams {
  temperature: number
  max_tokens: number
  json: boolean
}

// NOTE: vote/quest budgets were 220/180 and caused the dominant degradation
// class — verbose models (Haiku worst, 32% of votes) wrote a long "thinking"
// field, hit the ceiling mid-object, and the reply was TRUNCATED before the
// required vote/card field, so the parse failed twice and fell back to the
// heuristic. Fixed two ways: the vote/quest contracts now cap "thinking" (so
// the object stays small), and these budgets have headroom so a slightly-over
// model still lands the final field. Keep the field LAST + budget generous, or
// the truncation bug returns.
export const CALL_PARAMS: Record<LlmCallKind, CallParams> = {
  discuss: { temperature: 0.8, max_tokens: 300, json: true },
  propose: { temperature: 0.6, max_tokens: 300, json: true },
  pitch: { temperature: 0.7, max_tokens: 250, json: true },
  vote: { temperature: 0.4, max_tokens: 400, json: true },
  quest: { temperature: 0.3, max_tokens: 350, json: true },
  assassinate: { temperature: 0.4, max_tokens: 300, json: true },
  reflect: { temperature: 0.5, max_tokens: 350, json: true },
}
