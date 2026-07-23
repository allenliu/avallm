// HTTP-layer tests for the game server. The engine is covered elsewhere; this
// pins the reconnect-support endpoint the client relies on after a refresh:
// GET /api/game/:id/valid — 200 for a live seat, 403 for a wrong token, 404 for
// a game the server no longer has. The client probes this (EventSource can't
// read HTTP status) to tell a real reconnect from a game that's gone.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { server } from '../server/server.ts'

let base: string

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  base = `http://127.0.0.1:${port}`
})

after(async () => {
  server.closeAllConnections?.()
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

// A solo game: humanSeats defaults to 1, four autopilot (rule-based, offline) bots.
async function newSoloGame(): Promise<{ id: string; token: string }> {
  const res = await fetch(`${base}/api/game/new`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      playerCount: 5,
      table: ['autopilot', 'autopilot', 'autopilot', 'autopilot'],
      humanName: 'Tester',
    }),
  })
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.ok(data.id && data.token, 'new game returns id + token')
  return data
}

test('/valid returns 200 for the seat token that started the game', async () => {
  const { id, token } = await newSoloGame()
  const r = await fetch(`${base}/api/game/${id}/valid?token=${token}`)
  assert.equal(r.status, 200)
  assert.deepEqual(await r.json(), { ok: true })
})

test('/valid returns 403 for a wrong token on a live game', async () => {
  const { id } = await newSoloGame()
  const r = await fetch(`${base}/api/game/${id}/valid?token=not-the-real-token`)
  assert.equal(r.status, 403)
})

test('/valid returns 403 when no token is supplied', async () => {
  const { id } = await newSoloGame()
  const r = await fetch(`${base}/api/game/${id}/valid`)
  assert.equal(r.status, 403)
})

test('/valid returns 404 for a game the server does not have', async () => {
  // e.g. after a server restart dropped the in-memory session.
  const r = await fetch(`${base}/api/game/deadbeef99/valid?token=whatever`)
  assert.equal(r.status, 404)
})
