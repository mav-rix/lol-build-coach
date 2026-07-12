// LoL Build Coach — packaged desktop app.
// One process: an embedded local server (static bundle + Live Client/LCU
// proxies, loopback only), the main app window, and the in-game overlay window.
// Running natively on Windows means the game APIs are directly reachable — no
// WSL plumbing, no portproxy, no separate bridge.
//
// Overlay behavior matches the dev shell: click-through with a draggable grip,
// Tab-summoned visibility via a PASSIVE key listener (never consumes the key),
// position persisted. Hotkeys: Ctrl+Shift+O interactive pin, Ctrl+Shift+H
// visible pin, Ctrl+Shift+L toggle overlay on/off, Ctrl+Shift+Q quit.

const { app, BrowserWindow, Menu, Tray, globalShortcut, screen, shell, ipcMain } = require('electron')
const path = require('node:path')
const { readFileSync, writeFileSync } = require('node:fs')
const { startServer } = require('./server')

const DIST = path.join(__dirname, 'dist')
const TAB_MODE = (process.env.OVERLAY_TAB ?? 'hold').toLowerCase() // hold | toggle | off

let baseUrl = null
let mainWin = null
let overlayWin = null
let tray = null
// Update lifecycle (manual flow — nothing downloads without a click):
//   { version, state: 'available' } → tray/modal offer the download
//   { version, state: 'downloading', percent } → progress
//   { version, state: 'ready', file } → tray/modal offer the restart
let pendingUpdate = null
let updaterRef = null // electron-updater's autoUpdater once loaded

// Overlay state (mirrors the dev shell).
let interactivePin = false
let gripHover = false
let dragOrigin = null
let tabVisible = false
let pinnedVisible = false
let tabModeActive = false
let loadingLayout = false // renderer-reported: League loading screen is up
let preLoadingBounds = null // overlay bounds to restore after the loading screen

const HARDENED = {
  contextIsolation: true,
  nodeIntegration: false,
  backgroundThrottling: false,
}

// ---- main window -------------------------------------------------------------
function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1100,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: { ...HARDENED, preload: path.join(__dirname, 'app-preload.js') },
  })
  mainWin.loadURL(baseUrl + '/')
  // External links (Data Dragon docs etc.) go to the system browser.
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWin.on('closed', () => (mainWin = null))
}

// ---- overlay window ------------------------------------------------------------
const posFile = () => path.join(app.getPath('userData'), 'overlay-position.json')
const loadPos = () => {
  try {
    return JSON.parse(readFileSync(posFile(), 'utf8'))
  } catch {
    return null
  }
}
const savePos = () => {
  try {
    if (overlayWin && !overlayWin.isDestroyed()) writeFileSync(posFile(), JSON.stringify(overlayWin.getBounds()))
  } catch {
    // best-effort
  }
}

function applyOverlayIgnore() {
  if (overlayWin && !overlayWin.isDestroyed())
    overlayWin.setIgnoreMouseEvents(!(interactivePin || gripHover), { forward: true })
}

function applyOverlayVisibility() {
  if (!overlayWin || overlayWin.isDestroyed()) return
  // The loading-screen panel is always shown (like other companion apps) —
  // Tab-summoning only governs the in-game card.
  const visible = !tabModeActive || pinnedVisible || tabVisible || loadingLayout
  if (visible && !overlayWin.isVisible()) {
    overlayWin.showInactive()
    // Re-assert topmost on every show — borderless games re-grab z-order on
    // focus changes, and the periodic re-assert below only runs while visible.
    overlayWin.setAlwaysOnTop(true, 'screen-saver', 1)
    overlayWin.moveTop()
  } else if (!visible && overlayWin.isVisible()) overlayWin.hide()
}

// Loading screen: swap the overlay from its side-card bounds to a large
// centered panel, and back. The renderer drives this (it knows the gameflow
// phase); position is never persisted from the centered layout (savePos only
// runs on drag-end, and the loading panel has no drag grip).
function applyLoadingLayout(active) {
  loadingLayout = Boolean(active)
  if (overlayWin && !overlayWin.isDestroyed()) {
    if (loadingLayout && !preLoadingBounds) {
      preLoadingBounds = overlayWin.getBounds()
      const wa = screen.getPrimaryDisplay().workArea
      // Tall and narrow: the panel stacks the teams top/bottom (10 full-width
      // rows) rather than side by side.
      const w = Math.min(600, wa.width - 80)
      const h = Math.min(820, wa.height - 120)
      overlayWin.setBounds({
        x: wa.x + Math.round((wa.width - w) / 2),
        y: wa.y + Math.round((wa.height - h) / 2),
        width: w,
        height: h,
      })
    } else if (!loadingLayout && preLoadingBounds) {
      overlayWin.setBounds(preLoadingBounds)
      preLoadingBounds = null
    }
  }
  applyOverlayVisibility()
}

function createOverlayWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const saved = loadPos()
  const bounds = {
    width: saved?.width ?? 410,
    height: saved?.height ?? Math.min(860, height - 80),
    x: Math.max(0, Math.min(saved?.x ?? width - 420, width - 120)),
    y: Math.max(0, Math.min(saved?.y ?? 40, height - 60)),
  }
  overlayWin = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: { ...HARDENED, preload: path.join(__dirname, 'preload.js') },
  })
  overlayWin.setAlwaysOnTop(true, 'screen-saver', 1)
  applyOverlayIgnore()
  overlayWin.loadURL(baseUrl + '/overlay')
  overlayWin.on('closed', () => (overlayWin = null))
  // Games grab z-order on focus changes; keep re-asserting topmost.
  setInterval(() => {
    if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible())
      overlayWin.setAlwaysOnTop(true, 'screen-saver', 1)
  }, 2000)
}

// Passive global Tab listener (see overlay/main.js for rationale — a normal
// globalShortcut would steal Tab from the game's scoreboard).
// The hook's NATIVE THREAD can block Electron's quit sequence if it's still
// running (or stopped from inside will-quit), which held the whole app open on
// quit — and with it, pending updates. It's stopped explicitly in safeQuit
// BEFORE quitting, with a hard-exit fallback.
let activeHook = null
function stopTabListener() {
  try {
    activeHook?.stop()
  } catch {
    // best effort
  }
  activeHook = null
}
function startTabListener() {
  if (TAB_MODE === 'off') return
  let uio
  try {
    uio = require('uiohook-napi')
  } catch {
    console.warn('[app] uiohook-napi unavailable — overlay stays always-visible.')
    return
  }
  const { uIOhook, UiohookKey } = uio
  uIOhook.on('keydown', (e) => {
    if (e.keycode !== UiohookKey.Tab) return
    tabVisible = TAB_MODE === 'toggle' ? !tabVisible : true
    applyOverlayVisibility()
  })
  if (TAB_MODE === 'hold') {
    uIOhook.on('keyup', (e) => {
      if (e.keycode !== UiohookKey.Tab) return
      tabVisible = false
      applyOverlayVisibility()
    })
  }
  uIOhook.start()
  activeHook = uIOhook
  tabModeActive = true
  applyOverlayVisibility()
}

/**
 * Quit that can't hang: stop the global hook first, then quit — and if the
 * process is still alive shortly after (something blocked the quit sequence),
 * hard-exit. A pending update's installer is spawned before exit either way
 * (autoInstallOnAppQuit / quitAndInstall), so updates still apply.
 */
function safeQuit(fn) {
  stopTabListener()
  try {
    ;(fn ?? (() => app.quit()))()
  } catch {
    app.quit()
  }
  setTimeout(() => app.exit(0), 3000).unref?.()
}

// ---- tray ---------------------------------------------------------------------
function refreshTrayMenu() {
  if (!tray) return
  const items = []
  // The update entry leads the menu whenever one is known about.
  if (pendingUpdate) {
    const v = pendingUpdate.version
    const entry =
      pendingUpdate.state === 'available'
        ? { label: `Download update v${v}`, click: () => startUpdateDownload() }
        : pendingUpdate.state === 'downloading'
          ? { label: `Downloading v${v} — ${pendingUpdate.percent ?? 0}%`, enabled: false }
          : { label: `Restart to update (v${v})`, click: () => installPendingUpdate() }
    items.push(entry, { type: 'separator' })
  }
  items.push(
    { label: 'Open Build Coach', click: () => (mainWin ? mainWin.focus() : createMainWindow()) },
    {
      label: 'Toggle overlay',
      click: () => {
        if (overlayWin) {
          overlayWin.destroy()
          overlayWin = null
        } else createOverlayWindow()
      },
    },
    { type: 'separator' },
    { label: 'Quit', click: () => safeQuit() },
  )
  tray.setContextMenu(Menu.buildFromTemplate(items))
  tray.setToolTip(pendingUpdate ? `LoL Build Coach — update v${pendingUpdate.version} available` : 'LoL Build Coach')
}

function createTray() {
  // Windows needs an .ico; fall back silently if missing in dev.
  try {
    tray = new Tray(path.join(__dirname, 'icon.ico'))
  } catch {
    return
  }
  refreshTrayMenu()
  tray.on('double-click', () => (mainWin ? mainWin.focus() : createMainWindow()))
}

// ---- updates -------------------------------------------------------------------
// Append-only log next to userData so update failures are diagnosable instead
// of a vanishing error dialog.
function updaterLog(line) {
  try {
    require('node:fs').appendFileSync(
      path.join(app.getPath('userData'), 'updater.log'),
      `${new Date().toISOString()} ${line}\n`,
    )
  } catch {
    // best effort
  }
}

function installPendingUpdate() {
  if (pendingUpdate?.state !== 'ready') return // nothing downloaded yet
  // Preferred path: run the ALREADY-DOWNLOADED, checksum-verified installer
  // ourselves and exit — electron-updater's quitAndInstall threw async errors
  // on this setup, stranding updates. /S --force-run = silent + relaunch, the
  // same invocation electron-updater itself uses.
  const file = pendingUpdate?.file
  if (file && require('node:fs').existsSync(file)) {
    updaterLog(`installing ${file}`)
    stopTabListener()
    try {
      const child = require('node:child_process').spawn(file, ['/S', '--force-run'], {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      // Give the spawn a beat, then get out of the installer's way.
      setTimeout(() => app.exit(0), 700)
      return
    } catch (e) {
      updaterLog(`spawn failed: ${e}`)
    }
  }
  // Fallback: electron-updater's own path.
  try {
    const { autoUpdater } = require('electron-updater')
    safeQuit(() => autoUpdater.quitAndInstall(true, true))
  } catch (e) {
    updaterLog(`quitAndInstall failed: ${e}`)
  }
}

// Mirror every update-state change to the app window (see UpdateModal).
function pushUpdateState() {
  if (mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('app:update-ready', pendingUpdate)
  }
}

function startUpdateDownload() {
  if (!updaterRef || !pendingUpdate || pendingUpdate.state !== 'available') return
  pendingUpdate = { ...pendingUpdate, state: 'downloading', percent: 0 }
  updaterLog(`downloading v${pendingUpdate.version}`)
  refreshTrayMenu()
  pushUpdateState()
  updaterRef.downloadUpdate().catch((e) => {
    updaterLog(`download failed: ${e}`)
    if (pendingUpdate?.state === 'downloading') {
      pendingUpdate = { version: pendingUpdate.version, state: 'available' }
      refreshTrayMenu()
      pushUpdateState()
    }
  })
}

function startUpdater() {
  let autoUpdater
  try {
    ;({ autoUpdater } = require('electron-updater'))
  } catch {
    return // dev — updater not installed
  }
  updaterRef = autoUpdater
  // MANUAL update flow: the check runs in the background, but the ~100 MB
  // download only starts when the user clicks. The big win: the tray entry and
  // the in-app popup appear seconds after a check finds a release, instead of
  // only after a silent full download.
  autoUpdater.autoDownload = false
  autoUpdater.on('error', (e) => updaterLog(`updater error: ${e?.stack ?? e}`))
  autoUpdater.on('update-available', (info) => {
    const version = info?.version ?? 'new'
    // A restart-ready or in-flight download shouldn't regress to 'available'.
    if (pendingUpdate && pendingUpdate.version === version && pendingUpdate.state !== 'available')
      return
    pendingUpdate = { version, state: 'available' }
    updaterLog(`update available: v${version}`)
    refreshTrayMenu()
    pushUpdateState()
  })
  autoUpdater.on('update-not-available', (info) =>
    updaterLog(`up to date (latest: v${info?.version ?? '?'})`),
  )
  autoUpdater.on('download-progress', (p) => {
    if (!pendingUpdate || pendingUpdate.state !== 'downloading') return
    const percent = Math.floor(p?.percent ?? 0)
    if (percent === pendingUpdate.percent) return
    pendingUpdate.percent = percent
    // The tray menu is rebuilt sparingly (rebuilds close an open menu on
    // Windows); the modal gets every integer step.
    if (percent % 10 === 0) refreshTrayMenu()
    pushUpdateState()
  })
  autoUpdater.on('update-downloaded', (info) => {
    pendingUpdate = {
      version: info?.version ?? pendingUpdate?.version ?? 'new',
      state: 'ready',
      file: info?.downloadedFile ?? null,
    }
    updaterLog(`downloaded v${pendingUpdate.version} → ${pendingUpdate.file}`)
    refreshTrayMenu()
    pushUpdateState()
  })
  const check = () => {
    updaterLog('checking for updates')
    autoUpdater.checkForUpdates().catch((e) => updaterLog(`check failed: ${e}`))
  }
  check()
  // Long sessions: re-check hourly so an open app learns of updates quickly.
  setInterval(check, 60 * 60 * 1000)
}

// ---- app lifecycle --------------------------------------------------------------
if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.focus()
  } else createMainWindow()
})

app.whenReady().then(async () => {
  ;({ baseUrl } = await startServer(DIST))
  createMainWindow()
  createOverlayWindow()
  createTray()
  startTabListener()

  // Overlay drag bridge (see preload.js).
  ipcMain.on('overlay:hover', (_e, h) => {
    gripHover = Boolean(h)
    applyOverlayIgnore()
  })
  ipcMain.on('overlay:begin-drag', () => {
    dragOrigin = overlayWin && !overlayWin.isDestroyed() ? overlayWin.getPosition() : null
  })
  ipcMain.on('overlay:drag-to', (_e, dx, dy) => {
    if (dragOrigin && overlayWin && !overlayWin.isDestroyed())
      overlayWin.setPosition(Math.round(dragOrigin[0] + dx), Math.round(dragOrigin[1] + dy))
  })
  ipcMain.on('overlay:end-drag', () => {
    dragOrigin = null
    savePos()
  })
  ipcMain.on('overlay:loading-layout', (_e, active) => applyLoadingLayout(active))

  globalShortcut.register('Control+Shift+O', () => {
    interactivePin = !interactivePin
    applyOverlayIgnore()
    if (interactivePin && overlayWin) overlayWin.focus()
  })
  globalShortcut.register('Control+Shift+H', () => {
    if (tabModeActive) {
      pinnedVisible = !pinnedVisible
      applyOverlayVisibility()
    } else if (overlayWin?.isVisible()) overlayWin.hide()
    else overlayWin?.show()
  })
  globalShortcut.register('Control+Shift+L', () => {
    if (overlayWin) {
      overlayWin.destroy()
      overlayWin = null
    } else createOverlayWindow()
  })
  globalShortcut.register('Control+Shift+Q', () => safeQuit())

  // Update-UX bridge for the main window (see electron/app-preload.js).
  ipcMain.handle('app:get-pending-update', () => pendingUpdate)
  ipcMain.on('app:download-update', () => startUpdateDownload())
  ipcMain.on('app:install-update', () => installPendingUpdate())

  // Auto-update from GitHub Releases when packaged (no-op in dev, never fatal).
  startUpdater()
})

app.on('will-quit', () => globalShortcut.unregisterAll())
// Tray app: closing the main window doesn't quit; the tray/hotkeys still own
// the overlay. Quit via tray or Ctrl+Shift+Q.
app.on('window-all-closed', (e) => e?.preventDefault?.())
