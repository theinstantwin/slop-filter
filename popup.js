/**
 * Popover script. In the browser, popup.html loads filters.js and
 * storage.js as plain scripts before this one, so `findMatches`, `load`,
 * `save`, `unmute` are already globals in that shared page scope. Under
 * `node --test`, this file is required directly with no such scope.
 *
 * Matching content.js's `sf` pattern: every identifier this file consumes
 * from another module is resolved once into a single namespaced object,
 * never called as a bare global. That is what keeps popup.js safe if a
 * future edit adds its own top-level `save` or `load` helper — a bare
 * `function save(...)` here would otherwise silently shadow storage.js's
 * `save`, or (with `const`/`let`) throw a parse-time redeclaration error
 * that kills the whole popup with no test to catch it, since popup.js is
 * not part of the content-script bundle test/bundle.test.js guards.
 */
const pf = (typeof module !== 'undefined' && typeof require !== 'undefined')
  ? { ...require('./filters.js'), ...require('./storage.js') }
  : { load, save, unmute, setCategoryOn, setThreshold };

// Same key counters.js writes when a post is caught (see LAST_CAUGHT_KEY there).
// Not required from counters.js: that file also runs content-script setup.
const LAST_CAUGHT_KEY = 'sfLastCaughtAt';
const CAUGHT_WINDOW_MS = 5000;   // a catch this recent makes the pig react on open
const REACT_MS = 1600;           // two twitches, then settle back to "Watching"

const LABEL_ON = 'Watching your feed';
const LABEL_CAUGHT = 'Caught one';
const LABEL_PAUSED = 'Paused';

const FLAG_HINTS = {
  collapse: 'Collapsed posts sit behind a Show post button.',
  label: 'Flagged posts stay open, with a notice above them.',
};

// Same geometry as PIG_BADGE in notice.js (a test keeps the two in step),
// plus an eyes-shut variant and the drifting z for the paused state.
const POPUP_PIG =
  '<svg class="pig" viewBox="16 16 96 96" aria-hidden="true">' +
  '<circle class="bg" cx="64" cy="64" r="48" fill="#C62D18"/>' +
  '<g transform="translate(64 64) scale(.9) translate(-64 -59)">' +
  '<path class="earL" d="M36 50 Q30 34 36 27 Q44 26 56 38 Z" fill="#FEFDFB" stroke="#FEFDFB" stroke-width="4" stroke-linejoin="round"/>' +
  '<path class="earR" d="M92 50 Q98 34 92 27 Q84 26 72 38 Z" fill="#FEFDFB" stroke="#FEFDFB" stroke-width="4" stroke-linejoin="round"/>' +
  '<ellipse cx="64" cy="64" rx="34" ry="28" fill="#FEFDFB"/>' +
  '<g class="eyes-open"><circle cx="50" cy="56" r="3.8" fill="#12212B"/><circle cx="78" cy="56" r="3.8" fill="#12212B"/></g>' +
  '<g class="eyes-shut"><path d="M45 57 Q50 61 55 57" fill="none" stroke="#12212B" stroke-width="2.6" stroke-linecap="round"/>' +
  '<path d="M73 57 Q78 61 83 57" fill="none" stroke="#12212B" stroke-width="2.6" stroke-linecap="round"/></g>' +
  '<g class="snout">' +
  '<ellipse cx="64" cy="73" rx="18" ry="12.5" fill="#FEFDFB" stroke="#C62D18" stroke-width="4"/>' +
  '<ellipse cx="57.5" cy="73" rx="3" ry="5" fill="#C62D18"/>' +
  '<ellipse cx="70.5" cy="73" rx="3" ry="5" fill="#C62D18"/>' +
  '</g></g>' +
  '<text class="z" x="96" y="34">z</text><text class="z z2" x="104" y="26" style="font-size:16px">z</text>' +
  '</svg>';

/** 'asleep' | 'react' | 'awake' — what the header pig shows. */
function pigState(settings, caughtAt, now) {
  if (settings.paused) return 'asleep';
  if (caughtAt && now - caughtAt <= CAUGHT_WINDOW_MS && now >= caughtAt) return 'react';
  return 'awake';
}

/** Draws the header pig, status label and pause switch for a state. */
function renderStatus(doc, state) {
  const btn = doc.getElementById('pig-toggle');
  btn.innerHTML = POPUP_PIG; // static constant, no page data
  const svg = btn.querySelector('svg');
  if (state === 'asleep') svg.classList.add('asleep');
  if (state === 'react') svg.classList.add('react');
  const on = state !== 'asleep';
  const sw = doc.getElementById('pause-switch');
  if (sw) {
    sw.checked = on;
    sw.setAttribute('aria-checked', String(on));
  }
  const swl = doc.getElementById('switch-label');
  if (swl) swl.textContent = on ? 'On' : 'Paused';
  doc.getElementById('status').textContent =
    state === 'asleep' ? LABEL_PAUSED : state === 'react' ? LABEL_CAUGHT : LABEL_ON;
}

/** After the twitch finishes, drop back to the resting awake pig. */
function settleStatus(doc) {
  const svg = doc.querySelector('#pig-toggle svg');
  if (!svg || !svg.classList.contains('react')) return;
  svg.classList.remove('react');
  doc.getElementById('status').textContent = LABEL_ON;
}

function renderFlagHint(doc, mode) {
  const hint = doc.getElementById('flag-hint');
  if (hint) hint.textContent = FLAG_HINTS[mode] || FLAG_HINTS.collapse;
}

function renderFooter(doc, version) {
  const v = doc.getElementById('version');
  if (v) v.textContent = version ? `v${version}` : '';
}


function renderFilters(doc, settings) {
  const host = doc.getElementById('filters');
  host.textContent = '';
  for (const cat of settings.categories.filter(c => !c.labs)) {
    const row = doc.createElement('div');
    row.className = 'frow';
    row.dataset.filterRow = cat.id;

    const main = doc.createElement('div');
    main.className = 'frow-m';
    const nameEl = doc.createElement('div');
    nameEl.className = 'frow-n';
    nameEl.textContent = cat.name;
    main.appendChild(nameEl);
    row.appendChild(main);

    if (cat.counting) {
      const thr = doc.createElement('div');
      thr.className = 'thr';
      thr.dataset.threshold = cat.id;

      const lower = doc.createElement('button');
      lower.dataset.step = '-1';
      lower.setAttribute('aria-label', `Lower ${cat.name} threshold`);
      lower.textContent = '−';
      thr.appendChild(lower);

      const val = doc.createElement('span');
      val.className = 'val';
      val.textContent = String(cat.threshold);
      thr.appendChild(val);

      const raise = doc.createElement('button');
      raise.dataset.step = '1';
      raise.setAttribute('aria-label', `Raise ${cat.name} threshold`);
      raise.textContent = '+';
      thr.appendChild(raise);

      row.appendChild(thr);
    }

    const sw = doc.createElement('label');
    sw.className = 'sw';
    const checkbox = doc.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.toggle = cat.id;
    checkbox.checked = !!cat.on;
    checkbox.setAttribute('aria-label', cat.name);
    sw.appendChild(checkbox);
    sw.appendChild(doc.createElement('span'));
    row.appendChild(sw);

    host.appendChild(row);
  }
}

function renderMutes(doc, settings) {
  const host = doc.getElementById('mutes');
  host.textContent = '';
  if (!settings.mutedAuthors.length) {
    const empty = doc.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No one yet. Hover the pig on a flagged post to mute someone.';
    host.appendChild(empty);
    return;
  }
  for (const author of settings.mutedAuthors) {
    const row = doc.createElement('div');
    row.className = 'mrow';
    const name = doc.createElement('span');
    name.textContent = author;
    const btn = doc.createElement('button');
    btn.dataset.unmute = author;
    btn.textContent = 'Unmute';
    row.append(name, btn);
    host.appendChild(row);
  }
}

/**
 * Applies a loaded settings blob to the popup's DOM: renders the filter rows,
 * renders the muted list, and checks the flagmode radio matching
 * settings.flagMode. Extracted so the chrome-storage IIFE below has exactly
 * one call site for "settings changed, redraw the popup" — the same shape
 * the IIFE already needs after a mute/unmute or threshold change — and so
 * this sequence is reachable from node --test without a chrome global.
 */
function applySettings(doc, settings) {
  renderFilters(doc, settings);
  renderMutes(doc, settings);
  doc.querySelector(`input[name="flagmode"][value="${settings.flagMode}"]`).checked = true;
  renderFlagHint(doc, settings.flagMode);
}

/**
 * Wires the popup to chrome. Takes the document and chrome API explicitly so
 * node --test can drive it with jsdom and a stub.
 */
async function initPopup(doc, api, now = Date.now()) {
  let settings = await pf.load();
  applySettings(doc, settings);

  let caughtAt = 0;
  try {
    const blob = await api.storage.local.get([LAST_CAUGHT_KEY]);
    caughtAt = blob[LAST_CAUGHT_KEY] || 0;
  } catch (e) { /* no timestamp: the pig just rests */ }

  let timer = null;
  const paint = (t) => {
    renderStatus(doc, pigState(settings, caughtAt, t));
    clearTimeout(timer);
    if (pigState(settings, caughtAt, t) === 'react') {
      timer = setTimeout(() => settleStatus(doc), REACT_MS);
    }
  };
  paint(now);
  renderFooter(doc, api.runtime.getManifest().version);

  // Open LinkedIn tabs re-judge their posts from chrome.storage.onChanged.
  const persist = () => pf.save(settings);

  // The switch is the one control. A click anywhere else in the header
  // delegates to it; its own click is left alone so it toggles exactly once.
  const sw = doc.getElementById('pause-switch');
  sw.addEventListener('change', async () => {
    settings = { ...settings, paused: !sw.checked };
    paint(Date.now());
    await persist();
  });
  doc.getElementById('head').addEventListener('click', e => {
    if (e.target !== sw) sw.click();
  });
  doc.getElementById('open-settings').addEventListener('click', () => api.runtime.openOptionsPage());

  doc.addEventListener('change', async e => {
    if (e.target.name === 'flagmode') {
      settings.flagMode = e.target.value;
      renderFlagHint(doc, settings.flagMode);
      await persist();
    }
    const id = e.target.dataset.toggle;
    if (id) { settings = pf.setCategoryOn(settings, id, e.target.checked); await persist(); }
  });

  doc.addEventListener('click', async e => {
    const step = e.target.dataset.step;
    if (step) {
      const id = e.target.closest('[data-threshold]').dataset.threshold;
      const current = settings.categories.find(c => c.id === id).threshold;
      settings = pf.setThreshold(settings, id, current + Number(step));
      const next = settings.categories.find(c => c.id === id).threshold;
      e.target.parentElement.querySelector('.val').textContent = String(next);
      await persist();
    }
    const author = e.target.dataset.unmute;
    if (author) { settings = pf.unmute(settings, author); renderMutes(doc, settings); await persist(); }
  });
}

if (typeof module !== 'undefined') {
  module.exports = { renderFilters, renderMutes, applySettings, initPopup,
    renderStatus, settleStatus, pigState, renderFlagHint, renderFooter,
    POPUP_PIG, LAST_CAUGHT_KEY, CAUGHT_WINDOW_MS };
}

if (typeof chrome !== 'undefined' && chrome.storage) initPopup(document, chrome);
