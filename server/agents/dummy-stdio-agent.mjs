// Minimal external agent speaking the stdio protocol. Used by test/stdio.test.ts
// to prove the plugin boundary works end to end. Plays naive-but-legal Avalon.
import { createInterface } from 'node:readline'

process.stdout.write(JSON.stringify({ type: 'hello', capabilities: { discuss: false } }) + '\n')

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.type !== 'decide') return
  const { request, view } = msg
  let decision
  switch (request.kind) {
    case 'discuss':
      decision = { kind: 'discuss', say: '' }
      break
    case 'propose': {
      const size = view.quests[view.round - 1].teamSize
      const team = [view.seat]
      for (const p of view.players) {
        if (team.length >= size) break
        if (p.seat !== view.seat) team.push(p.seat)
      }
      decision = { kind: 'propose', team }
      break
    }
    case 'finalize':
      decision = { kind: 'finalize', stick: true }
      break
    case 'vote':
      decision = { kind: 'vote', vote: 'approve' }
      break
    case 'quest':
      decision = { kind: 'quest', card: view.alignment === 'evil' ? 'fail' : 'success' }
      break
    case 'assassinate': {
      const target = view.players.map((p) => p.seat).find((s) => s !== view.seat)
      decision = { kind: 'assassinate', target }
      break
    }
  }
  process.stdout.write(JSON.stringify({ id: msg.id, decision }) + '\n')
})
