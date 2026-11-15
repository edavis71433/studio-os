// ── GET/POST /sales/setup — the setup strip on Home (sales item 105) ──────────
//   GET   the steps a studio sets up once, each checked against the real thing, and
//         whether the strip was hidden. A check that can't be read leaves its step off.
//   POST  { hidden: true | false } puts the strip away for the whole studio (or back).
//         A studio setting, so a seat needs configure (lib/site_roles.ts).
import { json } from '../../_shared/http.ts';
import { svc, svcCount } from '../lib/db.ts';
import { readReservedJsonOrThrow, writeReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { setupSteps, setupShows, setupHidden } from '../lib/setup_strip.ts';
import { normalizeGoalAi } from '../lib/sales_ai.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const first = async (path: string): Promise<{ row: any } | null> => {
  try { const r = await svc(path); return r.ok && Array.isArray(r.json) ? { row: r.json[0] || null } : null; } catch { return null; }
};

export async function handleSetupStrip(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (req.method === 'POST') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    if (typeof b?.hidden !== 'boolean') return json({ error: 'validation', message: 'Say whether to hide the setup steps.' }, 422, cors);
    const ok = await writeReservedJson(site.id, RESERVED_NAMES.setupStrip, { hidden: b.hidden, at: new Date().toISOString(), by: principal.email || principal.userId || null }, principal.email || principal.userId || 'system');
    return ok ? json({ data: { hidden: b.hidden } }, 200, cors) : json({ error: 'write_failed', message: 'That didn’t save just now. Try again.' }, 502, cors);
  }
  const S = site.id;
  const [ident, loc, settings, services, contacts, deals, stored, goal] = await Promise.all([
    first(`presence_identity?site_id=eq.${S}&select=business_name&limit=1`),
    first(`presence_locations?site_id=eq.${S}&select=address_line1,city&limit=1`),
    first(`presence_settings?site_id=eq.${S}&select=brand_kit,logo_media_id&limit=1`),
    first(`presence_sales_templates?site_id=eq.${S}&kind=eq.proposal&name=eq.__services_catalog__&deleted_at=is.null&select=line_items&order=updated_at.desc&limit=1`),
    svcCount(`presence_contacts?site_id=eq.${S}&deleted_at=is.null`),
    svcCount(`presence_deals?site_id=eq.${S}&deleted_at=is.null`),
    readReservedJsonOrThrow(S, RESERVED_NAMES.setupStrip).then((v) => ({ v }), () => null),
    readReservedJsonOrThrow(S, RESERVED_NAMES.salesGoalAi).then((v) => ({ v }), () => null),   // sales item 94: the month's goal
  ]);
  const steps = setupSteps({
    business: ident && loc ? !!String(ident.row?.business_name || '').trim() && !!String(loc.row?.address_line1 || loc.row?.city || '').trim() : null,
    logo: settings ? !!(settings.row?.logo_media_id || settings.row?.brand_kit?.logo_media_id) : null,
    services: services ? Array.isArray(services.row?.line_items) && services.row.line_items.length > 0 : null,
    contact: contacts === null ? null : contacts > 0,
    deal: deals === null ? null : deals > 0,
    goal: goal ? normalizeGoalAi(goal.v).goal_cents !== null : null,
  });
  // a hide that can't be read is never a strip popping back: it stays away this time
  const hidden = stored ? setupHidden(stored.v) : true;
  return json({ data: { steps, hidden, shows: setupShows(steps, hidden), done: steps.filter((s) => s.done).length, total: steps.length } }, 200, cors);
}
