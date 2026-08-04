/* Hidden jobs page. Reads/writes chrome.storage.local.manualHidden — the same
   store the content script writes to — so this works no matter which tab (or
   whether any tab) is open. */

const $ = (id) => document.getElementById(id);
let hidden = {};
let companies = {};

// Current view state for the search / filter / sort toolbar.
const view = { q: "", site: "", range: "all", sort: "new" };

const DAY = 86400000;

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
  const host = hostLabel(r);
  return host.replace(/^www\./, "") || "unknown";
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

/* ---- filtering / sorting ---- */

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

/* ---- cards ---- */

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

/* ---- render ---- */

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

/* ---- blocked companies ---- */

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

/* ---- load / sync ---- */

function load() {
  // Pull the shared state through the bridge (forces a fresh read of the shared
  // file). Falls back to local if the native host isn't installed.
  chrome.runtime.sendMessage({ type: "lhvj-load" }, (state) => {
    if (!chrome.runtime.lastError && state) {
      hidden = state.manualHidden || {};
      companies = state.blockedCompanies || {};
      render();
      renderCompanies();
    } else {
      chrome.storage.local.get({ manualHidden: {}, blockedCompanies: {} }, (res) => {
        hidden = res.manualHidden || {};
        companies = res.blockedCompanies || {};
        render();
        renderCompanies();
      });
    }
  });
}

/* ---- toolbar wiring ---- */

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
  for (const b of $("rangeChips").children) b.classList.toggle("is-active", b.dataset.range === "all");
  render();
});

const themeBtn = $("themeToggle");
themeBtn.title = `Theme: ${window.lhvjTheme.get()}`;
themeBtn.addEventListener("click", () => {
  themeBtn.title = `Theme: ${window.lhvjTheme.cycle()}`;
});

$("clearAll").addEventListener("click", () => {
  const total = Object.keys(hidden).length;
  if (!total || !confirm(`Restore all ${total} hidden jobs? This can't be undone.`)) return;
  hidden = {};
  render();
  chrome.runtime.sendMessage({ type: "lhvj-apply", ops: [{ type: "clearHidden" }] });
});
$("companyAdd").addEventListener("click", addCompany);
$("companyInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") addCompany();
});

// Keep in sync if cards/companies change elsewhere while this page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.manualHidden) {
    hidden = changes.manualHidden.newValue || {};
    render();
  }
  if (changes.blockedCompanies) {
    companies = changes.blockedCompanies.newValue || {};
    renderCompanies();
  }
});

load();
