// ── Updates kept as templates by the studio (builder list item 221) ──────────
//   GET    /agency/update-templates       the studio's templates, newest first, with the
//                                         first words of each (never every whole body)
//   GET    /agency/update-templates/:id   one template whole, to start an update from
//   POST   /agency/update-templates       { site_id, name, subject, body }: keep one, from
//                                         one of the studio's clients or its own site
//   PATCH  /agency/update-templates/:id   { name }: rename
//   DELETE /agency/update-templates/:id   remove
// Templates belong to the studio, so one written for one client starts an update for
// another on Send an update. Reading is any member's; keeping, renaming and removing are
// for who manages clients, as with saved pages (agency/saved_pages.ts). What a template
// keeps, and what it leaves behind, is lib/update_templates.ts.
//
// Before migration 0221 there is no table: the list answers empty with available: false,
// and keeping one says templates aren't switched on yet, with nothing kept.
import { json } from '../../_shared/http.ts';
import { svc, svcCount } from '../lib/db.ts';
import { can, agencySiteIds } from './auth.ts';
import type { AgencyMember } from './auth.ts';
import { cleanTemplateName, templateFromUpdate, templateListItem, MAX_UPDATE_TEMPLATES } from '../lib/update_templates.ts';
import type { TemplateRow } from '../lib/update_templates.ts';
import { tableMissing } from './saved_pages.ts';
import type { SiteRow } from '../lib/site.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';

const forbid = (cors: Record<string, string>) => json({ error: 'forbidden', message: 'Your role doesn’t include this.' }, 403, cors);
const rows = <T,>(r: { ok?: boolean; json?: unknown }): T[] => (r.ok !== false && Array.isArray(r.json) ? r.json as T[] : []);
export const TEMPLATES_NOT_ON = { error: 'not_ready', message: 'Templates aren’t switched on yet. Nothing was kept.' };
const LIST = 'id,name,subject,body,created_from_site,from_name,created_by,created_at';
const gone = (cors: Record<string, string>) => json({ error: 'not_found', message: 'That template isn’t there any more.' }, 404, cors);

export async function handleUpdateTemplates(req: Request, route: string, method: string, member: AgencyMember, cors: Record<string, string>,
  deps: { ownSite: () => Promise<SiteRow | null> }): Promise<Response | null> {
  if (route !== '/agency/update-templates' && !route.startsWith('/agency/update-templates/')) return null;
  const body = async (): Promise<Record<string, unknown>> => { try { const b = await req.json(); return b && typeof b === 'object' ? b : {}; } catch { return {}; } };
  const canManage = can(member.role, 'manage_clients');

  if (route === '/agency/update-templates' && method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const r = await svc(`presence_update_templates?agency_id=eq.${member.agency_id}&select=${LIST}&order=created_at.desc&limit=${MAX_UPDATE_TEMPLATES}`);
    if (!r.ok) {
      if (tableMissing(r)) return json({ data: [], available: false, can_manage: canManage }, 200, cors);
      return json({ error: 'read_failed', message: 'We couldn’t read your templates just now.' }, 502, cors);
    }
    return json({ data: rows<TemplateRow>(r).map(templateListItem), available: true, can_manage: canManage, max: MAX_UPDATE_TEMPLATES }, 200, cors);
  }

  if (route === '/agency/update-templates' && method === 'POST') {
    if (!canManage) return forbid(cors);
    const b = await body();
    const siteId = String(b.site_id || '').toLowerCase();
    const name = cleanTemplateName(b.name);
    const kept = templateFromUpdate({ subject: b.subject, body: b.body });
    if (!UUID_RE.test(siteId)) return json({ error: 'bad_request', message: 'Say which client’s update this is.' }, 400, cors);
    if (!name) return json({ error: 'bad_name', message: 'Give the template a name.' }, 400, cors);
    if (!kept.subject) return json({ error: 'bad_subject', message: 'Give the update a subject first.' }, 400, cors);
    if (!kept.body) return json({ error: 'empty', message: kept.photos_left ? 'There are only photos here, and photos stay with the client. Write some words first.' : 'Write the update first.' }, 400, cors);
    // one of the studio's clients, or the studio's own site
    if (!(await agencySiteIds(member.agency_id, true)).includes(siteId)) {
      const own = await deps.ownSite().catch(() => null);
      if (!own || String(own.id).toLowerCase() !== siteId) return json({ error: 'not_found', message: 'Not one of your clients.' }, 404, cors);
    }
    const count = await svcCount(`presence_update_templates?agency_id=eq.${member.agency_id}`);
    if (count !== null && count >= MAX_UPDATE_TEMPLATES) return json({ error: 'full', message: `Your studio keeps up to ${MAX_UPDATE_TEMPLATES} templates. Remove one first.` }, 422, cors);
    const ident = await svc(`presence_identity?site_id=eq.${siteId}&select=business_name&limit=1`).catch(() => null);
    const fromName = String((ident && rows<{ business_name?: string }>(ident)[0]?.business_name) || '').trim().slice(0, 200);
    const ins = await svc(`presence_update_templates?select=${LIST}`, {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ agency_id: member.agency_id, name, subject: kept.subject, body: kept.body, created_from_site: siteId, from_name: fromName, created_by: member.email || '' }),
    });
    const row = rows<TemplateRow>(ins)[0];
    if (!ins.ok || !row) {
      if (tableMissing(ins)) return json(TEMPLATES_NOT_ON, 503, cors);
      return json({ error: 'write_failed', message: 'That didn’t save. Nothing was kept.' }, 502, cors);
    }
    return json({ data: templateListItem(row), photos_left: kept.photos_left }, 201, cors);
  }

  const m = route.match(/^\/agency\/update-templates\/([0-9a-f-]{36})$/);
  if (!m) return null;
  const id = m[1].toLowerCase();
  if (!UUID_RE.test(id)) return json({ error: 'bad_request', message: 'Which template?' }, 400, cors);

  if (method === 'GET') {
    if (!can(member.role, 'read')) return forbid(cors);
    const r = await svc(`presence_update_templates?id=eq.${id}&agency_id=eq.${member.agency_id}&select=${LIST}&limit=1`);
    if (!r.ok) return tableMissing(r) ? gone(cors) : json({ error: 'read_failed', message: 'We couldn’t read that template just now.' }, 502, cors);
    const row = rows<TemplateRow>(r)[0];
    if (!row) return gone(cors);
    return json({ data: { ...templateListItem(row), body: String(row.body || '') } }, 200, cors);
  }

  if (method === 'PATCH') {
    if (!canManage) return forbid(cors);
    const name = cleanTemplateName((await body()).name);
    if (!name) return json({ error: 'bad_name', message: 'Give the template a name.' }, 400, cors);
    const w = await svc(`presence_update_templates?id=eq.${id}&agency_id=eq.${member.agency_id}&select=${LIST}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name, updated_at: new Date().toISOString() }),
    });
    if (!w.ok && tableMissing(w)) return json(TEMPLATES_NOT_ON, 503, cors);
    const row = rows<TemplateRow>(w)[0];
    if (!row) return gone(cors);
    return json({ data: templateListItem(row) }, 200, cors);
  }

  if (method === 'DELETE') {
    if (!canManage) return forbid(cors);
    const w = await svc(`presence_update_templates?id=eq.${id}&agency_id=eq.${member.agency_id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
    if (!w.ok && tableMissing(w)) return json(TEMPLATES_NOT_ON, 503, cors);
    if (!w.ok) return json({ error: 'write_failed', message: 'That didn’t go through. Try again in a moment.' }, 502, cors);
    if (!rows(w).length) return gone(cors);
    return json({ data: { ok: true } }, 200, cors);
  }
  return null;
}
