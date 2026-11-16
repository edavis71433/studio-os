// ── The shell's shared helpers (shell-kit.js, builder item 101) ──────────────
//   deno run --allow-read --allow-env tests/presence/shell_kit_test.mjs
//
// Runs the real shell-kit.js and checks what it does: the one money format, the one
// set of date words (the person's own calendar day), and the one API helper (what it
// sends, and what a page gets back when there is no connection or the sign-in has run
// out). The page parts (the toast, the confirm, the sign-in bar) are tested in a browser:
// tests/e2e/shell-kit-101.spec.ts.

let pass = 0, fail = 0;
const ok = (name, cond, note = '') => { if (cond) pass++; else fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${note ? `  (${note})` : ''}`); };

// a page's globals, just enough for the file to load outside a browser
globalThis.window = globalThis;
const RealDate = Date;
let NOW = new RealDate(2026, 10, 16, 23, 30).getTime();   // Nov 16 2026, 11:30 pm here
class FixedDate extends RealDate {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
}
globalThis.Date = FixedDate;
await import('../../shell-kit.js');
const { ddsMoney, ddsDate, ddsApi, ddsKit } = globalThis;

ok('the kit puts its helpers on the page', !!(ddsKit && ddsMoney && ddsDate && ddsApi && globalThis.ddsToast && globalThis.ddsConfirm && globalThis.ddsAsk));

// ═══ 1. money: one format everywhere ═══
{
  ok('whole dollars show no cents', ddsMoney(125000) === '$1,250');
  ok('an amount with cents shows both digits, never "$1,234.5"', ddsMoney(123450) === '$1,234.50');
  ok('a single cent pads', ddsMoney(1001) === '$10.01');
  ok('zero is "$0", never a blank', ddsMoney(0) === '$0');
  ok('no amount at all is empty', ddsMoney(null) === '' && ddsMoney(undefined) === '' && ddsMoney('') === '');
  ok('…or what the page asks for', ddsMoney(null, { none: '—' }) === '—');
  ok('a refund reads with a minus', ddsMoney(-4000) === '-$40' && ddsMoney(-4050) === '-$40.50');
  ok('cents: true always shows the cents (a bill)', ddsMoney(120000, { cents: true }) === '$1,200.00');
  ok('millions group', ddsMoney(123456789) === '$1,234,567.89');
  ok('a number written as text still reads', ddsMoney('250000') === '$2,500');
  ok('nonsense is empty, not "$NaN"', ddsMoney('abc') === '');
  ok('dollars: the same format from dollars', ddsMoney.dollars(1200) === '$1,200' && ddsMoney.dollars(19.5) === '$19.50' && ddsMoney.dollars(0) === '$0' && ddsMoney.dollars(null) === '');
  ok('dollars: no floating-point cents', ddsMoney.dollars(0.1 + 0.2) === '$0.30');
}

// ═══ 2. dates: the person's own calendar day ═══
{
  const at = (d, h, m) => new RealDate(2026, 10, d, h || 0, m || 0);
  ok('ymd is today here', ddsDate.ymd() === '2026-11-16');
  ok('ymd of a time late in the evening is still that day (never the UTC day)', ddsDate.ymd(at(16, 23, 30).getTime()) === '2026-11-16');
  ok('a plain day is that day here, not midnight in London', ddsDate.days('2026-11-16') === 0 && ddsDate.day('2026-11-16') === 'Today');
  ok('day words', ddsDate.day(at(15, 22)) === 'Yesterday' && ddsDate.day(at(17, 9)) === 'Tomorrow' && ddsDate.day(at(12, 9)) === 'Nov 12');
  ok('another year carries its year', ddsDate.short(new RealDate(2025, 10, 3)) === 'Nov 3, 2025' && ddsDate.short(at(3)) === 'Nov 3');
  ok('days counts calendar days, not 24-hour blocks', ddsDate.days(at(15, 23, 59)) === -1 && ddsDate.days(at(16, 0, 1)) === 0);
  // the Nov 12 review (file 06, finding 101): a 10pm enquiry read "today" in the Inbox the next morning
  NOW = at(17, 8).getTime();
  ok('a 10pm enquiry is "yesterday" the next morning, on every page', ddsDate.ago(at(16, 22).toISOString()) === 'yesterday');
  ok('ago in days', ddsDate.ago(at(17, 1)) === 'today' && ddsDate.ago(at(14, 12)) === '3 days ago' && ddsDate.ago(at(9, 12)) === '1 week ago' && ddsDate.ago(at(1, 12)) === '2 weeks ago');
  ok('ago in months past 60 days', ddsDate.ago(new RealDate(2026, 7, 1)) === '3 months ago');
  ok('a day still to come is "soon"', ddsDate.ago(at(20)) === 'soon');
  ok('since: to the minute today', ddsDate.since(new RealDate(NOW - 20000)) === 'just now' && ddsDate.since(new RealDate(NOW - 5 * 60000)) === '5 min ago' && ddsDate.since(new RealDate(NOW - 3 * 3600000)) === '3 hours ago' && ddsDate.since(new RealDate(NOW - 3600000)) === '1 hour ago');
  ok('since: then the day words, then the date', ddsDate.since(at(16, 7)) === 'yesterday' && ddsDate.since(at(15, 7)) === '2 days ago' && ddsDate.since(at(13, 7)) === '4 days ago' && ddsDate.since(at(2, 7)) === 'Nov 2');
  ok('time', ddsDate.time(at(16, 15, 5)) === '3:05 PM' && ddsDate.time(at(16, 0, 0)) === '12:00 AM' && ddsDate.time(at(16, 12, 30)) === '12:30 PM');
  ok('not a date is empty everywhere', ddsDate.day('nope') === '' && ddsDate.ago(null) === '' && ddsDate.short('') === '' && ddsDate.since(undefined) === '' && ddsDate.days('x') === null && ddsDate.ymd(null) === '');
  NOW = at(16, 23, 30).getTime();
}

// ═══ 3. the API helper ═══
{
  const sent = [];
  let answer = () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
  globalThis.fetch = async (url, init) => { sent.push({ url, init }); return answer(url, init); };
  let session = { access_token: 'tok-1', expires_at: Math.floor(NOW / 1000) + 3600 };
  let reads = 0;
  const client = { auth: { getSession: async () => { reads++; return { data: { session } }; }, onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } };
  ddsApi.use(client);

  const r = await ddsApi('/studio/customers');
  const h = sent[0].init.headers;
  ok('a read carries the page\'s sign-in and the region', r.ok && r.status === 200 && r.body.data.ok === true && h['x-dds-user-jwt'] === 'tok-1' && h['x-region'] === 'us-west-2' && sent[0].url.endsWith('/functions/v1/presence/studio/customers'));
  ok('a read sends no body and says GET', sent[0].init.method === 'GET' && sent[0].init.body === undefined);
  await ddsApi('/x', { method: 'POST', body: { a: 1 }, scope: '', headers: { 'x-dds-preview': '1' } });
  ok('a save sends its body as JSON, the scope it was given and any extra header', sent[1].init.method === 'POST' && sent[1].init.body === '{"a":1}' && sent[1].init.headers['x-dds-scope-site'] === '' && sent[1].init.headers['x-dds-preview'] === '1');
  ok('the session is read once while it is fresh', reads === 1);

  session = { access_token: 'tok-2', expires_at: Math.floor(NOW / 1000) + 30 };
  await ddsApi('/y');   // the kept one still has an hour
  NOW += 3600 * 1000 - 20000;   // …and now it runs out in 20 s
  await ddsApi('/z');
  ok('a sign-in about to run out is read again from the client (which refreshes it)', reads === 2 && sent[3].init.headers['x-dds-user-jwt'] === 'tok-2');

  answer = () => { throw new TypeError('Failed to fetch'); };
  const off = await ddsApi('/save', { method: 'POST', body: {} });
  ok('no connection never throws: status 0, offline, a sentence', off.ok === false && off.status === 0 && off.offline === true && /connection/.test(off.body.message));
  ok('…and say() gives that sentence', ddsApi.say(off, 'x') === off.body.message);

  answer = () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  let aborted = false; try { await ddsApi('/slow'); } catch (e) { aborted = e.name === 'AbortError'; }
  ok('a call the page cancelled is the page\'s to handle', aborted);

  answer = () => new Response(JSON.stringify({ error: 'unauthorized', message: 'Please sign in.' }), { status: 401 });
  const out = await ddsApi('/inbox');
  ok('a refused sign-in says to sign in again, the same on every page', out.status === 401 && out.signedOut === true && out.body.message === 'Your sign-in has run out. Sign in again to carry on.' && out.body.error === 'unauthorized');
  answer = () => new Response(JSON.stringify({ error: 'wrong_password', message: 'That password didn’t match.' }), { status: 401 });
  const pw = await ddsApi('/preview');
  ok('a wrong password (also a 401) keeps its own words', !pw.signedOut && pw.body.message === 'That password didn’t match.');
  answer = () => new Response('not json', { status: 500 });
  const bad = await ddsApi('/boom');
  ok('an answer that isn\'t JSON is an empty body, never a throw', bad.ok === false && bad.status === 500 && typeof bad.body === 'object');
  ok('say(): the server\'s words, else the page\'s', ddsApi.say({ status: 400, body: { message: 'Give it a name.' } }, 'x') === 'Give it a name.' && ddsApi.say(bad, 'That didn’t save.') === 'That didn’t save.');
}

console.log(`\n════ SHELL KIT: ${pass}/${pass + fail} ${fail ? 'FAILED' : 'PASSED'} ════`);
if (fail) Deno.exit(1);
