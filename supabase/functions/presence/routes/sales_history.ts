// ── A deal's history and the lines you logged (sales items 186 and 191, Nov 22 2026 review) ──
//   PATCH /sales/logs/:id            a call, email, meeting or note you logged by hand:
//                                    { kind?, body?, occurred_at? } corrects it (the line says
//                                    "edited"), { remove: true } takes it off every timeline into
//                                    Recently deleted for 30 days, { restore: true } puts it back.
//                                    A deal's logs are deal events (kind 'note', detail.activity_kind);
//                                    a person's or a customer's are presence_person_events (0173).
//   GET   /sales/deals/:id/history   ?before=<ISO> the 200 history lines older than that, for the
//                                    deal page's "Show older" (the deal read carries the newest 80).
// Only the person who logged a line can change it, and only a line logged by hand: an email
// Studio OS sent, or one logged from your BCC address, stays as it happened.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { UUID_RE } from '../lib/uuid.ts';
import { loadStageLabels, renameMovedTo } from '../lib/stage_names.ts';
import {
  isDealActivityKind, activityNeedsBody, cleanActivityBody, normalizeOccurredAt, mergeDealTimeline, markMine, writtenByStudioOs,
  type DealActivityKind, type DealChange,
} from '../crm/deal_activity.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: any): any[] => (r && Array.isArray(r.json) ? r.json : []);
const actorOf = (p: Principal) => String(p.email || p.userId || 'system');
export const LOG_KEEP_DAYS = 30;
export const HISTORY_PAGE = 200;
const NEEDS_UPDATE = 'Changing a logged line needs a quick database update first. Try again a little later.';

/** What a correction asks for, cleaned, or an error to say. Pure. */
export function logEditIn(b: any, current: { kind: string; body: string; occurred_at: string }, nowIso: string):
  { ok: true; kind: DealActivityKind; body: string; occurred_at: string } | { ok: false; message: string } {
  const kind = (b?.kind === undefined ? current.kind : b.kind) as DealActivityKind;
  if (!isDealActivityKind(kind)) return { ok: false, message: 'Pick a call, email, meeting or note.' };
  const body = b?.body === undefined ? String(current.body || '') : cleanActivityBody(b.body);
  if (activityNeedsBody(kind) && !body) return { ok: false, message: 'A note needs a few words.' };
  const occurred_at = b?.occurred_at === undefined || b.occurred_at === '' ? String(current.occurred_at || nowIso) : normalizeOccurredAt(b.occurred_at, nowIso);
  return { ok: true, kind, body, occurred_at };
}

/** A removed deal log's detail, and the detail it gets back. Pure. */
export function removedDetail(d: Record<string, unknown>, by: string, at: string): Record<string, unknown> {
  const { activity_kind, body, ...rest } = d || {};
  return { ...rest, activity_kind: 'removed', removed: { activity_kind, body: body ?? '' }, removed_at: at, removed_by: by };
}
export function restoredDetail(d: Record<string, unknown>): Record<string, unknown> | null {
  const r = d && typeof d.removed === 'object' && d.removed ? d.removed as Record<string, unknown> : null;
  if (!r || !isDealActivityKind(r.activity_kind)) return null;
  const { removed: _r, removed_at: _a, removed_by: _b, ...rest } = d;
  return { ...rest, activity_kind: r.activity_kind, body: r.body ?? '' };
}

export async function handleSalesLog(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  if (req.method !== 'PATCH') return json({ error: 'method_not_allowed' }, 405, cors);
  let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
  const now = new Date().toISOString(), me = actorOf(principal);
  const notYours = () => json({ error: 'not_yours', message: 'Only the person who logged it can change it.' }, 403, cors);
  const gone = () => json({ error: 'not_found', message: 'That line isn’t there any more. Refresh to see what’s there.' }, 404, cors);
  const failed = () => json({ error: 'write_failed', message: 'That didn’t save. Try again in a moment.' }, 502, cors);
  const sameActor = (a: unknown) => String(a || '').trim().toLowerCase() === me.trim().toLowerCase();

  // ── a deal's own log ──
  const ev = rows(await svc(`presence_deal_events?id=eq.${id}&site_id=eq.${site.id}&kind=eq.note&select=id,deal_id,detail,actor,created_at&limit=1`).catch(() => null))[0];
  if (ev) {
    const d = (ev.detail && typeof ev.detail === 'object') ? ev.detail : {};
    if (!sameActor(ev.actor)) return notYours();
    const patchDeal = async (detail: Record<string, unknown>) => {
      const up = await svc(`presence_deal_events?id=eq.${id}&site_id=eq.${site.id}&kind=eq.note&select=id,deal_id,detail,actor,created_at`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ detail }) });
      return up.ok ? rows(up)[0] || null : null;
    };
    if (b.restore === true) {
      const back = d.activity_kind === 'removed' && String(d.removed_at || '') >= keepSince() ? restoredDetail(d) : null;
      if (!back) return gone();
      const row = await patchDeal(back);
      return row ? json({ data: { ok: true, restored: true, deal_id: row.deal_id } }, 200, cors) : failed();
    }
    if (!isDealActivityKind(d.activity_kind) || writtenByStudioOs(d)) return gone();   // removed already, or written by Studio OS
    if (b.remove === true) {
      const row = await patchDeal(removedDetail(d, me, now));
      return row ? json({ data: { ok: true, removed: true, deal_id: row.deal_id, keep_days: LOG_KEEP_DAYS } }, 200, cors) : failed();
    }
    const e = logEditIn(b, { kind: String(d.activity_kind), body: String(d.body || ''), occurred_at: String(d.occurred_at || ev.created_at) }, now);
    if (!e.ok) return json({ error: 'validation', message: e.message }, 422, cors);
    const row = await patchDeal({ ...d, activity_kind: e.kind, body: e.body, occurred_at: e.occurred_at, edited_at: now, edited_by: me });
    return row ? json({ data: { ok: true, item: mergeDealTimeline([row])[0] || null } }, 200, cors) : failed();
  }

  // ── a person's or a customer's own log (0173) ──
  const pe = rows(await svc(`presence_person_events?id=eq.${id}&site_id=eq.${site.id}&select=id,kind,body,occurred_at,via,actor,deleted_at,contact_id,client_id&limit=1`).catch(() => null))[0];
  if (!pe) return gone();
  if (!sameActor(pe.actor)) return notYours();
  if (writtenByStudioOs(pe)) return gone();
  const patchPerson = async (patch: Record<string, unknown>, filter: string) => {
    const up = await svc(`presence_person_events?id=eq.${id}&site_id=eq.${site.id}${filter}&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
    return up.ok ? !!rows(up)[0] : null;
  };
  if (b.restore === true) {
    if (!pe.deleted_at || String(pe.deleted_at) < keepSince()) return gone();
    const ok = await patchPerson({ deleted_at: null }, '&deleted_at=not.is.null');
    return ok ? json({ data: { ok: true, restored: true, contact_id: pe.contact_id || null, client_id: pe.client_id || null } }, 200, cors) : ok === false ? gone() : failed();
  }
  if (pe.deleted_at) return gone();
  if (b.remove === true) {
    const ok = await patchPerson({ deleted_at: now }, '&deleted_at=is.null');
    return ok ? json({ data: { ok: true, removed: true, keep_days: LOG_KEEP_DAYS } }, 200, cors) : ok === false ? gone() : failed();
  }
  const e = logEditIn(b, { kind: String(pe.kind), body: String(pe.body || ''), occurred_at: String(pe.occurred_at || '') }, now);
  if (!e.ok) return json({ error: 'validation', message: e.message }, 422, cors);
  const fix = { kind: e.kind, body: e.body, occurred_at: e.occurred_at };
  let ok = await patchPerson({ ...fix, edited_at: now, edited_by: me }, '&deleted_at=is.null');
  if (ok === null) {
    // before APPLY-0273 there is no edited mark: the correction still saves, and says it carries none
    ok = await patchPerson(fix, '&deleted_at=is.null');
    if (ok) return json({ data: { ok: true, warning: 'no_edit_mark', message: NEEDS_UPDATE } }, 200, cors);
  }
  return ok ? json({ data: { ok: true } }, 200, cors) : ok === false ? gone() : failed();
}
const keepSince = () => new Date(Date.now() - LOG_KEEP_DAYS * 86_400_000).toISOString();

/** Sales item 186: the lines removed in the last 30 days, for Recently deleted: { kind, body,
 *  at, removed_at, deal_id | contact_id | client_id }, newest removal first. null = couldn't read. */
export async function deletedLogs(siteId: string, me: string): Promise<any[] | null> {
  const since = encodeURIComponent(keepSince()), who = encodeURIComponent(me);
  const [dl, pl] = await Promise.all([
    svc(`presence_deal_events?site_id=eq.${siteId}&kind=eq.note&actor=eq.${who}&detail->>activity_kind=eq.removed&detail->>removed_at=gte.${since}&select=id,deal_id,detail,created_at&order=created_at.desc&limit=200`).catch(() => null),
    svc(`presence_person_events?site_id=eq.${siteId}&actor=eq.${who}&via=eq.&deleted_at=gte.${since}&select=id,kind,body,occurred_at,deleted_at,contact_id,client_id&order=deleted_at.desc&limit=200`).catch(() => null),
  ]);
  if (!dl || !dl.ok) return null;
  const out = rows(dl).map((e: any) => { const d = e.detail || {}, r = d.removed || {}; return { id: e.id, kind: String(r.activity_kind || 'note'), body: String(r.body || ''), at: String(d.occurred_at || e.created_at), removed_at: String(d.removed_at || ''), deal_id: e.deal_id || null, contact_id: null, client_id: null }; });
  // before APPLY-0173 there are no person logs; a failed read leaves them out of the list
  if (pl && pl.ok) for (const p of rows(pl)) out.push({ id: p.id, kind: String(p.kind || 'note'), body: String(p.body || ''), at: String(p.occurred_at || ''), removed_at: String(p.deleted_at || ''), deal_id: null, contact_id: p.contact_id || null, client_id: p.client_id || null });
  return out.sort((a, b) => (a.removed_at < b.removed_at ? 1 : -1));
}

/** Sales item 191: write a saved change's history lines on the deal (best-effort: the save itself
 *  already happened, and a lost line is never a failed save). */
export async function writeDealChanges(siteId: string, dealId: string, principal: Principal, changes: DealChange[]): Promise<void> {
  if (!changes.length) return;
  const actor = actorOf(principal);
  await svc('presence_deal_events', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(changes.map((detail) => ({ deal_id: dealId, site_id: siteId, kind: 'note', actor, actor_kind: principal.kind, detail }))) }).catch(() => {});
}
/** Undo on a ticked next step takes back the "Done:" line it just wrote (the last 15 minutes, yours). */
export async function undoStepDone(siteId: string, dealId: string, principal: Principal, step: string): Promise<void> {
  const since = encodeURIComponent(new Date(Date.now() - 15 * 60_000).toISOString());
  await svc(`presence_deal_events?deal_id=eq.${dealId}&site_id=eq.${siteId}&kind=eq.note&actor=eq.${encodeURIComponent(actorOf(principal))}&detail->>change=eq.step_done&detail->>step=eq.${encodeURIComponent(step.slice(0, 200))}&created_at=gte.${since}`, { method: 'DELETE' }).catch(() => {});
}

export async function handleDealHistory(req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const before = new URL(req.url).searchParams.get('before') || '';
  if (!Number.isFinite(Date.parse(before))) return json({ error: 'validation', message: 'Say where the older history starts.' }, 422, cors);
  const deal = rows(await svc(`presence_deals?id=eq.${id}&site_id=eq.${site.id}&deleted_at=is.null&select=id&limit=1`).catch(() => null))[0];
  if (!deal) return json({ error: 'not_found', message: 'That deal is no longer here.' }, 404, cors);
  const [r, names] = await Promise.all([
    svc(`presence_deal_events?deal_id=eq.${id}&site_id=eq.${site.id}&created_at=lt.${encodeURIComponent(new Date(Date.parse(before)).toISOString())}&select=id,kind,from_stage,to_stage,detail,actor,created_at&order=created_at.desc&limit=${HISTORY_PAGE}`),
    loadStageLabels(site.id).catch(() => null),
  ]);
  if (!r.ok) return json({ error: 'read_failed', message: 'The older history couldn’t load just now.' }, 502, cors);
  const list = rows(r);
  const timeline = markMine(mergeDealTimeline(list).map((it) => (names && it.kind === 'stage_change' ? { ...it, text: renameMovedTo(it.text, names) } : it)), actorOf(principal));
  return json({ data: { timeline, more: list.length >= HISTORY_PAGE, before: list.length ? String(list[list.length - 1].created_at) : null } }, 200, cors);
}
