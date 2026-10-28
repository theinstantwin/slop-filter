/**
 * Options page, Muted and Trusted People panels. Classic script loaded by settings.html after settings.js,
 * so `st`, `el` and the other panels' functions are shared page globals. Under
 * Node, settings.js publishes them on globalThis before requiring this file.
 */
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

if (typeof module !== 'undefined') {
  Object.assign(module.exports, {
    renderMutes, renderMute, renderTrusted, renderTrustedRow, wireTrustedAdd
  });
}
