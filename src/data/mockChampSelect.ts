import type { BridgeChampSelect } from '@/hooks/useChampSelect'

// Fixture for developing the champ-select auto-fill without a live draft.
// Activate with ?mockcs=1 on the Build page. Numeric keys are Data Dragon
// champion keys: 67 Vayne (self, ADC), enemies 86 Garen, 122 Darius,
// 32 Amumu, 21 Miss Fortune, 16 Soraka.
export const MOCK_CHAMP_SELECT: BridgeChampSelect = {
  clientOpen: true,
  phase: 'ChampSelect',
  inChampSelect: true,
  self: { championId: 67, role: 'ADC', position: 'bottom' },
  myTeam: [],
  theirTeam: [],
  enemyChampionKeys: [86, 122, 32, 21, 16],
  bans: [238, 157], // Zed, Yasuo
}
