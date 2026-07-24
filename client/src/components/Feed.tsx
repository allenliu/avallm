import { useEffect, useRef, type CSSProperties } from 'react'
import type { AgentInfo, GameEvent, PlayerView, Seat } from '../types.ts'
import { Emblem } from './Arcana.tsx'
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
  // A seat's identity in the stream is carried entirely by its colour — the
  // viewer is gold, each bot its model's brand colour. (No sigil, no badge.)
  const mc = (s: number) => (s === view.seat ? 'var(--gold)' : bots[s]?.color ?? 'var(--gold)')
  const degraded = new Set(degradedSeqs ?? [])

  const rows = view.events.map((ev) => renderEvent(ev, name, view)).filter(Boolean) as FeedRow[]

  return (
    <div className="feed" ref={ref}>
      {rows.map((row) => {
        const style = row.seat !== undefined ? { ['--mc' as string]: mc(row.seat) } : undefined
        const autopilot = degraded.has(row.key) && (
          <span
            className="chip autopilot-chip"
            title="This decision fell back to the rule-based autopilot — the model's reply was unusable"
          >autopilot</span>
        )
        const pill = row.lean && (
          <span className={`leanmark ${row.lean === 'approve' ? 'a' : row.lean === 'reject' ? 'r' : 'u'}`}>
            {row.lean === 'approve' ? 'Aye' : row.lean === 'reject' ? 'Nay' : 'Unsure'}
          </span>
        )

        if (row.kind === 'votereveal') {
          // Each ballot flips from face-down to the voter's aye/nay. The flip is
          // a CSS mount animation, so it plays its full duration even when the
          // server resolved instantly (no dev bot-delay).
          return (
            <div key={row.key} className="feed-row votereveal">
              <span className="votes-lbl">Votes</span>
              <span className="vcards">
                {row.votes!.map((v, i) => (
                  <span key={v.seat} className="vcardcol" style={{ ['--d' as string]: `${0.12 + i * 0.06}s` }}>
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
          // Q1: the sealed cards gather, shuffle, then a single card flips to the
          // aggregate (Loyal shield / Evil dagger + fail count) — individual plays are
          // never shown, the shuffle IS the anonymity. Same stage as the sealing
          // indicator, so the moment reads as one continuous element. Mount-driven,
          // so it plays in full even when the server resolved instantly.
          const won = row.cls === 'ok'
          const size = row.teamSize ?? 3
          return (
            <div key={row.key} className={`feed-row questreveal ${row.cls}`}>
              <span className="qr-top" aria-hidden="true" />
              <span className="qr-stage">
                {Array.from({ length: size }).map((_, i) => (
                  <span key={i} className="qr-card" style={qfan(i, size)} />
                ))}
                <span className={`qr-result ${won ? 'won' : 'lost'}`}>
                  <Emblem id={won ? 'shield' : 'dagger'} className="qr-em" />
                  <span className="qr-word">{won ? 'LOYAL' : `SABOTAGE ·${row.failCount}`}</span>
                </span>
              </span>
              <span className="qr-caption">
                <b>{row.text}</b>
                <span className="qr-sub">{row.sub}</span>
              </span>
            </div>
          )
        }

        if (row.kind === 'moment') {
          return (
            <div key={row.key} className={`feed-row moment ${row.cls ?? ''}`}>
              <span className="feed-text">{row.text}</span>
              {row.sub && <span className="feed-sub">{row.sub}</span>}
              {autopilot}
            </div>
          )
        }

        // talk / quiet / deed — the illuminated line. Punctuation is consistent:
        // a colon introduces spoken words, a mid-dot separates structured fields,
        // and narrated deeds/passes take no connector at all.
        const cls = `c-line ${row.kind}${row.cls ? ' ' + row.cls : ''}`

        if (row.kind === 'talk') {
          return (
            <div key={row.key} className={cls} style={style}>
              <b className="cl-nm">{name(row.seat!)}</b>
              <span className="cl-say">: {row.text}</span>
              {pill}
              {autopilot}
            </div>
          )
        }

        if (row.kind === 'quiet') {
          // The quiet register (passes, wordless signals, renames) is dimmed &
          // italic as a whole, so the body is bare text — no bright .cl-say.
          return (
            <div key={row.key} className={cls} style={style}>
              {row.seat !== undefined && <b className="cl-nm">{name(row.seat)}</b>}
              {row.text}
              {pill}
              {autopilot}
            </div>
          )
        }

        // deed: proposals, the crown, the hammer, the table being set. A gold
        // rail sets them apart as recorded moves without a badge or a box.
        const textLead = row.verb || row.seat !== undefined ? ' ' : ''
        return (
          <div key={row.key} className={cls} style={style}>
            {row.glyph && <span className="cl-glyph">{row.glyph}</span>}
            {row.seat !== undefined && <b className="cl-nm">{name(row.seat)}</b>}
            {row.verb && <i className="cl-verb"> {row.verb}</i>}
            {row.text && <span className="cl-say">{textLead}{row.text}</span>}
            {row.pitch && <><span className="cl-say">: </span><i className="cl-pitch">{row.pitch}</i></>}
            {autopilot}
          </div>
        )
      })}
      <PendingIndicator view={view} bots={bots} pending={pending} name={name} />
    </div>
  )
}

const Dots = () => <span className="tr-dots"><i>●</i><i>●</i><i>●</i></span>

// Fan offset for quest card i of a `size`-card team. Shared by the sealing
// indicator and the reveal row so the two share one stage: the cards start
// (and, when sealing, stay) fanned; the reveal's qgather animation collapses
// them from exactly this position.
const qfan = (i: number, size: number): CSSProperties => ({
  ['--x' as string]: `calc((${i} - (${size} - 1) / 2) * 15px)`,
  ['--r' as string]: `calc((${i} - (${size} - 1) / 2) * 6deg)`,
})

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
    // Same card box, columns, and seat-labels as the votereveal row (votes are
    // emitted in seat order, matching view.players), so the sealing element and
    // the reveal read as one continuous moment: the ballots you watch seal are
    // the same cards, in the same positions, that flip to aye/nay. Compare the
    // quest phase, which shares its stage the same way.
    const total = view.players.length
    const sealed = total - view.players.filter((p) => pending.has(p.seat)).length
    return (
      <div className="feed-row ballot" role="status">
        <span className="votes-lbl">Ballots</span>
        <span className="vcards">
          {view.players.map((p) => (
            <span key={p.seat} className="vcardcol">
              <span className={`vslot ${pending.has(p.seat) ? 'pending' : 'sealed'}`}
                title={pending.has(p.seat) ? `${name(p.seat)} — still to vote` : `${name(p.seat)} — sealed`} />
              <span className="vcard-name">{name(p.seat)}</span>
            </span>
          ))}
        </span>
        <span className="ballot-prog">{sealed}/{total} sealed<Dots /></span>
      </div>
    )
  }

  if (view.phase === 'quest') {
    // Only team members act this phase; once all have sealed, pending empties and
    // we've already returned null above — so this always shows sealing progress.
    // Same stage/cards as the questResult reveal row, so the sealing element and
    // the reveal read as one continuous moment: the cards you watch seal are the
    // ones that gather, shuffle, and flip. The gather-&-flip plays on the reveal.
    const team = view.currentTeam ?? []
    const size = team.length
    const sealed = size - team.filter((s) => pending.has(s)).length
    return (
      <div className="feed-row qseal" role="status">
        <span className="qr-top">sealing · {sealed}/{size}<Dots /></span>
        <span className="qr-stage">
          {team.map((s, i) => (
            <span key={s} className={`qr-card ${pending.has(s) ? 'pending' : 'sealed'}`}
              style={qfan(i, size)} title="a quest card, played in secret" />
          ))}
        </span>
      </div>
    )
  }

  // discussion / proposal: ghost rows for bots mid-decision (humans use the
  // action bar). Same illuminated-line vocabulary as the rest of the feed —
  // colour carries who, the italic verb carries the action.
  const botsPending = [...pending].filter((s) => s !== view.seat && s in bots)
  return (
    <>
      {botsPending.map((s) => (
        <div key={`thinking-${s}`} className="c-line think"
          style={{ ['--mc' as string]: bots[s]?.color ?? 'var(--gold)' }}>
          <b className="cl-nm">{name(s)}</b>
          <i className="cl-verb">is thinking</i>
          <Dots />
        </div>
      ))}
    </>
  )
}

// The pass pool: a wordless pass is narrated, picked deterministically by the
// event's seq so a given pass always reads the same way while the table varies.
// Stored in base (second-person) form; conjugate adds the -s for a third party
// so the viewer's own pass reads "You hold their peace", not "You holds".
const PASS_VERBS = [
  'hold their peace',
  'keep their counsel',
  'say nothing',
  'stay silent',
  'offer no word',
  'let it pass',
]

// "You <verb>" needs the base form; anyone else takes third-person -s on the
// leading verb ("hold" → "holds", "say" → "says", "let" → "lets").
const conjugate = (base: string, thirdParty: boolean) =>
  thirdParty ? base.replace(/^\S+/, (w) => `${w}s`) : base

interface FeedRow {
  key: number
  kind: 'talk' | 'quiet' | 'deed' | 'moment' | 'votereveal' | 'questreveal'
  seat?: number
  glyph?: string
  verb?: string
  text?: string
  pitch?: string
  lean?: string
  sub?: string
  cls?: string
  votes?: { seat: number; vote: string }[]
  ayes?: number
  nays?: number
  teamSize?: number
  failCount?: number
}

function renderEvent(ev: GameEvent, name: (s: number) => string, view: PlayerView): FeedRow | null {
  const viewSeat = view.seat
  const p = ev.payload
  // The narrated lines address the viewer in the second person ("You take"),
  // everyone else in the third ("Sol takes"). Verb agreement follows suit.
  const you = (s: number | undefined) => s === viewSeat
  switch (ev.type) {
    case 'leadChange': {
      const seat = p.seat as number
      return { key: ev.seq, kind: 'deed', glyph: '♛ ', seat, verb: you(seat) ? 'take the crown' : 'takes the crown', text: `· quest ${p.round}` }
    }
    case 'utterance': {
      if (p.text) return { key: ev.seq, kind: 'talk', seat: p.seat, text: p.text as string, lean: p.lean }
      if (p.lean) return { key: ev.seq, kind: 'quiet', seat: p.seat, text: you(p.seat) ? ' signal' : ' signals', lean: p.lean }
      // Silence is information too.
      return { key: ev.seq, kind: 'quiet', seat: p.seat, text: ` ${conjugate(PASS_VERBS[ev.seq % PASS_VERBS.length], !you(p.seat))}.` }
    }
    case 'proposal': {
      const team = (p.team as number[]).map(name).join(' · ')
      return {
        key: ev.seq, kind: 'deed', seat: p.leader, verb: you(p.leader) ? 'propose' : 'proposes',
        text: `${team} for quest ${p.round} · proposal ${p.proposalNum} of 5`,
        pitch: p.pitch ? String(p.pitch) : undefined,
      }
    }
    case 'voteReveal': {
      if (p.auto) {
        return {
          key: ev.seq, kind: 'deed', glyph: '🔨 ', cls: 'hammer',
          text: 'The hammer falls · the 5th proposal is locked in automatically, no vote.',
        }
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
      // teamSize is authoritative on the quest (set at game start); the team may
      // not be recorded on it, so don't derive size from team length.
      const teamSize = view.quests[p.round - 1]?.teamSize ?? 3
      return {
        key: ev.seq,
        kind: 'questreveal',
        cls: won ? 'ok' : 'bad',
        teamSize, failCount: p.failCount,
        text: `Quest ${p.round} · ${won ? 'SUCCESS' : 'SABOTAGED'}`,
        sub: `${p.failCount} fail card${p.failCount === 1 ? '' : 's'} revealed, ${p.failsRequired} needed`,
      }
    }
    case 'assassination':
      return {
        key: ev.seq, kind: 'moment', cls: 'gold',
        text: `The Knife is drawn`,
        sub: `${name(p.assassin)} is the Assassin — and names ${name(p.target)} as Merlin. ${p.wasMerlin ? 'Correct. Evil steals the game.' : 'Wrong.'}`,
      }
    case 'gameOver':
      return {
        key: ev.seq, kind: 'moment', cls: p.winner === 'good' ? 'ok' : 'bad',
        text: `${String(p.winner).toUpperCase()} WINS`,
        sub: winReasonText(String(p.reason)),
      }
    case 'gameCreated':
      return { key: ev.seq, kind: 'deed', text: `The table is set: ${p.playerCount} players. Roles in play: ${(p.rolesInPlay as string[]).join(', ')}.` }
    case 'rename':
      return { key: ev.seq, kind: 'quiet', text: `${p.from} is now known as ${p.to}.` }
    default:
      return null
  }
}
