// LoL Build Coach — in-game overlay shell.
// A transparent, always-on-top, click-through window that renders the web
// app's /overlay route. It is a separate OS window drawn above the game
// (League must be in Borderless/Windowed mode) — it never touches the game
// process, memory, or render pipeline.
//
// Moving it: press-and-hold the left mouse on the grip at the top of the card
// and drag — the window follows and its position is remembered. The grip is
// grabbable any time; the rest of the overlay stays click-through so it never
// blocks the game.
//
// Visibility: always visible in-game. The renderer collapses the card to a
// slim strip and expands it on grip hover, so the window itself never needs to
// hide/show around gameplay.
//
// A second window renders the enemy-comp panel (?panel=enemies), positioned
// and dragged completely independently of the build window — see
// createEnemyWindow. Its drag/hover state mirrors the build window's
// one-for-one, kept as separate variables rather than a shared abstraction so
// this already-working logic stays easy to diff against electron/main.js.
//
// Hotkeys:
//   Ctrl+Shift+O — pin interactive mode (click/scroll the whole overlay)
//   Ctrl+Shift+H — hide/show the overlay window
//   Ctrl+Shift+Q — quit

const { app, BrowserWindow, globalShortcut, screen, ipcMain } = require('electron')
const path = require('node:path')
const { readFileSync, writeFileSync } = require('node:fs')

const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://localhost:5173/overlay'
const RETRY_MS = 2000

let win = null
let pinned = false // Ctrl+Shift+O — whole overlay interactive
let hover = false // pointer is over the drag grip
let handleRects = [] // renderer-reported [data-drag-handle] rects (window-relative CSS px)
let dragOrigin = null // window [x,y] captured at drag start
let reloadTimer = null

let loadingLayout = false // renderer-reported: League loading screen is up
let preLoadingBounds = null // bounds to restore after the loading screen

let enemyWin = null
let enemyHover = false
let enemyHandleRects = []
let enemyDragOrigin = null
let enemyReloadTimer = null

// The window is always shown; this re-shows it if something hid it (e.g. the
// loading screen appearing after a Ctrl+Shift+H hide).
function applyVisibility() {
  if (!win || win.isDestroyed()) return
  if (!win.isVisible()) {
    win.showInactive() // never steal game focus
    // Re-assert topmost on every show — the periodic re-assert only runs
    // while visible, so a game may have re-grabbed z-order in between.
    win.setAlwaysOnTop(true, 'screen-saver', 1)
    win.moveTop()
  }
}

function applyEnemyVisibility() {
  if (!enemyWin || enemyWin.isDestroyed()) return
  if (!enemyWin.isVisible()) {
    enemyWin.showInactive()
    enemyWin.setAlwaysOnTop(true, 'screen-saver', 1)
    enemyWin.moveTop()
  }
}

// Loading screen: swap the overlay from its side-card bounds to a large
// centered panel, and back (mirrors electron/main.js). The enemy panel isn't
// resized here — it just renders nothing while loading (see Overlay.tsx) —
// but is re-shown in case a Ctrl+Shift+H hide happened before loading started.
function applyLoadingLayout(active) {
  loadingLayout = Boolean(active)
  if (win && !win.isDestroyed()) {
    if (loadingLayout && !preLoadingBounds) {
      preLoadingBounds = win.getBounds()
      const wa = screen.getPrimaryDisplay().workArea
      // Tall and narrow: the panel stacks the teams top/bottom (10 full-width
      // rows) rather than side by side.
      const w = Math.min(600, wa.width - 80)
      const h = Math.min(820, wa.height - 120)
      win.setBounds({
        x: wa.x + Math.round((wa.width - w) / 2),
        y: wa.y + Math.round((wa.height - h) / 2),
        width: w,
        height: h,
      })
    } else if (!loadingLayout && preLoadingBounds) {
      win.setBounds(preLoadingBounds)
      preLoadingBounds = null
    }
  }
  applyVisibility()
  applyEnemyVisibility()
}

const posFile = () => path.join(app.getPath('userData'), 'overlay-position.json')
function loadPos() {
  try {
    return JSON.parse(readFileSync(posFile(), 'utf8'))
  } catch {
    return null
  }
}
function savePos() {
  try {
    if (win && !win.isDestroyed()) writeFileSync(posFile(), JSON.stringify(win.getBounds()))
  } catch {
    // best-effort — a failed save just means the position isn't remembered
  }
}

const enemyPosFile = () => path.join(app.getPath('userData'), 'overlay-enemy-position.json')
function loadEnemyPos() {
  try {
    return JSON.parse(readFileSync(enemyPosFile(), 'utf8'))
  } catch {
    return null
  }
}
function saveEnemyPos() {
  try {
    if (enemyWin && !enemyWin.isDestroyed())
      writeFileSync(enemyPosFile(), JSON.stringify(enemyWin.getBounds()))
  } catch {
    // best-effort
  }
}

// The window is click-through unless it's pinned interactive, the pointer is
// over the grip, or a drag is in progress. NEVER pass forward:true here: on
// Windows it installs a system-wide low-level mouse hook that relays every
// physical mouse move through this process — in-game it feels like cursor
// lag/smoothing. Hover is instead detected hook-free: main polls the cursor
// position against [data-drag-handle] rects the renderer reports.
function applyIgnore() {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!(pinned || hover || dragOrigin))
}

function applyEnemyIgnore() {
  if (enemyWin && !enemyWin.isDestroyed())
    enemyWin.setIgnoreMouseEvents(!(pinned || enemyHover || enemyDragOrigin))
}

function setGripHover(h) {
  if (h === hover) return
  hover = h
  applyIgnore()
  if (win && !win.isDestroyed()) win.webContents.send('overlay:grip-hover', h)
}

function setEnemyGripHover(h) {
  if (h === enemyHover) return
  enemyHover = h
  applyEnemyIgnore()
  if (enemyWin && !enemyWin.isDestroyed()) enemyWin.webContents.send('overlay:grip-hover', h)
}

function pollGripHover() {
  if (!win || win.isDestroyed() || !win.isVisible()) return setGripHover(false)
  if (dragOrigin) return // stay interactive for the whole drag
  const p = screen.getCursorScreenPoint()
  const b = win.getContentBounds()
  setGripHover(
    handleRects.some(
      (r) => p.x >= b.x + r.x && p.x < b.x + r.x + r.w && p.y >= b.y + r.y && p.y < b.y + r.y + r.h,
    ),
  )
}

function pollEnemyGripHover() {
  if (!enemyWin || enemyWin.isDestroyed() || !enemyWin.isVisible()) return setEnemyGripHover(false)
  if (enemyDragOrigin) return
  const p = screen.getCursorScreenPoint()
  const b = enemyWin.getContentBounds()
  setEnemyGripHover(
    enemyHandleRects.some(
      (r) => p.x >= b.x + r.x && p.x < b.x + r.x + r.w && p.y >= b.y + r.y && p.y < b.y + r.y + r.h,
    ),
  )
}

// Keep retrying the load until the dev server answers. Without this, a load that
// hits the server while it's down (or mid-restart) lands on a blank page — and
// since the overlay is transparent, a blank page is invisible.
function scheduleReload() {
  if (reloadTimer) return
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    if (win && !win.isDestroyed()) win.loadURL(OVERLAY_URL).catch(() => scheduleReload())
  }, RETRY_MS)
}

function scheduleEnemyReload() {
  if (enemyReloadTimer) return
  enemyReloadTimer = setTimeout(() => {
    enemyReloadTimer = null
    if (enemyWin && !enemyWin.isDestroyed())
      enemyWin.loadURL(`${OVERLAY_URL}?panel=enemies`).catch(() => scheduleEnemyReload())
  }, RETRY_MS)
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const saved = loadPos()
  const bounds = {
    width: saved?.width ?? 410,
    height: saved?.height ?? Math.min(860, height - 80),
    x: saved?.x ?? width - 420,
    y: saved?.y ?? 40,
  }
  // Keep it on-screen even if the display or saved layout changed.
  bounds.x = Math.max(0, Math.min(bounds.x, width - 120))
  bounds.y = Math.max(0, Math.min(bounds.y, height - 60))

  win = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })
  // 'screen-saver' level stays above borderless-fullscreen games. Note this
  // cannot beat EXCLUSIVE fullscreen — the game must be in Borderless mode.
  win.setAlwaysOnTop(true, 'screen-saver', 1)
  applyIgnore()
  win.loadURL(OVERLAY_URL).catch(() => scheduleReload())

  // Auto-recover from a down/restarting dev server or a renderer crash.
  win.webContents.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
    // -3 = ERR_ABORTED (a superseded navigation), not a real failure.
    if (isMainFrame && errorCode !== -3) scheduleReload()
  })
  win.webContents.on('render-process-gone', () => scheduleReload())

  // Games grab z-order on focus changes; keep re-asserting topmost.
  setInterval(() => {
    if (win && !win.isDestroyed() && win.isVisible()) {
      win.setAlwaysOnTop(true, 'screen-saver', 1)
    }
  }, 2000)
  win.on('blur', () => win.setAlwaysOnTop(true, 'screen-saver', 1))
}

// Default top-left, opposite corner from the build window's default
// top-right, so the two panels start apart on screen.
function createEnemyWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const saved = loadEnemyPos()
  const bounds = {
    width: saved?.width ?? 340,
    height: saved?.height ?? Math.min(420, height - 160),
    x: saved?.x ?? 40,
    y: saved?.y ?? 40,
  }
  bounds.x = Math.max(0, Math.min(bounds.x, width - 120))
  bounds.y = Math.max(0, Math.min(bounds.y, height - 60))

  enemyWin = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: {
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })
  enemyWin.setAlwaysOnTop(true, 'screen-saver', 1)
  applyEnemyIgnore()
  enemyWin.loadURL(`${OVERLAY_URL}?panel=enemies`).catch(() => scheduleEnemyReload())

  enemyWin.webContents.on('did-fail-load', (_e, errorCode, _desc, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) scheduleEnemyReload()
  })
  enemyWin.webContents.on('render-process-gone', () => scheduleEnemyReload())

  setInterval(() => {
    if (enemyWin && !enemyWin.isDestroyed() && enemyWin.isVisible()) {
      enemyWin.setAlwaysOnTop(true, 'screen-saver', 1)
    }
  }, 2000)
  enemyWin.on('blur', () => enemyWin.setAlwaysOnTop(true, 'screen-saver', 1))
}

app.whenReady().then(() => {
  createWindow()
  createEnemyWindow()

  // Drag bridge (see overlay/preload.js). Sender-guarded: both windows load
  // the same /overlay page and would otherwise clobber each other's state.
  ipcMain.on('overlay:handles', (e, rects) => {
    if (win && !win.isDestroyed() && e.sender === win.webContents) {
      handleRects = Array.isArray(rects) ? rects : []
    } else if (enemyWin && !enemyWin.isDestroyed() && e.sender === enemyWin.webContents) {
      enemyHandleRects = Array.isArray(rects) ? rects : []
    }
  })
  setInterval(pollGripHover, 150)
  setInterval(pollEnemyGripHover, 150)
  ipcMain.on('overlay:begin-drag', (e) => {
    if (win && !win.isDestroyed() && e.sender === win.webContents) {
      dragOrigin = win.getPosition()
    } else if (enemyWin && !enemyWin.isDestroyed() && e.sender === enemyWin.webContents) {
      enemyDragOrigin = enemyWin.getPosition()
    }
  })
  ipcMain.on('overlay:drag-to', (e, dx, dy) => {
    if (dragOrigin && win && !win.isDestroyed() && e.sender === win.webContents) {
      win.setPosition(Math.round(dragOrigin[0] + dx), Math.round(dragOrigin[1] + dy))
    } else if (
      enemyDragOrigin &&
      enemyWin &&
      !enemyWin.isDestroyed() &&
      e.sender === enemyWin.webContents
    ) {
      enemyWin.setPosition(Math.round(enemyDragOrigin[0] + dx), Math.round(enemyDragOrigin[1] + dy))
    }
  })
  ipcMain.on('overlay:end-drag', (e) => {
    if (win && !win.isDestroyed() && e.sender === win.webContents) {
      dragOrigin = null
      savePos()
    } else if (enemyWin && !enemyWin.isDestroyed() && e.sender === enemyWin.webContents) {
      enemyDragOrigin = null
      saveEnemyPos()
    }
  })
  ipcMain.on('overlay:loading-layout', (_e, active) => applyLoadingLayout(active))

  globalShortcut.register('Control+Shift+O', () => {
    pinned = !pinned
    applyIgnore()
    applyEnemyIgnore()
    if (pinned && win) win.focus()
  })
  globalShortcut.register('Control+Shift+H', () => {
    if (win.isVisible()) win.hide()
    else win.show()
    if (enemyWin.isVisible()) enemyWin.hide()
    else enemyWin.show()
  })
  globalShortcut.register('Control+Shift+Q', () => app.quit())
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
