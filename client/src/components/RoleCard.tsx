import { useState } from 'react'
import type { PlayerView } from '../types.ts'

export function RoleCard({ view }: { view: PlayerView }) {
  const [open, setOpen] = useState(true)
  const name = (s: number) => view.players[s]?.name ?? `seat ${s}`
  const info = view.privateInfo
  return (
    <div className={`role-card ${view.alignment}`}>
      <button className="role-toggle" onClick={() => setOpen(!open)}>
        {open ? 'Hide role' : 'Show role'}
      </button>
      {open && (
        <div className="role-body">
          <div className="role-name">{view.role.toUpperCase()}</div>
          <div className={`role-align ${view.alignment}`}>{view.alignment}</div>
          {info.knownEvil && info.knownEvil.length > 0 && (
            <p>You see evil: <b>{info.knownEvil.map(name).join(', ')}</b></p>
          )}
          {info.evilPartners && info.evilPartners.length > 0 && (
            <p>Fellow evil: <b>{info.evilPartners.map(name).join(', ')}</b></p>
          )}
          {view.alignment === 'evil' && (!info.evilPartners || info.evilPartners.length === 0) && (
            <p>You work alone — the other evil don't know you either.</p>
          )}
          {info.merlinCandidates && info.merlinCandidates.length > 0 && (
            <p>Merlin is one of: <b>{info.merlinCandidates.map(name).join(' / ')}</b></p>
          )}
          <p className="roles-in-play">In play: {view.rolesInPlay.join(', ')}</p>
        </div>
      )}
    </div>
  )
}
