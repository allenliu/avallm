// Game-setup data: role descriptions, evil counts, complexity presets, and
// the role-list builder. Mirrors server/engine/rules.ts tables (the server
// re-validates everything — this is UI convenience, not authority).

export type Role =
  | 'merlin' | 'percival' | 'servant'
  | 'assassin' | 'morgana' | 'mordred' | 'oberon' | 'minion'

export const EVIL_COUNT: Record<number, number> = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3 }

// Mirrors server/engine/rules.ts TEAM_SIZES / failsRequired (display only —
// the engine is authoritative). Quest 4 at 7+ players needs 2 fails.
export const TEAM_SIZES: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
}
export const twoFailQuest = (players: number, quest: number): boolean =>
  players >= 7 && quest === 4

export const ROLE_INFO: Record<Role, { name: string; side: 'good' | 'evil'; desc: string }> = {
  merlin: {
    name: 'Merlin', side: 'good',
    desc: 'Sees who is evil (except Mordred) — but must hide it. If good wins 3 quests, the Assassin gets one shot at naming Merlin; a correct pick steals the game for evil.',
  },
  percival: {
    name: 'Percival', side: 'good',
    desc: 'Sees Merlin and Morgana without knowing which is which. Protect the real Merlin — or impersonate them to draw the Assassin\'s aim.',
  },
  servant: {
    name: 'Loyal Servant', side: 'good',
    desc: 'No special knowledge. Deduce from quest results and the vote record.',
  },
  assassin: {
    name: 'Assassin', side: 'evil',
    desc: 'Knows fellow evil. If good wins 3 quests, names one player as Merlin — a correct pick wins the game for evil.',
  },
  morgana: {
    name: 'Morgana', side: 'evil',
    desc: 'Appears to Percival as a possible Merlin, muddying his information.',
  },
  mordred: {
    name: 'Mordred', side: 'evil',
    desc: 'Hidden from Merlin — evil\'s cleanest asset.',
  },
  oberon: {
    name: 'Oberon', side: 'evil',
    desc: 'A lone wolf: unknown to the other evil, and does not know them either.',
  },
  minion: {
    name: 'Minion', side: 'evil',
    desc: 'Knows fellow evil (except Oberon). No other power.',
  },
}

// Win reasons arrive as engine enums (server/engine/game.ts endGame calls);
// spell them out for humans.
export const WIN_REASONS: Record<string, string> = {
  threeQuests: 'three quests succeeded',
  threeFails: 'three quests failed',
  merlinAssassinated: 'the Assassin found Merlin',
  assassinMissed: 'the Assassin struck the wrong player',
}
export const winReasonText = (reason: string): string => WIN_REASONS[reason] ?? reason

export const RULES_SUMMARY = [
  'Good wins by succeeding 3 of 5 quests. Evil wins by failing 3 quests — or by assassinating Merlin after good wins.',
  'Each round the leader proposes a quest team and EVERYONE votes. Strict majority approves; a tie rejects. Only 4 proposals per round can be rejected — the 5th ("hammer") proposal is locked in automatically, with no vote.',
  'Approved teams play quest cards in secret: good must play Success, evil may play Fail. Only the number of Fail cards is revealed.',
  'Roles are secret, but some players know things (see role list). Discussion is free — anyone may lie. The public vote record is the best evidence in the game.',
  'When a team is proposed, you can signal a non-binding lean (👍/👎/🤔) during discussion before votes are cast.',
]

// Optional specials the user can toggle. Merlin & Assassin come as a pair —
// each is meaningless without the other.
export interface SpecialSelection {
  merlinPair: boolean
  percival: boolean
  morgana: boolean
  mordred: boolean
  oberon: boolean
}

export type PresetId = 'beginner' | 'standard' | 'advanced'

export const PRESETS: Record<PresetId, { label: string; blurb: string; pick: (n: number) => SpecialSelection }> = {
  beginner: {
    label: 'Beginner',
    blurb: 'Merlin & Assassin only — the cleanest introduction.',
    pick: () => ({ merlinPair: true, percival: false, morgana: false, mordred: false, oberon: false }),
  },
  standard: {
    label: 'Standard',
    blurb: 'The common competitive setup: Percival & Morgana in, plus Oberon or Mordred at larger tables.',
    pick: (n) => ({
      merlinPair: true, percival: true, morgana: true,
      mordred: n === 9, oberon: n === 7,
    }),
  },
  advanced: {
    label: 'Advanced',
    blurb: 'Mordred hides from Merlin — good\'s information gets thin.',
    pick: (n) => ({
      merlinPair: true,
      percival: true,
      // Only 2 evil slots below 7 players: Assassin + Mordred (Percival still
      // has a pair target? No Morgana -> rulebook wants Mordred present, ok).
      morgana: n >= 7,
      mordred: true,
      oberon: false,
    }),
  },
}

export interface BuiltRoles {
  roles: Role[] | null
  error: string | null
  warning: string | null
}

export function buildRoles(playerCount: number, sel: SpecialSelection): BuiltRoles {
  const evil = EVIL_COUNT[playerCount]
  const good = playerCount - evil
  const goodSpecials = (sel.merlinPair ? 1 : 0) + (sel.percival ? 1 : 0)
  const evilSpecials = (sel.merlinPair ? 1 : 0) + (sel.morgana ? 1 : 0) + (sel.mordred ? 1 : 0) + (sel.oberon ? 1 : 0)

  if (sel.percival && !sel.merlinPair) {
    return { roles: null, error: 'Percival needs Merlin in play.', warning: null }
  }
  if ((sel.morgana || sel.mordred || sel.oberon) && !sel.merlinPair) {
    return { roles: null, error: 'Special evil roles need Merlin & Assassin in play.', warning: null }
  }
  if (goodSpecials > good) {
    return { roles: null, error: `Too many good roles for ${playerCount} players (${good} good seats).`, warning: null }
  }
  if (evilSpecials > evil) {
    return { roles: null, error: `Too many evil roles for ${playerCount} players (only ${evil} evil seats).`, warning: null }
  }

  const roles: Role[] = []
  if (sel.merlinPair) roles.push('merlin')
  if (sel.percival) roles.push('percival')
  while (roles.length < good) roles.push('servant')
  if (sel.merlinPair) roles.push('assassin')
  if (sel.morgana) roles.push('morgana')
  if (sel.mordred) roles.push('mordred')
  if (sel.oberon) roles.push('oberon')
  while (roles.length < playerCount) roles.push('minion')

  let warning: string | null = null
  if (playerCount === 5 && sel.percival && !sel.morgana && !sel.mordred) {
    warning = 'Rulebook: at 5 players, Percival without Morgana or Mordred makes good too strong.'
  }
  return { roles, error: null, warning }
}
