#!/usr/bin/env node
// Aggregate Arena augment win-rates from Match-V5 (queue 1700) into
// src/data/augmentStats.json — a global tier list the app shows as reference.
// The Live Client API doesn't expose which augments are being offered, so this
// is a static "strongest augments" list, not a live pick helper. Arena is the
// only queue whose Match-V5 payload carries augments; the metadata file
// (augments.json, see fetch-augments.mjs) is pre-filtered to the official ARAM
// Mayhem pool, so the metaIds guard below also scopes these stats to Mayhem.
//
//   RIOT_API_KEY=... node scripts/aggregate-augments.mjs --region na1 --matches 500
//
// Flags: --region, --matches, --per-player, --min-games, --champ-min-games,
// --top-per-champ, --out, --cached-only (re-tally the disk cache, zero API
// calls — for threshold/ranking changes). Match cache is shared with
// aggregate-builds.mjs under .cache/riot.

import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  process.loadEnvFile(join(ROOT, '.env'))
} catch {
  // no .env — rely on ambient env
}
const API_KEY = process.env.RIOT_API_KEY

const args = parseArgs(process.argv.slice(2))
const CACHED_ONLY = Boolean(args['cached-only']) // re-tally from disk, zero API calls
const PLATFORM = (args.region ?? 'na1').toLowerCase()
const MATCH_LIMIT = Number(args.matches ?? 500)
const PER_PLAYER = Number(args['per-player'] ?? 20)
const MIN_GAMES = Number(args['min-games'] ?? 50)
const CHAMP_MIN_GAMES = Number(args['champ-min-games'] ?? 8) // per (champion, augment) pair
const TOP_PER_CHAMP = Number(args['top-per-champ'] ?? 8)
const OUT = args.out ? resolve(args.out) : join(ROOT, 'src/data/augmentStats.json')

// Only keep augments we have metadata for (run `npm run augments:meta` first) —
// drops stat-anvils/reroll pseudo-augments and anything renamed out of the set.
let metaIds = null
try {
  metaIds = new Set(JSON.parse(readFileSync(join(ROOT, 'src/data/augments.json'), 'utf8')).map((a) => a.id))
} catch {
  // no metadata yet — emit everything and let the UI filter
}
const QUEUE = 1700 // Arena (Cherry)
const MIN_INTERVAL = Number(process.env.RIOT_MIN_INTERVAL_MS ?? 1300)

const platformHost = `${PLATFORM}.api.riotgames.com`
const regionHost = `${regionalCluster(PLATFORM)}.api.riotgames.com`
const CACHE = join(ROOT, '.cache/riot')
mkdirSync(CACHE, { recursive: true })

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
      console.warn(`  · 429, waiting ${retry}s`)
      await sleep((retry + 1) * 1000)
      continue
    }
    if (res.status === 404) return null
    if (res.status === 401 || res.status === 403) {
      console.error(`\n  ✗ ${res.status} — dev key invalid/expired. Regenerate and re-run (cache kept).`)
      process.exit(1)
    }
    if (res.status >= 500) {
      await sleep(3000)
      continue
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${path}`)
    return res.json()
  }
}

// Arena matches carry augments; cache them like the build aggregator does.
async function cachedMatch(id) {
  const file = join(CACHE, `${id}.match.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const data = await riotGet(regionHost, `/lol/match/v5/matches/${id}`)
  if (data) writeFileSync(file, JSON.stringify(data))
  return data
}

async function main() {
  let ids
  if (CACHED_ONLY) {
    // Re-tally what's on disk — no key, no API calls. Useful after changing
    // thresholds/ranking without re-fetching anything.
    const { readdirSync } = await import('node:fs')
    ids = new Set(
      readdirSync(CACHE)
        .filter((f) => f.endsWith('.match.json'))
        .map((f) => f.slice(0, -'.match.json'.length)),
    )
    console.log(`Arena augments · re-tallying ${ids.size} cached matches (no Riot calls)\n`)
  } else {
    if (!API_KEY) {
      console.error('Missing RIOT_API_KEY (see .env.example).')
      process.exit(1)
    }
    console.log(`Arena augments · ${PLATFORM} · up to ${MATCH_LIMIT} matches\n`)

    console.log('Gathering players…')
    const puuids = new Set()
    for (const ep of [
      '/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5',
      '/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5',
      '/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5',
    ]) {
      const list = await riotGet(platformHost, ep)
      for (const e of list?.entries ?? []) if (e.puuid) puuids.add(e.puuid)
    }
    console.log(`  ${puuids.size} players`)

    console.log('Gathering Arena match ids…')
    ids = new Set()
    for (const puuid of [...puuids].sort(() => Math.random() - 0.5)) {
      if (ids.size >= MATCH_LIMIT) break
      const list = await riotGet(
        regionHost,
        `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${QUEUE}&count=${PER_PLAYER}`,
      )
      for (const id of list ?? []) {
        ids.add(id)
        if (ids.size >= MATCH_LIMIT) break
      }
    }
    console.log(`  ${ids.size} Arena matches\n`)
  }

  // Champion-name normalizer (Match-V5 championName → DDragon id, e.g. FiddleSticks quirks).
  const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json()
  const champList = (
    await (
      await fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`)
    ).json()
  ).data
  const champByLower = {}
  for (const cid of Object.keys(champList)) champByLower[cid.toLowerCase()] = cid

  console.log('Fetching + tallying augments…')
  // Global tally per augment, plus a per-(champion, augment) tally for the
  // overlay's champion-specific goal list. Placement is 1-8 (8 duo teams).
  const tally = new Map()
  const champTally = new Map() // "champ|augId" -> {games, placementSum, firsts}
  let done = 0
  let usedMatches = 0
  for (const id of ids) {
    const match = await cachedMatch(id)
    if (match?.info?.queueId !== QUEUE) continue
    usedMatches++
    for (const p of match.info.participants) {
      const placement = p.subteamPlacement || p.placement
      if (!placement) continue
      const champ = champByLower[p.championName?.toLowerCase()] ?? p.championName
      const augs = [p.playerAugment1, p.playerAugment2, p.playerAugment3, p.playerAugment4, p.playerAugment5, p.playerAugment6]
      for (const a of augs) {
        if (!a) continue
        const t = tally.get(a) ?? { games: 0, placementSum: 0, firsts: 0 }
        t.games++
        t.placementSum += placement
        if (placement === 1) t.firsts++
        tally.set(a, t)
        const ck = `${champ}|${a}`
        const ct = champTally.get(ck) ?? { games: 0, placementSum: 0, firsts: 0 }
        ct.games++
        ct.placementSum += placement
        if (placement === 1) ct.firsts++
        champTally.set(ck, ct)
      }
    }
    if (++done % 50 === 0) console.log(`  ${done}/${ids.size} (${tally.size} augments seen)`)
  }

  const stats = [...tally.entries()]
    .filter(([id, t]) => t.games >= MIN_GAMES && (!metaIds || metaIds.has(id)))
    .map(([id, t]) => ({
      id,
      games: t.games,
      avgPlacement: Math.round((t.placementSum / t.games) * 100) / 100,
      firstRate: Math.round((1000 * t.firsts) / t.games) / 10,
    }))
    .sort((a, b) => a.avgPlacement - b.avgPlacement)

  writeFileSync(OUT, JSON.stringify(stats, null, 2) + '\n')
  console.log(`\n✓ Wrote ${stats.length} augments (${usedMatches} Arena matches) → ${args.out ?? 'src/data/augmentStats.json'}`)
  if (stats[0]) console.log(`  best avg placement: aug ${stats[0].id} @ ${stats[0].avgPlacement} (${stats[0].firstRate}% firsts)`)

  // Per-champion top augments: only pairs with a real sample survive; the app
  // blends these with the global list, so thin champions degrade gracefully.
  // Ranked by a SHRUNK placement — thin samples are pulled toward the 4.5 mean
  // (8 teams) so an 8-game fluke can't outrank a solid 40-game row; the raw
  // avgPlacement is still what's stored and displayed.
  const MEAN_PLACEMENT = 4.5
  const SHRINK_K = 15 // pseudo-games of prior
  const byChamp = {}
  for (const [key, t] of champTally) {
    const [champ, augIdStr] = key.split('|')
    const augId = Number(augIdStr)
    if (t.games < CHAMP_MIN_GAMES || (metaIds && !metaIds.has(augId))) continue
    ;(byChamp[champ] ??= []).push({
      id: augId,
      games: t.games,
      avgPlacement: Math.round((t.placementSum / t.games) * 100) / 100,
      firstRate: Math.round((1000 * t.firsts) / t.games) / 10,
      _shrunk: (t.placementSum + SHRINK_K * MEAN_PLACEMENT) / (t.games + SHRINK_K),
    })
  }
  for (const champ of Object.keys(byChamp)) {
    byChamp[champ] = byChamp[champ]
      .sort((a, b) => a._shrunk - b._shrunk)
      .slice(0, TOP_PER_CHAMP)
      .map(({ _shrunk, ...row }) => row)
  }
  const champOut = join(ROOT, 'src/data/augmentChampStats.json')
  writeFileSync(champOut, JSON.stringify(byChamp, null, 1) + '\n')
  const covered = Object.keys(byChamp).length
  const pairs = Object.values(byChamp).reduce((n, l) => n + l.length, 0)
  console.log(`✓ Wrote per-champion stats: ${covered} champions, ${pairs} champ-augment pairs (min ${CHAMP_MIN_GAMES} games) → src/data/augmentChampStats.json`)
}

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      out[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true'
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
