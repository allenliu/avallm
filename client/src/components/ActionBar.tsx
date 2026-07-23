import { useState } from 'react'
import type { DecisionRequest, PlayerView, Seat } from '../types.ts'
import { latestLeans } from '../leans.ts'
import { Emblem } from './Arcana.tsx'

export function ActionBar({ view, ask, onDecide, waitingOn }: {
  view: PlayerView
  ask: DecisionRequest | undefined
  onDecide: (d: Record<string, unknown>) => void
  waitingOn?: string[]
}) {
  if (!ask) {
    const others = (waitingOn ?? []).filter((n) => n !== view.name)
    return (
      <div className="action-bar waiting">
        {others.length
          ? `Waiting on ${others.join(', ')}… (no rush — this table plays like mail chess)`
          : 'The table is playing… watch the feed.'}
      </div>
    )
  }
  switch (ask.kind) {
    case 'discuss': return <Discuss view={view} onDecide={onDecide} />
    case 'propose': return <Propose view={view} onDecide={onDecide} />
    case 'vote': return <Vote view={view} onDecide={onDecide} />
    case 'quest': return <QuestCard view={view} onDecide={onDecide} />
    case 'assassinate': return <Assassinate view={view} onDecide={onDecide} />
  }
}

const TurnTag = ({ children }: { children: string }) => (
  <span className="turn-tag">⟡ {children}</span>
)

function Discuss({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const [say, setSay] = useState('')
  // Seed the picker from the lean you last signalled on this proposal so it
  // stays sticky across speaking turns (and survives a refresh) — re-choose
  // only to change it. A fresh proposal has no prior utterances, so this is null.
  const [lean, setLean] = useState<string | null>(() => latestLeans(view).get(view.seat) ?? null)
  const teamPending = !!view.currentTeam
  const round = view.discussionRound ?? 1
  // You lead this quest and the pre-proposal talk has just opened on you: the
  // table has nothing to react to yet, so passing here tends to stall everyone.
  const leadOpening = view.leaderSeat === view.seat && view.discussionSlot === 'pre' && !teamPending
  const submit = (text: string) => {
    onDecide({ kind: 'discuss', say: text, lean: lean ?? undefined })
    setSay('')
  }
  return (
    <div className="action-bar your-turn">
      {leadOpening && (
        <span className="action-hint">
          ♛ You lead quest {view.round} — open the discussion with the team you're leaning toward, so the table has something to react to before you propose.
        </span>
      )}
      <TurnTag>Your turn to speak</TurnTag>
      <span className="action-label">
        {round > 1 ? `Round ${round}` : teamPending ? 'React to the team' : 'Address the table'}
      </span>
      <input
        autoFocus value={say} maxLength={300}
        placeholder={teamPending ? 'React to the proposed team…' : 'Say something to the table…'}
        onChange={(e) => setSay(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(say) }}
      />
      {teamPending && (
        <span className="lean-picker" title="Signal how you're leaning on this team (not binding)">
          <span className="lean-lbl">lean</span>
          {(['approve', 'reject', 'unsure'] as const).map((l) => (
            <button
              key={l}
              className={`lean-btn ${l}${lean === l ? ' active' : ''}`}
              title={`lean ${l === 'approve' ? 'aye' : l === 'reject' ? 'nay' : 'unsure'}`}
              onClick={() => setLean(lean === l ? null : l)}
            >{l === 'approve' ? 'AYE' : l === 'reject' ? 'NAY' : '?'}</button>
          ))}
        </span>
      )}
      <button className="say-btn" onClick={() => submit(say)}>Say</button>
      <button className="ghost pass-btn" onClick={() => submit('')}>{lean ? 'Signal only' : 'Pass'}</button>
    </div>
  )
}

function Propose({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const size = view.quests[view.round - 1].teamSize
  const [team, setTeam] = useState<Seat[]>([])
  const [pitch, setPitch] = useState('')
  const toggle = (s: Seat) => setTeam((t) => t.includes(s) ? t.filter((x) => x !== s) : t.length < size ? [...t, s] : t)
  return (
    <div className="action-bar your-turn column">
      <div className="row">
        <TurnTag>You lead</TurnTag>
        <span className="action-label">Quest {view.round} — pick {size} players ({team.length}/{size})</span>
      </div>
      <div className="seat-picker">
        {view.players.map((p) => (
          <button
            key={p.seat}
            className={`pick${team.includes(p.seat) ? ' picked' : ''}`}
            onClick={() => toggle(p.seat)}
          >{p.seat === view.seat ? 'You' : p.name}</button>
        ))}
      </div>
      <div className="row">
        <input
          value={pitch} maxLength={200}
          placeholder="One-line pitch (optional)"
          onChange={(e) => setPitch(e.target.value)}
        />
        <button
          disabled={team.length !== size}
          onClick={() => onDecide({ kind: 'propose', team, pitch: pitch || undefined })}
        >Propose team</button>
      </div>
    </div>
  )
}

// Votes only happen on proposals 1-4 — the 5th ("hammer") proposal is
// approved automatically by the engine, so no hammer warning is needed here.
function Vote({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const team = (view.currentTeam ?? []).map((s) => s === view.seat ? 'You' : view.players[s].name).join(' · ')
  return (
    <div className="action-bar your-turn">
      <TurnTag>Play a card</TurnTag>
      <span className="action-label">Approve <b className="team-gold">{team}</b> for quest {view.round}?</span>
      <span className="bar-spacer" />
      <div className="playcards">
        <button className="play approve" onClick={() => onDecide({ kind: 'vote', vote: 'approve' })}>
          <span className="pc-star tl">✦</span><span className="pc-star br">✦</span>
          <span className="pnum">AYE</span>
          <span className="pem-frame"><Emblem id="laurel" className="pem" /></span>
          <span className="pt">Approve</span><span className="ps">send them</span>
        </button>
        <button className="play reject" onClick={() => onDecide({ kind: 'vote', vote: 'reject' })}>
          <span className="pc-star tl">✦</span><span className="pc-star br">✦</span>
          <span className="pnum">NAY</span>
          <span className="pem-frame"><Emblem id="dagger" className="pem" /></span>
          <span className="pt">Reject</span><span className="ps">force a new leader</span>
        </button>
      </div>
    </div>
  )
}

function QuestCard({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const good = view.alignment === 'good'
  return (
    <div className="action-bar your-turn">
      <TurnTag>The quest</TurnTag>
      <span className="action-label">
        Play your card in secret{good ? ' — good must play Success' : ''}:
      </span>
      <span className="bar-spacer" />
      <div className="playcards">
        <button className="play approve" onClick={() => onDecide({ kind: 'quest', card: 'success' })}>
          <span className="pc-star tl">✦</span><span className="pc-star br">✦</span>
          <span className="pnum">XIX</span>
          <span className="pem-frame"><Emblem id="laurel" className="pem" /></span>
          <span className="pt">Success</span>
        </button>
        {!good && (
          <button className="play reject" onClick={() => onDecide({ kind: 'quest', card: 'fail' })}>
            <span className="pc-star tl">✦</span><span className="pc-star br">✦</span>
            <span className="pnum">XVI</span>
            <span className="pem-frame"><Emblem id="dagger" className="pem" /></span>
            <span className="pt">Fail</span>
          </button>
        )}
      </div>
    </div>
  )
}

function Assassinate({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const [target, setTarget] = useState<Seat | null>(null)
  return (
    <div className="action-bar your-turn column">
      <div className="row">
        <TurnTag>The Knife</TurnTag>
        <span className="action-label">Good has three quests — but you are the Assassin. Who is Merlin?</span>
      </div>
      <div className="row">
        <div className="seat-picker">
          {view.players.filter((p) => p.seat !== view.seat).map((p) => (
            <button
              key={p.seat}
              className={`pick${target === p.seat ? ' picked danger-pick' : ''}`}
              onClick={() => setTarget(p.seat)}
            >{p.name}</button>
          ))}
        </div>
        <button className="play reject compact" disabled={target === null}
          onClick={() => onDecide({ kind: 'assassinate', target })}>
          <Emblem id="dagger" className="pem" /><span className="pt">Assassinate</span>
        </button>
      </div>
    </div>
  )
}
