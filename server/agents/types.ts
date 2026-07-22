// The agent plugin boundary (design doc §1 "Pluggable agents").
// An agent receives ONLY its seat's PlayerView — never raw Game state.

import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'

export interface AvalonAgent {
  decide(req: DecisionRequest, view: PlayerView): Promise<Decision>
  dispose?(): void
}

export type AgentSpec =
  | { type: 'heuristic' }
  | { type: 'random' }
  | { type: 'stdio'; cmd: string; args: string[]; label?: string }
  | { type: 'llm'; model: string } // model = roster id (server/llm/roster.ts)
  // Milestone 3: { type: 'human' } is constructed directly by the server/CLIs

export interface AgentContext {
  seed: string   // the game seed — agents derive their own RNG from it
  seat: number
}
