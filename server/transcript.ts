// Debug-transcript renderer: one game → one self-contained Markdown document
// meant to be copied to the clipboard and pasted into a chat for debugging.
//
// Two audiences in one artifact:
//   - a human skims the header + play-by-play to confirm they grabbed the
//     right game, and
//   - a debugger (me) reads the annotated play-by-play — which INLINES hidden
//     information (each bot's [thinking]/[notes], secret quest cards, individual
//     votes) in seq order — plus the raw JSONL log for byte-exact detail.
//
// Pure and clock-free (the caller passes `capturedAt`), so it unit-tests
// offline. Redaction is the CALLER's job: pass only the events the requester
// may see and omit roles when they aren't revealed — this module renders
// whatever it is given and never widens visibility.

import type { Alignment, GameEvent, Phase, Quest, Role, Seat } from './engine/types.ts'

export interface TranscriptSeat {
  seat: Seat
  name: string
  agent: string          // 'human' | model display name | 'rule-based' | 'external'
  role?: Role            // present only when the transcript is a full reveal
  alignment?: Alignment
}

export interface TranscriptInput {
  id: string
  seed: string
  playerCount: number
  phase: Phase
  round: number
  proposalNum: number
  leaderSeat: Seat
  quests: Quest[]
  seats: TranscriptSeat[]
  log: GameEvent[]                 // already redacted to what the caller may see
  degraded?: { seat: Seat; kind: string; error: string }[]
  winner?: Alignment
  winReason?: string
  // True when roles + hidden events are present (full reveal). False when the
  // log is scoped to one seat's visibility.
  revealed: boolean
  // For a scoped (non-revealed) transcript: whose view this is, for the header.
  scopedTo?: Seat | 'spectator'
  capturedAt: string               // ISO timestamp, supplied by the I/O layer
  includeRaw?: boolean             // append the raw JSONL log (default true)
}

export function renderTranscript(input: TranscriptInput): string {
  const seatName = new Map(input.seats.map((s) => [s.seat, s]))
  // `who(seat)` — the uniform seat reference used throughout the play-by-play.
  // When revealed it carries the role, which is exactly the annotation a
  // debugger wants next to every vote / card / thought: "Name(#3·morgana)".
  const who = (seat: Seat): string => {
    const s = seatName.get(seat)
    if (!s) return `seat ${seat}`
    return input.revealed && s.role ? `${s.name}(#${seat}·${s.role})` : `${s.name}(#${seat})`
  }

  const out: string[] = []
  out.push('# Avalon debug transcript')
  out.push('')

  // ---- header ----
  const over = input.phase === 'gameOver'
  const when = over
    ? 'FINAL'
    : `MID-GAME — ${input.phase} (quest ${input.round}, proposal ${input.proposalNum}), leader ${who(input.leaderSeat)}`
  out.push(`- game \`${input.id}\` · seed \`${input.seed}\` · ${input.playerCount} players`)
  out.push(`- captured: ${when}`)
  out.push(`- captured at: ${input.capturedAt}`)
  if (input.winner) out.push(`- winner: **${input.winner.toUpperCase()}** — ${input.winReason ?? '?'}`)
  if (input.revealed) {
    out.push('- fidelity: **FULL REVEAL** — every role and all bot reasoning included')
  } else {
    const scope = input.scopedTo === 'spectator' ? 'a spectator' : `seat ${input.scopedTo}`
    out.push(`- fidelity: **SCOPED** to ${scope} — public events plus that seat's own private events; other roles and bot reasoning are hidden (finish the game, or capture from the solo seat, for a full reveal)`)
  }
  if (input.degraded && input.degraded.length) {
    out.push(`- degraded decisions: ${input.degraded.length}`)
    for (const d of input.degraded) {
      out.push(`  - ${who(d.seat)} ${d.kind}: ${d.error}`)
    }
  }
  out.push('')

  // ---- seat roster ----
  out.push('## Seats')
  out.push('')
  if (input.revealed) {
    out.push('| # | name | agent | role | align |')
    out.push('| - | ---- | ----- | ---- | ----- |')
    for (const s of input.seats) {
      out.push(`| ${s.seat} | ${s.name} | ${s.agent} | ${s.role ?? '?'} | ${s.alignment ?? '?'} |`)
    }
  } else {
    out.push('| # | name | agent |')
    out.push('| - | ---- | ----- |')
    for (const s of input.seats) out.push(`| ${s.seat} | ${s.name} | ${s.agent} |`)
  }
  out.push('')

  // ---- quest board ----
  out.push('## Quests')
  out.push('')
  for (const q of input.quests) {
    const teamStr = q.team ? q.team.map(who).join(', ') : '—'
    const res = q.result
      ? `${q.result.toUpperCase()} (${q.failCount} fail${q.failCount === 1 ? '' : 's'}, needed ${q.failsRequired})`
      : 'pending'
    out.push(`- Q${q.num} (size ${q.teamSize}, needs ${q.failsRequired} fail${q.failsRequired === 1 ? '' : 's'}): ${res} — team: ${teamStr}`)
  }
  out.push('')

  // ---- annotated play-by-play ----
  // Free-form text (utterances, pitches, thinking, names) can contain ```,
  // which would close a fixed ``` fence early and garble the rendered document.
  // fenceBar picks a backtick run longer than anything in the body.
  out.push('## Play-by-play')
  out.push('')
  const pbp: string[] = []
  for (const ev of input.log) {
    const line = renderLine(ev, who)
    if (line !== null) pbp.push(line)
  }
  const pbpBar = fenceBar(pbp.join('\n'))
  out.push(pbpBar, ...pbp, pbpBar, '')

  // ---- raw log ----
  if (input.includeRaw !== false) {
    out.push('## Raw event log (JSONL, one event per line)')
    out.push('')
    const raw = input.log.map((ev) => JSON.stringify(ev))
    const rawBar = fenceBar(raw.join('\n'))
    out.push(rawBar + 'jsonl', ...raw, rawBar, '')
  }

  return out.join('\n')
}

// A fence guaranteed to survive body content: at least three backticks, and
// always one more than the longest backtick run the body already contains.
function fenceBar(body: string): string {
  const longest = (body.match(/`+/g) ?? []).reduce((m, r) => Math.max(m, r.length), 0)
  return '`'.repeat(Math.max(3, longest + 1))
}

// One event → one (or a few) play-by-play lines, or null to skip. Private
// events (thinking/notes/individual votes/secret cards/knowledge) are indented
// so they read as annotations under the public flow.
function renderLine(ev: GameEvent, who: (s: Seat) => string): string | null {
  const p = ev.payload as Record<string, any>
  const seq = String(ev.seq).padStart(3, ' ')
  const tag = (body: string) => `${seq}  ${body}`
  const sub = (body: string) => `${seq}      ${body}`
  switch (ev.type) {
    case 'gameCreated':
      return tag(`=== ${p.playerCount} players; roles: ${(p.rolesInPlay as string[]).join(', ')}; first leader ${who(p.firstLeader)} ===`)
    case 'roleDealt':
      return sub(`deal: ${who(p.seat)} = ${p.role} (${p.alignment})`)
    case 'knowledge': {
      const bits: string[] = []
      if (p.evilPartners) bits.push(`evil partners ${(p.evilPartners as Seat[]).map(who).join(', ') || '(none)'}`)
      if (p.knownEvil) bits.push(`sees evil ${(p.knownEvil as Seat[]).map(who).join(', ')}`)
      if (p.merlinCandidates) bits.push(`Merlin/Morgana ${(p.merlinCandidates as Seat[]).map(who).join(' or ')}`)
      return bits.length ? sub(`knows: ${who(p.seat)} — ${bits.join('; ')}`) : null
    }
    case 'leadChange':
      return tag(`— leader → ${who(p.seat)} (Q${p.round}.${p.proposalNum}) —`)
    case 'utterance': {
      if (!p.text) return null
      const lean = p.lean ? ` [lean: ${p.lean}]` : ''
      return tag(`${who(p.seat)}: "${p.text}"${lean}`)
    }
    case 'proposal': {
      const pitch = p.pitch ? ` — "${p.pitch}"` : ''
      return tag(`[Q${p.round}.${p.proposalNum}] ${who(p.leader)} proposes: ${(p.team as Seat[]).map(who).join(', ')}${pitch}`)
    }
    case 'voteCast':
      return sub(`vote: ${who(p.seat)} → ${p.vote}`)
    case 'voteReveal': {
      const votes = (p.votes as { seat: Seat; vote: string }[])
        .map((v) => `${who(v.seat)}:${v.vote === 'approve' ? 'Y' : 'N'}`).join('  ')
      return tag(`votes: ${votes}  →  ${p.approved ? 'APPROVED' : 'rejected'}`)
    }
    case 'questCard':
      return sub(`card: ${who(p.seat)} plays ${String(p.card).toUpperCase()}`)
    case 'questResult':
      return tag(`Quest ${p.round}: ${String(p.result).toUpperCase()} (${p.failCount} fail${p.failCount === 1 ? '' : 's'}, needed ${p.failsRequired})`)
    case 'thinking':
      return sub(`[${who(p.seat)} · ${p.kind} thinking] ${p.text}`)
    case 'scratchpad':
      return sub(`[${who(p.seat)} · notes] ${p.text}`)
    case 'assassination':
      return tag(`assassin ${who(p.assassin)} targets ${who(p.target)} — ${p.wasMerlin ? 'MERLIN! evil wins' : 'not Merlin'}`)
    case 'gameOver':
      return tag(`*** ${String(p.winner).toUpperCase()} wins (${p.reason}) ***`)
    case 'rename':
      return sub(`rename: seat ${p.seat} "${p.from}" → "${p.to}"`)
    default:
      return sub(`${ev.type}: ${JSON.stringify(p)}`)
  }
}
