// Minimal, safe bridge for dragging the overlay window from the renderer.
// contextIsolation is on, so the /overlay page talks to the main process only
// through this whitelisted surface — no Node access leaks into the page.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlay', {
  // Tell main whether the pointer is over a drag handle. While it is, main stops
  // ignoring mouse events so the handle is grabbable; otherwise the window stays
  // click-through and never blocks the game.
  setHover: (hover) => ipcRenderer.send('overlay:hover', Boolean(hover)),
  // Drag lifecycle: begin captures the window's current position; dragTo moves it
  // by a pointer delta; end persists the new position.
  beginDrag: () => ipcRenderer.send('overlay:begin-drag'),
  dragTo: (dx, dy) => ipcRenderer.send('overlay:drag-to', dx, dy),
  endDrag: () => ipcRenderer.send('overlay:end-drag'),
})
