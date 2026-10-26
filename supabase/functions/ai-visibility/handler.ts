// ── ai-visibility: run an AI Visibility Check ────────────────────────────────
//   POST /functions/v1/ai-visibility
//   { business_name, city, business_type?, search_phrases?, url?, detail?, turnstile_token }
// Public (deployed --no-verify-jwt). Same gate as Site Review
// (_shared/tools/guard.ts): Turnstile, 3/hour and 10/day per IP, the 7-day
// cache per business + city (a hit gets its own locked copy), the daily spend
// cap. An accepted scan streams newline-delimited JSON:
//   {"type":"progress","step":"asking","done":3,"total":7}
//   {"type":"done","report_id":"…","report":{…teaser…}}
//   {"type":"needs_detail","message":"…"}        ambiguous name: ask for the street
//   {"type":"error","error":"engines_failed"|"failed","message":"…"}

import { CALENDLY_URL, toolsCors, toolsJson } from '../_shared/tools/config.ts';
import { dbReady, insert } from '../_shared/tools/db.ts';
import { beginScan, finishScan, logUsage } from '../_shared/tools/guard.ts';
import { publicReport } from '../_shared/tools/report_view.ts';
import { assertPublicHttpUrl, normalizeSiteUrl } from '../_shared/tools/url_guard.ts';
import { runAiVisibility, type AiScanDeps } from '../_shared/tools/ai_visibility/scan.ts';

const BUSINESS_TYPES = ['restaurant', 'salon', 'retail', 'home services', 'health and wellness', 'other'];
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Overridable for tests: the network-facing pieces of a scan.
export const scanDeps: Partial<AiScanDeps> = {};

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: toolsCors(req) });
  if (req.method !== 'POST') return toolsJson(req, { error: 'method_not_allowed' }, 405);
  if (!dbReady()) return toolsJson(req, { error: 'not_configured' }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }
  const businessName = clean(body.business_name, 120);
  const city = clean(body.city, 80);
  if (businessName.length < 2) return toolsJson(req, { error: 'invalid_input', message: 'Enter your business name.' }, 400);
  if (city.length < 2) return toolsJson(req, { error: 'invalid_input', message: 'Enter your city or neighborhood.' }, 400);
  const businessType = BUSINESS_TYPES.includes(String(body.business_type)) ? String(body.business_type) : 'other';
  const searchPhrases = clean(body.search_phrases, 200);
  const detail = clean(body.detail, 120);
  let url: string | null = null;
  if (String(body.url || '').trim()) {
    url = normalizeSiteUrl(body.url);
    if (!url) return toolsJson(req, { error: 'invalid_url', message: "That website doesn't look right. Try something like yourbusiness.com, or leave it blank." }, 400);
    try { await (scanDeps.guard || assertPublicHttpUrl)(url); } catch { return toolsJson(req, { error: 'invalid_url', message: "We couldn't use that website address. Check it, or leave it blank." }, 400); }
  }
  const input = { business_name: detail ? `${businessName} ${detail}` : businessName, city };

  const gate = await beginScan(req, { tool: 'ai_visibility', turnstileToken: body.turnstile_token, input });
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
        const result = await runAiVisibility({ businessName, city, businessType, searchPhrases, url, detail }, {
          guard: assertPublicHttpUrl, ...scanDeps,
          onProgress: (p) => send({ type: 'progress', ...p }),
        });
        if (!result.ok) {
          await logUsage({ tool: 'ai_visibility', kind: 'scan', ip_hash: gate.ipHash, cost_usd: result.costUsd, note: `failed:${result.error}` });
          send(result.error === 'ambiguous' ? { type: 'needs_detail', message: result.message } : { type: 'error', error: result.error, message: result.message, calendly: CALENDLY_URL });
        } else {
          const row = await insert('tool_reports', { tool: 'ai_visibility', input: result.input, raw_results: result.raw, findings: result.findings, scores: result.scores, unlocked: false });
          await finishScan({ tool: 'ai_visibility', ipHash: gate.ipHash, cacheKey: gate.cacheKey, reportId: String(row.id), costUsd: result.costUsd });
          send({ type: 'done', report_id: String(row.id), report: publicReport(row) });
        }
      } catch (_e) {
        await logUsage({ tool: 'ai_visibility', kind: 'scan', ip_hash: gate.ipHash, note: 'failed:exception' });
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
