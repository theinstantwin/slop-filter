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

// The notice's pig popover asks to open Settings on the Muted people panel.
// A content script cannot call chrome.tabs, and openOptionsPage cannot carry
// a #hash, so the worker opens the page itself.
function onMessageHandler(msg, sender) {
  if (!msg || msg.type !== 'sf-open-settings') return;
  if (typeof chrome === 'undefined' || !chrome.runtime || sender?.id !== chrome.runtime.id) return;
  const panel = /^[a-z]+$/.test(msg.panel || '') ? msg.panel : '';
  chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') + (panel ? '#' + panel : '') });
}

// Register the handler in the browser context.
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(onInstalledHandler);
  chrome.runtime.onMessage.addListener(onMessageHandler);
}

// Export for Node tests.
if (typeof module !== 'undefined') {
  module.exports = { onInstalledHandler, onMessageHandler };
}
