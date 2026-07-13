// Embedded local server for the packaged app. Serves the built web bundle and
// provides the two local proxies the pages expect, so the web code runs
// unchanged from dev:
//
//   /liveclientdata/* → https://127.0.0.1:2999 (game's Live Client API,
//                       self-signed cert accepted; local loopback only)
//   /lcu/*            → League Client (LCU) via the lockfile — the old
//                       lcu-bridge folded in-process. Reads champ-select state;
//                       the only writes are loadout imports (rune page + item
//                       set) — it never picks, bans, or dodges.
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

function lcuRequest(lock, method, apiPath, body) {
  return new Promise((resolve) => {
    const auth = 'Basic ' + Buffer.from('riot:' + lock.password).toString('base64')
    const payload = body === undefined ? null : JSON.stringify(body)
    const req = https.request(
      {
        host: '127.0.0.1',
        port: lock.port,
        path: apiPath,
        method,
        headers: {
          Authorization: auth,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
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
    req.end(payload ?? undefined)
  })
}

const lcuGet = (lock, apiPath) => lcuRequest(lock, 'GET', apiPath)

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

// The player's solo-queue rank, for the ranked-draft panel ("most OP in your
// elo"). Rank barely moves within a session, so cache it briefly.
let selfRankCache = { at: 0, rank: null }
async function getSelfRank(lock) {
  if (Date.now() - selfRankCache.at < 5 * 60 * 1000) return selfRankCache.rank
  const res = await lcuGet(lock, '/lol-ranked/v1/current-ranked-stats')
  const solo = res.json?.queueMap?.RANKED_SOLO_5x5
  const entry = solo?.tier ? solo : res.json?.highestRankedEntry
  const rank =
    entry?.tier && entry.tier !== 'NONE' && entry.tier !== 'UNRANKED'
      ? {
          tier: entry.tier,
          division: entry.division && entry.division !== 'NA' ? entry.division : '',
        }
      : null
  selfRankCache = { at: Date.now(), rank }
  return rank
}

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
  // Queue (420/440 = ranked) + own rank, for the ranked-draft assistant.
  const [gfRes, selfRank] = await Promise.all([
    lcuGet(lock, '/lol-gameflow/v1/session'),
    getSelfRank(lock),
  ])
  const queueId = gfRes.json?.gameData?.queue?.id ?? -1
  return {
    clientOpen: true,
    phase,
    inChampSelect: true,
    queueId,
    selfRank,
    self: self
      ? { cellId: self.cellId, championId: self.championId, role: self.role, position: self.position }
      : null,
    myTeam,
    theirTeam,
    enemyChampionKeys: theirTeam.map((p) => p.championId),
    bans,
  }
}

// --- loading screen — both teams + rank/streak scouting -----------------------
// During the loading screen (gameflow GameStart → early InProgress, before the
// game's Live Client API is up) the gameflow session already lists all ten
// players. Enrich each once per game with ranked tier and a recent-form streak
// from the LCU's own read-only endpoints, then serve the cached result to every
// poll for the rest of that game.
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

// --- build import — the only LCU writes this server performs ------------------
// Imports the recommended build into the client: a rune page and a per-champion
// item set (what the in-game shop shows). Loadout configuration only. Pages and
// sets this app created are replaced on re-import; hand-made ones are never
// touched.
const COACH_PREFIX = 'Coach:'
const ITEM_SET_UID_PREFIX = 'lol-build-coach-'
// The client caps rune page names at 25 chars and rejects longer ones.
const RUNE_PAGE_NAME_MAX = 25

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 64 * 1024) req.destroy() // no legitimate payload is this big
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(data))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

async function importRunes(payload) {
  const lock = readLockfile()
  if (!lock) return { status: 503, body: { ok: false, error: 'League client is not running.' } }
  const name = typeof payload?.name === 'string' ? payload.name.slice(0, RUNE_PAGE_NAME_MAX) : ''
  const primaryStyleId = payload?.primaryStyleId
  const subStyleId = payload?.subStyleId
  const perks = Array.isArray(payload?.selectedPerkIds) ? payload.selectedPerkIds : []
  // A full page is exactly 9 perks: keystone + 3 primary + 2 secondary + 3 shards.
  if (
    !name.startsWith(COACH_PREFIX) ||
    !Number.isFinite(primaryStyleId) ||
    !Number.isFinite(subStyleId) ||
    perks.length !== 9 ||
    !perks.every(Number.isFinite)
  ) {
    return { status: 400, body: { ok: false, error: 'Malformed rune page payload.' } }
  }

  const pages = (await lcuGet(lock, '/lol-perks/v1/pages')).json
  for (const page of Array.isArray(pages) ? pages : []) {
    if (page?.isDeletable && typeof page.name === 'string' && page.name.startsWith(COACH_PREFIX)) {
      await lcuRequest(lock, 'DELETE', `/lol-perks/v1/pages/${page.id}`)
    }
  }
  const created = await lcuRequest(lock, 'POST', '/lol-perks/v1/pages', {
    name,
    primaryStyleId,
    subStyleId,
    selectedPerkIds: perks,
    current: true,
  })
  if (created.status !== 200 && created.status !== 201) {
    const detail = created.json?.message
    return {
      status: 502,
      body: {
        ok: false,
        error: detail
          ? `Client rejected the rune page: ${detail}`
          : 'Client rejected the rune page — if your pages are full, delete one and retry.',
      },
    }
  }
  return { status: 200, body: { ok: true } }
}

async function importItemSet(payload) {
  const lock = readLockfile()
  if (!lock) return { status: 503, body: { ok: false, error: 'League client is not running.' } }
  const title = typeof payload?.title === 'string' ? payload.title.slice(0, 75) : ''
  const champions = Array.isArray(payload?.associatedChampions)
    ? payload.associatedChampions.filter(Number.isFinite)
    : []
  const maps = Array.isArray(payload?.associatedMaps)
    ? payload.associatedMaps.filter(Number.isFinite)
    : []
  const blocks = (Array.isArray(payload?.blocks) ? payload.blocks : [])
    .filter((b) => typeof b?.type === 'string' && Array.isArray(b?.items))
    .map((b) => ({
      type: b.type,
      items: b.items
        .filter((it) => typeof it?.id === 'string' && /^\d+$/.test(it.id))
        .map((it) => ({ id: it.id, count: 1 })),
    }))
    .filter((b) => b.items.length > 0)
  if (!title.startsWith(COACH_PREFIX) || champions.length === 0 || blocks.length === 0) {
    return { status: 400, body: { ok: false, error: 'Malformed item set payload.' } }
  }

  const summoner = (await lcuGet(lock, '/lol-summoner/v1/current-summoner')).json
  if (!summoner?.summonerId) {
    return { status: 502, body: { ok: false, error: 'Could not resolve the current summoner.' } }
  }
  const setsPath = `/lol-item-sets/v1/item-sets/${summoner.summonerId}/sets`
  const existing = (await lcuGet(lock, setsPath)).json
  // One set per champion+map, replaced on re-import; other sets pass through.
  const uid = `${ITEM_SET_UID_PREFIX}${champions[0]}-${maps[0] ?? 'any'}`
  const kept = (Array.isArray(existing?.itemSets) ? existing.itemSets : []).filter(
    (s) => s?.uid !== uid,
  )
  const put = await lcuRequest(lock, 'PUT', setsPath, {
    accountId: existing?.accountId ?? summoner.accountId ?? 0,
    timestamp: Date.now(),
    itemSets: [
      ...kept,
      {
        uid,
        title,
        type: 'custom',
        map: 'any',
        mode: 'any',
        startedFrom: 'blank',
        priority: false,
        sortrank: 0,
        preferredItemSlots: [],
        associatedChampions: champions,
        associatedMaps: maps,
        blocks,
      },
    ],
  })
  if (put.status < 200 || put.status >= 300) {
    return { status: 502, body: { ok: false, error: 'Client rejected the item set.' } }
  }
  return { status: 200, body: { ok: true } }
}

async function handleLcu(req, res) {
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/lcu/health') {
    res.end(
      JSON.stringify({ ok: true, clientOpen: readLockfile() !== null, windowMode: readWindowMode() }),
    )
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
  if (req.url === '/lcu/loading-screen') {
    try {
      res.end(JSON.stringify(await buildLoadingScreen()))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: String(e) }))
    }
    return
  }
  if (req.url === '/lcu/import-runes' || req.url === '/lcu/import-itemset') {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('{}')
      return
    }
    try {
      const payload = await readJsonBody(req)
      const result =
        req.url === '/lcu/import-runes'
          ? await importRunes(payload)
          : await importItemSet(payload)
      res.statusCode = result.status
      res.end(JSON.stringify(result.body))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ ok: false, error: String(e) }))
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
