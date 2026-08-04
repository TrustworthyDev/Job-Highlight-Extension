/**
 * Service worker. Two jobs:
 *   1. Seed default keyword groups + toggles from defaults.json on install.
 *   2. Bridge the content script / hidden page to the native host that owns the
 *      cross-profile shared file (clicked + hidden jobs). If the native host isn't
 *      installed, everything falls back to per-profile chrome.storage.local.
 *
 * File state shape (owned by the host):   { seen: {sig:true}, hidden: {sig:record} }
 * Extension state shape (what we pass):    { seenJobs, manualHidden }
 */

const NATIVE_HOST = "com.jobtools.shared";

/* ----------------------------- install seed ---------------------------- */

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

/* --------------------------- native host bridge ------------------------ */

function nativeGet() {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { op: "get" }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.ok || !resp.state) {
          resolve(null); // host missing/unreadable — caller falls back to local
          return;
        }
        resolve(resp.state); // { seen, hidden }
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function nativeApply(ops) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { op: "apply", ops }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.ok || !resp.state) {
          resolve(null); // host missing — caller falls back to local
          return;
        }
        resolve(resp.state); // merged { seen, hidden }
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function normCompany(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function localFile() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ manualHidden: {}, seenJobs: {}, blockedCompanies: {} }, (r) => {
      resolve({
        seen: r.seenJobs || {},
        hidden: r.manualHidden || {},
        companies: r.blockedCompanies || {},
      });
    });
  });
}

// Same merge logic the host uses — needed when no host is installed (local-only).
function applyOps(state, ops) {
  state.seen = state.seen || {};
  state.hidden = state.hidden || {};
  state.companies = state.companies || {};
  for (const op of ops || []) {
    if (!op || !op.type) continue;
    if (op.type === "seen" && op.sig) state.seen[op.sig] = true;
    else if (op.type === "unsee" && op.sig) delete state.seen[op.sig];
    else if (op.type === "hide" && op.sig) state.hidden[op.sig] = op.record || true;
    else if (op.type === "unhide" && op.sig) delete state.hidden[op.sig];
    else if (op.type === "clearHidden") state.hidden = {};
    else if (op.type === "clearSeen") state.seen = {};
    else if (op.type === "addCompany" && normCompany(op.name))
      state.companies[normCompany(op.name)] = String(op.name).trim();
    else if (op.type === "removeCompany" && op.name)
      delete state.companies[normCompany(op.name)];
  }
  return state;
}

function mapToExt(file) {
  return {
    manualHidden: file.hidden || {},
    seenJobs: file.seen || {},
    blockedCompanies: file.companies || {},
  };
}

/** Source of truth = the shared file; fall back to per-profile local. */
async function loadState() {
  const file = await nativeGet();
  return mapToExt(file || (await localFile()));
}

/** Merge the delta ops into the shared file (or local if no host), mirror to local. */
async function applyState(ops) {
  let file = await nativeApply(ops);
  if (!file) {
    // No native host — merge into this profile's local store instead.
    file = applyOps(await localFile(), ops);
  }
  const ext = mapToExt(file);
  await new Promise((res) => chrome.storage.local.set(ext, res));
  return ext;
}

// Serialize all file load/save ops. Two quick clicks fire two async saves that
// could otherwise interleave and clobber each other (lost update); chaining them
// makes each finish before the next starts, in arrival order.
let opQueue = Promise.resolve();
function enqueue(task) {
  const run = opQueue.then(task, task);
  opQueue = run.catch(() => {});
  return run;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  if (msg.type === "lhvj-load") {
    enqueue(async () => {
      const st = await loadState();
      // Push into local so any open tab/page in THIS profile reconciles via onChanged.
      await new Promise((res) => chrome.storage.local.set(st, res));
      return st;
    }).then(sendResponse);
    return true; // async
  }
  if (msg.type === "lhvj-apply") {
    enqueue(() => applyState(msg.ops || [])).then((state) => sendResponse({ ok: true, state }));
    return true; // async
  }
  if (msg.type === "lhvj-host-status") {
    // The native host responds only if it's installed and working.
    nativeGet().then((state) => sendResponse({ connected: state !== null }));
    return true; // async
  }
});

/* --------------------------- scheduled sync ---------------------------- */
// Periodically re-read the shared file and mirror it into local storage. Any open
// tab/page reconciles via storage.onChanged, so a long-open profile still picks up
// what other profiles clicked/hid without needing a reload.

const SYNC_ALARM = "lhvj-sync";
const SYNC_MINUTES = 1; // Chrome's practical minimum for alarms

function ensureAlarm() {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_MINUTES });
}
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  enqueue(async () => {
    const st = await loadState(); // reads the shared file (or local if no host)
    await new Promise((res) => chrome.storage.local.set(st, res));
  });
});
