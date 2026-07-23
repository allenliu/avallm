import type { AgentInfo, PlayerView, Seat } from '../types.ts'

export function ModelBadge({ info }: { info: AgentInfo | undefined }) {
  if (!info) return null
  return (
    <span className="badge" style={{ background: info.color }} title={`${info.name} — ${info.model}`}>
      {info.monogram}
    </span>
  )
}

export function TableSeats({ view, bots, acting }: {
  view: PlayerView
  bots: Record<number, AgentInfo>
  acting: Seat[]
}) {
  const lastVoted = [...view.proposals].reverse().find((p) => p.votes)
  const votesVisible = view.phase !== 'vote' && lastVoted
  // Latest stated lean per seat for the proposal currently on the table.
  const leans = new Map<Seat, string>()
  if (view.currentTeam) {
    const lastProposalSeq = [...view.events].reverse().find((e) => e.type === 'proposal')?.seq ?? -1
    for (const ev of view.events) {
      if (ev.type === 'utterance' && ev.seq > lastProposalSeq && ev.payload.lean) {
        leans.set(ev.payload.seat, ev.payload.lean)
      }
    }
  }
  return (
    <div className="table-seats">
      {view.players.map((p) => {
        const isLeader = p.seat === view.leaderSeat
        const onTeam = view.currentTeam?.includes(p.seat)
        const isActing = acting.includes(p.seat)
        const lean = leans.get(p.seat)
        const vote = votesVisible ? lastVoted!.votes!.find((v) => v.seat === p.seat)?.vote : undefined
        return (
          <div key={p.seat} className={`seat${p.seat === view.seat ? ' me' : ''}${onTeam ? ' on-team' : ''}`}>
            <div className="seat-top">
              {isLeader && <span className="crown" title="Leader">♛</span>}
              <ModelBadge info={bots[p.seat]} />
              <span className="seat-name">{p.seat === view.seat ? 'You' : p.name}</span>
            </div>
            <div className="seat-bottom">
              {onTeam && <span className="chip team-chip" title="Proposed for the current quest (says nothing about loyalty)">on quest</span>}
              {lean && <span className={`chip lean-chip ${lean}`} title={`leaning ${lean}`}>
                {lean === 'approve' ? '👍' : lean === 'reject' ? '👎' : '🤔'}
              </span>}
              {vote && <span className={`chip vote-chip ${vote}`}>{vote === 'approve' ? 'Y' : 'N'}</span>}
              {isActing && <span className="thinking-dots" title="deciding…">●●●</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
