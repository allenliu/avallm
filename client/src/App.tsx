import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentInfo, DecisionRequest, Library, RevealPayload, ServerPayload } from './types.ts'
import { EVIL_COUNT, PRESETS, ROLE_INFO, RULES_SUMMARY, buildRoles } from './setup.ts'
import type { PresetId, Role, SpecialSelection } from './setup.ts'
import { ActionBar } from './components/ActionBar.tsx'
import { Feed } from './components/Feed.tsx'
import { HistoryGrid } from './components/HistoryGrid.tsx'
import { QuestBoard } from './components/QuestBoard.tsx'
import { Reference } from './components/Reference.tsx'
import { Reveal } from './components/Reveal.tsx'
import { RoleCard } from './components/RoleCard.tsx'
import { ModelBadge, TableSeats } from './components/TableSeats.tsx'

type Screen =
  | { name: 'landing' }
  | { name: 'game'; id: string }

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'landing' })
  const [payload, setPayload] = useState<ServerPayload | null>(null)
  const [reveal, setReveal] = useState<RevealPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [library, setLibrary] = useState<Library | null>(null)
  const [showRef, setShowRef] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const refreshLibrary = useCallback(() => {
    fetch('/api/agents').then((r) => r.json()).then(setLibrary).catch(() => {})
  }, [])
  useEffect(refreshLibrary, [refreshLibrary])

  const newGame = useCallback(async (playerCount: number, table: string[], roles: Role[] | null, humanName: string) => {
    setStarting(true)
    setError(null)
    try {
      const res = await fetch('/api/game/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerCount, table, humanName, ...(roles ? { roles } : {}) }),
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
        <Launcher onStart={newGame} starting={starting} library={library} onLibraryChange={refreshLibrary} />
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
        <span className="header-buttons">
          <button className="secondary" onClick={() => setShowHistory(true)}>📊 History</button>
          <button className="secondary" onClick={() => setShowRef(true)}>📖 Reference</button>
        </span>
      </header>
      {showRef && <Reference view={view} bots={bots} library={library} onClose={() => setShowRef(false)} />}
      {showHistory && <HistoryGrid view={view} bots={bots} onClose={() => setShowHistory(false)} />}
      <TableSeats view={view} bots={bots} acting={acting} />
      <main>
        <Feed view={view} bots={bots} degradedSeqs={payload.degradedSeqs} />
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

function defaultTable(library: Library | null, count: number): string[] {
  const llmAgents = library?.agents.filter((a) => a.model !== 'rule-based' && a.model !== 'external' && !a.custom) ?? []
  return Array.from({ length: count }, (_, i) =>
    llmAgents.length ? llmAgents[i % llmAgents.length].id : 'autopilot')
}

function Launcher({ onStart, starting, library, onLibraryChange }: {
  onStart: (playerCount: number, table: string[], roles: Role[] | null, humanName: string) => void
  starting: boolean
  library: Library | null
  onLibraryChange: () => void
}) {
  const [players, setPlayers] = useState(7)
  const [table, setTable] = useState<string[]>([])
  const [humanName, setHumanName] = useState(() => localStorage.getItem('avalon-name') ?? '')
  const [preset, setPreset] = useState<PresetId | 'custom'>('standard')
  const [sel, setSel] = useState<SpecialSelection>(PRESETS.standard.pick(7))
  const [showRules, setShowRules] = useState(false)

  // Fill the table once the library arrives; resize it when players changes.
  useEffect(() => {
    if (!library) return
    setTable((t) => {
      const want = players - 1
      const valid = t.filter((id) => library.agents.some((a) => a.id === id))
      if (valid.length === want && t.length === want) return t
      if (valid.length === 0) return defaultTable(library, want)
      return Array.from({ length: want }, (_, i) => valid[i % valid.length])
    })
  }, [players, library])

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
          Your name{' '}
          <input
            value={humanName} maxLength={24} placeholder="You"
            onChange={(e) => {
              setHumanName(e.target.value)
              localStorage.setItem('avalon-name', e.target.value)
            }}
          />
        </label>
        <label>
          Players{' '}
          <select value={players} onChange={(e) => setPlayersAndRoles(Number(e.target.value))}>
            {[5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>{n} ({n - EVIL_COUNT[n]} good / {EVIL_COUNT[n]} evil)</option>
            ))}
          </select>
        </label>
      </div>
      <TablePicker
        library={library}
        table={table}
        onChange={setTable}
        onFill={(mode) => setTable(mode === 'models'
          ? defaultTable(library, players - 1)
          : Array.from({ length: players - 1 }, () => 'autopilot'))}
      />
      <AddAgentForm library={library} onAdded={onLibraryChange} />
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
        disabled={starting || !built.roles || table.length !== players - 1}
        onClick={() => onStart(players, table, built.roles, humanName)}
      >
        {starting ? 'Dealing roles…' : 'Sit down at the table'}
      </button>
    </div>
  )
}

function TablePicker({ library, table, onChange, onFill }: {
  library: Library | null
  table: string[]
  onChange: (t: string[]) => void
  onFill: (mode: 'models' | 'autopilot') => void
}) {
  if (!library) return <p className="roles-preview">Loading agent library…</p>
  const agentById = (id: string) => library.agents.find((a) => a.id === id)
  const setSeat = (i: number, id: string) => {
    const next = table.slice()
    next[i] = id
    onChange(next)
  }
  return (
    <div className="table-picker">
      <div className="table-picker-head">
        <span className="action-label">Your opponents</span>
        <span className="fill-buttons">
          fill with:{' '}
          <button className="secondary" onClick={() => onFill('models')}>LLM models</button>
          <button className="secondary" onClick={() => onFill('autopilot')}>Autopilot (free)</button>
        </span>
      </div>
      {table.map((id, i) => {
        const info = agentById(id)
        return (
          <div key={i} className="table-picker-row">
            <ModelBadge info={info} />
            <select value={id} onChange={(e) => setSeat(i, e.target.value)}>
              {library.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.model}){a.custom ? ' — custom' : ''}
                </option>
              ))}
            </select>
            <span className="role-toggle-desc">{info?.about ?? ''}</span>
          </div>
        )
      })}
    </div>
  )
}

function AddAgentForm({ library, onAdded }: { library: Library | null; onAdded: () => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [about, setAbout] = useState('')
  const [personality, setPersonality] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!library) return null
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          model: model || library.models[0]?.id,
          about: about || undefined,
          personality: personality || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'failed to save agent')
      setOpen(false)
      setName(''); setAbout(''); setPersonality('')
      onAdded()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  if (!open) {
    return <button className="secondary rules-toggle" onClick={() => setOpen(true)}>+ Create your own agent</button>
  }
  return (
    <div className="add-agent">
      <div className="row">
        <input value={name} maxLength={40} placeholder="Agent name" onChange={(e) => setName(e.target.value)} />
        <select value={model || library.models[0]?.id} onChange={(e) => setModel(e.target.value)}>
          {library.models.map((m) => <option key={m.id} value={m.id}>{m.slug} ({m.tier})</option>)}
        </select>
      </div>
      <input value={about} maxLength={300} placeholder="About (shown in the library)" onChange={(e) => setAbout(e.target.value)} />
      <textarea
        value={personality} maxLength={2000} rows={3}
        placeholder="Personality / strategy prompt — layered onto the baseline agent (e.g. 'You are theatrical and paranoid. Accuse early, defend loudly, never vote with the crowd.')"
        onChange={(e) => setPersonality(e.target.value)}
      />
      <div className="row">
        <button disabled={busy || !name.trim()} onClick={submit}>Save to library</button>
        <button className="secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  )
}
