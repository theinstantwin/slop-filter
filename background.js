/**
 * background.js — service worker for Slop Filter
 *
 * Records the installation timestamp once when the extension is first installed.
 * On upgrade, the handler is called with reason='update' and does nothing.
 */

// The toolbar icon is static: red pig when filtering, grey eyes-shut pig when
// paused. It never animates. The worker has no storage.js, so it reads the
// settings blob directly (same key as storage.js's STORAGE_KEY).
const SETTINGS_KEY = 'slopFilterSettings';

function iconPaths(paused) {
  const stem = paused ? 'icons/icon-paused-' : 'icons/icon-';
  const out = {};
  for (const n of [16, 32, 48, 128]) out[n] = stem + n + '.png';
  return out;
}

function applyIcon(paused) {
  if (typeof chrome === 'undefined' || !chrome.action || !chrome.action.setIcon) return;
  try {
    const p = chrome.action.setIcon({ path: iconPaths(!!paused) });
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* worker shutting down; the next event sets it again */ }
}

async function syncIconFromStorage() {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  let blob = {};
  try { blob = await chrome.storage.local.get([SETTINGS_KEY]); } catch (e) { return; }
  applyIcon(blob[SETTINGS_KEY] && blob[SETTINGS_KEY].paused === true);
}

function onStorageChangedHandler(changes, area) {
  if (area !== 'local' || !changes || !changes[SETTINGS_KEY]) return;
  const next = changes[SETTINGS_KEY].newValue;
  const before = changes[SETTINGS_KEY].oldValue;
  const paused = !!(next && next.paused === true);
  if (before && (before.paused === true) === paused) return;
  applyIcon(paused);
}

function onInstalledHandler(details) {
  syncIconFromStorage();
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

/** The open Settings tab as {id, windowId, url}, or undefined. */
async function findSettingsTab(base) {
  try {
    if (chrome.runtime.getContexts) {
      const ctx = (await chrome.runtime.getContexts({ contextTypes: ['TAB'] }))
        .find(c => c.tabId >= 0 && (c.documentUrl || '').startsWith(base));
      return ctx && { id: ctx.tabId, windowId: ctx.windowId, url: ctx.documentUrl };
    }
    const [tab] = await chrome.tabs.query({ url: base + '*' });
    return tab;
  } catch (e) { return undefined; }
}

async function onMessageHandler(msg, sender) {
  if (!msg || msg.type !== 'sf-open-settings') return;
  if (typeof chrome === 'undefined' || !chrome.runtime || sender?.id !== chrome.runtime.id) return;
  const base = chrome.runtime.getURL('settings.html');
  const url = base + settingsHash(msg);
  // Reuse an open Settings tab: changing only the #hash fires hashchange in
  // the page, so it moves to the new spot without a reload. Without the
  // "tabs" permission, tabs.query can't read tab URLs, so the worker finds
  // its own Settings page through runtime.getContexts (no permission needed)
  // and only falls back to tabs.query on Chrome versions without it.
  const existing = await findSettingsTab(base);
  if (existing) {
    if (existing.url === url) {
      // Same URL, same hash: navigating would fire no hashchange, so tell the
      // page to jump again itself.
      await chrome.tabs.update(existing.id, { active: true });
      chrome.runtime.sendMessage?.({ type: 'sf-settings-hash', hash: settingsHash(msg) })?.catch?.(() => {});
    } else {
      await chrome.tabs.update(existing.id, { url, active: true });
    }
    if (existing.windowId != null) chrome.windows?.update?.(existing.windowId, { focused: true });
    return;
  }
  chrome.tabs.create({ url });
}

// Register the handler in the browser context.
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(onInstalledHandler);
  // Wrapped so the listener returns undefined: no reply is sent, and a
  // returned Promise would only hold the message port open.
  chrome.runtime.onMessage.addListener((msg, sender) => { onMessageHandler(msg, sender); });
  chrome.runtime.onStartup?.addListener(syncIconFromStorage);
  chrome.storage?.onChanged?.addListener(onStorageChangedHandler);
  syncIconFromStorage(); // every worker wake-up, so the icon never drifts
}

// Export for Node tests.
if (typeof module !== 'undefined') {
  module.exports = { onInstalledHandler, onMessageHandler, settingsHash,
    onStorageChangedHandler, syncIconFromStorage, iconPaths };
}
