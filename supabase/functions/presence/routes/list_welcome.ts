// ── The welcome email card on Send an update (builder list item 221) ─────────
//   GET  /broadcasts/welcome        on or off, its words (the owner's or the standard
//                                   ones), how many went, and the address replies reach
//   PUT  /broadcasts/welcome        { enabled?, subject?, body?, standard? }  (configure)
//   POST /broadcasts/welcome/test   { subject?, body? }: the words as they are on the card,
//                                   saved or not, to the signed-in person only, marked
//                                   [Test]; nothing is counted  (configure)
// The setting and the send live in lib/join_welcome.ts; the email goes out when someone
// presses "Yes, add me" (routes/commercial.ts handleJoinPost).
import { json } from '../../_shared/http.ts';
import { updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { readWelcome, normalizeWelcome, applyWelcomeChange, welcomeWords, sendWelcomeTo, WELCOME_SUBJECT, WELCOME_BODY, WELCOME_SUBJECT_MAX, WELCOME_BODY_MAX } from '../lib/join_welcome.ts';
import type { WelcomeSetting, WelcomeChange } from '../lib/join_welcome.ts';
import { cleanBody, cleanSubject } from '../lib/broadcast.ts';
import { ownerReplyTo } from '../lib/service_bridge.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

/** What the card shows. */
async function welcomeCard(site: SiteRow, s: WelcomeSetting) {
  return {
    ...s, words: welcomeWords(s), standard: { subject: WELCOME_SUBJECT, body: WELCOME_BODY },
    subject_max: WELCOME_SUBJECT_MAX, body_max: WELCOME_BODY_MAX,
    reply_to: (await ownerReplyTo(site.id).catch(() => '')) || null,   // who a reply reaches; none set, the site's Inbox
  };
}

export async function handleWelcomeGet(site: SiteRow, cors: Record<string, string>) {
  return json({ data: await welcomeCard(site, await readWelcome(site.id)) }, 200, cors);
}

export async function handleWelcomePut(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  let b: WelcomeChange = {}; try { b = await req.json(); } catch { /* answered below */ }
  if (!b || typeof b !== 'object') b = {};
  const nowIso = new Date().toISOString(), who = principal.email || null;
  // what can't be kept is said plainly before anything is written; the change itself doesn't depend on what is stored
  const check = applyWelcomeChange(normalizeWelcome(null), b, who, nowIso);
  if (!check.ok) return json({ error: 'bad_request', message: check.message }, 400, cors);
  const next = await updateReservedJson(site.id, RESERVED_NAMES.joinWelcome, (cur) => {
    const r = applyWelcomeChange(normalizeWelcome(cur), b, who, nowIso);
    return r.ok ? r.setting : normalizeWelcome(cur);
  }, who || 'studio');
  if (!next) return json({ error: 'write_failed', message: 'That didn’t save. Nothing was changed.' }, 502, cors);
  return json({ data: await welcomeCard(site, normalizeWelcome(next)) }, 200, cors);
}

export async function handleWelcomeTest(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>) {
  const to = String(principal.email || '').trim();
  if (!to) return json({ error: 'bad_request', message: 'Your sign-in has no email to send the test to.' }, 400, cors);
  let b: { subject?: unknown; body?: unknown } = {}; try { b = await req.json(); } catch { /* the saved words */ }
  if (!b || typeof b !== 'object') b = {};
  const s = await readWelcome(site.id);
  const subject = typeof b.subject === 'string' ? cleanSubject(b.subject).slice(0, WELCOME_SUBJECT_MAX) : '';
  const body = typeof b.body === 'string' ? cleanBody(b.body).trim().slice(0, WELCOME_BODY_MAX) : '';
  const ok = await sendWelcomeTo(site.id, to, welcomeWords({ subject: subject || s.subject, body: body || s.body }), { test: true }).catch(() => false);
  if (!ok) return json({ error: 'send_failed', message: 'The test didn’t send. Check that email sending is set up, then try again.' }, 502, cors);
  return json({ data: { sent_to: to } }, 200, cors);
}
