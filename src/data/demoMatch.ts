import type { MatchInput } from '@/types/app'

// A realistic Vayne ADC game used to demo the analysis engine without a
// backend / Riot API key. Matches the seeded Vayne build path.
export const DEMO_MATCH: MatchInput = {
  championId: 'Vayne',
  mode: 'SR',
  role: 'ADC',
  actualBuild: [
    { itemId: 1055, gameTime: 0, goldAtTime: 500 },
    { itemId: 3006, gameTime: 490, goldAtTime: 1350 },
    { itemId: 3153, gameTime: 800, goldAtTime: 3300 },
    { itemId: 3124, gameTime: 1400, goldAtTime: 6500 },
    { itemId: 3031, gameTime: 2100, goldAtTime: 10400 },
  ],
  stats: {
    duration: 2245, // 37:25
    result: 'WIN',
    kills: 9,
    deaths: 4,
    assists: 7,
    cs: 262,
    damageDealt: 31450,
    goldEarned: 14830,
  },
}

// An Ahri ARAM game — faster income, shorter game, higher deaths, low CS.
export const DEMO_MATCH_ARAM: MatchInput = {
  championId: 'Ahri',
  mode: 'ARAM',
  actualBuild: [
    { itemId: 1056, gameTime: 0, goldAtTime: 1400 },
    { itemId: 3020, gameTime: 240, goldAtTime: 2900 },
    { itemId: 6655, gameTime: 360, goldAtTime: 5100 },
    { itemId: 4645, gameTime: 700, goldAtTime: 8600 },
    { itemId: 3089, gameTime: 1180, goldAtTime: 13100 },
  ],
  stats: {
    duration: 1420, // 23:40
    result: 'WIN',
    kills: 12,
    deaths: 7,
    assists: 19,
    cs: 88,
    damageDealt: 41200,
    goldEarned: 16900,
  },
}
