import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DecisionRequest, Library, LobbyPayload, RevealPayload, ServerPayload, TableSeat } from './types.ts'
import { EVIL_COUNT, PRESETS, ROLE_INFO, RULES_SUMMARY, buildRoles } from './setup.ts'
import type { PresetId, Role, SpecialSelection } from './setup.ts'
import { ActionBar } from './components/ActionBar.tsx'
import { ARCANA } from './components/Arcana.tsx'
import { Feed } from './components/Feed.tsx'
import { HistoryGrid } from './components/HistoryGrid.tsx'
import { QuestBoard } from './components/QuestBoard.tsx'
import { Reference } from './components/Reference.tsx'
import { Reveal } from './components/Reveal.tsx'
import { RoleCard } from './components/RoleCard.tsx'
import { ModelBadge, TableSeats } from './components/TableSeats.tsx'

const Brand = () => <>Ava<span className="llm">LLM</span></>

type Screen =
  | { name: 'landing' }
  | { name: 'join'; lobbyId: string }
  | { name: 'lobby'; lobbyId: string; token: string }
  | { name: 'game'; id: string; token: string }

const tokenKey = (lobbyId: string) => `avalon-token-${lobbyId}`
const gameTokenKey = (gameId: string) => `avalon-game-token-${gameId}`

function parseHash(): Screen {
  const g = window.location.hash.match(/^#\/game\/([a-z0-9]+)/)
  if (g) {
    const stored = localStorage.getItem(gameTokenKey(g[1]))
    // Without the seat token we can't reconnect to a private view; drop to landing.
    if (stored) return { name: 'game', id: g[1], token: stored }
    return { name: 'landing' }
  }
  const m = window.location.hash.match(/^#\/join\/([a-z0-9]+)/)
  if (m) {
    const stored = localStorage.getItem(tokenKey(m[1]))
    if (stored) return { name: 'lobby', lobbyId: m[1], token: stored }
    return { name: 'join', lobbyId: m[1] }
  }
  return { name: 'landing' }
}

export function App() {
  const [screen, setScreen] = useState<Screen>(parseHash)
  const [payload, setPayload] = useState<ServerPayload | null>(null)
  const [lobby, setLobby] = useState<LobbyPayload | null>(null)
  const [lobbyMissing, setLobbyMissing] = useState(false)
  const [reveal, setReveal] = useState<RevealPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [library, setLibrary] = useState<Library | null>(null)
  const [showRef, setShowRef] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const esRef = useRef<EventSource | null>(null)
  const lobbyEsRef = useRef<EventSource | null>(null)

  const refreshLibrary = useCallback(() => {
    fetch('/api/agents').then((r) => r.json()).then(setLibrary).catch(() => {})
  }, [])
  useEffect(refreshLibrary, [refreshLibrary])
  useEffect(() => () => { esRef.current?.close(); lobbyEsRef.current?.close() }, [])

  const openGame = useCallback((id: string, token: string) => {
    lobbyEsRef.current?.close()
    esRef.current?.close()
    setReveal(null)
    setPayload(null)
    // Persist the seat so a refresh reconnects instead of dumping to the lobby.
    // Solo games have no #/join/ URL, so the game id + token must live here too.
    localStorage.setItem(gameTokenKey(id), token)
    window.location.hash = `#/game/${id}`
    setScreen({ name: 'game', id, token })
    const es = new EventSource(`/api/game/${id}/events?token=${token}`)
    es.onmessage = (ev) => {
      setError(null) // EventSource auto-reconnects; a fresh payload means we're back
      setPayload(JSON.parse(ev.data))
    }
    // Don't try to distinguish "game gone" here: EventSource can't read the HTTP
    // status, and a page unload aborts the stream with readyState CLOSED too —
    // acting on that would wipe the stored seat on every refresh. A truly dead
    // game is caught by the fetch probe on the refresh-restore path instead.
    es.onerror = () => setError('connection lost — reconnecting…')
    esRef.current = es
  }, [])

  const enterLobby = useCallback((lobbyId: string, token: string) => {
    window.location.hash = `#/join/${lobbyId}`
    setScreen({ name: 'lobby', lobbyId, token })
    setLobbyMissing(false)
    lobbyEsRef.current?.close()
    const es = new EventSource(`/api/lobby/${lobbyId}/events`)
    es.onmessage = (ev) => {
      const data: LobbyPayload = JSON.parse(ev.data)
      setLobby(data)
      if (data.status === 'started' && data.gameId) openGame(data.gameId, token)
    }
    es.onerror = () => {
      // The server 404s the SSE for a lobby it doesn't know — never existed, or
      // wiped by a redeploy (games live in memory). Per the SSE spec an HTTP
      // error permanently fails the connection: readyState becomes CLOSED and
      // the browser will NOT reconnect, so surface the miss (otherwise the
      // screen is stuck on "Opening the lobby…", or freezes if we were seated).
      // A transient network drop instead leaves readyState at CONNECTING, where
      // EventSource retries on its own — leave that alone.
      if (es.readyState !== EventSource.CLOSED) return
      lobbyEsRef.current = null
      setLobbyMissing(true)
    }
    lobbyEsRef.current = es
  }, [openGame])

  // Entering via a stored-token lobby URL: resolve whether it already started.
  useEffect(() => {
    if (screen.name !== 'lobby' || lobbyEsRef.current) return
    enterLobby(screen.lobbyId, screen.token)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refresh landed on a #/game/ URL (solo or reconnecting player): reopen the stream.
  // Probe /valid first — EventSource hides the HTTP status, so a game that's gone
  // (server restarted) would otherwise spin forever on "reconnecting…". /valid is a
  // cheap JSON GET (no SSE listener to leak): 200 = live seat, 404/403 = dead.
  useEffect(() => {
    if (screen.name !== 'game' || esRef.current) return
    const { id, token } = screen
    const ctrl = new AbortController()
    fetch(`/api/game/${id}/valid?token=${token}`, { signal: ctrl.signal })
      .then((r) => {
        if (r.ok) {
          openGame(id, token)
        } else {
          // Server answered but the game/seat is gone — clear the stale pointer.
          localStorage.removeItem(gameTokenKey(id))
          window.location.hash = ''
          setError('that game is no longer available (the server may have restarted)')
          setScreen({ name: 'landing' })
        }
      })
      // Only a network-level failure (server unreachable) lands here — not a 404.
      // Open the stream and let EventSource retry until the server comes back.
      .catch((e) => { if (e.name !== 'AbortError') openGame(id, token) })
    return () => ctrl.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startGame = useCallback(async (opts: {
    players: number; humanSeats: number; table: TableSeat[]; roles: Role[] | null; humanName: string
    invite?: string
  }) => {
    setStarting(true)
    setError(null)
    try {
      if (opts.humanSeats <= 1) {
        const res = await fetch('/api/game/new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            playerCount: opts.players, table: opts.table, humanName: opts.humanName,
            invite: opts.invite,
            ...(opts.roles ? { roles: opts.roles } : {}),
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'failed to start game')
        openGame(data.id, data.token)
        setPayload(data)
      } else {
        const res = await fetch('/api/lobby', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: opts.humanName, playerCount: opts.players, humanSeats: opts.humanSeats,
            table: opts.table, invite: opts.invite,
            ...(opts.roles ? { roles: opts.roles } : {}),
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'failed to create lobby')
        localStorage.setItem(tokenKey(data.lobbyId), data.token)
        setLobby(data)
        enterLobby(data.lobbyId, data.token)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }, [openGame, enterLobby])

  const gameId = screen.name === 'game' ? screen.id : null
  const gameToken = screen.name === 'game' ? screen.token : null
  const gameOver = payload?.view.phase === 'gameOver'

  useEffect(() => {
    if (gameOver && gameId && !reveal) {
      fetch(`/api/game/${gameId}/reveal`).then((r) => r.json()).then(setReveal).catch(() => {})
    }
  }, [gameOver, gameId, reveal])

  const decide = useCallback(async (decision: Record<string, unknown>) => {
    if (!gameId || !gameToken) return
    setError(null)
    const res = await fetch(`/api/game/${gameId}/decide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: gameToken, decision }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'decision rejected')
    }
  }, [gameId, gameToken])

  const backToLanding = useCallback(() => {
    esRef.current?.close()
    lobbyEsRef.current?.close()
    // Drop the solo game's stored seat so leaving doesn't reconnect on refresh.
    if (screen.name === 'game') localStorage.removeItem(gameTokenKey(screen.id))
    window.location.hash = ''
    setPayload(null)
    setLobby(null)
    setLobbyMissing(false)
    setScreen({ name: 'landing' })
  }, [screen])

  if (screen.name === 'landing') {
    return (
      <div className="landing">
        <h1><Brand /></h1>
        <p className="subtitle">The Resistance: Avalon vs. the LLMs</p>
        <p className="tagline">
          Hidden roles, open models. Bluff DeepSeek, out-read Gemini — or invite
          friends and let the machines fill the empty chairs.
        </p>
        <Launcher onStart={startGame} starting={starting} library={library} onLibraryChange={refreshLibrary} />
        {error && <p className="error">{error}</p>}
      </div>
    )
  }

  if (screen.name === 'join') {
    return <JoinScreen
      lobbyId={screen.lobbyId}
      onJoined={(token, data) => {
        localStorage.setItem(tokenKey(screen.lobbyId), token)
        setLobby(data)
        if (data.status === 'started' && data.gameId) openGame(data.gameId, token)
        else enterLobby(screen.lobbyId, token)
      }}
      onBack={backToLanding}
    />
  }

  if (screen.name === 'lobby') {
    return <LobbyScreen lobby={lobby} missing={lobbyMissing} lobbyId={screen.lobbyId} token={screen.token} onBack={backToLanding} />
  }

  if (!payload) {
    return <div className="landing"><p className="tagline">Joining the table…</p></div>
  }

  const { view, ask, acting, bots } = payload
  const myAsk: DecisionRequest | undefined = ask[0]

  const roleTitle = payload.spectator
    ? 'Spectator'
    : `${ARCANA[view.role as Role]?.title ?? view.role} · ${view.alignment}`

  return (
    <div className="game">
      <header className="chrome">
        <h1 className="small"><Brand /></h1>
        <span className="chrome-spacer" />
        <span className="header-buttons">
          <button className="ghost" onClick={() => setShowHistory(true)}>Record</button>
          <button className="ghost" onClick={() => setShowRef(true)}>Codex</button>
        </span>
      </header>
      {showRef && <Reference view={view} bots={bots} library={library} onClose={() => setShowRef(false)} />}
      {showHistory && <HistoryGrid view={view} bots={bots} onClose={() => setShowHistory(false)} />}
      <div className="fartable">
        <div className="surface" />
        <div className="table-glow" />
        <TableSeats view={view} bots={bots} acting={acting} />
        <QuestBoard view={view} />
      </div>
      <main>
        <Feed view={view} bots={bots} degradedSeqs={payload.degradedSeqs} />
        <aside>
          {payload.spectator
            ? <div className="role-card"><div className="role-body">
                <div className="role-name">Spectator</div>
                <p className="role-desc">You see only public information — votes, quests, and table talk. Roles stay hidden until the game ends.</p>
              </div></div>
            : <RoleCard view={view} />}
          {!payload.spectator && !gameOver && (
            <NameEditor
              current={view.name}
              rename={async (name) => {
                const res = await fetch(`/api/game/${gameId}/rename`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token: gameToken, name }),
                })
                const data = await res.json().catch(() => ({}))
                if (!res.ok) throw new Error(data.error ?? 'rename failed')
                localStorage.setItem('avalon-name', data.name)
              }}
            />
          )}
          {payload.degraded > 0 && (
            <div className="degraded-note">{payload.degraded} bot decision{payload.degraded === 1 ? '' : 's'} fell back to autopilot</div>
          )}
        </aside>
      </main>
      <footer className={gameOver ? 'endstage' : 'youredge'}>
        {gameOver
          ? <Reveal view={view} reveal={reveal} bots={bots} onNewGame={backToLanding} />
          : (
            <div className="edge-inner">
              <div className="youchip" title={roleTitle}>
                <span className="you-sigil">{payload.spectator ? '👁' : view.name.slice(0, 2).toUpperCase()}</span>
                <span className="you-meta">
                  <span className="you-name">{payload.spectator ? 'Spectating' : view.name}</span>
                  <span className="you-role">{roleTitle} · your seat</span>
                </span>
              </div>
              {payload.spectator
                ? <div className="action-bar waiting">
                    Spectating{payload.waitingOn.length ? ` — waiting on ${payload.waitingOn.join(', ')}` : '…'}
                  </div>
                : <ActionBar view={view} ask={myAsk} onDecide={decide} waitingOn={payload.waitingOn} />}
            </div>
          )}
        {error && <p className="error">{error}</p>}
      </footer>
    </div>
  )
}

// A lobby the server doesn't know — never existed, or wiped by a redeploy.
// Shown from both entry paths: JoinScreen (no token) and LobbyScreen (token).
function LobbyMissing({ onBack }: { onBack: () => void }) {
  return (
    <div className="landing">
      <h1><Brand /></h1>
      <p className="tagline">That lobby doesn't exist (or the server restarted).</p>
      <button onClick={onBack}>Start your own game</button>
    </div>
  )
}

function JoinScreen({ lobbyId, onJoined, onBack }: {
  lobbyId: string
  onJoined: (token: string, data: LobbyPayload & { token: string }) => void
  onBack: () => void
}) {
  const [preview, setPreview] = useState<LobbyPayload | null>(null)
  const [missing, setMissing] = useState(false)
  const [name, setName] = useState(() => localStorage.getItem('avalon-name') ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/lobby/${lobbyId}/preview`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setPreview)
      .catch(() => setMissing(true))
  }, [lobbyId])

  const join = async (mode: 'play' | 'spectate') => {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/lobby/${lobbyId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, mode }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'failed to join')
      localStorage.setItem('avalon-name', name)
      onJoined(data.token, data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (missing) return <LobbyMissing onBack={onBack} />
  if (!preview) return <div className="landing"><p className="tagline">Finding the table…</p></div>

  const started = preview.status === 'started'
  return (
    <div className="landing">
      <h1><Brand /></h1>
      <p className="tagline">
        <b>{preview.hostName}</b> has a table for {preview.playerCount}: {preview.members.length}/{preview.humanSeats} humans
        {preview.table.length > 0 && <> + {preview.table.map((t) => t.name).join(', ')}</>}.
        {started ? ' The game is underway.' : preview.openSeats > 0 ? ` ${preview.openSeats} seat${preview.openSeats === 1 ? '' : 's'} open.` : ' All seats taken.'}
      </p>
      <div className="launcher">
        <label>
          Your name{' '}
          <input value={name} maxLength={24} placeholder="Player" onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="row">
          {!started && preview.openSeats > 0 && (
            <button disabled={busy} onClick={() => join('play')}>Take a seat</button>
          )}
          <button className="secondary" disabled={busy} onClick={() => join('spectate')}>Spectate</button>
        </div>
        {err && <p className="error">{err}</p>}
      </div>
    </div>
  )
}

function LobbyScreen({ lobby, missing, lobbyId, token, onBack }: {
  lobby: LobbyPayload | null
  missing: boolean
  lobbyId: string
  token: string
  onBack: () => void
}) {
  const [copied, setCopied] = useState(false)
  const joinUrl = `${window.location.origin}/#/join/${lobbyId}`
  if (missing) return <LobbyMissing onBack={onBack} />
  if (!lobby) return <div className="landing"><p className="tagline">Opening the lobby…</p></div>
  const waitingFor = lobby.humanSeats - lobby.members.length
  return (
    <div className="landing">
      <h1><Brand /></h1>
      <p className="tagline">
        The game starts automatically when {lobby.humanSeats} human{lobby.humanSeats === 1 ? '' : 's'} are seated.
        No turn timers — play it like mail chess.
      </p>
      <div className="launcher">
        <div className="join-url-row">
          <code className="join-url">{joinUrl}</code>
          <button className="secondary" onClick={() => {
            navigator.clipboard.writeText(joinUrl).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}>{copied ? 'Copied!' : 'Copy invite link'}</button>
        </div>
        <div className="table-picker">
          <span className="action-label">Seated ({lobby.members.length}/{lobby.humanSeats})</span>
          {lobby.members.map((m, i) => (
            <div key={i} className="table-picker-row"><span>{m}{i === 0 ? ' (host)' : ''}</span></div>
          ))}
          {waitingFor > 0 && (
            <p className="roles-preview">Waiting for {waitingFor} more player{waitingFor === 1 ? '' : 's'}…</p>
          )}
          {lobby.table.length > 0 && (
            <p className="roles-preview">
              Bots at this table: {lobby.table.map((t) => `${t.name} (${t.model})`).join(', ')}
            </p>
          )}
          {lobby.spectators > 0 && (
            <p className="roles-preview">{lobby.spectators} spectator{lobby.spectators === 1 ? '' : 's'} watching</p>
          )}
        </div>
        <NameEditor
          current={localStorage.getItem('avalon-name') ?? ''}
          rename={async (name) => {
            const res = await fetch(`/api/lobby/${lobbyId}/rename`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token, name }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error ?? 'rename failed')
            localStorage.setItem('avalon-name', data.name)
          }}
        />
        <button className="secondary" onClick={onBack}>Leave lobby</button>
      </div>
    </div>
  )
}

function NameEditor({ current, rename }: {
  current: string
  rename: (name: string) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!open) {
    return (
      <button className="secondary name-edit-toggle" onClick={() => { setName(current); setOpen(true) }}>
        Change name
      </button>
    )
  }
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      await rename(name)
      setOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="name-editor">
      <div className="row">
        <input
          value={name} maxLength={24} placeholder="New name" autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <button disabled={busy || !name.trim()} onClick={submit}>Save</button>
        <button className="secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  )
}

function defaultTable(library: Library | null, count: number): TableSeat[] {
  // The server's canonical default order (DEFAULT_TABLE) — the same one used
  // when no table is sent — so every path seats the same roster.
  const pool = (library?.defaultTable ?? [])
    .filter((id) => library?.agents.some((a) => a.id === id))
  if (pool.length === 0) {
    const llmAgents = library?.agents.filter((a) => a.model !== 'rule-based' && a.model !== 'external' && !a.custom) ?? []
    return Array.from({ length: count }, (_, i) =>
      ({ agent: llmAgents.length ? llmAgents[i % llmAgents.length].id : 'autopilot' }))
  }
  const extras = library!.agents
    .filter((a) => !pool.includes(a.id) && a.model !== 'rule-based' && a.model !== 'external' && !a.custom)
    .map((a) => a.id)
  const full = [...pool, ...extras]
  return Array.from({ length: count }, (_, i) => ({ agent: full[i % full.length] }))
}

function Launcher({ onStart, starting, library, onLibraryChange }: {
  onStart: (opts: {
    players: number; humanSeats: number; table: TableSeat[]; roles: Role[] | null; humanName: string
    invite?: string
  }) => void
  starting: boolean
  library: Library | null
  onLibraryChange: () => void
}) {
  const [players, setPlayers] = useState(7)
  const [humanSeats, setHumanSeats] = useState(1)
  const [table, setTable] = useState<TableSeat[]>([])
  const [humanName, setHumanName] = useState(() => localStorage.getItem('avalon-name') ?? '')
  const [invite, setInvite] = useState(() => localStorage.getItem('avalon-invite') ?? '')
  const [preset, setPreset] = useState<PresetId | 'custom'>('standard')
  const [sel, setSel] = useState<SpecialSelection>(PRESETS.standard.pick(7))
  const [showRules, setShowRules] = useState(false)

  const botCount = players - humanSeats

  // Fill the table once the library arrives; resize when players/humans change.
  useEffect(() => {
    if (!library) return
    setTable((t) => {
      const valid = t.filter((s) => library.agents.some((a) => a.id === s.agent))
      if (valid.length === botCount && t.length === botCount) return t
      if (valid.length === 0) return defaultTable(library, botCount)
      return Array.from({ length: botCount }, (_, i) => valid[i % Math.max(valid.length, 1)])
    })
  }, [botCount, library])

  const setPlayersAndRoles = (n: number) => {
    setPlayers(n)
    setHumanSeats((h) => Math.min(h, n))
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
        <label>
          Humans{' '}
          <select value={humanSeats} onChange={(e) => setHumanSeats(Number(e.target.value))}>
            {Array.from({ length: players }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n === 1 ? 'just me' : `${n} (invite link)`}</option>
            ))}
          </select>
        </label>
        {library?.gated && (
          <label>
            Invite code{' '}
            <input
              value={invite} maxLength={64} placeholder="required on this server"
              onChange={(e) => {
                setInvite(e.target.value)
                localStorage.setItem('avalon-invite', e.target.value)
              }}
            />
          </label>
        )}
      </div>
      {botCount > 0 && (
        <TablePicker
          library={library}
          table={table}
          onChange={setTable}
          onFill={(mode) => setTable(mode === 'models'
            ? defaultTable(library, botCount)
            : Array.from({ length: botCount }, () => ({ agent: 'autopilot' })))}
        />
      )}
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
        disabled={starting || !built.roles || table.length !== botCount}
        onClick={() => onStart({ players, humanSeats, table, roles: built.roles, humanName, invite: invite || undefined })}
      >
        {starting
          ? 'Setting the table…'
          : humanSeats > 1 ? 'Create lobby & get invite link' : 'Sit down at the table'}
      </button>
    </div>
  )
}

function TablePicker({ library, table, onChange, onFill }: {
  library: Library | null
  table: TableSeat[]
  onChange: (t: TableSeat[]) => void
  onFill: (mode: 'models' | 'autopilot') => void
}) {
  if (!library) return <p className="roles-preview">Loading agent library…</p>
  const agentById = (id: string) => library.agents.find((a) => a.id === id)
  const setSeat = (i: number, seat: TableSeat) => {
    const next = table.slice()
    next[i] = seat
    onChange(next)
  }
  return (
    <div className="table-picker">
      <div className="table-picker-head">
        <span className="action-label">Bot opponents</span>
        <span className="fill-buttons">
          fill with:{' '}
          <button className="secondary" onClick={() => onFill('models')}>LLM models</button>
          <button className="secondary" onClick={() => onFill('autopilot')}>Autopilot (free)</button>
        </span>
      </div>
      {table.map((seat, i) => {
        const info = agentById(seat.agent)
        const isLlm = info && info.model !== 'rule-based' && info.model !== 'external'
        return (
          <div key={i} className="table-picker-row">
            <ModelBadge info={info} />
            {/* Switching agents drops any model override — the new agent's own default applies. */}
            <select value={seat.agent} onChange={(e) => setSeat(i, { agent: e.target.value })}>
              {library.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.model}){a.custom ? ' — custom' : ''}
                </option>
              ))}
            </select>
            {isLlm && (
              <select
                value={seat.model ?? ''}
                onChange={(e) => setSeat(i, { agent: seat.agent, model: e.target.value || undefined })}
              >
                <option value="">default — {info.model}</option>
                {library.models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.tier})</option>
                ))}
              </select>
            )}
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
          model: model || undefined, // omitted = ride the seat/server default
          about: about || undefined,
          personality: personality || undefined,
          invite: localStorage.getItem('avalon-invite') || undefined,
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
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">no fixed model — plays the table default ({library.defaultModel ?? 'server pick'})</option>
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
