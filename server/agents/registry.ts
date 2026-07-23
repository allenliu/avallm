// AgentSpec -> AvalonAgent. The one place that knows how to construct agents.

import { createHeuristicAgent } from './heuristic.ts'
import { createLlmAgent } from './llm.ts'
import { createRandomAgent } from './random.ts'
import { createStdioAgent } from './stdio.ts'
import { getClient } from '../llm/client.ts'
import { promptOverridesOf, resolveModel } from './defs.ts'
import type { AgentDef } from './defs.ts'
import type { AgentContext, AgentSpec, AvalonAgent } from './types.ts'

export function createAgent(spec: AgentSpec, ctx: AgentContext): AvalonAgent {
  switch (spec.type) {
    case 'heuristic': return createHeuristicAgent(ctx)
    case 'random': return createRandomAgent(ctx)
    case 'stdio': return createStdioAgent(spec)
    case 'llm': return createLlmAgent({ modelId: spec.model, client: getClient() })
  }
}

// Library agents (server/agents/defs.ts) — the config-driven construction
// path used by the web server and table setup. modelOverride is the seat-time
// (host's) model choice; see resolveModel for precedence.
export function createAgentFromDef(def: AgentDef, ctx: AgentContext, modelOverride?: string): AvalonAgent {
  switch (def.engine.type) {
    case 'heuristic': return createHeuristicAgent(ctx)
    case 'stdio': return createStdioAgent({ ...def.engine, label: def.name })
    case 'llm':
      return createLlmAgent({
        modelId: resolveModel(def, modelOverride),
        client: getClient(),
        agentId: def.id,
        label: `${def.name}${def.version ? ` v${def.version}` : ''}`,
        prompts: promptOverridesOf(def.engine),
        temperature: def.engine.temperature,
      })
  }
}
