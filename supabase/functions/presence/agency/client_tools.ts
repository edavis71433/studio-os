// ── The studio's client tools (builder list item 176, Nov 2026) ──────────────
// Three agency tools from Wix Studio, each started from a site's card on Sites:
//
//   GET  /agency/site-tools                 what every card says: the content form and the kit, in brief
//   GET  /agency/sites/:id/intake           the content form, its link, and the questions to pick from
//   PUT  /agency/sites/:id/intake           make it (a new link) or change its questions
//   GET  /agency/sites/:id/intake/answers   the client's words and photos (marks them read)
//   POST /agency/sites/:id/intake/email     email the link from the studio
//   POST /agency/sites/:id/intake/state     stop the link, or open it again
//   GET  /agency/sites/:id/kit              the hand-over kit, the site's facts, the files to pick from
//   PUT  /agency/sites/:id/kit              save it; `shown` puts it in their portal
//   POST /agency/sites/:id/kit/email        tell the owner it's ready
//   GET  /agency/week                       Plan my week (lib/week_plan.ts)
//
// The client's side of the content form is routes/intake_public.ts (no sign-in);
// the portal's side of the kit is routes/client_kit.ts. Reading needs `read`;
// changing a form or a kit, or emailing a client, needs `manage_clients`.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { can, agencySiteIds } from './auth.ts';
import type { AgencyMember } from './auth.ts';
import type { Principal } from '../../_shared/auth.ts';
import type { SiteRow } from '../lib/site.ts';
import { siteOrigin, SITE_COLS } from '../lib/site.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { INTAKE_KINDS, questionBank, buildQuestions, normalizeForm, normalizeAnswers, progressOf, newSecret, linkToken, formSummary } from '../lib/intake_form.ts';
import type { IntakeForm } from '../lib/intake_form.ts';
import { normalizeKit, kitFromSave, defaultKit, kitSummary } from '../lib/handover_kit.ts';
import { thingsFromNeeds, thingsFromTasks, thingsFromEstimates, thingsFromRecurring, thingsFromReports, thingsFromIntake, buildWeek, todayFrom, addDays, weekAsText, WEEK_DAYS } from '../lib/week_plan.ts';
import type { WeekThing } from '../lib/week_plan.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';
import { sendEmail } from '../commerce/account.ts';
import { signThumb, signDownload, isImageMime } from '../lib/media.ts';
import { rateAllow, tooMany } from '../lib/ratelimit.ts';
import { loadReceivables, loadMyTasks } from '../routes/sales.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';

export interface ClientToolsDeps {
  ownSite: () => Promise<SiteRow | null>;
  /** Home's Needs you, as computeStudioNeeds answers it */
  needs: () => Promise<{ rows?: any[]; rest?: any[]; snoozed?: Array<{ key: string; until: string }> }>;
  /** the portfolio gather (names of the clients' sites) */
  gather: (agencyId: string, nowIso: string) => Promise<{ links: Array<{ site_id: string; status: string }>; clientNames: Record<string, string> }>;
}

const APP = () => (Deno.env.get('APP_URL') || 'https://app.davisdigitalstudio.com').replace(/\/$/, '');
const forbid = (cors: Record<string, string>) => json({ error: 'forbidden', message: 'Your role doesn’t include this.' }, 403, cors);
const notYours = (cors: Record<string, string>) => json({ error: 'not_found', message: 'Not one of your clients.' }, 404, cors);
const rowsOf = <T,>(q: unknown): T[] => (q && (q as { ok?: boolean }).ok && Array.isArray((q as { json?: unknown }).json) ? (q as { json: T[] }).json : []);
const PLAIN_EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const parseBody = (b: unknown) => { try { return b ? JSON.parse(String(b)) : null; } catch { return null; } };

/** The link a client opens. */
export const intakeLink = (siteId: string, secret: string) => `${APP()}/intake?t=${linkToken(siteId, secret)}`;

async function siteOf(siteId: string): Promise<SiteRow | null> {
  return rowsOf<SiteRow>(await svc(`presence_sites?id=eq.${siteId}&select=${SITE_COLS}&limit=1`).catch(() => null))[0] || null;
}
/** The business name on a site, else its client's name. */
async function nameOf(site: SiteRow): Promise<string> {
  const [idQ, clQ] = await Promise.all([
    svc(`presence_identity?site_id=eq.${site.id}&select=business_name&limit=1`).catch(() => null),
    site.client_id ? svc(`clients?id=eq.${site.client_id}&select=name&limit=1`).catch(() => null) : Promise.resolve(null),
  ]);
  return String(rowsOf<{ business_name?: string }>(idQ)[0]?.business_name || rowsOf<{ name?: string }>(clQ)[0]?.name || '').trim();
}
/** The owner's address, when the site has one (a site made before its owner is invited has none). */
async function ownerOf(site: SiteRow): Promise<{ email: string; name: string } | null> {
  if (!site.client_id) return null;
  const c = rowsOf<{ email?: string | null; name?: string | null }>(await svc(`clients?id=eq.${site.client_id}&select=email,name&limit=1`).catch(() => null))[0];
  const email = String(c?.email || '').trim();
  return email && PLAIN_EMAIL.test(email) ? { email, name: String(c?.name || '').trim() } : null;
}
const readForm = async (siteId: string) => normalizeForm(await readReservedJson(siteId, RESERVED_NAMES.intakeForm));

/** A form as the studio sees it: everything but the secret, and the link. */
function formForStudio(siteId: string, f: IntakeForm | null) {
  if (!f) return null;
  const { secret, ...rest } = f;
  return { ...rest, link: intakeLink(siteId, secret), unread: !!f.sent_at && (!f.seen_at || f.seen_at < f.sent_at) };
}

function ctaEmail(brandAccent: string, lines: string[], cta: { href: string; label: string }, after: string[] = []): string {
  return lines.map((l) => `<p>${l}</p>`).join('') +
    `<p style="margin:22px 0"><a href="${esc(cta.href)}" style="display:inline-block;background:${esc(brandAccent)};color:#ffffff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${esc(cta.label)}</a></p>` +
    after.map((l) => `<p style="font-size:13px;color:#6b6478">${l}</p>`).join('');
}

/** The Sites, intake, kit and week routes, or null when the route is someone else's. */
export async function handleClientTools(req: Request, route: string, method: string, member: AgencyMember, principal: Principal, cors: Record<string, string>, deps: ClientToolsDeps): Promise<Response | null> {
  const now = new Date().toISOString();
  const body = async (): Promise<Record<string, any>> => { try { const b = await req.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; } };

  // ── what every card says ──
  if (route === '/agency/site-tools' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const ids = await agencySiteIds(member.agency_id);
    if (!ids.length) return json({ data: {} }, 200, cors);
    const names = [RESERVED_NAMES.intakeForm, RESERVED_NAMES.handoverKit].map(encodeURIComponent).join(',');
    const q = await svc(`presence_sales_templates?site_id=in.(${ids.join(',')})&kind=eq.proposal&name=in.(${names})&deleted_at=is.null&select=site_id,name,body,updated_at&order=updated_at.desc&limit=2000`).catch(() => null);
    if (!q || !q.ok) return json({ data: {}, partial: true }, 200, cors);
    const data: Record<string, { intake: ReturnType<typeof formSummary>; kit: ReturnType<typeof kitSummary> }> = {};
    const seen = new Set<string>();
    for (const r of rowsOf<{ site_id: string; name: string; body: string }>(q)) {
      const k = `${r.site_id}:${r.name}`;
      if (seen.has(k)) continue;   // the newest row of a name wins (reserved_store's rule)
      seen.add(k);
      const cur = data[r.site_id] || (data[r.site_id] = { intake: null, kit: null });
      if (r.name === RESERVED_NAMES.intakeForm) cur.intake = formSummary(normalizeForm(parseBody(r.body)));
      else cur.kit = kitSummary(normalizeKit(parseBody(r.body)));
    }
    return json({ data }, 200, cors);
  }

  // ── Plan my week ──
  if (route === '/agency/week' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    return await weekPlan(new URL(req.url).searchParams.get('today'), member, principal, now, deps, cors);
  }

  const m = route.match(/^\/agency\/sites\/([0-9a-f-]{36})\/(intake|kit)(?:\/(answers|email|state))?$/);
  if (!m) return null;
  const siteId = m[1], tool = m[2], sub = m[3] || '';
  const writes = method !== 'GET';
  if (!can(member.role, writes ? 'manage_clients' : 'read')) return forbid(cors);
  if (!(await agencySiteIds(member.agency_id)).includes(siteId)) return notYours(cors);
  const site = await siteOf(siteId);
  if (!site) return notYours(cors);

  // ══ the content form ══
  if (tool === 'intake') {
    if (!sub && method === 'GET') {
      const [f, business, owner] = await Promise.all([readForm(siteId), nameOf(site), ownerOf(site)]);
      return json({ data: {
        form: formForStudio(siteId, f), business_name: f?.business_name || business, owner_email: owner?.email || null,
        kinds: INTAKE_KINDS, bank: Object.fromEntries(INTAKE_KINDS.map((k) => [k.key, questionBank(k.key)])),
        can_edit: can(member.role, 'manage_clients'),
      } }, 200, cors);
    }
    if (!sub && method === 'PUT') {
      const b = await body();
      const built = buildQuestions({ kind: b.kind, picks: b.picks, own: b.own });
      if (!built.ok) return json({ error: 'bad_request', message: built.message }, 400, cors);
      const [business, own, answersRaw] = await Promise.all([nameOf(site), deps.ownSite().catch(() => null), readReservedJson(siteId, RESERVED_NAMES.intakeAnswers)]);
      const answers = normalizeAnswers(answersRaw);
      const stored = await updateReservedJson(siteId, RESERVED_NAMES.intakeForm, (cur) => {
        const prev = normalizeForm(cur);
        const p = progressOf(built.questions, answers);
        const base: IntakeForm = prev || {
          v: 1, kind: built.kind, questions: built.questions, secret: newSecret(), status: 'open', business_name: business || 'your business', studio_site_id: own?.id || null,
          created_at: now, created_by: member.email, updated_at: now, opened_at: null, saved_at: null, answered: 0, total: 0, files: 0,
          sent_at: null, seen_at: null, notified_at: null, emailed_to: null, emailed_at: null,
        };
        return { ...base, kind: built.kind, questions: built.questions, business_name: business || base.business_name, updated_at: now, ...p };
      }, member.email);
      if (!stored) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
      return json({ data: { form: formForStudio(siteId, normalizeForm(stored)) } }, 200, cors);
    }
    const f = await readForm(siteId);
    if (!f) return json({ error: 'no_form', message: 'There’s no content form for this site yet.' }, 404, cors);
    if (sub === 'answers' && method === 'GET') {
      const answers = normalizeAnswers(await readReservedJson(siteId, RESERVED_NAMES.intakeAnswers));
      const ids = [...new Set(Object.values(answers).flatMap((a) => (a.files || []).map((x) => x.id)))];
      const media = ids.length ? rowsOf<{ id: string; storage_path: string; mime: string }>(await svc(`presence_media?id=in.(${ids.join(',')})&site_id=eq.${siteId}&deleted_at=is.null&select=id,storage_path,mime`).catch(() => null)) : [];
      const byId = new Map(media.map((x) => [x.id, x]));
      const links = await Promise.all(ids.map(async (id) => {
        const x = byId.get(id);
        if (!x) return [id, null] as const;
        const [thumb, url] = await Promise.all([isImageMime(x.mime) ? signThumb(x.storage_path, x.mime, 320).catch(() => null) : Promise.resolve(null), signDownload(x.storage_path).catch(() => null)]);
        return [id, { thumb, url }] as const;
      }));
      const signed = new Map(links);
      const list = f.questions.map((qq) => {
        const a = answers[qq.id] || { at: '' };
        return { id: qq.id, label: qq.label, kind: qq.kind, text: a.text || '', at: a.at || null,
          files: (a.files || []).filter((x) => signed.get(x.id)).map((x) => ({ id: x.id, name: x.name, mime: x.mime, thumb_url: signed.get(x.id)!.thumb, url: signed.get(x.id)!.url })) };
      });
      if (f.sent_at && (!f.seen_at || f.seen_at < f.sent_at)) await updateReservedJson(siteId, RESERVED_NAMES.intakeForm, (cur) => ({ ...(cur as object), seen_at: now }), member.email);
      return json({ data: { form: formForStudio(siteId, f), answers: list } }, 200, cors);
    }
    if (sub === 'state' && method === 'POST') {
      const b = await body();
      if (typeof b.open !== 'boolean') return json({ error: 'bad_request', message: 'Say open true or false.' }, 400, cors);
      const stored = await updateReservedJson(siteId, RESERVED_NAMES.intakeForm, (cur) => ({ ...(cur as object), status: b.open ? 'open' : 'closed', updated_at: now }), member.email);
      if (!stored) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
      return json({ data: { form: formForStudio(siteId, normalizeForm(stored)) } }, 200, cors);
    }
    if (sub === 'email' && method === 'POST') {
      const b = await body();
      const to = String(b.to || '').trim();
      if (!PLAIN_EMAIL.test(to) || to.length > 254) return json({ error: 'bad_request', message: 'That email address doesn’t look right.' }, 400, cors);
      if (f.status !== 'open') return json({ error: 'closed', message: 'This form’s link is stopped. Open it again first.' }, 409, cors);
      if (!(await rateAllow(`intake_email:${siteId}`, 6, 3600))) return tooMany(cors, 3600);
      const own = await deps.ownSite().catch(() => null);
      const brand = await loadEmailBrand(f.studio_site_id || own?.id || siteId).catch(() => null);
      const studio = brand?.name || 'Your studio';
      const html = ctaEmail(brand?.accent || '#5b3fa0', [
        `${esc(studio)} is building the website for ${esc(f.business_name)}, and would like your words and photos for it.`,
        `It’s a short form: ${f.questions.length} question${f.questions.length === 1 ? '' : 's'}. It saves as you go, so you can come back to it any time, and there’s nothing to sign in to.`,
      ], { href: intakeLink(siteId, f.secret), label: 'Open the form' }, ['Questions? Just reply to this email.']);
      const subject = `${studio} asked for your words and photos`;
      const sent = await sendEmail(to, subject, html, brand || undefined, { replyTo: member.email });
      if (!sent) return json({ error: 'not_sent', message: 'That email didn’t go — the address may have unsubscribed or bounced before. Copy the link and send it yourself.' }, 502, cors);
      const stored = await updateReservedJson(siteId, RESERVED_NAMES.intakeForm, (cur) => ({ ...(cur as object), emailed_to: to, emailed_at: now }), member.email);
      return json({ data: { form: formForStudio(siteId, normalizeForm(stored) || f) } }, 200, cors);
    }
    return null;
  }

  // ══ the hand-over kit ══
  if (!sub && method === 'GET') {
    const own = await deps.ownSite().catch(() => null);
    const [raw, idQ, firstLive, filesQ, domQ, owner, business] = await Promise.all([
      readReservedJson(siteId, RESERVED_NAMES.handoverKit),
      own ? svc(`presence_identity?site_id=eq.${own.id}&select=business_name,email,phone&limit=1`).catch(() => null) : Promise.resolve(null),
      svc(`presence_publishes?site_id=eq.${siteId}&status=eq.live&select=created_at&order=created_at.asc&limit=1`).catch(() => null),
      svc(`presence_media?site_id=eq.${siteId}&deleted_at=is.null&select=id,alt_text,mime,created_at&order=created_at.desc&limit=200`).catch(() => null),
      svc(`presence_sites?id=eq.${siteId}&select=domain_registrar,domain_expires_at&limit=1`).catch(() => null),
      ownerOf(site), nameOf(site),
    ]);
    const studio = rowsOf<{ business_name?: string; email?: string; phone?: string }>(idQ)[0] || {};
    const dom = rowsOf<{ domain_registrar?: string | null; domain_expires_at?: string | null }>(domQ)[0] || {};
    const kit = normalizeKit(raw);
    return json({ data: {
      kit: kit || defaultKit({ name: studio.business_name || member.agency_name, email: studio.email || member.email, phone: studio.phone }),
      saved: !!kit,
      business_name: business,
      facts: { address: siteOrigin(site), live_since: rowsOf<{ created_at: string }>(firstLive)[0]?.created_at || null, domain: site.custom_domain || null, domain_expires_at: dom.domain_expires_at || null, domain_registrar: dom.domain_registrar || null },
      files: rowsOf<{ id: string; alt_text: string; mime: string; created_at: string }>(filesQ).map((x) => ({ id: x.id, name: String(x.alt_text || 'A file'), mime: x.mime, created_at: x.created_at })),
      owner: owner ? { name: owner.name, email: owner.email } : null,
      can_edit: can(member.role, 'manage_clients'),
    } }, 200, cors);
  }
  if (!sub && method === 'PUT') {
    const b = await body();
    const prev = normalizeKit(await readReservedJson(siteId, RESERVED_NAMES.handoverKit));
    const made = kitFromSave(b, prev, member.email, now);
    if (!made.ok) return json({ error: 'bad_request', message: made.message }, 400, cors);
    if (made.kit.files.length) {
      const have = new Set(rowsOf<{ id: string }>(await svc(`presence_media?id=in.(${made.kit.files.join(',')})&site_id=eq.${siteId}&deleted_at=is.null&select=id`).catch(() => null)).map((x) => x.id));
      if (made.kit.files.some((id) => !have.has(id))) return json({ error: 'bad_request', message: 'One of those files isn’t in their Files any more — pick again.' }, 400, cors);
    }
    const stored = await updateReservedJson(siteId, RESERVED_NAMES.handoverKit, (cur) => ({ ...made.kit, emailed_at: normalizeKit(cur)?.emailed_at || made.kit.emailed_at }), member.email);
    if (!stored) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
    return json({ data: { kit: normalizeKit(stored) } }, 200, cors);
  }
  if (sub === 'email' && method === 'POST') {
    const kit = normalizeKit(await readReservedJson(siteId, RESERVED_NAMES.handoverKit));
    if (!kit || !kit.shown) return json({ error: 'not_shown', message: 'Put the kit in their portal first, then tell them.' }, 409, cors);
    const owner = await ownerOf(site);
    if (!owner) return json({ error: 'no_owner', message: 'This site has no owner to tell yet. Invite them first.' }, 409, cors);
    if (!(await rateAllow(`kit_email:${siteId}`, 3, 3600))) return tooMany(cors, 3600);
    const own = await deps.ownSite().catch(() => null);
    const brand = own ? await loadEmailBrand(own.id).catch(() => null) : null;
    const studio = brand?.name || 'Your studio';
    const first = owner.name.split(/\s+/)[0] || '';
    const html = ctaEmail(brand?.accent || '#5b3fa0', [
      `${first ? `Hi ${esc(first)}, your` : 'Your'} website kit from ${esc(studio)} is ready.`,
      'It’s under Help in your portal: who to call, how to do the everyday things, and the details of your website in one place.',
    ], { href: `${APP()}/portal.html${own ? `?studio=${own.id}` : ''}`, label: 'Open your portal' }, ['Questions? Just reply to this email.']);
    const subject = `Your website kit from ${studio}`;
    const sent = await sendEmail(owner.email, subject, html, brand || undefined, { siteId: own?.id });
    if (!sent) return json({ error: 'not_sent', message: 'That email didn’t go — their address may have unsubscribed or bounced before.' }, 502, cors);
    const stored = await updateReservedJson(siteId, RESERVED_NAMES.handoverKit, (cur) => ({ ...(cur as object), emailed_at: now }), member.email);
    return json({ data: { kit: normalizeKit(stored) || kit } }, 200, cors);
  }
  return null;
}

/** Plan my week: Home's Needs you plus the week's dated things, by client. */
async function weekPlan(todayRaw: string | null, member: AgencyMember, principal: Principal, now: string, deps: ClientToolsDeps, cors: Record<string, string>): Promise<Response> {
  const today = todayFrom(todayRaw, now), end = addDays(today, WEEK_DAYS - 1);
  let partial = false;
  const soft = <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => { partial = true; return fallback; });
  const [needs, input, own] = await Promise.all([
    soft(deps.needs(), { rows: [], rest: [], snoozed: [] }),
    soft(deps.gather(member.agency_id, now), { links: [], clientNames: {} }),
    soft(deps.ownSite(), null),
  ]);
  if (!own) partial = true;
  const ids = (input.links || []).filter((l) => l.status === 'active').map((l) => l.site_id).filter((x) => UUID_RE.test(x));
  const read = (path: string) => soft(svc(path).then((r) => { if (!r.ok) partial = true; return r; }), null);
  const IN = `in.(${ids.join(',')})`;
  const reserved = [RESERVED_NAMES.intakeForm, RESERVED_NAMES.monthlyReport].map(encodeURIComponent).join(',');
  const [recv, tasks, estQ, recQ, sitesQ, resQ] = await Promise.all([
    own ? soft(loadReceivables(own, today), null) : Promise.resolve(null),
    own ? soft(loadMyTasks(own.id, principal.userId || null), { all: [], partial: true }) : Promise.resolve({ all: [], partial: false }),
    own ? read(`presence_estimates?site_id=eq.${own.id}&status=eq.sent&deleted_at=is.null&expires_at=gte.${today}&expires_at=lt.${addDays(end, 1)}&select=id,deal_id,title,subtotal_cents,expires_at,status&limit=200`) : Promise.resolve(null),
    own ? read(`presence_recurring_invoices?site_id=eq.${own.id}&status=eq.active&deleted_at=is.null&next_on=gte.${today}&next_on=lte.${end}&select=id,deal_id,title,amount_cents,next_on,status&limit=200`) : Promise.resolve(null),
    ids.length ? read(`presence_sites?id=${IN}&select=id,client_id&limit=1000`) : Promise.resolve(null),
    ids.length ? read(`presence_sales_templates?site_id=${IN}&kind=eq.proposal&name=in.(${reserved})&deleted_at=is.null&select=site_id,name,body,updated_at&order=updated_at.desc&limit=2000`) : Promise.resolve(null),
  ]);
  if (tasks.partial) partial = true;
  const estimates = rowsOf<any>(estQ), recurring = rowsOf<any>(recQ);
  // who each deal and project belongs to (the studio's own site holds them)
  const taskList = tasks.all || [];
  const dealIds = [...new Set([...taskList.filter((t) => t.kind !== 'project_task').map((t) => t.parent_id), ...estimates.map((e) => e.deal_id), ...recurring.map((r) => r.deal_id)].filter((x) => UUID_RE.test(String(x))))];
  const projIds = [...new Set(taskList.filter((t) => t.kind === 'project_task').map((t) => t.parent_id).filter((x) => UUID_RE.test(String(x))))];
  const [dealQ, linkQ] = await Promise.all([
    own && dealIds.length ? read(`presence_deals?id=in.(${dealIds.join(',')})&site_id=eq.${own.id}&select=id,title,converted_client_id,converted_site_id`) : Promise.resolve(null),
    own && projIds.length ? read(`presence_service_links?agency_site_id=eq.${own.id}&project_id=in.(${projIds.join(',')})&status=eq.active&select=project_id,customer_client_id,customer_site_id`) : Promise.resolve(null),
  ]);
  const portfolio = new Set(ids);
  const inPortfolio = (s: unknown) => (s && portfolio.has(String(s)) ? String(s) : null);
  const deals: Record<string, { site_id: string | null; client_id: string | null; title?: string }> = {};
  for (const d of rowsOf<any>(dealQ)) deals[String(d.id)] = { site_id: inPortfolio(d.converted_site_id), client_id: d.converted_client_id ? String(d.converted_client_id) : null, title: String(d.title || '') };
  const projects: Record<string, { site_id: string | null; client_id: string | null }> = {};
  for (const l of rowsOf<any>(linkQ)) projects[String(l.project_id)] = { site_id: inPortfolio(l.customer_site_id), client_id: l.customer_client_id ? String(l.customer_client_id) : null };
  const siteOfClient: Record<string, string> = {};
  for (const s of rowsOf<{ id: string; client_id: string | null }>(sitesQ)) if (s.client_id) siteOfClient[String(s.client_id)] = String(s.id);
  // the reserved rows: content forms and monthly-report settings, the newest of each
  const { normalizeReportSetting } = await import('../ops/monthly_report.ts');
  const forms: Parameters<typeof thingsFromIntake>[0] = [], reports: Parameters<typeof thingsFromReports>[0] = [];
  const seen = new Set<string>();
  for (const r of rowsOf<{ site_id: string; name: string; body: string }>(resQ)) {
    if (seen.has(`${r.site_id}:${r.name}`)) continue;
    seen.add(`${r.site_id}:${r.name}`);
    if (r.name === RESERVED_NAMES.intakeForm) { const f = normalizeForm(parseBody(r.body)); if (f) forms.push({ site_id: r.site_id, status: f.status, answered: f.answered, sent_at: f.sent_at, seen_at: f.seen_at, emailed_at: f.emailed_at, created_at: f.created_at }); }
    else { const s = normalizeReportSetting(parseBody(r.body)); reports.push({ site_id: r.site_id, enabled: s.enabled, last_month: s.last_month }); }
  }
  const invoiceDue: Record<string, string | null> = {};
  for (const v of (recv?.items || []) as Array<{ id: string; due_date: string | null }>) invoiceDue[String(v.id)] = v.due_date || null;
  const stepDue: Record<string, string | null> = {};
  for (const t of taskList) if (t.kind === 'next_step') stepDue[t.parent_id] = t.due;
  const needRows = [...(needs.rows || []), ...(needs.rest || [])];
  const things: WeekThing[] = [
    ...thingsFromNeeds(needRows, { invoiceDue, stepDue }, today),
    ...thingsFromTasks(taskList, { deal: deals, project: projects }, today),
    ...thingsFromEstimates(estimates, deals),
    ...thingsFromRecurring(recurring, deals),
    ...thingsFromReports(reports, today),
    ...thingsFromIntake(forms, today),
  ];
  const plan = buildWeek({ today, things, names: input.clientNames || {}, siteOfClient, snoozed: Object.fromEntries((needs.snoozed || []).map((s) => [s.key, s.until])) });
  return json({ data: { ...plan, text: weekAsText(plan), partial } }, 200, cors);
}
