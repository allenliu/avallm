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
  blurb: string        // one-line table manner, shown in UI
}

export const ROSTER: RosterEntry[] = [
  {
    id: 'deepseek', displayName: 'DeepSeek', slug: 'deepseek/deepseek-v4-flash',
    badge: { color: '#4D6BFE', monogram: 'DS' }, tier: 'cheap',
    blurb: 'Terse and punchy. Occasionally forgets it is playing a game.',
  },
  {
    id: 'gemini', displayName: 'Gemini', slug: 'google/gemini-3.1-flash-lite',
    badge: { color: '#1A73E8', monogram: 'GM' }, tier: 'cheap',
    blurb: 'Fast, steady, votes like a spreadsheet.',
  },
  {
    id: 'gemini-flash', displayName: 'Gemini Flash', slug: 'google/gemini-3-flash-preview',
    badge: { color: '#34A853', monogram: 'GF' }, tier: 'mid',
    blurb: 'The talkative Gemini. Better reads, bigger bills.',
  },
  {
    id: 'haiku', displayName: 'Haiku', slug: 'anthropic/claude-haiku-4.5',
    badge: { color: '#D97757', monogram: 'HK' }, tier: 'premium',
    blurb: 'The premium seat. Calm, deliberate, hard to rattle.',
  },
  {
    id: 'kimi', displayName: 'Kimi', slug: 'moonshotai/kimi-k2.5',
    badge: { color: '#16A8A8', monogram: 'KM' }, tier: 'mid',
    blurb: 'Warm and literary. Writes paragraphs when nervous.',
  },
  {
    id: 'glm', displayName: 'GLM', slug: 'z-ai/glm-4.6',
    badge: { color: '#8B5CF6', monogram: 'GL' }, tier: 'mid',
    blurb: 'Earnest. Takes accusations personally.',
  },
  {
    id: 'gpt-oss', displayName: 'GPT-OSS', slug: 'openai/gpt-oss-120b',
    badge: { color: '#10A37F', monogram: 'GP' }, tier: 'cheap',
    blurb: 'Open-weights OpenAI. Cheapest seat at the table.',
  },
  {
    id: 'seed', displayName: 'Seed', slug: 'bytedance-seed/seed-2.0-lite',
    badge: { color: '#F0424C', monogram: 'SD' }, tier: 'cheap',
    blurb: 'Quiet until it suddenly is not.',
  },
]

// Default 6-bot table (7p game with one human), family-diverse on purpose.
export const DEFAULT_TABLE = ['deepseek', 'gemini', 'haiku', 'kimi', 'glm', 'gpt-oss']

export function rosterById(id: string): RosterEntry {
  const entry = ROSTER.find((r) => r.id === id)
  if (!entry) throw new Error(`unknown roster model id: ${id}`)
  return entry
}
