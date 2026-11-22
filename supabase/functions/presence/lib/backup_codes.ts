// ── Backup codes for two-step sign-in (builder list item 347, Nov 2026) ─────────
// Two-step sign-in (item 191) had no way back from a lost phone: the person emailed
// support, and someone cleared their second step by hand in Supabase. Now a person with
// an authenticator app gets ten backup codes, shown once. The PAGE makes them
// (crypto.getRandomValues) and keeps nothing; it sends the server only their hashes and
// the salt it hashed them with, so a copy of the database holds no code. One code turns
// two-step sign-in off once, without a session, for the account the email names; the
// person then signs in with their first step and sets two-step up again (and gets ten
// new codes, which replace the old set).
//
// The page and the server have to hash the same way, so the rule is written out here:
//   code    ten symbols from CODE_ALPHABET (no 0, O, 1 or I, so a printout reads right),
//           8 per code, shown as XXXX-XXXX; typed back in any case, with or without the
//           dash or spaces
//   salt    16 random bytes (or more) as lowercase hex, one per set
//   hash    sha256(utf8(`${salt}|${CODE}`)) as 64 lowercase hex characters, CODE being
//           the 8 symbols in capitals with the dash removed
// Everything here is pure (no I/O): the routes (routes/backup_codes.ts) do the reading
// and writing, and the tests drive these rules directly.

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 32 symbols; no 0/O, no 1/I
export const CODE_LENGTH = 8;
export const CODE_COUNT = 10;
/** The action name a studio owner's fresh code (lib/fresh_code.ts) is asked for. */
export const TWO_STEP_OFF_ACTION = 'two_step_off' as const;

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const SALT_RE = /^[0-9a-f]{32,128}$/;
const HASH_RE = /^[0-9a-f]{64}$/;

/** The code a person typed, as 8 capitals, or '' when it isn't one. Spaces and dashes
 *  are forgiven, and so is lower case; a symbol outside the alphabet (0, O, 1, I or
 *  anything else) makes it no code. Pure. */
export function normalizeCode(v: unknown): string {
  const s = String(v ?? '').toUpperCase().replace(/[\s-]/g, '');
  return CODE_RE.test(s) ? s : '';
}
/** XXXX-XXXX, how a code is shown; '' for anything that isn't a code. Pure. */
export function formatCode(v: unknown): string {
  const c = normalizeCode(v);
  return c ? `${c.slice(0, 4)}-${c.slice(4)}` : '';
}
/** A salt as the page sends it: 32 to 128 lowercase hex characters. Pure. */
export function isSalt(v: unknown): v is string {
  return typeof v === 'string' && SALT_RE.test(v);
}
/** One hash as the page sends it: 64 lowercase hex characters. Pure. */
export function isHash(v: unknown): v is string {
  return typeof v === 'string' && HASH_RE.test(v);
}
/** Exactly CODE_COUNT hashes, every one a hash and no two the same. Pure. */
export function isHashList(v: unknown): v is string[] {
  if (!Array.isArray(v) || v.length !== CODE_COUNT) return false;
  if (!v.every(isHash)) return false;
  return new Set(v).size === v.length;
}

const hex = (bytes: ArrayBuffer | Uint8Array) => Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');

/** The hash kept for a code: sha256(`${salt}|${CODE}`), hex. The code is normalised first,
 *  so "abcd-efgh" and "ABCDEFGH" hash the same; a non-code hashes to '' (never a match). */
export async function codeHash(code: unknown, salt: string): Promise<string> {
  const c = normalizeCode(code);
  if (!c || !isSalt(salt)) return '';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}|${c}`));
  return hex(digest);
}

/** Same length and same characters, in time that doesn't depend on where they differ. Pure. */
export function sameHash(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

/** The unused row the typed code matches, or null. Every row is compared (no early
 *  return), so the time taken says nothing about which row, if any, matched. Pure
 *  given the hashes. */
export function matchRow<T extends { code_hash: string; used_at?: string | null }>(rows: T[], hashBySalt: (salt: string) => string, saltOf: (row: T) => string): T | null {
  let hit: T | null = null;
  for (const r of rows || []) {
    const same = sameHash(String(r.code_hash || ''), hashBySalt(saltOf(r)));
    if (same && !r.used_at && hit === null) hit = r;
  }
  return hit;
}

/** New random symbols, every one equally likely (256 is a whole number of 32s, so a byte
 *  modulo 32 has no bias). `random` is crypto.getRandomValues on the page and here; a
 *  test hands in its own. */
export function newCode(random: (a: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a)): string {
  const bytes = random(new Uint8Array(CODE_LENGTH));
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}
/** A fresh set: CODE_COUNT distinct codes and the salt they are hashed with. The page
 *  does exactly this; the server never calls it for a real person. */
export function newSet(random: (a: Uint8Array) => Uint8Array = (a) => crypto.getRandomValues(a)): { codes: string[]; salt: string } {
  const codes = new Set<string>();
  while (codes.size < CODE_COUNT) codes.add(newCode(random));
  return { codes: [...codes], salt: hex(random(new Uint8Array(16))) };
}
/** The hashes of a set, in the order the codes were given (what the page sends). */
export async function hashSet(codes: string[], salt: string): Promise<string[]> {
  return await Promise.all(codes.map((c) => codeHash(c, salt)));
}

/** What the person sees of their set: how many codes are left, and when it was made. Pure. */
export function setSummary(rows: Array<{ used_at?: string | null; created_at?: string | null }>): { remaining: number; total: number; created_at: string | null } {
  const list = rows || [];
  const created = list.map((r) => String(r.created_at || '')).filter(Boolean).sort()[0] || null;
  return { remaining: list.filter((r) => !r.used_at).length, total: list.length, created_at: created };
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** How to say when it happened, in UTC, plainly. Pure. */
export function whenText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toUTCString().replace(/:\d\d GMT$/, ' UTC');
}

/** The email the person gets when two-step sign-in is turned off. Critical mail (an
 *  unsubscribe never stops it). `by` is 'code' (they used a backup code) or 'studio' (their
 *  studio turned it off for them). Pure. */
export function offEmail(by: 'code' | 'studio', f: { at: string; studio?: string; signInUrl?: string }): { subject: string; html: string } {
  const when = whenText(f.at);
  const studio = String(f.studio || '').trim();
  const subject = by === 'code' ? 'Two-step sign-in was turned off with a backup code' : `${studio || 'Your studio'} turned off your two-step sign-in`;
  const lead = by === 'code'
    ? `<p>A backup code was used to turn off two-step sign-in for your account${when ? ` on ${esc(when)}` : ''}. The code it was done with no longer works, and the rest of that set is gone too.</p>`
    : `<p>${esc(studio || 'Your studio')} turned off two-step sign-in for your account${when ? ` on ${esc(when)}` : ''}, because you asked them to.</p>`;
  const next = `<p>You can sign in with your password${f.signInUrl ? ` at <a href="${esc(f.signInUrl)}">${esc(f.signInUrl)}</a>` : ''}. Turn two-step sign-in back on from Settings as soon as you have an authenticator app on a phone again: it gives you ten new backup codes.</p>`;
  const warn = by === 'code'
    ? `<p style="color:#6b6478;font-size:13px">Wasn’t you? Someone has your password and one of your backup codes. Change your password now, and tell your studio.</p>`
    : `<p style="color:#6b6478;font-size:13px">Didn’t ask for this? Tell your studio straight away, and change your password.</p>`;
  return { subject, html: lead + next + warn };
}

/** What the change log says. Pure. */
export function offSummary(by: 'code' | 'studio', email: string): string {
  return by === 'code' ? `Two-step sign-in was turned off with a backup code (${email})` : `Turned off two-step sign-in for ${email}`;
}
