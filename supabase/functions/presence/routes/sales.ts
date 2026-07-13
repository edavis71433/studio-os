// ── Sales & Customer Lifecycle routes (Presence CMS Phase 2, P2-C) ───────────
// One coherent /sales/* resource surface (NOT the legacy 185-route RPC shape):
//   contacts · deals(+stage) · proposals(+send/decide) · contracts(+send/sign)
//   · convert. Every query is site_id-scoped (tenant isolation); send/decide/
//   sign/convert are idempotent. Convert bridges to the existing, idempotent
//   provisionForSignup — no second provisioning path, no legacy data.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { sendEmail, findClientByEmail, createAuthUser, createContactAndClient, deleteAuthUser, generateSetPasswordLink, validEmail } from '../commerce/account.ts';
import { provisionForSignup } from '../commerce/provision.ts';
import { rateAllow, clientIp, tooMany } from '../lib/ratelimit.ts';
import { resolveAgencyMember } from '../agency/auth.ts';
import { ensureProjectForDeal, ensureBridge, linksForCustomer } from '../lib/service_bridge.ts';
import { loadEmailBrand } from '../lib/email_brand.ts';
import { raiseNotice } from '../lib/notice.ts';
import { stripeConfigured, createServicePaymentLink, createServiceRetainerLink, deactivatePaymentLink, cancelSubscription } from '../commerce/stripe.ts';
import { validateRetainerInput, mergeRetainerState, type RetainerState } from '../commerce/retainers.ts';
import type { PlanKey } from '../commerce/catalog.ts';
import { hmacHex, timingSafeEqual } from '../../_shared/hmac.ts';
import { signDocToken, verifyDocToken, renderDocument, type DocKind } from '../lib/documents.ts';
import {
  canTransition, isStage, normalizeLineItems, canDecideProposal, contractHash,
  canSignContract, convertOutcome, clampLimit, type Stage,
  buildPaymentSchedule, depositBalanceStages, equalInstallmentStages, type StageInput,
  summarizePipeline,
  splitLineItems, packLineItems, normalizeProposalMeta, proposalTotals, type ProposalMeta,
} from '../lib/sales_lifecycle.ts';
import {
  isDealActivityKind, activityNeedsBody, cleanActivityBody, normalizeOccurredAt,
  buildActivityDetail, mergeDealTimeline, lastContactedAt, type DealActivityKind,
} from '../crm/deal_activity.ts';
import { composeContactDetail } from '../crm/contact_detail.ts';
import { normalizeFieldDefs, normalizeFieldValues, applyFieldValues, type CustomFieldDef } from '../crm/custom_fields.ts';
import { findPossibleDuplicates } from '../crm/dedupe.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;                       // expected_close: ISO date only
const CONVERT_PLANS = new Set(['presence', 'cms_only', 'business_os_only', 'presence_monitor', 'presence_managed']);
const pickPlan = (p: unknown): PlanKey => (typeof p === 'string' && CONVERT_PLANS.has(p) ? p : 'presence') as PlanKey;
const clean = (s: unknown, max = 500) => String(s ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
const nowIso = () => new Date().toISOString();
// The studio's services catalog lives as ONE reserved template row (kind=proposal,
// this sentinel name) so it reuses the existing site-scoped, deny-all, function-
// mediated sales-templates store with NO new migration. Hidden from the template list.
const SERVICES_CATALOG_NAME = '__services_catalog__';
// The site's contact custom-field DEFINITIONS (≤5 owner-defined labeled fields)
// ride the same reserved-template store as the services catalog — a single row
// (kind=proposal, this sentinel name) whose `body` holds the definitions JSON.
// Site-scoped, deny-all, function-mediated — NO new migration for definitions.
// (Per-contact VALUES live in presence_contacts.custom, migration 0097.)
const CONTACT_FIELDS_NAME = '__crm_contact_fields__';
// A machine marker on a presence_contacts row (site-scoped) that says "this studio
// wants THIS email as a customer — auto-connect them the moment they self-serve
// sign up". The studio IS its presence site, and presence_contacts.site_id is
// exactly the agency_site_id the frozen bridge (ensureBridge) keys on — so this
// needs NO new table. commerce/handleSignup reads this same tag on signup.
export const CONNECT_INTENT_TAG = '[[connect-on-signup]]';
const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const actorOf = (p: Principal) => ({ actor: p.email || p.userId || 'system', actor_kind: p.kind });
const siteUrl = () => (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
const fnBase = () => (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');

// ── signed accept/sign links (reuse the house HMAC idiom; new sales scope) ──
export function linkSecret(): string | null {
  return Deno.env.get('APPROVAL_SECRET') || Deno.env.get('STATE_SIGNING_SECRET') || Deno.env.get('SCHEDULER_SECRET') || null;
}
function b64url(s: string): string { return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s: string): string { const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : ''; return atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad); }
export async function signSalesToken(payload: { t: 'proposal' | 'contract'; id: string; site_id: string; exp: number }, secret: string): Promise<string> {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${await hmacHex(secret, body)}`;
}
async function verifySalesToken(token: string, secret: string, nowSec: number): Promise<{ t: string; id: string; site_id: string; exp: number } | null> {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  if (!timingSafeEqual(parts[1], await hmacHex(secret, parts[0]))) return null;
  let p: any; try { p = JSON.parse(unb64url(parts[0])); } catch { return null; }
  if (!p || (p.t !== 'proposal' && p.t !== 'contract') || !UUID_RE.test(p.id || '') || !UUID_RE.test(p.site_id || '') || typeof p.exp !== 'number') return null;
  if (p.exp < nowSec) return null;
  return p;
}

/** Mint a URL to the branded, printable Document of Record for an artifact. The
 *  page is server-rendered by handleSalesDocument (a signed `doc` token, site_id
 *  inside it) and saved as PDF via the browser. 90-day exp: an emailed copy is a
 *  keepable record, so it outlives the 30-day accept/sign links. Null when no
 *  signing secret is configured. */
async function docLink(kind: DocKind, id: string, siteId: string): Promise<string | null> {
  const secret = linkSecret();
  if (!secret) return null;
  const token = await signDocToken({ t: 'doc', k: kind, id, site_id: siteId, exp: Math.floor(Date.now() / 1000) + 90 * 86400 }, secret);
  return `${fnBase()}/functions/v1/presence/sales/doc/${token}`;
}

// ── deal events (sales audit) + provenance mirror ──
async function dealEvent(siteId: string, dealId: string, kind: string, principal: Principal, extra: Record<string, unknown> = {}) {
  const { actor, actor_kind } = actorOf(principal);
  await svc('presence_deal_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ deal_id: dealId, site_id: siteId, kind, actor, actor_kind, ...extra }) }).catch(() => {});
}

/** R1: auto-advance the deal stage AND record the stage_change (pipeline history
 *  no longer jumps silently). Guarded to `from` stages; only emits when a row moved. */
async function advanceStage(siteId: string, dealId: string, to: Stage, from: Stage[], principal: Principal) {
  const up = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&stage=in.(${from.join(',')})&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ stage: to }) }).catch(() => ({ json: [] } as any));
  if (rows(up)[0]) await dealEvent(siteId, dealId, 'stage_change', principal, { to_stage: to }); // only when a row actually moved
}

// ═══ CONTACTS ═══
export async function handleSalesContacts(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const q = clean(u.searchParams.get('q'), 80).replace(/[(),*"\\]/g, ' ').trim();   // L2: neutralize PostgREST filter grammar
    const limit = clampLimit(u.searchParams.get('limit'));
    const offset = Math.max(0, Math.trunc(Number(u.searchParams.get('offset'))) || 0);
    let path = `presence_contacts?site_id=eq.${site.id}&deleted_at=is.null&select=id,name,email,phone,company,updated_at&order=updated_at.desc&limit=${limit}&offset=${offset}`;
    if (q) path += `&or=(name.ilike.*${encodeURIComponent(q)}*,email.ilike.*${encodeURIComponent(q)}*,company.ilike.*${encodeURIComponent(q)}*)`;
    const r = await svc(path);
    if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t load your contacts just now.' }, 502, cors);
    return json({ data: rows(r), limit, offset }, 200, cors);
  }
  if (req.method === 'POST') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const email = clean(b.email, 160).toLowerCase();
    const name = clean(b.name, 120);
    if (!name && !email) return json({ error: 'validation', message: 'A contact needs a name or an email.' }, 422, cors);
    const phone = clean(b.phone, 40);
    // duplicate protection: reuse an existing contact for this (site, email)
    if (email) {
      const existing = await svc(`presence_contacts?site_id=eq.${site.id}&email=eq.${encodeURIComponent(email)}&deleted_at=is.null&select=id,name,email,phone,company&limit=1`);
      if (existing.ok && rows(existing)[0]) return json({ data: rows(existing)[0], deduped: true }, 200, cors);
    }
    // FUZZY near-duplicate: past the exact-email check, a typo'd re-entry
    // ("Jayne" for "Jane") or an alt format ("Doe, Jane") with the same phone
    // can still be the same person. When the caller opts in (dedupe_check) and
    // hasn't yet confirmed, surface the possible matches for a gentle
    // "Is this the same person as {X}?" prompt — NEVER auto-merge, never block a
    // deliberate save. Bulk CSV import doesn't set the flag (exact-email dedupe
    // already covers its common case), so it stays fast.
    if (b.dedupe_check === true && b.confirm !== true && (name || phone)) {
      const CAP = 1000;
      const pool = rows(await svc(`presence_contacts?site_id=eq.${site.id}&deleted_at=is.null&select=id,name,email,phone,company&limit=${CAP}`));
      const matches = findPossibleDuplicates({ name, phone, email }, pool, 5);
      if (matches.length) return json({ error: 'possible_duplicate', matches, message: `This looks like someone you already have. Is it the same person?` }, 409, cors);
    }
    const ins = await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, name, email, phone, company: clean(b.company, 120), notes: clean(b.notes, 2000) }) });
    if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That contact didn’t save — please try again.' }, 502, cors);
    return json({ data: rows(ins)[0] }, 201, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

// ═══ CONTACT CUSTOM FIELD DEFINITIONS (site-level, ≤5, no migration) ══════════
// The owner's own labeled fields (text/number/date/select) live as ONE reserved
// presence_sales_templates row (kind=proposal, CONTACT_FIELDS_NAME), its `body`
// holding the definitions JSON — reusing the site-scoped, deny-all, function-
// mediated store exactly like the services catalog. Per-contact VALUES live in
// presence_contacts.custom (migration 0097). Studio-gated & site-scoped.
async function loadContactFieldDefs(siteId: string): Promise<CustomFieldDef[]> {
  const row = rows(await svc(`presence_sales_templates?site_id=eq.${siteId}&kind=eq.proposal&name=eq.${encodeURIComponent(CONTACT_FIELDS_NAME)}&deleted_at=is.null&select=body&limit=1`))[0];
  if (!row || !row.body) return [];
  try { return normalizeFieldDefs(JSON.parse(row.body)); } catch { return []; }
}
export async function handleSalesContactFields(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET') return json({ data: await loadContactFieldDefs(site.id) }, 200, cors);
  if (req.method === 'PUT') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    if (!Array.isArray(b.fields)) return json({ error: 'validation', message: 'Send your fields as a list.' }, 422, cors);
    const defs = normalizeFieldDefs(b.fields);                      // caps to ≤5, slugs unique keys, validates types
    const body = JSON.stringify(defs);
    // upsert the ONE reserved row (find-or-create) — a solo operator edits their
    // own field set, no concurrent-writer race to design around.
    const existing = rows(await svc(`presence_sales_templates?site_id=eq.${site.id}&kind=eq.proposal&name=eq.${encodeURIComponent(CONTACT_FIELDS_NAME)}&deleted_at=is.null&select=id&limit=1`))[0];
    const wrote = existing
      ? rows(await svc(`presence_sales_templates?id=eq.${existing.id}&site_id=eq.${site.id}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ body, updated_at: nowIso() }) }))[0]
      : rows(await svc('presence_sales_templates', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: site.id, kind: 'proposal', name: CONTACT_FIELDS_NAME, title: '', body, created_by: principal.email || principal.userId || 'system' }) }))[0];
    if (!wrote) return json({ error: 'write_failed', message: 'Your fields didn’t save — please try again.' }, 502, cors);
    return json({ data: defs }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

// ═══ CONTACT DETAIL (tap a contact → who they are, their deals, their activity) ═
// The read the flat contacts list never had: the contact + their deals (stage +
// value + when last contacted) + a merged recent-activity feed across those
// deals + "last spoke {when}" + their custom-field values. Reuses the deal-
// activity timeline machinery (composeContactDetail) so a contact's activity
// reads identically to a deal's. Site-scoped & studio-gated like every /sales/*.
async function loadContact(siteId: string, id: string) {
  // deploy-order tolerant: `custom` lands with migration 0097 — try the full
  // select, fall back to the pre-0097 shape so a deploy ahead of the migration
  // never breaks the contacts surface (same posture as the deals next_step cols).
  let r = await svc(`presence_contacts?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=id,name,email,phone,company,notes,created_at,updated_at,custom&limit=1`);
  if (!r.ok) r = await svc(`presence_contacts?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=id,name,email,phone,company,notes,created_at,updated_at&limit=1`);
  return rows(r)[0] || null;
}
export async function handleSalesContact(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const contact = await loadContact(site.id, id);
  if (!contact) return json({ error: 'not_found', message: 'That contact is no longer here.' }, 404, cors);

  if (req.method === 'GET') {
    const defs = await loadContactFieldDefs(site.id);
    const deals = rows(await svc(`presence_deals?contact_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,stage,expected_value_cents,expected_close,converted_client_id,updated_at&order=updated_at.desc&limit=100`));
    let events: any[] = [];
    if (deals.length) {
      const ids = deals.map((d: any) => d.id).filter(Boolean);
      events = rows(await svc(`presence_deal_events?site_id=eq.${site.id}&deal_id=in.(${ids.join(',')})&select=id,deal_id,kind,from_stage,to_stage,detail,actor,created_at&order=created_at.desc&limit=200`));
    }
    const composed = composeContactDetail(deals, events, { timelineLimit: 30 });
    const custom = normalizeFieldValues(defs, contact.custom);
    return json({ data: {
      contact: { id: contact.id, name: contact.name, email: contact.email, phone: contact.phone, company: contact.company, notes: contact.notes, created_at: contact.created_at, updated_at: contact.updated_at, custom },
      deals: composed.deals, timeline: composed.timeline, last_contacted_at: composed.last_contacted_at,
      custom_fields: defs,
    } }, 200, cors);
  }

  if (req.method === 'PATCH') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const patch: Record<string, unknown> = {};
    if (b.name !== undefined) patch.name = clean(b.name, 120);
    if (b.phone !== undefined) patch.phone = clean(b.phone, 40);
    if (b.company !== undefined) patch.company = clean(b.company, 120);
    if (b.notes !== undefined) patch.notes = clean(b.notes, 2000);
    if (b.email !== undefined) {
      const email = clean(b.email, 160).toLowerCase();
      if (email && email !== String(contact.email || '').toLowerCase()) {
        // keep the (site, email) uniqueness honest with a plain-language 409
        const dup = rows(await svc(`presence_contacts?site_id=eq.${site.id}&email=eq.${encodeURIComponent(email)}&id=neq.${id}&deleted_at=is.null&select=id&limit=1`))[0];
        if (dup) return json({ error: 'email_taken', message: 'Another contact already uses that email.' }, 409, cors);
      }
      patch.email = email;
    }
    // custom-field values: merge the incoming patch into the stored bag (only
    // defined keys; an empty value clears a field). Validated per type.
    let touchesCustom = false;
    if (b.custom !== undefined) {
      const defs = await loadContactFieldDefs(site.id);
      patch.custom = applyFieldValues(defs, contact.custom, b.custom);
      touchesCustom = true;
    }
    if (!Object.keys(patch).length) return json({ error: 'empty_update' }, 400, cors);
    let up = await svc(`presence_contacts?id=eq.${id}&site_id=eq.${site.id}&select=id,name,email,phone,company,notes,updated_at,custom`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    // deploy-order tolerance: before 0097 the `custom` column doesn't exist — a
    // whole detail save (name/phone/notes) must not 502 over it.
    if (!up.ok && touchesCustom) {
      delete patch.custom;
      up = Object.keys(patch).length
        ? await svc(`presence_contacts?id=eq.${id}&site_id=eq.${site.id}&select=id,name,email,phone,company,notes,updated_at`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) })
        : up;
      if (up.ok) return json({ data: rows(up)[0], warning: 'custom_unavailable', message: 'Saved — custom fields need a quick update before they’ll stick.' }, 200, cors);
    }
    if (!up.ok || !rows(up)[0]) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
    return json({ data: rows(up)[0] }, 200, cors);
  }

  return json({ error: 'method_not_allowed' }, 405, cors);
}

// ═══ PIPELINE SUMMARY (the calm "your numbers" rollup) ═══════════════════════
// The missing pipeline TOTAL: open value, won-this-month, win rate, per-stage —
// computed server-side over ALL the site's deals, because the deals list is PAGED
// (the browser only ever holds a page of ≤100, so it can't total them honestly).
// The pure summarizePipeline does the math; this just fetches the minimal columns.
// Site-scoped & studio-gated like every authed /sales/* route.
export async function handleSalesSummary(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, cors);
  // A solo studio's whole pipeline is small; scan a generous cap. `truncated`
  // tells the truth if we ever hit it — the totals are then a floor, never a
  // fabricated whole-set sum.
  const CAP = 2000;
  const r = await svc(`presence_deals?site_id=eq.${site.id}&deleted_at=is.null&select=stage,expected_value_cents,converted_client_id,converted_at,updated_at&limit=${CAP}`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t total your pipeline just now.' }, 502, cors);
  const deals = rows(r);
  return json({ data: summarizePipeline(deals, nowIso()), truncated: deals.length >= CAP }, 200, cors);
}

// ═══ DEALS ═══
export async function handleSalesDeals(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET') {
    const u = new URL(req.url);
    const stage = u.searchParams.get('stage');
    const q = clean(u.searchParams.get('q'), 80).replace(/[(),*"\\]/g, ' ').trim();   // L2: neutralize PostgREST filter grammar
    const limit = clampLimit(u.searchParams.get('limit'));
    const offset = Math.max(0, Math.trunc(Number(u.searchParams.get('offset'))) || 0);
    // next_step/next_step_at land with migration 0089 — try the full select, fall
    // back to the pre-0089 shape so a deploy ahead of the migration never breaks
    // the pipeline list.
    const baseCols = 'id,title,stage,source,expected_value_cents,expected_close,contact_id,converted_client_id,updated_at';
    const filters = `${stage && isStage(stage) ? `&stage=eq.${stage}` : ''}${q ? `&title.ilike.*${encodeURIComponent(q)}*` : ''}`;
    let r = await svc(`presence_deals?site_id=eq.${site.id}&deleted_at=is.null&select=${baseCols},next_step,next_step_at&order=updated_at.desc&limit=${limit}&offset=${offset}${filters}`);
    if (!r.ok) r = await svc(`presence_deals?site_id=eq.${site.id}&deleted_at=is.null&select=${baseCols}&order=updated_at.desc&limit=${limit}&offset=${offset}${filters}`);
    if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t load your pipeline just now.' }, 502, cors);
    const deals = rows(r);
    // "Last contacted" per card — ONE extra query over the manual activities
    // (kind='note') for the page's deals, folded to the latest occurred_at each.
    // The thing an owner most wants at a glance, without an N+1.
    if (deals.length) {
      try {
        const ids = deals.map((d: any) => d.id).filter(Boolean);
        const acts = rows(await svc(`presence_deal_events?site_id=eq.${site.id}&kind=eq.note&deal_id=in.(${ids.join(',')})&select=deal_id,detail,created_at&order=created_at.desc&limit=1000`));
        const latest: Record<string, string> = {};
        for (const a of acts) {
          const d = a && typeof a.detail === 'object' ? a.detail : null;
          if (!d || !isDealActivityKind(d.activity_kind)) continue;   // manual activities only, not future note kinds
          const at = (typeof d.occurred_at === 'string' && d.occurred_at) || String(a.created_at || '');
          if (at && (!latest[a.deal_id] || at > latest[a.deal_id])) latest[a.deal_id] = at;
        }
        for (const d of deals) d.last_contacted_at = latest[d.id] || null;
      } catch { /* the list still loads without the last-contacted hint */ }
      // Agreement-signed flag per card — ONE query for signed contracts among the
      // page's deals, so a signed deal reads "Agreement signed ✓" instead of the
      // stale "Agreement out" (the drawer already knew; the list badge didn't).
      try {
        const ids = deals.map((d: any) => d.id).filter(Boolean);
        const signed = new Set(rows(await svc(`presence_contracts?site_id=eq.${site.id}&status=eq.signed&deal_id=in.(${ids.join(',')})&deleted_at=is.null&select=deal_id`)).map((c: any) => c.deal_id));
        for (const d of deals) d.agreement_signed = signed.has(d.id);
      } catch { /* badge falls back to the plain stage label */ }
    }
    return json({ data: deals, limit, offset }, 200, cors);
  }
  if (req.method === 'POST') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const title = clean(b.title, 200);
    if (!title) return json({ error: 'validation', message: 'A deal needs a title.' }, 422, cors);
    let contactId: string | null = UUID_RE.test(b.contact_id || '') ? b.contact_id : null;
    if (contactId) { // tenant guard: the contact must belong to this site
      const c = await svc(`presence_contacts?id=eq.${contactId}&site_id=eq.${site.id}&select=id&limit=1`);
      if (!rows(c)[0]) return json({ error: 'bad_contact', message: 'That contact isn’t in this workspace.' }, 422, cors);
    }
    let srcSub: string | null = UUID_RE.test(b.source_submission_id || '') ? b.source_submission_id : null;
    if (srcSub) { const s = await svc(`presence_form_submissions?id=eq.${srcSub}&site_id=eq.${site.id}&select=id&limit=1`); if (!rows(s)[0]) srcSub = null; }
    // P2-F G1 — DEDUPE conversion: a website enquiry becomes at most ONE deal.
    // A second "add to pipeline" click (or a retry) returns the existing deal
    // instead of creating a duplicate.
    if (srcSub) {
      const existing = rows(await svc(`presence_deals?site_id=eq.${site.id}&source_submission_id=eq.${srcSub}&deleted_at=is.null&select=id,title,stage,source,expected_value_cents,expected_close,contact_id,converted_client_id,updated_at&limit=1`))[0];
      if (existing) return json({ data: existing, already_converted: true }, 200, cors);
    }
    const closeDate = b.expected_close ? clean(b.expected_close, 10) : '';
    if (closeDate && !DATE_RE.test(closeDate)) return json({ error: 'validation', message: 'Expected close must be a date (YYYY-MM-DD).' }, 422, cors);
    const ins = await svc('presence_deals', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, contact_id: contactId, title, stage: 'lead',
        source: clean(b.source, 40) || (srcSub ? 'website_form' : 'manual'), source_submission_id: srcSub,
        expected_value_cents: Math.min(1_000_000_00, Math.max(0, Math.trunc(Number(b.expected_value_cents)) || 0)), // R6: bounded like line items
        expected_close: closeDate || null, notes: clean(b.notes, 2000) }) });
    if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That deal didn’t save — please try again.' }, 502, cors);
    const deal = rows(ins)[0];
    // Mark the originating website enquiry converted (system status) so the leads
    // inbox reflects it and it can't be converted again.
    if (srcSub) await svc(`presence_form_submissions?id=eq.${srcSub}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'converted' }) }).catch(() => {});
    await dealEvent(site.id, deal.id, 'created', principal, { to_stage: 'lead', source_submission_id: srcSub });
    return json({ data: deal }, 201, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

async function loadDeal(siteId: string, id: string) {
  const r = await svc(`presence_deals?id=eq.${id}&site_id=eq.${siteId}&deleted_at=is.null&select=*&limit=1`);
  return rows(r)[0] || null;
}

export async function handleSalesDeal(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const deal = await loadDeal(site.id, id);
  if (!deal) return json({ error: 'not_found', message: 'That deal is no longer here.' }, 404, cors);
  if (req.method === 'GET') {
    const [contact, proposals, contracts, events, invoices] = await Promise.all([
      deal.contact_id ? svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${site.id}&select=id,name,email,phone,company,notes&limit=1`) : Promise.resolve({ json: [] }),
      svc(`presence_proposals?deal_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,line_items,subtotal_cents,currency,status,version,sent_at,decided_at&order=created_at.desc`),
      svc(`presence_contracts?deal_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,status,signer_name,signed_at,version,terms_snapshot&order=created_at.desc`),
      svc(`presence_deal_events?deal_id=eq.${id}&site_id=eq.${site.id}&select=id,kind,from_stage,to_stage,detail,actor,created_at&order=created_at.desc&limit=80`),
      svc(`presence_invoices?deal_id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,title,amount_cents,purpose,status,stripe_url,due_date,paid_at,created_at&order=due_date.asc.nullsfirst,created_at.asc`),
    ]);
    const eventRows = rows(events);
    // ONE reverse-chronological timeline: manual activities (call/email/meeting/
    // dated note) + system events live in the same presence_deal_events table, so
    // they merge by EFFECTIVE time (occurred_at for a back-dated log). `events`
    // stays for backward-compat; `timeline` + `last_contacted_at` are the new shape.
    const timeline = mergeDealTimeline(eventRows);
    return json({ data: { deal, contact: rows(contact)[0] || null, proposals: rows(proposals), contracts: rows(contracts), events: eventRows, timeline, last_contacted_at: lastContactedAt(eventRows), invoices: rows(invoices) } }, 200, cors);
  }
  if (req.method === 'PATCH') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const patch: Record<string, unknown> = {};
    if (b.title !== undefined) patch.title = clean(b.title, 200);
    if (b.notes !== undefined) patch.notes = clean(b.notes, 2000);
    if (b.expected_value_cents !== undefined) patch.expected_value_cents = Math.min(1_000_000_00, Math.max(0, Math.trunc(Number(b.expected_value_cents)) || 0));
    if (b.expected_close !== undefined) { const cd = b.expected_close ? clean(b.expected_close, 10) : ''; if (cd && !DATE_RE.test(cd)) return json({ error: 'validation', message: 'Expected close must be a date (YYYY-MM-DD).' }, 422, cors); patch.expected_close = cd || null; }
    if (b.assigned_to !== undefined) patch.assigned_to = UUID_RE.test(b.assigned_to || '') ? b.assigned_to : null;
    // "Next step + when" — the one field that keeps a solo seller's pipeline
    // honest (columns arrive with migration 0089; harmless to omit before then).
    if (b.next_step !== undefined) patch.next_step = clean(b.next_step, 200);
    if (b.next_step_at !== undefined) { const nd = b.next_step_at ? clean(b.next_step_at, 10) : ''; if (nd && !DATE_RE.test(nd)) return json({ error: 'validation', message: 'The next-step date must be a date (YYYY-MM-DD).' }, 422, cors); patch.next_step_at = nd || null; }
    if (!Object.keys(patch).length) return json({ error: 'empty_update' }, 400, cors);
    let up = await svc(`presence_deals?id=eq.${id}&site_id=eq.${site.id}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    // Deploy-order tolerance: before migration 0089 the next-step columns don't
    // exist — a whole Details save (value/close/notes) must not 502 over them.
    if (!up.ok && ('next_step' in patch || 'next_step_at' in patch)) {
      delete patch.next_step; delete patch.next_step_at;
      if (Object.keys(patch).length) up = await svc(`presence_deals?id=eq.${id}&site_id=eq.${site.id}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    }
    if (!up.ok || !rows(up)[0]) return json({ error: 'write_failed' }, 502, cors);
    return json({ data: rows(up)[0] }, 200, cors);
  }
  if (req.method === 'DELETE') {
    // Soft-delete: the deal leaves the pipeline but its history (events,
    // proposals, contracts, invoices) is retained — deleted_at is the same
    // pattern every other soft-deleted entity uses (0074 partial indexes).
    // A converted/won deal is NOT deletable (it produced a real customer).
    if (deal.stage === 'converted' || deal.converted_at) return json({ error: 'won_deal', message: 'This deal became a customer — it can’t be deleted. Manage the customer from Projects.' }, 409, cors);
    const del = await svc(`presence_deals?id=eq.${id}&site_id=eq.${site.id}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ deleted_at: new Date().toISOString() }) });
    if (!del.ok || !rows(del)[0]) return json({ error: 'write_failed' }, 502, cors);
    return json({ data: { ok: true, deleted: true } }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

// ═══ ACTIVITY LOG (quick-log a call / email / meeting / dated note) ═══════════
// The highest-value CRM gap: let a solo owner answer "when did I last talk to
// them, and what did we say?". A manual activity rides the EXISTING
// presence_deal_events ledger as a kind='note' row (permitted since 0074), its
// jsonb `detail` carrying { activity_kind, body, occurred_at } — NO migration.
// It merges with system events into the ONE deal timeline the drawer already
// shows. Studio-gated & site-scoped like every authed /sales/* route.
export async function handleSalesDealActivity(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  const deal = await loadDeal(site.id, id);
  if (!deal) return json({ error: 'not_found', message: 'That deal is no longer here.' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const kind = b.kind as DealActivityKind;
  if (!isDealActivityKind(kind)) return json({ error: 'validation', message: 'Pick a call, email, meeting, or note.' }, 422, cors);
  const body = cleanActivityBody(b.body);
  if (activityNeedsBody(kind) && !body) return json({ error: 'validation', message: 'Write a short note.' }, 422, cors);
  const occurredAt = normalizeOccurredAt(b.occurred_at, nowIso());
  const { actor, actor_kind } = actorOf(principal);
  const ins = await svc('presence_deal_events', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ deal_id: id, site_id: site.id, kind: 'note', actor, actor_kind, detail: buildActivityDetail(kind, body, occurredAt) }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  // Bump the deal so a freshly-contacted deal rises in the pipeline list (best-effort).
  await svc(`presence_deals?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ updated_at: nowIso() }) }).catch(() => {});
  return json({ data: { item: rows(ins)[0], last_contacted_at: occurredAt } }, 201, cors);
}

export async function handleSalesDealStage(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const to = b.to as Stage;
  if (!isStage(to)) return json({ error: 'bad_stage' }, 422, cors);
  const deal = await loadDeal(site.id, id);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  if (deal.stage === to) return json({ data: deal }, 200, cors); // idempotent no-op
  if (!canTransition(deal.stage, to)) return json({ error: 'invalid_transition', message: `A deal can’t move from ${deal.stage} to ${to}.` }, 409, cors);
  const patch: Record<string, unknown> = { stage: to };
  if (to === 'lost') patch.lost_reason = clean(b.reason, 200);
  const up = await svc(`presence_deals?id=eq.${id}&site_id=eq.${site.id}&stage=eq.${deal.stage}&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict', message: 'That deal just changed — refresh and try again.' }, 409, cors); // optimistic: stage guard in WHERE
  await dealEvent(site.id, id, 'stage_change', principal, { from_stage: deal.stage, to_stage: to });
  return json({ data: rows(up)[0] }, 200, cors);
}

// ═══ SAVED TEMPLATES (proposals + contracts) ═══
// Save once, reuse on every deal — the repeat-operator time-saver. Contract bodies
// may carry {{client_name}} / {{deal_title}}, filled from the deal at create time.
async function loadTemplate(siteId: string, id: string, kind: 'proposal' | 'contract') {
  if (!UUID_RE.test(id)) return null;
  return rows(await svc(`presence_sales_templates?id=eq.${id}&site_id=eq.${siteId}&kind=eq.${kind}&deleted_at=is.null&select=*&limit=1`))[0] || null;
}
export async function handleSalesTemplates(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET') {
    // the reserved rows (services catalog + contact field defs) are NOT reusable templates — keep them out of the list
    const r = await svc(`presence_sales_templates?site_id=eq.${site.id}&deleted_at=is.null&name=neq.${encodeURIComponent(SERVICES_CATALOG_NAME)}&name=neq.${encodeURIComponent(CONTACT_FIELDS_NAME)}&select=id,kind,name,title,line_items,updated_at&order=updated_at.desc&limit=100`);
    return r.ok ? json({ data: rows(r) }, 200, cors) : json({ error: 'read_failed' }, 502, cors);
  }
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const kind = b.kind === 'contract' ? 'contract' : b.kind === 'proposal' ? 'proposal' : null;
  if (!kind) return json({ error: 'bad_kind', message: 'A template is a proposal or a contract.' }, 422, cors);
  const name = clean(b.name, 120);
  if (!name) return json({ error: 'validation', message: 'Give the template a name.' }, 422, cors);
  let title = clean(b.title, 200), body = '', line_items: unknown[] = [];
  if (UUID_RE.test(b.from_proposal_id || '')) {   // save an existing proposal as the template
    const p = rows(await svc(`presence_proposals?id=eq.${b.from_proposal_id}&site_id=eq.${site.id}&deleted_at=is.null&select=title,line_items&limit=1`))[0];
    if (!p) return json({ error: 'not_found', message: 'That proposal isn’t here.' }, 404, cors);
    // Keep the items + any discount/tax, but DROP the revise trail (revised_from/
    // superseded_by) — a reusable template isn't a version of anything.
    const sp = splitLineItems(p.line_items);
    title = title || p.title; line_items = packLineItems(sp.items, { discount: sp.meta.discount ?? null, tax_pct: sp.meta.tax_pct ?? null });
  } else if (UUID_RE.test(b.from_contract_id || '')) {   // save an existing contract as the template
    const c = rows(await svc(`presence_contracts?id=eq.${b.from_contract_id}&site_id=eq.${site.id}&deleted_at=is.null&select=title,body&limit=1`))[0];
    if (!c) return json({ error: 'not_found', message: 'That agreement isn’t here.' }, 404, cors);
    title = title || c.title; body = String(c.body || '');
  } else {
    body = clean(b.body, 50000);
    if (kind === 'proposal') { const norm = normalizeLineItems(b.line_items); if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors); line_items = norm.items; }
    if (kind === 'contract' && !body) return json({ error: 'validation', message: 'A contract template needs the agreement text.' }, 422, cors);
  }
  const ins = await svc('presence_sales_templates', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, kind, name, title, body, line_items, created_by: principal.email || principal.userId || 'system' }) });
  return (ins.ok && rows(ins)[0]) ? json({ data: rows(ins)[0] }, 201, cors) : json({ error: 'write_failed' }, 502, cors);
}
export async function handleSalesTemplateDelete(site: SiteRow, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const up = await svc(`presence_sales_templates?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ deleted_at: nowIso() }) });
  return rows(up)[0] ? json({ data: { ok: true } }, 200, cors) : json({ error: 'not_found' }, 404, cors);
}
// ═══ STUDIO SERVICES CATALOG ═════════════════════════════════════════════════
// The studio's own sellable services (name + price) — the palette a proposal line
// item is picked from. Stored as ONE reserved template row (kind=proposal, the
// SERVICES_CATALOG_NAME sentinel) so it reuses the existing site-scoped, deny-all,
// function-mediated sales-templates store — NO new migration. Services are kept in
// the same LineItem shape the store already holds ({ label, qty, unit_cents });
// the API speaks { name, price_cents } to the UI. Site-scoped like every /sales/*.
async function loadServicesCatalog(siteId: string): Promise<Array<{ name: string; price_cents: number }>> {
  const row = rows(await svc(`presence_sales_templates?site_id=eq.${siteId}&kind=eq.proposal&name=eq.${encodeURIComponent(SERVICES_CATALOG_NAME)}&deleted_at=is.null&select=id,line_items&limit=1`))[0];
  const items = row && Array.isArray(row.line_items) ? row.line_items : [];
  return items
    .map((i: any) => ({ name: String(i?.label || ''), price_cents: Math.max(0, Math.trunc(Number(i?.unit_cents)) || 0) }))
    .filter((s: any) => s.name);
}
export async function handleSalesServices(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET') return json({ data: await loadServicesCatalog(site.id) }, 200, cors);
  if (req.method === 'PUT') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    if (!Array.isArray(b.services)) return json({ error: 'validation', message: 'Send your services as a list.' }, 422, cors);
    if (b.services.length > 40) return json({ error: 'validation', message: 'You can keep up to 40 services here.' }, 422, cors);
    // clean + bound each; drop blank-name rows (an empty row left behind in the editor)
    const items: Array<{ label: string; qty: number; unit_cents: number }> = [];
    for (const s of b.services) {
      const name = clean(s?.name, 120);                                            // ≤120, control-char stripped (same as line items)
      if (!name) continue;
      const price = Math.min(1_000_000_00, Math.max(0, Math.trunc(Number((s as any)?.price_cents)) || 0)); // 0–$1,000,000
      items.push({ label: name, qty: 1, unit_cents: price });
    }
    // upsert the ONE reserved row (find-or-create). A single studio operator edits
    // their own catalog — no concurrent-writer race to design around.
    const existing = rows(await svc(`presence_sales_templates?site_id=eq.${site.id}&kind=eq.proposal&name=eq.${encodeURIComponent(SERVICES_CATALOG_NAME)}&deleted_at=is.null&select=id&limit=1`))[0];
    const wrote = existing
      ? rows(await svc(`presence_sales_templates?id=eq.${existing.id}&site_id=eq.${site.id}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ line_items: items, updated_at: nowIso() }) }))[0]
      : rows(await svc('presence_sales_templates', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: site.id, kind: 'proposal', name: SERVICES_CATALOG_NAME, title: '', line_items: items, created_by: principal.email || principal.userId || 'system' }) }))[0];
    if (!wrote) return json({ error: 'write_failed', message: 'Your services didn’t save — please try again.' }, 502, cors);
    return json({ data: items.map((i) => ({ name: i.label, price_cents: i.unit_cents })) }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

/** Fill {{client_name}} / {{deal_title}} from the deal. */
async function fillPlaceholders(siteId: string, deal: any, text: string): Promise<string> {
  let clientName = '';
  try { if (deal.contact_id) clientName = rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${siteId}&select=name&limit=1`))[0]?.name || ''; } catch { /* best-effort */ }
  return text.replace(/\{\{\s*client_name\s*\}\}/g, clientName || 'the client').replace(/\{\{\s*deal_title\s*\}\}/g, String(deal.title || 'the project'));
}

// ═══ PROPOSALS ═══
export async function handleSalesProposalCreate(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  if (b.template_id) {   // one-tap: draft from a saved template
    const t = await loadTemplate(site.id, String(b.template_id), 'proposal');
    if (!t) return json({ error: 'not_found', message: 'That template isn’t here.' }, 404, cors);
    b = { ...b, line_items: t.line_items, title: b.title || t.title || t.name };
  }
  const norm = normalizeLineItems(b.line_items);
  if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors);
  // Discount + tax: the owner's fields win; otherwise carry any pricing a template
  // brought in via its line_items (never the revise trail on a plain create).
  const bodyMeta = normalizeProposalMeta(b);
  const tplMeta = splitLineItems(b.line_items).meta;
  const meta: ProposalMeta = { discount: bodyMeta.discount ?? tplMeta.discount ?? null, tax_pct: bodyMeta.tax_pct ?? tplMeta.tax_pct ?? null };
  const ins = await svc('presence_proposals', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, deal_id: dealId, title: clean(b.title, 200) || 'Proposal',
      line_items: packLineItems(norm.items, meta), subtotal_cents: norm.subtotal_cents, currency: clean(b.currency, 8) || 'usd',
      terms: clean(b.terms, 5000), status: 'draft' }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed' }, 502, cors);
  return json({ data: rows(ins)[0] }, 201, cors);
}

// ═══ REVISE (versioning) — clone a sent/declined proposal as vN+1 ═════════════
// Renegotiation is universal, but a sent/declined proposal was a dead end. Revise
// creates a NEW draft proposal on the SAME deal at version = prior.version + 1,
// carrying the prior's line items, discount/tax, terms and title (the editor may
// have edited any of them), records the trail (new.revised_from → prior), and
// stamps the prior as superseded (prior.superseded_by → new). Supersession lives
// in the reserved line_items meta — no status-enum migration on a live table — and
// is enforced at decide time so the prior's public link can never be accepted once
// it's been replaced. Studio-gated & site-scoped like every authed /sales/* route.
export async function handleSalesProposalRevise(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const prior = rows(await svc(`presence_proposals?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`))[0];
  if (!prior) return json({ error: 'not_found', message: 'That proposal isn’t here.' }, 404, cors);
  if (prior.status !== 'sent' && prior.status !== 'declined') return json({ error: 'bad_state', message: 'Only a proposal you’ve sent (or one the client declined) can be revised.' }, 409, cors);
  const priorSplit = splitLineItems(prior.line_items);
  if (priorSplit.meta.superseded_by) return json({ error: 'already_revised', message: 'This proposal was already revised — edit the newest version instead.' }, 409, cors);
  let b: any = {}; try { b = await req.json(); } catch { /* body optional — a blank body clones the prior as-is */ }
  // Edited data from the drawer editor, else clone the prior's exactly.
  const rawItems = (b.line_items !== undefined) ? b.line_items : priorSplit.items;
  const norm = normalizeLineItems(rawItems);
  if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors);
  const bodyMeta = normalizeProposalMeta(b);
  const meta: ProposalMeta = {
    discount: (b.discount !== undefined) ? (bodyMeta.discount ?? null) : (priorSplit.meta.discount ?? null),
    tax_pct: (b.tax_pct !== undefined) ? (bodyMeta.tax_pct ?? null) : (priorSplit.meta.tax_pct ?? null),
    revised_from: id,
  };
  const newVersion = (Math.trunc(Number(prior.version)) || 1) + 1;
  const title = clean(b.title, 200) || prior.title || 'Proposal';
  const terms = (b.terms !== undefined) ? clean(b.terms, 5000) : String(prior.terms || '');
  const ins = await svc('presence_proposals', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, deal_id: prior.deal_id, title,
      line_items: packLineItems(norm.items, meta), subtotal_cents: norm.subtotal_cents,
      currency: prior.currency || 'usd', terms, status: 'draft', version: newVersion }) });
  const created = rows(ins)[0];
  if (!created) return json({ error: 'write_failed', message: 'The revision didn’t save — please try again.' }, 502, cors);
  // Stamp the prior superseded (merge into ITS meta — keeps its own items+pricing).
  // Best-effort: the new draft is authoritative; the decide guard also protects the
  // prior via the new proposal's trail, so a missed stamp can't be accepted twice.
  const priorPacked = packLineItems(priorSplit.items, { ...priorSplit.meta, superseded_by: created.id });
  await svc(`presence_proposals?id=eq.${id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ line_items: priorPacked }) }).catch(() => {});
  // No dedicated deal event: the version trail (prior shown Superseded → the new
  // vN+1 draft) is the visible record, and presence_deal_events has no 'revised'
  // kind (its CHECK constraint would reject one, and a generic 'note' reads wrong).
  return json({ data: created, revised_from: id, version: newVersion }, 201, cors);
}

/** Auto-email a signed proposal/contract link to the deal's contact, so "Send"
 *  is one click — not send → copy link → switch to email → paste → send. Uses
 *  the STUDIO's brand (never the platform name — secrecy rule). Best-effort: it
 *  never blocks the send; the link is still returned for manual sharing, and it
 *  no-ops cleanly when the contact has no email or email isn't configured. */
async function emailSalesDoc(siteId: string, dealId: string | null, kind: 'proposal' | 'contract', url: string | null): Promise<boolean> {
  if (!url || !dealId) return false;
  try {
    const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&select=contact_id&limit=1`))[0];
    const email = deal?.contact_id ? rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${siteId}&select=email&limit=1`))[0]?.email : '';
    if (!email) return false;
    const brand = await loadEmailBrand(siteId);
    const subject = kind === 'contract' ? 'Your agreement is ready to sign' : 'Your proposal is ready to review';
    const line = kind === 'contract'
      ? 'Your studio has prepared an agreement for you. Review and sign it here — nothing is final until you do.'
      : 'Your studio has prepared a proposal for you. Take a look whenever you’re ready — nothing is final until you accept.';
    const label = kind === 'contract' ? 'Review &amp; sign →' : 'Review the proposal →';
    const btn = `<a href="${url}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">${label}</a>`;
    return await sendEmail(String(email), subject, `<p>${line}</p><p class="cta">${btn}</p>`, brand, { critical: true });   // a doc THEY are waiting to sign = transactional
  } catch { return false; }
}

/** Email the customer their invoice/deposit pay link, on the studio's brand. Best-effort. */
async function emailInvoice(siteId: string, dealId: string, title: string, url: string, amountCents: number, invoiceId?: string): Promise<boolean> {
  try {
    const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&select=contact_id&limit=1`))[0];
    const email = deal?.contact_id ? rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${siteId}&select=email&limit=1`))[0]?.email : '';
    if (!email) return false;
    const brand = await loadEmailBrand(siteId);
    const amount = '$' + (amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const btn = `<a href="${url}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Pay ${amount} securely →</a>`;
    // Operator-typed title → escape it (it lands inside HTML) and mind the article.
    const safeTitle = title.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
    const article = /^[aeiou]/i.test(title) ? 'an' : 'a';
    // A branded, printable copy of the invoice (a keepable record alongside the pay link).
    const doc = invoiceId ? await docLink('invoice', invoiceId, siteId) : null;
    const docLine = doc ? `<p style="margin-top:6px"><a href="${doc}" style="color:${brand.accentDark}">View / print your copy →</a></p>` : '';
    return await sendEmail(String(email), `${title} — ${amount}`, `<p>Your studio has sent you ${article} ${safeTitle.toLowerCase()} for <strong>${amount}</strong>. You can pay securely here — nothing else needed.</p><p class="cta">${btn}</p>${docLine}`, brand, { critical: true });   // a payment link = transactional
  } catch { return false; }
}

/** Turn a deal (its accepted proposal, or an explicit amount) into a payable invoice
 *  or deposit: create the presence_invoices row, generate a non-expiring Stripe
 *  payment link, email the customer, record the event. Service billing — kept
 *  separate from the SaaS subscription, on the one Stripe authority. */
export async function handleSalesInvoice(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  if (!stripeConfigured()) return json({ error: 'unavailable', message: 'Connect Stripe before sending invoices.' }, 503, cors);
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { /* body optional */ }
  let amountCents: number | null = Number.isFinite(Number(b.amount_cents)) ? Math.trunc(Number(b.amount_cents)) : null;
  if (amountCents === null) {   // default to the accepted proposal's FINAL total (post discount + tax)
    const prop = rows(await svc(`presence_proposals?deal_id=eq.${dealId}&site_id=eq.${site.id}&status=eq.accepted&deleted_at=is.null&select=line_items,subtotal_cents&order=decided_at.desc&limit=1`))[0];
    amountCents = prop ? proposalTotals(prop.line_items).total_cents : null;
  }
  if (!amountCents || amountCents < 50) return json({ error: 'validation', message: 'Enter an amount to invoice (or accept a proposal first).' }, 422, cors);
  if (amountCents > 100000000) return json({ error: 'validation', message: 'That amount is over $1,000,000 — double-check it and try again.' }, 422, cors);
  const purpose = b.purpose === 'deposit' ? 'deposit' : 'service';
  const title = clean(b.title, 200) || (purpose === 'deposit' ? 'Deposit' : 'Invoice');
  const description = clean(b.description, 1000) || `${title} — ${deal.title || 'project'}`;
  const dueDate = (typeof b.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date)) ? b.due_date : null;

  // IDEMPOTENT: a double-tap (or a retry after a link failure) must never mint a
  // second open invoice. Reuse the existing open row for this deal+purpose —
  // repair its missing link if that's why the operator is retrying.
  // (Deliberate tradeoff: no DB unique index on open deal+purpose, because
  // `force: true` legitimately opens a second one — e.g. milestone 2 while
  // milestone 1 is still unpaid. A simultaneous double-POST race can therefore
  // still double-insert; the UI path can't produce it.)
  let inv = rows(await svc(`presence_invoices?deal_id=eq.${dealId}&site_id=eq.${site.id}&purpose=eq.${purpose}&status=eq.open&deleted_at=is.null&select=*&order=created_at.desc&limit=1`))[0];
  let reused = !!inv;
  if (inv && b.force === true) { reused = false; inv = null; }   // explicit "yes, another one"
  // HONESTY GUARD: an open invoice exists and the operator typed a DIFFERENT
  // amount — never silently send the old amount. Tell them, let them choose.
  if (inv && b.amount_cents !== undefined && Number(inv.amount_cents) !== amountCents) {
    const openAmt = '$' + ((Number(inv.amount_cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
    return json({ error: 'amount_mismatch', open_invoice: inv, message: `There's already an open ${purpose === 'deposit' ? 'deposit request' : 'invoice'} for ${openAmt} on this deal. Resend that one, or send another for the new amount.` }, 409, cors);
  }
  if (!inv) {
    const ins = await svc('presence_invoices', { method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ site_id: site.id, deal_id: dealId, customer_client_id: deal.converted_client_id || null, customer_site_id: deal.converted_site_id || null, title, description, amount_cents: amountCents, currency: 'usd', purpose, status: 'open', due_date: dueDate, created_by: principal.email || principal.userId || 'system' }) });
    inv = rows(ins)[0];
    if (!inv) return json({ error: 'write_failed', message: 'That invoice didn’t save — please try again.' }, 502, cors);
  }
  let payUrl: string | null = inv.stripe_url || null;
  let repaired = false;
  if (!payUrl) {
    try {
      // Use the STORED row's description so a retry sends Stripe identical params
      // under the per-row idempotency key (changed params + same key = hard error).
      const link = await createServicePaymentLink({ amountCents: Number(inv.amount_cents), currency: 'usd', description: String(inv.description || description), invoiceId: inv.id });
      payUrl = link.url; repaired = true;
      await svc(`presence_invoices?id=eq.${inv.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ stripe_url: link.url, stripe_payment_link_id: link.id }) });
    } catch {
      return json({ data: { ...inv, stripe_url: null }, warning: 'link_failed', message: 'Invoice saved, but the payment link didn’t generate — tap Send again (it will finish this same invoice, not make another).' }, 200, cors);
    }
  }
  // Email throttle: a reuse within 2 minutes of the last touch is a double-tap,
  // not a deliberate resend — don't send the client two identical emails.
  const lastTouch = Date.parse(String(inv.updated_at || inv.created_at || '')) || 0;
  const doubleTap = reused && !repaired && (Date.now() - lastTouch) < 120000;
  const emailed = doubleTap ? false : await emailInvoice(site.id, dealId, String(inv.title || title), payUrl, Number(inv.amount_cents), inv.id);
  if (!doubleTap) await svc(`presence_invoices?id=eq.${inv.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ updated_at: nowIso() }) }).catch(() => {});
  // `repaired` = the FIRST attempt's link failed before its event could be
  // recorded — the retry that completes it must write the history line.
  if (!reused || repaired) await dealEvent(site.id, dealId, 'invoice_sent', principal, { detail: { invoice_id: inv.id, amount_cents: Number(inv.amount_cents), purpose } });
  return json({ data: { ...inv, stripe_url: payUrl }, url: payUrl, emailed, reused, amount_cents: Number(inv.amount_cents) }, reused ? 200 : 201, cors);
}

/** PAYMENT SCHEDULE — turn a deal total into an ordered set of STAGED invoices
 *  (deposit + balance, or N milestone installments). Pure composition over the
 *  existing invoice model: each stage is an ordinary presence_invoices row (its
 *  own Stripe link + reminder sweep + independent webhook settlement), grouped by
 *  deal_id and ordered by due_date — NO new table/column/migration. The stage math
 *  (sum == total, remainder-on-last, non-decreasing dates, ≤12 stages) is the pure
 *  buildPaymentSchedule; this handler just mints the rows and links/emails the
 *  first (due-now) stage. Later stages are sent on demand (see handleSalesInvoiceSend).
 *  Guarded: refuses if the deal already carries live invoices, so a plan is never
 *  a second, double-billing money source. */
export async function handleSalesSchedule(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  if (!stripeConfigured()) return json({ error: 'unavailable', message: 'Connect Stripe before setting up a payment plan.' }, 503, cors);
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }

  // Total to schedule: explicit > accepted proposal subtotal > the deal's own value.
  let total: number | null = Number.isFinite(Number(b.total_cents)) ? Math.trunc(Number(b.total_cents)) : null;
  if (total === null) {
    const prop = rows(await svc(`presence_proposals?deal_id=eq.${dealId}&site_id=eq.${site.id}&status=eq.accepted&deleted_at=is.null&select=line_items,subtotal_cents&order=decided_at.desc&limit=1`))[0];
    total = prop ? proposalTotals(prop.line_items).total_cents : (Number(deal.expected_value_cents) || null);
  }
  if (!total || total < 50) return json({ error: 'validation', message: 'Set the total to schedule — accept a proposal, set the deal value, or enter an amount.' }, 422, cors);

  // Compose the stage list from the friendly spec (or a raw stages array the
  // preview already computed). The pure builder is authoritative either way.
  let stages: StageInput[];
  if (Array.isArray(b.stages)) stages = b.stages as StageInput[];
  else if (b.mode === 'installments') stages = equalInstallmentStages({ total_cents: total, count: Number(b.count), first_due_date: b.first_due_date ?? null, interval_days: Number(b.interval_days) });
  else stages = depositBalanceStages({ deposit_type: b.deposit_type === 'amount' ? 'amount' : 'percent', deposit_value: Number(b.deposit_value), deposit_due_date: b.deposit_due_date ?? null, balance_due_date: b.balance_due_date ?? null });

  const built = buildPaymentSchedule(total, stages);
  if (!built.ok) return json({ error: 'validation', message: built.error }, 422, cors);

  // A plan is the single money source for the deal — refuse if live invoices
  // already exist (never double-bill). Voided ones don't count.
  const existing = rows(await svc(`presence_invoices?deal_id=eq.${dealId}&site_id=eq.${site.id}&status=in.(open,paid)&deleted_at=is.null&select=id&limit=1`))[0];
  if (existing) return json({ error: 'schedule_exists', message: 'This deal already has invoices — settle or remove them before setting up a payment plan.' }, 409, cors);

  // Mint every stage in ONE bulk insert (atomic: all rows or none).
  const insBody = built.stages.map((s) => ({
    site_id: site.id, deal_id: dealId, customer_client_id: deal.converted_client_id || null, customer_site_id: deal.converted_site_id || null,
    title: s.label, description: `${s.label} — ${deal.title || 'project'}`, amount_cents: s.amount_cents, currency: 'usd',
    purpose: s.purpose, status: 'open', due_date: s.due_date, created_by: principal.email || principal.userId || 'system',
  }));
  const ins = await svc('presence_invoices', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(insBody) });
  const created = rows(ins);
  if (created.length !== built.stages.length) return json({ error: 'write_failed', message: 'The payment plan didn’t save — please try again.' }, 502, cors);

  // Link the FIRST (due-now) stage now and email it — the deposit is payable
  // immediately, exactly like today's single deposit. Later stages get their link
  // ON DEMAND when the operator sends them (handleSalesInvoiceSend); the reminder
  // sweep then nudges any sent-but-unpaid stage as its due date arrives.
  const sendFirst = b.send_first !== false;
  const first = created[0];
  let emailed = false, linked = false;
  if (sendFirst && first) {
    try {
      const link = await createServicePaymentLink({ amountCents: Number(first.amount_cents), currency: 'usd', description: String(first.description || first.title), invoiceId: first.id });
      await svc(`presence_invoices?id=eq.${first.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ stripe_url: link.url, stripe_payment_link_id: link.id }) });
      first.stripe_url = link.url; linked = true;
      emailed = await emailInvoice(site.id, dealId, String(first.title), link.url, Number(first.amount_cents), first.id);
      await dealEvent(site.id, dealId, 'invoice_sent', principal, { detail: { invoice_id: first.id, amount_cents: Number(first.amount_cents), purpose: first.purpose, schedule: true } });
    } catch { /* the plan is saved; the first stage's link can be generated later via Send */ }
  }
  const view = created.map((c) => ({ id: c.id, label: c.title, amount_cents: Number(c.amount_cents), due_date: c.due_date || null, purpose: c.purpose, status: c.status, stripe_url: c.stripe_url || null }));
  return json({ data: { stages: view, total_cents: built.total_cents, count: view.length, linked, emailed } }, 201, cors);
}

/** Send (or resend) ONE existing invoice — the per-stage action a payment plan
 *  needs (e.g. "bill the balance now that the milestone is reached"). Reuses the
 *  exact single-invoice primitives: generate the Stripe link on demand if missing,
 *  email the client on the studio's brand, record the history line. Idempotent and
 *  double-tap-throttled like handleSalesInvoice. Works for ANY open invoice, so a
 *  plan stage and a one-off invoice share one send path (no parallel system). */
export async function handleSalesInvoiceSend(req: Request, site: SiteRow, principal: Principal, invoiceId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(invoiceId)) return json({ error: 'bad_request' }, 400, cors);
  if (!stripeConfigured()) return json({ error: 'unavailable', message: 'Connect Stripe before sending invoices.' }, 503, cors);
  const inv = rows(await svc(`presence_invoices?id=eq.${invoiceId}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`))[0];
  if (!inv) return json({ error: 'not_found', message: 'That invoice is no longer here.' }, 404, cors);
  if (inv.status !== 'open') return json({ error: 'bad_state', message: inv.status === 'paid' ? 'That stage is already paid.' : 'That invoice isn’t open.' }, 409, cors);
  const hadLink = !!inv.stripe_url;
  let payUrl: string | null = inv.stripe_url || null;
  let repaired = false;
  if (!payUrl) {
    try {
      const link = await createServicePaymentLink({ amountCents: Number(inv.amount_cents), currency: 'usd', description: String(inv.description || inv.title || 'Invoice'), invoiceId: inv.id });
      payUrl = link.url; repaired = true;
      await svc(`presence_invoices?id=eq.${inv.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ stripe_url: link.url, stripe_payment_link_id: link.id }) });
    } catch {
      return json({ data: { ...inv, stripe_url: null }, warning: 'link_failed', message: 'The payment link didn’t generate — tap Send again (it finishes this same stage).' }, 200, cors);
    }
  }
  // A resend within 2 minutes of the last touch is a double-tap, not a deliberate
  // resend — don't send the client two identical emails.
  const lastTouch = Date.parse(String(inv.updated_at || inv.created_at || '')) || 0;
  const doubleTap = hadLink && !repaired && (Date.now() - lastTouch) < 120000;
  const emailed = doubleTap ? false : await emailInvoice(site.id, inv.deal_id, String(inv.title || 'Invoice'), payUrl!, Number(inv.amount_cents), inv.id);
  if (!doubleTap) await svc(`presence_invoices?id=eq.${inv.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ updated_at: nowIso() }) }).catch(() => {});
  // First real send (or a link repair) writes the history line; a plain resend doesn't spam it.
  if ((!hadLink || repaired) && inv.deal_id) await dealEvent(site.id, inv.deal_id, 'invoice_sent', principal, { detail: { invoice_id: inv.id, amount_cents: Number(inv.amount_cents), purpose: inv.purpose } });
  return json({ data: { ...inv, stripe_url: payUrl }, url: payUrl, emailed, resent: hadLink && !repaired }, 200, cors);
}

/** Email the client their non-expiring retainer authorization link, on the
 *  studio's brand. Best-effort — it never blocks setup; the link is still returned. */
async function emailRetainerLink(siteId: string, dealId: string, url: string, amountCents: number, interval: 'month' | 'year'): Promise<boolean> {
  try {
    const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&select=contact_id&limit=1`))[0];
    const email = deal?.contact_id ? rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${siteId}&select=email&limit=1`))[0]?.email : '';
    if (!email) return false;
    const brand = await loadEmailBrand(siteId);
    const amount = '$' + (amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 });
    const per = interval === 'year' ? 'year' : 'month';
    const btn = `<a href="${url}" style="display:inline-block;margin-top:6px;background:${brand.accent};color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Set up your ${amount}/${per} retainer →</a>`;
    return await sendEmail(String(email), `Your retainer — ${amount} every ${per}`,
      `<p>Your studio has set up an ongoing retainer of <strong>${amount} every ${per}</strong>. You authorize it securely through Stripe — you’re always in control, and you can cancel any time.</p><p class="cta">${btn}</p>`,
      brand, { critical: true });   // a payment authorization the client is expecting = transactional
  } catch { return false; }
}

/** RETAINER — set up recurring SERVICE billing on a deal: "$X every month/year".
 *  Starts a Stripe recurring subscription tagged with a SERVICE purpose (metadata),
 *  DISTINCT from the customer's SaaS subscription. The client authorizes via Stripe
 *  (their consent) exactly like existing service payments — nothing is auto-charged.
 *  State lives on the deal (presence_deals.retainer jsonb, 0096) so no SaaS
 *  lifecycle can ever touch it. ONE calm toggle — never a plan-builder. */
export async function handleSalesRetainer(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  if (!stripeConfigured()) return json({ error: 'unavailable', message: 'Connect Stripe before setting up a retainer.' }, 503, cors);
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const v = validateRetainerInput(b.amount_cents, b.interval);
  if (!v.ok) return json({ error: 'validation', message: v.error }, 422, cors);
  const prior: Partial<RetainerState> | null = (deal.retainer && typeof deal.retainer === 'object') ? deal.retainer : null;
  // One retainer at a time — a live one must be canceled before starting another
  // (never two recurring charges on one deal).
  if (prior && (prior.status === 'active' || prior.status === 'past_due')) {
    return json({ error: 'retainer_exists', retainer: prior, message: 'This deal already has an active retainer. Cancel it before starting a new one.' }, 409, cors);
  }
  // A still-PENDING retainer at the same amount+interval → return the existing link
  // (idempotent re-tap), never mint a second Stripe link.
  if (prior && prior.status === 'pending' && Number(prior.amount_cents) === v.value.amount_cents && prior.interval === v.value.interval && prior.checkout_url) {
    return json({ data: { retainer: prior, url: prior.checkout_url, reused: true } }, 200, cors);
  }
  const now = nowIso();
  // Seed a PENDING marker FIRST — this write gates on the 0096 column, so BEFORE
  // any Stripe object is created it fails fast on a pre-migration environment
  // (never an orphan subscription). Idempotent shape via mergeRetainerState.
  const pending = mergeRetainerState((prior && prior.status === 'canceled') ? null : prior, {
    status: 'pending', amount_cents: v.value.amount_cents, interval: v.value.interval,
    stripe_subscription_id: null, stripe_customer_id: null, stripe_payment_link_id: null,
    checkout_url: null, current_period_end: null, canceled_at: null, created_at: now,
  }, now);
  const seed = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ retainer: pending }) });
  if (!seed.ok || !rows(seed)[0]) return json({ error: 'unavailable', message: 'Retainers need a one-time database update before they can be set up.' }, 503, cors);
  // Create the non-expiring recurring authorization link (client authorizes via Stripe).
  let link: { url: string; id: string; priceId: string };
  try {
    link = await createServiceRetainerLink({ productName: `Retainer — ${deal.title || 'ongoing work'}`, amountCents: v.value.amount_cents, interval: v.value.interval, dealId, siteId: site.id });
  } catch (e) {
    // Roll the pending marker back so the deal never shows a broken retainer.
    await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ retainer: prior && prior.status !== 'canceled' ? prior : null }) }).catch(() => {});
    return json({ error: 'link_failed', message: 'We couldn’t set up the retainer link — please try again.', detail: String((e as Error).message || e) }, 502, cors);
  }
  const withLink = mergeRetainerState(pending, { stripe_payment_link_id: link.id, checkout_url: link.url }, now);
  await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ retainer: withLink }) });
  const emailed = await emailRetainerLink(site.id, dealId, link.url, v.value.amount_cents, v.value.interval);
  return json({ data: { retainer: withLink, url: link.url, emailed } }, 201, cors);
}

/** Cancel a deal's retainer: stop future Stripe billing (cancel the subscription,
 *  or deactivate the pending authorization link) and mark it canceled. Never
 *  refunds or touches past charges. Idempotent. */
export async function handleSalesRetainerCancel(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  const prior: Partial<RetainerState> | null = (deal.retainer && typeof deal.retainer === 'object') ? deal.retainer : null;
  if (!prior || prior.status === 'canceled') return json({ data: { retainer: prior || null, canceled: true, already: true } }, 200, cors);
  const now = nowIso();
  if (prior.stripe_subscription_id) {
    const r = await cancelSubscription(String(prior.stripe_subscription_id));
    if (!r.ok) return json({ error: 'cancel_failed', message: 'We couldn’t cancel the retainer with Stripe just now — please try again.', detail: r.error }, 502, cors);
  } else if (prior.stripe_payment_link_id) {
    await deactivatePaymentLink(String(prior.stripe_payment_link_id));   // pending: kill the link so no one authorizes it
  }
  const next = mergeRetainerState(prior, { status: 'canceled', canceled_at: now }, now);
  const up = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ retainer: next }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'write_failed' }, 502, cors);
  return json({ data: { retainer: next, canceled: true } }, 200, cors);
}

/** Set (or clear) the renewal / expiry date on a SIGNED agreement. Stored in the
 *  contract's existing terms_snapshot jsonb (no new column). A distinct
 *  'agreement_renewal' owner reminder (commerce/lifecycle.ts) then nudges before it
 *  lapses — never an auto-renew. Signed-only, so the immutable content_hash is
 *  untouched (terms_snapshot is a side annotation, not part of the signed bytes). */
export async function handleSalesContractTerm(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const c = rows(await svc(`presence_contracts?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id,terms_snapshot,status&limit=1`))[0];
  if (!c) return json({ error: 'not_found', message: 'That agreement isn’t here.' }, 404, cors);
  if (c.status !== 'signed') return json({ error: 'not_signed', message: 'Add a renewal date once the agreement is signed.' }, 409, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const raw = typeof b.term_end === 'string' ? b.term_end.trim() : '';
  if (raw && !DATE_RE.test(raw)) return json({ error: 'validation', message: 'The renewal date must be a date (YYYY-MM-DD).' }, 422, cors);
  const terms = (c.terms_snapshot && typeof c.terms_snapshot === 'object') ? { ...c.terms_snapshot } : {};
  if (raw) terms.term_end = raw; else delete terms.term_end;
  const up = await svc(`presence_contracts?id=eq.${id}&site_id=eq.${site.id}&select=id,terms_snapshot`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ terms_snapshot: terms }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'write_failed' }, 502, cors);
  return json({ data: { term_end: raw || null } }, 200, cors);
}

/** W1: a client just accepted a proposal / signed a contract via the token link.
 *  The deal advanced, but the studio has no live surface telling them so — they'd
 *  only find out by opening Pipeline and clicking each deal. Raise ONE notice on
 *  the deal's (agency) site so "ready to convert {name}" lands on the operator's
 *  Today / Attention / bell with a deep-link to Pipeline. Deals only ever live on
 *  agency sites, so this is operator-only by construction. Best-effort; the
 *  stable `period` makes it idempotent (once per deal per event). */
async function raiseDealReady(siteId: string, dealId: string, event: 'accepted' | 'signed'): Promise<void> {
  try {
    const site = rows(await svc(`presence_sites?id=eq.${siteId}&select=client_id&limit=1`))[0];
    if (!site?.client_id) return; // no owning client → nowhere calm to surface it
    const title = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${siteId}&select=title&limit=1`))[0]?.title || 'a deal';
    const headline = event === 'signed' ? `Agreement signed — ready to convert ${title}` : `Proposal accepted — ${title}`;
    const body = event === 'signed'
      ? 'The client signed. Convert them to a customer to provision their workspace whenever you’re ready.'
      : 'The client accepted your proposal. Prepare the agreement to sign when you’re ready.';
    await raiseNotice({ siteId, clientId: site.client_id, kind: 'deal_signed', period: `${event}:${dealId}`, headline, body });
  } catch { /* non-fatal — the deal event + Pipeline still record it */ }
}

export async function handleSalesProposalSend(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const r = await svc(`presence_proposals?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`);
  const p = rows(r)[0];
  if (!p) return json({ error: 'not_found' }, 404, cors);
  if (p.status === 'sent') { // idempotent: already sent → return the existing link
    const secret = linkSecret();
    const link = secret ? `${siteUrl()}/sign.html?t=${await signSalesToken({ t: 'proposal', id, site_id: site.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, secret)}` : null;
    return json({ data: p, url: link, already_sent: true }, 200, cors);
  }
  if (p.status !== 'draft') return json({ error: 'bad_state', message: 'Only a draft proposal can be sent.' }, 409, cors);
  const up = await svc(`presence_proposals?id=eq.${id}&site_id=eq.${site.id}&status=eq.draft&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'sent', sent_at: nowIso() }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict' }, 409, cors);
  const secret = linkSecret();
  const token = secret ? await signSalesToken({ t: 'proposal', id, site_id: site.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, secret) : null;
  const url = token ? `${siteUrl()}/sign.html?t=${token}` : null;   // the human signing PAGE, not the raw API
  await dealEvent(site.id, p.deal_id, 'proposal_sent', principal, { detail: { proposal_id: id } });
  // move the deal to 'proposal' if it's earlier (guarded; records the stage change)
  await advanceStage(site.id, p.deal_id, 'proposal', ['lead', 'qualified'], principal);
  const emailed = await emailSalesDoc(site.id, p.deal_id, 'proposal', url);   // auto-send to the contact
  return json({ data: rows(up)[0], url, emailed }, 200, cors);
}

/** Public (token) OR authed proposal decision. */
export async function handleSalesProposalDecide(req: Request, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await rateAllow(`sales_decide:${clientIp(req)}`, 20, 60))) return tooMany(cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const decision = b.decision === 'accepted' ? 'accepted' : b.decision === 'declined' ? 'declined' : null;
  if (!decision) return json({ error: 'bad_decision' }, 422, cors);
  const secret = linkSecret();
  if (!secret) return json({ error: 'unavailable' }, 503, cors);
  const tok = await verifySalesToken(String(b.token || ''), secret, Math.floor(Date.now() / 1000));
  if (!tok || tok.t !== 'proposal' || tok.id !== id) return json({ error: 'invalid_link', message: 'This link isn’t valid or has expired.' }, 403, cors);
  const r = await svc(`presence_proposals?id=eq.${id}&site_id=eq.${tok.site_id}&select=*&limit=1`);
  const p = rows(r)[0];
  if (!p) return json({ error: 'not_found' }, 404, cors);
  // A revised (superseded) proposal's old link can NEVER be accepted — the studio
  // replaced it with a newer version (the enforcement point for revise/supersede).
  if (splitLineItems(p.line_items).meta.superseded_by) return json({ error: 'superseded', message: 'This proposal was replaced by a newer version — ask your studio for the latest.' }, 409, cors);
  if (p.status === decision) return json({ data: { status: p.status }, already: true }, 200, cors); // idempotent
  if (!canDecideProposal(p.status, decision)) return json({ error: 'bad_state', message: 'This proposal can’t be updated.' }, 409, cors);
  const up = await svc(`presence_proposals?id=eq.${id}&site_id=eq.${tok.site_id}&status=eq.sent&select=deal_id,status`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: decision, decided_at: nowIso(), decided_note: clean(b.note, 500) }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict' }, 409, cors);
  const dealId = rows(up)[0].deal_id;
  const sys: Principal = { kind: 'public', userId: 'proposal-link', tenantId: null, role: null, email: null, jwt: null, requestId: 'proposal-decide' } as Principal;
  await dealEvent(tok.site_id, dealId, 'proposal_decided', sys, { detail: { proposal_id: id, decision } });
  if (decision === 'accepted') {
    await advanceStage(tok.site_id, dealId, 'contract', ['lead', 'qualified', 'proposal'], sys);
    await raiseDealReady(tok.site_id, dealId, 'accepted');   // W1: tell the studio
  } else {
    // A decline deserves a heads-up too — silence here means the studio keeps
    // waiting on a deal that already said no. Best-effort, idempotent per deal.
    try {
      const st = rows(await svc(`presence_sites?id=eq.${tok.site_id}&select=client_id&limit=1`))[0];
      const title = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${tok.site_id}&select=title&limit=1`))[0]?.title || 'a deal';
      if (st?.client_id) await raiseNotice({ siteId: tok.site_id, clientId: st.client_id, kind: 'deal_followup', period: `declined:${dealId}`, headline: `They passed on the proposal — ${title}`, body: 'The client declined. A quick follow-up note often keeps the door open — or send an updated proposal.' });
    } catch { /* non-fatal */ }
  }
  return json({ data: { status: decision } }, 200, cors);
}

// ═══ CONTRACTS ═══
export async function handleSalesContractCreate(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  if (b.template_id) {   // one-tap: draft from a saved template, placeholders filled from the deal
    const t = await loadTemplate(site.id, String(b.template_id), 'contract');
    if (!t) return json({ error: 'not_found', message: 'That template isn’t here.' }, 404, cors);
    b = { ...b, body: await fillPlaceholders(site.id, deal, String(t.body || '')), title: b.title || t.title || t.name };
  }
  const body = clean(b.body, 50000);
  if (!body) return json({ error: 'validation', message: 'A contract needs a body.' }, 422, cors);
  const terms = (b.terms_snapshot && typeof b.terms_snapshot === 'object') ? b.terms_snapshot : {};
  const hash = await contractHash(body, terms);
  let proposalId: string | null = UUID_RE.test(b.proposal_id || '') ? b.proposal_id : null;
  if (proposalId) { const pp = await svc(`presence_proposals?id=eq.${proposalId}&site_id=eq.${site.id}&deal_id=eq.${dealId}&select=id&limit=1`); if (!rows(pp)[0]) proposalId = null; }
  const ins = await svc('presence_contracts', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, deal_id: dealId, proposal_id: proposalId, title: clean(b.title, 200) || 'Service agreement', body, content_hash: hash, terms_snapshot: terms, status: 'draft' }) });
  if (!ins.ok || !rows(ins)[0]) return json({ error: 'write_failed' }, 502, cors);
  return json({ data: { ...rows(ins)[0], content_hash: hash } }, 201, cors);
}

export async function handleSalesContractSend(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const r = await svc(`presence_contracts?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=*&limit=1`);
  const c = rows(r)[0];
  if (!c) return json({ error: 'not_found' }, 404, cors);
  const secret = linkSecret();
  const mkLink = async () => secret ? `${siteUrl()}/sign.html?t=${await signSalesToken({ t: 'contract', id, site_id: site.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, secret)}` : null;
  if (c.status === 'signed') return json({ error: 'already_signed' }, 409, cors);
  if (c.status === 'sent') return json({ data: c, url: await mkLink(), content_hash: c.content_hash, already_sent: true }, 200, cors);
  const up = await svc(`presence_contracts?id=eq.${id}&site_id=eq.${site.id}&status=eq.draft&select=*`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'sent', sent_at: nowIso() }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict' }, 409, cors);
  const link = await mkLink();
  await dealEvent(site.id, c.deal_id, 'contract_sent', principal, { detail: { contract_id: id } });
  const emailed = await emailSalesDoc(site.id, c.deal_id, 'contract', link);   // auto-send to the contact
  return json({ data: rows(up)[0], url: link, content_hash: c.content_hash, emailed }, 200, cors);
}

/** Public (token) contract signing — version-integrity enforced. */
export async function handleSalesContractSign(req: Request, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  if (!(await rateAllow(`sales_sign:${clientIp(req)}`, 20, 60))) return tooMany(cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const secret = linkSecret();
  if (!secret) return json({ error: 'unavailable' }, 503, cors);
  const tok = await verifySalesToken(String(b.token || ''), secret, Math.floor(Date.now() / 1000));
  if (!tok || tok.t !== 'contract' || tok.id !== id) return json({ error: 'invalid_link', message: 'This link isn’t valid or has expired.' }, 403, cors);
  const r = await svc(`presence_contracts?id=eq.${id}&site_id=eq.${tok.site_id}&select=*&limit=1`);
  const c = rows(r)[0];
  if (!c) return json({ error: 'not_found' }, 404, cors);
  if (c.status === 'signed') return json({ data: { status: 'signed', signed_at: c.signed_at }, already: true }, 200, cors); // idempotent
  const presented = clean(b.presented_hash, 64);
  const chk = canSignContract(c.status, c.content_hash, presented);
  if (!chk.ok) return json({ error: chk.reason, message: chk.reason === 'version_mismatch' ? 'This agreement was updated — please reload the latest version before signing.' : 'This agreement can’t be signed right now.' }, 409, cors);
  const signerName = clean(b.signer_name, 120);
  const signerEmail = clean(b.signer_email, 160).toLowerCase();
  if (!signerName) return json({ error: 'validation', message: 'Please type your name to sign.' }, 422, cors);
  const signedAt = nowIso();   // ONE timestamp — the evidence, the stored row, and the emailed certificate all agree
  const evidence = { hash: c.content_hash, at: signedAt, token_exp: tok.exp, ip_hash: await hmacHex(secret, clientIp(req)) }; // R3: hashed signer IP for legal signing evidence
  const up = await svc(`presence_contracts?id=eq.${id}&site_id=eq.${tok.site_id}&status=eq.sent&content_hash=eq.${c.content_hash}&select=deal_id`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'signed', signer_name: signerName, signer_email: signerEmail, signed_at: signedAt, signed_evidence: evidence }) });
  if (!up.ok || !rows(up)[0]) return json({ error: 'conflict', message: 'This agreement changed — reload and sign again.' }, 409, cors); // hash guard in WHERE = version integrity
  const dealId = rows(up)[0].deal_id;
  const sys: Principal = { kind: 'public', userId: 'contract-link', tenantId: null, role: null, email: null, jwt: null, requestId: 'contract-sign' } as Principal;
  await dealEvent(tok.site_id, dealId, 'contract_signed', sys, { detail: { contract_id: id, signer: signerName } });
  await advanceStage(tok.site_id, dealId, 'contract', ['lead', 'qualified', 'proposal'], sys);
  await raiseDealReady(tok.site_id, dealId, 'signed');   // W1: "ready to convert {name}" → operator Today/Attention/bell

  // EXECUTED COPY: the email is the durable record ("you'll always be able to ask
  // for a copy" — now they don't have to ask). Full agreement text + signature
  // facts, on the studio's brand, to the signer (falls back to the deal contact).
  let copyEmailed = false;
  try {
    let to = signerEmail;
    if (!to) {
      const deal = rows(await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${tok.site_id}&select=contact_id&limit=1`))[0];
      to = deal?.contact_id ? String(rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${tok.site_id}&select=email&limit=1`))[0]?.email || '') : '';
    }
    if (to) {
      const brand = await loadEmailBrand(tok.site_id);
      const escHtml = (s: string) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch] as string));
      // A branded, print-ready copy of the signed Document of Record (the same
      // content_hash + evidence, rendered as a certificate) they can save as PDF.
      const doc = await docLink('contract', id, tok.site_id);
      const docLine = doc ? `<p style="margin:12px 0 0"><a href="${doc}" style="color:${brand.accentDark}">View / print your copy →</a></p>` : '';
      // Signature certificate: name · timestamp (UTC) · document fingerprint —
      // only facts this request already holds; deliberately no IP or device data.
      copyEmailed = await sendEmail(to, `Your signed copy — ${c.title || 'Service agreement'}`,
        `<p>Here's your copy of the agreement, exactly as signed. Keep this email — it's your record.</p>` +
        `<div style="border:1px solid #e5e0d6;border-radius:12px;padding:16px 18px;margin:12px 0;white-space:pre-wrap;font-size:14px">${escHtml(String(c.body || ''))}</div>` +
        `<p style="font-size:13px;color:#6b6478;margin:14px 0 4px"><strong>Signature certificate</strong></p>` +
        `<div style="border:1px solid #e5e0d6;border-radius:12px;padding:12px 18px;font-size:13px;color:#6b6478;line-height:1.7">` +
        `Signed by: <strong>${escHtml(signerName)}</strong><br>` +
        `Signed at: ${signedAt.slice(0, 19).replace('T', ' ')} UTC<br>` +
        `Document fingerprint: <span style="font-family:ui-monospace,Menlo,Consolas,monospace;overflow-wrap:anywhere">${String(c.content_hash || '')}</span></div>` +
        docLine,
        brand, { critical: true }).catch(() => false);   // their signed legal record = transactional
    }
  } catch { /* the signature stands; the copy email is best-effort */ }

  // SIGN → PAY, one session: if a deposit is already waiting on this deal, hand
  // its payment link straight back — the moment of "yes" is the moment to pay.
  let pay: { url: string; amount_cents: number } | null = null;
  try {
    const dep = rows(await svc(`presence_invoices?deal_id=eq.${dealId}&site_id=eq.${tok.site_id}&purpose=eq.deposit&status=eq.open&deleted_at=is.null&select=stripe_url,amount_cents&order=created_at.desc&limit=1`))[0];
    if (dep?.stripe_url) pay = { url: String(dep.stripe_url), amount_cents: Number(dep.amount_cents) || 0 };
  } catch { /* optional */ }
  return json({ data: { status: 'signed', pay_url: pay?.url || null, pay_amount_cents: pay?.amount_cents || null, copy_emailed: copyEmailed } }, 200, cors);
}

// ═══ PUBLIC VIEW (token) — a prospect reviews the proposal/contract before acting ═══
export async function handleSalesPublicView(req: Request, token: string, cors: Record<string, string>): Promise<Response> {
  if (!(await rateAllow(`sales_view:${clientIp(req)}`, 60, 60))) return tooMany(cors);
  const secret = linkSecret();
  if (!secret) return json({ error: 'unavailable' }, 503, cors);
  const tok = await verifySalesToken(token, secret, Math.floor(Date.now() / 1000));
  if (!tok) return json({ error: 'invalid_link', message: 'This link isn’t valid or has expired.' }, 403, cors);
  // The page carries the STUDIO's identity — a prospect should see who they're
  // hiring, not a generic plum. Accent is Brand-Kit contrast-safe already.
  let brand: { name: string; accent: string } | null = null;
  try { const eb = await loadEmailBrand(tok.site_id); brand = { name: eb.name, accent: eb.accent }; } catch { /* neutral fallback */ }
  if (tok.t === 'proposal') {
    const p = rows(await svc(`presence_proposals?id=eq.${tok.id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=id,title,line_items,subtotal_cents,currency,terms,status&limit=1`))[0];
    if (!p) return json({ error: 'not_found' }, 404, cors);
    return json({ data: { kind: 'proposal', brand, ...p } }, 200, cors);
  }
  const c = rows(await svc(`presence_contracts?id=eq.${tok.id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=id,title,body,content_hash,status,signed_at&limit=1`))[0];
  if (!c) return json({ error: 'not_found' }, 404, cors);
  return json({ data: { kind: 'contract', brand, ...c } }, 200, cors); // content_hash is presented back on sign (version integrity)
}

// ═══ BRANDED DOCUMENT OF RECORD (token) — a printable, keepable copy ═════════
// Server-renders a self-contained, print-optimized branded HTML document for a
// proposal / invoice / deposit / SIGNED contract, authorized ONLY by a signed
// `doc` token (its own type — a doc link only RENDERS, it can never mutate; the
// site_id lives inside the token, so it's tenant-safe pre-auth). It renders the
// EXISTING immutable rows — the signed contract's exact body + typed signer + UTC
// timestamp + content_hash + signed_evidence become a visible certificate of
// record. No new storage, table, column, or migration. Opened directly in a
// browser (like /p/<token>) and saved as PDF via the page's Print affordance.
export async function handleSalesDocument(req: Request, token: string, cors: Record<string, string>): Promise<Response> {
  const htmlResp = (body: string, status = 200) => new Response(body, { status, headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' } });
  const errPage = (msg: string) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Document unavailable</title><div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#1b1525;text-align:center"><h1 style="font-weight:500">This document link isn’t working</h1><p style="color:#6b6478">${msg}</p></div>`;
  if (!(await rateAllow(`sales_doc:${clientIp(req)}`, 60, 60))) return htmlResp(errPage('Too many requests — try again in a moment.'), 429);
  const secret = linkSecret();
  if (!secret) return htmlResp(errPage('This link isn’t available right now.'), 503);
  const tok = await verifyDocToken(token, secret, Math.floor(Date.now() / 1000));
  if (!tok) return htmlResp(errPage('It may have expired — ask your studio for a fresh copy. Nothing is lost.'), 403);
  let brand: { name: string; accent: string; accentDark: string } | undefined;
  try { brand = await loadEmailBrand(tok.site_id); } catch { /* neutral default in the renderer */ }
  if (tok.k === 'proposal') {
    const p = rows(await svc(`presence_proposals?id=eq.${tok.id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=id,title,line_items,subtotal_cents,currency,terms,status,sent_at,decided_at&limit=1`))[0];
    if (!p) return htmlResp(errPage('This proposal is no longer available.'), 404);
    return htmlResp(renderDocument('proposal', p, brand));
  }
  if (tok.k === 'invoice') {
    const v = rows(await svc(`presence_invoices?id=eq.${tok.id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=id,title,description,amount_cents,currency,purpose,status,stripe_url,due_date,paid_at,created_at&limit=1`))[0];
    if (!v) return htmlResp(errPage('This invoice is no longer available.'), 404);
    return htmlResp(renderDocument('invoice', v, brand));
  }
  const c = rows(await svc(`presence_contracts?id=eq.${tok.id}&site_id=eq.${tok.site_id}&deleted_at=is.null&select=id,title,body,content_hash,status,signer_name,signer_email,signed_at,signed_evidence,sent_at,created_at&limit=1`))[0];
  if (!c) return htmlResp(errPage('This agreement is no longer available.'), 404);
  return htmlResp(renderDocument('contract', c, brand));
}

// ═══ DOCUMENT LINK (authed) — mint the printable document URL for the CRM ════
// The operator opens/prints a branded document from the deal drawer. Verifies the
// artifact belongs to THIS site (tenant-safe), then mints a 30-day `doc` token and
// returns the URL to the server-rendered page above. Studio-gated like every
// authed /sales/* route.
const DOC_TABLE: Record<DocKind, string> = { proposal: 'presence_proposals', contract: 'presence_contracts', invoice: 'presence_invoices' };
export async function handleSalesDocumentLink(site: SiteRow, kind: DocKind, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const secret = linkSecret();
  if (!secret) return json({ error: 'unavailable', message: 'Document links aren’t available in this environment.' }, 503, cors);
  const exists = rows(await svc(`${DOC_TABLE[kind]}?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id&limit=1`))[0];
  if (!exists) return json({ error: 'not_found', message: 'That document isn’t here.' }, 404, cors);
  const token = await signDocToken({ t: 'doc', k: kind, id, site_id: site.id, exp: Math.floor(Date.now() / 1000) + 30 * 86400 }, secret);
  return json({ url: `${fnBase()}/functions/v1/presence/sales/doc/${token}` }, 200, cors);
}

// ═══ CONVERT TO CUSTOMER (idempotent) ═══
export async function handleSalesConvert(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  let cb: any = {}; try { cb = await req.json(); } catch { /* body optional */ }
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found' }, 404, cors);
  const outcome = convertOutcome({ stage: deal.stage, converted_client_id: deal.converted_client_id });
  if (outcome === 'already_converted') { // idempotent: return the existing customer/workspace (+ ensure the project handoff)
    const { actor, actor_kind } = actorOf(principal);
    const ph = await ensureProjectForDeal({ agencySiteId: site.id, deal, clientId: deal.converted_client_id, customerSiteId: deal.converted_site_id, actor, actorKind: actor_kind });
    return json({ data: { converted: true, client_id: deal.converted_client_id, site_id: deal.converted_site_id, project_id: ph.project?.id || deal.created_project_id || null, onboarding: '/get-started.html', idempotent: true } }, 200, cors);
  }
  if (outcome === 'blocked_lost') return json({ error: 'lost', message: 'A lost deal can’t be converted.' }, 409, cors);
  if (outcome === 'blocked_stage') return json({ error: 'not_ready', message: 'Sign the agreement before converting this deal to a customer.' }, 409, cors);

  // CLAIM the deal atomically BEFORE any account/provisioning work, so two
  // concurrent converts can NEVER double-create a customer or workspace. A prior
  // claim that never finished (>5 min stale) is reclaimable → a failed attempt
  // self-heals. `converted_at` is the claim marker; `converted_client_id` is the
  // completion marker (checked by convertOutcome above).
  const claimBody = () => JSON.stringify({ converted_at: nowIso() });
  let claim = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&converted_client_id=is.null&converted_at=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: claimBody() });
  if (!rows(claim)[0]) {
    const staleBefore = new Date(Date.now() - 5 * 60_000).toISOString();
    claim = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&converted_client_id=is.null&converted_at=lt.${encodeURIComponent(staleBefore)}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: claimBody() });
  }
  if (!rows(claim)[0]) { // another convert holds the claim (or it just finished)
    const fresh = await loadDeal(site.id, dealId);
    if (fresh?.converted_client_id) return json({ data: { converted: true, client_id: fresh.converted_client_id, site_id: fresh.converted_site_id, idempotent: true } }, 200, cors);
    return json({ error: 'conversion_in_progress', message: 'This deal is already being converted — refresh in a moment.' }, 409, cors);
  }
  const unclaim = () => svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&converted_client_id=is.null`, { method: 'PATCH', body: JSON.stringify({ converted_at: null }) }).catch(() => {});

  // resolve the customer's business name + email (from the contact, or the deal)
  const contact = deal.contact_id ? rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${site.id}&select=name,email,company&limit=1`))[0] : null;
  const businessName = clean((contact?.company || contact?.name || deal.title), 120) || 'New customer';
  const email = clean(contact?.email, 160).toLowerCase();
  const plan = pickPlan(cb.plan); // selectable edition (default 'presence'); billing formalized in P2-E (active access, unbilled — a deliberate P2-C decision)

  // 1+2) resolve/create the customer ACCOUNT (login) and run the ONE idempotent
  //    provisioning path (entitlement + site + hosting + seeds). This is the SHARED
  //    provisioning internal — the exact same helper the direct "Add a customer"
  //    path calls, so there is never a second provisioner. It rolls back only what
  //    IT created on failure; convert holds the deal claim around it.
  const acct = await provisionCustomerAccount({ email, businessName, plan, actorEmail: principal.email });
  if (!acct.ok || !acct.clientId) {
    await unclaim();
    return json({ error: acct.error || 'provision_incomplete', message: acct.message || 'We couldn’t set up the customer’s account — please try again.' }, acct.httpStatus || 502, cors);
  }
  const clientId = acct.clientId;
  const createdClient = acct.createdClient, createdAuthId = acct.createdAuthId, isNewLogin = acct.isNewLogin;

  // 3) stamp the chain onto the deal (we hold the claim; converted_client_id UNIQUE
  //    also blocks a client already converted from ANOTHER deal).
  const up = await svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&converted_client_id=is.null&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ converted_client_id: clientId, converted_site_id: acct.siteId, stage: 'won' }) });
  if (!up.ok || !rows(up)[0]) {
    // stamp failed (e.g. this customer is already linked to another deal). Roll back
    // ONLY what WE created (never a reused existing customer); release the claim.
    if (createdClient) { await svc(`clients?id=eq.${clientId}`, { method: 'DELETE' }).catch(() => {}); if (createdAuthId) await deleteAuthUser(createdAuthId); }
    await unclaim();
    const fresh = await loadDeal(site.id, dealId);
    if (fresh?.converted_client_id) return json({ data: { converted: true, client_id: fresh.converted_client_id, site_id: fresh.converted_site_id, idempotent: true } }, 200, cors);
    return json({ error: 'convert_conflict', message: 'That customer is already linked to another deal.' }, 409, cors);
  }
  await dealEvent(site.id, dealId, 'converted', principal, { to_stage: 'won', detail: { client_id: clientId, site_id: acct.siteId } });
  await writeChangeEvent({ siteId: site.id, entityType: 'deal', entityId: dealId, action: 'convert', summary: `Converted “${deal.title}” to a customer`, principal, provenance: 'human' }).catch(() => {});

  // Seam 1: if the converting operator runs an AGENCY, add the new customer to
  // their managed portfolio (shared helper). Idempotent; solo owners skip it.
  const managed = await linkAgencyPortfolio(principal, acct.siteId, email);

  // 4) ACCESS + onboarding handoff — the one-tap sign-in invite (shared helper).
  const invited = await sendCustomerInvite(email, isNewLogin);

  // 5) SERVICE-DELIVERY HANDOFF (Agency–Client Bridge): create the authoritative
  //    project on THIS (agency) site for the new customer + link the tenant-safe
  //    bridge to their own workspace, so post-sale delivery is connected with no
  //    manual step. Idempotent (deal.created_project_id UNIQUE + bridge UNIQUE).
  //    Self-guard: a deal whose contact IS the studio itself must not bridge the
  //    studio to itself ("your studio is on it" on the studio's own Today).
  const selfConvert = clientId === site.client_id;
  const handoff = selfConvert
    ? { project: null }
    : await ensureProjectForDeal({ agencySiteId: site.id, deal, clientId, customerSiteId: acct.siteId || null, actor: actorOf(principal).actor, actorKind: actorOf(principal).actor_kind });

  // 5b) BILLING BACKFILL: deposits/invoices sent BEFORE convert were written with
  //     customer_client_id NULL (the customer didn't exist yet). Stamp them now so
  //     the client's own Billing view shows the full money story. Idempotent.
  try {
    await svc(`presence_invoices?deal_id=eq.${dealId}&site_id=eq.${site.id}&customer_client_id=is.null`, {
      method: 'PATCH', body: JSON.stringify({ customer_client_id: clientId, customer_site_id: acct.siteId || null }),
    });
  } catch { /* best-effort — the studio-side record is already correct */ }
  return json({ data: { converted: true, client_id: clientId, site_id: acct.siteId, project_id: handoff.project?.id || null, hosted: acct.hosted, invited, managed, plan, onboarding: '/get-started.html' } }, 200, cors);
}

/** Re-send the welcome / set-password email to an already-converted customer —
 *  the "they never got it / it expired" recovery. Reuses the ONE invite helper
 *  (sendCustomerInvite → a fresh signed set-password link), so a resend is byte-
 *  identical to the original. Only for a converted deal with an email on file;
 *  logged as an email activity on the deal timeline. Idempotent to re-tap. */
export async function handleSalesResendInvite(req: Request, site: SiteRow, principal: Principal, dealId: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(dealId)) return json({ error: 'bad_request' }, 400, cors);
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  const deal = await loadDeal(site.id, dealId);
  if (!deal) return json({ error: 'not_found', message: 'That deal is no longer here.' }, 404, cors);
  if (!deal.converted_client_id) return json({ error: 'not_converted', message: 'Convert this deal to a customer first — then you can send the welcome email.' }, 409, cors);
  // Email lives on the deal's contact (same source convert used to provision).
  const contact = deal.contact_id ? rows(await svc(`presence_contacts?id=eq.${deal.contact_id}&site_id=eq.${site.id}&select=email&limit=1`))[0] : null;
  const email = clean(contact?.email, 160).toLowerCase();
  if (!email || !validEmail(email)) return json({ error: 'no_email', message: 'This customer has no email on file, so there’s nothing to send. Add an email to their contact first.' }, 409, cors);
  const sent = await sendCustomerInvite(email, false);
  if (!sent) return json({ error: 'send_failed', message: 'We couldn’t send the welcome email just now — please try again in a moment.' }, 502, cors);
  await dealEvent(site.id, dealId, 'note', principal, { detail: buildActivityDetail('email', `Welcome email re-sent to ${email}`, nowIso()) });
  return json({ data: { sent: true, email } }, 200, cors);
}

// ═══ SHARED PROVISIONING INTERNALS ═══════════════════════════════════════════
// The account + workspace provisioning that BOTH the deal→convert ceremony and
// the direct "Add a customer" path run — extracted so there is exactly ONE
// provisioner, never a parallel one. Placed after handleSalesConvert so the
// convert flow reads top-to-bottom; both callers reference these by name.

interface CustomerAccountResult {
  ok: boolean;
  error?: string; message?: string; httpStatus?: number;
  clientId?: string; siteId?: string; hosted?: boolean;
  isNewLogin: boolean;            // a login we just minted (needs a set-password invite)
  alreadyExisted: boolean;        // an account for this email already existed (reused, never duplicated)
  createdClient: boolean;         // WE inserted the clients row → safe to roll back
  createdAuthId: string | null;   // WE minted the auth login → safe to roll back
}

/** Resolve or create the customer's login + client record, then run the ONE
 *  idempotent provisioning path (entitlement + site + hosting + seeds + first-run).
 *  Reuses an existing account by email — NEVER duplicates a customer. Rolls back
 *  ONLY what it created if provisioning fails, so a partial run never lingers.
 *  Shared by convert and the direct add-customer route (no second provisioner). */
async function provisionCustomerAccount(opts: {
  email: string; businessName: string; plan: PlanKey; actorEmail?: string | null;
}): Promise<CustomerAccountResult> {
  const { email, businessName, plan } = opts;
  // Track what WE created for clean rollback. `createdClient` is NEVER set for a
  // REUSED existing customer, so rollback can never delete someone else's account.
  let clientId: string | null = null, createdAuthId: string | null = null;
  let createdClient = false, isNewLogin = false, alreadyExisted = false;
  const fail = (error: string, message: string, httpStatus = 502): CustomerAccountResult =>
    ({ ok: false, error, message, httpStatus, isNewLogin, alreadyExisted, createdClient, createdAuthId });

  if (email) {
    const existing = await findClientByEmail(email);
    if (existing) { clientId = existing.id; alreadyExisted = true; }  // reuse — never duplicate a customer
    else {
      const auth = await createAuthUser(email, crypto.randomUUID() + 'Aa1!');
      if ('id' in auth) {
        createdAuthId = auth.id;
        const chain = await createContactAndClient(auth.id, email, businessName);
        if ('error' in chain) { await deleteAuthUser(auth.id); return fail('client_failed', 'We couldn’t create the customer account — please try again.'); }
        clientId = chain.clientId; createdClient = true; isNewLogin = true;
      } else if (auth.error === 'account_exists') {                 // they already sign in; link a client by email if missing
        alreadyExisted = true;
        clientId = (await findClientByEmail(email))?.id || null;
        if (!clientId) { const ci = await svc('clients', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: businessName, email, contact_email: email, status: 'active' }) }); clientId = rows(ci)[0]?.id || null; if (clientId) createdClient = true; }
      } else { return fail('auth_failed', 'We couldn’t set up the customer’s login — please try again.'); }
    }
  } else {
    // no email → a studio-managed workspace (no self-serve login yet; invite later)
    const ci = await svc('clients', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name: businessName, status: 'active' }) });
    clientId = rows(ci)[0]?.id || null; if (clientId) createdClient = true;
  }
  if (!clientId) return fail('client_failed', 'We couldn’t create the customer account — please try again.');

  // reuse the ONE idempotent provisioning path (entitlement + site + hosting + seeds + first-run)
  const prov = await provisionForSignup({ clientId, businessName, plan, patch: { status: 'active' } as any, actorEmail: opts.actorEmail });
  if (!prov.ok) {
    if (createdClient) { await svc(`clients?id=eq.${clientId}`, { method: 'DELETE' }).catch(() => {}); if (createdAuthId) await deleteAuthUser(createdAuthId); } // roll back only what WE created (cascade drops site+entitlement)
    const msg = prov.error === 'hosting_unconfigured' ? 'The account was created but hosting isn’t available in this environment.' : 'We created the account but hit a snag provisioning the workspace.';
    return { ok: false, error: 'provision_incomplete', message: msg, httpStatus: 502, isNewLogin, alreadyExisted, createdClient, createdAuthId };
  }
  return { ok: true, clientId, siteId: prov.siteId, hosted: prov.hosted, isNewLogin, alreadyExisted, createdClient, createdAuthId };
}

/** Seam 1: if the operator runs an AGENCY, add the customer to their managed
 *  portfolio (presence_agency_clients) so the Studio App can service them via
 *  scope-switching. Idempotent (site_id PK). Best-effort; solo owners skip it. */
async function linkAgencyPortfolio(principal: Principal, siteId: string | undefined, email: string): Promise<boolean> {
  try {
    if (!siteId || !principal.jwt) return false;
    const am = await resolveAgencyMember(principal.jwt);
    if (!am) return false;
    const link = await svc('presence_agency_clients?on_conflict=site_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ site_id: siteId, agency_id: am.agency_id, status: 'active', owner_email: email || am.email }) });
    return link.ok;
  } catch { return false; } // portfolio link is best-effort
}

/** The one-tap sign-in invite. A brand-new login gets a signed set-password link
 *  (they never chose a password) that lands them straight in the EXISTING guided
 *  first-run (via ?next=); an existing login gets a welcome. Best-effort. */
async function sendCustomerInvite(email: string, _isNewLogin: boolean): Promise<boolean> {
  if (!email) return false;
  // App pages (set-password/get-started/portal) ARE served on the primary site —
  // build-public.sh copies every root .html into dist/ and _redirects blocks only
  // source/doc dirs, not these pages. So the link MUST use the same origin as the
  // Supabase project's Site URL (davisdigitalstudio.com), matching workspace.ts /
  // service_bridge.ts. A different host (e.g. a non-configured subdomain) is not in
  // GoTrue's redirect allow-list, so the recovery link silently falls back to the
  // Site URL — i.e. lands on the home page. SITE_URL env should be set to this too.
  const base = (Deno.env.get('SITE_URL') || 'https://davisdigitalstudio.com').replace(/\/$/, '');
  // Every provisioned customer needs to CREATE their password. Always send a signed
  // set-password link that lands them in the guided first-run; if it can't be generated
  // they can still get in passwordlessly (one-time email code) at the portal.
  // Converted customers are CLIENTS — they land in their client portal (client.html),
  // where they work WITH the studio (files, approvals, messages, invoices), NOT the
  // Studio OS operator surfaces. (/client.html is whitelisted in set-password.html's
  // NEXT_OK.) Self-running workspaces are a different persona (self-serve signup).
  const link = await generateSetPasswordLink(email, `${base}/set-password.html?next=/client.html`);
  const cta = link
    ? `<a href="${link}">Create your password &amp; sign in →</a> — you’ll land in your client portal.`
    : `<a href="${base}/portal.html">Sign in at your portal →</a> — we’ll email you a one-time code, no password needed.`;
  sendEmail(email, 'Your workspace is ready — welcome to Studio OS',
    `<p>Welcome! Your workspace is set up and ready.</p><p>${cta}</p><p style="font-size:13px;color:#6b6478">You can always sign in any time at <a href="${base}/portal.html">your portal</a>.</p>`,
  undefined, { critical: true }).catch(() => {});   // login access = transactional
  return true;
}

/** Form the Agency–Client Bridge for a customer that has NO originating deal (a
 *  direct add, a connect-by-email, or a self-serve signup a studio pre-listed).
 *  Reuses the ONE frozen bridge path (ensureBridge + presence_customer_agency =
 *  one primary agency per customer) — never a parallel bridge. Idempotent: reuses
 *  an existing link for this customer under this studio instead of minting a second
 *  empty project. Returns which happened (bridged / already owned elsewhere). */
export async function bridgeCustomerToStudio(opts: {
  agencySiteId: string; clientId: string; customerSiteId: string | null; label: string;
}): Promise<{ bridged: boolean; projectId: string | null; ownedElsewhere: boolean }> {
  const { agencySiteId, clientId, customerSiteId, label } = opts;
  const links = await linksForCustomer(clientId);
  const mine = links.find((l) => l.agency_site_id === agencySiteId);
  if (mine) return { bridged: true, projectId: mine.project_id, ownedElsewhere: false };   // reuse — no duplicate project
  if (links.length) return { bridged: false, projectId: null, ownedElsewhere: true };       // linked to a DIFFERENT agency already
  const ins = await svc('presence_projects', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: agencySiteId, client_id: clientId, name: String(label || 'New project').slice(0, 200), description: '', status: 'active', client_visible: true }) });
  const project = rows(ins)[0];
  if (!project) return { bridged: false, projectId: null, ownedElsewhere: false };
  const bridged = await ensureBridge(agencySiteId, project.id, clientId, customerSiteId, null);
  if (!bridged) { await svc(`presence_projects?id=eq.${project.id}`, { method: 'PATCH', body: JSON.stringify({ deleted_at: nowIso() }) }).catch(() => {}); return { bridged: false, projectId: null, ownedElsewhere: true }; } // customer belongs to another agency — drop our orphan
  return { bridged: true, projectId: project.id, ownedElsewhere: false };
}

/** Find-or-create the site-scoped CRM contact for (site, email) — the record that
 *  lets a later self-serve signup find THIS studio. `mark` stamps the connect-intent
 *  tag (so signup only auto-connects emails the studio explicitly pre-listed, never
 *  a coincidental CRM lead); it's appended, never clobbering the operator's notes.
 *  Reuses the presence_contacts store's (site,email) uniqueness — no new table. */
async function ensureConnectContact(siteId: string, email: string, name: string, mark: boolean) {
  const existing = rows(await svc(`presence_contacts?site_id=eq.${siteId}&email=eq.${encodeURIComponent(email)}&deleted_at=is.null&select=id,notes&limit=1`))[0];
  if (existing) {
    if (mark && !String(existing.notes || '').includes(CONNECT_INTENT_TAG)) {
      const notes = (String(existing.notes || '').trim() ? existing.notes.trim() + ' ' : '') + CONNECT_INTENT_TAG;
      await svc(`presence_contacts?id=eq.${existing.id}&site_id=eq.${siteId}`, { method: 'PATCH', body: JSON.stringify({ notes: clean(notes, 2000) }) }).catch(() => {});
    }
    return existing;
  }
  const ins = await svc('presence_contacts', { method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: siteId, name: name || '', email, notes: mark ? CONNECT_INTENT_TAG : '' }) });
  return rows(ins)[0] || null;
}

// ═══ ADD A CUSTOMER (direct — no sales ceremony) ═════════════════════════════
// The owner already has customers (people he's served for years). TWO paths, his
// choice (owner's words: "there should be two options"):
//   A) mode='provision' (default) — set them up NOW: reuse the SAME provisioning
//      internals (account + workspace + service-role entitlement + agency bridge +
//      set-password invite). Idempotent: an email that already has a workspace
//      returns a friendly "already set up", never a duplicate.
//   B) mode='connect' — they'll sign up themselves; the owner just RECORDS the
//      email. If an account already exists → bridge it to this studio NOW. If not →
//      record the intent on a site-scoped contact so commerce/handleSignup
//      auto-connects them the moment that email self-serve-signs-up. NEVER
//      provisions a workspace, mints a login, or sends a set-password email.
// A SERVICE customer either way — active access, no Stripe subscription (billing
// stays the studio's own invoicing, P2-E).
export async function handleSalesAddCustomer(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const email = clean(b.email, 160).toLowerCase();
  const name = clean(b.name, 120);
  const businessNameIn = clean(b.business_name, 120);
  if (!email || !validEmail(email)) return json({ error: 'validation', message: 'Enter the customer’s email — that’s where their sign-in invitation goes.' }, 422, cors);
  const businessName = businessNameIn || name || (email.split('@')[0] || 'New customer');
  const mode = b.mode === 'connect' ? 'connect' : 'provision';
  const portalUrl = `${siteUrl()}/portal.html`;

  // ── B) CONNECT BY EMAIL — record intent; provision NOTHING ──────────────────
  if (mode === 'connect') {
    const existing = await findClientByEmail(email);
    if (existing) {
      // They already have an account → connect (bridge) it to this studio now.
      const clientId = existing.id;
      const customerSite = rows(await svc(`presence_sites?client_id=eq.${clientId}&select=id&limit=1`))[0];
      const managed = await linkAgencyPortfolio(principal, customerSite?.id, email);
      await ensureConnectContact(site.id, email, name, false);   // record them in the CRM (no marker — already connected)
      let projectId: string | null = null, bridged = false, ownedElsewhere = false;
      if (clientId !== site.client_id) {   // self-guard: never bridge the studio to itself
        const r = await bridgeCustomerToStudio({ agencySiteId: site.id, clientId, customerSiteId: customerSite?.id || null, label: businessName });
        projectId = r.projectId; bridged = r.bridged; ownedElsewhere = r.ownedElsewhere;
      }
      await writeChangeEvent({ siteId: site.id, entityType: 'client', entityId: clientId, action: 'connect', summary: `Connected ${businessName} to your workspace`, principal, provenance: 'human' }).catch(() => {});
      return json({ data: { mode: 'connect', connected: true, created: false, client_id: clientId, site_id: customerSite?.id || null, project_id: projectId, managed, bridged, owned_elsewhere: ownedElsewhere, portal_url: portalUrl, message: 'Connected to their workspace.' } }, 200, cors);
    }
    // No account yet → record the intent (tagged contact) so signup auto-connects.
    const contact = await ensureConnectContact(site.id, email, name, true);
    await writeChangeEvent({ siteId: site.id, entityType: 'contact', entityId: contact?.id || email, action: 'connect_pending', summary: `Saved ${email} to connect when they sign up`, principal, provenance: 'human' }).catch(() => {});
    return json({ data: { mode: 'connect', pending: true, connected: false, email, contact_id: contact?.id || null, portal_url: portalUrl, message: `Saved. When ${email} signs up, they’ll connect to you automatically.` } }, 200, cors);
  }

  // ── A) SET THEM UP NOW (existing behavior) ──────────────────────────────────
  const plan = pickPlan(b.edition);   // "what they get" (default presence); reuse the convert whitelist

  const acct = await provisionCustomerAccount({ email, businessName, plan, actorEmail: principal.email });
  if (!acct.ok || !acct.clientId) return json({ error: acct.error || 'provision_incomplete', message: acct.message || 'We couldn’t set up the customer’s account — please try again.' }, acct.httpStatus || 502, cors);
  const clientId = acct.clientId;

  // managed portfolio (Seam 1) + agency bridge (one primary agency per customer).
  const managed = await linkAgencyPortfolio(principal, acct.siteId, email);

  // Agency–Client Bridge via the shared helper (ensureBridge — one primary agency
  // per customer; idempotent; reuses an existing link; refuses a customer owned by
  // another agency). Self-guard: never bridge the studio to itself.
  let projectId: string | null = null, bridged = false, ownedElsewhere = false;
  if (clientId !== site.client_id) {
    const r = await bridgeCustomerToStudio({ agencySiteId: site.id, clientId, customerSiteId: acct.siteId || null, label: businessName });
    projectId = r.projectId; bridged = r.bridged; ownedElsewhere = r.ownedElsewhere;
  }

  // Already had a workspace → friendly "they're already set up" (with a link), no
  // duplicate, no fresh invite (they already have access).
  if (acct.alreadyExisted) {
    return json({ data: { already_exists: true, created: false, client_id: clientId, site_id: acct.siteId, project_id: projectId, managed, portal_url: portalUrl, message: 'They already have a workspace — nothing was duplicated.' } }, 200, cors);
  }
  const invited = await sendCustomerInvite(email, acct.isNewLogin);
  await writeChangeEvent({ siteId: site.id, entityType: 'client', entityId: clientId, action: 'create', summary: `Added ${businessName} as a customer`, principal, provenance: 'human' }).catch(() => {});
  return json({ data: { created: true, client_id: clientId, site_id: acct.siteId, project_id: projectId, hosted: acct.hosted, invited, managed, bridged, owned_elsewhere: ownedElsewhere, plan, portal_url: portalUrl } }, 201, cors);
}
