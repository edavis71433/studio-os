// ── One "do next" list per client, the studio's routes (builder list item 184) ──
//   GET  /agency/sites/:id/do-next          the list for one client (lib/do_next.ts)
//   POST /agency/sites/:id/do-next/decide   { key, decision: done | not_relevant | undo, title }
// Studio-side, on the client's Overview: it joins the studio's own Needs you rows for
// this client with what the client's site knows. Anyone who can see the list can mark
// an item, as with Needs you's snooze. A Growth Coach idea marked here is decided in
// the coach too (accept or dismiss), so it isn't suggested again.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { can, agencySiteIds } from './auth.ts';
import type { AgencyMember } from './auth.ts';
import type { Principal } from '../../_shared/auth.ts';
import { SITE_COLS, type SiteRow } from '../lib/site.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { composeDoNext, normalizeDecisions, applyDecision, type DoNextFacts } from '../lib/do_next.ts';
import { searchTabExtras } from '../routes/search_tab.ts';
import { liveAddress } from '../lib/search_visibility.ts';
import { decideOpportunity } from '../coach/engine.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';

const rows = (r: unknown): any[] => { const j = (r as { json?: unknown } | null)?.json; return Array.isArray(j) ? j : []; };
const safe = async <T>(p: Promise<T>): Promise<T | null> => { try { return await p; } catch { return null; } };

export interface DoNextDeps { needs: () => Promise<{ rows?: any[]; rest?: any[] }> }

/** What the list is made from, for one client site. Each read is best-effort. */
export async function doNextFacts(site: SiteRow, needs: DoNextDeps['needs']): Promise<DoNextFacts> {
  const [needsD, healthQ, connQ, extQ, gbpQ, pendQ, aiQ, ideaQ] = await Promise.all([
    safe(needs()),
    safe(svc(`presence_health_days?site_id=eq.${site.id}&select=issues&order=day.desc&limit=1`)),
    safe(svc(`presence_connections?site_id=eq.${site.id}&provider_key=in.(google_search_console,google_business_profile)&select=provider_key,status`)),
    safe(svc(`presence_monitor_connections?site_id=eq.${site.id}&select=domain&limit=1`)),
    safe(svc(`presence_connected_data?site_id=eq.${site.id}&provider_key=eq.google_business_profile&select=data&limit=1`)),
    safe(svc(`presence_reviews?site_id=eq.${site.id}&status=eq.pending&select=id&limit=50`)),
    safe(svc(`presence_ai_checks?site_id=eq.${site.id}&select=results&order=month.desc&limit=1`)),
    safe(svc(`presence_growth_opportunities?site_id=eq.${site.id}&status=eq.open&select=id,opportunity,suggested_next_step,timing_phrase&order=created_at.desc&limit=5`)),
  ]);
  const conn = new Map(rows(connQ).map((c) => [c.provider_key, c.status]));
  const address = liveAddress(site, rows(extQ)[0]?.domain || null);
  const extras = await safe(searchTabExtras(site, { address, consoleConnected: conn.get('google_search_console') === 'connected', listingConnected: conn.get('google_business_profile') === 'connected', period: null, review: null }));
  const allNeeds = [...(needsD?.rows || []), ...(needsD?.rest || [])].filter((r) => r && r.site_id === site.id);
  const gbp = rows(gbpQ)[0]?.data || null;
  return {
    siteId: site.id,
    needs: allNeeds.map((r) => ({ key: String(r.key), what: String(r.what || ''), when: String(r.when || ''), verb: String(r.verb || 'Open'), href: String(r.href || '') })),
    health: healthQ && (healthQ as { ok?: boolean }).ok && Array.isArray(rows(healthQ)[0]?.issues) ? rows(healthQ)[0].issues : null,
    search: extras ? extras.tasks : null,
    reviews: { googleUnreplied: Number(gbp?.unreplied_reviews) || 0, pending: rows(pendQ).length },
    ai: rows(aiQ)[0] ? { results: Array.isArray(rows(aiQ)[0].results) ? rows(aiQ)[0].results : [] } : null,
    ideas: rows(ideaQ).map((i) => ({ id: String(i.id), opportunity: String(i.opportunity || ''), suggested_next_step: String(i.suggested_next_step || ''), timing_phrase: i.timing_phrase || null })),
  };
}

/** The Do next routes, or null when the route is someone else's. */
export async function handleDoNext(req: Request, route: string, method: string, member: AgencyMember, principal: Principal, cors: Record<string, string>, deps: DoNextDeps): Promise<Response | null> {
  const m = route.match(/^\/agency\/sites\/([0-9a-f-]{36})\/do-next(\/decide)?$/);
  if (!m) return null;
  const siteId = m[1], decide = !!m[2];
  if (decide ? method !== 'POST' : method !== 'GET') return null;
  if (!can(member.role, 'read')) return json({ error: 'forbidden', message: 'Your role can’t see this.' }, 403, cors);
  if (!UUID_RE.test(siteId) || !(await agencySiteIds(member.agency_id)).includes(siteId)) return json({ error: 'not_found', message: 'That client isn’t one of yours.' }, 404, cors);
  const site = rows(await svc(`presence_sites?id=eq.${siteId}&select=${SITE_COLS}&limit=1`).catch(() => null))[0] as SiteRow | undefined;
  if (!site) return json({ error: 'not_found', message: 'That client isn’t one of yours.' }, 404, cors);
  const nowIso = new Date().toISOString();
  if (decide) {
    let b: { key?: unknown; decision?: unknown; title?: unknown } = {}; try { b = await req.json(); } catch { /* answered below */ }
    const key = String(b.key ?? '');
    let refused = '';
    const saved = await updateReservedJson(site.id, RESERVED_NAMES.doNext, (cur) => {
      const r = applyDecision(normalizeDecisions(cur), key, b.decision, String(b.title || ''), member.email || null, nowIso);
      if ('error' in r) { refused = r.error; throw new Error('refused'); }
      return r;
    }, member.email || 'studio').catch(() => null);
    if (refused) return json({ error: 'bad_request', message: refused }, 400, cors);
    if (!saved) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed; try again.' }, 502, cors);
    // a coach idea is decided in the coach too, so it isn't suggested again
    const idea = key.match(/^idea:([0-9a-f-]{36})$/);
    if (idea && (b.decision === 'done' || b.decision === 'not_relevant')) await decideOpportunity(site.id, idea[1], b.decision === 'done' ? 'accept' : 'dismiss').catch(() => null);
    return json({ data: composeDoNext(await doNextFacts(site, deps.needs), normalizeDecisions(saved), nowIso) }, 200, cors);
  }
  const [facts, decisions] = await Promise.all([doNextFacts(site, deps.needs), readReservedJson(site.id, RESERVED_NAMES.doNext)]);
  return json({ data: composeDoNext(facts, normalizeDecisions(decisions), nowIso) }, 200, cors);
}
