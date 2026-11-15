// ── Builder list item 150: "Usable by everyone" (the ticks and the last check) ─
// GET /site/usable reads them; PUT /site/usable { ticks?, last? } saves a tick or the result
// of a check the editor just ran. Editing the site's words is what fixes the list, so a
// save needs edit, as those do.
import { json } from '../../_shared/http.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { applyUsable, normalizeUsable, type UsableCheck } from '../lib/usable_check.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

export async function handleUsableGet(site: SiteRow, cors: Record<string, string>) {
  let stored: unknown = null;
  try { stored = await readReservedJson(site.id, RESERVED_NAMES.usableCheck); } catch { /* nothing kept yet reads as no ticks and no check */ }
  return json({ data: normalizeUsable(stored) }, 200, cors);
}

export async function handleUsablePut(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: unknown = null;
  try { body = await req.json(); } catch { return json({ error: 'bad_json', message: 'That didn’t read right. Nothing changed.' }, 400, cors); }
  const probe = applyUsable(null, body, new Date().toISOString());
  if ('error' in probe) return json({ error: 'validation', message: probe.error }, 422, cors);
  const who = principal.email || principal.userId || 'owner';
  const saved = await updateReservedJson<UsableCheck>(site.id, RESERVED_NAMES.usableCheck, (cur) => applyUsable(cur, body, new Date().toISOString()) as UsableCheck, who);
  if (!saved) return json({ error: 'write_failed', message: 'That didn’t save. Nothing changed; try again.' }, 502, cors);
  return json({ data: normalizeUsable(saved) }, 200, cors);
}
