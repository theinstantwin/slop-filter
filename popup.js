/**
 * Toolbar popup: pause switch, per-category toggles and thresholds, flag mode,
 * muted list. Every change re-reads storage and applies one transform, so
 * edits made in Settings meanwhile are not overwritten.
 * popup.html loads filters.js and storage.js first (globalThis.SlopFilter, or
 * required under Node); `pf` is the only top-level name added for them.
 */
const pf = typeof module !== 'undefined'
  ? { ...module.require('./filters.js'), ...module.require('./storage.js') }
  : globalThis.SlopFilter;

// Same key as counters.js's LAST_CAUGHT_KEY. Not imported because that file
// also sets up content-script listeners.
const CAUGHT_KEY = 'sfLastCaughtAt';
const CAUGHT_WINDOW_MS = 5000;   // a catch this recent makes the pig react on open
const REACT_MS = 1600;           // two twitches, then the pig settles

const FLAG_HINTS = {
  collapse: 'Collapsed posts sit behind a Show post button.',
  label: 'Flagged posts stay open, with a notice above them.',
};

// Same geometry as PIG_BADGE in notice.js (a test keeps them in step), plus
// the eyes-shut variant and drifting z for the paused state.
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

/** Which header pig to show: 'asleep' (paused), 'react' (recent catch), or 'awake'. */
function pigState(settings, caughtAt, now) {
  if (settings.paused) return 'asleep';
  if (caughtAt && now - caughtAt <= CAUGHT_WINDOW_MS && now >= caughtAt) return 'react';
  return 'awake';
}

/** Draws the header pig and pause switch for a state. */
function renderStatus(doc, state) {
  const btn = doc.getElementById('pig-toggle');
  // Parsed rather than set through innerHTML: Mozilla's add-on linter flags any
  // innerHTML assignment from a variable, even a packaged constant.
  btn.replaceChildren(new doc.defaultView.DOMParser().parseFromString(POPUP_PIG, 'text/html').body.firstChild);
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
}

/** Drops the pig back to its resting state after the twitch. */
function settleStatus(doc) {
  const svg = doc.querySelector('#pig-toggle svg');
  if (!svg || !svg.classList.contains('react')) return;
  svg.classList.remove('react');
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
    // Info mark showing the category description (the text Settings shows,
    // including edits). A CSS tooltip, because title is slow to appear.
    if (cat.def) {
      const info = doc.createElement('button');
      info.type = 'button';
      info.className = 'info';
      info.textContent = 'i';
      info.dataset.tip = cat.def;
      info.setAttribute('aria-label', `About ${cat.name}: ${cat.def}`);
      nameEl.appendChild(info);
    }
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
 * Redraws the whole popup from a settings blob: filter rows, muted list, flag
 * mode radio and hint. Separate from initPopup so tests can call it without a
 * chrome global.
 */
function applySettings(doc, settings) {
  renderFilters(doc, settings);
  renderMutes(doc, settings);
  doc.querySelector(`input[name="flagmode"][value="${settings.flagMode}"]`).checked = true;
  renderFlagHint(doc, settings.flagMode);
}

/**
 * Wires the popup to chrome. Takes the document and chrome API as arguments so
 * tests can pass jsdom and a stub.
 */
async function initPopup(doc, api, now = Date.now()) {
  let settings = await pf.load();
  applySettings(doc, settings);

  let caughtAt = 0;
  try {
    const blob = await api.storage.local.get([CAUGHT_KEY]);
    caughtAt = blob[CAUGHT_KEY] || 0;
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

  // Re-reads storage and applies fn to the fresh copy, so a Settings edit made
  // while the popup is open isn't overwritten by this popup's older snapshot.
  // Calls are serialized so two quick clicks can't read the same snapshot.
  let queue = Promise.resolve();
  const update = (fn) => {
    queue = queue.then(async () => {
      const fresh = await pf.load();
      const stale = JSON.stringify(fresh) !== JSON.stringify(settings);
      settings = fn(fresh);
      await pf.save(settings);
      if (stale) applySettings(doc, settings);
    });
    return queue;
  };

  // A change from elsewhere (Settings tab, another popup) repaints this one.
  if (api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[pf.STORAGE_KEY]) return;
      const next = changes[pf.STORAGE_KEY].newValue;
      if (!next || JSON.stringify(next) === JSON.stringify(settings)) return;
      settings = pf.migrate(next);
      applySettings(doc, settings);
      paint(Date.now());
    });
  }

  // A click anywhere in the header delegates to the switch; clicks on the
  // switch itself pass through so it toggles once.
  const sw = doc.getElementById('pause-switch');
  sw.addEventListener('change', async () => {
    const paused = !sw.checked;
    await update(s => ({ ...s, paused }));
    paint(Date.now());
  });
  doc.getElementById('head').addEventListener('click', e => {
    if (e.target !== sw) sw.click();
  });
  doc.getElementById('open-settings').addEventListener('click', () => api.runtime.openOptionsPage());

  doc.addEventListener('change', async e => {
    if (e.target.name === 'flagmode') {
      const flagMode = e.target.value;
      renderFlagHint(doc, flagMode);
      await update(s => ({ ...s, flagMode }));
    }
    const id = e.target.dataset.toggle;
    if (id) { const on = e.target.checked; await update(s => pf.setCategoryOn(s, id, on)); }
  });

  doc.addEventListener('click', async e => {
    const step = e.target.dataset.step;
    if (step) {
      const id = e.target.closest('[data-threshold]').dataset.threshold;
      const val = e.target.parentElement.querySelector('.val');
      await update(s => pf.setThreshold(s, id, s.categories.find(c => c.id === id).threshold + Number(step)));
      val.textContent = String(settings.categories.find(c => c.id === id).threshold);
    }
    const author = e.target.dataset.unmute;
    if (author) { await update(s => pf.unmute(s, author)); renderMutes(doc, settings); }
  });
}

if (typeof module !== 'undefined') {
  Object.assign(module.exports, { renderFilters, renderMutes, applySettings, initPopup,
    renderStatus, settleStatus, pigState, renderFlagHint, renderFooter,
    POPUP_PIG, LAST_CAUGHT_KEY: CAUGHT_KEY, CAUGHT_WINDOW_MS });
}

if (typeof chrome !== 'undefined' && chrome.storage) initPopup(document, chrome);
