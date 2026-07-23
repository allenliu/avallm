import { useEffect, useRef } from 'react'
import type { AgentInfo, GameEvent, PlayerView } from '../types.ts'
import { ModelBadge } from './TableSeats.tsx'

export function Feed({ view, bots, degradedSeqs }: {
  view: PlayerView
  bots: Record<number, AgentInfo>
  degradedSeqs?: number[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [view.events.length])
  const name = (s: number) => view.players[s]?.name ?? `seat ${s}`
  const degraded = new Set(degradedSeqs ?? [])

  const rows = view.events.map((ev) => renderEvent(ev, name)).filter(Boolean) as FeedRow[]

  return (
    <div className="feed" ref={ref}>
      {rows.map((row) => (
        <div key={row.key} className={`feed-row ${row.cls}`}>
          {row.seat !== undefined && (
            <span className="feed-speaker">
              <ModelBadge info={bots[row.seat]} />
              {name(row.seat)}
            </span>
          )}
          <span className="feed-text">{row.text}</span>
          {degraded.has(row.key) && (
            <span
              className="chip autopilot-chip"
              title="This decision fell back to the rule-based autopilot — the model's reply was unusable"
            >🤖 autopilot</span>
          )}
        </div>
      ))}
    </div>
  )
}

interface FeedRow {
  key: number
  cls: string
  seat?: number
  text: string
}

function renderEvent(ev: GameEvent, name: (s: number) => string): FeedRow | null {
  const p = ev.payload
  switch (ev.type) {
    case 'utterance': {
      const lean = p.lean ? ` ${p.lean === 'approve' ? '👍' : p.lean === 'reject' ? '👎' : '🤔'}` : ''
      if (p.text) return { key: ev.seq, cls: 'talk', seat: p.seat, text: p.text + lean }
      if (p.lean) return { key: ev.seq, cls: 'system', seat: p.seat, text: `signals ${p.lean}${lean}` }
      // Silence is information too.
      return { key: ev.seq, cls: 'system pass', seat: p.seat, text: 'passes' }
    }
    case 'proposal': {
      const team = (p.team as number[]).map(name).join(', ')
      const pitch = p.pitch ? ` — “${p.pitch}”` : ''
      return { key: ev.seq, cls: 'system', seat: p.leader, text: `proposes [${team}] for quest ${p.round} (proposal ${p.proposalNum}/5)${pitch}` }
    }
    case 'voteReveal': {
      if (p.auto) {
        return { key: ev.seq, cls: 'system ok', text: 'The hammer falls — the 5th proposal is locked in automatically, no vote.' }
      }
      const votes = (p.votes as { seat: number; vote: string }[])
        .map((v) => `${name(v.seat)} ${v.vote === 'approve' ? '✓' : '✗'}`).join('  ')
      return { key: ev.seq, cls: p.approved ? 'system ok' : 'system bad', text: `Votes: ${votes} → ${p.approved ? 'APPROVED' : 'rejected'}` }
    }
    case 'questResult':
      return {
        key: ev.seq,
        cls: p.result === 'success' ? 'system ok big' : 'system bad big',
        text: `Quest ${p.round}: ${String(p.result).toUpperCase()} (${p.failCount} fail card${p.failCount === 1 ? '' : 's'} revealed, ${p.failsRequired} needed)`,
      }
    case 'assassination':
      return {
        key: ev.seq, cls: 'system big',
        text: `${name(p.assassin)} is the Assassin — and names ${name(p.target)} as Merlin. ${p.wasMerlin ? 'Correct. Evil steals the game.' : 'Wrong.'}`,
      }
    case 'gameOver':
      return { key: ev.seq, cls: `system big ${p.winner === 'good' ? 'ok' : 'bad'}`, text: `${String(p.winner).toUpperCase()} WINS (${p.reason})` }
    case 'gameCreated':
      return { key: ev.seq, cls: 'system', text: `The table is set: ${p.playerCount} players. Roles in play: ${(p.rolesInPlay as string[]).join(', ')}.` }
    case 'rename':
      return { key: ev.seq, cls: 'system', text: `${p.from} is now known as ${p.to}.` }
    default:
      return null
  }
}
