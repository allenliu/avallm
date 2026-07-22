// Rule-based agent, distilled from docs/research-strategy.md §5 (Bot Playbook).
// Doubles as the runtime fallback when any other agent fails, so the pure
// function form (heuristicDecide) is exported separately from the class.
//
// Stateless by design: every decision is derived fresh from the view. Seeded:
// same seed + same view => same decision (replay determinism).

import { makeRng, fnv1a } from '../engine/prng.ts'
import type { Rng } from '../engine/prng.ts'
import { MAX_PROPOSALS, QUESTS_TO_WIN } from '../engine/rules.ts'
import type { Decision, DecisionRequest, PlayerView, Seat } from '../engine/types.ts'
import type { AgentContext, AvalonAgent } from './types.ts'

// ---- shared analysis helpers ----

function knownEvilSeats(view: PlayerView): Set<Seat> {
  const s = new Set<Seat>()
  if (view.alignment === 'evil') {
    s.add(view.seat)
    for (const p of view.privateInfo.evilPartners ?? []) s.add(p)
  }
  for (const p of view.privateInfo.knownEvil ?? []) s.add(p)
  return s
}

// Suspicion per seat, from public evidence + private knowledge.
function suspicion(view: PlayerView): number[] {
  const n = view.playerCount
  const score = new Array<number>(n).fill(0)
  const evil = knownEvilSeats(view)
  for (const s of evil) score[s] += 10
  for (const q of view.quests) {
    if (!q.team || q.result === undefined || q.failCount === undefined) continue
    for (const s of q.team) {
      if (s === view.seat) continue
      // A failed quest is hard evidence: weight it so burned players actually
      // get excluded (fail-count inference, strategy doc §1).
      if (q.result === 'fail') score[s] += 4 * (q.failCount / q.team.length)
      else score[s] -= 0.5
    }
  }
  // Vote-pattern inference (strategy doc: the vote matrix is the game's
  // primary text): who led and who approved the teams that went on to fail?
  for (const prop of view.proposals) {
    if (!prop.approved) continue
    const quest = view.quests[prop.round - 1]
    if (quest.result !== 'fail') continue
    if (prop.leader !== view.seat) score[prop.leader] += 1.5
    for (const v of prop.votes ?? []) {
      if (v.seat === view.seat || v.vote !== 'approve') continue
      if (!prop.team.includes(v.seat)) score[v.seat] += 0.4
    }
  }
  score[view.seat] = -100 // trust thyself
  return score
}

function rankBySuspicion(view: PlayerView): Seat[] {
  const s = suspicion(view)
  return view.players
    .map((p) => p.seat)
    .sort((a, b) => s[a] - s[b])
}

function successesSoFar(view: PlayerView): number {
  return view.quests.filter((q) => q.result === 'success').length
}
function failsSoFar(view: PlayerView): number {
  return view.quests.filter((q) => q.result === 'fail').length
}

// ---- per-kind decisions ----

function decidePropose(view: PlayerView, rng: Rng): Decision {
  const size = view.quests[view.round - 1].teamSize
  const ranked = rankBySuspicion(view).filter((s) => s !== view.seat)
  const team: Seat[] = [view.seat]
  if (view.alignment === 'evil') {
    // Look clean: self + the most trusted-looking non-partners.
    const partners = new Set(view.privateInfo.evilPartners ?? [])
    const clean = ranked.filter((s) => !partners.has(s))
    team.push(...clean.slice(0, size - 1))
    // Backfill from partners if the table is small.
    for (const s of ranked) {
      if (team.length >= size) break
      if (!team.includes(s)) team.push(s)
    }
  } else {
    team.push(...ranked.slice(0, size - 1))
  }
  return { kind: 'propose', team: rng.shuffle(team) }
}

function decideVote(view: PlayerView, rng: Rng): Decision {
  const team = view.currentTeam ?? []
  const isHammer = view.proposalNum >= MAX_PROPOSALS
  const evil = knownEvilSeats(view)
  const teamHasKnownEvil = team.some((s) => evil.has(s) && s !== view.seat)
  const selfOnTeam = team.includes(view.seat)

  if (view.alignment === 'evil') {
    const teamHasAnyEvil = team.some((s) => evil.has(s))
    if (isHammer) {
      // Rejecting the hammer wins for evil — but only take the obvious win
      // when the team is clean; an evil-carrying team is a safer route.
      return { kind: 'vote', vote: teamHasAnyEvil ? 'approve' : 'reject' }
    }
    if (teamHasAnyEvil) return { kind: 'vote', vote: 'approve' }
    return { kind: 'vote', vote: rng.chance(0.2) ? 'approve' : 'reject' }
  }

  // Good. Never reject the hammer — 5th rejection is an instant loss.
  if (isHammer) return { kind: 'vote', vote: 'approve' }
  if (teamHasKnownEvil) {
    // Merlin caps its accuracy: sometimes lets a bad team through as cover
    // (near-perfect voting is the assassin's #1 tell, strategy doc §3).
    const isMerlin = view.role === 'merlin'
    if (isMerlin && rng.chance(0.25)) return { kind: 'vote', vote: 'approve' }
    return { kind: 'vote', vote: 'reject' }
  }
  // Merlin also throws occasional wrong-way rejects on clean teams as cover.
  if (view.role === 'merlin' && rng.chance(0.15)) return { kind: 'vote', vote: 'reject' }
  if (view.round === 1) return { kind: 'vote', vote: 'approve' }
  const sus = suspicion(view)
  const worst = Math.max(...team.map((s) => sus[s]))
  if (worst >= 1.2) return { kind: 'vote', vote: 'reject' } // someone burned is on it
  if (selfOnTeam) return { kind: 'vote', vote: 'approve' }
  // Off-team: at small counts the evil bloc + one lenient good passes any
  // team, so good must default to rejecting teams it's not on (strategy doc
  // §1) unless every member is proven by a succeeded quest.
  if (worst < -0.3) return { kind: 'vote', vote: 'approve' }
  const p = view.playerCount <= 6 ? 0.25 : 0.4
  return { kind: 'vote', vote: rng.chance(p) ? 'approve' : 'reject' }
}

function decideQuest(view: PlayerView, rng: Rng): Decision {
  if (view.alignment === 'good') return { kind: 'quest', card: 'success' }

  const quest = view.quests[view.round - 1]
  const team = view.currentTeam ?? quest.team ?? []
  const partners = new Set(view.privateInfo.evilPartners ?? [])
  const evilOnTeam = team.filter((s) => s === view.seat || partners.has(s))
  const mustFail =
    failsSoFar(view) === QUESTS_TO_WIN - 1 ||       // failing now wins for evil
    successesSoFar(view) === QUESTS_TO_WIN - 1      // success now wins for good

  // Deterministic anti-double-fail convention: when one fail suffices and
  // several known evil are on the team, only the lowest seat plays fail.
  // (Oberon can't coordinate and just uses the probabilities.)
  const designated = evilOnTeam.length > 0 ? Math.min(...evilOnTeam) : view.seat
  const iAmDesignated =
    quest.failsRequired >= 2 || evilOnTeam.length <= 1 || designated === view.seat

  if (mustFail) return { kind: 'quest', card: iAmDesignated ? 'fail' : 'success' }
  if (!iAmDesignated) return { kind: 'quest', card: 'success' }

  // Empirical fail rates (strategy doc appendix): tiny teams rarely fail early.
  let p: number
  if (team.length === 2) p = 0.15
  else if (view.round === 1) p = 0.4
  else p = 0.55
  return { kind: 'quest', card: rng.chance(p) ? 'fail' : 'success' }
}

function decideAssassinate(view: PlayerView, rng: Rng): Decision {
  // The strategy doc's #1 signal: vote accuracy. Score each candidate by how
  // often their vote matched the "correct" call given the assassin's knowledge.
  const evil = knownEvilSeats(view)
  const candidates = view.players.map((p) => p.seat).filter((s) => !evil.has(s))
  const score = new Map<Seat, number>(candidates.map((s) => [s, 0]))
  for (const prop of view.proposals) {
    if (!prop.votes) continue
    const teamHadEvil = prop.team.some((s) => evil.has(s))
    const correct = teamHadEvil ? 'reject' : 'approve'
    for (const v of prop.votes) {
      if (score.has(v.seat) && v.vote === correct) {
        score.set(v.seat, score.get(v.seat)! + 1)
      }
    }
  }
  let best: Seat[] = []
  let bestScore = -1
  for (const [s, sc] of score) {
    if (sc > bestScore) { bestScore = sc; best = [s] }
    else if (sc === bestScore) best.push(s)
  }
  return { kind: 'assassinate', target: best.length ? rng.pick(best) : rng.pick(candidates) }
}

function decideDiscuss(view: PlayerView, rng: Rng): Decision {
  if (rng.chance(0.3)) return { kind: 'discuss', say: '' } // passing is natural
  const sus = suspicion(view)
  const nameOf = (s: Seat) => view.players[s].name

  if (view.alignment === 'evil') {
    // Blend in: cast vague doubt on a non-partner, or play it cool.
    const partners = knownEvilSeats(view)
    const marks = view.players.map((p) => p.seat).filter((s) => !partners.has(s))
    const lines = [
      `Something feels off about ${nameOf(rng.pick(marks))}.`,
      `I'm comfortable with how this is shaping up.`,
      `No strong reads from me yet.`,
    ]
    return { kind: 'discuss', say: rng.pick(lines) }
  }

  const ranked = view.players.map((p) => p.seat).filter((s) => s !== view.seat)
    .sort((a, b) => sus[b] - sus[a])
  const worst = ranked[0]
  const trusted = ranked[ranked.length - 1]
  if (sus[worst] > 1) {
    return { kind: 'discuss', say: `I don't trust ${nameOf(worst)}.` }
  }
  const lines = [
    `I'd feel better with ${nameOf(trusted)} on this one.`,
    `Watch the votes closely this round.`,
    `No strong reads from me yet.`,
  ]
  return { kind: 'discuss', say: rng.pick(lines) }
}

// ---- entry points ----

export function heuristicDecide(
  req: DecisionRequest, view: PlayerView, seed: string,
): Decision {
  // Fresh RNG per decision, keyed by seed+seat+log position: deterministic
  // on replay, varied across a game.
  const rng = makeRng(fnv1a(`${seed}:${req.seat}:${view.events.length}:${req.kind}`))
  switch (req.kind) {
    case 'discuss': return decideDiscuss(view, rng)
    case 'propose': return decidePropose(view, rng)
    case 'vote': return decideVote(view, rng)
    case 'quest': return decideQuest(view, rng)
    case 'assassinate': return decideAssassinate(view, rng)
  }
}

export function createHeuristicAgent(ctx: AgentContext): AvalonAgent {
  return {
    decide: async (req, view) => heuristicDecide(req, view, ctx.seed),
  }
}
