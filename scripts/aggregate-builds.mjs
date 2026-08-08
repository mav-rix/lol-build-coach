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
//   --tiers  <list>       challenger,grandmaster,master (default all three);
//                         diamond|emerald|platinum|gold|silver|bronze|iron are
//                         sampled from the paged division-II entries endpoint
//   --entry-pages <n>     pages of a division tier's ladder to sample, 200
//                         players each (default 2; apex tiers ignore this)
//   --since <days>        only count games played in the last <days>. Match ids
//                         are "this player's last N games in this queue" with no
//                         date bound, so a rarely-played queue returns year-old
//                         games — this is what holds a run to the current patch.
//                         Costs breadth: players idle in the queue return none.
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
//   --mode <sr|aram|arena> which mode to aggregate (default sr); aram/arena
//                         ingest queue 450/1750 into a separate per-champion
//                         builds file each (both roleless)
//   --replace             overwrite the output outright. Default is to MERGE:
//                         this run's builds refresh the champ/roles it observed
//                         and any others are carried over from the previous file
//                         so a small run never silently drops coverage. Use
//                         --replace for a clean rebuild that prunes stale entries.

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
const TIERS = (args.tiers ?? 'challenger,grandmaster,master')
  .split(',')
  .map((t) => t.trim().toLowerCase())
  .filter(Boolean)
// Pages of a division tier's ladder to sample (200 players each). Only applies
// to the sub-Master tiers, which have no single-call ladder endpoint.
const ENTRY_PAGES = Number(args['entry-pages'] ?? 2)
// Match ids come back as "this player's last N games in this queue", with no
// regard for when they were played — so a queue someone plays rarely returns
// year-old games. That is why the ARAM pool ended up spanning 50 patches with
// only ~5% of it recent, and it is not an elo problem: a test pull from
// Emerald came back on patch 15.4. --since <days> passes startTime so only
// games from that window count, which is the only way to hold the data to the
// current patch. Costs breadth: players who haven't touched the queue lately
// return nothing, so a windowed run needs far more players to fill its quota.
// Seed players from cached matches of this queue rather than the ranked
// ladder — see snowballSeeds. Essential for casual queues; pointless for
// ranked SR, where the ladder players are the population.
const SNOWBALL = Boolean(args.snowball)
const SNOWBALL_SEEDS = Number(args['snowball-seeds'] ?? 600)
const SINCE_DAYS = Number(args.since ?? 0)
const SINCE_MS = SINCE_DAYS ? Date.now() - SINCE_DAYS * 86400_000 : 0
const SINCE_PARAM = SINCE_MS ? `&startTime=${Math.floor(SINCE_MS / 1000)}` : ''
const MATCH_LIMIT = Number(args.matches ?? 300)
const PER_PLAYER = Number(args['per-player'] ?? 15)
const MIN_SAMPLE = Number(args['min-sample'] ?? 3)
const IF_STALE = Boolean(args['if-stale'])
const INCLUDE_CACHED = Boolean(args['include-cached'])
const REPLACE = Boolean(args['replace']) // overwrite instead of merging with the previous output
const CACHED_ONLY = Boolean(args['cached-only']) // re-aggregate the disk cache, zero API calls
const DRY_RUN = Boolean(args['dry-run'])
const DRY_LIMIT = Number(args.matches ?? 50)
// --mode sr (ranked Summoner's Rift) or aram (ARAM). ARAM has no roles, so its
// builds are per-champion and written to a separate file the loader merges.
const MODE = (args.mode ?? 'sr').toLowerCase()
// `queue` is the id NEW matches are fetched under; `queues` is every id whose
// matches still count when aggregating, so a queue-id change doesn't orphan
// the games already on disk.
//
// Arena is the cautionary tale: it moved 1700 → 1750 and the fetch silently
// returned zero ids for months while the mode was live and popular — an empty
// result from a valid key is indistinguishable from "nobody played". Riot's
// public queues.json still doesn't list 1750, so it can't be trusted to catch
// this; verify against a real recent match (map 30 games showing queueId 1750)
// whenever a mode's yield drops to nothing.
const MODE_CFG = {
  sr: { queue: 420, queues: [420], map: 11, roleless: false, buildMode: 'SR', file: 'src/data/aggregatedBuilds.json' },
  aram: { queue: 450, queues: [450], map: 12, roleless: true, buildMode: 'ARAM', file: 'src/data/aggregatedBuildsAram.json' },
  arena: { queue: 1750, queues: [1750, 1700], map: 30, roleless: true, buildMode: 'ARENA', file: 'src/data/aggregatedBuildsArena.json' },
}[MODE]
if (!MODE_CFG) {
  console.error(`Unknown --mode "${MODE}" (expected sr, aram, or arena)`)
  process.exit(1)
}
const OUT = args.out ? resolve(args.out) : join(ROOT, MODE_CFG.file)
const QUEUE = MODE_CFG.queue
// Every queue id that counts as this mode when reading cached matches.
const QUEUES = new Set(MODE_CFG.queues)
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

// Arena (mapId 30) remaps every real item to '22' + its base id (e.g. Infinity
// Edge 3031 → 223031) and also carries ~13 synthetic shop-slot placeholders in
// the same numeric range (Legendary Fighter/Marksman/Assassin/Mage/Tank/Support
// "generic slot" items, Stat Bonus, Prismatic Item, reroll/anvil vouchers,
// Poro-Snax) that would otherwise pass every other isLegendary check and
// pollute coreItems. Kept in sync with src/lib/arenaItems.ts's isRealArenaItem.
function isRealArenaItem(id, items) {
  const str = String(id)
  if (!str.startsWith('22')) return false
  const baseId = str.slice(2)
  return baseId.length > 0 && baseId in items
}

function isLegendary(itemId, it, items) {
  if (MODE_CFG.map === 30 && !isRealArenaItem(itemId, items)) return false
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
  if (!QUEUES.has(info.queueId) || info.mapId !== MODE_CFG.map) return []
  // --since bounds what gets AGGREGATED as well as what gets fetched, so a
  // --cached-only rerun can rebuild from just the recent slice of a cache that
  // spans years. Without this the only way to drop stale matches would be to
  // delete them.
  if (SINCE_MS && (info.gameEndTimestamp ?? info.gameCreation ?? 0) < SINCE_MS) return []
  const patch = info.gameVersion.split('.').slice(0, 2).join('.')
  const idOf = (name) => statik.champByLower[name.toLowerCase()] ?? name
  // Arena is 8 teams of 2 (playerSubteamId, not the 2-team teamId split below),
  // and each participant only ever faces one rotating round opponent rather
  // than a fixed 5-man "enemy team" — enemyConditions (a 5-a-side team-comp
  // read) doesn't have a meaningful equivalent here, so it's skipped entirely
  // for Arena rather than guessing at a re-derivation. See the "out of scope"
  // note in the Arena plan for the real opponent-aware follow-up.
  const teams = { 100: [], 200: [] }
  for (const p of info.participants) teams[p.teamId]?.push(idOf(p.championName))

  const out = []
  for (const p of info.participants) {
    // ARAM has no lane assignments — every participant is a per-champion sample.
    const role = MODE_CFG.roleless ? null : ROLE_MAP[p.teamPosition]
    if (!MODE_CFG.roleless && !role) continue
    const enemies = MODE_CFG.map === 30 ? [] : teams[p.teamId === 100 ? 200 : 100]
    const buys = purchasesFor(timeline, p.participantId)
    const starters = []
    const core = []
    const seen = new Set()
    let boots = null
    for (const b of buys) {
      const it = statik.items[String(b.itemId)]
      if (!it) continue
      // it.maps guards against stale/rotated item ids whose Data Dragon entry
      // no longer validates on any map (seen live: a couple of legacy support
      // items with every map flag false slipping into Arena starters) — the
      // core-item path already gets this for free via isLegendary/isRealArenaItem.
      if (
        b.t <= 90000 &&
        !isBoots(it) &&
        !isTrinket(it) &&
        !isConsumable(it) &&
        it.maps[String(MODE_CFG.map)] !== false
      )
        starters.push(b.itemId)
      // Tier-2 boots now upgrade to tier-3, so they carry an `into` — key off
      // cost, not completion, and keep the first substantive boots (the choice
      // that matters), skipping basic Boots (300g). Arena has no basic-boots
      // step at all — every boots purchase there is already the real choice,
      // uniformly priced at 500g (below the 600g floor), so the floor only
      // applies off Arena's map.
      if (isBoots(it) && (MODE_CFG.map === 30 || it.gold.total >= 600) && boots == null)
        boots = b.itemId
      if (isLegendary(b.itemId, it, statik.items) && !seen.has(b.itemId)) {
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
      matchId: match.metadata?.matchId ?? null, // for the elo-provenance label
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

// Greedy CONDITIONAL path: each next core slot is the most frequent item among
// the observations consistent with the route chosen so far. Flat top-N mixed
// alternative routes into one path (e.g. Lord Dominik's AND Mortal Reminder —
// players build one or the other, never both), which made the build ambiguous.
// Conditioning suppresses low-co-occurrence alternatives organically while
// keeping legitimate combos (multiple items sharing a component type survive
// because they genuinely co-occur). The unpicked alternative still surfaces via
// the comp-conditioned situational swaps, which is where "which route" belongs.
function aggregateCore(group) {
  const MIN_POOL = 8 // below this, stop narrowing (avoid overfitting a tiny tail)
  const EXCLUSIVE_COOC = 0.2 // co-occurrence below this = alternative route
  const chosen = []
  const banned = new Set()
  let pool = group
  while (chosen.length < 5) {
    const freq = new Map()
    for (const o of pool)
      for (const id of o.core) if (!chosen.includes(id) && !banned.has(id)) freq.set(id, (freq.get(id) ?? 0) + 1)
    let best = null
    let bestN = 0
    for (const [id, n] of freq)
      if (n > bestN) {
        bestN = n
        best = id
      }
    // Only the first slot demands real consensus (it anchors the route and a
    // stray buy there would poison the conditioning). Later slots naturally
    // diversify — games end before 4th/5th items, supports finish two
    // legendaries — and a percentage floor there starved champions down to 1–2
    // item "builds". Every remaining slot takes the best signal available
    // (players expect a full 5-item path + boots), never below 2 observations.
    const floor = chosen.length === 0 ? Math.max(2, pool.length * 0.15) : 2
    if (best === null || bestN < floor) {
      // The conditioned sub-route ran dry rather than the build being over.
      // Narrowing compounds: 43-game AD Volibear went 43 → 36 (Dusk and Dawn)
      // → 12 (Navori), and among 12 games every third item was a singleton, so
      // the path stopped at two items — which then reads as a broken build and
      // gets hidden from the variant picker entirely. Widen back to the whole
      // cluster and keep filling slots; bans stay in force, so genuinely
      // exclusive alternative routes can't leak back in. Terminates: after
      // widening `pool === group`, so a second dry slot breaks.
      if (pool !== group) {
        pool = group
        continue
      }
      break
    }
    chosen.push(best)
    // Ban alternatives to the pick: items popular in the group overall but
    // rarely built ALONGSIDE it (e.g. Mortal Reminder once Lord Dominik's is
    // chosen — same slot, different route). Measured on the full group so a
    // shrunken pool can't leak them back in later slots.
    const withBest = group.filter((o) => o.core.includes(best))
    if (withBest.length >= 5) {
      const candidates = new Set()
      for (const o of group) for (const id of o.core) candidates.add(id)
      for (const id of candidates) {
        if (chosen.includes(id) || banned.has(id)) continue
        const base = group.filter((o) => o.core.includes(id)).length / group.length
        const cooc = withBest.filter((o) => o.core.includes(id)).length / withBest.length
        if (base >= 0.15 && cooc < EXCLUSIVE_COOC) banned.add(id)
      }
    }
    const filtered = pool.filter((o) => o.core.includes(best))
    if (filtered.length >= MIN_POOL) pool = filtered
  }
  // Order the route by average purchase position across the whole group.
  const idxSum = new Map()
  const cnt = new Map()
  for (const o of group)
    o.core.forEach((id, i) => {
      if (!chosen.includes(id)) return
      idxSum.set(id, (idxSum.get(id) ?? 0) + i)
      cnt.set(id, (cnt.get(id) ?? 0) + 1)
    })
  return chosen.sort((a, b) => idxSum.get(a) / cnt.get(a) - idxSum.get(b) / cnt.get(b))
}

const JUNGLE_PETS = [1101, 1102, 1103] // Scorchclaw / Gustwalker / Mosstomper

// The 90s cutoff in observeMatch (below) that feeds this is an SR/ARAM
// laning-phase assumption — Arena has no laning phase; it's round 1's short
// shop window instead. The mechanism still runs unchanged for Arena (it just
// captures "round 1 buys" rather than a true starter concept); left as-is
// rather than redefining Arena's round structure in this pass.
function aggregateStarters(group) {
  const key = modal(group.map((o) => [...o.starters].sort((a, b) => a - b).join(',')))
  const starters = key ? key.split(',').filter(Boolean).map(Number) : []

  // Jungle: the pet is a mandatory start with a real choice — pick it by WIN
  // RATE across the cluster (min sample), not popularity, and put it first.
  if (group[0]?.role === 'JUNGLE') {
    const stats = new Map(JUNGLE_PETS.map((id) => [id, { games: 0, wins: 0 }]))
    for (const o of group)
      for (const id of o.starters)
        if (stats.has(id)) {
          const s = stats.get(id)
          s.games++
          if (o.win) s.wins++
        }
    const MIN = 15
    let best = null
    for (const [id, s] of stats) {
      if (s.games < MIN) continue
      const wr = s.wins / s.games
      if (!best || wr > best.wr) best = { id, wr }
    }
    if (best) {
      const rest = starters.filter((id) => !JUNGLE_PETS.includes(id))
      return [best.id, ...rest]
    }
  }
  return starters
}

// --- Archetype clustering -----------------------------------------------
// Flex champions (AP poke vs tank Malphite, etc.) split into distinct builds;
// naive modal aggregation stitches the most popular items from DIFFERENT
// archetypes into a chimera no one actually builds (Heartsteel → Malignance).
// Classify each observation by its core items' tags and aggregate only the
// dominant cluster, so the emitted build is one coherent archetype.

function archetypeCounts(o, items) {
  let ap = 0
  let ad = 0
  let tank = 0
  for (const id of o.core) {
    const it = items[String(id)]
    if (!it) continue
    const t = it.tags ?? []
    const isAp = t.includes('SpellDamage') || (it.stats?.FlatMagicDamageMod ?? 0) > 0
    const isAd = t.includes('Damage') || t.includes('AttackSpeed') || t.includes('CriticalStrike')
    const isTank =
      !isAp && !isAd && (t.includes('Armor') || t.includes('SpellBlock') || t.includes('Health'))
    if (isAp) ap++
    if (isAd) ad++
    if (isTank) tank++
  }
  return { ap, ad, tank }
}

// The "pure" three-way read (ap/ad/tank/other) — both the tail of the refined
// classifier and the coverage-guard baseline in chooseClusters below.
function pureArchetype({ ap, ad, tank }) {
  if (tank > ap && tank > ad) return 'tank'
  if (ap > ad) return 'ap'
  if (ad > 0) return 'ad'
  return 'other'
}

// Genuine bruiser/hybrid builds (Volibear, Sett, Gwen …) mix a damage stat
// with real defensive itemization rather than leaning all the way into
// either — a pure three-way read saw that as a tie and silently fell through
// to "ad" no matter which side actually won, mislabeling e.g. a build with
// AP=2/AD=2/Tank=2 as pure AD. Treat "tank within 1 item of the leading
// damage stat" as its own bucket instead of a false tie-break.
function refinedArchetype(counts) {
  const { ap, ad, tank } = counts
  const damage = Math.max(ap, ad)
  if (tank > 0 && damage > 0 && Math.abs(tank - damage) <= 1) {
    return ad >= ap ? 'bruiser' : 'hybrid'
  }
  return pureArchetype(counts)
}

/** Archetype clusters for a group, largest first: [{ archetype, obs }]. */
function rankedClusters(group, items, classify = refinedArchetype) {
  const clusters = {}
  for (const o of group) {
    const k = classify(archetypeCounts(o, items))
    ;(clusters[k] ??= []).push(o)
  }
  return Object.entries(clusters)
    .map(([archetype, obs]) => ({ archetype, obs }))
    .sort((a, b) => b.obs.length - a.obs.length)
}

// A secondary archetype is surfaced as a selectable variant only when it's a
// real alternative: at least this fraction as common as the dominant build,
// AND clearing an absolute sample floor of its own. The fraction alone isn't
// enough — SR's per-role grouping means an off-role group's dominant cluster
// can itself be tiny (e.g. 3 games), so "34% as common as dominant" let
// literal 3-game troll picks (Sion SUPPORT, XinZhao ADC, …) through as if
// they were real build alternatives. VARIANT_MIN_ABSOLUTE closes that gap
// regardless of the fraction setting.
//
// ARAM and SR get a looser fraction than Arena deliberately: off-meta picks
// (AP Blitzcrank, AD Shaco, Katarina AP/AD, …) are a real, popular part of
// both modes. Arena stays strict — its build data is thin even for primary
// builds (median ~15 games; only ~250 matches have ever had a timeline
// fetched for the aggregator), so any secondary cluster there is noise no
// matter the fraction (verified 2026-08-02: even at 0.20, Arena's largest
// secondary sample was 14 games).
//
// Verified against the cached match set (2026-08-02):
//   - ARAM at 0.20: every newly-surfaced variant clears 20+ games (up to 183).
//   - SR at 0.20 + a 15-game absolute floor: 36 clean variants (Katarina
//     MID ap/ad, Shaco JUNGLE ad/ap, Lulu SUPPORT ap/ad, …), zero noise.
//   - Looser than ~0.10 (either mode) starts admitting single-digit-game
//     flukes as if they were real builds.
const VARIANT_MIN_FRACTION = MODE === 'arena' ? 0.34 : 0.2
const VARIANT_MIN_ABSOLUTE = 15
// The fraction bar has a blind spot: it scales with the dominant build's
// popularity, so the same 26-game AP Rakan cluster that surfaced when tank
// Rakan had 129 games silently vanished once tank reached 156 — an alt build
// disappearing because the MAIN build got more played. Above this many games
// a distinct archetype is a real build in its own right no matter how popular
// the primary is, so it passes on the absolute count alone. 'other' (cores
// that resolve no ap/ad/tank tags at all) is excluded — those clusters are
// degenerate games, not a build (measured 2026-08-03: the override without
// the exclusion admitted 'other' rows for Caitlyn/Jhin/Pyke/Locke/…; with it,
// every admitted variant is a recognizable off-meta build: AP Ashe/MF/Twitch/
// Varus in ARAM, AP Kaisa / AD Ekko / AP Senna in SR, and AP Rakan is back).
const VARIANT_MIN_STANDALONE = 25
const MAX_VARIANTS = 3

/** The clusters that clear the surfacing gates, dominant first. */
function gateClusters(clusters, minSample) {
  if (!clusters.length || clusters[0].obs.length < minSample) return []
  const primaryN = clusters[0].obs.length
  return clusters
    .filter(
      (c, i) =>
        c.obs.length >= minSample &&
        (i === 0 ||
          (c.obs.length >= primaryN * VARIANT_MIN_FRACTION && c.obs.length >= VARIANT_MIN_ABSOLUTE) ||
          (c.archetype !== 'other' && c.obs.length >= VARIANT_MIN_STANDALONE)),
    )
    .slice(0, MAX_VARIANTS)
}

// Two clusters that aggregate to the same opening are one build wearing two
// labels — offering both as a choice ("Bruiser" and "Tank", identical first
// three items) is noise, and it means the refinement cut through a build
// rather than between two. The pure read never produced such a pair (0 of 33
// multi-variant SR groups pre-1.6); refinement introduced 4 (Amumu JUNGLE,
// Poppy TOP, Shen TOP, Urgot TOP).
function dropDuplicatePaths(clusters) {
  const kept = []
  return clusters.filter((c) => {
    const path = aggregateCore(c.obs)
    // Two labels are the same build only when neither path ever diverges from
    // the other: identical, or one a prefix of the other (what a truncated
    // cluster looks like). A cluster that picks a different item at ANY slot
    // is a real alternative and stays.
    //
    // This started as a first-three-items match, back when truncation left
    // lots of two- and three-item paths. Now that widening runs paths out to
    // five, that test threw away real choices: ARAM Illaoi's AD and Tank both
    // open Sundered Sky → Iceborn → Spirit Visage and then part ways (Death's
    // Dance vs Thornmail), which is exactly the kind of decision the picker
    // exists to offer. More viable playstyles beats a tidier list.
    const twin = kept.some((k) => {
      const n = Math.min(k.length, path.length)
      return n > 0 && k.slice(0, n).join(',') === path.slice(0, n).join(',')
    })
    if (twin) return false
    kept.push(path)
    return true
  })
}

// The bruiser/hybrid buckets are a refinement, and refining a blended cluster
// mechanically shrinks each piece — against the variant gates that can DELETE
// a build instead of relabeling it (v1.6.0 shipped exactly that: ARAM Amumu's
// 49-game AP cluster split into ap+hybrid fragments that each failed the
// gates, so "AP Amumu" vanished from a dataset that had carried it for months;
// SR lost Udyr TOP's tank and ap, Nidalee TOP's ap, and every ~3-game niche
// group whose primary fell under min-sample). So gate BOTH clusterings and
// keep the refined one only when it's an actual improvement on the pure
// ap/ad/tank read — otherwise this group falls back to that read, which is
// exactly what shipped before the buckets existed.
function chooseClusters(group, items, minSample) {
  const pure = gateClusters(rankedClusters(group, items, pureArchetype), minSample)
  const refinedAll = gateClusters(rankedClusters(group, items, refinedArchetype), minSample)
  const refined = dropDuplicatePaths(refinedAll)
  // Every archetype the pure read surfaces must still be there, as itself or
  // as the mixed bucket it would have been folded into.
  const have = new Set(refined.map((c) => c.archetype))
  const covered = (a) =>
    have.has(a) ||
    (a === 'ap' && have.has('hybrid')) ||
    (a === 'ad' && have.has('bruiser')) ||
    (a === 'tank' && (have.has('hybrid') || have.has('bruiser')))
  if (!pure.every((c) => covered(c.archetype))) return pure
  // More distinct builds than the pure read found is a real gain. An equal
  // count is only a gain when nothing was deduped — if it was, the refinement
  // split one build in two and pure describes that build off the full sample.
  if (refined.length > pure.length) return refined
  return refined.length === pure.length && refined.length === refinedAll.length ? refined : pure
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

const GENERAL_MIN_SAMPLE = 10 // group size needed for popular-alternative reads
const GENERAL_MIN_RATE = 0.1 // baseline pick rate floor for a general alternative
const MAX_SITUATIONALS = 6

function aggregateSituationals(group, items, coreIds) {
  const n = group.length
  const core = new Set(coreIds)

  // Candidate items: any legendary someone bought that isn't already core.
  const totals = new Map()
  for (const o of group)
    for (const id of new Set(o.core)) if (!core.has(id)) totals.set(id, (totals.get(id) ?? 0) + 1)

  const found = []
  if (n >= MIN_SITUATIONAL_SAMPLE) {
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
  }

  const name = (id) => items[String(id)]?.name ?? `Item ${id}`
  const out = found.slice(0, MAX_SITUATIONALS).map((f) => ({
    itemId: f.itemId,
    condition: f.cond,
    description: `${name(f.itemId)} — ${CONDITION_LABEL[f.cond]} (${Math.round(
      f.rate * 100,
    )}% pick vs ${Math.round(f.baseline * 100)}% baseline)`,
  }))

  // Pad with popular general-purpose alternatives so the live recommender and
  // the build page always have flex options beyond the core path (most groups
  // used to emit zero situationals, which left late-game recs empty).
  if (n >= GENERAL_MIN_SAMPLE) {
    const taken = new Set(out.map((s) => s.itemId))
    const general = [...totals.entries()]
      .filter(([id, total]) => !taken.has(id) && total / n >= GENERAL_MIN_RATE && total >= 2)
      .sort((a, b) => b[1] - a[1])
    for (const [itemId, total] of general) {
      if (out.length >= MAX_SITUATIONALS) break
      out.push({
        itemId,
        condition: 'general',
        description: `${name(itemId)} — popular alternative (built in ${Math.round(
          (100 * total) / n,
        )}% of games)`,
      })
    }
  }
  return out
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
export function toBuildPath(group, items, archetype = null) {
  const perkRep = modalBy(group, (o) => JSON.stringify(o.perks))
  const skillRep = modalBy(group, (o) => `${o.maxOrder}|${o.start}`)
  const wins = group.filter((o) => o.win).length
  const coreItems = aggregateCore(group)
  // Per-item pick/win rates across the cluster — surfaced in the UI the way
  // stat sites annotate each slot, and honest about how confident each pick is.
  const coreItemStats = {}
  for (const id of coreItems) {
    const withItem = group.filter((o) => o.core.includes(id))
    if (withItem.length === 0) continue
    coreItemStats[id] = {
      games: withItem.length,
      pickRate: Math.round((100 * withItem.length) / group.length),
      winRate: Math.round((100 * withItem.filter((o) => o.win).length) / withItem.length),
    }
  }
  return {
    id: idSeq++,
    championId: group[0].championId,
    mode: MODE_CFG.buildMode,
    role: group[0].role,
    archetype,
    patch: modal(group.map((o) => o.patch)),
    starterItems: aggregateStarters(group),
    coreItems,
    coreItemStats,
    situationalItems: aggregateSituationals(group, items, coreItems),
    bootsOptions: topN(group.map((o) => o.boots), 2),
    ...perkRep.perks,
    skillMaxOrder: skillRep.maxOrder,
    skillStart: skillRep.start,
    sampleTiers: tierLabel(group),
    notes: [
      `Aggregated from ${group.length} ${tierLabel(group)} games on patch ${modal(
        group.map((o) => o.patch),
      )} · ${Math.round((100 * wins) / group.length)}% win rate.`,
    ],
    winRate: Math.round((1000 * wins) / group.length) / 10,
    sampleSize: group.length,
  }
}

// ---- pipeline -------------------------------------------------------------
const APEX_LADDERS = {
  challenger: '/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5',
  grandmaster: '/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5',
  master: '/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5',
}
// Everything below Master has no single-call ladder — sample the paged entries
// endpoint instead. Division II is the middle of a tier, so it represents the
// tier better than I (its top) or IV (where demoted and new accounts pile up).
const DIVISION_TIERS = new Set(['diamond', 'emerald', 'platinum', 'gold', 'silver', 'bronze', 'iron'])

/** Which elo a build's games came from, for honest provenance in the UI. */
const TIER_BUCKET = {
  challenger: 'Master+',
  grandmaster: 'Master+',
  master: 'Master+',
  diamond: 'Diamond',
  emerald: 'Emerald',
  platinum: 'Platinum',
  gold: 'Gold',
  silver: 'Silver',
  bronze: 'Bronze',
  iron: 'Iron',
}

/**
 * Players proven to play THIS queue: the participants of the most recent
 * cached matches of it. The ranked ladder is the wrong population for a
 * casual queue — measured 2026-08-04, 1 of 50 ranked-ladder players had
 * played ARAM in the previous 21 days (0.02 match ids per call, ~50 hours to
 * gather 3,000). Seeding from ARAM matches instead returned 22 of 22 players
 * active, at 16–38 ids per call. Same rate limit, ~1000x the yield.
 *
 * Every match id carries its platform prefix and a puuid is only queryable on
 * its own regional cluster, so seeds are filtered to the ones this platform
 * can actually ask about.
 */
function snowballSeeds(platform) {
  const cluster = regionalCluster(platform)
  const matches = []
  for (const id of cachedMatchIds()) {
    if (regionalCluster(id.split('_')[0].toLowerCase()) !== cluster) continue
    try {
      const m = JSON.parse(readFileSync(join(CACHE, `${id}.match.json`), 'utf8'))
      if (!QUEUES.has(m?.info?.queueId)) continue
      matches.push({ t: m.info.gameEndTimestamp ?? m.info.gameCreation ?? 0, players: m.metadata?.participants ?? [] })
    } catch {
      // unreadable cache entry — skip
    }
  }
  matches.sort((a, b) => b.t - a.t)
  const seeds = new Map()
  for (const m of matches) {
    for (const p of m.players) if (!seeds.has(p)) seeds.set(p, 'All ranks')
    if (seeds.size >= SNOWBALL_SEEDS) break
  }
  const newest = matches[0]?.t ? new Date(matches[0].t).toISOString().slice(0, 10) : 'none'
  console.log(`  ${seeds.size} seed players from cached ${MODE_CFG.buildMode} matches (newest ${newest})`)
  return seeds
}

/** puuid → elo bucket it was sampled from (first tier to claim it wins). */
async function gatherPuuids(platform) {
  const puuids = new Map()
  const add = (list, tier) => {
    let n = 0
    for (const e of list ?? []) {
      if (!e.puuid) continue
      n++
      if (!puuids.has(e.puuid)) puuids.set(e.puuid, TIER_BUCKET[tier])
    }
    return n
  }
  for (const tier of TIERS) {
    if (APEX_LADDERS[tier]) {
      const list = await riotGet(platformHost(platform), APEX_LADDERS[tier])
      console.log(`  ${tier}: ${add(list?.entries, tier)} entries`)
    } else if (DIVISION_TIERS.has(tier)) {
      let got = 0
      for (let page = 1; page <= ENTRY_PAGES; page++) {
        const list = await riotGet(
          platformHost(platform),
          `/lol/league/v4/entries/RANKED_SOLO_5x5/${tier.toUpperCase()}/II?page=${page}`,
        )
        if (!list?.length) break
        got += add(list, tier)
      }
      console.log(`  ${tier} II: ${got} entries (${ENTRY_PAGES} page${ENTRY_PAGES > 1 ? 's' : ''})`)
    } else {
      console.warn(`  ⚠ unknown tier "${tier}" — expected ${Object.keys(TIER_BUCKET).join(', ')}`)
    }
  }
  if (puuids.size === 0)
    console.warn('  ⚠ no puuids found — the league entries lacked a puuid field for this key/region.')
  return puuids
}

// Which elo each cached match was sampled through, so a build can say where
// its games came from instead of the UI assuming "high-elo". Every match
// cached before this manifest existed came from the apex ladders — that was
// the only sampling the aggregator could do — so seeding them as Master+ is
// accurate, not a guess.
const TIER_MANIFEST_FILE = join(CACHE, 'build-tier-manifest.json')
const tierManifest = new Map()

function loadTierManifest() {
  if (existsSync(TIER_MANIFEST_FILE)) {
    try {
      for (const [id, tier] of Object.entries(JSON.parse(readFileSync(TIER_MANIFEST_FILE, 'utf8'))))
        tierManifest.set(id, tier)
      return
    } catch {
      // unreadable — fall through and reseed
    }
  }
  for (const id of cachedMatchIds()) tierManifest.set(id, 'Master+')
  console.log(`  seeded tier manifest with ${tierManifest.size} previously-cached matches (Master+)`)
}

function saveTierManifest() {
  writeFileSync(TIER_MANIFEST_FILE, JSON.stringify(Object.fromEntries(tierManifest)))
}

/**
 * The elo mix behind a set of observations, commonest first — e.g. "Master+"
 * or "Emerald/Master+". Buckets under a tenth of the sample are dropped so a
 * handful of stray games can't muddy the label.
 */
function tierLabel(group) {
  const counts = new Map()
  for (const o of group) {
    const t = tierManifest.get(o.matchId) ?? 'Master+'
    counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, n]) => n / group.length >= 0.1)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t)
    .join('/')
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

/** Match ids for these players, recording the elo each id was reached through. */
async function gatherMatchIds(puuids, platform) {
  const ids = new Set()
  const shuffled = [...puuids.keys()].sort(() => Math.random() - 0.5)
  let sinceFlush = 0
  for (const puuid of shuffled) {
    if (ids.size >= MATCH_LIMIT) break
    const list = await riotGet(
      regionHost(platform),
      `/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=${QUEUE}&count=${PER_PLAYER}${SINCE_PARAM}`,
    )
    for (const id of list ?? []) {
      ids.add(id)
      // A match reached through several players keeps the first elo that found
      // it. Rough by nature — a game has ten players and they aren't all the
      // same rank — but it's the only provenance signal available, and it's
      // enough to keep a Master+ build from being labelled Emerald.
      if (!tierManifest.has(id)) tierManifest.set(id, puuids.get(puuid))
      if (ids.size >= MATCH_LIMIT) break
    }
    // Flush periodically. A run that dies here — expired key, Ctrl-C — has
    // already written matches to the cache, and without this the manifest never
    // learns about them: they fall through to the Master+ seed default and the
    // Build page then claims apex provenance for lower-elo games.
    if (++sinceFlush >= 25) {
      saveTierManifest()
      sinceFlush = 0
    }
  }
  saveTierManifest()
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
  loadTierManifest()

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
  } else if (CACHED_ONLY) {
    // Re-aggregate what's on disk (e.g. after a logic change) — no key, no API.
    // The per-mode queue/map filter in observeMatch picks the right matches.
    matchIds = cachedMatchIds()
    console.log(`Re-aggregating ${matchIds.length} cached matches (no Riot calls).\n`)
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
      const puuids = SNOWBALL ? snowballSeeds(platform) : await gatherPuuids(platform)
      console.log(`  ${puuids.size} unique players`)
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
    // A live run that pooled nothing is never a real result — it means the
    // ids are being requested under a queue that no longer serves them. Riot
    // answers a retired queue id with an empty list and HTTP 200, so this is
    // indistinguishable from "nobody played" unless we refuse it. Arena went
    // undetected this way from 1700 → 1750 for months, quietly merging no-ops
    // over data that kept aging. Fail loudly instead of writing that merge.
    if (matchIds.length === 0) {
      console.error(
        `\n  ✗ 0 matches pooled for --mode ${MODE} (queue ${QUEUE}).\n` +
          `    Nothing was written — the previous ${MODE_CFG.file} is untouched.\n\n` +
          `    Most likely the queue id changed. Riot returns an empty list, not\n` +
          `    an error, so verify against a real recent game rather than the\n` +
          `    public queues.json (it lags new modes by weeks):\n\n` +
          `      curl "https://<cluster>.api.riotgames.com/lol/match/v5/matches/\\\n` +
          `        by-puuid/<puuid>/ids?count=5&api_key=..."\n\n` +
          `    then read queueId off one of those matches and check it against\n` +
          `    MODE_CFG (map should still be ${MODE_CFG.map}). Add the new id as\n` +
          `    \`queue\` and keep the old one in \`queues\`.\n\n` +
          `    If the mode really is out of rotation, re-run with --cached-only.`,
      )
      process.exit(1)
    }
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

  // Matches were fetched but none survived observeMatch's queue/map filter —
  // the other half of the same trap: the fetch id can be right while the
  // accepted-queue set is stale, or --since can exclude everything. Either way
  // the only possible output is a no-op merge, so don't write one.
  if (observations.length === 0 && !DRY_RUN) {
    console.error(
      `  ✗ 0 observations from ${matchIds.length} matches for --mode ${MODE}.\n` +
        `    Nothing was written — the previous ${MODE_CFG.file} is untouched.\n` +
        `    observeMatch keeps queue ∈ {${[...QUEUES].join(', ')}} on map ${MODE_CFG.map}` +
        (SINCE_DAYS ? `, played in the last ${SINCE_DAYS}d` : '') +
        `.\n    Check a cached match's queueId/mapId against those before widening --since.`,
    )
    process.exit(1)
  }

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
  for (const group of groups.values()) {
    // Aggregate each archetype cluster into its own coherent build (flex
    // champions split into e.g. AP and Tank), so the Build page can offer them
    // as variants. Cluster-per-build avoids tank/AP chimeras; the dominant one
    // stays first. chooseClusters applies the surfacing gates and the
    // refinement coverage guard (see its comment).
    for (const c of chooseClusters(group, statik.items, minSample)) {
      const path = toBuildPath(c.obs, statik.items, c.archetype)
      // A cluster whose games can't agree on two core items isn't a build.
      // Arena Lee Sin and Rek'Sai shipped rows with an empty coreItems and no
      // starters — the Build page rendered a "CORE BUILD PATH" heading over
      // nothing. Emitting no row instead lets the app fall through to its
      // honest "too few high-elo games this patch" message, which also points
      // at the Live tracker's scoring engine. Thinner-but-real 2-item rows
      // stay: they still carry runes, skill order, starters and boots.
      if (path.coreItems.length < 2) continue
      builds.push(path)
    }
  }
  builds.sort(
    (a, b) => a.championId.localeCompare(b.championId) || (a.role ?? '').localeCompare(b.role ?? ''),
  )

  if (DRY_RUN) {
    printSampleBuilds(builds, statik.items)
    console.log(`(dry run — ${builds.length} builds from ${groups.size} groups, nothing written)`)
    return
  }

  // Safety merge: fold this run's builds over the previous output rather than
  // replacing it. A run only observes the champ/roles in its match sample, so a
  // plain overwrite silently drops everything it didn't see this time (a 300-
  // match run quietly halved the SR set on patch 26.14). Keeping each build's
  // own `patch` field, un-refreshed entries stay visibly stale for consumers.
  // --replace opts out for a clean rebuild that prunes anything no longer seen.
  const key = (b) => `${b.championId}|${b.role ?? ''}|${b.archetype ?? ''}`
  const byKey = new Map(builds.map((b) => [key(b), b]))
  let retained = 0
  if (!REPLACE && existsSync(OUT)) {
    try {
      const prev = JSON.parse(readFileSync(OUT, 'utf8'))
      if (Array.isArray(prev)) {
        for (const b of prev) {
          if (!byKey.has(key(b))) {
            byKey.set(key(b), b)
            retained++
          }
        }
      }
    } catch {
      // unreadable/legacy output — just write this run's builds
    }
  }
  const merged = [...byKey.values()].sort(
    (a, b) => a.championId.localeCompare(b.championId) || (a.role ?? '').localeCompare(b.role ?? ''),
  )
  saveTierManifest()
  writeFileSync(OUT, JSON.stringify(merged, null, 2) + '\n')
  console.log(
    `\n✓ Wrote ${merged.length} builds (${builds.length} refreshed from ${groups.size} groups this run` +
      `${REPLACE ? ', --replace' : `, ${retained} retained from previous`}) → ${OUT}`,
  )
  const covered = new Set(merged.map((b) => b.championId)).size
  console.log(`  covering ${covered} champions across ${new Set(merged.map((b) => b.role)).size} roles`)
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
