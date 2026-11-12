// ── AI help on the sales side, and the month's goal (sales item 94, Nov 2026) ─────────
//   GET  /sales/goal-ai      the month's goal, whether AI help is on, whether this caller may
//                            switch it, and what it used this month and today
//   PUT  /sales/goal-ai      { goal_cents?, ai_on? }: the goal is a studio setting (configure,
//                            lib/site_roles.ts); the switch is the owner's alone, never a seat's
//                            and never from inside a client
//   POST /sales/ai/draft     { kind: 'enquiry' | 'support', id } or { kind: 'record', contact?,
//                            deal?, project?, client_id? }, with what is in the box and the subject:
//                            a draft for the box. Nothing is sent, and the words are not kept.
//   GET  /sales/ai/summary?subject=deal:<id>   the newest kept "Where things stand"
//   POST /sales/ai/summary   { contact?, deal?, project?, client_id? }: three lines and a Next, kept
// Every press: AI help is on (the studio's switch; inside a client, the studio's own), the
// studio is under 50 presses in the last 24 hours, and the tools' daily spend cap
// (_shared/tools/guard.ts) isn't reached, the same cap the AI answers check stops at. Each
// call is written down (presence_sales_ai, 0201) with what it cost, and in tool_usage_log.
// Before 0201 is in the database a press answers "AI help isn't ready yet" and calls nothing.
// The record's facts come from the record page's own two reads (/crm/record and
// /crm/activity, run here as they are for the page), so a press sees what the page sees.
import { json } from '../../_shared/http.ts';
import type { Principal } from '../../_shared/auth.ts';
import { logUsage, spendCapReached } from '../../_shared/tools/guard.ts';
import { CLAUDE_ENGINE_MODEL } from '../../_shared/tools/ai_visibility/engines.ts';
import { svc, svcCount } from '../lib/db.ts';
import { readReservedJsonOrThrow, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { resolveSite, type SiteRow } from '../lib/site.ts';
import { resolveMemberSite } from '../lib/workspace.ts';
import { resolveAgencyMember } from '../agency/auth.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { DEFAULT_STAGE_LABEL } from '../lib/stage_names.ts';
import {
  AI_DAY_LIMIT, AI_CENTS_SAID, normalizeGoalAi, applyGoalAi, costCents, monthStartIso, draftMessages, summaryMessages,
  cleanDraft, parseSummary, draftFrom, type GoalAi, type SalesFacts,
} from '../lib/sales_ai.ts';

const rows = (r: { ok?: boolean; json?: unknown } | null) => (r && r.ok && Array.isArray(r.json) ? r.json : []) as any[];
const who = (p: Principal) => p.email || p.userId || null;
const SUBJECT_RE = /^(client|deal|contact|project):[0-9a-f-]{36}$/;
const claudeKey = () => Deno.env.get('ANTHROPIC_KEY') || Deno.env.get('ANTHROPIC_API_KEY') || '';
const say = (status: number, error: string, message: string, cors: Record<string, string>, extra: Record<string, unknown> = {}) => json({ error, message, ...extra }, status, cors);

/** The studio that pays for a press and whose book a record is in: the caller's own site;
 *  inside a client, the studio's own (the same way the record finds the studio's book). */
async function payerOf(jwt: string, site: SiteRow, principal: Principal): Promise<string> {
  if (!principal.scope) return String(site.id);
  try { const s = await resolveSite(jwt); if (s?.id) return String(s.id); } catch { /* try the seat */ }
  try { const m = await resolveMemberSite(principal as any); if (m?.site?.id) return String(m.site.id); } catch { /* none */ }
  return '';
}

/** Only the owner switches AI help: never a seat, never from inside a client, and of a
 *  studio's team only its owner. */
async function canSwitch(jwt: string, principal: Principal): Promise<boolean> {
  if (principal.scope || principal.member) return false;
  if (principal.kind === 'staff') return principal.role === 'owner' || principal.role === 'admin';
  if (principal.kind !== 'client') return false;
  try { const m = await resolveAgencyMember(jwt); return !m || m.role === 'owner'; } catch { return false; }
}

const readGoalAi = async (siteId: string): Promise<GoalAi> => normalizeGoalAi(await readReservedJsonOrThrow(siteId, RESERVED_NAMES.salesGoalAi));
const tableReady = async (): Promise<boolean> => { try { return (await svc('presence_sales_ai?select=id&limit=1')).ok; } catch { return false; } };
const dayAgo = (nowMs: number) => new Date(nowMs - 86_400_000).toISOString();

async function usageOf(payer: string, monthStart: string, nowMs: number): Promise<{ month_uses: number; month_cents: number; last_at: string | null; today_uses: number } | null> {
  try {
    const [m, d] = await Promise.all([
      svc(`presence_sales_ai?site_id=eq.${payer}&created_at=gte.${encodeURIComponent(monthStart)}&select=cost_cents,created_at&order=created_at.desc&limit=5000`),
      svcCount(`presence_sales_ai?site_id=eq.${payer}&created_at=gte.${encodeURIComponent(dayAgo(nowMs))}`),
    ]);
    if (!m.ok || d === null) return null;
    const list = rows(m);
    const cents = list.reduce((a, r) => a + (Number(r.cost_cents) || 0), 0);
    return { month_uses: list.length, month_cents: Math.round(cents * 1000) / 1000, last_at: list[0]?.created_at ? String(list[0].created_at) : null, today_uses: d };
  } catch { return null; }
}

// ── GET/PUT /sales/goal-ai ────────────────────────────────────────────────────────────
export async function handleGoalAi(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const u = new URL(req.url);
  if (req.method === 'PUT') {
    let b: any = {}; try { b = await req.json(); } catch { return say(400, 'bad_json', 'That didn’t come through. Try again.', cors); }
    if (b && typeof b === 'object' && 'ai_on' in b && !(await canSwitch(jwt, principal))) return say(403, 'owner_only', 'Only the studio’s owner can switch AI help on or off.', cors);
    let cur: GoalAi;
    try { cur = await readGoalAi(site.id); } catch { return say(502, 'read_failed', 'That didn’t save just now. Try again.', cors); }
    const now = new Date().toISOString();
    const first = applyGoalAi(cur, b, who(principal), now);
    if ('error' in first) return say(422, 'validation', first.error, cors);
    const saved = await updateReservedJson(site.id, RESERVED_NAMES.salesGoalAi, (stored) => {
      const r = applyGoalAi(normalizeGoalAi(stored), b, who(principal), now);
      return 'value' in r ? r.value : normalizeGoalAi(stored);
    }, who(principal) || 'system');
    if (!saved) return say(502, 'write_failed', 'That didn’t save just now. Try again.', cors);
    return json({ data: { goal_cents: saved.goal_cents, ai_on: saved.ai_on, ai_on_at: saved.ai_on_at } }, 200, cors);
  }
  const payer = await payerOf(jwt, site, principal);
  const nowMs = Date.now();
  const [goal, ai, switchable, ready, usage] = await Promise.all([
    readGoalAi(site.id).catch(() => null),
    payer ? readGoalAi(payer).catch(() => null) : Promise.resolve(null),
    canSwitch(jwt, principal),
    tableReady(),
    payer ? usageOf(payer, monthStartIso(u.searchParams.get('today'), Number(u.searchParams.get('tzo')), new Date(nowMs).toISOString()), nowMs) : Promise.resolve(null),
  ]);
  if (!goal) return say(502, 'read_failed', 'We couldn’t load the goal and AI help just now.', cors);
  return json({ data: {
    goal_cents: goal.goal_cents,
    ai_on: !!ai?.ai_on, ai_on_at: ai?.ai_on_at || null, can_switch: switchable, from_studio: !!principal.scope,
    ready: ready && !!claudeKey(),
    usage: usage ? { ...usage, day_limit: AI_DAY_LIMIT, cents_each: AI_CENTS_SAID } : null,
  } }, 200, cors);
}

// ── the call ──────────────────────────────────────────────────────────────────────────
// The AI answers check's call (_shared/tools/ai_visibility/engines.ts askClaude): the same
// model, low effort, the server-side fallback beta with a retry without it if this account
// can't use it, one wait-and-retry on an overload. No tools here: the facts are in the ask.
type Asked = { ok: true; text: string; cents: number } | { ok: false; why: 'refusal' | 'error' | 'timeout'; cents: number };
export async function askClaude(system: string, user: string, maxTokens: number, budgetMs = 25_000): Promise<Asked> {
  const key = claudeKey();
  const deadline = Date.now() + budgetMs;
  let withFallbacks = true, retried = false, cents = 0;
  for (let round = 0; round < 3; round++) {
    let r: Response;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', ...(withFallbacks ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {}) },
        body: JSON.stringify({
          model: CLAUDE_ENGINE_MODEL,
          max_tokens: maxTokens,
          output_config: { effort: 'low' },
          ...(withFallbacks ? { fallbacks: 'default' } : {}),
          system,
          messages: [{ role: 'user', content: user }],
        }),
        signal: AbortSignal.timeout(Math.max(1000, deadline - Date.now())),
      });
    } catch (e) {
      return { ok: false, why: e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 'error', cents };
    }
    const j = await r.json().catch(() => null);
    if (r.status === 400 && withFallbacks && /fallback/i.test(JSON.stringify(j?.error || ''))) { withFallbacks = false; round--; continue; }
    cents += costCents(j?.usage);
    if ((r.status === 429 || r.status === 529 || r.status === 503 || r.status === 500) && !retried && deadline - Date.now() > 8000) {
      retried = true;
      await new Promise((res) => setTimeout(res, Math.min(3000, Math.max(1000, (Number(r.headers.get('retry-after')) || 1.5) * 1000))));
      continue;
    }
    if (!r.ok || !j) return { ok: false, why: 'error', cents };
    if (j.stop_reason === 'refusal') return { ok: false, why: 'refusal', cents };
    const text = Array.isArray(j.content) ? j.content.filter((b: any) => b?.type === 'text').map((b: any) => String(b.text || '')).join('').trim() : '';
    return text ? { ok: true, text, cents } : { ok: false, why: 'error', cents };
  }
  return { ok: false, why: 'error', cents };
}

// ── what a press may do: on, ready, under the day's limit, under the spend cap ──────────
async function gate(jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<{ payer: string; used: number } | Response> {
  const payer = await payerOf(jwt, site, principal);
  if (!payer) return say(409, 'ai_off', 'AI help is off. Ask the studio’s owner to switch it on.', cors, { can_switch: false });
  let st: GoalAi;
  try { st = await readGoalAi(payer); } catch { return say(502, 'read_failed', 'Couldn’t check AI help just now. Try again.', cors); }
  if (!st.ai_on) {
    const mine = await canSwitch(jwt, principal);
    return say(409, 'ai_off', mine ? 'AI help is off. Switch it on in Settings, under Goal and AI help. It costs about 1¢ each time you press Draft or Sum up.' : 'AI help is off. Ask the studio’s owner to switch it on.', cors, { can_switch: mine });
  }
  if (!claudeKey() || !(await tableReady())) return say(503, 'not_ready', 'AI help isn’t ready yet. Try again in a little while.', cors);
  const used = await svcCount(`presence_sales_ai?site_id=eq.${payer}&created_at=gte.${encodeURIComponent(dayAgo(Date.now()))}`);
  if (used === null) return say(502, 'read_failed', 'Couldn’t check today’s count just now. Try again.', cors);
  if (used >= AI_DAY_LIMIT) return say(429, 'day_limit', `That’s ${AI_DAY_LIMIT} AI helps today (about ${AI_DAY_LIMIT * AI_CENTS_SAID}¢). It starts again tomorrow.`, cors);
  if (await spendCapReached()) return say(503, 'resting', 'AI help is resting until tomorrow. Everything else works as usual.', cors);
  return { payer, used };
}

/** Every call is written down, worked or not: it counts toward the day's 50 and the month's
 *  cost. A summary keeps its words (body); a draft never does. */
async function record(payer: string, kind: 'draft' | 'summary', subject: string, body: string | null, cents: number, worked: boolean, principal: Principal): Promise<boolean> {
  const [w] = await Promise.all([
    svc('presence_sales_ai', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ site_id: payer, kind, subject, body, cost_cents: cents, made_by: who(principal) }) }).then((r) => r.ok, () => false),
    logUsage({ tool: 'sales_ai', kind: 'scan', cost_usd: Math.round(cents * 1000) / 100_000, note: `sales AI ${kind}${worked ? '' : ' (failed)'}` }),   // cents carry three places
  ]);
  return w;
}

// ── the facts ─────────────────────────────────────────────────────────────────────────
async function businessOf(siteId: string): Promise<{ business: string; services: SalesFacts['services'] }> {
  const [idn, cat] = await Promise.all([
    svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`).catch(() => null),
    svc(`presence_sales_templates?site_id=eq.${siteId}&kind=eq.proposal&name=eq.__services_catalog__&deleted_at=is.null&select=line_items&order=updated_at.desc&limit=1`).catch(() => null),
  ]);
  const items = rows(cat)[0]?.line_items;
  return {
    business: String(rows(idn)[0]?.business_name || ''),
    services: Array.isArray(items) ? items.filter((i: any) => i && i.label).slice(0, 12).map((i: any) => ({ name: String(i.label), price_cents: Number(i.unit_cents) || null })) : [],
  };
}

// the keys the record page reads its history with (crm.html loadActivity); inside a client the scope alone names them
const RECORD_KEYS = ['contact', 'deal', 'project', 'client_id'] as const;
type Gathered = { facts: SalesFacts; subject: string; lastCallAt: string | null } | { status: number; error: string; message: string };

/** A record's facts, from the record page's own reads. */
async function recordFacts(jwt: string, site: SiteRow, principal: Principal, payer: string, b: any): Promise<Gathered> {
  const q = new URLSearchParams();
  for (const k of RECORD_KEYS) if (UUID_RE.test(String(b?.[k] || ''))) q.set(k, String(b[k]));
  if (![...q.keys()].length && !principal.scope) return { status: 422, error: 'validation', message: 'Open a record to use AI help on it.' };
  if (typeof b?.today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.today)) q.set('today', b.today);
  const { handleCrmRecord, handleCrmActivity } = await import('./crm.ts');
  const [rr, ar, biz] = await Promise.all([
    handleCrmRecord(new Request(`https://presence.local/crm/record?${q}`), jwt, site, principal, {}),
    handleCrmActivity(new Request(`https://presence.local/crm/activity?${q}`), jwt, site, principal, {}),
    businessOf(payer),
  ]);
  if (rr.status === 403) return { status: 403, error: 'forbidden', message: 'Only your studio can use AI help on a record.' };
  const rec = (await rr.json().catch(() => null))?.data, act = (await ar.json().catch(() => null))?.data;
  if (!rr.ok || !rec?.canonical?.value) return { status: rr.status === 404 ? 404 : 502, error: 'read_failed', message: 'Couldn’t read this record just now. Try again.' };
  if (!ar.ok || !act) return { status: 502, error: 'read_failed', message: 'Couldn’t read this record just now. Try again.' };
  const h = rec.header || {}, hl = rec.highlights || {};
  const items: any[] = Array.isArray(act.items) ? act.items : [];
  const said = items.filter((i) => i && (i.type === 'message' || i.type === 'email'));
  const rest = items.filter((i) => i && !(i.type === 'message' || i.type === 'email'));
  const dealId = rec.identity?.deal_id;
  const dealTitle = dealId && Array.isArray(rec.related_deals) ? (rec.related_deals.find((d: any) => d && d.id === dealId)?.title || '') : '';
  const facts: SalesFacts = {
    ...biz,
    person: { name: h.person || h.name || '', company: h.company || '', email: h.email || '' },
    deal: dealId ? { title: dealTitle, stage: hl.stage ? (DEFAULT_STAGE_LABEL as Record<string, string>)[hl.stage] || hl.stage : '', value_cents: Number(hl.value_cents) || null, next_step: hl.next_step || '' } : null,
    owed_cents: Number(hl.owed_cents) || null,
    upcoming: (Array.isArray(act.upcoming) ? act.upcoming : []).map((x: any) => ({ title: String(x?.title || ''), due: x?.due || null, overdue: !!x?.overdue })).filter((x: any) => x.title),
    thread: said.slice(0, 12).reverse().map((i) => ({ at: i.at, who: String(i.title || ''), text: String(i.body || '') })),
    timeline: rest.slice(0, 40).map((i) => ({ at: i.at, text: `${i.title || ''}${i.body ? `: ${i.body}` : ''}` })),
  };
  return { facts, subject: `${rec.canonical.key}:${rec.canonical.value}`, lastCallAt: rest.find((i) => i.type === 'call')?.at || null };
}

/** A website enquiry's facts: what they wrote, and the business's services. */
async function enquiryFacts(site: SiteRow, id: string): Promise<Gathered> {
  const [r, biz] = await Promise.all([
    svc(`presence_form_submissions?id=eq.${id}&site_id=eq.${site.id}&spam=eq.false&select=id,form_kind,name,email,message,source_page,created_at&limit=1`).catch(() => null),
    businessOf(site.id),
  ]);
  if (!r || !r.ok) return { status: 502, error: 'read_failed', message: 'Couldn’t read this enquiry just now. Try again.' };
  const s = rows(r)[0];
  if (!s) return { status: 404, error: 'not_found', message: 'That enquiry isn’t here any more.' };
  const name = String(s.name || s.email || 'They');
  return {
    facts: { ...biz, person: { name: s.name || '', email: s.email || '' }, deal: null, upcoming: [], timeline: [],
      thread: [{ at: s.created_at, who: `${name} wrote through the website${s.source_page ? ` (from ${s.source_page})` : ''}`, text: String(s.message || 'They left their details without a message.') }] },
    subject: `enquiry:${id}`, lastCallAt: null,
  };
}

/** A support request's facts: the request and every message on it, as the Inbox shows them. */
async function supportFacts(jwt: string, site: SiteRow, principal: Principal, id: string): Promise<Gathered> {
  const { handleSupportOne } = await import('./service_intake.ts');
  const [r, biz] = await Promise.all([handleSupportOne(new Request(`https://presence.local/support/${id}`), jwt, site, principal, id, {}), businessOf(site.id)]);
  if (r.status === 404) return { status: 404, error: 'not_found', message: 'That request isn’t here any more.' };
  const d = (await r.json().catch(() => null))?.data;
  if (!r.ok || !d?.request) return { status: 502, error: 'read_failed', message: 'Couldn’t read this request just now. Try again.' };
  const q = d.request, msgs: any[] = Array.isArray(d.messages) ? d.messages : [];
  // a request keeps who asked as a key (an address, or a sign-in id); their messages carry a name
  const email = /@/.test(String(q.requester || '')) ? String(q.requester) : '';
  const named = String(msgs.find((m) => m && m.author_kind === 'client' && m.author)?.author || '');
  const asker = named || email || 'The client';
  return {
    facts: { ...biz, person: { name: named, email }, deal: null, upcoming: [], timeline: [],
      thread: [
        { at: q.created_at, who: `${asker} asked for help: ${String(q.subject || 'a request')}`, text: String(q.body || '') },
        ...msgs.map((m) => ({ at: m.created_at, who: m.author_kind === 'client' ? asker : 'You', text: String(m.body || '') })),
      ] },
    subject: `support:${id}`, lastCallAt: null,
  };
}

// ── POST /sales/ai/draft ──────────────────────────────────────────────────────────────
export async function handleAiDraft(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  let b: any = {}; try { b = await req.json(); } catch { return say(400, 'bad_json', 'That didn’t come through. Try again.', cors); }
  const kind = b?.kind;
  if (kind !== 'enquiry' && kind !== 'support' && kind !== 'record') return say(422, 'validation', 'Say what the reply is for.', cors);
  if (kind !== 'record' && !UUID_RE.test(String(b?.id || ''))) return say(422, 'validation', 'Say which message the reply is for.', cors);
  const g = await gate(jwt, site, principal, cors);
  if (g instanceof Response) return g;
  const got = kind === 'enquiry' ? await enquiryFacts(site, String(b.id))
    : kind === 'support' ? await supportFacts(jwt, site, principal, String(b.id))
    : await recordFacts(jwt, site, principal, g.payer, b);
  if ('status' in got) return say(got.status, got.error, got.message, cors);
  const m = draftMessages(got.facts, String(b?.typed || '').slice(0, 4000), String(b?.subject || '').slice(0, 200));
  const asked = await askClaude(m.system, m.user, 1200);
  const text = asked.ok ? cleanDraft(asked.text) : '';
  await record(g.payer, 'draft', got.subject, null, asked.cents, !!text, principal);
  if (!text) return say(502, asked.ok ? 'ai_failed' : asked.why === 'refusal' ? 'ai_refused' : 'ai_failed', 'Couldn’t write a draft just now. Your message is as you left it.', cors);
  const tzo = Number.isFinite(Number(b?.tzo)) ? Number(b.tzo) : null;
  return json({ data: { text, from: draftFrom(kind, got.facts, new Date().toISOString(), tzo, got.lastCallAt), cost_cents: asked.cents, used_today: g.used + 1, day_limit: AI_DAY_LIMIT } }, 200, cors);
}

// ── GET/POST /sales/ai/summary ────────────────────────────────────────────────────────
export async function handleAiSummary(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'GET') {
    if (principal.member && principal.member.role === 'client_reviewer') return say(403, 'forbidden', 'Only your studio can see this.', cors);
    const subject = new URL(req.url).searchParams.get('subject') || '';
    if (!SUBJECT_RE.test(subject)) return say(422, 'validation', 'Say which record.', cors);
    const payer = await payerOf(jwt, site, principal);
    if (!payer) return json({ data: { summary: null } }, 200, cors);
    const r = await svc(`presence_sales_ai?site_id=eq.${payer}&kind=eq.summary&subject=eq.${encodeURIComponent(subject)}&body=not.is.null&select=body,created_at&order=created_at.desc&limit=1`).catch(() => null);
    if (!r || !r.ok) return json({ data: { summary: null } }, 200, cors);   // before 0201, or a hiccup: the card offers Sum them up
    const row = rows(r)[0];
    let kept: { lines?: unknown; next?: unknown } | null = null;
    try { kept = row ? JSON.parse(String(row.body)) : null; } catch { kept = null; }
    const lines = Array.isArray(kept?.lines) ? (kept!.lines as unknown[]).map(String).slice(0, 3) : [];
    return json({ data: { summary: lines.length ? { lines, next: String(kept?.next || ''), at: String(row.created_at) } : null } }, 200, cors);
  }
  let b: any = {}; try { b = await req.json(); } catch { return say(400, 'bad_json', 'That didn’t come through. Try again.', cors); }
  if (!RECORD_KEYS.some((k) => UUID_RE.test(String(b?.[k] || ''))) && !principal.scope) return say(422, 'validation', 'Open a record to use AI help on it.', cors);
  const g = await gate(jwt, site, principal, cors);
  if (g instanceof Response) return g;
  const got = await recordFacts(jwt, site, principal, g.payer, b);
  if ('status' in got) return say(got.status, got.error, got.message, cors);
  const m = summaryMessages(got.facts);
  const asked = await askClaude(m.system, m.user, 800);
  const s = asked.ok ? parseSummary(asked.text) : { lines: [], next: '' };
  const ok = s.lines.length > 0;
  const at = new Date().toISOString();
  const kept = await record(g.payer, 'summary', got.subject, ok ? JSON.stringify(s) : null, asked.cents, ok, principal);
  if (!ok) return say(502, asked.ok ? 'ai_failed' : asked.why === 'refusal' ? 'ai_refused' : 'ai_failed', 'Couldn’t sum this up just now. Try again in a moment.', cors);
  return json({ data: { summary: { lines: s.lines, next: s.next, at }, subject: got.subject, kept, cost_cents: asked.cents, used_today: g.used + 1, day_limit: AI_DAY_LIMIT } }, 200, cors);
}
