import { HEALERS, HEAVY_CC } from '@/lib/situational'
import type { SituationalCondition } from '@/types/app'
import type { DDragonChampion, DDragonItem } from '@/types/ddragon'
import type { LiveAllGameData, LivePlayer } from '@/types/live'

// Everything here reads only scoreboard-visible data (the same items you see
// pressing TAB), served by Riot's documented local Live Client Data API.

export interface EnemyThreat {
  championId: string // Data Dragon id when resolvable ("MonkeyKing"), else raw name
  championName: string // display name
  level: number
  itemIds: number[]
  goldValue: number // total gold of held items — rough "how fed" signal
  note: string | null // counter-itemization hint
}

export interface LiveThreatAnalysis {
  enemies: EnemyThreat[]
  activeConditions: Set<SituationalCondition>
  notes: string[] // team-level itemization reads
}

const EMPTY: LiveThreatAnalysis = {
  enemies: [],
  activeConditions: new Set(['general']),
  notes: [],
}

export function championIdFromRaw(rawChampionName: string): string {
  return rawChampionName.replace('game_character_displayname_', '')
}

/** A "real" purchase worth reasoning about (not a component, ward, or potion). */
function isMajorItem(item: DDragonItem): boolean {
  return item.gold.total >= 2000
}

function countTag(
  enemyItems: DDragonItem[],
  predicate: (item: DDragonItem) => boolean,
): number {
  return enemyItems.filter(predicate).length
}

export function analyzeThreats(
  live: LiveAllGameData,
  self: LivePlayer | null,
  items: Record<string, DDragonItem>,
  championsById: Record<string, DDragonChampion>,
): LiveThreatAnalysis {
  if (!self) return EMPTY
  const enemyPlayers = live.allPlayers.filter((p) => p.team !== self.team)
  if (enemyPlayers.length === 0) return EMPTY

  const activeConditions = new Set<SituationalCondition>(['general'])
  const notes: string[] = []

  const allEnemyMajorItems: DDragonItem[] = []
  const enemies: EnemyThreat[] = enemyPlayers.map((p) => {
    const championId = championIdFromRaw(p.rawChampionName)
    const held = p.items
      .map((it) => ({ id: it.itemID, data: items[String(it.itemID)] }))
      .filter((x) => x.data !== undefined)
    const majors = held.filter((x) => isMajorItem(x.data!)).map((x) => x.data!)
    allEnemyMajorItems.push(...majors)
    return {
      championId,
      championName: p.championName,
      level: p.level,
      itemIds: held.map((x) => x.id),
      goldValue: held.reduce((sum, x) => sum + (x.data!.gold.total ?? 0), 0),
      note: threatNote(majors),
    }
  })

  // --- Team-level reads from what they actually bought ---
  const armorItems = countTag(allEnemyMajorItems, (i) => i.tags.includes('Armor'))
  const mrItems = countTag(allEnemyMajorItems, (i) => i.tags.includes('SpellBlock'))
  const apItems = countTag(allEnemyMajorItems, (i) => i.tags.includes('SpellDamage'))
  const adItems = countTag(
    allEnemyMajorItems,
    (i) => i.tags.includes('Damage') && !i.tags.includes('SpellDamage'),
  )
  const healItems = countTag(
    allEnemyMajorItems,
    (i) => i.tags.includes('LifeSteal') || i.tags.includes('SpellVamp'),
  )

  const enemyChampions = enemies
    .map((e) => championsById[e.championId])
    .filter((c): c is DDragonChampion => c !== undefined)
  const healerChamps = enemies.filter((e) => HEALERS.has(e.championId))
  const ccChamps = enemies.filter((e) => HEAVY_CC.has(e.championId))
  const tankChamps = enemyChampions.filter((c) => c.tags.includes('Tank'))
  const mageChamps = enemyChampions.filter((c) => c.tags.includes('Mage'))

  if (armorItems >= 3 || mrItems >= 3 || tankChamps.length >= 2) {
    activeConditions.add('enemy_has_tanks')
    if (armorItems >= 3) notes.push(`${armorItems} armor items on their team — % armor pen pays off`)
    if (mrItems >= 3) notes.push(`${mrItems} MR items on their team — magic pen pays off`)
  }
  if (healItems >= 2 || healerChamps.length >= 1) {
    activeConditions.add('enemy_has_healing')
    notes.push(
      healItems >= 2
        ? `${healItems} lifesteal/vamp items bought — anti-heal is high value now`
        : `Healing from ${healerChamps.map((e) => e.championName).join(', ')} — buy anti-heal`,
    )
  }
  if (apItems >= 3 || mageChamps.length >= 3) {
    activeConditions.add('enemy_heavy_ap')
    notes.push(`Heavy AP (${Math.max(apItems, mageChamps.length)} sources) — MR item valuable`)
  }
  if (adItems >= 3) {
    activeConditions.add('enemy_heavy_ad')
    notes.push(`${adItems} AD items across their team — armor valuable`)
  }
  if (ccChamps.length >= 2) {
    activeConditions.add('enemy_heavy_cc')
    notes.push(`Heavy CC (${ccChamps.map((e) => e.championName).join(', ')}) — tenacity/cleanse valuable`)
  }

  return { enemies, activeConditions, notes }
}

/** One-line counter hint for a single enemy based on their biggest purchases. */
function threatNote(majors: DDragonItem[]): string | null {
  if (majors.length === 0) return null
  const has = (tag: string) => majors.some((i) => i.tags.includes(tag))
  if (has('ArmorPenetration')) return 'Stacking armor pen — raw armor loses value, consider HP/GA'
  if (has('MagicPenetration')) return 'Building magic pen — HP beats flat MR against them'
  if (has('LifeSteal') || has('SpellVamp')) return 'Sustain-heavy — anti-heal cuts them down'
  if (has('CriticalStrike')) return 'Crit spike — Randuin’s-type effects are strong'
  if (has('SpellDamage')) return 'AP damage growing — MR shard/item helps'
  if (has('Armor') && has('Health')) return 'Tanking up — % health / pen damage recommended'
  return null
}
