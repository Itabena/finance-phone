// Turns one page of the decrypted snapshot into a self-contained document for the sandboxed frame (PLAN-43 C1).
// The page's CSS/JS/images come from payload.assets; its follow-up GETs are answered from payload.api; links to
// other screens and form submits are handed to the shell (postMessage) instead of going to the network.

// Runs inside the frame. Kept dependency-free: it is inserted as text.
function shim(API, QUEUE) {
  const queueable = path => QUEUE.some(re => new RegExp("^" + re + "$").test(path));
  const pathOf = url => { try { return new URL(url, "http://pc.invalid").pathname; } catch (e) { return String(url).split("?")[0]; } };
  const fieldsOf = fd => { const out = []; for (const [k, v] of fd.entries()) if (typeof v === "string") out.push([k, v]); return out; };
  const json = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
    if (method !== "GET") {
      const body = (init && init.body) || null;
      if (queueable(pathOf(url)) && body instanceof FormData) {
        parent.postMessage({ queue: { path: pathOf(url), fields: fieldsOf(body) } }, "*");
        return Promise.resolve(new Response("{}", { status: 200 }));          // the row turns "saved" as on the PC
      }
      parent.postMessage({ note: "Read-only on the phone — do this on the PC." }, "*");
      return Promise.reject(new Error("read-only"));
    }
    let key = url;
    try { const u = new URL(url, "http://pc.invalid"); key = u.pathname + u.search; } catch (e) { /* keep url */ }
    if (Object.prototype.hasOwnProperty.call(API, key)) return Promise.resolve(json(API[key]));
    const path = key.split("?")[0];
    const near = Object.keys(API).find(k => k.split("?")[0] === path);   // sliders are off: the default answer is right
    return Promise.resolve(near ? json(API[near]) : json({ phone: "only on the PC" }, 404));
  };
  document.addEventListener("click", e => {
    const a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
    if (!a) return;
    const h = a.getAttribute("href") || "";
    if (h.startsWith("#") || h.startsWith("javascript:")) return;
    e.preventDefault();
    if (/^https?:\/\//i.test(h)) { window.open(h, "_blank", "noopener"); return; }
    if (h.startsWith("/")) parent.postMessage({ go: h }, "*");
  }, true);
  document.addEventListener("submit", e => {
    if (e.defaultPrevented) return;                     // the page handles it itself (e.g. Review uses fetch)
    e.preventDefault();
    const form = e.target, path = pathOf(form.getAttribute("action") || "");
    if (!queueable(path)) { parent.postMessage({ note: "Read-only on the phone — do this on the PC." }, "*"); return; }
    const fd = new FormData(form);
    if (e.submitter && e.submitter.name) fd.append(e.submitter.name, e.submitter.value);
    parent.postMessage({ queue: { path, fields: fieldsOf(fd) } }, "*");
    form.querySelectorAll("button").forEach(b => { b.disabled = true; });
    const b = e.submitter || form.querySelector("button");
    if (b) b.textContent = "✓ Saved for the PC";
  }, false);
}

// Buttons the phone may press. They wait in Drive until the PC replays them — mirror of ALLOWED in
// finance/sync/phone_queue.py (the PC refuses anything else anyway).
export const QUEUE_PATHS = ["/review", "/review/accept-suggestions", "/routine/done", "/proposal/\\d+/(accept|reject)"];

const PHONE_CSS = `
body > header, aside.chat { display: none !important; }
input[type=range] { pointer-events: none; opacity: .45; }
main { padding-left: 12px !important; padding-right: 12px !important; }
`;

const noCloseTag = (text, tag) => text.replace(new RegExp(`</(${tag})`, "gi"), "<\\/$1");
const safeJSON = v => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

export function buildDoc(payload, path) {
  const A = payload.assets || {};
  let html = payload.pages[path];
  if (html == null) throw new Error(`no screen ${path}`);
  html = html.replace(/<link\b[^>]*>/gi, tag => {
    const href = (tag.match(/\bhref="(\/static\/[^"?#]+)/i) || [])[1];
    if (!href || !/\brel="stylesheet"/i.test(tag)) return tag;
    return A[href] && A[href].text != null ? `<style>${noCloseTag(A[href].text, "style")}</style>` : "";
  });
  html = html.replace(/<script\b([^>]*?)\bsrc="(\/static\/[^"?#]+)[^"]*"([^>]*)>\s*<\/script>/gi, (m, a, src, b) =>
    A[src] && A[src].text != null ? `<script${a}${b}>${noCloseTag(A[src].text, "script")}</script>` : "");
  html = html.replace(/\b(src|href)="(\/static\/[^"?#]+)[^"]*"/gi, (m, attr, p) =>
    A[p] && A[p].b64 ? `${attr}="data:${A[p].type};base64,${A[p].b64}"` : m);
  const head = `<script>(${shim.toString()})(${safeJSON(payload.api || {})}, ${safeJSON(QUEUE_PATHS)});</script><style>${PHONE_CSS}</style>`;
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + head) : head + html;
}
