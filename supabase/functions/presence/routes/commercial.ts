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
import { sendEmail, platformSenderName } from '../commerce/account.ts';
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
import { normEmail, emailMatch, isUniqueViolation } from '../lib/contact_email.ts';
import { leadVisit } from '../lib/visit_source.ts';   // item 89
import { judgeSend, issueTicket, TICKET_MIN_AGE_S, markSender, spamLinkToken, readSpamLinkToken, SPAM_REASONS } from '../lib/form_check.ts';
import { storeFormFiles, cleanFileName, filesOf, filePath, fileLink, formFileBytes, filePathsOf, removeFormFiles, SPAM_KEEP_DAYS, type StoredFile } from '../lib/form_files.ts';
import { autoReplyVerdict } from '../lib/auto_reply.ts';   // item 203
import { JOINED, JOIN_CHECK_EMAIL, joinLinkToken, readJoinLinkToken, joinEmailSubject, joinEmailHtml } from '../lib/join_confirm.ts';
import { approvalDetail, cleanNote } from '../lib/approval_page.ts';   // sales item 92
import { wordsHtml, quoteBlock, followupPlan } from '../lib/follow_ups.ts';   // sales item 87
import { readVisitStats } from '../lib/visit_stats.ts';

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
  const sentFiles: Record<string, File[]> = {};          // item 147: a "Photo or file" field's files, by field
  if (isFormPost) {
    try {
      const fd = await req.formData();
      for (const key of new Set(fd.keys())) {
        const all = fd.getAll(key);
        const words = all.filter((x) => typeof x === 'string') as string[];
        const got = all.filter((x) => typeof x !== 'string' && (x as File).size > 0) as File[];
        if (got.length) sentFiles[key] = got;
        rawMap[key] = words.length > 1 ? words : (words[0] ?? '');
      }
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
    return r.ok ? ok200(JOIN_CHECK_EMAIL) : json({ error: r.error, field: r.field, message: r.message }, r.error === 'write_failed' ? 502 : 400, cors);
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
    // item 147: only a file field's own files count; anything else sent as a file is ignored
    const fileFields = def.fields.filter((f) => f.type === 'file').map((f) => f.key);
    const asSent = Object.fromEntries(fileFields.map((k) => [k, (sentFiles[k] || []).map((f) => ({ name: f.name, size: f.size, type: f.type }))]));
    // a show-or-hide rule on a file box reads its files' names, as the page's rules do
    for (const k of fileFields) if (sentFiles[k]?.length) (rawMap as any)[k] = sentFiles[k].map((f) => f.name).join(', ');
    const fv = validateFormValues(def, rawMap as any, asSent);
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
    // item 147: a person's photos and PDFs are kept privately; a send judged spam keeps none
    const entries = spam ? [] : fileFields.flatMap((k) => (fv.sub.values[k] ? (sentFiles[k] || []) : []).map((file) => ({ key: k, file })));
    let keptFiles: StoredFile[] = [];
    if (entries.length) {
      // item 203: a site keeps so much in files from its forms, all messages together
      const kept = await storeFormFiles(siteId, entries, undefined, await formFileBytes(siteId));
      if (!kept.ok) {
        if (toPage && siteOrigin) return await notSent(kept.error === 'site_full' ? 'check' : 'try_again');
        const field = kept.error === 'site_full' ? entries[0]?.key : entries.find((e) => cleanFileName(e.file.name) === kept.name)?.key;
        return kept.error === 'write_failed'
          ? json({ error: 'write_failed', field, message: 'Your files didn’t send. Please try again in a minute.' }, 502, cors)
          : json({ error: kept.error, field, message: kept.error === 'site_full' ? SITE_FULL : kept.error === 'not_allowed' ? `“${kept.name}” isn’t a photo or a PDF.` : (kept.name ? `“${kept.name}” is too big. Try a smaller one.` : 'Those files are too big together. Send fewer, or smaller ones.') }, 400, cors);
      }
      keptFiles = kept.files;
    }
    // the answer remembers its form (item 147: each form's own table of answers)
    const keep: Record<string, unknown> = { ...fv.sub.values, __form: def.id };
    if (keptFiles.length) keep.__files = keptFiles;
    if (why2) keep.__spam = { reason: why2 };
    const ins2 = await svc('presence_form_submissions?select=id', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: siteId, form_kind: def.kind, name: fv.sub.name, email: fv.sub.email, phone: fv.sub.phone, message: fv.sub.message, fields: keep, source_page: src, spam, ip_hash: ipHash2 }),
    });
    if (!ins2.ok) {
      if (toPage && siteOrigin) return await notSent('try_again');
      return json({ error: 'write_failed', message: 'That didn’t send — please try again.' }, 502, cors);
    }
    if (!spam) { notifyOwnerOfLead(siteId, { id: String(ins2.json?.[0]?.id || ''), form_kind: def.kind, name: fv.sub.name, email: fv.sub.email, phone: fv.sub.phone, message: fv.sub.message, files: keptFiles.length }).catch(() => {}); acknowledgeEnquiry(siteId, { name: fv.sub.name, email: fv.sub.email, message: fv.sub.message }).catch(() => {}); }
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
// ticket and the spam checks of item 140 included). Item 203: joining no longer adds
// anyone. It sends the address one email from the business with a "Yes, add me" link
// (lib/join_confirm.ts), and only pressing it on join.html makes them a contact of the
// site with subscribed_at and a note of what they agreed to, where and when they said
// yes (migration 0157). The box gives the same answer whoever typed the address, and
// the email counts as the site's one automatic reply that day to that address. A robot
// is thanked and nothing is sent. A sign-up never lifts an unsubscribe: the one
// suppression list still decides who gets mail, and gets no "Yes, add me" email.
export { JOINED, JOIN_CHECK_EMAIL };
async function joinList(siteId: string, raw: Record<string, unknown>): Promise<{ ok: true } | { ok: false; error: string; field?: string; message: string }> {
  const email = normEmail(raw.email).slice(0, 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: 'bad_email', field: 'email', message: 'That email doesn’t look right.' };
  if (String(raw.consent ?? '') !== 'yes') return { ok: false, error: 'consent', field: 'consent', message: 'Tick the box to say yes to emails.' };
  const trap = !!String(raw._hp ?? '').slice(0, 100).trim();
  if (await judgeSend(siteId, { trap, ticket: raw._tk, email, name: '', message: '' })) return { ok: true };
  const page = String(raw.source_page ?? '').replace(/[^\w\-./]/g, '').slice(0, 200) || '/';
  // on the list already: the same answer, and no email
  const found = await svc(`presence_contacts?site_id=eq.${siteId}&deleted_at=is.null&${emailMatch(email)}&select=id,subscribed_at&limit=1`);
  if (!found.ok) return { ok: false, error: 'write_failed', message: 'That didn’t go through. Please try again in a minute.' };
  if (Array.isArray(found.json) && found.json[0]?.subscribed_at) return { ok: true };
  if (await autoReplyVerdict(siteId, email) !== 'send') return { ok: true };
  const t = await joinLinkToken(siteId, email, page);
  if (!t) return { ok: false, error: 'write_failed', message: 'That didn’t go through. Please try again in a minute.' };
  const [brand, replyTo] = await Promise.all([loadEmailBrand(siteId), ownerReplyTo(siteId)]);
  const business = await businessName(siteId, brand.name);
  // to a visitor who typed their address on the business's own site: from the business,
  // and an answer reaches the owner (items 72 and 78)
  const went = await sendEmail(email, joinEmailSubject(business), joinEmailHtml({ business, email, link: `${appBase()}/join.html?t=${encodeURIComponent(t)}`, accent: brand.accent }), brand, { critical: true, asBusiness: true, replyTo });
  return went ? { ok: true } : { ok: false, error: 'write_failed', message: 'We couldn’t send your email just now. Please try again later.' };
}
/** The business's name as its visitors know it: the business details, else its brand. */
async function businessName(siteId: string, fallback: string): Promise<string> {
  const ident = await svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`).catch(() => null);
  return String(ident?.json?.[0]?.business_name || fallback || '').trim();
}

// ═══ Item 203 · join.html: "Yes, add me" ═══
// The link in the email opens join.html on the app's address (a function's own address
// can't show a page). It shows who and what first, since mail scanners open links on their
// own; the button adds them. Authorized by the link's signature alone.
async function joinTarget(req: Request, token: unknown, cors: Record<string, string>): Promise<{ siteId: string; email: string; page: string } | Response> {
  if (!(await rateAllow(`joinlink:ip:${clientIp(req)}`, 30, 60))) return tooMany(cors);
  const t = await readJoinLinkToken(token);
  if (t === 'expired') return json({ error: 'expired', message: 'This link has run out. Join again on the website, and use the new email.' }, 410, cors);
  if (!t) return json({ error: 'bad_link', message: 'This link isn’t complete. Join again on the website.' }, 400, cors);
  return t;
}
async function onList(siteId: string, email: string): Promise<{ id: string; subscribed_at: string | null } | null | false> {
  const r = await svc(`presence_contacts?site_id=eq.${siteId}&deleted_at=is.null&${emailMatch(email)}&select=id,subscribed_at&limit=1`);
  if (!r.ok) return false;
  return Array.isArray(r.json) && r.json[0] ? r.json[0] : null;
}
export async function handleJoinGet(req: Request, cors: Record<string, string>) {
  const hit = await joinTarget(req, new URL(req.url).searchParams.get('t'), cors);
  if (hit instanceof Response) return hit;
  const [brand, row] = await Promise.all([loadEmailBrand(hit.siteId), onList(hit.siteId, hit.email)]);
  return json({ data: { business: await businessName(hit.siteId, brand.name), email: hit.email, joined: !!(row && row.subscribed_at) } }, 200, { ...cors, 'Cache-Control': 'no-store' });
}
export async function handleJoinPost(req: Request, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const hit = await joinTarget(req, b?.t, cors);
  if (hit instanceof Response) return hit;
  const failed = () => json({ error: 'write_failed', message: 'That didn’t go through. Try again in a moment.' }, 502, cors);
  const now = new Date().toISOString();
  const patch = { subscribed_at: now, subscribed_note: `Joined on ${hit.page}: “${SIGNUP_CONSENT}” Said yes by email on ${now.slice(0, 10)}.` };
  let row = await onList(hit.siteId, hit.email);
  if (row === false) return failed();
  if (row && row.subscribed_at) return json({ data: { ok: true, joined: true } }, 200, cors);   // pressed twice
  if (!row) {
    const ins = await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: hit.siteId, email: normEmail(hit.email), name: '', ...patch }) });
    if (ins.ok && ins.json?.[0]) return json({ data: { ok: true, joined: true } }, 200, cors);
    if (!isUniqueViolation(ins)) return failed();
    // the same person pressed it in another tab a moment before: theirs is the row to mark
    row = await onList(hit.siteId, hit.email);
    if (!row) return failed();
    if (row.subscribed_at) return json({ data: { ok: true, joined: true } }, 200, cors);
  }
  const w = await svc(`presence_contacts?id=eq.${row.id}&site_id=eq.${hit.siteId}`, { method: 'PATCH', body: JSON.stringify(patch) });
  return w.ok ? json({ data: { ok: true, joined: true } }, 200, cors) : failed();
}

/** What the page's sender shows where the contact form was (the thank-you page's words). */
export const FORM_THANKS = 'Thank you, your message was sent. We’ll get back to you soon.';
/** Item 203: what a visitor is told when the site's room for form files is full. */
export const SITE_FULL = 'This form can’t take files just now. Send your message without them, or email the business.';

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
  // item 87: the follow-ups each enquiry got, and when the next one goes (the site's switch)
  const { automationSettingsFor, followupSettingsOf } = await import('../commerce/lifecycle.ts');   // lazy: lifecycle pulls in the whole sweep
  const fcfg = followupSettingsOf(await automationSettingsFor(site.id));
  const submissions = rows.map(({ fields, ...s }: any) => {
    const dealId = dealMap.get(String(s.id)) || null;
    // item 147: its files (names, never where they're kept) and the form it came from
    return { ...s, replies: leadReplies(fields), note: leadNote(fields), files: filesOf(fields), form_id: typeof fields?.__form === 'string' ? fields.__form : null, followups: followupPlan(s, fields, fcfg, Date.now()), deal_id: dealId, ...enquiryState(s.status, dealId, customers.has(String(s.email || '').trim().toLowerCase())) };
  });
  for (const s of submissions as any[]) s.visit = visits.get(String(s.id)) || null;
  return json({ data: { submissions, unread: submissions.filter((s: any) => s.status === 'new').length, more, followups_on: fcfg.on } }, 200, cors);
}

// ═══ Builder list item 147 · a form's files, and its own table of answers ═══
/** A ten-minute link to file `n` of one enquiry (the Inbox's attachment buttons). */
export async function handleFormFile(site: SiteRow, id: string, n: number, cors: Record<string, string>) {
  const r = await svc(`presence_form_submissions?id=eq.${id}&site_id=eq.${site.id}&select=fields&limit=1`);
  const row = Array.isArray(r.json) ? r.json[0] : null;
  const path = row ? filePath(row.fields, n) : null;
  const meta = row ? filesOf(row.fields).find((f) => f.n === n) : null;
  if (!path || !meta) return json({ error: 'not_found', message: 'That file isn’t there any more.' }, 404, cors);
  const url = await fileLink(path, meta.name, meta.type);
  return url ? json({ data: { url, name: meta.name, type: meta.type } }, 200, cors) : json({ error: 'unavailable', message: 'That file couldn’t be opened just now. Try again in a moment.' }, 502, cors);
}

/** GET /forms/answers?form=<id>[&page=<slug>] — one form's answers as a table: its fields
 *  as columns, the newest FORM_ANSWERS_MAX answers as rows (each with its files), how many
 *  are new, and, over the last 30 days, how many visitors saw a page the form is on
 *  against how many sent it. An answer knows its form from item 147 on (fields.__form). */
export const FORM_ANSWERS_MAX = 500;
export async function handleFormAnswers(req: Request, site: SiteRow, cors: Record<string, string>) {
  const u = new URL(req.url);
  const formId = String(u.searchParams.get('form') || '').trim();
  const page = String(u.searchParams.get('page') || '').trim();
  if (!/^[a-z0-9_]{1,40}$/.test(formId)) return json({ error: 'bad_request', message: 'Pick a form first.' }, 400, cors);
  const st = await svc(`presence_settings?site_id=eq.${site.id}&select=blocks,pages&limit=1`);
  const row = Array.isArray(st.json) ? st.json[0] : null;
  const where: Array<{ path: string; blocks: unknown }> = [{ path: '/', blocks: row?.blocks }, ...(Array.isArray(row?.pages) ? row.pages : []).map((p: any) => ({ path: `/${String(p?.slug || '')}/`, blocks: p?.blocks }))];
  let def: FormDefinition | undefined;
  const paths: string[] = [];
  for (const w of where) {
    const d = validateBlocks(w.blocks).find((bl: any) => bl.type === 'form' && bl.id === formId) as FormDefinition | undefined;
    if (!d) continue;
    paths.push(w.path);
    if (!def || (page ? w.path === `/${page}/` : w.path === '/')) def = d;
  }
  if (!def) return json({ error: 'not_found', message: 'That form isn’t on your site any more.' }, 404, cors);
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const formPaths = paths.flatMap((p) => (p === '/' ? ['/'] : [p, p.slice(0, -1)])).map((p) => p.replace(/"/g, ''));
  const [ans, views] = await Promise.all([
    svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&fields->>__form=eq.${encodeURIComponent(formId)}&select=id,created_at,status,name,email,phone,fields&order=created_at.desc&limit=${FORM_ANSWERS_MAX + 1}`),
    // item 207: the people who saw the form's pages, counted in the database (the row read
    // this replaces stopped at 1,000 rows, whatever limit it asked for)
    readVisitStats(site.id, { startMs: Date.parse(since), nowMs: Date.now(), paths: formPaths }).catch(() => null),
  ]);
  if (!ans.ok) return json({ error: 'read_failed', message: 'The answers couldn’t load just now. Try again in a moment.' }, 502, cors);
  const all = Array.isArray(ans.json) ? ans.json : [];
  const rows = all.slice(0, FORM_ANSWERS_MAX).map(({ fields, ...r }: any) => ({
    ...r,
    values: Object.fromEntries(def!.fields.map((f) => [f.key, typeof fields?.[f.key] === 'string' ? fields[f.key] : ''])),
    files: filesOf(fields),
  }));
  const seen = views ? views.agg.visitors : null;
  return json({ data: {
    form: { id: def.id, title: def.title, kind: def.kind, fields: def.fields.map((f) => ({ key: f.key, label: f.label, type: f.type })) },
    rows, more: all.length > FORM_ANSWERS_MAX, new: rows.filter((r: any) => r.status === 'new').length,
    last30: { seen, sent: rows.filter((r: any) => String(r.created_at || '') >= since).length },
  } }, 200, cors);
}

// ═══ Builder list item 140 · what the spam checks kept back, and why ═══
// The Inbox's enquiries gain a Spam filter: the last SPAM_DAYS of messages filed as
// spam, each with the reason in plain words and Not spam (POST /forms/inbox/:id
// { spam: false }), so a stricter check never loses a real customer's message.
export const SPAM_DAYS = SPAM_KEEP_DAYS;   // item 203: and then it goes, with its files (ops/retention.ts)
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
async function ensureLeadContact(siteId: string, emailIn: string, name: string, phone: string): Promise<void> {
  // item 110 (K1): kept lower-cased and matched whatever the capitals, the way the database's
  // one-contact-per-email rule matches — Jane@Example.com used to block every later add of her
  const email = normEmail(emailIn);
  const hit = await svc(`presence_contacts?site_id=eq.${siteId}&${emailMatch(email)}&deleted_at=is.null&select=id&limit=1`);
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
  const sent = await sendEmail(email, `Re: your ${kind}`, leadReplyHtml(body, String(sub.message || '')), brand, { critical: true, asBusiness: true, siteId: site.id });
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
  // item 87: { followups: 'off' | 'on' } alone stops or restarts the follow-ups, status untouched
  const followupsFlag = b?.followups === 'off' ? true : b?.followups === 'on' ? false : null;
  const followupsOnly = followupsFlag !== null && b?.status === undefined && spamFlag === null && typeof b?.note !== 'string';
  const status = followupsOnly ? null : ENQUIRY_STATUSES.includes(b?.status) ? b.status : (spamFlag === null && !noteOnly ? 'read' : null);
  const patch: Record<string, unknown> = {};
  if (status) patch.status = status;
  if (spamFlag !== null) patch.spam = spamFlag;
  let email = '';
  if (typeof b?.note === 'string' || spamFlag !== null || followupsFlag !== null) {
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
    if (followupsFlag === true) fields.__followups_off = true; else if (followupsFlag === false) delete fields.__followups_off;
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

// ═══ Item 203 · Delete an enquiry, and the files that came with it ═══
// DELETE /forms/inbox/:id: the message goes for good, and its files first. When the
// store refuses the files the message stays, so no file is left with nothing pointing
// to it; the next try removes the rest. Its follow-up nudge goes with it.
export async function handleFormDelete(site: SiteRow, id: string, cors: Record<string, string>) {
  const r = await svc(`presence_form_submissions?id=eq.${id}&site_id=eq.${site.id}&select=id,fields&limit=1`);
  if (!r.ok) return json({ error: 'read_failed', message: 'That didn’t go through. Try again in a moment.' }, 502, cors);
  const row = Array.isArray(r.json) ? r.json[0] : null;
  if (!row) return json({ error: 'not_found', message: 'That message isn’t there any more.' }, 404, cors);
  if (!(await removeFormFiles(filePathsOf(row.fields)))) return json({ error: 'files_kept', message: 'Its files couldn’t be removed just now, so the message stays. Try again in a moment.' }, 502, cors);
  const d = await svc(`presence_form_submissions?id=eq.${id}&site_id=eq.${site.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (!d.ok) return json({ error: 'write_failed', message: 'That didn’t go through. Try again in a moment.' }, 502, cors);
  const k = leadFollowupNoticeKey(id);
  await svc(`presence_plan_notices?site_id=eq.${site.id}&kind=eq.${k.kind}&period=eq.${k.period}&status=eq.active`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) }).catch(() => {});
  return json({ data: { ok: true, deleted: true } }, 200, cors);
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
 *  Settings shows (enquiryAckCopy — pinned by test), or the owner's own words.
 *  On for a new site since 0175 (sales item 87); no email on the enquiry →
 *  nothing to send; never blocks the submit. */
async function acknowledgeEnquiry(siteId: string, sub: { name: string; email: string; message?: string }): Promise<boolean> {
  if (!sub.email) return false;
  const { automationSettingsFor } = await import('../commerce/lifecycle.ts');   // lazy: lifecycle pulls in the whole sweep
  const auto = await automationSettingsFor(siteId);
  if (!auto.auto_ack_enquiries) return false;
  // item 203: one automatic reply a day to an address, and none to the do-not-send list
  if (await autoReplyVerdict(siteId, sub.email) !== 'send') return false;
  const [ident, brand, replyTo] = await Promise.all([
    svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`),
    loadEmailBrand(siteId),
    ownerReplyTo(siteId),
  ]);
  const studio = String(ident.json?.[0]?.business_name || '').trim();
  const copy = enquiryAckCopy({ name: sub.name, studio: studio || brand.name, words: auto.auto_ack_message });
  // Item 72: an answer to this reaches the owner's own email. Someone writing in for
  // the first time is no contact yet, so the site's inbound address (siteId, left as
  // the fallback) dropped their answer as a stranger's.
  // they wrote in; this is the reply they are waiting for, from the business they wrote to (sales item 78)
  // item 87: a copy of what they wrote, so the email is proof it arrived (links taken out, lib/follow_ups.ts)
  return await sendEmail(sub.email, copy.subject, `${wordsHtml(copy.sentence)}${quoteBlock(sub.message)}${copy.footer ? `<p style="color:#6b6478;font-size:13px">${esc(copy.footer)}</p>` : ''}`, brand, { critical: true, asBusiness: true, siteId, replyTo });
}

async function notifyOwnerOfLead(siteId: string, sub: { id?: string; form_kind: string; name: string; email: string; phone: string; message: string; files?: number }) {
  const ident = await svc(`presence_identity?site_id=eq.${siteId}&select=business_name,email&limit=1`);
  const to = ident.json?.[0]?.email;
  if (!to) return;
  const who = [sub.name, sub.email, sub.phone].filter(Boolean).join(' · ');
  const brand = await loadEmailBrand(siteId);   // BR-1: on the owner's brand
  // item 140: one tap from the email files it as spam, and more from that address goes there too
  const tok = sub.id ? await spamLinkToken(siteId, sub.id) : '';
  // item 147: files are opened from the Inbox (they never travel by email)
  const filesLine = sub.files ? `<p>${sub.files === 1 ? 'A file came' : `${sub.files} files came`} with it. Open ${sub.files === 1 ? 'it' : 'them'} from your Inbox.</p>` : '';
  const spamLine = tok ? `<p style="margin-top:14px;color:#6b6478;font-size:13px">Not a real customer? <a href="${appBase()}/spam.html?t=${encodeURIComponent(tok)}" style="color:#6b6478">This was spam</a>. It moves to Spam, and more from them goes there too.</p>` : '';
  // Sales item 74: a new enquiry is the business's own news, so it always arrives (critical);
  // an unsubscribe from some other email must never cost the owner a customer.
  await sendEmail(String(to), `New ${sub.form_kind} from your website`,
    `<p>Someone reached out through your website.</p><p><b>${esc(who)}</b></p><p>${esc(sub.message)}</p>${filesLine}<p class="cta"><a href="${siteBase()}/crm.html" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">See it in your workspace →</a></p>${spamLine}`, brand, { critical: true });
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

  // Sales item 92: the request comes from the studio that looks after this site, in its name
  // (it read "Your studio has…" from the client's own brand); no studio known → the client's brand as before
  const sender = await approvalSender(site.id);
  const brand = await loadEmailBrand(sender.siteId || site.id);
  const exp = Math.floor(Date.now() / 1000) + 7 * 86400; // one week
  let rows = '';
  for (const it of items) {
    const tok = await signApprovalToken({ site_id: site.id, kind: it.kind, plan_id: it.id, exp }, APPROVAL_SECRET);
    const link = `${siteBase()}/approve.html?token=${encodeURIComponent(tok)}`;
    rows += `<div style="margin:14px 0;padding:14px;border:1px solid #eee9e0;border-radius:10px"><b>${esc(it.title || 'A change is ready')}</b><br>${esc(it.summary || '')}<br><span class="cta"><a href="${link}" style="display:inline-block;margin-top:8px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">See what changes →</a></span></div>`;
  }
  // critical: an approval request is transactional — the client's approval loop must
  // not stall because they unsubscribed from updates (bounces still suppress).
  const n = `${items.length} ${items.length === 1 ? 'change' : 'changes'}`;
  const sent = await sendEmail(String(to), 'Something is ready for your approval',
    `<p>${esc(sender.name)} has ${n} ready for you. Tap one to see exactly what changes, then approve it or say what should change. Nothing happens until you do.</p>${rows}`, brand, { critical: true, asBusiness: !!sender.siteId });
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
  // Sales item 92: who is asking (the studio, by name and logo) and what exactly changes
  const sender = await approvalSender(p.site_id);
  return json({ data: { title: item.title, summary: item.summary, kind: p.kind, business_name: item.business_name, studio: { name: sender.name, logo_url: sender.logoUrl }, ...item.detail } }, 200, cors);
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
  // Sales item 92: "Not yet" can say what should change (read before the decision, which ends the pending row)
  const note = decision === 'abandon' ? cleanNote(b?.note) : '';
  const pending = decision === 'abandon' ? await loadPending(p).catch(() => null) : null;

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
  if (decision === 'abandon') await tellStudioNotYet(p, pending, note, principal).catch(() => {});
  return json({ data: { ok: true, decision: decision === 'approve' ? 'approved' : 'set_aside', message: decision === 'approve' ? 'Approved — thank you.' : 'Set aside.' } }, 200, cors);
}

/** Who sent an approval (sales item 92): the studio that looks after the site (its active
 *  service link), by its Business details name and logo; no studio known → the name the
 *  platform's own mail goes out under. siteId is the studio's site, or null. */
async function approvalSender(siteId: string): Promise<{ siteId: string | null; name: string; logoUrl: string | null }> {
  try {
    const link = await svc(`presence_service_links?customer_site_id=eq.${siteId}&status=eq.active&select=agency_site_id&order=created_at.desc&limit=1`);
    const studio = String((Array.isArray(link.json) && link.json[0]?.agency_site_id) || '');
    if (studio) {
      const { studioBrandOf } = await import('./studio_brand.ts');
      const b = await studioBrandOf(studio);
      return { siteId: studio, name: b.is_default ? platformSenderName() : b.name, logoUrl: b.logo_url };
    }
  } catch { /* the platform's name below */ }
  return { siteId: null, name: platformSenderName(), logoUrl: null };
}

/** "Not yet" reaches the studio that asked (sales item 92), with the client's note when
 *  they left one, and the site's change log keeps it. Mail to the studio is operator mail
 *  (lib/service_bridge.ts emailOperator: critical, the platform's reply-to); with no studio
 *  known, the platform's own studio site (AGENCY_SITE_ID) hears it. Best-effort: the
 *  decision already stands. */
async function tellStudioNotYet(p: ApprovalTokenPayload, pending: { title: string; business_name: string } | null, note: string, principal: Principal): Promise<void> {
  const title = pending?.title || 'a change';
  const biz = pending?.business_name || 'Your client';
  if (note) await writeChangeEvent({ siteId: p.site_id, entityType: 'settings', entityId: null, action: 'update', summary: `Not yet on “${title}”: ${note}`.slice(0, 300), principal, provenance: 'human', fields: [p.kind === 'connected' ? 'connected_write' : 'infra_plan'] }).catch(() => {});
  const html = `<p><strong>${esc(biz)}</strong> said not yet to <strong>${esc(title)}</strong>, so nothing was changed.</p>` +
    (note ? `<p>What they’d like changed:</p><blockquote style="margin:8px 0;padding:8px 14px;border-left:3px solid #ccc">${esc(note).replace(/\n/g, '<br>')}</blockquote>` : '<p>They didn’t leave a note.</p>');
  const sender = await approvalSender(p.site_id);
  const studioSite = sender.siteId || Deno.env.get('AGENCY_SITE_ID') || '';
  if (!studioSite) return;
  const { emailOperator } = await import('../lib/service_bridge.ts');
  await emailOperator(studioSite, `Not yet: ${title}`, html, 'approval_not_yet');
}

async function loadPending(p: ApprovalTokenPayload): Promise<{ title: string; summary: string; business_name: string; detail: ReturnType<typeof approvalDetail> } | null> {
  const ident = await svc(`presence_identity?site_id=eq.${p.site_id}&select=business_name&limit=1`);
  const business_name = ident.json?.[0]?.business_name || 'your business';
  const table = p.kind === 'connected' ? 'presence_connection_writes' : 'presence_infra_plans';
  // sales item 92: the plain words each kind already keeps about what it does
  const cols = p.kind === 'connected' ? 'title,summary,workflow,what_changes,what_stays,reversible,rollback,payload' : 'title,summary,kind,steps,reversible,rollback_note';
  const r = await svc(`${table}?id=eq.${p.plan_id}&site_id=eq.${p.site_id}&status=eq.proposed&select=${cols}&limit=1`);
  const row = r.json?.[0];
  return row ? { title: row.title || 'A change is ready', summary: row.summary || '', business_name, detail: approvalDetail(p.kind === 'connected' ? 'connected' : 'infrastructure', row) } : null;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
function linkMsg(err: string): string {
  return err === 'expired' ? 'This link has expired — open your workspace to review.' : 'This link isn’t valid — open your workspace to review.';
}
