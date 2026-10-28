/**
 * Activity writer. Its own storage key — `sfCounters`, never
 * `slopFilterSettings` (see storage.js's header: counter bumps must not
 * re-serialise the whole settings blob on every match).
 *
 * Shape: { phrases: { [phrase]: { caught, readPast } }, promoted, boosted }.
 *
 * record() only touches an in-memory pending map — cheap, called once per
 * match on every scan. flush() is the sole place that talks to storage, and
 * it always does a read-modify-write of THIS KEY ONLY, merging its pending
 * deltas onto whatever is already stored rather than overwriting it — two
 * tabs, or two flushes in the same session, must not stomp each other's
 * counts. scheduleFlush() debounces repeated record() calls (LinkedIn's feed
 * fires a scan every ~400ms while scrolling) down to one write, and is also
 * wired to `visibilitychange` so backgrounding the tab flushes immediately
 * instead of losing whatever is pending when the tab is later discarded.
 *
 * Loaded after storage.js and before notice.js (manifest.json).
 */

const COUNTERS_KEY = 'sfCounters';
// When a post was last caught: one number under its own key, so the popup's
// pig can react to a catch from the last few seconds. Not part of sfCounters
// (that blob is debounced to 2s and merged; this must land at once).
const LAST_CAUGHT_KEY = 'sfLastCaughtAt';
const LAST_CAUGHT_THROTTLE_MS = 1000;
let lastCaughtWritten = 0;
const DEBOUNCE_MS = 2000;
// Blank rules ("drop a ___ below") catch a different phrase almost every
// time, so the phrase map would grow for as long as the extension is
// installed. Past this many, the least-caught phrases are dropped at flush.
const MAX_PHRASES = 500;

/**
 * @typedef {object} Counters
 * @property {Record<string, { caught: number, readPast: number }>} phrases
 * @property {number} promoted
 * @property {number} boosted
 */

/** @returns {Counters} */
function scEmptyCounters() {
  return { phrases: {}, promoted: 0, boosted: 0 };
}

// Any stored or imported counters blob reduced to the sfCounters shape with
// whole non-negative numbers, so a hand-edited file or a corrupted store
// cannot break the Activity panel or poison a flush.
/** @param {any} raw @returns {Counters} */
function normalizeCounters(raw) {
  const n = v => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const phrases = {};
  const src = raw && raw.phrases && typeof raw.phrases === 'object' && !Array.isArray(raw.phrases) ? raw.phrases : {};
  for (const [phrase, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && phrase !== '__proto__') phrases[phrase] = { caught: n(v.caught), readPast: n(v.readPast) };
  }
  return { phrases, promoted: n(raw && raw.promoted), boosted: n(raw && raw.boosted) };
}

// Pending in-memory deltas since the last flush. Same shape as stored
// counters, but represents ONLY what has not yet been written.
let pending = scEmptyCounters();
let timer = null;

function scPendingPhrase(phrase) {
  if (!pending.phrases[phrase]) pending.phrases[phrase] = { caught: 0, readPast: 0 };
  return pending.phrases[phrase];
}

/**
 * kind: 'caught' | 'readPast' | 'promoted' | 'boosted'. phrase required for
 * the first two. In-memory only — callers always follow with scheduleFlush().
 */
function record(kind, phrase) {
  if (kind === 'caught' || kind === 'readPast') {
    scPendingPhrase(phrase)[kind] += 1;
  } else if (kind === 'promoted' || kind === 'boosted') {
    pending[kind] += 1;
  }
}

/**
 * An extension reload (dev refresh, Web Store auto-update) orphans content
 * scripts still injected in open tabs: chrome.* calls then throw "Extension
 * context invalidated." For an orphaned script the right move is a silent
 * no-op — the fresh script owns counting — so that one error is swallowed;
 * anything else still propagates.
 */
function scContextDead(err) {
  return /context invalidated/i.test(err && err.message || '');
}

async function scReadStored() {
  if (typeof chrome === 'undefined' || !chrome.storage) return scEmptyCounters();
  let blob;
  try {
    blob = await chrome.storage.local.get([COUNTERS_KEY]);
  } catch (err) {
    if (scContextDead(err)) return scEmptyCounters();
    throw err;
  }
  return normalizeCounters(blob[COUNTERS_KEY]);
}

/**
 * Read-modify-write of sfCounters ONLY, merging the pending deltas onto
 * whatever is currently stored, then clearing pending. Never touches
 * slopFilterSettings.
 */
async function flush() {
  const current = await scReadStored();
  const merged = {
    phrases: { ...current.phrases },
    promoted: current.promoted + pending.promoted,
    boosted: current.boosted + pending.boosted,
  };
  for (const [phrase, delta] of Object.entries(pending.phrases)) {
    const existing = merged.phrases[phrase] || { caught: 0, readPast: 0 };
    merged.phrases[phrase] = {
      caught: existing.caught + delta.caught,
      readPast: existing.readPast + delta.readPast,
    };
  }

  pending = scEmptyCounters();
  scTrim(merged.phrases);

  if (typeof chrome === 'undefined' || !chrome.storage) return;
  try {
    await chrome.storage.local.set({ [COUNTERS_KEY]: merged });
  } catch (err) {
    if (!scContextDead(err)) throw err;
  }
}

function scTrim(phrases) {
  const keys = Object.keys(phrases);
  if (keys.length <= MAX_PHRASES) return;
  keys.sort((a, b) => phrases[a].caught - phrases[b].caught);
  for (const k of keys.slice(0, keys.length - MAX_PHRASES)) delete phrases[k];
}

function scheduleFlush() {
  if (typeof clearTimeout !== 'undefined' && timer) clearTimeout(timer);
  if (typeof setTimeout === 'undefined') return;
  timer = setTimeout(() => { flush(); }, DEBOUNCE_MS);
}

/** Stamps "a post was caught just now". At most one write a second. */
function markCaught() {
  const now = Date.now();
  if (now - lastCaughtWritten < LAST_CAUGHT_THROTTLE_MS) return;
  lastCaughtWritten = now;
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  try {
    const p = chrome.storage.local.set({ [LAST_CAUGHT_KEY]: now });
    if (p && p.catch) p.catch(() => {});
  } catch (err) {
    if (!scContextDead(err)) throw err;
  }
}

/** For the settings Activity panel. */
async function readAll() {
  return scReadStored();
}

// Guarded: requiring this file under Node (no `document`) must not throw.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

Object.assign(typeof module !== 'undefined' ? module.exports : (globalThis.SlopFilter ||= {}), {
  record, flush, scheduleFlush, readAll, markCaught, normalizeCounters, LAST_CAUGHT_KEY, MAX_PHRASES,
});
