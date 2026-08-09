#!/usr/bin/env node
// Ranked champion-stats aggregator: samples the RANKED_SOLO_5x5 ladder per elo
// bucket and turns Match-V5 data into per-champion pick/win/ban rates (plus
// per-role winrates), written to src/data/rankedChampStats.json. The frontend's
// ranked-draft panel reads it to suggest bans ("most OP in your elo") and picks.
// Runs offline with a Riot dev key — same model as aggregate-builds.mjs.
//
//   RIOT_API_KEY=... node scripts/aggregate-ranked-stats.mjs --region na1 --buckets silver_gold --matches 400
//
// Flags (all optional):
//   --region <platform>   na1|euw1|kr|...          (default na1)
//   --buckets <list>      iron_bronze,silver_gold,plat_emerald,diamond,master_plus
//                         (default all five)
//   --matches <n>         max matches per bucket   (default 400)
//   --per-player <n>      match ids pulled per player (default 10)
//   --patches <n>         keep only the N newest patches seen (default 3)
//   --pages <n>           ladder pages sampled per non-apex tier (default 1,
//                         ~200 players each) — raise it when --since filters
//                         most seeds out
//   --since <days>        only count games newer than this, at BOTH ends: sent
//                         as startTime when pulling match ids, and re-checked
//                         against gameCreation when aggregating (so it also
//                         cleans up a stale --cached-only pool)
//   --out <path>          output json (default src/data/rankedChampStats.json)
//   --cached-only         re-aggregate the disk cache, zero API calls. The
//                         pre-existing aggregate-builds cache (sampled from
//                         master/GM/challenger ladders) feeds MASTER_PLUS.
//
// Buckets already in the output are preserved when a run only refreshes some of
// them, as long as they're from the same patch window.
//
// WHY --since MATTERS: the match-ids endpoint has no implicit date bound, so a
// seed player's "last 10 ranked games" can be months old. The paged entries
// ladder (every bucket below Master) is full of abandoned accounts, so without
// --since the low buckets fill up with last-season games and the patch window
// then happily keeps them: IRON_BRONZE once reported "16.15" off 58% patch-16.13
// data. Apex buckets hide the problem because those players are always active.

import {
  writeFileSync,
  readFileSync,
  readdirSync,
  mkdirSync,
  existsSync,
  openSync,
  readSync,
  closeSync,
  fstatSync,
} from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  process.loadEnvFile(join(ROOT, '.env'))
} catch {
  // no .env file — rely on the ambient environment
}

const API_KEY = process.env.RIOT_API_KEY

// ---- config ---------------------------------------------------------------
const args = parseArgs(process.argv.slice(2))
const REGIONS = (args.region ?? 'na1')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
const MATCH_LIMIT = Number(args.matches ?? 400)
const PER_PLAYER = Number(args['per-player'] ?? 10)
const PATCH_WINDOW = Number(args.patches ?? 3)
const CACHED_ONLY = Boolean(args['cached-only'])
const SEED_PAGES = Number(args.pages ?? 1)
const SINCE_DAYS = args.since ? Number(args.since) : 0
const SINCE_MS = SINCE_DAYS ? Date.now() - SINCE_DAYS * 86_400_000 : 0
const OUT = args.out ? resolve(args.out) : join(ROOT, 'src/data/rankedChampStats.json')
const QUEUE = 420 // ranked solo/duo

// Elo buckets. Apex tiers use the league-v4 ladder endpoints; the rest sample
// the paged entries endpoint (division II ≈ the middle of each tier).
const BUCKETS = {
  IRON_BRONZE: { tiers: ['IRON', 'BRONZE'], label: 'Iron–Bronze' },
  SILVER_GOLD: { tiers: ['SILVER', 'GOLD'], label: 'Silver–Gold' },
  PLAT_EMERALD: { tiers: ['PLATINUM', 'EMERALD'], label: 'Platinum–Emerald' },
  DIAMOND: { tiers: ['DIAMOND'], label: 'Diamond' },
  MASTER_PLUS: { tiers: ['MASTER', 'GRANDMASTER', 'CHALLENGER'], label: 'Master+' },
}
const APEX = {
  CHALLENGER: '/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5',
  GRANDMASTER: '/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5',
  MASTER: '/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5',
}
const BUCKET_KEYS = (args.buckets ?? Object.keys(BUCKETS).join(','))
  .split(',')
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)
for (const k of BUCKET_KEYS) {
  if (!BUCKETS[k]) {
    console.error(`Unknown bucket "${k}" (expected ${Object.keys(BUCKETS).join(', ').toLowerCase()})`)
    process.exit(1)
  }
}

// Dev key allows 100 req / 2 min ≈ one per 1.2s; hold a floor so we never 429.
const MIN_INTERVAL = Number(process.env.RIOT_MIN_INTERVAL_MS ?? 1300)

const platformHost = (p) => `${p}.api.riotgames.com`
const regionHost = (p) => `${regionalCluster(p)}.api.riotgames.com`
const regionalHostForMatch = (matchId) => regionHost(matchId.split('_')[0].toLowerCase())
const ROLE_MAP = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', BOTTOM: 'ADC', UTILITY: 'SUPPORT' }

const CACHE = join(ROOT, '.cache/riot')
mkdirSync(CACHE, { recursive: true })
// Which match ids each bucket sampled, so --cached-only reruns keep buckets
// separate (a Silver match must not leak into the Master+ pool and vice versa).
const MANIFEST = join(CACHE, 'ranked-stats-manifest.json')

// ---- Riot fetch (serialized + rate-limited + 429/5xx aware) ---------------
let lastReq = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function riotGet(host, path) {
  for (;;) {
    const wait = lastReq + MIN_INTERVAL - Date.now()
    if (wait > 0) await sleep(wait)
    lastReq = Date.now()
    const res = await fetch(`https://${host}${path}`, { headers: { 'X-Riot-Token': API_KEY } })
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? 5)
      console.warn(`  · 429 rate-limited, waiting ${retry}s`)
      await sleep((retry + 1) * 1000)
      continue
    }
    if (res.status === 404) return null
    if (res.status === 401 || res.status === 403) {
      console.error(`\n  ✗ ${res.status} from Riot — the dev key is invalid or expired (they last 24h).`)
      console.error('    Regenerate at developer.riotgames.com, update .env, and re-run — cached matches are kept.')
      process.exit(1)
    }
    if (res.status >= 500) {
      console.warn(`  · ${res.status} from Riot, retrying in 3s`)
      await sleep(3000)
      continue
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`)
    return res.json()
  }
}

const matchFile = (id) => join(CACHE, `${id}.match.json`)

// Matches are immutable — cache to disk so reruns never refetch. Shares the
// aggregate-builds cache (same file naming), so pools cross-pollinate for free.
async function cachedMatch(id) {
  const file = matchFile(id)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const data = await riotGet(regionalHostForMatch(id), `/lol/match/v5/matches/${id}`)
  if (data) writeFileSync(file, JSON.stringify(data))
  return data
}

/**
 * Patch / date / queue of one match, without keeping the match itself. Reads
 * the cached file as text and picks the three fields off it, because a full
 * JSON.parse of every pooled match is what used to exhaust the heap — the
 * MASTER_PLUS pool is ~30k matches averaging most of a megabyte each.
 * Falls back to a real parse if the fast path misses anything, and fetches the
 * match first when it isn't cached yet.
 */
async function matchMeta(id) {
  const file = matchFile(id)
  if (existsSync(file)) {
    // Riot serialises info's keys in roughly alphabetical order, which puts
    // gameCreation/gameVersion in the first ~2% of the file and queueId in the
    // last ~1% (participants[] fills everything between). Grabbing 4K off each
    // end beats reading all ~73KB, and the pool is ~49k files.
    for (const raw of [headTail(file), null]) {
      const text = raw ?? readFileSync(file, 'utf8') // full read only if that missed
      const ver = text.match(/"gameVersion":"(\d+)\.(\d+)/)
      const created = text.match(/"gameCreation":(\d+)/)
      const queue = text.match(/"queueId":(\d+)/)
      if (ver && created && queue) {
        return {
          patch: `${ver[1]}.${ver[2]}`,
          created: Number(created[1]),
          queueId: Number(queue[1]),
        }
      }
    }
  }
  const match = await cachedMatch(id)
  if (!match?.info) return null
  return {
    patch: gamePatch(match),
    created: match.info.gameCreation,
    queueId: match.info.queueId,
  }
}

/** First and last `bytes` of a file, concatenated. */
function headTail(file, bytes = 4096) {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const head = Buffer.alloc(Math.min(bytes, size))
    readSync(fd, head, 0, head.length, 0)
    if (size <= bytes) return head.toString('utf8')
    const tail = Buffer.alloc(bytes)
    readSync(fd, tail, 0, bytes, size - bytes)
    // Joined with a newline so a key can't be forged across the seam.
    return `${head.toString('utf8')}\n${tail.toString('utf8')}`
  } finally {
    closeSync(fd)
  }
}

// ---- Data Dragon (numeric key ↔ champion id) -------------------------------
async function loadStatic() {
  const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json()
  const patch = versions[0]
  const champs = (
    await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`)).json()
  ).data
  const byKey = {}
  const byLower = {}
  for (const id of Object.keys(champs)) {
    byKey[Number(champs[id].key)] = id
    byLower[id.toLowerCase()] = id
  }
  return { patch, byKey, byLower }
}

// ---- sampling ---------------------------------------------------------------
async function gatherPuuids(platform, tiers) {
  const puuids = new Set()
  for (const tier of tiers) {
    if (APEX[tier]) {
      const list = await riotGet(platformHost(platform), APEX[tier])
      for (const e of list?.entries ?? []) if (e.puuid) puuids.add(e.puuid)
      console.log(`  ${tier}: ${list?.entries?.length ?? 0} entries`)
    } else {
      // One page of division II is ~200 players. That's plenty when every seed
      // yields matches, but --since discards inactive accounts entirely, so
      // --pages buys the extra seeds needed to still hit --matches.
      let got = 0
      for (let page = 1; page <= SEED_PAGES; page++) {
        const list = await riotGet(
          platformHost(platform),
          `/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/II?page=${page}`,
        )
        if (!list?.length) break // ran off the end of the ladder
        for (const e of list) if (e.puuid) puuids.add(e.puuid)
        got += list.length
      }
      console.log(`  ${tier} II: ${got} entries over ${SEED_PAGES} page(s)`)
    }
  }
  return [...puuids]
}

async function gatherMatchIds(puuids, platform, limit) {
  const ids = new Set()
  const shuffled = puuids.sort(() => Math.random() - 0.5)
  // startTime is epoch SECONDS here, unlike gameCreation's milliseconds.
  const since = SINCE_MS ? `&startTime=${Math.floor(SINCE_MS / 1000)}` : ''
  for (const puuid of shuffled) {
    if (ids.size >= limit) break
    const list = await riotGet(
      regionHost(platform),
      `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${QUEUE}&count=${PER_PLAYER}${since}`,
    )
    for (const id of list ?? []) {
      ids.add(id)
      if (ids.size >= limit) break
    }
  }
  return [...ids]
}

// ---- aggregation ------------------------------------------------------------
const gamePatch = (match) => match.info.gameVersion.split('.').slice(0, 2).join('.')
const patchNum = (p) => {
  const [maj, min] = p.split('.').map(Number)
  return (maj || 0) * 1000 + (min || 0)
}

/** Fold one match into a bucket's champion tallies. */
function observe(match, tally, statik) {
  const info = match.info
  if (info.queueId !== QUEUE) return false
  const champ = (p) => statik.byKey[p.championId] ?? statik.byLower[p.championName?.toLowerCase()] ?? null
  for (const p of info.participants) {
    const id = champ(p)
    if (!id) continue
    const c = (tally.champions[id] ??= { g: 0, w: 0, b: 0, roles: {} })
    c.g++
    if (p.win) c.w++
    const role = ROLE_MAP[p.teamPosition]
    if (role) {
      const r = (c.roles[role] ??= [0, 0])
      r[0]++
      if (p.win) r[1]++
    }
  }
  for (const team of info.teams ?? []) {
    for (const ban of team.bans ?? []) {
      const id = statik.byKey[ban.championId]
      if (!id) continue
      const c = (tally.champions[id] ??= { g: 0, w: 0, b: 0, roles: {} })
      c.b++
    }
  }
  tally.matches++
  return true
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function cachedMatchIds() {
  return readdirSync(CACHE)
    .filter((f) => f.endsWith('.match.json'))
    .map((f) => f.slice(0, -'.match.json'.length))
}

async function main() {
  console.log(
    CACHED_ONLY
      ? `Re-aggregating the disk cache (no Riot calls) · buckets ${BUCKET_KEYS.join('/')}\n`
      : `Regions ${REGIONS.join('/')} · buckets ${BUCKET_KEYS.join('/')} · up to ${MATCH_LIMIT} matches each\n`,
  )
  console.log('Loading Data Dragon…')
  const statik = await loadStatic()
  console.log(`  patch ${statik.patch}\n`)

  const manifest = readJson(MANIFEST, {})

  // Resolve each bucket's match-id pool.
  const pools = {}
  if (CACHED_ONLY) {
    // Ids a lower-elo run explicitly sampled stay in their bucket; everything
    // else in the cache came from the aggregate-builds master+ ladder sample.
    const claimed = new Set(
      Object.entries(manifest)
        .filter(([k]) => k !== 'MASTER_PLUS')
        .flatMap(([, ids]) => ids),
    )
    for (const key of BUCKET_KEYS) {
      pools[key] =
        key === 'MASTER_PLUS'
          ? cachedMatchIds().filter((id) => !claimed.has(id))
          : (manifest[key] ?? [])
      console.log(`  ${key}: ${pools[key].length} cached matches`)
    }
    console.log('')
  } else {
    if (!API_KEY) {
      console.error('Missing RIOT_API_KEY. Put it in .env (see .env.example) or export it.')
      process.exit(1)
    }
    for (const key of BUCKET_KEYS) {
      const pooled = new Set(manifest[key] ?? [])
      for (const platform of REGIONS) {
        console.log(`Gathering ${platform.toUpperCase()} ${key} players…`)
        const puuids = await gatherPuuids(platform, BUCKETS[key].tiers)
        console.log(`  ${puuids.length} unique players`)
        const ids = await gatherMatchIds(puuids, platform, MATCH_LIMIT)
        for (const id of ids) pooled.add(id)
        console.log(`  ${ids.length} matches (${pooled.size} pooled)\n`)
      }
      pools[key] = [...pooled]
      manifest[key] = pools[key]
    }
    writeFileSync(MANIFEST, JSON.stringify(manifest))
  }

  // Fetch + tally, keeping only the newest PATCH_WINDOW patches per bucket so a
  // long-lived cache doesn't smear old metas into the current one.
  const buckets = {}
  for (const key of BUCKET_KEYS) {
    console.log(`Aggregating ${key} (${pools[key].length} matches)…`)

    // Pass 1 — metadata only, so nothing but {id, patch} is ever held at once.
    const meta = []
    let done = 0
    let stale = 0
    for (const id of pools[key]) {
      const m = await matchMeta(id)
      if (++done % 500 === 0) console.log(`  scanned ${done}/${pools[key].length}`)
      if (!m || m.queueId !== QUEUE) continue
      if (SINCE_MS && m.created < SINCE_MS) {
        stale++
        continue
      }
      meta.push({ id, patch: m.patch })
    }
    if (stale) console.log(`  ${stale} pooled matches older than ${SINCE_DAYS}d — excluded`)

    const patches = [...new Set(meta.map((m) => m.patch))].sort((a, b) => patchNum(b) - patchNum(a))
    const keep = new Set(patches.slice(0, PATCH_WINDOW))

    // Pass 2 — parse only what survived the filters, one match at a time.
    const tally = { matches: 0, champions: {} }
    for (const m of meta) {
      if (!keep.has(m.patch)) continue
      const file = matchFile(m.id)
      if (!existsSync(file)) continue
      observe(JSON.parse(readFileSync(file, 'utf8')), tally, statik)
    }
    if (tally.matches < 50) {
      console.warn(`  ⚠ only ${tally.matches} usable matches — skipping ${key} (need ≥ 50)`)
      continue
    }
    buckets[key] = { label: BUCKETS[key].label, matches: tally.matches, champions: tally.champions }
    console.log(
      `  ${tally.matches} matches on patch ${[...keep].join('/') || '—'} · ${Object.keys(tally.champions).length} champions\n`,
    )
  }

  // Merge with buckets from a previous run that this one didn't refresh.
  const prev = readJson(OUT, null)
  if (prev?.buckets) {
    for (const [key, data] of Object.entries(prev.buckets)) {
      if (!buckets[key]) {
        buckets[key] = data
        console.log(`  (kept previous ${key} bucket — not refreshed this run)`)
      }
    }
  }

  if (Object.keys(buckets).length === 0) {
    console.error('No bucket produced enough data — nothing written.')
    process.exit(1)
  }

  const out = {
    patch: statik.patch.split('.').slice(0, 2).join('.'),
    generatedAt: new Date().toISOString(),
    queue: QUEUE,
    buckets,
  }
  writeFileSync(OUT, JSON.stringify(out) + '\n')
  const summary = Object.entries(buckets)
    .map(([k, b]) => `${k} ${b.matches}`)
    .join(' · ')
  console.log(`\n✓ Wrote ranked champion stats (${summary} matches) → ${OUT}`)
}

// ---- tiny helpers ---------------------------------------------------------
function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
      out[key] = val
    }
  }
  return out
}

function regionalCluster(platform) {
  if (['na1', 'br1', 'la1', 'la2', 'oc1'].includes(platform)) return 'americas'
  if (['euw1', 'eun1', 'tr1', 'ru'].includes(platform)) return 'europe'
  if (['kr', 'jp1'].includes(platform)) return 'asia'
  if (['ph2', 'sg2', 'th2', 'tw2', 'vn2'].includes(platform)) return 'sea'
  return 'americas'
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
