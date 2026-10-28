/**
 * Options page, Backup panel: export, validate, and restore. A classic script
 * loaded after settings.js, so `st`, `el` and the other panels' functions are
 * page globals (under Node, settings.js publishes them on globalThis first).
 *
 * Export merges settings and counters (two storage keys) into one file. Restore
 * splits them again: applyBackup returns { settings, counters? } and the caller
 * decides where each half is written. Two file kinds exist ('slop-filter-backup'
 * and 'slop-filter-rules') so a categories-only file can't be mistaken for a
 * full backup.
 */

/** Builds the export object; `kind` is 'all' or 'rules' (categories and ad flags only). */
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

/* A category is well-formed with a string name plus a rules array of strings,
   counting:true with a numeric threshold, or labs:true. Anything else is
   rejected here instead of breaking the Categories panel on render. */
function isValidBackupCategory(cat) {
  if (!cat || typeof cat !== 'object') return false;
  if (typeof cat.name !== 'string' || !cat.name) return false;
  if (cat.counting === true) return Number.isFinite(cat.threshold);
  if (cat.labs === true) return true;
  return Array.isArray(cat.rules) && cat.rules.every(r => typeof r === 'string');
}

/**
 * Checks a parsed backup file. Invalid JSON is the caller's case; this tells an
 * unrecognized `kind` from a recognized kind with a malformed shape.
 * Returns { ok: true, kind: 'all' | 'rules' } or { ok: false, error }.
 */
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

/**
 * Replaces categories and ad flags always; people lists and counters only from
 * a full backup, so a rules-only restore leaves them untouched. The result goes
 * through migrate() so a file from another version normalizes like a loaded blob.
 */
function applyBackup(parsed, currentSettings) {
  const merged = {
    ...currentSettings,
    schema: 2,
    categories: parsed.categories,
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
    return { settings, counters: st.normalizeCounters(parsed.counters) };
  }
  return { settings };
}

/** Downloads `obj` as a JSON file. */
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
    try { data = JSON.parse(String(fr.result)); }
    catch { return fail('It is not valid JSON. Pick a file exported from this extension.'); }

    const result = validateBackup(data);
    if (!result.ok) return fail(result.error);
    showRestorePreview(doc, data, result.kind, file.name);
  };
  fr.onerror = () => fail('The file could not be read.');
  fr.readAsText(file);
}

/*
 * Shows what the file contains and warns what it will replace before offering
 * the button, since restore is destructive. Nothing is written until the
 * confirm handler runs; Cancel discards the preview.
 */
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

function renderBackup() {} // nothing to render; renderAll calls it for symmetry

if (typeof module !== 'undefined') {
  Object.assign(module.exports, {
    buildExport, validateBackup, isValidBackupCategory, applyBackup, wireBackupPanel, renderBackup
  });
}
