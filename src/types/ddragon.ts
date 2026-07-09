// Types for Riot's Data Dragon static data CDN.

export interface DDragonChampion {
  version: string
  id: string // "Vayne"
  key: string // "67"
  name: string
  title: string // "the Night Hunter"
  blurb: string
  info: {
    attack: number
    defense: number
    magic: number
    difficulty: number
  }
  image: DDragonImage
  tags: string[] // ["Marksman", "Assassin"]
  partype: string // "Mana"
  stats: Record<string, number>
}

export interface DDragonImage {
  full: string
  sprite: string
  group: string
  x: number
  y: number
  w: number
  h: number
}

export interface DDragonChampionList {
  type: string
  format: string
  version: string
  data: Record<string, DDragonChampion>
}

export interface DDragonItem {
  name: string
  description: string
  colloq: string
  plaintext: string
  into?: string[]
  from?: string[]
  specialRecipe?: number // base item id this transforms from (e.g. Muramana←Manamune)
  image: DDragonImage
  gold: {
    base: number
    purchasable: boolean
    total: number
    sell: number
  }
  tags: string[]
  maps: Record<string, boolean>
  stats: Record<string, number>
  depth?: number
}

export interface DDragonItemList {
  type: string
  version: string
  basic: DDragonItem
  data: Record<string, DDragonItem>
  groups: Array<{ id: string; MaxGroupOwnable: string }>
  tree: Array<{ header: string; tags: string[] }>
}

export interface DDragonRune {
  id: number
  key: string
  icon: string
  name: string
  shortDesc?: string
  longDesc?: string
}

export interface DDragonRuneSlot {
  runes: DDragonRune[]
}

export interface DDragonRunePath {
  id: number
  key: string
  icon: string
  name: string
  slots: DDragonRuneSlot[]
}
