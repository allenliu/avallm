import { Emblem, SPECTATOR_ARCANA } from './Arcana.tsx'

// The spectator's "Your card" — shown in place of the RoleCard when the viewer
// is watching rather than seated. Its own component so App and the screenshot
// gallery render the exact same markup (no hand-copied drift).
export function SpectatorCard() {
  return (
    <div className="role-card spectator">
      <div className="rc-head"><span>Your card</span></div>
      <div className="role-body">
        <div className="rc-num">{SPECTATOR_ARCANA.numeral}</div>
        <Emblem id={SPECTATOR_ARCANA.emblem} className="rc-em" />
        <div className="role-name">{SPECTATOR_ARCANA.title}</div>
        <div className="role-align spectator">Spectator · unaligned</div>
        <p className="role-desc">You see only public information — votes, quests, and table talk. Roles stay hidden until the game ends.</p>
      </div>
    </div>
  )
}
