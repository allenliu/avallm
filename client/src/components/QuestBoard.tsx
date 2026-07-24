import type { PlayerView } from '../types.ts'
import { Emblem } from './Arcana.tsx'

// The quest line as a five-card spread lying on the felt: face-down = future,
// glowing = current, flipped = resolved to the faction that won it (Loyal shield
// / Evil dagger — the sigils players already know from the role sheets). Details live in
// arcane tooltips (who went, fails revealed); the tally plaque carries the
// score where hover doesn't exist (mobile).
export function QuestBoard({ view }: { view: PlayerView }) {
  const name = (s: number) => (s === view.seat ? 'You' : view.players[s]?.name ?? `seat ${s}`)
  return (
    <div className="spread">
      <div className="qcards">
        {view.quests.map((q) => {
          const tip = (
            <span className="tooltip tip-up" role="tooltip">
              <span className="t-title"><span className="t-num">Q·{q.num}</span>
                {q.result === 'success' ? 'Loyal victory' : q.result === 'fail' ? 'Sabotaged' : q.num === view.round ? 'Current quest' : 'Future quest'}
              </span>
              <span className="t-rows">
                {q.team
                  ? <span className="t-row"><span className="k">went</span><span className="v">{q.team.map(name).join(' · ')}</span></span>
                  : <span className="t-row"><span className="k">team</span><span className="v">{q.teamSize} players</span></span>}
                {q.result
                  ? <span className="t-row"><span className="k">fails</span><span className="v">{q.failCount} revealed · {q.failsRequired} needed</span></span>
                  : <span className="t-row"><span className="k">to fail</span><span className="v">needs {q.failsRequired} fail card{q.failsRequired === 1 ? '' : 's'}</span></span>}
              </span>
            </span>
          )
          if (q.result === 'success') {
            return (
              <div key={q.num} className="qcard face won">
                <span className="qn">Q·{q.num}</span>
                <Emblem id="shield" className="qem" />
                <span className="word">LOYAL</span>
                {tip}
              </div>
            )
          }
          if (q.result === 'fail') {
            return (
              <div key={q.num} className="qcard face lost">
                <span className="qn">Q·{q.num}</span>
                <Emblem id="dagger" className="qem" />
                <span className="word">SABOTAGE ·{q.failCount}</span>
                {tip}
              </div>
            )
          }
          return (
            <div key={q.num} className={`qcard back${q.num === view.round ? ' current' : ''}`}>
              <span className="qn">Q·{q.num}</span>
              <span className="sz">{q.teamSize}</span>
              {tip}
            </div>
          )
        })}
      </div>
      <div className="prop" title="Proposals this round; after 4 rejections the 5th (hammer) team is locked in automatically, no vote">
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
