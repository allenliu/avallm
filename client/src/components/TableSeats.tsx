import type { AgentInfo, PlayerView, Seat } from '../types.ts'
import { latestLeans } from '../leans.ts'

export function ModelBadge({ info }: { info: AgentInfo | undefined }) {
  if (!info) return null
  return (
    <span className="badge" style={{ background: info.color }} title={`${info.name} — ${info.model}`}>
      {info.monogram}
    </span>
  )
}

// Everyone but the viewer, seated as small arcana cards along the far side of
// the table. Positions are computed along the arc: edges sit low, the middle
// seats stand behind the table's crest. Both axes are percentages of the arc
// zone so the whole arrangement compresses with the zone on small screens.
function arcPosition(i: number, n: number): { x: number; y: number } {
  const t = n === 1 ? 0.5 : i / (n - 1)
  return {
    x: 7 + 86 * t,
    y: 38 - 28 * Math.sin(Math.PI * t),
  }
}

export function TableSeats({ view, bots, acting }: {
  view: PlayerView
  bots: Record<number, AgentInfo>
  acting: Seat[]
}) {
  const lastVoted = [...view.proposals].reverse().find((p) => p.votes)
  const votesVisible = view.phase !== 'vote' && lastVoted
  const leans = latestLeans(view)
  // Spectators (seat < 0) watch every chair; players see themselves at the
  // near edge (the footer chip), not on the arc.
  const others = view.players.filter((p) => p.seat !== view.seat)
  const nextLeader = view.players.length
    ? ((view.leaderSeat + 1) % view.players.length) as Seat
    : undefined
  return (
    <div className={`farseats${others.length >= 7 ? ' crowded' : ''}`}>
      {others.map((p, i) => {
        const isLeader = p.seat === view.leaderSeat
        const onTeam = view.currentTeam?.includes(p.seat)
        const isActing = acting.includes(p.seat)
        const lean = leans.get(p.seat)
        const vote = votesVisible ? lastVoted!.votes!.find((v) => v.seat === p.seat)?.vote : undefined
        const bot = bots[p.seat]
        const pos = arcPosition(i, others.length)
        const mc = bot?.color ?? 'var(--gold)'
        return (
          <div
            key={p.seat}
            className={`seat${isLeader ? ' leader' : ''}${onTeam ? ' onquest' : ''}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, animationDelay: `${i * 0.85}s`, ['--mc' as string]: mc }}
            title={bot ? `${p.name} — ${bot.model}` : p.name}
          >
            <div className="seat-card">
              {isLeader && <span className="halo" />}
              {isLeader && <span className="crown" title="Leader">♛</span>}
              <span className="sigil">{bot?.monogram ?? p.name.slice(0, 2).toUpperCase()}</span>
              <span className="seat-nm">{p.name}</span>
              {lean && (
                <span className={`gem ${lean === 'approve' ? 'a' : lean === 'reject' ? 'r' : 'u'}`}
                  title={`leaning ${lean}`} />
              )}
              {vote && (
                <span className={`votechip ${vote}`} title={`voted ${vote}`}>
                  {vote === 'approve' ? '✓' : '✕'}
                </span>
              )}
            </div>
            <div className="seat-under">
              {isActing
                ? <span className="thinking-dots" title="deciding…">●●●</span>
                : p.seat === nextLeader && !isLeader
                  ? <span className="next-tag">next ♛</span>
                  : <span className="seat-md">{bot ? shortModel(bot.model) : 'human'}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function shortModel(model: string): string {
  return model.includes('/') ? model.split('/')[1] : model
}
