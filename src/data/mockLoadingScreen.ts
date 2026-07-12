import type { LoadingScreenState } from '@/hooks/useLoadingScreen'

// Fixture for developing the loading-screen panel without a live game.
// Activate with ?mockload=1 on the /overlay route. Numeric keys are Data
// Dragon champion keys. Includes the interesting cases: hot streak, cold
// streak, unranked, apex tier (no division), and self-highlight.
export const MOCK_LOADING_SCREEN: LoadingScreenState = {
  available: true,
  phase: 'GameStart',
  show: true,
  windowMode: 0, // Fullscreen — exercises the warning banner; set 2 to hide it
  myTeam: [
    {
      championId: 266, // Aatrox
      name: 'TopOrFeed',
      isSelf: false,
      rank: { tier: 'GOLD', division: 'II' },
      streak: null,
      recent: { wins: 5, losses: 5 },
    },
    {
      championId: 64, // Lee Sin
      name: 'JGL Diff',
      isSelf: false,
      rank: { tier: 'PLATINUM', division: 'IV' },
      streak: { kind: 'hot', count: 4 },
      recent: { wins: 7, losses: 3 },
    },
    {
      championId: 103, // Ahri
      name: 'Eric',
      isSelf: true,
      rank: { tier: 'GOLD', division: 'I' },
      streak: null,
      recent: { wins: 6, losses: 4 },
    },
    {
      championId: 22, // Ashe
      name: 'ArrowMachine',
      isSelf: false,
      rank: null,
      streak: null,
      recent: { wins: 4, losses: 6 },
    },
    {
      championId: 412, // Thresh
      name: 'HookCity',
      isSelf: false,
      rank: { tier: 'SILVER', division: 'I' },
      streak: { kind: 'cold', count: 3 },
      recent: { wins: 3, losses: 7 },
    },
  ],
  enemyTeam: [
    {
      championId: 86, // Garen
      name: 'SpinToWin',
      isSelf: false,
      rank: { tier: 'GOLD', division: 'III' },
      streak: null,
      recent: { wins: 5, losses: 5 },
    },
    {
      championId: 421, // Rek'Sai
      name: 'Tunnel Vision',
      isSelf: false,
      rank: { tier: 'EMERALD', division: 'IV' },
      streak: null,
      recent: { wins: 6, losses: 4 },
    },
    {
      championId: 238, // Zed
      name: 'ShadowClone',
      isSelf: false,
      rank: { tier: 'MASTER', division: '' },
      streak: { kind: 'hot', count: 6 },
      recent: { wins: 8, losses: 2 },
    },
    {
      championId: 51, // Caitlyn
      name: 'HeadshotHer',
      isSelf: false,
      rank: { tier: 'GOLD', division: 'IV' },
      streak: null,
      recent: { wins: 5, losses: 5 },
    },
    {
      championId: 111, // Nautilus
      name: 'AnchorDrop',
      isSelf: false,
      rank: { tier: 'BRONZE', division: 'I' },
      streak: { kind: 'cold', count: 5 },
      recent: { wins: 2, losses: 8 },
    },
  ],
}
