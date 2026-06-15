/* Popup: master toggles + CRUD for highlight keyword groups + export/import. */

const $ = (id) => document.getElementById(id);
let groups = [];
let editingId = null; // null = adding new

/* ---- contrast helper for the colored badge ---- */
function contrastText(hex) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#000" : "#fff";
}

function uid() {
  return "g" + Date.now() + Math.floor(Math.random() * 1000);
}

function saveGroups() {
  chrome.storage.sync.set({ highlightGroups: groups });
}

/* ---- rendering ---- */
function render() {
  const filter = $("filter").value.trim().toLowerCase();
  const list = $("list");
  list.innerHTML = "";

  const visible = groups.filter(
    (g) =>
      !filter ||
      g.label.toLowerCase().includes(filter) ||
      g.terms.some((t) => t.toLowerCase().includes(filter))
  );

  $("empty").hidden = groups.length !== 0;

  for (const g of visible) {
    const li = document.createElement("li");
    li.className = "item" + (g.enabled ? "" : " disabled");

    const badge = document.createElement("span");
    badge.className = "badge";
    badge.style.background = g.color;
    badge.style.color = contrastText(g.color);
    badge.textContent = (g.label[0] || "?").toUpperCase();

    const text = document.createElement("div");
    text.className = "item-text";
    const label = document.createElement("div");
    label.className = "item-label";
    label.textContent = g.label;
    const terms = document.createElement("div");
    terms.className = "item-terms";
    terms.textContent = g.terms.join(", ");
    text.append(label, terms);

    const pause = iconBtn(g.enabled ? "⏸" : "▶", g.enabled ? "Pause" : "Enable", () => {
      g.enabled = !g.enabled;
      saveGroups();
      render();
    });
    const edit = iconBtn("✎", "Edit", () => openForm(g.id));
    const del = iconBtn("🗑", "Delete", () => {
      groups = groups.filter((x) => x.id !== g.id);
      saveGroups();
      render();
    });

    li.append(badge, text, pause, edit, del);
    list.appendChild(li);
  }
}

function iconBtn(symbol, title, onClick) {
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.textContent = symbol;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

/* ---- add / edit form ---- */
function openForm(id) {
  editingId = id || null;
  const g = id ? groups.find((x) => x.id === id) : null;
  $("fLabel").value = g ? g.label : "";
  $("fTerms").value = g ? g.terms.join(", ") : "";
  $("fColor").value = g ? g.color : "#ffff00";
  $("form").hidden = false;
  $("fLabel").focus();
}

function closeForm() {
  $("form").hidden = true;
  editingId = null;
}

function submitForm() {
  const label = $("fLabel").value.trim();
  const terms = $("fTerms").value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const color = $("fColor").value;
  if (!label && !terms.length) return closeForm();
  // Default the matched words to the label if none were given explicitly.
  const finalTerms = terms.length ? terms : [label];

  if (editingId) {
    const g = groups.find((x) => x.id === editingId);
    Object.assign(g, { label: label || finalTerms[0], terms: finalTerms, color });
  } else {
    groups.push({ id: uid(), label: label || finalTerms[0], terms: finalTerms, color, enabled: true });
  }
  saveGroups();
  closeForm();
  render();
}

/* ---- export / import ---- */
function exportSettings() {
  const data = {
    version: 1,
    extensionEnabled: $("extensionEnabled").checked,
    hideViewedEnabled: $("hideViewed").checked,
    manualHideEnabled: $("manualHide").checked,
    highlightEnabled: $("highlightOn").checked,
    highlightGroups: groups,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "linkedin-job-tools-settings.json";
  a.click();
  URL.revokeObjectURL(url);
}

function normalizeGroup(g) {
  return {
    id: g.id || uid(),
    label: g.label || (g.terms && g.terms[0]) || "?",
    terms: Array.isArray(g.terms) ? g.terms : [],
    color: g.color || "#ffff00",
    enabled: g.enabled !== false,
  };
}

function importSettings(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (Array.isArray(data.highlightGroups)) {
        groups = data.highlightGroups.map(normalizeGroup);
        saveGroups();
      }
      if (typeof data.extensionEnabled === "boolean") {
        $("extensionEnabled").checked = data.extensionEnabled;
        setFeaturesEnabled(data.extensionEnabled);
        chrome.storage.sync.set({ extensionEnabled: data.extensionEnabled });
      }
      if (typeof data.hideViewedEnabled === "boolean") {
        $("hideViewed").checked = data.hideViewedEnabled;
        chrome.storage.sync.set({ hideViewedEnabled: data.hideViewedEnabled });
      }
      if (typeof data.manualHideEnabled === "boolean") {
        $("manualHide").checked = data.manualHideEnabled;
        chrome.storage.sync.set({ manualHideEnabled: data.manualHideEnabled });
      }
      if (typeof data.highlightEnabled === "boolean") {
        $("highlightOn").checked = data.highlightEnabled;
        chrome.storage.sync.set({ highlightEnabled: data.highlightEnabled });
      }
      render();
    } catch (e) {
      alert("Could not import: the file is not valid settings JSON.");
    }
  };
  reader.readAsText(file);
}

/* ---- hidden jobs (stored in chrome.storage.local; managed on hidden.html) ---- */
function refreshHiddenCount() {
  // Ask the background bridge so the count reflects the shared file (falls back
  // to local automatically if the native host isn't installed).
  chrome.runtime.sendMessage({ type: "lhvj-load" }, (state) => {
    const hidden =
      !chrome.runtime.lastError && state && state.manualHidden ? state.manualHidden : null;
    if (hidden) {
      $("hiddenCount").textContent = String(Object.keys(hidden).length);
    } else {
      chrome.storage.local.get({ manualHidden: {} }, (res) => {
        $("hiddenCount").textContent = String(Object.keys(res.manualHidden || {}).length);
      });
    }
  });
}

function openHiddenPage() {
  chrome.tabs.create({ url: chrome.runtime.getURL("hidden.html") });
}

/* ---- profile sync (native host) setup helper ---- */
function refreshSyncStatus() {
  const pill = $("syncStatus");
  const hint = $("syncHint");
  const id = chrome.runtime.id;
  chrome.runtime.sendMessage({ type: "lhvj-host-status" }, (resp) => {
    const on = !chrome.runtime.lastError && resp && resp.connected;
    pill.textContent = on ? "On" : "Off";
    pill.className = "pill " + (on ? "pill-on" : "pill-off");
    hint.innerHTML = on
      ? "Clicked &amp; hidden jobs are shared across all profiles."
      : 'Per-profile only. To share across profiles: click <b>Copy setup command</b>, ' +
        "run it in the extension's <code>native-host</code> folder, then restart Chrome.";
    $("copySetup").textContent = on ? "Copy setup command (re-run)" : "Copy setup command";
    $("copySetup").dataset.cmd = "install.bat " + id;
  });
}

function copySetupCommand() {
  const btn = $("copySetup");
  const cmd = btn.dataset.cmd || "install.bat " + chrome.runtime.id;
  navigator.clipboard.writeText(cmd).then(
    () => {
      const prev = btn.textContent;
      btn.textContent = "Copied: " + cmd;
      setTimeout(() => {
        btn.textContent = prev;
      }, 2500);
    },
    () => {
      // Clipboard blocked — show the command so it can be copied manually.
      $("syncHint").textContent = "Run this in the native-host folder: " + cmd;
    }
  );
}

/* ---- init ---- */
async function loadDefaults() {
  try {
    const res = await fetch(chrome.runtime.getURL("defaults.json"));
    const data = await res.json();
    return (data.highlightGroups || []).map(normalizeGroup);
  } catch (e) {
    return [];
  }
}

/** When the master toggle is off, dim + disable the per-feature toggles. */
function setFeaturesEnabled(on) {
  $("featureToggles").classList.toggle("disabled", !on);
  ["hideViewed", "manualHide", "highlightOn"].forEach((id) => {
    $(id).disabled = !on;
  });
}

function init() {
  chrome.storage.sync.get(
    {
      extensionEnabled: true,
      hideViewedEnabled: true,
      manualHideEnabled: true,
      highlightEnabled: true,
      highlightGroups: null,
    },
    async (res) => {
      $("extensionEnabled").checked = res.extensionEnabled;
      $("hideViewed").checked = res.hideViewedEnabled;
      $("manualHide").checked = res.manualHideEnabled;
      $("highlightOn").checked = res.highlightEnabled;
      setFeaturesEnabled(res.extensionEnabled);

      if (res.highlightGroups === null) {
        // First run (no background seed yet): pull groups from defaults.json.
        groups = await loadDefaults();
        saveGroups();
      } else {
        groups = res.highlightGroups;
      }
      render();
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
  $("filter").addEventListener("input", render);
  $("addBtn").addEventListener("click", () => openForm(null));
  $("cancelBtn").addEventListener("click", closeForm);
  $("saveBtn").addEventListener("click", submitForm);
  $("exportBtn").addEventListener("click", exportSettings);
  $("importBtn").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", (e) => {
    if (e.target.files[0]) importSettings(e.target.files[0]);
    e.target.value = "";
  });

  $("viewHidden").addEventListener("click", openHiddenPage);
  $("copySetup").addEventListener("click", copySetupCommand);
  refreshHiddenCount();
  refreshSyncStatus();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.manualHidden) refreshHiddenCount();
  });
}

init();
