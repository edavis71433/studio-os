// ── Starter kits: the reads and writes (Phase CP-1) ──────────────────────────
// lib/kits.ts decides what a kit carries and what applying it may touch (pure,
// test-locked). These two do the I/O, for the kit routes in routes.ts and for
// Duplicate site (agency/sites.ts), so a kit is made and applied one way only.
// Callers fence both sites to the agency first.
import { svc } from '../lib/db.ts';
import { buildKitPayload, applyPlan } from '../lib/kits.ts';
import type { KitPayload } from '../lib/kits.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import type { Principal } from '../../_shared/auth.ts';

/** A site's setup as a kit: services, FAQs, voice, colors, industry and the
 *  template it uses. buildKitPayload leaves every business fact out. */
export async function kitFromSite(siteId: string): Promise<KitPayload> {
  const [siteQ, off, faqs, voiceQ, setQ, devQ] = await Promise.all([
    svc(`presence_sites?id=eq.${siteId}&select=template_slug&limit=1`),
    svc(`presence_offerings?site_id=eq.${siteId}&deleted_at=is.null&is_visible=is.true&select=name,category,description,price_text,sort_order&order=sort_order.asc&limit=100`),
    svc(`presence_faqs?site_id=eq.${siteId}&deleted_at=is.null&is_visible=is.true&select=question,answer,sort_order&order=sort_order.asc&limit=50`),
    svc(`presence_voice?site_id=eq.${siteId}&select=tone_notes,preferred_vocabulary,never_claim&limit=1`),
    svc(`presence_settings?site_id=eq.${siteId}&select=industry_key,category_order&limit=1`),
    svc(`presence_dev_customizations?site_id=eq.${siteId}&select=theme_tokens&limit=1`),
  ]);
  return buildKitPayload({
    industry_key: setQ.json?.[0]?.industry_key, template_slug: siteQ.json?.[0]?.template_slug,
    category_order: setQ.json?.[0]?.category_order, offerings: off.json ?? [], faqs: faqs.json ?? [],
    voice: voiceQ.json?.[0] ?? null, theme_tokens: devQ.json?.[0]?.theme_tokens ?? null,
  });
}

/** Apply a kit to a site, fill-only-empty (applyPlan), and record it on the
 *  site's history under `summary`. Says what was applied and what was skipped. */
export async function applyKitTo(kit: KitPayload, siteId: string, principal: Principal, summary: string) {
  const [off, faqs, voiceQ, setQ, devQ] = await Promise.all([
    svc(`presence_offerings?site_id=eq.${siteId}&deleted_at=is.null&select=id&limit=1`),
    svc(`presence_faqs?site_id=eq.${siteId}&deleted_at=is.null&select=id&limit=1`),
    svc(`presence_voice?site_id=eq.${siteId}&select=tone_notes,preferred_vocabulary,never_claim&limit=1`),
    svc(`presence_settings?site_id=eq.${siteId}&select=industry_key,category_order&limit=1`),
    svc(`presence_dev_customizations?site_id=eq.${siteId}&select=theme_tokens&limit=1`),
  ]);
  const v0 = voiceQ.json?.[0];
  const plan = applyPlan(kit, {
    offerings_count: (off.json ?? []).length, faqs_count: (faqs.json ?? []).length,
    has_voice: !!(v0 && (v0.tone_notes || v0.preferred_vocabulary || v0.never_claim)),
    has_tokens: Object.keys(devQ.json?.[0]?.theme_tokens ?? {}).length > 0,
    industry_key: String(setQ.json?.[0]?.industry_key || 'generic'),
    category_order_count: (setQ.json?.[0]?.category_order ?? []).length,
  });
  if (plan.insert_offerings.length) {
    await svc('presence_offerings', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(plan.insert_offerings.map((o) => ({ ...o, site_id: siteId }))) });
  }
  if (plan.insert_faqs.length) {
    await svc('presence_faqs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(plan.insert_faqs.map((f) => ({ ...f, site_id: siteId }))) });
  }
  if (plan.set_voice) await svc(`presence_voice?on_conflict=site_id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ site_id: siteId, ...plan.set_voice }) });
  const setPatch: Record<string, unknown> = {};
  if (plan.set_industry) setPatch.industry_key = plan.set_industry;
  if (plan.set_category_order) setPatch.category_order = plan.set_category_order;
  if (Object.keys(setPatch).length) await svc(`presence_settings?on_conflict=site_id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ site_id: siteId, ...setPatch }) });
  if (plan.set_tokens) await svc(`presence_dev_customizations?on_conflict=site_id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ site_id: siteId, theme_tokens: plan.set_tokens, custom_css: '', custom_html: '' }) });
  await writeChangeEvent({ siteId, entityType: 'settings', entityId: null, action: 'update', summary, principal, provenance: 'human', fields: ['starter_kit'] });
  return {
    applied: { offerings: plan.insert_offerings.length, faqs: plan.insert_faqs.length, voice: !!plan.set_voice, colors: !!plan.set_tokens, industry: plan.set_industry || null },
    skipped: plan.skipped,
  };
}
