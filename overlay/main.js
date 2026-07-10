// LoL Build Coach — in-game overlay shell.
// A transparent, always-on-top, click-through window that renders the web
// app's /overlay route. It is a separate OS window drawn above the game
// (League must be in Borderless/Windowed mode) — it never touches the game
// process, memory, or render pipeline.
//
// Moving it: press-and-hold the left mouse on the grip at the top of the card
// and drag — the window follows and its position is remembered. The grip is
// grabbable any time; the rest of the overlay stays click-through so it never
// blocks the game (or the Tab scoreboard).
//
// Hotkeys:
//   Ctrl+Shift+O — pin interactive mode (click/scroll the whole overlay)
//   Ctrl+Shift+H — hide/show
//   Ctrl+Shift+Q — quit

const { app, BrowserWindow, globalShortcut, screen, ipcMain } = require('electron')
const path = require('node:path')
const { readFileSync, writeFileSync } = require('node:fs')

const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://localhost:5173/overlay'
const RETRY_MS = 2000

let win = null
let pinned = false // Ctrl+Shift+O — whole overlay interactive
let hover = false // pointer is over the drag grip
let dragOrigin = null // window [x,y] captured at drag start
let reloadTimer = null

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

// The window is click-through unless it's pinned interactive or the pointer is
// over the grip. Keeping mouse-move forwarding on lets the renderer detect that
// hover even while click-through.
function applyIgnore() {
  if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!(pinned || hover), { forward: true })
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

app.whenReady().then(() => {
  createWindow()

  // Drag bridge (see overlay/preload.js).
  ipcMain.on('overlay:hover', (_e, h) => {
    hover = Boolean(h)
    applyIgnore()
  })
  ipcMain.on('overlay:begin-drag', () => {
    dragOrigin = win && !win.isDestroyed() ? win.getPosition() : null
  })
  ipcMain.on('overlay:drag-to', (_e, dx, dy) => {
    if (dragOrigin && win && !win.isDestroyed()) {
      win.setPosition(Math.round(dragOrigin[0] + dx), Math.round(dragOrigin[1] + dy))
    }
  })
  ipcMain.on('overlay:end-drag', () => {
    dragOrigin = null
    savePos()
  })

  globalShortcut.register('Control+Shift+O', () => {
    pinned = !pinned
    applyIgnore()
    if (pinned && win) win.focus()
  })
  globalShortcut.register('Control+Shift+H', () => {
    if (win.isVisible()) win.hide()
    else win.show()
  })
  globalShortcut.register('Control+Shift+Q', () => app.quit())
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
