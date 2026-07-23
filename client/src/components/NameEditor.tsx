import { useState } from 'react'

// A collapsed "Change name" button that expands into an inline rename form.
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
      <button className="secondary name-edit-toggle" onClick={() => { setName(current); setOpen(true) }}>
        Change name
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
      <div className="row">
        <input
          value={name} maxLength={24} placeholder="New name" autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
        />
        <button disabled={busy || !name.trim()} onClick={submit}>Save</button>
        <button className="secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {err && <p className="error">{err}</p>}
    </div>
  )
}
