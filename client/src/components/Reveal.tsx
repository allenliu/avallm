import { useState } from 'react'
import type { PlayerView, RevealPayload } from '../types.ts'
import { ModelBadge } from './TableSeats.tsx'

export function Reveal({ view, reveal, bots, onNewGame }: {
  view: PlayerView
  reveal: RevealPayload | null
  bots: Record<number, string>
  onNewGame: () => void
}) {
  const [showThinking, setShowThinking] = useState(false)
  const winnerCls = view.winner === 'good' ? 'ok' : 'bad'
  return (
    <div className="reveal">
      <div className={`winner-banner ${winnerCls}`}>
        {view.winner?.toUpperCase()} WINS <span className="reason">({view.winReason})</span>
      </div>
      {reveal && (
        <div className="reveal-roles">
          {reveal.players.map((p) => (
            <span key={p.seat} className={`reveal-role ${p.alignment}`}>
              <ModelBadge botId={bots[p.seat]} />
              {p.name}: <b>{p.role}</b>
            </span>
          ))}
        </div>
      )}
      <div className="row">
        <button onClick={() => setShowThinking(!showThinking)}>
          {showThinking ? 'Hide' : 'Show'} what they were really thinking
        </button>
        <button className="secondary" onClick={onNewGame}>New game</button>
      </div>
      {showThinking && reveal && <ThinkingTimeline reveal={reveal} bots={bots} />}
    </div>
  )
}

function ThinkingTimeline({ reveal, bots }: { reveal: RevealPayload; bots: Record<number, string> }) {
  const name = (s: number) => reveal.players.find((p) => p.seat === s)?.name ?? `seat ${s}`
  const rows = reveal.log.filter((ev) =>
    ev.type === 'thinking' || ev.type === 'questCard' || ev.type === 'proposal' || ev.type === 'questResult')
  return (
    <div className="thinking-timeline">
      {rows.map((ev) => {
        const p = ev.payload
        if (ev.type === 'thinking') {
          return (
            <div key={ev.seq} className="think-row">
              <span className="feed-speaker"><ModelBadge botId={bots[p.seat]} />{name(p.seat)}</span>
              <span className="think-kind">[{p.kind}]</span>
              <em>{p.text}</em>
            </div>
          )
        }
        if (ev.type === 'questCard') {
          return (
            <div key={ev.seq} className={`think-row card-${p.card}`}>
              <span className="feed-speaker">{name(p.seat)}</span>
              <span>secretly played <b>{String(p.card).toUpperCase()}</b></span>
            </div>
          )
        }
        if (ev.type === 'proposal') {
          return <div key={ev.seq} className="think-row marker">— {name(p.leader)} proposes (Q{p.round}.{p.proposalNum}) —</div>
        }
        return <div key={ev.seq} className="think-row marker big">═ Quest {p.round}: {String(p.result).toUpperCase()} ═</div>
      })}
    </div>
  )
}
