#!/usr/bin/env node
// Fetch Arena/Mayhem augment metadata from Community Dragon (Riot's own data,
// mirrored) and write a slim src/data/augments.json the app bundles. Augments
// aren't in Data Dragon, so this is the only metadata source. The numeric `id`
// matches Match-V5's playerAugmentN fields, so the win-rate aggregator joins to
// this. Re-run each patch.
//
//   node scripts/fetch-augments.mjs

import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CDRAGON = 'https://raw.communitydragon.org/latest'
const RARITY = { 0: 'silver', 1: 'gold', 2: 'prismatic' }

// Strip HTML tags and unresolved @template@ tokens down to plain text.
const clean = (html) =>
  String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/@[^@]+@/g, '…')
    .replace(/\s+/g, ' ')
    .trim()

const data = await (await fetch(`${CDRAGON}/cdragon/arena/en_us.json`)).json()
const augments = data.augments
  // Only the three pickable tiers — rarity 4 ("other") is utility pseudo-augments
  // (Replace Augment, stat anvils, extra-slot) that aren't real picks.
  .filter((a) => a.id && a.name && a.iconLarge && a.name !== 'Null Augment' && a.rarity in RARITY)
  .map((a) => ({
    id: a.id,
    name: a.name,
    rarity: RARITY[a.rarity] ?? 'other',
    desc: clean(a.desc),
    icon: `${CDRAGON}/game/${a.iconLarge.toLowerCase()}`,
  }))
  .sort((a, b) => a.id - b.id)

writeFileSync(join(ROOT, 'src/data/augments.json'), JSON.stringify(augments, null, 2) + '\n')
const byRarity = {}
for (const a of augments) byRarity[a.rarity] = (byRarity[a.rarity] ?? 0) + 1
console.log(`Wrote ${augments.length} augments → src/data/augments.json`, byRarity)
