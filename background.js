/**
 * Service worker: on install, seed settings from the bundled defaults.json so a
 * freshly-loaded copy of the extension (e.g. on another Chrome profile) already
 * has the keyword groups. Existing settings are never overwritten.
 */
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const res = await chrome.storage.sync.get("highlightGroups");
    if (res.highlightGroups && res.highlightGroups.length) return; // keep user's data

    const defaults = await fetch(chrome.runtime.getURL("defaults.json")).then((r) => r.json());
    await chrome.storage.sync.set({
      extensionEnabled: defaults.extensionEnabled !== false,
      hideViewedEnabled: defaults.hideViewedEnabled !== false,
      manualHideEnabled: defaults.manualHideEnabled !== false,
      highlightEnabled: defaults.highlightEnabled !== false,
      highlightGroups: defaults.highlightGroups || [],
    });
  } catch (e) {
    // defaults.json missing or unreadable — leave storage as-is.
  }
});
