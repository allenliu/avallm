// viewFor — THE hidden-information chokepoint. No prompt builder, client
// payload, or agent ever touches raw Game; they consume viewFor(game, seat).
// Contract tests in test/knowledge.test.ts and test/leaks.test.ts pin this.

import { computeKnowledge } from './rules.ts'
import type {
  Game, GameEvent, PlayerView, ProposalRecord, Seat,
} from './types.ts'

export function eventVisibleTo(ev: GameEvent, seat: Seat): boolean {
  return ev.visibility === 'public' || ev.visibility.only.includes(seat)
}

// A role-less observer: strictly the public record. Client code gates all
// role/alignment UI on role === 'spectator'.
//
// Every field is named EXPLICITLY rather than spread from a seat's view: the
// seat-private fields (role, alignment, privateInfo, per-seat events) are
// neutralized here, and any PRIVATE field added to PlayerView later is
// excluded by default (opt-in public) instead of silently leaking. The
// remaining fields carried from base are seat-independent public record.
export function viewForSpectator(game: Game): PlayerView {
  const base = viewFor(game, 0)
  return {
    seat: -1,
    name: 'Spectator',
    role: 'spectator' as PlayerView['role'],
    alignment: 'good', // placeholder — never rendered for spectators
    privateInfo: {},
    events: game.log.filter((ev) => ev.visibility === 'public'),
    // --- public record, seat-independent ---
    playerCount: base.playerCount,
    rolesInPlay: base.rolesInPlay,
    players: base.players,
    phase: base.phase,
    round: base.round,
    proposalNum: base.proposalNum,
    leaderSeat: base.leaderSeat,
    quests: base.quests,
    proposals: base.proposals,
    currentTeam: base.currentTeam,
    discussionRound: base.discussionRound,
    discussionPostRevision: base.discussionPostRevision,
    transcript: base.transcript,
    winner: base.winner,
    winReason: base.winReason,
  }
}

export function viewFor(game: Game, seat: Seat): PlayerView {
  const me = game.players[seat]
  if (!me) throw new Error(`no player at seat ${seat}`)

  const events = game.log.filter((ev) => eventVisibleTo(ev, seat))

  const proposals: ProposalRecord[] = []
  for (const ev of game.log) {
    if (ev.type === 'proposal') {
      proposals.push({
        round: ev.payload.round as number,
        proposalNum: ev.payload.proposalNum as number,
        leader: ev.payload.leader as Seat,
        team: (ev.payload.team as Seat[]).slice(),
        ...(typeof ev.payload.pitch === 'string' ? { pitch: ev.payload.pitch } : {}),
      })
    } else if (ev.type === 'proposalRevised') {
      // The leader changed the team at finalize: the record keeps ONE entry
      // per proposal cycle, showing the final team with the original preserved.
      const rec = proposals[proposals.length - 1]
      rec.team = (ev.payload.to as Seat[]).slice()
      rec.revisedFrom = (ev.payload.from as Seat[]).slice()
      if (typeof ev.payload.reason === 'string') rec.revisedReason = ev.payload.reason
    } else if (ev.type === 'voteReveal') {
      const rec = proposals[proposals.length - 1]
      rec.votes = (ev.payload.votes as ProposalRecord['votes'])!.map((v) => ({ ...v }))
      rec.approved = ev.payload.approved as boolean
      if (ev.payload.auto === true) rec.auto = true
    }
  }

  // Renames appear in the transcript stream so bots (whose table knowledge is
  // the transcript) learn name changes exactly like everyone else. Each entry
  // is tagged with the proposal segment it was spoken under (`prop`), tracked
  // by replaying proposal/proposalRevised in log order — so a renderer can
  // fence one proposal's discussion off from the next and a lean from an
  // earlier team can't masquerade as a lean on the current one.
  const transcript: PlayerView['transcript'] = []
  let curProp: { round: number; proposalNum: number; team: Seat[] } | undefined
  for (const ev of game.log) {
    if (ev.type === 'proposal') {
      curProp = { round: ev.payload.round as number, proposalNum: ev.payload.proposalNum as number, team: (ev.payload.team as Seat[]).slice() }
    } else if (ev.type === 'proposalRevised') {
      // Same proposalNum, new team — the leans before it were about `from`.
      curProp = { round: ev.payload.round as number, proposalNum: ev.payload.proposalNum as number, team: (ev.payload.to as Seat[]).slice() }
    } else if (ev.type === 'rename') {
      transcript.push({
        seat: ev.payload.seat as Seat,
        name: game.players[ev.payload.seat as Seat].name,
        text: `(changed display name from ${ev.payload.from} to ${ev.payload.to})`,
        ...(curProp ? { prop: curProp } : {}),
      })
    } else if (ev.type === 'utterance' &&
        ((ev.payload.text as string).length > 0 || ev.payload.lean !== undefined)) {
      transcript.push({
        seat: ev.payload.seat as Seat,
        name: game.players[ev.payload.seat as Seat].name,
        text: ev.payload.text as string,
        ...(ev.payload.lean !== undefined ? { lean: ev.payload.lean as any } : {}),
        ...(curProp ? { prop: curProp } : {}),
      })
    }
  }

  return {
    seat,
    name: me.name,
    role: me.role,
    alignment: me.alignment,
    privateInfo: computeKnowledge(game.players, seat),
    playerCount: game.config.playerCount,
    rolesInPlay: game.config.roles.slice().sort(),
    players: game.players.map((p) => ({ seat: p.seat, name: p.name })),
    phase: game.phase,
    round: game.round,
    proposalNum: game.proposalNum,
    leaderSeat: game.leaderSeat,
    quests: game.quests.map((q) => ({ ...q, team: q.team?.slice() })),
    proposals,
    currentTeam: game.currentTeam?.slice(),
    discussionRound: game.discussion?.roundNum,
    discussionPostRevision: game.discussion?.postRevision,
    transcript,
    events,
    winner: game.winner,
    winReason: game.winReason,
  }
}
