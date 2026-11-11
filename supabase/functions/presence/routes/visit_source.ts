// ── An enquiry notes where its visitor came from (sales item 89, Nov 2026) ───
// Runs after a website form is sent (index.ts, once handleFormSubmit has answered
// the visitor): finds the enquiry this visitor just sent by the IP hash the form
// keeps, rebuilds the visit counter's daily visitor hash from the same request
// (routes/collect.ts) to read their page views from today and yesterday, and notes
// where the visit began on the enquiry (fields.__visit, lib/visit_source.ts).
// Best-effort and after the response: nothing found, nothing noted, and the visitor
// never waits for it. Someone who asked not to be tracked (Do Not Track) left no page
// views, so nothing is noted for them.
import { svc } from '../lib/db.ts';
import { clientIp } from '../lib/ratelimit.ts';
import { visitorDayHash } from '../lib/visits.ts';
import { enquiryVisit, type VisitView } from '../lib/visit_source.ts';
import { hashIp } from './commercial.ts';
import { VISITS_SALT } from './collect.ts';

const DAY_MS = 86_400_000;
const rowsOf = (r: { ok?: boolean; json?: unknown } | null) => (r && r.ok && Array.isArray(r.json) ? r.json as any[] : []);

/** Note on the enquiry just sent (at or after `sentAtMs`) where its visitor came from.
 *  True when a note was written. */
export async function noteVisitSource(req: Request, siteId: string, sentAtMs: number): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(siteId) || (req.headers.get('dnt') || '') === '1') return false;
  const ipHash = await hashIp(req);
  if (!ipHash) return false;
  // the database's clock may run a little behind this one: look a few seconds back
  const since = new Date(sentAtMs - 5_000).toISOString();
  const sub = rowsOf(await svc(`presence_form_submissions?site_id=eq.${siteId}&ip_hash=eq.${ipHash}&created_at=gte.${encodeURIComponent(since)}&select=id,fields&order=created_at.desc&limit=1`).catch(() => null))[0];
  const fields = sub && sub.fields && typeof sub.fields === 'object' && !Array.isArray(sub.fields) ? sub.fields : {};
  if (!sub || fields.__visit) return false;
  // the visit counter's hash for this visitor, today's and yesterday's (a visit can cross midnight UTC)
  const ip = clientIp(req), ua = req.headers.get('user-agent') || '';
  const days = [...new Set([sentAtMs, sentAtMs - DAY_MS].map((ms) => new Date(ms).toISOString().slice(0, 10)))];
  const hashes = await Promise.all(days.map((d) => visitorDayHash(ip, ua, siteId, d, VISITS_SALT)));
  const views: VisitView[] = rowsOf(await svc(`presence_visits?site_id=eq.${siteId}&kind=eq.pageview&visitor_hash=in.(${hashes.join(',')})&ts=gte.${encodeURIComponent(new Date(sentAtMs - DAY_MS).toISOString())}&select=ts,path,ref_host,utm_source,utm_medium,utm_campaign&order=ts.asc&limit=300`).catch(() => null));
  const visit = enquiryVisit(views, sentAtMs);
  if (!visit) return false;
  const w = await svc(`presence_form_submissions?id=eq.${sub.id}&site_id=eq.${siteId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ fields: { ...fields, __visit: visit } }) }).catch(() => null);
  return !!(w && w.ok);
}
