import { useCallback, useEffect, useRef, useState } from 'react'
import type { DecisionRequest, RevealPayload, ServerPayload } from './types.ts'
import { ActionBar } from './components/ActionBar.tsx'
import { Feed } from './components/Feed.tsx'
import { QuestBoard } from './components/QuestBoard.tsx'
import { Reveal } from './components/Reveal.tsx'
import { RoleCard } from './components/RoleCard.tsx'
import { TableSeats } from './components/TableSeats.tsx'

type Screen =
  | { name: 'landing' }
  | { name: 'game'; id: string }

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'landing' })
  const [payload, setPayload] = useState<ServerPayload | null>(null)
  const [reveal, setReveal] = useState<RevealPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const newGame = useCallback(async (playerCount: number, bots: 'llm' | 'heuristic') => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/game/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerCount, bots }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'failed to start game')
      setPayload(data)
      setReveal(null)
      setScreen({ name: 'game', id: data.id })
      esRef.current?.close()
      const es = new EventSource(`/api/game/${data.id}/events`)
      es.onmessage = (ev) => setPayload(JSON.parse(ev.data))
      es.onerror = () => setError('lost connection to the server')
      esRef.current = es
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }, [])

  useEffect(() => () => esRef.current?.close(), [])

  const gameId = screen.name === 'game' ? screen.id : null
  const gameOver = payload?.view.phase === 'gameOver'

  useEffect(() => {
    if (gameOver && gameId && !reveal) {
      fetch(`/api/game/${gameId}/reveal`)
        .then((r) => r.json())
        .then(setReveal)
        .catch(() => {})
    }
  }, [gameOver, gameId, reveal])

  const decide = useCallback(async (decision: Record<string, unknown>) => {
    if (!gameId) return
    setError(null)
    const res = await fetch(`/api/game/${gameId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'decision rejected')
    }
  }, [gameId])

  if (screen.name === 'landing' || !payload) {
    return (
      <div className="landing">
        <h1>Avalon <span className="vs">vs.</span> the Machines</h1>
        <p className="tagline">
          Hidden roles, open models. Every other player at the table is an LLM —
          and you know exactly which one you're trying to fool.
        </p>
        <Launcher onStart={newGame} starting={starting} />
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  const { view, ask, acting, bots } = payload
  const myAsk: DecisionRequest | undefined = ask[0]

  return (
    <div className="game">
      <header>
        <h1 className="small">Avalon <span className="vs">vs.</span> the Machines</h1>
        <QuestBoard view={view} />
      </header>
      <TableSeats view={view} bots={bots} acting={acting} />
      <main>
        <Feed view={view} bots={bots} />
        <aside>
          <RoleCard view={view} />
          {payload.degraded > 0 && (
            <div className="degraded-note">{payload.degraded} bot decision{payload.degraded === 1 ? '' : 's'} fell back to autopilot</div>
          )}
        </aside>
      </main>
      <footer>
        {gameOver
          ? <Reveal view={view} reveal={reveal} bots={bots} onNewGame={() => setScreen({ name: 'landing' })} />
          : <ActionBar view={view} ask={myAsk} onDecide={decide} />}
        {error && <p className="error">{error}</p>}
      </footer>
    </div>
  )
}

function Launcher({ onStart, starting }: {
  onStart: (playerCount: number, bots: 'llm' | 'heuristic') => void
  starting: boolean
}) {
  const [players, setPlayers] = useState(7)
  const [bots, setBots] = useState<'llm' | 'heuristic'>('llm')
  return (
    <div className="launcher">
      <label>
        Players{' '}
        <select value={players} onChange={(e) => setPlayers(Number(e.target.value))}>
          {[5, 6, 7, 8, 9].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <label>
        Opponents{' '}
        <select value={bots} onChange={(e) => setBots(e.target.value as 'llm' | 'heuristic')}>
          <option value="llm">LLM models (costs a few cents)</option>
          <option value="heuristic">Rule-based (free)</option>
        </select>
      </label>
      <button disabled={starting} onClick={() => onStart(players, bots)}>
        {starting ? 'Dealing roles…' : 'Sit down at the table'}
      </button>
    </div>
  )
}
