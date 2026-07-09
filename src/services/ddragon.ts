import type {
  DDragonChampion,
  DDragonChampionList,
  DDragonItem,
  DDragonItemList,
  DDragonRunePath,
} from '@/types/ddragon'

const DDRAGON = 'https://ddragon.leagueoflegends.com'
const VERSION_CACHE_KEY = 'ddragon:version'
const VERSION_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

export interface StaticData {
  patch: string
  champions: DDragonChampion[] // sorted by name
  championsById: Record<string, DDragonChampion>
  items: Record<string, DDragonItem>
  runes: DDragonRunePath[]
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json() as Promise<T>
}

export async function fetchLatestVersion(): Promise<string> {
  const cached = localStorage.getItem(VERSION_CACHE_KEY)
  if (cached) {
    try {
      const { version, fetchedAt } = JSON.parse(cached) as {
        version: string
        fetchedAt: number
      }
      if (Date.now() - fetchedAt < VERSION_TTL_MS) return version
    } catch {
      localStorage.removeItem(VERSION_CACHE_KEY)
    }
  }
  const versions = await fetchJson<string[]>(`${DDRAGON}/api/versions.json`)
  const version = versions[0]
  localStorage.setItem(
    VERSION_CACHE_KEY,
    JSON.stringify({ version, fetchedAt: Date.now() }),
  )
  return version
}

function cacheGet<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    localStorage.removeItem(key)
    return null
  }
}

function cacheSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage full — data still works from memory this session
  }
}

async function fetchCachedByPatch<T>(patch: string, name: string): Promise<T> {
  const key = `ddragon:${patch}:${name}`
  const cached = cacheGet<T>(key)
  if (cached) return cached
  const data = await fetchJson<T>(
    `${DDRAGON}/cdn/${patch}/data/en_US/${name}.json`,
  )
  cacheSet(key, data)
  return data
}

export async function loadStaticData(): Promise<StaticData> {
  const patch = await fetchLatestVersion()
  const [championList, itemList, runes] = await Promise.all([
    fetchCachedByPatch<DDragonChampionList>(patch, 'champion'),
    fetchCachedByPatch<DDragonItemList>(patch, 'item'),
    fetchCachedByPatch<DDragonRunePath[]>(patch, 'runesReforged'),
  ])
  const champions = Object.values(championList.data).sort((a, b) =>
    a.name.localeCompare(b.name),
  )
  return {
    patch,
    champions,
    championsById: championList.data,
    items: itemList.data,
    runes,
  }
}

// ---- CDN URL builders (assets are linked, never redistributed) ----

export const championIconUrl = (patch: string, championId: string) =>
  `${DDRAGON}/cdn/${patch}/img/champion/${championId}.png`

export const championSplashUrl = (championId: string) =>
  `${DDRAGON}/cdn/img/champion/splash/${championId}_0.jpg`

export const itemIconUrl = (patch: string, itemId: number) =>
  `${DDRAGON}/cdn/${patch}/img/item/${itemId}.png`

export const runeIconUrl = (iconPath: string) =>
  `${DDRAGON}/cdn/img/${iconPath}`
