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
//   --out <path>          output json (default src/data/rankedChampStats.json)
//   --cached-only         re-aggregate the disk cache, zero API calls. The
//                         pre-existing aggregate-builds cache (sampled from
//                         master/GM/challenger ladders) feeds MASTER_PLUS.
//
// Buckets already in the output are preserved when a run only refreshes some of
// them, as long as they're from the same patch window.

import { writeFileSync, readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
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

// Matches are immutable — cache to disk so reruns never refetch. Shares the
// aggregate-builds cache (same file naming), so pools cross-pollinate for free.
async function cachedMatch(id) {
  const file = join(CACHE, `${id}.match.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const data = await riotGet(regionalHostForMatch(id), `/lol/match/v5/matches/${id}`)
  if (data) writeFileSync(file, JSON.stringify(data))
  return data
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
      // One page of division II is ~200 players — plenty of seeds per tier.
      const list = await riotGet(
        platformHost(platform),
        `/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/II?page=1`,
      )
      for (const e of list ?? []) if (e.puuid) puuids.add(e.puuid)
      console.log(`  ${tier} II: ${list?.length ?? 0} entries`)
    }
  }
  return [...puuids]
}

async function gatherMatchIds(puuids, platform, limit) {
  const ids = new Set()
  const shuffled = puuids.sort(() => Math.random() - 0.5)
  for (const puuid of shuffled) {
    if (ids.size >= limit) break
    const list = await riotGet(
      regionHost(platform),
      `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${QUEUE}&count=${PER_PLAYER}`,
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
    const matches = []
    let done = 0
    for (const id of pools[key]) {
      const match = await cachedMatch(id)
      if (match?.info?.queueId === QUEUE) matches.push(match)
      if (++done % 200 === 0) console.log(`  ${done}/${pools[key].length}`)
    }
    const patches = [...new Set(matches.map(gamePatch))].sort((a, b) => patchNum(b) - patchNum(a))
    const keep = new Set(patches.slice(0, PATCH_WINDOW))
    const tally = { matches: 0, champions: {} }
    for (const m of matches) if (keep.has(gamePatch(m))) observe(m, tally, statik)
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
