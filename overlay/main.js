// LoL Build Coach — in-game overlay shell.
// A transparent, always-on-top, click-through window that renders the web
// app's /overlay route. It is a separate OS window drawn above the game
// (League must be in Borderless/Windowed mode) — it never touches the game
// process, memory, or render pipeline.
//
// Hotkeys:
//   Ctrl+Shift+O — toggle interactive mode (click/scroll the overlay)
//   Ctrl+Shift+H — hide/show
//   Ctrl+Shift+Q — quit

const { app, BrowserWindow, globalShortcut, screen } = require('electron')

const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://localhost:5173/overlay'
const RETRY_MS = 2000

let win = null
let interactive = false
let reloadTimer = null

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
  win = new BrowserWindow({
    width: 410,
    height: Math.min(860, height - 80),
    x: width - 420,
    y: 40,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: { backgroundThrottling: false },
  })
  // 'screen-saver' level stays above borderless-fullscreen games. Note this
  // cannot beat EXCLUSIVE fullscreen — the game must be in Borderless mode.
  win.setAlwaysOnTop(true, 'screen-saver', 1)
  win.setIgnoreMouseEvents(true, { forward: true })
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

  globalShortcut.register('Control+Shift+O', () => {
    interactive = !interactive
    win.setIgnoreMouseEvents(!interactive, { forward: true })
    if (interactive) win.focus()
  })
  globalShortcut.register('Control+Shift+H', () => {
    if (win.isVisible()) win.hide()
    else win.show()
  })
  globalShortcut.register('Control+Shift+Q', () => app.quit())
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
