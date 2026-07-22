import type { BuildPath } from '@/types/app'
import type { DDragonChampion, DDragonItem, DDragonRunePath } from '@/types/ddragon'

// Import the recommended build into the League client through the LCU bridge
// (/lcu/import-* — electron/server.js in the packaged app, lcu-bridge in dev).
// Two loadout writes: a rune page (replaces the previous "Coach:" page) and a
// per-champion item set the in-game shop shows. Nothing else is touched.

// Everything this app writes into the client is namespaced under this prefix —
// the bridge only ever replaces pages/sets carrying it, and rejects payloads
// without it. Must match COACH_PREFIX in electron/server.js and the bridge.
const COACH_PREFIX = 'Coach:'
// The client caps rune page names at 25 chars.
const RUNE_PAGE_NAME_MAX = 25

export interface ImportOutcome {
  ok: boolean
  message: string
}

const buildLabel = (build: BuildPath) =>
  build.mode === 'ARAM' ? 'ARAM' : (build.role ?? '')

/**
 * A rune page is importable only when every style/rune id still exists on the
 * live patch — seed builds carry ids that may have rotated out, and the client
 * rejects pages with unknown perks. Stat shards (5xxx) aren't in the
 * runesReforged tree and are stable across patches, so they're not checked.
 */
function runePagePayload(build: BuildPath, champion: DDragonChampion, runes: DDragonRunePath[]) {
  const styleIds = new Set(runes.map((p) => p.id))
  const runeIds = new Set(runes.flatMap((p) => p.slots.flatMap((s) => s.runes.map((r) => r.id))))
  const treeRunes = [build.keystoneId, ...build.primaryRuneIds, ...build.secondaryRuneIds]
  if (
    !styleIds.has(build.primaryPathId) ||
    !styleIds.has(build.secondaryPathId) ||
    treeRunes.length !== 6 ||
    !treeRunes.every((id) => runeIds.has(id)) ||
    build.statRuneIds.length !== 3
  ) {
    return null
  }
  return {
    name: `${COACH_PREFIX} ${champion.name} ${buildLabel(build)}`
      .trim()
      .slice(0, RUNE_PAGE_NAME_MAX),
    primaryStyleId: build.primaryPathId,
    subStyleId: build.secondaryPathId,
    selectedPerkIds: [...treeRunes, ...build.statRuneIds],
  }
}

function itemSetPayload(
  build: BuildPath,
  champion: DDragonChampion,
  mapId: number,
  items: Record<string, DDragonItem>,
) {
  const toItems = (ids: number[]) => ids.map((id) => ({ id: String(id), count: 1 }))
  const blocks: { type: string; items: { id: string; count: number }[] }[] = []
  if (build.starterItems.length > 0)
    blocks.push({ type: 'Starter', items: toItems(build.starterItems) })
  // Mirrors the game plan's path: first boots, then the core items in order.
  const core = [...(build.bootsOptions[0] ? [build.bootsOptions[0]] : []), ...build.coreItems]
  if (core.length > 0) blocks.push({ type: 'Core build order', items: toItems(core) })
  // One block per core item listing its components in front of the finished
  // item — the shop's own affordability graying then reads as "buy these
  // next". Items with fewer than two components (boots tiers, epics bought
  // whole) don't earn a block; the set can't update mid-game, so this carries
  // the whole plan's shopping lists up front.
  core.forEach((id, i) => {
    const components = (items[String(id)]?.from ?? []).map(Number)
    if (components.length < 2) return
    const name = items[String(id)]?.name ?? String(id)
    blocks.push({ type: `${i + 1}. ${name} — components`, items: toItems([...components, id]) })
  })
  const situational = [
    ...build.bootsOptions.slice(1),
    ...build.situationalItems.map((s) => s.itemId),
  ]
  if (situational.length > 0)
    blocks.push({ type: 'Situational / alternatives', items: toItems(situational) })
  return {
    title: `${COACH_PREFIX} ${champion.name} ${buildLabel(build)}`.trim(),
    associatedChampions: [Number(champion.key)],
    associatedMaps: [mapId],
    blocks,
  }
}

async function post(pathname: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null
    if (res.ok && json?.ok) return { ok: true }
    return { ok: false, error: json?.error ?? `bridge responded ${res.status}` }
  } catch {
    return { ok: false, error: 'LCU bridge unreachable' }
  }
}

/**
 * Push the build into the client: item set always, rune page when its ids are
 * valid on the live patch. Partial success reports what happened to each half.
 *
 * `skipRunes` forces item-only import for augmented-Abyss events (ARAM Mayhem),
 * which have no rune pages — attempting a rune write there is pointless.
 */
export async function importBuildToClient(
  build: BuildPath,
  champion: DDragonChampion,
  mapId: number,
  runes: DDragonRunePath[],
  items: Record<string, DDragonItem>,
  skipRunes = false,
): Promise<ImportOutcome> {
  if (skipRunes) {
    const itemsResult = await post(
      '/lcu/import-itemset',
      itemSetPayload(build, champion, mapId, items),
    )
    return itemsResult.ok
      ? { ok: true, message: 'Item set imported (no runes — this mode has no rune pages)' }
      : { ok: false, message: `Import failed: ${itemsResult.error}` }
  }
  const runePage = runePagePayload(build, champion, runes)
  const [itemsResult, runesResult] = await Promise.all([
    post('/lcu/import-itemset', itemSetPayload(build, champion, mapId, items)),
    runePage ? post('/lcu/import-runes', runePage) : Promise.resolve(null),
  ])

  if (itemsResult.ok && runesResult?.ok) return { ok: true, message: 'Item set + rune page imported' }
  if (itemsResult.ok && runesResult === null)
    return { ok: true, message: 'Item set imported (runes skipped — outdated rune ids)' }
  if (itemsResult.ok) return { ok: false, message: `Item set imported, runes failed: ${runesResult?.error}` }
  if (runesResult?.ok) return { ok: false, message: `Rune page imported, item set failed: ${itemsResult.error}` }
  return { ok: false, message: `Import failed: ${itemsResult.error}` }
}
