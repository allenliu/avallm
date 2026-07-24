// Interactive CLI play: you at seat 0, heuristic bots elsewhere.
//   node server/sim/play.ts --players 7 --seed mygame
// Milestone-1 exit criterion: a human can play a full game against heuristics.

import { parseArgs } from 'node:util'
import { createInterface } from 'node:readline'
import { createGame } from '../engine/game.ts'
import { teamsEqual } from '../engine/rules.ts'
import { eventVisibleTo } from '../engine/view.ts'
import { createHeuristicAgent } from '../agents/heuristic.ts'
import { runGame } from './runner.ts'
import { renderEvent, revealRoles } from './render.ts'
import type { AvalonAgent } from '../agents/types.ts'
import type { Decision, DecisionRequest, PlayerView, Seat } from '../engine/types.ts'

const { values } = parseArgs({
  options: {
    players: { type: 'string', default: '7' },
    seed: { type: 'string', default: `play-${Math.floor(Math.random() * 1e9)}` },
  },
})

const playerCount = Number(values.players)
const HUMAN: Seat = 0

// Line-queue instead of rl.question: readline drops lines that arrive while
// no question is pending, which breaks scripted/piped play (the smoke test).
const rl = createInterface({ input: process.stdin })
const lineQueue: string[] = []
const waiters: ((s: string) => void)[] = []
let stdinClosed = false
rl.on('line', (raw) => {
  const line = raw.replace(/^﻿/, '').replace(/\r$/, '')
  const w = waiters.shift()
  if (w) w(line)
  else lineQueue.push(line)
})
rl.on('close', () => {
  stdinClosed = true
  for (const w of waiters.splice(0)) w('')
})
function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt)
  const queued = lineQueue.shift()
  if (queued !== undefined) {
    process.stdout.write(queued + '\n')
    return Promise.resolve(queued)
  }
  if (stdinClosed) throw new Error('stdin closed before the game finished')
  return new Promise((resolve) => waiters.push(resolve))
}

const names = ['Human', 'DeepSeek', 'Gemini', 'Haiku', 'Kimi', 'Qwen', 'GLM', 'Mistral', 'GPT', 'Llama']
  .slice(0, playerCount)

const game = createGame({
  seed: values.seed!, playerCount, names,
  talk: { maxRounds: 1, maxRoundsAfterChange: 1 },
})

function questBoard(view: PlayerView): string {
  const discs = view.quests.map((q) => {
    if (q.result === 'success') return ` [${q.teamSize}✓]`
    if (q.result === 'fail') return ` [${q.teamSize}✗]`
    return ` [${q.teamSize}${q.failsRequired === 2 ? '*' : ' '}]`
  }).join('')
  return `Quests:${discs}   proposal ${view.proposalNum}/5`
}

async function askHuman(req: DecisionRequest, view: PlayerView): Promise<Decision> {
  console.log('\n--- ' + questBoard(view))
  switch (req.kind) {
    case 'discuss': {
      const say = await ask('Your table talk (enter to pass): ')
      if (view.currentTeam && view.leaderSeat !== HUMAN) {
        const raw = (await ask('Your lean on the team (a=approve, r=reject, u=unsure, enter to skip): ')).trim().toLowerCase()
        const lean = raw.startsWith('a') ? 'approve' as const
          : raw.startsWith('r') ? 'reject' as const
          : raw.startsWith('u') ? 'unsure' as const : undefined
        return { kind: 'discuss', say, lean }
      }
      return { kind: 'discuss', say }
    }
    case 'propose': {
      const size = view.quests[view.round - 1].teamSize
      const roster = view.players.map((p) => `${p.seat}=${p.name}`).join(' ')
      while (true) {
        const raw = await ask(`You lead. Pick ${size} seats (${roster}), comma-separated: `)
        const team = raw.split(/[\s,]+/).filter(Boolean).map(Number)
        if (team.length === size && team.every((s) => Number.isInteger(s) && s >= 0 && s < playerCount)
          && new Set(team).size === size) {
          return { kind: 'propose', team }
        }
        console.log(`Need exactly ${size} distinct valid seats.`)
      }
    }
    case 'finalize': {
      const team = (view.currentTeam ?? []).map((s) => view.players[s].name).join(', ')
      const raw = (await ask(`Your team [${team}] — enter to lock it in, or type a new comma-separated team: `)).trim()
      if (!raw) return { kind: 'finalize', stick: true }
      const size = view.quests[view.round - 1].teamSize
      let input = raw
      while (true) {
        const team2 = input.split(/[\s,]+/).filter(Boolean).map(Number)
        const identical = teamsEqual(team2, view.currentTeam ?? [])
        if (!identical && team2.length === size
          && team2.every((s) => Number.isInteger(s) && s >= 0 && s < playerCount)
          && new Set(team2).size === size) {
          const reason = await ask('One sentence to the table on why you changed: ')
          return { kind: 'finalize', stick: false, team: team2, reason }
        }
        const retry = (await ask(`Need ${size} distinct valid seats, different from the current team (enter to lock instead): `)).trim()
        if (!retry) return { kind: 'finalize', stick: true }
        input = retry
      }
    }
    case 'vote': {
      const team = (view.currentTeam ?? []).map((s) => view.players[s].name).join(', ')
      while (true) {
        const raw = (await ask(`Vote on [${team}] (a=approve, r=reject): `)).trim().toLowerCase()
        if (raw.startsWith('a')) return { kind: 'vote', vote: 'approve' }
        if (raw.startsWith('r')) return { kind: 'vote', vote: 'reject' }
      }
    }
    case 'quest': {
      if (view.alignment === 'good') {
        console.log('You are on the quest. Good must play Success — played.')
        return { kind: 'quest', card: 'success' }
      }
      while (true) {
        const raw = (await ask('Quest card (s=success, f=fail): ')).trim().toLowerCase()
        if (raw.startsWith('s')) return { kind: 'quest', card: 'success' }
        if (raw.startsWith('f')) return { kind: 'quest', card: 'fail' }
      }
    }
    case 'assassinate': {
      const roster = view.players.filter((p) => p.seat !== view.seat)
        .map((p) => `${p.seat}=${p.name}`).join(' ')
      while (true) {
        const raw = await ask(`ASSASSINATE — who is Merlin? (${roster}): `)
        const target = Number(raw.trim())
        if (Number.isInteger(target) && target >= 0 && target < playerCount && target !== view.seat) {
          return { kind: 'assassinate', target }
        }
      }
    }
  }
}

const humanAgent: AvalonAgent = { decide: askHuman }
const agents = new Map<Seat, AvalonAgent>(
  game.players.map((p) => [
    p.seat,
    p.seat === HUMAN ? humanAgent : createHeuristicAgent({ seed: game.seed, seat: p.seat }),
  ]),
)

// Role card.
{
  const me = game.players[HUMAN]
  console.log(`\nYou are ${me.role.toUpperCase()} (${me.alignment}).`)
  const knowledge = game.log.find((ev) => ev.type === 'knowledge' && (ev.payload.seat as Seat) === HUMAN)!
  const info = knowledge.payload as Record<string, Seat[] | undefined>
  const label = (seats?: Seat[]) => seats?.map((s) => `${names[s]}(${s})`).join(', ')
  if (info.knownEvil?.length) console.log(`You see evil: ${label(info.knownEvil as Seat[])}`)
  if (info.evilPartners?.length) console.log(`Your fellow evil: ${label(info.evilPartners as Seat[])}`)
  if (info.merlinCandidates?.length) console.log(`Merlin is one of: ${label(info.merlinCandidates as Seat[])}`)
}

const result = await runGame({
  game, agents,
  onEvent: (ev) => {
    if (!eventVisibleTo(ev, HUMAN)) return
    if (ev.type === 'roleDealt' || ev.type === 'knowledge' || ev.type === 'voteCast' || ev.type === 'questCard') return
    const line = renderEvent(ev, game)
    if (line) console.log(line)
  },
})

console.log('\n' + revealRoles(result.game))
rl.close()
