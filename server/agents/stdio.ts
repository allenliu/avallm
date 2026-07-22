// External-agent adapter: newline-delimited JSON over a child process's stdio.
// Protocol:
//   child -> { type: 'hello', capabilities?: { discuss?: boolean } }   (once, on start)
//   us    -> { id, type: 'decide', request, view }
//   child -> { id, decision }
// Agents that declare discuss:false are auto-passed in table-talk rounds.
// Any protocol failure throws from decide(); the runner's fallback ladder
// (heuristic substitute) keeps the game moving.

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { Decision, DecisionRequest, PlayerView } from '../engine/types.ts'
import type { AvalonAgent } from './types.ts'

export interface StdioAgentOpts {
  cmd: string
  args: string[]
  label?: string
  timeoutMs?: number
}

interface Hello {
  type: 'hello'
  capabilities?: { discuss?: boolean }
}

export function createStdioAgent(opts: StdioAgentOpts): AvalonAgent {
  const timeoutMs = opts.timeoutMs ?? 15_000
  const label = opts.label ?? opts.cmd
  let child: ChildProcessWithoutNullStreams | null = null
  let nextId = 1
  const pending = new Map<number, (msg: unknown) => void>()
  let helloPromise: Promise<Hello> | null = null

  function start(): Promise<Hello> {
    if (helloPromise) return helloPromise
    helloPromise = new Promise<Hello>((resolveHello, rejectHello) => {
      const proc = spawn(opts.cmd, opts.args, { stdio: ['pipe', 'pipe', 'pipe'] })
      child = proc
      let helloSeen = false
      proc.on('error', (err) => rejectHello(new Error(`agent "${label}" failed to start: ${err.message}`)))
      proc.on('exit', () => {
        if (!helloSeen) rejectHello(new Error(`agent "${label}" exited before hello`))
        for (const resolve of pending.values()) {
          resolve(new Error(`agent "${label}" exited`))
        }
        pending.clear()
      })
      const rl = createInterface({ input: proc.stdout })
      rl.on('line', (line) => {
        let msg: Record<string, unknown>
        try {
          msg = JSON.parse(line)
        } catch {
          return // ignore non-JSON noise on stdout
        }
        if (msg.type === 'hello' && !helloSeen) {
          helloSeen = true
          resolveHello(msg as unknown as Hello)
          return
        }
        const id = msg.id as number
        const resolve = pending.get(id)
        if (resolve) {
          pending.delete(id)
          resolve(msg)
        }
      })
      const t = setTimeout(() => {
        if (!helloSeen) rejectHello(new Error(`agent "${label}" hello timeout`))
      }, timeoutMs)
      t.unref?.()
    })
    return helloPromise
  }

  return {
    async decide(req: DecisionRequest, view: PlayerView): Promise<Decision> {
      const hello = await start()
      if (req.kind === 'discuss' && hello.capabilities?.discuss === false) {
        return { kind: 'discuss', say: '' }
      }
      const id = nextId++
      const reply = await new Promise<unknown>((resolve, reject) => {
        pending.set(id, resolve)
        const t = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`agent "${label}" timed out on ${req.kind}`))
        }, timeoutMs)
        t.unref?.()
        child!.stdin.write(JSON.stringify({ id, type: 'decide', request: req, view }) + '\n')
      })
      if (reply instanceof Error) throw reply
      const decision = (reply as Record<string, unknown>).decision as Decision | undefined
      if (!decision || decision.kind !== req.kind) {
        throw new Error(`agent "${label}" returned invalid decision for ${req.kind}`)
      }
      return decision
    },
    dispose() {
      child?.kill()
      child = null
    },
  }
}
