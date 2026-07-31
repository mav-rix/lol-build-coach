import type { DDragonItem } from '@/types/ddragon'

// Arena (mapId 30) remaps every buildable item to a new id: '22' + the base
// SR/ARAM id (e.g. Infinity Edge 3031 → 223031), each carrying its own
// Arena-specific price/stats in Data Dragon. Confirmed live against Data
// Dragon's item.json (patch 16.15.1) — see electron/server.js sibling note in
// scripts/aggregate-builds.mjs for the same rule applied offline.
//
// Ids 220000-220013 are NOT real remapped items — they're synthetic
// shop-slot placeholders (Legendary Fighter/Marksman/Assassin/Mage/Tank/
// Support "generic slot" items, Stat Bonus, Prismatic Item, reroll/anvil
// vouchers, Poro-Snax). They fail the "strip '22', does a real base item
// exist" check below, so no id-range guess or hand-maintained list is needed.

/** The Arena-remapped id for a base SR/ARAM item id. */
export function toArenaItemId(baseId: number): number {
  return Number(`22${baseId}`)
}

/**
 * True iff `id` is a real, buildable Arena item — i.e. it's in the '22'-
 * prefixed range AND stripping that prefix yields an id that exists as a real
 * base item in Data Dragon. Filters out the synthetic 220000-220013 slot/
 * voucher entries without hand-maintaining their id list.
 */
export function isRealArenaItem(id: number, items: Record<string, DDragonItem>): boolean {
  const str = String(id)
  if (!str.startsWith('22')) return false
  const baseId = str.slice(2)
  return baseId.length > 0 && baseId in items
}
