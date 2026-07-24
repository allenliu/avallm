import type { AgentInfo, PlayerView, Seat } from '../types.ts'
import { latestLeans } from '../leans.ts'
import { celestialFor } from './Arcana.tsx'

export function ModelBadge({ info }: { info: AgentInfo | undefined }) {
  if (!info) return null
  return (
    <span className="badge" style={{ background: info.color }} title={`${info.name} · ${info.model}`}>
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
  const playerCount = view.players.length
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
        // Details live in the hover tooltip, placed to the side so the arc
        // zone's overflow clip can't cut it off: left-half seats open right.
        const tipSide = pos.x < 50 ? 'tip-right' : 'tip-left'
        const leadsIn = playerCount ? (p.seat - view.leaderSeat + playerCount) % playerCount : 0
        const body = celestialFor(bot?.id, p.name)
        return (
          <div
            key={p.seat}
            className={`seat${isLeader ? ' leader' : ''}${onTeam ? ' onquest' : ''}`}
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, animationDelay: `${i * 0.85}s`, ['--mc' as string]: mc }}
          >
            <div className="seat-card">
              {isLeader && <span className="crown" title="Leader">♛</span>}
              <span className="sigil">{body.glyph}</span>
              <span className="seat-nm">{p.name}</span>
              {lean && (
                <span className={`seat-lean ${lean === 'approve' ? 'a' : lean === 'reject' ? 'r' : 'u'}`}>
                  {lean === 'approve' ? 'AYE' : lean === 'reject' ? 'NAY' : '?'}
                </span>
              )}
              {vote && (
                <span className={`votechip ${vote}`}>
                  {vote === 'approve' ? '✓' : '✕'}
                </span>
              )}
              <span className={`tooltip ${tipSide}`} role="tooltip">
                <span className="t-title">{isLeader && <span className="t-num">♛ </span>}{p.name}</span>
                <span className="t-sub">{body.body} · {bot ? bot.model : 'human player'}</span>
                <span className="t-rows">
                  <span className="t-row"><span className="k">status</span><span className="v gold">
                    {[isLeader ? 'leader' : '', onTeam ? 'on quest' : '', isActing ? 'deciding…' : '']
                      .filter(Boolean).join(' · ') || 'at the table'}
                  </span></span>
                  {lean && (
                    <span className="t-row"><span className="k">lean</span>
                      <span className={`v ${lean === 'approve' ? 'aye' : lean === 'reject' ? 'nay' : ''}`}>
                        {lean === 'approve' ? 'aye' : lean === 'reject' ? 'nay' : 'unsure'}
                      </span></span>
                  )}
                  {vote && (
                    <span className="t-row"><span className="k">last vote</span>
                      <span className={`v ${vote === 'approve' ? 'aye' : 'nay'}`}>{vote === 'approve' ? 'approved' : 'rejected'}</span></span>
                  )}
                  <span className="t-row"><span className="k">leads</span>
                    <span className="v">{isLeader ? 'now' : leadsIn === 1 ? 'next' : `in ${leadsIn} turns`}</span></span>
                  {bot?.about && <span className="t-row about"><span className="k">about</span><span className="v dim">{bot.about}</span></span>}
                </span>
              </span>
            </div>
            <div className="seat-under">
              {isActing && <span className="thinking-dots" title="deciding…">●●●</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
