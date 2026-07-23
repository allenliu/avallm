import type { PlayerView } from '../types.ts'
import { Emblem } from './Arcana.tsx'

// The quest line as a five-card spread lying on the felt: face-down = future,
// glowing = current, flipped = resolved (The Sun / The Tower).
export function QuestBoard({ view }: { view: PlayerView }) {
  return (
    <div className="spread">
      <div className="qcards">
        {view.quests.map((q) => {
          const state = q.result ?? (q.num === view.round ? 'current' : 'pending')
          const title = `Quest ${q.num}: team of ${q.teamSize}${q.failsRequired === 2 ? ', needs 2 fails' : ''}${q.result ? ` — ${q.result} (${q.failCount} fail${q.failCount === 1 ? '' : 's'})` : ''}`
          if (q.result === 'success') {
            return (
              <div key={q.num} className="qcard face won" title={title}>
                <span className="qn">Q·{q.num}</span>
                <Emblem id="sun" className="qem" />
                <span className="word">THE SUN</span>
              </div>
            )
          }
          if (q.result === 'fail') {
            return (
              <div key={q.num} className="qcard face lost" title={title}>
                <span className="qn">Q·{q.num}</span>
                <Emblem id="tower" className="qem" />
                <span className="word">TOWER ·{q.failCount}</span>
              </div>
            )
          }
          return (
            <div key={q.num} className={`qcard back${state === 'current' ? ' current' : ''}`} title={title}>
              <span className="qn">Q·{q.num}</span>
              <span className="sz">{q.teamSize}</span>
              {q.failsRequired === 2 && <span className="twofail">2 fails</span>}
            </div>
          )
        })}
      </div>
      <div className="prop" title="Proposals this round — after 4 rejections the 5th (hammer) team is locked in automatically, no vote">
        <span className="prop-lbl">Proposal {view.proposalNum}/5</span>
        <div className="pips">
          {[1, 2, 3, 4, 5].map((n) => (
            <span
              key={n}
              className={`pip${n < view.proposalNum ? ' used' : ''}${n === view.proposalNum ? ' now' : ''}${n === 5 ? ' hammer' : ''}`}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
