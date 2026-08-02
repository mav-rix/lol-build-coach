#!/usr/bin/env node
// Build the augment metadata the app bundles, from two sources:
//
//  1. Community Dragon's arena file (Riot's own data, mirrored): ids, icons,
//     descriptions, and Arena's own rarity (0/1/2 = silver/gold/prismatic; 4 =
//     utility pseudo-augments — stat anvils, rerolls — not a real pick tier).
//     The numeric `id` matches Match-V5's playerAugmentN fields, so the
//     win-rate aggregator joins to this. Augments aren't in Data Dragon, so
//     this is the only id/icon source.
//  2. The official League wiki's MayhemAugmentData module: the CURRENT ARAM
//     Mayhem augment pool with Mayhem-specific tiers. Arena and Mayhem pools
//     diverged in season 2026 — the arena file carries plenty of augments that
//     aren't offered in Mayhem (and Mayhem-only augments that have no arena
//     id yet, which we can't show stats for anyway).
//
// Writes two metadata files from the same CDragon fetch:
//   - src/data/augments.json      Mayhem pool only (CDragon ∩ wiki, wiki's
//                                  tier) — what the Mayhem overlay's vision
//                                  matcher and badges key off. Retired/
//                                  Arena-only augments must NOT leak in here.
//   - src/data/augmentsArena.json Full real Arena pool (every CDragon augment
//                                  with rarity 0/1/2), Arena's own rarity, no
//                                  wiki dependency. Feeds Arena-scoped features
//                                  (pre-game Top Augments panel) that want the
//                                  complete picture, not just Mayhem's subset.
//
// Also writes src/data/patch.json with the League display patch the data was
// generated on. Re-run each patch.
//
//   node scripts/fetch-augments.mjs

import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CDRAGON = 'https://raw.communitydragon.org/latest'
const WIKI_MODULE =
  'https://wiki.leagueoflegends.com/en-us/Module:MayhemAugmentData/data?action=raw'

// Strip HTML tags and unresolved @template@ / {{ keyword }} tokens down to
// plain text ("{{ Item_Keyword_OnHit }}" reads as "On-Hit").
const clean = (html) =>
  String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/@[^@]+@/g, '…')
    .replace(/\{\{ *Item_Keyword_(\w+) *\}\}/gi, (_, w) => w.replace(/([a-z])([A-Z])/g, '$1-$2'))
    .replace(/\{\{[^}]*\}\}/g, '…')
    .replace(/\s+/g, ' ')
    .trim()

// Names differ cosmetically between sources ("Don't Blink" vs "Dont Blink"),
// so match on a lowercase alphanumeric key.
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

// Official Mayhem pool: parse the wiki Lua module's top-level entries —
//   ["Name"] = { ["description"] = ..., ["tier"] = "Silver|Gold|Prismatic" }
const lua = await (await fetch(WIKI_MODULE)).text()
const mayhem = new Map()
for (const block of lua.split(/^\t\["/m).slice(1)) {
  const name = block.split('"]')[0]
  const tier = block.match(/\["tier"\] = "(\w+)"/)?.[1]?.toLowerCase()
  if (!tier) continue
  mayhem.set(norm(name), {
    name,
    tier,
    disabled: block.includes('currently disabled'),
    matched: false,
  })
}
if (mayhem.size < 100) {
  console.error(`Wiki Mayhem module parsed to only ${mayhem.size} augments — format change? Aborting.`)
  process.exit(1)
}

const data = await (await fetch(`${CDRAGON}/cdragon/arena/en_us.json`)).json()
const augments = data.augments
  .filter((a) => a.id && a.name && a.iconLarge && a.name !== 'Null Augment')
  .flatMap((a) => {
    const m = mayhem.get(norm(a.name))
    if (!m || m.disabled) return []
    m.matched = true
    return {
      id: a.id,
      name: a.name,
      rarity: m.tier, // Mayhem tier, not the arena rarity — they can differ
      desc: clean(a.desc),
      icon: `${CDRAGON}/game/${a.iconLarge.toLowerCase()}`,
    }
  })
  .sort((a, b) => a.id - b.id)

writeFileSync(join(ROOT, 'src/data/augments.json'), JSON.stringify(augments, null, 2) + '\n')
const byRarity = {}
for (const a of augments) byRarity[a.rarity] = (byRarity[a.rarity] ?? 0) + 1
const unmatched = [...mayhem.values()].filter((m) => !m.matched && !m.disabled)
console.log(`Wrote ${augments.length} augments → src/data/augments.json`, byRarity)
console.log(
  `Mayhem pool: ${mayhem.size} on the wiki; ${unmatched.length} have no arena id (Mayhem-only — no Match-V5 stats possible, not bundled)`,
)

// Full Arena pool: every real pickable augment (rarity 0/1/2), Arena's own
// rarity — independent of the wiki/Mayhem intersection above.
const ARENA_RARITY = { 0: 'silver', 1: 'gold', 2: 'prismatic' }
const arenaAugments = data.augments
  .filter((a) => a.id && a.name && a.iconLarge && a.name !== 'Null Augment' && a.rarity in ARENA_RARITY)
  .map((a) => ({
    id: a.id,
    name: a.name,
    rarity: ARENA_RARITY[a.rarity],
    desc: clean(a.desc),
    icon: `${CDRAGON}/game/${a.iconLarge.toLowerCase()}`,
  }))
  .sort((a, b) => a.id - b.id)
writeFileSync(join(ROOT, 'src/data/augmentsArena.json'), JSON.stringify(arenaAugments, null, 2) + '\n')
const arenaByRarity = {}
for (const a of arenaAugments) arenaByRarity[a.rarity] = (arenaByRarity[a.rarity] ?? 0) + 1
console.log(`Wrote ${arenaAugments.length} augments → src/data/augmentsArena.json`, arenaByRarity)

// League's displayed patch (e.g. "26.13") for the UI: Community Dragon reports
// the internal version ("16.13.…"); since the 2025 season renumbering, the
// public patch is internal major + 10.
const meta = await (await fetch(`${CDRAGON}/content-metadata.json`)).json()
const v = String(meta.version ?? '').match(/^(\d+)\.(\d+)/)
if (v) {
  const leaguePatch = `${Number(v[1]) + 10}.${v[2]}`
  writeFileSync(
    join(ROOT, 'src/data/patch.json'),
    JSON.stringify({ leaguePatch }, null, 2) + '\n',
  )
  console.log(`Wrote patch ${leaguePatch} → src/data/patch.json`)
} else {
  console.warn(`Could not parse content-metadata version "${meta.version}" — patch.json left as-is`)
}
