// ── Transfer ownership (builder list item 53, Nov 2026) ──────────────────────
// On the site (after the site is resolved, so the owner or the studio inside it):
//   POST /portal/transfer          { email, keep_owner } start a handover
//   POST /portal/transfer/cancel   stop the open one
// For the person an email reached (before any site is resolved: the new owner has
// no site here yet):
//   GET  /transfers                the requests waiting on me
//   POST /transfers/:id/agree      the owner agrees to a request their studio started
//   POST /transfers/:id/accept     the new owner accepts, and the site is theirs
//   POST /transfers/:id/decline    either of them says no
// The rules are pure in lib/site_transfer.ts; the People sheet reads the open request
// with the people (GET /portal/members).
import { json } from '../../_shared/http.ts';
import type { Principal } from '../../_shared/auth.ts';
import type { SiteRow } from '../lib/site.ts';
import { svc } from '../lib/db.ts';
import { resolveSiteRoleCached } from '../lib/workspace.ts';
import { resolveAgencyMember, can } from '../agency/auth.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import {
  starterSide, startRefusal, START_WORDS, transferSummary, transferStep, ownerWho, ownerFacts, ownerEmailsOf, hasOwnerFacts,
  ownsAnother, openTransfer, createTransfer, moveTransfer, handOver, transferById, transfersWaitingOn, businessName,
  emailNextStep, emailOutcome,
} from '../lib/site_transfer.ts';
import type { TransferRow } from '../lib/site_transfer.ts';

const lower = (s: unknown) => String(s ?? '').trim().toLowerCase();
const NEEDS_DB = 'Handing a site over needs a one-time database update first (APPLY-0177).';

/** Which side the caller would start or stop a handover from, or null. */
async function sideOf(jwt: string, site: SiteRow, principal: Principal): Promise<{ side: 'owner' | 'studio' | null; studio: string }> {
  const role = await resolveSiteRoleCached(principal, jwt, site.id);
  let studioCanManage = false, studio = '';
  if (principal.scope) {
    const am = await resolveAgencyMember(jwt).catch(() => null);
    studioCanManage = !!am && can(am.role, 'manage_clients');
    studio = am?.agency_name || '';
  }
  return { side: starterSide({ scoped: !!principal.scope, studioCanManage, kind: principal.kind, seated: !!principal.member, role }), studio };
}

/** For the People sheet: whether this caller may start a transfer, and from which side. */
export async function transferSideFor(jwt: string, site: SiteRow, principal: Principal): Promise<'owner' | 'studio' | null> {
  return (await sideOf(jwt, site, principal)).side;
}

/** The studio a site works with, for a request's words ("Bright Studio asks…"). */
async function studioNameOf(siteId: string): Promise<string> {
  try {
    const link = (await svc(`presence_agency_clients?site_id=eq.${siteId}&select=agency_id&limit=1`)).json?.[0];
    if (!link?.agency_id) return '';
    const ag = (await svc(`presence_agencies?id=eq.${link.agency_id}&select=name&limit=1`)).json?.[0];
    return String(ag?.name || '').trim();
  } catch { return ''; }
}

export async function handleTransferStart(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const now = new Date().toISOString();
  const { side, studio } = await sideOf(jwt, site, principal);
  if (!side) return json({ error: 'forbidden', message: 'Only the owner can hand this site to someone else. Their studio can ask them to.' }, 403, cors);
  let b: { email?: unknown; keep_owner?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
  const to = lower(b.email).slice(0, 254);
  const keepOld = b.keep_owner !== false;
  const facts = await ownerFacts(site.id);
  const owners = ownerEmailsOf(facts);
  const open = await openTransfer(site.id, now);
  if (open.missing) return json({ error: 'unavailable', message: NEEDS_DB }, 503, cors);
  const clientId = facts?.client?.id || '';
  let refusal = startRefusal({ toEmail: to, ownerEmails: owners, hasOwner: hasOwnerFacts(facts) && owners.length > 0, open: !!open.row, ownsAnother: false });
  if (!refusal && await ownsAnother(to, null, clientId)) refusal = 'owns_another';
  if (refusal) { const [status, message] = START_WORDS[refusal]; return json({ error: refusal, message }, status, cors); }
  const made = await createTransfer({ siteId: site.id, clientId, fromEmail: owners[0], toEmail: to, keepOld, startedBy: principal.email || '', side }, now);
  if (!made.row) {
    if (made.error === 'already_open') { const [status, message] = START_WORDS.already_open; return json({ error: 'already_open', message }, status, cors); }
    return made.error === 'unavailable' ? json({ error: 'unavailable', message: NEEDS_DB }, 503, cors) : json({ error: 'write_failed', message: 'That didn’t save. Please try again.' }, 502, cors);
  }
  const business = await businessName(site.id);
  const owner = ownerWho(facts?.client, facts?.contact?.name);
  const emailed = await emailNextStep(made.row, { business, studio: studio || await studioNameOf(site.id), ownerName: owner?.name });
  await writeChangeEvent({ siteId: site.id, entityType: 'site', entityId: site.id, action: 'update', summary: side === 'studio' ? `Asked the owner to hand the site to ${to}` : `Started handing the site to ${to}`, principal, provenance: 'human' }).catch(() => {});
  const who = side === 'studio' ? (owner?.name || owners[0]) : to;
  const message = emailed
    ? (side === 'studio' ? `We’ve emailed ${who} to agree. Then ${to} gets an email to accept.` : `We’ve emailed ${to} to accept. Nothing changes until they do.`)
    : `It’s waiting, but the email to ${who} didn’t send. Try Stop and start again in a moment.`;
  return json({ data: { transfer: transferSummary(made.row, now), emailed, message } }, 201, cors);
}

export async function handleTransferCancel(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const now = new Date().toISOString();
  const { side } = await sideOf(jwt, site, principal);
  if (!side) return json({ error: 'forbidden', message: 'Only the owner or their studio can stop a transfer.' }, 403, cors);
  const open = await openTransfer(site.id, now);
  if (open.missing) return json({ error: 'unavailable', message: NEEDS_DB }, 503, cors);
  if (!open.row) return json({ error: 'not_found', message: 'No transfer is waiting on this site.' }, 404, cors);
  const t = open.row;
  if (!(await moveTransfer(t, 'cancelled', principal.email || '', now))) return json({ error: 'changed', message: 'It was answered a moment ago. Refresh to see where it stands.' }, 409, cors);
  const business = await businessName(site.id);
  const asked = t.status === 'asked_owner' ? t.from_email : t.to_email;
  await emailOutcome(asked, site.id, `The transfer of ${business} was stopped`, `The request to hand ${business} to ${t.to_email} was stopped, so nothing changes. You don’t need to do anything.`);
  await writeChangeEvent({ siteId: site.id, entityType: 'site', entityId: site.id, action: 'update', summary: `Stopped handing the site to ${t.to_email}`, principal, provenance: 'human' }).catch(() => {});
  return json({ data: { cancelled: true, message: 'Stopped. Nothing changed.' } }, 200, cors);
}

/** What one request looks like to the person it waits on (transfer.html). */
async function viewOf(t: TransferRow, email: string, nowIso: string) {
  const [business, facts, studio] = await Promise.all([businessName(t.site_id), ownerFacts(t.site_id), t.started_side === 'studio' ? studioNameOf(t.site_id) : Promise.resolve('')]);
  const owner = ownerWho(facts?.client, facts?.contact?.name);
  return {
    id: t.id, business, step: transferStep(t, email, nowIso), status: t.status, started_side: t.started_side, studio,
    owner_name: owner?.name || t.from_email, from_email: t.from_email, to_email: t.to_email, keep_old: !!t.keep_old, expires_at: t.expires_at,
  };
}

export async function handleTransfersMine(principal: Principal, cors: Record<string, string>) {
  const email = lower(principal.email);
  if (!email || !principal.userId) return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
  const now = new Date().toISOString();
  const rows = await transfersWaitingOn(email, now);
  if (rows === null) return json({ error: 'unavailable', message: 'We couldn’t check just now. Please try again in a moment.' }, 503, cors);
  return json({ data: await Promise.all(rows.map((t) => viewOf(t, email, now))) }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

export async function handleTransferAnswer(req: Request, id: string, verb: 'agree' | 'accept' | 'decline', principal: Principal, cors: Record<string, string>) {
  const email = lower(principal.email);
  if (!email || !principal.userId) return json({ error: 'unauthorized', message: 'Please sign in.' }, 401, cors);
  const now = new Date().toISOString();
  const t = await transferById(id);
  const step = t ? transferStep(t, email, now) : null;
  // a request that isn't waiting on this person reads the same as one that doesn't exist
  if (!t || !step) return json({ error: 'not_found', message: 'Nothing here is waiting on you. It may have been answered, stopped, or have lapsed.' }, 404, cors);
  if ((verb === 'agree' || verb === 'accept') && verb !== step) return json({ error: 'wrong_step', message: verb === 'accept' ? 'The owner hasn’t agreed yet.' : 'This is waiting on the new owner now.' }, 409, cors);
  const business = await businessName(t.site_id);

  if (verb === 'decline') {
    if (!(await moveTransfer(t, 'declined', email, now))) return json({ error: 'changed', message: 'It changed a moment ago. Refresh to see where it stands.' }, 409, cors);
    const who = step === 'agree' ? 'The owner' : t.to_email;
    const tell = [...new Set([lower(t.started_by), step === 'accept' ? lower(t.from_email) : ''].filter((e) => e && e !== email))];
    for (const to of tell) await emailOutcome(to, t.site_id, `${business} stays with its owner`, `${who} said no to handing ${business} to ${t.to_email}, so nothing changes.`);
    await writeChangeEvent({ siteId: t.site_id, entityType: 'site', entityId: t.site_id, action: 'update', summary: `${step === 'agree' ? 'The owner' : 'The new owner'} said no to the transfer`, principal, provenance: 'human' }).catch(() => {});
    return json({ data: { status: 'declined', message: 'Done. Nothing changes.' } }, 200, cors);
  }

  if (verb === 'agree') {
    if (!(await moveTransfer(t, 'asked_new', email, now))) return json({ error: 'changed', message: 'It changed a moment ago. Refresh to see where it stands.' }, 409, cors);
    const facts = await ownerFacts(t.site_id);
    const emailed = await emailNextStep({ ...t, status: 'asked_new' }, { business, ownerName: ownerWho(facts?.client, facts?.contact?.name)?.name });
    await writeChangeEvent({ siteId: t.site_id, entityType: 'site', entityId: t.site_id, action: 'update', summary: `The owner agreed to hand the site to ${t.to_email}`, principal, provenance: 'human' }).catch(() => {});
    return json({ data: { status: 'asked_new', emailed, message: emailed ? `Thanks. We’ve emailed ${t.to_email} to accept. Nothing changes until they do.` : `Thanks. The email to ${t.to_email} didn’t send; your studio can send it again.` } }, 200, cors);
  }

  const done = await handOver(t, { userId: String(principal.userId), email }, now);
  if (!done.ok) {
    const words: Record<string, [number, string]> = {
      owns_another: [409, 'You already own a business here, and one sign-in can own one. Ask for a Co-owner place instead: you can switch between both.'],
      owner_changed: [409, 'The owner changed since this was sent, so it can’t go ahead. Ask them to start it again.'],
      gone: [404, 'This website isn’t here any more.'],
      not_open: [409, 'It changed a moment ago. Refresh to see where it stands.'],
      write_failed: [502, 'That didn’t go through. Nothing changed; please try again.'],
    };
    const [status, message] = words[done.error] || words.write_failed;
    return json({ error: done.error, message }, status, cors);
  }
  const keepWords = t.keep_old ? 'You stay on as Co-owner.' : 'You no longer have access to it.';
  await emailOutcome(t.from_email, t.site_id, `${t.to_email} now owns ${business}`, `${t.to_email} accepted, so they own ${business} now. ${keepWords}`);
  if (lower(t.started_by) && lower(t.started_by) !== lower(t.from_email)) await emailOutcome(t.started_by, t.site_id, `${business} has a new owner`, `${t.to_email} accepted and owns ${business} now. Your studio keeps working on it as before.`);
  await writeChangeEvent({ siteId: t.site_id, entityType: 'site', entityId: t.site_id, action: 'update', summary: `${t.to_email} accepted and owns the site now`, principal, provenance: 'human' }).catch(() => {});
  return json({ data: { status: 'done', site_id: t.site_id, business, message: `${business} is yours now.` } }, 200, cors);
}

