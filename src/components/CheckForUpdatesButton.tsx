import { useEffect, useState } from 'react'

// On-demand "Check for updates" for the packaged desktop app. The app otherwise
// only checks on launch and hourly, so a release cut mid-session was unreachable
// without a restart. Renders nothing in a plain browser / the overlay window,
// where the Electron bridge (electron/app-preload.js) doesn't exist.
//
// Feedback flows from main via onCheckStatus: 'checking' | 'uptodate' | 'found'
// | 'error'. When an update is found, the UpdateModal takes over the download
// flow — this control just resets.

type Status = 'idle' | 'checking' | 'uptodate' | 'error'

export function CheckForUpdatesButton() {
  const [status, setStatus] = useState<Status>('idle')
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    const api = window.appUpdates
    if (!api?.onCheckStatus) return
    setAvailable(true)
    const off = api.onCheckStatus((s) => {
      if (s === 'checking') setStatus('checking')
      else if (s === 'uptodate') setStatus('uptodate')
      else if (s === 'error') setStatus('error')
      else if (s === 'found') setStatus('idle') // UpdateModal handles it from here
    })
    return off
  }, [])

  if (!available) return null

  const label =
    status === 'checking'
      ? 'Checking…'
      : status === 'uptodate'
        ? "You're up to date"
        : status === 'error'
          ? 'Check failed — retry'
          : 'Check for updates'

  return (
    <button
      onClick={() => window.appUpdates?.checkForUpdates?.()}
      disabled={status === 'checking'}
      className="rounded-md border border-zinc-700/60 px-2.5 py-0.5 text-[11px] font-medium text-zinc-400 transition-colors hover:border-zinc-600 hover:text-zinc-200 disabled:cursor-default disabled:opacity-60"
    >
      {label}
    </button>
  )
}
