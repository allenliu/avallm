import { useEffect, useRef } from 'react'
import type { AgentInfo, GameEvent, PlayerView } from '../types.ts'
import { ModelBadge } from './TableSeats.tsx'
import { winReasonText } from '../setup.ts'

export function Feed({ view, bots, degradedSeqs }: {
  view: PlayerView
  bots: Record<number, AgentInfo>
  degradedSeqs?: number[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [view.events.length])
  // The viewer sees "You" for their own seat; the canonical name (what bots
  // see) is never a pronoun, so this label lives only in the client.
  const name = (s: number) => (s === view.seat ? 'You' : view.players[s]?.name ?? `seat ${s}`)
  const degraded = new Set(degradedSeqs ?? [])

  const rows = view.events.map((ev) => renderEvent(ev, name, view.seat)).filter(Boolean) as FeedRow[]

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
          {row.sub && <span className="feed-sub">{row.sub}</span>}
          {degraded.has(row.key) && (
            <span
              className="chip autopilot-chip"
              title="This decision fell back to the rule-based autopilot — the model's reply was unusable"
            >autopilot</span>
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
  sub?: string
}

function renderEvent(ev: GameEvent, name: (s: number) => string, viewSeat: number): FeedRow | null {
  const p = ev.payload
  switch (ev.type) {
    case 'leadChange': {
      const seat = p.seat as number
      const you = seat === viewSeat
      return { key: ev.seq, cls: 'record lead', text: `♛ ${name(seat)} ${you ? 'are' : 'is'} now the leader — quest ${p.round}` }
    }
    case 'utterance': {
      const lean = p.lean ? ` ${p.lean === 'approve' ? '〔aye〕' : p.lean === 'reject' ? '〔nay〕' : '〔unsure〕'}` : ''
      if (p.text) return { key: ev.seq, cls: 'talk', seat: p.seat, text: p.text + lean }
      if (p.lean) return { key: ev.seq, cls: 'system pass', seat: p.seat, text: `signals ${p.lean}` }
      // Silence is information too.
      return { key: ev.seq, cls: 'system pass', seat: p.seat, text: 'passes' }
    }
    case 'proposal': {
      const team = (p.team as number[]).map(name).join(' · ')
      const pitch = p.pitch ? ` — “${p.pitch}”` : ''
      return { key: ev.seq, cls: 'record', seat: p.leader, text: `proposes ${team} — quest ${p.round}, proposal ${p.proposalNum} of 5${pitch}` }
    }
    case 'voteReveal': {
      if (p.auto) {
        return { key: ev.seq, cls: 'record hammer', text: '🔨 The hammer falls — the 5th proposal is locked in automatically, no vote.' }
      }
      const votes = (p.votes as { seat: number; vote: string }[])
        .map((v) => `${name(v.seat)} ${v.vote === 'approve' ? '✓' : '✕'}`).join('  ')
      return { key: ev.seq, cls: p.approved ? 'record ok' : 'record bad', text: `Votes: ${votes} → ${p.approved ? 'APPROVED' : 'REJECTED'}` }
    }
    case 'questResult': {
      const won = p.result === 'success'
      return {
        key: ev.seq,
        cls: won ? 'moment ok' : 'moment bad',
        text: `Quest ${p.round} · ${won ? 'The Sun — SUCCESS' : 'The Tower — FAILED'}`,
        sub: `${p.failCount} fail card${p.failCount === 1 ? '' : 's'} revealed, ${p.failsRequired} needed`,
      }
    }
    case 'assassination':
      return {
        key: ev.seq, cls: 'moment gold',
        text: `The Knife is drawn`,
        sub: `${name(p.assassin)} is the Assassin — and names ${name(p.target)} as Merlin. ${p.wasMerlin ? 'Correct. Evil steals the game.' : 'Wrong.'}`,
      }
    case 'gameOver':
      return {
        key: ev.seq, cls: `moment ${p.winner === 'good' ? 'ok' : 'bad'}`,
        text: `${String(p.winner).toUpperCase()} WINS`,
        sub: winReasonText(String(p.reason)),
      }
    case 'gameCreated':
      return { key: ev.seq, cls: 'record', text: `The table is set: ${p.playerCount} players. Roles in play: ${(p.rolesInPlay as string[]).join(', ')}.` }
    case 'rename':
      return { key: ev.seq, cls: 'system', text: `${p.from} is now known as ${p.to}.` }
    default:
      return null
  }
}
