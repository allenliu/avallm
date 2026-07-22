// In-game reference drawer: rules, roles in play, the table (agent cards),
// and game setup. One persistent place to answer "wait, what does Morgana
// do again?" mid-game.
import { useState } from 'react'
import type { AgentInfo, PlayerView } from '../types.ts'
import { ROLE_INFO, RULES_SUMMARY } from '../setup.ts'
import type { Role } from '../setup.ts'
import { ModelBadge } from './TableSeats.tsx'

type Tab = 'rules' | 'roles' | 'table' | 'setup'

export function Reference({ view, bots, onClose }: {
  view: PlayerView
  bots: Record<number, AgentInfo>
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('rules')
  const tabs: { id: Tab; label: string }[] = [
    { id: 'rules', label: 'Rules' },
    { id: 'roles', label: 'Roles in play' },
    { id: 'table', label: 'The table' },
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
              <span className="role-toggle-desc">That's you.</span>
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
            </span>
          </div>
        )
      })}
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
        <span className="role-toggle-desc">5 per quest — the 5th ("hammer") ends the game for evil if rejected</span></div>
    </div>
  )
}
