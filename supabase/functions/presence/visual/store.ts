// ── AI Visual Studio — persistence + promotion into the media library ───────
// Rides the shared Approved-Plan spine (lib/approved_plan.ts): a generation is
// proposed → approved → (atomic claim) → stored. Draft variations live in the
// private bucket under a per-plan prefix and NEVER become library rows until the
// customer approves one; promotion inserts the single chosen variation into
// presence_media with honest `ai_approved` provenance, then removes the drafts.
import { svc } from '../lib/db.ts';
import { decidePlan, claimApprovedPlan, releaseApprovedPlanClaim } from '../lib/approved_plan.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { BUCKET } from '../lib/media.ts';
import type { VisualPlan, Variation } from './contract.ts';
import type { Principal } from '../../_shared/auth.ts';

const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const PLAN_SELECT = 'id,kind,title,summary,brief,prompt,brand_snapshot,risk,reversible,rollback,requires_approval,variations,chosen_variation,alt_text,media_id,provenance,model,status,created_at,updated_at';

/** Server-side upload of raw bytes into the private bucket. Returns the
 *  storage_path in the same `${BUCKET}/${path}` shape the media pipeline uses. */
async function putObject(path: string, bytes: Uint8Array, contentType: string): Promise<string | null> {
  const r = await fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, 'Content-Type': contentType, 'x-upsert': 'true' },
    body: bytes as unknown as BodyInit,
  });
  return r.ok ? `${BUCKET}/${path}` : null;
}

async function removeObjects(paths: string[]): Promise<void> {
  await Promise.all(paths.map((sp) => {
    const objectPath = sp.replace(`${BUCKET}/`, '');
    return fetch(`${SB_URL}/storage/v1/object/${BUCKET}/${objectPath}`, { method: 'DELETE', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE } }).catch(() => {});
  }));
}

/** Insert the proposed plan. */
export async function saveVisualPlan(siteId: string, plan: VisualPlan): Promise<any | null> {
  const r = await svc('presence_visual_plans', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      site_id: siteId, kind: plan.kind, title: plan.title, summary: plan.summary, brief: plan.brief,
      prompt: plan.prompt, brand_snapshot: plan.brand_snapshot, risk: plan.risk, reversible: plan.reversible,
      rollback: plan.rollback, provenance: 'ai', status: 'proposed',
    }),
  });
  return r.ok && r.json?.[0] ? r.json[0] : null;
}

/** Upload freshly generated images as draft variations and attach them to the plan. */
export async function attachVariations(siteId: string, planId: string, images: Uint8Array[], model: string, width: number, height: number): Promise<Variation[]> {
  const now = new Date().toISOString();
  const vars: Variation[] = [];
  for (const bytes of images) {
    const id = crypto.randomUUID();
    const sp = await putObject(`${siteId}/visual/${planId}/${id}.png`, bytes, 'image/png');
    if (sp) vars.push({ id, storage_path: sp, width, height, model, created_at: now });
  }
  // append to any existing variations (edit / "make more" accumulates options)
  const existing = await getVisualPlan(siteId, planId);
  const merged = [...(existing?.variations || []), ...vars];
  await svc(`presence_visual_plans?id=eq.${planId}&site_id=eq.${siteId}`, {
    method: 'PATCH', body: JSON.stringify({ variations: merged, model }),
  });
  return vars;
}

/** A short-lived signed URL so the customer can SEE a private draft variation. */
async function signPreview(storagePath: string): Promise<string | null> {
  const objectPath = storagePath.replace(`${BUCKET}/`, '');
  const r = await fetch(`${SB_URL}/storage/v1/object/sign/${BUCKET}/${objectPath}`, {
    method: 'POST', headers: { Authorization: `Bearer ${SB_SERVICE}`, apikey: SB_SERVICE, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 900 }),
  });
  const j = await r.json().catch(() => null);
  return j?.signedURL ? `${SB_URL}/storage/v1${j.signedURL}` : null;
}

/** Attach preview URLs to a plan's variations (never persisted — signed on read). */
export async function withPreviews(plan: any): Promise<any> {
  if (!plan?.variations?.length) return plan;
  const variations = await Promise.all(plan.variations.map(async (v: Variation) => ({ ...v, preview_url: await signPreview(v.storage_path) })));
  return { ...plan, variations };
}

export async function listVisualPlans(siteId: string): Promise<any[]> {
  const r = await svc(`presence_visual_plans?site_id=eq.${siteId}&status=neq.abandoned&select=${PLAN_SELECT}&order=created_at.desc&limit=50`);
  return r.ok && Array.isArray(r.json) ? r.json : [];
}

export async function getVisualPlan(siteId: string, id: string): Promise<any | null> {
  const r = await svc(`presence_visual_plans?id=eq.${id}&site_id=eq.${siteId}&select=${PLAN_SELECT}&limit=1`);
  return r.ok && r.json?.[0] ? r.json[0] : null;
}

/** Approve (with a chosen variation + alt text) or abandon. Approve records the
 *  decision; promotion into the library is the separate, atomic next step. */
export async function decideVisualPlan(siteId: string, id: string, decision: string, opts: { variationId?: string; altText?: string } = {}): Promise<{ ok: boolean; row?: any; error?: string }> {
  const next = decidePlan(decision);
  if (!next) return { ok: false, error: 'bad_decision' };
  const existing = await getVisualPlan(siteId, id);
  if (!existing || existing.status !== 'proposed') return { ok: false, error: 'not_open' };

  if (next === 'abandoned') {
    await removeObjects((existing.variations || []).map((v: Variation) => v.storage_path));
    const r = await svc(`presence_visual_plans?id=eq.${id}&site_id=eq.${siteId}&status=eq.proposed`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'abandoned', variations: [], decided_at: new Date().toISOString() }),
    });
    return r.ok && r.json?.[0] ? { ok: true, row: r.json[0] } : { ok: false, error: 'write_failed' };
  }

  // approve: require a chosen variation and alt text (accessibility is not optional)
  const chosen = (existing.variations || []).find((v: Variation) => v.id === opts.variationId);
  if (!chosen) return { ok: false, error: 'no_variation' };
  const alt = String(opts.altText || '').trim();
  if (alt.length < 3) return { ok: false, error: 'alt_required' };
  const r = await svc(`presence_visual_plans?id=eq.${id}&site_id=eq.${siteId}&status=eq.proposed`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ status: 'approved', chosen_variation: opts.variationId, alt_text: alt, decided_at: new Date().toISOString() }),
  });
  return r.ok && r.json?.[0] ? { ok: true, row: r.json[0] } : { ok: false, error: 'write_failed' };
}

/** Promote the approved, chosen variation into the media library. Atomic: exactly
 *  one caller wins the claim; the chosen draft becomes a presence_media row with
 *  ai_approved provenance, the other drafts are removed, and the plan is 'stored'. */
export async function promoteToLibrary(siteId: string, id: string, principal: Principal): Promise<{ ok: boolean; media_id?: string; error?: string }> {
  const claimed = await claimApprovedPlan({ table: 'presence_visual_plans', id, siteId, claimColumn: 'claimed_at', select: PLAN_SELECT });
  if (!claimed) {
    const cur = await getVisualPlan(siteId, id);
    if (cur?.status === 'stored') return { ok: true, media_id: cur.media_id };
    return { ok: false, error: 'not_claimable' };
  }
  const chosen = (claimed.variations || []).find((v: Variation) => v.id === claimed.chosen_variation);
  if (!chosen) { await releaseApprovedPlanClaim('presence_visual_plans', id, 'claimed_at'); return { ok: false, error: 'no_variation' }; }

  const media = await svc('presence_media', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: siteId, storage_path: chosen.storage_path, alt_text: claimed.alt_text, mime: 'image/png', width: chosen.width, height: chosen.height, bytes: 0 }),
  });
  const mediaId = media.ok ? media.json?.[0]?.id : null;
  if (!mediaId) { await releaseApprovedPlanClaim('presence_visual_plans', id, 'claimed_at'); return { ok: false, error: 'store_failed' }; }

  // remove the drafts we didn't keep (the chosen path is now owned by the media row)
  await removeObjects((claimed.variations || []).filter((v: Variation) => v.id !== claimed.chosen_variation).map((v: Variation) => v.storage_path));
  await svc(`presence_visual_plans?id=eq.${id}&site_id=eq.${siteId}`, {
    method: 'PATCH', body: JSON.stringify({ status: 'stored', media_id: mediaId, provenance: 'ai_approved', stored_at: new Date().toISOString() }),
  });
  await writeChangeEvent({ siteId, entityType: 'media', entityId: mediaId, action: 'create', summary: 'Saved an AI-made image to the library', principal, provenance: 'ai_approved', fields: ['storage_path', 'alt_text'] });
  return { ok: true, media_id: mediaId };
}
