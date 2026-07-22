// Augment "vision": identify which ARAM Mayhem augments are on the pick screen
// by capturing the display (desktopCapturer — same DXGI path OBS uses, never
// touches the game process). This is the non-Overwolf route to Porofessor-style
// badges over the actual cards: Overwolf apps read the offer from game memory;
// all we can read is our own screen.
//
// v3 pipeline — icon matching DETECTS, title OCR NAMES:
// - Icon template matching against the augment icon library finds the pick
//   screen (cards sit at fixed, resolution-scaled positions). Field-proven
//   detector, but a hopeless namer: Riot reuses and lightly recolors icon art
//   across dozens of augments (validated across three live games — the same
//   sword serves 4+ augments, generic category icons serve 20+), and the file
//   that ships isn't always the art that renders.
// - The card TITLE is the only unambiguous identifier on screen. Once icons
//   say "pick screen", each card's title band is OCR'd (tesseract.js, local
//   traineddata) and fuzzy-matched (edit distance) against the ~220 known
//   augment names. A card gets a badge ONLY when its title resolves; no
//   fallback to icon names — a missing badge costs nothing, a wrong one costs
//   trust. Validated 6/6 exact on captured live frames, ~100 ms per title.
//
// Robustness notes, learned the hard way:
// - Capture is decoded via toPNG() + pngjs, NOT toBitmap(): toBitmap's channel
//   order is platform-dependent (BGRA on Windows) — a silent red/blue swap
//   wrecks matching on exactly the gold-tinted icons the game renders.
// - Templates are FILL-NORMALIZED: trimmed to their alpha bounding box and
//   re-rendered at a fixed glyph-fill ratio. Riot pads icon files wildly
//   inconsistently (kiwi vs cherry) while the game renders glyphs at a
//   consistent size — without this, identical art scores 0.65 vs 0.95 purely
//   on padding, enough to lose to a wrong template.
// - Presence has hysteresis (2 consecutive empty scans to clear) so the card
//   glow animation can't flap badges at a threshold edge.
// - Every scan appends to userData/vision.log; each detection dumps the crops
//   (vision-debug.png) and the full frame (vision-frame.png) — mismatches are
//   diagnosable from a player's machine without a debugger.
//
// The renderer drives start/stop (armed for the whole Mayhem game — the pick
// screen can appear at any death after an unlock, and probes are cheap) and
// supplies the template manifest {key, name, icon} (augments.json metas + the
// Mayhem-only extras from augmentExtras.json). Icons cache into userData.

const { desktopCapturer, screen, app, utilityProcess } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

let PNG = null
try {
  PNG = require('pngjs').PNG
} catch {
  // Optional dep missing — vision quietly stays off.
}

const PATCH = 32
const BACKDROP = [40, 40, 50]
// Glyph-fill ratio templates are normalized to. 0.95 reproduces how the game
// renders icons inside the card's icon area (fitted on captured live frames).
const FILL = 0.95
const SCAN_MS = 400
// Icon scores merely gate the OCR: any card whose region resembles ANY known
// augment art this strongly means the pick screen is up. Correct cards run
// 0.85+ with fill-normalized templates; non-pick screens stay ≤ ~0.6.
const TRIGGER_SCORE = 0.75
// Quick-pass band: a single-window score below this is a definite miss (live
// negatives probe ~0.15, real cards 0.83+); only [PREGATE, TRIGGER) runs the
// full offset×scale grid. Keeps the whole-game probe loop at a few ms.
const PREGATE_SCORE = 0.5
// Trigger templates deduped at this cosine similarity — Riot reuses icon art
// heavily, and for DETECTION a near-duplicate's score is the same score. Cuts
// the per-probe dot products roughly in half at zero detection cost.
const DEDUP_SIM = 0.98
const MISS_LIMIT = 2 // consecutive OCR-empty scans before badges clear
// The renderer now arms the watch for the WHOLE Mayhem game (probes are cheap
// enough); this cap only guards against a dead renderer never saying stop.
const WATCH_MAX_MS = 45 * 60_000

// Card geometry measured on real 1920×1080 captures (validated across three
// live games — game-start and mid-game pick screens share it). Horizontally
// centered, scales with display HEIGHT.
const REF_H = 1080
const REF_ICONS = [
  { cx: 598, cy: 312 },
  { cx: 965, cy: 312 },
  { cx: 1335, cy: 312 },
]
const REF_ICON_SIZE = 140
// Title band under each icon (bbox-tightened before OCR).
const TITLE_BAND = { y0: 420, y1: 470, halfW: 175 }

function vlog(line) {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'vision.log'),
      `${new Date().toISOString()} ${line}\n`,
    )
  } catch {
    // best effort
  }
}

// --- matching core --------------------------------------------------------------

/** Alpha bounding box of a pngjs image (alpha > 16). */
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

/** Template downscale with the glyph normalized to FILL of the patch; the
 *  sample window may extend past the png (out-of-range = transparent). */
function downscaleNormalized(png, patch, fill) {
  const bb = alphaBBox(png)
  if (!bb) return null
  const side = Math.max(bb.x1 - bb.x0 + 1, bb.y1 - bb.y0 + 1) / fill
  const bcx = (bb.x0 + bb.x1 + 1) / 2
  const bcy = (bb.y0 + bb.y1 + 1) / 2
  const ox = bcx - side / 2
  const oy = bcy - side / 2
  const rgb = new Float64Array(patch * patch * 3)
  const alpha = new Float64Array(patch * patch)
  for (let py = 0; py < patch; py++) {
    for (let px = 0; px < patch; px++) {
      const sx0 = Math.floor(ox + (px * side) / patch)
      const sx1 = Math.max(sx0 + 1, Math.floor(ox + ((px + 1) * side) / patch))
      const sy0 = Math.floor(oy + (py * side) / patch)
      const sy1 = Math.max(sy0 + 1, Math.floor(oy + ((py + 1) * side) / patch))
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

/** Box-downscale a region of an RGBA buffer to patch×patch RGB. */
function downscale(data, width, x0, y0, w, h, patch) {
  const rgb = new Float64Array(patch * patch * 3)
  for (let py = 0; py < patch; py++) {
    for (let px = 0; px < patch; px++) {
      const sx0 = x0 + Math.floor((px * w) / patch)
      const sx1 = Math.max(sx0 + 1, x0 + Math.floor(((px + 1) * w) / patch))
      const sy0 = y0 + Math.floor((py * h) / patch)
      const sy1 = Math.max(sy0 + 1, y0 + Math.floor(((py + 1) * h) / patch))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * width + sx) * 4
          r += data[o]
          g += data[o + 1]
          b += data[o + 2]
          n++
        }
      }
      const t = (py * patch + px) * 3
      rgb[t] = r / n
      rgb[t + 1] = g / n
      rgb[t + 2] = b / n
    }
  }
  return rgb
}

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

/** Single-window icon score (no offset/scale search): the cheap first tier of
 *  the probe. Validated on live-art composites: real cards score 0.83+ here,
 *  non-pick screens ~0.15 — only the rare in-between pays for the full grid. */
function quickIconScore(image, x, y, size, templates) {
  const v = normalize(downscale(image.data, image.width, x, y, size, size, PATCH))
  let best = 0
  for (const t of templates) {
    let score = 0
    for (let i = 0; i < v.length; i++) score += v[i] * t.vec[i]
    if (score > best) best = score
  }
  return best
}

/** Best icon-similarity score for a region (offset × scale search). Only the
 *  score matters — naming is OCR's job. `enough` short-circuits the search the
 *  moment the score answers the only question asked ("is the screen up?"). */
function bestIconScore(image, x, y, size, templates, enough = Infinity) {
  const search = Math.max(4, Math.round(size * 0.06))
  const step = Math.max(2, Math.round(search / 2))
  let best = 0
  for (const s of [0.95, 1, 1.05]) {
    const sz = Math.round(size * s)
    for (let dy = -search; dy <= search; dy += step) {
      for (let dx = -search; dx <= search; dx += step) {
        const cx = Math.max(0, Math.min(image.width - sz, x + dx))
        const cy = Math.max(0, Math.min(image.height - sz, y + dy))
        const v = normalize(downscale(image.data, image.width, cx, cy, sz, sz, PATCH))
        for (const t of templates) {
          let score = 0
          for (let i = 0; i < v.length; i++) score += v[i] * t.vec[i]
          if (score > best) {
            best = score
            if (best >= enough) return best
          }
        }
      }
    }
  }
  return best
}

/** Detection-only template subset: drop templates nearly identical to one
 *  already kept. Built once per template build, reused across scans. */
function dedupForTrigger(templates) {
  const kept = []
  for (const t of templates) {
    let dup = false
    for (const k of kept) {
      let sim = 0
      for (let i = 0; i < t.vec.length; i++) sim += t.vec[i] * k.vec[i]
      if (sim >= DEDUP_SIM) {
        dup = true
        break
      }
    }
    if (!dup) kept.push(t)
  }
  return kept
}

// --- template library -----------------------------------------------------------

const iconCacheDir = () => path.join(app.getPath('userData'), 'augment-icons')

async function fetchIcon(entry) {
  const safe = String(entry.key).replace(/[^\w-]/g, '_')
  const file = path.join(iconCacheDir(), `${safe}.png`)
  if (!fs.existsSync(file)) {
    const res = await fetch(entry.icon)
    if (!res.ok) throw new Error(`${res.status} for ${entry.icon}`)
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  }
  return file
}

let templatesCache = null
let triggerCache = null // {from: templates array, list: deduped subset}

async function buildTemplates(manifest) {
  if (templatesCache) return templatesCache
  fs.mkdirSync(iconCacheDir(), { recursive: true })
  const templates = []
  let failed = 0
  for (const entry of manifest) {
    try {
      const file = await fetchIcon(entry)
      const png = PNG.sync.read(fs.readFileSync(file))
      const scaled = downscaleNormalized(png, PATCH, FILL)
      if (!scaled) throw new Error('fully transparent icon')
      const flat = new Float64Array(scaled.rgb.length)
      for (let p = 0; p < scaled.alpha.length; p++) {
        const a = scaled.alpha[p] / 255
        for (let c = 0; c < 3; c++)
          flat[p * 3 + c] = scaled.rgb[p * 3 + c] * a + BACKDROP[c] * (1 - a)
      }
      templates.push({ key: entry.key, name: entry.name, vec: normalize(flat) })
    } catch (e) {
      failed++
      vlog(`template ${entry.key} skipped: ${e.message ?? e}`)
    }
  }
  vlog(`templates ready: ${templates.length} ok, ${failed} failed`)
  // Only memoize a healthy build so a bad network moment heals on the next
  // offer window instead of sticking.
  if (templates.length > 0 && failed <= manifest.length * 0.1) templatesCache = templates
  return templates
}

// --- title OCR -------------------------------------------------------------------

// Known-name index for fuzzy matching. Numeric keys (stats-backed augments)
// win name collisions so badges keep their stats.
function buildNameIndex(manifest) {
  const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const index = new Map()
  for (const entry of manifest) {
    const c = canon(entry.name)
    if (!c) continue
    const cur = index.get(c)
    if (!cur || (/^\d+$/.test(entry.key) && !/^\d+$/.test(cur.key))) index.set(c, entry)
  }
  return { index, canon }
}

/** Semi-global edit distance: cheapest alignment of `name` against ANY
 *  substring of `raw`. OCR of a title band picks up junk around the name
 *  (sparkle particles, card-frame pixels read as characters) — with a plain
 *  edit distance that junk costs edits and real titles get rejected; here a
 *  free start/end in `raw` makes it cost nothing. */
function nameDist(raw, name) {
  const m = raw.length
  const n = name.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let best = prev[n]
  for (let i = 1; i <= m; i++) {
    const cur = [0] // free start anywhere in raw
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (raw[i - 1] === name[j - 1] ? 0 : 1))
    prev = cur
    if (cur[n] < best) best = cur[n] // free end anywhere in raw
  }
  return best
}

// OCR runs in an isolated utilityProcess (electron/ocr-worker.js): tesseract's
// worker_threads + WASM must never run inside main — a native fault there
// killed the whole app in the field (2026-07-20, silent death right after the
// in-main warm-up). If the sidecar dies, badges simply don't confirm.
const OCR_TIMEOUT_MS = 6000
// Per watch — a crash-looping sidecar stays down. Watches now span a whole
// game, so allow a few more lives than the old 2-minute windows did.
const OCR_MAX_SPAWNS = 5

// electron-builder unpacks tesseract + the traineddata + the sidecar script
// next to the asar; paths from inside the archive must be redirected there
// (plain fs in the child can't see into an asar).
const unpacked = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')

let ocrProc = null
let ocrSpawns = 0
let ocrSeq = 0
const ocrPending = new Map() // id -> {resolve, timer}

function ocrFailAll(reason) {
  for (const [, p] of ocrPending) {
    clearTimeout(p.timer)
    p.resolve(null)
  }
  ocrPending.clear()
  if (reason) vlog(`ocr: ${reason}`)
}

function ensureOcrProc() {
  if (ocrProc) return ocrProc
  if (ocrSpawns >= OCR_MAX_SPAWNS) return null
  ocrSpawns++
  const script = unpacked(path.join(__dirname, 'ocr-worker.js'))
  const trained = path.join(unpacked(__dirname), 'eng.traineddata.gz')
  const langDir = fs.existsSync(trained) ? unpacked(__dirname) : ''
  try {
    ocrProc = utilityProcess.fork(script, [langDir, app.getPath('userData')], {
      serviceName: 'augment-ocr',
    })
  } catch (e) {
    vlog(`ocr spawn failed: ${e.message ?? e}`)
    ocrProc = null
    return null
  }
  ocrProc.on('message', (msg) => {
    const p = ocrPending.get(msg?.id)
    if (!p) return
    ocrPending.delete(msg.id)
    clearTimeout(p.timer)
    if (msg.error) vlog(`ocr error: ${msg.error}`)
    p.resolve(typeof msg.text === 'string' ? msg.text : null)
  })
  ocrProc.on('exit', (code) => {
    ocrProc = null
    ocrFailAll(`sidecar exited (code ${code})`)
  })
  return ocrProc
}

/** Recognize a PNG buffer via the sidecar; null on any failure/timeout. */
function ocrRecognize(pngBuf) {
  const proc = ensureOcrProc()
  if (!proc) return Promise.resolve(null)
  const id = ++ocrSeq
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      ocrPending.delete(id)
      resolve(null)
      vlog(`ocr timeout (#${id}) — killing sidecar`)
      try {
        proc.kill()
      } catch {
        // already gone
      }
    }, OCR_TIMEOUT_MS)
    ocrPending.set(id, { resolve, timer })
    proc.postMessage({ id, png: pngBuf })
  })
}

function stopOcr() {
  const p = ocrProc
  ocrProc = null
  ocrSpawns = 0
  ocrFailAll(null)
  if (p)
    try {
      p.kill()
    } catch {
      // already gone
    }
}

/** Crop a card's title band, tighten to the bright-text bbox, upscale 2× and
 *  invert (dark text on light OCRs best). Returns a PNG buffer or null. */
function titleCrop(image, cardCx, s) {
  const y0 = Math.round(TITLE_BAND.y0 * s)
  const y1 = Math.round(TITLE_BAND.y1 * s)
  const xL = Math.max(0, Math.round(cardCx - TITLE_BAND.halfW * s))
  const xR = Math.min(image.width, Math.round(cardCx + TITLE_BAND.halfW * s))
  let minX = Infinity
  let maxX = -1
  let minY = Infinity
  let maxY = -1
  for (let y = y0; y < y1; y++) {
    for (let x = xL; x < xR; x++) {
      const o = (y * image.width + x) * 4
      const lum = 0.3 * image.data[o] + 0.6 * image.data[o + 1] + 0.1 * image.data[o + 2]
      if (lum > 170) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0 || maxX - minX < 12) return null
  const pad = Math.round(6 * s)
  const cx0 = Math.max(0, minX - pad)
  const cy0 = Math.max(0, minY - pad)
  const w = Math.min(image.width, maxX + pad) - cx0
  const h = Math.min(image.height, maxY + pad) - cy0
  const out = new PNG({ width: w * 2, height: h * 2 })
  for (let y = 0; y < h * 2; y++) {
    for (let x = 0; x < w * 2; x++) {
      const so = ((cy0 + (y >> 1)) * image.width + cx0 + (x >> 1)) * 4
      const to = (y * out.width + x) * 4
      const lum = 0.3 * image.data[so] + 0.6 * image.data[so + 1] + 0.1 * image.data[so + 2]
      const v = 255 - Math.min(255, Math.max(0, Math.round(lum * 1.4)))
      out.data[to] = out.data[to + 1] = out.data[to + 2] = v
      out.data[to + 3] = 255
    }
  }
  return PNG.sync.write(out)
}

/** OCR one title band and resolve it to a known augment, or null. */
async function readTitle(image, cardCx, s, nameIndex) {
  const buf = titleCrop(image, cardCx, s)
  if (!buf) return null
  const text = await ocrRecognize(buf)
  if (text == null) return null
  const raw = text.trim().replace(/\s+/g, ' ')
  const c = nameIndex.canon(raw)
  if (c.length < 4) return null
  // Best per-name partial match. On distance ties the LONGER name wins — an
  // OCR of "Infinite Recursion" contains "Recursion" at distance 0 too, and
  // the more specific name is the one actually on the card.
  let best = null
  let second = null
  for (const [cn, entry] of nameIndex.index) {
    const d = nameDist(c, cn)
    if (d > Math.max(1, Math.round(cn.length * 0.25))) continue
    const better = !best || d < best.d || (d === best.d && cn.length > best.len)
    if (better) {
      second = best
      best = { d, len: cn.length, entry }
    } else if (!second || d < second.d || (d === second.d && cn.length > second.len)) {
      second = { d, len: cn.length, entry }
    }
  }
  if (!best) return { raw, entry: null }
  // Equal-quality match for two different augments → genuinely ambiguous.
  if (second && second.d === best.d && second.len === best.len && second.entry !== best.entry)
    return { raw, entry: null }
  return { raw, entry: best.entry, dist: best.d }
}

// --- debug dumps ------------------------------------------------------------------

/** The three icon crops the trigger saw, side by side. Overwritten per event. */
function dumpCrops(image, cards, iconSize) {
  try {
    const out = new PNG({ width: iconSize * 3, height: iconSize })
    cards.forEach((c, i) => {
      const x0 = Math.max(0, Math.min(image.width - iconSize, c.cx - Math.round(iconSize / 2)))
      const y0 = Math.max(0, Math.min(image.height - iconSize, c.cy - Math.round(iconSize / 2)))
      for (let y = 0; y < iconSize; y++) {
        for (let x = 0; x < iconSize; x++) {
          const so = ((y0 + y) * image.width + (x0 + x)) * 4
          const to = (y * out.width + (i * iconSize + x)) * 4
          for (let ch = 0; ch < 4; ch++) out.data[to + ch] = image.data[so + ch]
        }
      }
    })
    fs.writeFileSync(path.join(app.getPath('userData'), 'vision-debug.png'), PNG.sync.write(out))
  } catch (e) {
    vlog(`crop dump failed: ${e.message ?? e}`)
  }
}

/** Full captured frame — ground truth for geometry/OCR diagnosis. */
function dumpFrame(image, why) {
  try {
    const out = new PNG({ width: image.width, height: image.height })
    image.data.copy(out.data)
    fs.writeFileSync(path.join(app.getPath('userData'), 'vision-frame.png'), PNG.sync.write(out))
    vlog(`frame dumped (${why})`)
  } catch (e) {
    vlog(`frame dump failed: ${e.message ?? e}`)
  }
}

// --- capture + watch loop ----------------------------------------------------------

let watch = null

// Field incident (game 7, 2026-07-20): full-res getSources stalled for 1–2
// MINUTES at a stretch during live gameplay (200 fps game saturating the GPU;
// captures only flowed again once the load dropped), and the old code's only
// silent path — an empty thumbnail — left nothing in the log. Now every scan
// is a cheap half-res PROBE for the icon trigger; the expensive full-res
// grab (needed for OCR-legible titles) happens only when cards are actually
// on screen. Every capture is raced against a timeout and every failure path
// logs.
const CAPTURE_TIMEOUT_MS = 8000
const PROBE_H = 540

async function captureFrame(w, h, tag) {
  const display = screen.getPrimaryDisplay()
  let sources
  try {
    sources = await Promise.race([
      desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } }),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error(`timed out after ${CAPTURE_TIMEOUT_MS} ms`)), CAPTURE_TIMEOUT_MS),
      ),
    ])
  } catch (e) {
    vlog(`capture(${tag}) failed: ${e.message ?? e}`)
    return null
  }
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!source || source.thumbnail.isEmpty()) {
    vlog(`capture(${tag}) empty (${sources.length} sources)`)
    return null
  }
  // PNG round-trip: guarantees RGBA regardless of platform bitmap layout.
  try {
    return PNG.sync.read(source.thumbnail.toPNG())
  } catch (e) {
    vlog(`decode(${tag}) failed: ${e.message ?? e}`)
    return null
  }
}

async function scanOnce() {
  if (!watch) return
  const display = screen.getPrimaryDisplay()
  const pxW = Math.round(display.size.width * display.scaleFactor)
  const pxH = Math.round(display.size.height * display.scaleFactor)

  // Phase 1: half-res probe → icon trigger (validated ≥0.87 on live frames).
  const probeH = Math.min(PROBE_H, pxH)
  const probeW = Math.round((pxW * probeH) / pxH)
  const probe = await captureFrame(probeW, probeH, 'probe')
  if (!watch || !probe) return
  const ps = probe.height / REF_H
  const probeIcon = Math.round(REF_ICON_SIZE * ps)
  // Middle card first — it's the least likely to sit under the cursor — and
  // stop the moment any card clears the trigger; a real pick screen usually
  // answers on the first card's quick pass. Only quick scores in the ambiguous
  // band pay for the offset×scale grid.
  const scores = [null, null, null]
  let maxScore = 0
  for (const i of [1, 0, 2]) {
    const r = REF_ICONS[i]
    const x = Math.round(probe.width / 2 + (r.cx - 960) * ps) - Math.round(probeIcon / 2)
    const y = Math.round(r.cy * ps) - Math.round(probeIcon / 2)
    let sc = quickIconScore(probe, x, y, probeIcon, watch.triggerTemplates)
    if (sc >= PREGATE_SCORE && sc < TRIGGER_SCORE)
      sc = bestIconScore(probe, x, y, probeIcon, watch.triggerTemplates, TRIGGER_SCORE)
    scores[i] = sc
    if (sc > maxScore) maxScore = sc
    if (maxScore >= TRIGGER_SCORE) break
  }
  if (!watch) return // stopped while matching

  if (maxScore < TRIGGER_SCORE) {
    vlog(`scan probe ${probe.width}x${probe.height} icons=${scores.map((v) => (v == null ? '-' : v.toFixed(2))).join('/')} (no trigger)`)
    if (watch.present && ++watch.missStreak >= MISS_LIMIT) {
      watch.present = false
      watch.lastKeys = null
      watch.onGone()
    }
    return
  }

  // Phase 2: full-res frame for OCR. A failed full grab is NOT "screen gone" —
  // badges keep their state and the next probe decides.
  const image = await captureFrame(pxW, pxH, 'full')
  if (!watch || !image) return
  const { width, height } = image

  const s = height / REF_H
  const iconSize = Math.round(REF_ICON_SIZE * s)
  const cards = REF_ICONS.map((r) => ({
    cx: Math.round(width / 2 + (r.cx - 960) * s),
    cy: Math.round(r.cy * s),
  }))

  // Pick screen likely up — let OCR name each card. Logged in two steps so a
  // stall between them is localizable from the log alone.
  vlog(`scan ${width}x${height} icons=${scores.map((v) => (v == null ? '-' : v.toFixed(2))).join('/')} triggered, ocr…`)
  let reads
  try {
    // All three titles at once — the sidecar runs parallel OCR workers.
    reads = await Promise.all(cards.map((c) => readTitle(image, c.cx, s, watch.nameIndex)))
  } catch (e) {
    vlog(`ocr failed: ${e.message ?? e}`)
    return
  }
  if (!watch) return
  const confirmed = reads
    .map((r, i) => (r?.entry ? { entry: r.entry, dist: r.dist, i } : null))
    .filter(Boolean)
  vlog(
    `ocr result: ${reads
      .map((r) => (r ? `"${r.raw}"→${r.entry ? r.entry.name : '?'}` : 'blank'))
      .join(' | ')}`,
  )

  if (confirmed.length === 0) {
    if (!watch.frameDumped) {
      watch.frameDumped = true
      dumpFrame(image, `trigger without ocr match, icons=${scores.map((v) => (v == null ? '-' : v.toFixed(2))).join('/')}`)
    }
    if (watch.present && ++watch.missStreak >= MISS_LIMIT) {
      watch.present = false
      watch.lastKeys = null
      watch.onGone()
    }
    return
  }

  watch.present = true
  watch.missStreak = 0
  const keys = confirmed.map((c) => `${c.i}:${c.entry.key}`).join('|')
  if (keys !== watch.lastKeys) {
    watch.lastKeys = keys
    dumpCrops(image, cards, iconSize)
    dumpFrame(image, 'detection')
    const toDip = (v) => v / display.scaleFactor
    watch.onOffer({
      cards: confirmed.map((c) => ({
        key: c.entry.key,
        score: 1 - c.dist / 10, // rough confidence for display/debug
        cx: toDip(cards[c.i].cx) + display.bounds.x,
        cy: toDip(cards[c.i].cy) + display.bounds.y,
      })),
      iconSize: toDip(iconSize),
    })
  }
}

/**
 * Start watching for the pick screen. `manifest` is [{key, name, icon}] from
 * the renderer. Callbacks: onOffer(payload) when cards are identified or the
 * identified set changes (payload carries keys + card centers in DIP screen
 * coords), onGone() when the screen disappears. No-ops when pngjs is missing.
 */
async function startVision(manifest, onOffer, onGone) {
  if (!PNG || !Array.isArray(manifest) || manifest.length === 0) return
  stopVision()
  const templates = await buildTemplates(manifest)
  if (templates.length === 0) return
  if (!triggerCache || triggerCache.from !== templates) {
    triggerCache = { from: templates, list: dedupForTrigger(templates) }
    vlog(`trigger templates: ${triggerCache.list.length} of ${templates.length} after dedup`)
  }
  ensureOcrProc() // warm the OCR sidecar off the critical path
  watch = {
    templates,
    triggerTemplates: triggerCache.list,
    nameIndex: buildNameIndex(manifest),
    onOffer,
    onGone,
    present: false,
    missStreak: 0,
    lastKeys: null,
    frameDumped: false,
    stopAt: Date.now() + WATCH_MAX_MS,
  }
  vlog('watch started')
  let scanning = false
  watch.timer = setInterval(async () => {
    if (!watch) return
    if (Date.now() > watch.stopAt) {
      vlog('watch safety-stop')
      stopVision(true)
      return
    }
    if (scanning) return
    scanning = true
    try {
      await scanOnce()
    } finally {
      scanning = false
    }
  }, SCAN_MS)
  // First scan immediately — offers usually pop with the player already dead.
  scanOnce().catch(() => {})
}

function stopVision(fireGone = false) {
  stopOcr()
  if (!watch) return
  clearInterval(watch.timer)
  const { onGone, present } = watch
  watch = null
  vlog('watch stopped')
  if (fireGone && present) onGone()
}

module.exports = { startVision, stopVision }
