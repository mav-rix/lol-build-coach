import type {
  LiveAllGameData,
  LiveFullRunes,
  LivePlayer,
  LivePlayerItem,
} from '@/types/live'

// Fixture for developing/screenshotting the live views without a running game.
// Activate with ?mock=1 on /live or /overlay.

function mkItem(itemID: number, slot: number): LivePlayerItem {
  return {
    canUse: false,
    consumable: false,
    count: 1,
    displayName: `Item ${itemID}`,
    itemID,
    price: 0,
    rawDescription: '',
    rawDisplayName: '',
    slot,
  }
}

const RUNES: LiveFullRunes = {
  generalRunes: [],
  keystone: {
    displayName: 'Press the Attack',
    id: 8005,
    rawDescription: '',
    rawDisplayName: '',
  },
  primaryRuneTree: { displayName: 'Precision', id: 8000, rawDescription: '', rawDisplayName: '' },
  secondaryRuneTree: { displayName: 'Sorcery', id: 8200, rawDescription: '', rawDisplayName: '' },
  statRunes: [],
}

function mkPlayer(
  champion: string,
  displayName: string,
  team: 'ORDER' | 'CHAOS',
  level: number,
  itemIds: number[],
  position = '',
): LivePlayer {
  return {
    championName: displayName,
    isBot: false,
    isDead: false,
    items: itemIds.map((id, i) => mkItem(id, i)),
    level,
    position,
    rawChampionName: `game_character_displayname_${champion}`,
    respawnTimer: 0,
    runes: RUNES,
    scores: { assists: 4, creepScore: level * 14, deaths: 2, kills: 3, wardScore: 8 },
    skinID: 0,
    summonerName: `${displayName}Player`,
    summonerSpells: {
      summonerSpellOne: { displayName: 'Flash', rawDescription: '', rawDisplayName: '' },
      summonerSpellTwo: { displayName: 'Heal', rawDescription: '', rawDisplayName: '' },
    },
    team,
  }
}

export const MOCK_LIVE: LiveAllGameData = {
  activePlayer: {
    abilities: {
      Passive: { abilityLevel: 0, displayName: 'Night Hunter', id: '', rawDescription: '', rawDisplayName: '' },
      Q: { abilityLevel: 5, displayName: 'Tumble', id: '', rawDescription: '', rawDisplayName: '' },
      W: { abilityLevel: 3, displayName: 'Silver Bolts', id: '', rawDescription: '', rawDisplayName: '' },
      E: { abilityLevel: 1, displayName: 'Condemn', id: '', rawDescription: '', rawDisplayName: '' },
      R: { abilityLevel: 1, displayName: 'Final Hour', id: '', rawDescription: '', rawDisplayName: '' },
    },
    championStats: {
      abilityPower: 0, armor: 52, armorPenetrationFlat: 0, armorPenetrationPercent: 0,
      attackDamage: 138, attackRange: 550, attackSpeed: 1.42,
      bonusArmorPenetrationPercent: 0, bonusMagicPenetrationPercent: 0,
      cooldownReduction: 0, critChance: 0, critDamage: 175, currentHealth: 1240,
      healthRegenRate: 3.2, lifeSteal: 0.08, magicLethality: 0, magicPenetrationFlat: 0,
      magicPenetrationPercent: 0, magicResist: 34, maxHealth: 1610, moveSpeed: 385,
      physicalLethality: 0, resourceMax: 480, resourceRegenRate: 1.6,
      resourceType: 'MANA', resourceValue: 310, spellVamp: 0, tenacity: 0,
    },
    currentGold: 2430,
    fullRunes: RUNES,
    level: 10,
    summonerName: 'VaynePlayer',
  },
  allPlayers: [
    // Your team (ORDER)
    mkPlayer('Vayne', 'Vayne', 'ORDER', 10, [1055, 3006, 3153], 'BOTTOM'),
    mkPlayer('Lulu', 'Lulu', 'ORDER', 9, [3865, 3158], 'UTILITY'),
    mkPlayer('Ahri', 'Ahri', 'ORDER', 10, [1056, 3020, 6655], 'MIDDLE'),
    mkPlayer('LeeSin', 'Lee Sin', 'ORDER', 9, [1102, 3047, 6692], 'JUNGLE'),
    mkPlayer('Malphite', 'Malphite', 'ORDER', 10, [1054, 3047, 3068], 'TOP'),
    // Enemy team (CHAOS): tanky + healer + lethality + CC pair
    mkPlayer('Garen', 'Garen', 'CHAOS', 11, [3047, 3068, 3075], 'TOP'),
    mkPlayer('Amumu', 'Amumu', 'CHAOS', 9, [3111, 3068], 'JUNGLE'),
    mkPlayer('Zed', 'Zed', 'CHAOS', 10, [3814, 6692, 3111], 'MIDDLE'),
    mkPlayer('MissFortune', 'Miss Fortune', 'CHAOS', 10, [3006, 6673, 3072], 'BOTTOM'),
    mkPlayer('Soraka', 'Soraka', 'CHAOS', 9, [3158, 3107, 6617], 'UTILITY'),
  ],
  events: { Events: [] },
  gameData: {
    gameMode: 'CLASSIC',
    gameTime: 923,
    mapName: 'Map11',
    mapNumber: 11,
    mapTerrain: 'Default',
  },
}

// Preview the scored-build path with an unseeded champion (?mock=1&champ=Nocturne).
export function mockLiveFor(championId: string): LiveAllGameData {
  const clone = structuredClone(MOCK_LIVE)
  const self = clone.allPlayers.find(
    (p) => p.summonerName === clone.activePlayer.summonerName,
  )
  if (self) {
    self.championName = championId
    self.rawChampionName = `game_character_displayname_${championId}`
    self.items = [] // empty inventory so full recommendations show
  }
  return clone
}
