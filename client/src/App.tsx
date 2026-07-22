import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DecisionRequest, RevealPayload, ServerPayload } from './types.ts'
import { EVIL_COUNT, PRESETS, ROLE_INFO, RULES_SUMMARY, buildRoles } from './setup.ts'
import type { PresetId, Role, SpecialSelection } from './setup.ts'
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

  const newGame = useCallback(async (playerCount: number, bots: 'llm' | 'heuristic', roles: Role[] | null) => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/game/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerCount, bots, ...(roles ? { roles } : {}) }),
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
  onStart: (playerCount: number, bots: 'llm' | 'heuristic', roles: Role[] | null) => void
  starting: boolean
}) {
  const [players, setPlayers] = useState(7)
  const [bots, setBots] = useState<'llm' | 'heuristic'>('llm')
  const [preset, setPreset] = useState<PresetId | 'custom'>('standard')
  const [sel, setSel] = useState<SpecialSelection>(PRESETS.standard.pick(7))
  const [showRules, setShowRules] = useState(false)

  const setPlayersAndRoles = (n: number) => {
    setPlayers(n)
    if (preset !== 'custom') setSel(PRESETS[preset].pick(n))
  }
  const applyPreset = (p: PresetId) => {
    setPreset(p)
    setSel(PRESETS[p].pick(players))
  }
  const toggle = (key: keyof SpecialSelection) => {
    setPreset('custom')
    setSel((s) => ({ ...s, [key]: !s[key] }))
  }

  const built = useMemo(() => buildRoles(players, sel), [players, sel])
  const evil = EVIL_COUNT[players]

  const toggles: { key: keyof SpecialSelection; label: string; roles: Role[] }[] = [
    { key: 'merlinPair', label: 'Merlin & Assassin', roles: ['merlin', 'assassin'] },
    { key: 'percival', label: 'Percival', roles: ['percival'] },
    { key: 'morgana', label: 'Morgana', roles: ['morgana'] },
    { key: 'mordred', label: 'Mordred', roles: ['mordred'] },
    { key: 'oberon', label: 'Oberon', roles: ['oberon'] },
  ]

  return (
    <div className="launcher">
      <button className="secondary rules-toggle" onClick={() => setShowRules(!showRules)}>
        {showRules ? 'Hide the rules' : 'How do you play Avalon?'}
      </button>
      {showRules && (
        <ul className="rules-summary">
          {RULES_SUMMARY.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
      <div className="row">
        <label>
          Players{' '}
          <select value={players} onChange={(e) => setPlayersAndRoles(Number(e.target.value))}>
            {[5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>{n} ({n - EVIL_COUNT[n]} good / {EVIL_COUNT[n]} evil)</option>
            ))}
          </select>
        </label>
        <label>
          Opponents{' '}
          <select value={bots} onChange={(e) => setBots(e.target.value as 'llm' | 'heuristic')}>
            <option value="llm">LLM models (costs a few cents)</option>
            <option value="heuristic">Rule-based (free)</option>
          </select>
        </label>
      </div>
      <div className="preset-row">
        {(Object.keys(PRESETS) as PresetId[]).map((p) => (
          <button
            key={p}
            className={`secondary preset-btn${preset === p ? ' active' : ''}`}
            title={PRESETS[p].blurb}
            onClick={() => applyPreset(p)}
          >{PRESETS[p].label}</button>
        ))}
        {preset === 'custom' && <span className="preset-custom">custom</span>}
      </div>
      <div className="role-toggles">
        {toggles.map((t) => (
          <label key={t.key} className={`role-toggle-row ${ROLE_INFO[t.roles[0]].side}`}>
            <input
              type="checkbox"
              checked={sel[t.key]}
              onChange={() => toggle(t.key)}
            />
            <span className="role-toggle-name">{t.label}</span>
            <span className="role-toggle-desc">
              {t.roles.map((r) => ROLE_INFO[r].desc).join(' ')}
            </span>
          </label>
        ))}
        <p className="role-fill-note">
          Remaining seats are filled with Loyal Servants (good, no knowledge) and
          Minions (evil, know each other). {evil} of {players} players are evil.
        </p>
      </div>
      {built.error && <p className="error">{built.error}</p>}
      {built.warning && <p className="warning">{built.warning}</p>}
      {built.roles && (
        <p className="roles-preview">
          In play: {built.roles.map((r) => ROLE_INFO[r].name).join(', ')}
        </p>
      )}
      <button
        disabled={starting || !built.roles}
        onClick={() => onStart(players, bots, built.roles)}
      >
        {starting ? 'Dealing roles…' : 'Sit down at the table'}
      </button>
    </div>
  )
}
