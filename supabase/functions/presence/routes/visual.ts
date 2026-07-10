// ── /visual/* — AI Visual Studio (V1) ───────────────────────────────────────
// Brand-aware image generation for the customer's own presence. Every generation
// is an approval-gated plan; the chosen variation enters the media library only
// on approval, with honest ai_approved provenance. Manual parity is untouched:
// /media/upload-url still adds your own photos exactly as before.
//   GET  /visual/kinds                 — the asset kinds you can make (plain + sizes)
//   POST /visual/generate              — { kind, subject, count?, palette? } → proposed plan + variations
//   GET  /visual/plans                 — recent generations (not abandoned)
//   GET  /visual/plans/:id             — one generation
//   POST /visual/plans/:id/vary        — { count? } → more variations, same brief
//   POST /visual/plans/:id/edit        — { instruction, count? } → variations guided by a change
//   POST /visual/plans/:id/decide      — { decision, variation_id?, alt_text? } → approve→store or abandon
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { packFor } from '../writer/pack.ts';
import { ASSET_SPECS, VISUAL_KINDS, isVisualKind, VISUAL_HONESTY } from '../visual/contract.ts';
import { brandSnapshotFrom, planGeneration, runVariations } from '../visual/generate.ts';
import { imageModel, visualConfigured } from '../visual/model.ts';
import { saveVisualPlan, attachVariations, listVisualPlans, getVisualPlan, decideVisualPlan, promoteToLibrary, withPreviews } from '../visual/store.ts';
import { checkAiCeiling, ceilingDenial, recordImageUsage } from '../commerce/metering.ts';

const NOT_AVAILABLE = 'Making images isn’t switched on for your studio yet. Your own photos still work exactly as always — nothing here changes that.';

export function handleVisualKinds(cors: Record<string, string>) {
  return json({ data: {
    kinds: VISUAL_KINDS.map((k) => ASSET_SPECS[k]),
    honesty: VISUAL_HONESTY,
    available: visualConfigured(),
  } }, 200, cors);
}

async function loadBrand(site: SiteRow, palette: string[]) {
  const r = await svc(`presence_brand_profile?site_id=eq.${site.id}&select=personality,voice_characteristics,words_prefer,preferred_vocabulary,words_avoid&limit=1`);
  const profile = (r.ok && r.json?.[0]) || {};
  const industry = packFor(site.template_slug).slug;
  return brandSnapshotFrom(profile, industry, palette);
}

const cleanPalette = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x)).filter((c) => /^#?[0-9a-fA-F]{3,8}$/.test(c)).slice(0, 5) : [];

export async function handleVisualGenerate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const kind = String(body?.kind || '');
  if (!isVisualKind(kind)) return json({ error: 'bad_kind', message: `Choose one of: ${VISUAL_KINDS.join(', ')}.` }, 400, cors);
  const subject = String(body?.subject || '').trim();
  if (subject.length < 3) return json({ error: 'bad_subject', message: 'Tell us in a few words what the image should show.' }, 400, cors);
  const count = Math.max(1, Math.min(4, Number(body?.count) || 3));

  // honest gate — never fake an image
  const model = imageModel();
  if (!model) return json({ error: 'not_available', message: NOT_AVAILABLE }, 503, cors);
  // HARD cost ceiling — enforced BEFORE the (expensive) provider call
  const ceil = await checkAiCeiling(site.client_id);
  if (!ceil.allowed) { const d = ceilingDenial(cors); return json(d.body, d.status, d.cors); }

  const brand = await loadBrand(site, cleanPalette(body?.palette));
  const plan = planGeneration({ kind, subject, brand });
  const row = await saveVisualPlan(site.id, plan);
  if (!row) return json({ error: 'save_failed', message: 'We couldn’t start that — nothing was made. Please try again.' }, 502, cors);

  const run = await runVariations(plan, model, count);
  if (!run.ok) {
    await svc(`presence_visual_plans?id=eq.${row.id}&site_id=eq.${site.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed' }) });
    return json({ error: run.reason || 'failed', message: run.reason === 'not_available' ? NOT_AVAILABLE : 'That didn’t come through — nothing was saved. Please try again.' }, run.reason === 'not_available' ? 503 : 502, cors);
  }
  await attachVariations(site.id, row.id, run.images, run.model, plan.width, plan.height);
  recordImageUsage({ siteId: site.id, clientId: site.client_id, agent: 'visual' }, run.model, (run.images || []).length).catch(() => {}); // meter cost
  return json({ data: await withPreviews(await getVisualPlan(site.id, row.id)) }, 200, cors);
}

export async function handleVisualList(site: SiteRow, cors: Record<string, string>) {
  const plans = await listVisualPlans(site.id);
  return json({ data: await Promise.all(plans.map(withPreviews)) }, 200, cors);
}

export async function handleVisualGet(site: SiteRow, id: string, cors: Record<string, string>) {
  const row = await getVisualPlan(site.id, id);
  if (!row) return json({ error: 'not_found', message: 'That’s not here.' }, 404, cors);
  return json({ data: await withPreviews(row) }, 200, cors);
}

async function regenerate(site: SiteRow, id: string, extraInstruction: string, count: number, cors: Record<string, string>) {
  const existing = await getVisualPlan(site.id, id);
  if (!existing) return json({ error: 'not_found', message: 'That’s not here.' }, 404, cors);
  if (existing.status !== 'proposed') return json({ error: 'not_open', message: 'This one’s already decided — start a new image.' }, 409, cors);
  const model = imageModel();
  if (!model) return json({ error: 'not_available', message: NOT_AVAILABLE }, 503, cors);
  const ceil = await checkAiCeiling(site.client_id);
  if (!ceil.allowed) { const d = ceilingDenial(cors); return json(d.body, d.status, d.cors); }
  const subject = extraInstruction ? `${existing.brief}; ${extraInstruction}` : existing.brief;
  const plan = planGeneration({ kind: existing.kind, subject, brand: existing.brand_snapshot });
  const run = await runVariations(plan, model, count);
  if (!run.ok) return json({ error: run.reason || 'failed', message: run.reason === 'not_available' ? NOT_AVAILABLE : 'That didn’t come through — your earlier options are untouched.' }, run.reason === 'not_available' ? 503 : 502, cors);
  await attachVariations(site.id, id, run.images, run.model, plan.width, plan.height);
  recordImageUsage({ siteId: site.id, clientId: site.client_id, agent: 'visual' }, run.model, (run.images || []).length).catch(() => {});
  return json({ data: await withPreviews(await getVisualPlan(site.id, id)) }, 200, cors);
}

export async function handleVisualVary(req: Request, site: SiteRow, id: string, cors: Record<string, string>) {
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  return regenerate(site, id, '', Math.max(1, Math.min(4, Number(body?.count) || 2)), cors);
}

export async function handleVisualEdit(req: Request, site: SiteRow, id: string, cors: Record<string, string>) {
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const instruction = String(body?.instruction || '').trim();
  if (instruction.length < 2) return json({ error: 'bad_instruction', message: 'Tell us what to change — e.g. “warmer light”, “less busy”.' }, 400, cors);
  return regenerate(site, id, instruction, Math.max(1, Math.min(4, Number(body?.count) || 2)), cors);
}

export async function handleVisualDecide(req: Request, site: SiteRow, id: string, principal: Principal, cors: Record<string, string>) {
  let body: any = {}; try { body = await req.json(); } catch { /* */ }
  const decision = String(body?.decision || '');
  const res = await decideVisualPlan(site.id, id, decision, { variationId: String(body?.variation_id || ''), altText: String(body?.alt_text || '') });
  if (!res.ok) {
    const map: Record<string, [number, string]> = {
      bad_decision: [400, 'Decide with approve or abandon.'],
      not_open: [409, 'This one’s already decided.'],
      no_variation: [400, 'Pick which option to keep first.'],
      alt_required: [422, 'Please describe the image (a few words) — it helps customers and search engines.'],
      write_failed: [502, 'That didn’t go through — nothing changed. Please try again.'],
    };
    const [code, message] = map[res.error || 'write_failed'] || [502, 'That didn’t go through — nothing changed.'];
    return json({ error: res.error, message }, code, cors);
  }
  if (res.row?.status === 'abandoned') return json({ data: { status: 'abandoned', message: 'Discarded — nothing was saved.' } }, 200, cors);

  // approved → promote the chosen variation into the library (atomic)
  const stored = await promoteToLibrary(site.id, id, principal);
  if (!stored.ok) return json({ error: stored.error, message: 'We saved your choice but couldn’t add it to your library just now — please try again in a moment.' }, 502, cors);
  return json({ data: { status: 'stored', media_id: stored.media_id, message: 'Saved to your library. It’s yours to use anywhere — nothing goes live until you publish.' } }, 200, cors);
}
