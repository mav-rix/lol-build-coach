#!/usr/bin/env node
// Dev helper for the Electron shell. The Electron app serves the *built* bundle
// from electron/dist via its embedded server (electron/server.js) — it never
// talks to the Vite dev server — so seeing a UI change in the real app means
// rebuilding and re-staging. This does both in one step:
//
//   node scripts/electron-dev.mjs   (npm run electron:dev)
//
// It does NOT launch Electron itself: Electron is a Windows app (native global
// Tab hook, C:\Riot Games lockfile) and isn't installed in this repo. Run
// `npm run package:win` once to install it Windows-side, then relaunch with the
// printed command. For fast UI iteration prefer `npm run dev` in a browser.

import { execSync } from 'node:child_process'
import { cpSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WIN_USER = process.env.WIN_USER ?? 'Eric'
const PKG = `/mnt/c/Users/${WIN_USER}/lol-build-coach-pkg`

console.log('1/2 building web bundle…')
execSync('npm run build', { stdio: 'inherit', cwd: ROOT })

console.log('2/2 staging bundle to electron/dist…')
const stageDist = (destDir) => {
  rmSync(join(destDir, 'dist'), { recursive: true, force: true })
  cpSync(join(ROOT, 'dist'), join(destDir, 'dist'), { recursive: true })
}
stageDist(join(ROOT, 'electron'))

// If the app has already been packaged (npm run package:win), the running
// Electron process launches from the Windows-side pkg dir with its own copy of
// the bundle — refresh that too so a relaunch actually shows the change without
// reinstalling deps or rebuilding the installer.
if (existsSync(PKG)) {
  stageDist(PKG)
  console.log(
    '\n✓ bundle refreshed. Relaunch the app on Windows with:\n' +
      `    cd C:\\Users\\${WIN_USER}\\lol-build-coach-pkg\n` +
      '    ..\\lol-build-tools\\node_modules\\.bin\\electron .\n',
  )
} else {
  console.log(
    '\n✓ electron/dist is up to date, but the app has never been packaged, so\n' +
      '  Electron + its native deps are not installed on the Windows side yet.\n' +
      '  Run `npm run package:win` once, then relaunch with:\n' +
      `    cd C:\\Users\\${WIN_USER}\\lol-build-coach-pkg\n` +
      '    ..\\lol-build-tools\\node_modules\\.bin\\electron .\n',
  )
}
