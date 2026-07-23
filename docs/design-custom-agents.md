# Custom agents v2 — design

**Status:** proposal, 2026-07-22. Fleshes out roadmap #4 (custom agents on deployments) and the
larger ask behind it: custom agents should be able to be *smarter*, not just *flavored*. Today a
custom agent is a model choice plus a `personality` string (and an undocumented `roleGuidance`
field the UI never exposes). This doc opens up the strategy portion of the system prompt to
authors while keeping the invariants that make custom agents safe to run and fair to play against.

Companion: [design-implementation.md](design-implementation.md) §1 (agent library, prompt
architecture).

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

Everything else about the system prompt — the rules digest, strategy, role guidance, persona,
even overall structure — becomes author territory. A custom agent that teaches itself wrong rules
or an unhinged strategy just plays badly, and playing badly is allowed (semantic leaks are
measured, not prevented — roadmap #7).

## 2. Two authoring tiers

### Tier A — structured layers (the default editor)

The `LlmEngine` config grows from two prompt fields to four, all optional, all layered into the
baseline prompt in a fixed order:

```ts
interface LlmEngine {
  type: 'llm'
  model: string                                        // roster id (unchanged)
  personality?: string                                 // table persona (unchanged)
  strategy?: string                                    // NEW: always-on strategy, alignment-agnostic
  roleGuidance?: Partial<Record<Role, string>>         // per-role strategy (unchanged: replaces baseline)
  kindGuidance?: Partial<Record<LlmCallKind, string>>  // NEW: per-decision coaching
  temperature?: number                                 // NEW: global override, clamped [0, 1.2]
}
```

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
- **`temperature`** is the one sampling knob worth exposing. It overrides the per-kind defaults
  uniformly; `max_tokens` and the JSON response format stay engine-owned (they're part of the
  cost ceiling and the parse contract).

Layered composition order (system message):

```
RULES_DIGEST                     engine
identity + knowledge             engine (view-derived)
strategy                         custom
roleGuidance[role]               custom, else baseline
kindGuidance[kind]               custom
personality                      custom
TABLE_TALK_NORMS                 engine (discuss/pitch only)
INJECTION_GUARD                  engine, always
OUTPUT_CONTRACTS[kind]           engine, always last
```

Strategy sits above role guidance (general before specific); persona comes last of the custom
layers so voice colors strategy rather than the reverse.

### Tier B — the system template (advanced)

For authors who want real control, one more field:

```ts
systemTemplate?: string   // full authorship of the system-prompt body
```

When present, the template *replaces* the entire body of the system message — rules digest,
strategy, role guidance, persona ordering, all of it — and the engine composes:

```
expand(systemTemplate)           custom — the whole body
INJECTION_GUARD                  engine, always
OUTPUT_CONTRACTS[kind]           engine, always last
```

The template is plain text with `{{placeholder}}` interpolation for the engine-rendered and
config-stored fragments:

| Placeholder | Expands to | Required? |
|---|---|---|
| `{{identity}}` | "You are Name(seat N). Your secret role: …" | **yes** |
| `{{knowledge}}` | `knowledgeText(view)` — role knowledge from the view | **yes** |
| `{{rules}}` | the baseline `RULES_DIGEST` | no — write your own if you dare |
| `{{role_guidance}}` | baseline or config `roleGuidance[role]` | no |
| `{{table_talk_norms}}` | baseline norms (empty on non-speech kinds) | no |
| `{{personality}}` | the config `personality` field | no |
| `{{kind}}` | the decision kind name (`discuss`, `vote`, …) | no |

Validation rejects a template missing `{{identity}}` or `{{knowledge}}` (an agent that doesn't
know who it is isn't smart, it's broken) and rejects unknown placeholders (typos should fail
loudly at save time, not silently render as literal braces mid-game). Omitting `{{rules}}` is
legal: an author may believe they can teach the rules better than the baseline does, and the
coherence harness (roadmap #5) is the referee for whether they're right.

Conditional per-kind text inside a template comes free via `kindGuidance` — it still applies in
template mode if the author includes a `{{kind_guidance}}` placeholder (expands to the matching
entry or empty). Structured fields and the template are therefore not exclusive: the template
controls *placement*, the fields remain the *storage*, and the default layered composition is
literally just the built-in template. That gives one composition path to test instead of two.

## 3. Size, cost, and the honesty of the meter

Custom layers ride every call of every game the agent plays. Limits:

- Per-field cap stays 2,000 chars; `systemTemplate` gets 8,000; aggregate custom text across all
  fields capped at 10,000 chars (~2.5k tokens).
- The editor shows a live cost line derived from the actual layer sizes: "your custom text adds
  ~N tokens per call ≈ $X per game on <model>" using the roster's pricing. The per-agent spend
  tags (`agentId/kind`) already attribute real cost, so the usage dashboard (roadmap #3) shows
  whether a verbose agent is worth its bill.
- Custom layers are static per agent and sit in the system message ahead of all per-turn content,
  so provider prompt caches still hit (same property the baseline constants have today).

## 4. Secrecy: personas are public, strategy is scouted

Today `publicInfo` exposes `personality` and hides `roleGuidance` — a precedent worth keeping and
extending: **persona is public, strategy is private during play.**

- Library browser and in-game Reference panel: show `about`, `personality`, model slug, and a
  "custom strategy: ~N tokens" badge so opponents know a tuned agent is at the table without
  reading its playbook.
- **Post-game reveal shows the full prompt config** of every custom agent that played, alongside
  the private thinking it already shows. You learn an agent's strategy the way you learn a
  player's: by playing against it. This is the scouting loop that makes career stats (roadmap
  #12) interesting.
- Authors who want their prompt public in the library set `openSource: true` on the def. Curated
  checked-in agents (§6) default to open.

## 5. API and lifecycle

- `POST /api/agents` — extended with the new fields; llm engines only; invite-gated. Unchanged
  otherwise.
- `PUT /api/agents/:id` — NEW. Edits a custom agent (built-ins 403), auto-bumps a numeric
  version. Running games are unaffected: agents are constructed from the def at game start, and
  session snapshots (roadmap #1) must persist the resolved def so a restore replays the version
  that was actually playing.
- `DELETE /api/agents/:id` — NEW (roadmap #4). Custom only, invite-gated. Deletion removes the
  library entry; historical reveals keep their embedded def copy.
- `GET /api/agents` — additionally returns the prompt anatomy the editor needs: baseline
  `kindGuidance` slots (empty), `TABLE_TALK_NORMS`, the output contracts (read-only display), and
  the built-in default template so Tier B authors start from the real thing.
- Custom agents whose roster model has disappeared are returned with `unavailable: true` and the
  dead model id (roadmap #4) instead of being silently skipped; the client renders them dimmed
  with a "pick a new model" edit affordance.

Validation additions in `validateDef`: placeholder checks (§2B), aggregate size cap (§3),
`kindGuidance` keys must be real `LlmCallKind`s, temperature clamped, `openSource` boolean.

## 6. Three library tiers on deployments

Per roadmap #4, the library becomes three sources merged in precedence order:

1. **Built-ins** — generated from the roster + Autopilot (code).
2. **Curated** — NEW: checked-in `agents/*.json`, versioned with the repo, present on every
   deployment. Same schema, loaded read-only, `author: 'curated'`. This is where good Tier B
   templates get promoted once the coherence harness likes them.
3. **User** — `data/agents/*.json` on the Railway volume at `/app/data` (survives redeploys once
   the volume from roadmap #1 exists).

Same id-collision rule as today: earlier tiers win.

## 7. The iteration loop: preview and test drive

Writing prompts blind is the main reason custom agents stay shallow. Two editor affordances:

- **Prompt preview (free).** The server renders the exact messages `buildMessages` would produce
  for a fixture `PlayerView` (a canned mid-game 7-player state, selectable role and kind) with
  the draft config applied — `POST /api/agents/preview`, no LLM call, no save required. Authors
  see precisely where their text lands and what surrounds it.
- **Test drive (spends real money, says so).** `POST /api/agents/:id/smoke` runs the agent's
  model against the fixture view for three kinds (`discuss`, `vote`, `assassinate`), returns raw
  output + parse verdict + cost, tagged `agentId/smoke` in the spend ledger. Invite-gated like
  creation. This is the small sibling of the coherence harness (roadmap #5); when the golden-set
  harness lands, its fixtures replace the canned view and custom agents get scored with the same
  machinery as roster models.

Failure behavior in real games needs no new machinery: a template that confuses its model into
unparseable output hits the existing two-strike parse ladder and degrades that decision to the
heuristic, visibly. Bad prompts cost their author fallback-rate embarrassment, not table stalls.

## 8. Client: from form to studio

The `AddAgentForm` grows into a modal **Agent Studio** (still on the setup screen):

- **Basics tab:** name, about, model picker, personality — today's form.
- **Strategy tab:** `strategy` textarea; per-role accordion pre-filled with baseline
  `roleGuidance` (edit-in-place = override, revert button = back to baseline); per-kind
  accordion for `kindGuidance`.
- **Advanced tab:** temperature slider; template editor seeded with the built-in default
  template; placeholder chips that insert `{{…}}` tokens; `openSource` toggle.
- **Right rail, always visible:** prompt preview (§7) with role/kind switchers, live token/cost
  meter (§3), and the Test drive button with its price tag.
- Library cards get edit/delete for custom agents and the strategy-size badge (§4).

## 9. Build order

1. **Schema + composition** — new `LlmEngine` fields, template expansion in `buildMessages`
   (default template = current layered order), `validateDef` additions, tests for placeholder
   validation and footer-always-last. No UI yet; hand-written JSON defs exercise it.
2. **API lifecycle** — PUT/DELETE, `unavailable` surfacing, preview endpoint, curated tier
   loading. (Volume attach is roadmap #1's deliverable; this ships ready for it.)
3. **Studio UI** — tabs, preview rail, cost meter.
4. **Test drive + reveal integration** — smoke endpoint, reveal screen shows agent configs,
   `openSource` in the library browser.

Each step is independently shippable; step 1 alone already unlocks "smarter agents" for anyone
willing to edit JSON.

## Non-goals

- **Custom output formats or tools.** The decision shapes are the game; agents differ in brains,
  not in interface.
- **Per-agent model keys / BYO endpoints.** One OpenRouter key, one spend ceiling, one roster.
  Custom models enter via the roster + coherence harness, not via agent defs.
- **Prompt-injection armor for custom layers.** Authors are invite-gated humans writing their own
  agent's instructions; the injection guard protects against *table talk*, not against the
  author. An author can write a self-sabotaging agent; that's their right.
- **stdio engines over HTTP** — unchanged hard rule (RCE). File-drop only, local only.
