// The phone shell (PLAN-43 C1): sign in to Google, download the encrypted snapshot from Drive, unlock it with the
// passphrase, show the screens. Read-only; the PC stays the only place where data changes.
import { CLIENT_ID, SNAPSHOT_NAME, REMEMBER_DAYS } from "./config.js";
import { deriveKey, openSealed, readHeader, seal, WrongKey } from "./crypto.js";
import { buildDoc } from "./render.js";

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
let current = "/";
let token = null, tokenClient = null;
let liveKey = null;      // the unlocked key, in memory only (also in IndexedDB when "remember" is ticked)

function show(id) {
  for (const s of ["screen-start", "screen-unlock", "screen-msg", "screen-upload"]) $(s).hidden = s !== id;
  const viewing = id === "view" || id === "screen-upload";
  $("view").hidden = id !== "view"; $("tabs").hidden = !viewing; $("foot").hidden = !viewing;
}
function message(text) { $("msg").textContent = text; show("screen-msg"); }
function toast(text) {
  let t = $("toast"); if (!t) { t = document.createElement("div"); t.id = "toast"; document.body.append(t); }
  t.textContent = text; t.hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
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
    tokenClient.callback = r => r.error ? reject(new Error(r.error_description || r.error)) : (token = r.access_token, resolve(token));
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
  if (!f) throw new Error("No finance copy in this Google Drive yet. On the PC: Settings → Phone → set the passphrase, and check that Google Drive for desktop is running.");
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

// ---------------------------------------------------------------- showing screens
function render() {
  const tabs = $("tabs"); tabs.innerHTML = "";
  for (const [path, title] of Object.entries(payload.titles || {})) {
    const b = document.createElement("button"); b.textContent = title; b.dataset.path = path;
    b.className = "small-btn" + (path === current ? " on" : ""); b.onclick = () => go(path); tabs.append(b);
  }
  const up = document.createElement("button"); up.textContent = "⬆ Upload"; up.className = "small-btn";
  up.onclick = () => { tabs.querySelectorAll("button").forEach(x => x.classList.remove("on")); up.classList.add("on"); show("screen-upload"); };
  tabs.append(up);
  updatePending();
  if (!payload.pages[current]) current = "/";
  const made = payload.made;
  $("fresh").textContent = `From the PC ${ago(made)}` + (Date.now() - new Date(made) > 7 * 864e5 ? " — open the app on the PC to refresh it" : "");
  $("refresh").hidden = false;
  $("view").srcdoc = buildDoc(payload, current);
  show("view");
}
function go(href) {
  const path = href.split(/[?#]/)[0] || "/";
  if (!payload.pages[path]) { toast("That screen is only on the PC."); return; }
  current = path; render(); window.scrollTo(0, 0);
}
window.addEventListener("message", e => {
  if (e.source !== $("view").contentWindow || !e.data) return;
  if (e.data.go) go(String(e.data.go));
  if (e.data.note) toast(String(e.data.note));
  if (e.data.queue) queueAdd(e.data.queue);
});

// ---------------------------------------------------------------- the phone's queue (C2) and uploads (C3)
// Each queued button / uploaded file goes to Drive as one encrypted file in a folder this page creates itself
// ("Finance-phone-queue"); the PC applies it with finance/sync/phone_queue.py and then republishes the snapshot.
async function queueAdd(q) {
  const items = (await idb.get("queue")) || [];
  items.push({ id: crypto.randomUUID(), at: new Date().toISOString(), path: String(q.path), fields: q.fields || [] });
  await idb.set("queue", items);
  updatePending();
  try { await flush(); toast("Saved — the PC applies it the next time it runs."); }
  catch (e) { toast("Saved on the phone — tap Get latest to send it to the PC."); }
}
async function updatePending() {
  const n = ((await idb.get("queue")) || []).length;
  $("pending").textContent = n ? `${n} change(s) waiting to be sent — tap Get latest.` :
    "Review answers and routine ticks are saved for the PC; the rest is read-only.";
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
  await idb.set("queue", ((await idb.get("queue")) || []).filter(i => !sent.has(i.id)));
  updatePending();
}
$("upload-btn").onclick = async () => {
  const f = $("upload-file").files[0], msg = $("upload-msg");
  if (!f) { msg.textContent = "Pick a file first."; return; }
  if (f.size > 15 * 1024 * 1024) { msg.textContent = "That file is over 15 MB."; return; }
  const btn = $("upload-btn"); btn.disabled = true; msg.textContent = "Encrypting and sending…";
  try {
    if (!token) await getToken(false);
    const b64 = await new Promise((res, rej) => { const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
    await putSealed(`upload-${Date.now()}.fin`, await seal(liveKey, { name: f.name, b64 }, sealParams("upload")));
    msg.textContent = `Sent ${f.name}. The PC imports it the next time it runs.`; $("upload-file").value = "";
  } catch (err) { msg.textContent = "Not sent: " + err.message; }
  finally { btn.disabled = false; }
};

// ---------------------------------------------------------------- buttons
async function fetchLatest(interactive) {
  const btn = $("refresh"); btn.disabled = true; btn.textContent = "…";
  try {
    if (!token) await getToken(interactive);
    if (liveKey) await flush().catch(() => {});      // send what was done on the phone first
    await download();
    await open();
    if (payload) toast("Up to date.");
  } catch (err) {
    if (payload) toast(err.message); else message(err.message);
  } finally { btn.disabled = false; btn.textContent = "↻ Get latest"; }
}
$("signin").onclick = () => fetchLatest(true);
$("refresh").onclick = () => fetchLatest(false);
$("lock").onclick = async () => { await idb.del("key"); payload = null; liveKey = null; $("view").srcdoc = ""; show("screen-unlock"); };

// ---------------------------------------------------------------- start
(async () => {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (CLIENT_ID.startsWith("PASTE")) { message("This page is not set up yet: the Google client ID is missing in config.js."); return; }
  const saved = await idb.get("snapshot").catch(() => null);
  if (saved && saved.blob) { blob = saved.blob; modified = saved.modified; await open(); }   // works offline
  else show("screen-start");
})();
