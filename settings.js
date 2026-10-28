/**
 * Options page script. settings.html loads filters.js, storage.js and
 * counters.js first; their API is on globalThis.SlopFilter, or required under
 * `node --test`. `st` also holds this page's own state — `st.settings` (the
 * loaded blob) and `st.persist()` (save + flashSaved). No dom.js: nothing on
 * this page reads LinkedIn markup.
 *
 * The page is split by panel into settings-categories/people/activity/backup
 * .js and settings-boot.js, all classic scripts in one scope. This file loads
 * first and owns the shared helpers; the boot file loads last, once every
 * panel function exists.
 */
const st = typeof module !== 'undefined'
  ? { ...module.require('./filters.js'), ...module.require('./storage.js'), ...module.require('./counters.js') }
  : { ...globalThis.SlopFilter };

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
  /** @type {any} */ (t).unref?.(); // Node tests only; browsers return a number
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
  const node = [...doc.querySelectorAll('[data-cat]')].find(n => n.dataset.cat === cat.id);
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

let savedTimer;
function flashSaved(doc) {
  const s = doc.getElementById('saved');
  s.classList.add('on');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => s.classList.remove('on'), 1400);
}

const el = (t, c, txt) => {
  const n = document.createElement(t);
  if (c) n.className = c;
  if (txt !== undefined) n.textContent = txt;
  return n;
};

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
  renderBackup();
}

const PANEL_FILES = ['./settings-categories.js', './settings-people.js', './settings-activity.js', './settings-backup.js'];

if (typeof module !== 'undefined') {
  // Node has no shared scope: put the shared names on globalThis first, so the
  // panel files (and the functions below) find them as bare globals, as in the browser.
  Object.assign(globalThis, { st, el, flashSaved, renderAll, applyHash, wirePanelSwitching, parseSettingsHash });
  const panels = PANEL_FILES.map(f => module.require(f));
  Object.assign(globalThis, ...panels);
  Object.assign(module.exports, {
    st,
    wirePanelSwitching, parseSettingsHash, applyHash, onSettingsChanged, flashSaved, renderAll,
  }, ...panels);
}
