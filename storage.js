/**
 * Settings shape, migration, and chrome.storage.local access.
 *
 * Settings live under `slopFilterSettings`. Installs from before 1.2 stored
 * them under `doucheFilterSettings`; load() moves them to the new key once
 * and deletes the old one, so no one loses their muted-author list.
 *
 * Schema 2 moves categories INTO the blob (filters.js's SEED_CATEGORIES is
 * only ever the seed — every read after first install goes through the
 * stored categories array, never back through the seed). Every migration
 * function takes SEED as a defaulted parameter rather than closing over a
 * module-level require: in the browser, storage.js loads as a plain
 * <script> AFTER filters.js in the same isolated-world scope (manifest.json,
 * popup.html), so `const SEED_CATEGORIES = ...` at filters.js's top level is
 * already a declared name in that shared scope by the time this file runs.
 * A bare `const { SEED_CATEGORIES } = require(...)` here would be a
 * SyntaxError in that scope ("already been declared") — the same failure
 * content.js's header documents for `SEED_CATEGORIES`. Under Node, where this file
 * is required standalone with no ambient SEED_CATEGORIES global, the guarded
 * require below supplies it.
 */
const _SEED = (typeof module !== 'undefined' && typeof require !== 'undefined')
  ? require('./filters.js').SEED_CATEGORIES
  : SEED_CATEGORIES;

// Same guarded-require pattern as _SEED above: BLANK is filters.js's template
// marker, already a declared global in the browser's shared script scope by
// the time this file runs, but not ambient under Node.
const _BLANK = (typeof module !== 'undefined' && typeof require !== 'undefined')
  ? require('./filters.js').BLANK
  : BLANK;

const STORAGE_KEY = 'slopFilterSettings';
const LEGACY_KEY = 'doucheFilterSettings';

const clone = o => JSON.parse(JSON.stringify(o));

function seedCategories(SEED) {
  return SEED.map(c => ({ ...c, rules: c.rules ? [...c.rules] : undefined }));
}

// 1.1-era shape, kept only as a migration source — never read directly by
// content.js/popup.js once schema 2 exists.
const LEGACY_DEFAULTS = {
  version: 2,
  flagMode: 'collapse',
  filters: {
    aiSlop: true,
    fakeInsight: true,
    humbleBrag: true,
    engagementBait: true,
    hustleCulture: true,
    sponsored: true,
    hashtagOverload: true,
    emojiOverload: true,
  },
  thresholds: { hashtagOverload: 5, emojiOverload: 5 },
};

function buildDefaults(SEED) {
  return {
    schema: 2,
    flagMode: 'collapse',            // 'collapse' | 'label'
    categories: seedCategories(SEED),
    hidePromoted: true,
    hideBoosted: false,
    allowedPhrases: [],
    mutedAuthors: [],
    whitelistedAuthors: [],
    noticeHintSeen: false,           // the one-time pig/tag tip, dismissed forever
    // No stats here. A 1.0-era { hidden, allowed } tally lived in this blob with
    // a reader and no writer — a permanent 0 indistinguishable from the filter
    // being dead. 1.2's Activity counters go under their OWN storage key so
    // counter bumps don't re-serialise the whole settings blob (see PRD).
  };
}

const DEFAULTS = buildDefaults(_SEED);
// Kept for migrating old blobs and for the "no drift from filters.js" check —
// not part of the schema-2 shape itself.
DEFAULTS.filters = clone(LEGACY_DEFAULTS.filters);
DEFAULTS.thresholds = clone(LEGACY_DEFAULTS.thresholds);

/**
 * Stage 1: 1.0/1.1 field-name migration. Produces the pre-schema-2 shape
 * (filters/thresholds/mutedAuthors/allowedPhrases/flagMode) from anything
 * older. Stage 2 (upgradeToV2) lifts that shape — or a native schema-2 blob —
 * onto categories.
 */
function migrateLegacy(stored) {
  const out = clone(LEGACY_DEFAULTS);
  out.mutedAuthors = [];
  out.allowedPhrases = [];

  if (stored.filters && typeof stored.filters === 'object') {
    for (const [key, val] of Object.entries(stored.filters)) {
      // 1.0 called this filter linkedinGuru; 1.1 renamed it Fake Insight.
      const id = key === 'linkedinGuru' ? 'fakeInsight' : key;
      if (id in out.filters) out.filters[id] = !!val;
    }
  }
  // 1.0 key was blockedAuthors; 1.1 calls the action Mute.
  const muted = stored.mutedAuthors || stored.blockedAuthors;
  if (Array.isArray(muted)) out.mutedAuthors = muted.slice();

  if (Array.isArray(stored.allowedPhrases)) {
    out.allowedPhrases = stored.allowedPhrases.map(p => String(p).toLowerCase());
  }
  if (stored.thresholds) out.thresholds = { ...out.thresholds, ...stored.thresholds };
  if (stored.flagMode === 'label' || stored.flagMode === 'collapse') {
    out.flagMode = stored.flagMode;
  }
  return out;
}

/**
 * Stage 2: lift a (post-stage-1) legacy blob, or an existing schema-2 blob,
 * onto schema 2. Append-only by id: a seed category NEVER overwrites an
 * on/off flag or rule list the blob already has — it only fills in
 * categories the blob has never seen.
 */
function upgradeToV2(stored, SEED = _SEED) {
  const hasCategories = Array.isArray(stored.categories);

  let categories;
  if (!hasCategories) {
    // Build fresh from seeds, overlaying legacy filters/thresholds onto on/threshold.
    const filters = stored.filters || {};
    const thresholds = stored.thresholds || {};
    categories = seedCategories(SEED).map(cat => {
      const next = { ...cat };
      if (cat.id in filters) next.on = !!filters[cat.id];
      if (cat.counting && cat.id in thresholds) next.threshold = thresholds[cat.id];
      return next;
    });
  } else {
    // Already schema 2 (or upgraded once already): keep every existing
    // category untouched, append deep copies of any seed id not yet present.
    // One exception: sponsored moved from plain rule strings to a hardcoded
    // labs regex (its bare "#ad" rule matched inside #advertising — compile()
    // adds no word boundary), and a blob saved before that move carries the
    // poisoned rules array forever unless repaired here. Re-seed the category
    // shape, keeping only the user's on/off choice.
    categories = stored.categories.map(c => {
      if (c.id === 'sponsored' && Array.isArray(c.rules)) {
        const seed = SEED.find(s => s.id === 'sponsored');
        if (seed) return { ...seedCategories([seed])[0], on: !!c.on };
      }
      // Labs categories are not editable, so their name and definition always
      // come from the seed: a rename (Follow verb variants -> Follow Bait)
      // reaches settings saved before it.
      if (c.labs) {
        const seed = SEED.find(s => s.id === c.id);
        if (seed) return { ...c, name: seed.name, def: seed.def };
      }
      return { ...c, rules: c.rules ? [...c.rules] : undefined };
    });
    const seenIds = new Set(categories.map(c => c.id));
    for (const seed of SEED) {
      if (!seenIds.has(seed.id)) categories.push(...seedCategories([seed]));
    }
  }

  return {
    schema: 2,
    flagMode: (stored.flagMode === 'label' || stored.flagMode === 'collapse') ? stored.flagMode : 'collapse',
    categories,
    hidePromoted: 'hidePromoted' in stored ? !!stored.hidePromoted : true,
    hideBoosted: 'hideBoosted' in stored ? !!stored.hideBoosted : false,
    allowedPhrases: Array.isArray(stored.allowedPhrases) ? stored.allowedPhrases.slice() : [],
    mutedAuthors: Array.isArray(stored.mutedAuthors) ? stored.mutedAuthors.slice() : [],
    whitelistedAuthors: Array.isArray(stored.whitelistedAuthors) ? stored.whitelistedAuthors.slice() : [],
    noticeHintSeen: stored.noticeHintSeen === true,
  };
}

function migrate(stored = {}, SEED = _SEED) {
  if (!stored || typeof stored !== 'object') return upgradeToV2({}, SEED);
  if (Array.isArray(stored.categories)) return upgradeToV2(stored, SEED);

  // 1.0 keys with no 1.1 equivalent, intentionally dropped:
  //   customPhrases  — 1.1 uses a flat allowedPhrases array, different shape
  //   customFilters  — user-defined filter categories are not a 1.1 concept
  //   hiddenPosts    — per-session dismissals; stale entries would just reappear once
  //
  // migrateLegacy() only normalizes field NAMES (blockedAuthors->mutedAuthors,
  // linkedinGuru->fakeInsight) and hands back mutedAuthors/allowedPhrases/
  // flagMode already in their final shape. Its `filters`/`thresholds` output
  // is filled from LEGACY_DEFAULTS for every key, not just the ones the user's
  // blob actually set — so upgradeToV2's on/threshold overlay must read the
  // RAW stored.filters/stored.thresholds (renamed), never the synthesized
  // full object, or every never-touched key would appear "explicitly set."
  const stage1 = migrateLegacy(stored);
  const rawFilters = {};
  if (stored.filters && typeof stored.filters === 'object') {
    for (const [key, val] of Object.entries(stored.filters)) {
      const id = key === 'linkedinGuru' ? 'fakeInsight' : key;
      rawFilters[id] = !!val;
    }
  }
  stage1.filters = rawFilters;
  stage1.thresholds = stored.thresholds || {};
  return upgradeToV2(stage1, SEED);
}

function nextCustomId(categories) {
  let n = categories.filter(c => c.custom).length + 1;
  while (categories.some(c => c.id === `custom${n}`)) n++;
  return `custom${n}`;
}

function allowPhrase(settings, phrase) {
  const p = String(phrase).toLowerCase().trim();
  const next = clone(settings);
  if (p && !next.allowedPhrases.includes(p)) next.allowedPhrases.push(p);
  return next;
}

function unallowPhrase(settings, phrase) {
  const p = String(phrase).toLowerCase().trim();
  const next = clone(settings);
  next.allowedPhrases = next.allowedPhrases.filter(x => x !== p);
  return next;
}

function mute(settings, author) {
  const next = clone(settings);
  if (author && !next.mutedAuthors.includes(author)) next.mutedAuthors.push(author);
  return next;
}

function unmute(settings, author) {
  const next = clone(settings);
  next.mutedAuthors = next.mutedAuthors.filter(a => a !== author);
  return next;
}

function allowAuthor(settings, author) {
  if (author && settings.mutedAuthors.includes(author)) {
    throw new Error(`"${author}" is already muted — remove them from Muted people first, or use a different name.`);
  }
  const next = clone(settings);
  if (author && !next.whitelistedAuthors.includes(author)) next.whitelistedAuthors.push(author);
  return next;
}

function unallowAuthor(settings, author) {
  const next = clone(settings);
  next.whitelistedAuthors = next.whitelistedAuthors.filter(a => a !== author);
  return next;
}

function setHidePromoted(settings, on) {
  const next = clone(settings);
  next.hidePromoted = !!on;
  return next;
}

function setHideBoosted(settings, on) {
  const next = clone(settings);
  next.hideBoosted = !!on;
  return next;
}

function setCategoryOn(settings, id, on) {
  const next = clone(settings);
  const cat = next.categories.find(c => c.id === id);
  if (cat) cat.on = !!on;
  return next;
}

function setThreshold(settings, id, n) {
  const next = clone(settings);
  const cat = next.categories.find(c => c.id === id);
  const num = Number(n);
  if (cat && Number.isFinite(num)) cat.threshold = Math.max(1, Math.min(15, num));
  return next;
}

// Built-in categories can't go through upsertCustomCategory (custom-only) but
// still need their definition editable in place — the settings panel's Edit
// button works on every category, not just custom ones.
function setCategoryDef(settings, id, def) {
  const next = clone(settings);
  const cat = next.categories.find(c => c.id === id);
  if (cat) cat.def = def;
  return next;
}

function addRule(settings, id, text) {
  const rule = String(text).trim();
  const next = clone(settings);
  const cat = next.categories.find(c => c.id === id);
  if (cat && rule && !cat.rules.includes(rule)) cat.rules.push(rule);
  return next;
}

function removeRule(settings, id, text) {
  const next = clone(settings);
  const cat = next.categories.find(c => c.id === id);
  // Sentence templates (containing BLANK) are built-in and locked — the
  // settings panel renders them with no × for exactly this reason, but the
  // helper refuses independently rather than relying on the UI never asking.
  if (cat && !String(text).includes(_BLANK)) {
    cat.rules = cat.rules.filter(r => r !== text);
  }
  return next;
}

function upsertCustomCategory(settings, { id, name, def }) {
  const next = clone(settings);
  const existing = id ? next.categories.find(c => c.id === id && c.custom) : undefined;
  if (existing) {
    existing.name = name;
    existing.def = def;
  } else {
    next.categories.push({
      id: nextCustomId(next.categories),
      name,
      def,
      on: true,
      custom: true,
      rules: [],
    });
  }
  return next;
}

function deleteCategory(settings, id) {
  const next = clone(settings);
  next.categories = next.categories.filter(c => !(c.id === id && c.custom));
  return next;
}

async function load() {
  if (typeof chrome === 'undefined' || !chrome.storage) return clone(DEFAULTS);
  const blob = await chrome.storage.local.get([STORAGE_KEY, LEGACY_KEY]);
  if (!(LEGACY_KEY in blob)) return migrate(blob[STORAGE_KEY]);
  const settings = migrate(STORAGE_KEY in blob ? blob[STORAGE_KEY] : blob[LEGACY_KEY]);
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
  await chrome.storage.local.remove(LEGACY_KEY);
  return settings;
}

async function save(settings) {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: settings });
}

if (typeof module !== 'undefined') {
  module.exports = {
    STORAGE_KEY, DEFAULTS, migrate, upgradeToV2,
    allowPhrase, unallowPhrase, mute, unmute,
    allowAuthor, unallowAuthor,
    setHidePromoted, setHideBoosted,
    setCategoryOn, setThreshold, setCategoryDef, addRule, removeRule,
    upsertCustomCategory, deleteCategory,
    load, save,
  };
}
