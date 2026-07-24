import { useState } from 'react'
import type { PlayerView } from '../types.ts'
import { ROLE_INFO } from '../setup.ts'
import type { Role } from '../setup.ts'
import { ARCANA, Emblem } from './Arcana.tsx'

export function RoleCard({ view }: { view: PlayerView }) {
  const [open, setOpen] = useState(true)
  const name = (s: number) => view.players[s]?.name ?? `seat ${s}`
  const info = view.privateInfo
  const arcana = ARCANA[view.role as Role]
  return (
    <div className={`role-card ${view.alignment}`}>
      <div className="rc-head">
        <span>Your secret</span>
        <button className="rc-toggle" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && (
        <div className="role-body">
          {arcana && <div className="rc-num">{arcana.numeral}</div>}
          {arcana && <Emblem id={arcana.emblem} className="rc-em" />}
          <div className="role-name">{arcana?.title ?? view.role.toUpperCase()}</div>
          <div className={`role-align ${view.alignment}`}>
            {ROLE_INFO[view.role as Role]?.name ?? view.role} · {view.alignment}
          </div>
          <p className="role-desc">{ROLE_INFO[view.role as Role]?.desc}</p>
          {info.knownEvil && info.knownEvil.length > 0 && (
            <p className="rc-know">You see evil: <b>{info.knownEvil.map(name).join(', ')}</b></p>
          )}
          {info.evilPartners && info.evilPartners.length > 0 && (
            <p className="rc-know">Fellow evil: <b>{info.evilPartners.map(name).join(', ')}</b></p>
          )}
          {view.alignment === 'evil' && (!info.evilPartners || info.evilPartners.length === 0) && (
            <p className="rc-know">You work alone; the other evil don't know you either.</p>
          )}
          {info.merlinCandidates && info.merlinCandidates.length > 0 && (
            <p className="rc-know">Merlin is one of: <b>{info.merlinCandidates.map(name).join(' / ')}</b></p>
          )}
          <p className="roles-in-play">In play: {view.rolesInPlay.join(', ')}</p>
        </div>
      )}
    </div>
  )
}
