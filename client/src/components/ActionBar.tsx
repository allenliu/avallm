import { useState } from 'react'
import type { DecisionRequest, PlayerView, Seat } from '../types.ts'
import { latestLeans } from '../leans.ts'
import { Emblem } from './Arcana.tsx'

// `data-kind` (the decision kind, or "waiting") and `data-t` (per-button role) are
// stable automation hooks for the screenshot harness (tools/screenshots.mjs). They
// are intentionally decoupled from visual class names and button copy, both of which
// get redesigned often — keep them when restyling so the harness doesn't break.

export function ActionBar({ view, ask, onDecide, waitingOn }: {
  view: PlayerView
  ask: DecisionRequest | undefined
  onDecide: (d: Record<string, unknown>) => void
  waitingOn?: string[]
}) {
  if (!ask) {
    const others = (waitingOn ?? []).filter((n) => n !== view.name)
    return (
      <div className="action-bar waiting" data-kind="waiting">
        {others.length
          ? `Waiting on ${others.join(', ')}; they'll play when ready.`
          : 'The table is thinking…'}
      </div>
    )
  }
  switch (ask.kind) {
    case 'discuss': return <Discuss view={view} onDecide={onDecide} />
    case 'propose': return <Propose view={view} onDecide={onDecide} />
    case 'finalize': return <Finalize view={view} onDecide={onDecide} />
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
  const isLeader = view.leaderSeat === view.seat
  const teamPending = !!view.currentTeam
  // The leader never leans — their signals are the pitch and the finalize turn.
  const showLean = teamPending && !isLeader
  const round = view.discussionRound ?? 1
  const submit = (text: string) => {
    onDecide({ kind: 'discuss', say: text, lean: showLean && lean ? lean : undefined })
    setSay('')
  }
  return (
    <div className="action-bar your-turn column discuss2" data-kind="discuss">
      <div className="discuss-top">
        <TurnTag>Your turn to speak</TurnTag>
        <span className="action-label">
          {round > 1 ? `Round ${round}` : isLeader ? 'Defend your team' : 'React to the team'}
        </span>
      </div>
      <div className="discuss-bottom">
        {showLean && (
          <span className="lean-seg" title="Signal how you're leaning on this team (not binding)">
            <span className="lean-lbl">lean</span>
            {(['approve', 'reject', 'unsure'] as const).map((l) => (
              <button
                key={l}
                data-t={`lean-${l}`}
                className={`lean-seg-btn ${l}${lean === l ? ' active' : ''}`}
                title={`lean ${l === 'approve' ? 'aye' : l === 'reject' ? 'nay' : 'unsure'}`}
                onClick={() => setLean(lean === l ? null : l)}
              >{l === 'approve' ? 'AYE' : l === 'reject' ? 'NAY' : '?'}</button>
            ))}
          </span>
        )}
        <input
          autoFocus value={say} maxLength={300}
          placeholder={isLeader ? 'Defend your proposal…' : teamPending ? 'React to the proposed team…' : 'Say something to the table…'}
          onChange={(e) => setSay(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(say) }}
        />
        <button className="say-btn" data-t="say" onClick={() => submit(say)}>Say</button>
        <button className="ghost pass-btn" data-t="pass" onClick={() => submit('')}>{showLean && lean ? 'Signal only' : 'Pass'}</button>
      </div>
    </div>
  )
}

function Propose({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const size = view.quests[view.round - 1].teamSize
  const [team, setTeam] = useState<Seat[]>([])
  const [pitch, setPitch] = useState('')
  const toggle = (s: Seat) => setTeam((t) => t.includes(s) ? t.filter((x) => x !== s) : t.length < size ? [...t, s] : t)
  return (
    <div className="action-bar your-turn column" data-kind="propose">
      <div className="row">
        <TurnTag>You lead</TurnTag>
        <span className="action-label">Quest {view.round}: pick {size} players ({team.length}/{size})</span>
      </div>
      <div className="seat-picker">
        {view.players.map((p) => (
          <button
            key={p.seat}
            data-t="seat-pick"
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
          data-t="propose"
          disabled={team.length !== size}
          onClick={() => onDecide({ kind: 'propose', team, pitch: pitch || undefined })}
        >Propose team</button>
      </div>
    </div>
  )
}

// The leader's one-time stick-or-change turn after discussion winds down.
// A revision requires a spoken reason — a silent team swap reads as evasive
// and the engine announces the reason to the table.
function Finalize({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const size = view.quests[view.round - 1].teamSize
  const current = view.currentTeam ?? []
  const [revising, setRevising] = useState(false)
  const [team, setTeam] = useState<Seat[]>(current)
  const [reason, setReason] = useState('')
  const hammer = view.proposalNum === 5
  const teamNames = current.map((s) => s === view.seat ? 'You' : view.players[s].name).join(' · ')
  const sameTeam = team.length === current.length
    && [...team].sort((a, b) => a - b).every((s, i) => s === current[i])
  const toggle = (s: Seat) => setTeam((t) => t.includes(s) ? t.filter((x) => x !== s) : t.length < size ? [...t, s] : t)
  if (!revising) {
    return (
      <div className="action-bar your-turn" data-kind="finalize">
        <TurnTag>Lock it in?</TurnTag>
        <span className="action-label">
          Discussion has wound down on <b className="team-gold">{teamNames}</b>
          {hammer ? '. The hammer: your locked team goes straight on the quest.' : '.'}
        </span>
        <span className="bar-spacer" />
        <button data-t="finalize-stick" onClick={() => onDecide({ kind: 'finalize', stick: true })}>Keep team</button>
        <button className="ghost" data-t="finalize-revise" onClick={() => setRevising(true)}>Revise…</button>
      </div>
    )
  }
  return (
    <div className="action-bar your-turn column" data-kind="finalize">
      <div className="row">
        <TurnTag>Revise your team</TurnTag>
        <span className="action-label">Pick {size} players ({team.length}/{size}), one revision only</span>
      </div>
      <div className="seat-picker">
        {view.players.map((p) => (
          <button
            key={p.seat}
            data-t="seat-pick"
            className={`pick${team.includes(p.seat) ? ' picked' : ''}`}
            onClick={() => toggle(p.seat)}
          >{p.seat === view.seat ? 'You' : p.name}</button>
        ))}
      </div>
      <div className="row">
        <input
          value={reason} maxLength={200}
          placeholder="Tell the table why (required)"
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          data-t="finalize-confirm"
          disabled={team.length !== size || sameTeam || !reason.trim()}
          onClick={() => onDecide({ kind: 'finalize', stick: false, team, reason: reason.trim() })}
        >Change team</button>
        <button className="ghost" data-t="finalize-back" onClick={() => { setRevising(false); setTeam(current) }}>Back</button>
      </div>
    </div>
  )
}

// Votes only happen on proposals 1-4 — the 5th ("hammer") proposal is
// approved automatically by the engine, so no hammer warning is needed here.
function Vote({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const team = (view.currentTeam ?? []).map((s) => s === view.seat ? 'You' : view.players[s].name).join(' · ')
  return (
    <div className="action-bar your-turn" data-kind="vote">
      <TurnTag>Play a card</TurnTag>
      <span className="action-label">Approve <b className="team-gold">{team}</b> for quest {view.round}?</span>
      <span className="bar-spacer" />
      <div className="playcards">
        <button className="play approve" data-t="vote-approve" title="The Chariot: approve, send them forth" onClick={() => onDecide({ kind: 'vote', vote: 'approve' })}>
          <span className="pc-star tl">✦</span><span className="pc-star br">✦</span>
          <span className="pnum">VII</span>
          <span className="pem-frame"><Emblem id="chariot" className="pem" /></span>
          {/* arcanum name on desktop, plain verdict on mobile (where numeral + subtitle are hidden) */}
          <span className="pt vote-title"><span className="ptx-arc">The Chariot</span><span className="ptx-plain">Approve</span></span>
          <span className="ps">send them forth</span>
        </button>
        <button className="play reject" data-t="vote-reject" title="The Hanged Man: reject, force a new leader" onClick={() => onDecide({ kind: 'vote', vote: 'reject' })}>
          <span className="pc-star tl">✦</span><span className="pc-star br">✦</span>
          <span className="pnum">XII</span>
          <span className="pem-frame"><Emblem id="hanged" className="pem" /></span>
          <span className="pt vote-title"><span className="ptx-arc">The Hanged Man</span><span className="ptx-plain">Reject</span></span>
          <span className="ps">force a new leader</span>
        </button>
      </div>
    </div>
  )
}

function QuestCard({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const good = view.alignment === 'good'
  return (
    <div className="action-bar your-turn" data-kind="quest">
      <TurnTag>The quest</TurnTag>
      <span className="action-label">
        Play your card in secret{good ? ' (good must play Success)' : ''}:
      </span>
      <span className="bar-spacer" />
      <div className="playcards">
        <button className="play approve" data-t="quest-success" onClick={() => onDecide({ kind: 'quest', card: 'success' })}>
          <span className="pc-star tl">✦</span><span className="pc-star br">✦</span>
          <span className="pnum">XIX</span>
          <span className="pem-frame"><Emblem id="laurel" className="pem" /></span>
          <span className="pt">Success</span>
        </button>
        {!good && (
          <button className="play reject" data-t="quest-fail" onClick={() => onDecide({ kind: 'quest', card: 'fail' })}>
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
    <div className="action-bar your-turn column" data-kind="assassinate">
      <div className="row">
        <TurnTag>The Knife</TurnTag>
        <span className="action-label">Good has three quests, but you are the Assassin. Who is Merlin?</span>
      </div>
      <div className="row">
        <div className="seat-picker">
          {view.players.filter((p) => p.seat !== view.seat).map((p) => (
            <button
              key={p.seat}
              data-t="seat-pick"
              className={`pick${target === p.seat ? ' picked danger-pick' : ''}`}
              onClick={() => setTarget(p.seat)}
            >{p.name}</button>
          ))}
        </div>
        <button className="play reject compact" data-t="assassinate" disabled={target === null}
          onClick={() => onDecide({ kind: 'assassinate', target })}>
          <Emblem id="dagger" className="pem" /><span className="pt">Assassinate</span>
        </button>
      </div>
    </div>
  )
}
