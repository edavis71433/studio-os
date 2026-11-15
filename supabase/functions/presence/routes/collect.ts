// ── /px/:siteId — the ONE first-party analytics collector (AN-2) ─────────────
// PUBLIC, pre-auth (a visitor on the customer's published site beacons here).
// Privacy-first: honors Do-Not-Track, drops bots, stores NO raw IP (daily hash),
// NO cookies, NO full referrer. Extremely lightweight — one tiny insert, always
// returns 204, never blocks the visitor. Reuses the public-insert + rate-limit +
// salted-hash pattern from the lead form; adds no new infrastructure.
import { svc } from '../lib/db.ts';
import { rateAllowBoth, clientIp } from '../lib/ratelimit.ts';
import { parseUA, refHost, cleanPath, cleanUtms, visitorDayHash, isVisitKind, cleanLabel, cleanMs, cleanLcp } from '../lib/visits.ts';

// exported for routes/visit_source.ts, which rebuilds a visitor's daily hash to find their page views (item 89)
export const VISITS_SALT = Deno.env.get('VISITS_SALT') || Deno.env.get('APPROVAL_SECRET') || 'presence-visits';
const noContent = (cors: Record<string, string>) => new Response(null, { status: 204, headers: cors });

export async function handleCollect(req: Request, siteId: string, cors: Record<string, string>) {
  // always succeed silently — analytics must never affect the visitor's experience
  if (!/^[0-9a-f-]{36}$/.test(siteId)) return noContent(cors);
  if ((req.headers.get('dnt') || '') === '1') return noContent(cors);         // respect Do-Not-Track server-side too

  const ip = clientIp(req);
  // generous caps for real traffic; a runaway source is still bounded (item 209: both in one call)
  if (!(await rateAllowBoth({ bucket: `px:ip:${ip}`, max: 120 }, { bucket: `px:site:${siteId}`, max: 1200 }, 60))) return noContent(cors);

  let b: any = {};
  try { const t = await req.text(); if (t && t.length < 2000) b = JSON.parse(t); } catch { return noContent(cors); }
  const kind = isVisitKind(b?.k) ? b.k : 'pageview';
  // list item 157: a page's time comes with how long it was open, or it isn't worth a row
  const ms = kind === 'leave' ? cleanMs(b?.ms) : null;
  if (kind === 'leave' && ms === null) return noContent(cors);
  const label = kind === 'pageview' || kind === 'leave' ? '' : cleanLabel(b?.l);
  const lcp = kind === 'leave' ? cleanLcp(b?.lcp) : null;   // list item 151: how fast the page showed

  const ua = req.headers.get('user-agent') || '';
  const { device, browser, os, bot } = parseUA(ua);
  if (bot) return noContent(cors);                                            // bots are never stored

  const host = (() => { try { return new URL(req.headers.get('origin') || req.headers.get('referer') || '').hostname; } catch { return ''; } })();
  const utm = cleanUtms(b?.u);
  const day = new Date().toISOString().slice(0, 10);
  const visitor = await visitorDayHash(ip, ua, siteId, day, VISITS_SALT);
  const country = (req.headers.get('cf-ipcountry') || req.headers.get('x-country') || '').slice(0, 2).toUpperCase().replace(/[^A-Z]/g, '');
  const region = (req.headers.get('cf-region') || '').slice(0, 40);

  const row = {
    site_id: siteId, kind,
    path: cleanPath(b?.p || '/'),
    ref_host: kind === 'pageview' ? refHost(String(b?.r || ''), host) : '',
    utm_source: utm.source, utm_medium: utm.medium, utm_campaign: utm.campaign,
    device, browser, os, country, region, visitor_hash: visitor,
  };
  const extra = { ...(label ? { label } : {}), ...(ms !== null ? { ms } : {}) };
  const write = (body: Record<string, unknown>) => svc('presence_visits', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body) }).catch(() => null);
  // fire-and-forget insert; never await-block the response beyond the write
  let w = await write({ ...row, ...extra, ...(lcp !== null ? { lcp_ms: lcp } : {}) });
  // Before migration 0160 a page's time is refused with its speed: keep the time.
  if (lcp !== null && w && !w.ok && w.status === 400) w = await write({ ...row, ...extra });
  // Before migration 0156 a row naming a button's words is refused: keep the tap as it was
  // always kept. A button press or a page's time is new, so it waits for the migration.
  if (w && !w.ok && w.status === 400 && Object.keys(extra).length && kind !== 'button' && kind !== 'leave') await write(row);
  return noContent(cors);
}
