// ── Backup codes for two-step sign-in: the routes (builder list item 347) ──────
// The rules are in lib/backup_codes.ts (pure). This file does the reading and writing:
//
//   GET  /auth/backup-codes          signed in · how many codes are left, when the set was made
//   POST /auth/backup-codes          signed in · { hashes: [10], salt } replaces the caller's set;
//                                    refused unless they have a verified authenticator app
//   POST /auth/backup-codes/use      PUBLIC, no session · { email, code } turns two-step sign-in
//                                    off for that account once, if the code is one of theirs and
//                                    unused; the same { ok:false } for an unknown email, a wrong
//                                    code and an account with no codes, so nothing leaks
//   POST /agency/clients/:site/two-step/off   studio OWNER, with a fresh code (lib/fresh_code.ts) ·
//                                    turns a client's two-step sign-in off for them
//
// The second step is a Supabase TOTP factor (item 191). Turning it off is removing that factor
// through the auth ADMIN API with the service role (DELETE /auth/v1/admin/users/:id/factors/:fid);
// a code is never verified with the person's session (that signs them out), and nothing here
// calls mfa verify. The person then signs in with their first step and sets two-step up again.
import { appBase } from '../../_shared/app_url.ts';   // builder item 388: every link starts at the app's address
import { json } from '../../_shared/http.ts';
import type { Principal } from '../../_shared/auth.ts';
import { maskEmail } from '../../_shared/email_infra.ts';
import { svc } from '../lib/db.ts';
import { resolveSite } from '../lib/site.ts';
import { rateAllowBoth, clientIp, tooMany } from '../lib/ratelimit.ts';
import { requireFresh, appFactor } from '../lib/fresh_code.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { linksForCustomer } from '../lib/service_bridge.ts';
import { EMAIL_BRAND_DEFAULT, loadEmailBrand } from '../lib/email_brand.ts';
import type { EmailBrand } from '../lib/email_brand.ts';
import { isActiveClient } from '../agency/auth.ts';
import type { AgencyMember } from '../agency/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { CODE_COUNT, TWO_STEP_OFF_ACTION, normalizeCode, isSalt, isHashList, codeHash, matchRow, setSummary, offEmail, offSummary } from '../lib/backup_codes.ts';

const TABLE = 'presence_backup_codes';
/** The lost-phone door: this many tries per email, and per address, in USE_WINDOW_SEC. */
export const USE_PER_EMAIL = 5, USE_PER_IP = 20, USE_WINDOW_SEC = 15 * 60;

// read at call time, not import time, so a test (or a cold start) that sets the env late still works
const sbUrl = () => Deno.env.get('SUPABASE_URL') || '';
const sbKey = () => Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const adminHeaders = () => ({ apikey: sbKey(), Authorization: `Bearer ${sbKey()}`, 'Content-Type': 'application/json' });
const signInUrl = () => `${appBase()}/portal.html`;   // item 388: the app's address
const noStore = (cors: Record<string, string>) => ({ ...cors, 'Cache-Control': 'no-store' });
const refuse = (cors: Record<string, string>, status: number, body: Record<string, unknown>) => json(body, status, noStore(cors));
const notYet = (cors: Record<string, string>) => refuse(cors, 503, { error: 'unavailable', message: 'This needs a one-time database update first.' });

interface AuthUser { id: string; email: string; factors: Array<{ id: string; factor_type: string; status: string }> }
const userOf = (j: unknown): AuthUser | null => {
  const u = j && typeof j === 'object' ? j as Record<string, unknown> : null;
  if (!u || typeof u.id !== 'string' || !UUID_RE.test(u.id)) return null;
  const factors = (Array.isArray(u.factors) ? u.factors : []).map((f) => ({ id: String((f as any)?.id || ''), factor_type: String((f as any)?.factor_type || ''), status: String((f as any)?.status || '') }));
  return { id: u.id, email: String(u.email || '').trim().toLowerCase(), factors };
};

/** The auth ADMIN API (service role), each call best-effort and never throwing. Tests fake fetch. */
export const adminApi = {
  /** The person with this sign-in id, with their second-step factors. */
  async user(id: string): Promise<AuthUser | null> {
    try {
      const r = await fetch(`${sbUrl()}/auth/v1/admin/users/${encodeURIComponent(id)}`, { headers: adminHeaders() });
      return r.ok ? userOf(await r.json().catch(() => null)) : null;
    } catch { return null; }
  },
  /** The person whose sign-in email is exactly this one (the list's filter over-matches). */
  async userByEmail(email: string): Promise<AuthUser | null> {
    const want = String(email || '').trim().toLowerCase();
    if (!want) return null;
    try {
      const r = await fetch(`${sbUrl()}/auth/v1/admin/users?page=1&per_page=10&filter=${encodeURIComponent(want)}`, { headers: adminHeaders() });
      const j = r.ok ? await r.json().catch(() => null) : null;
      const list: unknown[] = Array.isArray(j?.users) ? j.users : Array.isArray(j) ? j : [];
      const hit = list.map(userOf).find((u) => u && u.email === want) || null;
      return hit;
    } catch { return null; }
  },
  /** Remove one factor. true when it is gone (a 404 counts: it is gone). */
  async deleteFactor(userId: string, factorId: string): Promise<boolean> {
    try {
      const r = await fetch(`${sbUrl()}/auth/v1/admin/users/${encodeURIComponent(userId)}/factors/${encodeURIComponent(factorId)}`, { method: 'DELETE', headers: adminHeaders() });
      return r.ok || r.status === 404;
    } catch { return false; }
  },
};

/** The person's authenticator-app factors (verified or not: a half-set-up one goes too). Pure. */
export function totpFactors(u: AuthUser | null | undefined): string[] {
  return (u?.factors || []).filter((f) => f.factor_type === 'totp' && f.id).map((f) => f.id);
}
/** Remove every authenticator-app factor; false when any stayed. */
async function removeTotp(u: AuthUser): Promise<{ removed: number; ok: boolean }> {
  const ids = totpFactors(u);
  let removed = 0, ok = true;
  for (const id of ids) { if (await adminApi.deleteFactor(u.id, id)) removed++; else ok = false; }
  return { removed, ok };
}

const rows = (r: { ok: boolean; json: unknown }) => (r.ok && Array.isArray(r.json) ? r.json as Array<Record<string, any>> : []);

/** The email, as the brand it should carry: a studio's when the person is a studio's client
 *  (the bridge's link, as lib/service_bridge.ts resolves it), else the platform default. */
export async function brandForUser(uid: string, email: string): Promise<{ brand: EmailBrand; studioSiteId: string | null; clientId: string | null; siteId: string | null }> {
  const out = { brand: EMAIL_BRAND_DEFAULT, studioSiteId: null as string | null, clientId: null as string | null, siteId: null as string | null };
  try {
    const c = rows(await svc(`contacts?auth_user_id=eq.${encodeURIComponent(uid)}&select=id&limit=1`))[0];
    const byContact = c?.id ? rows(await svc(`clients?contact_id=eq.${encodeURIComponent(String(c.id))}&select=id&limit=1`))[0] : null;
    const byEmail = !byContact && email ? rows(await svc(`clients?or=(email.eq.${encodeURIComponent(email)},contact_email.eq.${encodeURIComponent(email)})&select=id&limit=1`))[0] : null;
    const clientId = String((byContact || byEmail)?.id || '') || null;
    out.clientId = clientId;
    if (clientId) {
      const site = rows(await svc(`presence_sites?client_id=eq.${encodeURIComponent(clientId)}&select=id&order=created_at.asc&limit=1`))[0];
      out.siteId = site?.id ? String(site.id) : null;
      const link = (await linksForCustomer(clientId))[0];
      if (link?.agency_site_id) { out.studioSiteId = String(link.agency_site_id); out.brand = await loadEmailBrand(out.studioSiteId); }
    }
  } catch { /* the default brand */ }
  return out;
}

async function sendOff(to: string, by: 'code' | 'studio', brand: EmailBrand, studioSiteId: string | null, at: string): Promise<boolean> {
  const { sendEmail } = await import('../commerce/account.ts');   // lazy: account pulls in the email shell
  const mail = offEmail(by, { at, studio: brand.name !== EMAIL_BRAND_DEFAULT.name ? brand.name : '', signInUrl: signInUrl() });
  const asBusiness = !!studioSiteId && brand.name !== EMAIL_BRAND_DEFAULT.name;
  return await sendEmail(to, mail.subject, mail.html, brand, { critical: true, asBusiness, ...(asBusiness ? { siteId: studioSiteId! } : {}) }).catch(() => false);
}

// ═══ GET /auth/backup-codes ═══════════════════════════════════════════════════
export async function handleBackupCodesGet(principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (!principal.userId) return refuse(cors, 401, { error: 'unauthorized', message: 'Please sign in again.' });
  const r = await svc(`${TABLE}?user_id=eq.${encodeURIComponent(principal.userId)}&select=used_at,created_at&limit=100`);
  if (!r.ok) return r.status === 404 ? notYet(cors) : refuse(cors, 502, { error: 'unavailable', message: 'We couldn’t read your backup codes just now. Try again in a moment.' });
  return json({ data: setSummary(rows(r)) }, 200, noStore(cors));
}

// ═══ POST /auth/backup-codes ══════════════════════════════════════════════════
export async function handleBackupCodesSave(req: Request, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (!principal.userId) return refuse(cors, 401, { error: 'unauthorized', message: 'Please sign in again.' });
  let b: { hashes?: unknown; salt?: unknown } = {}; try { b = await req.json(); } catch { b = {}; }
  if (!isHashList(b.hashes) || !isSalt(b.salt)) return refuse(cors, 422, { error: 'bad_codes', message: `Send ${CODE_COUNT} different code hashes and the salt they were made with.` });
  const user = await adminApi.user(principal.userId);
  if (!user) return refuse(cors, 502, { error: 'unavailable', message: 'We couldn’t check your sign-in just now. Try again in a moment.' });
  if (!appFactor(user)) return refuse(cors, 409, { error: 'two_step_off', message: 'Turn on two-step sign-in first; backup codes go with it.' });
  const site = principal.jwt ? await resolveSite(principal.jwt).catch(() => null) : null;
  const created_at = new Date().toISOString();
  // the old set goes first: a replaced code never works again
  const gone = await svc(`${TABLE}?user_id=eq.${encodeURIComponent(principal.userId)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (!gone.ok) return gone.status === 404 ? notYet(cors) : refuse(cors, 502, { error: 'unavailable', message: 'We couldn’t save your backup codes just now. Nothing changed. Try again in a moment.' });
  const ins = await svc(TABLE, { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(b.hashes.map((code_hash) => ({ user_id: principal.userId, site_id: site?.id || null, code_hash, salt: b.salt, created_at }))) });
  if (!ins.ok) return refuse(cors, 502, { error: 'unavailable', message: 'We couldn’t save your backup codes just now. Make a new set and try again.' });
  return json({ data: { count: CODE_COUNT, created_at } }, 200, noStore(cors));
}

// ═══ POST /auth/backup-codes/use  (public) ════════════════════════════════════
/** One answer for an unknown email, a wrong code, a used code and an account with none. */
const REFUSED = { ok: false, error: 'backup_code_refused', message: 'That didn’t work. Check the email address and the code, and try again.' };

export async function handleBackupCodeUse(req: Request, cors: Record<string, string>): Promise<Response> {
  let b: { email?: unknown; code?: unknown } = {}; try { b = await req.json(); } catch { b = {}; }
  const email = String(b.email ?? '').trim().toLowerCase();
  const code = normalizeCode(b.code);
  if (!email || !email.includes('@') || email.length > 254) return refuse(cors, 400, { error: 'bad_request', message: 'Say the email address you sign in with.' });
  if (!code) return refuse(cors, 400, { error: 'bad_request', message: 'A backup code is 8 letters and numbers, like ABCD-EFGH.' });
  if (!(await rateAllowBoth({ bucket: `backup:email:${email}`, max: USE_PER_EMAIL }, { bucket: `backup:ip:${clientIp(req)}`, max: USE_PER_IP }, USE_WINDOW_SEC))) return tooMany(cors, USE_WINDOW_SEC);

  const user = await adminApi.userByEmail(email);
  if (!user) return refuse(cors, 403, REFUSED);
  const r = await svc(`${TABLE}?user_id=eq.${encodeURIComponent(user.id)}&used_at=is.null&select=id,code_hash,salt,used_at&limit=100`);
  if (!r.ok) return r.status === 404 ? notYet(cors) : refuse(cors, 502, { error: 'unavailable', message: 'We couldn’t check that just now. Try again in a moment.' });
  const unused = rows(r) as Array<{ id: string; code_hash: string; salt: string; used_at: string | null }>;
  // one hash per salt (a set shares one), then every row compared in constant time
  const hashes = new Map<string, string>();
  for (const row of unused) { const s = String(row.salt || ''); if (!hashes.has(s)) hashes.set(s, await codeHash(code, s)); }
  const hit = matchRow(unused, (s) => hashes.get(s) || '', (row) => String(row.salt || ''));
  if (!hit) return refuse(cors, 403, REFUSED);

  // used once: only the row still unused is marked, so two requests with the same code can't both win
  const at = new Date().toISOString();
  const used = await svc(`${TABLE}?id=eq.${encodeURIComponent(hit.id)}&used_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ used_at: at }) });
  if (!used.ok || !rows(used).length) return refuse(cors, 403, REFUSED);

  const off = await removeTotp(user);
  if (!off.ok) {
    // the second step is still there: give the code back rather than burn it
    await svc(`${TABLE}?id=eq.${encodeURIComponent(hit.id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ used_at: null }) }).catch(() => null);
    return refuse(cors, 502, { error: 'unavailable', message: 'We couldn’t turn off two-step sign-in just now. Nothing changed; your code still works. Try again in a moment.' });
  }
  // the rest of the set goes with the second step it belonged to (a new set comes with the next one)
  await svc(`${TABLE}?user_id=eq.${encodeURIComponent(user.id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => null);

  const who = await brandForUser(user.id, user.email || email);
  const emailed = await sendOff(user.email || email, 'code', who.brand, who.studioSiteId, at);
  if (who.siteId) {
    const actor: Principal = { kind: 'client', userId: user.id, tenantId: null, role: 'client', email: user.email || email, jwt: null, requestId: crypto.randomUUID() };
    await writeChangeEvent({ siteId: who.siteId, entityType: 'site', entityId: who.siteId, action: 'update', summary: offSummary('code', maskEmail(user.email || email)), principal: actor, provenance: 'human' }).catch(() => false);
  }
  return json({ ok: true, emailed, message: 'Two-step sign-in is off. Sign in with your password, then turn it back on from Settings to get new backup codes.' }, 200, noStore(cors));
}

// ═══ POST /agency/clients/:site/two-step/off  (studio owner, fresh code) ══════
export async function handleTwoStepOff(req: Request, member: AgencyMember, principal: Principal, clientSiteId: string, studioSiteId: string | null, cors: Record<string, string>): Promise<Response> {
  if (member.role !== 'owner') return refuse(cors, 403, { error: 'forbidden', message: 'Only the studio’s owner can turn off a client’s two-step sign-in.' });
  const siteId = String(clientSiteId || '').toLowerCase();
  if (!UUID_RE.test(siteId)) return refuse(cors, 400, { error: 'bad_request', message: 'Say which client.' });
  if (!(await isActiveClient(member.agency_id, siteId))) return refuse(cors, 404, { error: 'not_found', message: 'That isn’t one of your clients.' });

  // who signs in for this client's site
  const site = rows(await svc(`presence_sites?id=eq.${siteId}&select=id,client_id&limit=1`))[0];
  const client = site?.client_id ? rows(await svc(`clients?id=eq.${encodeURIComponent(String(site.client_id))}&select=id,name,email,contact_email,contact_id&limit=1`))[0] : null;
  const contact = client?.contact_id ? rows(await svc(`contacts?id=eq.${encodeURIComponent(String(client.contact_id))}&select=id,auth_user_id&limit=1`))[0] : null;
  const uid = String(contact?.auth_user_id || '');
  if (!client || !UUID_RE.test(uid)) return refuse(cors, 409, { error: 'no_login', message: 'They don’t have a sign-in yet, so there is no two-step sign-in to turn off.' });
  const user = await adminApi.user(uid);
  if (!user) return refuse(cors, 502, { error: 'unavailable', message: 'We couldn’t read their sign-in just now. Try again in a moment.' });
  if (!totpFactors(user).length) return refuse(cors, 409, { error: 'no_two_step', message: 'They don’t have two-step sign-in on.' });

  let b: { fresh_code?: unknown; fresh_jwt?: unknown } = {}; try { b = await req.json(); } catch { b = {}; }
  const name = String(client.name || '').trim() || user.email || 'this client';
  const fresh = await requireFresh(principal, b, TWO_STEP_OFF_ACTION, name, cors);
  if (fresh instanceof Response) return fresh;

  const off = await removeTotp(user);
  if (!off.removed) return refuse(cors, 502, { error: 'unavailable', message: 'We couldn’t turn it off just now. Nothing changed. Try again in a moment.' });
  await svc(`${TABLE}?user_id=eq.${encodeURIComponent(user.id)}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => null);

  const at = new Date().toISOString();
  const to = user.email || String(client.email || client.contact_email || '').trim().toLowerCase();
  const brand = studioSiteId ? await loadEmailBrand(studioSiteId).catch(() => EMAIL_BRAND_DEFAULT) : EMAIL_BRAND_DEFAULT;
  const emailed = to ? await sendOff(to, 'studio', brand, studioSiteId, at) : false;
  await writeChangeEvent({ siteId, entityType: 'site', entityId: siteId, action: 'update', summary: offSummary('studio', maskEmail(to || user.id)), principal, provenance: 'human' }).catch(() => false);
  return json({ data: { site_id: siteId, removed: off.removed, all_removed: off.ok, emailed, email: to ? maskEmail(to) : '', confirmed_with: fresh.way } }, 200, noStore(cors));
}
