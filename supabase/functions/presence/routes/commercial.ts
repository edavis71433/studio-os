// ── /schedule/* · /forms/* · /approve/* — commercial V1 (Phase F) ────────────
// FD-1 scheduled publish/expiry · FD-2 lead capture · FD-3 one-tap approve.
// Reuses existing spines: the ONE publish pipeline, the CRM timeline, the
// approval decide logic. No new architecture.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { getTemplate } from '../lib/render.ts';
import { serializeDraft } from '../lib/serializer.ts';
import { sendEmail } from '../commerce/account.ts';
import { decideWritePlan } from '../connected/writestore.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import {
  validateScheduleTime, isScheduleKind, validateSubmission, formParamsToSubmission,
  signApprovalToken, verifyApprovalToken, type ApprovalTokenPayload,
  leadFollowupResolvesOn, leadFollowupNoticeKey,
} from '../lib/commercial.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const APPROVAL_SECRET = Deno.env.get('APPROVAL_SECRET') || Deno.env.get('SCHEDULER_SECRET') || '';
const siteBase = () => (Deno.env.get('SITE_URL') || 'https://presence.davisdigitalstudio.com').replace(/\/$/, '');

// ═══ FD-1 · Scheduled publish / revert (content expiry) ══════════════════════

export async function handleScheduleCreate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const now = new Date().toISOString();
  const when = validateScheduleTime(b?.scheduled_for, now);
  if (!when.ok) return json({ error: when.error, message: when.error === 'past' ? 'Pick a time in the future.' : 'That date doesn’t look right.' }, 400, cors);
  const kind = isScheduleKind(b?.kind) ? b.kind : 'publish';

  let snapshotId: string; let summary: string;
  if (kind === 'revert') {
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
    const { snapshot, mediaManifest } = await serializeDraft(site.id, t.manifest, { templateSlug: site.template_slug, templateVersion: site.template_version, now });
    const ins = await svc('presence_snapshots', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, content: snapshot.content, media_manifest: mediaManifest, content_contract_version: snapshot.content_contract_version, template_slug: snapshot.template_slug, template_version: snapshot.template_version, dev_customization: snapshot.dev_customization ?? null, created_by: principal.userId, created_by_kind: 'client' }),
    });
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
  const ok200 = (msg: string) => json({ data: { ok: true, message: msg } }, 200, cors); // always 200 to bots
  if (!/^[0-9a-f-]{36}$/.test(siteId)) return json({ error: 'not_found' }, 404, cors);

  // Phase S / FD-M2: throttle the public submit — per-IP and per-site fixed windows.
  // A bot that ignores the honeypot is still capped; a real visitor is nowhere near it.
  const rlIp = clientIp(req);
  if (!(await rateAllow(`forms:ip:${rlIp}`, 10, 60)) || !(await rateAllow(`forms:site:${siteId}`, 60, 60))) return tooMany(cors);

  // Phase V FD-N1: the published template posts a plain HTML form (urlencoded).
  // Accept both encodings; browser form posts get a 303 redirect to the site's
  // rendered thank-you page (works with no JS) instead of raw JSON.
  const ctype = (req.headers.get('content-type') || '').toLowerCase();
  const isFormPost = ctype.includes('application/x-www-form-urlencoded') || ctype.includes('multipart/form-data');
  let b: any = {};
  if (isFormPost) {
    try { const fd = await req.formData(); b = formParamsToSubmission((k) => { const x = fd.get(k); return typeof x === 'string' ? x : null; }); } catch { /* */ }
  } else {
    try { b = await req.json(); } catch { /* */ }
  }

  const site = await svc(`presence_sites?id=eq.${siteId}&select=id,client_id,custom_domain,netlify_site_id&limit=1`);
  if (!site.json?.[0]) return json({ error: 'not_found' }, 404, cors);
  const siteRow = site.json[0];
  const siteOrigin = siteRow.custom_domain ? `https://${siteRow.custom_domain}` : (siteRow.netlify_site_id ? `https://${siteRow.netlify_site_id}.netlify.app` : '');
  const redirectTo = (path: string) => new Response(null, { status: 303, headers: { ...cors, Location: `${siteOrigin}${path}` } });

  const v = validateSubmission(b);
  if (!v.ok) {
    if (isFormPost && siteOrigin) return redirectTo('/contact/');   // calm retry; browser `required` makes this rare
    return json({ error: v.error, message: v.error === 'bad_email' ? 'That email doesn’t look right.' : v.error === 'need_contact' ? 'Leave an email or phone so they can reply.' : 'Add a short message.' }, 400, cors);
  }
  const ipHash = await hashIp(req);

  const ins = await svc('presence_form_submissions', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ site_id: siteId, form_kind: v.sub.form_kind, name: v.sub.name, email: v.sub.email, phone: v.sub.phone, message: v.sub.message, fields: v.sub.fields, source_page: v.sub.source_page, spam: v.spam, ip_hash: ipHash }),
  });
  if (!ins.ok) {
    if (isFormPost && siteOrigin) return redirectTo('/contact/');
    return json({ error: 'write_failed', message: 'That didn’t send — please try again.' }, 502, cors);
  }
  if (!v.spam) { notifyOwnerOfLead(siteId, v.sub).catch(() => {}); } // best-effort, non-blocking
  if (isFormPost && siteOrigin) return redirectTo('/thanks/');       // spam included — bots see success
  return ok200('Thanks — your message was sent.');
}

export async function handleFormInbox(site: SiteRow, cors: Record<string, string>) {
  const r = await svc(`presence_form_submissions?site_id=eq.${site.id}&spam=eq.false&select=id,form_kind,name,email,phone,message,source_page,status,created_at&order=created_at.desc&limit=100`);
  const rows = Array.isArray(r.json) ? r.json : [];
  return json({ data: { submissions: rows, unread: rows.filter((s: any) => s.status === 'new').length } }, 200, cors);
}

export async function handleFormStatus(req: Request, site: SiteRow, id: string, cors: Record<string, string>) {
  let b: any = {}; try { b = await req.json(); } catch { /* */ }
  const status = ['new', 'read', 'archived'].includes(b?.status) ? b.status : 'read';
  const r = await svc(`presence_form_submissions?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status }) });
  if (!(r.ok && r.json?.[0])) return json({ error: 'not_found' }, 404, cors);
  // PP-1: acting on the lead resolves its follow-up nudge — so Today's card, the
  // bell, and the attention badge (all reading active notices) drop it at once.
  // Keyed period=lead:<id>, this touches exactly this lead's notice, nothing else.
  if (leadFollowupResolvesOn(status)) {
    const k = leadFollowupNoticeKey(id);
    await svc(`presence_plan_notices?site_id=eq.${site.id}&kind=eq.${k.kind}&period=eq.${k.period}&status=eq.active`, {
      method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }),
    }).catch(() => {});
  }
  return json({ data: { ok: true } }, 200, cors);
}

async function hashIp(req: Request): Promise<string> {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
  if (!ip) return '';
  const data = new TextEncoder().encode(ip + '|' + (APPROVAL_SECRET || 'salt'));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function notifyOwnerOfLead(siteId: string, sub: { form_kind: string; name: string; email: string; phone: string; message: string }) {
  const ident = await svc(`presence_identity?site_id=eq.${siteId}&select=business_name,email&limit=1`);
  const to = ident.json?.[0]?.email;
  if (!to) return;
  const who = [sub.name, sub.email, sub.phone].filter(Boolean).join(' · ');
  await sendEmail(String(to), `New ${sub.form_kind} from your website`,
    `<p>Someone reached out through your website.</p><p><b>${esc(who)}</b></p><p>${esc(sub.message)}</p><p><a href="${siteBase()}/crm.html">See it in your workspace →</a></p>`);
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

  const exp = Math.floor(Date.now() / 1000) + 7 * 86400; // one week
  let rows = '';
  for (const it of items) {
    const tok = await signApprovalToken({ site_id: site.id, kind: it.kind, plan_id: it.id, exp }, APPROVAL_SECRET);
    const link = `${siteBase()}/approve.html?token=${encodeURIComponent(tok)}`;
    rows += `<div style="margin:14px 0;padding:14px;border:1px solid #eee;border-radius:10px"><b>${esc(it.title || 'A change is ready')}</b><br>${esc(it.summary || '')}<br><a href="${link}" style="display:inline-block;margin-top:8px;background:#5b3fa0;color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Review &amp; approve →</a></div>`;
  }
  const sent = await sendEmail(String(to), 'Something is ready for your approval',
    `<p>Your studio has ${items.length} ${items.length === 1 ? 'change' : 'changes'} ready. Tap to review and approve — nothing happens until you do.</p>${rows}`);
  return json({ data: { ok: true, sent: items.length, delivered: sent, message: sent ? `Sent ${items.length} to ${to}.` : 'Prepared, but email isn’t configured on this environment.' } }, 200, cors);
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
