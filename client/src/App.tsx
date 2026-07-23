import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AgentInfo, DecisionRequest, Library, LobbyPayload, PreviewResponse, RevealPayload, ServerPayload, TableSeat } from './types.ts'
import { tokenEstimate as tokenEst } from './agentConfig.ts'
import { EVIL_COUNT, PRESETS, ROLE_INFO, RULES_SUMMARY, buildRoles } from './setup.ts'
import type { PresetId, Role, SpecialSelection } from './setup.ts'
import { ActionBar } from './components/ActionBar.tsx'
import { ARCANA, Emblem, HUMAN_CELESTIAL, SPECTATOR_ARCANA } from './components/Arcana.tsx'
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
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle')
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

  // Copy a debug transcript of the current game to the clipboard. The server
  // decides fidelity (full reveal when the game is over or you're solo-vs-bots,
  // else scoped to your own view) — see GET /api/game/:id/transcript.
  const copyLog = useCallback(async () => {
    if (!gameId) return
    try {
      const res = await fetch(`/api/game/${gameId}/transcript?token=${encodeURIComponent(gameToken ?? '')}`)
      if (!res.ok) throw new Error('transcript unavailable')
      await navigator.clipboard.writeText(await res.text())
      setCopyState('ok')
      setTimeout(() => setCopyState('idle'), 1500)
    } catch (e) {
      // The button label carries the failure too, since the footer's error line
      // is hidden on the end-game Reveal screen.
      setCopyState('err')
      setTimeout(() => setCopyState('idle'), 2500)
      setError(e instanceof Error ? e.message : 'could not copy transcript')
    }
  }, [gameId, gameToken])

  const copyLabel = copyState === 'ok' ? 'Copied!' : copyState === 'err' ? 'Copy failed' : 'Copy log'

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
      <div className="landing-page">
        <div className="hero">
          <h1><Brand /></h1>
          <p className="subtitle">The Resistance: Avalon, played against a table of LLMs</p>
          <p className="tagline">
            Hidden roles, open models. Bluff DeepSeek, out-read Gemini, or invite
            friends and let the machines fill the empty chairs.
          </p>
        </div>
        <Launcher onStart={startGame} starting={starting} library={library} onLibraryChange={refreshLibrary} />
        {error && <p className="error center">{error}</p>}
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
    ? SPECTATOR_ARCANA.title
    : `${ARCANA[view.role as Role]?.title ?? view.role} · ${view.alignment}`

  return (
    <div className="game">
      <header className="chrome">
        <h1 className="small"><Brand /></h1>
        <span className="chrome-spacer" />
        <span className="header-buttons">
          <button className="ghost" onClick={() => setShowHistory(true)}>Record</button>
          <button className="ghost" onClick={() => setShowRef(true)}>Codex</button>
          <button className="ghost" onClick={copyLog} title="Copy a debug transcript of this game to the clipboard">{copyLabel}</button>
        </span>
      </header>
      {showRef && <Reference view={view} bots={bots} library={library} onClose={() => setShowRef(false)} />}
      {showHistory && <HistoryGrid view={view} bots={bots} onClose={() => setShowHistory(false)} />}
      <div className="fartable">
        <div className="orbit" />
        <div className="orbit o2" />
        <div className="mote" />
        <span className="tw" style={{ left: '16%', top: '30%' }} />
        <span className="tw" style={{ left: '42%', top: '12%', animationDelay: '1.4s' }} />
        <span className="tw" style={{ left: '70%', top: '38%', animationDelay: '2.3s' }} />
        <span className="tw" style={{ left: '88%', top: '12%', animationDelay: '3.2s' }} />
        <TableSeats view={view} bots={bots} acting={acting} />
        <QuestBoard view={view} />
      </div>
      {gameOver ? (
        <main className="reveal-main">
          <Reveal view={view} reveal={reveal} bots={bots} onNewGame={backToLanding} onCopyLog={copyLog} copyLabel={copyLabel} />
        </main>
      ) : (
      <main>
        <Feed view={view} bots={bots} acting={acting} waitingOn={payload.waitingOn} degradedSeqs={payload.degradedSeqs} />
        <aside>
          {payload.spectator
            ? <div className="role-card spectator">
                <div className="rc-head"><span>Your card</span></div>
                <div className="role-body">
                  <div className="rc-num">{SPECTATOR_ARCANA.numeral}</div>
                  <Emblem id={SPECTATOR_ARCANA.emblem} className="rc-em" />
                  <div className="role-name">{SPECTATOR_ARCANA.title}</div>
                  <div className="role-align spectator">Spectator · unaligned</div>
                  <p className="role-desc">You see only public information — votes, quests, and table talk. Roles stay hidden until the game ends.</p>
                </div>
              </div>
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
      )}
      {!gameOver && (
      <footer className={`youredge${myAsk && !payload.spectator ? ' waits' : ''}`}>
        <div className="edge-inner">
          <div className="youchip" title={payload.spectator ? roleTitle : `${roleTitle} — you are ⊕ Earth at this table`}>
            <span className="you-sigil">{payload.spectator ? '◎' : HUMAN_CELESTIAL.glyph}</span>
          <span className="you-meta">
              <span className="you-name">{payload.spectator ? 'Spectating' : view.name}</span>
              <span className="you-role">{payload.spectator ? 'public information only' : `${roleTitle} · your seat`}</span>
            </span>
          </div>
          {payload.spectator
            ? <div className="action-bar waiting">
                Spectating{payload.waitingOn.length ? ` — waiting on ${payload.waitingOn.join(', ')}` : '…'}
              </div>
            : <ActionBar view={view} ask={myAsk} onDecide={decide} waitingOn={payload.waitingOn} />}
        </div>
        {error && <p className="error">{error}</p>}
      </footer>
      )}
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

// The five quests dealt as a tarot spread: each card wears a fixed celestial
// sigil (crescent, sun, star, eye, wheel) with its quest order as a corner
// numeral. Decorative — the authoritative team sizes live in the game board.
const QUEST_NUMERALS = ['I', 'II', 'III', 'IV', 'V']
const QUEST_SIGILS = [
  <svg viewBox="0 0 30 30" className="qsig" key="moon"><path d="M20 6a10 10 0 1 0 0 18 8 8 0 0 1 0-18z" /></svg>,
  <svg viewBox="0 0 30 30" className="qsig" key="sun"><circle cx="15" cy="15" r="5" /><path d="M15 2v4M15 24v4M2 15h4M24 15h4M6 6l3 3M21 21l3 3M24 6l-3 3M9 21l-3 3" /></svg>,
  <svg viewBox="0 0 30 30" className="qsig" key="star"><path d="M15 3l2.5 9.5L27 15l-9.5 2.5L15 27l-2.5-9.5L3 15l9.5-2.5z" /></svg>,
  <svg viewBox="0 0 30 30" className="qsig" key="eye"><path d="M2 15q6-9 13-9t13 9q-6 9-13 9T2 15z" /><circle className="fill" cx="15" cy="15" r="3" /></svg>,
  <svg viewBox="0 0 30 30" className="qsig" key="wheel"><circle cx="15" cy="15" r="10" /><path d="M15 5v20M5 15h20M8 8l14 14M22 8L8 22" /></svg>,
]

function Launcher({ onStart, starting, library, onLibraryChange }: {
  onStart: (opts: {
    players: number; humanSeats: number; table: TableSeat[]; roles: Role[] | null; humanName: string
    invite?: string
  }) => void
  starting: boolean
  library: Library | null
  onLibraryChange: () => void
}) {
  const [players, setPlayers] = useState(5)
  const [humanSeats, setHumanSeats] = useState(1)
  const [table, setTable] = useState<TableSeat[]>([])
  const [humanName, setHumanName] = useState(() => localStorage.getItem('avalon-name') ?? '')
  const [invite, setInvite] = useState(() => localStorage.getItem('avalon-invite') ?? '')
  const [preset, setPreset] = useState<PresetId | 'custom'>('standard')
  const [sel, setSel] = useState<SpecialSelection>(PRESETS.standard.pick(5))
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

  const goodRoles = built.roles?.filter((r) => ROLE_INFO[r].side === 'good') ?? []
  const evilRoles = built.roles?.filter((r) => ROLE_INFO[r].side === 'evil') ?? []
  const rollup = (rs: Role[]) => {
    const counts = new Map<Role, number>()
    for (const r of rs) counts.set(r, (counts.get(r) ?? 0) + 1)
    return [...counts].map(([r, n]) => `${ROLE_INFO[r].name}${n > 1 ? ` ×${n}` : ''}`).join(' · ')
  }

  return (
    <div className="launcher-arcane">
      <div className="deal" aria-hidden="true">
        {QUEST_NUMERALS.map((num, i) => (
          <div key={i} className="dcard">
            <span className="qidx">{num}</span>
            {QUEST_SIGILS[i]}
          </div>
        ))}
      </div>
      <div className="center-row">
        <button className="ghost rules-toggle" onClick={() => setShowRules(!showRules)}>
          {showRules ? 'Hide the rules' : 'How do you play Avalon?'}
        </button>
      </div>
      {showRules && (
        <ul className="rules-summary wide">
          {RULES_SUMMARY.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
      <div className="setup-grid">
        <div className="setup-col">
          <section className="card-panel">
            <h2><span className="n">I</span>The Table</h2>
            <div className="body">
              <div className="frow">
                <label className="field">Your name
                  <input
                    value={humanName} maxLength={24} placeholder="You"
                    onChange={(e) => {
                      setHumanName(e.target.value)
                      localStorage.setItem('avalon-name', e.target.value)
                    }}
                  />
                </label>
                <label className="field wide">Players
                  <select value={players} onChange={(e) => setPlayersAndRoles(Number(e.target.value))}>
                    {[5, 6, 7, 8, 9].map((n) => (
                      <option key={n} value={n}>{n} players · {n - EVIL_COUNT[n]} good / {EVIL_COUNT[n]} evil</option>
                    ))}
                  </select>
                </label>
                <label className="field">Humans
                  <select value={humanSeats} onChange={(e) => setHumanSeats(Number(e.target.value))}>
                    {Array.from({ length: players }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n === 1 ? 'just me' : `${n} · invite link`}</option>
                    ))}
                  </select>
                </label>
                {library?.gated && (
                  <label className="field">Invite code
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
            </div>
          </section>
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
          <AgentStudio library={library} onChanged={onLibraryChange} />
        </div>
        <div className="setup-col">
          <section className="card-panel">
            <h2><span className="n">III</span>The Roles</h2>
            <div className="body">
              <div className="presets">
                {(Object.keys(PRESETS) as PresetId[]).map((p) => (
                  <button
                    key={p}
                    className={`preset${preset === p ? ' active' : ''}`}
                    title={PRESETS[p].blurb}
                    onClick={() => applyPreset(p)}
                  >{PRESETS[p].label}</button>
                ))}
              </div>
              {preset === 'custom' && <p className="preset-custom">custom selection</p>}
              <div className="gem-roles">
                {toggles.map((t) => {
                  const side = ROLE_INFO[t.roles[0]].side
                  return (
                    <label key={t.key} className={`gem-role ${side}${sel[t.key] ? ' checked' : ''}`}>
                      <input
                        type="checkbox"
                        className="visually-hidden"
                        checked={sel[t.key]}
                        onChange={() => toggle(t.key)}
                      />
                      <span className={`gembox ${side}`} />
                      <span>
                        <span className={`gr-name ${side}`}>{t.label}</span>{' '}
                        <span className="gr-desc">{t.roles.map((r) => ROLE_INFO[r].desc).join(' ')}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
              <p className="role-fill-note">
                Remaining seats are filled with Loyal Servants (good, no knowledge) and
                Minions (evil, know each other). {evil} of {players} players are evil.
              </p>
              {built.error && <p className="error">{built.error}</p>}
              {built.warning && <p className="warning">{built.warning}</p>}
            </div>
          </section>
        </div>
      </div>
      <div className="cta-rail">
        <div className="cta-inner">
          {built.roles && (
            <span className="inplay">
              <b>In play:</b>{' '}
              <span className="good">{rollup(goodRoles)}</span>
              {' · '}
              <span className="evil">{rollup(evilRoles)}</span>
            </span>
          )}
          <span className="cta-spacer" />
          <button
            className="cta"
            disabled={starting || !built.roles || table.length !== botCount}
            onClick={() => onStart({ players, humanSeats, table, roles: built.roles, humanName, invite: invite || undefined })}
          >
            {starting
              ? 'Setting the table…'
              : humanSeats > 1 ? 'Create lobby & get invite link' : 'Sit down at the table'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TablePicker({ library, table, onChange, onFill }: {
  library: Library | null
  table: TableSeat[]
  onChange: (t: TableSeat[]) => void
  onFill: (mode: 'models' | 'autopilot') => void
}) {
  const [showModels, setShowModels] = useState(false)
  if (!library) return <p className="roles-preview">Loading agent library…</p>
  const agentById = (id: string) => library.agents.find((a) => a.id === id)
  const setSeat = (i: number, seat: TableSeat) => {
    const next = table.slice()
    next[i] = seat
    onChange(next)
  }
  const seatIsLlm = (s: TableSeat) => {
    const a = agentById(s.agent)
    return !!a && a.model !== 'rule-based' && a.model !== 'external'
  }
  // Per-seat model overrides are power-user plumbing — for a built-in model agent
  // the agent already names its model, so the second dropdown is noise. Hide it by
  // default; reveal on request, or force it open when a seat already carries an
  // override or names an unavailable agent (whose dead default the server rejects).
  const forced = table.some((s) => s.model || agentById(s.agent)?.unavailable)
  const showOverrides = showModels || forced
  // Only an LLM seat can take a model override, so the toggle is dead weight when
  // the whole table is autopilot/external.
  const anyLlm = table.some(seatIsLlm)
  return (
    <section className="card-panel">
      <h2>
        <span className="n">II</span>The Seats
        <span className="fill-buttons">
          fill with{' '}
          <button className="fill-btn" onClick={() => onFill('models')}>LLMs</button>
          <button className="fill-btn" onClick={() => onFill('autopilot')}>Autopilot (free)</button>
        </span>
      </h2>
      <div className="body">
        {table.map((seat, i) => {
          const info = agentById(seat.agent)
          const isLlm = seatIsLlm(seat)
          return (
            <div key={i} className="seatrow" style={{ ['--mc' as string]: info?.color ?? 'var(--line)' }}>
              <span className="mini">{info?.monogram ?? '?'}</span>
              {/* Switching agents drops any model override — the new agent's own
                  default applies. An UNAVAILABLE agent (stale model suggestion)
                  stays selectable: the server's cure is a seat model override,
                  so selecting one auto-picks a model instead of blocking it. */}
              <select
                value={seat.agent}
                title={info?.model}
                onChange={(e) => {
                  const next = library.agents.find((a) => a.id === e.target.value)
                  setSeat(i, next?.unavailable
                    ? { agent: e.target.value, model: library.defaultModel ?? library.models[0]?.id }
                    : { agent: e.target.value })
                }}
              >
                {library.agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} — {a.model.includes('/') ? a.model.split('/')[1] : a.model}{a.custom ? ' (custom)' : ''}{a.unavailable ? ' — pick a model' : ''}
                  </option>
                ))}
              </select>
              {showOverrides && isLlm && (
                <select
                  className="model-override"
                  value={seat.model ?? ''}
                  onChange={(e) => setSeat(i, { agent: seat.agent, model: e.target.value || undefined })}
                  title="Model this seat runs on"
                >
                  {/* No "default" option for unavailable agents — their default
                      is the dead model the server would reject. */}
                  {!info.unavailable && <option value="">default — {info.model}</option>}
                  {library.models.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.tier})</option>
                  ))}
                </select>
              )}
            </div>
          )
        })}
        {!forced && anyLlm && (
          <button
            type="button"
            className="seat-advanced"
            aria-expanded={showModels}
            onClick={() => setShowModels((v) => !v)}
          >
            {showModels ? 'Hide per-seat models' : 'Choose per-seat models'}
          </button>
        )}
      </div>
    </section>
  )
}

// Agent Studio (design doc §8): create AND edit custom agents, with the full
// prompt-layer surface (strategy, per-role, per-kind, temperature) and a free
// server-rendered prompt preview against a fixture game.
function AgentStudio({ library, onChanged }: { library: Library | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<AgentInfo | null>(null)
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [about, setAbout] = useState('')
  const [personality, setPersonality] = useState('')
  const [strategy, setStrategy] = useState('')
  const [temp, setTemp] = useState('')                  // '' = per-kind defaults
  const [roleG, setRoleG] = useState<Record<string, string>>({})
  const [roleGMode, setRoleGMode] = useState<'replace' | 'append'>('replace')
  const [kindG, setKindG] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [pvRole, setPvRole] = useState('servant')
  const [pvKind, setPvKind] = useState('discuss')
  const [preview, setPreview] = useState<PreviewResponse | null>(null)
  if (!library) return null

  const roles = Object.keys(library.baseline?.roleGuidance ?? {})
  const kinds = library.baseline?.kinds ?? []
  const invite = () => localStorage.getItem('avalon-invite') || undefined
  const tunedChars = strategy.length + personality.length
    + Object.values(roleG).reduce((n, t) => n + t.length, 0)
    + Object.values(kindG).reduce((n, t) => n + t.length, 0)

  const draftBody = () => ({
    name,
    // Always send the key: '' means CLEAR the model suggestion. `|| undefined`
    // would be dropped by JSON.stringify, and PUT keeps absent fields — making
    // "no fixed model" silently keep the old pin.
    model,
    about,
    personality,
    strategy,
    roleGuidance: roleG,
    roleGuidanceMode: roleGMode,
    kindGuidance: kindG,
    temperature: temp === '' ? null : Number(temp),
    invite: invite(),
  })

  const reset = () => {
    setName(''); setModel(''); setAbout(''); setPersonality(''); setStrategy('')
    setTemp(''); setRoleG({}); setRoleGMode('replace'); setKindG({}); setErr(null); setPreview(null)
  }
  const startCreate = () => { reset(); setEditing(null); setOpen(true) }
  const startEdit = (a: AgentInfo) => {
    reset()
    setEditing(a)
    setName(a.name); setAbout(a.about ?? ''); setPersonality(a.personality ?? '')
    setStrategy(a.strategy ?? '')
    setTemp(a.temperature !== undefined ? String(a.temperature) : '')
    setRoleG({ ...(a.roleGuidance ?? {}) })
    setRoleGMode(a.roleGuidanceMode ?? 'replace')
    setKindG({ ...(a.kindGuidance ?? {}) })
    // The raw suggestion, NOT a.model — that is the resolved display slug, and
    // pinning it here would silently turn "no fixed model" into a fixed one.
    // A suggestion that left the roster seeds as '' (= clear on save): keeping
    // the dead id would make EVERY save 400 with "unknown model".
    setModel(library.models.some((m) => m.id === a.suggestedModel) ? a.suggestedModel! : '')
    setOpen(true)
  }

  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(editing ? `/api/agents/${editing.id}` : '/api/agents', {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftBody()),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'failed to save agent')
      setOpen(false)
      reset()
      onChanged()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const del = async (a: AgentInfo) => {
    if (!window.confirm(`Delete "${a.name}" from the library? Finished games keep their record of it.`)) return
    try {
      const res = await fetch(`/api/agents/${a.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invite: invite() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'failed to delete agent')
      onChanged()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e))
    }
  }

  const runPreview = async () => {
    setErr(null)
    try {
      const res = await fetch('/api/agents/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...draftBody(), role: pvRole, kind: pvKind }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'preview failed')
      setPreview(data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const guidanceEditor = (
    keys: string[], values: Record<string, string>,
    setValues: (v: Record<string, string>) => void,
    baseline: Record<string, string> | undefined, placeholder: (k: string) => string,
  ) => keys.map((k) => (
    <label key={k} className="guidance-row">
      <span className="guidance-key">
        {k}
        {values[k] && baseline?.[k] !== undefined && (
          <button
            className="secondary guidance-revert"
            title="Revert to the baseline guidance"
            onClick={() => {
              const next = { ...values }
              delete next[k]
              setValues(next)
            }}
          >revert</button>
        )}
      </span>
      <textarea
        value={values[k] ?? ''} maxLength={2000} rows={2}
        placeholder={placeholder(k)}
        onChange={(e) => setValues({ ...values, [k]: e.target.value })}
      />
    </label>
  ))

  if (!open) {
    const customs = library.agents.filter((a) => a.custom)
    return (
      <div className="agent-studio-closed">
        <button className="addagent" onClick={startCreate}>+ Inscribe your own agent</button>
        {customs.map((a) => (
          <div key={a.id} className={`custom-agent-row${a.unavailable ? ' unavailable' : ''}`}>
            <ModelBadge info={a} />
            <span className="custom-agent-name">
              {a.name} v{a.version ?? 1}
              {a.tunedChars > 0 && <span className="tuned-note"> · tuned (~{tokenEst(a.tunedChars)} tokens)</span>}
              {a.unavailable && <span className="error"> — {a.unavailable}</span>}
            </span>
            <button className="secondary" onClick={() => startEdit(a)}>edit</button>
            <button className="secondary" onClick={() => del(a)}>delete</button>
          </div>
        ))}
        {(library.problems ?? []).map((p) => (
          <p key={p.file} className="warning">agent file {p.file}: {p.reason}</p>
        ))}
      </div>
    )
  }

  return (
    <div className="add-agent agent-studio card-panel">
      <div className="body add-agent-body">
      <p className="action-label">{editing ? `Editing ${editing.name} (saves as v${(editing.version ?? 1) + 1})` : 'New agent'}</p>
      <div className="row">
        <input value={name} maxLength={40} placeholder="Agent name" onChange={(e) => setName(e.target.value)} />
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="">no fixed model — plays the table default ({library.defaultModel ?? 'server pick'})</option>
          {library.models.map((m) => <option key={m.id} value={m.id}>{m.slug} ({m.tier})</option>)}
        </select>
      </div>
      <input value={about} maxLength={300} placeholder="About (shown in the library)" onChange={(e) => setAbout(e.target.value)} />
      <textarea
        value={personality} maxLength={2000} rows={2}
        placeholder="Personality — the table persona (e.g. 'Theatrical and paranoid. Accuse early, defend loudly.')"
        onChange={(e) => setPersonality(e.target.value)}
      />
      <textarea
        value={strategy} maxLength={2000} rows={3}
        placeholder="Strategy — always-on doctrine, any role (e.g. 'Track who approves failed teams across the whole vote record; treat early reject-storms as evil coordination.')"
        onChange={(e) => setStrategy(e.target.value)}
      />
      <details className="prompt-details">
        <summary>Per-role strategy overrides ({Object.values(roleG).filter(Boolean).length} set)</summary>
        <label className="temp-row">
          Mode{' '}
          <select value={roleGMode} onChange={(e) => setRoleGMode(e.target.value as 'replace' | 'append')}>
            <option value="replace">replace the baseline guidance</option>
            <option value="append">append under the baseline (rides baseline improvements)</option>
          </select>
        </label>
        <p className="roles-preview">
          {roleGMode === 'replace'
            ? 'Your text replaces the baseline guidance for that role. Leave blank to keep the baseline (shown as placeholder).'
            : 'Your text is added below the baseline guidance for that role, so the agent keeps riding baseline improvements.'}
        </p>
        {guidanceEditor(roles, roleG, setRoleG, library.baseline?.roleGuidance,
          (r) => library.baseline?.roleGuidance[r] ?? '')}
      </details>
      <details className="prompt-details">
        <summary>Per-decision guidance ({Object.values(kindG).filter(Boolean).length} set)</summary>
        <p className="roles-preview">
          Extra coaching for one decision type. The <b>reflect</b> slot shapes the agent's private
          notes — a custom memory strategy.
        </p>
        {guidanceEditor(kinds, kindG, setKindG, undefined,
          (k) => `e.g. ${k === 'assassinate' ? 'Rank seats by vote-correctness; shoot the most correct.' : k === 'reflect' ? 'Note each player: trust 0-10, one reason, one prediction.' : `guidance applied only to ${k} calls`}`)}
      </details>
      <label className="temp-row">
        Temperature{' '}
        <select value={temp} onChange={(e) => setTemp(e.target.value)}>
          <option value="">per-decision defaults</option>
          {[0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1].map((t) => (
            <option key={t} value={String(t)}>{t}</option>
          ))}
        </select>
      </label>
      <p className="roles-preview">
        Custom text: {tunedChars.toLocaleString()} / {(library.baseline?.caps?.aggregate ?? 10_000).toLocaleString()} chars
        (~{tokenEst(tunedChars)} tokens added to every call this agent makes).
      </p>
      <details className="prompt-details" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !preview) void runPreview() }}>
        <summary>Preview the exact prompt (free — no model call)</summary>
        <div className="row">
          <label>as{' '}
            <select value={pvRole} onChange={(e) => setPvRole(e.target.value)}>
              {/* previewRoles = roles actually in the server's fixture game;
                  the full role list would offer options that can only 400. */}
              {(preview?.rolesInPlay ?? library.baseline?.previewRoles ?? roles).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label>deciding{' '}
            <select value={pvKind} onChange={(e) => setPvKind(e.target.value)}>
              {(preview?.kinds ?? kinds).map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </label>
          <button className="secondary" onClick={runPreview}>Render</button>
          {preview && <span className="roles-preview">~{preview.tokenEstimate} tokens</span>}
        </div>
        {preview && (
          <pre className="preview-pane">
            {preview.messages.map((m) => `── ${m.role.toUpperCase()} ──\n${m.content}`).join('\n\n')}
          </pre>
        )}
      </details>
      <div className="row">
        <button disabled={busy || !name.trim()} onClick={submit}>
          {editing ? 'Save changes' : 'Save to library'}
        </button>
        <button className="secondary" onClick={() => { setOpen(false); reset() }}>Cancel</button>
      </div>
      {err && <p className="error">{err}</p>}
      </div>
    </div>
  )
}
