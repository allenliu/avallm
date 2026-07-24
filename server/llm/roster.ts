// The model roster — the cast of characters. Bots ARE models, openly badged.
// Slugs deliberately limited to ones measured in datingsim's MODELS.md
// (rate cards + reasoning-suppression behavior verified there); prices are
// $/M prompt/completion as of 2026-07 and only inform tier labels — real
// cost accounting uses OpenRouter's usage.cost.

export interface RosterEntry {
  id: string           // stable internal id
  displayName: string  // what the table shows
  slug: string         // OpenRouter model slug
  badge: { color: string; monogram: string }
  tier: 'cheap' | 'mid' | 'premium'
}

export const ROSTER: RosterEntry[] = [
  {
    id: 'deepseek', displayName: 'DeepSeek', slug: 'deepseek/deepseek-v4-flash',
    badge: { color: '#4D6BFE', monogram: 'DS' }, tier: 'cheap',
  },
  {
    id: 'gemini', displayName: 'Gemini', slug: 'google/gemini-3.1-flash-lite',
    badge: { color: '#1A73E8', monogram: 'GM' }, tier: 'cheap',
  },
  {
    id: 'gemini-flash', displayName: 'Gemini Flash', slug: 'google/gemini-3-flash-preview',
    badge: { color: '#34A853', monogram: 'GF' }, tier: 'mid',
  },
  // Haiku is temporarily benched: at ~$1/$5 per M tokens it runs an order of
  // magnitude pricier than every other seat here, which dominates the spend on
  // a hobby budget. Kept commented (not deleted) so it's a one-line restore
  // when we want the premium seat back — its reasoning-suppression policy and
  // Arcana glyph are still wired up.
  // {
  //   id: 'haiku', displayName: 'Haiku', slug: 'anthropic/claude-haiku-4.5',
  //   badge: { color: '#D97757', monogram: 'HK' }, tier: 'premium',
  // },
  {
    id: 'kimi', displayName: 'Kimi', slug: 'moonshotai/kimi-k2.5',
    badge: { color: '#16A8A8', monogram: 'KM' }, tier: 'mid',
  },
  {
    id: 'glm', displayName: 'GLM', slug: 'z-ai/glm-4.6',
    badge: { color: '#8B5CF6', monogram: 'GL' }, tier: 'mid',
  },
  {
    id: 'gpt-oss', displayName: 'GPT-OSS', slug: 'openai/gpt-oss-120b',
    badge: { color: '#10A37F', monogram: 'GP' }, tier: 'cheap',
  },
  {
    id: 'seed', displayName: 'Seed', slug: 'bytedance-seed/seed-2.0-lite',
    badge: { color: '#F0424C', monogram: 'SD' }, tier: 'cheap',
  },
]

// Default 6-bot table (7p game with one human), family-diverse on purpose.
// (Haiku held the 6th seat until it was benched on cost — see above; Seed keeps
// the family diversity without the premium bill.)
export const DEFAULT_TABLE = ['deepseek', 'gemini', 'seed', 'kimi', 'glm', 'gpt-oss']

// What a personality-only agent (no model in its def) plays on when the seat
// doesn't override. Provisional: deepseek is just the cheap starting point —
// the real pick is whatever balances cost, interesting table talk, and good
// play once we've measured that.
export const DEFAULT_MODEL = 'deepseek'

export function rosterById(id: string): RosterEntry {
  const entry = ROSTER.find((r) => r.id === id)
  if (!entry) throw new Error(`unknown roster model id: ${id}`)
  return entry
}
