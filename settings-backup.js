/**
 * Options page, Backup panel. Classic script loaded by settings.html after settings.js,
 * so `st`, `el` and the other panels' functions are shared page globals. Under
 * Node, settings.js publishes them on globalThis before requiring this file.
 */
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

if (typeof module !== 'undefined') {
  Object.assign(module.exports, {
    buildExport, validateBackup, isValidBackupCategory, applyBackup, wireBackupPanel, renderBackup
  });
}
