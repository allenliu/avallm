// Per-model OpenRouter provider constraints, ported from datingsim
// game/lib/provider-policy.cjs. Most models need NO entry (an unmeasured
// constraint is a silent routing experiment). glm-5.2's pin is carried over
// because its unconstrained rotation measurably leaks reasoning tokens.

export interface ProviderPrefs {
  order?: string[]
  only?: string[]
  ignore?: string[]
  allow_fallbacks?: boolean
  quantizations?: string[]
  sort?: string
  require_parameters?: boolean
}

interface ProviderRule {
  family: string
  match: RegExp
  prefs: ProviderPrefs
}

export const RULES: ProviderRule[] = [
  {
    family: 'glm-5.2',
    match: /^z-ai\/glm-5\.2$/,
    prefs: {
      order: ['Novita', 'StreamLake'],
      allow_fallbacks: false,
      quantizations: ['fp8'],
    },
  },
]

export function providerPrefsFor(model: string): ProviderPrefs | null {
  if (typeof model !== 'string') return null
  return RULES.find((r) => r.match.test(model))?.prefs ?? null
}

// A HARD constraint promises "never route outside these arms" — a served
// provider outside the list is a real violation worth counting.
export function providerServedOutsidePolicy(
  prefs: ProviderPrefs | null, served: string | undefined,
): boolean {
  if (!prefs || prefs.allow_fallbacks !== false || !served) return false
  const allow = prefs.only ?? prefs.order
  if (!Array.isArray(allow) || allow.length === 0) return false
  return !allow.includes(served)
}
