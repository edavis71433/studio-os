// ── The editor's start-up reads in one answer (builder list item 37) ──
//   GET /site?with=offerings,faqs,testimonials,posts,media,settings,publish_lock
// The editor read the site, then each list on its own: seven calls, seven sign-in checks and,
// once a day per address, seven "may I?" checks before them. This is GET /site's answer with
// `parts` beside it: each part is what that read alone answers ({ data }), or why it couldn't
// ({ status, error }). Each part is answered by the very handler its own route uses, after the
// same gates that route meets in index.ts (a reviewer's, a Designer's, the plan's), so a part
// someone may not read is refused here exactly as it would be on its own. A name it doesn't
// know is left out, and the page reads that one on its own.
import { json } from '../../_shared/http.ts';
import type { SiteDb } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';
import { designerAllowed } from '../lib/site_roles.ts';
import { featureForRoute, requireFeature, loadEdition } from '../middleware/feature.ts';
import { handleGetSite } from './site.ts';
import { handleCollection, handleSettings } from './content.ts';
import { handleMediaList } from './room.ts';
import { handlePublishLockGet } from './publish_lock.ts';
import { reviewerAllowed } from './workspace.ts';

type Cors = Record<string, string>;
type Part = { data: unknown } | { status: number; error: string };

// each part, the route it is on its own
export const OPEN_PARTS: Record<string, string> = {
  offerings: '/offerings', faqs: '/faqs', testimonials: '/testimonials', posts: '/posts',
  media: '/media', settings: '/settings', publish_lock: '/site/publish-lock',
};

export async function handleSiteOpen(req: Request, db: SiteDb, site: SiteRow, principal: Principal, siteRole: string | null, wanted: string, cors: Cors) {
  const names = [...new Set(wanted.split(','))].filter((n) => Object.hasOwn(OPEN_PARTS, n));
  const jwt = principal.jwt || '';
  let edition: Promise<Awaited<ReturnType<typeof loadEdition>>> | null = null;
  const one = async (name: string): Promise<Part> => {
    const route = OPEN_PARTS[name];
    // the gates of index.ts, in its order, for a read
    if (siteRole === 'client_reviewer' && !reviewerAllowed(route, 'GET')) return { status: 403, error: 'forbidden' };
    if (siteRole === 'designer' && !designerAllowed(route, 'GET')) return { status: 403, error: 'forbidden' };
    const needed = featureForRoute(route, 'GET');
    if (needed) {
      edition ??= loadEdition(principal, site.client_id, site.edition);
      const denial = requireFeature(await edition, needed, cors);
      if (denial) return { status: denial.status, error: 'feature_not_in_plan' };
    }
    try {
      const own = new Request(new URL(route, req.url), { method: 'GET', headers: req.headers });
      const res = name === 'media' ? await handleMediaList(site, cors)
        : name === 'settings' ? await handleSettings(own, db, site, principal, cors)
        : name === 'publish_lock' ? await handlePublishLockGet(jwt, site, principal, cors)
        : await handleCollection(own, db, site, principal, name, null, cors);
      if (!res) return { status: 404, error: 'not_found' };
      const body = await res.json().catch(() => ({}));
      return res.ok ? { data: body.data ?? null } : { status: res.status, error: String(body.error || 'error') };
    } catch {
      return { status: 500, error: 'server_error' };
    }
  };
  const [siteRes, ...parts] = await Promise.all([handleGetSite(db, site, cors), ...names.map(one)]);
  if (!siteRes.ok) return siteRes;
  const body = await siteRes.json();
  return json({ ...body, parts: Object.fromEntries(names.map((n, i) => [n, parts[i]])) }, 200, cors);
}
