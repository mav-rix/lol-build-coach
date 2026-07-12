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
const path = require('node:path')

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

// League's Video setting, from <League dir>/Config/game.cfg next to the
// lockfile. 0 = Fullscreen (exclusive — an overlay window CANNOT be drawn
// above it), 1 = Windowed, 2 = Borderless. null when unreadable.
function readWindowMode() {
  try {
    const cfg = fs.readFileSync(path.join(path.dirname(LOCKFILE), 'Config', 'game.cfg'), 'utf8')
    const m = cfg.match(/^\s*WindowMode\s*=\s*(\d)/m)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

// --- loading screen — both teams + rank/streak scouting -----------------------
// Mirrors electron/server.js (this bridge runs standalone from a Windows-side
// copy, so the logic is duplicated rather than shared — same as champ-select).
const playerName = (p) =>
  p.riotIdGameName ||
  p.gameName ||
  (typeof p.riotId === 'string' ? p.riotId.split('#')[0] : '') ||
  p.summonerName ||
  'Summoner'

async function enrichPlayer(lock, p, self) {
  const puuid = p.puuid || null
  const base = {
    championId: p.championId ?? 0,
    name: playerName(p),
    isSelf: Boolean(
      (puuid && puuid === self?.puuid) ||
        (p.summonerId && p.summonerId === self?.summonerId),
    ),
    rank: null, // { tier, division } — solo queue, else highest entry
    streak: null, // { kind: 'hot' | 'cold', count } — 3+ consecutive results
    recent: null, // { wins, losses } over the last ≤10 games
  }
  if (!puuid) return base
  const [ranked, hist] = await Promise.all([
    lcuGet(lock, `/lol-ranked/v1/ranked-stats/${puuid}`),
    lcuGet(lock, `/lol-match-history/v1/products/lol/${puuid}/matches?begIndex=0&endIndex=9`),
  ])
  const solo = ranked.json?.queueMap?.RANKED_SOLO_5x5
  const entry = solo?.tier ? solo : ranked.json?.highestRankedEntry
  if (entry?.tier && entry.tier !== 'NONE' && entry.tier !== 'UNRANKED') {
    base.rank = {
      tier: entry.tier,
      division: entry.division && entry.division !== 'NA' ? entry.division : '',
    }
  }
  // Product match history returns only the requested player's participant.
  const results = (hist.json?.games?.games ?? [])
    .slice()
    .sort((a, b) => (b?.gameCreation ?? 0) - (a?.gameCreation ?? 0))
    .map((g) => g?.participants?.[0]?.stats?.win)
    .filter((w) => typeof w === 'boolean')
  if (results.length > 0) {
    let run = 1
    while (run < results.length && results[run] === results[0]) run++
    const wins = results.filter(Boolean).length
    base.recent = { wins, losses: results.length - wins }
    if (run >= 3) base.streak = { kind: results[0] ? 'hot' : 'cold', count: run }
  }
  return base
}

async function enrichTeams(lock, teamOne, teamTwo) {
  const self = (await lcuGet(lock, '/lol-summoner/v1/current-summoner')).json
  const [one, two] = await Promise.all([
    Promise.all(teamOne.map((p) => enrichPlayer(lock, p, self))),
    Promise.all(teamTwo.map((p) => enrichPlayer(lock, p, self))),
  ])
  return two.some((p) => p.isSelf) && !one.some((p) => p.isSelf)
    ? { myTeam: two, enemyTeam: one }
    : { myTeam: one, enemyTeam: two }
}

// One enrichment per game — ~20 LCU calls total, not per poll.
let loadingCache = { gameId: 0, promise: null }

async function buildLoadingScreen() {
  const lock = readLockfile()
  const windowMode = readWindowMode()
  if (!lock) return { available: false, phase: 'None', show: false, windowMode }
  const phase = (await lcuGet(lock, '/lol-gameflow/v1/gameflow-phase')).json ?? 'Unknown'
  if (phase !== 'GameStart' && phase !== 'InProgress') {
    loadingCache = { gameId: 0, promise: null }
    return { available: true, phase, show: false, windowMode }
  }
  const gd = (await lcuGet(lock, '/lol-gameflow/v1/session')).json?.gameData
  const teamOne = gd?.teamOne ?? []
  const teamTwo = gd?.teamTwo ?? []
  if (teamOne.length + teamTwo.length === 0)
    return { available: true, phase, show: false, windowMode }
  const gameId = gd?.gameId ?? -1
  if (loadingCache.gameId !== gameId || !loadingCache.promise) {
    loadingCache = { gameId, promise: enrichTeams(lock, teamOne, teamTwo) }
  }
  let teams
  try {
    teams = await loadingCache.promise
  } catch {
    loadingCache = { gameId: 0, promise: null } // retry on the next poll
    return { available: true, phase, show: false, windowMode }
  }
  return { available: true, phase, show: true, windowMode, ...teams }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  if (req.url === '/health') {
    const lock = readLockfile()
    res.end(JSON.stringify({ ok: true, clientOpen: lock !== null, windowMode: readWindowMode() }))
    return
  }
  if (req.url === '/loading-screen') {
    try {
      res.end(JSON.stringify(await buildLoadingScreen()))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(e) }))
    }
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
