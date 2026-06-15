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
 *   { "op": "get" }              -> { ok:true, state:{ seen:{}, hidden:{} } }
 *   { "op": "apply", "ops":[..] } -> { ok:true, state:{...merged...} }
 *
 * "apply" MERGES the given delta ops into whatever is currently on disk (read ->
 * apply -> write), so a profile only ever adds/removes the specific items it
 * touched and never overwrites another profile's data. Each op:
 *   { type:"seen",   sig }            mark a card clicked/viewed
 *   { type:"hide",   sig, record }    hide a card
 *   { type:"unhide", sig }            restore a hidden card
 *   { type:"unsee",  sig }            forget a clicked card
 *   { type:"clearHidden" }            restore all hidden cards
 *
 * Writes are atomic (temp file + rename) so a crash can't leave a half file.
 */

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "shared-state.json");
const TMP = FILE + ".tmp";

function readState() {
  try {
    const obj = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { seen: obj.seen || {}, hidden: obj.hidden || {} };
  } catch (e) {
    return { seen: {}, hidden: {} };
  }
}

function writeState(state) {
  const clean = { seen: state.seen || {}, hidden: state.hidden || {} };
  fs.writeFileSync(TMP, JSON.stringify(clean));
  fs.renameSync(TMP, FILE);
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
  for (const op of ops || []) {
    if (!op || !op.type) continue;
    if (op.type === "seen" && op.sig) state.seen[op.sig] = true;
    else if (op.type === "unsee" && op.sig) delete state.seen[op.sig];
    else if (op.type === "hide" && op.sig) state.hidden[op.sig] = op.record || true;
    else if (op.type === "unhide" && op.sig) delete state.hidden[op.sig];
    else if (op.type === "clearHidden") state.hidden = {};
    else if (op.type === "clearSeen") state.seen = {};
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
