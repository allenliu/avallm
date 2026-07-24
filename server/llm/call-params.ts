// kind -> call params, one checked-in table shared by the live server and
// any headless harness so they can't drift (datingsim v2-call-params pattern).
// reflect is the scratchpad-update call (not an engine decision kind).

// 'pitch' is the second half of proposing: the team is chosen first, then
// the pitch is generated with the team on the table — so the speech can never
// contradict the action.
export type LlmCallKind =
  | 'discuss' | 'propose' | 'pitch' | 'finalize' | 'vote' | 'quest' | 'assassinate' | 'reflect'

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
//
// discuss is the SAME class at the highest-frequency call, but its contract
// keeps a deliberately generous 60-word "thinking" (clipping thinking makes the
// bot dumber) plus "say" and "lean" AFTER it — so at 300 a verbose model (a
// DeepSeek discuss degraded this way) truncated before "say". discuss buys the
// headroom with a bigger budget rather than a smaller contract.
export const CALL_PARAMS: Record<LlmCallKind, CallParams> = {
  discuss: { temperature: 0.8, max_tokens: 500, json: true },
  propose: { temperature: 0.6, max_tokens: 300, json: true },
  pitch: { temperature: 0.7, max_tokens: 250, json: true },
  finalize: { temperature: 0.6, max_tokens: 350, json: true },
  vote: { temperature: 0.4, max_tokens: 400, json: true },
  quest: { temperature: 0.3, max_tokens: 350, json: true },
  // assassinate is the game's single highest-impact call (fires once, and >50%
  // of evil wins run through it) AND the most reasoning-heavy ASK (rank every
  // good player by vote-accuracy, separate Merlin from Percival). A reasoning
  // model (gpt-oss-120b, observed) burns completion budget on reasoning tokens
  // that count against max_tokens; at 400 it emitted ~400 reasoning tokens and
  // returned an EMPTY answer TWICE, degrading to the heuristic — the salvage
  // ladder can't rescue empty content. So this budget is deliberately generous:
  // once-a-game, the extra tokens are free, and skimping here throws the shot.
  assassinate: { temperature: 0.4, max_tokens: 2000, json: true },
  // reflect writes the scratchpad (up to 9 reads + a plan); the budget must fit
  // the richer reads the reflect contract now asks for, or the OUTPUT truncates
  // before the parser's generous caps ever apply.
  reflect: { temperature: 0.5, max_tokens: 800, json: true },
}
