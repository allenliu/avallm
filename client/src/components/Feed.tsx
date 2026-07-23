import { useEffect, useRef } from 'react'
import type { AgentInfo, GameEvent, PlayerView, Seat } from '../types.ts'
import { ModelBadge } from './TableSeats.tsx'
import { celestialFor } from './Arcana.tsx'
import { winReasonText } from '../setup.ts'

export function Feed({ view, bots, acting, degradedSeqs }: {
  view: PlayerView
  bots: Record<number, AgentInfo>
  acting?: Seat[]
  degradedSeqs?: number[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Ghost rows for bots currently deciding — the transcript's live edge. The
  // viewer's own turn shows the action bar instead, so skip their seat.
  const thinking = (acting ?? []).filter((s) => s !== view.seat && s in bots)
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [view.events.length, thinking.join(',')])
  // The viewer sees "You" for their own seat; the canonical name (what bots
  // see) is never a pronoun, so this label lives only in the client.
  const name = (s: number) => (s === view.seat ? 'You' : view.players[s]?.name ?? `seat ${s}`)
  const degraded = new Set(degradedSeqs ?? [])
  const shortModel = (s: number) =>
    s === view.seat ? 'you' : bots[s] ? (bots[s].model.includes('/') ? bots[s].model.split('/')[1] : bots[s].model) : 'human'

  const rows = view.events.map((ev) => renderEvent(ev, name, view.seat)).filter(Boolean) as FeedRow[]

  return (
    <div className="feed" ref={ref}>
      {rows.map((row) => {
        const autopilot = degraded.has(row.key) && (
          <span
            className="chip autopilot-chip"
            title="This decision fell back to the rule-based autopilot — the model's reply was unusable"
          >autopilot</span>
        )
        if (row.cls === 'talk') {
          return (
            <div key={row.key} className="feed-row talk"
              style={{ ['--mc' as string]: row.seat === view.seat ? 'var(--gold)' : bots[row.seat!]?.color ?? 'var(--gold)' }}>
              <div className="say-who">{name(row.seat!)}<small>{shortModel(row.seat!)}</small></div>
              <div className="say-text">
                {row.text}
                {row.lean && <span className={`leanmark ${row.lean === 'approve' ? 'a' : row.lean === 'reject' ? 'r' : 'u'}`}>
                  {row.lean === 'approve' ? 'Aye' : row.lean === 'reject' ? 'Nay' : 'Unsure'}
                </span>}
                {autopilot}
              </div>
            </div>
          )
        }
        if (row.votes) {
          return (
            <div key={row.key} className={`feed-row votes ${row.cls}`}>
              <span className="votes-lbl">Votes</span>
              {row.votes.map((v) => (
                <span key={v.seat} className={`vcard ${v.vote}`} title={`${name(v.seat)} voted ${v.vote}`}>
                  {name(v.seat)} <b>{v.vote === 'approve' ? '✓' : '✕'}</b>
                </span>
              ))}
              <span className={`votes-result ${row.cls.includes('ok') ? 'ok' : 'bad'}`}>{row.text}</span>
            </div>
          )
        }
        return (
          <div key={row.key} className={`feed-row ${row.cls}`}>
            {row.seat !== undefined && (
              <span className="feed-speaker">
                <ModelBadge info={bots[row.seat]} />
                {name(row.seat)}
              </span>
            )}
            <span className="feed-text">{row.text}</span>
            {row.sub && <span className="feed-sub">{row.sub}</span>}
            {autopilot}
          </div>
        )
      })}
      {thinking.map((s) => {
        const body = celestialFor(bots[s]?.id, name(s))
        return (
          <div key={`thinking-${s}`} className="feed-row thinking-row"
            style={{ ['--mc' as string]: bots[s]?.color ?? 'var(--gold)' }}>
            <span className="tr-glyph">{body.glyph}</span>
            <span className="tr-nm">{name(s)}</span>
            <span className="tr-act">is thinking</span>
            <span className="tr-dots"><i>●</i><i>●</i><i>●</i></span>
          </div>
        )
      })}
    </div>
  )
}

interface FeedRow {
  key: number
  cls: string
  seat?: number
  text: string
  sub?: string
  lean?: string
  votes?: { seat: number; vote: string }[]
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
      if (p.text) return { key: ev.seq, cls: 'talk', seat: p.seat, text: p.text, lean: p.lean }
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
      return {
        key: ev.seq,
        cls: p.approved ? 'ok' : 'bad',
        votes: p.votes as { seat: number; vote: string }[],
        text: p.approved ? 'APPROVED' : 'REJECTED',
      }
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
