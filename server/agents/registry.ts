// AgentSpec -> AvalonAgent. The one place that knows how to construct agents.

import { createHeuristicAgent } from './heuristic.ts'
import { createLlmAgent } from './llm.ts'
import { createRandomAgent } from './random.ts'
import { createStdioAgent } from './stdio.ts'
import { getClient } from '../llm/client.ts'
import type { AgentContext, AgentSpec, AvalonAgent } from './types.ts'

export function createAgent(spec: AgentSpec, ctx: AgentContext): AvalonAgent {
  switch (spec.type) {
    case 'heuristic': return createHeuristicAgent(ctx)
    case 'random': return createRandomAgent(ctx)
    case 'stdio': return createStdioAgent(spec)
    case 'llm': return createLlmAgent({ modelId: spec.model, client: getClient() })
  }
}
