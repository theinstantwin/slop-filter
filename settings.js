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
      ...{ STORAGE_KEY, DEFAULTS, migrate, upgradeToV2, allowPhrase, unallowPhrase, mute, unmute,
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

/* settings.html#muted opens that panel (the notice's pig popover links here). */
function openPanelFromHash(doc, hash) {
  const id = String(hash || '').replace(/^#/, '');
  if (!id) return false;
  const btn = [...doc.querySelectorAll('.navitem')].find(b => b.dataset.panel === id);
  if (!btn) return false;
  btn.click();
  return true;
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
  const r = el('div', 'rule' + (shape ? ' locked' : ''));

  const label = el('div', 'rule-text');
  if (shape) {
    // render blanks as visible placeholders so the template reads as a sentence
    txt.split(st.BLANK).forEach((part, i) => {
      if (i) label.appendChild(el('span', 'fill', 'anything'));
      label.appendChild(doc.createTextNode(part));
    });
  } else {
    label.textContent = txt;
  }
  r.appendChild(label);

  if (shape) {
    r.title = 'Built-in sentence template — the blanks match anything. Cannot be edited.';
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

  const catTotals = new Map();
  const byPhrase = [];
  for (const [phrase, { caught, readPast }] of Object.entries(counters.phrases || {})) {
    const countingMatch = phrase.match(countingPhraseRe);
    const countingCategoryName = countingMatch ? unitToCategory.get(countingMatch[1]) : undefined;
    if (countingCategoryName) {
      catTotals.set(countingCategoryName, (catTotals.get(countingCategoryName) || 0) + caught);
      continue; // no By-phrase row — see comment above unitToCategory
    }

    const categoryName = owner.get(phrase.toLowerCase()) || '(removed)';
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

  // Share card fills (Task 12 owns the card's Download PNG button/logic —
  // this only fills the two text hosts).
  // Categories lead: "118 AI Slop posts" reads as a sentence, where
  // "let that sink in — 94" is a data point. No phrases on the card:
  // nobody reading the post cares which exact string fired,
  // and custom phrases are the user's own writing.
  const rows = doc.getElementById('card-rows');
  rows.textContent = '';
  model.byCategory.slice(0, 5).forEach(c => {
    const r = el('div', 'card-row');
    r.appendChild(el('span', 'card-count', String(c.caught)));
    r.appendChild(el('span', 'card-phrase', c.name + ' posts'));
    rows.appendChild(r);
  });

  // Total is derived from the model (sum of every row shown), not a separate
  // stored counter — readAll()'s shape has no top-level "total" field to
  // begin with, so summing what is already displayed is also the only
  // number that can't disagree with the rows above it.
  const total = model.byCategory.reduce((sum, c) => sum + c.caught, 0);
  const period = doc.getElementById('card-period');
  period.textContent = '';
  period.appendChild(doc.createTextNode('Safe from '));
  period.appendChild(el('b', null, total.toLocaleString()));
  // 1.1 upgraders have no sfMeta.installedAt (the install event already
  // fired before this field existed) — the date clause is dropped rather
  // than showing a wrong one.
  const installedAt = st.meta && st.meta.installedAt;
  period.appendChild(doc.createTextNode(
    ' slop posts' + (installedAt
      ? ' since ' + new Date(installedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      : '')));
}
/* ---- Share card (Task 12) ----
   Renders the Activity panel's card preview to a real 1200x1200 PNG. The
   preview DOM (#share-card/#card-rows/#card-period, Task 10) and this
   canvas draw from the SAME data (activityModel + sfMeta.installedAt) but
   are two independent renderers — the PRD's anti-drift rule is to put the
   shared geometry in one constants object both read, rather than trying to
   generate one render from the other.

   CARD is that object. settings.css's `.card` block (drawn at true 1200px
   size, then `scale(0.3)`'d down for the on-page preview per its own
   comment) is the CSS half of the correspondence — every CARD number below
   has a comment in settings.css pointing back here, and vice versa. A full
   CSS-custom-property generation step would keep the two perfectly in sync
   automatically, but for five hand-verified numbers a documented
   correspondence plus a live visual check (this task's controller does that
   pixel-eyeball) is enough; CARD.MAX_ROWS and CARD.SIZE are the two values
   pinned by an actual test below, since those are the ones a silent drift
   would be easiest to miss (an extra row rendered, or a canvas resized). */
const CARD = {
  SIZE: 1200,                    // .card width/height
  BG: '#12212B',                 // .card background
  PAD_X: 108,                    // .card-body padding: 104px 108px 0
  PAD_TOP: 104,                  // .card-body padding-top
  TITLE_LINES: ['THE POSTS I', 'NEVER HAVE TO READ'],
  TITLE_SIZE: 96,                // .card-title font-size
  TITLE_LINE_HEIGHT: 0.9,        // .card-title line-height
  TITLE_MARGIN_BOTTOM: 14,       // .card-title margin-bottom
  SUB_SIZE: 34,                  // .card-sub font-size
  SUB_COLOR: '#8fa3b0',          // .card-sub color
  SUB_BOLD_COLOR: '#fff',        // .card-sub b color
  SUB_MARGIN_BOTTOM: 44,         // .card-sub margin-bottom
  MAX_ROWS: 5,                   // top-5 categories, matches renderStats' .slice(0, 5)
  ROW_PAD_Y: 28,                 // .card-row padding: 28px 0
  ROW_BORDER: 2,                 // .card-row border-bottom width
  ROW_COUNT_SIZE: 58,            // .card-count font-size
  ROW_COUNT_WIDTH: 130,          // .card-count min-width
  ROW_GAP: 34,                   // .card-row gap
  ROW_LABEL_SIZE: 40,            // .card-phrase font-size
  ROW_LABEL_COLOR: '#c8d6de',    // .card-phrase color
  ROWS_PAD_BOTTOM: 30,           // .card-rows padding-bottom
  FOOT_PAD_X: 108,                // .card-foot padding: 38px 108px
  FOOT_PAD_Y: 38,                // .card-foot padding
  FOOT_BG: 'rgba(0, 0, 0, 0.28)', // .card-foot background
  BRAND_SIZE: 30,                 // .card-brand font-size
  BRAND_ICON_SIZE: 36,            // .card-brand svg width/height
  BRAND_ICON_COLOR: '#3BA9D4',    // .card-brand svg color
  BRAND_TEXT: 'Slop Filter for LinkedIn',
  FONT_FAMILY: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif', // --sans
};

/* The Anton woff2 payload settings.css embeds as its @font-face's base64
   data URL — copied here VERBATIM (not derived; CSS cannot be read from
   JS at runtime, and MV3's CSP blocks fetching settings.css as a resource
   from this script). The two literal copies are the anti-drift risk: the
   'settings-bundle: ANTON_FONT_BASE64 matches...' test in
   test/settings.test.js re-parses settings.css off disk and asserts the
   payload below is byte-identical to the one embedded there. If a future
   font update touches one copy without the other, that test catches it. */
const ANTON_FONT_BASE64 = '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';

/* Pure — the same "Safe from N slop posts" / " since <Month Year>" text
   renderStats builds inline for #card-period, extracted so drawCard can
   build the identical string for the canvas without a document. */
function cardSubhead(total, installedAt) {
  const since = installedAt
    ? ' since ' + new Date(installedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : '';
  return 'Safe from ' + total.toLocaleString() + ' slop posts' + since;
}

/* Draws the share card to `canvas` at CARD.SIZE x CARD.SIZE. `model` is an
   activityModel()-shaped object ({ byCategory, byPhrase }); `installedAt` is
   sfMeta.installedAt (may be undefined for 1.1 upgraders — see cardSubhead).
   Loads Anton via the FontFace API (not @font-face — canvas text needs the
   font registered in document.fonts, and this runs before settings.css's
   own @font-face is guaranteed to have finished loading) and awaits it
   before drawing so the headline never falls back to the sans stack. */
async function drawCard(canvas, model, installedAt) {
  canvas.width = CARD.SIZE;
  canvas.height = CARD.SIZE;
  const ctx = canvas.getContext('2d');

  if (typeof FontFace !== 'undefined' && typeof document !== 'undefined' && document.fonts) {
    const face = new FontFace('Anton', `url(data:font/woff2;base64,${ANTON_FONT_BASE64})`);
    await face.load();
    document.fonts.add(face);
  }

  // ---- background ----
  ctx.fillStyle = CARD.BG;
  ctx.fillRect(0, 0, CARD.SIZE, CARD.SIZE);

  const rows = model.byCategory.slice(0, CARD.MAX_ROWS);
  const total = model.byCategory.reduce((sum, c) => sum + c.caught, 0);

  // ---- body: headline + subhead + rows, laid out top-down from PAD_TOP ----
  let y = CARD.PAD_TOP;
  const centerX = CARD.SIZE / 2;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = `400 ${CARD.TITLE_SIZE}px Anton, ${CARD.FONT_FAMILY}`;
  const titleLineHeight = CARD.TITLE_SIZE * CARD.TITLE_LINE_HEIGHT;
  y += CARD.TITLE_SIZE; // first baseline
  for (const line of CARD.TITLE_LINES) {
    ctx.fillText(line, centerX, y);
    y += titleLineHeight;
  }
  y += CARD.TITLE_MARGIN_BOTTOM - titleLineHeight + CARD.TITLE_SIZE * (1 - CARD.TITLE_LINE_HEIGHT);

  ctx.font = `400 ${CARD.SUB_SIZE}px ${CARD.FONT_FAMILY}`;
  ctx.fillStyle = CARD.SUB_COLOR;
  const subhead = cardSubhead(total, installedAt);
  ctx.fillText(subhead, centerX, y);
  y += CARD.SUB_MARGIN_BOTTOM;

  // ---- rows: count (right-aligned in its column) then "<name> posts" ----
  const rowLeft = CARD.PAD_X;
  const rowRight = CARD.SIZE - CARD.PAD_X;
  const countColRight = rowLeft + CARD.ROW_COUNT_WIDTH;
  const labelLeft = countColRight + CARD.ROW_GAP;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.09)';
  ctx.lineWidth = CARD.ROW_BORDER;

  rows.forEach((row, i) => {
    const rowTop = y;
    if (i === 0) {
      ctx.beginPath();
      ctx.moveTo(rowLeft, rowTop);
      ctx.lineTo(rowRight, rowTop);
      ctx.stroke();
    }
    const baselineY = rowTop + CARD.ROW_PAD_Y + CARD.ROW_COUNT_SIZE * 0.8;

    ctx.textAlign = 'left';
    ctx.font = `680 ${CARD.ROW_COUNT_SIZE}px ${CARD.FONT_FAMILY}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(row.caught), rowLeft, baselineY);

    ctx.font = `400 ${CARD.ROW_LABEL_SIZE}px ${CARD.FONT_FAMILY}`;
    ctx.fillStyle = CARD.ROW_LABEL_COLOR;
    ctx.fillText(row.name + ' posts', labelLeft, baselineY);

    const rowBottom = rowTop + CARD.ROW_PAD_Y * 2 + CARD.ROW_COUNT_SIZE;
    ctx.beginPath();
    ctx.moveTo(rowLeft, rowBottom);
    ctx.lineTo(rowRight, rowBottom);
    ctx.stroke();
    y = rowBottom;
  });

  // ---- footer: brand row, pinned to the bottom of the card ----
  const footTop = CARD.SIZE - (CARD.BRAND_SIZE + CARD.FOOT_PAD_Y * 2);
  ctx.fillStyle = CARD.FOOT_BG;
  ctx.fillRect(0, footTop, CARD.SIZE, CARD.SIZE - footTop);

  ctx.textAlign = 'left';
  ctx.font = `560 ${CARD.BRAND_SIZE}px ${CARD.FONT_FAMILY}`;
  ctx.fillStyle = '#fff';
  const brandBaseline = footTop + CARD.FOOT_PAD_Y + CARD.BRAND_SIZE * 0.8;
  ctx.fillText(CARD.BRAND_TEXT, CARD.FOOT_PAD_X, brandBaseline);

  return canvas;
}

/* Download button: canvas.toBlob -> object URL -> a[download] -> revoke,
   same pattern as the Backup panel's download() but a PNG blob instead of a
   JSON one (toBlob is async/callback-based, so this isn't a fit for that
   helper as written). */
function wireShareCard(doc) {
  const btn = doc.getElementById('dl-card');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const canvas = doc.createElement('canvas');
    const model = activityModel(st.counters, st.settings.categories);
    const installedAt = st.meta && st.meta.installedAt;
    await drawCard(canvas, model, installedAt);
    canvas.toBlob(blob => {
      const a = doc.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'slop-filter-card.png';
      a.click();
      URL.revokeObjectURL(a.href);
    }, 'image/png');
  });
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
    wirePanelSwitching, openPanelFromHash, flashSaved, renderAll,
    renderCats, renderCat, renderRule, wireCategoriesPanel, runTry,
    renderPromoted, wirePromotedPanel, renderLabs, wireLabsPanel, renderMutes, renderMute,
    renderTrusted, renderTrustedRow, wireTrustedAdd,
    activityModel, renderStats,
    CARD, ANTON_FONT_BASE64, cardSubhead, drawCard, wireShareCard,
    buildExport, validateBackup, isValidBackupCategory, applyBackup, wireBackupPanel,
  };
}

if (typeof chrome !== 'undefined' && chrome.storage) {
  (async () => {
    st.settings = await st.load();

    // Read once on page load — no chrome.storage.onChanged listener (PRD): a
    // settings page left open showing numbers from when it was opened is
    // fine, and refreshing is the obvious gesture for wanting current ones.
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
    openPanelFromHash(document, location.hash);

    const verEl = document.getElementById('ver');
    if (verEl && chrome.runtime && chrome.runtime.getManifest) {
      verEl.textContent = 'v' + chrome.runtime.getManifest().version;
    }

    renderAll(document);
    wireCategoriesPanel(document);
    wirePromotedPanel(document);
    wireLabsPanel(document);
    wireTrustedAdd(document);
    wireShareCard(document);
    wireBackupPanel(document);
  })();
}
