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
export function viewForSpectator(game: Game): PlayerView {
  const base = viewFor(game, 0)
  return {
    ...base,
    seat: -1,
    name: 'Spectator',
    role: 'spectator' as PlayerView['role'],
    alignment: 'good', // placeholder — never rendered for spectators
    privateInfo: {},
    events: game.log.filter((ev) => ev.visibility === 'public'),
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
    } else if (ev.type === 'voteReveal') {
      const rec = proposals[proposals.length - 1]
      rec.votes = (ev.payload.votes as ProposalRecord['votes'])!.map((v) => ({ ...v }))
      rec.approved = ev.payload.approved as boolean
    }
  }

  const transcript = game.log
    .filter((ev) => ev.type === 'utterance' &&
      ((ev.payload.text as string).length > 0 || ev.payload.lean !== undefined))
    .map((ev) => ({
      seat: ev.payload.seat as Seat,
      name: game.players[ev.payload.seat as Seat].name,
      text: ev.payload.text as string,
      ...(ev.payload.lean !== undefined ? { lean: ev.payload.lean as any } : {}),
    }))

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
    discussionSlot: game.discussion?.slot,
    discussionRound: game.discussion?.roundNum,
    transcript,
    events,
    winner: game.winner,
    winReason: game.winReason,
  }
}
