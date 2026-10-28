/**
 * Options page, Muted and Trusted People panels. A classic script loaded after
 * settings.js, so `st`, `el` and the other panels' functions are page globals
 * (under Node, settings.js publishes them on globalThis first).
 *
 * Both panels render from st.settings on every change (the array on screen is
 * the stored one) and persist through st.persist().
 */

/**
 * Muted people panel. Removing a name swaps the row for "Unmuted / Undo" for
 * six seconds. That state is page-local; the unmute is already saved, and Undo
 * saves again.
 */
function renderMutes(doc) {
  const host = doc.getElementById('mutes');
  host.textContent = '';

  if (!st.settings.mutedAuthors.length) {
    host.appendChild(el('p', 'placeholder',
      'Nobody is muted. Hover the pig on a flagged post to mute its author.'));
    return;
  }

  // Alphabetical: it's a lookup list, so insertion order carries no meaning.
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

    // Undo instead of a confirm dialog: unmuting is reversible, but on a long
    // list a misclick loses the name, which would have to be retyped.
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

/**
 * Trusted People panel. Mirrors the Muted panel, plus a text input and Add
 * button, since nothing in the feed adds a Trusted entry.
 */
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
    // allowAuthor throws if the name is muted; show the message and keep the
    // input so the user can edit and retry.
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
