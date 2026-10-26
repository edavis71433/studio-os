// ── send-lead-alert: "New lead: [business] ran [tool]" to Eric ──────────────
//   POST /functions/v1/send-lead-alert   { report_id }
// Internal only: the caller must present the service role key as its bearer
// token (unlock-report does). Deployed --no-verify-jwt so this check, not the
// gateway, is the gate; anything else gets 401. Kept as its own function so a
// failed alert can be re-sent for a report without touching the unlock flow.

import { TOOL_NAMES, ERIC_EMAIL, reportUrl, type ToolId } from '../_shared/tools/config.ts';
import { dbReady, getReport, select, enc } from '../_shared/tools/db.ts';
import { publicReport } from '../_shared/tools/report_view.ts';
import { leadAlertEmail, sendEmail } from '../_shared/tools/email.ts';

const json = (payload: unknown, status = 200) => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

function constEq(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const key = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!key || !constEq(bearer, key)) return json({ error: 'unauthorized' }, 401);
  if (!dbReady()) return json({ error: 'not_configured' }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* validated below */ }
  const reportId = String(body.report_id || '');
  const row = reportId ? await getReport(reportId).catch(() => null) : null;
  if (!row || !row.lead_id) return json({ error: 'not_found' }, 404);
  const leads = await select(`tool_leads?id=eq.${enc(String(row.lead_id))}&select=*&limit=1`).catch(() => []);
  if (!leads[0]) return json({ error: 'not_found' }, 404);

  const view = publicReport(row);
  const msg = leadAlertEmail({ toolName: TOOL_NAMES[row.tool as ToolId] || 'free tool', reportUrl: reportUrl(reportId), score: view.overall, label: view.label, lead: leads[0] });
  const sent = await sendEmail({ to: Deno.env.get('LEAD_ALERT_TO') || ERIC_EMAIL, ...msg, replyTo: String(leads[0].email || ERIC_EMAIL) });
  return json({ ok: sent.ok, error: sent.error || null }, sent.ok ? 200 : 502);
}
