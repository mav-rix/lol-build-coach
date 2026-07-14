// LoL Build Coach — LCU bridge.
//
// The League *Client* (not the game) exposes the LCU API on a random local
// HTTPS port with a password, both written to a "lockfile" while the client
// runs. Browsers can't read that file, can't do the Basic auth, and can't
// accept Riot's self-signed cert — so this tiny Node service does it on the
// Windows side and re-serves a simplified, CORS-open champ-select payload on a
// fixed port the WSL dev server can proxy to.
//
// Reads champ-select/summoner/gameflow endpoints; the only writes are loadout
// imports (rune page + item set). It never sends game actions to the client
// (no auto-pick/ban/dodge).

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
    req.end(payload ?? undefined)
  })
}

const lcuGet = (lock, apiPath) => lcuRequest(lock, 'GET', apiPath)

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

  // Queue (420/440 = ranked) + own rank, for the ranked-draft assistant.
  const [gfRes, selfRank] = await Promise.all([
    lcuGet(lock, '/lol-gameflow/v1/session'),
    getSelfRank(lock),
  ])
  const queueId = gfRes.json?.gameData?.queue?.id ?? -1
  // Queue gameMode + map, so the client can flag augmented-Abyss events (ARAM
  // Mayhem), which have no rune pages — item import only. Plain ARAM reads
  // exactly "ARAM"; event variants deviate. See isAugmentedAbyss in modes.ts.
  const gameMode = gfRes.json?.gameData?.queue?.gameMode ?? ''
  const mapId = gfRes.json?.gameData?.queue?.mapId ?? -1

  return {
    clientOpen: true,
    phase,
    inChampSelect: true,
    queueId,
    gameMode,
    mapId,
    selfRank,
    self: self
      ? { cellId: self.cellId, championId: self.championId, role: self.role, position: self.position }
      : null,
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

// --- build import — the only LCU writes this bridge performs ------------------
// Mirrors electron/server.js (duplicated rather than shared — same as
// champ-select). Imports the recommended build into the client: a rune page and
// a per-champion item set. Loadout configuration only. Pages and sets this app
// created are replaced on re-import; hand-made ones are never touched.
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

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  // Preflight for the POST import endpoints (the Vite proxy doesn't need it,
  // but a page talking to the bridge directly does).
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    res.statusCode = 204
    res.end()
    return
  }

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
  if (req.url === '/import-runes' || req.url === '/import-itemset') {
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end('{}')
      return
    }
    try {
      const payload = await readJsonBody(req)
      const result =
        req.url === '/import-runes' ? await importRunes(payload) : await importItemSet(payload)
      res.statusCode = result.status
      res.end(JSON.stringify(result.body))
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ ok: false, error: String(e) }))
    }
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ error: 'not found' }))
})

server.listen(PORT, HOST, () => {
  console.log(`LCU bridge listening on ${HOST}:${PORT} (lockfile: ${LOCKFILE})`)
})
