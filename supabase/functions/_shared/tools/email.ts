// ── Free Tools: the two emails ───────────────────────────────────────────────
// "Your report is ready" to the visitor, and "New lead: [business] ran [tool]"
// to Eric. No follow-up sequence (spec). Every visitor email carries the
// one-click unsubscribe link from _shared/email_infra.ts, and the suppression
// store is respected (an opt-out still gets the report they just asked for,
// a bounce or complaint never does).

import { ERIC_EMAIL, FROM } from './config.ts';

const RESEND_URL = () => Deno.env.get('RESEND_API_URL') || 'https://api.resend.com/emails';
const RESEND_KEY = () => Deno.env.get('RESEND_KEY') || Deno.env.get('RESEND_API_KEY') || '';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export async function sendEmail(msg: { to: string; subject: string; html: string; text: string; replyTo?: string; unsubscribeUrl?: string; attachments?: { filename: string; content: Uint8Array }[] }): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!RESEND_KEY()) return { ok: false, error: 'resend_not_configured' };
  const headers: Record<string, string> = {};
  if (msg.unsubscribeUrl) {
    headers['List-Unsubscribe'] = `<${msg.unsubscribeUrl}>, <mailto:support@davisdigitalstudio.com?subject=unsubscribe>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }
  try {
    const r = await fetch(RESEND_URL(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [msg.to], reply_to: msg.replyTo || ERIC_EMAIL, subject: msg.subject, html: msg.html, text: msg.text, headers, ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: toBase64(a.content) })) } : {}) }),
      signal: AbortSignal.timeout(10_000),
    });
    const out = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, id: out?.id } : { ok: false, error: `resend_${r.status}` };
  } catch (e) { return { ok: false, error: String(e).slice(0, 120) }; }
}

const NAVY = '#0f142a', GOLD = '#b08d57', CREAM = '#faf8f5', MUTED = '#5b6075';

function shell(inner: string, footer: string) {
  return `<!doctype html><html><body style="margin:0;background:${CREAM};font-family:Inter,-apple-system,Segoe UI,Arial,sans-serif;color:${NAVY};">
<div style="max-width:560px;margin:0 auto;padding:32px 20px;">
<p style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${GOLD};font-weight:600;margin:0 0 18px;">Davis Digital Studio</p>
<div style="background:#fff;border:1px solid rgba(15,20,42,.09);border-radius:18px;padding:28px;">${inner}</div>
${footer}
</div></body></html>`;
}

const button = (href: string, label: string) =>
  `<a href="${esc(href)}" style="display:inline-block;background:${NAVY};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 22px;border-radius:999px;">${esc(label)}</a>`;

export function reportReadyEmail(p: { name?: string | null; toolName: string; businessName?: string | null; score: number | null; label: string | null; reportUrl: string; calendlyUrl: string; unsubscribeUrl: string; pdfAttached?: boolean }) {
  const hi = p.name ? `Hi ${esc(p.name)},` : 'Hi,';
  const forWhat = p.businessName ? ` for ${esc(p.businessName)}` : '';
  const scoreLine = p.score != null ? `<p style="margin:0 0 18px;font-size:15px;line-height:1.6;">Your overall score is <strong>${p.score}</strong>${p.label ? ` (${esc(p.label)})` : ''}. The full report has every finding, the three fixes that matter most, and the details behind each one.</p>` : '';
  const html = shell(
    `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${hi}</p>
<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">Your ${esc(p.toolName)}${forWhat} is ready.</p>
${scoreLine}
<p style="margin:0 0 22px;">${button(p.reportUrl, 'Open your report')}</p>
<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:${MUTED};">${p.pdfAttached ? 'A PDF copy is attached to this email.' : 'To save a PDF, open the report and use the "Save as PDF" button.'}</p>
<p style="margin:18px 0 0;font-size:15px;line-height:1.6;">If you'd like me to walk you through it, <a href="${esc(p.calendlyUrl)}" style="color:${NAVY};font-weight:600;">book a free 30 minute call</a>.</p>
<p style="margin:18px 0 0;font-size:15px;line-height:1.6;">Eric Davis<br><span style="color:${MUTED};">Davis Digital Studio</span></p>`,
    `<p style="font-size:12px;color:${MUTED};margin:18px 4px 0;line-height:1.6;">You're getting this because you asked for this report on davisdigitalstudio.com. Davis Digital Studio LLC · Burbank, California · <a href="${esc(p.unsubscribeUrl)}" style="color:${MUTED};">Unsubscribe</a></p>`,
  );
  const text = `${p.name ? `Hi ${p.name},` : 'Hi,'}

Your ${p.toolName}${p.businessName ? ` for ${p.businessName}` : ''} is ready.${p.score != null ? `\nYour overall score is ${p.score}${p.label ? ` (${p.label})` : ''}.` : ''}

Open your report: ${p.reportUrl}

${p.pdfAttached ? 'A PDF copy is attached to this email.' : 'To save a PDF, open the report and use the "Save as PDF" button.'}

If you'd like me to walk you through it, book a free 30 minute call: ${p.calendlyUrl}

Eric Davis
Davis Digital Studio

--
Davis Digital Studio LLC · Burbank, California
Unsubscribe: ${p.unsubscribeUrl}`;
  return { subject: `Your ${p.toolName} is ready`, html, text };
}

export function leadAlertEmail(p: { toolName: string; reportUrl: string; score: number | null; label: string | null; lead: Record<string, unknown> }) {
  const l = p.lead;
  const who = String(l.business_name || l.website_url || l.email || 'someone');
  const rows: [string, unknown][] = [
    ['Email', l.email], ['Name', l.name], ['Business', l.business_name], ['Type', l.business_type],
    ['City', l.city], ['Website', l.website_url], ['Score', p.score != null ? `${p.score}${p.label ? ` (${p.label})` : ''}` : null],
    ['Marketing consent', l.consent_marketing ? 'Yes' : 'No'],
  ];
  const shown = rows.filter(([, v]) => v != null && v !== '');
  const html = shell(
    `<p style="margin:0 0 14px;font-size:17px;font-weight:600;">${esc(who)} ran the ${esc(p.toolName)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px;margin:0 0 20px;">${shown.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:${MUTED};white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;">${esc(v)}</td></tr>`).join('')}</table>
<p style="margin:0;">${button(p.reportUrl, 'Open the report')}</p>`,
    '',
  );
  const text = `${who} ran the ${p.toolName}\n\n${shown.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\nReport: ${p.reportUrl}`;
  return { subject: `New lead: ${who} ran ${p.toolName}`, html, text };
}
