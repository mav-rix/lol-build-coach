import { useEffect, useState } from 'react'

// Centered update popup for the packaged desktop app. Manual flow: the Electron
// main process only CHECKS in the background — the popup (and tray entry) offer
// the download as soon as a release is found, and the restart once it's
// downloaded (see electron/app-preload.js). In a plain browser / the overlay
// window the bridge doesn't exist and this renders nothing.

interface UpdateInfo {
  version: string
  state: 'available' | 'downloading' | 'ready'
  percent?: number
}

declare global {
  interface Window {
    appUpdates?: {
      onUpdateReady: (cb: (info: UpdateInfo) => void) => () => void
      getPendingUpdate: () => Promise<UpdateInfo | null>
      downloadUpdate: () => void
      installUpdate: () => void
      checkForUpdates?: () => void
      onCheckStatus?: (
        cb: (status: 'checking' | 'uptodate' | 'found' | 'error') => void,
      ) => () => void
    }
  }
}

export function UpdateModal() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  // Per-state dismissal: "Later" on the download offer shouldn't also swallow
  // the restart prompt once the download finishes.
  const [dismissedState, setDismissedState] = useState<UpdateInfo['state'] | null>(null)

  useEffect(() => {
    const api = window.appUpdates
    if (!api) return
    // Covers both orders: update lands after mount, or was known before it.
    const off = api.onUpdateReady(setUpdate)
    api.getPendingUpdate().then((p) => p && setUpdate(p))
    return off
  }, [])

  if (!update || dismissedState === update.state) return null

  const body =
    update.state === 'available' ? (
      <>
        LoL Build Coach v{update.version} is available. Download it now? You&apos;ll get a
        restart prompt when it&apos;s ready — nothing installs until then.
      </>
    ) : update.state === 'downloading' ? (
      <>Downloading v{update.version}… {update.percent ?? 0}%</>
    ) : (
      <>
        LoL Build Coach v{update.version} has been downloaded. Restart to apply — it takes a few
        seconds and your overlay position is kept.
      </>
    )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <div className="mb-1 text-sm font-bold text-zinc-100">
          {update.state === 'ready' ? 'Update ready' : `Update v${update.version}`}
        </div>
        <p className="mb-4 text-xs leading-relaxed text-zinc-400">{body}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setDismissedState(update.state)}
            className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            Later
          </button>
          {update.state === 'available' && (
            <button
              onClick={() => window.appUpdates?.downloadUpdate()}
              className="rounded-md bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-500/40 transition-colors hover:bg-sky-500/30"
            >
              Download
            </button>
          )}
          {update.state === 'ready' && (
            <button
              onClick={() => window.appUpdates?.installUpdate()}
              className="rounded-md bg-sky-500/20 px-3 py-1.5 text-xs font-semibold text-sky-300 ring-1 ring-sky-500/40 transition-colors hover:bg-sky-500/30"
            >
              Restart now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
