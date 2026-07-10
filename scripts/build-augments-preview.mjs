#!/usr/bin/env node
// Build a standalone HTML preview of the /augments tier list from the bundled
// data (src/data/augments.json + augmentStats.json), with augment icons embedded
// as data URIs so it's fully self-contained (no external requests). Handy for
// sharing the tier list as a single file without running the app.
//
//   node scripts/build-augments-preview.mjs [--top 20] [--out augments-preview.html]
//
// Run `npm run augments:meta && npm run aggregate:augments` first to populate the data.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') ? 'true' : arr[i + 1]])
    return acc
  }, []),
)
const TOP = Number(args.top ?? 20)
const OUT = resolve(args.out ?? join(ROOT, 'augments-preview.html'))

const meta = new Map(
  JSON.parse(readFileSync(join(ROOT, 'src/data/augments.json'), 'utf8')).map((a) => [a.id, a]),
)
const stats = JSON.parse(readFileSync(join(ROOT, 'src/data/augmentStats.json'), 'utf8'))

const ORDER = ['prismatic', 'gold', 'silver']
const RC = { prismatic: '#a78bfa', gold: '#fbbf24', silver: '#a1a1aa' }
const RL = { prismatic: 'Prismatic', gold: 'Gold', silver: 'Silver' }

const joined = stats
  .map((s) => ({ ...s, aug: meta.get(s.id) }))
  .filter((r) => r.aug && ORDER.includes(r.aug.rarity))
const groups = {}
const totals = {}
for (const r of ORDER) {
  const all = joined.filter((x) => x.aug.rarity === r).sort((a, b) => a.avgPlacement - b.avgPlacement)
  totals[r] = all.length
  groups[r] = all.slice(0, TOP)
}

async function icon(url) {
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(String(res.status))
    return `data:image/png;base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  } catch {
    return null
  }
}
for (const r of ORDER) for (const x of groups[r]) x.data = await icon(x.aug.icon)

const STYLE = `<style>
  :root{--bg:#09090b;--panel:#141417;--line:#27272a;--text:#f4f4f5;--muted:#8b8b93;--dim:#5c5c64;--accent:#7dd3fc}
  body{margin:0;background:var(--bg);color:var(--text);
    font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{max-width:760px;margin:0 auto;padding:40px 20px 60px}
  .titlerow{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap}
  h1{margin:0;font-size:22px;font-weight:700;letter-spacing:-.01em;text-wrap:balance}
  .badge{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);
    border:1px solid #164e63;background:#0c2a37;border-radius:999px;padding:3px 9px}
  .lead{max-width:64ch;margin:10px 0 0;color:var(--muted);font-size:13px;line-height:1.6}
  .filters{display:flex;gap:6px;margin:22px 0 14px}
  .chip{font-size:12px;font-weight:500;color:var(--muted);background:transparent;border:0;border-radius:8px;
    padding:5px 12px;cursor:pointer;transition:background .12s,color .12s}
  .chip:hover{background:#1c1c20;color:#d4d4d8}
  .chip.active{background:rgba(56,189,248,.16);color:var(--accent);box-shadow:inset 0 0 0 1px rgba(56,189,248,.4)}
  .chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .groups{display:flex;flex-direction:column;gap:26px}
  .sechead{display:flex;align-items:center;gap:8px;padding:0 2px 8px}
  .section h2{margin:0;font-size:13px;font-weight:700;letter-spacing:.02em}
  .sdot{width:8px;height:8px;border-radius:999px;flex:none}
  .count{font-size:11px;color:var(--dim);font-variant-numeric:tabular-nums}
  .list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
  .row{display:flex;align-items:center;gap:12px;padding:8px 12px;border:1px solid var(--line);border-radius:10px;background:var(--panel)}
  .rank{width:22px;flex:none;text-align:right;font-size:12px;color:var(--dim);font-variant-numeric:tabular-nums}
  .ic{width:38px;height:38px;flex:none;border-radius:8px;background:#0e0e11}
  .ic.ph{box-shadow:inset 0 0 0 2px var(--r)}
  .meta{min-width:0;flex:1}
  .name{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .desc{margin:2px 0 0;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .stat{flex:none;text-align:right;font-variant-numeric:tabular-nums}
  .avg{font-size:15px;font-weight:700;color:var(--accent)}
  .sub{margin-top:1px;font-size:10.5px;color:var(--dim)}
  .note{margin:22px 0 0;font-size:12px;color:var(--dim);line-height:1.55}
</style>`

const row = (r, i) => `
  <li class="row"><span class="rank">${i + 1}</span>
    ${r.data ? `<img class="ic" src="${r.data}" alt="" width="38" height="38">` : `<span class="ic ph" style="--r:${RC[r.aug.rarity]}"></span>`}
    <div class="meta"><div class="name">${r.aug.name}</div><p class="desc">${r.aug.desc}</p></div>
    <div class="stat"><div class="avg">${r.avgPlacement.toFixed(2)}</div>
      <div class="sub">${r.firstRate}% 1st · ${r.games.toLocaleString()}g</div></div></li>`
const section = (r) => `
  <section class="section" data-rarity="${r}">
    <div class="sechead"><span class="sdot" style="background:${RC[r]}"></span>
      <h2 style="color:${RC[r]}">${RL[r]}</h2><span class="count">top ${groups[r].length} of ${totals[r]}</span></div>
    <ol class="list">${groups[r].map(row).join('')}</ol></section>`

const html = `<title>Augment Tier List</title>
${STYLE}
<div class="wrap">
  <header>
    <div class="titlerow"><h1>Augment tier list</h1><span class="badge">Arena win-rates</span></div>
    <p class="lead">Strongest Arena augments by average team placement (1–8, lower is better), grouped by
    rarity, from recent high-elo Arena games. ARAM Mayhem shares the same augments, so it applies there
    too. Static reference — the game doesn’t expose your live augment choices.</p>
  </header>
  <div class="filters">
    <button class="chip active" data-f="all">All</button>
    <button class="chip" data-f="prismatic">Prismatic</button>
    <button class="chip" data-f="gold">Gold</button>
    <button class="chip" data-f="silver">Silver</button>
  </div>
  <div class="groups">${ORDER.map(section).join('')}</div>
  <p class="note">Aggregated from Arena (queue 1700) Match-V5, joined with Community Dragon metadata —
  the same data the app’s /augments page bundles. Showing the top ${TOP} per rarity.</p>
</div>
<script>
  const chips=[...document.querySelectorAll('.chip')], secs=[...document.querySelectorAll('.section')]
  for(const c of chips) c.addEventListener('click',()=>{
    chips.forEach(x=>x.classList.toggle('active',x===c)); const f=c.dataset.f
    secs.forEach(s=>s.style.display=(f==='all'||s.dataset.rarity===f)?'':'none')
  })
</script>`

writeFileSync(OUT, html)
console.log(`Wrote ${OUT} — ${ORDER.map((r) => `${r} ${groups[r].length}/${totals[r]}`).join(', ')}`)
