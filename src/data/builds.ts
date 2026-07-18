import { PREFER_AGGREGATED_SAMPLE, findAggregatedBuild } from '@/data/aggregatedBuilds'
import type { BuildPath, GameMode, Role } from '@/types/app'

// MVP seed data — the Week 1 champions from the spec. Item/rune IDs resolve
// against live Data Dragon; unknown IDs (removed in a future patch) are
// skipped gracefully by the UI.
export const BUILD_PATHS: BuildPath[] = [
  {
    id: 1,
    championId: 'Vayne',
    mode: 'SR',
    role: 'ADC',
    patch: 'seed',
    starterItems: [1055, 2003],
    coreItems: [3153, 3124, 3031], // Blade of the Ruined King → Guinsoo's → Infinity Edge
    situationalItems: [
      { itemId: 3036, condition: 'enemy_has_tanks', description: 'Lord Dominik’s vs. 2+ tanks' },
      { itemId: 3033, condition: 'enemy_has_healing', description: 'Mortal Reminder vs. strong healing' },
      { itemId: 3072, condition: 'general', description: 'Bloodthirster for sustain and shield' },
      { itemId: 3026, condition: 'general', description: 'Guardian Angel vs. dive threats' },
      { itemId: 3139, condition: 'enemy_heavy_cc', description: 'Quicksilver vs. hard CC chains' },
      { itemId: 3091, condition: 'enemy_heavy_ap', description: 'Wit’s End vs. heavy AP' },
    ],
    bootsOptions: [3006, 3111],
    primaryPathId: 8000,
    keystoneId: 8005, // Press the Attack
    primaryRuneIds: [9111, 9104, 8014],
    secondaryPathId: 8200,
    secondaryRuneIds: [8234, 8236],
    statRuneIds: [5005, 5008, 5011],
    skillMaxOrder: 'Q > W > E',
    skillStart: 'Q',
    notes: [
      'Rush Mortal Reminder components early vs. Soraka or Yuumi.',
      'Blade of the Ruined King spike at ~3100g wins most 1v1s.',
      'Save Tumble (Q) to dodge key abilities, not just for damage.',
    ],
    winRate: 51.2,
    sampleSize: 15400,
  },
  {
    id: 2,
    championId: 'Malphite',
    mode: 'SR',
    role: 'TOP',
    patch: 'seed',
    starterItems: [1054, 2003],
    coreItems: [3068, 3110, 3075], // Sunfire → Frozen Heart → Thornmail
    situationalItems: [
      { itemId: 3065, condition: 'enemy_heavy_ap', description: 'Spirit Visage vs. heavy AP' },
      { itemId: 3083, condition: 'general', description: 'Warmog’s for sustain when ahead on HP items' },
      { itemId: 3742, condition: 'general', description: 'Dead Man’s Plate for roam/engage speed' },
      { itemId: 3143, condition: 'enemy_heavy_ad', description: 'Randuin’s vs. crit-stacking carries' },
      { itemId: 3193, condition: 'general', description: 'Gargoyle Stoneplate when you’re the only frontline' },
      { itemId: 4401, condition: 'enemy_heavy_ap', description: 'Force of Nature vs. sustained magic damage' },
    ],
    bootsOptions: [3047, 3111],
    primaryPathId: 8400,
    keystoneId: 8437, // Grasp of the Undying
    primaryRuneIds: [8446, 8429, 8451],
    secondaryPathId: 8300,
    secondaryRuneIds: [8345, 8347],
    statRuneIds: [5008, 5008, 5001],
    skillMaxOrder: 'Q > E > W',
    skillStart: 'Q',
    notes: [
      'Vs. AD tops, rush cloth armor and spam Q to poke — you win on armor stacking.',
      'Look for R flanks after 6; your ult is the team’s win condition.',
      'Frozen Heart timing matters vs. attack-speed junglers.',
    ],
    winRate: 52.8,
    sampleSize: 12100,
  },
  {
    id: 3,
    championId: 'Lulu',
    mode: 'SR',
    role: 'SUPPORT',
    patch: 'seed',
    starterItems: [3865, 2003],
    coreItems: [6617, 3504, 6616], // Moonstone → Ardent Censer → Staff of Flowing Water
    situationalItems: [
      { itemId: 3107, condition: 'general', description: 'Redemption for teamfight sustain' },
      { itemId: 3222, condition: 'enemy_heavy_cc', description: 'Mikael’s vs. catch/CC comps' },
      { itemId: 2065, condition: 'general', description: 'Shurelya’s for engage/disengage speed' },
      { itemId: 3190, condition: 'general', description: 'Locket vs. burst AoE comps' },
    ],
    bootsOptions: [3158],
    primaryPathId: 8200,
    keystoneId: 8214, // Summon Aery
    primaryRuneIds: [8226, 8210, 8237],
    secondaryPathId: 8400,
    secondaryRuneIds: [8453, 8444],
    statRuneIds: [5008, 5008, 5011],
    skillMaxOrder: 'E > W > Q',
    skillStart: 'E',
    notes: [
      'Track your ADC’s all-in windows — Wild Growth (R) + Ardent turns them into a raid boss.',
      'Use W (polymorph) reactively on divers, not proactively.',
      'Poke with E-shield on minions? No — hold E for your carry vs. burst.',
    ],
    winRate: 52.1,
    sampleSize: 18800,
  },
  {
    id: 4,
    championId: 'LeeSin',
    mode: 'SR',
    role: 'JUNGLE',
    patch: 'seed',
    starterItems: [1102, 2003],
    coreItems: [6692, 6610, 3071], // Eclipse → Sundered Sky → Black Cleaver
    situationalItems: [
      { itemId: 3814, condition: 'enemy_heavy_cc', description: 'Edge of Night vs. pick comps' },
      { itemId: 6694, condition: 'enemy_has_tanks', description: 'Serylda’s Grudge vs. armor stackers' },
      { itemId: 3053, condition: 'general', description: 'Sterak’s Gage for extended fights' },
      { itemId: 3026, condition: 'general', description: 'Guardian Angel when you’re the win condition' },
    ],
    bootsOptions: [3047, 3111],
    primaryPathId: 8000,
    keystoneId: 8010, // Conqueror
    primaryRuneIds: [9111, 9104, 8299],
    secondaryPathId: 8100,
    secondaryRuneIds: [8143, 8135],
    statRuneIds: [5008, 5005, 5011],
    skillMaxOrder: 'Q > W > E',
    skillStart: 'Q',
    notes: [
      'Your power peaks pre-20 minutes — force plays early or fall off.',
      'Ward-hop (W) escapes are budgeted: always keep one ward for exits.',
      'InSec kicks win fights, but a plain R on the carry is usually better.',
    ],
    winRate: 49.6,
    sampleSize: 22300,
  },
  {
    id: 5,
    championId: 'Ahri',
    mode: 'SR',
    role: 'MID',
    patch: 'seed',
    starterItems: [1056, 2003],
    coreItems: [6655, 4645, 3089], // Luden's → Shadowflame → Rabadon's
    situationalItems: [
      { itemId: 3135, condition: 'enemy_has_tanks', description: 'Void Staff vs. MR stackers' },
      { itemId: 3157, condition: 'enemy_heavy_ad', description: 'Zhonya’s vs. AD assassins/divers' },
      { itemId: 3102, condition: 'enemy_heavy_ap', description: 'Banshee’s vs. pick/burst AP' },
      { itemId: 3165, condition: 'enemy_has_healing', description: 'Morellonomicon vs. strong healing' },
      { itemId: 3116, condition: 'general', description: 'Rylai’s for kiting and lockdown' },
    ],
    bootsOptions: [3020],
    primaryPathId: 8100,
    keystoneId: 8112, // Electrocute
    primaryRuneIds: [8139, 8137, 8135], // Taste of Blood, Sixth Sense, Treasure Hunter
    secondaryPathId: 8000,
    secondaryRuneIds: [8009, 8014],
    statRuneIds: [5008, 5008, 5011],
    skillMaxOrder: 'Q > W > E',
    skillStart: 'Q',
    notes: [
      'Charm (E) into full combo one-shots squishies after two items.',
      'Use R charges to dodge, not only to engage — you have three.',
      'Push and roam: Ahri’s wave-clear funds bot-lane plays.',
    ],
    winRate: 50.9,
    sampleSize: 26700,
  },

  // ---- ARAM seeds. 1400 starting gold, no roles, no recall — buy on death. ----
  {
    id: 101,
    championId: 'Vayne',
    mode: 'ARAM',
    role: null,
    patch: 'seed',
    starterItems: [1055, 1036], // Doran's Blade + Long Sword from the 1400g start
    coreItems: [3153, 3124, 3072], // BotRK → Guinsoo's → Bloodthirster (BT shield > IE in poke fests)
    situationalItems: [
      { itemId: 3036, condition: 'enemy_has_tanks', description: 'Lord Dominik’s vs. 2+ tanks' },
      { itemId: 3033, condition: 'enemy_has_healing', description: 'Mortal Reminder vs. sustain comps' },
      { itemId: 3091, condition: 'enemy_heavy_ap', description: 'Wit’s End vs. heavy AP' },
      { itemId: 3139, condition: 'enemy_heavy_cc', description: 'Quicksilver vs. hard CC chains' },
      { itemId: 3046, condition: 'general', description: 'Phantom Dancer for kiting speed' },
    ],
    bootsOptions: [3006],
    primaryPathId: 8000,
    keystoneId: 8005,
    primaryRuneIds: [9111, 9104, 8014],
    secondaryPathId: 8200,
    secondaryRuneIds: [8234, 8236],
    statRuneIds: [5005, 5008, 5011],
    skillMaxOrder: 'Q > W > E',
    skillStart: 'Q',
    notes: [
      'You are the backline win condition — hug your frontline, never face-check.',
      'Lifesteal matters more than on the Rift: constant poke, no recall to heal.',
      'Condemn (E) into walls is a kill in ARAM’s narrow corridor.',
    ],
  },
  {
    id: 102,
    championId: 'Malphite',
    mode: 'ARAM',
    role: null,
    patch: 'seed',
    starterItems: [1056], // Doran's Ring — AP poke Malphite is the ARAM pick
    coreItems: [6655, 3089, 3135], // Luden's → Rabadon's → Void Staff
    situationalItems: [
      { itemId: 3157, condition: 'enemy_heavy_ad', description: 'Zhonya’s vs. AD burst' },
      { itemId: 3102, condition: 'enemy_heavy_ap', description: 'Banshee’s vs. AP pick' },
      { itemId: 4645, condition: 'general', description: 'Shadowflame vs. squishy comps' },
      { itemId: 3068, condition: 'general', description: 'Sunfire pivot if your team needs a frontline' },
    ],
    bootsOptions: [3020],
    primaryPathId: 8200,
    keystoneId: 8229, // Arcane Comet — lands off Q poke
    primaryRuneIds: [8226, 8210, 8237],
    secondaryPathId: 8300,
    secondaryRuneIds: [8345, 8347],
    statRuneIds: [5008, 5008, 5011],
    skillMaxOrder: 'Q > E > W',
    skillStart: 'Q',
    notes: [
      'Full AP: Q chunks half a health bar; R one-shots squishies.',
      'You’re a mage until 6, then an assassin with a map-wide threat circle.',
      'If your team is all squishy, swap to the tank pivot instead.',
    ],
  },
  {
    id: 103,
    championId: 'Lulu',
    mode: 'ARAM',
    role: null,
    patch: 'seed',
    starterItems: [1056], // no support quest item in ARAM — Doran's Ring start
    coreItems: [6617, 3504, 6616],
    situationalItems: [
      { itemId: 3107, condition: 'general', description: 'Redemption — constant teamfights, constant value' },
      { itemId: 3222, condition: 'enemy_heavy_cc', description: 'Mikael’s vs. catch/CC comps' },
      { itemId: 2065, condition: 'general', description: 'Shurelya’s for engage/disengage speed' },
      { itemId: 3190, condition: 'general', description: 'Locket vs. burst AoE comps' },
    ],
    bootsOptions: [3158],
    primaryPathId: 8200,
    keystoneId: 8214,
    primaryRuneIds: [8226, 8210, 8237],
    secondaryPathId: 8400,
    secondaryRuneIds: [8453, 8444],
    statRuneIds: [5008, 5008, 5011],
    skillMaxOrder: 'E > Q > W',
    skillStart: 'Q',
    notes: [
      'Poke with Q early — mana regen on the Abyss keeps it nearly free.',
      'Every fight is 5v5: hold R for the first champion who gets collapsed on.',
      'Max E second here (unlike SR) — shields beat polymorph in nonstop poke.',
    ],
  },
  {
    id: 104,
    championId: 'LeeSin',
    mode: 'ARAM',
    role: null,
    patch: 'seed',
    starterItems: [1055, 1036], // no jungle pet in ARAM
    coreItems: [6692, 6610, 6333], // Eclipse → Sundered Sky → Death's Dance
    situationalItems: [
      { itemId: 6694, condition: 'enemy_has_tanks', description: 'Serylda’s Grudge vs. armor stackers' },
      { itemId: 3814, condition: 'enemy_heavy_cc', description: 'Edge of Night vs. pick comps' },
      { itemId: 3053, condition: 'general', description: 'Sterak’s Gage for extended fights' },
      { itemId: 3156, condition: 'enemy_heavy_ap', description: 'Maw vs. AP burst' },
    ],
    bootsOptions: [3047, 3111],
    primaryPathId: 8000,
    keystoneId: 8010,
    primaryRuneIds: [9111, 9104, 8299],
    secondaryPathId: 8100,
    secondaryRuneIds: [8143, 8135],
    statRuneIds: [5008, 5005, 5011],
    skillMaxOrder: 'Q > W > E',
    skillStart: 'Q',
    notes: [
      'Melee skirmisher is rough in ARAM poke — look for Q picks on cooldown.',
      'W-shield allies constantly; it’s your main value between engages.',
      'A good kick into your team is worth more than a kill steal.',
    ],
  },
  {
    id: 105,
    championId: 'Ahri',
    mode: 'ARAM',
    role: null,
    patch: 'seed',
    starterItems: [1056, 2003],
    coreItems: [6655, 4645, 3089],
    situationalItems: [
      { itemId: 3135, condition: 'enemy_has_tanks', description: 'Void Staff vs. MR stackers' },
      { itemId: 3157, condition: 'enemy_heavy_ad', description: 'Zhonya’s vs. AD assassins' },
      { itemId: 3102, condition: 'enemy_heavy_ap', description: 'Banshee’s vs. pick/burst AP' },
      { itemId: 3165, condition: 'enemy_has_healing', description: 'Morellonomicon — sustain is everywhere in ARAM' },
      { itemId: 3116, condition: 'general', description: 'Rylai’s for kiting and lockdown' },
    ],
    bootsOptions: [3020],
    primaryPathId: 8100,
    keystoneId: 8112,
    primaryRuneIds: [8139, 8137, 8135],
    secondaryPathId: 8000,
    secondaryRuneIds: [8009, 8014],
    statRuneIds: [5008, 5008, 5011],
    skillMaxOrder: 'Q > W > E',
    skillStart: 'Q',
    notes: [
      'Q spam through the whole enemy team is free gold on the Abyss.',
      'Charm a face-checker into your team — picks decide ARAM.',
      'R aggressively; the fight resets fast enough that charges come back.',
    ],
  },
]

export function findBuild(
  championId: string,
  role: Role | null | undefined,
  mode: GameMode = 'SR',
) {
  // Priority: high-confidence aggregated build → hand-authored seed →
  // low-confidence aggregated build → (caller falls back to the scoring engine
  // when this returns null). A confident aggregated build (Phase 2: real
  // current-patch data + comp-conditioned situationals) supersedes a seed;
  // below the confidence bar the seed's hand-tuned situationals win.
  const aggregated = findAggregatedBuild(championId, role, mode)
  // A high-sample aggregated build supersedes a seed only when it's an actual
  // build path — an aggregation that fell apart into 1–2 core items reads as
  // broken next to a hand-tuned six-slot seed, however many games back it.
  if (
    aggregated &&
    (aggregated.sampleSize ?? 0) >= PREFER_AGGREGATED_SAMPLE &&
    aggregated.coreItems.length >= 3
  )
    return aggregated

  const inMode = BUILD_PATHS.filter(
    (b) => b.championId === championId && b.mode === mode,
  )
  const seed =
    mode === 'ARAM'
      ? (inMode[0] ?? null)
      : (inMode.find((b) => b.role === role) ?? inMode[0] ?? null)
  if (seed) return seed

  return aggregated
}
