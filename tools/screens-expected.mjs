// Single source of truth for which gallery shots the harness targets — shared by
// the harness (tools/screenshots.mjs, to report what a run missed) and the drift
// test (test/screens.test.ts, to fail when a required shot is absent or empty).
//
//   required: true  — deterministic; the harness should produce it every run, so
//                     its absence means the harness broke or the game ended weird.
//   required: false — luck-of-the-deal; depends on the unseeded role deal (e.g. the
//                     human must be dealt the Assassin AND good must win three
//                     quests for the knife to come out), so absence is expected.
//
// Keep COMPONENTS in sync with the VARIANTS list in client/src/gallery.tsx.

// Hit by every player every game — the playthrough always produces these.
const SOLO_REQUIRED = [
  'setup', 'setup-rules', 'setup-agent-form', 'game-start', 'discuss',
  'vote', 'record-sheet', 'codex-sheet', 'reveal', 'reveal-thinking',
]
// Luck-of-the-deal in a live run: `propose` and `finalize` need the human to lead
// before the game ends, `quest-card` needs them picked onto an approved team,
// `assassinate` needs them dealt the Assassin after a good win. The component
// gallery captures these deterministically (act-propose / act-finalize /
// act-quest-good / act-assassinate), so the playthrough versions are a contextual
// bonus, not a requirement.
const SOLO_OPTIONAL = ['propose', 'finalize', 'quest-card', 'assassinate']
// Forced deterministically via a dev-only hook rather than the deal: the harness
// severs the seat's SSE stream (AVALON_DEV_SEVER) to surface the reconnect banner,
// so it's required at both viewports like the other transient captures.
const SOLO_FORCED = ['reconnect-banner']
const DESKTOP_MULTIPLAYER = ['lobby-host', 'join-screen', 'spectator']
const COMPONENTS = [
  'role-merlin', 'role-percival', 'role-servant', 'role-minion',
  'role-oberon', 'role-spectator', 'name-editor',
  'quest-party', 'quest-party-mission', 'quest-party-awaiting', // proposed team named in the aside

  'act-propose', 'act-finalize', 'act-quest-good', 'act-quest-evil', 'act-assassinate',
  'tip-seat', 'tip-quest', // hover-only tooltips (off on touch)
  'reveal-assassin', // end-game reveal on an Assassin miss (deal, struck card, target line)
]

function build() {
  const out = []
  for (const vp of ['desktop', 'mobile']) {
    for (const name of SOLO_REQUIRED) out.push({ file: `${vp}/${name}.jpg`, required: true })
    for (const name of SOLO_FORCED) out.push({ file: `${vp}/${name}.jpg`, required: true })
    for (const name of SOLO_OPTIONAL) out.push({ file: `${vp}/${name}.jpg`, required: false })
  }
  for (const name of DESKTOP_MULTIPLAYER) out.push({ file: `desktop/${name}.jpg`, required: true })
  for (const name of COMPONENTS) out.push({ file: `components/${name}.jpg`, required: true })
  return out
}

export const EXPECTED = build()
