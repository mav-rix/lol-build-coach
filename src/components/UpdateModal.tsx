import { useEffect, useState } from 'react'

// Centered "update ready" popup for the packaged desktop app. The Electron main
// process downloads updates in the background and signals the window when one
// is ready (see electron/app-preload.js); in a plain browser / the overlay
// window the bridge doesn't exist and this renders nothing.

declare global {
  interface Window {
    appUpdates?: {
      onUpdateReady: (cb: (info: { version: string }) => void) => () => void
      getPendingUpdate: () => Promise<{ version: string } | null>
      installUpdate: () => void
    }
  }
}

export function UpdateModal() {
  const [update, setUpdate] = useState<{ version: string } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const api = window.appUpdates
    if (!api) return
    // Covers both orders: update lands after mount, or was ready before it.
    const off = api.onUpdateReady(setUpdate)
    api.getPendingUpdate().then((p) => p && setUpdate(p))
    return off
  }, [])

  if (!update || dismissed) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <div className="mb-1 text-sm font-bold text-zinc-100">Update ready</div>
        <p className="mb-4 text-xs leading-relaxed text-zinc-400">
          LoL Build Coach v{update.version} has been downloaded. Restart to apply — it takes a few
          seconds and your overlay position is kept.
        </p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setDismissed(true)}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            Later
          </button>
          <button
            onClick={() => window.appUpdates?.installUpdate()}
            className="rounded-md bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-500/40 transition-colors hover:bg-sky-500/30"
          >
            Restart now
          </button>
        </div>
      </div>
    </div>
  )
}
