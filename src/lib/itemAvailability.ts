import type { DDragonItem } from '@/types/ddragon'

// Given what you already own, some items are pointless or impossible to buy —
// not just exact duplicates. This computes that "don't recommend" set so the
// live Build Next engines (builder.ts, scoring.ts) stop suggesting dead items:
//
//   1. Components already consumed into an owned item — you've built past them.
//      (`from`/`into` are inverses, so this also covers "builds into something
//      you already own", e.g. don't suggest B.F. Sword once you have Infinity Edge.)
//   2. The base of a transformed item you own (Muramana ⇒ Manamune) — you
//      effectively already have it, so its base shouldn't be recommended.
//   3. Mutually-exclusive families: League caps some component groups at one per
//      inventory (DDragon's MaxGroupOwnable=1). Own any item built from such an
//      anchor and every *other* item in that family becomes unbuildable — e.g.
//      buy Manamune and Archangel's/Seraph's/Winter's are off the table (they'd
//      need a second Tear). DDragon doesn't put group membership on the item
//      objects, so we key off the shared anchor component instead.

type Items = Record<string, DDragonItem>

// One-per-inventory anchor components (MaxGroupOwnable=1 groups):
//   3070 Tear of the Goddess — Manamune / Archangel's / Winter's / Fimbulwinter
//   1001 Boots of Speed      — every pair of completed boots descends from it
const EXCLUSIVE_ANCHOR_COMPONENTS = [3070, 1001]

const toIds = (list: string[] | undefined): number[] => (list ?? []).map(Number)

/** baseItemId → the item it transforms into via specialRecipe (Manamune → Muramana). */
function buildUpgradeMap(items: Items): Map<number, number> {
  const upgrades = new Map<number, number>()
  for (const [idStr, it] of Object.entries(items)) {
    if (it.specialRecipe) upgrades.set(Number(it.specialRecipe), Number(idStr))
  }
  return upgrades
}

/** Every item consumed into `itemId` — its transitive `from` closure. */
function transitiveComponents(itemId: number, items: Items, acc = new Set<number>()): Set<number> {
  for (const c of toIds(items[String(itemId)]?.from)) {
    if (!acc.has(c)) {
      acc.add(c)
      transitiveComponents(c, items, acc)
    }
  }
  return acc
}

/**
 * The mutual-exclusion family of an anchor: every item built from it, following
 * both the `into` build tree and specialRecipe transforms (so Seraph's, the
 * transformed Archangel's, counts as part of the Tear family).
 */
function anchorFamily(
  anchor: number,
  items: Items,
  upgrades: Map<number, number>,
  acc = new Set<number>(),
): Set<number> {
  for (const child of toIds(items[String(anchor)]?.into)) {
    if (acc.has(child)) continue
    acc.add(child)
    anchorFamily(child, items, upgrades, acc)
    const upgraded = upgrades.get(child)
    if (upgraded !== undefined && !acc.has(upgraded)) {
      acc.add(upgraded)
      anchorFamily(upgraded, items, upgrades, acc)
    }
  }
  return acc
}

/** Item ids that should not be recommended given the current inventory. */
export function unavailableItems(ownedIds: Set<number>, items: Items): Set<number> {
  const blocked = new Set<number>()
  if (ownedIds.size === 0) return blocked

  // Owning a transformed item means you built its base (Muramana ⇒ Manamune).
  const effectivelyOwned = new Set<number>(ownedIds)
  for (const id of ownedIds) {
    const base = items[String(id)]?.specialRecipe
    if (base) {
      effectivelyOwned.add(Number(base))
      blocked.add(Number(base))
    }
  }

  // (1) + (2): components already merged into something you own.
  for (const id of effectivelyOwned) {
    for (const c of transitiveComponents(id, items)) blocked.add(c)
  }

  // (3): one-per-inventory families — own any member, block the rest.
  const upgrades = buildUpgradeMap(items)
  for (const anchor of EXCLUSIVE_ANCHOR_COMPONENTS) {
    const family = anchorFamily(anchor, items, upgrades)
    if ([...effectivelyOwned].some((id) => family.has(id))) {
      for (const member of family) if (!ownedIds.has(member)) blocked.add(member)
    }
  }

  return blocked
}
