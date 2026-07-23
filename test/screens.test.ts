// Drift guard for the committed screenshot gallery (docs/screens/). This does NOT
// re-run the (slow, Chrome-dependent) harness or compare pixels — the gallery is
// deliberately unseeded, so pixels vary run to run (see CLAUDE.md). It only asserts
// that every REQUIRED shot exists and is non-empty, catching a partial run that
// threw mid-shoot, an accidental deletion, or a rename that left the set incomplete.
// Luck-of-the-deal shots (required: false) are not asserted — see tools/screens-expected.mjs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXPECTED } from '../tools/screens-expected.mjs'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screens')
const REGEN = 'npm --prefix client run build && node tools/screenshots.mjs'
const required = EXPECTED.filter((e) => e.required)

// If NONE of the gallery exists, this checkout never generated it (fresh clone
// without the committed images, or images stripped) — skip rather than emit dozens
// of failures. Partial presence, by contrast, is real drift (a forgotten commit or
// a mid-run crash), so we still assert every required shot once any of them is here.
const galleryPresent = required.some((e) => fs.existsSync(path.join(OUT, e.file)))

for (const { file } of required) {
  test(`gallery has ${file}`, { skip: galleryPresent ? false : 'gallery not generated in this checkout' }, () => {
    const p = path.join(OUT, file)
    assert.ok(fs.existsSync(p), `missing required screenshot: ${file}\n  regenerate with: ${REGEN}`)
    assert.ok(fs.statSync(p).size > 0, `empty required screenshot: ${file}\n  regenerate with: ${REGEN}`)
  })
}

// If a run wrote a manifest it must be consistent both ways: every file it lists
// exists on disk (no lost commit), AND it lists every required shot (not a stale
// manifest from an older EXPECTED). Optional shots aren't checked — a run legitimately
// omits the ones its deal didn't surface.
test('manifest (if present) is consistent with disk and required set', () => {
  const manifestPath = path.join(OUT, 'manifest.json')
  if (!fs.existsSync(manifestPath)) return // written by the harness; fine to run before first shoot
  const { shots } = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const shotSet = new Set<string>(shots)
  const notOnDisk = shots.filter((f: string) => !fs.existsSync(path.join(OUT, f)))
  assert.equal(notOnDisk.length, 0, `manifest lists files not on disk: ${notOnDisk.join(', ')}\n  regenerate with: ${REGEN}`)
  const requiredMissing = required.filter((e) => !shotSet.has(e.file)).map((e) => e.file)
  assert.equal(requiredMissing.length, 0, `manifest is stale — missing required shots: ${requiredMissing.join(', ')}\n  regenerate with: ${REGEN}`)
})
