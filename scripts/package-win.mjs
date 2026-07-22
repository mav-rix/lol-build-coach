#!/usr/bin/env node
// Package the desktop app (Windows). Builds the web bundle, stages the Electron
// app to the Windows side, and runs npm install + electron-builder there with
// the portable Node — Electron's binary downloads and NSIS run natively on
// Windows (they're blocked in some WSL sandboxes). WSL + Windows only.
//
//   node scripts/package-win.mjs [--publish]
//
// Output: C:\Users\<user>\lol-build-coach-pkg\release\ (installer + zip).
// --publish uploads to a GitHub Release via electron-builder (needs GH_TOKEN).

import { execSync } from 'node:child_process'
import { cpSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WIN_USER = process.env.WIN_USER ?? 'Eric'
const PKG = `/mnt/c/Users/${WIN_USER}/lol-build-coach-pkg`
const NODE_WIN = `C:\\Users\\${WIN_USER}\\node-v24.18.0-win-x64`
const publish = process.argv.includes('--publish') ? '--publish always' : '--publish never'

const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', cwd: ROOT, ...opts })

console.log('1/4 building web bundle…')
run('npm run build')

console.log('2/4 staging to Windows…')
// OCR language data for the augment-title reader (electron/augment-vision.js):
// fetched once, bundled so the packaged app never needs tesseract's CDN.
const TRAINED = join(ROOT, 'electron/eng.traineddata.gz')
if (!existsSync(TRAINED)) {
  console.log('  fetching eng.traineddata.gz…')
  const res = await fetch('https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz')
  if (!res.ok) throw new Error(`traineddata download failed: ${res.status}`)
  writeFileSync(TRAINED, Buffer.from(await res.arrayBuffer()))
}
rmSync(join(ROOT, 'electron/dist'), { recursive: true, force: true })
cpSync(join(ROOT, 'dist'), join(ROOT, 'electron/dist'), { recursive: true })
if (existsSync(PKG)) rmSync(PKG, { recursive: true, force: true })
mkdirSync(PKG, { recursive: true })
for (const f of [
  'main.js',
  'server.js',
  'preload.js',
  'app-preload.js',
  'augment-vision.js',
  'ocr-worker.js',
  'eng.traineddata.gz',
  'package.json',
]) {
  cpSync(join(ROOT, 'electron', f), join(PKG, f))
}
if (existsSync(join(ROOT, 'electron/icon.ico'))) cpSync(join(ROOT, 'electron/icon.ico'), join(PKG, 'icon.ico'))
cpSync(join(ROOT, 'electron/dist'), join(PKG, 'dist'), { recursive: true })

// Two-dir layout: the app dir holds ONLY production deps (so node_modules/** is
// safely force-included in the package), while electron + electron-builder live
// in a separate tools dir; the pinned electronVersion in the build config keeps
// them out of the app's dependency tree.
console.log('3/4 installing deps on Windows…')
const winCmd = (inner) => run(`/mnt/c/Windows/System32/cmd.exe /c "set PATH=${NODE_WIN};%PATH% && ${inner}"`)
const TOOLS = `C:\\Users\\${WIN_USER}\\lol-build-tools`
const PKG_WIN = `C:\\Users\\${WIN_USER}\\lol-build-coach-pkg`
const electronVersion = JSON.parse(
  readFileSync(join(ROOT, 'electron/package.json'), 'utf8'),
).build.electronVersion
winCmd(`mkdir ${TOOLS} 2>nul & cd /d ${TOOLS} && npm install electron-builder electron@${electronVersion} --no-audit --no-fund`)
winCmd(`cd /d ${PKG_WIN} && npm install --omit=dev --no-audit --no-fund`)

console.log('4/4 building installer…')
winCmd(`cd /d ${TOOLS} && npx electron-builder --project ${PKG_WIN} --win ${publish}`)

console.log(`\n✓ artifacts in C:\\Users\\${WIN_USER}\\lol-build-coach-pkg\\release\\`)
