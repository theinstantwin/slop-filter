/**
 * Options page, Activity panel. A classic script loaded after settings.js, so
 * `st`, `el` and the other panels' functions are page globals (under Node,
 * settings.js publishes them on globalThis first).
 */

/**
 * Pure model for the panel (no DOM). Phrase counts come from st.counters, a
 * snapshot read once at page load. Category totals are summed from each
 * category's phrases, not stored. Promoted/Boosted match no phrase (a hidden ad
 * fires no rule), so their stored counts show as rows only when nonzero.
 * Returns { byCategory, byPhrase }.
 */
function activityModel(counters, categories) {
  // phrase -> category name; the first category in display order wins when a
  // phrase appears in several. Keys are lowercase: rules are stored lowercase
  // but counters keep the post's casing ("Hot take"), and without folding a
  // capitalized catch would land in "(removed)" like a genuinely deleted phrase.
  const owner = new Map();
  for (const cat of categories) {
    if (!cat.rules) continue; // counting categories (hashtags etc.) own no phrases
    for (const phrase of cat.rules) {
      const key = phrase.toLowerCase();
      if (!owner.has(key)) owner.set(key, cat.name);
    }
  }

  // A counting category has no single phrase: findMatches synthesizes one per
  // exact count ("5 hashtags", "6 hashtags"), which would fragment into a
  // permanent By-phrase row per count. Map each unit back to its category and
  // roll every "<n> <unit>" counter into one By-category total.
  const unitToCategory = new Map();
  for (const cat of categories) {
    if (cat.counting && cat.unit) unitToCategory.set(cat.unit, cat.name);
  }
  const countingPhraseRe = /^\d+ (.+)$/;

  // A phrase with no typed rule may still belong to a category (Sponsored and
  // Labs match by pattern, templates by "___"). Ask the matcher with every
  // category forced on before calling it removed.
  const matchAll = categories.filter(c => !c.counting).map(c => ({ ...c, on: true, off: [] }));
  const ownerOf = phrase => {
    const typed = owner.get(phrase.toLowerCase());
    if (typed) return typed;
    const hit = st.findMatches ? st.findMatches(phrase, { categories: matchAll })[0] : null;
    return hit ? hit.filterName : '(removed)';
  };

  // Counters keep the post's own casing ("#ad", "#Ad"); fold them into one row,
  // shown in whichever casing was caught most.
  const folded = new Map();
  for (const [phrase, { caught, readPast }] of Object.entries(counters.phrases || {})) {
    const key = phrase.toLowerCase();
    const f = folded.get(key);
    if (!f) { folded.set(key, { phrase, caught, readPast, top: caught }); continue; }
    if (caught > f.top) { f.phrase = phrase; f.top = caught; }
    f.caught += caught; f.readPast += readPast;
  }

  const catTotals = new Map();
  const byPhrase = [];
  for (const { phrase, caught, readPast } of folded.values()) {
    const countingMatch = phrase.match(countingPhraseRe);
    const countingCategoryName = countingMatch ? unitToCategory.get(countingMatch[1]) : undefined;
    if (countingCategoryName) {
      catTotals.set(countingCategoryName, (catTotals.get(countingCategoryName) || 0) + caught);
      continue; // counting categories get no By-phrase row
    }

    const categoryName = ownerOf(phrase);
    if (categoryName !== '(removed)') {
      catTotals.set(categoryName, (catTotals.get(categoryName) || 0) + caught);
    }
    const misfiring = caught >= 10 && readPast / caught >= 0.30;
    byPhrase.push({ phrase, categoryName, caught, readPast, misfiring });
  }
  byPhrase.sort((a, b) => b.caught - a.caught);

  const byCategory = [...catTotals].map(([name, caught]) => ({ name, caught }));
  // Promoted/Boosted are stored counts; zero renders no row.
  if (counters.promoted) byCategory.push({ name: 'Promoted', caught: counters.promoted });
  if (counters.boosted) byCategory.push({ name: 'Boosted', caught: counters.boosted });
  byCategory.sort((a, b) => b.caught - a.caught);

  return { byCategory, byPhrase };
}

/** Draws the By-category bars and By-phrase rows from activityModel. */
function renderStats(doc) {
  const model = activityModel(st.counters, st.settings.categories);
  const max = model.byCategory[0]?.caught || 1;

  const chost = doc.getElementById('cat-stats');
  chost.textContent = '';
  for (const c of model.byCategory) {
    const row = el('div', 'cstat');
    row.appendChild(el('div', 'cstat-name', c.name));
    const track = el('div', 'cstat-track');
    const bar = el('div', 'cstat-bar');
    bar.style.width = Math.min(100, c.caught / max * 100) + '%';
    track.appendChild(bar);
    row.appendChild(track);
    row.appendChild(el('span', 'cstat-n', String(c.caught)));
    chost.appendChild(row);
  }

  const phost = doc.getElementById('phrase-stats');
  phost.textContent = '';
  for (const p of model.byPhrase) {
    const row = el('div', 'pstat' + (p.misfiring ? ' misfiring' : ''));
    row.appendChild(el('div', 'pstat-phrase', p.phrase));
    if (p.misfiring) {
      row.appendChild(el('span', 'pstat-warn', `read past ${p.readPast}× — probably too broad`));
    }
    row.appendChild(el('span', 'pstat-cat', p.categoryName));
    row.appendChild(el('span', 'pstat-n', String(p.caught)));
    phost.appendChild(row);
  }
}

if (typeof module !== 'undefined') {
  Object.assign(module.exports, {
    activityModel, renderStats
  });
}
