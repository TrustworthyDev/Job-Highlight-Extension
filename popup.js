/* Popup: the master switch plus the three feature toggles. Everything else
   (hidden jobs, keyword groups, blocked companies, sync, backup) lives on the
   settings page — see hidden.html. */

const $ = (id) => document.getElementById(id);

/** When the master toggle is off, dim + disable the per-feature toggles. */
function setFeaturesEnabled(on) {
  $("featureToggles").classList.toggle("disabled", !on);
  ["hideViewed", "manualHide", "highlightOn", "hideEasyApply"].forEach((id) => {
    $(id).disabled = !on;
  });
}

function openSettingsPage() {
  // hidden.html is registered as options_ui (open_in_tab), so openOptionsPage
  // focuses an existing settings tab instead of piling up copies — and needs no
  // extra permission, unlike a tabs.query({url}) lookup.
  //
  // openOptionsPage exists as a function even when no options page is registered
  // (e.g. the extension hasn't been reloaded since the manifest changed): it just
  // reports the failure through lastError. So check the callback and fall back to
  // opening the page directly, otherwise the button would silently do nothing.
  const openDirectly = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("hidden.html") }, () => window.close());
  };

  try {
    chrome.runtime.openOptionsPage(() => {
      if (chrome.runtime.lastError) openDirectly();
      else window.close();
    });
  } catch (e) {
    openDirectly();
  }
}

function init() {
  chrome.storage.sync.get(
    {
      extensionEnabled: true,
      hideViewedEnabled: true,
      manualHideEnabled: true,
      highlightEnabled: true,
      hideEasyApplyEnabled: false,
    },
    (res) => {
      $("extensionEnabled").checked = res.extensionEnabled;
      $("hideViewed").checked = res.hideViewedEnabled;
      $("manualHide").checked = res.manualHideEnabled;
      $("highlightOn").checked = res.highlightEnabled;
      $("hideEasyApply").checked = res.hideEasyApplyEnabled;
      setFeaturesEnabled(res.extensionEnabled);
    }
  );

  $("extensionEnabled").addEventListener("change", (e) => {
    setFeaturesEnabled(e.target.checked);
    chrome.storage.sync.set({ extensionEnabled: e.target.checked });
  });
  $("hideViewed").addEventListener("change", (e) =>
    chrome.storage.sync.set({ hideViewedEnabled: e.target.checked })
  );
  $("manualHide").addEventListener("change", (e) =>
    chrome.storage.sync.set({ manualHideEnabled: e.target.checked })
  );
  $("highlightOn").addEventListener("change", (e) =>
    chrome.storage.sync.set({ highlightEnabled: e.target.checked })
  );
  $("hideEasyApply").addEventListener("change", (e) =>
    chrome.storage.sync.set({ hideEasyApplyEnabled: e.target.checked })
  );

  $("openSettings").addEventListener("click", openSettingsPage);

  // The settings page can change the toggles too (via Import) — stay in step.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.extensionEnabled) {
      $("extensionEnabled").checked = changes.extensionEnabled.newValue !== false;
      setFeaturesEnabled(changes.extensionEnabled.newValue !== false);
    }
    if (changes.hideViewedEnabled) $("hideViewed").checked = changes.hideViewedEnabled.newValue !== false;
    if (changes.manualHideEnabled) $("manualHide").checked = changes.manualHideEnabled.newValue !== false;
    if (changes.highlightEnabled) $("highlightOn").checked = changes.highlightEnabled.newValue !== false;
    if (changes.hideEasyApplyEnabled) {
      $("hideEasyApply").checked = changes.hideEasyApplyEnabled.newValue === true;
    }
  });
}

init();
