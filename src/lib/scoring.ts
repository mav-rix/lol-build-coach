import type { BuildRec } from '@/lib/builder'
import { unavailableItems } from '@/lib/itemAvailability'
import type { LiveThreatAnalysis } from '@/lib/threats'
import type { DDragonChampion, DDragonItem } from '@/types/ddragon'
import type { LivePlayer } from '@/types/live'

// Weighted item-scoring builder. Works for ANY champion with no hand-authored
// build path: it scores every valid legendary from its Data Dragon stats/tags,
// weighted by the champion's class, and adds situational bonuses driven by the
// live enemy composition + what they've actually bought. This is what powers
// "Build Next" for unseeded champions and keeps adapting as the game develops.

// --- Curated effect sets (things Data Dragon tags don't capture) ---

// Grievous Wounds (anti-heal). No shared tag, so listed explicitly.
const GRIEVOUS_AD = new Set([3033, 6609, 3123]) // Mortal Reminder, Chempunk, Executioner's
const GRIEVOUS_AP = new Set([3165, 3011, 3916]) // Morellonomicon, Chemtech, Oblivion Orb
const GRIEVOUS_TANK = new Set([3075, 6664]) // Thornmail, Hollow Radiance
// Cheapest anti-heal component to rush when healing is urgent and gold is tight.
const CHEAP_GRIEVOUS_AD = 3123 // Executioner's Calling (800g)
const CHEAP_GRIEVOUS_AP = 3916 // Oblivion Orb (800g)

// % max-health damage — excellent into stacked health/armor regardless of pen.
const PERCENT_HP = new Set([3153, 3124, 6672, 3748, 3115]) // BotRK, Guinsoo, Kraken, Titanic, Nashor's

// Cleanse / heavy-CC relief actives (beyond the Tenacity tag).
const CLEANSE = new Set([3140, 3139, 6035]) // QSS, Mercurial, Silvermere

// Survivability spikes to favor when you're dying / behind.
const DEFENSIVE_ACTIVES = new Set([3157, 3026, 3156, 3053, 3102, 3190]) // Zhonya, GA, Maw, Sterak, Banshee, Locket

// Boots options, chosen by threat.
const BOOTS = {
  ad: 3047, // Plated Steelcaps — vs AD
  apCc: 3111, // Mercury's Treads — vs AP / CC
  attackSpeed: 3006, // Berserker's — marksmen
  ability: 3020, // Sorcerer's — mages
  cdr: 3158, // Ionian — utility
  default: 3009, // Boots of Swiftness
}

interface DamageProfile {
  isAP: boolean
  isMarksman: boolean
  isAssassin: boolean
  isTank: boolean
  isFighter: boolean
  isSupport: boolean
}

function profile(champion: DDragonChampion): DamageProfile {
  const t = champion.tags
  const isMarksman = t.includes('Marksman')
  const isAP =
    t.includes('Mage') ||
    (!isMarksman && champion.info.magic > champion.info.attack)
  return {
    isAP,
    isMarksman,
    isAssassin: t.includes('Assassin'),
    isTank: t.includes('Tank'),
    isFighter: t.includes('Fighter'),
    isSupport: t.includes('Support'),
  }
}

const has = (item: DDragonItem, tag: string) => item.tags.includes(tag)
const stat = (item: DDragonItem, key: string) => item.stats[key] ?? 0

function isMR(item: DDragonItem) {
  return has(item, 'SpellBlock') || has(item, 'MagicResist') || stat(item, 'FlatSpellBlockMod') > 0
}
function isArmor(item: DDragonItem) {
  return has(item, 'Armor') || stat(item, 'FlatArmorMod') > 0
}
function isADItem(item: DDragonItem) {
  return (
    has(item, 'Damage') ||
    has(item, 'AttackSpeed') ||
    has(item, 'CriticalStrike') ||
    stat(item, 'FlatPhysicalDamageMod') > 0
  )
}
function isAPItem(item: DDragonItem) {
  return has(item, 'SpellDamage') || stat(item, 'FlatMagicDamageMod') > 0
}
function isPureDefensive(item: DDragonItem) {
  return !isADItem(item) && !isAPItem(item) && (isArmor(item) || isMR(item) || has(item, 'Health'))
}

/** Base damage value of an item for this champion, gold-normalized-ish. */
function damageValue(item: DDragonItem, p: DamageProfile): number {
  let v = 0
  if (p.isAP) {
    v += stat(item, 'FlatMagicDamageMod') * 1.0
    if (has(item, 'MagicPenetration')) v += 25
  } else {
    v += stat(item, 'FlatPhysicalDamageMod') * 1.0
    v += stat(item, 'PercentAttackSpeedMod') * 100 * (p.isMarksman ? 1.0 : 0.5)
    v += stat(item, 'FlatCritChanceMod') * 100 * (p.isMarksman ? 1.2 : 0.2)
    if (has(item, 'ArmorPenetration')) v += p.isAssassin ? 30 : 20
    if (has(item, 'OnHit')) v += p.isMarksman ? 25 : 12
    v += stat(item, 'PercentLifeStealMod') * 100 * (p.isMarksman || p.isFighter ? 0.8 : 0.3)
  }
  return v
}

/** Defensive/utility value — always some worth, more for tanks/fighters. */
function defensiveValue(item: DDragonItem, p: DamageProfile): number {
  const tankMult = p.isTank ? 1.0 : p.isFighter ? 0.6 : p.isSupport ? 0.5 : 0.35
  let v = 0
  v += stat(item, 'FlatHPPoolMod') * 0.05
  v += stat(item, 'FlatArmorMod') * 0.4
  v += stat(item, 'FlatSpellBlockMod') * 0.4
  return v * tankMult
}

export interface ScoreParams {
  champion: DDragonChampion
  ownedIds: Set<number>
  gold: number
  items: Record<string, DDragonItem>
  threats: LiveThreatAnalysis | null
  self: LivePlayer | null
  mapId: number
}

/** Rank the best next purchases for a champion from live state. */
export function recommendByScore({
  champion,
  ownedIds,
  gold,
  items,
  threats,
  self,
  mapId,
}: ScoreParams): BuildRec[] {
  const p = profile(champion)
  // Items consumed into what you own, or made unbuildable by a one-per-inventory
  // conflict (e.g. a second Tear item) — excluded from every suggestion below.
  const blocked = unavailableItems(ownedIds, items)
  const cond = threats?.activeConditions ?? new Set<string>()
  const mapKey = String(mapId)
  const deaths = self?.scores.deaths ?? 0
  const kills = self?.scores.kills ?? 0
  const behind = deaths >= 5 && deaths > kills + 2

  // Count owned offensive items so we don't over-stack one spike too early.
  let ownedDamageItems = 0
  for (const id of ownedIds) {
    const it = items[String(id)]
    if (it && (p.isAP ? isAPItem(it) : isADItem(it)) && !has(it, 'Boots')) ownedDamageItems++
  }

  interface Scored {
    item: DDragonItem
    id: number
    score: number
    reasons: string[]
    urgent: boolean
  }
  const scored: Scored[] = []

  for (const [idStr, item] of Object.entries(items)) {
    const id = Number(idStr)
    if (ownedIds.has(id) || blocked.has(id)) continue
    // Special-mode variants (Arena/Swarm) carry inflated ids; real items are low.
    if (id >= 40000) continue
    if (!item.gold.purchasable || item.gold.total < 1800) continue
    if (item.maps[mapKey] === false) continue
    if (item.into && item.into.length > 0) continue // components/boots handled elsewhere
    if (has(item, 'Boots') || has(item, 'Consumable') || has(item, 'Trinket')) continue
    if (has(item, 'Jungle') || has(item, 'GoldPer')) continue

    // Damage-type gate: skip off-type damage items (AP item on an AD champ, etc.)
    // unless they're primarily defensive/utility.
    const offType = p.isAP ? isADItem(item) && !isAPItem(item) : isAPItem(item) && !isADItem(item)
    if (offType && !isPureDefensive(item)) continue

    const reasons: string[] = []
    let score = damageValue(item, p) + defensiveValue(item, p)
    if (score > 0 && (isADItem(item) || isAPItem(item))) reasons.push('core damage')
    let urgent = false

    // --- Situational bonuses from live enemy state ---
    // Tank Grievous items (Thornmail/Hollow Radiance) only for actual tanks and
    // juggernauts; squishies/assassins get the on-damage Grievous instead.
    const grievous = p.isAP ? GRIEVOUS_AP : GRIEVOUS_AD
    const tankyChamp = p.isTank || (p.isFighter && !p.isAssassin)
    const grievousMatch = grievous.has(id) || (tankyChamp && GRIEVOUS_TANK.has(id))
    if (cond.has('enemy_has_healing') && grievousMatch) {
      score += 120
      urgent = true
      reasons.push('anti-heal')
    }
    if (cond.has('enemy_heavy_ap') && isMR(item)) {
      score += 55
      reasons.push('vs AP')
    }
    if (cond.has('enemy_heavy_ad') && isArmor(item)) {
      score += 55
      reasons.push('vs AD')
    }
    if (cond.has('enemy_has_tanks')) {
      const penTag = p.isAP ? 'MagicPenetration' : 'ArmorPenetration'
      if (has(item, penTag) || PERCENT_HP.has(id)) {
        score += 70
        urgent = true
        reasons.push('vs tanks')
      }
    }
    if (cond.has('enemy_heavy_cc') && (has(item, 'Tenacity') || CLEANSE.has(id))) {
      score += 45
      if (p.isMarksman || p.isAP) reasons.push('vs CC')
    }
    if (behind && DEFENSIVE_ACTIVES.has(id)) {
      score += 60
      urgent = true
      reasons.push('survivability')
    }

    // Diminishing returns: mild penalty for piling a 3rd+ damage item before
    // any defense, so the build doesn't go all-glass by default.
    if ((isADItem(item) || isAPItem(item)) && ownedDamageItems >= 3 && isPureDefensive(item) === false) {
      score -= 25
    }

    if (score <= 0) continue
    scored.push({ item, id, score, reasons, urgent })
  }

  scored.sort((a, b) => b.score - a.score)

  // Dedupe by display name (some items ship multiple ids for the same item).
  const seenNames = new Set<string>()
  const dedupedScored = scored.filter((s) => {
    if (seenNames.has(s.item.name)) return false
    seenNames.add(s.item.name)
    return true
  })

  const recs: BuildRec[] = []
  const pushRec = (s: Scored) => {
    const cost = s.item.gold.total
    recs.push({
      itemId: s.id,
      name: s.item.name,
      cost,
      priority: s.urgent ? 'urgent' : recs.length === 0 ? 'recommended' : 'planned',
      reason: s.reasons.join(' · ') || 'strong item for your kit',
      affordable: gold >= cost,
      goldNeeded: Math.max(0, Math.ceil(cost - gold)),
      source: s.urgent ? 'situational' : 'core',
    })
  }

  // Urgent anti-heal: if healing is active and you can't afford a full Grievous
  // item, rush the cheap component instead.
  if (cond.has('enemy_has_healing')) {
    const cheapId = p.isAP ? CHEAP_GRIEVOUS_AP : CHEAP_GRIEVOUS_AD
    const cheap = items[String(cheapId)]
    const topGrievousAffordable = dedupedScored.some(
      (s) => s.reasons.includes('anti-heal') && gold >= s.item.gold.total,
    )
    if (cheap && !ownedIds.has(cheapId) && !blocked.has(cheapId) && !topGrievousAffordable) {
      recs.push({
        itemId: cheapId,
        name: cheap.name,
        cost: cheap.gold.total,
        priority: 'urgent',
        reason: 'anti-heal (rush the cheap component now)',
        affordable: gold >= cheap.gold.total,
        goldNeeded: Math.max(0, Math.ceil(cheap.gold.total - gold)),
        source: 'situational',
      })
    }
  }

  for (const s of dedupedScored.slice(0, 6)) pushRec(s)

  // Boots suggestion if none owned yet.
  const hasBoots = [...ownedIds].some((id) => items[String(id)]?.tags.includes('Boots'))
  if (!hasBoots) {
    let bootId = BOOTS.default
    let reason = 'boots for mobility'
    if (cond.has('enemy_heavy_ap') || cond.has('enemy_heavy_cc')) {
      bootId = BOOTS.apCc
      reason = 'Mercury’s — vs AP/CC'
    } else if (cond.has('enemy_heavy_ad')) {
      bootId = BOOTS.ad
      reason = 'Steelcaps — vs AD'
    } else if (p.isMarksman) {
      bootId = BOOTS.attackSpeed
      reason = 'Berserker’s — attack speed'
    } else if (p.isAP) {
      bootId = BOOTS.ability
      reason = 'Sorcerer’s — magic pen'
    } else {
      bootId = BOOTS.cdr
      reason = 'Ionian — ability haste'
    }
    const boot = items[String(bootId)]
    if (boot && !ownedIds.has(bootId) && !blocked.has(bootId)) {
      recs.unshift({
        itemId: bootId,
        name: boot.name,
        cost: boot.gold.total,
        priority: 'recommended',
        reason,
        affordable: gold >= boot.gold.total,
        goldNeeded: Math.max(0, Math.ceil(boot.gold.total - gold)),
        source: 'core',
      })
    }
  }

  // Urgent items first, then keep the list glanceable.
  const rank = { urgent: 0, recommended: 1, planned: 2 } as const
  recs.sort((a, b) => {
    if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority]
    if (a.affordable !== b.affordable) return a.affordable ? -1 : 1
    return a.cost - b.cost
  })
  return recs.slice(0, 6)
}
