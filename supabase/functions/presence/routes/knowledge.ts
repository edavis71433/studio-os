// ── Business Knowledge Import routes (M10) ──────────────────────────────────
//   POST   /knowledge/import      — {filename, content} → deterministic extraction, stored
//   GET    /knowledge/docs        — what the customer has provided
//   DELETE /knowledge/docs/:id    — the customer removes their document
// Knowledge in, evidence out. Nothing here generates content, reviews the
// document, or produces AI summaries — extraction is regex-class and pure
// (optimization/knowledge.ts). The knowledge provider reads the stored facts
// on the next evidence run.
import { json } from '../../_shared/http.ts';
import { asUser, svc } from '../lib/db.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { extractKnowledge } from '../optimization/knowledge.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const MAX_CHARS = 50_000;
const MAX_DOCS = 10;

export async function handleKnowledgeImport(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: { filename?: string; content?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right — nothing was saved.' }, 400, cors); }
  const filename = String(body?.filename || '').trim().slice(0, 120);
  const content = String(body?.content || '').slice(0, MAX_CHARS);
  if (!filename || content.trim().length < 20) {
    return json({ error: 'bad_request', message: 'A name and the document’s text are needed.' }, 400, cors);
  }
  const countQ = await svc(`presence_knowledge_docs?site_id=eq.${site.id}&deleted_at=is.null&select=id`);
  if ((countQ.json ?? []).length >= MAX_DOCS) {
    return json({ error: 'limit', message: `Up to ${MAX_DOCS} documents can be kept — remove one first.` }, 400, cors);
  }
  const extracted = extractKnowledge(content);
  const ins = await svc('presence_knowledge_docs?select=id,filename,extracted,created_at', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, filename, content_text: content, extracted }),
  });
  if (!ins.ok || !ins.json?.[0]) return json({ error: 'write_failed', message: 'That didn’t save — please try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'create', summary: `Added a document: ${filename}`, principal, provenance: 'human', fields: ['knowledge_doc'] });
  return json({ data: { id: ins.json[0].id, filename, items: extracted.items.length, phones: extracted.phones.length, hours_lines: extracted.hours_lines.length } }, 200, cors);
}

export async function handleKnowledgeList(jwt: string, site: SiteRow, cors: Record<string, string>) {
  const r = await asUser(jwt, `presence_knowledge_docs?site_id=eq.${site.id}&deleted_at=is.null&select=id,filename,extracted,created_at&order=created_at.desc&limit=${MAX_DOCS}`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t open your documents just now.' }, 502, cors);
  return json({ data: (r.json ?? []).map((d: { id: string; filename: string; created_at: string; extracted: { items?: unknown[] } }) => ({
    id: d.id, filename: d.filename, created_at: d.created_at, items: (d.extracted?.items || []).length,
  })) }, 200, cors);
}

export async function handleKnowledgeDelete(site: SiteRow, docId: string, principal: Principal, cors: Record<string, string>) {
  const w = await svc(`presence_knowledge_docs?id=eq.${docId}&site_id=eq.${site.id}&deleted_at=is.null&select=id,filename`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ deleted_at: new Date().toISOString() }),
  });
  if (!w.ok || !w.json?.[0]) return json({ error: 'not_found', message: 'That document isn’t here.' }, 404, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'delete', summary: `Removed a document: ${w.json[0].filename}`, principal, provenance: 'human' });
  return json({ data: { ok: true } }, 200, cors);
}
