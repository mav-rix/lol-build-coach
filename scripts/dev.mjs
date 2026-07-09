// Dev-server launcher that auto-configures the WSL2 → Windows plumbing.
//
// When the dev server runs inside WSL2 but League runs on Windows, the game's
// Live Client Data API (127.0.0.1:2999) and our LCU bridge (127.0.0.1:2998)
// live on the *Windows* loopback, which WSL's own 127.0.0.1 can't reach. The
// documented fix (see README "Live tracker & WSL2") is a one-time Windows
// `netsh portproxy` exposing those on 23999/23998, then pointing the dev server
// at the Windows gateway IP. This script detects WSL and wires that up so a
// plain `npm run dev` just works — instead of having to remember the long
// LIVE_CLIENT_HOST=... LCU_HOST=... command every time.
//
// Everything stays overridable: any var you set yourself is left untouched, and
// on non-WSL hosts this is a no-op passthrough to vite. Ports match the README
// convention and can be overridden with LIVE_CLIENT_PORT / LCU_PORT.

import { spawn, execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const LIVE_CLIENT_PORT = process.env.LIVE_CLIENT_PORT ?? '23999'
const LCU_PORT = process.env.LCU_PORT ?? '23998'

function isWSL() {
  if (process.env.WSL_DISTRO_NAME) return true
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8'))
  } catch {
    return false
  }
}

/** WSL's default gateway is the Windows host. */
function windowsHostIP() {
  const route = execSync('ip route show default', { encoding: 'utf8' })
  const match = route.match(/default via (\d+\.\d+\.\d+\.\d+)/)
  if (!match) throw new Error('could not parse Windows host IP from `ip route`')
  return match[1]
}

const env = { ...process.env }
const viteArgs = process.argv.slice(2)

if (isWSL()) {
  try {
    const gw = windowsHostIP()
    // Only fill in what the user hasn't already set, so overrides win.
    env.LIVE_CLIENT_HOST ??= gw
    env.LIVE_CLIENT_PORT ??= LIVE_CLIENT_PORT
    env.LCU_HOST ??= gw
    env.LCU_PORT ??= LCU_PORT
    // Bind on all interfaces so the Windows-side Electron overlay can reach us.
    if (!viteArgs.includes('--host')) viteArgs.push('--host')
    console.log(
      `[dev] WSL detected — Windows host ${gw}; ` +
        `live-client → ${env.LIVE_CLIENT_HOST}:${env.LIVE_CLIENT_PORT}, ` +
        `LCU → ${env.LCU_HOST}:${env.LCU_PORT}. ` +
        `Requires the one-time Windows portproxy (see README).`,
    )
  } catch (err) {
    console.warn(`[dev] WSL detected but auto-config failed: ${err.message}`)
    console.warn('[dev] falling back to default localhost proxy targets.')
  }
}

// Run vite's JS entry directly under the current node — no shell, so the
// arguments aren't concatenated into a command string (avoids DEP0190). Vite's
// `exports` doesn't expose ./bin/vite.js, so derive it from the package's `bin`
// field relative to its resolvable package.json.
const require = createRequire(import.meta.url)
const vitePkgPath = require.resolve('vite/package.json')
const viteBin = resolve(dirname(vitePkgPath), require(vitePkgPath).bin.vite)
const child = spawn(process.execPath, [viteBin, ...viteArgs], {
  env,
  stdio: 'inherit',
})
child.on('exit', (code) => process.exit(code ?? 0))
