import type { AgentInfo, PlayerView, Seat } from '../types.ts'
import { celestialFor } from './Arcana.tsx'

// The proposed quest team, named in the right rail above the role card. Solves
// two gaps the on-card outline can't: it's a loud, readable "who's going?" (the
// felt ring is a quiet secondary echo), and it lists the viewer by name — so a
// player who has no card at the table (they sit at the footer edge) still sees
// themselves on the team. Team membership is public, so this renders for
// spectators too, just without a "you" highlight.
export function QuestParty({ view, bots }: {
  view: PlayerView
  bots: Record<number, AgentInfo>
}) {
  // Only meaningful while a team is being sought or run. Assassination/gameOver
  // have no team on the table — show nothing rather than a stale placeholder.
  const seeking = view.phase === 'discussion' || view.phase === 'proposal'
    || view.phase === 'finalize' || view.phase === 'vote'
  const onMission = view.phase === 'quest'
  if (!seeking && !onMission) return null

  const team: Seat[] = view.currentTeam ?? []
  const teamSize = view.quests[view.round - 1]?.teamSize
  const leaderName = view.players[view.leaderSeat]?.name ?? `seat ${view.leaderSeat}`
  const iLead = view.leaderSeat === view.seat
  const voting = view.phase === 'vote'

  return (
    <div className={`qparty${onMission ? ' mission' : ''}`}>
      <div className="qp-head">
        <span>{onMission ? 'On the mission' : 'On this quest'}</span>
        <span className="qp-count">
          {team.length ? <><b>{team.length}</b> of {teamSize}</> : <>needs {teamSize}</>}
        </span>
      </div>
      <div className="qp-body">
        {team.length === 0 ? (
          <div className="qp-empty">
            <span className="dots" aria-hidden="true">···</span>
            {iLead ? 'Name your team.' : `${leaderName} is naming the team.`}
          </div>
        ) : (
          <>
            {!onMission && (
              <p className="qp-status">
                Proposed by <b>{leaderName}</b>{voting ? ' · vote underway' : ''}
              </p>
            )}
            <ul className="qp-list">
              {team.map((s) => {
                const bot = bots[s]
                const name = view.players[s]?.name ?? `seat ${s}`
                const glyph = celestialFor(bot?.id, name).glyph
                const you = s === view.seat
                const leads = s === view.leaderSeat
                return (
                  <li
                    key={s}
                    className={`party-chip${you ? ' you' : ''}${leads ? ' leader' : ''}`}
                    style={{ ['--mc' as string]: bot?.color ?? 'var(--gold)' }}
                  >
                    <span className="pc-sig">{glyph}</span>
                    <span className="pc-nm">{name}</span>
                    {you ? <span className="pc-tag">You</span>
                      : leads ? <span className="pc-tag">Leader</span> : null}
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
