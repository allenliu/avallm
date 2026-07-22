import type { PlayerView } from '../types.ts'

export function QuestBoard({ view }: { view: PlayerView }) {
  return (
    <div className="quest-board">
      {view.quests.map((q) => (
        <div
          key={q.num}
          className={`quest-disc ${q.result ?? (q.num === view.round ? 'current' : 'pending')}`}
          title={`Quest ${q.num}: team of ${q.teamSize}${q.failsRequired === 2 ? ', needs 2 fails' : ''}${q.result ? ` — ${q.result} (${q.failCount} fails)` : ''}`}
        >
          <span className="disc-size">{q.teamSize}</span>
          {q.failsRequired === 2 && <span className="disc-star">*</span>}
        </div>
      ))}
      <div className="vote-track" title="Rejected proposals this round — 5 rejections and evil wins">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`track-dot${n < view.proposalNum ? ' burnt' : ''}${n === 5 ? ' hammer' : ''}`} />
        ))}
      </div>
    </div>
  )
}
