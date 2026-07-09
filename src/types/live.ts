// Types for the Live Client Data API (https://127.0.0.1:2999).
// Read-only, local-machine data about your own running game.

export interface LiveAbility {
  abilityLevel: number
  displayName: string
  id: string
  rawDescription: string
  rawDisplayName: string
}

export interface LiveAbilities {
  E: LiveAbility
  Passive: LiveAbility
  Q: LiveAbility
  R: LiveAbility
  W: LiveAbility
}

export interface LiveChampionStats {
  abilityPower: number
  armor: number
  armorPenetrationFlat: number
  armorPenetrationPercent: number
  attackDamage: number
  attackRange: number
  attackSpeed: number
  bonusArmorPenetrationPercent: number
  bonusMagicPenetrationPercent: number
  cooldownReduction: number
  critChance: number
  critDamage: number
  currentHealth: number
  healthRegenRate: number
  lifeSteal: number
  magicLethality: number
  magicPenetrationFlat: number
  magicPenetrationPercent: number
  magicResist: number
  maxHealth: number
  moveSpeed: number
  physicalLethality: number
  resourceMax: number
  resourceRegenRate: number
  resourceType: string
  resourceValue: number
  spellVamp: number
  tenacity: number
}

export interface LiveRune {
  displayName: string
  id: number
  rawDescription: string
  rawDisplayName: string
}

export interface LiveRuneTree {
  displayName: string
  id: number
  rawDescription: string
  rawDisplayName: string
}

export interface LiveStatRune {
  id: number
  rawDescription: string
}

export interface LiveFullRunes {
  generalRunes: LiveRune[]
  keystone: LiveRune
  primaryRuneTree: LiveRuneTree
  secondaryRuneTree: LiveRuneTree
  statRunes: LiveStatRune[]
}

export interface LiveActivePlayer {
  abilities: LiveAbilities
  championStats: LiveChampionStats
  currentGold: number
  fullRunes: LiveFullRunes
  level: number
  summonerName: string
}

export interface LivePlayerItem {
  canUse: boolean
  consumable: boolean
  count: number
  displayName: string
  itemID: number
  price: number
  rawDescription: string
  rawDisplayName: string
  slot: number
}

export interface LiveScores {
  assists: number
  creepScore: number
  deaths: number
  kills: number
  wardScore: number
}

export interface LiveSummonerSpell {
  displayName: string
  rawDescription: string
  rawDisplayName: string
}

export interface LivePlayer {
  championName: string
  isBot: boolean
  isDead: boolean
  items: LivePlayerItem[]
  level: number
  position: string // "TOP" | "JUNGLE" | "MIDDLE" | "BOTTOM" | "UTILITY"
  rawChampionName: string
  rawSkinName?: string
  respawnTimer: number
  runes?: Partial<LiveFullRunes>
  scores: LiveScores
  skinID: number
  skinName?: string
  summonerName: string
  summonerSpells: {
    summonerSpellOne: LiveSummonerSpell
    summonerSpellTwo: LiveSummonerSpell
  }
  team: string // "ORDER" (blue) | "CHAOS" (red)
}

export interface LiveEvent {
  EventID: number
  EventName: string
  EventTime: number
  Assisters?: string[]
  KillerName?: string
  VictimName?: string
  DragonType?: string
  Acer?: string
  AcingTeamName?: string
  InhibKilled?: string
  TurretKilled?: string
}

export interface LiveEvents {
  Events: LiveEvent[]
}

export interface LiveGameData {
  gameMode: string // "CLASSIC", "ARAM", ...
  gameTime: number // seconds
  mapName: string
  mapNumber: number
  mapTerrain: string
}

export interface LiveAllGameData {
  activePlayer: LiveActivePlayer
  allPlayers: LivePlayer[]
  events: LiveEvents
  gameData: LiveGameData
}
