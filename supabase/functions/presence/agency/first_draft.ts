// ── + New site's first draft (builder list item 332) ──────────────────────────
//   POST /agency/sites/:id/first-draft   {services: [up to 3], town, tone}
// A new site used to start as "This is sample text". The server could already draft a
// starter site (the writer's starter_site, writer/engine.ts), but only the client's own
// first-run page (get-started.html) asked for it. + New site now has one optional step,
// three things the business offers, the town and how it should sound, and right after the
// site is made the page sends them here. This runs that same starter draft and accepts it
// into the site's private draft: Home, About, Services and Contact get real words (the
// tagline, the description, the story, the services, three questions answered), every one
// editable, nothing published, nobody emailed. Then a photo to open with: real stock photos
// when the stock library is on, and until its key is in (item 263) a stand-in picture for
// the kind of business (lib/stand_in.ts), which the publish check asks to be swapped.
// The same plan rule, cost ceiling and honest "not switched on" answer as /writer/generate.
import { json } from '../../_shared/http.ts';
import { svc, svcCount } from '../lib/db.ts';
import { generateDraft, acceptDraft } from '../writer/engine.ts';
import { anthropicModel } from '../writer/model.ts';
import { loadPlan, draftingDenial } from '../commerce/enforce.ts';
import { meterModel, raiseCapacityNoticeIfNeeded, checkAiCeiling, ceilingDenial } from '../commerce/metering.ts';
import { stockProvider } from '../lib/stock/registry.ts';
import { importImage } from '../lib/media.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { BUSINESS_KINDS, DRAFT_TONES, familyOf } from '../lib/design_gallery.ts';
import { STAND_IN_ALT, fetchStandIn } from '../lib/stand_in.ts';
import type { WriterRequest } from '../writer/contract.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

export interface FirstDraftAsk { services: string[]; town: string; tone: string }
const line = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** The three answers, made safe: up to three services of 80 characters, a town of 80, one of
 *  the five tones (friendly when none). Something to draft from is needed: a service or a
 *  town. Pure. */
export function cleanAsk(b: unknown): FirstDraftAsk | { error: string; message: string } {
  const o = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>;
  const services = (Array.isArray(o.services) ? o.services : []).map((s) => line(s, 80)).filter(Boolean).slice(0, 3);
  const town = line(o.town, 80);
  const tone = DRAFT_TONES.some((t) => t.key === o.tone) ? String(o.tone) : 'friendly';
  if (!services.length && !town) return { error: 'nothing_to_draft', message: 'Add one thing they offer, or the town, so there’s something to write from.' };
  return { services, town, tone };
}

/** The kind of business in words ("Hair salon"), from the site's industry key. Pure. */
export function kindWords(industryKey: string | null | undefined): string {
  const k = String(industryKey || '');
  for (const kind of BUSINESS_KINDS) {
    const exact = kind.exact.find((e) => e.key === k);
    if (exact) return exact.key === 'generic' ? 'local business' : exact.label.toLowerCase();
    if (kind.key === k) return kind.key === 'generic' ? 'local business' : kind.label.toLowerCase();
  }
  return 'local business';
}

/** What the writer is asked: the services and the town are the owner's facts, said verbatim;
 *  the tone is the one direction it writes in. Pure. */
export function starterRequest(ask: FirstDraftAsk, kind: string, name: string): WriterRequest {
  const tone = DRAFT_TONES.find((t) => t.key === ask.tone) || DRAFT_TONES[0];
  return {
    kind: 'starter_site',
    tones: [tone.words],
    instructions: `A ${kind} called ${name}${ask.town ? ` in ${ask.town}` : ''}. Write the words for the Home, About, Services and Contact pages, ${tone.words}. Say only what the facts say.`.slice(0, 600),
    starter: { services: ask.services.map((s) => ({ name: s })), goals: ask.town ? `Based in ${ask.town}.` : '' },
  };
}

export type PhotoOutcome = 'stock' | 'stand_in' | 'none';

/** The cover photo for the draft, then up to three service photos: stock when the library is
 *  on, else the kind's stand-in for the cover alone. Never throws. */
async function addPhotos(site: SiteRow, industryKey: string, kind: string, principal: Principal): Promise<PhotoOutcome> {
  const setCover = async (mediaId: string) => {
    const w = await svc('presence_settings?on_conflict=site_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ site_id: site.id, cover_media_id: mediaId }) }).catch(() => null);
    if (w?.ok) await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'update', summary: 'Added a photo to open the home page with', principal, provenance: 'ai_approved', fields: ['cover_media_id'] }).catch(() => {});
    return !!w?.ok;
  };
  const provider = stockProvider();
  if (provider.available()) {
    try {
      const fetchOne = async (query: string, landscape: boolean) => {
        const imgs = await provider.search(query, 1);
        const pick = (landscape ? imgs.find((i) => (i.width || 0) > (i.height || 0)) : null) || imgs[0];
        if (!pick) return null;
        const dl = await provider.download(pick.id);
        if (!dl) return null;
        const res = await importImage(site.id, dl.bytes, dl.mime, (pick.alt || kind).slice(0, 300), {
          width: dl.width, height: dl.height, collection: 'stock',
          metadata: { source: provider.key, source_name: provider.name, stock_id: pick.id, license: provider.license.name, license_url: provider.license.url, ...(pick.credit ? { attribution: pick.credit.slice(0, 120) } : {}) },
        });
        return 'media_id' in res ? String(res.media_id) : null;
      };
      const cover = await fetchOne(kind, true);
      if (cover && await setCover(cover)) {
        const offs = await svc(`presence_offerings?site_id=eq.${site.id}&deleted_at=is.null&media_id=is.null&select=id,name&order=sort_order.asc&limit=3`).catch(() => null);
        const rows = (Array.isArray(offs?.json) ? offs!.json : []) as Array<{ id: string; name: string }>;
        await Promise.all(rows.map(async (o) => {
          const id = await fetchOne(`${o.name} ${kind}`, false).catch(() => null);
          if (id) await svc(`presence_offerings?id=eq.${o.id}&site_id=eq.${site.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ media_id: id }) }).catch(() => null);
        }));
        return 'stock';
      }
    } catch (e) { console.warn('[first-draft] stock photos failed:', String(e).slice(0, 200)); }
  }
  const bytes = await fetchStandIn(familyOf(industryKey));
  if (!bytes) return 'none';
  const res = await importImage(site.id, bytes, 'image/jpeg', STAND_IN_ALT, { width: 1600, height: 1000, collection: 'stand-in', metadata: { stand_in: true, family: familyOf(industryKey) } }).catch(() => null);
  return res && 'media_id' in res && await setCover(String(res.media_id)) ? 'stand_in' : 'none';
}

/** POST /agency/sites/:id/first-draft. The caller has already checked the site is the studio's. */
export async function handleFirstDraft(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  let body: unknown = null; try { body = await req.json(); } catch { /* answered below */ }
  const ask = cleanAsk(body);
  if ('error' in ask) return json(ask, 400, cors);
  const plan = await loadPlan(site.client_id);
  const denied = draftingDenial(plan, cors);
  if (denied) return denied;
  const ceil = await checkAiCeiling(site.client_id);
  if (!ceil.allowed) { const d = ceilingDenial(cors); return json(d.body, d.status, d.cors); }
  const model = meterModel(anthropicModel(), { siteId: site.id, clientId: site.client_id, agent: 'writer' });
  if (!model) return json({ error: 'writer_unavailable', message: 'Writing the first draft isn’t switched on right now. The site is ready, with sample words to change by hand.' }, 503, cors);

  const [identR, setR] = await Promise.all([
    svc(`presence_identity?site_id=eq.${site.id}&select=business_name,service_area&limit=1`).catch(() => null),
    svc(`presence_settings?site_id=eq.${site.id}&select=industry_key&limit=1`).catch(() => null),
  ]);
  const ident = ((Array.isArray(identR?.json) && identR!.json[0]) || {}) as { business_name?: string; service_area?: string };
  const industry = String(((Array.isArray(setR?.json) && setR!.json[0]) || {}).industry_key || 'generic');
  const kind = kindWords(industry);
  // the town is where the site says it works, unless it already says (a fact the writer can use)
  if (ask.town && !String(ident.service_area || '').trim()) {
    await svc(`presence_identity?site_id=eq.${site.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ service_area: `Serving ${ask.town}` }) }).catch(() => null);
  }
  const gen = await generateDraft(site, starterRequest(ask, kind, String(ident.business_name || 'the business')), model);
  if (!gen.ok || !gen.draft_id) {
    const msg = gen.error === 'all_options_failed_fact_guard'
      ? 'The draft came back saying things we can’t check, so it was set aside. Try again, or write the words by hand.'
      : 'The first draft didn’t come through. Nothing was changed; the site is ready with sample words. Try again in a moment.';
    return json({ error: 'generate_failed', message: msg }, 502, cors);
  }
  const acc = await acceptDraft(site, gen.draft_id, 0, null, principal);
  if (!acc.ok) console.warn('[first-draft] the accept didn’t land:', acc.error);
  if (!acc.ok) return json({ error: 'apply_failed', message: 'The draft was written but didn’t land in the site. Nothing was changed; try again in a moment.' }, 502, cors);
  raiseCapacityNoticeIfNeeded(site, plan).catch(() => {});
  const photos = await addPhotos(site, industry, kind, principal);
  // what the draft now holds, for the page to say in plain words
  const [services, questions] = await Promise.all([
    svcCount(`presence_offerings?site_id=eq.${site.id}&deleted_at=is.null`).catch(() => null),
    svcCount(`presence_faqs?site_id=eq.${site.id}&deleted_at=is.null`).catch(() => null),
  ]);
  return json({ data: { written: true, services: services ?? 0, questions: questions ?? 0, photos } }, 200, cors);
}
