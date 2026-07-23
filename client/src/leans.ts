import type { PlayerView, Seat } from './types.ts'

// Latest stated lean per seat for the proposal currently on the table.
// A lean is signalled during discussion and stays valid until a new team is
// proposed, so we only count utterances after the most recent proposal event.
export function latestLeans(view: PlayerView): Map<Seat, string> {
  const leans = new Map<Seat, string>()
  if (!view.currentTeam) return leans
  const lastProposalSeq = [...view.events].reverse().find((e) => e.type === 'proposal')?.seq ?? -1
  for (const ev of view.events) {
    if (ev.type === 'utterance' && ev.seq > lastProposalSeq && ev.payload.lean) {
      leans.set(ev.payload.seat, ev.payload.lean)
    }
  }
  return leans
}
