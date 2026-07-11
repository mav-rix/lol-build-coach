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

// Overlay state (mirrors the dev shell).
let interactivePin = false
let gripHover = false
let dragOrigin = null
let tabVisible = false
let pinnedVisible = false
let tabModeActive = false

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
    webPreferences: { ...HARDENED },
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
  const visible = !tabModeActive || pinnedVisible || tabVisible
  if (visible && !overlayWin.isVisible()) overlayWin.showInactive()
  else if (!visible && overlayWin.isVisible()) overlayWin.hide()
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
  tabModeActive = true
  applyOverlayVisibility()
  app.on('will-quit', () => uIOhook.stop())
}

// ---- tray ---------------------------------------------------------------------
function createTray() {
  // Windows needs an .ico; fall back silently if missing in dev.
  try {
    tray = new Tray(path.join(__dirname, 'icon.ico'))
  } catch {
    return
  }
  tray.setToolTip('LoL Build Coach')
  tray.setContextMenu(
    Menu.buildFromTemplate([
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
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
  tray.on('double-click', () => (mainWin ? mainWin.focus() : createMainWindow()))
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
  globalShortcut.register('Control+Shift+Q', () => app.quit())

  // Auto-update from GitHub Releases when packaged (no-op in dev, never fatal).
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.checkForUpdatesAndNotify().catch(() => {})
  } catch {
    // updater not installed in dev — fine
  }
})

app.on('will-quit', () => globalShortcut.unregisterAll())
// Tray app: closing the main window doesn't quit; the tray/hotkeys still own
// the overlay. Quit via tray or Ctrl+Shift+Q.
app.on('window-all-closed', (e) => e?.preventDefault?.())
