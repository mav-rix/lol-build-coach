#!/usr/bin/env node
// PROTOTYPE: identify which ARAM Mayhem augments are on screen by matching the
// shipped augment icons (src/data/augments.json) against a screen capture —
// the non-Overwolf path to Porofessor-style "% on the actual augment card".
// Overwolf apps get the offer from game memory; we can only see the screen, so
// this tests whether icon template-matching is reliable enough to build on.
//
// Matching: each icon is alpha-composited over a flat dark backdrop (many
// icons are white glyphs on transparency — their SHAPE against the card
// background is the signal, so matching must include the background contrast),
// downscaled to a small RGB patch, mean-centered and unit-normalized; a
// candidate crop scores by cosine similarity, maximized over a small offset ×
// scale search since a real capture never lands pixel-perfect. Robust to
// global brightness/contrast shifts by construction.
//
//   node scripts/match-augments.mjs --synth 200         # synthetic benchmark
//   node scripts/match-augments.mjs --image shot.png --regions "x,y,s;x,y,s;x,y,s"
//
// Flags: --synth N (trials), --jitter px (crop misalignment, default 4),
// --size px (rendered icon size in synth, default 96), --patch px (match
// resolution, default 24), --extra dir (loose PNGs added as templates, named
// by filename — for icons outside augments.json, e.g. the Mayhem-only Upgrade
// family from CDragon's kiwi/augments/icons). Icons are fetched once into
// .cache/augment-icons/.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ICON_CACHE = join(ROOT, '.cache/augment-icons')
mkdirSync(ICON_CACHE, { recursive: true })

const args = {}
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) {
    const k = process.argv[i].slice(2)
    args[k] =
      process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[++i] : 'true'
  }
}
const PATCH = Number(args.patch ?? 24)
const SYNTH_SIZE = Number(args.size ?? 96)
const JITTER = Number(args.jitter ?? 4)
// --fill r: normalize every template to a fixed glyph-fill ratio — trim to the
// alpha bounding box, then downscale a square window sized bbox/r around its
// center. Riot's icon files pad the glyph inconsistently (kiwi icons far more
// than cherry) while the game renders the glyph at a consistent size within
// the card, so without this the same art scores 0.65 (padded template) vs
// 0.95 (matching padding) — enough to lose to a wrong template.
const FILL = args.fill ? Number(args.fill) : null

/** Alpha bounding box of an RGBA png (alpha > 16). */
function alphaBBox(png) {
  let x0 = png.width
  let y0 = png.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (png.data[(y * png.width + x) * 4 + 3] > 16) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 }
}

/** Downscale with the template's glyph normalized to FILL of the patch. The
 *  sample window may extend past the png; out-of-range pixels are transparent. */
function downscaleNormalized(png, patch, fill) {
  const bb = alphaBBox(png)
  if (!bb) return null
  const side = Math.max(bb.x1 - bb.x0 + 1, bb.y1 - bb.y0 + 1) / fill
  const cx = (bb.x0 + bb.x1 + 1) / 2
  const cy = (bb.y0 + bb.y1 + 1) / 2
  const x0 = cx - side / 2
  const y0 = cy - side / 2
  const rgb = new Float64Array(patch * patch * 3)
  const alpha = new Float64Array(patch * patch)
  for (let py = 0; py < patch; py++) {
    for (let px = 0; px < patch; px++) {
      const sx0 = Math.floor(x0 + (px * side) / patch)
      const sx1 = Math.max(sx0 + 1, Math.floor(x0 + ((px + 1) * side) / patch))
      const sy0 = Math.floor(y0 + (py * side) / patch)
      const sy1 = Math.max(sy0 + 1, Math.floor(y0 + ((py + 1) * side) / patch))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          n++
          if (sx < 0 || sy < 0 || sx >= png.width || sy >= png.height) continue
          const o = (sy * png.width + sx) * 4
          r += png.data[o]
          g += png.data[o + 1]
          b += png.data[o + 2]
          a += png.data[o + 3]
        }
      }
      const t = (py * patch + px) * 3
      rgb[t] = r / n
      rgb[t + 1] = g / n
      rgb[t + 2] = b / n
      alpha[py * patch + px] = a / n
    }
  }
  return { rgb, alpha }
}

const augments = JSON.parse(readFileSync(join(ROOT, 'src/data/augments.json'), 'utf8'))

// --- image helpers -------------------------------------------------------------

/** Box-downscale an RGBA buffer region to patch×patch; returns {rgb, alpha}. */
function downscale(data, width, x0, y0, w, h, patch) {
  const rgb = new Float64Array(patch * patch * 3)
  const alpha = new Float64Array(patch * patch)
  for (let py = 0; py < patch; py++) {
    for (let px = 0; px < patch; px++) {
      const sx0 = x0 + Math.floor((px * w) / patch)
      const sx1 = Math.max(sx0 + 1, x0 + Math.floor(((px + 1) * w) / patch))
      const sy0 = y0 + Math.floor((py * h) / patch)
      const sy1 = Math.max(sy0 + 1, y0 + Math.floor(((py + 1) * h) / patch))
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * width + sx) * 4
          r += data[o]
          g += data[o + 1]
          b += data[o + 2]
          a += data[o + 3]
          n++
        }
      }
      const t = (py * patch + px) * 3
      rgb[t] = r / n
      rgb[t + 1] = g / n
      rgb[t + 2] = b / n
      alpha[py * patch + px] = a / n
    }
  }
  return { rgb, alpha }
}

/** Mean-center + unit-normalize an RGB patch vector. */
function normalize(rgb) {
  const v = new Float64Array(rgb.length)
  let mean = 0
  for (let i = 0; i < rgb.length; i++) mean += rgb[i]
  mean /= rgb.length || 1
  let norm = 0
  for (let i = 0; i < rgb.length; i++) {
    const d = rgb[i] - mean
    v[i] = d
    norm += d * d
  }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < v.length; i++) v[i] /= norm
  return v
}

// Backdrop the templates are composited on — flat dark, roughly the pick
// screen's card face. Matching is mean/contrast-invariant, so the exact shade
// matters less than it being dark and uniform.
const BACKDROP = [40, 40, 50]

// --- template library ----------------------------------------------------------

async function fetchIcon(aug) {
  const file = join(ICON_CACHE, `${aug.id}.png`)
  if (!existsSync(file)) {
    const res = await fetch(aug.icon)
    if (!res.ok) throw new Error(`${res.status} fetching ${aug.icon}`)
    writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  return PNG.sync.read(readFileSync(file))
}

async function buildTemplates() {
  const templates = []
  for (const aug of augments) {
    let png
    try {
      png = await fetchIcon(aug)
    } catch (e) {
      console.warn(`  · skipping ${aug.name}: ${e.message}`)
      continue
    }
    // Riot reuses identical icon art across related augments (Bread And
    // Butter/Jam/Cheese all ship Recursion's glyph, escAPADe/ADAPt share,
    // etc.) — no matcher can tell those apart by icon. Group by content hash;
    // a group hit is a correct visual match, and the real feature would
    // disambiguate within a group by the card's rarity frame color.
    const group = createHash('md5')
      .update(readFileSync(join(ICON_CACHE, `${aug.id}.png`)))
      .digest('hex')
    const scaled = FILL
      ? downscaleNormalized(png, PATCH, FILL)
      : downscale(png.data, png.width, 0, 0, png.width, png.height, PATCH)
    if (!scaled) continue
    const { rgb, alpha } = scaled
    // Composite over the flat backdrop so shape-vs-background is in the vector.
    const flat = new Float64Array(rgb.length)
    for (let p = 0; p < alpha.length; p++) {
      const a = alpha[p] / 255
      for (let c = 0; c < 3; c++) flat[p * 3 + c] = rgb[p * 3 + c] * a + BACKDROP[c] * (1 - a)
    }
    templates.push({ id: aug.id, name: aug.name, group, vec: normalize(flat), png })
  }
  if (args.extra) {
    const { readdirSync } = await import('node:fs')
    for (const f of readdirSync(args.extra).filter((f) => f.endsWith('.png'))) {
      const png = PNG.sync.read(readFileSync(join(args.extra, f)))
      const scaled = FILL
        ? downscaleNormalized(png, PATCH, FILL)
        : downscale(png.data, png.width, 0, 0, png.width, png.height, PATCH)
      if (!scaled) continue
      const { rgb, alpha } = scaled
      const flat = new Float64Array(rgb.length)
      for (let p = 0; p < alpha.length; p++) {
        const a = alpha[p] / 255
        for (let c = 0; c < 3; c++) flat[p * 3 + c] = rgb[p * 3 + c] * a + BACKDROP[c] * (1 - a)
      }
      const name = f.replace(/\.png$/, '')
      templates.push({ id: name, name: `[extra] ${name}`, group: `extra:${name}`, vec: normalize(flat), png })
    }
  }
  return templates
}

/**
 * Best template for a screenshot crop. The nominal region only approximates
 * where the icon sits, so the score is maximized over a small offset × scale
 * grid around it — this is what makes the matcher survive imperfect card
 * geometry (HUD scale, resolution rounding).
 */
function matchRegion(image, x, y, size, templates, search = JITTER) {
  const offsets = []
  for (let dy = -search; dy <= search; dy += 2)
    for (let dx = -search; dx <= search; dx += 2) offsets.push([dx, dy])
  const scales = [0.9, 1, 1.1]
  let best = null
  let second = null
  for (const s of scales) {
    const sz = Math.round(size * s)
    for (const [dx, dy] of offsets) {
      const cx = Math.max(0, Math.min(image.width - sz, x + dx))
      const cy = Math.max(0, Math.min(image.height - sz, y + dy))
      const { rgb } = downscale(image.data, image.width, cx, cy, sz, sz, PATCH)
      const v = normalize(rgb)
      // The margin (confidence) is measured against the best DIFFERENT-art
      // template — identical-art siblings always tie and say nothing.
      for (const t of templates) {
        let score = 0
        for (let i = 0; i < v.length; i++) score += v[i] * t.vec[i]
        if (!best || score > best.score) {
          if (best && best.group !== t.group) second = best
          best = { id: t.id, name: t.name, group: t.group, score }
        } else if (best.group !== t.group && (!second || score > second.score)) {
          second = { id: t.id, name: t.name, group: t.group, score }
        }
      }
    }
  }
  return { ...best, margin: best.score - (second?.score ?? 0) }
}

// --- synthetic benchmark --------------------------------------------------------

function synthBackground(w, h, rng) {
  const png = new PNG({ width: w, height: h })
  // Dark vignette-ish gradient + noise — roughly the pick screen's backdrop.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const g = 18 + 30 * (y / h) + (rng() - 0.5) * 24
      png.data[o] = g * 0.9
      png.data[o + 1] = g * 0.8
      png.data[o + 2] = g * 1.2
      png.data[o + 3] = 255
    }
  }
  return png
}

/** Paste an icon (nearest-neighbor scaled, alpha-composited) with brightness jitter. */
function pasteIcon(bg, icon, x, y, size, brightness) {
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const sx = Math.floor((dx * icon.width) / size)
      const sy = Math.floor((dy * icon.height) / size)
      const so = (sy * icon.width + sx) * 4
      const a = icon.data[so + 3] / 255
      if (a === 0) continue
      const to = ((y + dy) * bg.width + (x + dx)) * 4
      for (let c = 0; c < 3; c++) {
        const v = Math.min(255, icon.data[so + c] * brightness)
        bg.data[to + c] = v * a + bg.data[to + c] * (1 - a)
      }
    }
  }
}

function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function runSynth(trials) {
  console.log(`Building templates (${augments.length} icons, patch ${PATCH}px)…`)
  const templates = await buildTemplates()
  console.log(`  ${templates.length} templates ready\n`)
  const rng = mulberry32(1234)
  // Three "cards" like the pick screen, icons centered near the card tops.
  const positions = [
    [280, 300],
    [760, 300],
    [1240, 300],
  ]
  let hits = 0
  let total = 0
  let marginSum = 0
  let worst = { margin: Infinity }
  const misses = new Map() // "expected → got" -> count
  for (let t = 0; t < trials; t++) {
    const bg = synthBackground(1600, 700, rng)
    const chosen = []
    while (chosen.length < 3) {
      const c = templates[Math.floor(rng() * templates.length)]
      if (!chosen.includes(c)) chosen.push(c)
    }
    const size = Math.round(SYNTH_SIZE * (0.8 + rng() * 0.5)) // 77–125 px at default
    const brightness = 0.75 + rng() * 0.5 // ±25 %
    chosen.forEach((c, i) => pasteIcon(bg, c.png, positions[i][0], positions[i][1], size, brightness))
    chosen.forEach((c, i) => {
      // The matcher doesn't get perfect alignment: jitter the crop a few px.
      const jx = Math.round((rng() - 0.5) * 2 * JITTER)
      const jy = Math.round((rng() - 0.5) * 2 * JITTER)
      const m = matchRegion(bg, positions[i][0] + jx, positions[i][1] + jy, size, templates)
      total++
      marginSum += m.margin
      if (m.group === c.group) hits++
      else {
        const key = `${c.name} → ${m.name}`
        misses.set(key, (misses.get(key) ?? 0) + 1)
        if (m.margin < worst.margin) worst = { margin: m.margin, expected: c.name, got: m.name }
      }
    })
  }
  const acc = ((100 * hits) / total).toFixed(1)
  console.log(`Synthetic benchmark: ${trials} trials × 3 cards, icon ${SYNTH_SIZE}±25 px,`)
  console.log(`brightness ±25 %, crop jitter ±${JITTER} px`)
  console.log(`  top-1 accuracy: ${hits}/${total} (${acc} %)`)
  console.log(`  mean margin over 2nd-best: ${(marginSum / total).toFixed(3)}`)
  if (misses.size > 0) {
    console.log('  confusions:')
    for (const [pair, n] of [...misses.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`    ${n}× ${pair}`)
  }
}

// --- real screenshot -----------------------------------------------------------

async function runImage(file, regionSpec) {
  const templates = await buildTemplates()
  const image = PNG.sync.read(readFileSync(file))
  const regions = regionSpec.split(';').map((r) => r.split(',').map(Number))
  for (const [x, y, s] of regions) {
    const m = matchRegion(image, x, y, s, templates)
    console.log(
      `  (${x},${y},${s}) → ${m.name} (id ${m.id})  score ${m.score.toFixed(3)}  margin ${m.margin.toFixed(3)}`,
    )
  }
}

if (args.synth) await runSynth(Number(args.synth === 'true' ? 200 : args.synth))
else if (args.image && args.regions) await runImage(args.image, args.regions)
else {
  console.log('Usage: --synth [N]  |  --image shot.png --regions "x,y,s;x,y,s;x,y,s"')
  process.exit(1)
}
