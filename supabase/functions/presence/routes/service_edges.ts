// ── Service-loop edge routes: saved replies + customer FAQ ───────────────────
// Two small owner-managed JSON settings, stored on presence_settings (NO new
// table). Both reads are DEFENSIVE: pre-0095 the column doesn't exist and the
// select 400s, so the route returns an empty result instead of an error — the
// routes are dormant until the owner applies the migration, never broken.
//   • /service/saved-replies  (studio)  GET|PUT  reusable reply snippets
//   • /service/faq            (studio)  GET|PUT  the customer-facing Q&A source
//   • /client/faq             (client)  GET      the agency's FAQ, rendered
//
// TODO (deferred, clean): the owner-facing EDITOR for saved replies + the FAQ is
// not yet wired into the settings surface (presence.html). The API (GET/PUT above)
// + validation (lib/saved_replies.ts, lib/faq.ts) + the CONSUME surfaces are done:
// the saved-reply picker appears in the studio support reply (projects.html) and
// the FAQ renders in the client portal (client.html /client/faq). A small settings
// panel that lists/edits snippets + Q&A pairs and PUTs them here is all that remains.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { isStudioSide, studioDenied } from './projects.ts';
import { normalizeSavedReplies } from '../lib/saved_replies.ts';
import { normalizeFaq, renderFaq } from '../lib/faq.ts';
import { linksForCustomer } from '../lib/service_bridge.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any).json) ? (r as any).json : []) as any[];

/** Read one JSON settings column defensively — a pre-migration "column does not
 *  exist" 400 (or any read failure) yields null, never an error. */
async function readSetting(siteId: string, col: 'saved_replies' | 'customer_faq'): Promise<unknown> {
  try {
    const r = await svc(`presence_settings?site_id=eq.${siteId}&select=${col}&limit=1`);
    if (!r.ok) return null;                       // column not present yet → dormant
    return rows(r)[0]?.[col] ?? null;
  } catch { return null; }
}

/** Upsert one JSON settings column (merge-duplicates on site_id). Returns false
 *  on any failure (e.g. pre-migration) so the caller can answer honestly. */
async function writeSetting(siteId: string, col: 'saved_replies' | 'customer_faq', value: unknown): Promise<boolean> {
  try {
    const r = await svc('presence_settings?on_conflict=site_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ site_id: siteId, [col]: value }),
    });
    return r.ok;
  } catch { return false; }
}

// ═══ SAVED REPLIES (studio) ═══
export async function handleSavedReplies(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  if (req.method === 'GET') {
    const norm = normalizeSavedReplies(await readSetting(site.id, 'saved_replies'));
    return json({ data: { replies: norm.ok ? norm.replies : [] } }, 200, cors);
  }
  if (req.method === 'PUT') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    const norm = normalizeSavedReplies(b?.replies ?? b);
    if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors);
    const okw = await writeSetting(site.id, 'saved_replies', norm.replies);
    if (!okw) return json({ error: 'unavailable', message: 'Saved replies aren’t available on this site yet.' }, 503, cors);
    return json({ data: { replies: norm.replies } }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

// ═══ CUSTOMER FAQ — studio edit ═══
export async function handleFaqAdmin(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  if (!(await isStudioSide(jwt, site, principal))) return studioDenied(cors);
  if (req.method === 'GET') {
    const norm = normalizeFaq(await readSetting(site.id, 'customer_faq'));
    return json({ data: norm.ok ? norm.faq : { items: [] } }, 200, cors);
  }
  if (req.method === 'PUT') {
    let b: any = {}; try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400, cors); }
    // an empty FAQ is a valid "clear it" — store {items:[]} rather than erroring
    const rawItems = Array.isArray(b?.items) ? b.items : (Array.isArray(b) ? b : []);
    if (!rawItems.length && !b?.intro) {
      const okw = await writeSetting(site.id, 'customer_faq', { items: [] });
      return okw ? json({ data: { items: [] } }, 200, cors) : json({ error: 'unavailable', message: 'The FAQ isn’t available on this site yet.' }, 503, cors);
    }
    const norm = normalizeFaq(b);
    if (!norm.ok) return json({ error: 'validation', message: norm.error }, 422, cors);
    const okw = await writeSetting(site.id, 'customer_faq', norm.faq);
    if (!okw) return json({ error: 'unavailable', message: 'The FAQ isn’t available on this site yet.' }, 503, cors);
    return json({ data: norm.faq }, 200, cors);
  }
  return json({ error: 'method_not_allowed' }, 405, cors);
}

// ═══ CUSTOMER FAQ — client portal read (the agency's FAQ, rendered) ═══
export async function handleClientFaq(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>): Promise<Response> {
  const me = site.client_id ? String(site.client_id) : null;
  if (!me) return json({ data: { html: '', faq: { items: [] } } }, 200, cors);
  const links = await linksForCustomer(me);
  if (!links.length) return json({ data: { html: '', faq: { items: [] } } }, 200, cors);
  const agencySiteId = links[0].agency_site_id;   // the studio serving this customer
  const norm = normalizeFaq(await readSetting(agencySiteId, 'customer_faq'));
  const faq = norm.ok ? norm.faq : { items: [] };
  return json({ data: { html: renderFaq(faq), faq } }, 200, cors);
}
