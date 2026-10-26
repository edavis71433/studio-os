// ── site-review: run a Site Review scan ──────────────────────────────────────
//   POST /functions/v1/site-review
//   { url, business_type, city?, turnstile_token }
// Public (deployed --no-verify-jwt). The gate (_shared/tools/guard.ts) runs
// first: Turnstile, 3/hour and 10/day per IP, the 24 h cache (a cache hit gets
// its own locked copy), and the daily spend cap. A refused request gets a
// plain JSON error with an HTTP status.
//
// An accepted scan answers with a stream of newline-delimited JSON so the
// loading screen can show real progress:
//   {"type":"progress","step":"pages","done":3,"total":8}
//   {"type":"done","report_id":"…","report":{…teaser…}}
//   {"type":"error","error":"unreachable"|"blocked"|"failed","message":"…"}

import { CALENDLY_URL, toolsCors, toolsJson } from '../_shared/tools/config.ts';
import { dbReady, insert } from '../_shared/tools/db.ts';
import { beginScan, finishScan, logUsage } from '../_shared/tools/guard.ts';
import { publicReport } from '../_shared/tools/report_view.ts';
import { assertPublicHttpUrl, normalizeSiteUrl } from '../_shared/tools/url_guard.ts';
import { ERROR_MESSAGES, runSiteReview, type ScanDeps } from '../_shared/tools/site_review/scan.ts';

export const BUSINESS_TYPES = ['restaurant', 'salon', 'retail', 'home services', 'health and wellness', 'other'];

// Overridable for tests: the network-facing pieces of a scan.
export const scanDeps: Partial<ScanDeps> = {};

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: toolsCors(req) });
  if (req.method !== 'POST') return toolsJson(req, { error: 'method_not_allowed' }, 405);
  if (!dbReady()) return toolsJson(req, { error: 'not_configured' }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }
  const url = normalizeSiteUrl(body.url);
  if (!url) return toolsJson(req, { error: 'invalid_url', message: "That doesn't look like a website address. Try something like yourbusiness.com." }, 400);
  try { await (scanDeps.guard || assertPublicHttpUrl)(url); } catch { return toolsJson(req, { error: 'unreachable', message: ERROR_MESSAGES.unreachable }, 400); }
  const businessType = BUSINESS_TYPES.includes(String(body.business_type)) ? String(body.business_type) : 'other';
  const city = String(body.city || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const input = { url, business_type: businessType, city };

  const gate = await beginScan(req, { tool: 'site_review', turnstileToken: body.turnstile_token, input });
  if (!gate.ok) return gate.response;
  if (gate.cachedReport) {
    return toolsJson(req, { type: 'done', cached: true, report_id: String(gate.cachedReport.id), report: publicReport(gate.cachedReport) });
  }

  const enc = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const send = (obj: unknown) => { if (closed) return; try { ctrl.enqueue(enc.encode(JSON.stringify(obj) + '\n')); } catch { closed = true; } };
      try {
        const result = await runSiteReview({ url, businessType, city }, {
          guard: assertPublicHttpUrl, ...scanDeps,
          onProgress: (p) => send({ type: 'progress', ...p }),
        });
        if (!result.ok) {
          await logUsage({ tool: 'site_review', kind: 'scan', ip_hash: gate.ipHash, note: `failed:${result.error}` });
          send({ type: 'error', error: result.error, message: ERROR_MESSAGES[result.error], calendly: CALENDLY_URL });
        } else {
          const row = await insert('tool_reports', { tool: 'site_review', input: result.input, raw_results: result.raw, findings: result.findings, scores: result.scores, unlocked: false });
          await finishScan({ tool: 'site_review', ipHash: gate.ipHash, cacheKey: gate.cacheKey, reportId: String(row.id), costUsd: result.costUsd });
          send({ type: 'done', report_id: String(row.id), report: publicReport(row) });
        }
      } catch (_e) {
        await logUsage({ tool: 'site_review', kind: 'scan', ip_hash: gate.ipHash, note: 'failed:exception' });
        send({ type: 'error', error: 'failed', message: "Something went wrong on our side. Try again in a minute, or book a call and I'll run it by hand.", calendly: CALENDLY_URL });
      } finally {
        closed = true;
        try { ctrl.close(); } catch { /* already closed */ }
      }
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    status: 200,
    headers: { ...toolsCors(req), 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
