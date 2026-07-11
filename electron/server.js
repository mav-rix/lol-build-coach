// Embedded local server for the packaged app. Serves the built web bundle and
// provides the two local proxies the pages expect, so the web code runs
// unchanged from dev:
//
//   /liveclientdata/* → https://127.0.0.1:2999 (game's Live Client API,
//                       self-signed cert accepted; local loopback only)
//   /lcu/*            → League Client (LCU) via the lockfile — the old
//                       lcu-bridge folded in-process. Read-only endpoints only.
//   everything else   → static files from dist/ (index.html fallback for SPA
//                       routes)
//
// Binds 127.0.0.1 on an ephemeral port — nothing is exposed off-machine.

const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')
const path = require('node:path')

const LOCKFILE = process.env.LOCKFILE ?? 'C:\\Riot Games\\League of Legends\\lockfile'
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

// --- Live Client proxy -------------------------------------------------------
function proxyLiveClient(req, res) {
  const upstream = https.request(
    {
      host: '127.0.0.1',
      port: 2999,
      path: req.url,
      method: 'GET', // the Live Client API is read-only
      rejectUnauthorized: false, // Riot's self-signed cert
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, { 'Content-Type': 'application/json' })
      up.pipe(res)
    },
  )
  upstream.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end('{}')
  })
  upstream.setTimeout(4000, () => upstream.destroy())
  upstream.end()
}

// --- LCU (League Client) — read-only champ-select bridge ---------------------
function readLockfile() {
  try {
    const parts = fs.readFileSync(LOCKFILE, 'utf8').trim().split(':')
    if (parts.length < 5) return null
    return { port: parts[2], password: parts[3] }
  } catch {
    return null // client not running
  }
}

function lcuGet(lock, apiPath) {
  return new Promise((resolve) => {
    const auth = 'Basic ' + Buffer.from('riot:' + lock.password).toString('base64')
    const req = https.request(
      {
        host: '127.0.0.1',
        port: lock.port,
        path: apiPath,
        method: 'GET',
        headers: { Authorization: auth, Accept: 'application/json' },
        rejectUnauthorized: false,
      },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          let json = null
          try {
            json = data ? JSON.parse(data) : null
          } catch {
            json = null
          }
          resolve({ status: res.statusCode, json })
        })
      },
    )
    req.on('error', () => resolve({ status: 0, json: null }))
    req.setTimeout(3000, () => req.destroy())
    req.end()
  })
}

const POSITION_TO_ROLE = {
  top: 'TOP',
  jungle: 'JUNGLE',
  middle: 'MID',
  bottom: 'ADC',
  utility: 'SUPPORT',
}

const normalizePlayer = (cell) => ({
  cellId: cell.cellId,
  championId: cell.championId || cell.championPickIntent || 0,
  position: cell.assignedPosition || '',
  role: POSITION_TO_ROLE[cell.assignedPosition] ?? null,
})

async function buildChampSelect() {
  const lock = readLockfile()
  if (!lock) return { clientOpen: false, phase: 'None', inChampSelect: false }
  const phase = (await lcuGet(lock, '/lol-gameflow/v1/gameflow-phase')).json ?? 'Unknown'
  const csRes = await lcuGet(lock, '/lol-champ-select/v1/session')
  if (csRes.status !== 200 || !csRes.json) return { clientOpen: true, phase, inChampSelect: false }
  const session = csRes.json
  const myTeam = (session.myTeam ?? []).map(normalizePlayer)
  const theirTeam = (session.theirTeam ?? []).map(normalizePlayer)
  const self = myTeam.find((p) => p.cellId === session.localPlayerCellId) ?? null
  const bans = []
  for (const action of (session.actions ?? []).flat()) {
    if (action.type === 'ban' && action.completed && action.championId) bans.push(action.championId)
  }
  return {
    clientOpen: true,
    phase,
    inChampSelect: true,
    self: self ? { championId: self.championId, role: self.role, position: self.position } : null,
    myTeam,
    theirTeam,
    enemyChampionKeys: theirTeam.map((p) => p.championId),
    bans,
  }
}

async function handleLcu(req, res) {
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/lcu/health') {
    res.end(JSON.stringify({ ok: true, clientOpen: readLockfile() !== null }))
    return
  }
  if (req.url === '/lcu/champ-select') {
    try {
      res.end(JSON.stringify(await buildChampSelect()))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(e) }))
    }
    return
  }
  res.statusCode = 404
  res.end('{}')
}

// --- static files -------------------------------------------------------------
function serveStatic(distDir, req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let filePath = path.join(distDir, urlPath)
  // Path-traversal guard + SPA fallback.
  if (!filePath.startsWith(distDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(distDir, 'index.html')
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
  })
  fs.createReadStream(filePath).pipe(res)
}

/** Start the embedded server; resolves the base URL (http://127.0.0.1:PORT). */
function startServer(distDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/liveclientdata/')) return proxyLiveClient(req, res)
      if (req.url.startsWith('/lcu/')) return handleLcu(req, res)
      return serveStatic(distDir, req, res)
    })
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` })
    })
  })
}

module.exports = { startServer }
