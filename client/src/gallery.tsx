// Component gallery — a fixture-driven storybook for the variants a live
// playthrough only reaches by luck (which role the deal hands you) or by
// interaction (hover-only tooltips, off on touch). The screenshot harness
// (tools/screenshots.mjs) loads /gallery.html, reads window.__VARIANTS__, and
// shoots each variant into docs/screens/components/.
//
// Fixtures feed the SAME presentational components the app renders, wrapped in the
// SAME layout skeleton (App.tsx's <aside> / <footer className="youredge"> /
// <div className="fartable">), so what you see here is what ships. Add a variant
// by pushing to VARIANTS; a variant may name a `hover` target the harness hovers
// before shooting (for the seat/quest tooltips).
import React from 'react'
import { createRoot } from 'react-dom/client'
import type { AgentInfo, DecisionRequest, PlayerView } from './types.ts'
import { NameEditor } from './components/NameEditor.tsx'
import { RoleCard } from './components/RoleCard.tsx'
import { SpectatorCard } from './components/SpectatorCard.tsx'
import { ActionBar } from './components/ActionBar.tsx'
import { QuestBoard } from './components/QuestBoard.tsx'
import { TableSeats } from './components/TableSeats.tsx'
import { ArcanaDefs } from './components/Arcana.tsx'
import './styles.css'

const names = ['You', 'Gemini', 'DeepSeek', 'Claude', 'GPT-OSS', 'Kimi', 'GLM']
const players = names.map((name, seat) => ({ seat, name }))
const rolesInPlay = ['merlin', 'percival', 'servant', 'servant', 'assassin', 'morgana', 'oberon']

const base: PlayerView = {
  seat: 0, name: 'You', role: 'servant', alignment: 'good',
  privateInfo: {}, playerCount: 7, rolesInPlay, players,
  phase: 'discussion', round: 1, proposalNum: 1, leaderSeat: 0,
  quests: [
    { num: 1, teamSize: 2, failsRequired: 1 },
    { num: 2, teamSize: 3, failsRequired: 1 },
    { num: 3, teamSize: 3, failsRequired: 1 },
    { num: 4, teamSize: 4, failsRequired: 2 },
    { num: 5, teamSize: 4, failsRequired: 1 },
  ],
  proposals: [], transcript: [], events: [],
}
const v = (over: Partial<PlayerView>): PlayerView => ({ ...base, ...over })
const ask = (kind: DecisionRequest['kind']): DecisionRequest => ({ kind, seat: 0, round: 1, proposalNum: 1 })
const noop = () => {}

// Bots for the seat tooltip — the tooltip surfaces model + about, so fixtures
// need them populated.
const bot = (id: string, name: string, model: string, color: string, about: string): AgentInfo =>
  ({ id, name, model, color, monogram: name.slice(0, 2).toUpperCase(), about, custom: false })
const bots: Record<number, AgentInfo> = {
  1: bot('gemini', 'Gemini', 'google/gemini-3.1-flash-lite', '#6c8fd9', 'Fast and confident; over-commits early.'),
  2: bot('deepseek', 'DeepSeek', 'deepseek/deepseek-v4-flash', '#c9a84c', 'Terse and punchy. Occasionally forgets it is playing a game.'),
  3: bot('claude', 'Claude', 'anthropic/claude-4.5', '#c98a4c', 'The premium seat. Calm, deliberate, hard to rattle.'),
  4: bot('gptoss', 'GPT-OSS', 'openai/gpt-oss-120b', '#7bc47f', 'Open-weights OpenAI. Cheapest seat at the table.'),
  5: bot('kimi', 'Kimi', 'moonshotai/kimi-k2.5', '#b06ed9', 'Warm and literary. Writes paragraphs when nervous.'),
  6: bot('glm', 'GLM', 'z-ai/glm-4.6', '#d97b6e', 'Earnest. Takes accusations personally.'),
}

// A mid-game table state so the seat tooltip has status/lean/last-vote/leads to show.
const tableView = v({
  phase: 'discussion', round: 2, proposalNum: 1, leaderSeat: 2, currentTeam: [2, 3],
  proposals: [{
    round: 2, proposalNum: 1, leader: 2, team: [2, 3], approved: true,
    votes: [
      { seat: 1, vote: 'reject' }, { seat: 2, vote: 'approve' }, { seat: 3, vote: 'approve' },
      { seat: 4, vote: 'approve' }, { seat: 5, vote: 'reject' }, { seat: 6, vote: 'approve' },
    ],
  }],
  events: [
    { seq: 1, type: 'proposal', payload: { leader: 2, round: 2, proposalNum: 1 }, visibility: 'public' },
    { seq: 2, type: 'utterance', payload: { seat: 3, lean: 'approve' }, visibility: 'public' },
    { seq: 3, type: 'utterance', payload: { seat: 5, lean: 'reject' }, visibility: 'public' },
  ],
})

// A quest line with one won, one lost, one current — so the quest tooltip shows
// a resolved card's "who went / fails revealed".
const questView = v({
  round: 3, proposalNum: 2,
  quests: [
    { num: 1, teamSize: 2, failsRequired: 1, team: [0, 2], result: 'success', failCount: 0 },
    { num: 2, teamSize: 3, failsRequired: 1, team: [1, 3, 5], result: 'fail', failCount: 1 },
    { num: 3, teamSize: 3, failsRequired: 1 },
    { num: 4, teamSize: 4, failsRequired: 2 },
    { num: 5, teamSize: 4, failsRequired: 1 },
  ],
})

// Faithful wrappers — mirror App.tsx so the components' parent-scoped styles
// (aside width, the lacquer action rail, the table zone) resolve as they do in game.
const Aside = ({ children }: { children: React.ReactNode }) =>
  <main className="gallery-main"><aside>{children}</aside></main>

const Edge = ({ role, children }: { role: string; children: React.ReactNode }) => (
  <footer className="youredge waits">
    <div className="edge-inner">
      <div className="youchip">
        <span className="you-sigil">YO</span>
        <span className="you-meta">
          <span className="you-name">You</span>
          <span className="you-role">{role} · your seat</span>
        </span>
      </div>
      {children}
    </div>
  </footer>
)

const Table = ({ children }: { children: React.ReactNode }) => <div className="fartable">{children}</div>

type Variant = { id: string; sel: string; hover?: string; node: React.ReactNode }
const VARIANTS: Variant[] = [
  // Role cards — one per distinct privateInfo branch: Merlin sees evil, Percival
  // sees Merlin candidates, a Minion sees its partners, Oberon works alone, the
  // Loyal Servant sees nothing, plus the spectator's Witness card. A live run only
  // reaches whichever the deal hands the human. (Morgana/Mordred share the Minion's
  // evilPartners branch, differing only in arcana; represented here by the Minion.)
  { id: 'role-merlin', sel: '.role-card', node: <Aside><RoleCard view={v({ role: 'merlin', alignment: 'good', privateInfo: { knownEvil: [4, 5] } })} /></Aside> },
  { id: 'role-percival', sel: '.role-card', node: <Aside><RoleCard view={v({ role: 'percival', alignment: 'good', privateInfo: { merlinCandidates: [1, 5] } })} /></Aside> },
  { id: 'role-servant', sel: '.role-card', node: <Aside><RoleCard view={v({ role: 'servant', alignment: 'good', privateInfo: {} })} /></Aside> },
  { id: 'role-minion', sel: '.role-card', node: <Aside><RoleCard view={v({ role: 'minion', alignment: 'evil', privateInfo: { evilPartners: [4, 5] }, rolesInPlay: ['merlin', 'percival', 'servant', 'servant', 'assassin', 'morgana', 'minion'] })} /></Aside> },
  { id: 'role-oberon', sel: '.role-card', node: <Aside><RoleCard view={v({ role: 'oberon', alignment: 'evil', privateInfo: {} })} /></Aside> },
  { id: 'role-spectator', sel: '.role-card', node: <Aside><SpectatorCard /></Aside> },
  // The expanded name editor — reachable in-app only by clicking "Change name".
  { id: 'name-editor', sel: '.name-editor', node: <Aside><NameEditor initialOpen current="Allen" rename={async () => {}} /></Aside> },
  // Action bar — states a real game reaches only by luck (whether the human leads,
  // is picked onto an approved team, is dealt evil, or is the Assassin after a good
  // win). `discuss` and `vote` are left to the playthrough — every player hits those.
  { id: 'act-propose', sel: '.youredge', node: <Edge role="Loyal Servant · Good"><ActionBar view={v({ phase: 'proposal' })} ask={ask('propose')} onDecide={noop} /></Edge> },
  { id: 'act-quest-good', sel: '.youredge', node: <Edge role="Loyal Servant · Good"><ActionBar view={v({ phase: 'quest' })} ask={ask('quest')} onDecide={noop} /></Edge> },
  { id: 'act-quest-evil', sel: '.youredge', node: <Edge role="The Knife · Assassin"><ActionBar view={v({ role: 'assassin', alignment: 'evil', phase: 'quest' })} ask={ask('quest')} onDecide={noop} /></Edge> },
  { id: 'act-assassinate', sel: '.youredge', node: <Edge role="The Knife · Assassin"><ActionBar view={v({ role: 'assassin', alignment: 'evil', phase: 'assassination' })} ask={ask('assassinate')} onDecide={noop} /></Edge> },
  // Hover-only tooltips (off on touch) — the harness hovers the named element, then
  // crops the whole stage (see the tip- CSS: table-zone clip dropped, headroom added)
  // so the side/up-placed tooltip is fully in frame.
  { id: 'tip-seat', sel: '.gallery-stage', hover: '.farseats .seat:nth-child(3) .seat-card', node: <Table><TableSeats view={tableView} bots={bots} acting={[4]} /></Table> },
  { id: 'tip-quest', sel: '.gallery-stage', hover: '.qcards .qcard:nth-child(1)', node: <Table><QuestBoard view={questView} /></Table> },
]

// Published for the harness to enumerate (id + crop selector + optional hover),
// so adding a fixture here is enough to get it shot — the tool hard-codes nothing.
;(window as unknown as { __VARIANTS__: { id: string; sel: string; hover?: string }[] }).__VARIANTS__ =
  VARIANTS.map((x) => ({ id: x.id, sel: x.sel, hover: x.hover }))

const current = () => VARIANTS.find((x) => x.id === location.hash.replace(/^#/, '')) ?? null

function Gallery() {
  const [, force] = React.useReducer((n: number) => n + 1, 0)
  React.useEffect(() => {
    window.addEventListener('hashchange', force)
    return () => window.removeEventListener('hashchange', force)
  }, [])
  const cur = current()
  // data-variant is the harness's render barrier: it waits for the attribute to
  // equal the target id before shooting, so a shared crop selector (.role-card,
  // .fartable) can't hand back the previous variant's still-mounted node.
  return (
    <div className="game gallery-stage" data-variant={cur?.id ?? ''}>
      {cur ? cur.node : (
        <p className="gallery-hint">
          Pick a variant: {VARIANTS.map((x) => <a key={x.id} href={`#${x.id}`}>{x.id}</a>)}
        </p>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ArcanaDefs />
    <Gallery />
  </React.StrictMode>,
)
