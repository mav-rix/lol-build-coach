// OCR sidecar — runs tesseract.js in an Electron utilityProcess, NOT in main.
// tesseract spins up worker_threads + WASM; a native fault there must never
// take the app down (field incident 2026-07-20: main died silently right after
// the OCR warm-up, killing the whole overlay). In a utility process the blast
// radius is this file: main sees an 'exit' and simply shows no badges.
//
// Runs a small pool of tesseract workers so the three card titles of an offer
// recognize in parallel — main fires all three crops at once.
//
// Protocol (parentPort messages):
//   in:  { id, png: Uint8Array }  — a PNG-encoded title crop
//   out: { id, text }             — recognized text ('' on empty)
//        { id, error }            — recognition failed
//
// argv[2] = dir containing eng.traineddata.gz ('' → tesseract's CDN fallback)
// argv[3] = writable cache dir for the decompressed traineddata

const { createScheduler, createWorker } = require('tesseract.js')

const langDir = process.argv[2] || ''
const cacheDir = process.argv[3] || undefined
const POOL = 3 // one per card

const scheduler = createScheduler()
let readyPromise = null
function ensure() {
  if (!readyPromise)
    readyPromise = Promise.allSettled(
      Array.from({ length: POOL }, () =>
        createWorker('eng', 1, {
          cachePath: cacheDir,
          ...(langDir ? { langPath: langDir, gzip: true } : {}),
        }).then((w) => scheduler.addWorker(w)),
      ),
    ).then((results) => {
      // Degrade to fewer workers rather than fail; zero workers is the error.
      if (!results.some((r) => r.status === 'fulfilled'))
        throw results[0].status === 'rejected' ? results[0].reason : new Error('no OCR workers')
    })
  return readyPromise
}
ensure().catch(() => {}) // warm up; real errors surface per-request

process.parentPort.on('message', async (e) => {
  const { id, png } = e.data ?? {}
  try {
    await ensure()
    const { data } = await scheduler.addJob('recognize', Buffer.from(png))
    process.parentPort.postMessage({ id, text: data?.text ?? '' })
  } catch (err) {
    process.parentPort.postMessage({ id, error: String(err?.message ?? err) })
  }
})
