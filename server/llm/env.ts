// .env loader, ported from datingsim game/lib/env.js. Walks UP from startDir
// loading the NEAREST .env; real OS env vars always win.

import fs from 'node:fs'
import path from 'node:path'

export function loadEnv(startDir: string = process.cwd(), depth = 8): void {
  let dir = startDir
  for (let i = 0; i < depth; i++) {
    try {
      let text = fs.readFileSync(path.join(dir, '.env'), 'utf8')
      if (text.length > 0 && text.charCodeAt(0) === 0xfeff) text = text.slice(1)
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq < 1) continue
        const key = trimmed.slice(0, eq).trim()
        if (!/^[A-Z0-9_]+$/i.test(key) || process.env[key]) continue
        let raw = trimmed.slice(eq + 1)
        if (raw.length >= 2 && (raw[0] === '"' || raw[0] === "'")) {
          const close = raw.indexOf(raw[0], 1)
          if (close !== -1) {
            process.env[key] = raw.slice(1, close)
            continue
          }
        }
        const ci = raw.search(/\s+#/)
        if (ci !== -1) raw = raw.slice(0, ci)
        process.env[key] = raw.trimEnd()
      }
      return
    } catch {
      /* not here — keep walking up */
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}
