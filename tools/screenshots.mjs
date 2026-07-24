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
// sheets, reveal, thinking), lobby host view, join screen, and an in-game
// spectator — desktop 1280x800 and mobile 390x844 (multiplayer set: desktop only).
// Plus a fixture component gallery (docs/screens/components/) for the role cards
// and action states a live deal only reaches by luck — see client/src/gallery.tsx.
// TODO: error/reconnect banner (needs a way to sever SSE mid-shoot).
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXPECTED } from './screens-expected.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'client', 'package.json'))
const puppeteer = require('puppeteer-core')

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.PORT ?? 18917)
const BASE = `http://localhost:${PORT}`
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
      const buttons = bar ? [...bar.querySelectorAll('button')].map((b) => (b.querySelector('.ptx-plain') ?? b.querySelector('.pt') ?? b).textContent.trim()) : []
      return {
        buttons,
        hasInput: !!bar?.querySelector('input'),
        teamPending: !!bar?.querySelector('.lean-seg'),
        reveal: !!document.querySelector('.reveal'),
        waiting: bar?.classList.contains('waiting') ?? false,
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
    if (st.waiting) {
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
    if (!st.buttons.length && !st.hasInput) continue

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

    if (st.buttons.includes('Approve') && st.buttons.includes('Reject')) {
      if (!seen.has('vote')) { seen.add('vote'); await shot('vote') }
      if (!seen.has('vote-ballot') && await page.$('.feed-row.ballot')) { seen.add('vote-ballot'); await shot('vote-ballot') }
      if (!rejectedOnce) { rejectedOnce = true; await clickByText(page, 'Reject') }
      else await clickByText(page, 'Approve')
    } else if (st.buttons.includes('Success')) {
      if (!seen.has('quest')) { seen.add('quest'); await shot('quest-card') }
      if (!seen.has('quest-ballot') && await page.$('.feed-row.qseal')) { seen.add('quest-ballot'); await shot('quest-ballot') }
      await clickByText(page, 'Success')
    } else if (st.buttons.includes('Fail')) {
      if (!seen.has('quest')) { seen.add('quest'); await shot('quest-card') }
      await clickByText(page, 'Success')
    } else if (st.buttons.includes('Propose team')) {
      const size = await page.evaluate(() => {
        const m = document.querySelector('.action-label')?.textContent.match(/pick (\d+)/)
        return m ? Number(m[1]) : 2
      })
      await page.evaluate((size) => {
        const picks = [...document.querySelectorAll('.seat-picker .pick')]
        for (let i = 0; i < size && i < picks.length; i++) picks[i].click()
      }, size)
      await sleep(150)
      if (!seen.has('propose')) { seen.add('propose'); await shot('propose') }
      await clickByText(page, 'Propose team')
    } else if (st.buttons.includes('Assassinate')) {
      await page.evaluate(() => document.querySelector('.seat-picker .pick')?.click())
      await sleep(150)
      if (!seen.has('assassinate')) { seen.add('assassinate'); await shot('assassinate') }
      await clickByText(page, 'Assassinate')
    } else if (st.hasInput) {
      // discuss.jpg prefers the react-to-team frame (lean picker ✓/✕/? engaged,
      // which the plain opening turn — identical to game-start — lacks), but must
      // ALWAYS exist so the required-shot check can't spuriously fail: capture the
      // plain turn as a fallback on first sight, then upgrade in place once a team
      // is on the table. In the common case the upgrade lands; only a run that never
      // reaches a post-proposal turn keeps the plain (game-start-like) fallback.
      if (!discussIsReact) {
        if (st.teamPending) {
          await page.evaluate(() => document.querySelector('.action-bar .lean-seg-btn.approve')?.click())
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
        await clickByText(page, 'Say')
      } else {
        // The pass button reads "Pass" normally but "Signal only" once a lean is
        // engaged (both just submit an empty utterance) — click by its stable class,
        // not the label (and not `.secondary`, which the action rail doesn't use).
        await page.evaluate(() => document.querySelector('.action-bar .pass-btn')?.click())
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
  await shooter(host, shotDir)('lobby-host')

  const playerCtx = await browser.createBrowserContext()
  const player = await playerCtx.newPage()
  await player.setViewport({ width: 1280, height: 800 })
  await player.goto(joinUrl, { waitUntil: 'domcontentloaded' })
  await player.waitForSelector('input[placeholder="Player"]', { timeout: 15000 })
  await sleep(300)
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
    if (hover) { await page.hover(hover); await sleep(150) } // reveal the hover-only tooltip
    const file = path.join(dir, `${id}.jpg`)
    await el.screenshot({ path: file, type: 'jpeg', quality: 82 })
    record(file)
    console.log('shot:', path.relative(root, file))
  }
  await ctx.close()
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
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({ shots }, null, 2) + '\n')
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
// The bot-decision delay holds the transient thinking / sealing-ballot / beat
// UI long enough to snapshot (autopilot otherwise decides in zero frames).
const server = spawn(process.execPath, ['server/server.ts'], {
  cwd: root,
  env: { ...process.env, AVALON_PORT: String(PORT), PORT: String(PORT), AVALON_BOT_DELAY_MS: '1300' },
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
  await galleryRun(browser)
  await browser.close()
  writeManifest()
  console.log('gallery complete →', path.relative(root, OUT))
} finally {
  server.kill()
}
