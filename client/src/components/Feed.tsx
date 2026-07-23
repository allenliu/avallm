import { useEffect, useRef } from 'react'
import type { AgentInfo, GameEvent, PlayerView, Seat } from '../types.ts'
import { ModelBadge } from './TableSeats.tsx'
import { celestialFor, Emblem } from './Arcana.tsx'
import { winReasonText } from '../setup.ts'

export function Feed({ view, bots, acting, waitingOn, degradedSeqs }: {
  view: PlayerView
  bots: Record<number, AgentInfo>
  acting?: Seat[]
  waitingOn?: string[]
  degradedSeqs?: number[]
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Everyone with a decision still outstanding this phase: bots mid-decision
  // (acting) plus humans not yet acted (waitingOn, matched by name). Drives the
  // live-edge indicators, which vary by phase (ghost row / ballot / beat).
  const pending = new Set<Seat>(acting ?? [])
  const waitingNames = new Set(waitingOn ?? [])
  for (const p of view.players) if (waitingNames.has(p.name)) pending.add(p.seat)
  const pendingKey = [...pending].sort((a, b) => a - b).join(',')
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight, behavior: 'smooth' })
  }, [view.events.length, view.phase, pendingKey])
  // The viewer sees "You" for their own seat; the canonical name (what bots
  // see) is never a pronoun, so this label lives only in the client.
  const name = (s: number) => (s === view.seat ? 'You' : view.players[s]?.name ?? `seat ${s}`)
  const degraded = new Set(degradedSeqs ?? [])
  const shortModel = (s: number) =>
    s === view.seat ? 'you' : bots[s] ? (bots[s].model.includes('/') ? bots[s].model.split('/')[1] : bots[s].model) : 'human'

  const rows = view.events.map((ev) => renderEvent(ev, name, view)).filter(Boolean) as FeedRow[]

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
        if (row.kind === 'votereveal') {
          // Option A: each ballot flips from face-down to the voter's aye/nay.
          // The flip is a CSS mount animation, so it plays its full duration
          // even when the server resolved instantly (no dev bot-delay).
          return (
            <div key={row.key} className="feed-row votereveal">
              <span className="votes-lbl">Votes</span>
              <span className="vcards">
                {row.votes!.map((v, i) => (
                  <span key={v.seat} className="vcardcol" style={{ ['--d' as string]: `${0.15 + i * 0.09}s` }}>
                    <span className={`vflip ${v.vote === 'approve' ? 'aye' : 'nay'}`}>
                      <span className="vf-inner">
                        <span className="vf-front" />
                        <span className="vf-back">{v.vote === 'approve' ? '✓' : '✕'}</span>
                      </span>
                    </span>
                    <span className="vcard-name">{name(v.seat)}</span>
                  </span>
                ))}
              </span>
              <span className={`votes-result ${row.cls}`}>{row.text} {row.ayes}–{row.nays}</span>
            </div>
          )
        }
        if (row.kind === 'questreveal') {
          // Q1: face-down cards gather, shuffle, then a single card flips to the
          // aggregate (The Sun / The Tower + fail count). Individual plays are
          // never shown — the shuffle IS the anonymity. Mount-driven animation.
          const won = row.cls === 'ok'
          return (
            <div key={row.key} className={`feed-row questreveal ${row.cls}`}>
              <span className="qr-stage" style={{ ['--n' as string]: row.teamSize }}>
                {Array.from({ length: row.teamSize ?? 3 }).map((_, i) => (
                  <span key={i} className="qr-card"
                    style={{ ['--i' as string]: i, ['--x' as string]: `calc((${i} - (${row.teamSize ?? 3} - 1) / 2) * 15px)`, ['--r' as string]: `calc((${i} - (${row.teamSize ?? 3} - 1) / 2) * 6deg)` }} />
                ))}
                <span className={`qr-result ${won ? 'sun' : 'tower'}`}>
                  <Emblem id={won ? 'sun' : 'tower'} className="qr-em" />
                  <span className="qr-word">{won ? 'THE SUN' : `TOWER ·${row.failCount}`}</span>
                </span>
              </span>
              <span className="qr-caption">
                <b>{row.text}</b>
                <span className="qr-sub">{row.sub}</span>
              </span>
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
      <PendingIndicator view={view} bots={bots} pending={pending} name={name} />
    </div>
  )
}

const Dots = () => <span className="tr-dots"><i>●</i><i>●</i><i>●</i></span>

// The live-edge indicator, chosen by phase:
//  discussion / proposal → ghost row (a typing indicator; agents act in turn)
//  vote                  → sealing ballot; resolves to the attributed tally
//  quest                 → sealing ballot; the cards gather & shuffle, then the
//                          questResult moment reveals ONLY the fail count (who
//                          played what stays secret — the shuffle is the anonymity)
//  assassination         → the dread beat, leading into the reveal
function PendingIndicator({ view, bots, pending, name }: {
  view: PlayerView
  bots: Record<number, AgentInfo>
  pending: Set<Seat>
  name: (s: number) => string
}) {
  if (view.phase === 'assassination') {
    return (
      <div className="feed-row moment assassin-beat" role="status">
        <span className="feed-text">⚔ The Knife is drawn</span>
        <span className="feed-sub">the Assassin studies the table<Dots /></span>
      </div>
    )
  }
  if (pending.size === 0) return null

  if (view.phase === 'vote') {
    const total = view.players.length
    const sealed = total - view.players.filter((p) => pending.has(p.seat)).length
    return (
      <div className="feed-row ballot" role="status">
        <span className="ballot-lbl">Ballots</span>
        <span className="bslots">
          {view.players.map((p) => (
            <span key={p.seat} className={`bslot ${pending.has(p.seat) ? 'pending' : 'sealed'}`}
              title={pending.has(p.seat) ? `${name(p.seat)} — still to vote` : `${name(p.seat)} — sealed`} />
          ))}
        </span>
        <span className="ballot-prog">{sealed}/{total} sealed<Dots /></span>
      </div>
    )
  }

  if (view.phase === 'quest') {
    const team = view.currentTeam ?? []
    const sealed = team.length - team.filter((s) => pending.has(s)).length
    const allSealed = sealed === team.length
    return (
      <div className={`feed-row ballot quest${allSealed ? ' gathered' : ''}`} role="status">
        <span className="ballot-lbl">The chosen are sealing their quest cards</span>
        <span className="qstack">
          {team.map((s, i) => (
            <span key={s} className={`qmini ${pending.has(s) ? 'pending' : 'sealed'}`}
              style={{ ['--i' as string]: i }} title="a quest card, played in secret" />
          ))}
        </span>
        <span className="ballot-prog">{allSealed ? <>gathered &amp; shuffled<Dots /></> : <>{sealed}/{team.length} sealed<Dots /></>}</span>
      </div>
    )
  }

  // discussion / proposal: ghost rows for bots mid-decision (humans use the action bar)
  const botsPending = [...pending].filter((s) => s !== view.seat && s in bots)
  return (
    <>
      {botsPending.map((s) => {
        const body = celestialFor(bots[s]?.id, name(s))
        return (
          <div key={`thinking-${s}`} className="feed-row thinking-row"
            style={{ ['--mc' as string]: bots[s]?.color ?? 'var(--gold)' }}>
            <span className="tr-glyph">{body.glyph}</span>
            <span className="tr-nm">{name(s)}</span>
            <span className="tr-act">is thinking</span>
            <Dots />
          </div>
        )
      })}
    </>
  )
}

interface FeedRow {
  key: number
  cls: string
  kind?: 'votereveal' | 'questreveal'
  seat?: number
  text: string
  sub?: string
  lean?: string
  votes?: { seat: number; vote: string }[]
  ayes?: number
  nays?: number
  teamSize?: number
  failCount?: number
}

function renderEvent(ev: GameEvent, name: (s: number) => string, view: PlayerView): FeedRow | null {
  const viewSeat = view.seat
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
      const votes = p.votes as { seat: number; vote: string }[]
      const ayes = votes.filter((v) => v.vote === 'approve').length
      return {
        key: ev.seq,
        kind: 'votereveal',
        cls: p.approved ? 'ok' : 'bad',
        votes, ayes, nays: votes.length - ayes,
        text: p.approved ? 'APPROVED' : 'REJECTED',
      }
    }
    case 'questResult': {
      const won = p.result === 'success'
      const q = view.quests[p.round - 1]
      const teamSize = q?.team?.length ?? q?.teamSize ?? (p.failsRequired + 2)
      return {
        key: ev.seq,
        kind: 'questreveal',
        cls: won ? 'ok' : 'bad',
        teamSize, failCount: p.failCount,
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
