#!/usr/bin/env node
// Build src/data/mayhemAugmentStats.json — real ARAM Mayhem augment stats
// (global + per-champion), the one thing Riot's API can't give us.
//
// WHY SCRAPE: Match-V5 does not index Mayhem (queue 2400 / gameMode KIWI) at
// all — the by-puuid list skips those games and a direct fetch 403s, so the
// augment picks that DO exist in the local client can't be aggregated across
// players through the official API. op.gg aggregates them from its desktop
// app's local-history uploads and ships the finished table embedded in the
// mode page's RSC payload. We parse that table. It is not a documented API, so
// this is best-effort and will need fixing if op.gg changes their page shape.
//
// SOURCES joined:
//  1. op.gg/lol/modes/aram-mayhem — per augment: a pick rate (`popular`, a real
//     %), an opaque composite `performance` score (ranges past 100, so NOT a
//     win rate — stored as `score`, not shown as a %), an op.gg `tier`, and the
//     same three for its top champions. Augments/champions are keyed by Riot's
//     numeric ids.
//  2. CDragon cherry-augments (`nameTRA`) + local augmentExtras.json — Riot
//     augment id → name, so the app can match a badge (which resolves to a
//     name) to a row regardless of the Arena-vs-kiwi id split.
//  3. Data Dragon champion.json — numeric champion id → Data Dragon id (e.g.
//     63 → "Brand"), the form the app keys per-champion data by.
//
//   node scripts/fetch-mayhem-stats.mjs

import { writeFileSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OPGG_URL = 'https://op.gg/lol/modes/aram-mayhem'
const CDRAGON_AUGMENTS =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/cherry-augments.json'
const DDRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json'

const canon = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

// --- 1. op.gg embedded augment table -----------------------------------------
console.log('fetching op.gg mayhem page…')
const html = await (await fetch(OPGG_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text()
// RSC payload escapes quotes as \"; unescape a working copy.
const un = html.replace(/\\"/g, '"')

// Each augment: {"id":N,"tier":N,"performance":F,"popular":F,"champion_ids":[…],
//                "champions":[{"id":N,"tier":N,"performance":F,"popular":F},…]}
const headRe =
  /\{"id":(\d+),"tier":(\d+),"performance":([\d.]+),"popular":([\d.]+),"champion_ids":\[/g
const rawAugments = []
let m
while ((m = headRe.exec(un))) {
  const head = { id: +m[1], tier: +m[2], score: +m[3], pickRate: +m[4], at: m.index }
  // Per-champion block: read the flat "champions":[ … ] array that follows.
  const from = un.indexOf('"champions":[', head.at)
  const champs = []
  if (from >= 0 && from < head.at + 6000) {
    const end = un.indexOf(']', from)
    const inner = un.slice(from + '"champions":['.length, end)
    const cRe = /\{"id":(\d+),"tier":(\d+),"performance":([\d.]+),"popular":([\d.]+)\}/g
    let c
    while ((c = cRe.exec(inner)))
      champs.push({ id: +c[1], tier: +c[2], score: +c[3], pickRate: +c[4] })
  }
  rawAugments.push({ id: head.id, tier: head.tier, score: head.score, pickRate: head.pickRate, champs })
}
if (rawAugments.length < 50)
  throw new Error(`op.gg parse yielded only ${rawAugments.length} augments — page shape likely changed`)
console.log(`  parsed ${rawAugments.length} augments`)

// --- 2. augment id → name -----------------------------------------------------
console.log('fetching CDragon augment names…')
const cherry = await (await fetch(CDRAGON_AUGMENTS)).json()
const nameById = new Map()
for (const a of Array.isArray(cherry) ? cherry : []) if (a?.id != null && a.nameTRA) nameById.set(a.id, a.nameTRA)
// Local extras cover the Mayhem-only augments (often ahead of CDragon's mirror).
const extras = JSON.parse(readFileSync(join(ROOT, 'src/data/augmentExtras.json'), 'utf8'))
for (const e of extras) {
  const id = +String(e.key).replace(/^x:/, '')
  if (!nameById.has(id) && e.name) nameById.set(id, e.name)
}

// --- 3. numeric champion id → Data Dragon id ---------------------------------
console.log('fetching Data Dragon champions…')
const versions = await (await fetch(DDRAGON_VERSIONS)).json()
const patch = versions[0]
const champData = await (
  await fetch(`https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`)
).json()
const ddragonByNumeric = new Map()
for (const c of Object.values(champData.data)) ddragonByNumeric.set(Number(c.key), c.id)

// --- join & emit --------------------------------------------------------------
const out = {}
let unnamed = 0
let withChamps = 0
for (const a of rawAugments) {
  const name = nameById.get(a.id)
  if (!name) {
    unnamed++
    continue // no name → the app can't match it to a badge anyway
  }
  const champions = {}
  for (const c of a.champs) {
    const cid = ddragonByNumeric.get(c.id)
    if (cid) champions[cid] = { pickRate: c.pickRate, score: c.score, tier: c.tier }
  }
  if (Object.keys(champions).length) withChamps++
  out[a.id] = {
    name,
    canon: canon(name),
    tier: a.tier,
    pickRate: a.pickRate,
    score: a.score,
    champions,
  }
}

writeFileSync(join(ROOT, 'src/data/mayhemAugmentStats.json'), JSON.stringify(out, null, 2) + '\n')
console.log(
  `\n✓ src/data/mayhemAugmentStats.json — ${Object.keys(out).length} augments ` +
    `(${withChamps} with per-champ rows, ${unnamed} dropped unnamed) · patch ${patch}`,
)
