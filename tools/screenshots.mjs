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
// (discuss, vote, propose, quest, Record + Codex sheets, reveal, thinking),
// lobby host view, join screen, and an in-game spectator — desktop 1280x800
// and mobile 390x844 (multiplayer set: desktop only).
// TODO: error/reconnect banner (needs a way to sever SSE mid-shoot).
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'client', 'package.json'))
const puppeteer = require('puppeteer-core')

const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = Number(process.env.PORT ?? 18917)
const BASE = `http://localhost:${PORT}`
const OUT = path.join(root, 'docs', 'screens')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------- helpers ----------
const label = `(e) => (e.querySelector?.('.pt')?.textContent ?? e.textContent).trim()`
async function clickByText(page, text) {
  const ok = await page.evaluate((text) => {
    const label = (e) => (e.querySelector?.('.pt')?.textContent ?? e.textContent).trim()
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
    await page.screenshot({ path: path.join(dir, `${name}.jpg`), type: 'jpeg', quality: 82, fullPage })
    console.log('shot:', path.relative(root, path.join(dir, `${name}.jpg`)))
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
  let rejectedOnce = false
  let modalsDone = false
  const deadline = Date.now() + 4 * 60 * 1000
  while (Date.now() < deadline) {
    await sleep(350)
    const st = await page.evaluate(() => {
      const bar = document.querySelector('.action-bar')
      const buttons = bar ? [...bar.querySelectorAll('button')].map((b) => (b.querySelector('.pt')?.textContent ?? b.textContent).trim()) : []
      return {
        buttons,
        hasInput: !!bar?.querySelector('input'),
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
    if (st.waiting) continue
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
      if (!rejectedOnce) { rejectedOnce = true; await clickByText(page, 'Reject') }
      else await clickByText(page, 'Approve')
    } else if (st.buttons.includes('Success')) {
      if (!seen.has('quest')) { seen.add('quest'); await shot('quest-card') }
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
      if (!seen.has('discuss')) { seen.add('discuss'); await shot('discuss') }
      if (!saidSomething) {
        saidSomething = true
        await typeInto(page, '.action-bar input', "I'm just a humble servant — watch the votes with me.")
        await sleep(100)
        await clickByText(page, 'Say')
      } else {
        await clickByText(page, 'Pass')
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

// ---------- main ----------
const server = spawn(process.execPath, ['server/server.ts'], {
  cwd: root,
  env: { ...process.env, AVALON_PORT: String(PORT), PORT: String(PORT) },
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
  await browser.close()
  console.log('gallery complete →', path.relative(root, OUT))
} finally {
  server.kill()
}
