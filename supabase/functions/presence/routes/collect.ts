// ── /px/:siteId — the ONE first-party analytics collector (AN-2) ─────────────
// PUBLIC, pre-auth (a visitor on the customer's published site beacons here).
// Privacy-first: honors Do-Not-Track, drops bots, stores NO raw IP (daily hash),
// NO cookies, NO full referrer. Extremely lightweight — one tiny insert, always
// returns 204, never blocks the visitor. Reuses the public-insert + rate-limit +
// salted-hash pattern from the lead form; adds no new infrastructure.
import { svc } from '../lib/db.ts';
import { rateAllow, clientIp } from '../lib/ratelimit.ts';
import { parseUA, refHost, cleanPath, cleanUtms, visitorDayHash, isVisitKind } from '../lib/visits.ts';

const VISITS_SALT = Deno.env.get('VISITS_SALT') || Deno.env.get('APPROVAL_SECRET') || 'presence-visits';
const noContent = (cors: Record<string, string>) => new Response(null, { status: 204, headers: cors });

export async function handleCollect(req: Request, siteId: string, cors: Record<string, string>) {
  // always succeed silently — analytics must never affect the visitor's experience
  if (!/^[0-9a-f-]{36}$/.test(siteId)) return noContent(cors);
  if ((req.headers.get('dnt') || '') === '1') return noContent(cors);         // respect Do-Not-Track server-side too

  const ip = clientIp(req);
  // generous caps for real traffic; a runaway source is still bounded
  if (!(await rateAllow(`px:ip:${ip}`, 120, 60)) || !(await rateAllow(`px:site:${siteId}`, 1200, 60))) return noContent(cors);

  let b: any = {};
  try { const t = await req.text(); if (t && t.length < 2000) b = JSON.parse(t); } catch { return noContent(cors); }
  const kind = isVisitKind(b?.k) ? b.k : 'pageview';

  const ua = req.headers.get('user-agent') || '';
  const { device, browser, os, bot } = parseUA(ua);
  if (bot) return noContent(cors);                                            // bots are never stored

  const host = (() => { try { return new URL(req.headers.get('origin') || req.headers.get('referer') || '').hostname; } catch { return ''; } })();
  const utm = cleanUtms(b?.u);
  const day = new Date().toISOString().slice(0, 10);
  const visitor = await visitorDayHash(ip, ua, siteId, day, VISITS_SALT);
  const country = (req.headers.get('cf-ipcountry') || req.headers.get('x-country') || '').slice(0, 2).toUpperCase().replace(/[^A-Z]/g, '');
  const region = (req.headers.get('cf-region') || '').slice(0, 40);

  // fire-and-forget insert; never await-block the response beyond the write
  await svc('presence_visits', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      site_id: siteId, kind,
      path: cleanPath(b?.p || '/'),
      ref_host: kind === 'pageview' ? refHost(String(b?.r || ''), host) : '',
      utm_source: utm.source, utm_medium: utm.medium, utm_campaign: utm.campaign,
      device, browser, os, country, region, visitor_hash: visitor,
    }),
  }).catch(() => {});
  return noContent(cors);
}
