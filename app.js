// The phone shell (PLAN-43 C, PLAN-44): sign in to Google, download the encrypted snapshot from Drive, unlock it with the
// passphrase, hand the data to ui.js, and send what was done on the phone back to the PC as encrypted queue files.
import { CLIENT_ID, SNAPSHOT_NAME, REMEMBER_DAYS } from "./config.js?v=12";
import { deriveKey, openSealed, readHeader, seal, WrongKey } from "./crypto.js?v=12";
import * as ui from "./ui.js?v=12";

// drive.readonly finds the copy Drive for desktop uploaded; drive.file is for the phone's own queue files (C2).
const SCOPES = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file";
const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- tiny IndexedDB key/value store
const idb = (() => {
  let dbp;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open("finance-phone", 1);
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

const GATES = ["screen-start", "screen-unlock", "screen-msg"];
function show(id) {
  for (const s of GATES) $(s).hidden = s !== id;
  const app = id === "app";
  $("views").hidden = !app; $("tabbar").hidden = !app; $("menu-btn").hidden = !app;
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
function getToken(interactive) {
  return new Promise((resolve, reject) => {
    if (!(window.google && google.accounts && google.accounts.oauth2)) return reject(new Error("Google sign-in did not load — check the connection."));
    if (!tokenClient) tokenClient = google.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPES, callback: () => {} });
    tokenClient.callback = r => {
      if (r.error) return reject(new Error(r.error_description || r.error));
      // Google shows a tick box per permission; without "see your Drive files" the copy is invisible to this page.
      if (!google.accounts.oauth2.hasGrantedAllScopes(r, "https://www.googleapis.com/auth/drive.readonly")) {
        token = null;
        return reject(new Error("Google did not give this page permission to see your Drive files. Tap “Sign in again” and, on Google's screen, tick “See and download all your Google Drive files”."));
      }
      token = r.access_token; resolve(token);
    };
    tokenClient.error_callback = e => reject(new Error(e.message || e.type || "sign-in was cancelled"));
    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}
async function drive(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  if (r.status === 401) { token = null; throw new Error("Google sign-in expired — tap Get latest again."); }
  if (!r.ok) throw new Error(`Google Drive answered ${r.status}`);
  return r;
}
async function download() {
  const q = encodeURIComponent(`name='${SNAPSHOT_NAME}' and trashed=false`);
  const list = await (await drive(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=1&fields=files(id,modifiedTime,size)`)).json();
  const f = (list.files || [])[0];
  if (!f) {
    let who = "";
    try { who = (await (await drive("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)")).json()).user.emailAddress; } catch (e) { /* not essential */ }
    throw new Error(`No finance copy found in the Google Drive of ${who || "this account"}. Check that this is the account Google Drive for desktop uses on the PC, and on drive.google.com that the folder Finance-sync holds snapshot.fin (Drive for desktop may still be uploading it).`);
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
  pending = ((await idb.get("queue").catch(() => null)) || []).length;
}
async function render() {
  if (!payload.phone) {
    message("This copy was written by an older version of the PC app. Open the app on the PC once (it rewrites the copy within a minute), then tap Try again.");
    return;
  }
  await loadLocal();
  $("fresh").textContent = `PC copy from ${ago(payload.made)}` + (Date.now() - new Date(payload.made) > 7 * 864e5 ? " — open the PC app to refresh" : "");
  show("app");
  ui.mount(payload.phone, ctx);
}
const ctx = {
  isTicked: key => !!local.ticks[key],
  isAnswered: desc => !!local.answers[desc],
  pendingCount: () => pending,
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
};

// ---------------------------------------------------------------- the phone's queue (C2) and uploads (C3)
// Each change goes to Drive as one encrypted file in a folder this page creates itself ("Finance-phone-queue");
// the PC applies it with finance/sync/phone_queue.py and then republishes the snapshot.
async function queueAdd(q, quiet) {
  const items = (await idb.get("queue")) || [];
  items.push({ id: crypto.randomUUID(), at: new Date().toISOString(), path: String(q.path), fields: q.fields || [] });
  await idb.set("queue", items);
  pending = items.length; ui.refreshBadges();
  try { await flush(); if (!quiet) toast("Saved — the PC applies it within a minute while it runs."); }
  catch (e) { toast("Saved on the phone — it goes to the PC with the next Get latest."); }
}
async function queueFolder() {
  const known = await idb.get("queue-folder");
  if (known) return known;
  const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and appProperties has { key='financePhone' and value='queue' } and trashed=false");
  const found = (await (await drive(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`)).json()).files || [];
  const id = found.length ? found[0].id : (await (await drive("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Finance-phone-queue", mimeType: "application/vnd.google-apps.folder", appProperties: { financePhone: "queue" } }),
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
  return { salt: header.salt, iterations: header.iter, kind, made: new Date().toISOString() };
}
async function flush() {
  const items = (await idb.get("queue")) || [];
  if (!items.length) return;
  if (!token || !liveKey) throw new Error("not signed in");
  await putSealed(`queue-${Date.now()}.fin`, await seal(liveKey, { items }, sealParams("queue")));
  const sent = new Set(items.map(i => i.id));
  const left = ((await idb.get("queue")) || []).filter(i => !sent.has(i.id));
  await idb.set("queue", left);
  pending = left.length; ui.refreshBadges();
}
async function uploadFile(f, what) {
  if (f.size > 15 * 1024 * 1024) throw new Error("that file is over 15 MB");
  if (!token) await getToken(false);
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
    btn("Lock", "Forget the passphrase on this phone until you type it again", lock));
  const p = document.createElement("p"); p.className = "small muted";
  p.textContent = "Changes made on the phone (review answers, routine ticks, files) wait encrypted in your Drive until the PC applies them. Everything else is set on the PC.";
  body.append(p);
});

// ---------------------------------------------------------------- start
(async () => {
  window.__appStarted = true;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (CLIENT_ID.startsWith("PASTE")) { message("This page is not set up yet: the Google client ID is missing in config.js."); return; }
  const saved = await idb.get("snapshot").catch(() => null);
  if (saved && saved.blob) { blob = saved.blob; modified = saved.modified; await open(); }   // works offline
  else show("screen-start");
})();
