// GET /identity  — the identity singleton, nothing else.
// PUT /identity  — the service's first write: validate, upsert under the
//                  caller's JWT (RLS proves ownership via with-check), write a
//                  provenance change event, return the saved row.
import { json } from '../../_shared/http.ts';
import { asUser } from '../lib/db.ts';
import { validateIdentity } from '../lib/validate.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const SELECT = 'site_id,business_name,tagline,description,phone,email,story,service_area,booking_url,ordering_url,social,seo_title,seo_description,updated_at';

export async function handleGetIdentity(jwt: string, site: SiteRow, cors: Record<string, string>) {
  const r = await asUser(jwt, `presence_identity?site_id=eq.${site.id}&select=${SELECT}&limit=1`);
  if (!r.ok) return json({ error: 'read_failed', message: 'We couldn’t load your business details just now.' }, 502, cors);
  const row = Array.isArray(r.json) && r.json.length ? r.json[0] : null;
  return json({ data: row }, 200, cors);
}

export async function handlePutIdentity(req: Request, jwt: string, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let payload: any = null;
  try { payload = await req.json(); } catch { return json({ error: 'bad_json', message: 'The request body wasn’t valid JSON.' }, 400, cors); }

  const v = validateIdentity(payload);
  if (!v.ok) return json({ error: 'validation_failed', message: 'Some fields need a second look.', fields: v.errors }, 422, cors);
  if (v.fields.length === 0) return json({ error: 'empty_update', message: 'No editable fields were provided.' }, 400, cors);

  // Upsert the singleton under the caller's JWT — RLS with-check enforces that
  // this site belongs to the caller. site_id is the conflict target.
  const body = { site_id: site.id, ...v.clean };
  const w = await asUser(jwt, `presence_identity?on_conflict=site_id&select=${SELECT}`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!w.ok || !Array.isArray(w.json) || w.json.length === 0) {
    return json({ error: 'write_failed', message: 'That didn’t save — nothing was changed. Please try again.' }, w.status === 403 || w.status === 401 ? 403 : 502, cors);
  }

  // Provenance: exactly one change event per successful mutation (service role).
  await writeChangeEvent({
    siteId: site.id,
    entityType: 'identity',
    entityId: null, // singleton
    action: 'update',
    summary: 'Updated business details',
    principal,
    provenance: 'human',
    fields: v.fields,
  });

  return json({ data: w.json[0] }, 200, cors);
}
