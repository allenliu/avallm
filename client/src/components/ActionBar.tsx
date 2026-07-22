import { useState } from 'react'
import type { DecisionRequest, PlayerView, Seat } from '../types.ts'

export function ActionBar({ view, ask, onDecide }: {
  view: PlayerView
  ask: DecisionRequest | undefined
  onDecide: (d: Record<string, unknown>) => void
}) {
  if (!ask) {
    return <div className="action-bar waiting">The table is playing… watch the feed.</div>
  }
  switch (ask.kind) {
    case 'discuss': return <Discuss onDecide={onDecide} />
    case 'propose': return <Propose view={view} onDecide={onDecide} />
    case 'vote': return <Vote view={view} onDecide={onDecide} />
    case 'quest': return <QuestCard view={view} onDecide={onDecide} />
    case 'assassinate': return <Assassinate view={view} onDecide={onDecide} />
  }
}

function Discuss({ onDecide }: { onDecide: (d: Record<string, unknown>) => void }) {
  const [say, setSay] = useState('')
  const submit = (text: string) => { onDecide({ kind: 'discuss', say: text }); setSay('') }
  return (
    <div className="action-bar">
      <span className="action-label">Your turn to speak</span>
      <input
        autoFocus value={say} maxLength={300}
        placeholder="Say something to the table…"
        onChange={(e) => setSay(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(say) }}
      />
      <button onClick={() => submit(say)}>Say</button>
      <button className="secondary" onClick={() => submit('')}>Pass</button>
    </div>
  )
}

function Propose({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const size = view.quests[view.round - 1].teamSize
  const [team, setTeam] = useState<Seat[]>([])
  const [pitch, setPitch] = useState('')
  const toggle = (s: Seat) => setTeam((t) => t.includes(s) ? t.filter((x) => x !== s) : t.length < size ? [...t, s] : t)
  return (
    <div className="action-bar column">
      <span className="action-label">You lead quest {view.round} — pick {size} players ({team.length}/{size})</span>
      <div className="seat-picker">
        {view.players.map((p) => (
          <button
            key={p.seat}
            className={`pick${team.includes(p.seat) ? ' picked' : ''}`}
            onClick={() => toggle(p.seat)}
          >{p.name}</button>
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

function Vote({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const team = (view.currentTeam ?? []).map((s) => view.players[s].name).join(', ')
  const hammer = view.proposalNum === 5
  return (
    <div className="action-bar">
      <span className="action-label">
        Vote on [{team}]{hammer && <b className="hammer-warn"> — THE HAMMER: a rejection ends the game for evil</b>}
      </span>
      <button onClick={() => onDecide({ kind: 'vote', vote: 'approve' })}>Approve</button>
      <button className="danger" onClick={() => onDecide({ kind: 'vote', vote: 'reject' })}>Reject</button>
    </div>
  )
}

function QuestCard({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const good = view.alignment === 'good'
  return (
    <div className="action-bar">
      <span className="action-label">You are on the quest. Play your card{good ? ' (good must play Success)' : ''}:</span>
      <button onClick={() => onDecide({ kind: 'quest', card: 'success' })}>Success</button>
      {!good && <button className="danger" onClick={() => onDecide({ kind: 'quest', card: 'fail' })}>Fail</button>}
    </div>
  )
}

function Assassinate({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const [target, setTarget] = useState<Seat | null>(null)
  return (
    <div className="action-bar column">
      <span className="action-label">Good has three quests — but you are the Assassin. Who is Merlin?</span>
      <div className="seat-picker">
        {view.players.filter((p) => p.seat !== view.seat).map((p) => (
          <button
            key={p.seat}
            className={`pick${target === p.seat ? ' picked danger-pick' : ''}`}
            onClick={() => setTarget(p.seat)}
          >{p.name}</button>
        ))}
      </div>
      <button className="danger" disabled={target === null}
        onClick={() => onDecide({ kind: 'assassinate', target })}>
        Assassinate
      </button>
    </div>
  )
}
