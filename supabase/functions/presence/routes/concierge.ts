// ── The client-facing Concierge route (M9.4) ────────────────────────────────
//   POST /concierge/ask  { question, topic_id?, history?: [{topic_id}] }
// One host, five verbs, everything grounded. Conversation memory belongs to
// the CURRENT interaction only: the caller (the room) holds the short history
// and sends it back; the server stores nothing about the conversation.
// Actions in the answer are prepared pointers into the room — the customer
// performs and approves everything; nothing executes here.
import { json } from '../../_shared/http.ts';
import { buildGrounding } from '../concierge/grounding.ts';
import { answer } from '../concierge/answer.ts';
import { polish } from '../concierge/polish.ts';
import { checkAiCeiling } from '../commerce/metering.ts';
import type { SiteRow } from '../lib/site.ts';

export async function handleConciergeAsk(req: Request, site: SiteRow, cors: Record<string, string>) {
  let body: { question?: string; topic_id?: string; history?: Array<{ topic_id?: string }> } = {};
  try { body = await req.json(); } catch { /* empty ask becomes an overview */ }
  const question = String(body?.question || '').slice(0, 500);
  const topicId = typeof body?.topic_id === 'string' && /^[0-9a-f-]{36}$/.test(body.topic_id) ? body.topic_id : undefined;
  const history = Array.isArray(body?.history)
    ? body.history.slice(-10).map((h) => ({ topic_id: typeof h?.topic_id === 'string' ? h.topic_id : undefined }))
    : [];

  const grounding = await buildGrounding(site);
  const a = answer({ question, topicId, history }, grounding);

  // HARD cost ceiling (margin protection): the ANSWER is deterministic and free,
  // only the optional language polish spends model tokens — so over the ceiling we
  // skip the polish and still answer, rather than deny. Same guard writer/coach/visual use.
  const ceil = await checkAiCeiling(site.client_id);
  if (!ceil.allowed) {
    return json({ data: { verb: a.verb, answer: a.text, topic: a.topic, actions: a.actions, grounded: a.grounded, low_confidence: a.low_confidence, sources: a.sources } }, 200, cors);
  }

  // optional language polish — facts already fixed; verifier guards; fallback always
  const groundingText = [
    ...grounding.moments.map((m) => m.headline + ' ' + m.summary),
    ...grounding.evidence.map((e) => e.human),
  ].join('\n');
  const polished = await polish(a.text, groundingText, { siteId: site.id, clientId: site.client_id, agent: 'concierge' });

  return json({
    data: {
      verb: a.verb,
      answer: polished.text,
      topic: a.topic,
      actions: a.actions,
      grounded: a.grounded,
      low_confidence: a.low_confidence,
      sources: a.sources,           // ids only — auditability without internals
    },
  }, 200, cors);
}
