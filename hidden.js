/* Settings page: hidden jobs, keyword groups, blocked companies, profile sync
   and backup. The popup keeps only the on/off toggles.

   Hidden jobs, blocked companies AND keyword groups all live in the shared file,
   mirrored into chrome.storage.local by the background bridge. Only the on/off
   toggles are per-profile (chrome.storage.sync). */

const $ = (id) => document.getElementById(id);

let hidden = {};
let companies = {};
let groups = [];
let editingId = null; // null = adding a new group
let formOpen = false;

// The keyword form is a row inside #kwList: renderGroups() detaches it and puts it
// back at the row being edited, so it has to be held by reference — a later
// getElementById would come up empty while it's detached.
const formEl = document.getElementById("form");

// Current view state for the hidden-jobs toolbar.
const view = { q: "", site: "", range: "all", sort: "new" };

const DAY = 86400000;

/* ============================== tabs ============================== */

function showPanel(id) {
  for (const tab of $("tabs").children) {
    const on = tab.dataset.panel === id;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", String(on));
    $(tab.dataset.panel).hidden = !on;
  }
}

$("tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (tab) showPanel(tab.dataset.panel);
});

/* ============================== hidden jobs ============================== */

function rec(key) {
  const r = hidden[key];
  return r && typeof r === "object" ? r : {};
}

function hostLabel(r) {
  if (r.site && r.site !== "linkedin") return r.site;
  try {
    return new URL(r.url).hostname;
  } catch (e) {
    return r.site || "";
  }
}

function siteLabel(r) {
  return hostLabel(r).replace(/^www\./, "") || "unknown";
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function matchesRange(r) {
  if (view.range === "all") return true;
  const ts = r.ts || 0;
  if (!ts) return false; // no timestamp — only ever shown under "All time"
  if (view.range === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return ts >= start.getTime();
  }
  return Date.now() - ts <= Number(view.range) * DAY;
}

function matchesQuery(r) {
  if (!view.q) return true;
  const hay = [r.title, r.company, r.country, siteLabel(r)].filter(Boolean).join(" ").toLowerCase();
  return view.q.split(/\s+/).every((word) => hay.includes(word));
}

function visibleKeys() {
  const keys = Object.keys(hidden).filter((k) => {
    const r = rec(k);
    return (!view.site || siteLabel(r) === view.site) && matchesRange(r) && matchesQuery(r);
  });

  const by = {
    new: (a, b) => (rec(b).ts || 0) - (rec(a).ts || 0),
    old: (a, b) => (rec(a).ts || 0) - (rec(b).ts || 0),
    title: (a, b) => (rec(a).title || "").localeCompare(rec(b).title || ""),
    company: (a, b) => (rec(a).company || "").localeCompare(rec(b).company || ""),
  };
  return keys.sort(by[view.sort] || by.new);
}

function placeholderLogo(r) {
  const ph = document.createElement("div");
  ph.className = "logo placeholder";
  ph.textContent = ((r.company || r.title || "?").trim()[0] || "?").toUpperCase();
  return ph;
}

function makeCard(key, r) {
  const li = document.createElement("li");
  li.className = "card";

  // logo (or a letter placeholder)
  if (r.logo) {
    const img = document.createElement("img");
    img.className = "logo";
    img.src = r.logo;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => img.replaceWith(placeholderLogo(r));
    li.appendChild(img);
  } else {
    li.appendChild(placeholderLogo(r));
  }

  const info = document.createElement("div");
  info.className = "info";

  const title = document.createElement(r.url ? "a" : "div");
  title.className = "title";
  title.textContent = r.title || "(hidden card)";
  if (r.url) {
    title.href = r.url;
    title.target = "_blank";
    title.rel = "noreferrer";
  }
  info.appendChild(title);

  const metaParts = [r.company, r.country].filter(Boolean);
  if (metaParts.length) {
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = metaParts.join(" · ");
    info.appendChild(meta);
  }

  const sub = document.createElement("div");
  sub.className = "sub";
  const site = document.createElement("span");
  site.className = "tag";
  site.textContent = siteLabel(r);
  sub.appendChild(site);
  const when = timeAgo(r.ts);
  if (when) {
    const ago = document.createElement("span");
    ago.textContent = `hidden ${when}`;
    ago.title = new Date(r.ts).toLocaleString();
    sub.appendChild(ago);
  }
  info.appendChild(sub);

  li.appendChild(info);

  const restore = document.createElement("button");
  restore.className = "restore";
  restore.textContent = "Restore";
  restore.title = "Un-hide this card";
  restore.addEventListener("click", () => {
    delete hidden[key];
    render();
    chrome.runtime.sendMessage({ type: "lhvj-apply", ops: [{ type: "unhide", sig: key }] });
  });
  li.appendChild(restore);

  return li;
}

function syncSiteOptions() {
  const select = $("siteFilter");
  const sites = [...new Set(Object.keys(hidden).map((k) => siteLabel(rec(k))))].sort();
  const current = view.site;

  select.textContent = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "All sites";
  select.appendChild(all);
  for (const site of sites) {
    const opt = document.createElement("option");
    opt.value = site;
    opt.textContent = site;
    select.appendChild(opt);
  }

  // Keep the chosen site selected; drop it if nothing is hidden from it anymore.
  if (current && !sites.includes(current)) view.site = "";
  select.value = view.site;
}

function filtersActive() {
  return Boolean(view.q || view.site) || view.range !== "all";
}

function render() {
  syncSiteOptions();

  const list = $("list");
  list.textContent = "";
  const total = Object.keys(hidden).length;
  const keys = visibleKeys();

  $("count").textContent = String(total);
  $("clearAll").disabled = total === 0;

  for (const key of keys) list.appendChild(makeCard(key, rec(key)));

  const filtered = filtersActive();
  $("empty").hidden = total !== 0;
  $("noResults").hidden = !(total !== 0 && keys.length === 0);
  $("resultInfo").hidden = !(filtered && keys.length > 0);
  $("resultInfo").textContent = `Showing ${keys.length} of ${total} hidden jobs`;
}

/* ============================== keyword groups ============================== */

function contrastText(hex) {
  const c = String(hex || "").replace("#", "");
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#000" : "#fff";
}

function uid() {
  return "g" + Date.now() + Math.floor(Math.random() * 1000);
}

/**
 * Keyword groups live in the shared file, next to the hidden/clicked cards, so a
 * change here lands in native-host/shared-state.json and every profile picks it up.
 * Ops are per-group (by id) so two profiles editing different groups merge instead
 * of overwriting each other's list; setGroups is only for a wholesale replace.
 */
function groupOp(op) {
  chrome.runtime.sendMessage({ type: "lhvj-apply", ops: [op] }, (resp) => {
    const merged = resp && resp.state && resp.state.highlightGroups;
    if (!chrome.runtime.lastError && Array.isArray(merged)) {
      groups = merged;
      renderGroups();
      return;
    }
    // A pre-upgrade service worker doesn't understand group ops and answers
    // without highlightGroups at all. Trusting that blindly would replace the
    // whole list with [] and wipe the page. Keep what's on screen instead, and
    // write it to the old chrome.storage.sync home so the edit isn't lost —
    // reloading the extension then migrates it into the shared file.
    chrome.storage.sync.set({ highlightGroups: groups });
    renderGroups();
  });
}

function iconBtn(symbol, title, onClick) {
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.textContent = symbol;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.addEventListener("click", onClick);
  return b;
}

function makeGroupCard(g) {
  const li = document.createElement("li");
  li.className = "card" + (g.enabled ? "" : " is-paused");

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.style.background = g.color;
  badge.style.color = contrastText(g.color);
  badge.textContent = ((g.label || "?")[0] || "?").toUpperCase();

  const info = document.createElement("div");
  info.className = "info";
  const label = document.createElement("div");
  label.className = "title";
  label.textContent = g.label;
  const terms = document.createElement("div");
  terms.className = "terms";
  terms.textContent = (g.terms || []).join(", ");
  info.append(label, terms);

  const actions = document.createElement("div");
  actions.className = "card-actions";
  actions.append(
    iconBtn(g.enabled ? "⏸" : "▶", g.enabled ? "Pause" : "Enable", () => {
      g.enabled = !g.enabled;
      renderGroups(); // optimistic — groupOp re-renders from the merged state
      groupOp({ type: "putGroup", group: g });
    }),
    iconBtn("✎", "Edit", () => openForm(g.id)),
    iconBtn("🗑", "Delete", () => {
      groups = groups.filter((x) => x.id !== g.id);
      if (editingId === g.id) {
        formOpen = false; // don't leave the form editing a group that's gone
        editingId = null;
      }
      renderGroups();
      groupOp({ type: "removeGroup", id: g.id });
    })
  );

  li.append(badge, info, actions);
  return li;
}

function renderGroups() {
  const filter = $("filter").value.trim().toLowerCase();
  const list = $("kwList");

  const visible = groups.filter(
    (g) =>
      !filter ||
      (g.label || "").toLowerCase().includes(filter) ||
      (g.terms || []).some((t) => t.toLowerCase().includes(filter))
  );

  // The form lives in this list, so pull it out before the rebuild wipes it.
  formEl.remove();
  list.textContent = "";

  $("kwCount").textContent = String(groups.length);
  $("kwEmpty").hidden = groups.length !== 0 || formOpen;
  $("kwNoResults").hidden = !(groups.length !== 0 && visible.length === 0) || formOpen;

  // Editing swaps the form in where that group's row sits, so the group you
  // picked stays in its original position instead of the list jumping around.
  let placed = false;
  for (const g of visible) {
    if (formOpen && editingId === g.id) {
      list.appendChild(formEl);
      placed = true;
    } else {
      list.appendChild(makeGroupCard(g));
    }
  }

  if (formOpen && !placed) {
    // Adding a new group — or editing one the filter is currently hiding.
    list.insertBefore(formEl, list.firstChild);
  } else if (!formOpen) {
    list.appendChild(formEl); // parked out of the way, and hidden below
  }
  formEl.hidden = !formOpen;
}

function openForm(id) {
  editingId = id || null;
  formOpen = true;
  const g = id ? groups.find((x) => x.id === id) : null;
  $("fLabel").value = g ? g.label : "";
  $("fTerms").value = g ? (g.terms || []).join(", ") : "";
  $("fColor").value = g ? g.color : "#ffff00";
  $("saveBtn").textContent = g ? "Save changes" : "Save group";
  renderGroups(); // moves the form into position
  $("fLabel").focus(); // after the move — relocating an element drops focus
}

function closeForm() {
  formOpen = false;
  editingId = null;
  renderGroups();
}

function submitForm() {
  const label = $("fLabel").value.trim();
  const terms = $("fTerms")
    .value.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const color = $("fColor").value;
  if (!label && !terms.length) return closeForm();
  // Default the matched words to the label if none were given explicitly.
  const finalTerms = terms.length ? terms : [label];

  let group;
  if (editingId) {
    group = groups.find((x) => x.id === editingId);
    if (!group) return closeForm(); // deleted from another profile while editing
    Object.assign(group, { label: label || finalTerms[0], terms: finalTerms, color });
  } else {
    group = {
      id: uid(),
      label: label || finalTerms[0],
      terms: finalTerms,
      color,
      enabled: true,
    };
    groups.push(group);
  }
  groupOp({ type: "putGroup", group });
  closeForm(); // re-renders the list
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

/**
 * Groups arrive with the rest of the shared state in load(); background.js seeds
 * the file on first run.
 *
 * A pre-upgrade service worker answers lhvj-load WITHOUT a highlightGroups key at
 * all — reloading this page doesn't restart the worker, only reloading the whole
 * extension does — which would leave the list looking empty while the groups are
 * still sitting in their old chrome.storage.sync home. So: no key at all means
 * "ask the old location"; an empty ARRAY is taken at face value, because that
 * means the user really did delete them all.
 */
function adoptGroups(list) {
  if (Array.isArray(list)) {
    groups = list;
    renderGroups();
    return;
  }
  chrome.storage.sync.get({ highlightGroups: [] }, (res) => {
    groups = Array.isArray(res.highlightGroups) ? res.highlightGroups : [];
    renderGroups();
  });
}

/* ============================== blocked companies ============================== */

function renderCompanies() {
  const list = $("companyList");
  list.textContent = "";
  const keys = Object.keys(companies).sort((a, b) =>
    (companies[a] || a).localeCompare(companies[b] || b)
  );
  $("companyCount").textContent = String(keys.length);
  $("companyEmpty").hidden = keys.length !== 0;

  for (const key of keys) {
    const li = document.createElement("li");
    li.className = "chip";
    const name = document.createElement("span");
    name.className = "chip-name";
    name.textContent = companies[key] || key;
    const x = document.createElement("button");
    x.className = "chip-x";
    x.textContent = "×";
    x.title = "Unblock this company";
    x.setAttribute("aria-label", `Unblock ${companies[key] || key}`);
    x.addEventListener("click", () => companyOp({ type: "removeCompany", name: key }));
    li.append(name, x);
    list.appendChild(li);
  }
}

function companyOp(op) {
  chrome.runtime.sendMessage({ type: "lhvj-apply", ops: [op] }, (resp) => {
    if (!chrome.runtime.lastError && resp && resp.state) {
      companies = resp.state.blockedCompanies || {};
      renderCompanies();
    }
  });
}

function addCompany() {
  const name = $("companyInput").value.trim();
  $("companyInput").value = "";
  if (name) companyOp({ type: "addCompany", name });
}

/* ============================== profile sync ============================== */

function refreshSyncStatus() {
  const pill = $("syncStatus");
  const hint = $("syncHint");
  const id = chrome.runtime.id;
  chrome.runtime.sendMessage({ type: "lhvj-host-status" }, (resp) => {
    const on = !chrome.runtime.lastError && resp && resp.connected;
    pill.textContent = on ? "On" : "Off";
    pill.className = "pill " + (on ? "pill-on" : "pill-off");
    hint.textContent = on
      ? "Connected. Everything listed below is shared with your other Chrome profiles."
      : "Not connected — this profile keeps its own history. The steps below turn sharing on.";
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

/* ============================== backup ============================== */

function exportSettings() {
  chrome.storage.sync.get(
    {
      extensionEnabled: true,
      hideViewedEnabled: true,
      manualHideEnabled: true,
      highlightEnabled: true,
      hideEasyApplyEnabled: false,
    },
    (res) => {
      const data = { version: 1, ...res, highlightGroups: groups };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "linkedin-job-tools-settings.json";
      a.click();
      URL.revokeObjectURL(url);
      note(`Exported ${groups.length} keyword group(s) and your toggles.`);
    }
  );
}

function note(text) {
  const el = $("backupHint");
  el.textContent = text;
  clearTimeout(note.timer);
  note.timer = setTimeout(() => {
    el.textContent = "";
  }, 4000);
}

function importSettings(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (e) {
      note("Could not import: the file is not valid JSON.");
      return;
    }
    // Toggles are per-profile (storage.sync); the keyword groups go into the
    // shared file, so importing on one profile updates them all.
    const toSet = {};
    for (const key of [
      "extensionEnabled",
      "hideViewedEnabled",
      "manualHideEnabled",
      "highlightEnabled",
      "hideEasyApplyEnabled",
    ]) {
      if (typeof data[key] === "boolean") toSet[key] = data[key];
    }
    const hasGroups = Array.isArray(data.highlightGroups);
    if (!hasGroups && !Object.keys(toSet).length) {
      note("Could not import: no settings found in that file.");
      return;
    }
    if (hasGroups) {
      groups = data.highlightGroups.map(normalizeGroup);
      groupOp({ type: "setGroups", groups });
    }
    chrome.storage.sync.set(toSet, () => note("Settings imported."));
  };
  reader.readAsText(file);
}

/* ============================== load / sync ============================== */

function load() {
  // Pull the shared state through the bridge (forces a fresh read of the shared
  // file). Falls back to local if the native host isn't installed.
  chrome.runtime.sendMessage({ type: "lhvj-load" }, (state) => {
    if (!chrome.runtime.lastError && state) {
      hidden = state.manualHidden || {};
      companies = state.blockedCompanies || {};
      render();
      renderCompanies();
      adoptGroups(state.highlightGroups);
    } else {
      chrome.storage.local.get(
        { manualHidden: {}, blockedCompanies: {}, highlightGroups: null },
        (res) => {
          hidden = res.manualHidden || {};
          companies = res.blockedCompanies || {};
          render();
          renderCompanies();
          adoptGroups(res.highlightGroups);
        }
      );
    }
  });
}

/* ============================== wiring ============================== */

$("search").addEventListener("input", (e) => {
  view.q = e.target.value.trim().toLowerCase();
  render();
});
$("siteFilter").addEventListener("change", (e) => {
  view.site = e.target.value;
  render();
});
$("sort").addEventListener("change", (e) => {
  view.sort = e.target.value;
  render();
});
$("rangeChips").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip-btn");
  if (!btn) return;
  view.range = btn.dataset.range;
  for (const b of $("rangeChips").children) b.classList.toggle("is-active", b === btn);
  render();
});
$("resetFilters").addEventListener("click", () => {
  view.q = "";
  view.site = "";
  view.range = "all";
  $("search").value = "";
  for (const b of $("rangeChips").children) {
    b.classList.toggle("is-active", b.dataset.range === "all");
  }
  render();
});
$("clearAll").addEventListener("click", () => {
  const total = Object.keys(hidden).length;
  if (!total || !confirm(`Restore all ${total} hidden jobs? This can't be undone.`)) return;
  hidden = {};
  render();
  chrome.runtime.sendMessage({ type: "lhvj-apply", ops: [{ type: "clearHidden" }] });
});

$("filter").addEventListener("input", renderGroups);
$("addBtn").addEventListener("click", () => openForm(null));
$("cancelBtn").addEventListener("click", closeForm);
$("saveBtn").addEventListener("click", submitForm);
formEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitForm();
  else if (e.key === "Escape") closeForm();
});

$("companyAdd").addEventListener("click", addCompany);
$("companyInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addCompany();
});

$("copySetup").addEventListener("click", copySetupCommand);
$("exportBtn").addEventListener("click", exportSettings);
$("importBtn").addEventListener("click", () => $("importFile").click());
$("importFile").addEventListener("change", (e) => {
  if (e.target.files[0]) importSettings(e.target.files[0]);
  e.target.value = "";
});

const themeBtn = $("themeToggle");
themeBtn.title = `Theme: ${window.lhvjTheme.get()}`;
themeBtn.addEventListener("click", () => {
  themeBtn.title = `Theme: ${window.lhvjTheme.cycle()}`;
});

// Keep in sync if things change elsewhere while this page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.manualHidden) {
      hidden = changes.manualHidden.newValue || {};
      render();
    }
    if (changes.blockedCompanies) {
      companies = changes.blockedCompanies.newValue || {};
      renderCompanies();
    }
    if (changes.highlightGroups && !formOpen) {
      // Skip while the form is open so another profile's edit can't yank the
      // fields out from under whatever is being typed here.
      groups = changes.highlightGroups.newValue || [];
      renderGroups();
    }
  }
});

// Names the build this page belongs to, so it can be compared against the copies
// listed in chrome://extensions — a duplicate install is the one failure mode that
// survives every reload.
try {
  $("buildVersion").textContent = "v" + chrome.runtime.getManifest().version;
  $("buildId").textContent = chrome.runtime.id;
} catch (e) {
  /* not running as an extension page (local preview) */
}

load();
refreshSyncStatus();
