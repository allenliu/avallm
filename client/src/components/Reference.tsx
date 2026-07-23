// In-game reference drawer: rules, roles in play, the table (agent cards),
// and game setup. One persistent place to answer "wait, what does Morgana
// do again?" mid-game.
import { useState } from 'react'
import type { AgentInfo, Library, PlayerView } from '../types.ts'
import { ROLE_INFO, RULES_SUMMARY } from '../setup.ts'
import type { Role } from '../setup.ts'
import { agentConfigText, tokenEstimate } from '../agentConfig.ts'
import { ModelBadge } from './TableSeats.tsx'

type Tab = 'rules' | 'roles' | 'table' | 'library' | 'setup'

export function Reference({ view, bots, library, onClose }: {
  view: PlayerView
  bots: Record<number, AgentInfo>
  library: Library | null
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('rules')
  const tabs: { id: Tab; label: string }[] = [
    { id: 'rules', label: 'Rules' },
    { id: 'roles', label: 'Roles in play' },
    { id: 'table', label: 'The table' },
    { id: 'library', label: 'Agent library' },
    { id: 'setup', label: 'Setup' },
  ]
  return (
    <div className="ref-overlay" onClick={onClose}>
      <div className="ref-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ref-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`secondary${tab === t.id ? ' active' : ''}`}
              onClick={() => setTab(t.id)}
            >{t.label}</button>
          ))}
          <button className="secondary ref-close" onClick={onClose}>✕</button>
        </div>
        {tab === 'rules' && (
          <ul className="rules-summary">
            {RULES_SUMMARY.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        )}
        {tab === 'roles' && <RolesTab view={view} />}
        {tab === 'table' && <TableTab view={view} bots={bots} />}
        {tab === 'library' && <LibraryTab library={library} />}
        {tab === 'setup' && <SetupTab view={view} />}
      </div>
    </div>
  )
}

function RolesTab({ view }: { view: PlayerView }) {
  const unique = [...new Set(view.rolesInPlay)] as Role[]
  const counts = new Map<string, number>()
  for (const r of view.rolesInPlay) counts.set(r, (counts.get(r) ?? 0) + 1)
  return (
    <div className="ref-list">
      {unique.map((r) => {
        const info = ROLE_INFO[r]
        if (!info) return null
        const n = counts.get(r)!
        return (
          <div key={r} className="ref-row">
            <span className={`role-toggle-name ${info.side}`}>
              {info.name}{n > 1 ? ` ×${n}` : ''}
            </span>
            <span className="role-toggle-desc">{info.desc}</span>
          </div>
        )
      })}
    </div>
  )
}

function TableTab({ view, bots }: { view: PlayerView; bots: Record<number, AgentInfo> }) {
  return (
    <div className="ref-list">
      {view.players.map((p) => {
        const info = bots[p.seat]
        if (!info) {
          return (
            <div key={p.seat} className="ref-row">
              <span className="role-toggle-name">{p.name}</span>
              <span className="role-toggle-desc">{p.seat === view.seat ? "That's you." : 'Human player.'}</span>
            </div>
          )
        }
        return (
          <div key={p.seat} className="ref-row">
            <span className="role-toggle-name agent-name">
              <ModelBadge info={info} />{info.name}
            </span>
            <span className="role-toggle-desc">
              {info.model}{info.version ? ` · v${info.version}` : ''}{info.author ? ` · by ${info.author}` : ''}
              {info.about ? ` — ${info.about}` : ''}
              {info.personality ? ` Persona: ${info.personality}` : ''}
              {info.tunedChars > 0 && ` · tuned (~${tokenEstimate(info.tunedChars)} tokens of custom strategy)`}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function LibraryTab({ library }: { library: Library | null }) {
  if (!library) return <p className="roles-preview">Library not loaded.</p>
  return (
    <div className="ref-list">
      {library.agents.map((a) => (
        <div key={a.id} className="ref-row lib-row">
          <span className="role-toggle-name agent-name">
            <ModelBadge info={a} />{a.name}
          </span>
          <span className="role-toggle-desc lib-desc">
            {a.model}{a.version ? ` · v${a.version}` : ''}{a.author ? ` · by ${a.author}` : ''}
            {a.custom ? ' · custom' : ''}
            {a.unavailable ? ` · unavailable (${a.unavailable})` : ''}
            {a.about ? ` — ${a.about}` : ''}
            {a.tunedChars > 0 && (
              <details className="prompt-details">
                <summary>prompt config (~{tokenEstimate(a.tunedChars)} tokens)</summary>
                <pre>{agentConfigText(a)}</pre>
              </details>
            )}
          </span>
        </div>
      ))}
      {library.baseline && (
        <div className="baseline-prompts">
          <p className="roles-preview">
            Every LLM agent runs on the same engine-owned baseline — personalities layer on top.
            The output format, hidden-information filtering, and injection guard are fixed and not
            part of any agent's config.
          </p>
          <details className="prompt-details">
            <summary>baseline rules digest (shared system prompt)</summary>
            <pre>{library.baseline.rulesDigest}</pre>
          </details>
          {Object.entries(library.baseline.roleGuidance).map(([role, text]) => (
            <details key={role} className="prompt-details">
              <summary>baseline guidance: {role}</summary>
              <pre>{text}</pre>
            </details>
          ))}
        </div>
      )}
    </div>
  )
}

function SetupTab({ view }: { view: PlayerView }) {
  const created = view.events.find((e) => e.type === 'gameCreated')?.payload
  const evil = view.rolesInPlay.filter((r) => ROLE_INFO[r as Role]?.side === 'evil').length
  return (
    <div className="ref-list">
      <div className="ref-row"><span className="role-toggle-name">Players</span>
        <span className="role-toggle-desc">{view.playerCount} ({view.playerCount - evil} good / {evil} evil)</span></div>
      <div className="ref-row"><span className="role-toggle-name">Quests</span>
        <span className="role-toggle-desc">
          {view.quests.map((q) => `${q.teamSize}${q.failsRequired === 2 ? '*' : ''}`).join(' · ')} (* needs 2 fails)
        </span></div>
      <div className="ref-row"><span className="role-toggle-name">Table talk</span>
        <span className="role-toggle-desc">
          {created?.talk
            ? `up to ${created.talk.preProposal} round(s) before a proposal, ${created.talk.postProposal} after; a silent round ends talk early`
            : '—'}
        </span></div>
      <div className="ref-row"><span className="role-toggle-name">Proposals</span>
        <span className="role-toggle-desc">up to 5 per quest — after 4 rejections the 5th ("hammer") team is locked in automatically, no vote</span></div>
    </div>
  )
}
