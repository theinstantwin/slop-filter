/**
 * Settings shape, migration, and chrome.storage.local access.
 *
 * Settings live under `slopFilterSettings` (schema 2). Categories are stored in
 * the blob; SEED_CATEGORIES in filters.js only seeds a fresh install and
 * supplies built-in names. Every migration function takes SEED as a defaulted
 * parameter so tests can inject one.
 *
 * migrate() is the one place settings are made valid. Every path in (load, a
 * restored backup, a storage change from another tab) goes through it, so
 * readers never re-check types or clamp thresholds.
 *
 * Phrase on/off lives on the category: `cat.off` lists rules (exact strings
 * from `cat.rules`) that are kept but don't flag, so `rules` stays a plain
 * string array. Counters live under their own key (counters.js) so a counter
 * bump never re-serializes this blob.
 */
/**
 * @typedef {object} Category
 * @property {string} id
 * @property {string} name
 * @property {string} [def]
 * @property {boolean} on
 * @property {string[]} [rules]       phrases; absent on labs categories
 * @property {string[]} [off]         rules switched off, omitted when empty
 * @property {boolean} [counting]     fires on a count, not a phrase
 * @property {number} [threshold]     counting categories only
 * @property {string} [unit]          counting categories only, e.g. 'hashtags'
 * @property {boolean} [labs]         hardcoded regex, see LABS_PATTERNS
 * @property {boolean} [custom]
 */
/**
 * @typedef {object} Settings
 * @property {number} schema
 * @property {'collapse' | 'label'} flagMode
 * @property {Category[]} categories
 * @property {boolean} hidePromoted
 * @property {boolean} hideBoosted
 * @property {string[]} allowedPhrases   always [] since schema 2
 * @property {string[]} mutedAuthors
 * @property {string[]} whitelistedAuthors
 * @property {boolean} paused
 * @property {boolean} noticeHintSeen
 * @property {string[]} addedRules       "<catId>:<rule>" keys already applied
 * @property {Record<string, boolean>} [filters]     pre-schema-2 only
 * @property {Record<string, number>} [thresholds]   pre-schema-2 only
 */

const _filters = typeof module !== 'undefined' ? module.require('./filters.js') : globalThis.SlopFilter;
const _SEED = _filters.SEED_CATEGORIES;
const _BLANK = _filters.BLANK;

const STORAGE_KEY = 'slopFilterSettings';
const LEGACY_KEY = 'doucheFilterSettings';

const clone = o => JSON.parse(JSON.stringify(o));

function seedCategories(SEED) {
  return SEED.map(c => ({ ...c, rules: c.rules ? [...c.rules] : undefined }));
}

// The pre-schema-2 shape, kept only as a migration source.
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

// Phrases added to built-in categories after release. Each is applied to stored
// settings once (tracked as "<catId>:<rule>" in addedRules), so a phrase the
// user deletes later stays deleted.
const ADDED_RULES = {
  selfPromotion: ['follow for the latest', 'follow us for'],
  aiSlop: ['most people get this wrong', 'in the ever-evolving landscape', 'unlocking new possibilities'],
  fakeInsight: ['nobody tells you', 'the uncomfortable truth', "everything you've been told",
    "is wrong. here's why", 'is half right', 'harsh truth:'],
  engagementBait: ['and i love it. why?', 'busy founders:'],
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
    paused: false,                   // judge and hide nothing
    noticeHintSeen: false,           // the one-time pig/tag tip
    addedRules: Object.entries(ADDED_RULES).flatMap(([id, rules]) => rules.map(r => `${id}:${r}`)),
  };
}

// Threshold range for counting filters: below 2 nearly every post would flag,
// above 15 it would effectively never fire.
const THRESHOLD_MIN = 2;
const THRESHOLD_MAX = 15;

/** @param {unknown} n @param {number} [fallback] @returns {number} */
function clampThreshold(n, fallback = THRESHOLD_MIN) {
  const num = Number(n);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, Math.round(num)));
}

const DEFAULTS = buildDefaults(_SEED);
// Legacy fields, used by migration and by a test that checks for drift from
// filters.js. Not part of the schema-2 shape.
DEFAULTS.filters = clone(LEGACY_DEFAULTS.filters);
DEFAULTS.thresholds = clone(LEGACY_DEFAULTS.thresholds);

/**
 * Stage 1: renames legacy fields into the pre-schema-2 shape (filters,
 * thresholds, mutedAuthors, allowedPhrases, flagMode). upgradeToV2 then lifts
 * that shape onto categories.
 */
function migrateLegacy(stored) {
  const out = clone(LEGACY_DEFAULTS);
  out.mutedAuthors = [];
  out.allowedPhrases = [];

  if (stored.filters && typeof stored.filters === 'object') {
    for (const [key, val] of Object.entries(stored.filters)) {
      // Pre-1.1 id.
      const id = key === 'linkedinGuru' ? 'fakeInsight' : key;
      if (id in out.filters) out.filters[id] = !!val;
    }
  }
  // Pre-1.1 key.
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
 * Migrates the pre-1.2 global allowedPhrases list: an entry equal to a plain
 * rule (case-insensitive) turns that rule off in every category that has it.
 * Other entries are dropped. Text caught by a ___ template or a Labs pattern
 * has no checkbox to move to, and a hidden suppression list the user can't see
 * or undo is worse than letting the phrase flag again.
 * Mutates `categories`, which must already be normalized copies.
 */
function liftAllowedPhrases(categories, allowed) {
  for (const entry of allowed) {
    const p = String(entry).toLowerCase().trim();
    for (const cat of categories) {
      if (cat.counting || cat.labs || !Array.isArray(cat.rules)) continue;
      for (const rule of cat.rules) {
        if (rule.includes(_BLANK) || rule.toLowerCase() !== p) continue;
        cat.off = cat.off || [];
        if (!cat.off.includes(rule)) cat.off.push(rule);
      }
    }
  }
}

// Seed definitions that have since been rewritten. A stored definition still
// equal to one of these was never edited, so it takes the new seed text.
const RETIRED_DEFS = {
  selfPromotion: ['Pitching a follow instead of standing on its own'],
};

const strings = a => (Array.isArray(a) ? a.filter(x => typeof x === 'string') : []);

// Returns one category in its valid shape, as a copy sharing nothing with the
// input (later steps push into rules/off), or null if it can't be a category.
// Unknown fields are kept.
/** @param {any} c @param {Category[]} SEED @returns {Category | null} */
function normalizeCategory(c, SEED) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string') return null;
  const out = { ...c, name: typeof c.name === 'string' ? c.name : c.id, on: !!c.on };
  if (Array.isArray(c.rules)) out.rules = strings(c.rules); else delete out.rules;
  if (Array.isArray(c.off)) out.off = strings(c.off); else delete out.off;
  if (c.counting) {
    const seed = SEED.find(s => s.id === c.id);
    out.threshold = clampThreshold(c.threshold, seed && seed.threshold);
  }
  return out;
}

/**
 * Stage 2: lifts a stage-1 legacy blob, or an existing schema-2 blob, onto
 * schema 2. Append-only by id: a seed category never overwrites a stored
 * on/off flag or rule list, it only adds categories the blob hasn't seen.
 * @param {any} stored @param {Category[]} [SEED] @returns {Settings}
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
      if (cat.counting && cat.id in thresholds) next.threshold = clampThreshold(thresholds[cat.id], cat.threshold);
      return next;
    });
  } else {
    // Keep stored categories; append copies of seed ids not yet present.
    // Exception: "sponsored" moved from plain rules to a Labs regex because its
    // "#ad" rule matched inside #advertising. A blob saved before that still
    // has the old rules array, so re-seed it and keep only the on/off choice.
    categories = stored.categories.map(c => normalizeCategory(c, SEED)).filter(Boolean).map(c => {
      if (c.id === 'sponsored' && Array.isArray(c.rules)) {
        const seed = SEED.find(s => s.id === 'sponsored');
        if (seed) return { ...seedCategories([seed])[0], on: !!c.on };
      }
      // Labs categories aren't editable, so name and definition track the seed.
      if (c.labs) {
        const seed = SEED.find(s => s.id === c.id);
        if (seed) return { ...c, name: seed.name, def: seed.def };
      }
      // Built-in names can't be edited, so they track the seed. A definition
      // refreshes only if the user never edited it.
      if (!c.custom) {
        const seed = SEED.find(s => s.id === c.id);
        if (seed) {
          const next = { ...c, name: seed.name };
          if (RETIRED_DEFS[c.id] && RETIRED_DEFS[c.id].includes(c.def)) next.def = seed.def;
          return next;
        }
      }
      return c;
    });
    const seenIds = new Set(categories.map(c => c.id));
    for (const seed of SEED) {
      if (!seenIds.has(seed.id)) categories.push(...seedCategories([seed]));
    }
  }

  liftAllowedPhrases(categories, Array.isArray(stored.allowedPhrases) ? stored.allowedPhrases : []);

  // One-time additions of new built-in phrases (see ADDED_RULES).
  const addedRules = strings(stored.addedRules);
  for (const [catId, rules] of Object.entries(ADDED_RULES)) {
    const cat = categories.find(c => c.id === catId);
    for (const rule of rules) {
      const key = `${catId}:${rule}`;
      if (addedRules.includes(key)) continue;
      if (cat && Array.isArray(cat.rules) && !cat.rules.includes(rule)) cat.rules.push(rule);
      addedRules.push(key);
    }
  }

  return {
    schema: 2,
    flagMode: (stored.flagMode === 'label' || stored.flagMode === 'collapse') ? stored.flagMode : 'collapse',
    categories,
    hidePromoted: 'hidePromoted' in stored ? !!stored.hidePromoted : true,
    hideBoosted: 'hideBoosted' in stored ? !!stored.hideBoosted : false,
    allowedPhrases: [],
    mutedAuthors: strings(stored.mutedAuthors),
    whitelistedAuthors: strings(stored.whitelistedAuthors),
    paused: stored.paused === true,
    noticeHintSeen: stored.noticeHintSeen === true,
    addedRules,
  };
}

/** @param {any} [stored] @param {Category[]} [SEED] @returns {Settings} */
function migrate(stored = {}, SEED = _SEED) {
  if (!stored || typeof stored !== 'object') return upgradeToV2({}, SEED);
  if (Array.isArray(stored.categories)) return upgradeToV2(stored, SEED);

  // Legacy keys customPhrases, customFilters and hiddenPosts have no equivalent
  // and are dropped.
  //
  // migrateLegacy fills `filters`/`thresholds` with defaults for every key, so
  // the overlay in upgradeToV2 must read the raw stored values (ids renamed).
  // Otherwise every untouched key would look explicitly set.
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

// Turns one rule on or off without deleting it. `off` is omitted when empty.
function setRuleOn(settings, id, rule, on) {
  const next = clone(settings);
  const cat = next.categories.find(c => c.id === id);
  if (!cat || !(cat.rules || []).includes(rule)) return next;
  const off = (cat.off || []).filter(r => r !== rule);
  if (!on) off.push(rule);
  if (off.length) cat.off = off; else delete cat.off;
  return next;
}

/** @param {Settings} settings @param {string} author @returns {Settings} */
function mute(settings, author) {
  const next = clone(settings);
  if (author && !next.mutedAuthors.includes(author)) next.mutedAuthors.push(author);
  return next;
}

/** @param {Settings} settings @param {string} author @returns {Settings} */
function unmute(settings, author) {
  const next = clone(settings);
  next.mutedAuthors = next.mutedAuthors.filter(a => a !== author);
  return next;
}

/** Adds an author to Trusted People; throws if they are muted. */
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

/** @param {Settings} settings @param {string} id @param {unknown} n @returns {Settings} */
function setThreshold(settings, id, n) {
  const next = clone(settings);
  const cat = next.categories.find(c => c.id === id);
  const num = Number(n);
  if (cat && Number.isFinite(num)) cat.threshold = clampThreshold(num);
  return next;
}

// Edits a definition on any category; upsertCustomCategory only handles custom ones.
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
  // Sentence templates (containing BLANK) are built-in and locked. The UI hides
  // their delete button, and this refuses independently of the UI.
  if (cat && !String(text).includes(_BLANK)) {
    cat.rules = cat.rules.filter(r => r !== text);
    if (cat.off) {
      cat.off = cat.off.filter(r => r !== text);
      if (!cat.off.length) delete cat.off;
    }
  }
  return next;
}

/** Creates a custom category, or renames and redefines an existing one by id. */
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

/** Loads settings, migrating the pre-1.2 `doucheFilterSettings` key to the current one once. */
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

Object.assign(typeof module !== 'undefined' ? module.exports : (globalThis.SlopFilter ||= {}), {
    STORAGE_KEY, DEFAULTS, THRESHOLD_MIN, THRESHOLD_MAX, clampThreshold, migrate, upgradeToV2,
    setRuleOn, mute, unmute,
    allowAuthor, unallowAuthor,
    setHidePromoted, setHideBoosted,
    setCategoryOn, setThreshold, setCategoryDef, addRule, removeRule,
    upsertCustomCategory, deleteCategory,
    load, save,
});
