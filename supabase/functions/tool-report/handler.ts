// ── tool-report: read one Free Tools report for the hosted report page ───────
//   GET /functions/v1/tool-report?id=<uuid>
// Public (deployed --no-verify-jwt). Unlocked reports are viewable by anyone
// with the link (UUIDs are unguessable); locked ones come back as the teaser
// only (report_view.publicReport cuts them down here, server side).

import { toolsCors, toolsJson } from '../_shared/tools/config.ts';
import { dbReady, getReport } from '../_shared/tools/db.ts';
import { publicReport } from '../_shared/tools/report_view.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: toolsCors(req) });
  if (req.method !== 'GET') return toolsJson(req, { error: 'method_not_allowed' }, 405);
  if (!dbReady()) return toolsJson(req, { error: 'not_configured' }, 500);

  const id = new URL(req.url).searchParams.get('id') || '';
  if (!UUID.test(id)) return toolsJson(req, { error: 'not_found', message: "We couldn't find that report." }, 404);
  try {
    const row = await getReport(id);
    if (!row) return toolsJson(req, { error: 'not_found', message: "We couldn't find that report." }, 404);
    return toolsJson(req, { report: publicReport(row) });
  } catch (_) {
    return toolsJson(req, { error: 'unavailable', message: "The report couldn't load just now. Try again in a minute." }, 503);
  }
}
