/**
 * Options page script. In the browser, settings.html loads filters.js,
 * storage.js, and counters.js as plain scripts before this one, so `load`,
 * `save`, `record`, `readAll` etc. are already globals in that shared page
 * scope. Under `node --test`, this file is required directly with no such
 * scope.
 *
 * Matching popup.js's `pf` pattern and content.js's `sf` pattern: every
 * identifier this file consumes from another module is resolved once into a
 * single namespaced object, never called as a bare global. `st` also holds
 * this page's own state — `st.settings` (the loaded blob) and `st.persist()`
 * (save + flashSaved) — alongside the imported helpers, matching pf's shape.
 *
 * This is the shell only (Task 7): panel switching, the five panel
 * skeletons, and load/save wiring. renderCats/renderMutes/renderStats/etc.
 * are empty placeholders — Tasks 8-11 fill them in. No dom.js: nothing on
 * this page reads LinkedIn markup.
 */
const st = (typeof module !== 'undefined' && typeof require !== 'undefined')
  ? { ...require('./filters.js'), ...require('./storage.js'), ...require('./counters.js') }
  : { ...{ findMatches, BLANK, compile, SEED_CATEGORIES, COUNTERS },
      ...{ STORAGE_KEY, DEFAULTS, migrate, upgradeToV2, setRuleOn, mute, unmute,
           allowAuthor, unallowAuthor,
           setCategoryOn, setCategoryDef, setThreshold, addRule, removeRule, upsertCustomCategory,
           deleteCategory, setHidePromoted, setHideBoosted, load, save },
      ...{ record, flush, scheduleFlush, readAll } };

/* ---- sidebar panel switching ---- */
function wirePanelSwitching(doc) {
  doc.querySelectorAll('.navitem').forEach(b => {
    b.addEventListener('click', () => {
      doc.querySelectorAll('.navitem').forEach(o => o.setAttribute('aria-current', String(o === b)));
      doc.querySelectorAll('.panel').forEach(p => p.classList.remove('on'));
      doc.getElementById('panel-' + b.dataset.panel).classList.add('on');
    });
  });
}

/* Deep links. The notice's "Change in Settings" and pig link open
     settings.html#panel=muted
     settings.html#cat=<categoryId>[&phrase=<rule text>]
   (a bare #muted still works). On load AND on hashchange this switches panel,
   expands the category, scrolls it into view and briefly highlights the exact
   phrase chip, or the threshold control for a counting category. */
function parseSettingsHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return {};
  if (!raw.includes('=')) return { panel: raw };
  const p = new URLSearchParams(raw);
  const out = {};
  if (p.get('panel')) out.panel = p.get('panel');
  if (p.get('cat')) out.cat = p.get('cat');
  if (p.get('phrase')) out.phrase = p.get('phrase');
  return out;
}

function showPanel(doc, id) {
  const btn = [...doc.querySelectorAll('.navitem')].find(b => b.dataset.panel === id);
  if (!btn) return false;
  btn.click();
  return true;
}

function reducedMotion(doc) {
  return !!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function highlight(doc, node) {
  if (!node) return;
  node.classList.add('hl');
  node.scrollIntoView?.({ block: 'center', behavior: reducedMotion(doc) ? 'auto' : 'smooth' });
  const t = setTimeout(() => node.classList.remove('hl'), 2200);
  t.unref?.(); // Node tests only; browsers return a number
}

function applyHash(doc, hash) {
  const h = parseSettingsHash(hash);
  if (h.panel) return showPanel(doc, h.panel);
  if (!h.cat) return false;
  const cat = st.settings?.categories.find(c => c.id === h.cat);
  if (!cat) return false;
  if (cat.labs) return showPanel(doc, 'labs');
  showPanel(doc, 'categories');
  st.catOpen.add(cat.id);
  renderCats(doc);
  const node = doc.querySelector('[data-cat="' + cat.id + '"]');
  if (!node) return false;
  let target = node;
  if (cat.counting) target = node.querySelector('.thr') || node;
  else if (h.phrase) {
    const want = h.phrase.toLowerCase();
    target = [...node.querySelectorAll('.rule[data-rule]')]
      .find(r => r.dataset.rule.toLowerCase() === want) || node;
  }
  highlight(doc, target);
  return true;
}

/* kept for the bare "#muted" form and older callers */
function openPanelFromHash(doc, hash) {
  const id = String(hash || '').replace(/^#/, '');
  return id ? showPanel(doc, id) : false;
}

let savedTimer;
function flashSaved(doc) {
  const s = doc.getElementById('saved');
  s.classList.add('on');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => s.classList.remove('on'), 1400);
}

// ---- Categories panel (Task 8) ----
//
// The array under render IS storage: every mutation is
// `st.settings = <Task 3 helper>(st.settings, ...)` followed by `st.persist()`,
// and renderCats() always reads `st.settings.categories` fresh. Nothing in
// this file hand-edits a category or rules array.
//
// Accordion open/closed state is UI-only — it must never round-trip through
// chrome.storage, so it lives in `st.catOpen`, a page-local Set of category
// ids, never on the stored category objects themselves.
st.catOpen = new Set();

// A new category starts as a page-local draft, NOT a stored one — "+ New
// category" must not write to chrome.storage at all until the draft gains
// real content (a committed name/def, or a first phrase). Closing the tab
// mid-edit on an unsaved draft leaves storage untouched, same as it always
// was. At most one draft exists at a time (a second click while one is
// already open just re-focuses/re-creates it).
st.newCatDraft = null;

const el = (t, c, txt) => {
  const n = document.createElement(t);
  if (c) n.className = c;
  if (txt !== undefined) n.textContent = txt;
  return n;
};

/* ---- the top add row ---- */
function syncAddCats(doc) {
  const sel = doc.getElementById('top-add-cat');
  const keep = sel.value;
  sel.textContent = '';
  for (const cat of st.settings.categories) {
    if (cat.counting || cat.labs) continue; // nothing to add a phrase to
    const o = el('option', null, cat.name);
    o.value = cat.id;
    sel.appendChild(o);
  }
  if (keep && st.settings.categories.some(c => c.id === keep && !c.counting && !c.labs)) sel.value = keep;
}

async function addPhrase(doc, catId, text) {
  if (!text) return;
  st.settings = st.addRule(st.settings, catId, text);
  st.catOpen.add(catId);
  await st.persist();
  renderCats(doc);
  runTry(doc);
  const node = doc.querySelector('[data-cat="' + catId + '"]');
  node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function wireTopAdd(doc) {
  const topAdd = doc.getElementById('top-add');
  const commit = () => {
    const v = topAdd.value.trim();
    if (!v) return;
    addPhrase(doc, doc.getElementById('top-add-cat').value, v);
    topAdd.value = '';
  };
  doc.getElementById('top-add-btn').addEventListener('click', commit);
  topAdd.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); });
}

/* ---- categories ---- */
function renderCats(doc) {
  const host = doc.getElementById('cats');
  host.textContent = '';
  for (const cat of st.settings.categories.filter(c => !c.labs)) host.appendChild(renderCat(doc, cat));
  // The unsaved draft (if any) renders last, same slot "+ New category" would
  // have appended it to were it a real, stored category.
  if (st.newCatDraft) host.appendChild(renderCat(doc, st.newCatDraft, { draft: true }));
  syncAddCats(doc);
}

function renderCat(doc, cat, { draft = false } = {}) {
  const isOpen = draft || st.catOpen.has(cat.id);
  const wrap = el('section', 'cat' + (cat.on ? '' : ' off') + (isOpen ? ' open' : ''));
  wrap.dataset.cat = cat.id;

  const head = el('div', 'cat-head');
  head.tabIndex = 0;
  head.setAttribute('role', 'button');
  head.setAttribute('aria-expanded', String(isOpen));
  const caret = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  caret.setAttribute('class', 'caret');
  caret.setAttribute('viewBox', '0 0 12 12');
  caret.setAttribute('aria-hidden', 'true');
  caret.innerHTML = '<path d="M4.75 2.5 L8.25 6 L4.75 9.5" fill="none" ' +
    'stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>';
  head.appendChild(caret);

  const id = el('div', 'cat-id');
  const nameRow = el('div', 'cat-name');
  nameRow.textContent = cat.name || 'Untitled category';
  if (cat.custom) nameRow.appendChild(el('span', 'badge-custom', 'yours'));
  id.appendChild(nameRow);
  const nameEl = nameRow;
  const defEl = el('div', 'cat-def', cat.def);
  id.appendChild(defEl);
  head.appendChild(id);

  if (cat.counting) {
    const meta = el('div', 'cat-meta');
    meta.appendChild(el('span', 'n', `${cat.threshold}+ ${cat.unit}`));
    head.appendChild(meta);
  }

  /* Edit swaps the title line for inputs, in place — the accordion stays
     shut, since it holds phrases. Custom categories get their name too;
     built-in names are fixed, so those edit the definition only. */
  const edit = el('button', 'cat-action', 'Edit');
  let closing = false;

  const startEdit = (focusName) => {
    if (wrap.querySelector('.def-inline')) return;
    closing = false;

    const done = async (commit) => {
      if (closing) return;
      closing = true;

      if (draft) {
        // The draft is page-local — it has never been written to storage.
        // Only a commit with real content (a non-empty name or def) turns it
        // into an actual stored category, via upsertCustomCategory with no
        // `id`, so the helper mints the real id. Abandoning it (Escape, or a
        // blur/Enter with both fields still empty) just drops the draft —
        // no storage read, write, or delete ever happens for a category that
        // was never really created.
        const name = nameIn.value.trim();
        const def = defIn.value.trim();
        if (commit && (name || def)) {
          st.settings = st.upsertCustomCategory(st.settings, { name, def: def || '' });
          const created = st.settings.categories[st.settings.categories.length - 1];
          st.catOpen.add(created.id);
          await st.persist();
        }
        st.newCatDraft = null;
        renderCats(doc);
        runTry(doc);
        return;
      }

      if (commit) {
        const name = nameIn ? (nameIn.value.trim() || 'Untitled category') : cat.name;
        const def = defIn.value.trim();
        if (cat.custom) {
          // upsertCustomCategory covers both name and def for custom categories.
          st.settings = st.upsertCustomCategory(st.settings, { id: cat.id, name, def });
        } else {
          // Built-ins have no name field (nameIn is null above) and can't go
          // through upsertCustomCategory (custom-only), so their definition
          // edit uses the sibling built-in-safe helper.
          st.settings = st.setCategoryDef(st.settings, cat.id, def);
        }
        await st.persist();
      }
      renderCats(doc);
      runTry(doc);
    };

    const mk = (cls, val, ph, label) => {
      const i = el('input', cls);
      i.type = 'text';
      i.value = val;
      i.placeholder = ph;
      i.setAttribute('aria-label', label);
      i.addEventListener('click', ev => ev.stopPropagation());
      /* stopPropagation on keydown too: Enter/Space on a focused child
         otherwise reaches the header's own key handler and toggles the
         accordion. */
      i.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
      });
      /* Tabbing between the two fields is not leaving the editor.
         relatedTarget names the element receiving focus and is correct
         synchronously — during a real Tab, document.activeElement is still
         <body> here, which made a setTimeout check tear the editor down
         mid-tab. Keep this pattern EXACTLY. */
      i.addEventListener('blur', ev => {
        if (ev.relatedTarget?.classList.contains('def-inline')) return;
        done(true);
      });
      return i;
    };

    const nameIn = cat.custom
      ? mk('def-inline name-inline', cat.name, 'Name this category…', 'Category name')
      : null;
    const defIn = mk('def-inline', cat.def, 'What should it catch?', cat.name + ' definition');

    defEl.replaceWith(defIn);
    if (nameIn) nameEl.replaceWith(nameIn);
    edit.textContent = 'Done';
    const first = (focusName && nameIn) ? nameIn : defIn;
    first.focus();
    first.select();
  };

  edit.addEventListener('click', e => { e.stopPropagation(); startEdit(!!cat.custom); });
  wrap.startEdit = startEdit;
  head.appendChild(edit);

  /* No Rename button — Edit covers the name for custom categories. No
     Delete for an unsaved draft — it was never created, so there is nothing
     to delete; abandoning the editor (blur/Escape) is how it goes away. */
  if (cat.custom && !draft) {
    const del = el('button', 'cat-action', 'Delete');
    const remove = async () => {
      st.settings = st.deleteCategory(st.settings, cat.id);
      st.catOpen.delete(cat.id);
      await st.persist();
      renderCats(doc);
      runTry(doc);
    };
    /* An empty category holds nothing worth confirming. One with phrases in
       it asks first, inline — the button becomes the confirmation. */
    del.addEventListener('click', e => {
      e.stopPropagation();
      if (!cat.rules.length) return remove();

      if (del.dataset.confirming) return remove();
      del.dataset.confirming = '1';
      del.textContent = `Delete ${cat.rules.length} phrase${cat.rules.length > 1 ? 's' : ''}?`;
      del.classList.add('danger');
      const resetController = new AbortController();
      const reset = () => {
        resetController.abort();
        delete del.dataset.confirming;
        del.textContent = 'Delete';
        del.classList.remove('danger');
      };
      del.addEventListener('blur', reset, { once: true, signal: resetController.signal });
      wrap.addEventListener('mouseleave', reset, { once: true, signal: resetController.signal });
      del.focus();
    });
    head.appendChild(del);
  }

  const sw = el('label', 'sw');
  const swCheckbox = doc.createElement('input');
  swCheckbox.type = 'checkbox';
  swCheckbox.checked = !!cat.on;
  swCheckbox.setAttribute('aria-label', cat.name);
  sw.appendChild(swCheckbox);
  sw.appendChild(doc.createElement('span'));
  sw.querySelector('input').addEventListener('change', async e => {
    st.settings = st.setCategoryOn(st.settings, cat.id, e.target.checked);
    wrap.classList.toggle('off', !e.target.checked);
    await st.persist();
    runTry(doc);
  });
  sw.addEventListener('click', e => e.stopPropagation());
  head.appendChild(sw);

  const toggle = () => {
    const nowOpen = !st.catOpen.has(cat.id);
    if (nowOpen) st.catOpen.add(cat.id); else st.catOpen.delete(cat.id);
    wrap.classList.toggle('open', nowOpen);
    head.setAttribute('aria-expanded', String(nowOpen));
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
  });
  wrap.appendChild(head);

  /* ---- expanded ---- */
  const bodyOuter = el('div', 'cat-body');
  const body = el('div', 'cat-body-inner');
  bodyOuter.appendChild(body);

  if (cat.counting) {
    const f = el('div', 'field');
    f.appendChild(el('label', 'field-label', 'Flag a post at'));
    const row = el('div', 'thr-row');
    const thr = el('div', 'thr');
    thr.innerHTML = `<button data-step="-1" aria-label="Lower">−</button>` +
      `<span class="val">${cat.threshold}+</span>` +
      `<button data-step="1" aria-label="Raise">+</button>`;
    thr.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      const next = Math.max(2, Math.min(15, cat.threshold + Number(b.dataset.step)));
      st.settings = st.setThreshold(st.settings, cat.id, next);
      const updated = st.settings.categories.find(c => c.id === cat.id);
      thr.querySelector('.val').textContent = updated.threshold + '+';
      wrap.querySelector('.cat-meta .n').textContent = `${updated.threshold}+ ${updated.unit}`;
      await st.persist();
      runTry(doc);
    });
    row.appendChild(thr);
    row.appendChild(el('span', 'field-hint', `${cat.unit} in a single post`));
    f.appendChild(row);
    body.appendChild(f);
  } else {
    const f = el('div', 'field');
    f.appendChild(el('label', 'field-label', 'Flag a post containing any of these'));

    const rules = el('div', 'rules');
    for (const r of cat.rules) rules.appendChild(renderRule(doc, cat, r));

    /* Ghost chip: adds a phrase without going back to the field at the top
       of the page. Sits last so the list reads as "…these, and one more". */
    const ghost = el('button', 'rule ghost');
    ghost.type = 'button';
    ghost.innerHTML = '<span class="rule-text">+ Add phrase</span>';
    ghost.addEventListener('click', () => {
      const inp = el('input', 'ghost-input');
      inp.type = 'text';
      inp.placeholder = 'Type a phrase, then Enter';
      inp.setAttribute('aria-label', 'New phrase for ' + cat.name);

      const close = () => { inp.replaceWith(ghost); };
      const commit = async () => {
        const v = inp.value.trim();
        if (!v) return close();

        if (draft) {
          // A first phrase is real content too — it turns the draft into an
          // actual stored category in the same breath the rule is added,
          // rather than persisting an empty category and then a rule onto
          // it as two separate writes.
          st.settings = st.upsertCustomCategory(st.settings, { name: cat.name, def: cat.def });
          const created = st.settings.categories[st.settings.categories.length - 1];
          st.settings = st.addRule(st.settings, created.id, v);
          st.catOpen.add(created.id);
          await st.persist();
          st.newCatDraft = null;
          renderCats(doc);
          runTry(doc);
          return;
        }

        st.settings = st.addRule(st.settings, cat.id, v);
        await st.persist();
        inp.insertAdjacentElement('beforebegin', renderRule(doc, cat, v));
        inp.value = '';
        runTry(doc);
        inp.focus(); // stay open for a run of additions
      };
      inp.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { ev.preventDefault(); close(); }
      });
      inp.addEventListener('blur', () => { if (!inp.value.trim()) close(); });

      ghost.replaceWith(inp);
      inp.focus();
    });
    rules.appendChild(ghost);

    f.appendChild(rules);
    body.appendChild(f);
  }

  wrap.appendChild(bodyOuter);
  return wrap;
}

function renderRule(doc, cat, txt) {
  const shape = txt.includes(st.BLANK);
  const isOff = (cat.off || []).includes(txt);
  const r = el('div', 'rule' + (shape ? ' locked' : '') + (isOff ? ' u' : ''));
  r.dataset.rule = txt;

  // The label wraps the checkbox, so clicking the phrase toggles it. Checked
  // means flagging; unchecked keeps the phrase but stops it firing.
  const lab = el('label', 'rule-label');
  const cb = doc.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !isOff;
  cb.addEventListener('change', async () => {
    st.settings = st.setRuleOn(st.settings, cat.id, txt, cb.checked);
    r.classList.toggle('u', !cb.checked);
    await st.persist();
    runTry(doc);
  });
  lab.appendChild(cb);

  const label = el('span', 'rule-text');
  if (shape) {
    // render blanks as visible placeholders so the template reads as a sentence
    txt.split(st.BLANK).forEach((part, i) => {
      if (i) label.appendChild(el('span', 'fill', 'anything'));
      label.appendChild(doc.createTextNode(part));
    });
  } else {
    label.textContent = txt;
  }
  lab.appendChild(label);
  r.appendChild(lab);

  if (shape) {
    // Custom tooltip (CSS, data-tip): the native title tooltip waits ~1s to appear.
    r.dataset.tip = 'Catches every version of this line, whatever fills the blanks. It’s built in, so you can switch it off but not edit it.';
    r.setAttribute('aria-description', r.dataset.tip);
    const lock = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    lock.setAttribute('class', 'lock');
    lock.setAttribute('viewBox', '0 0 10 10');
    lock.setAttribute('aria-hidden', 'true');
    lock.innerHTML = '<path d="M3 4.4V3a2 2 0 0 1 4 0v1.4" fill="none" stroke="currentColor" ' +
      'stroke-width="1"/><rect x="2.2" y="4.4" width="5.6" height="4.2" rx="1" fill="currentColor"/>';
    r.appendChild(lock);
  } else {
    const x = el('button', 'rule-x', '×');
    x.setAttribute('aria-label', 'Remove "' + txt + '"');
    x.addEventListener('click', async () => {
      // No empty state needed — the ghost chip is always the last item.
      st.settings = st.removeRule(st.settings, cat.id, txt);
      await st.persist();
      r.remove();
      runTry(doc);
    });
    r.appendChild(x);
  }
  return r;
}

/* ---- new category ----
   Creates the row empty and drops straight into the inline editor with the
   name focused — same interaction as renaming, so there is one thing to
   learn. The row is a page-local draft (`st.newCatDraft`), not a stored
   category: nothing is written to chrome.storage here. `renderCat`'s
   `done(commit)` (draft branch, above) is the only place a draft turns into
   a real, persisted category — on a commit with a non-empty name or def —
   or quietly disappears on abandonment, with zero storage interaction
   either way. The ghost-chip add-phrase path (also above) covers the case
   where the first real content is a phrase rather than a name/def. */
function wireNewCategory(doc) {
  doc.getElementById('new-cat').addEventListener('click', () => {
    // One draft at a time: a stray click while one is already open just
    // re-focuses it rather than creating a second.
    if (!st.newCatDraft) {
      st.newCatDraft = { id: '__draft__', name: '', def: '', on: true, custom: true, rules: [] };
    }
    renderCats(doc);

    const last = doc.querySelector('[data-cat="__draft__"]');
    last.scrollIntoView({ block: 'center', behavior: 'smooth' });
    last.startEdit(true);
  });
}

/* ---- try a post: findMatches against st.settings.categories, live ---- */
function runTry(doc) {
  const text = doc.getElementById('try').value;
  const out = doc.getElementById('verdict');
  out.textContent = '';

  const hits = st.findMatches(text, {
    categories: st.settings.categories,
    allowed: st.settings.allowedPhrases,
  });

  if (!hits.length) {
    out.appendChild(el('div', 'v-clean', 'Nothing fires. This post reads clean.'));
    return;
  }
  out.appendChild(el('div', 'v-count', `${hits.length} match${hits.length > 1 ? 'es' : ''}`));
  for (const hit of hits) {
    const row = el('div', 'v-hit');
    row.appendChild(el('span', 'v-cat', hit.filterName));
    row.appendChild(el('span', 'v-phrase', hit.phrase));
    out.appendChild(row);
  }
}

function wireCategoriesPanel(doc) {
  wireTopAdd(doc);
  wireNewCategory(doc);
  doc.getElementById('try').addEventListener('input', () => runTry(doc));
  runTry(doc);
}

/* ---- Labs panel ----
   Same toggle-row shape as Promoted content's static rows, but data-driven
   over st.settings.categories instead of two fixed ids — a Labs entry is a
   category object with `labs: true` and no `rules` array (see filters.js's
   LABS_PATTERNS).
   Every mutation goes through the same setCategoryOn() + st.persist() path
   any other category toggle uses — nothing Labs-specific in storage.js. */
function renderLabs(doc) {
  const host = doc.getElementById('labs-rows');
  host.textContent = '';
  for (const cat of st.settings.categories.filter(c => c.labs)) {
    const wrap = el('section', 'cat static' + (cat.on ? '' : ' off'));
    wrap.dataset.cat = cat.id;

    const head = el('div', 'cat-head');
    const id = el('div', 'cat-id');
    id.appendChild(el('div', 'cat-name', cat.name));
    id.appendChild(el('div', 'cat-def', cat.def));
    head.appendChild(id);

    const label = el('label', 'sw');
    const box = el('input');
    box.type = 'checkbox';
    box.checked = cat.on;
    box.setAttribute('aria-label', cat.name);
    box.dataset.labsToggle = cat.id;
    label.appendChild(box);
    label.appendChild(el('span'));
    head.appendChild(label);

    wrap.appendChild(head);
    host.appendChild(wrap);
  }
}

function wireLabsPanel(doc) {
  doc.getElementById('labs-rows').addEventListener('change', async e => {
    const id = e.target.dataset.labsToggle;
    if (!id) return;
    st.settings = st.setCategoryOn(st.settings, id, e.target.checked);
    e.target.closest('.cat').classList.toggle('off', !e.target.checked);
    await st.persist();
  });
}

/* ---- Promoted content panel ----
   The two rows are static markup already in settings.html (Task 7, copy
   locked) — nothing here builds DOM, it only reads
   st.settings.hidePromoted/hideBoosted into the checkboxes on render and
   writes them back through the Task 9 copy-on-write helpers on change. */
function renderPromoted(doc) {
  const promotedBox = doc.getElementById('promoted-toggle');
  const boostedBox = doc.getElementById('boosted-toggle');
  promotedBox.checked = st.settings.hidePromoted;
  boostedBox.checked = st.settings.hideBoosted;
  doc.getElementById('promoted-row').classList.toggle('off', !st.settings.hidePromoted);
  doc.getElementById('boosted-row').classList.toggle('off', !st.settings.hideBoosted);
}

function wirePromotedPanel(doc) {
  doc.getElementById('promoted-toggle').addEventListener('change', async e => {
    st.settings = st.setHidePromoted(st.settings, e.target.checked);
    doc.getElementById('promoted-row').classList.toggle('off', !e.target.checked);
    await st.persist();
  });
  doc.getElementById('boosted-toggle').addEventListener('change', async e => {
    st.settings = st.setHideBoosted(st.settings, e.target.checked);
    doc.getElementById('boosted-row').classList.toggle('off', !e.target.checked);
    await st.persist();
  });
}

/* ---- Muted people panel ----
   Same as the Categories panel: the array under render IS storage — every mutation goes through
   st.mute()/st.unmute() into a cloned settings object, followed by
   st.persist(), and renderMutes() always reads st.settings.mutedAuthors
   fresh.

   The 6-second "Unmuted · Undo" row is page-local UI state only: the timer
   handle and the "this row is showing its undo state" flag never touch
   chrome.storage — unmuting has already persisted by the time the row
   flips, and Undo re-persists via mute(). If Undo fires, clearTimeout stops
   the pending full re-render; if the timer fires first, it just calls
   renderMutes() again to drop back to the normal list (a no-op if the row
   already navigated away, guarded by `row.isConnected`). */
function renderMutes(doc) {
  const host = doc.getElementById('mutes');
  host.textContent = '';

  if (!st.settings.mutedAuthors.length) {
    host.appendChild(el('p', 'placeholder',
      'Nobody is muted. Hover the pig on a flagged post to mute its author.'));
    return;
  }

  // Alphabetical: this is a lookup, not a workspace — there is no insertion
  // order worth preserving the way there is with phrase chips.
  const sorted = [...st.settings.mutedAuthors].sort((a, b) => a.localeCompare(b));
  for (const name of sorted) host.appendChild(renderMute(doc, name));
}

function renderMute(doc, name) {
  const row = el('div', 'mute');
  row.appendChild(el('div', 'mute-name', name));

  const btn = el('button', 'cat-action', 'Unmute');
  btn.addEventListener('click', async () => {
    st.settings = st.unmute(st.settings, name);
    await st.persist();

    // Undo rather than a confirmation. Unmuting is harmless and reversible,
    // so a dialog would be friction — but on a long list an accidental click
    // loses the name itself, which is the part that can't be recovered
    // without retyping it.
    row.classList.add('undone');
    row.textContent = '';
    row.appendChild(el('div', 'mute-name gone', name));
    const undo = el('button', 'cat-action', 'Undo');
    undo.addEventListener('click', async () => {
      clearTimeout(timer);
      st.settings = st.mute(st.settings, name);
      await st.persist();
      renderMutes(doc);
    });
    row.appendChild(el('span', 'mute-note', 'Unmuted'));
    row.appendChild(undo);

    const timer = setTimeout(() => { if (row.isConnected) renderMutes(doc); }, 6000);
  });
  row.appendChild(btn);
  return row;
}

/* ---- Trusted People panel ----
   Mirrors renderMutes/renderMute exactly (see the comment above renderMutes
   for the persistence and Undo-row rationale, which applies identically
   here), with one addition: there is no in-feed action that adds a Trusted
   entry, so this panel also owns a text input + Add button that Muted
   people does not need. */
function renderTrusted(doc) {
  const host = doc.getElementById('trusted');
  host.textContent = '';

  if (!st.settings.whitelistedAuthors.length) {
    host.appendChild(el('p', 'placeholder',
      'Nobody is trusted yet. Type a name below to add one.'));
    return;
  }

  const sorted = [...st.settings.whitelistedAuthors].sort((a, b) => a.localeCompare(b));
  for (const name of sorted) host.appendChild(renderTrustedRow(doc, name));
}

function renderTrustedRow(doc, name) {
  const row = el('div', 'mute');
  row.appendChild(el('div', 'mute-name', name));

  const btn = el('button', 'cat-action', 'Remove');
  btn.addEventListener('click', async () => {
    st.settings = st.unallowAuthor(st.settings, name);
    await st.persist();

    row.classList.add('undone');
    row.textContent = '';
    row.appendChild(el('div', 'mute-name gone', name));
    const undo = el('button', 'cat-action', 'Undo');
    undo.addEventListener('click', async () => {
      clearTimeout(timer);
      st.settings = st.allowAuthor(st.settings, name);
      await st.persist();
      renderTrusted(doc);
    });
    row.appendChild(el('span', 'mute-note', 'Removed'));
    row.appendChild(undo);

    const timer = setTimeout(() => { if (row.isConnected) renderTrusted(doc); }, 6000);
  });
  row.appendChild(btn);
  return row;
}

function wireTrustedAdd(doc) {
  const input = doc.getElementById('trust-input');
  const btn = doc.getElementById('trust-add-btn');
  const errorEl = doc.getElementById('trust-add-error');
  const addFromInput = async () => {
    const name = input.value.trim();
    errorEl.textContent = '';
    if (!name) return;
    // allowAuthor() throws if `name` is already in mutedAuthors (storage.js,
    // Task 1) — that guard is the actual duplicate check; this catch only
    // decides how the error surfaces on this specific page. Input is
    // deliberately NOT cleared on error so the user can edit and retry
    // without retyping the whole name.
    try {
      st.settings = st.allowAuthor(st.settings, name);
    } catch (e) {
      errorEl.textContent = e.message;
      return;
    }
    await st.persist();
    input.value = '';
    renderTrusted(doc);
  };
  btn.addEventListener('click', addFromInput);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') addFromInput(); });
}

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
/* ---- Backup panel (Task 11) ----
   Export takes settings/counters as
   parameters (st.settings and st.counters, sfCounters's shape) and stamps
   `exported` at click time.

   Export MERGES the two storage keys — slopFilterSettings and sfCounters
   — into one file; restore SPLITS them back apart (PRD): applyBackup()
   returns { settings, counters? }, and only the caller (the confirm-button
   handler below) decides where each half gets written.

   The 'rules' kind's original name was 'slop-filter-backup' for both kinds —
   that collapsed the distinction the PRD wants restore to draw between "a
   full backup" and "just categories/rules," so the two kinds now carry
   different `kind` strings and validateBackup only accepts those two exact
   values. */
function buildExport(kind, settings, counters) {
  const base = {
    kind: kind === 'rules' ? 'slop-filter-rules' : 'slop-filter-backup',
    version: 2,
    exported: new Date().toISOString().slice(0, 10),
    categories: settings.categories,
    hidePromoted: settings.hidePromoted,
    hideBoosted: settings.hideBoosted,
  };
  if (kind === 'rules') return base;
  return { ...base, mutedAuthors: settings.mutedAuthors, whitelistedAuthors: settings.whitelistedAuthors, counters };
}

/* Three distinguishable user-facing errors, per the PRD: invalid JSON is
   caught by the caller (JSON.parse throws before this is ever reached) and
   gets its own message there; this function distinguishes the other two —
   an unrecognized/missing `kind` vs. a recognized kind whose shape is wrong
   (categories not an array). */
/* A category is well-formed if it has a string name AND either a rules array
   of strings (a phrase-matching category) or counting:true with a numeric
   threshold (a counting category, e.g. hashtag overload). Anything else —
   {} being the minimal failing case — is rejected here rather than let
   through to wedge the Categories panel on render. */
function isValidBackupCategory(cat) {
  if (!cat || typeof cat !== 'object') return false;
  if (typeof cat.name !== 'string' || !cat.name) return false;
  if (cat.counting === true) return Number.isFinite(cat.threshold);
  if (cat.labs === true) return true;
  return Array.isArray(cat.rules) && cat.rules.every(r => typeof r === 'string');
}

function validateBackup(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, error: 'That is not a Slop Filter backup file.' };
  }
  if (parsed.kind !== 'slop-filter-backup' && parsed.kind !== 'slop-filter-rules') {
    return { ok: false, error: 'Unrecognized file — this was not exported from Slop Filter.' };
  }
  if (!Array.isArray(parsed.categories)) {
    return { ok: false, error: 'No categories in it — this does not look like a Slop Filter export.' };
  }
  if (!parsed.categories.every(isValidBackupCategory)) {
    return { ok: false, error: 'One or more categories in that file are missing a name or rules — this does not look like a Slop Filter export.' };
  }
  const strings = a => a === undefined || (Array.isArray(a) && a.every(x => typeof x === 'string'));
  if (!strings(parsed.mutedAuthors) || !strings(parsed.whitelistedAuthors)) {
    return { ok: false, error: 'The people lists in that file are damaged — this does not look like a Slop Filter export.' };
  }
  return { ok: true, kind: parsed.kind === 'slop-filter-rules' ? 'rules' : 'all' };
}

/* Full replace of categories/flags always; mutes and counters only for a
   kind:'all' backup (a rules-only file was never asked to carry them, and
   the PRD requires rules-only restore to leave both untouched). `schema: 2`
   is preserved explicitly and the result is run through migrate() — cheap
   belt-and-braces so a restored file exported from a future or past minor
   version still normalizes the same way a freshly loaded blob would. */
function applyBackup(parsed, currentSettings) {
  const merged = {
    ...currentSettings,
    schema: 2,
    // Same 2–15 range setThreshold enforces: a threshold of 0 from a hand-
    // edited file would flag every post on the feed.
    categories: parsed.categories.map(c => (c.counting
      ? { ...c, threshold: Math.max(2, Math.min(15, c.threshold)) }
      : c)),
    hidePromoted: !!parsed.hidePromoted,
    hideBoosted: !!parsed.hideBoosted,
  };
  if (parsed.kind === 'slop-filter-backup' && Array.isArray(parsed.mutedAuthors)) {
    merged.mutedAuthors = parsed.mutedAuthors;
  }
  if (parsed.kind === 'slop-filter-backup' && Array.isArray(parsed.whitelistedAuthors)) {
    merged.whitelistedAuthors = parsed.whitelistedAuthors;
  }
  const settings = st.migrate(merged);
  if (parsed.kind === 'slop-filter-backup' && parsed.counters) {
    return { settings, counters: parsed.counters };
  }
  return { settings };
}

function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function wireBackupPanel(doc) {
  doc.getElementById('bk-all').addEventListener('click', () => {
    download('slop-filter-backup.json', buildExport('all', st.settings, st.counters));
    flashSaved(doc);
  });
  doc.getElementById('bk-rules').addEventListener('click', () => {
    download('slop-filter-rules.json', buildExport('rules', st.settings, st.counters));
    flashSaved(doc);
  });

  const drop = doc.getElementById('drop');
  const picker = el('input');
  picker.type = 'file';
  picker.accept = 'application/json,.json';
  picker.style.display = 'none';
  doc.body.appendChild(picker);

  drop.addEventListener('click', () => picker.click());
  drop.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); }
  });
  picker.addEventListener('change', () => {
    if (picker.files[0]) readBackupFile(doc, picker.files[0]);
    picker.value = '';
  });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer?.files?.[0];
    if (f) readBackupFile(doc, f);
  });
}

function readBackupFile(doc, file) {
  const out = doc.getElementById('restore-preview');
  const fail = msg => {
    out.textContent = '';
    const box = el('div', 'rpv');
    box.appendChild(el('h4', null, 'Cannot read that file'));
    box.appendChild(el('p', 'rpv-warn', msg));
    out.appendChild(box);
  };

  const fr = new FileReader();
  fr.onload = () => {
    let data;
    try { data = JSON.parse(fr.result); }
    catch { return fail('It is not valid JSON. Pick a file exported from this extension.'); }

    const result = validateBackup(data);
    if (!result.ok) return fail(result.error);
    showRestorePreview(doc, data, result.kind, file.name);
  };
  fr.onerror = () => fail('The file could not be read.');
  fr.readAsText(file);
}

/* States what the file contains and how many current categories it will
   replace, in a red warning, before offering the button — restoring is
   destructive, so that has to be legible before the click, not after. The
   write itself only happens in the confirm handler below; Cancel discards
   the preview with no storage interaction at all. */
function showRestorePreview(doc, data, kind, filename) {
  const out = doc.getElementById('restore-preview');
  out.textContent = '';

  const box = el('div', 'rpv');
  box.appendChild(el('h4', null, 'Ready to restore from ' + filename));

  const phrases = data.categories.reduce((n, c) => n + (c.rules?.length || 0), 0);
  const dl = el('dl');
  const add = (k, v) => { dl.appendChild(el('dt', null, k)); dl.appendChild(el('dd', null, v)); };
  add('Categories', String(data.categories.length));
  add('Phrases', String(phrases));
  add('Muted people', kind === 'all' ? String(data.mutedAuthors?.length || 0) : 'not included');
  add('Trusted people', kind === 'all' ? String(data.whitelistedAuthors?.length || 0) : 'not included');
  add('Counts', kind === 'all' && data.counters ? 'included' : 'not included');
  box.appendChild(dl);

  const currentCount = st.settings.categories.length;
  box.appendChild(el('p', 'rpv-warn',
    'This replaces your ' + currentCount + ' current categor' + (currentCount === 1 ? 'y' : 'ies')
    + ' and everything in them.'
    + (kind === 'all' ? ' It also replaces your muted people, trusted people, and counts.' : '')
    + ' Back up first if you want to keep them.'));

  const actions = el('div', 'rpv-actions');
  const go = el('button', 'btn btn-primary', 'Replace my settings');
  go.addEventListener('click', async () => {
    if (go.disabled) return;
    go.disabled = true;
    const applied = applyBackup(data, st.settings);
    st.settings = applied.settings;
    await st.persist();
    if (applied.counters) {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        await chrome.storage.local.set({ sfCounters: applied.counters });
      }
      st.counters = applied.counters;
      renderStats(doc);
    }
    renderCats(doc);
    renderMutes(doc);
    renderTrusted(doc);
    renderPromoted(doc);
    runTry(doc);

    out.textContent = '';
    const done = el('div', 'rpv');
    done.appendChild(el('h4', null, 'Restored'));
    out.appendChild(done);
  });
  const cancel = el('button', 'btn btn-line', 'Cancel');
  cancel.addEventListener('click', () => { out.textContent = ''; });
  actions.appendChild(go);
  actions.appendChild(cancel);
  box.appendChild(actions);
  out.appendChild(box);
}

function renderBackup() {}

/* Settings changed somewhere else (a LinkedIn tab's notice). */
function onSettingsChanged(changes, area, doc = document) {
  if (area !== 'local' || !changes[st.STORAGE_KEY]) return;
  const next = changes[st.STORAGE_KEY].newValue;
  if (!next || JSON.stringify(next) === JSON.stringify(st.settings)) return;
  st.settings = st.migrate(next);
  renderAll(doc);
  runTry(doc);
}

function renderAll(doc) {
  renderCats(doc);
  renderMutes(doc);
  renderTrusted(doc);
  renderStats(doc);
  renderPromoted(doc);
  renderLabs(doc);
  renderBackup(doc);
}

if (typeof module !== 'undefined') {
  module.exports = {
    st,
    wirePanelSwitching, openPanelFromHash, parseSettingsHash, applyHash, onSettingsChanged, flashSaved, renderAll,
    renderCats, renderCat, renderRule, wireCategoriesPanel, runTry,
    renderPromoted, wirePromotedPanel, renderLabs, wireLabsPanel, renderMutes, renderMute,
    renderTrusted, renderTrustedRow, wireTrustedAdd,
    activityModel, renderStats,
    buildExport, validateBackup, isValidBackupCategory, applyBackup, wireBackupPanel,
  };
}

if (typeof chrome !== 'undefined' && chrome.storage) {
  (async () => {
    st.settings = await st.load();

    // Activity counters are read once on page load: a page left open showing
    // numbers from when it was opened is fine. The settings blob itself is
    // kept live by onSettingsChanged below.
    st.counters = await st.readAll();
    const metaBlob = await chrome.storage.local.get(['sfMeta']);
    st.meta = metaBlob.sfMeta || {};

    // Open LinkedIn tabs pick the change up from chrome.storage.onChanged
    // (content.js) and re-judge their posts in place; nothing to notify.
    st.persist = async () => {
      await st.save(st.settings);
      flashSaved(document);
    };

    wirePanelSwitching(document);

    const verEl = document.getElementById('ver');
    if (verEl && chrome.runtime && chrome.runtime.getManifest) {
      verEl.textContent = 'v' + chrome.runtime.getManifest().version;
    }

    renderAll(document);
    wireCategoriesPanel(document);
    wirePromotedPanel(document);
    wireLabsPanel(document);
    wireTrustedAdd(document);
    wireBackupPanel(document);

    // Deep links need the panels rendered first.
    applyHash(document, location.hash);
    window.addEventListener('hashchange', () => applyHash(document, location.hash));

    // The feed edits settings too (stepper, mute, Undo). Pick those up so this
    // page never shows or saves a stale copy. Our own saves echo back equal
    // and are skipped.
    chrome.storage.onChanged?.addListener(onSettingsChanged);
  })();
}
