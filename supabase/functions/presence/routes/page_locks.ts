// ── Page passwords (builder list items 48 and 120, Nov 2026) ─────────────────
// POST /page-locks { password } makes a lock: a random salt and the key PBKDF2 makes from the
// password (lib/page_access.ts). It answers the lock's id, which the page then names in its
// settings (pages[].lock, with access 'password'); the password itself is never kept. GET
// /page-locks lists this site's lock ids, so the editor can say a page's password is saved.
// The keys are read only by a publish, which seals each password page with its own.
// presence_page_locks (migration 0158) is service-role only.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { rateAllow } from '../lib/ratelimit.ts';
import { writeChangeEvent } from '../lib/provenance.ts';
import { newPageLock, passwordProblem } from '../lib/page_access.ts';
import { tableMissing } from './estimates.ts';
import { UUID_LOWER_RE as UUID_RE } from '../lib/uuid.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const needsUpdate = (cors: Record<string, string>) => json({ error: 'unavailable', message: 'Page passwords need a one-time database update before they can be set.' }, 503, cors);
const rows = (r: { ok?: boolean; json?: unknown } | null | undefined): any[] => (r && r.ok && Array.isArray(r.json) ? r.json : []);

export async function handlePageLockCreate(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* an empty body is a missing password */ }
  const problem = passwordProblem(body?.password);
  if (problem) return json({ error: 'bad_password', message: problem }, 422, cors);
  // each one costs a key derivation, so a site gets a fair number an hour
  if (!(await rateAllow(`page_lock:${site.id}`, 30, 3600))) return json({ error: 'rate_limited', message: 'That’s a lot of passwords in a short time. Try again in a little while.' }, 429, cors);
  const lock = await newPageLock(String(body.password));
  const by = UUID_RE.test(String(principal.userId || '')) ? principal.userId : null;
  const w = await svc('presence_page_locks', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ site_id: site.id, salt: lock.salt, iterations: lock.iterations, key: lock.key, created_by: by }),
  });
  const id = rows(w)[0]?.id;
  if (!id) return tableMissing(w as any) ? needsUpdate(cors) : json({ error: 'write_failed', message: 'That didn’t save. Nothing was changed. Please try again.' }, 502, cors);
  await writeChangeEvent({ siteId: site.id, entityType: 'settings', entityId: null, action: 'create', summary: 'Set a page password', principal, provenance: 'human', fields: ['page_lock'] });
  return json({ data: { id } }, 201, cors);
}

export async function handlePageLockList(site: SiteRow, cors: Record<string, string>) {
  const r = await svc(`presence_page_locks?site_id=eq.${site.id}&select=id&order=created_at.desc&limit=200`);
  if (!r.ok) return tableMissing(r as any) ? json({ data: { ids: [], ready: false } }, 200, cors) : json({ error: 'read_failed', message: 'We couldn’t check your page passwords just now.' }, 502, cors);
  return json({ data: { ids: rows(r).map((x) => String(x.id)), ready: true } }, 200, cors);
}

/** Which of these lock ids this site holds, or null when that couldn't be read: the publish
 *  list then says nothing rather than ask for a password that may well be set (item 196). */
export async function pageLocksFound(siteId: string, ids: string[]): Promise<Set<string> | null> {
  const clean = ids.filter((id) => UUID_RE.test(id)).slice(0, 40);
  if (!clean.length) return new Set();
  const r = await svc(`presence_page_locks?site_id=eq.${siteId}&id=in.(${clean.join(',')})&select=id`).catch(() => null);
  return r && r.ok ? new Set(rows(r).map((x) => String(x.id))) : null;
}

/** The keys a publish seals this site's password pages with, by lock id. A lock that isn't
 *  this site's, or a table that isn't there yet, gives nothing: those pages stay off the
 *  live site rather than going up open. */
export async function readPageLocks(siteId: string, ids: string[]): Promise<Map<string, { salt: string; iterations: number; key: string }>> {
  const out = new Map<string, { salt: string; iterations: number; key: string }>();
  const clean = ids.filter((id) => UUID_RE.test(id)).slice(0, 40);
  if (!clean.length) return out;
  const r = await svc(`presence_page_locks?site_id=eq.${siteId}&id=in.(${clean.join(',')})&select=id,salt,iterations,key`).catch(() => null);
  for (const x of rows(r)) {
    if (typeof x.salt === 'string' && typeof x.key === 'string' && Number.isInteger(x.iterations)) out.set(String(x.id), { salt: x.salt, iterations: x.iterations, key: x.key });
  }
  return out;
}
