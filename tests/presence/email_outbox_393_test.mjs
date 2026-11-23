// ── Builder item 393: the emails that matter wait in an outbox until they go ──
//   deno run --allow-read --allow-env --allow-net tests/presence/email_outbox_393_test.mjs
// An email the sending service refused or didn't answer used to be dropped (Nov 22 2026
// review, file 07 finding 17). Now a money, sign-in or agreement email is written down
// before its send, ticked after, and tried again every 15 minutes for a day, never twice:
//   1  taken at once: ticked sent, the message cleared, one delivery, with its key
//   2  the service down: kept and said "sent"; tried again only after 15 minutes, the same
//      message with the same key, then ticked
//   3  never twice: an answer lost after the service took it, tried again with the same key,
//      delivers nothing more
//   4  refused for good (a bad address): "not sent", as before, and never tried again
//   5  a day of failures: given up at 23 and a half hours, the message cleared, the site
//      that sent it told once
//   6  an address that bounced meanwhile gets nothing
//   7  two runs at once send it once; done rows go after 30 days
//   8  mail that isn't kept, and an outbox that can't be written: once, as before
//   9  the Health page's words, and a run that never sounds the alarm
import { installFakePostgrest } from './fake_pgrst.mjs';
import { pinClock } from './clock.mjs';

const ROOT = new URL('../../', import.meta.url);
// the two check lists, from the migration itself, so the stand-in refuses what the table refuses
const sql = Deno.readTextFileSync(new URL('supabase/migrations/0268_email_outbox.sql', ROOT));
const listOf = (col) => [...(new RegExp(`${col} text not null[^\\n]*check \\(${col} in \\(([^)]*)\\)\\)`).exec(sql) || ['', ''])[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const KINDS = listOf('kind'), STATUSES = listOf('status');

const db = installFakePostgrest({ strict: { email_outbox: { uuid: ['site_id'], check: { kind: KINDS, status: STATUSES } } } });
Deno.env.set('RESEND_KEY', 're_test_key');
Deno.env.set('RESEND_API_URL', 'https://resend.test/emails');

// ── a stand-in for the sending service, which remembers keys as the real one does ──
const resend = { mode: 'ok', deliveries: [], calls: [], byKey: new Map() };
const pg = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).startsWith('https://resend.test/')) return pg(url, init);
  const key = new Headers(init.headers).get('Idempotency-Key');
  const body = String(init.body || '');
  resend.calls.push({ key, body });
  if (key && resend.byKey.has(key)) {
    const first = resend.byKey.get(key);
    if (first.body !== body) return new Response(JSON.stringify({ name: 'invalid_idempotent_request' }), { status: 409 });
    return new Response(JSON.stringify({ id: first.id }), { status: 200 });   // the first answer again; nothing delivered
  }
  if (resend.mode === 'down') return new Response('{"name":"internal_server_error"}', { status: 503 });
  if (resend.mode === 'refuse') return new Response('{"name":"validation_error","message":"Invalid `to` field."}', { status: 422 });
  const id = `em_${resend.deliveries.length + 1}`;
  resend.deliveries.push({ key, body });
  if (key) resend.byKey.set(key, { id, body });
  if (resend.mode === 'lost') { const e = new Error('The signal has been aborted'); e.name = 'TimeoutError'; throw e; }   // taken, but the answer never came back
  return new Response(JSON.stringify({ id }), { status: 200 });
};

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const uuid = (c) => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`;
const SITE = uuid('a'), CLIENT = uuid('b');
const T0 = '2026-11-20T15:00:00Z';
const at = (min) => new Date(Date.parse(T0) + min * 60_000).toISOString();
let restore = pinClock(T0);
const moveTo = (iso) => { restore(); restore = pinClock(iso); };

const { sendEmail } = await import('../../supabase/functions/presence/commerce/account.ts');
const O = await import('../../supabase/functions/presence/lib/email_outbox.ts');
const { emailArea } = await import('../../supabase/functions/presence/lib/health_center.ts');
const { sweepIssues } = await import('../../supabase/functions/presence/routes/system.ts');

const fresh = () => {
  db.reset({ presence_sites: [{ id: SITE, client_id: CLIENT }], suppressed_emails: [], presence_plan_notices: [] });
  resend.mode = 'ok'; resend.deliveries = []; resend.calls = []; resend.byKey = new Map();
  moveTo(T0);
};
const rows = () => db.tables.email_outbox || [];
const invoice = (to = 'pat@client.example') => sendEmail(to, 'Invoice 1042 — $480.00', '<p>Here is your invoice.</p>', undefined, { critical: true, siteId: SITE, keep: 'money' });

try {
  // ═══ 1. taken at once ═══
  fresh();
  {
    const sent = await invoice();
    const r = rows()[0];
    ok('taken at once: the caller hears sent', sent === true);
    ok('…the row was written before the send and ticked after: sent, the message cleared', r && r.status === 'sent' && r.payload === null && !!r.sent_at && r.kind === 'money' && r.site_id === SITE, JSON.stringify(r));
    ok('…one delivery, carrying the row\'s key', resend.deliveries.length === 1 && resend.deliveries[0].key === O.outboxKey(r.id));
    ok('…and the row was in the outbox before the service was asked', db.log.findIndex((c) => c.method === 'POST' && c.url.startsWith('/rest/v1/email_outbox')) >= 0 && resend.calls.length === 1);
  }

  // ═══ 2. the service down for a while ═══
  fresh();
  {
    resend.mode = 'down';
    const sent = await invoice();
    const r = rows()[0];
    ok('the service down: kept, and the caller hears sent (it will be)', sent === true && r && r.status === 'queued' && r.tries === 1 && !!r.payload && /503/.test(r.last_error || ''), JSON.stringify(r));
    ok('…to be tried again in 15 minutes', r && Date.parse(r.next_try_at) === Date.parse(at(15)), r && r.next_try_at);
    const firstBody = resend.calls[0].body;
    moveTo(at(10)); resend.mode = 'ok';
    const early = await O.runEmailOutbox();
    ok('…a run before then leaves it alone', early.tried === 0 && resend.calls.length === 1, JSON.stringify(early));
    moveTo(at(15));
    const run = await O.runEmailOutbox();
    const r2 = rows()[0];
    ok('…the run after 15 minutes sends it and ticks it', run.sent === 1 && r2.status === 'sent' && r2.payload === null && r2.tries === 2, JSON.stringify(run));
    ok('…the same message, with the same key', resend.calls.length === 2 && resend.calls[1].body === firstBody && resend.calls[1].key === resend.calls[0].key && resend.calls[0].key === O.outboxKey(r2.id));
    ok('…delivered once', resend.deliveries.length === 1);
    const again = await O.runEmailOutbox();
    ok('…and never tried again once sent', again.tried === 0 && resend.calls.length === 2);
  }

  // ═══ 3. never twice: the service took it, the answer was lost ═══
  fresh();
  {
    resend.mode = 'lost';
    const sent = await invoice();
    ok('an answer lost after the service took it: kept, the caller hears sent', sent === true && rows()[0].status === 'queued' && /no answer|aborted/i.test(rows()[0].last_error || ''), JSON.stringify(rows()[0]));
    // the database keeps the message in a jsonb column, which stores its keys in an order of its own
    const reorder = (v) => Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reorder(v[k])])) : v;
    rows()[0].payload = reorder(rows()[0].payload);
    moveTo(at(16)); resend.mode = 'ok';
    const run = await O.runEmailOutbox();
    ok('…the retry, even with the keys stored in another order, is the same message, so it gets the first answer back and ticks it', run.sent === 1 && rows()[0].status === 'sent' && resend.calls[1].body === resend.calls[0].body, JSON.stringify(run));
    ok('…and nothing more is delivered: one copy, ever', resend.deliveries.length === 1 && resend.calls.length === 2);
  }

  // ═══ 4. refused for good ═══
  fresh();
  {
    resend.mode = 'refuse';
    const sent = await invoice('not-an-address@');
    const r = rows()[0];
    ok('refused for good (a bad address): the caller hears not sent, as before', sent === false && r.status === 'failed' && r.payload === null && /422/.test(r.last_error || ''), JSON.stringify(r));
    moveTo(at(60)); resend.mode = 'ok';
    await O.runEmailOutbox();
    ok('…and it is never tried again', resend.calls.length === 1);
  }

  // ═══ 5. a day of failures ═══
  fresh();
  {
    resend.mode = 'down';
    await invoice();
    let tries = 1;
    for (let m = 15; m < 23.5 * 60; m += 15) { moveTo(at(m)); const r = await O.runEmailOutbox(); tries += r.tried; }
    ok('the service down all day: tried every 15 minutes, 23 and a half hours of tries', tries === 94 && rows()[0].status === 'queued', `${tries} tries, ${rows()[0].status}`);
    moveTo(at(23.5 * 60));
    const last = await O.runEmailOutbox();
    const r = rows()[0];
    ok('…then given up: failed, the message cleared', last.gave_up === 1 && r.status === 'failed' && r.payload === null && !!r.done_at, JSON.stringify(last));
    const n = db.tables.presence_plan_notices.filter((x) => x.kind === 'email_not_sent');
    ok('…and the site that sent it is told, in plain words', n.length === 1 && n[0].site_id === SITE && n[0].client_id === CLIENT && n[0].period === `outbox:${r.id}` && /Invoice 1042/.test(n[0].headline) && /pat@client\.example/.test(n[0].body) && /for a day/.test(n[0].body), JSON.stringify(n[0]));
    moveTo(at(24 * 60 + 30));
    await O.runEmailOutbox();
    ok('…once', db.tables.presence_plan_notices.filter((x) => x.kind === 'email_not_sent').length === 1 && resend.deliveries.length === 0);
    ok('every try stayed inside the service\'s 24 hours of remembering a key', O.OUTBOX_GIVE_UP_MS < 24 * 3600_000);
  }

  // ═══ 6. an address that bounced meanwhile ═══
  fresh();
  {
    resend.mode = 'down';
    await invoice();
    db.tables.suppressed_emails.push({ email: 'pat@client.example', reason: 'bounce', created_at: at(5) });
    moveTo(at(15)); resend.mode = 'ok';
    const run = await O.runEmailOutbox();
    ok('bounced since: never sent, given up, the site told why', run.gave_up === 1 && resend.deliveries.length === 0 && rows()[0].status === 'failed' && /do-not-email/.test(db.tables.presence_plan_notices[0]?.body || ''), JSON.stringify(run));
  }

  // ═══ 7. two runs at once; old rows ═══
  fresh();
  {
    resend.mode = 'down';
    await invoice();
    moveTo(at(15)); resend.mode = 'ok';
    const [a, b] = await Promise.all([O.runEmailOutbox(), O.runEmailOutbox()]);
    ok('two runs at once: one claims it, one sends it', a.sent + b.sent === 1 && resend.calls.length === 2 && resend.deliveries.length === 1, JSON.stringify([a, b]));
    db.tables.email_outbox.push({ id: uuid('c'), kind: 'sign_in', to_email: 'old@x.example', subject: 'old', site_id: null, payload: null, status: 'sent', tries: 1, next_try_at: at(-40000), created_at: at(-31 * 24 * 60), sent_at: at(-31 * 24 * 60) });
    await O.runEmailOutbox();
    ok('done rows go after 30 days; the recent one stays', !rows().some((x) => x.id === uuid('c')) && rows().length === 1);
  }

  // ═══ 8. not kept; no outbox ═══
  fresh();
  {
    resend.mode = 'down';
    const sent = await sendEmail('pat@client.example', 'A note', '<p>Hello.</p>', undefined, { critical: true, siteId: SITE });
    ok('mail that isn\'t kept: no row, and a failure is "not sent", as before', sent === false && rows().length === 0 && resend.calls.length === 1 && !resend.calls[0].key);
    db.fail.add('email_outbox');
    resend.mode = 'ok';
    const once = await invoice();
    ok('an outbox that can\'t be written: the email still goes, once, the way it always did', once === true && resend.deliveries.length === 1 && !resend.deliveries[0].key);
    db.fail.delete('email_outbox');
    resend.mode = 'down';
    db.tables.suppressed_emails.push({ email: 'gone@client.example', reason: 'complaint' });
    const blocked = await invoice('gone@client.example');
    ok('an address on the do-not-email list: nothing kept, nothing sent', blocked === false && rows().length === 0);
  }

  // ═══ 9. the Health page, and the alarm ═══
  {
    ok('Health: nothing waiting', emailArea(true, { waiting: 0, gaveUp7d: 0 }).state === 'ok');
    const w = emailArea(true, { waiting: 2, gaveUp7d: 1 });
    ok('Health: what waits and what was given up, counted in words', w.state === 'attention' && /^2 important emails/.test(w.detail) && /every 15 minutes for a day/.test(w.detail) && /1 important email couldn’t be sent in the last 7 days/.test(w.detail), w.detail);
    ok('Health: one waiting reads as one', /1 important email \(money, sign-in or agreements\) is waiting/.test(emailArea(true, { waiting: 1, gaveUp7d: 0 }).detail));
    ok('Health: not counted is said, not guessed', emailArea(true, { waiting: null, gaveUp7d: 0 }).state === 'attention');
    ok('Health: before the outbox exists, the line is as it was', emailArea(true, undefined).state === 'ok' && emailArea(false, undefined).state === 'off');
    ok('a run with emails waiting and one given up never fails the scheduled run', sweepIssues({ email_outbox: { read: 3, tried: 2, sent: 0, waiting: 2, gave_up: 1 } }).length === 0);
    ok('…a run that couldn\'t read the outbox does', sweepIssues({ email_outbox: { ok: false } }).length === 1);
    ok('the kinds the code keeps are the kinds the table takes', [...O.OUTBOX_KINDS].sort().join() === [...KINDS].sort().join() && STATUSES.join() === 'queued,sent,failed');
  }
} finally { restore(); }

const passed = results.filter(Boolean).length;
console.log(`\n════ EMAIL OUTBOX (builder item 393): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
