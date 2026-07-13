---
name: verify
description: Build, launch, and visually verify LoL Build Coach changes end-to-end (WSL dev server + Windows headless Edge screenshots)
---

# Verifying LoL Build Coach changes

Vite React app; the GUI is the surface. No live League client is needed — every
page has a mock query param.

## Build + lint

```bash
npm run build   # tsc -b && vite build
npm run lint    # oxlint
```

## Launch + screenshot (WSL + Windows)

WSL has no browser; use Windows headless Edge over localhost (same trick as
`scripts/screenshot-overlay.mjs`):

```bash
npx vite --port 5199 &   # dev:plain; avoids scripts/dev.mjs extras
B="/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
"$B" --headless --disable-gpu --no-first-run --no-default-browser-check \
  --hide-scrollbars --window-size=1100,1900 --virtual-time-budget=9000 \
  --screenshot='C:\Users\Eric\shot.png' --user-data-dir='C:\Users\Eric\edge-shot' \
  "http://localhost:5199/?mockcs=1"
# then Read /mnt/c/Users/Eric/shot.png
```

- File args to Edge must be **Windows** paths; read the result via `/mnt/c/...`.
- `--virtual-time-budget` lets DDragon fetches + React settle.
- Edge may exit non-zero on success — check the PNG exists instead.

## Mock flows (no game/client needed)

- Build page champ select + ranked draft panel: `/?mockcs=1`
- Live tracker: `/live?mock=1&champ=Nocturne`
- Overlay: `/overlay?mock=1&champ=Ahri` (or `npm run overlay:shot`)
- Bridge-down noise in the vite log (`http proxy error: /champ-select`,
  ECONNREFUSED 2998) is normal when the League client/bridge isn't running.

## Gotchas

- The zustand store persists in the Edge profile's localStorage, so state from a
  mock visit (e.g. enemy team) carries into later screenshots with the same
  `--user-data-dir`.
- Data scripts are offline-verifiable: `node scripts/aggregate-builds.mjs
  --dry-run` and `node scripts/aggregate-ranked-stats.mjs --cached-only` run
  from `.cache/riot` with zero API calls.
