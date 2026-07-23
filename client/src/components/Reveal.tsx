import { useState } from 'react'
import type { AgentInfo, PlayerView, RevealPayload } from '../types.ts'
import { agentConfigText, tokenEstimate } from '../agentConfig.ts'
import { ModelBadge } from './TableSeats.tsx'
import { ROLE_INFO, winReasonText } from '../setup.ts'
import type { Role } from '../setup.ts'
import { ARCANA, Emblem } from './Arcana.tsx'

// The reveal takes over the stage: every identity dealt face-down in seat
// order, then flipped one by one. The flip is the arcana's core animation.
export function Reveal({ view, reveal, bots, onNewGame, onCopyLog, copyLabel }: {
  view: PlayerView
  reveal: RevealPayload | null
  bots: Record<number, AgentInfo>
  onNewGame: () => void
  onCopyLog: () => void
  copyLabel: string
}) {
  const [showThinking, setShowThinking] = useState(false)
  const winnerCls = view.winner === 'good' ? 'ok' : 'bad'
  return (
    <div className="reveal">
      <div className={`winner-banner ${winnerCls}`}>
        {view.winner?.toUpperCase()} WINS
        <span className="reason"> — {winReasonText(view.winReason ?? '')}</span>
      </div>
      {reveal ? (
        <div className="reveal-deal">
          {reveal.players.map((p, i) => {
            const arcana = ARCANA[p.role as Role]
            const you = p.seat === view.seat
            return (
              <div key={p.seat} className="flip" style={{ animationDelay: `${0.3 + i * 0.35}s` }}>
                <div className={`flip-face tarot-mini ${p.alignment}${you ? ' you' : ''}`}>
                  <span className="tm-num">{arcana?.numeral ?? '·'}</span>
                  {arcana && <Emblem id={arcana.emblem} className="tm-em" />}
                  <span className="tm-title">{arcana?.title ?? p.role}</span>
                  <span className="tm-plate">
                    <span className="tm-name"><ModelBadge info={bots[p.seat]} />{you ? 'You' : p.name}</span>
                    <span className="tm-role">{ROLE_INFO[p.role as Role]?.name ?? p.role}</span>
                  </span>
                </div>
                <div className="flip-back">
                  <span className="fb-ring">✦</span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="reveal-waiting">Turning the cards…</p>
      )}
      <div className="row reveal-actions">
        <button onClick={() => setShowThinking(!showThinking)}>
          {showThinking ? 'Hide' : 'Show'} what they were really thinking
        </button>
        <button className="secondary" onClick={onCopyLog} title="Copy a full debug transcript of this game to the clipboard">{copyLabel}</button>
        <button className="secondary" onClick={onNewGame}>New game</button>
      </div>
      {showThinking && reveal && <ThinkingTimeline reveal={reveal} bots={bots} />}
      {reveal && <AgentConfigCards reveal={reveal} bots={bots} />}
    </div>
  )
}

// The configs that actually played (def snapshots from game start) — full
// transparency once the game is over, including custom prompt layers.
function AgentConfigCards({ reveal, bots }: { reveal: RevealPayload; bots: Record<number, AgentInfo> }) {
  const tuned = Object.entries(reveal.agents ?? {})
    .filter(([, a]) => a.custom || a.tunedChars > 0)
  if (!tuned.length) return null
  return (
    <div className="reveal-agent-configs">
      <p className="roles-preview">Custom agents, as configured for this game:</p>
      {tuned.map(([seat, a]) => {
        const player = reveal.players.find((p) => p.seat === Number(seat))
        return (
          <details key={seat} className="prompt-details">
            <summary>
              <ModelBadge info={bots[Number(seat)] ?? a} />
              {player?.name ?? a.name} — {a.name} v{a.version ?? 1} ({a.model},
              ~{tokenEstimate(a.tunedChars)} tokens of custom prompt)
            </summary>
            <pre>{agentConfigText(a)}</pre>
          </details>
        )
      })}
    </div>
  )
}

function ThinkingTimeline({ reveal, bots }: { reveal: RevealPayload; bots: Record<number, AgentInfo> }) {
  const name = (s: number) => reveal.players.find((p) => p.seat === s)?.name ?? `seat ${s}`
  const rows = reveal.log.filter((ev) =>
    ev.type === 'thinking' || ev.type === 'scratchpad' || ev.type === 'questCard' ||
    ev.type === 'proposal' || ev.type === 'questResult')
  return (
    <div className="thinking-timeline">
      {rows.map((ev) => {
        const p = ev.payload
        if (ev.type === 'scratchpad') {
          return (
            <div key={ev.seq} className="think-row notes-row">
              <span className="feed-speaker"><ModelBadge info={bots[p.seat]} />{name(p.seat)}</span>
              <span className="think-kind">[notes]</span>
              <em>{p.text}</em>
            </div>
          )
        }
        if (ev.type === 'thinking') {
          return (
            <div key={ev.seq} className="think-row">
              <span className="feed-speaker"><ModelBadge info={bots[p.seat]} />{name(p.seat)}</span>
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
