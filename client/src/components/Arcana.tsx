// The AvaLLM Arcana — canonical card anatomy and emblem sprite.
// Reference: docs/mocks/arcana-specimen.html and docs/design-visual.md.
// Arcana titles are display dress on cards; prose keeps standard Avalon names.
import type { Role } from '../setup.ts'

export const ARCANA: Record<Role, { numeral: string; title: string; emblem: EmblemId }> = {
  merlin: { numeral: 'I', title: 'The Seer', emblem: 'eye' },
  percival: { numeral: 'II', title: 'The Watcher', emblem: 'shield' },
  servant: { numeral: 'III', title: 'The Loyal', emblem: 'chalice' },
  assassin: { numeral: 'XIII', title: 'The Knife', emblem: 'dagger' },
  morgana: { numeral: 'XVIII', title: 'The Mirror', emblem: 'moons' },
  mordred: { numeral: 'XV', title: 'The Veiled', emblem: 'veil' },
  oberon: { numeral: 'IX', title: 'The Stranger', emblem: 'lantern' },
  minion: { numeral: 'V', title: 'The Sworn', emblem: 'swords' },
}

export type EmblemId =
  | 'eye' | 'shield' | 'chalice' | 'dagger' | 'moons' | 'veil' | 'lantern' | 'swords'
  | 'sun' | 'tower' | 'laurel' | 'crown'

export function Emblem({ id, className }: { id: EmblemId; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 60 60" aria-hidden="true">
      <use href={`#em-${id}`} />
    </svg>
  )
}

// Rendered once at the app root. All emblems are 60×60 stroke-only drawings
// that inherit currentColor, so they recolor with the palette and scale from
// 12px chips to full cards.
export function ArcanaDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <g id="em-eye" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 30 Q30 12 52 30 Q30 48 8 30 Z" />
          <circle cx="30" cy="30" r="7" />
          <circle cx="30" cy="30" r="2.4" fill="currentColor" stroke="none" />
          <path d="M30 6 v6 M30 48 v6 M12 12 l4 4 M48 12 l-4 4" />
        </g>
        <g id="em-shield" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M30 8 L46 15 V30 C46 41 38 48 30 53 C22 48 14 41 14 30 V15 Z" />
          <path d="M23 27 l3.5 2.5 -1.3 -4.1 3.4 -2.5 h-4.2 L23 19 l-1.4 3.9 h-4.2 l3.4 2.5 -1.3 4.1 Z" transform="translate(9,3) scale(0.9)" />
          <path d="M23 27 l3.5 2.5 -1.3 -4.1 3.4 -2.5 h-4.2 L23 19 l-1.4 3.9 h-4.2 l3.4 2.5 -1.3 4.1 Z" transform="translate(-1,14) scale(0.75)" />
        </g>
        <g id="em-chalice" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 16 H43 C43 30 37 36 30 36 C23 36 17 30 17 16 Z" />
          <path d="M30 36 V46 M22 50 H38 M26 46 h8" />
          <path d="M30 4 l1.6 3.4 3.4 0.5 -2.5 2.4 0.6 3.5 -3.1 -1.7 -3.1 1.7 0.6 -3.5 -2.5 -2.4 3.4 -0.5 Z" fill="currentColor" stroke="none" transform="translate(0,2) scale(0.8) translate(7,1)" />
        </g>
        <g id="em-dagger" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M30 6 L34 34 H26 Z" />
          <path d="M20 38 H40 M30 38 V48" />
          <circle cx="30" cy="52" r="2.6" />
        </g>
        <g id="em-moons" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12 A18 18 0 1 0 20 48 A20 20 0 0 1 20 12 Z" />
          <path d="M20 12 A18 18 0 1 0 20 48 A20 20 0 0 1 20 12 Z" transform="translate(60,0) scale(-1,1)" opacity="0.55" />
          <path d="M30 18 V42" strokeDasharray="2 4" opacity="0.6" />
          <circle cx="30" cy="8" r="1.4" fill="currentColor" stroke="none" />
        </g>
        <g id="em-veil" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 40 L18 22 L26 32 L30 18 L34 32 L42 22 L46 40 Z" />
          <path d="M12 46 H48" />
          <path d="M10 12 Q20 18 30 12 Q40 6 50 12" opacity="0.55" />
          <path d="M10 12 L14 40 M50 12 L46 40" opacity="0.35" />
        </g>
        <g id="em-lantern" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M24 22 Q30 10 36 22" />
          <rect x="22" y="22" width="16" height="20" rx="2" />
          <path d="M30 28 l3 4 -3 4 -3 -4 Z" fill="currentColor" stroke="none" />
          <path d="M26 46 H34 M30 42 V46" />
          <path d="M12 30 h4 M44 30 h4" opacity="0.5" />
        </g>
        <g id="em-swords" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 10 L40 42 M18 46 l-4 -4 6 -1 -1 6 Z" />
          <path d="M46 10 L20 42 M42 46 l4 -4 -6 -1 1 6 Z" />
          <path d="M12 34 h6 M42 34 h6" opacity="0.5" />
        </g>
        <g id="em-sun" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="30" cy="30" r="11" />
          <circle cx="30" cy="30" r="4.5" opacity="0.7" />
          <path d="M30 8 V15 M30 45 V52 M8 30 H15 M45 30 H52 M14.4 14.4 l5 5 M40.6 40.6 l5 5 M45.6 14.4 l-5 5 M19.4 40.6 l-5 5" />
        </g>
        <g id="em-tower" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 22 L22 52 H38 L40 22" />
          <path d="M17 22 H43 M19 15 h5 v7 M36 15 h5 v7 M27 13 h6 v9" />
          <path d="M27 34 h6 M30 34 v8" opacity="0.6" />
          <path d="M46 4 L36 15 H42 L31 28" strokeWidth="2.2" />
        </g>
        <g id="em-laurel" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 12 C10 24 10 38 20 48" />
          <path d="M42 12 C50 24 50 38 40 48" />
          <path d="M16 20 q-5 1 -7 -3 q5 -2 7 3 Z M14 30 q-5 1 -7 -3 q5 -2 7 3 Z M16 40 q-5 2 -8 -1 q4 -4 8 1 Z" fill="currentColor" stroke="none" opacity="0.8" />
          <path d="M44 20 q5 1 7 -3 q-5 -2 -7 3 Z M46 30 q5 1 7 -3 q-5 -2 -7 3 Z M44 40 q5 2 8 -1 q-4 -4 -8 1 Z" fill="currentColor" stroke="none" opacity="0.8" />
          <path d="M30 22 l2 4.5 4.5 0.7 -3.3 3.2 0.8 4.6 -4 -2.2 -4 2.2 0.8 -4.6 -3.3 -3.2 4.5 -0.7 Z" fill="currentColor" stroke="none" />
        </g>
        <g id="em-crown" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 40 L19 24 L27 32 L30 18 L33 32 L41 24 L44 40 Z" />
          <path d="M16 46 H44" />
          <circle cx="30" cy="12" r="2" opacity="0.7" />
        </g>
      </defs>
    </svg>
  )
}
