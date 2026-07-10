# LoL Build Coach

A Riot-compliant build optimization tool for League of Legends: pre-game build
recommendations, lightweight live economic tracking, and post-game build analysis.

> LoL Build Coach isn't endorsed by Riot Games. League of Legends and Riot Games
> are trademarks or registered trademarks of Riot Games, Inc.

## Features

- **Build** (`/`) — pick your game mode (Summoner's Rift or ARAM), champion, and
  role (SR only), optionally enter the enemy team, and get a full recommendation:
  starters, core build order, boots, situational items (highlighted when the
  enemy comp calls for them), rune page, skill order, and matchup notes.
  Champion/item/rune data comes live from Data Dragon and is cached in
  localStorage per patch.
  - **Counter-pick suggestions** (SR): once you've entered the enemy team, the
    page suggests champions per role whose kit exploits that comp's weaknesses
    (armor stackers vs AD-heavy, %-health shredders vs tanks, assassins vs
    squishy backlines, tenacity/mobility vs heavy CC, innate anti-heal vs
    sustain). Click a suggestion to build it. These are explainable heuristics
    from comp attributes — **not** statistical matchup data (that needs the
    Phase 3 backend). Suggestions with a full seeded build show a "Build" badge.
  - **Champ-select auto-fill**: with the LCU bridge running (see below), the page
    reads your live draft from the League client and fills your champion, role,
    and the enemy team automatically as picks lock in.
- **Live** (`/live`) — polls the local Live Client Data API
  (`https://127.0.0.1:2999`) every 5s while in game (10s while idle), and detects
  the mode from the running game. Shows your gold, KDA, CS/min, inventory, and
  build-path progress with purchase timestamps. When you can complete your next
  item it shows a recall banner on SR, or "buy on your next respawn" in ARAM.
  - **Build Next** — an adaptive item builder that ranks your next purchases and
    reacts to what enemies *actually bought*: anti-heal jumps to "Buy now" the
    moment an enemy completes healing, armor pen promotes against armor stackers,
    and a defensive item is suggested if you're dying repeatedly. For champions
    with a seeded build it promotes situational items into that path; for any
    other champion it falls back to the **scoring engine** (below), so *every*
    champion gets live itemization.
  - **Enemy Threats** — each enemy's champion, level, items, and a one-line
    counter note. Uses only scoreboard-visible data (what TAB shows) from Riot's
    documented local API — no fog-of-war info. Strictly read-only.
  - Append `?mock=1` to `/live` or `/overlay` for a fixture with a full enemy
    comp, to explore the views without a running game.
- **Review** (`/review`) — the match analysis engine scores your build
  efficiency (0–100) using mode-appropriate gold pacing, compares your item
  timings against projected targets, and generates coaching tips. Automatic match
  import needs the Phase 3 backend + Riot API key; until then use the SR or ARAM
  demo match, or paste match JSON.

## Stack

React 19 · TypeScript (strict) · Vite · Tailwind CSS 4 · Zustand · TanStack
Query · React Router 7. No backend required for the current phase.

## Running

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production bundle
```

### Live tracker & WSL2

The Live Client Data API only exists on the machine running the game, over HTTPS
with a self-signed cert. The Vite dev server proxies `/liveclientdata` to
`https://127.0.0.1:2999` (see `vite.config.ts`), which handles both the cert and
CORS.

If you run the dev server inside WSL2 but the game on Windows, WSL's `127.0.0.1`
won't reach the game client in NAT mode (the default) — and Riot binds the API to
Windows loopback only, so the WSL→Windows gateway IP can't reach it either. Two
options that work:

**Option A (Windows 11 22H2+ only, one-time):** enable mirrored networking.
(On Windows 10 WSL silently ignores this and stays on NAT — use Option B.) In
`C:\Users\<you>\.wslconfig` add:

```ini
[wsl2]
networkingMode=mirrored
```

then run `wsl --shutdown` from Windows and reopen your terminal. With mirrored
networking, `127.0.0.1` inside WSL reaches Windows loopback services directly —
no other config needed.

**Option B (works on Windows 10):** forward a port on the Windows side (admin
PowerShell), which exposes the loopback-bound API to WSL. The listen port must
NOT be 2999 — a 2999→2999 forward binds the port before the game can and breaks
the API entirely:

```powershell
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=23999 connectaddress=127.0.0.1 connectport=2999
New-NetFirewallRule -DisplayName "LoL Live Client from WSL" -Direction Inbound -LocalPort 23999 -Protocol TCP -Action Allow
```

then just start the dev server:

```bash
npm run dev
```

`npm run dev` runs `scripts/dev.mjs`, which detects WSL and automatically points
both the live-game and champ-select proxies at the Windows host gateway on the
forward ports (`23999`/`23998`) and binds Vite with `--host` so the Windows-side
overlay can reach it. It prints the targets on startup. Any of `LIVE_CLIENT_HOST`,
`LIVE_CLIENT_PORT`, `LCU_HOST`, `LCU_PORT` you set yourself are respected; use
`npm run dev:plain` for a bare `vite` with no auto-config. (Option A / mirrored
networking needs none of this — the auto-detected gateway still works, or use
`dev:plain`.)

If the forward was created while a game was already running, start a new game —
the API only binds its port at game launch.

Easiest test path: Practice Tool — the API is live the moment you load in.

## Champ-select auto-fill (LCU)

The Build page can read your **live draft** from the League *client* — your locked
champion + assigned role and each enemy pick as it's revealed — and auto-fill the
form (which then drives the counter-picks). This uses the LCU API, exposed by the
client on a random local HTTPS port with a password (both in a "lockfile").

`lcu-bridge/` is a tiny Node service (deployed to `C:\Users\Eric\lol-lcu-bridge`)
that reads the lockfile, authenticates to the LCU, and re-serves a simplified,
CORS-open `/champ-select` payload on a fixed port the dev server can proxy to. It
is **read-only** — it only reads champ-select/summoner/gameflow; it never sends
picks, bans, or dodges to the client.

One-time WSL networking (Windows 10, same portproxy pattern as the game):

```powershell
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=23998 connectaddress=127.0.0.1 connectport=2998
New-NetFirewallRule -DisplayName "LoL Build Coach LCU Bridge Proxy" -Direction Inbound -LocalPort 23998 -Protocol TCP -Action Allow
```

Then, on Windows, run `C:\Users\Eric\lol-lcu-bridge\launch-bridge.bat` (or
`launch-windows-helpers.bat` to start the bridge **and** the overlay together).
Leave it running; it idles until the client is open. Enter champ select and the
Build page shows a green "Champ Select connected" banner and fills itself in.
Append `?mockcs=1` to the Build page to preview the flow without a live draft.

Note: enemy hovers are hidden by Riot until a pick locks (in most queues), so
enemies populate as they lock, not on hover.

## In-game overlay

`overlay/` contains a tiny Electron shell (deployed to `C:\Users\Eric\lol-overlay`
with portable Node at `C:\Users\Eric\node-v24.18.0-win-x64`) that renders the
app's `/overlay` route in a transparent, always-on-top, click-through window —
a separate OS window drawn above the game, never injected into it.

- Launch: run `C:\Users\Eric\lol-overlay\launch-overlay.bat` on Windows (the WSL
  dev server must be running). Set `OVERLAY_URL` to override the page URL;
  append `?mock=1` for fixture data without a game.
- Move it: press and hold the **left mouse button on the grip** (the dotted tab
  at the top of the card) and drag — the window follows and its position is
  remembered across launches. The grip is grabbable any time; only that tiny grip
  is solid, so the rest of the overlay stays click-through and never blocks the
  game or the Tab scoreboard.
- Hotkeys: `Ctrl+Shift+O` pin the whole overlay interactive (click/scroll it),
  `Ctrl+Shift+H` hide/show, `Ctrl+Shift+Q` quit.
- League must be in **Borderless** or Windowed mode (Settings → Video) —
  exclusive Fullscreen draws over everything.
- Preview it without a game: `npm run overlay:shot -- --champ Ahri` renders
  `/overlay?mock=1` with the running dev server and writes a PNG (uses the
  Windows-side Edge/Chrome headless; WSL + Windows only).

The overlay (and the `/live` page) shows **enemy items and counter-itemization
reads** driven by what enemies actually bought — armor stacking lights up % pen,
lifesteal purchases light up anti-heal, and so on. This uses only
scoreboard-visible data (what TAB already shows) from Riot's documented local
API — no fog-of-war information.

## Game modes

Ranked and normal Summoner's Rift share the same builds — queue type doesn't
matter. ARAM is a first-class mode:

- Mode toggle on the Build page (no role picker in ARAM — builds are per champion)
- Separate ARAM seed builds with mode-appropriate itemization (e.g. AP poke
  Malphite, no jungle/support starters)
- Mode-specific economy in the analysis engine (`src/lib/modes.ts`): 1,400
  starting gold and faster income on the Abyss, plus ARAM-adjusted CS and boots
  expectations
- Items are filtered by Data Dragon's per-map validity flags, so anything
  disabled on the Howling Abyss never shows in an ARAM build
- The Live tracker detects the mode by **map**, not the mode string: the Howling
  Abyss (map 12) means ARAM, so normal ARAM, ARAM Mayhem, ARAM Clash, and any
  future Abyss event are all recognized regardless of the event's `gameMode`
  string (with a substring fallback if the map is unavailable). In ARAM the
  recall banner becomes "buy on your next respawn"
- Limited-time ARAM variants (Mayhem etc.) ride on the ARAM support — same map
  and API surface. Their mutators make builds approximations, but the economy,
  item filtering, and threat reads are correct

## Seeded builds (MVP)

SR: Vayne (ADC), Malphite (TOP), Lulu (SUPPORT), Lee Sin (JUNGLE), Ahri (MID) —
plus ARAM builds for the same five champions — in `src/data/builds.ts`. All item
and rune IDs are validated against the live patch; unknown IDs degrade gracefully
in the UI. Add more builds by appending to `BUILD_PATHS`.

## Scoring engine (`src/lib/scoring.ts`)

Riot doesn't publish "the meta build" anywhere machine-readable, so the seeded
builds are hand-authored — but you can't hand-author all ~170 champions. The
scoring engine fills the gap: it computes a live build for **any** champion from
data we already have.

Each poll it scores every valid legendary from Data Dragon:

- **Damage profile** — AD vs AP inferred from champion tags + `info`, so it only
  offers on-type items (no AP items for an AD champ).
- **Base value** — from the item's `stats`/`tags`, weighted by class (crit for
  marksmen, lethality for assassins, resistances for tanks, etc.).
- **Situational bonuses from live enemy state** — magic resist vs AP, armor vs
  AD, **Grievous Wounds vs healing** (rushing the cheap component when gold is
  tight), armor/magic pen and %-max-health vs tanks, tenacity/cleanse vs heavy
  CC, and survivability items when you're dying/behind.
- **Diminishing returns** so it doesn't stack pure glass, plus a threat-matched
  boots pick.

Effects that tags don't capture (anti-heal, %-max-health, cleanse, defensive
actives) are small curated ID sets, validated against the live patch. Preview it
for any champion with `?mock=1&champ=<Name>` on `/live` (e.g.
`/live?mock=1&champ=Nocturne`). This is heuristic itemization; real
challenger-aggregated builds are the Phase 3 layer.

## Aggregated builds (`scripts/aggregate-builds.mjs`)

The "pro build" base layer (Phase 3, in progress). An **offline** script turns
high-elo Match-V5 data into per-(champion, role) `BuildPath` rows — the same
shape the seeds use — so the adaptive engine adjusts them case-by-case just like
a seed. No standing backend: it runs locally with a Riot **dev key** and writes
`src/data/aggregatedBuilds.json`, which is bundled and consulted by `findBuild`
**after** the hand-authored seeds and **before** the scoring engine.

```bash
cp .env.example .env          # then paste your key from developer.riotgames.com
npm run aggregate -- --region na1 --matches 300
```

It pulls Challenger/GM/Master ladders → their ranked matches → each match +
timeline (timeline gives purchase *order* and skill order), then takes the modal
starters/core/boots/runes/skills per champion+role. Requests are serialized and
rate-limited for a dev key (100 req / 2 min); matches are cached under `.cache/`
so reruns are cheap. Flags: `--tiers`, `--per-player`, `--min-sample`, `--out`.
Add `--dry-run` to preview sample builds from already-cached matches (instant,
no key, no Riot calls) — or a small live pull if the cache is empty — without
writing the file. A good first look: `npm run aggregate -- --dry-run`.

**Multiple regions + ARAM.** `--region` takes a comma list (`--region na1,kr,euw1`);
matches from every region are pooled into one merged dataset (each match is
routed to its correct regional cluster, so mixed-region pools just work), with
`--matches` applied per region. `--include-cached` folds already-cached matches
(e.g. a prior region's run) into the pool without re-fetching. `--mode aram`
ingests queue 450 into a separate per-champion `aggregatedBuildsAram.json` (ARAM
has no roles); the loader merges SR + ARAM and `findBuild` serves each by mode,
so ARAM/Mayhem get real win-rate builds instead of pure heuristics.

**Refreshing per patch.** The data is patch-specific, so re-run the aggregator
when a new patch ships. `--if-stale` makes that cheap: it no-ops if the output
was already built for the current patch, otherwise runs — so
`npm run aggregate -- --if-stale` is safe to run any time. `npm run dev` also
checks on startup and prints a one-line heads-up when a new patch is out and the
data is stale (non-blocking; a full refresh is a ~10–80 min job depending on
`--matches`, so it nudges rather than auto-runs — and your dev key needs to be
current in `.env`).

**Comp-conditioned situationals (Phase 2):** for each build it also computes
which items high-elo players buy *notably more often* against a given enemy-comp
attribute — e.g. Void Staff at 83% vs tank comps against a 46% baseline — and
emits them as `situationalItems` tagged with the same `SituationalCondition` the
live threat engine produces. So the adaptive engine promotes them in-game with
no extra wiring: it's the data-driven version of the hand-authored seed
situationals. Thresholds are conservative, so thin ingests emit few and degrade
to seed behaviour. `findBuild` prefers an aggregated build over a seed once it
clears a confidence bar (`PREFER_AGGREGATED_SAMPLE`); below it, the seed wins.
Re-run each patch.

## Augment tier list (`/augments`)

Arena / ARAM Mayhem augment win-rates, shown as a ranked reference grouped by
rarity. Two offline steps, both keyed off the numeric augment id that Match-V5's
`playerAugmentN` fields use:

```bash
npm run augments:meta                                   # metadata (no key)
npm run aggregate:augments -- --region na1 --matches 500 # win-rates (dev key)
```

- `augments:meta` pulls augment names/icons/rarity from Community Dragon (augments
  aren't in Data Dragon) → `src/data/augments.json`.
- `aggregate:augments` tallies augment strength from Arena (queue 1700) matches by
  **average team placement** (1–8, lower is better) and first-place rate →
  `src/data/augmentStats.json` (global) and `src/data/augmentChampStats.json`
  (per-champion pairs that clear `--champ-min-games`, default 8). It ranks by
  placement, not `win` — Arena sets `win` unreliably for non-1st teams.

It's a **static** reference by design: the Live Client API doesn't expose which
augments you're being offered, so this can't be a live "pick this now" helper.
All files lazy-load, so they stay out of the initial bundle. Re-run each patch.

**Overlay augment goals (ARAM Mayhem):** in augmented Abyss games the overlay
adds an **Augment Goals** section — the highest win-rate augments *for your
champion* (champion-specific rows bright, global fills dim), so when the pick
screen appears you take one of these or reroll. Detected as map 12 with a
`gameMode` other than plain `ARAM`; regular ARAM stays uncluttered. Preview it
with `npm run overlay:shot -- --champ Nasus --mayhem` (or `?mock=1&mayhem=1` on
`/overlay`). Win-rates come from Arena — the only mode whose Match-V5 data
carries augments — as a proxy for Mayhem's shared augment pool.

## Roadmap status (per spec)

- ✅ Phase 1 — Pre-game build advisor (champion search, role, enemy comp
  analysis, build/rune/skill display)
- ✅ Phase 2 — Live economic tracker (polling hook, dashboard, build progress,
  purchase recommendation, recall alert)
- 🟡 Phase 3 — Post-game review: analysis engine + UI done; Express/PostgreSQL
  backend and Riot Match-V5 import for *automatic match import* still to build
  (requires a Riot developer API key from https://developer.riotgames.com).
  Challenger-aggregated builds — the other thing this phase would power — now
  have a first cut via the **offline** `scripts/aggregate-builds.mjs` (above),
  which feeds `findBuild` directly without a standing backend.

## Compliance notes

- Read-only: never sends input to the game client
- Local Live Client data only, polled well under Riot's rate guidance
- Riot assets are hot-linked from the Data Dragon CDN, never redistributed
- Attribution/disclaimer shown in the app footer
