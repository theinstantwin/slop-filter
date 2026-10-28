/**
 * Activity writer. Counters live under their own key, `sfCounters`, so a
 * counter bump never re-serializes the settings blob.
 * Shape: { phrases: { [phrase]: { caught, readPast } }, promoted, boosted }.
 *
 * record() only updates an in-memory map. flush() is the only code that
 * touches storage: it reads this key, adds the pending deltas to what is
 * stored, and writes back, so two tabs can't overwrite each other's counts.
 * scheduleFlush() debounces writes (the feed scans about every 400ms while
 * scrolling); a hidden tab flushes immediately so a discarded tab loses nothing.
 *
 * Loaded after storage.js and before notice.js.
 */

const COUNTERS_KEY = 'sfCounters';
// Timestamp of the latest catch, under its own key so the popup pig can react
// within seconds. sfCounters is debounced and merged, so it can't carry this.
const LAST_CAUGHT_KEY = 'sfLastCaughtAt';
const LAST_CAUGHT_THROTTLE_MS = 1000;
let lastCaughtWritten = 0;
const DEBOUNCE_MS = 2000;
// Blank rules ("drop a ___ below") catch a different phrase almost every time,
// so the map would grow without bound. Past this, flush drops the least-caught.
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

/**
 * Coerces any stored or imported blob to the sfCounters shape with whole
 * non-negative numbers, so a hand-edited file can't break the Activity panel.
 * @param {any} raw @returns {Counters} */
function normalizeCounters(raw) {
  const n = v => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);
  const phrases = {};
  const src = raw && raw.phrases && typeof raw.phrases === 'object' && !Array.isArray(raw.phrases) ? raw.phrases : {};
  for (const [phrase, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && phrase !== '__proto__') phrases[phrase] = { caught: n(v.caught), readPast: n(v.readPast) };
  }
  return { phrases, promoted: n(raw && raw.promoted), boosted: n(raw && raw.boosted) };
}

// Deltas since the last flush, not totals.
let pending = scEmptyCounters();
let timer = null;

function scPendingPhrase(phrase) {
  if (!pending.phrases[phrase]) pending.phrases[phrase] = { caught: 0, readPast: 0 };
  return pending.phrases[phrase];
}

/**
 * Counts one event in memory; callers follow with scheduleFlush().
 * kind: 'caught' | 'readPast' | 'promoted' | 'boosted'. phrase is required
 * for the first two.
 */
function record(kind, phrase) {
  if (kind === 'caught' || kind === 'readPast') {
    scPendingPhrase(phrase)[kind] += 1;
  } else if (kind === 'promoted' || kind === 'boosted') {
    pending[kind] += 1;
  }
}

/**
 * An extension reload orphans content scripts already injected in open tabs,
 * and their chrome.* calls throw "Extension context invalidated". The new
 * script owns counting, so that one error is swallowed; others propagate.
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

/** Adds the pending deltas to the stored counters, writes them, clears pending. */
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

// Guarded so the file loads under Node tests, which have no `document`.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

Object.assign(typeof module !== 'undefined' ? module.exports : (globalThis.SlopFilter ||= {}), {
  record, flush, scheduleFlush, readAll, markCaught, normalizeCounters, LAST_CAUGHT_KEY, MAX_PHRASES,
});
