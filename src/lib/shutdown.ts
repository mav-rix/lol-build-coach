import patch from '@/data/patch.json'

/**
 * End-of-life state for the project.
 *
 * The app's bundled build/rune/augment data is generated per patch and then
 * frozen at whatever patch the last release shipped on. Nothing about that
 * expires on its own: without this module the app keeps presenting patch-26.15
 * recommendations with total confidence years later, which is the same failure
 * we kept hitting in the aggregators — stale data wearing a current label.
 *
 * So the app measures its own staleness against live Data Dragon (already
 * fetched for champion/item art, so this costs no extra request) and says how
 * far behind it is, escalating as the gap grows.
 */

/** Date the project stopped being maintained. Shown verbatim in the notice. */
export const SHUTDOWN_DATE = '9 August 2026'

/** Where people can still read the code / grab the last build. */
export const PROJECT_URL = 'https://github.com/mav-rix/lol-build-coach'

/** The League patch the bundled data was generated on, e.g. "26.15". */
export const DATA_PATCH = patch.leaguePatch

export type StalenessLevel = 'current' | 'aging' | 'stale' | 'ancient'

export interface Staleness {
  level: StalenessLevel
  /** Patches elapsed since the data was generated; null when not comparable. */
  patchesBehind: number | null
  /** Live patch in display form ("26.18"), or null if Data Dragon is unknown. */
  livePatch: string | null
  /** One-line plain-English summary of the gap. */
  summary: string
}

/**
 * Riot's public patch number is the internal major + 10 — internal 16.15 is
 * public 26.15 (see scripts/fetch-augments.mjs, which stamps patch.json).
 * Data Dragon reports the internal form, so it needs converting before it can
 * be compared with anything the UI shows.
 */
function toDisplayPatch(ddragonVersion: string): { major: number; minor: number } | null {
  const m = ddragonVersion.match(/^(\d+)\.(\d+)/)
  if (!m) return null
  return { major: Number(m[1]) + 10, minor: Number(m[2]) }
}

function parseDisplayPatch(p: string): { major: number; minor: number } | null {
  const m = p.match(/^(\d+)\.(\d+)/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]) }
}

/**
 * How far the bundled data has fallen behind the live game.
 *
 * Across a season boundary the gap deliberately isn't quantified: a major
 * doesn't have a fixed number of patches, so subtracting minors would invent a
 * number. "A season or more" is the honest answer, and by then the exact count
 * doesn't change what anyone should do about it.
 */
export function computeStaleness(ddragonVersion: string | null | undefined): Staleness {
  const data = parseDisplayPatch(DATA_PATCH)
  const live = ddragonVersion ? toDisplayPatch(ddragonVersion) : null

  if (!live || !data) {
    return {
      level: 'aging',
      patchesBehind: null,
      livePatch: null,
      summary: `Built for patch ${DATA_PATCH}. Couldn't reach Data Dragon to check the live patch.`,
    }
  }

  const livePatch = `${live.major}.${live.minor}`

  if (live.major !== data.major) {
    const behindBySeason = live.major > data.major
    return {
      level: behindBySeason ? 'ancient' : 'current',
      patchesBehind: null,
      livePatch,
      summary: behindBySeason
        ? `Live is patch ${livePatch}; this data is from ${DATA_PATCH} — a season or more out of date.`
        : `Built for patch ${DATA_PATCH}; live is ${livePatch}.`,
    }
  }

  const behind = live.minor - data.minor
  if (behind <= 0) {
    return {
      level: 'current',
      patchesBehind: 0,
      livePatch,
      summary: `Data matches the live patch (${livePatch}).`,
    }
  }

  const level: StalenessLevel = behind >= 6 ? 'ancient' : behind >= 3 ? 'stale' : 'aging'
  return {
    level,
    patchesBehind: behind,
    livePatch,
    summary:
      `Live is patch ${livePatch}; this data is from ${DATA_PATCH} — ` +
      `${behind} patch${behind === 1 ? '' : 'es'} behind.`,
  }
}

/** What the user should actually do about it, per level. */
export const ADVICE: Record<StalenessLevel, string> = {
  current: 'Recommendations should still be accurate.',
  aging: 'Items and runes change every patch — double-check anything that looks off.',
  stale: 'Several patches of item and rune changes are missing. Treat every build as a rough starting point, not current advice.',
  ancient:
    'These builds are far enough out of date that items in them may no longer exist. Use a maintained site instead.',
}
