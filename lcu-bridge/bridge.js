// LoL Build Coach — LCU bridge.
//
// The League *Client* (not the game) exposes the LCU API on a random local
// HTTPS port with a password, both written to a "lockfile" while the client
// runs. Browsers can't read that file, can't do the Basic auth, and can't
// accept Riot's self-signed cert — so this tiny Node service does it on the
// Windows side and re-serves a simplified, CORS-open champ-select payload on a
// fixed port the WSL dev server can proxy to.
//
// Read-only: it only GETs champ-select/summoner/gameflow endpoints. It never
// sends actions to the client (no auto-pick/ban/dodge).

const fs = require('node:fs')
const http = require('node:http')
const https = require('node:https')

const LOCKFILE =
  process.env.LOCKFILE ?? 'C:\\Riot Games\\League of Legends\\lockfile'
const PORT = Number(process.env.BRIDGE_PORT ?? 2998)
// Loopback-only by default; WSL reaches it through a fixed netsh portproxy
// (see README). Set BRIDGE_HOST=0.0.0.0 to expose directly if you prefer.
const HOST = process.env.BRIDGE_HOST ?? '127.0.0.1'

function readLockfile() {
  try {
    const raw = fs.readFileSync(LOCKFILE, 'utf8').trim()
    // Format: LeagueClient:<pid>:<port>:<password>:<protocol>
    const parts = raw.split(':')
    if (parts.length < 5) return null
    return { port: parts[2], password: parts[3] }
  } catch {
    return null // client not running / no lockfile
  }
}

function lcuGet(lock, path) {
  return new Promise((resolve) => {
    const auth = 'Basic ' + Buffer.from('riot:' + lock.password).toString('base64')
    const req = https.request(
      {
        host: '127.0.0.1',
        port: lock.port,
        path,
        method: 'GET',
        headers: { Authorization: auth, Accept: 'application/json' },
        rejectUnauthorized: false, // Riot's self-signed cert
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

// LCU position strings → our roles.
const POSITION_TO_ROLE = {
  top: 'TOP',
  jungle: 'JUNGLE',
  middle: 'MID',
  bottom: 'ADC',
  utility: 'SUPPORT',
}

function normalizePlayer(cell) {
  return {
    cellId: cell.cellId,
    championId: cell.championId || cell.championPickIntent || 0,
    position: cell.assignedPosition || '',
    role: POSITION_TO_ROLE[cell.assignedPosition] ?? null,
  }
}

async function buildChampSelect() {
  const lock = readLockfile()
  if (!lock) return { clientOpen: false, phase: 'None', inChampSelect: false }

  const phaseRes = await lcuGet(lock, '/lol-gameflow/v1/gameflow-phase')
  const phase = phaseRes.json ?? 'Unknown'

  const csRes = await lcuGet(lock, '/lol-champ-select/v1/session')
  if (csRes.status !== 200 || !csRes.json) {
    return { clientOpen: true, phase, inChampSelect: false }
  }

  const session = csRes.json
  const myTeam = (session.myTeam ?? []).map(normalizePlayer)
  const theirTeam = (session.theirTeam ?? []).map(normalizePlayer)
  const self = myTeam.find((p) => p.cellId === session.localPlayerCellId) ?? null

  // Bans (revealed as they happen).
  const bans = []
  for (const action of (session.actions ?? []).flat()) {
    if (action.type === 'ban' && action.completed && action.championId) {
      bans.push(action.championId)
    }
  }

  return {
    clientOpen: true,
    phase,
    inChampSelect: true,
    self: self ? { championId: self.championId, role: self.role, position: self.position } : null,
    myTeam,
    theirTeam,
    // Enemy champion keys revealed so far (0s filtered out client-side).
    enemyChampionKeys: theirTeam.map((p) => p.championId),
    bans,
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  if (req.url === '/health') {
    const lock = readLockfile()
    res.end(JSON.stringify({ ok: true, clientOpen: lock !== null }))
    return
  }
  if (req.url === '/champ-select') {
    try {
      const payload = await buildChampSelect()
      res.end(JSON.stringify(payload))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(e) }))
    }
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, HOST, () => {
  console.log(`LCU bridge listening on ${HOST}:${PORT} (lockfile: ${LOCKFILE})`)
})
