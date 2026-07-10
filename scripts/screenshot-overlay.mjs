#!/usr/bin/env node
// Headless screenshot of the in-game overlay, rendered with mock data (no live
// game needed). Uses the Windows-side Edge/Chrome in headless mode — it reaches
// the WSL dev server over localhost and writes a PNG — so it needs no bundled
// Chromium (which can't download in some sandboxes). WSL + Windows only.
//
//   npm run dev            # dev server must be up
//   node scripts/screenshot-overlay.mjs [--champ Ahri] [--out shot.png] [--width 380] [--height 560]

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? 'true' : arr[i + 1]])
    return acc
  }, []),
)

const BROWSERS = [
  '/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]
const browser = BROWSERS.find((p) => existsSync(p))
if (!browser) {
  console.error('No Windows Edge/Chrome found under /mnt/c — this targets a WSL + Windows setup.')
  process.exit(1)
}

const champ = args.champ ?? 'Ahri'
const width = Number(args.width ?? 480) // wide enough that the right-aligned card isn't clipped
const height = Number(args.height ?? 560)
const port = process.env.PORT ?? '5173'
const mayhem = args.mayhem ? '&mayhem=1' : '' // show the ARAM Mayhem augment panel
const url = `http://localhost:${port}/overlay?mock=1&champ=${champ}${mayhem}`

// The browser is a Windows process, so its file args must be Windows paths.
const outWsl = args.out ?? `/mnt/c/Users/${process.env.WIN_USER ?? 'Eric'}/lol-overlay-shot.png`
const toWin = (p) => p.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\')

try {
  execFileSync(
    browser,
    [
      '--headless',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      `--window-size=${width},${height}`,
      '--virtual-time-budget=9000', // let DDragon fetch + React render settle
      `--screenshot=${toWin(outWsl)}`,
      `--user-data-dir=${toWin('/mnt/c/Users/' + (process.env.WIN_USER ?? 'Eric') + '/edge-shot')}`,
      url,
    ],
    { stdio: ['ignore', 'ignore', 'ignore'] },
  )
} catch {
  // Edge prints benign task-manager/sync errors and can exit non-zero even on
  // success; fall through to the file check below.
}

if (existsSync(outWsl)) console.log(`Screenshot written: ${outWsl}  (${champ}, ${width}x${height})`)
else {
  console.error('Screenshot not produced — is the dev server running on port ' + port + '?')
  process.exit(1)
}
