// Minimal, safe bridge for dragging the overlay window from the renderer.
// contextIsolation is on, so the /overlay page talks to the main process only
// through this whitelisted surface — no Node access leaks into the page.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('overlay', {
  // Report the drag-handle rects (window-relative CSS px). Main polls the
  // cursor against them and makes the window interactive while the pointer is
  // over one — hover can't be detected renderer-side because the window is
  // click-through WITHOUT mouse-move forwarding (forward:true = a global mouse
  // hook = in-game cursor lag).
  reportHandles: (rects) => ipcRenderer.send('overlay:handles', rects),
  // Main's poll result: is the pointer over a drag handle right now?
  onGripHover: (cb) => {
    const listener = (_e, h) => cb(Boolean(h))
    ipcRenderer.on('overlay:grip-hover', listener)
    return () => ipcRenderer.removeListener('overlay:grip-hover', listener)
  },
  // Drag lifecycle: begin captures the window's current position; dragTo moves it
  // by a pointer delta; end persists the new position.
  beginDrag: () => ipcRenderer.send('overlay:begin-drag'),
  dragTo: (dx, dy) => ipcRenderer.send('overlay:drag-to', dx, dy),
  endDrag: () => ipcRenderer.send('overlay:end-drag'),
  // League loading screen up/down: main swaps the window between the side-card
  // bounds and a large centered panel, and forces it visible while loading.
  setLoadingLayout: (active) => ipcRenderer.send('overlay:loading-layout', Boolean(active)),
})
