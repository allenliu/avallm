// The game engine: createGame, expectedDecisions, applyDecision.
// applyDecision validates every decision regardless of source (LLM, heuristic,
// human, external process) — invalid decisions throw EngineError and never
// touch state. NOTE: applyDecision mutates `game` and returns it.

import {
  DEFAULT_ROLES, EVIL_COUNT, MAX_PLAYERS, MAX_PROPOSALS, MIN_PLAYERS,
  QUESTS_PER_GAME, QUESTS_TO_WIN, ROLE_ALIGNMENT, TEAM_SIZES,
  computeKnowledge, failsRequired, validateRoles,
} from './rules.ts'
import { makeRng } from './prng.ts'
import type {
  Decision, DecisionRequest, Game, GameConfig, GameEvent, Phase, Player,
  Quest, Role, Seat, TalkConfig, Visibility,
} from './types.ts'

export class EngineError extends Error {}

export interface CreateGameOpts {
  seed: string
  playerCount?: number
  roles?: Role[]
  names?: string[]
  talk?: Partial<TalkConfig>
  id?: string
}

function emit(game: Game, type: GameEvent['type'], payload: Record<string, unknown>, visibility: Visibility): void {
  game.log.push({ seq: game.log.length, type, payload, visibility })
}

export function createGame(opts: CreateGameOpts): Game {
  const playerCount = opts.playerCount ?? 7
  if (playerCount < MIN_PLAYERS || playerCount > MAX_PLAYERS) {
    throw new EngineError(`playerCount must be ${MIN_PLAYERS}-${MAX_PLAYERS}, got ${playerCount}`)
  }
  const roles = opts.roles ?? DEFAULT_ROLES[playerCount]
  validateRoles(playerCount, roles)
  const names = opts.names ?? Array.from({ length: playerCount }, (_, i) => `P${i}`)
  if (names.length !== playerCount) throw new EngineError('names length mismatch')
  const talk: TalkConfig = { preProposal: 1, postProposal: 1, ...opts.talk }

  const rng = makeRng(`deal:${opts.seed}`)
  const dealtRoles = rng.shuffle(roles)
  const players: Player[] = dealtRoles.map((role, seat) => ({
    seat, name: names[seat], role, alignment: ROLE_ALIGNMENT[role],
  }))
  const leaderSeat = rng.int(playerCount)

  const quests: Quest[] = Array.from({ length: QUESTS_PER_GAME }, (_, i) => ({
    num: i + 1,
    teamSize: TEAM_SIZES[playerCount][i],
    failsRequired: failsRequired(playerCount, i + 1),
  }))

  const game: Game = {
    id: opts.id ?? `game-${opts.seed}`,
    seed: opts.seed,
    config: { playerCount, roles, names, talk },
    phase: 'proposal',
    round: 1,
    proposalNum: 1,
    leaderSeat,
    players,
    quests,
    pendingVotes: {},
    pendingCards: {},
    log: [],
  }

  emit(game, 'gameCreated', {
    playerCount,
    names,
    rolesInPlay: roles.slice().sort(),
    firstLeader: leaderSeat,
    talk,
  }, 'public')
  for (const p of players) {
    emit(game, 'roleDealt', { seat: p.seat, role: p.role, alignment: p.alignment }, { only: [p.seat] })
    const info = computeKnowledge(players, p.seat)
    emit(game, 'knowledge', { seat: p.seat, ...info }, { only: [p.seat] })
  }

  enterProposalCycle(game)
  return game
}

// ---- phase transitions ----

function speakerOrder(game: Game): Seat[] {
  const n = game.config.playerCount
  return Array.from({ length: n }, (_, i) => (game.leaderSeat + i) % n)
}

function startDiscussion(game: Game, slot: 'pre' | 'post', maxRounds: number): boolean {
  if (maxRounds <= 0) return false
  game.phase = 'discussion'
  game.discussion = {
    slot, remaining: speakerOrder(game), roundNum: 1, maxRounds, anySpoke: false,
  }
  return true
}

function endDiscussion(game: Game): void {
  const slot = game.discussion!.slot
  game.discussion = undefined
  game.phase = slot === 'pre' ? 'proposal' : 'vote'
}

function enterProposalCycle(game: Game): void {
  game.currentTeam = undefined
  game.pendingVotes = {}
  if (!startDiscussion(game, 'pre', game.config.talk.preProposal)) {
    game.phase = 'proposal'
  }
}

function afterProposal(game: Game): void {
  if (!startDiscussion(game, 'post', game.config.talk.postProposal)) {
    game.phase = 'vote'
  }
}

function rotateLeader(game: Game): void {
  game.leaderSeat = (game.leaderSeat + 1) % game.config.playerCount
}

function endGame(game: Game, winner: 'good' | 'evil', reason: string): void {
  game.winner = winner
  game.winReason = reason
  game.phase = 'gameOver'
  game.discussion = undefined
  emit(game, 'gameOver', { winner, reason }, 'public')
}

function assassinSeat(game: Game): Seat | undefined {
  return game.players.find((p) => p.role === 'assassin')?.seat
}

function successCount(game: Game): number {
  return game.quests.filter((q) => q.result === 'success').length
}
function failQuestCount(game: Game): number {
  return game.quests.filter((q) => q.result === 'fail').length
}

// Display-name change, announced as a PUBLIC event so every player — human
// and bot — learns the mapping the same way a table would. All game identity
// is seat-anchored; the name is presentation, so history re-renders under the
// new name automatically (views derive names live from players[seat]).
export function renamePlayer(game: Game, seat: Seat, rawName: string): void {
  const player = game.players[seat]
  if (!player) throw new EngineError(`no player at seat ${seat}`)
  const name = rawName.replace(/\s+/g, ' ').trim().slice(0, 24)
  if (!name) throw new EngineError('name must not be empty')
  const from = player.name
  if (from === name) return
  if (game.players.some((p) => p.seat !== seat && p.name.toLowerCase() === name.toLowerCase())) {
    throw new EngineError(`the name "${name}" is already taken at this table`)
  }
  player.name = name
  game.config.names[seat] = name
  emit(game, 'rename', { seat, from, to: name }, 'public')
}

// ---- the decision surface ----

export function expectedDecisions(game: Game): DecisionRequest[] {
  const base = { round: game.round, proposalNum: game.proposalNum }
  switch (game.phase) {
    case 'discussion':
      return [{ kind: 'discuss', seat: game.discussion!.remaining[0], ...base }]
    case 'proposal':
      return [{ kind: 'propose', seat: game.leaderSeat, ...base }]
    case 'vote':
      return game.players
        .filter((p) => game.pendingVotes[p.seat] === undefined)
        .map((p) => ({ kind: 'vote' as const, seat: p.seat, ...base }))
    case 'quest':
      return game.currentTeam!
        .filter((seat) => game.pendingCards[seat] === undefined)
        .map((seat) => ({ kind: 'quest' as const, seat, ...base }))
    case 'assassination':
      return [{ kind: 'assassinate', seat: assassinSeat(game)!, ...base }]
    case 'gameOver':
      return []
  }
}

export function applyDecision(game: Game, seat: Seat, decision: Decision): Game {
  const expected = expectedDecisions(game)
  const match = expected.find((r) => r.seat === seat && r.kind === decision.kind)
  if (!match) {
    throw new EngineError(
      `unexpected decision ${decision.kind} from seat ${seat} in phase ${game.phase}`,
    )
  }

  if (typeof decision.thinking === 'string' && decision.thinking.trim()) {
    emit(game, 'thinking', {
      seat, kind: decision.kind, text: decision.thinking.trim().slice(0, 900),
    }, { only: [seat] })
  }
  if (typeof decision.notes === 'string' && decision.notes.trim()) {
    emit(game, 'scratchpad', {
      seat, round: game.round, text: decision.notes.trim().slice(0, 900),
    }, { only: [seat] })
  }

  switch (decision.kind) {
    case 'discuss': {
      if (typeof decision.say !== 'string') throw new EngineError('say must be a string')
      const lean = decision.lean
      if (lean !== undefined && lean !== 'approve' && lean !== 'reject' && lean !== 'unsure') {
        throw new EngineError(`invalid lean: ${String(lean)}`)
      }
      const say = decision.say.slice(0, 600)
      const d = game.discussion!
      // A lean is a public signal about the team on the table — only
      // meaningful while a proposal is pending.
      const withLean = lean !== undefined && game.currentTeam ? { lean } : {}
      emit(game, 'utterance', {
        seat, text: say, slot: d.slot, round: d.roundNum, ...withLean,
      }, 'public')
      if (say.trim() !== '') d.anySpoke = true
      d.remaining.shift()
      if (d.remaining.length === 0) {
        // Another round only if this one had any speech and rounds remain —
        // a silent table is done talking.
        if (d.anySpoke && d.roundNum < d.maxRounds) {
          d.roundNum += 1
          d.anySpoke = false
          d.remaining = speakerOrder(game)
        } else {
          endDiscussion(game)
        }
      }
      return game
    }

    case 'propose': {
      const size = game.quests[game.round - 1].teamSize
      const team = decision.team
      if (!Array.isArray(team) || team.length !== size) {
        throw new EngineError(`team must have exactly ${size} members`)
      }
      const seen = new Set<Seat>()
      for (const s of team) {
        if (!Number.isInteger(s) || s < 0 || s >= game.config.playerCount) {
          throw new EngineError(`invalid seat on team: ${s}`)
        }
        if (seen.has(s)) throw new EngineError(`duplicate seat on team: ${s}`)
        seen.add(s)
      }
      game.currentTeam = team.slice().sort((a, b) => a - b)
      emit(game, 'proposal', {
        round: game.round, proposalNum: game.proposalNum,
        leader: seat, team: game.currentTeam,
        ...(typeof decision.pitch === 'string' && decision.pitch.trim()
          ? { pitch: decision.pitch.trim().slice(0, 400) }
          : {}),
      }, 'public')
      afterProposal(game)
      return game
    }

    case 'vote': {
      if (decision.vote !== 'approve' && decision.vote !== 'reject') {
        throw new EngineError(`invalid vote: ${String(decision.vote)}`)
      }
      game.pendingVotes[seat] = decision.vote
      emit(game, 'voteCast', { seat, vote: decision.vote }, { only: [seat] })
      if (Object.keys(game.pendingVotes).length === game.config.playerCount) {
        const votes = game.players.map((p) => ({ seat: p.seat, vote: game.pendingVotes[p.seat] }))
        const approves = votes.filter((v) => v.vote === 'approve').length
        // Official rule: strict majority approves; a tie rejects.
        const approved = approves * 2 > game.config.playerCount
        emit(game, 'voteReveal', {
          round: game.round, proposalNum: game.proposalNum,
          team: game.currentTeam, votes, approved,
        }, 'public')
        game.pendingVotes = {}
        if (approved) {
          game.quests[game.round - 1].team = game.currentTeam!.slice()
          game.pendingCards = {}
          game.phase = 'quest'
        } else if (game.proposalNum >= MAX_PROPOSALS) {
          // Official rule: the 5th rejected proposal in a round ends the game.
          endGame(game, 'evil', 'fiveRejections')
        } else {
          game.proposalNum += 1
          rotateLeader(game)
          enterProposalCycle(game)
        }
      }
      return game
    }

    case 'quest': {
      if (decision.card !== 'success' && decision.card !== 'fail') {
        throw new EngineError(`invalid quest card: ${String(decision.card)}`)
      }
      const player = game.players[seat]
      // Rule, not honor system: good cannot play fail.
      const card = player.alignment === 'good' ? 'success' : decision.card
      game.pendingCards[seat] = card
      emit(game, 'questCard', { seat, card }, { only: [seat] })
      if (Object.keys(game.pendingCards).length === game.currentTeam!.length) {
        const quest = game.quests[game.round - 1]
        const failCount = Object.values(game.pendingCards).filter((c) => c === 'fail').length
        quest.failCount = failCount
        quest.result = failCount >= quest.failsRequired ? 'fail' : 'success'
        emit(game, 'questResult', {
          round: game.round, failCount, result: quest.result,
          failsRequired: quest.failsRequired,
        }, 'public')
        game.pendingCards = {}
        game.currentTeam = undefined

        if (successCount(game) >= QUESTS_TO_WIN) {
          if (assassinSeat(game) !== undefined && game.players.some((p) => p.role === 'merlin')) {
            game.phase = 'assassination'
          } else {
            endGame(game, 'good', 'threeQuests')
          }
        } else if (failQuestCount(game) >= QUESTS_TO_WIN) {
          endGame(game, 'evil', 'threeFails')
        } else {
          game.round += 1
          game.proposalNum = 1
          rotateLeader(game)
          enterProposalCycle(game)
        }
      }
      return game
    }

    case 'assassinate': {
      const target = decision.target
      if (!Number.isInteger(target) || target < 0 || target >= game.config.playerCount) {
        throw new EngineError(`invalid assassination target: ${String(target)}`)
      }
      if (target === seat) throw new EngineError('assassin cannot target self')
      const wasMerlin = game.players[target].role === 'merlin'
      emit(game, 'assassination', { assassin: seat, target, wasMerlin }, 'public')
      endGame(game, wasMerlin ? 'evil' : 'good', wasMerlin ? 'merlinAssassinated' : 'assassinMissed')
      return game
    }
  }
}
