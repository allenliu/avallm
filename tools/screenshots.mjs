// Screenshot gallery: captures every hard-to-reach UI state into docs/screens/
// so design commits have a clear before/after. Run on demand (not per commit):
//
//   npm --prefix client run build        # gallery shoots the built client
//   node tools/screenshots.mjs           # ~3-4 min; spawns its own server
//
// Chrome is expected at the default Windows path (or set CHROME env var).
// Puppeteer-core comes from client/node_modules (the client owns npm deps;
// the server stays zero-dependency). Games are NOT seeded — the server derives
// hidden roles from its seed, so a client-chosen seed would leak information.
// Layout, not pixels, is what these are for.
//
// Covered: setup (default/rules/agent form), a full autopilot playthrough
// (discuss=reacting to a proposed team, vote, propose, quest, Record + Codex
// sheets, reveal, thinking), the error/reconnect banner (forced via a dev-only
// SSE-sever hook — see disconnectRun / AVALON_DEV_SEVER below), lobby host view,
// join screen, and an in-game spectator — desktop 1280x800 and mobile 390x844
// (multiplayer set: desktop only). Plus a fixture component gallery
// (docs/screens/components/) for the role cards and action states a live deal
// only reaches by luck — see client/src/gallery.tsx.
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXPECTED } from './screens-expected.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'client', 'package.json'))
const puppeteer = require('puppeteer-core')

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
// PORT/BASE are mutable: a prior run's server can orphan and hold the port (a killed
// child isn't always reaped promptly on Windows), so we probe for a free one at startup.
let PORT = Number(process.env.PORT ?? 18917)
let BASE = `http://localhost:${PORT}`
const OUT = path.join(root, 'docs', 'screens')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Every shot written this run, keyed like EXPECTED (`desktop/setup.jpg`), so the
// end-of-run manifest can flag missing shots — required (harness broke) vs.
// optional (luck-of-the-deal deal never surfaced the state).
const produced = new Set()
const record = (file) => produced.add(path.relative(OUT, file).split(path.sep).join('/'))

// ---------- helpers ----------
// A button's action label. Prefer `.ptx-plain` (the plain verdict, e.g. "Approve")
// over `.pt` — the vote/quest cards wrap `.pt` around both an arcanum name and the
// verdict (".pt > .ptx-arc 'The Chariot' + .ptx-plain 'Approve'"), so reading `.pt`
// whole yields "The ChariotApprove". Fall back to `.pt`, then the button text.
async function clickByText(page, text) {
  const ok = await page.evaluate((text) => {
    const label = (e) => (e.querySelector?.('.ptx-plain') ?? e.querySelector?.('.pt') ?? e).textContent.trim()
    const el = [...document.querySelectorAll('button')].find((e) => label(e) === text)
    if (el) { el.click(); return true }
    return false
  }, text)
  if (!ok) throw new Error(`no button "${text}"`)
}
// Click an action-bar control by its stable `data-t` hook (see ActionBar.tsx). The
// in-game action rail is redesigned often, so it exposes data-* automation anchors;
// prefer these over button copy/classes there. clickByText stays for the setup,
// lobby, sheet, and reveal UIs, whose plain labels have been stable.
async function clickT(page, t) {
  const ok = await page.evaluate((t) => {
    const el = document.querySelector(`.action-bar [data-t="${t}"]`)
    if (el) { el.click(); return true }
    return false
  }, t)
  if (!ok) throw new Error(`no action-bar [data-t="${t}"]`)
}
async function typeInto(page, selector, value) {
  await page.evaluate((selector, value) => {
    const input = document.querySelector(selector)
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, selector, value)
}
function shooter(page, dir) {
  fs.mkdirSync(dir, { recursive: true })
  return async (name, fullPage = false) => {
    const file = path.join(dir, `${name}.jpg`)
    await page.screenshot({ path: file, type: 'jpeg', quality: 82, fullPage })
    record(file)
    console.log('shot:', path.relative(root, file))
  }
}

// ---------- solo playthrough (setup + every game phase) ----------
async function soloRun(browser, viewportName, viewport) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport(viewport)
  const shot = shooter(page, path.join(OUT, viewportName))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[placeholder="You"]', { timeout: 15000 })
  await sleep(400)

  // Engage a per-seat model override on the first LLM seat before the shot, so
  // the setup capture shows the override control actually in use — a plain
  // "default — …" row sits right below it for contrast. The control is present
  // by default, but only an engaged one makes the feature legible in the gallery.
  await page.evaluate(() => {
    const sel = document.querySelector('.model-override')
    if (sel && sel.options.length > 1) {
      sel.value = sel.options[1].value
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    }
  })
  await sleep(150)
  await shot('setup', true)
  await clickByText(page, 'How do you play Avalon?')
  await sleep(200)
  await shot('setup-rules', true)
  await clickByText(page, 'Hide the rules')
  await clickByText(page, '+ Inscribe your own agent')
  await sleep(200)
  await shot('setup-agent-form', true)
  await clickByText(page, 'Cancel')
  await typeInto(page, 'input[placeholder="You"]', 'Allen')
  await clickByText(page, 'Autopilot (free)')
  await sleep(200)
  await clickByText(page, 'Sit down at the table')
  await page.waitForSelector('.game', { timeout: 15000 })
  await sleep(600)
  await shot('game-start')

  const seen = new Set()
  let saidSomething = false
  let discussIsReact = false // whether discuss.jpg is the (preferred) react-to-team frame yet
  let rejectedOnce = false
  let modalsDone = false
  const deadline = Date.now() + 4 * 60 * 1000
  while (Date.now() < deadline) {
    await sleep(350)
    const st = await page.evaluate(() => {
      const bar = document.querySelector('.action-bar')
      return {
        // `data-kind` is the stable phase hook (ActionBar.tsx): waiting | discuss |
        // propose | finalize | vote | quest | assassinate. null = the bar isn't up yet.
        kind: bar?.dataset.kind ?? null,
        hasInput: !!bar?.querySelector('input'),
        teamPending: !!bar?.querySelector('[data-t="lean-approve"]'),
        reveal: !!document.querySelector('.reveal'),
      }
    })
    if (st.reveal) {
      await sleep(3500) // let the deal-and-flip finish
      await shot('reveal', true)
      await clickByText(page, 'Show what they were really thinking')
      await sleep(400)
      await shot('reveal-thinking', true)
      break
    }
    if (st.kind === 'waiting') {
      // bots deciding while we wait — capture the transient live-edge indicators
      const kind = await page.evaluate(() => {
        if (document.querySelector('.assassin-beat')) return 'assassin-beat'
        if (document.querySelector('.feed-row.qseal')) return 'quest-ballot'
        if (document.querySelector('.feed-row.ballot')) return 'vote-ballot'
        if (document.querySelector('.thinking-row')) return 'discuss-thinking'
        return null
      })
      if (kind && !seen.has(kind)) { seen.add(kind); await shot(kind) }
      continue
    }
    if (!st.kind) continue // action bar not up yet

    if (!modalsDone && seen.size >= 2) {
      modalsDone = true
      await clickByText(page, 'Record')
      await sleep(300)
      await shot('record-sheet', true)
      await page.evaluate(() => document.querySelector('.ref-close')?.click())
      await sleep(200)
      await clickByText(page, 'Codex')
      await sleep(300)
      await shot('codex-sheet', true)
      await page.evaluate(() => document.querySelector('.ref-close')?.click())
      await sleep(200)
    }

    if (st.kind === 'vote') {
      if (!seen.has('vote')) { seen.add('vote'); await shot('vote') }
      if (!seen.has('vote-ballot') && await page.$('.feed-row.ballot')) { seen.add('vote-ballot'); await shot('vote-ballot') }
      // Reject the first proposal (to exercise a re-vote), approve the rest.
      if (!rejectedOnce) { rejectedOnce = true; await clickT(page, 'vote-reject') }
      else await clickT(page, 'vote-approve')
    } else if (st.kind === 'quest') {
      // Good sees only Success; evil sees Success + Fail. Always play Success so the
      // game keeps moving (the Fail card's presence is captured by the fixture gallery).
      if (!seen.has('quest')) { seen.add('quest'); await shot('quest-card') }
      if (!seen.has('quest-ballot') && await page.$('.feed-row.qseal')) { seen.add('quest-ballot'); await shot('quest-ballot') }
      await clickT(page, 'quest-success')
    } else if (st.kind === 'propose') {
      const size = await page.evaluate(() => {
        const m = document.querySelector('.action-label')?.textContent.match(/pick (\d+)/)
        return m ? Number(m[1]) : 2
      })
      await page.evaluate((size) => {
        const picks = [...document.querySelectorAll('.action-bar [data-t="seat-pick"]')]
        for (let i = 0; i < size && i < picks.length; i++) picks[i].click()
      }, size)
      await sleep(150)
      if (!seen.has('propose')) { seen.add('propose'); await shot('propose') }
      await clickT(page, 'propose')
    } else if (st.kind === 'finalize') {
      // The leader's one-time stick-or-change turn after discussion winds down.
      // Keep the team so the run stays on rails; the revise picker itself is
      // covered deterministically by the fixture gallery (act-finalize).
      if (!seen.has('finalize')) { seen.add('finalize'); await shot('finalize') }
      await clickT(page, 'finalize-stick')
    } else if (st.kind === 'assassinate') {
      await page.evaluate(() => document.querySelector('.action-bar [data-t="seat-pick"]')?.click())
      await sleep(150)
      if (!seen.has('assassinate')) { seen.add('assassinate'); await shot('assassinate') }
      await clickT(page, 'assassinate')
    } else if (st.kind === 'discuss') {
      // discuss.jpg prefers the react-to-team frame (lean picker ✓/✕/? engaged,
      // which the plain opening turn — identical to game-start — lacks), but must
      // ALWAYS exist so the required-shot check can't spuriously fail: capture the
      // plain turn as a fallback on first sight, then upgrade in place once a team
      // is on the table. In the common case the upgrade lands; only a run that never
      // reaches a post-proposal turn keeps the plain (game-start-like) fallback.
      if (!discussIsReact) {
        if (st.teamPending) {
          await clickT(page, 'lean-approve')
          await sleep(120)
          await shot('discuss')
          discussIsReact = true
        } else if (!seen.has('discuss')) {
          seen.add('discuss')
          await shot('discuss')
        }
      }
      if (!saidSomething) {
        saidSomething = true
        await typeInto(page, '.action-bar input', "I'm just a humble servant — watch the votes with me.")
        await sleep(100)
        await clickT(page, 'say')
      } else {
        // "pass" submits an empty utterance (its label is "Pass", or "Signal only"
        // once a lean is engaged) — click by data-t so neither label nor class matters.
        await clickT(page, 'pass')
      }
    }
  }
  await ctx.close()
}

// ---------- multiplayer: lobby, join, spectator ----------
async function lobbyRun(browser) {
  const shotDir = path.join(OUT, 'desktop')
  const hostCtx = await browser.createBrowserContext()
  const host = await hostCtx.newPage()
  await host.setViewport({ width: 1280, height: 800 })
  await host.goto(BASE, { waitUntil: 'domcontentloaded' })
  await host.waitForSelector('input[placeholder="You"]', { timeout: 15000 })
  await sleep(300)
  await typeInto(host, 'input[placeholder="You"]', 'Allen')
  await host.evaluate(() => {
    const humans = [...document.querySelectorAll('select')][1]
    humans.value = '2'
    humans.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await sleep(200)
  await clickByText(host, 'Autopilot (free)')
  await sleep(200)
  await clickByText(host, 'Create lobby & get invite link')
  await host.waitForSelector('.join-url', { timeout: 10000 })
  const joinUrl = await host.$eval('.join-url', (el) => el.textContent.trim())
  await sleep(900) // let the invite panels' staggered page-load reveal settle
  await shooter(host, shotDir)('lobby-host')

  const playerCtx = await browser.createBrowserContext()
  const player = await playerCtx.newPage()
  await player.setViewport({ width: 1280, height: 800 })
  await player.goto(joinUrl, { waitUntil: 'domcontentloaded' })
  await player.waitForSelector('input[placeholder="Player"]', { timeout: 15000 })
  await sleep(900) // let the invite panels' staggered page-load reveal settle
  await shooter(player, shotDir)('join-screen')
  await typeInto(player, 'input[placeholder="Player"]', 'Bea')
  await clickByText(player, 'Take a seat')
  await player.waitForSelector('.game', { timeout: 15000 })

  const specCtx = await browser.createBrowserContext()
  const spec = await specCtx.newPage()
  await spec.setViewport({ width: 1280, height: 800 })
  await spec.goto(joinUrl, { waitUntil: 'domcontentloaded' })
  await spec.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Spectate'),
    { timeout: 15000 })
  await sleep(300)
  await clickByText(spec, 'Spectate')
  await spec.waitForSelector('.game', { timeout: 15000 })
  await sleep(1500)
  await shooter(spec, shotDir)('spectator')
  await hostCtx.close(); await playerCtx.close(); await specCtx.close()
}

// ---------- reconnect banner: force an SSE drop via the dev-only sever hook ----------
// The floating "connection lost — reconnecting…" toast only appears when a live SSE
// stream drops, which no natural playthrough moment produces. The harness server runs
// with AVALON_DEV_SEVER=1, which unlocks POST /api/game/:id/dev/sever: it closes this
// seat's stream and refuses its reconnect (503) so the banner holds still for the shot.
// Runs in a throwaway context per viewport — severing kills the game, so it can't
// share the soloRun page. Both viewports, mirroring the other transient captures.
async function disconnectRun(browser, viewportName, viewport) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport(viewport)
  const shot = shooter(page, path.join(OUT, viewportName))
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input[placeholder="You"]', { timeout: 15000 })
  await sleep(300)
  await typeInto(page, 'input[placeholder="You"]', 'Allen')
  await clickByText(page, 'Autopilot (free)')
  await sleep(200)
  await clickByText(page, 'Sit down at the table')
  await page.waitForSelector('.game', { timeout: 15000 })
  await sleep(600)
  // Sever from inside the page: it owns the game id (URL hash) and seat token
  // (localStorage key avalon-game-token-<id>), so nothing has to thread through Node.
  const severed = await page.evaluate(async () => {
    const id = location.hash.replace('#/game/', '')
    const token = localStorage.getItem(`avalon-game-token-${id}`)
    if (!id || !token) return false
    const r = await fetch(`/api/game/${id}/dev/sever?token=${encodeURIComponent(token)}`, { method: 'POST' })
    return r.ok
  })
  if (!severed) throw new Error('dev sever hook failed — is AVALON_DEV_SEVER=1 set on the server?')
  // The closed stream trips EventSource.onerror → the banner mounts; wait for it
  // (not a fixed sleep) so a slow drop can't hand back a banner-less shot.
  await page.waitForSelector('footer .error', { timeout: 5000 })
  await sleep(250) // let the lay-in + comet pulse settle
  await shot('reconnect-banner')
  await ctx.close()
}

// ---------- component gallery (fixture-driven, luck-of-the-deal states) ----------
async function galleryRun(browser) {
  const dir = path.join(OUT, 'components')
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 })
  await page.goto(`${BASE}/gallery.html`, { waitUntil: 'networkidle0' })
  // The gallery publishes its own variant list — the harness never hard-codes it,
  // so adding a fixture in gallery.tsx is enough to get it shot here. Wait for the
  // module to populate it rather than reading right after networkidle0 (the module
  // sets it at eval, but that can land a beat after the goto resolves).
  await page.waitForFunction(() => window.__VARIANTS__?.length > 0, { timeout: 10000 })
    .catch(() => { throw new Error('gallery.html exposed no __VARIANTS__ — is the client built?') })
  const variants = await page.evaluate(() => window.__VARIANTS__)
  fs.mkdirSync(dir, { recursive: true })
  for (const { id, sel, hover } of variants) {
    await page.mouse.move(0, 0) // drop any hover carried over from the previous variant
    await page.evaluate((id) => { window.location.hash = id }, id)
    // Barrier: wait until the stage reports THIS variant is mounted. A fixed sleep
    // plus a shared crop selector (.role-card / .fartable) could otherwise hand back
    // the previous variant's still-present node and shoot stale content.
    await page.waitForSelector(`.gallery-stage[data-variant="${id}"]`, { timeout: 5000 })
    const el = await page.waitForSelector(sel, { timeout: 5000 })
    // The reveal spread flips its cards in with staggered delays (~3s for a full
    // table); let them land face-up before the shot, like the live reveal capture.
    if (id.startsWith('reveal')) await sleep(3300)
    if (hover) { await page.hover(hover); await sleep(150) } // reveal the hover-only tooltip
    const file = path.join(dir, `${id}.jpg`)
    await el.screenshot({ path: file, type: 'jpeg', quality: 82 })
    record(file)
    console.log('shot:', path.relative(root, file))
  }
  await ctx.close()
}

// ---------- source fingerprint (regenerate-only-on-visual-change support) ----------
// A hash of everything that affects how the client renders — the gallery is a
// layout/design diff, so a run is only worth its ~5 min when this changes. It over-
// approximates (flags non-visual edits to these files too), so it's a prompt for a
// human to judge, not an auto-gate: `--check` reports drift, `--accept` records "I
// looked, no screenshot change needed" without regenerating.
function uiSourceFiles() {
  const out = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(tsx?|css)$/.test(e.name)) out.push(p)
    }
  }
  walk(path.join(root, 'client', 'src'))
  for (const f of fs.readdirSync(path.join(root, 'client')))
    if (f.endsWith('.html')) out.push(path.join(root, 'client', f))
  return out.sort()
}
function uiSourceHash() {
  const h = crypto.createHash('sha256')
  for (const f of uiSourceFiles()) {
    h.update(path.relative(root, f).split(path.sep).join('/') + '\0')
    h.update(fs.readFileSync(f))
    h.update('\0')
  }
  return h.digest('hex').slice(0, 16)
}
const manifestPath = () => path.join(OUT, 'manifest.json')
const readManifest = () => fs.existsSync(manifestPath()) ? JSON.parse(fs.readFileSync(manifestPath(), 'utf8')) : null

// `--check`: cheap (no Chrome) — is the committed gallery stale vs. current UI source?
function checkMode() {
  const m = readManifest()
  const cur = uiSourceHash()
  if (!m) { console.log('no manifest — screenshots have never been generated'); process.exit(1) }
  if (m.sourceHash === cur) { console.log(`screenshots up to date with UI source (${cur})`); process.exit(0) }
  console.log(`STALE — UI source changed since the last screenshot regen (${m.sourceHash ?? 'none'} → ${cur}).`)
  console.log('  Review the client diff. If the change is visual, regenerate:')
  console.log('    npm --prefix client run build && node tools/screenshots.mjs')
  console.log('  If it does not affect any screenshot, record that without regenerating:')
  console.log('    node tools/screenshots.mjs --accept')
  process.exit(1)
}
// `--accept`: bump the stored fingerprint to the current source without a regen —
// for a UI-source edit you've judged to have no visual effect.
function acceptMode() {
  const m = readManifest() ?? { shots: [] }
  m.sourceHash = uiSourceHash()
  fs.writeFileSync(manifestPath(), JSON.stringify(m, null, 2) + '\n')
  console.log(`accepted current UI source as up to date (${m.sourceHash}) — no regeneration`)
  process.exit(0)
}

// ---------- manifest + drift/degradation report ----------
function writeManifest() {
  // An optional shot this run didn't reproduce is now stale — a leftover from an
  // earlier run that would show a prior UI. Delete it so the committed gallery is
  // coherent: an optional image is present only when a recent run actually captured
  // it (the deterministic fixtures in components/ cover those states regardless).
  const stale = EXPECTED.filter((e) => !e.required && !produced.has(e.file))
    .map((e) => path.join(OUT, e.file)).filter((f) => fs.existsSync(f))
  for (const f of stale) { fs.rmSync(f); console.log('stale (removed):', path.relative(root, f)) }

  const shots = [...produced].sort()
  fs.writeFileSync(manifestPath(), JSON.stringify({ shots, sourceHash: uiSourceHash() }, null, 2) + '\n')
  console.log(`manifest: ${shots.length} shots → ${path.relative(root, path.join(OUT, 'manifest.json'))}`)

  // Optional misses are a known-degradation note, not a failure: the unseeded deal
  // simply didn't surface these states this run (e.g. no Assassin seat for the human).
  const missingOptional = EXPECTED.filter((e) => !e.required && !produced.has(e.file))
  if (missingOptional.length) {
    console.log(`note: ${missingOptional.length} luck-of-the-deal state(s) not captured this run — ${missingOptional.map((e) => e.file).join(', ')}`)
  }
  // Required misses mean the harness itself came up short — fail loudly so a partial
  // run can't masquerade as a complete gallery.
  const missingRequired = EXPECTED.filter((e) => e.required && !produced.has(e.file))
  if (missingRequired.length) {
    console.error(`MISSING ${missingRequired.length} REQUIRED shot(s): ${missingRequired.map((e) => e.file).join(', ')}`)
    process.exitCode = 1
  }
}

// ---------- main ----------
// Cheap, Chrome-free modes: `--check` reports staleness, `--accept` records it away.
if (process.argv.includes('--check')) checkMode()
if (process.argv.includes('--accept')) acceptMode()

// Is `port` bindable right now? Probe on all interfaces, exactly as the game server
// binds ('::'), so a leftover listener on either stack counts as taken.
function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port)
  })
}
// Advance PORT/BASE to the first free port at/above the requested one, so an orphaned
// server from a previous run can't fail this one with EADDRINUSE.
for (let tries = 0; ; tries++) {
  if (await portFree(PORT)) break
  if (tries >= 20) throw new Error(`no free port near ${PORT}`)
  console.log(`port ${PORT} busy — trying ${PORT + 1}`)
  PORT += 1; BASE = `http://localhost:${PORT}`
}

// AVALON_BOT_DELAY_MS holds the transient thinking / sealing-ballot / beat UI long
// enough to snapshot (autopilot otherwise decides in zero frames). AVALON_DEV_SEVER
// unlocks the SSE-sever hook disconnectRun uses for the reconnect banner. Both are
// dev-only and unset in prod.
const server = spawn(process.execPath, ['server/server.ts'], {
  cwd: root,
  env: {
    ...process.env, AVALON_PORT: String(PORT), PORT: String(PORT),
    AVALON_BOT_DELAY_MS: '1300', AVALON_DEV_SEVER: '1',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('server did not start')), 15000)
  server.stdout.on('data', (d) => {
    process.stdout.write(d)
    if (String(d).includes('listening')) { clearTimeout(timer); resolve() }
  })
  server.on('exit', (code) => reject(new Error(`server exited early (${code})`)))
})

try {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] })
  await soloRun(browser, 'desktop', { width: 1280, height: 800, deviceScaleFactor: 1 })
  await soloRun(browser, 'mobile', { width: 390, height: 844, deviceScaleFactor: 2 })
  await lobbyRun(browser)
  await disconnectRun(browser, 'desktop', { width: 1280, height: 800, deviceScaleFactor: 1 })
  await disconnectRun(browser, 'mobile', { width: 390, height: 844, deviceScaleFactor: 2 })
  await galleryRun(browser)
  await browser.close()
  writeManifest()
  console.log('gallery complete →', path.relative(root, OUT))
} finally {
  // Ensure the child is actually dead before we exit — otherwise it can orphan and
  // hold the port for the next run. SIGTERM first, SIGKILL if it lingers (Windows
  // doesn't reap on parent exit).
  server.kill()
  await new Promise((resolve) => {
    if (server.exitCode !== null || server.signalCode !== null) return resolve()
    const t = setTimeout(() => { try { server.kill('SIGKILL') } catch {} resolve() }, 3000)
    server.once('exit', () => { clearTimeout(t); resolve() })
  })
}
