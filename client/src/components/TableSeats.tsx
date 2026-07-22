import type { PlayerView, Seat } from '../types.ts'
import { BADGES } from '../types.ts'

export function ModelBadge({ botId }: { botId: string | undefined }) {
  if (!botId) return null
  const b = BADGES[botId]
  if (!b) return null
  return <span className="badge" style={{ background: b.color }}>{b.monogram}</span>
}

export function TableSeats({ view, bots, acting }: {
  view: PlayerView
  bots: Record<number, string>
  acting: Seat[]
}) {
  const lastVoted = [...view.proposals].reverse().find((p) => p.votes)
  const votesVisible = view.phase !== 'vote' && lastVoted
  return (
    <div className="table-seats">
      {view.players.map((p) => {
        const isLeader = p.seat === view.leaderSeat
        const onTeam = view.currentTeam?.includes(p.seat)
        const isActing = acting.includes(p.seat)
        const vote = votesVisible ? lastVoted!.votes!.find((v) => v.seat === p.seat)?.vote : undefined
        return (
          <div key={p.seat} className={`seat${p.seat === view.seat ? ' me' : ''}${onTeam ? ' on-team' : ''}`}>
            <div className="seat-top">
              {isLeader && <span className="crown" title="Leader">♛</span>}
              <ModelBadge botId={bots[p.seat]} />
              <span className="seat-name">{p.name}</span>
            </div>
            <div className="seat-bottom">
              {onTeam && <span className="chip team-chip">team</span>}
              {vote && <span className={`chip vote-chip ${vote}`}>{vote === 'approve' ? 'Y' : 'N'}</span>}
              {isActing && <span className="thinking-dots" title="deciding…">●●●</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
