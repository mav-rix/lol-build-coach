#!/usr/bin/env node
// Phase 1 build aggregator: turns high-elo Match-V5 data into per
// (champion, role) BuildPath rows the frontend already understands, written to
// src/data/aggregatedBuilds.json. Runs offline with a Riot dev key — no standing
// backend. Re-run each patch to refresh. See README "Aggregated builds".
//
//   RIOT_API_KEY=... node scripts/aggregate-builds.mjs --region na1 --matches 300
//
// Flags (all optional):
//   --region <platform>   na1|euw1|kr|...      (default na1)
//   --tiers  <list>       challenger,grandmaster,master (default all three)
//   --matches <n>         max matches to ingest           (default 300)
//   --per-player <n>      match ids pulled per player      (default 15)
//   --min-sample <n>      min games to emit a build        (default 3)
//   --out <path>          output json (default src/data/aggregatedBuilds.json)
//   --dry-run             preview builds from cached (or a small live) sample
//                         without writing the file — great for a first look
//   --if-stale            no-op if the output was already built for the current
//                         patch; otherwise run — for a per-patch scheduled job
//   --include-cached      fold every already-cached match into the merged pool,
//                         so prior regions/runs join without being re-fetched
//   --mode <sr|aram>      which mode to aggregate (default sr); aram ingests
//                         queue 450 into a separate per-champion builds file

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
// One or more platforms (comma-separated), e.g. na1,kr,euw1. Matches from all of
// them are pooled and aggregated into a single dataset. --matches is per region.
const REGIONS = (args.region ?? 'na1')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)
const TIERS = (args.tiers ?? 'challenger,grandmaster,master').split(',')
const MATCH_LIMIT = Number(args.matches ?? 300)
const PER_PLAYER = Number(args['per-player'] ?? 15)
const MIN_SAMPLE = Number(args['min-sample'] ?? 3)
const IF_STALE = Boolean(args['if-stale'])
const INCLUDE_CACHED = Boolean(args['include-cached'])
const DRY_RUN = Boolean(args['dry-run'])
const DRY_LIMIT = Number(args.matches ?? 50)
// --mode sr (ranked Summoner's Rift) or aram (ARAM). ARAM has no roles, so its
// builds are per-champion and written to a separate file the loader merges.
const MODE = (args.mode ?? 'sr').toLowerCase()
const MODE_CFG = {
  sr: { queue: 420, map: 11, roleless: false, buildMode: 'SR', file: 'src/data/aggregatedBuilds.json' },
  aram: { queue: 450, map: 12, roleless: true, buildMode: 'ARAM', file: 'src/data/aggregatedBuildsAram.json' },
}[MODE]
if (!MODE_CFG) {
  console.error(`Unknown --mode "${MODE}" (expected sr or aram)`)
  process.exit(1)
}
const OUT = args.out ? resolve(args.out) : join(ROOT, MODE_CFG.file)
const QUEUE = MODE_CFG.queue
// Dev key allows 100 req / 2 min ≈ one per 1.2s; hold a floor so we never 429.
const MIN_INTERVAL = Number(process.env.RIOT_MIN_INTERVAL_MS ?? 1300)

// Platform host serves LEAGUE-V4 (ladders); regional-cluster host serves
// MATCH-V5. A match id is prefixed with its platform (e.g. NA1_, KR_, EUW1_), so
// we route each match fetch to the right cluster — essential when the pool mixes
// regions.
const platformHost = (p) => `${p}.api.riotgames.com`
const regionHost = (p) => `${regionalCluster(p)}.api.riotgames.com`
const regionalHostForMatch = (matchId) => regionHost(matchId.split('_')[0].toLowerCase())
const ROLE_MAP = { TOP: 'TOP', JUNGLE: 'JUNGLE', MIDDLE: 'MID', BOTTOM: 'ADC', UTILITY: 'SUPPORT' }
const SUPPORT_STARTER_ID = 3865 // World Atlas — auto-granted, so injected as the support starter

const CACHE = join(ROOT, '.cache/riot')
mkdirSync(CACHE, { recursive: true })

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

// Match + timeline are immutable — cache to disk so reruns never refetch.
async function cachedMatch(kind, id) {
  const file = join(CACHE, `${id}.${kind}.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const path =
    kind === 'match'
      ? `/lol/match/v5/matches/${id}`
      : `/lol/match/v5/matches/${id}/timeline`
  const data = await riotGet(regionalHostForMatch(id), path)
  if (data) writeFileSync(file, JSON.stringify(data))
  return data
}

// ---- Data Dragon (item + champion metadata for classification) ------------
async function loadStatic() {
  const versions = await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json()
  const patch = versions[0]
  const items = (
    await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/item.json`)).json()
  ).data
  const champs = (
    await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`)).json()
  ).data
  const champByLower = {}
  for (const id of Object.keys(champs)) champByLower[id.toLowerCase()] = id
  return { patch, items, champs, champByLower }
}

// ---- enemy-comp conditions (keep in sync with src/lib/situational.ts) ------
// The live threat engine tags an enemy comp with these same SituationalCondition
// strings; matching them here is what lets recommendPurchases promote an
// aggregated situational item in-game with no runtime change.
const HEALERS = new Set([
  'Soraka', 'Yuumi', 'Sona', 'Nami', 'Aatrox', 'Vladimir', 'DrMundo',
  'Sylas', 'Swain', 'Illaoi', 'Fiora', 'Warwick', 'Maokai', 'Kayn',
  'Briar', 'Zac', 'Renata', 'Senna', 'Nidalee', 'Ivern',
])
const HEAVY_CC = new Set([
  'Malzahar', 'Warwick', 'Skarner', 'Lissandra', 'Leona', 'Nautilus',
  'Morgana', 'Ashe', 'Sejuani', 'Maokai', 'Amumu', 'Rell', 'Thresh',
])
const CONDITION_LABEL = {
  enemy_has_healing: 'vs healing',
  enemy_has_tanks: 'vs tanks',
  enemy_heavy_ap: 'vs AP',
  enemy_heavy_ad: 'vs AD',
  enemy_heavy_cc: 'vs CC',
}

/** Conditions an enemy team (ddragon ids) activates — mirrors analyzeEnemyComp. */
function enemyConditions(enemyIds, champs) {
  const meta = enemyIds.map((id) => champs[id]).filter(Boolean)
  const has = (tag) => (c) => c.tags.includes(tag)
  const active = []
  const tanks = meta.filter(has('Tank')).length
  const mages = meta.filter(has('Mage')).length
  const physical = meta.filter(
    (c) => c.tags.includes('Marksman') || (c.tags.includes('Assassin') && !c.tags.includes('Mage')),
  ).length
  const healers = meta.filter((c) => HEALERS.has(c.id)).length
  const ccers = meta.filter((c) => HEAVY_CC.has(c.id)).length
  if (tanks >= 2) active.push('enemy_has_tanks')
  if (mages >= 3) active.push('enemy_heavy_ap')
  if (physical >= 3) active.push('enemy_heavy_ad')
  if (healers >= 1) active.push('enemy_has_healing')
  if (ccers >= 2) active.push('enemy_heavy_cc')
  return active
}

const isBoots = (it) => it?.tags?.includes('Boots') ?? false
const isTrinket = (it) => it?.tags?.includes('Trinket') ?? false
const isConsumable = (it) => it?.tags?.includes('Consumable') ?? false
const isCompleted = (it) => Boolean(it?.gold?.purchasable) && (!it.into || it.into.length === 0)
function isLegendary(it) {
  return (
    isCompleted(it) &&
    !isBoots(it) &&
    !isConsumable(it) &&
    !isTrinket(it) &&
    it.gold.total >= 2000 &&
    !it.tags?.includes('Jungle') &&
    !it.tags?.includes('GoldPer') // support/jungle quest starters handled elsewhere
  )
}

// ---- per-participant parsing ---------------------------------------------
function parsePerks(perks) {
  const styles = perks?.styles ?? []
  const prim = styles.find((s) => s.description === 'primaryStyle')
  const sub = styles.find((s) => s.description === 'subStyle')
  const primSel = (prim?.selections ?? []).map((s) => s.perk)
  const subSel = (sub?.selections ?? []).map((s) => s.perk)
  return {
    primaryPathId: prim?.style ?? 0,
    keystoneId: primSel[0] ?? 0,
    primaryRuneIds: primSel.slice(1),
    secondaryPathId: sub?.style ?? 0,
    secondaryRuneIds: subSel,
    statRuneIds: [perks?.statPerks?.offense, perks?.statPerks?.flex, perks?.statPerks?.defense].filter(
      (x) => x != null,
    ),
  }
}

function purchasesFor(timeline, pid) {
  const buys = []
  for (const frame of timeline.info.frames) {
    for (const ev of frame.events) {
      if (ev.participantId !== pid) continue
      if (ev.type === 'ITEM_PURCHASED') buys.push({ itemId: ev.itemId, t: ev.timestamp })
      else if (ev.type === 'ITEM_UNDO') {
        // Undo removes the most recent purchase of beforeId.
        for (let i = buys.length - 1; i >= 0; i--) {
          if (buys[i].itemId === ev.beforeId) {
            buys.splice(i, 1)
            break
          }
        }
      }
    }
  }
  return buys
}

const SKILL = { 1: 'Q', 2: 'W', 3: 'E' }
function skillOrder(timeline, pid) {
  const ups = []
  for (const frame of timeline.info.frames)
    for (const ev of frame.events)
      if (ev.type === 'SKILL_LEVEL_UP' && ev.participantId === pid) ups.push(ev.skillSlot)
  const start = SKILL[ups[0]] ?? 'Q'
  const count = { 1: 0, 2: 0, 3: 0 }
  const reachedFifth = {}
  let rank = 0
  for (const s of ups) {
    if (s === 4) continue // ult
    if (count[s] === undefined) continue
    count[s]++
    if (count[s] === 5 && reachedFifth[s] === undefined) reachedFifth[s] = rank++
  }
  const ranked = [1, 2, 3].sort((a, b) => {
    const fa = reachedFifth[a] ?? 99
    const fb = reachedFifth[b] ?? 99
    if (fa !== fb) return fa - fb
    return count[b] - count[a]
  })
  return { maxOrder: ranked.map((s) => SKILL[s]).join(' > '), start }
}

export function observeMatch(match, timeline, statik) {
  const info = match.info
  if (info.queueId !== QUEUE || info.mapId !== MODE_CFG.map) return []
  const patch = info.gameVersion.split('.').slice(0, 2).join('.')
  const idOf = (name) => statik.champByLower[name.toLowerCase()] ?? name
  const teams = { 100: [], 200: [] }
  for (const p of info.participants) teams[p.teamId]?.push(idOf(p.championName))

  const out = []
  for (const p of info.participants) {
    // ARAM has no lane assignments — every participant is a per-champion sample.
    const role = MODE_CFG.roleless ? null : ROLE_MAP[p.teamPosition]
    if (!MODE_CFG.roleless && !role) continue
    const enemies = teams[p.teamId === 100 ? 200 : 100]
    const buys = purchasesFor(timeline, p.participantId)
    const starters = []
    const core = []
    const seen = new Set()
    let boots = null
    for (const b of buys) {
      const it = statik.items[String(b.itemId)]
      if (!it) continue
      if (b.t <= 90000 && !isBoots(it) && !isTrinket(it) && !isConsumable(it)) starters.push(b.itemId)
      // Tier-2 boots now upgrade to tier-3, so they carry an `into` — key off
      // cost, not completion, and keep the first substantive boots (the choice
      // that matters), skipping basic Boots (300g).
      if (isBoots(it) && it.gold.total >= 600 && boots == null) boots = b.itemId
      if (isLegendary(it) && !seen.has(b.itemId)) {
        seen.add(b.itemId)
        core.push(b.itemId)
      }
    }
    // A support's World Atlas is auto-granted, not bought — it only surfaces as
    // ITEM_DESTROYED when it upgrades, so no purchase scan can see it. Inject it
    // as the known support starter (the adaptive layer picks the quest *final*).
    if (role === 'SUPPORT' && !starters.includes(SUPPORT_STARTER_ID)) {
      starters.unshift(SUPPORT_STARTER_ID)
    }
    out.push({
      championId: idOf(p.championName),
      role,
      patch,
      win: Boolean(p.win),
      starters: starters.slice(0, 3),
      core, // full ordered legendary list — situational aggregation reads this
      boots,
      perks: parsePerks(p.perks),
      enemyConditions: enemyConditions(enemies, statik.champs),
      ...skillOrder(timeline, p.participantId),
    })
  }
  return out
}

// ---- aggregation ----------------------------------------------------------
function topN(values, n) {
  const m = new Map()
  for (const v of values) if (v != null) m.set(v, (m.get(v) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k)
}
const modal = (values) => topN(values, 1)[0]

function aggregateCore(group) {
  const freq = new Map()
  const idxSum = new Map()
  for (const o of group)
    o.core.forEach((id, i) => {
      freq.set(id, (freq.get(id) ?? 0) + 1)
      idxSum.set(id, (idxSum.get(id) ?? 0) + i)
    })
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id)
  // Order the popular items by their average purchase position.
  top.sort((a, b) => idxSum.get(a) / freq.get(a) - idxSum.get(b) / freq.get(b))
  return top
}

function aggregateStarters(group) {
  const key = modal(group.map((o) => [...o.starters].sort((a, b) => a - b).join(',')))
  return key ? key.split(',').filter(Boolean).map(Number) : []
}

// Comp-conditioned situational items: an item is "situational vs condition C"
// when it's bought materially more often in games where C is active than
// overall. Thresholds are deliberately conservative — small ingests emit few or
// none (which degrades gracefully to seed behavior), big ingests emit real reads.
const SIT_CONDITIONS = ['enemy_has_tanks', 'enemy_heavy_ap', 'enemy_heavy_ad', 'enemy_has_healing', 'enemy_heavy_cc']
const MIN_SITUATIONAL_SAMPLE = 15 // group size needed to attempt situational reads
const MIN_ITEM_COUNT = 3 // item must be bought in at least this many games
const MIN_COND_SAMPLE = 6 // games with the condition active, for signal
const SIT_MIN_RATE = 0.25 // conditional pick rate floor
const SIT_MIN_LIFT = 0.12 // conditional minus baseline pick rate

function aggregateSituationals(group, items, coreIds) {
  const n = group.length
  if (n < MIN_SITUATIONAL_SAMPLE) return []
  const core = new Set(coreIds)

  // Candidate items: any legendary someone bought that isn't already core.
  const totals = new Map()
  for (const o of group)
    for (const id of new Set(o.core)) if (!core.has(id)) totals.set(id, (totals.get(id) ?? 0) + 1)

  const found = []
  for (const [itemId, total] of totals) {
    if (total < MIN_ITEM_COUNT) continue
    const baseline = total / n
    let best = null
    for (const cond of SIT_CONDITIONS) {
      const withCond = group.filter((o) => o.enemyConditions.includes(cond))
      if (withCond.length < MIN_COND_SAMPLE) continue
      const rate = withCond.filter((o) => o.core.includes(itemId)).length / withCond.length
      const lift = rate - baseline
      if (rate >= SIT_MIN_RATE && lift >= SIT_MIN_LIFT && (!best || lift > best.lift)) {
        best = { cond, rate, lift }
      }
    }
    if (best) found.push({ itemId, ...best, baseline })
  }

  found.sort((a, b) => b.lift - a.lift)
  return found.slice(0, 6).map((f) => ({
    itemId: f.itemId,
    condition: f.cond,
    description: `${items[String(f.itemId)]?.name ?? `Item ${f.itemId}`} — ${CONDITION_LABEL[f.cond]} (${Math.round(
      f.rate * 100,
    )}% pick vs ${Math.round(f.baseline * 100)}% baseline)`,
  }))
}

// Pick the single most common full rune page / skill plan that a real player
// ran — coherent by construction, unlike field-by-field modes.
function modalBy(group, keyFn) {
  const counts = new Map()
  const rep = new Map()
  for (const o of group) {
    const k = keyFn(o)
    counts.set(k, (counts.get(k) ?? 0) + 1)
    if (!rep.has(k)) rep.set(k, o)
  }
  let bestKey
  let bestN = -1
  for (const [k, n] of counts) {
    if (n > bestN) {
      bestN = n
      bestKey = k
    }
  }
  return rep.get(bestKey)
}

let idSeq = 20000
export function toBuildPath(group, items) {
  const perkRep = modalBy(group, (o) => JSON.stringify(o.perks))
  const skillRep = modalBy(group, (o) => `${o.maxOrder}|${o.start}`)
  const wins = group.filter((o) => o.win).length
  const coreItems = aggregateCore(group)
  return {
    id: idSeq++,
    championId: group[0].championId,
    mode: MODE_CFG.buildMode,
    role: group[0].role,
    patch: modal(group.map((o) => o.patch)),
    starterItems: aggregateStarters(group),
    coreItems,
    situationalItems: aggregateSituationals(group, items, coreItems),
    bootsOptions: topN(group.map((o) => o.boots), 2),
    ...perkRep.perks,
    skillMaxOrder: skillRep.maxOrder,
    skillStart: skillRep.start,
    notes: [
      `Aggregated from ${group.length} ${TIERS.join('/')} games on patch ${modal(
        group.map((o) => o.patch),
      )} · ${Math.round((100 * wins) / group.length)}% win rate.`,
    ],
    winRate: Math.round((1000 * wins) / group.length) / 10,
    sampleSize: group.length,
  }
}

// ---- pipeline -------------------------------------------------------------
async function gatherPuuids(platform) {
  const eps = {
    challenger: '/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5',
    grandmaster: '/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5',
    master: '/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5',
  }
  const puuids = new Set()
  for (const tier of TIERS) {
    if (!eps[tier]) continue
    const list = await riotGet(platformHost(platform), eps[tier])
    for (const e of list?.entries ?? []) if (e.puuid) puuids.add(e.puuid)
    console.log(`  ${tier}: ${list?.entries?.length ?? 0} entries`)
  }
  if (puuids.size === 0)
    console.warn('  ⚠ no puuids found — the league entries lacked a puuid field for this key/region.')
  return [...puuids]
}

// Match ids already fully cached on disk (both match + timeline present).
function cachedMatchIds() {
  const files = readdirSync(CACHE)
  const timelines = new Set(
    files.filter((f) => f.endsWith('.timeline.json')).map((f) => f.slice(0, -'.timeline.json'.length)),
  )
  return files
    .filter((f) => f.endsWith('.match.json'))
    .map((f) => f.slice(0, -'.match.json'.length))
    .filter((id) => timelines.has(id))
}

// Modal patch of the already-written builds, or null if the file is missing/empty.
function currentBuildsPatch() {
  if (!existsSync(OUT)) return null
  try {
    const arr = JSON.parse(readFileSync(OUT, 'utf8'))
    if (!Array.isArray(arr) || arr.length === 0) return null
    return modal(arr.map((b) => b.patch))
  } catch {
    return null
  }
}

function printSampleBuilds(builds, items) {
  const name = (id) => items[String(id)]?.name ?? `Item ${id}`
  const sample = [...builds].sort((a, b) => (b.sampleSize ?? 0) - (a.sampleSize ?? 0)).slice(0, 8)
  console.log(`\nSample of ${sample.length}/${builds.length} aggregated builds:\n`)
  for (const b of sample) {
    console.log(`── ${b.championId} ${b.role}  (n=${b.sampleSize}, ${b.winRate}% WR, patch ${b.patch})`)
    console.log(`   start: ${b.starterItems.map(name).join(', ') || '—'}`)
    console.log(`   boots: ${b.bootsOptions.map(name).join(' / ') || '—'}`)
    console.log(`   core:  ${b.coreItems.map(name).join(' → ') || '—'}`)
    for (const s of b.situationalItems) console.log(`     · ${s.description}`)
    console.log(`   plan:  keystone ${b.keystoneId} · ${b.skillMaxOrder} (start ${b.skillStart})\n`)
  }
}

async function gatherMatchIds(puuids, platform) {
  const ids = new Set()
  const shuffled = puuids.sort(() => Math.random() - 0.5)
  for (const puuid of shuffled) {
    if (ids.size >= MATCH_LIMIT) break
    const list = await riotGet(
      regionHost(platform),
      `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${QUEUE}&count=${PER_PLAYER}`,
    )
    for (const id of list ?? []) {
      ids.add(id)
      if (ids.size >= MATCH_LIMIT) break
    }
  }
  return [...ids]
}

async function main() {
  console.log(
    DRY_RUN
      ? `Dry run · ${REGIONS.join('/')} · up to ${DRY_LIMIT} matches\n`
      : `Regions ${REGIONS.join('/')} · tiers ${TIERS.join('/')} · up to ${MATCH_LIMIT} matches each\n`,
  )
  console.log('Loading Data Dragon…')
  const statik = await loadStatic()
  console.log(`  patch ${statik.patch}\n`)

  // Per-patch gate: skip the whole run if the output was already built for the
  // current patch, so a scheduled job is a cheap no-op until a new patch drops.
  if (IF_STALE) {
    const current = statik.patch.split('.').slice(0, 2).join('.')
    const have = currentBuildsPatch()
    if (have === current) {
      console.log(`Already aggregated for patch ${current} — up to date, nothing to do.`)
      return
    }
    console.log(`Patch ${current} (builds on ${have ?? 'none'}) — regenerating.\n`)
  }

  // Choose match ids. A dry run prefers already-cached matches so it's instant
  // and needs no key; only if the cache is empty does it pull a small sample.
  let matchIds
  if (DRY_RUN) {
    const cached = cachedMatchIds()
    if (cached.length > 0) {
      matchIds = cached.slice(0, DRY_LIMIT)
      console.log(`Using ${matchIds.length} cached matches (no Riot calls).\n`)
    } else {
      if (!API_KEY) {
        console.error('Dry run needs cached matches (.cache/riot) or a RIOT_API_KEY for a small live sample.')
        process.exit(1)
      }
      console.log('No cache yet — pulling a small live sample…')
      const puuids = await gatherPuuids(REGIONS[0])
      matchIds = (await gatherMatchIds(puuids, REGIONS[0])).slice(0, DRY_LIMIT)
      console.log(`  ${matchIds.length} matches\n`)
    }
  } else {
    if (!API_KEY) {
      console.error('Missing RIOT_API_KEY. Put it in .env (see .env.example) or export it.')
      process.exit(1)
    }
    // Gather + pool match ids from every region; the union is aggregated into
    // one dataset. Already-cached matches (e.g. a prior region) are reused below.
    const pooled = new Set()
    for (const platform of REGIONS) {
      console.log(`Gathering ${platform.toUpperCase()} players…`)
      const puuids = await gatherPuuids(platform)
      console.log(`  ${puuids.length} unique players`)
      console.log(`Gathering ${platform.toUpperCase()} match ids…`)
      const ids = await gatherMatchIds(puuids, platform)
      for (const id of ids) pooled.add(id)
      console.log(`  ${ids.length} matches (${pooled.size} pooled)\n`)
    }
    // Fold in every already-cached match (e.g. a prior region's run) so it joins
    // the merged dataset without re-fetching.
    if (INCLUDE_CACHED) {
      const cached = cachedMatchIds()
      for (const id of cached) pooled.add(id)
      console.log(`Including ${cached.length} cached matches → ${pooled.size} total\n`)
    }
    matchIds = [...pooled]
  }

  console.log('Fetching matches + timelines…')
  const observations = []
  let done = 0
  for (const id of matchIds) {
    const match = await cachedMatch('match', id)
    const timeline = match ? await cachedMatch('timeline', id) : null
    if (match && timeline) observations.push(...observeMatch(match, timeline, statik))
    if (++done % 25 === 0) console.log(`  ${done}/${matchIds.length} (${observations.length} observations)`)
  }
  console.log(`  ${observations.length} participant observations\n`)

  console.log('Aggregating…')
  const groups = new Map()
  for (const o of observations) {
    const key = `${o.championId}|${o.role}`
    let group = groups.get(key)
    if (!group) groups.set(key, (group = []))
    group.push(o)
  }
  // A dry run's tiny sample rarely clears the normal floor, so relax it to 1
  // just to preview the build shapes.
  const minSample = DRY_RUN ? 1 : MIN_SAMPLE
  const builds = []
  for (const group of groups.values())
    if (group.length >= minSample) builds.push(toBuildPath(group, statik.items))
  builds.sort(
    (a, b) => a.championId.localeCompare(b.championId) || (a.role ?? '').localeCompare(b.role ?? ''),
  )

  if (DRY_RUN) {
    printSampleBuilds(builds, statik.items)
    console.log(`(dry run — ${builds.length} builds from ${groups.size} groups, nothing written)`)
    return
  }

  writeFileSync(OUT, JSON.stringify(builds, null, 2) + '\n')
  console.log(`\n✓ Wrote ${builds.length} builds (${groups.size} champ/role groups seen) → ${args.out ?? 'src/data/aggregatedBuilds.json'}`)
  const covered = new Set(builds.map((b) => b.championId)).size
  console.log(`  covering ${covered} champions across ${new Set(builds.map((b) => b.role)).size} roles`)
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

// Only run the pipeline when invoked directly — importing (e.g. for tests)
// exposes the pure parsing/aggregation functions without hitting the network.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
