/**
 * Options page, startup. Loads last: boot awaits storage, and the awaited
 * continuation can run between script tags, so every panel function must
 * already be defined.
 */
if (typeof chrome !== 'undefined' && chrome.storage) {
  (async () => {
    st.settings = await st.load();

    // Activity counters are read once on page load: a page left open showing
    // numbers from when it was opened is fine. The settings blob itself is
    // kept live by onSettingsChanged below.
    st.counters = await st.readAll();
    const metaBlob = await chrome.storage.local.get(['sfMeta']);
    st.meta = metaBlob.sfMeta || {};

    // Open LinkedIn tabs pick the change up from chrome.storage.onChanged
    // (content.js) and re-judge their posts in place; nothing to notify.
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

    // Deep links need the panels rendered first.
    applyHash(document, location.hash);
    window.addEventListener('hashchange', () => applyHash(document, location.hash));
    // The worker re-sends a deep link the tab is already showing (no hashchange then).
    chrome.runtime?.onMessage?.addListener((msg, sender) => {
      if (msg?.type === 'sf-settings-hash' && sender?.id === chrome.runtime.id) applyHash(document, msg.hash);
    });

    // The feed edits settings too (stepper, mute, Undo). Pick those up so this
    // page never shows or saves a stale copy. Our own saves echo back equal
    // and are skipped.
    chrome.storage.onChanged?.addListener(onSettingsChanged);
  })();
}
