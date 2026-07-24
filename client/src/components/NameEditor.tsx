import { useState } from 'react'

// A decorative quill sigil — the write/rename affordance, drawn in the house
// stroke style so the control reads as part of the Arcane Table, not a stock form.
function Quill() {
  return (
    <svg className="quill" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 4C11 5 6 10 5 19" />
      <path d="M20 4c-1 7-5 11-11 12" />
      <path d="M5 19l3.2-1.1" />
    </svg>
  )
}

// A collapsed quill "pill" that expands into an inline rename card, styled to sit
// beside the role card (mono label header, gold-deep frame, serif input).
// initialOpen defaults false (production always mounts collapsed); the component
// gallery passes true to capture the expanded editor without an interaction step.
export function NameEditor({ current, rename, initialOpen = false }: {
  current: string
  rename: (name: string) => Promise<void>
  initialOpen?: boolean
}) {
  const [open, setOpen] = useState(initialOpen)
  const [name, setName] = useState(current)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  if (!open) {
    return (
      <button className="name-edit-toggle" onClick={() => { setName(current); setErr(null); setOpen(true) }}>
        <Quill />
        <span>Change name</span>
      </button>
    )
  }
  const submit = async () => {
    setBusy(true)
    setErr(null)
    try {
      await rename(name)
      setOpen(false)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="name-editor">
      <div className="ne-head"><Quill /><span>Your name</span></div>
      <div className="ne-body">
        <input
          value={name} maxLength={24} placeholder="New name" autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
            if (e.key === 'Escape') setOpen(false)
          }}
        />
        {err && <p className="error ne-error">{err}</p>}
        <div className="ne-actions">
          <button className="ne-cancel" onClick={() => setOpen(false)}>Cancel</button>
          <button className="ne-save" disabled={busy || !name.trim()} onClick={submit}>Save</button>
        </div>
      </div>
    </div>
  )
}
