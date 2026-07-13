import type { BridgeChampSelect } from '@/hooks/useChampSelect'

// Fixture for developing the champ-select auto-fill + ranked-draft panel
// without a live draft. Activate with ?mockcs=1 on the Build page. Numeric keys
// are Data Dragon champion keys: 67 Vayne (self, ADC); ally hovers 92 Riven,
// 64 Lee Sin, 517 Sylas, 117 Lulu (an all-carry comp missing frontline);
// enemies 86 Garen, 122 Darius, 32 Amumu, 21 Miss Fortune, 16 Soraka.
export const MOCK_CHAMP_SELECT: BridgeChampSelect = {
  clientOpen: true,
  phase: 'ChampSelect',
  inChampSelect: true,
  queueId: 420, // Ranked Solo/Duo
  selfRank: { tier: 'GOLD', division: 'II' },
  self: { cellId: 0, championId: 67, role: 'ADC', position: 'bottom' },
  myTeam: [
    { cellId: 0, championId: 67, position: 'bottom', role: 'ADC' },
    { cellId: 1, championId: 92, position: 'top', role: 'TOP' },
    { cellId: 2, championId: 64, position: 'jungle', role: 'JUNGLE' },
    { cellId: 3, championId: 517, position: 'middle', role: 'MID' },
    { cellId: 4, championId: 117, position: 'utility', role: 'SUPPORT' },
  ],
  theirTeam: [],
  enemyChampionKeys: [86, 122, 32, 21, 16],
  bans: [238, 157], // Zed, Yasuo
}
