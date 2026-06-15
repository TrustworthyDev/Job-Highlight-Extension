/* Hidden jobs page. Reads/writes chrome.storage.local.manualHidden — the same
   store the content script writes to — so this works no matter which tab (or
   whether any tab) is open. */

const $ = (id) => document.getElementById(id);
let hidden = {};

function hostLabel(rec) {
  if (rec.site && rec.site !== "linkedin") return rec.site;
  try {
    return new URL(rec.url).hostname;
  } catch (e) {
    return rec.site || "";
  }
}

function makeCard(key, rec) {
  const li = document.createElement("li");
  li.className = "card";

  // logo (or a letter placeholder)
  if (rec.logo) {
    const img = document.createElement("img");
    img.className = "logo";
    img.src = rec.logo;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.onerror = () => img.replaceWith(placeholderLogo(rec));
    li.appendChild(img);
  } else {
    li.appendChild(placeholderLogo(rec));
  }

  const info = document.createElement("div");
  info.className = "info";

  const title = document.createElement(rec.url ? "a" : "div");
  title.className = "title";
  title.textContent = rec.title || "(hidden card)";
  if (rec.url) {
    title.href = rec.url;
    title.target = "_blank";
    title.rel = "noreferrer";
  }
  info.appendChild(title);

  const metaParts = [rec.company, rec.country].filter(Boolean);
  if (metaParts.length) {
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = metaParts.join(" · ");
    info.appendChild(meta);
  }

  const sub = document.createElement("div");
  sub.className = "sub";
  sub.textContent = hostLabel(rec);
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

function placeholderLogo(rec) {
  const ph = document.createElement("div");
  ph.className = "logo placeholder";
  ph.textContent = ((rec.company || rec.title || "?").trim()[0] || "?").toUpperCase();
  return ph;
}

function render() {
  const list = $("list");
  list.innerHTML = "";
  const keys = Object.keys(hidden).sort((a, b) => (hidden[b]?.ts || 0) - (hidden[a]?.ts || 0));
  $("count").textContent = String(keys.length);
  $("empty").hidden = keys.length !== 0;

  for (const key of keys) {
    const rec = hidden[key] && typeof hidden[key] === "object" ? hidden[key] : {};
    list.appendChild(makeCard(key, rec));
  }
}

function load() {
  // Pull the shared state through the bridge (forces a fresh read of the shared
  // file). Falls back to local if the native host isn't installed.
  chrome.runtime.sendMessage({ type: "lhvj-load" }, (state) => {
    if (!chrome.runtime.lastError && state) {
      hidden = state.manualHidden || {};
      render();
    } else {
      chrome.storage.local.get({ manualHidden: {} }, (res) => {
        hidden = res.manualHidden || {};
        render();
      });
    }
  });
}

$("clearAll").addEventListener("click", () => {
  hidden = {};
  render();
  chrome.runtime.sendMessage({ type: "lhvj-apply", ops: [{ type: "clearHidden" }] });
});

// Keep in sync if cards are hidden/restored elsewhere while this page is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.manualHidden) {
    hidden = changes.manualHidden.newValue || {};
    render();
  }
});

load();
