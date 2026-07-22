// The vote-history grid — the game's public record as one table.
// Rows = players; columns = proposals grouped by quest. Shows per proposal:
// who led (♛), who was on the team (shaded), and how everyone voted.
// This is core deduction UI: the vote matrix is the game's primary text.
import type { AgentInfo, PlayerView, ProposalRecord, Seat } from '../types.ts'
import { ModelBadge } from './TableSeats.tsx'

export function HistoryGrid({ view, bots, onClose }: {
  view: PlayerView
  bots: Record<number, AgentInfo>
  onClose: () => void
}) {
  const rounds: { round: number; proposals: ProposalRecord[] }[] = []
  for (const p of view.proposals) {
    const g = rounds.find((r) => r.round === p.round)
    if (g) g.proposals.push(p)
    else rounds.push({ round: p.round, proposals: [p] })
  }

  const questHeader = (round: number) => {
    const q = view.quests[round - 1]
    if (q.result === 'success') return { text: `Quest ${round} ✓`, cls: 'ok' }
    if (q.result === 'fail') return { text: `Quest ${round} ✗ (${q.failCount} fail${q.failCount === 1 ? '' : 's'})`, cls: 'bad' }
    return { text: `Quest ${round} — team of ${q.teamSize}${q.failsRequired === 2 ? ', 2 fails to sink' : ''}`, cls: 'pending' }
  }

  return (
    <div className="ref-overlay" onClick={onClose}>
      <div className="ref-panel history-panel" onClick={(e) => e.stopPropagation()}>
        <div className="ref-tabs">
          <span className="action-label">Game record</span>
          <button className="secondary ref-close" onClick={onClose}>✕</button>
        </div>
        {rounds.length === 0 ? (
          <p className="roles-preview">No proposals yet.</p>
        ) : (
          <div className="history-scroll">
            <table className="history-grid">
              <thead>
                <tr>
                  <th className="hg-name" />
                  {rounds.map((r) => {
                    const h = questHeader(r.round)
                    return (
                      <th key={r.round} colSpan={r.proposals.length} className={`hg-quest ${h.cls}`}>
                        {h.text}
                      </th>
                    )
                  })}
                </tr>
                <tr>
                  <th className="hg-name" />
                  {rounds.flatMap((r) => r.proposals.map((p) => (
                    <th key={`${p.round}.${p.proposalNum}`} className={`hg-prop${p.approved === false ? ' rejected' : ''}`}
                      title={`Proposal ${p.proposalNum}/5 — leader ${view.players[p.leader]?.name}${p.pitch ? ` — “${p.pitch}”` : ''}`}>
                      {p.proposalNum}{p.proposalNum === 5 ? '🔨' : ''}
                    </th>
                  )))}
                </tr>
              </thead>
              <tbody>
                {view.players.map((player) => (
                  <tr key={player.seat}>
                    <td className="hg-name">
                      <ModelBadge info={bots[player.seat]} />
                      {player.name}
                    </td>
                    {rounds.flatMap((r) => r.proposals.map((p) => {
                      const onTeam = p.team.includes(player.seat)
                      const isLeader = p.leader === player.seat
                      const vote = p.votes?.find((v) => v.seat === player.seat)?.vote
                      const cls = [
                        'hg-cell',
                        onTeam ? 'on-team' : '',
                        vote === 'approve' ? 'yes' : vote === 'reject' ? 'no' : '',
                      ].join(' ')
                      return (
                        <td key={`${p.round}.${p.proposalNum}`} className={cls}>
                          {isLeader ? '♛' : ''}{vote === 'approve' ? '✓' : vote === 'reject' ? '✗' : onTeam ? '·' : ''}
                        </td>
                      )
                    }))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hg-legend">
          ♛ leader · shaded = on the proposed team · ✓ approved · ✗ rejected · 🔨 hammer (5th proposal)
        </p>
      </div>
    </div>
  )
}
