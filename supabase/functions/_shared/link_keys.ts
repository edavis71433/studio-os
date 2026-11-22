// ── Every kind of signed link gets a key of its own (builder list item 394) ──────
// Before: proposal, agreement and estimate links, the retainer card link, shared draft links,
// one-tap approvals, booking links, form tickets and Join our list links were all signed with
// APPROVAL_SECRET, or if that wasn't set an older secret, or the scheduler's secret, which sat
// in plain text in the database's job list until Nov 9. Every unsubscribe link, open counter
// and emailed photo was signed with the database's master key itself, so changing that key
// would have broken every unsubscribe link ever sent.
//
// Now each kind has its own key, derived from one root:
//   LINK_SECRET, if it is ever set (optional; any long random value), else APPROVAL_SECRET,
//   else the database's key, which every function has. Never the scheduler's secret.
// A kind with a secret of its own uses it as before (PREVIEW_LINK_SECRET for shared drafts).
// The keys are derived one way (HMAC-SHA256 of the root over the kind's name), so one kind's
// key can't sign another kind's links and none of them gives the root away.
//
// Nothing already sent breaks. A link that always expires within 90 days (a form ticket,
// a draft link, a one-tap approval, the card link, a spam or Join our list link) and was
// signed the old way still opens until LEGACY_LINKS_UNTIL, 90 days after this went live: its
// old key may have been the scheduler's secret. A link that never expires keeps opening with
// its old key for as long as that key is the same: a receipt's or a signed agreement's
// (sales item 79 keeps those for good), a booking's change-or-cancel link, and every emailed
// unsubscribe link, open counter and photo (signed with the database key itself). Breaking
// those would break what people were promised; changing the old secret retires them.
// A link signed from any root this server still holds keeps opening, so setting LINK_SECRET
// later breaks nothing either.
//
// Sync on purpose: half the callers pick their key outside an async step, so the derivation
// is a small SHA-256 written out here (tests/presence/link_keys_394_test.mjs checks it
// against WebCrypto).

export type LinkKind =
  | 'sales' | 'retainer_card' | 'preview' | 'approval' | 'booking' | 'form_ticket' | 'spam_link' | 'join'
  | 'email_unsubscribe' | 'email_open' | 'email_image' | 'address_hash' | 'ip_hash';

/** Until this moment a link signed the old way is still accepted (90 days after Nov 23 2026). */
export const LEGACY_LINKS_UNTIL = '2027-02-21T00:00:00Z';

// Each secret is read by its name, so the secret inventory (tests/presence/secret_inventory_test.mjs) sees it.
const t = (v: string | undefined) => (v || '').trim();
const linkSecretEnv = () => t(Deno.env.get('LINK_SECRET'));
const approvalEnv = () => t(Deno.env.get('APPROVAL_SECRET'));
const previewEnv = () => t(Deno.env.get('PREVIEW_LINK_SECRET'));
const stateEnv = () => t(Deno.env.get('STATE_SIGNING_SECRET'));
const schedulerEnv = () => t(Deno.env.get('SCHEDULER_SECRET'));
const dbKey = () => t(Deno.env.get('SERVICE_ROLE_KEY')) || t(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));

/** A kind that has a secret of its own, used as it is before any derived key. */
const ownSecret = (kind: LinkKind): string => (kind === 'preview' ? previewEnv() : '');

/** The roots a key may come from, the one new links use first. Never the scheduler's secret. */
export function linkRoots(): string[] {
  return [...new Set([linkSecretEnv(), approvalEnv(), dbKey()].filter(Boolean))];
}

/** Links that never expire: their old signatures stay good while the old key is the same. */
const LASTING_KINDS: ReadonlySet<LinkKind> = new Set(['sales', 'booking', 'email_unsubscribe', 'email_open', 'email_image']);

/** What each kind was signed with before this change. */
function legacyKeys(kind: LinkKind): string[] {
  const first = (...vals: string[]) => { const v = vals.find(Boolean); return v ? [v] : []; };
  switch (kind) {
    case 'sales': case 'retainer_card': return first(approvalEnv(), stateEnv(), schedulerEnv());
    case 'preview': return first(previewEnv(), approvalEnv(), stateEnv(), schedulerEnv());
    case 'approval': case 'booking': case 'form_ticket': case 'spam_link': case 'join': return first(approvalEnv(), schedulerEnv());
    case 'email_unsubscribe': case 'email_open': case 'email_image': return first(dbKey());
    default: return [];   // hashes, not links: nothing to keep opening
  }
}

const memo = new Map<string, string>();
/** The key for one kind from one root, as 64 hex characters. Pure. */
export function deriveLinkKey(root: string, kind: LinkKind): string {
  const id = `${kind}\u0000${root}`;
  let k = memo.get(id);
  if (!k) { k = toHex(hmacSha256(utf8(root), utf8(`studio-os/link-key/v1/${kind}`))); if (memo.size > 64) memo.clear(); memo.set(id, k); }
  return k;
}

/** The key new links of this kind are signed with; '' when the server holds no root at all. */
export function linkKey(kind: LinkKind): string {
  const own = ownSecret(kind);
  if (own) return own;
  const root = linkRoots()[0];
  return root ? deriveLinkKey(root, kind) : '';
}

/** Every key a link of this kind may be signed with now: the signing key first, then the same
 *  kind from the other roots, then (until LEGACY_LINKS_UNTIL) what it was signed with before. */
export function linkKeysAccepted(kind: LinkKind, nowMs: number = Date.now()): string[] {
  const out = [linkKey(kind), ...linkRoots().map((r) => deriveLinkKey(r, kind))];
  if (LASTING_KINDS.has(kind) || nowMs < Date.parse(LEGACY_LINKS_UNTIL)) out.push(...legacyKeys(kind));
  return [...new Set(out.filter(Boolean))];
}

/** Is a link signed with a key it may carry? `given` is the key the caller verifies with:
 *  when it is this server's own key for the kind, every accepted key is tried in turn
 *  (linkKeysAccepted); any other key (a test's own) is tried alone, as before. `check`
 *  says whether the link is signed with one key. */
export async function signedWithAny(kind: LinkKind, given: string | null | undefined, check: (key: string) => Promise<boolean>, nowMs: number = Date.now()): Promise<boolean> {
  const keys = given && given === linkKey(kind) ? linkKeysAccepted(kind, nowMs) : [given || ''];
  for (const k of keys) if (k && await check(k)) return true;
  return false;
}

// ── SHA-256 and HMAC, synchronously (FIPS 180-4, RFC 2104) ──
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const utf8 = (s: string) => new TextEncoder().encode(s);
const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/** SHA-256 of some bytes. Pure. */
export function sha256(msg: Uint8Array): Uint8Array {
  const bitLen = msg.length * 8;
  const padded = new Uint8Array(((msg.length + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
  return out;
}

/** HMAC-SHA256. Pure. */
export function hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array {
  const k = new Uint8Array(64);
  k.set(key.length > 64 ? sha256(key) : key);
  const inner = new Uint8Array(64 + msg.length), outer = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { inner[i] = k[i] ^ 0x36; outer[i] = k[i] ^ 0x5c; }
  inner.set(msg, 64);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}
