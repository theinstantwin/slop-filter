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
      val.textContent = `${cat.threshold}+`;
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
    empty.textContent = 'No one muted yet. Open the Slop Filter bar on any flagged post and press Mute, or use the ··· menu on a post.';
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
}

if (typeof module !== 'undefined') module.exports = { renderFilters, renderMutes, applySettings };

if (typeof chrome !== 'undefined' && chrome.storage) {
  (async () => {
    let settings = await pf.load();
    applySettings(document, settings);

    const settingsLink = document.getElementById('open-settings');
    if (settingsLink) {
      settingsLink.addEventListener('click', () => chrome.runtime.openOptionsPage());
    }

    // Open LinkedIn tabs re-judge their posts from chrome.storage.onChanged.
    const persist = () => pf.save(settings);

    document.addEventListener('change', async e => {
      if (e.target.name === 'flagmode') { settings.flagMode = e.target.value; await persist(); }
      const id = e.target.dataset.toggle;
      if (id) { settings = pf.setCategoryOn(settings, id, e.target.checked); await persist(); }
    });

    document.addEventListener('click', async e => {
      const step = e.target.dataset.step;
      if (step) {
        const id = e.target.closest('[data-threshold]').dataset.threshold;
        const current = settings.categories.find(c => c.id === id).threshold;
        settings = pf.setThreshold(settings, id, current + Number(step));
        const next = settings.categories.find(c => c.id === id).threshold;
        e.target.parentElement.querySelector('.val').textContent = `${next}+`;
        await persist();
      }
      const author = e.target.dataset.unmute;
      if (author) { settings = pf.unmute(settings, author); renderMutes(document, settings); await persist(); }
    });
  })();
}
