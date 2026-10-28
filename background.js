/**
 * background.js — service worker for Slop Filter
 *
 * Records the installation timestamp once when the extension is first installed.
 * On upgrade, the handler is called with reason='update' and does nothing.
 */

function onInstalledHandler(details) {
  if (details.reason === 'install') {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({
        sfMeta: {
          installedAt: Date.now(),
        },
      });
    }
  }
}

// The notice asks to open Settings at an exact place: the Muted people panel
// (pig popover) or a category, optionally with one phrase (Change in Settings).
// A content script cannot call chrome.tabs, and openOptionsPage cannot carry a
// #hash, so the worker opens the page itself.
//   {panel:'muted'}            -> settings.html#panel=muted
//   {cat:'aiSlop', phrase:'x'} -> settings.html#cat=aiSlop&phrase=x
function settingsHash(msg) {
  const params = new URLSearchParams();
  if (/^[a-z]+$/.test(msg.panel || '')) params.set('panel', msg.panel);
  else if (/^[\w-]{1,40}$/.test(msg.cat || '')) {
    params.set('cat', msg.cat);
    if (typeof msg.phrase === 'string' && msg.phrase && msg.phrase.length <= 200) {
      params.set('phrase', msg.phrase);
    }
  }
  const h = params.toString();
  return h ? '#' + h : '';
}

async function onMessageHandler(msg, sender) {
  if (!msg || msg.type !== 'sf-open-settings') return;
  if (typeof chrome === 'undefined' || !chrome.runtime || sender?.id !== chrome.runtime.id) return;
  const base = chrome.runtime.getURL('settings.html');
  const url = base + settingsHash(msg);
  // Reuse an open Settings tab: changing only the #hash fires hashchange in
  // the page, so it moves to the new spot without a reload. Querying our own
  // extension pages by url needs no extra permission; if it fails anyway,
  // fall back to a new tab.
  let existing;
  try {
    [existing] = await chrome.tabs.query({ url: base + '*' });
  } catch (e) { existing = undefined; }
  if (existing) {
    await chrome.tabs.update(existing.id, { url, active: true });
    if (existing.windowId != null) chrome.windows?.update?.(existing.windowId, { focused: true });
    return;
  }
  chrome.tabs.create({ url });
}

// Register the handler in the browser context.
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(onInstalledHandler);
  chrome.runtime.onMessage.addListener(onMessageHandler);
}

// Export for Node tests.
if (typeof module !== 'undefined') {
  module.exports = { onInstalledHandler, onMessageHandler, settingsHash };
}
