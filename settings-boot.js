/**
 * Options page startup. Must load last: the awaited storage reads can resume
 * between script tags, so every panel function has to exist already.
 */
if (typeof chrome !== 'undefined' && chrome.storage) {
  (async () => {
    st.settings = await st.load();

    // Counters are read once; a stale Activity panel is acceptable. The
    // settings blob stays live through onSettingsChanged below.
    st.counters = await st.readAll();
    const metaBlob = await chrome.storage.local.get(['sfMeta']);
    st.meta = metaBlob.sfMeta || {};

    // Open LinkedIn tabs react to the storage change themselves (content.js).
    st.persist = async () => {
      await st.save(st.settings);
      flashSaved(document);
    };

    wirePanelSwitching(document);

    const verEl = document.getElementById('ver');
    if (verEl && chrome.runtime && chrome.runtime.getManifest) {
      verEl.textContent = 'v' + chrome.runtime.getManifest().version;
    }

    renderAll(document);
    wireCategoriesPanel(document);
    wirePromotedPanel(document);
    wireLabsPanel(document);
    wireTrustedAdd(document);
    wireBackupPanel(document);

    // Deep links need rendered panels.
    applyHash(document, location.hash);
    window.addEventListener('hashchange', () => applyHash(document, location.hash));
    // The worker re-sends a link to the current hash, which fires no hashchange.
    chrome.runtime?.onMessage?.addListener((msg, sender) => {
      if (msg?.type === 'sf-settings-hash' && sender?.id === chrome.runtime.id) applyHash(document, msg.hash);
    });

    // The feed edits settings too (stepper, mute, Undo). Syncing keeps this
    // page from showing or saving a stale copy; its own saves echo back equal
    // and are skipped.
    chrome.storage.onChanged?.addListener(onSettingsChanged);
  })();
}
