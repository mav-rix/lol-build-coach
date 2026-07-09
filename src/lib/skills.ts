const MAX_POINTS: Record<string, number> = { Q: 5, W: 5, E: 5, R: 3 }
const ULT_LEVELS = new Set([6, 11, 16])

/** Parse "Q > W > E" into ["Q", "W", "E"]. */
export function parseMaxOrder(skillMaxOrder: string): string[] {
  return skillMaxOrder
    .split('>')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => ['Q', 'W', 'E'].includes(s))
}

/**
 * Generate a typical 18-level skill sequence from a max-order priority:
 * one point in each basic skill by level 3 (starting with skillStart),
 * R at 6/11/16, otherwise highest-priority skill that can still be leveled.
 */
export function skillSequence(skillMaxOrder: string, skillStart?: string): string[] {
  const priority = parseMaxOrder(skillMaxOrder)
  if (priority.length !== 3) return []

  const start = skillStart?.toUpperCase()
  const early =
    start && priority.includes(start)
      ? [start, ...priority.filter((s) => s !== start)]
      : [...priority]

  const points: Record<string, number> = { Q: 0, W: 0, E: 0, R: 0 }
  const sequence: string[] = []

  for (let level = 1; level <= 18; level++) {
    let pick: string | undefined
    if (ULT_LEVELS.has(level)) {
      pick = 'R'
    } else if (level <= 3) {
      pick = early[level - 1]
    } else {
      // Basic skill rank cap: ceil(level / 2), matching in-game rules.
      pick = priority.find(
        (s) => points[s] < MAX_POINTS[s] && points[s] < Math.ceil(level / 2),
      )
    }
    if (!pick) pick = priority.find((s) => points[s] < MAX_POINTS[s]) ?? 'Q'
    points[pick]++
    sequence.push(pick)
  }
  return sequence
}
