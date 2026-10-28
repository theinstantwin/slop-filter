/**
 * Options page, Categories, Labs and Promoted content panels. A classic script
 * loaded after settings.js, so `st`, `el` and the other panels' functions are
 * page globals (under Node, settings.js publishes them on globalThis first).
 *
 * Every mutation is `st.settings = st.<helper>(st.settings, ...)` followed by
 * st.persist(), and renderers read st.settings fresh, so the page never hand-edits
 * a category or rules array.
 */

// Accordion open state is UI-only and never stored: a page-local Set of ids.
st.catOpen = new Set();

// "+ New category" creates a page-local draft, not a stored category. Nothing is
// written until the draft gains content (a committed name or definition, or a
// first phrase), so abandoning it leaves storage untouched. One draft at a time.
st.newCatDraft = null;

// Fills the top "add a phrase" category picker, keeping the current choice.
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

function renderCats(doc) {
  const host = doc.getElementById('cats');
  host.textContent = '';
  for (const cat of st.settings.categories.filter(c => !c.labs)) host.appendChild(renderCat(doc, cat));
  // The unsaved draft renders last, where a stored new category would land.
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

  // Edit swaps the title line for inputs in place without opening the accordion.
  // Custom categories edit name and definition; built-ins edit the definition only.
  const edit = el('button', 'cat-action', 'Edit');
  let closing = false;

  const startEdit = (focusName) => {
    if (wrap.querySelector('.def-inline')) return;
    closing = false;

    const done = async (commit) => {
      if (closing) return;
      closing = true;

      if (draft) {
        // Only a commit with a non-empty name or definition makes the draft a
        // stored category (no `id`, so upsertCustomCategory mints one).
        // Otherwise it is dropped with no storage access.
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
          st.settings = st.upsertCustomCategory(st.settings, { id: cat.id, name, def });
        } else {
          // Built-ins have no name field and upsertCustomCategory is custom-only.
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
      // Stop keydown too, or Enter/Space would reach the header and toggle the accordion.
      i.addEventListener('keydown', ev => {
        ev.stopPropagation();
        if (ev.key === 'Enter') { ev.preventDefault(); done(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); done(false); }
      });
      // Tabbing between the two fields doesn't leave the editor. Use
      // relatedTarget: during a real Tab, document.activeElement is still <body>
      // here, so a deferred activeElement check closes the editor mid-tab.
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

  // No Delete on an unsaved draft: abandoning the editor discards it.
  if (cat.custom && !draft) {
    const del = el('button', 'cat-action', 'Delete');
    const remove = async () => {
      st.settings = st.deleteCategory(st.settings, cat.id);
      st.catOpen.delete(cat.id);
      await st.persist();
      renderCats(doc);
      runTry(doc);
    };
    // An empty category deletes at once; one with phrases confirms inline.
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

  const bodyOuter = el('div', 'cat-body');
  const body = el('div', 'cat-body-inner');
  bodyOuter.appendChild(body);

  if (cat.counting) {
    const f = el('div', 'field');
    f.appendChild(el('label', 'field-label', 'Flag a post at'));
    const row = el('div', 'thr-row');
    const thr = el('div', 'thr');
    const lower = el('button', null, '−');
    lower.dataset.step = '-1';
    lower.setAttribute('aria-label', 'Lower');
    const raise = el('button', null, '+');
    raise.dataset.step = '1';
    raise.setAttribute('aria-label', 'Raise');
    thr.append(lower, el('span', 'val', `${cat.threshold}+`), raise);
    thr.addEventListener('click', async e => {
      const b = e.target.closest('button');
      if (!b) return;
      // Step from the live value; the rendered one may be stale.
      const current = st.settings.categories.find(c => c.id === cat.id).threshold;
      st.settings = st.setThreshold(st.settings, cat.id, st.clampThreshold(current + Number(b.dataset.step)));
      const updated = st.settings.categories.find(c => c.id === cat.id);
      thr.querySelector('.val').textContent = updated.threshold + '+';
      wrap.querySelector('.cat-meta .n').textContent = `${updated.threshold}+ ${updated.unit}`;
      await st.persist();
      // The sidebar's "Saved" may be off-screen, so confirm here too.
      saved.classList.add('on');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => saved.classList.remove('on'), 1600);
      runTry(doc);
    });
    const saved = el('span', 'inline-saved', 'Saved');
    saved.setAttribute('role', 'status');
    let savedTimer;
    row.appendChild(thr);
    row.appendChild(el('span', 'field-hint', `${cat.unit} in a single post`));
    row.appendChild(saved);
    f.appendChild(row);
    body.appendChild(f);
  } else {
    const f = el('div', 'field');
    f.appendChild(el('label', 'field-label', 'Flag a post containing any of these'));

    const rules = el('div', 'rules');
    for (const r of cat.rules) rules.appendChild(renderRule(doc, cat, r));

    // Ghost chip: adds a phrase in place, last in the list.
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
          // A first phrase also makes the draft real, in one write rather than
          // an empty category followed by a rule.
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

  // The label wraps the checkbox, so clicking the phrase toggles it. Unchecked
  // keeps the phrase but stops it firing.
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
    // Show blanks as visible placeholders so the template reads as a sentence.
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
    // A CSS tooltip (data-tip); native title tooltips wait about a second.
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
      st.settings = st.removeRule(st.settings, cat.id, txt);
      await st.persist();
      r.remove();
      runTry(doc);
    });
    r.appendChild(x);
  }
  return r;
}

// Starts a draft category and opens the inline editor on its name. Storage is
// untouched here; renderCat's done() and the ghost-chip path persist it.
function wireNewCategory(doc) {
  doc.getElementById('new-cat').addEventListener('click', () => {
    // A second click re-focuses the open draft instead of creating another.
    if (!st.newCatDraft) {
      st.newCatDraft = { id: '__draft__', name: '', def: '', on: true, custom: true, rules: [] };
    }
    renderCats(doc);

    const last = doc.querySelector('[data-cat="__draft__"]');
    last.scrollIntoView({ block: 'center', behavior: 'smooth' });
    last.startEdit(true);
  });
}

/** The "Try a post" box: runs findMatches over the text against the current categories, live. */
function runTry(doc) {
  const text = doc.getElementById('try').value;
  const out = doc.getElementById('verdict');
  out.textContent = '';

  const hits = st.findMatches(text, {
    categories: st.settings.categories,
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

/**
 * Labs panel: one toggle row per category with `labs: true` (no rules array;
 * the pattern is in filters.js LABS_PATTERNS). Toggles use the same
 * setCategoryOn path as any other category.
 */
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

/**
 * Promoted content panel. The two rows are static markup in settings.html;
 * this only syncs hidePromoted/hideBoosted to the checkboxes and back.
 */
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

if (typeof module !== 'undefined') {
  Object.assign(module.exports, {
    renderCats, renderCat, renderRule, wireCategoriesPanel, runTry,
    renderPromoted, wirePromotedPanel, renderLabs, wireLabsPanel
  });
}
