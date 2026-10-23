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
 * Loading model: joins the shared content-script scope like storage.js —
 * guarded require under Node, plain globals in the browser (manifest.json
 * loads this after storage.js, before notice.js).
 */

const COUNTERS_KEY = 'sfCounters';
const DEBOUNCE_MS = 2000;

function scEmptyCounters() {
  return { phrases: {}, promoted: 0, boosted: 0 };
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
  const stored = blob[COUNTERS_KEY];
  if (!stored || typeof stored !== 'object') return scEmptyCounters();
  return {
    phrases: stored.phrases && typeof stored.phrases === 'object' ? stored.phrases : {},
    promoted: stored.promoted || 0,
    boosted: stored.boosted || 0,
  };
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

  if (typeof chrome === 'undefined' || !chrome.storage) return;
  try {
    await chrome.storage.local.set({ [COUNTERS_KEY]: merged });
  } catch (err) {
    if (!scContextDead(err)) throw err;
  }
}

function scheduleFlush() {
  if (typeof clearTimeout !== 'undefined' && timer) clearTimeout(timer);
  if (typeof setTimeout === 'undefined') return;
  timer = setTimeout(() => { flush(); }, DEBOUNCE_MS);
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

// Own namespace, matching content.js's `sf` and storage.js's pattern of a
// single uniquely-named binding — `sc` collides with nothing dom/filters/
// storage declare, so counters.js is safe to load ahead of notice/menu/
// content in the shared content-script scope.
const sc = { record, flush, scheduleFlush, readAll };

if (typeof module !== 'undefined') {
  module.exports = { record, flush, scheduleFlush, readAll };
}
