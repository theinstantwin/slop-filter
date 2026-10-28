/**
 * Settings shape, migration, and chrome.storage.local access.
 *
 * Settings live under `slopFilterSettings`. Installs from before 1.2 stored
 * them under `doucheFilterSettings`; load() moves them to the new key once
 * and deletes the old one, so no one loses their muted-author list.
 *
 * Phrase on/off lives on the rule's own category: `cat.off` is an optional
 * array of rule strings (exact, as they appear in `cat.rules`) that are kept
 * but do not flag. A rule is enabled unless it is listed in `off`, so `rules`
 * stays a plain string array and every existing reader keeps working.
 * filters.js findMatches skips rules listed in `off`; Settings shows each as a
 * checkbox. The old global `allowedPhrases` list is gone: migration lifts
 * every entry it can map onto a rule and drops the rest (see
 * liftAllowedPhrases), so the field always comes back as [].
 *
 * migrate() is the one place settings are made valid. Every path in (load,
 * a restored backup, a storage change from another tab) goes through it, so
 * readers never re-check types or clamp thresholds themselves.
 *
 * Schema 2 moves categories INTO the blob (filters.js's SEED_CATEGORIES is
 * only ever the seed — every read after first install goes through the
 * stored categories array, never back through the seed). Every migration
 * function takes SEED as a defaulted parameter so tests can inject one.
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

// Phrases added to a built-in category after release. Each is added once to
// stored settings (keyed "<catId>:<rule>" in addedRules), so a phrase the
// user later deletes is never put back.
const ADDED_RULES = {
  selfPromotion: ['follow for the latest', 'follow us for'],
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
    paused: false,                   // popup "Pause filtering": judge and hide nothing
    noticeHintSeen: false,           // the one-time pig/tag tip, dismissed forever
    addedRules: Object.entries(ADDED_RULES).flatMap(([id, rules]) => rules.map(r => `${id}:${r}`)),
    // No stats here. A 1.0-era { hidden, allowed } tally lived in this blob with
    // a reader and no writer — a permanent 0 indistinguishable from the filter
    // being dead. 1.2's Activity counters go under their OWN storage key so
    // counter bumps don't re-serialise the whole settings blob (see PRD).
  };
}

// The range a counting filter's threshold may take. Below 2 a filter would
// flag nearly every post; above 15 it could never fire.
const THRESHOLD_MIN = 2;
const THRESHOLD_MAX = 15;

/** @param {unknown} n @param {number} [fallback] @returns {number} */
function clampThreshold(n, fallback = THRESHOLD_MIN) {
  const num = Number(n);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(THRESHOLD_MIN, Math.min(THRESHOLD_MAX, Math.round(num)));
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
 * "Stop flagging this phrase" used to push the matched text onto a global
 * allowedPhrases list. Phrase on/off now lives on the rule (`cat.off`), so
 * every allowed entry that equals a plain rule in a category (case-insensitive)
 * turns that rule off in each category that has it, and leaves the list.
 * Entries that match no plain rule are dropped: text caught by a ___ sentence
 * template or a Labs pattern has no checkbox to move to, and a hidden
 * suppression list the user can neither see nor undo is worse than letting
 * the phrase flag again. Mutates `categories` (already normalized copies).
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

/**
 * Stage 2: lift a (post-stage-1) legacy blob, or an existing schema-2 blob,
 * onto schema 2. Append-only by id: a seed category NEVER overwrites an
 * on/off flag or rule list the blob already has — it only fills in
 * categories the blob has never seen.
 */
// Seed definitions that have since been rewritten. A stored definition still
// equal to one of these was never edited, so it takes the new seed text.

const RETIRED_DEFS = {
  selfPromotion: ['Pitching a follow instead of standing on its own'],
};

const strings = a => (Array.isArray(a) ? a.filter(x => typeof x === 'string') : []);

// One category in its valid shape, as a copy that shares nothing with the
// input (later steps push into rules/off). Unknown fields ride along. Returns
// null for something that cannot be a category at all.
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

/** @param {any} stored @param {Category[]} [SEED] @returns {Settings} */
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
    // Already schema 2 (or upgraded once already): keep every existing
    // category untouched, append deep copies of any seed id not yet present.
    // One exception: sponsored moved from plain rule strings to a hardcoded
    // labs regex (its bare "#ad" rule matched inside #advertising — compile()
    // adds no word boundary), and a blob saved before that move carries the
    // poisoned rules array forever unless repaired here. Re-seed the category
    // shape, keeping only the user's on/off choice.
    categories = stored.categories.map(c => normalizeCategory(c, SEED)).filter(Boolean).map(c => {
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
      // Built-in names can't be edited, so they always come from the seed
      // (a rename like "Self-promotion CTA" -> "Self Promotion" reaches
      // everyone). A definition is refreshed only if the user never edited it.
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

// Turn one rule on or off without deleting it. `off` is omitted when empty.
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
    if (cat.off) {
      cat.off = cat.off.filter(r => r !== text);
      if (!cat.off.length) delete cat.off;
    }
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

Object.assign(typeof module !== 'undefined' ? module.exports : (globalThis.SlopFilter ||= {}), {
    STORAGE_KEY, DEFAULTS, THRESHOLD_MIN, THRESHOLD_MAX, clampThreshold, migrate, upgradeToV2,
    setRuleOn, mute, unmute,
    allowAuthor, unallowAuthor,
    setHidePromoted, setHideBoosted,
    setCategoryOn, setThreshold, setCategoryDef, addRule, removeRule,
    upsertCustomCategory, deleteCategory,
    load, save,
});
