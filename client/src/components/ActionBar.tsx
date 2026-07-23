import { useState } from 'react'
import type { DecisionRequest, PlayerView, Seat } from '../types.ts'
import { latestLeans } from '../leans.ts'

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

function Discuss({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const [say, setSay] = useState('')
  // Seed the picker from the lean you last signalled on this proposal so it
  // stays sticky across speaking turns (and survives a refresh) — re-choose
  // only to change it. A fresh proposal has no prior utterances, so this is null.
  const [lean, setLean] = useState<string | null>(() => latestLeans(view).get(view.seat) ?? null)
  const teamPending = !!view.currentTeam
  const round = view.discussionRound ?? 1
  const submit = (text: string) => {
    onDecide({ kind: 'discuss', say: text, lean: lean ?? undefined })
    setSay('')
  }
  return (
    <div className="action-bar">
      <span className="action-label">
        Your turn to speak{round > 1 ? ` (round ${round})` : ''}
      </span>
      <input
        autoFocus value={say} maxLength={300}
        placeholder={teamPending ? 'React to the proposed team…' : 'Say something to the table…'}
        onChange={(e) => setSay(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(say) }}
      />
      {teamPending && (
        <span className="lean-picker" title="Signal how you're leaning on this team (not binding)">
          {(['approve', 'reject', 'unsure'] as const).map((l) => (
            <button
              key={l}
              className={`secondary lean-btn${lean === l ? ` active ${l}` : ''}`}
              onClick={() => setLean(lean === l ? null : l)}
            >{l === 'approve' ? '👍' : l === 'reject' ? '👎' : '🤔'}</button>
          ))}
        </span>
      )}
      <button onClick={() => submit(say)}>Say</button>
      <button className="secondary" onClick={() => submit('')}>{lean ? 'Signal only' : 'Pass'}</button>
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

// Votes only happen on proposals 1-4 — the 5th ("hammer") proposal is
// approved automatically by the engine, so no hammer warning is needed here.
function Vote({ view, onDecide }: { view: PlayerView; onDecide: (d: Record<string, unknown>) => void }) {
  const team = (view.currentTeam ?? []).map((s) => view.players[s].name).join(', ')
  return (
    <div className="action-bar">
      <span className="action-label">
        Vote on [{team}]
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
