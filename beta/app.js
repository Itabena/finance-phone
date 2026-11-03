// The phone shell (PLAN-43 C, PLAN-44): sign in to Google, download the encrypted snapshot from Drive, unlock it with the
// passphrase, hand the data to ui.js, and send what was done on the phone back to the PC as encrypted queue files.
import { CLIENT_ID, SNAPSHOT_NAME, REMEMBER_DAYS } from "./config.js?v=19";
import { deriveKey, openSealed, readHeader, seal, WrongKey } from "./crypto.js?v=19";
import * as ui from "./ui.js?v=19";

// drive.readonly finds the copy Drive for desktop uploaded; drive.file is for the phone's own queue files (C2).
const SCOPES = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file";
const $ = id => document.getElementById(id);
// PLAN-52: the page served under /beta/ is the TEST profile only: fake data, its own Drive names, its own on-phone
// database, so it can never touch (or be confused with) the real copy. The page at the root is the real profile.
const PROFILE = location.pathname.split("/").includes("beta") ? "test" : "real";
const NAMES = PROFILE === "test"
  ? { db: "finance-phone-test", snapshot: "snapshot-test.fin", folder: "Finance-phone-queue-test", marker: "queue-test", drive: "Finance-sync-test" }
  : { db: "finance-phone", snapshot: SNAPSHOT_NAME, folder: "Finance-phone-queue", marker: "queue", drive: "Finance-sync" };
const APP_VERSION = 19;   // shown under ⋯ so it is clear which phone code is running; bump with ?v= and sw.js

// ---------------------------------------------------------------- tiny IndexedDB key/value store
const idb = (() => {
  let dbp;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAMES.db, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => {
    const t = d.transaction("kv", mode); const q = fn(t.objectStore("kv"));
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  return { get: k => tx("readonly", s => s.get(k)), set: (k, v) => tx("readwrite", s => s.put(v, k)),
           del: k => tx("readwrite", s => s.delete(k)) };
})();

// ---------------------------------------------------------------- state
let blob = null;          // encrypted snapshot (ArrayBuffer), also kept in IndexedDB for offline use
let modified = null;      // when Drive got it
let payload = null;       // decrypted, in memory only
let token = null, tokenClient = null;
let liveKey = null;       // the unlocked key, in memory only (also in IndexedDB when "remember" is ticked)
let local = { ticks: {}, answers: {}, sent: [] };   // done on the phone, not yet in a newer PC copy
let pending = 0;
let entries = [];         // PLAN-56: everything done on this phone with its state: waiting, sent, applied or refused
let mounted = false;      // ui.mount has run, so the screens can be redrawn
const LABELS = {          // what an entry is called in "Sent from this phone" (never an amount)
  "/settings/cash": "Bank balance", "/settings/commitment": "Monthly savings", "/hold/balance": "Holding value",
  "/hold/classify": "Classify a holding", "/hold/pot": "Choose a pot", "/hold/confirm": "Confirm holdings", "/mix/tags": "Mix tags",
  "/tx/category": "Transaction category", "/tx/hide": "Hide a transaction", "/tx/fix": "Fix a transaction", "/tx/add": "Add a transaction",
  "/tx/remove": "Remove a transaction", "/review": "Review answer", "/review/accept-suggestions": "Accept suggestions",
  "/routine/done": "Routine ticked", "/next/done": "I did it (next ₪)",
};
const labelFor = path => LABELS[path] || (/^\/proposal\/\d+\/(accept|reject)$/.test(path) ? "Proposal answer" : "Change");

const GATES = ["screen-start", "screen-unlock", "screen-msg"];
function show(id) {
  for (const s of GATES) $(s).hidden = s !== id;
  const app = id === "app";
  $("views").hidden = !app; $("tabbar").hidden = !app; $("menu-btn").hidden = !app;
  updateBanner();
}
// PLAN-55: what waits on the phone is always visible. Saving never opens Google; sending needs a token, and a token
// comes only from a tap (Send, Get latest, Sign in).
let netDown = false;       // the last attempt to reach Drive failed for want of a connection
function setPending(n) { pending = n; updateBanner(); refreshEntries(); }
function updateBanner() {
  const b = $("sync-banner");
  b.hidden = !(pending > 0 && !$("views").hidden);
  if (!b.hidden) $("sync-text").textContent = `${pending} waiting · ${!token ? "Not signed in" : netDown ? "Offline" : "Not sent yet"}`;
}
function message(text) { $("msg").textContent = text; show("screen-msg"); }
function toast(text, action) {
  const t = $("toast"); t.innerHTML = "";
  t.append(document.createTextNode(text));
  if (action) { const b = document.createElement("button"); b.textContent = action.label; b.onclick = () => { t.hidden = true; action.run(); }; t.append(b); }
  t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, action ? 5000 : 3200);
}
function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime(); const h = ms / 36e5;
  return h < 1 ? "less than an hour ago" : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} days ago`;
}

// ---------------------------------------------------------------- Google sign-in + Drive
let tokenWait = null;      // the sign-in in progress, so two taps never start two Google windows
function getToken(interactive, patient) {      // patient: started by a tap, so no 30 s limit while the person picks an account
  if (tokenWait) return tokenWait;
  tokenWait = new Promise((resolve, reject) => {
    if (!(window.google && google.accounts && google.accounts.oauth2)) return reject(new Error("Google sign-in did not load — check the connection."));
    const slow = interactive || patient ? null : setTimeout(() => reject(new Error("Google sign-in did not answer")), 30000);
    const done = () => clearTimeout(slow);
    if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: () => {} });
    tokenClient.callback = r => {
      done();
      if (r.error) return reject(new Error(r.error_description || r.error));
      // Google shows a tick box per permission; without "see your Drive files" the copy is invisible to this page.
      if (!google.accounts.oauth2.hasGrantedAllScopes(r, "https://www.googleapis.com/auth/drive.readonly")) {
        token = null;
        return reject(new Error("Google did not give this page permission to see your Drive files. Tap “Sign in again” and, on Google's screen, tick “See and download all your Google Drive files”."));
      }
      token = r.access_token; resolve(token);
    };
    tokenClient.error_callback = e => { done(); reject(new Error(e.message || e.type || "sign-in was cancelled")); };
    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  }).finally(() => { tokenWait = null; });
  return tokenWait;
}
// The app opens from the copy saved on the phone and does not ask Google for anything (PLAN-55).
async function drive(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  if (r.status === 401) { token = null; throw new Error("Google sign-in expired — tap Get latest again."); }
  if (!r.ok) throw new Error(`Google Drive answered ${r.status}`);
  return r;
}
async function download() {
  const q = encodeURIComponent(`name='${NAMES.snapshot}' and trashed=false`);
  const list = await (await drive(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=1&fields=files(id,modifiedTime,size)`)).json();
  const f = (list.files || [])[0];
  if (!f) {
    let who = "";
    try { who = (await (await drive("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)")).json()).user.emailAddress; } catch (e) { /* not essential */ }
    throw new Error(`No finance copy found in the Google Drive of ${who || "this account"}. Check that this is the account Google Drive for desktop uses on the PC, and on drive.google.com that the folder ${NAMES.drive} holds ${NAMES.snapshot} (Drive for desktop may still be uploading it).`);
  }
  const buf = await (await drive(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`)).arrayBuffer();
  blob = buf; modified = f.modifiedTime;
  await idb.set("snapshot", { blob, modified });
  await idb.set("signed-in", true);
}

// ---------------------------------------------------------------- unlocking
async function rememberedKey(header) {
  const k = await idb.get("key");
  if (!k || k.until < Date.now() || k.salt !== header.salt || k.iter !== header.iter) return null;
  return k.key;
}
async function open() {
  const { header } = readHeader(blob);
  const key = await rememberedKey(header);
  if (!key) { show("screen-unlock"); setTimeout(() => $("pass").focus(), 50); return; }
  try { ({ payload } = await openSealed(key, blob)); liveKey = key; }
  catch (e) { await idb.del("key"); show("screen-unlock"); return; }
  render();
}
$("unlock-form").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("unlock-btn"); btn.disabled = true; $("unlock-msg").textContent = "Unlocking…";
  try {
    const { header } = readHeader(blob);
    const key = await deriveKey($("pass").value, header.salt, header.iter);
    ({ payload } = await openSealed(key, blob));
    liveKey = key;
    if ($("remember").checked) await idb.set("key", { key, salt: header.salt, iter: header.iter, until: Date.now() + REMEMBER_DAYS * 864e5 });
    $("pass").value = ""; $("unlock-msg").textContent = "";
    render();
  } catch (err) {
    $("unlock-msg").textContent = err instanceof WrongKey ? "That passphrase doesn't open it. It's the one set on the PC under Settings → Phone." : err.message;
  } finally { btn.disabled = false; }
});

// ---------------------------------------------------------------- showing the app
async function loadLocal() {
  local = (await idb.get("local").catch(() => null)) || { ticks: {}, answers: {}, sent: [] };
  local.sent = (local.sent || []).filter(f => new Date(f.at).getTime() >= (new Date(payload.made).getTime() || 0) - 60e3);
  const made = new Date(payload.made).getTime() || 0;          // a newer PC copy already contains these
  for (const k of ["ticks", "answers"]) for (const [x, at] of Object.entries(local[k] || {})) if (new Date(at).getTime() < made - 60e3) delete local[k][x];
  await idb.set("local", local).catch(() => {});
  pending = ((await idb.get("queue").catch(() => null)) || []).length;      // shown by show("app") in render()
  await refreshEntries(false);
}
// Waiting = still in the on-phone queue; Sent = uploaded, no receipt yet; Applied / Refused = the PC's receipt (by entry id).
// A PC copy from older code carries no receipts at all: then "Sent" is all that can honestly be said.
async function refreshEntries(redraw = true) {
  const waiting = ((await idb.get("queue").catch(() => null)) || []).map(i => ({ id: i.id, label: i.label || labelFor(i.path), at: i.at, state: "waiting" }));
  const log = (await idb.get("sentlog").catch(() => null)) || [];
  const receipts = payload && payload.phone && payload.phone.receipts;
  const byId = new Map((Array.isArray(receipts) ? receipts : []).map(r => [r.id, r]));
  const sent = log.map(e => { const r = byId.get(e.id); return { id: e.id, label: e.label, at: e.at, state: r ? r.status : "sent", why: r && r.why, unconfirmable: !Array.isArray(receipts) }; });
  entries = [...waiting, ...sent].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (redraw && mounted && payload) ui.refreshBadges();
  updateBanner();
}
const STATE_WORDS = { waiting: "Waiting", sent: "Sent", applied: "Applied", refused: "Refused" };
function entriesSheet() {
  ui.sheet("Sent from this phone", body => {
    if (!entries.length) { const p = document.createElement("p"); p.className = "muted"; p.textContent = "Nothing has been done on this phone yet."; body.append(p); return; }
    for (const e of entries) {
      const row = document.createElement("div"); row.className = "entry";
      const top = document.createElement("div"); top.className = "entry-top";
      const label = document.createElement("b"); label.className = "label"; label.textContent = e.label;
      const state = document.createElement("span"); state.className = "state state-" + e.state; state.textContent = STATE_WORDS[e.state];
      top.append(label, state);
      const when = document.createElement("div"); when.className = "small muted"; when.textContent = ago(e.at);
      row.append(top, when);
      if (e.state === "refused" && e.why) { const w = document.createElement("div"); w.className = "small"; w.style.color = "var(--warn)"; w.textContent = e.why; row.append(w); }
      if (e.state === "sent" && e.unconfirmable) { const w = document.createElement("div"); w.className = "small muted"; w.textContent = "The PC copy is too old to confirm this — open the PC app, then Get latest."; row.append(w); }
      body.append(row);
    }
  });
}
async function render() {
  if (!payload.phone) {
    message("This copy was written by an older version of the PC app. Open the app on the PC once (it rewrites the copy within a minute), then tap Try again.");
    return;
  }
  await loadLocal();
  const ph = payload.phone || {}, old = (ph.data || 0) < 3;      // 3 = phone_data.DATA_VERSION this page needs
  const fresh = $("fresh");
  fresh.textContent = `${ph.source === "test" ? "Test copy (fake data)" : ph.source === "demo" ? "Demo copy" : ph.source === "real" ? "Your data" : "PC copy"} from ${ago(payload.made)}` +
    (old ? " · old PC version — restart the PC app" : Date.now() - new Date(payload.made) > 7 * 864e5 ? " — open the PC app to refresh" : "");
  fresh.style.color = old ? "var(--warn)" : "";
  fresh.style.fontWeight = old ? "700" : "";
  show("app");
  ui.mount(payload.phone, ctx);
  mounted = true;
}
const ctx = {
  isTicked: key => !!local.ticks[key],
  isAnswered: desc => !!local.answers[desc],
  pendingCount: () => pending,
  refusedCount: () => entries.filter(e => e.state === "refused").length,
  openEntries: () => entriesSheet(),
  sentFiles: () => local.sent || [],
  async send(path, fields) { await queueAdd({ path, fields }); },
  toast,
  async tick(key) {
    local.ticks[key] = new Date().toISOString(); await idb.set("local", local).catch(() => {});
    await queueAdd({ path: "/routine/done", fields: [["key", key]] });
  },
  // A review answer waits 5 s so it can be undone, then goes into the queue.
  answer(desc, fields, rerender) {
    local.answers[desc] = new Date().toISOString();
    let undone = false;
    const timer = setTimeout(async () => { if (undone) return; await idb.set("local", local).catch(() => {}); await queueAdd({ path: "/review", fields }, true); }, 5000);
    toast("Filed.", { label: "Undo", run: () => { undone = true; clearTimeout(timer); delete local.answers[desc]; rerender(); } });
  },
  upload: uploadFile,
  flushNow: sendNow,
};
// Entries wait on the phone until they reach Drive; this is the one button that sends them (it signs in if it must).
async function sendNow() {
  try {
    if (!token) await getToken(false, true);
    await flush();
    toast(pending ? `${pending} still waiting — try again with a connection.` : "Sent — the PC applies it within a minute while it runs.");
  } catch (e) { toast("Not sent yet: " + (e instanceof TypeError ? "there is no connection." : e.message)); }
  updateBanner();
}
$("sync-send").onclick = sendNow;
// Back in the app, or the connection returns: if a token already exists, send what waits (never starts a sign-in).
function tryQuietSend() { if (token && liveKey && pending) flush().catch(() => {}).finally(updateBanner); }
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tryQuietSend(); });
window.addEventListener("online", tryQuietSend);

// ---------------------------------------------------------------- the phone's queue (C2) and uploads (C3)
// Each change goes to Drive as one encrypted file in a folder this page creates itself ("Finance-phone-queue");
// the PC applies it with finance/sync/phone_queue.py and then republishes the snapshot.
async function queueAdd(q, quiet) {
  // quiet = a review answer sent 5 s after the tap: no toast. Saving never starts a sign-in (PLAN-55); it sends only
  // when a token already exists, otherwise the entry waits on the phone and the banner offers Send.
  const items = (await idb.get("queue")) || [];
  items.push({ id: crypto.randomUUID(), at: new Date().toISOString(), path: String(q.path), label: labelFor(String(q.path)), fields: q.fields || [] });
  await idb.set("queue", items);
  setPending(items.length);
  try { await flush(); if (!quiet) toast("Sent — the PC applies it within a minute while it runs."); }
  catch (e) {
    setPending(((await idb.get("queue").catch(() => null)) || []).length);
    if (!quiet) toast(`Saved on this phone — ${pending} waiting. Tap Send in the bar above when you are online.`);
  }
}
async function queueFolder() {
  const known = await idb.get("queue-folder");
  if (known) return known;
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and appProperties has { key='financePhone' and value='${NAMES.marker}' } and trashed=false`);
  const found = (await (await drive(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`)).json()).files || [];
  const id = found.length ? found[0].id : (await (await drive("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: NAMES.folder, mimeType: "application/vnd.google-apps.folder", appProperties: { financePhone: NAMES.marker } }),
  })).json()).id;
  await idb.set("queue-folder", id);
  return id;
}
async function putSealed(name, bytes) {
  const meta = { name, parents: [await queueFolder()], appProperties: { financePhone: "item" } };
  const boundary = "fin" + crypto.randomUUID().replace(/-/g, "");
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`, bytes, `\r\n--${boundary}--`]);
  await drive("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body });
}
function sealParams(kind) {
  const { header } = readHeader(blob);
  return { salt: header.salt, iterations: header.iter, kind, made: new Date().toISOString(), profile: PROFILE };
}
let flushing = null;       // one send at a time, so a tap and a return to the app never upload the same entries twice
function flush() { return flushing || (flushing = doFlush().finally(() => { flushing = null; })); }
async function doFlush() {
  const items = (await idb.get("queue")) || [];
  if (!items.length) return;
  if (!token || !liveKey) throw new Error("not signed in");
  try { await putSealed(`queue-${Date.now()}.fin`, await seal(liveKey, { items }, sealParams("queue"))); }
  catch (e) { netDown = e instanceof TypeError; updateBanner(); throw e; }
  netDown = false;
  const log = ((await idb.get("sentlog").catch(() => null)) || []).concat(items.map(i => ({ id: i.id, label: i.label || labelFor(i.path), at: i.at })));
  await idb.set("sentlog", log.slice(-50));                                  // the last 50, to match the PC's receipts
  const sent = new Set(items.map(i => i.id));
  const left = ((await idb.get("queue")) || []).filter(i => !sent.has(i.id));
  await idb.set("queue", left);
  setPending(left.length);
}
async function uploadFile(f, what) {
  if (f.size > 15 * 1024 * 1024) throw new Error("that file is over 15 MB");
  if (!token) await getToken(false, true);
  const b64 = await new Promise((res, rej) => { const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
  await putSealed(`upload-${Date.now()}.fin`, await seal(liveKey, { name: f.name, b64, what: what || "" }, sealParams("upload")));
  local.sent = [...(local.sent || []), { name: f.name, what: what || "", at: new Date().toISOString() }];
  await idb.set("local", local).catch(() => {});
}

// ---------------------------------------------------------------- buttons
async function fetchLatest(interactive) {
  try {
    if (!token) await getToken(interactive);
    if (liveKey) await flush().catch(() => {});      // send what was done on the phone first
    await download();
    await open();
    if (payload) toast("Up to date.");
  } catch (err) {
    if (payload) toast(err.message); else message(err.message);
  }
}
async function lock() {
  await idb.del("key"); payload = null; liveKey = null; ui.closeAllSheets(); $("views").innerHTML = ""; show("screen-unlock");
}
$("signin").onclick = () => fetchLatest(true);
$("retry").onclick = () => fetchLatest(false);
$("resignin").onclick = () => { token = null; fetchLatest(true); };
$("menu-btn").onclick = () => ui.sheet("Household finance", (body, s) => {
  const btn = (label, sub, fn) => { const b = document.createElement("button"); b.className = "big-btn";
    b.innerHTML = `<div>${label}</div><div class="small muted" style="font-weight:400">${sub}</div>`; b.onclick = () => { s.close(); fn(); }; return b; };
  body.append(
    btn("↻ Get latest", `Copy from the PC written ${ago(payload.made)}${pending ? ` · ${pending} change(s) to send` : ""}`, () => fetchLatest(false)),
    btn("Sign in again", "Switch Google account or grant Drive permission again", () => { token = null; fetchLatest(true); }),
    btn("Sent from this phone", entries.length ? `${entries.length} entr${entries.length > 1 ? "ies" : "y"} — waiting, sent, applied or refused` : "Nothing yet", entriesSheet),
    btn("Layout report", "Screen size, keyboard and tab bar measurements — no data in it", layoutSheet),
    btn("Lock", "Forget the passphrase on this phone until you type it again", lock));
  const p = document.createElement("p"); p.className = "small muted";
  p.textContent = `Phone app v${APP_VERSION}${PROFILE === "test" ? " · beta · test profile (fake data)" : ""}. ` + "Changes made on the phone (review answers, routine ticks, files) wait encrypted in your Drive until the PC applies them. Everything else is set on the PC.";
  body.append(p);
});

// ---------------------------------------------------------------- layout readout (PLAN-54, BUG-001)
// The bottom tab bar once disappeared on the real phone while typing. Layout numbers (no data) and the last 20 viewport
// / focus events, so the cause can be read off the device instead of guessed.
const layoutLog = [];
function logLayout(type) {
  const vv = window.visualViewport, bar = $("tabbar").getBoundingClientRect();
  layoutLog.push({ at: new Date(), type, h: innerHeight, vh: vv ? Math.round(vv.height) : null, vtop: vv ? Math.round(vv.offsetTop) : null, tab: Math.round(bar.top) });
  if (layoutLog.length > 20) layoutLog.shift();
}
for (const t of ["resize", "orientationchange"]) window.addEventListener(t, () => logLayout(t));
if (window.visualViewport) for (const t of ["resize", "scroll"]) visualViewport.addEventListener(t, () => logLayout("viewport " + t));
for (const t of ["focusin", "focusout"]) document.addEventListener(t, () => logLayout(t));
function measure(css) {
  const d = document.createElement("div"); d.style.cssText = "position:fixed;visibility:hidden;" + css; document.body.append(d);
  const cs = getComputedStyle(d), r = d.getBoundingClientRect(), out = { h: r.height, pt: cs.paddingTop, pr: cs.paddingRight, pb: cs.paddingBottom, pl: cs.paddingLeft };
  d.remove(); return out;
}
function layoutReport() {
  const vv = window.visualViewport, bar = $("tabbar").getBoundingClientRect();
  const mode = ["standalone", "fullscreen", "minimal-ui"].find(m => matchMedia(`(display-mode: ${m})`).matches) || "browser tab";
  const safe = measure("padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)");
  const lines = [
    `display mode: ${mode}`,
    `window: ${innerWidth} x ${innerHeight}`,
    `visual viewport: ${vv ? `${Math.round(vv.width)} x ${Math.round(vv.height)}, top ${Math.round(vv.offsetTop)}, left ${Math.round(vv.offsetLeft)}, scale ${vv.scale}` : "not available"}`,
    `100dvh: ${Math.round(measure("height:100dvh").h)}`,
    `safe area (top right bottom left): ${[safe.pt, safe.pr, safe.pb, safe.pl].map(v => Math.round(parseFloat(v) || 0)).join(" ")}`,
    `tab bar: top ${Math.round(bar.top)}, height ${Math.round(bar.height)}`,
    `browser: ${navigator.userAgent}`,
    `recent events (newest last, at most 20):`,
    ...layoutLog.map(e => `  ${e.at.toTimeString().slice(0, 8)} ${e.type}: window ${e.h}, viewport ${e.vh} (top ${e.vtop}), tab bar top ${e.tab}`),
  ];
  return lines.join("\n");
}
function layoutSheet() {
  ui.sheet("Layout report", body => {
    const pre = document.createElement("pre");
    pre.style.cssText = "white-space:pre-wrap;word-break:break-word;font-size:12px;margin:0";
    pre.textContent = layoutReport();
    body.append(pre);
  });
}

// ---------------------------------------------------------------- start
(async () => {
  window.__appStarted = true;
  if (PROFILE === "test") { $("profile-strip").hidden = false; document.title = "Household finance (beta)"; }
  if ("serviceWorker" in navigator) {
    // A new version takes over while this page still runs the old code: offer a reload instead of mixing the two.
    const hadOne = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (hadOne) toast("A new version of this app is here.", { label: "Reload", run: () => location.reload() });
    });
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  if (CLIENT_ID.startsWith("PASTE")) { message("This page is not set up yet: the Google client ID is missing in config.js."); return; }
  const saved = await idb.get("snapshot").catch(() => null);
  if (saved && saved.blob) { blob = saved.blob; modified = saved.modified; await open(); }   // works offline
  else show("screen-start");
})();
