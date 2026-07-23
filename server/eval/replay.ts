// Deterministic replay: rebuild the live Game — and therefore any seat's
// PlayerView — at any decision point of an archived game. The artifact's
// unredacted log contains every decision (utterances, proposals, private
// voteCast/questCard, assassination, renames), and the engine is pure and
// seeded, so re-applying those decisions to createGame(same seed) reproduces
// the original event-for-event. Replay VERIFIES that: any divergence between
// the replayed log and the artifact log is a hard error, because a snapshot
// taken from a drifted replay would be fiction.
//
// This is the foundation of the situation bank (design doc §6): a judge
// incident cites an event seq; snapshotAt() turns that into the exact
// (DecisionRequest, PlayerView, scratchpad) the deciding agent faced, which
// any prompt version can then replay as a single LLM call.

import { createGame, applyDecision, renamePlayer } from '../engine/game.ts'
import { viewFor } from '../engine/view.ts'
import type { GameArtifact } from './artifact.ts'
import type {
  Decision, DecisionRequest, Game, GameEvent, PlayerView, Seat,
} from '../engine/types.ts'

interface ReplayStep {
  firstSeq: number  // first event this step emitted (thinking/scratchpad precede the action)
  actionSeq: number
  seat: Seat
  action: Decision | { kind: 'rename'; to: string }
}

// Reconstruct the decision stream from the log. thinking/scratchpad events are
// folded into the decision that emitted them so the replayed log reproduces
// the original seq-for-seq.
function extractSteps(log: GameEvent[]): ReplayStep[] {
  const steps: ReplayStep[] = []
  // seat -> pending private preamble (thinking/notes emitted just before the action)
  const pending = new Map<Seat, { thinking?: string; notes?: string; firstSeq: number }>()

  const take = (seat: Seat, actionSeq: number): { thinking?: string; notes?: string; firstSeq: number } => {
    const p = pending.get(seat) ?? { firstSeq: actionSeq }
    pending.delete(seat)
    return p
  }

  for (const ev of log) {
    const p = ev.payload
    switch (ev.type) {
      case 'thinking': {
        const seat = p.seat as Seat
        const cur = pending.get(seat) ?? { firstSeq: ev.seq }
        cur.thinking = p.text as string
        pending.set(seat, cur)
        break
      }
      case 'scratchpad': {
        const seat = p.seat as Seat
        const cur = pending.get(seat) ?? { firstSeq: ev.seq }
        cur.notes = p.text as string
        pending.set(seat, cur)
        break
      }
      case 'utterance': {
        const seat = p.seat as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'discuss', say: p.text as string,
            ...(p.lean !== undefined ? { lean: p.lean as 'approve' | 'reject' | 'unsure' } : {}),
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
        })
        break
      }
      case 'proposal': {
        const seat = p.leader as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'propose', team: (p.team as Seat[]).slice(),
            ...(typeof p.pitch === 'string' ? { pitch: p.pitch } : {}),
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
        })
        break
      }
      case 'voteCast': {
        const seat = p.seat as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'vote', vote: p.vote as 'approve' | 'reject',
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
        })
        break
      }
      case 'questCard': {
        const seat = p.seat as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'quest', card: p.card as 'success' | 'fail',
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
        })
        break
      }
      case 'assassination': {
        const seat = p.assassin as Seat
        const pre = take(seat, ev.seq)
        steps.push({
          firstSeq: pre.firstSeq, actionSeq: ev.seq, seat,
          action: {
            kind: 'assassinate', target: p.target as Seat,
            ...(pre.thinking !== undefined ? { thinking: pre.thinking } : {}),
            ...(pre.notes !== undefined ? { notes: pre.notes } : {}),
          },
        })
        break
      }
      case 'rename':
        steps.push({
          firstSeq: ev.seq, actionSeq: ev.seq, seat: p.seat as Seat,
          action: { kind: 'rename', to: p.to as string },
        })
        break
      // Engine-emitted events (voteReveal, questResult, leadChange, gameOver,
      // gameCreated, roleDealt, knowledge) are consequences, not decisions.
    }
  }
  return steps
}

function verifyPrefix(a: GameArtifact, game: Game): void {
  for (let i = 0; i < game.log.length; i++) {
    if (JSON.stringify(game.log[i]) !== JSON.stringify(a.log[i])) {
      throw new Error(
        `replay drift at seq ${i}: replayed ${JSON.stringify(game.log[i])} !== archived ${JSON.stringify(a.log[i])}`,
      )
    }
  }
}

// Replay up to (not including) the step whose event span contains untilSeq;
// omit untilSeq to replay the whole game. The returned Game's log is verified
// to be an exact prefix of the artifact's.
export function replayGame(a: GameArtifact, untilSeq?: number): Game {
  const created = a.log[0]
  if (created?.type !== 'gameCreated') throw new Error('artifact log must start with gameCreated')
  const game = createGame({
    seed: a.seed,
    playerCount: a.playerCount,
    // Pass the persisted config-order roles so the seeded shuffle reproduces the
    // exact deal — this is what makes custom-role games replayable. Pre-v2
    // artifacts lack `roles`; omitting it falls back to the default set, which
    // is what those games used, and the check below still guards against drift.
    ...(a.roles ? { roles: a.roles.slice() } : {}),
    names: (created.payload.names as string[]).slice(),
    talk: a.talk,
    id: a.id,
  })
  for (const p of game.players) {
    if (p.role !== a.players[p.seat].role) {
      throw new Error(
        `replay deal mismatch at seat ${p.seat}: dealt ${p.role}, archived ${a.players[p.seat].role}`
        + (a.roles ? '' : ' — pre-v2 artifact with no stored roles and a non-default deal'),
      )
    }
  }
  for (const step of extractSteps(a.log)) {
    if (untilSeq !== undefined && step.firstSeq >= untilSeq) break
    if (step.action.kind === 'rename') renamePlayer(game, step.seat, step.action.to)
    else applyDecision(game, step.seat, step.action)
  }
  verifyPrefix(a, game)
  if (untilSeq === undefined && game.log.length !== a.log.length) {
    throw new Error(`replay incomplete: ${game.log.length} events vs ${a.log.length} archived`)
  }
  return game
}

export interface DecisionSnapshot {
  artifactId: string
  seed: string
  seq: number        // the action event
  firstSeq: number
  seat: Seat
  kind: DecisionRequest['kind']
  role: string
  req: DecisionRequest
  view: PlayerView   // exactly what the deciding agent saw
  scratchpad: string // the agent's private notes at that moment ('' if none)
  original: Decision // what actually happened, including private thinking
}

// The situation-bank extractor: the full decision context at event seq.
// seq must be a decision's action event (utterance/proposal/voteCast/
// questCard/assassination) — engine-emitted consequences have no decider.
export function snapshotAt(a: GameArtifact, seq: number): DecisionSnapshot {
  const step = extractSteps(a.log).find((s) => s.firstSeq <= seq && seq <= s.actionSeq)
  if (!step || step.action.kind === 'rename') {
    throw new Error(`seq ${seq} is not a decision event in game ${a.id}`)
  }
  const original = step.action
  const game = replayGame(a, step.firstSeq)
  // The scratchpad the live prompt saw: when a reflect ran this turn, the new
  // notes ride THIS decision (original.notes) and were emitted in its own
  // preamble (seq >= firstSeq) — so a prior-only lookup would return the STALE
  // pad. Prefer the decision's own notes, else the last scratchpad emitted
  // before this step. (These are the exact runtime semantics in llm.ts.)
  const priorPad = a.log.findLast(
    (ev) => ev.type === 'scratchpad' && ev.payload.seat === step.seat && ev.seq < step.firstSeq,
  )
  return {
    artifactId: a.id,
    seed: a.seed,
    seq: step.actionSeq,
    firstSeq: step.firstSeq,
    seat: step.seat,
    kind: original.kind,
    role: a.players[step.seat].role,
    req: {
      kind: original.kind, seat: step.seat,
      round: game.round, proposalNum: game.proposalNum,
    },
    view: viewFor(game, step.seat),
    scratchpad: original.notes ?? (priorPad?.payload.text as string | undefined) ?? '',
    original,
  }
}
