// ── Handing a site to a new owner (builder list item 53, Nov 2026) ───────────
// Wix's model: the client owns the site, and the studio works on it with a role.
// The owner is the person the client record names (clients.email, contact_email,
// contact_id → contacts.auth_user_id: the chain my_client_ids() follows), so a
// transfer changes that person and nothing else. The pages, the plan, the people
// and the studio's link all stay with the business.
//
// A transfer is a request first (presence_site_transfers, migration 0177):
//   • the owner starts it           → asked_new:   the new owner accepts;
//   • the studio starts it for them → asked_owner: the owner agrees, then the new
//     owner accepts. A studio can't take a site away from its owner.
// Nothing changes until the new owner accepts, either side may stop it before
// then, and it lapses after TRANSFER_DAYS. One open request per site.
//
// Someone who already owns a business here can't take a second one yet: one login
// owns one client record (clients.email is unique, and an owner of two would land in
// either one, in no set order). They are added as a Co-owner instead and reach both
// through the business switch (item 83).
import { svc } from './db.ts';
import { TENANT_ID } from '../../_shared/auth.ts';
import { validEmail, findClientByEmail, pgrstQuoted, sendEmail } from '../commerce/account.ts';
import { loadEmailBrand, EMAIL_BRAND_DEFAULT } from './email_brand.ts';
import { mintSignInLink } from './workspace.ts';

export type TransferStatus = 'asked_owner' | 'asked_new' | 'done' | 'cancelled' | 'declined' | 'expired';
export type TransferSide = 'owner' | 'studio';
export interface TransferRow {
  id: string; site_id: string; client_id: string; from_email: string; to_email: string; keep_old: boolean;
  started_by: string; started_side: TransferSide; status: TransferStatus; expires_at: string; created_at?: string;
  decided_by?: string | null; decided_at?: string | null;
}
export const TRANSFER_DAYS = 14;
export const OPEN_STATUSES: readonly TransferStatus[] = ['asked_owner', 'asked_new'];
const COLS = 'id,site_id,client_id,from_email,to_email,keep_old,started_by,started_side,status,expires_at,created_at,decided_by,decided_at';

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const rowsOf = <T,>(q: { ok?: boolean; json?: unknown } | null | undefined): T[] => (q && q.ok !== false && Array.isArray(q.json) ? (q.json as T[]) : []);

/* ── the rules, pure ── */

/** The status as of now: an open request past its date has lapsed. Pure. */
export function liveStatus(t: Pick<TransferRow, 'status' | 'expires_at'>, nowIso: string): TransferStatus {
  if (OPEN_STATUSES.includes(t.status) && String(t.expires_at || '') <= nowIso) return 'expired';
  return t.status;
}

/** What this person may do with the request: the owner agrees to a request the studio
 *  started, the new owner accepts. Anyone else, or a closed request, gets nothing. Pure. */
export function transferStep(t: TransferRow, email: string, nowIso: string): 'agree' | 'accept' | null {
  const me = lower(email), status = liveStatus(t, nowIso);
  if (!me) return null;
  if (status === 'asked_owner' && me === lower(t.from_email)) return 'agree';
  if (status === 'asked_new' && me === lower(t.to_email)) return 'accept';
  return null;
}

/** Who may start a transfer, and on whose side. The studio inside the client, with a
 *  role that runs clients; or the owner themself: a client sign-in on their own site,
 *  not a seat (a Co-owner can do everything else, but the site isn't theirs to give).
 *  Platform staff are neither. Pure. */
export function starterSide(i: { scoped: boolean; studioCanManage: boolean; kind: string; seated: boolean; role: string }): TransferSide | null {
  if (i.scoped) return i.studioCanManage ? 'studio' : null;
  if (i.kind === 'client' && !i.seated && i.role === 'business_owner') return 'owner';
  return null;
}

export type StartRefusal = 'bad_email' | 'no_owner' | 'same_owner' | 'already_open' | 'owns_another';
/** Why a transfer to this email can't start, or null. Pure. */
export function startRefusal(i: { toEmail: string; ownerEmails: string[]; hasOwner: boolean; open: boolean; ownsAnother: boolean }): StartRefusal | null {
  const to = lower(i.toEmail);
  if (!validEmail(to)) return 'bad_email';
  if (!i.hasOwner) return 'no_owner';
  if (i.ownerEmails.map(lower).includes(to)) return 'same_owner';
  if (i.open) return 'already_open';
  if (i.ownsAnother) return 'owns_another';
  return null;
}

export const START_WORDS: Record<StartRefusal, [number, string]> = {
  bad_email: [400, 'That doesn’t look like an email address.'],
  no_owner: [409, 'This site has no owner yet. Invite the owner first; a transfer is for a site someone owns.'],
  same_owner: [409, 'That person already owns this site.'],
  already_open: [409, 'A transfer is already waiting on this site. Stop that one first.'],
  owns_another: [409, 'That person already owns a business here, and one sign-in can own one. Add them as a Co-owner instead: they can switch between both.'],
};

/** What the People sheet and a Sites card show of an open request. Pure. */
export function transferSummary(t: TransferRow | null | undefined, nowIso: string) {
  if (!t) return null;
  const status = liveStatus(t, nowIso);
  if (!OPEN_STATUSES.includes(status)) return null;
  return { id: t.id, to_email: t.to_email, from_email: t.from_email, status, started_side: t.started_side, keep_old: !!t.keep_old, expires_at: t.expires_at, created_at: t.created_at || null };
}

/** The owner as a person: their name when the contact holds one (a self-serve sign-up
 *  stores the business name there instead), else their email. Pure. */
export function ownerWho(c: { name?: string | null; email?: string | null; contact_email?: string | null } | null | undefined, contactName: string | null | undefined): { name: string; email: string } | null {
  const email = lower(c?.email) || lower(c?.contact_email);
  const name = String(contactName || '').trim();
  if (!email && !name) return null;
  const isBusiness = !!name && lower(name) === lower(c?.name);
  return { name: name && !isBusiness ? name : email, email };
}

/* ── reading ── */

export interface OwnerFacts { client: { id: string; name?: string | null; email?: string | null; contact_email?: string | null; contact_id?: string | null } | null; contact: { name?: string | null; email?: string | null; auth_user_id?: string | null } | null }
/** The site's client record and its owner's contact. Null fields when there is none. */
export async function ownerFacts(siteId: string): Promise<OwnerFacts | null> {
  const s = rowsOf<{ client_id: string | null }>(await svc(`presence_sites?id=eq.${siteId}&select=client_id&limit=1`))[0];
  if (!s) return null;
  if (!s.client_id) return { client: null, contact: null };
  const client = rowsOf<NonNullable<OwnerFacts['client']>>(await svc(`clients?id=eq.${s.client_id}&select=id,name,email,contact_email,contact_id&limit=1`))[0] || null;
  const contact = client?.contact_id ? rowsOf<NonNullable<OwnerFacts['contact']>>(await svc(`contacts?id=eq.${client.contact_id}&select=name,email,auth_user_id&limit=1`))[0] || null : null;
  return { client, contact };
}
export function ownerEmailsOf(f: OwnerFacts | null): string[] {
  return [...new Set([f?.client?.email, f?.client?.contact_email, f?.contact?.email].map(lower).filter(Boolean))];
}
export function hasOwnerFacts(f: OwnerFacts | null): boolean {
  return !!f?.client && !!(lower(f.client.email) || lower(f.client.contact_email) || f.client.contact_id);
}

/** When a sign-in last signed in, from GoTrue's admin API: null for never, undefined
 *  when it can't be told (no id, no keys, a failed read). */
export async function lastSignIn(authUserId: string | null | undefined): Promise<string | null | undefined> {
  const base = Deno.env.get('SUPABASE_URL') || '', key = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!authUserId || !base || !key) return undefined;
  try {
    const r = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(authUserId)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!r.ok) return undefined;
    const j = await r.json().catch(() => null);
    return j && j.last_sign_in_at ? String(j.last_sign_in_at) : null;
  } catch { return undefined; }
}

/** Does this person already own a business other than `exceptClientId`? By email, and
 *  by sign-in when known. A failed read answers true: the transfer waits rather than
 *  give one login two businesses. */
export async function ownsAnother(email: string, userId: string | null, exceptClientId: string): Promise<boolean> {
  try {
    const hit = await findClientByEmail(email);
    if (hit && hit.id !== exceptClientId) return true;
    if (!userId) return false;
    const contacts = await svc(`contacts?auth_user_id=eq.${encodeURIComponent(userId)}&select=id&limit=20`);
    if (!contacts.ok) return true;
    const ids = rowsOf<{ id: string }>(contacts).map((c) => c.id);
    if (!ids.length) return false;
    const owned = await svc(`clients?contact_id=in.(${ids.join(',')})&deleted_at=is.null&select=id&limit=5`);
    if (!owned.ok) return true;
    return rowsOf<{ id: string }>(owned).some((c) => c.id !== exceptClientId);
  } catch { return true; }
}

/** The site's open request. `missing` when the table isn't there yet (before 0177)
 *  or the read failed, so callers can say so instead of showing none. */
export async function openTransfer(siteId: string, nowIso: string): Promise<{ row: TransferRow | null; missing: boolean }> {
  const r = await svc(`presence_site_transfers?site_id=eq.${siteId}&status=in.(asked_owner,asked_new)&select=${COLS}&order=created_at.desc&limit=1`);
  if (!r.ok) return { row: null, missing: true };
  const row = rowsOf<TransferRow>(r)[0] || null;
  if (row && liveStatus(row, nowIso) === 'expired') {
    await svc(`presence_site_transfers?id=eq.${row.id}&status=eq.${row.status}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'expired' }) }).catch(() => null);
    return { row: null, missing: false };
  }
  return { row, missing: false };
}

/** Every open request across many sites (the Sites page), keyed by site. Empty on any failure. */
export async function openTransfersFor(siteIds: string[], nowIso: string): Promise<Record<string, ReturnType<typeof transferSummary>>> {
  const out: Record<string, ReturnType<typeof transferSummary>> = {};
  if (!siteIds.length) return out;
  const r = await svc(`presence_site_transfers?site_id=in.(${siteIds.join(',')})&status=in.(asked_owner,asked_new)&select=${COLS}&limit=1000`).catch(() => null);
  for (const t of rowsOf<TransferRow>(r)) { const s = transferSummary(t, nowIso); if (s) out[t.site_id] = s; }
  return out;
}

/** The open requests waiting on this person, as owner or as new owner (transfer.html). */
export async function transfersWaitingOn(email: string, nowIso: string): Promise<TransferRow[] | null> {
  const e = lower(email);
  if (!validEmail(e)) return [];
  const q = pgrstQuoted(e);
  const r = await svc(`presence_site_transfers?status=in.(asked_owner,asked_new)&or=(and(status.eq.asked_owner,from_email.eq.${q}),and(status.eq.asked_new,to_email.eq.${q}))&select=${COLS}&order=created_at.desc&limit=10`);
  if (!r.ok) return null;
  return rowsOf<TransferRow>(r).filter((t) => transferStep(t, e, nowIso) !== null);
}

export async function transferById(id: string): Promise<TransferRow | null> {
  return rowsOf<TransferRow>(await svc(`presence_site_transfers?id=eq.${id}&select=${COLS}&limit=1`))[0] || null;
}

/* ── changing it ── */

export async function createTransfer(t: { siteId: string; clientId: string; fromEmail: string; toEmail: string; keepOld: boolean; startedBy: string; side: TransferSide }, nowIso: string): Promise<{ row: TransferRow | null; error?: 'unavailable' | 'already_open' | 'write_failed' }> {
  const r = await svc('presence_site_transfers', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: t.siteId, client_id: t.clientId, from_email: lower(t.fromEmail), to_email: lower(t.toEmail), keep_old: !!t.keepOld,
      started_by: lower(t.startedBy).slice(0, 254), started_side: t.side, status: t.side === 'studio' ? 'asked_owner' : 'asked_new',
      expires_at: new Date(Date.parse(nowIso) + TRANSFER_DAYS * 86400000).toISOString(),
    }),
  });
  if (r.ok) return { row: rowsOf<TransferRow>(r)[0] || null };
  const text = String((r as { text?: string }).text || '');
  if (r.status === 409 || /presence_site_transfers_one_open|duplicate key/.test(text)) return { row: null, error: 'already_open' };
  if (r.status === 404 || /presence_site_transfers/.test(text)) return { row: null, error: 'unavailable' };
  return { row: null, error: 'write_failed' };
}

/** Move an open request on, only from the status it was read in (one answer wins). */
export async function moveTransfer(t: TransferRow, to: TransferStatus, by: string, nowIso: string): Promise<boolean> {
  const r = await svc(`presence_site_transfers?id=eq.${t.id}&status=eq.${t.status}&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: to, decided_by: lower(by).slice(0, 254), decided_at: nowIso }),
  });
  return r.ok && rowsOf(r).length > 0;
}

export type HandOverError = 'gone' | 'owner_changed' | 'owns_another' | 'not_open' | 'write_failed';
/** The change itself, when the new owner accepts. The request is claimed first, so two
 *  presses can't both land; the client record is changed only while it still names
 *  the owner who was asked; anything that fails before that undoes what came before. */
export async function handOver(t: TransferRow, caller: { userId: string; email: string; name?: string }, nowIso: string): Promise<{ ok: true } | { ok: false; error: HandOverError }> {
  const me = lower(caller.email);
  const facts = await ownerFacts(t.site_id);
  if (!facts?.client || facts.client.id !== t.client_id) return { ok: false, error: 'gone' };
  if (!ownerEmailsOf(facts).includes(lower(t.from_email))) return { ok: false, error: 'owner_changed' };
  if (await ownsAnother(me, caller.userId, t.client_id)) return { ok: false, error: 'owns_another' };
  if (!(await moveTransfer({ ...t, status: 'asked_new' }, 'done', me, nowIso))) return { ok: false, error: 'not_open' };
  const undoClaim = () => svc(`presence_site_transfers?id=eq.${t.id}&status=eq.done`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'asked_new', decided_by: null, decided_at: null }) }).catch(() => null);

  const ins = await svc('contacts', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name: (String(caller.name || '').trim() || me.split('@')[0]).slice(0, 120), email: me, auth_user_id: caller.userId, stage: 'active', tenant_id: TENANT_ID }),
  });
  const contactId = rowsOf<{ id: string }>(ins)[0]?.id;
  if (!contactId) { await undoClaim(); return { ok: false, error: 'write_failed' }; }
  const c = facts.client;
  const guard = [
    c.contact_id ? `contact_id=eq.${c.contact_id}` : 'contact_id=is.null',
    c.email ? `email=eq.${encodeURIComponent(String(c.email))}` : 'email=is.null',
  ].join('&');
  const w = await svc(`clients?id=eq.${c.id}&${guard}&select=id`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ email: me, contact_email: me, contact_id: contactId }),
  });
  if (!w.ok || !rowsOf(w).length) {
    await svc(`contacts?id=eq.${contactId}`, { method: 'DELETE' }).catch(() => null);
    await undoClaim();
    return { ok: false, error: w.status === 409 ? 'owns_another' : 'owner_changed' };
  }
  // An owner is no seat: a seat they held here would decide their role ahead of owning it.
  await svc(`presence_site_members?site_id=eq.${t.site_id}&or=(email.eq.${pgrstQuoted(me)},user_id.eq.${caller.userId})`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'revoked' }) }).catch(() => null);
  if (t.keep_old) {
    await svc('presence_site_members?on_conflict=site_id,email', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ site_id: t.site_id, email: lower(t.from_email), role: 'business_owner', status: 'active', invited_by: 'transfer' }),
    }).catch(() => null);
  }
  await svc(`presence_agency_clients?site_id=eq.${t.site_id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ owner_email: me }) }).catch(() => null);
  return { ok: true };
}

/* ── the emails ── */

const APP = () => (Deno.env.get('APP_URL') || 'https://app.davisdigitalstudio.com').replace(/\/$/, '');
const escHtml = (s: string) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));

export async function businessName(siteId: string): Promise<string> {
  const r = rowsOf<{ business_name?: string }>(await svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`).catch(() => null))[0];
  return String(r?.business_name || '').trim() || 'your business';
}

/** The email that asks the next person: the owner to agree, or the new owner to accept.
 *  Its link signs them in on transfer.html (an invite makes the new owner's sign-in). */
export async function emailNextStep(t: TransferRow, words: { business: string; studio?: string; ownerName?: string }): Promise<boolean> {
  const brand = await loadEmailBrand(t.site_id).catch(() => EMAIL_BRAND_DEFAULT);
  const step = t.status === 'asked_owner' ? 'agree' : 'accept';
  const to = step === 'agree' ? t.from_email : t.to_email;
  const link = await mintSignInLink(to, `/transfer.html?id=${t.id}`, APP()).catch(() => '');
  const href = link || `${APP()}/transfer.html?id=${t.id}`;
  const biz = escHtml(words.business);
  const btn = `display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none`;
  const keep = t.keep_old ? 'You stay on as Co-owner.' : 'You won’t have access afterwards.';
  const subject = step === 'agree'
    ? `${words.studio || 'Your studio'} asks to hand ${words.business} to someone else`
    : `${words.ownerName || 'The owner'} wants you to own ${words.business}`;
  const body = step === 'agree'
    ? `<p>${escHtml(words.studio || 'Your studio')} asks to make <strong>${escHtml(t.to_email)}</strong> the owner of <strong>${biz}</strong>.</p><p>They would sign in as the owner and decide who else gets in. The website, its pages and its plan stay as they are. ${keep}</p><p>Only you can agree, because you own ${biz}. If you didn’t expect this, say no and call your studio.</p><p class="cta"><a href="${href}" style="${btn}">See it and answer →</a></p>`
    : `<p>${escHtml(words.ownerName || 'The owner')} wants you to be the owner of <strong>${biz}</strong>.</p><p>Accepting makes you the owner of the website and its account. Nothing changes until you accept, and the request lapses on its own after ${TRANSFER_DAYS} days.</p><p class="cta"><a href="${href}" style="${btn}">See it and answer →</a></p>`;
  return sendEmail(to, subject, body + `<p style="color:#938ba3;font-size:13px;margin-top:10px">This link signs you in, so there’s no password to type.</p>`, brand, { critical: true }).catch(() => false);
}

/** A short note to someone when the request ends: done, stopped or turned down. */
export async function emailOutcome(to: string, siteId: string, subject: string, line: string): Promise<boolean> {
  if (!validEmail(lower(to))) return false;
  const brand = await loadEmailBrand(siteId).catch(() => EMAIL_BRAND_DEFAULT);
  return sendEmail(lower(to), subject, `<p>${escHtml(line)}</p>`, brand, { critical: true }).catch(() => false);
}
