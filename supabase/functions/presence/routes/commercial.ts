// ── /schedule/* · /forms/* · /approve/* — commercial V1 (Phase F) ────────────
// FD-1 scheduled publish/expiry · FD-2 lead capture · FD-3 one-tap approve.
// Reuses existing spines: the ONE publish pipeline, the CRM timeline, the
// approval decide logic. No new architecture.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import type { SiteRow } from '../lib/site.ts';
import { siteOrigin as siteAddress } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { getTemplate } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { insertSnapshot } from '../lib/draft_settings.ts';
import { sendEmail } from '../commerce/account.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';
import { ownerReplyTo } from '../lib/service_bridge.ts';
import { isStudioSide, studioDenied } from './projects.ts';
import { buildActivityDetail } from '../crm/deal_activity.ts';
import { decideWritePlan } from '../connected/writestore.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import {
  validateScheduleTime, isScheduleKind, validateSubmission, formParamsToSubmission,
  signApprovalToken, verifyApprovalToken, type ApprovalTokenPayload,
  leadFollowupResolvesOn, leadFollowupNoticeKey, enquiryAckCopy,
} from '../lib/commercial.ts';
import { validateBlocks } from '../lib/site_blocks.ts';
import { SIGNUP_CONSENT } from '../lib/site_send.ts';
import { validateFormValues, type FormDefinition } from '../lib/forms.ts';
import { notSentReason } from '../lib/legal_pages.ts';
import { enquiryState, customerEmails } from '../lib/enquiry_state.ts';
import { leadVisit } from '../lib/visit_source.ts';   // item 89
import { judgeSend, issueTicket, TICKET_MIN_AGE_S, markSender, spamLinkToken, readSpamLinkToken, SPAM_REASONS } from '../lib/form_check.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const APPROVAL_SECRET = Deno.env.get('APPROVAL_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '';
const siteBase = () => (Deno.env.get('SITE_URL') || 'https://presence.davisdigitalstudio.com').replace(/\/$/, '');
// the app's own address, where pages that answer an email's link live (spam.html, like unsubscribe.html)
const appBase = () => (Deno.env.get('APP_URL') || 'https://app.davisdigitalstudio.com').replace(/\/$/, '');

// ═══ FD-1 · Scheduled publish / revert (content expiry) ══════════════════════

export async function handleScheduleCreate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const now = new Date().toISOString();
  const when = validateScheduleTime(b?.scheduled_for, now);
  if (!when.ok) return json({ error: when.error, message: when.error === 'past' ? 'Pick a time in the future.' : 'That date doesn’t look right.' }, 400, cors);
  const kind = isScheduleKind(b?.kind) ? b.kind : 'publish';

  let snapshotId: string | null; let summary: string;
  if (kind === 'offline') {
    // G5 "unpublish at": no frozen snapshot — the holding page is rendered at
    // fire time (G10 takeSiteOffline) through the same deploy machinery.
    snapshotId = null;
    summary = String(b?.note || 'Scheduled to take the site offline');
  } else if (kind === 'revert') {
    // expiry: restore a chosen prior version at the scheduled time
    const pubId = String(b?.publish_id || '');
    const rec = await svc(`presence_publishes?id=eq.${encodeURIComponent(pubId)}&site_id=eq.${site.id}&select=snapshot_id&limit=1`);
    snapshotId = rec.json?.[0]?.snapshot_id;
    if (!snapshotId) return json({ error: 'bad_request', message: 'Choose a version to revert to.' }, 400, cors);
    summary = String(b?.note || 'Scheduled revert to an earlier version');
  } else {
    // publish: freeze the CURRENT draft into a snapshot now (WYSIWYG at schedule time)
    const t = getTemplate(site.template_slug, site.template_version);
    if (!t) return json({ error: 'template_missing', message: 'This site’s template isn’t available.' }, 500, cors);
    const { snapshot, mediaManifest, draftSettings } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now });
    const ins = await insertSnapshot({ site_id: site.id, content: snapshot.content, media_manifest: mediaManifest, content_contract_version: snapshot.content_contract_version, template_slug: snapshot.template_slug, template_version: snapshot.template_version, dev_customization: snapshot.dev_customization ?? null, created_by: principal.userId, created_by_kind: 'client' }, draftSettings);
    snapshotId = ins.json?.[0]?.id;
    if (!snapshotId) return json({ error: 'snapshot_failed', message: 'We couldn’t prepare that — please try again.' }, 502, cors);
    summary = String(b?.note || 'Scheduled publish');
  }

  const row = await svc('presence_scheduled_publishes', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, snapshot_id: snapshotId, kind, scheduled_for: when.iso, summary, created_by: principal.userId || 'owner' }),
  });
  if (!row.ok || !row.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  return json({ data: { ok: true, id: row.json[0].id, scheduled_for: when.iso, kind, message: `Scheduled for ${new Date(when.iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.` } }, 200, cors);
}

export async function handleScheduleList(site: SiteRow, cors: Record<string, string>) {
  const r = await svc(`presence_scheduled_publishes?site_id=eq.${site.id}&status=eq.pending&select=id,kind,scheduled_for,summary,created_at&order=scheduled_for.asc&limit=50`);
  return json({ data: { scheduled: Array.isArray(r.json) ? r.json : [] } }, 200, cors);
}

export async function handleScheduleCancel(site: SiteRow, id: string, principal: Principal, cors: Record<string, string>) {
  const r = await svc(`presence_scheduled_publishes?id=eq.${id}&site_id=eq.${site.id}&status=eq.pending`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'canceled' }),
  });
  return (r.ok && r.json?.[0]) ? json({ data: { ok: true, message: 'Canceled.' } }, 200, cors) : json({ error: 'not_found', message: 'Nothing scheduled to cancel.' }, 404, cors);
}

// ═══ FD-2 · Lead capture ═════════════════════════════════════════════════════

/** PUBLIC — a visitor on the customer's published site submits a form. Handled
 *  before the auth gate; resolves the site by id. Honeypot marks spam silently. */
export async function handleFormSubmit(req: Request, siteId: string, cors: Record<string, string>) {
  const ok200 = (msg: string, extra: Record<string, unknown> = {}) => json({ data: { ok: true, message: msg, ...extra } }, 200, cors); // always 200 to bots
  if (!/^[0-9a-f-]{36}$/.test(siteId)) return json({ error: 'not_found' }, 404, cors);

  // Phase V FD-N1: the published template posts a plain HTML form (urlencoded).
  // Accept both encodings; browser form posts get a 303 redirect to the site's
  // rendered thank-you page (works with no JS) instead of raw JSON.
  // Item 131: the page's own sender (lib/site_send.ts) posts the same form but asks
  // for an answer it can show in the page (Accept: application/json), so only a
  // plain post, with scripts off, is sent on to a page.
  const ctype = (req.headers.get('content-type') || '').toLowerCase();
  const isFormPost = ctype.includes('application/x-www-form-urlencoded') || ctype.includes('multipart/form-data');
  const toPage = isFormPost && !(req.headers.get('accept') || '').toLowerCase().includes('application/json');

  // Phase S / FD-M2: throttle the public submit — per-IP and per-site fixed windows.
  // A bot that ignores the honeypot is still capped; a real visitor is nowhere near it.
  // Item 131: a plain post over the limit lands on the site's "didn't send" page, not
  // on the server's raw answer at its own address.
  const rlIp = clientIp(req);
  if (!(await rateAllow(`forms:ip:${rlIp}`, 10, 60)) || !(await rateAllow(`forms:site:${siteId}`, 60, 60))) {
    if (toPage) {
      const s = await svc(`presence_sites?id=eq.${siteId}&select=id,client_id,custom_domain,netlify_site_id&limit=1`);
      const origin = s.json?.[0] ? siteAddress(s.json[0]) : '';
      if (origin) return new Response(null, { status: 303, headers: { ...cors, Location: `${origin}/not-sent/#ns-try_again` } });
    }
    return tooMany(cors);
  }
  let b: any = {};
  let rawMap: Record<string, string | string[]> = {};   // FB: full field map (keeps multi-value checkboxes)
  if (isFormPost) {
    try {
      const fd = await req.formData();
      for (const key of new Set(fd.keys())) { const all = fd.getAll(key).filter((x) => typeof x === 'string') as string[]; rawMap[key] = all.length > 1 ? all : (all[0] ?? ''); }
      b = formParamsToSubmission((k) => { const x = rawMap[k]; return typeof x === 'string' ? x : (Array.isArray(x) ? x[0] : null); });
    } catch { /* */ }
  } else {
    try { b = await req.json(); rawMap = (b && typeof b === 'object') ? b : {}; } catch { /* */ }
  }

  const site = await svc(`presence_sites?id=eq.${siteId}&select=id,client_id,custom_domain,netlify_site_id&limit=1`);
  if (!site.json?.[0]) return json({ error: 'not_found' }, 404, cors);
  const siteRow = site.json[0];
  const siteOrigin = siteAddress(siteRow);
  const redirectTo = (path: string) => new Response(null, { status: 303, headers: { ...cors, Location: /^https?:\/\//i.test(path) ? path : `${siteOrigin}${path}` } });
  // Item 62: a message that didn't send lands on the site's own "didn't send" page, which says
  // why and goes back to the form, where the browser still holds what was typed. A site
  // published before that page existed has none, so it gets its contact page as before.
  const notSent = async (error: string) => {
    try {
      const r = await fetch(`${siteOrigin}/not-sent/`, { method: 'HEAD', signal: AbortSignal.timeout(1500) });
      if (r.ok) return redirectTo(`/not-sent/#ns-${notSentReason(error)}`);
    } catch { /* falls back below */ }
    return redirectTo('/contact/');
  };

  // ── FB: a CUSTOM form (built in the Forms area) posts a `form_id`. Load its
  //    definition from the site's stored blocks (same JSON storage as content
  //    blocks — no new table), validate the typed values against it (re-running
  //    the whitelisted rules so hidden-field values can't be smuggled), then feed
  //    the SAME inbox + CRM + follow-up flow. The fixed contact form is untouched.
  // Item 146: the "Join our list" box posts here too, with form_kind=signup
  if (String((rawMap as any)?.form_kind ?? '') === 'signup') {
    const r = await joinList(siteId, rawMap as Record<string, unknown>);
    if (toPage && siteOrigin) return r.ok ? redirectTo('/thanks/') : await notSent(r.error);
    return r.ok ? ok200(JOINED) : json({ error: r.error, field: r.field, message: r.message }, r.error === 'write_failed' ? 502 : 400, cors);
  }

  const formId = String((rawMap as any)?.form_id ?? b?.form_id ?? '').trim();
  if (formId) {
    // A form can sit on the home page or on any of the owner's own pages.
    const settings = await svc(`presence_settings?site_id=eq.${siteId}&select=blocks,pages&limit=1`);
    const stored = settings.json?.[0];
    const lists = [stored?.blocks, ...(Array.isArray(stored?.pages) ? stored.pages.map((p: any) => p?.blocks) : [])];
    let def: FormDefinition | undefined;
    for (const list of lists) {
      def = validateBlocks(list).find((bl: any) => bl.type === 'form' && bl.id === formId) as FormDefinition | undefined;
      if (def) break;
    }
    if (!def) {   // unknown form — treat as a plain contact fallback (never leak internals)
      if (toPage && siteOrigin) return redirectTo('/contact/');
      return json({ error: 'not_found', message: 'That form is no longer available.' }, 404, cors);
    }
    const trap = !!String((rawMap as any)?._hp ?? b?._hp ?? '').slice(0, 100).trim();
    const fv = validateFormValues(def, rawMap as any);
    if (!fv.ok) {
      if (toPage && siteOrigin) return await notSent(fv.error);
      return json({ error: fv.error, field: fv.field, message: fv.error === 'need_contact' ? 'Leave an email or phone so they can reply.' : (fv.error === 'empty' ? 'Please fill in the form.' : fv.error) }, 400, cors);
    }
    // item 140: the time ticket, the words and the owner's marks (lib/form_check.ts)
    const why2 = await judgeSend(siteId, { trap, ticket: (rawMap as any)?._tk, email: fv.sub.email, name: fv.sub.name, message: fv.sub.message });
    const spam = !!why2;
    const ipHash2 = await hashIp(req);
    const src = String((rawMap as any)?.source_page ?? '').slice(0, 300);
    // item 131: a send that already arrived (a retry after no answer, a double tap) isn't stored twice
    if (!spam && await alreadyArrived(siteId, fv.sub)) return toPage && siteOrigin ? redirectTo(def.redirect_url || '/thanks/') : ok200(def.confirmation_text || FORM_THANKS, def.redirect_url ? { redirect: def.redirect_url } : {});
    const ins2 = await svc('presence_form_submissions?select=id', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: siteId, form_kind: def.kind, name: fv.sub.name, email: fv.sub.email, phone: fv.sub.phone, message: fv.sub.message, fields: why2 ? { ...fv.sub.values, __spam: { reason: why2 } } : fv.sub.values, source_page: src, spam, ip_hash: ipHash2 }),
    });
    if (!ins2.ok) {
      if (toPage && siteOrigin) return await notSent('try_again');
      return json({ error: 'write_failed', message: 'That didn’t send — please try again.' }, 502, cors);
    }
    if (!spam) { notifyOwnerOfLead(siteId, { id: String(ins2.json?.[0]?.id || ''), form_kind: def.kind, name: fv.sub.name, email: fv.sub.email, phone: fv.sub.phone, message: fv.sub.message }).catch(() => {}); acknowledgeEnquiry(siteId, { name: fv.sub.name, email: fv.sub.email }).catch(() => {}); }
    if (toPage && siteOrigin) return redirectTo(def.redirect_url || '/thanks/');
    // the page's sender goes on to the owner's own thank-you address when the form has one
    return ok200(def.confirmation_text || FORM_THANKS, def.redirect_url ? { redirect: def.redirect_url } : {});
  }

  const v = validateSubmission(b);
  if (!v.ok) {
    if (toPage && siteOrigin) return await notSent(v.error);   // browser `required` makes this rare
    return json({ error: v.error, message: v.error === 'bad_email' ? 'That email doesn’t look right.' : v.error === 'need_contact' ? 'Leave an email or phone so they can reply.' : 'Add a short message.' }, 400, cors);
  }
  const ipHash = await hashIp(req);
  // item 140: the time ticket, the words and the owner's marks (lib/form_check.ts)
  const why = await judgeSend(siteId, { trap: v.spam, ticket: (rawMap as any)?._tk, email: v.sub.email, name: v.sub.name, message: v.sub.message });

  if (!why && await alreadyArrived(siteId, v.sub)) return toPage && siteOrigin ? redirectTo('/thanks/') : ok200(FORM_THANKS);
  const ins = await svc('presence_form_submissions?select=id', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: siteId, form_kind: v.sub.form_kind, name: v.sub.name, email: v.sub.email, phone: v.sub.phone, message: v.sub.message, fields: why ? { ...v.sub.fields, __spam: { reason: why } } : v.sub.fields, source_page: v.sub.source_page, spam: !!why, ip_hash: ipHash }),
  });
  if (!ins.ok) {
    if (toPage && siteOrigin) return await notSent('try_again');
    return json({ error: 'write_failed', message: 'That didn’t send — please try again.' }, 502, cors);
  }
  if (!why) { notifyOwnerOfLead(siteId, { ...v.sub, id: String(ins.json?.[0]?.id || '') }).catch(() => {}); acknowledgeEnquiry(siteId, v.sub).catch(() => {}); } // best-effort, non-blocking
  if (toPage && siteOrigin) return redirectTo('/thanks/');       // spam included — bots see success
  return ok200(FORM_THANKS);
}

// ═══ Builder list item 146 · "Join our list" ═══
// The Newsletter section's box: an email and a consent tick, sent like a form (the time
// ticket and the spam checks of item 140 included). Whoever joins becomes a contact of
// the site with subscribed_at and a note of what they agreed to and where (migration
// 0157); Send an update's "People who joined your list" writes to them, and the
// unsubscribe link every update carries is how they leave. A robot is thanked and
// nothing is kept. Joining twice changes nothing, and a sign-up never lifts an
// unsubscribe: the one suppression list still decides who gets mail.
export const JOINED = 'You’re on the list. Thank you!';
async function joinList(siteId: string, raw: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string; field?: string; message: string }> {
  const typed = String(raw.email ?? '').trim().slice(0, 254);
  const email = typed.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'bad_email', field: 'email', message: 'That email doesn’t look right.' };
  if (String(raw.consent ?? '') !== 'yes') return { ok: false, error: 'consent', field: 'consent', message: 'Tick the box to say yes to emails.' };
  const trap = !!String(raw._hp ?? '').slice(0, 100).trim();
  if (await judgeSend(siteId, { trap, ticket: raw._tk, email, name: '', message: '' })) return { ok: true };
  const page = String(raw.source_page ?? '').replace(/[^\w\-./]/g, '').slice(0, 200) || '/';
  const patch = { subscribed_at: new Date().toISOString(), subscribed_note: `Joined on ${page}: “${SIGNUP_CONSENT}”` };
  // the contact, in either spelling the address may have been saved in
  const forms = [...new Set([email, typed])].map((e) => `email.eq."${e.replace(/"/g, '')}"`).join(',');
  const found = await svc(`presence_contacts?site_id=eq.${siteId}&deleted_at=is.null&or=(${encodeURIComponent(forms)})&select=id,subscribed_at&limit=1`);
  if (!found.ok) return { ok: false, error: 'write_failed', message: 'That didn’t go through. Please try again in a minute.' };
  let row = Array.isArray(found.json) ? found.json[0] : null;
  if (!row) {
    const ins = await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: siteId, email, name: '', ...patch }) });
    if (ins.ok && ins.json?.[0]) return { ok: true };
    if (ins.status !== 409) return { ok: false, error: 'write_failed', message: 'That didn’t go through. Please try again in a minute.' };
    // saved already in another mix of capitals: the unique index matched it, so find it the long way
    const all = await svc(`presence_contacts?site_id=eq.${siteId}&deleted_at=is.null&select=id,email,subscribed_at&limit=5000`);
    row = (Array.isArray(all.json) ? all.json : []).find((c: any) => String(c.email || '').toLowerCase() === email) || null;
    if (!row) return { ok: false, error: 'write_failed', message: 'That didn’t go through. Please try again in a minute.' };
  }
  if (row.subscribed_at) return { ok: true };   // on the list already
  const w = await svc(`presence_contacts?id=eq.${row.id}&site_id=eq.${siteId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return w.ok ? { ok: true } : { ok: false, error: 'write_failed', message: 'That didn’t go through. Please try again in a minute.' };
}

/** What the page's sender shows where the contact form was (the thank-you page's words). */
export const FORM_THANKS = 'Thank you, your message was sent. We’ll get back to you soon.';

/** Item 131: the same words from the same person to the same site in the last ten
 *  minutes already arrived. The page's sender gives up after 15 seconds with no answer
 *  and invites a second try, and a slow answer may still have stored the first. */
export const RESEND_WINDOW_MIN = 10;
async function alreadyArrived(siteId: string, sub: { email: string; phone: string; message: string }): Promise<boolean> {
  const who = sub.email ? `email=eq.${encodeURIComponent(sub.email)}` : (sub.phone ? `phone=eq.${encodeURIComponent(sub.phone)}` : '');
  if (!who || !sub.message) return false;
  const since = new Date(Date.now() - RESEND_WINDOW_MIN * 60_000).toISOString();
  const r = await svc(`presence_form_submissions?site_id=eq.${siteId}&${who}&created_at=gte.${since}&select=message&order=created_at.desc&limit=5`);
  return Array.isArray(r.json) && r.json.some((row: any) => String(row?.message ?? '') === sub.message);
}

/** The Enquiries queue answers the newest FORM_INBOX_PAGE; `more` says it was cut (bug hunt C15). */
export const FORM_INBOX_PAGE = 100;
export async function handleFormInbox(site: SiteRow, cors: Record<string, string>, req?: Request) {
  if (req && new URL(req.url).searchParams.get('spam') === '1') return handleSpamList(site, cors);
  // one past the page, so the queue can say when it stops short of every enquiry
  const r = await svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&select=id,form_kind,name,email,phone,message,source_page,status,created_at,fields&order=created_at.desc&limit=${FORM_INBOX_PAGE + 1}`);
  const all = Array.isArray(r.json) ? r.json : [];
  const more = all.length > FORM_INBOX_PAGE;
  const rows = all.slice(0, FORM_INBOX_PAGE);
  // P2-F G1 — link each website enquiry to the CRM deal it became (if any), so the
  // inbox can show "converted → view deal" and disable a second conversion. One
  // bounded query over the deals already linked by source_submission_id.
  const ids = rows.map((s: any) => s.id);
  const dealMap = new Map<string, string>();
  if (ids.length) {
    const dq = await svc(`presence_deals?site_id=eq.${site.id}&deleted_at=is.null&source_submission_id=in.(${ids.join(',')})&select=id,source_submission_id`);
    for (const d of (Array.isArray(dq.json) ? dq.json : [])) if (d.source_submission_id) dealMap.set(String(d.source_submission_id), String(d.id));
  }
  // C5: "In pipeline" only with a live deal; one marked converted with none left is a
  // Customer when the person became one (a contact linked to a client), else just seen
  const noDeal = rows.filter((s: any) => s.status === 'converted' && !dealMap.has(String(s.id)) && s.email);
  const customers = noDeal.length ? (await customerEmails(site.id, noDeal.map((s: any) => String(s.email)))) || new Set<string>() : new Set<string>();
  // item 89: where each enquiry's visitor came from, noted after they sent it (routes/visit_source.ts)
  const visits = new Map(rows.map((s: any) => [String(s.id), leadVisit(s.fields)]));
  // `fields` is read only for the studio's replies (fields.__studio_replies) — the raw
  // form values stay server-side as before; each row carries `replies` instead.
  const submissions = rows.map(({ fields, ...s }: any) => {
    const dealId = dealMap.get(String(s.id)) || null;
    return { ...s, replies: leadReplies(fields), note: leadNote(fields), deal_id: dealId, ...enquiryState(s.status, dealId, customers.has(String(s.email || '').trim().toLowerCase())) };
  });
  for (const s of submissions as any[]) s.visit = visits.get(String(s.id)) || null;
  return json({ data: { submissions, unread: submissions.filter((s: any) => s.status === 'new').length, more } }, 200, cors);
}

// ═══ Builder list item 140 · what the spam checks kept back, and why ═══
// The Inbox's enquiries gain a Spam filter: the last SPAM_DAYS of messages filed as
// spam, each with the reason in plain words and Not spam (POST /forms/inbox/:id
// { spam: false }), so a stricter check never loses a real customer's message.
export const SPAM_DAYS = 30;
export async function handleSpamList(site: SiteRow, cors: Record<string, string>) {
  const since = new Date(Date.now() - SPAM_DAYS * 86400_000).toISOString();
  const r = await svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.true&created_at=gte.${since}&select=id,form_kind,name,email,phone,message,source_page,status,created_at,fields&order=created_at.desc&limit=${FORM_INBOX_PAGE + 1}`);
  if (!r.ok) return json({ error: 'read_failed', message: 'Your spam couldn’t load just now. Try again in a moment.' }, 502, cors);
  const all = Array.isArray(r.json) ? r.json : [];
  const spam = all.slice(0, FORM_INBOX_PAGE).map(({ fields, ...row }: any) => ({ ...row, spam: true, spam_reason: SPAM_REASONS[String(fields?.__spam?.reason || '')] || SPAM_REASONS.owner }));
  return json({ data: { spam, days: SPAM_DAYS, more: all.length > FORM_INBOX_PAGE } }, 200, cors);
}

// ═══ Builder list item 140 · the ticket a site's page sends with a form or a booking ═══
/** PUBLIC (a visitor route): a signed, timed ticket for this site. Stateless, no read. */
export async function handleSendTicket(req: Request, siteId: string, cors: Record<string, string>) {
  if (!/^[0-9a-f-]{36}$/.test(siteId)) return json({ error: 'not_found' }, 404, cors);
  if (!(await rateAllow(`ticket:ip:${clientIp(req)}`, 30, 60))) return tooMany(cors);
  return json({ data: { ticket: await issueTicket(siteId, Math.floor(Date.now() / 1000)), wait_s: TICKET_MIN_AGE_S } }, 200, { ...cors, 'Cache-Control': 'no-store' });
}

// ═══ Builder list item 140 · "This was spam" from the owner's alert email ═══
// The link opens spam.html on the app's address (a function's own address can't show a
// page), which shows the message and asks first: mail scanners open links on their own,
// so the link itself changes nothing. Authorized by its signature alone, like an
// approval link; it names one message on one site.
async function spamLinkTarget(req: Request, token: unknown, cors: Record<string, string>): Promise<{ siteId: string; row: any } | Response> {
  if (!(await rateAllow(`spamlink:ip:${clientIp(req)}`, 30, 60))) return tooMany(cors);
  const t = await readSpamLinkToken(token);
  if (t === 'expired') return json({ error: 'expired', message: 'This link has expired. Open your Inbox to mark the message as spam there.' }, 410, cors);
  if (!t) return json({ error: 'bad_link', message: 'This link isn’t complete. Open your Inbox to mark the message as spam there.' }, 400, cors);
  const row = (await svc(`presence_form_submissions?id=eq.${t.submissionId}&site_id=eq.${t.siteId}&select=id,name,email,phone,message,spam,fields,created_at&limit=1`)).json?.[0];
  if (!row) return json({ error: 'not_found', message: 'That message isn’t there any more.' }, 404, cors);
  return { siteId: t.siteId, row };
}
export async function handleSpamLinkGet(req: Request, cors: Record<string, string>) {
  const hit = await spamLinkTarget(req, new URL(req.url).searchParams.get('t'), cors);
  if (hit instanceof Response) return hit;
  const r = hit.row;
  return json({ data: { who: r.name || r.email || r.phone || 'Someone', preview: String(r.message || '').slice(0, 280), spam: !!r.spam, at: r.created_at } }, 200, cors);
}
export async function handleSpamLinkPost(req: Request, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const hit = await spamLinkTarget(req, b?.t, cors);
  if (hit instanceof Response) return hit;
  const on = b?.undo !== true;
  const ok = await setSpam(hit.siteId, hit.row, on);
  if (!ok) return json({ error: 'write_failed', message: 'That didn’t go through. Try again in a moment.' }, 502, cors);
  return json({ data: { ok: true, spam: on } }, 200, cors);
}
/** Mark one message spam (the owner's own call) or not, and teach the site's memory. */
async function setSpam(siteId: string, row: { id: string; email?: string; fields?: unknown }, on: boolean): Promise<boolean> {
  const fields = { ...((row.fields && typeof row.fields === 'object') ? row.fields as Record<string, unknown> : {}) };
  if (on) fields.__spam = { reason: 'owner' }; else delete fields.__spam;
  const w = await svc(`presence_form_submissions?id=eq.${row.id}&site_id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ spam: on, fields }) });
  if (!(w.ok && w.json?.[0])) return false;
  if (row.email) await markSender(siteId, row.email, on).catch(() => {});
  if (on) {
    const k = leadFollowupNoticeKey(String(row.id));
    await svc(`presence_plan_notices?site_id=eq.${siteId}&kind=eq.${k.kind}&period=eq.${k.period}&status=eq.active`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }).catch(() => {});
  }
  return true;
}

// ═══ Oct 2026 workflow audit, change 5 · reply to a website enquiry from Studio OS ═══
// The reply used to be a mailto: — written in the owner's mail app, recorded nowhere.
// POST /forms/inbox/:id/reply { body } sends it through the ONE send point
// (sendEmail, the site's brand, reply-to = the site's inbound address), so:
//   · the person exists as a contact first (ensureLeadContact) — the inbound door
//     only lands mail from KNOWN senders, so their answer threads back into the Inbox;
//   · the enquiry is marked Replied (its follow-up nudge resolves, like any reply);
//   · the reply text is kept on the submission (fields.__studio_replies, newest last,
//     capped) — no new table — and, when the enquiry became a deal, logged on it as
//     an email activity, so the customer record's timeline shows the answer.
const LEAD_REPLY_MAX = 4000;
const LEAD_REPLIES_KEPT = 20;
export function leadReplies(fields: unknown): Array<{ body: string; at: string }> {
  const list = fields && typeof fields === 'object' ? (fields as any).__studio_replies : null;
  return Array.isArray(list) ? list.filter((r: any) => r && typeof r.body === 'string').map((r: any) => ({ body: String(r.body), at: String(r.at || '') })) : [];
}
// Sales review item 28 (Nov 2026): the studio's own note on an enquiry, before
// it is a deal ("called back, wants a quote in March"). Kept on the submission
// as fields.__studio_note — the same reserved-key pattern as __studio_replies,
// no new column — and never shown to the person who wrote in.
export const LEAD_NOTE_MAX = 1000;
export function leadNote(fields: unknown): { body: string; at: string } | null {
  const n = fields && typeof fields === 'object' ? (fields as any).__studio_note : null;
  return n && typeof n.body === 'string' && n.body.trim() ? { body: String(n.body), at: String(n.at || '') } : null;
}
export function leadReplyHtml(body: string, original: string): string {
  const paras = String(body).split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  const quoted = original ? `<p style="margin-top:18px;color:#6b6478;font-size:13px">You wrote:</p><blockquote style="margin:0;padding-left:12px;border-left:3px solid #e2dff0;color:#6b6478;font-size:13px">${esc(original).replace(/\n/g, '<br>')}</blockquote>` : '';
  return paras + quoted;
}
async function ensureLeadContact(siteId: string, email: string, name: string, phone: string): Promise<void> {
  const hit = await svc(`presence_contacts?site_id=eq.${siteId}&email=eq.${encodeURIComponent(email)}&deleted_at=is.null&select=id&limit=1`);
  if (Array.isArray(hit.json) && hit.json.length) return;
  await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: siteId, name: name || '', email, phone: phone || '' }) }).catch(() => {});
}
export async function handleFormReply(req: Request, jwt: string, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>) {
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const body = typeof b?.body === 'string' ? b.body.trim() : '';
  if (!body) return json({ error: 'empty', message: 'Write your reply first.' }, 400, cors);
  if (body.length > LEAD_REPLY_MAX) return json({ error: 'too_long', message: 'That reply is too long to send — keep it under 4,000 characters.' }, 400, cors);
  const sr = await svc(`presence_form_submissions?id=eq.${id}&site_id=eq.${site.id}&select=id,form_kind,name,email,phone,message,status,fields&limit=1`);
  const sub = Array.isArray(sr.json) ? sr.json[0] : null;
  if (!sub) return json({ error: 'not_found' }, 404, cors);
  const email = String(sub.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'no_email', message: 'They left no email address — there’s no way to reply by email.' }, 400, cors);
  // a studio sends a handful of these a day; this only stops a runaway loop
  if (!(await rateAllow(`lead-reply:${site.id}`, 60, 3600))) return json({ error: 'rate_limited', message: 'That’s a lot of replies in an hour — try again in a little while.' }, 429, cors);
  await ensureLeadContact(site.id, email, String(sub.name || ''), String(sub.phone || '')).catch(() => {});
  const kind = sub.form_kind === 'quote' ? 'quote request' : sub.form_kind === 'booking' ? 'booking request' : 'message';
  const brand = await loadEmailBrand(site.id);
  const sent = await sendEmail(email, `Re: your ${kind}`, leadReplyHtml(body, String(sub.message || '')), brand, { critical: true, siteId: site.id });
  if (!sent) return json({ error: 'not_sent', message: 'We couldn’t send that just now — nothing went out. Try again in a moment, or use your email app.' }, 503, cors);
  const at = new Date().toISOString();
  const fields = sub.fields && typeof sub.fields === 'object' ? sub.fields : {};
  const replies = leadReplies(fields).concat([{ body, at }]).slice(-LEAD_REPLIES_KEPT);
  const patch: Record<string, unknown> = { fields: { ...fields, __studio_replies: replies } };
  if (sub.status === 'new' || sub.status === 'read') patch.status = 'replied';
  await svc(`presence_form_submissions?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify(patch) }).catch(() => {});
  if (leadFollowupResolvesOn('replied')) {
    const k = leadFollowupNoticeKey(id);
    await svc(`presence_plan_notices?site_id=eq.${site.id}&kind=eq.${k.kind}&period=eq.${k.period}&status=eq.active`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }).catch(() => {});
  }
  // the enquiry became a deal → the answer shows on the customer record's timeline
  try {
    const dq = await svc(`presence_deals?site_id=eq.${site.id}&deleted_at=is.null&source_submission_id=eq.${id}&select=id&limit=1`);
    const dealId = Array.isArray(dq.json) && dq.json[0] ? String(dq.json[0].id) : '';
    if (dealId) await svc('presence_deal_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ deal_id: dealId, site_id: site.id, kind: 'note', actor: principal.email || principal.userId || 'system', actor_kind: principal.kind, detail: buildActivityDetail('email', body, at) }) });
  } catch { /* the timeline mirror is best-effort — the email went out */ }
  return json({ data: { sent: true, at, status: patch.status || sub.status } }, 200, cors);
}

/** The user-settable enquiry statuses (migration 0129). `converted` is system-set. */
export const ENQUIRY_STATUSES = ['new', 'read', 'replied', 'archived', 'not_a_fit'];
export async function handleFormStatus(req: Request, site: SiteRow, id: string, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  // Phase 4 (triage): New · Read · Replied · Not a fit (archived is the old name
  // for the same shelf) · Spam (the boolean). Only `new` counts as needs-you, so
  // every other mark takes the enquiry off Today, the bell and the Inbox at once.
  const spamFlag = typeof b?.spam === 'boolean' ? b.spam : null;
  // item 28: { note } alone saves the studio's note and leaves the status as it is
  // (a note on a Replied enquiry must not knock it back to Read)
  const noteOnly = typeof b?.note === 'string' && b?.status === undefined && spamFlag === null;
  const status = ENQUIRY_STATUSES.includes(b?.status) ? b.status : (spamFlag === null && !noteOnly ? 'read' : null);
  const patch: Record<string, unknown> = {};
  if (status) patch.status = status;
  if (spamFlag !== null) patch.spam = spamFlag;
  let email = '';
  if (typeof b?.note === 'string' || spamFlag !== null) {
    const cur = await svc(`presence_form_submissions?id=eq.${id}&site_id=eq.${site.id}&select=fields,email&limit=1`);
    const row = Array.isArray(cur.json) ? cur.json[0] : null;
    if (!row) return json({ error: 'not_found' }, 404, cors);
    email = String(row.email || '');
    const fields = { ...((row.fields && typeof row.fields === 'object') ? row.fields : {}) } as Record<string, unknown>;
    if (typeof b?.note === 'string') {
      const body = String(b.note).replace(/\r\n?/g, '\n').trim().slice(0, LEAD_NOTE_MAX);
      if (body) fields.__studio_note = { body, at: new Date().toISOString() }; else delete fields.__studio_note;
    }
    // item 140: the owner's own call says why it's in Spam, and Not spam clears the reason
    if (spamFlag === true) fields.__spam = { reason: 'owner' }; else if (spamFlag === false) delete fields.__spam;
    patch.fields = fields;
  }
  if (!Object.keys(patch).length) return json({ data: { ok: true } }, 200, cors);
  const r = await svc(`presence_form_submissions?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!(r.ok && r.json?.[0])) return json({ error: 'not_found' }, 404, cors);
  // item 140: more from an address marked as spam goes to Spam; Not spam forgets it
  if (spamFlag !== null && email) await markSender(site.id, email, spamFlag).catch(() => {});
  // PP-1: acting on the lead resolves its follow-up nudge — so Today's card, the
  // bell, and the attention badge (all reading active notices) drop it at once.
  // Keyed period=lead:<id>, this touches exactly this lead's notice, nothing else.
  if ((status && leadFollowupResolvesOn(status)) || spamFlag === true) {
    const k = leadFollowupNoticeKey(id);
    await svc(`presence_plan_notices?site_id=eq.${site.id}&kind=eq.${k.kind}&period=eq.${k.period}&status=eq.active`, {
      method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }),
    }).catch(() => {});
  }
  return json({ data: { ok: true } }, 200, cors);
}

// the IP hash an enquiry keeps; routes/visit_source.ts finds the enquiry a visitor just sent by it (item 89)
export async function hashIp(req: Request): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  if (!ip) return '';
  // salt fallback chain: never a guessable literal (an unset APPROVAL_SECRET
  // would have made IPv4 pre-images enumerable)
  const data = new TextEncoder().encode(ip + '|' + (APPROVAL_SECRET || Deno.env.get('SCHEDULER_SECRET') || Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || 'salt'));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** "Acknowledge new enquiries within a minute" (benchmark 2026-10, item 6):
 *  the FIRST switch. When the site has it on, the person who just wrote in gets
 *  ONE short email, right now, on the owner's brand, saying exactly the sentence
 *  Settings shows (enquiryAckCopy — pinned by test). Default OFF; no email on
 *  the enquiry → nothing to send; never blocks the submit. */
async function acknowledgeEnquiry(siteId: string, sub: { name: string; email: string }): Promise<boolean> {
  if (!sub.email) return false;
  const { automationSettingsFor } = await import('../commerce/lifecycle.ts');   // lazy: lifecycle pulls in the whole sweep
  const auto = await automationSettingsFor(siteId);
  if (!auto.auto_ack_enquiries) return false;
  const [ident, brand, replyTo] = await Promise.all([
    svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`),
    loadEmailBrand(siteId),
    ownerReplyTo(siteId),
  ]);
  const studio = String(ident.json?.[0]?.business_name || '').trim();
  const copy = enquiryAckCopy({ name: sub.name, studio: studio || brand.name });
  // Item 72: an answer to this reaches the owner's own email. Someone writing in for
  // the first time is no contact yet, so the site's inbound address (siteId, left as
  // the fallback) dropped their answer as a stranger's.
  return await sendEmail(sub.email, copy.subject, `<p>${esc(copy.sentence)}</p>${copy.footer ? `<p style="color:#6b6478;font-size:13px">${esc(copy.footer)}</p>` : ''}`, brand, { critical: true, siteId, replyTo });   // they wrote in; this is the reply they are waiting for
}

async function notifyOwnerOfLead(siteId: string, sub: { id?: string; form_kind: string; name: string; email: string; phone: string; message: string }) {
  const ident = await svc(`presence_identity?site_id=eq.${siteId}&select=business_name,email&limit=1`);
  const to = ident.json?.[0]?.email;
  if (!to) return;
  const who = [sub.name, sub.email, sub.phone].filter(Boolean).join(' · ');
  const brand = await loadEmailBrand(siteId);   // BR-1: on the owner's brand
  // item 140: one tap from the email files it as spam, and more from that address goes there too
  const tok = sub.id ? await spamLinkToken(siteId, sub.id) : '';
  const spamLine = tok ? `<p style="margin-top:14px;color:#6b6478;font-size:13px">Not a real customer? <a href="${appBase()}/spam.html?t=${encodeURIComponent(tok)}" style="color:#6b6478">This was spam</a>. It moves to Spam, and more from them goes there too.</p>` : '';
  await sendEmail(String(to), `New ${sub.form_kind} from your website`,
    `<p>Someone reached out through your website.</p><p><b>${esc(who)}</b></p><p>${esc(sub.message)}</p><p class="cta"><a href="${siteBase()}/crm.html" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">See it in your workspace →</a></p>${spamLine}`, brand);
}

// ═══ FD-3 · Approval → notify → one-tap approve ══════════════════════════════

/** AUTHED (owner/operator) — email the client a one-tap approve link for every
 *  pending approval on this site. */
export async function handleApproveSend(site: SiteRow, principal: Principal, cors: Record<string, string>) {
  if (!APPROVAL_SECRET) return json({ error: 'unavailable', message: 'One-tap approval isn’t configured on this environment yet.' }, 503, cors);
  const ident = await svc(`presence_identity?site_id=eq.${site.id}&select=business_name,email&limit=1`);
  const to = ident.json?.[0]?.email;
  if (!to) return json({ error: 'no_recipient', message: 'Add a business email first so we know where to send it.' }, 400, cors);

  const [infra, writes] = await Promise.all([
    svc(`presence_infra_plans?site_id=eq.${site.id}&status=eq.proposed&select=id,title,summary&limit=10`),
    svc(`presence_connection_writes?site_id=eq.${site.id}&status=eq.proposed&select=id,title,summary,provider_key&limit=10`),
  ]);
  const items = [
    ...(((infra.json ?? []) as any[]).map((p) => ({ kind: 'infrastructure' as const, id: p.id, title: p.title, summary: p.summary }))),
    ...(((writes.json ?? []) as any[]).map((p) => ({ kind: 'connected' as const, id: p.id, title: p.title, summary: p.summary }))),
  ];
  if (!items.length) return json({ data: { ok: true, sent: 0, message: 'Nothing is waiting for approval.' } }, 200, cors);

  const brand = await loadEmailBrand(site.id);   // BR-1: the approval email carries the studio/business brand
  const exp = Math.floor(Date.now() / 1000) + 7 * 86400; // one week
  let rows = '';
  for (const it of items) {
    const tok = await signApprovalToken({ site_id: site.id, kind: it.kind, plan_id: it.id, exp }, APPROVAL_SECRET);
    const link = `${siteBase()}/approve.html?token=${encodeURIComponent(tok)}`;
    rows += `<div style="margin:14px 0;padding:14px;border:1px solid #eee9e0;border-radius:10px"><b>${esc(it.title || 'A change is ready')}</b><br>${esc(it.summary || '')}<br><span class="cta"><a href="${link}" style="display:inline-block;margin-top:8px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Review &amp; approve →</a></span></div>`;
  }
  // critical: an approval request is transactional — the client's approval loop must
  // not stall because they unsubscribed from updates (bounces still suppress).
  const sent = await sendEmail(String(to), 'Something is ready for your approval',
    `<p>Your studio has ${items.length} ${items.length === 1 ? 'change' : 'changes'} ready. Tap to review and approve — nothing happens until you do.</p>${rows}`, brand, { critical: true });
  return json({ data: { ok: true, sent: items.length, delivered: sent, message: sent ? `Sent ${items.length} to ${to}.` : 'Prepared, but the email couldn’t be sent (email may be off in this environment, or that address can’t receive mail right now).' } }, 200, cors);
}

/** PUBLIC — the one-tap page reads the pending item from a signed token. */
export async function handleApproveGet(req: Request, cors: Record<string, string>) {
  // Phase S / FD-M2: throttle the public token endpoint (guards against token-guessing).
  if (!(await rateAllow(`approve:ip:${clientIp(req)}`, 20, 60))) return tooMany(cors);
  const token = new URL(req.url).searchParams.get('token') || '';
  const v = await verifyApprovalToken(token, APPROVAL_SECRET, Math.floor(Date.now() / 1000));
  if (!v.ok) return json({ error: v.error, message: linkMsg(v.error) }, 400, cors);
  const p = v.payload;
  const item = await loadPending(p);
  if (!item) return json({ error: 'already_decided', message: 'This was already handled — nothing more to do.' }, 409, cors);
  return json({ data: { title: item.title, summary: item.summary, kind: p.kind, business_name: item.business_name } }, 200, cors);
}

/** PUBLIC — apply the client's decision through the existing approval spine. */
export async function handleApprovePost(req: Request, cors: Record<string, string>) {
  if (!(await rateAllow(`approve:ip:${clientIp(req)}`, 20, 60))) return tooMany(cors);
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const v = await verifyApprovalToken(String(b?.token || ''), APPROVAL_SECRET, Math.floor(Date.now() / 1000));
  if (!v.ok) return json({ error: v.error, message: linkMsg(v.error) }, 400, cors);
  const decision = b?.decision === 'approve' ? 'approve' : b?.decision === 'reject' ? 'abandon' : null;
  if (!decision) return json({ error: 'bad_request', message: 'Choose approve or not yet.' }, 400, cors);
  const p = v.payload;
  const principal: Principal = { kind: 'system', userId: 'client-one-tap', tenantId: null, role: 'client', email: null, jwt: null, requestId: 'approve-token' };

  if (p.kind === 'connected') {
    const row = await decideWritePlan(p.site_id, p.plan_id, decision as 'approve' | 'abandon');
    if (!row) return json({ error: 'already_decided', message: 'This was already handled.' }, 409, cors);
  } else {
    const target = decision === 'approve' ? 'approved' : 'abandoned';
    const w = await svc(`presence_infra_plans?id=eq.${p.plan_id}&site_id=eq.${p.site_id}&status=eq.proposed&select=id,title`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: target, decided_at: new Date().toISOString() }),
    });
    if (!w.ok || !w.json?.[0]) return json({ error: 'already_decided', message: 'This was already handled.' }, 409, cors);
    await writeChangeEvent({ siteId: p.site_id, entityType: 'settings', entityId: null, action: 'update', summary: `${target === 'approved' ? 'Approved' : 'Set aside'} the plan (one-tap): ${w.json[0].title}`, principal, provenance: 'human', fields: ['infra_plan'] });
  }
  return json({ data: { ok: true, decision: decision === 'approve' ? 'approved' : 'set_aside', message: decision === 'approve' ? 'Approved — thank you.' : 'Set aside.' } }, 200, cors);
}

async function loadPending(p: ApprovalTokenPayload): Promise<{ title: string; summary: string; business_name: string } | null> {
  const ident = await svc(`presence_identity?site_id=eq.${p.site_id}&select=business_name&limit=1`);
  const business_name = ident.json?.[0]?.business_name || 'your business';
  const table = p.kind === 'connected' ? 'presence_connection_writes' : 'presence_infra_plans';
  const r = await svc(`${table}?id=eq.${p.plan_id}&site_id=eq.${p.site_id}&status=eq.proposed&select=title,summary&limit=1`);
  const row = r.json?.[0];
  return row ? { title: row.title || 'A change is ready', summary: row.summary || '', business_name } : null;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
function linkMsg(err: string): string {
  return err === 'expired' ? 'This link has expired — open your workspace to review.' : 'This link isn’t valid — open your workspace to review.';
}
