# Custom agents v2 — design

**Status:** revised 2026-07-22 after adversarial review; supersedes the first draft. Fleshes out
roadmap #4 (custom agents on deployments) and the larger ask behind it: custom agents should be
able to be *smarter*, not just *flavored*. Today a custom agent is a model choice plus a
`personality` string (and an undocumented `roleGuidance` field the UI never exposes). This doc
opens up the strategy portion of the system prompt to authors while keeping the invariants that
make custom agents safe to run and fair to play against.

Companion: [design-implementation.md](design-implementation.md) §1 (agent library, prompt
architecture). The review that shaped this revision is summarized in §10.

## 1. What stays locked, and why

The current rule — "a custom agent can change how it plays, never what it can see or how its
output is parsed" — survives unchanged. Four things remain engine-owned and non-overridable:

1. **View rendering.** Prompts are built from `PlayerView` only. A custom prompt can *claim*
   anything, but the engine will never render hidden information into it. Structural leak-safety
   is not negotiable.
2. **Output contracts** (`OUTPUT_CONTRACTS[kind]`). The JSON shapes are what the parse ladder and
   the engine's legality checks understand. An agent that could rewrite them would break itself in
   confusing ways; keeping them engine-owned means every custom agent gets the same
   parse → retry → heuristic-degrade ladder for free.
3. **Injection guard.** Table talk is adversarial input by design; the guard is part of the
   harness, not the player.
4. **Placement of the engine footer.** Whatever the author writes, the injection guard and the
   output contract are appended *after* it, so the format instruction is always the last word.

Everything else in the strategy region of the prompt becomes author territory. A custom agent
with an unhinged strategy just plays badly, and playing badly is allowed (semantic leaks are
measured, not prevented — roadmap #7).

> **Layer mapping** ([design-evaluation.md](design-evaluation.md) §1.2): the locked set above is
> that doc's *integrity layer*; the author fields in §2 are its *policy layer*. The third layer
> there — a *facts dossier* of engine-computed, strictly neutral social facts (who addressed
> you, your own public commitments, hammer proximity) — is future work, as is making
> `TABLE_TALK_NORMS`/ask-embedded norms overridable like `roleGuidance` (they are policy, not
> harness). The eval framework measures whether such changes actually help before they ship.

## 2. The authoring surface: structured layers

The `LlmEngine` config grows from two prompt fields to four, all optional, all layered into the
baseline prompt in a fixed order:

```ts
interface LlmEngine {
  type: 'llm'
  model?: string                                       // roster id — a SUGGESTION (see note below)
  personality?: string                                 // table persona (unchanged)
  strategy?: string                                    // NEW: always-on strategy, alignment-agnostic
  roleGuidance?: Partial<Record<Role, string>>         // per-role strategy
  roleGuidanceMode?: 'replace' | 'append'              // replace baseline (default) or layer under it
  kindGuidance?: Partial<Record<LlmCallKind, string>>  // NEW: per-decision coaching
  temperature?: number                                 // NEW: global override, clamped [0, 1.0]
}
```

> **Reconciled with the model/config split (landed on master 2026-07-23).** An agent def no
> longer owns its model: `model` is an optional *suggestion*, and the model that actually plays
> is resolved at seat time (`resolveModel`: lobby seat override > def suggestion >
> `DEFAULT_MODEL` — the host pays the bill, so the host gets the final say). This composes
> cleanly with this design: a personality-only "character card" rides base-prompt improvements
> AND the strategy layers below; `unavailable` (§5) now means "the def *suggests* a model that
> left the roster" and is curable either by editing the def or by a seat-time override.
> `roleGuidance` also gained `roleGuidanceMode: 'append'` from the same change — append layers
> custom text *under* the baseline so the agent keeps riding baseline improvements; the studio
> exposes it as a mode toggle on the per-role section.

- **`strategy`** is the general brain: "track vote correlations across proposals; treat a
  reject-heavy early game as evil coordination; never sit on the first quest twice" — the kind of
  cross-role doctrine that today has nowhere to live.
- **`roleGuidance`** keeps its replace semantics (author text supersedes the baseline for that
  role), but the editor now shows the baseline text inline so authors edit *from* it rather than
  guessing what they're replacing. `GET /api/agents` already ships the baselines for exactly this.
- **`kindGuidance`** attaches to a decision kind rather than a role: extra coaching for `vote`
  ("weigh the vote record over table talk"), `assassinate` (a custom Merlin-detection checklist),
  or `reflect` — which is quietly the most interesting slot, because a custom reflect prompt is a
  custom *memory strategy* (what the agent chooses to write in its scratchpad shapes every later
  decision).
- **`temperature`** is the one sampling knob worth exposing, clamped to **[0, 1.0]**: every call
  is strict-JSON with tight `max_tokens`, several roster models get materially less reliable at
  JSON above ~1.0, and each parse failure doubles the call's cost on the shared key before
  degrading visibly. Above-1.0 sampling buys nothing an author can't get from personality text.
  `max_tokens` and the JSON response format stay engine-owned (they're part of the cost ceiling
  and the parse contract).

Layered composition order (system message):

```
RULES_DIGEST                     engine
identity + knowledge             engine (view-derived)
strategy                         custom
roleGuidance[role]               custom, else baseline
personality                      custom
kindGuidance[kind]               custom
TABLE_TALK_NORMS                 engine (discuss/pitch only)
INJECTION_GUARD                  engine, always
OUTPUT_CONTRACTS[kind]           engine, always last
```

Ordering rationale (prompt-engineering grounds, not caching — see §3): general strategy before
role-specific, both before persona; `kindGuidance` goes **after** personality so the tactical
note for the decision at hand sits nearest the ask, and so all kind-varying text stays at the
tail of the system message as it does today. Models weight later text more heavily, which is
what you want for "this decision, do it this way."

### Deferred: the system template (Tier B)

The first draft included a `systemTemplate` field — full authorship of the system-prompt body
with `{{placeholder}}` interpolation. Review killed it for now, for three reasons: the layered
fields above already cover every "smarter agent" example the draft itself gave; the only thing a
template adds is removing/reordering engine baseline text (custom rules digest), which is
un-referee-able until the coherence harness (roadmap #5) can score it; and the expansion
machinery is where the real risk lives — player names are user-controlled and mid-game mutable,
so any naive multi-pass expansion or string-form `.replace()` turns a player named `{{rules}}`
into a prompt-injection vector against every custom agent at the table.

If/when the harness exists and someone actually wants a custom rules digest, the spec is: a
separate composition branch (do **not** re-platform baseline prompts onto expansion machinery);
single-pass expansion with function-form replacement, interpolated values inserted literally and
never re-scanned; `{{identity}}` and `{{knowledge}}` required at save time; unknown placeholders
rejected at save time; the placeholder set must include `{{kind_guidance}}` and `{{strategy}}` so
Tier A fields remain the storage; and the test "player renamed to `{{rules}}` renders literally"
ships with it. Until then: not built.

## 3. Size and cost

Custom layers ride every call of every game the agent plays. Limits:

- Per-field cap stays 2,000 chars; aggregate custom text across all fields (strategy +
  personality + all roleGuidance + all kindGuidance entries) capped at **10,000 chars** (~2.5k
  tokens).
- All custom text is normalized `\r\n` → `\n` at validation time — Windows textareas paste CRLF,
  which inflates the caps and puts stray `\r` into prompts.
- The editor shows a live cost line derived from the actual layer sizes: "your custom text adds
  ~N tokens per call" (chars/4), with the model's tier label as the price context. Per-agent
  spend tags (`agentId/kind`) already attribute real cost, so the usage dashboard (roadmap #3)
  shows whether a verbose agent is worth its bill.
- No prompt-caching claims: the system message already varies per seat (identity/knowledge) and
  per kind (contracts at the tail), and the per-turn game state dominates the user message. The
  layer order is justified on prompt-engineering grounds alone (§2).
- Reveal payloads grow by up to ~10k chars per custom agent (§4); fine at friends-scale, noted
  here so nobody is surprised.

## 4. Transparency: everything is public

The first draft proposed persona-public / strategy-private-until-reveal, with an `openSource`
opt-out. Review pointed out this is **unenforceable at the current trust model**: there are no
accounts (roadmap #15 is parked), the invite code is shared by exactly the people who'd peek, and
the edit flow itself requires an endpoint that returns full defs to any code-holder. Shipping
secrecy UI while any player can open the editor on any agent mid-game would be theater.

So: **custom agent configs are public**, matching the game's existing ethos ("transparency is
part of the premise" — the Reference panel already shows each opponent's persona).

- Library browser and Reference panel show `about`, `personality`, and the model slug as today;
  custom agents additionally get a "tuned: ~N tokens of custom strategy" line, expandable to the
  full config for anyone who wants to read it.
- **Post-game reveal shows the full prompt config** of every custom agent that played, alongside
  the private thinking it already shows — the config that *actually played*, not the current
  library version (see §5 on def snapshots).
- If accounts ever land, per-author secrecy can be revisited; nothing here forecloses it.

## 5. API and lifecycle

- `POST /api/agents` — extended with the new fields; llm engines only; invite-gated. Unchanged
  otherwise.
- `PUT /api/agents/:id` — NEW. Edits a **user-tier** custom agent; built-ins and curated agents
  return 403. Version is a number: POST writes `version: 1`, PUT increments (legacy string
  `'1.0'` defs are read as 1). Strict validation (§below).
- `DELETE /api/agents/:id` — NEW (roadmap #4). User-tier only, invite-gated. Removes the library
  entry and file; historical reveals are unaffected because they serve the session's def
  snapshot, not a library lookup.
- **Def snapshots.** At game start the session captures a deep copy of each seat's resolved
  `AgentDef`. The reveal payload serves these copies; the session-snapshot work (roadmap #1)
  persists them, which also makes restores replay the version that was actually playing. A PUT or
  DELETE mid-game therefore affects only future games. A DELETE while the agent is seated in a
  **not-yet-started lobby** must not crash `startLobby`: seats whose library id no longer
  resolves fall back to Autopilot with a feed notice (same shape as the degrade ladder's
  visible-substitution rule).
- `GET /api/agents` — additionally returns the editor's prompt anatomy: baseline `roleGuidance`
  (already there), baseline `kindGuidance` slots (empty today), `TABLE_TALK_NORMS`, and the
  output contracts as read-only display strings.
- **Two-mode validation.** `validateDef(raw, { allowUnknownModel })`: strict at POST/PUT (unknown
  roster model rejected), lenient at library load (accepted, marked `unavailable: true` with the
  dead model id — roadmap #4's "surface rather than silently skip"). `publicInfo` gets an
  `unavailable` branch instead of throwing on the dead slug. The client renders unavailable
  agents dimmed with a "pick a new model" edit affordance; `startLobby` refuses to seat them.
- **Durable writes.** `saveCustomDef` writes temp-file + `renameSync` (atomic on Linux and NTFS)
  so a Railway redeploy mid-write can't leave truncated JSON. Files that still fail to parse at
  load are surfaced in `GET /api/agents` as `unavailable` entries with a `corrupt` reason, not
  just console-warned.
- **Degrade attribution.** The two-strike failure in `llm.ts` currently throws with the *model's*
  display name; with two custom agents on the same model that's ambiguous. The error (and the
  `degraded` record downstream) carries the agent's name and version. This is what makes "bad
  prompts cost their author fallback-rate embarrassment" true, and what the dashboard's
  per-agent fallback rate (roadmap #3) hangs on.

Other validation additions: `kindGuidance` keys must be real `LlmCallKind`s, `roleGuidance` keys
real roles, temperature clamped [0, 1.0], aggregate size cap (§3), CRLF normalization (§3).

## 6. Three library tiers on deployments

Per roadmap #4, the library becomes three sources merged in precedence order:

1. **Built-ins** — generated from the roster + Autopilot (code).
2. **Curated** — NEW: checked-in `agents/*.json`, versioned with the repo, present on every
   deployment. Same schema, loaded read-only, `author: 'curated'`.
3. **User** — `data/agents/*.json` on the Railway volume at `/app/data` (survives redeploys once
   the volume from roadmap #1 exists).

**Shadowing is surfaced, not silent.** Earlier tiers win on id collision, but a curated agent
added in a later deploy could otherwise silently vanish a pre-existing user agent with the same
id. On collision the user def is listed as `unavailable` with a `shadowed` reason (file stays on
disk, rename-able), and the server logs loudly. POST already avoids collisions by suffixing
against the whole merged library.

## 7. The iteration loop: prompt preview

Writing prompts blind is the main reason custom agents stay shallow. One editor affordance,
free: **`POST /api/agents/preview`** renders the exact messages `buildMessages` would produce for
a draft config — no LLM call, no save required, invite-gated like POST.

The fixture is a **real engine-generated game**, not handcrafted JSON: `createGame` with a fixed
seed and a short scripted event sequence (a couple of proposals, one resolved quest, some table
talk), then `viewFor(game, seat)` for the seat whose role matches the requested preview role.
The engine guarantees the `privateInfo` consistency a handcrafted view would get wrong, and the
test suite already builds fixtures exactly this way. Request: `{ engine, role, kind }` → response:
the rendered system + user messages plus the token estimate.

### Deferred: test drive

The first draft had a paid smoke-test endpoint (three real calls against the fixture). Cut for
now: a solo game *is* a test drive with full context, the degrade ladder already makes broken
prompts visible in real play, and a shared-key spend surface that competes with live games isn't
worth it before the spend ceiling survives restarts (roadmap #1). When the coherence harness
(roadmap #5) lands, custom agents get scored by the same machinery as roster models — that's the
real test drive, built once.

Failure behavior in real games needs no new machinery: a config that confuses its model into
unparseable output hits the existing two-strike parse ladder and degrades that decision to the
heuristic, visibly and now attributably (§5).

## 8. Client: from form to studio

The `AddAgentForm` grows into a modal **Agent Studio** (still on the setup screen):

- **Basics tab:** name, about, model picker, personality — today's form.
- **Strategy tab:** `strategy` textarea; per-role accordion pre-filled with baseline
  `roleGuidance` (edit-in-place = override, revert button = back to baseline); per-kind
  accordion for `kindGuidance`; temperature slider.
- **Preview rail:** prompt preview (§7) with role/kind switchers and the live token meter (§3).
- Library cards get edit/delete for user-tier agents, the "tuned" line with expandable full
  config (§4), and dimmed rendering + "pick a new model" for `unavailable` entries.
- Reveal screen: a per-agent config card for custom agents, next to the existing thinking
  timeline, fed from the def snapshot.

Client type sync is real work, listed so it isn't discovered mid-build: `client/src/types.ts`
needs the new `LlmEngine` fields, `AgentPublicInfo.unavailable`/`tunedChars`, the expanded
`Library.baseline` (kind slots, norms, contracts), the preview response type, and the reveal
payload's `agentDefs`.

## 9. Build order

1. **Schema + composition** — new `LlmEngine` fields, layer order in `buildMessages`,
   two-mode `validateDef` with normalization and caps, atomic `saveCustomDef`, `unavailable`
   handling in load/`publicInfo`, temperature override and degrade attribution in `llm.ts`.
   Tests: layer order and footer-always-last, validation edge cases, CRLF normalization,
   unavailable load path. No UI yet; hand-written JSON defs exercise it.
2. **API lifecycle** — PUT/DELETE, def snapshots at game start + reveal integration, preview
   endpoint with the engine-generated fixture, curated tier loading with shadow surfacing,
   lobby-start fallback for vanished agents.
3. **Studio UI** — tabs, preview rail, token meter, edit/delete, unavailable rendering, reveal
   config cards, client type sync (§8).

Each step is independently shippable; step 1 alone already unlocks "smarter agents" for anyone
willing to edit JSON.

## 10. Review log

An adversarial review of the first draft produced 14 findings; the substantive ones and their
dispositions:

- **Template expansion is where the invariants break** (player names are user-controlled and
  mid-game mutable; `{{...}}` in names/fields + multi-pass expansion = injection) → Tier B
  deferred entirely; expansion spec recorded in §2 for whenever it's built.
- **Secrecy is unenforceable under a shared invite code** → cut; configs are public (§4).
- **Reveal must serve the def that played, not a library lookup** → def snapshots (§5).
- **`unavailable` contradicts throw-on-unknown-model validation** → two-mode validation (§5).
- **Curated tier silently shadows user agents** → surfaced as `shadowed` (§6).
- **Smoke test is a spend surface duplicating what solo games already do** → deferred (§7).
- **Temperature 1.2 fights the JSON parse ladder at 2x cost** → clamp 1.0 (§2).
- **Caching claim overstated; kindGuidance-before-personality misordered** → claim dropped,
  order fixed (§2, §3).
- **Degrade ladder attributes failures to the model, not the agent** → attribution added (§5).
- **Non-atomic writes + Railway redeploys = corrupt defs silently skipped** → temp+rename,
  corrupt surfacing, CRLF normalization (§5, §3).
- **Preview fixture must come from the engine, not handcrafted JSON** → §7.

## Non-goals

- **Custom output formats or tools.** The decision shapes are the game; agents differ in brains,
  not in interface.
- **Per-agent model keys / BYO endpoints.** One OpenRouter key, one spend ceiling, one roster.
  Custom models enter via the roster + coherence harness, not via agent defs.
- **Prompt-injection armor for custom layers.** Authors are invite-gated humans writing their own
  agent's instructions; the injection guard protects against *table talk*, not against the
  author. An author can write a self-sabotaging agent; that's their right.
- **stdio engines over HTTP** — unchanged hard rule (RCE). File-drop only, local only.
