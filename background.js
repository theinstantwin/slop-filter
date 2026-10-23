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

// Register the handler in the browser context.
if (typeof chrome !== 'undefined' && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(onInstalledHandler);
}

// Export for Node tests.
if (typeof module !== 'undefined') {
  module.exports = { onInstalledHandler };
}
