/**
 * Hide & Highlight — Job Tools
 *
 *   1. Keyword highlighter (all sites) — colors matching words via the CSS Custom
 *      Highlight API (text color only, no background). Never mutates the DOM.
 *   2. Manual Hide (all sites) — a floating "Hide" button on hover removes the
 *      hovered card. Hidden cards are saved in chrome.storage.local (auto-persisted
 *      JSON) and listed on the extension's "Hidden jobs" page.
 *   3. "Viewed" tint (LinkedIn only) — a card is tinted once it's been viewed. We
 *      consider a card viewed if LinkedIn labels it "Viewed" OR if you've clicked
 *      it (we track that ourselves, because LinkedIn doesn't show its own "Viewed"
 *      label on the job that's currently open).
 *
 * We never inject elements into a site's cards — the only thing we do to a card is
 * toggle a CSS class (tint / hide). The Hide button is a single floating element
 * parented to <body>.
 */

/* ----------------------------- shared state ----------------------------- */

let extensionEnabled = true; // master on/off for the whole extension
let hideViewedEnabled = true;
let highlightEnabled = true;
let manualHideEnabled = true;
let groups = [];
let manualHidden = {}; // { [sig]: record }     hidden cards
let seenJobs = {}; // { [sig]: true }       cards we saw the user click

const IS_LINKEDIN = /(^|\.)linkedin\.com$/i.test(location.hostname);

const VIEWED_CLASS = "lhvj-viewed";
const REMOVED_CLASS = "lhvj-removed";

function saveHidden() {
  chrome.storage.local.set({ manualHidden });
}
function saveSeen() {
  chrome.storage.local.set({ seenJobs });
}

/* ============================ LinkedIn cards ============================= */

const CARD_SELECTORS = [
  "li.scaffold-layout__list-item",
  "li.jobs-search-results__list-item",
  "li[data-occludable-job-id]",
  "div.job-card-container",
];
const LK_SELECTOR = CARD_SELECTORS.join(",");

function isViewed(card) {
  const nodes = card.querySelectorAll("span, li, div, time");
  for (const node of nodes) {
    if (node.childElementCount > 0) continue; // leaf nodes only
    if ((node.textContent || "").trim() === "Viewed") return true;
  }
  return false;
}

function resolveListItem(card) {
  return card.closest("li") || card;
}

function collectCards() {
  const set = new Set();
  document.querySelectorAll(LK_SELECTOR).forEach((el) => set.add(resolveListItem(el)));
  return set;
}

const TITLE_SELECTOR =
  ".job-card-list__title--link, .job-card-list__title, .artdeco-entity-lockup__title";

function grabText(item, sels) {
  for (const s of sels) {
    const el = item.querySelector(s);
    const t = el && el.textContent.replace(/\s+/g, " ").trim();
    if (t) return t;
  }
  return "";
}

function getTitleText(item) {
  const titleEl = item.querySelector(TITLE_SELECTOR);
  let title = "";
  if (titleEl) {
    const strong = titleEl.querySelector("strong");
    title = (strong ? strong.textContent : titleEl.textContent) || "";
  }
  if (!title) {
    const overlay = item.querySelector("a[href*='/jobs/view/'][aria-label]");
    if (overlay) title = overlay.getAttribute("aria-label") || "";
  }
  return title.replace(/\s+/g, " ").trim();
}

function getCompanyText(item) {
  return grabText(item, [
    ".job-card-container__primary-description",
    ".artdeco-entity-lockup__subtitle",
    ".job-card-container__company-name",
  ]);
}

/** Country = last comma segment of the location, minus a trailing "(Remote)". */
function extractCountry(loc) {
  if (!loc) return "";
  const stripped = loc.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const segs = stripped.split(",").map((s) => s.trim()).filter(Boolean);
  return segs.length ? segs[segs.length - 1] : stripped;
}

function getCountryText(item) {
  return extractCountry(
    grabText(item, [
      ".job-card-container__metadata-item",
      ".artdeco-entity-lockup__caption",
      ".job-card-container__metadata-wrapper li",
    ])
  );
}

function getLogo(card) {
  const img = card.querySelector("img");
  return (img && (img.currentSrc || img.src)) || "";
}

function getJobLink(item) {
  const a = item.querySelector("a[href*='/jobs/view/']");
  if (!a) return "";
  const href = a.getAttribute("href") || a.href || "";
  const m = href.match(/\/jobs\/view\/(\d+)/);
  if (m) return "https://www.linkedin.com/jobs/view/" + m[1] + "/";
  return href.startsWith("http") ? href : "https://www.linkedin.com" + href.split("?")[0];
}

/** Posting identity = title + company, so hiding one hides every duplicate. */
function getCardSig(item) {
  const title = getTitleText(item).toLowerCase();
  const company = getCompanyText(item).toLowerCase();
  if (!title && !company) return null;
  return "lk:" + djb2(title + "|" + company);
}

/* ============================ generic cards ============================= */

const GENERIC_CARD_SELECTOR = "article, li, [role='listitem'], [role='article']";

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (((h << 5) + h) + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function genText(card) {
  return (card.textContent || "").replace(/\s+/g, " ").trim();
}

function genKey(card) {
  const text = genText(card).slice(0, 200);
  if (text.length < 8) return null;
  return location.origin + location.pathname + "#" + djb2(text);
}

function isGenericCard(el) {
  if (!el || el.nodeType !== 1 || !el.matches(GENERIC_CARD_SELECTOR)) return false;
  const r = el.getBoundingClientRect();
  if (r.height < 36 || r.width < 120) return false;
  return genText(el).length >= 12;
}

/* ----------------------- unified hide / reconcile ---------------------- */

function sigFor(card) {
  return IS_LINKEDIN ? getCardSig(card) : genKey(card);
}

function recordFor(card) {
  if (IS_LINKEDIN) {
    return {
      title: getTitleText(card),
      company: getCompanyText(card),
      country: getCountryText(card),
      logo: getLogo(card),
      url: getJobLink(card),
      site: "linkedin",
      ts: Date.now(),
    };
  }
  return {
    title: genText(card).slice(0, 140),
    company: "",
    country: "",
    logo: getLogo(card),
    url: location.origin + location.pathname,
    site: location.hostname,
    ts: Date.now(),
  };
}

function hideCard(card) {
  const sig = sigFor(card);
  if (!sig) return;
  manualHidden[sig] = recordFor(card);
  saveHidden();
  reconcile();
}

/** Record that the user opened this card (our own "viewed" signal). */
function markSeen(card) {
  const sig = getCardSig(card);
  if (!sig || seenJobs[sig]) return;
  seenJobs[sig] = true;
  saveSeen();
  reconcile();
}

/**
 * The ONLY thing we do to the page's cards: toggle the viewed tint and the hidden
 * class. No nodes are added to any card. (Class toggles are attribute mutations,
 * which our observer doesn't watch, so this never self-loops.)
 */
/** Strip every class we may have added (used when the extension is turned off). */
function clearOurClasses() {
  document.querySelectorAll("." + VIEWED_CLASS).forEach((e) => e.classList.remove(VIEWED_CLASS));
  document.querySelectorAll("." + REMOVED_CLASS).forEach((e) => e.classList.remove(REMOVED_CLASS));
}

function reconcile() {
  if (!extensionEnabled) {
    clearOurClasses();
    return;
  }
  if (IS_LINKEDIN) {
    for (const item of collectCards()) {
      const sig = getCardSig(item);
      const viewed = isViewed(item) || (sig && seenJobs[sig]);
      item.classList.toggle(VIEWED_CLASS, hideViewedEnabled && Boolean(viewed));
      item.classList.toggle(REMOVED_CLASS, manualHideEnabled && Boolean(sig && manualHidden[sig]));
    }
  } else {
    document.querySelectorAll(GENERIC_CARD_SELECTOR).forEach((card) => {
      const sig = genKey(card);
      card.classList.toggle(REMOVED_CLASS, manualHideEnabled && Boolean(sig && manualHidden[sig]));
    });
  }
}

/* ----------------------- floating hover Hide button -------------------- */

let floatBtn = null;
let hoverCard = null;

function ensureFloatBtn() {
  if (floatBtn) return floatBtn;
  floatBtn = document.createElement("button");
  floatBtn.type = "button";
  floatBtn.className = "lhvj-float-hide";
  floatBtn.textContent = "Hide";
  floatBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (hoverCard) hideCard(hoverCard);
    hideFloat();
  });
  (document.body || document.documentElement).appendChild(floatBtn);
  return floatBtn;
}

function hideFloat() {
  hoverCard = null;
  if (floatBtn) floatBtn.style.display = "none";
}

function positionFloat(card) {
  const b = ensureFloatBtn();
  b.style.display = "block";
  const r = card.getBoundingClientRect();
  const rightInset = IS_LINKEDIN ? 38 : 6; // clear LinkedIn's own "X"
  b.style.top = Math.max(2, r.top + 4) + "px";
  b.style.left = Math.max(2, r.right - b.offsetWidth - rightInset) + "px";
}

function targetCard(el) {
  if (!el || !el.closest) return null;
  let card = el.closest(IS_LINKEDIN ? LK_SELECTOR : GENERIC_CARD_SELECTOR);
  if (!card) return null;
  if (IS_LINKEDIN) card = resolveListItem(card);
  if (card.classList.contains(REMOVED_CLASS)) return null;
  if (!IS_LINKEDIN && !isGenericCard(card)) return null;
  return card;
}

function onHover(e) {
  if (!extensionEnabled || !manualHideEnabled) {
    hideFloat();
    return;
  }
  if (e.target === floatBtn) return;
  const card = targetCard(e.target);
  if (card) {
    hoverCard = card;
    positionFloat(card);
  } else {
    hideFloat();
  }
}

/** LinkedIn only: clicking a card opens the job — treat that as "viewed". */
function onCardClick(e) {
  if (!extensionEnabled || e.target === floatBtn) return;
  const card = targetCard(e.target);
  if (card) markSeen(card);
}

/* ----------------------- keyword highlighter (no DOM) ------------------- */

const SUPPORTS_HIGHLIGHTS =
  typeof Highlight !== "undefined" && typeof CSS !== "undefined" && CSS.highlights;

const SKIP_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "SVG",
]);

let registeredNames = [];
let styleEl = null;

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegex(terms) {
  const sorted = terms
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!sorted.length) return null;
  return new RegExp("(" + sorted.map(escapeRegExp).join("|") + ")", "gi");
}

function shouldSkip(node) {
  let el = node.parentNode;
  while (el && el.nodeType === 1) {
    if (SKIP_TAGS.has(el.tagName)) return true;
    if (el.isContentEditable) return true;
    el = el.parentNode;
  }
  return false;
}

function collectTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (shouldSkip(n)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

function ensureStyleEl() {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "lhvj-highlight-styles";
    (document.head || document.documentElement).appendChild(styleEl);
  }
  return styleEl;
}

/** Pick black/white text for readability against a background color. */
function contrastText(hex) {
  const c = (hex || "#ffff00").replace("#", "");
  const r = parseInt(c.substr(0, 2), 16);
  const g = parseInt(c.substr(2, 2), 16);
  const b = parseInt(c.substr(4, 2), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#000" : "#fff";
}

/**
 * Bold matches on a colored background. The Custom Highlight API ignores
 * font-size / font-weight, so "bold" is faked with -webkit-text-stroke (a
 * supported property) and the background-color makes them pop.
 */
function rebuildHighlightStyles() {
  const css = groups
    .filter((g) => g.enabled)
    .map((g) => {
      const fg = contrastText(g.color);
      return (
        `::highlight(lhvj-${g.id}){` +
        `background-color:${g.color};` +
        `color:${fg};` +
        `-webkit-text-stroke:0.4px ${fg};` +
        `border-radius:3px;}`
      );
    })
    .join("\n");
  ensureStyleEl().textContent = css;
}

function clearHighlights() {
  for (const name of registeredNames) CSS.highlights.delete(name);
  registeredNames = [];
}

function applyHighlights() {
  if (!SUPPORTS_HIGHLIGHTS || !document.body) return;
  clearHighlights();
  if (!extensionEnabled || !highlightEnabled) return;

  const active = groups
    .filter((g) => g.enabled && g.terms && g.terms.length)
    .map((g) => ({ id: g.id, regex: buildRegex(g.terms) }))
    .filter((m) => m.regex);
  if (!active.length) return;

  const rangesById = new Map();
  for (const node of collectTextNodes(document.body)) {
    const text = node.nodeValue;
    for (const m of active) {
      m.regex.lastIndex = 0;
      let mm;
      while ((mm = m.regex.exec(text))) {
        const range = document.createRange();
        range.setStart(node, mm.index);
        range.setEnd(node, mm.index + mm[0].length);
        if (!rangesById.has(m.id)) rangesById.set(m.id, []);
        rangesById.get(m.id).push(range);
        if (mm.index === m.regex.lastIndex) m.regex.lastIndex++;
      }
    }
  }

  for (const [id, ranges] of rangesById) {
    const name = "lhvj-" + id;
    CSS.highlights.set(name, new Highlight(...ranges));
    registeredNames.push(name);
  }
  rebuildHighlightStyles();
}

/* ------------------------------ orchestration --------------------------- */

let schedTimer = null;
function schedule() {
  if (schedTimer) return;
  schedTimer = setTimeout(() => {
    schedTimer = null;
    reconcile();
    applyHighlights();
  }, 150);
}

function startPage() {
  reconcile();
  applyHighlights();

  const obs = new MutationObserver(schedule);
  if (document.body) {
    obs.observe(document.body, { childList: true, subtree: true, characterData: IS_LINKEDIN });
  }

  document.addEventListener("mouseover", onHover, true);
  if (IS_LINKEDIN) document.addEventListener("click", onCardClick, true);
  window.addEventListener(
    "scroll",
    () => {
      hideFloat();
      schedule();
    },
    { capture: true, passive: true }
  );
}

function init() {
  chrome.storage.sync.get(
    {
      extensionEnabled: true,
      hideViewedEnabled: true,
      highlightEnabled: true,
      manualHideEnabled: true,
      highlightGroups: [],
    },
    (res) => {
      extensionEnabled = res.extensionEnabled;
      hideViewedEnabled = res.hideViewedEnabled;
      highlightEnabled = res.highlightEnabled;
      manualHideEnabled = res.manualHideEnabled;
      groups = res.highlightGroups || [];

      chrome.storage.local.get({ manualHidden: null, seenJobs: {} }, (loc) => {
        seenJobs = loc.seenJobs || {};
        if (loc.manualHidden) {
          manualHidden = loc.manualHidden;
        } else {
          // One-time migration from the previous (website localStorage) store.
          let legacy = {};
          try {
            legacy = JSON.parse(localStorage.getItem("lhvj_hidden_v1") || "{}") || {};
          } catch (e) {
            /* ignore */
          }
          manualHidden = legacy;
          if (Object.keys(manualHidden).length) saveHidden();
        }
        startPage();
      });
    }
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync") {
      if (changes.extensionEnabled) extensionEnabled = changes.extensionEnabled.newValue;
      if (changes.hideViewedEnabled) hideViewedEnabled = changes.hideViewedEnabled.newValue;
      if (changes.manualHideEnabled) manualHideEnabled = changes.manualHideEnabled.newValue;
      if (changes.highlightEnabled) highlightEnabled = changes.highlightEnabled.newValue;
      if (changes.highlightGroups) groups = changes.highlightGroups.newValue || [];

      if (changes.extensionEnabled || changes.hideViewedEnabled || changes.manualHideEnabled) {
        if (!extensionEnabled || !manualHideEnabled) hideFloat();
        reconcile();
      }
      if (changes.extensionEnabled || changes.highlightEnabled || changes.highlightGroups) {
        applyHighlights();
      }
    } else if (area === "local") {
      if (changes.manualHidden) manualHidden = changes.manualHidden.newValue || {};
      if (changes.seenJobs) seenJobs = changes.seenJobs.newValue || {};
      if (changes.manualHidden || changes.seenJobs) reconcile();
    }
  });
}

init();
