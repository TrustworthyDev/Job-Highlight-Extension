/**
 * Native messaging host for "Hide & Highlight - Job Tools".
 *
 * It is the bridge between the extension and a single shared JSON file on disk
 * (shared-state.json, in this same folder). Every Chrome profile that loads the
 * extension talks to this host, so they all read/write the SAME file - that's how
 * one profile sees what another profile clicked/hid.
 *
 * Protocol (Chrome native messaging): each message is a 4-byte little-endian
 * length prefix followed by that many bytes of UTF-8 JSON, on stdin/stdout.
 *
 * Supported requests:
 *   { "op": "get" }              -> { ok:true, state:{ seen:{}, hidden:{}, companies:{}, groups:[] } }
 *   { "op": "apply", "ops":[..] } -> { ok:true, state:{...merged...} }
 *
 * "apply" MERGES the given delta ops into whatever is currently on disk (read ->
 * apply -> write), so a profile only ever adds/removes the specific items it
 * touched and never overwrites another profile's data. Each op:
 *   { type:"seen",   sig }             mark a card clicked/viewed
 *   { type:"hide",   sig, record }     hide a card
 *   { type:"unhide", sig }             restore a hidden card
 *   { type:"unsee",  sig }             forget a clicked card
 *   { type:"clearHidden" }             restore all hidden cards
 *   { type:"addCompany",    name }     hide all cards from this company
 *   { type:"removeCompany", name }     stop blocking a company
 *   { type:"putGroup",    group }      add or update one highlight keyword group
 *   { type:"removeGroup", id }         delete one keyword group
 *   { type:"setGroups",   groups }     replace the whole list (import / first seed)
 *
 * Keyword groups are an ordered array (display order matters), so they merge by
 * group id rather than by object key like the maps above.
 *
 * The shared state lives in ONE file: shared-state.json. We write it directly (no
 * temp file) so the single file is always the latest data. Keyword changes are
 * additionally mirrored, one-way, into ../linkedin-job-tools-settings.json in the
 * same shape "Export settings" produces.
 */

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "shared-state.json");

// Human-readable mirror of the keyword groups, written next to the extension in
// the same shape "Export settings" produces (so it can be imported straight back).
// shared-state.json stays the source of truth; this is a one-way copy for reading
// and version-controlling — editing it by hand does not feed back into Chrome.
const SETTINGS_FILE = path.join(__dirname, "..", "linkedin-job-tools-settings.json");
const GROUP_OPS = new Set(["putGroup", "removeGroup", "setGroups"]);

// Company key normalization must match the extension's (content.js / popup.js).
function normCompany(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function readState() {
  try {
    const obj = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return {
      seen: obj.seen || {},
      hidden: obj.hidden || {},
      companies: obj.companies || {},
      // null (not []) while the key has never been written, so the extension can
      // tell "no groups in the file yet, seed me" from "the user deleted them all".
      groups: Array.isArray(obj.groups) ? obj.groups : null,
    };
  } catch (e) {
    return { seen: {}, hidden: {}, companies: {}, groups: null };
  }
}

function writeState(state) {
  const clean = {
    seen: state.seen || {},
    hidden: state.hidden || {},
    companies: state.companies || {},
  };
  // Only write the key once groups actually exist — otherwise the first unrelated
  // op (a hide, say) would stamp an empty list and the seed above would never run.
  if (Array.isArray(state.groups)) clean.groups = state.groups;
  fs.writeFileSync(FILE, JSON.stringify(clean, null, 2));
}

/**
 * Rewrite linkedin-job-tools-settings.json with the current keyword groups.
 * Any other keys already in that file (the toggles from an earlier export) are
 * kept as they are — only highlightGroups is replaced. Failures are swallowed:
 * the folder may be read-only, and that must not break the actual save.
 */
function writeSettingsMirror(groups) {
  if (!Array.isArray(groups)) return;
  let existing = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    if (parsed && typeof parsed === "object") existing = parsed;
  } catch (e) {
    /* no file yet, or unreadable — start from scratch */
  }
  try {
    const out = Object.assign({}, existing, {
      version: existing.version || 1,
      highlightGroups: groups,
      savedAt: new Date().toISOString(),
    });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(out, null, 2));
  } catch (e) {
    /* read-only location — the shared state is still saved, so carry on */
  }
}

function send(msg) {
  const buf = Buffer.from(JSON.stringify(msg), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

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
    // Groups are matched by id so two profiles editing different groups merge
    // instead of overwriting each other's list. Note groups is deliberately NOT
    // initialised alongside the maps above — it stays null until something sets it.
    else if (op.type === "putGroup" && op.group && op.group.id) {
      const list = Array.isArray(state.groups) ? state.groups : [];
      const i = list.findIndex((g) => g && g.id === op.group.id);
      if (i === -1) list.push(op.group);
      else list[i] = op.group;
      state.groups = list;
    } else if (op.type === "removeGroup" && op.id) {
      state.groups = (Array.isArray(state.groups) ? state.groups : []).filter(
        (g) => g && g.id !== op.id
      );
    } else if (op.type === "setGroups" && Array.isArray(op.groups)) {
      state.groups = op.groups;
    }
  }
  return state;
}

function handle(msg) {
  try {
    if (msg.op === "get") {
      send({ ok: true, state: readState() });
    } else if (msg.op === "apply") {
      const state = applyOps(readState(), msg.ops); // read -> merge -> write
      writeState(state);
      // Only on keyword changes — no point rewriting the settings file on every
      // card click.
      if ((msg.ops || []).some((op) => op && GROUP_OPS.has(op.type))) {
        writeSettingsMirror(state.groups);
      }
      send({ ok: true, state: state });
    } else {
      send({ ok: false, error: "unknown op: " + msg.op });
    }
  } catch (e) {
    send({ ok: false, error: String((e && e.message) || e) });
  }
}

// Read framed messages from stdin (may arrive in several chunks).
let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const len = buffer.readUInt32LE(0);
    if (buffer.length < 4 + len) break;
    const body = buffer.slice(4, 4 + len);
    buffer = buffer.slice(4 + len);
    let msg;
    try {
      msg = JSON.parse(body.toString("utf8"));
    } catch (e) {
      send({ ok: false, error: "bad json" });
      continue;
    }
    handle(msg);
  }
});

// When Chrome closes the connection, exit cleanly.
process.stdin.on("end", () => process.exit(0));
