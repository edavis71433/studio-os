// ── The project survey, on the main server (builder item 392) ──────────────────
// project-survey.html is the short "how did it go?" form the studio sends a client after
// launch. It posted to the old server (clever-api's survey_response), one of the last
// public doors there. It now posts here, with the same rules: the answer is kept first
// (survey_responses, which the referral and sentiment readers use), then the studio's
// owner is told by email, and the page hears truthfully whether each happened.
// PUBLIC: no sign-in. A survey link carries only the client's id (never a name in a web
// address), so the name is read from the client record when the form didn't send one.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { clientIp, rateAllow } from '../lib/ratelimit.ts';
import { appBase } from '../../_shared/app_url.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A sender may send this many an hour, and all senders together this many a day. */
export const SURVEY_LIMITS = { perSenderHour: 10, allDay: 50 };

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

export interface SurveyAnswer { name: string; email: string; subject: string; message: string; clientId: string | null }

/** What the form sent, trimmed to size; null when there is nothing to keep. Pure. */
export function readSurvey(body: unknown): SurveyAnswer | null {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const meta = (b.meta && typeof b.meta === 'object' ? b.meta : {}) as Record<string, unknown>;
  const message = clip(b.message, 4000);
  if (!message) return null;
  const id = String(meta.client_id ?? '');
  return { name: clip(b.clientName, 200), email: clip(b.clientEmail, 200), subject: clip(b.subject, 200), message, clientId: UUID.test(id) ? id.toLowerCase() : null };
}

/** The owner's email: who wrote, then each line they wrote. Every word is theirs, so all of
 *  it is escaped. Pure. */
export function surveyEmail(a: SurveyAnswer): { subject: string; html: string } {
  const who = a.name || 'A client';
  const subject = a.subject ? (a.name && !a.subject.includes(a.name) ? `${a.subject} from ${a.name}` : a.subject) : `New project survey answer${a.name ? ': ' + a.name : ''}`;
  const lines = a.message.split('\n').map((l) => l.trim()).filter(Boolean);
  const html = `<h1 style="font-size:20px;margin:0 0 12px">New project survey answer</h1>`
    + `<p style="margin:0 0 12px;color:#55526a">From ${esc(who)}${a.email ? ` · ${esc(a.email)}` : ''}</p>`
    + lines.map((l) => `<p style="margin:0 0 8px">${esc(l)}</p>`).join('')
    + `<p class="cta"><a href="${appBase()}/studio.html" style="display:inline-block;margin-top:10px;background:#5b3fa0;color:#fff;padding:9px 16px;border-radius:999px;text-decoration:none">Open Studio OS</a></p>`;
  return { subject: subject.slice(0, 200), html };
}

export async function handleSurveyResponse(req: Request, cors: Record<string, string>): Promise<Response> {
  let body: unknown = null; try { body = await req.json(); } catch { /* answered below */ }
  const a = readSurvey(body);
  if (!a) return json({ error: 'bad_request', message: 'Write a few words first.' }, 400, cors);
  // the day's ceiling is counted only for a sender still inside their own hour
  const ok = (await rateAllow(`survey:ip:${clientIp(req)}`, SURVEY_LIMITS.perSenderHour, 3600)) && (await rateAllow('survey:day', SURVEY_LIMITS.allDay, 86400));
  if (!ok) return json({ error: 'rate_limited', message: 'Thanks! We’ve had a lot of answers just now. Please try again later.' }, 429, cors);

  // keep it first: email is a way to hear about it, not where it lives
  let name = a.name;
  if (!name && a.clientId) {
    const c = await svc(`clients?id=eq.${a.clientId}&select=name&limit=1`).catch(() => null);
    name = clip(c?.json?.[0]?.name, 200);
  }
  const ins = await svc('survey_responses', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ client_id: a.clientId, client_name: name || null, client_email: a.email || null, message: a.message }) }).catch(() => null);
  const saved = !!ins?.ok;

  let emailed = false;
  const to = Deno.env.get('OPS_ALERT_EMAIL') || 'eric@davisdigitalstudio.com';
  try {
    const { subject, html } = surveyEmail({ ...a, name });
    const { sendEmail } = await import('../commerce/account.ts');
    emailed = await sendEmail(to, subject, html, undefined, { critical: true });   // the owner's own alert
  } catch { emailed = false; }
  return json({ ok: true, saved, emailed }, 200, cors);
}
