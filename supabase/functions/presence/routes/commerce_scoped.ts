// ── /commerce/* for a studio drilled into a client (?client=) ────────────────
// routes/commerce.ts answers for the caller, which is right for an owner in their
// own room and wrong here: the page is asking about the client. index.ts sends a
// signed-in /commerce request with a scope through the ordinary gate (scope,
// entitlement, reviewer) and then here, so a denied scope never reaches this file
// and can't fall back to the caller's own site.
//
// One route answers: POST /commerce/notices/dismiss. Today and the bell read their
// notices from /portal/feed, which has always honoured the scope, so Done and Clear
// send the client's row ids and need the client's row. Everything else refuses,
// whether it exists today or is added later. No page in a drill-in calls any of it:
//   subscription, portal   a portal session can change or cancel the plan, and neither
//                          the studio's billing nor the client's belongs on this page
//   notices, first-run     the plan card and the welcome are the owner's
//   first-run/dismiss      one row per site, so it would hide the client's own welcome
//   delete-*, example-data they act on an account, and answered for the studio's own
//
// Every read and write goes through `db`, which index.ts built for this one site.
// This file imports neither svc nor asUser, so it has no other way to the data.
import { json } from '../../_shared/http.ts';
import { noticeDismissible, NOTICE_ACCOUNT_KINDS } from '../lib/inbox_feed.ts';
import type { SiteDb } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';

type Cors = Record<string, string>;

export async function handleScopedCommerce(req: Request, db: SiteDb, site: SiteRow, route: string, method: string, cors: Cors): Promise<Response> {
  if (route === '/commerce/notices/dismiss' && method === 'POST') return handleScopedNoticeDismiss(req, db, site, cors);
  return json({
    error: 'owner_only',
    message: 'That belongs to an account, not a site, so it isn’t available while you’re working on a client’s site. For your own account, leave this client first.',
  }, 403, cors);
}

// The row is read first, as in the owner's route: only the row can be trusted for
// its kind and period. Unlike that route there is no no-id fallback, because its one
// job is to clear the capacity card, and that card is the owner's.
async function handleScopedNoticeDismiss(req: Request, db: SiteDb, site: SiteRow, cors: Cors): Promise<Response> {
  let body: any = null;
  try { body = await req.json(); } catch { body = null; }
  const id = body && typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return json({ error: 'bad_request', message: 'Say which item to clear.' }, 422, cors);
  const row = `id=eq.${encodeURIComponent(id)}&site_id=eq.${site.id}&status=eq.active`;
  const notice = (await db(`presence_plan_notices?${row}&select=id,kind,period&limit=1`)).json?.[0];
  if (!notice) return json({ error: 'not_found', message: 'That item isn’t on this client’s list.' }, 404, cors);
  if (!noticeDismissible(notice.kind, notice.period)) {
    return json({ error: 'not_dismissable', message: 'This one can’t be cleared by hand — it clears itself the moment it’s genuinely resolved.' }, 409, cors);
  }
  if (NOTICE_ACCOUNT_KINDS.has(String(notice.kind))) {
    return json({ error: 'not_dismissable', message: 'That one is for the account owner, so it stays on their list.' }, 409, cors);
  }
  const up = await db(`presence_plan_notices?${row}`, { method: 'PATCH', body: JSON.stringify({ status: 'dismissed' }) });
  if (!up.ok) return json({ error: 'unavailable', message: 'We couldn’t clear that just now. Nothing changed.' }, 502, cors);
  return json({ data: { dismissed: true } }, 200, cors);
}
