/**
 * Options page, Activity panel. Classic script loaded by settings.html after settings.js,
 * so `st`, `el` and the other panels' functions are shared page globals. Under
 * Node, settings.js publishes them on globalThis before requiring this file.
 */
/* ---- Activity panel (Task 10) ----
   The phrase→category map comes from st.settings.categories (live, as-configured), and the
   raw counts come from st.counters (a snapshot read once on page load — see
   readAll() below, no chrome.storage.onChanged listener per PRD).

   Category totals are DERIVED (summed from that category's owned phrases),
   never read from a stored per-category counter — the exception is
   Promoted/Boosted, which match no phrase (a hidden ad has no rule that
   fired), so their counts are the raw stored numbers and only rendered as a
   row when nonzero.

   activityModel is exported and pure (no DOM) so Task 10's boundary cases —
   9-catch/30%, 10/30%, 10/29%, derived-sum, removed-phrase handling — are
   unit-testable without a document. */
function activityModel(counters, categories) {
  // phrase -> categoryName, first-match-wins in category display order. A
  // phrase can appear in more than one category (a user could add the same
  // text twice) — it is attributed to whichever category lists it first,
  // matching the order categories render in the Categories panel.
  //
  // Keyed lowercase: rules are stored lowercase ("hot take", "#ad"), but a
  // counter's phrase preserves the ACTUAL matched text's original casing
  // from the post ("Hot take", "#Ad") — findMatches() is already
  // case-insensitive (every pattern carries the 'i' flag) and never
  // normalizes what it returns. Without lowercasing both sides here, any
  // post that capitalized a phrase differently than the stored rule missed
  // this lookup and fell into the same "(removed)" bucket as a genuinely
  // deleted phrase — indistinguishable from real removal.
  const owner = new Map();
  for (const cat of categories) {
    if (!cat.rules) continue; // counting categories (hashtags etc.) own no phrases
    for (const phrase of cat.rules) {
      const key = phrase.toLowerCase();
      if (!owner.has(key)) owner.set(key, cat.name);
    }
  }

  // Counting categories (Hashtag/Emoji Overload) don't have a single
  // triggering phrase — findMatches() synthesizes one per exact count
  // ("5 hashtags", "6 hashtags", "16 hashtags", ...), so without this every
  // distinct count a post ever hit would fragment into its own permanent
  // By-phrase row forever, with no way to tell they're all the same
  // category crossing the same threshold. unitToCategory maps each
  // category's unit ("hashtags"/"emoji") back to its name so every
  // "<n> <unit>" counter rolls into ONE By-category total instead — the
  // count-crossing-a-threshold shape has no natural "phrase" to show.
  const unitToCategory = new Map();
  for (const cat of categories) {
    if (cat.counting && cat.unit) unitToCategory.set(cat.unit, cat.name);
  }
  const countingPhraseRe = /^\d+ (.+)$/;

  // A phrase with no typed rule may still belong to a category: Sponsored and
  // Labs match by built-in pattern, templates by "___" blanks. Ask the matcher
  // which category catches the phrase's own text (every category forced on)
  // before calling it removed.
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
      continue; // no By-phrase row — see comment above unitToCategory
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
  // Structural hides: stored counters, not derived sums — the exception to
  // the rule above. Zero renders no row (a toggle left off is not "0 hides").
  if (counters.promoted) byCategory.push({ name: 'Promoted', caught: counters.promoted });
  if (counters.boosted) byCategory.push({ name: 'Boosted', caught: counters.boosted });
  byCategory.sort((a, b) => b.caught - a.caught);

  return { byCategory, byPhrase };
}

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
