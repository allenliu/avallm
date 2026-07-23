// Render an agent's custom prompt config as readable text — used by the
// library browser, the Reference panel, and the post-game reveal cards.
import type { AgentInfo } from './types.ts'

export function agentConfigText(a: AgentInfo): string {
  const parts: string[] = []
  if (a.personality) parts.push(`PERSONA\n${a.personality}`)
  if (a.strategy) parts.push(`STRATEGY\n${a.strategy}`)
  for (const [role, text] of Object.entries(a.roleGuidance ?? {})) {
    parts.push(`AS ${role.toUpperCase()}\n${text}`)
  }
  for (const [kind, text] of Object.entries(a.kindGuidance ?? {})) {
    parts.push(`ON ${kind.toUpperCase()}\n${text}`)
  }
  if (a.temperature !== undefined) parts.push(`TEMPERATURE ${a.temperature}`)
  return parts.join('\n\n') || '(no custom layers — baseline prompts)'
}

// ~4 chars per token, matching the server's estimate.
export const tokenEstimate = (chars: number) => Math.round(chars / 4)
