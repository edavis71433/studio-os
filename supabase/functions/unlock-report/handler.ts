// ── unlock-report: trade an email for the full Free Tools report ─────────────
//   POST /functions/v1/unlock-report
//   { report_id, email, name?, consent_marketing? }
// Public (deployed --no-verify-jwt). In order:
//   1. limits: unlocks per IP per day; 2 runs per email per tool per week
//   2. writes the tool_leads row and marks the report unlocked
//   3. mirrors the lead into audit_leads so it shows in the Studio OS pipeline
//   4. emails the visitor the report link ("Your report is ready")
//   5. triggers send-lead-alert so Eric hears about it right away
// Steps 3-5 are best-effort: the visitor always gets the full report on screen
// even if an email or the mirror fails, and the response says what was sent.

import { CALENDLY_URL, LIMITS, TOOL_NAMES, reportUrl, toolsCors, toolsJson, type ToolId } from '../_shared/tools/config.ts';
import { dbReady, getReport, insert, patch, enc } from '../_shared/tools/db.ts';
import { clientIp, hashId, isEmail, logUsage, rateHit } from '../_shared/tools/guard.ts';
import { publicReport } from '../_shared/tools/report_view.ts';
import { reportReadyEmail, sendEmail } from '../_shared/tools/email.ts';
import { maySend, unsubscribeUrl } from '../_shared/email_infra.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null);

async function mirrorToAuditLeads(tool: ToolId, input: Record<string, unknown>, email: string, view: ReturnType<typeof publicReport>): Promise<string | null> {
  try {
    const row = await insert<{ id: string }>('audit_leads', {
      tool, source: 'free_tools', client_email: email,
      business_name: input.business_name ?? null, url: input.url ?? null, city: input.city ?? null, business_type: input.business_type ?? null,
      score: view.overall, pillars: view.pillars, findings: view.findings,
      notes: `Free Tools report: ${reportUrl(view.id)}`,
    });
    return row?.id || null;
  } catch { return null; }
}

async function triggerLeadAlert(reportId: string): Promise<boolean> {
  const base = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
  const key = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const url = Deno.env.get('LEAD_ALERT_URL') || `${base}/functions/v1/send-lead-alert`;
  try {
    const r = await fetch(url, {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ report_id: reportId }), signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  } catch { return false; }
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: toolsCors(req) });
  if (req.method !== 'POST') return toolsJson(req, { error: 'method_not_allowed' }, 405);
  if (!dbReady()) return toolsJson(req, { error: 'not_configured' }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body falls through to validation */ }
  const reportId = String(body.report_id || '');
  const email = String(body.email || '').trim().toLowerCase();
  if (!UUID.test(reportId)) return toolsJson(req, { error: 'not_found', message: "We couldn't find that report." }, 404);
  if (!isEmail(email)) return toolsJson(req, { error: 'invalid_email', message: 'Enter a valid email address.' }, 400);

  const ipHash = await hashId('ip', clientIp(req));
  if (!(await rateHit(`tools:unlock:ip:${ipHash}`, 'day', LIMITS.unlocksPerIpPerDay))) {
    return toolsJson(req, { error: 'rate_limited', message: "That's a lot of reports for one day. Book a call and I'll go through them with you.", calendly: CALENDLY_URL }, 429);
  }

  let row: Record<string, unknown> | null;
  try { row = await getReport(reportId); } catch { return toolsJson(req, { error: 'unavailable', message: 'Something went wrong on our side. Try again in a minute.' }, 503); }
  if (!row) return toolsJson(req, { error: 'not_found', message: "We couldn't find that report." }, 404);
  if (row.unlocked === true) return toolsJson(req, { ok: true, already_unlocked: true, emailed: false, report: publicReport(row) });

  const tool = row.tool as ToolId;
  const emailHash = await hashId('email', email);
  if (!(await rateHit(`tools:unlock:${tool}:${emailHash}`, 'week', LIMITS.unlocksPerEmailPerToolPerWeek))) {
    return toolsJson(req, { error: 'rate_limited', message: `You've already run the ${TOOL_NAMES[tool]} twice this week with that email. Book a call and I'll go through it with you.`, calendly: CALENDLY_URL }, 429);
  }

  const input = (row.input || {}) as Record<string, unknown>;
  const name = clip(body.name, 120);
  let lead: Record<string, unknown>;
  try {
    lead = await insert('tool_leads', {
      email, name, source_tool: tool, consent_marketing: body.consent_marketing === true,
      business_name: clip(input.business_name, 200), business_type: clip(input.business_type, 80),
      city: clip(input.city, 120), website_url: clip(input.url, 500),
    });
    const unlockedAt = new Date().toISOString();
    await patch(`tool_reports?id=eq.${enc(reportId)}`, { unlocked: true, unlocked_at: unlockedAt, lead_id: lead.id });
    row = { ...row, unlocked: true, unlocked_at: unlockedAt, lead_id: lead.id };
  } catch {
    return toolsJson(req, { error: 'unavailable', message: 'Something went wrong on our side. Try again in a minute.' }, 503);
  }

  const view = publicReport(row);
  const auditLeadId = await mirrorToAuditLeads(tool, input, email, view);
  if (auditLeadId) await patch(`tool_leads?id=eq.${enc(String(lead.id))}`, { audit_lead_id: auditLeadId }).catch(() => {});

  let emailed = false;
  if ((await maySend(email, { critical: true })).ok) {
    const unsub = await unsubscribeUrl(email);
    const msg = reportReadyEmail({ name, toolName: TOOL_NAMES[tool], businessName: view.business.name, score: view.overall, label: view.label, reportUrl: reportUrl(reportId), calendlyUrl: CALENDLY_URL, unsubscribeUrl: unsub });
    emailed = (await sendEmail({ to: email, ...msg, unsubscribeUrl: unsub })).ok;
  }
  const alerted = await triggerLeadAlert(reportId);
  await logUsage({ tool, kind: 'unlock', ip_hash: ipHash, email, report_id: reportId, note: `emailed=${emailed} alerted=${alerted}` });

  return toolsJson(req, { ok: true, emailed, report: view });
}
