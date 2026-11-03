// The encrypted file format, phone side (PLAN-43 C). Mirror of finance/sync/crypto.py — keep the two in step.
//   file = "FINSYNC1" | header length (4 bytes, big-endian) | header JSON | AES-256-GCM ciphertext+tag
//   key  = PBKDF2-SHA256(passphrase, header.salt, header.iter); additional data = everything before the ciphertext
const MAGIC = "FINSYNC1";

export function unb64(s) { return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
export function b64(bytes) { let s = ""; for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b); return btoa(s); }

export function readHeader(buf) {
  const u = new Uint8Array(buf);
  if (new TextDecoder().decode(u.slice(0, 8)) !== MAGIC) throw new Error("not a finance sync file");
  const n = new DataView(u.buffer, u.byteOffset).getUint32(8, false);
  if (n > 4096) throw new Error("bad header");
  return { header: JSON.parse(new TextDecoder().decode(u.slice(12, 12 + n))), prefix: u.slice(0, 12 + n), body: u.slice(12 + n) };
}

// A non-extractable key: it can decrypt (and later encrypt the phone's queue) but can never be read out again.
export async function deriveKey(passphrase, saltB64, iterations) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(saltB64), iterations },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt", "encrypt"]);
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class WrongKey extends Error {}

export async function openSealed(key, buf) {
  const { header, prefix, body } = readHeader(buf);
  let plain;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(header.iv), additionalData: prefix }, key, body);
  } catch (e) { throw new WrongKey("this passphrase does not open the file"); }
  return { header, payload: JSON.parse(new TextDecoder().decode(await gunzip(plain))) };
}

// For the phone's queue (C2): same format, so the PC opens it with finance/sync/crypto.py.
export async function seal(key, payload, { salt, iterations, kind, made }) {
  const header = { v: 1, kdf: "PBKDF2-SHA256", iter: iterations, salt, iv: b64(crypto.getRandomValues(new Uint8Array(12))), kind, made };
  const hb = new TextEncoder().encode(JSON.stringify(header));
  const prefix = new Uint8Array(12 + hb.length);
  prefix.set(new TextEncoder().encode(MAGIC), 0);
  new DataView(prefix.buffer).setUint32(8, hb.length, false);
  prefix.set(hb, 12);
  const body = await gzip(new TextEncoder().encode(JSON.stringify(payload)));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: unb64(header.iv), additionalData: prefix }, key, body));
  const out = new Uint8Array(prefix.length + ct.length); out.set(prefix); out.set(ct, prefix.length);
  return out;
}
