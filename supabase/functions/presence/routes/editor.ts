// ── Client-facing AI Editor route (M9.5B) ───────────────────────────────────
//   POST /editor/improve — {kind, action, target_id?, text?, instructions?,
//                           tones?, recommendation_hash?}
// Everything else is shared with the Writer: proposals are reviewed via
// GET /writer/drafts/:id (options now carry the compare pack), accepted via
// /accept (the unmodified Draft Writer), discarded via /discard. Optional,
// editable, reviewable, reversible; nothing auto-publishes or auto-accepts.
import { json } from '../../_shared/http.ts';
import { generateEdit, EDIT_ACTIONS } from '../writer/editor.ts';
import { anthropicModel } from '../writer/model.ts';
import type { EditRequest } from '../writer/editor.ts';
import type { EditorKind } from '../writer/contract.ts';
import type { SiteRow } from '../lib/site.ts';
import { loadPlan, draftingDenial } from '../commerce/enforce.ts';
import { meterModel } from '../commerce/metering.ts';

const KINDS: EditorKind[] = ['edit_identity', 'edit_faq', 'edit_offering', 'edit_post', 'edit_document', 'site_polish'];

export async function handleEditorImprove(req: Request, site: SiteRow, cors: Record<string, string>) {
  // Editing is a drafting workflow — Presence-and-up (entitlement, not UI).
  const plan = await loadPlan(site.client_id);
  const denied = draftingDenial(plan, cors);
  if (denied) return denied;

  const model = meterModel(anthropicModel(), { siteId: site.id, clientId: site.client_id, agent: 'editor' });
  if (!model) return json({ error: 'editor_unavailable', message: 'Editing help isn’t switched on right now. Everything can still be edited by hand — it always can.' }, 503, cors);
  let body: Partial<EditRequest> = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That request didn’t read right — nothing happened.' }, 400, cors); }
  const kind = KINDS.includes(body.kind as EditorKind) ? body.kind as EditorKind : null;
  if (!kind) return json({ error: 'bad_kind', message: 'Choose what you’d like improved first.' }, 400, cors);
  const action = typeof body.action === 'string' && EDIT_ACTIONS[body.action] ? body.action : 'rewrite';

  const summary = await generateEdit(site, {
    kind, action,
    target_id: typeof body.target_id === 'string' && /^[0-9a-f-]{36}$/.test(body.target_id) ? body.target_id : undefined,
    text: typeof body.text === 'string' ? body.text.slice(0, 8000) : undefined,
    instructions: String(body.instructions || '').slice(0, 400),
    tones: Array.isArray(body.tones) ? body.tones.slice(0, 3).map((t) => String(t).slice(0, 30)) : undefined,
    recommendation_hash: typeof body.recommendation_hash === 'string' ? body.recommendation_hash.slice(0, 40) : undefined,
  }, model);

  if (!summary.ok) {
    const msgs: Record<string, string> = {
      nothing_to_edit: 'There isn’t any written content there to improve yet — write a first draft (by hand or with help) and come back.',
      target_not_found: 'That item isn’t here to improve — it may have been removed.',
      text_too_short: 'Paste in a little more text to work with.',
      all_options_failed_fact_guard: 'The edit came back wanting to change facts, so it was set aside. Your original text is untouched.',
    };
    return json({ error: 'improve_failed', message: msgs[summary.error || ''] || 'The editing didn’t come through — nothing was changed. Try again in a moment.', missing_facts: summary.missing_facts }, summary.error === 'target_not_found' ? 404 : 502, cors);
  }
  return json({ data: summary }, 200, cors);
}
