// ── Builder item 391: a stranger can't make a site send hundreds of emails ──
//   deno run --allow-read --allow-env --allow-net tests/presence/auto_reply_ceiling_391_test.mjs
// One automatic reply a day per address held (item 203), but nothing capped a site, a form
// took 60 posts a minute, and a "a person waited" ticket worked again and again for a day
// (Nov 22 2026 review, file 07 finding 10). Now:
//   1  a site sends at most 200 automatic replies in a UTC day, all kinds together; the
//      per-address rule still comes first and a held-back reply isn't counted; the site and
//      its studio are told once that day; the next day starts again; a booking's own
//      confirmation still goes when the count can't be read
//   2  the notice lands on the site's bell and in the studio's news for that site, an update
//   3  a ticket is good for 30 minutes on pages that ask again every 20; pages published
//      before keep the day they were built for until the site is published again, and the
//      old pages get 12 hours to go
//   4  a booking past the ceiling still lands; the owner is told no confirmation went
//   5  a site's forms take 20 posts a minute and 300 an hour
import { installFakePostgrest } from './fake_pgrst.mjs';
import { pinClock } from './clock.mjs';

const ROOT = new URL('../../', import.meta.url);
// the newest list of notice kinds, from the migration that last set it, so the stand-in refuses what the table refuses
const kindsSql = Deno.readTextFileSync(new URL('supabase/migrations/0270_notice_kinds_safety.sql', ROOT));
const NOTICE_KINDS = [...kindsSql.slice(kindsSql.indexOf('check (kind in (')).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
const db = installFakePostgrest({ strict: { presence_plan_notices: { check: { kind: NOTICE_KINDS } } } });
Deno.env.set('LINK_SECRET', 'test-link-root');

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const SID = '39100000-0000-4000-8000-000000000001', OTHER = '39100000-0000-4000-8000-000000000002', CLIENT = '39100000-0000-4000-8000-0000000000c1';
const restore = pinClock('2026-11-21T20:00:00Z');

const P = '../../supabase/functions/presence';
const AR = await import(`${P}/lib/auto_reply.ts`);
const FC = await import(`${P}/lib/form_check.ts`);
const { TICKET_FRESH_MS, TICKET_SETTLE_MS } = await import(`${P}/lib/site_send.ts`);
const { SITE_NEWS_KINDS, siteNews } = await import(`${P}/agency/routes.ts`);
const { noticeTier } = await import(`${P}/lib/inbox_feed.ts`);
const { noticeHrefFor, STUDIO_WEBSITE_NOTICE_KINDS } = await import(`${P}/routes/workspace.ts`);
const { FORM_POSTS_PER_MINUTE, FORM_POSTS_PER_HOUR } = await import(`${P}/routes/commercial.ts`);
const { RESERVED_NAMES } = await import(`${P}/lib/reserved_store.ts`);

try {
  // ═══ 1. the site's day of automatic replies ═══
  {
    const counts = new Map(), told = [];
    const real = { ...AR.autoReplyDeps };
    let siteDown = false;
    AR.autoReplyDeps.suppression = async (e) => (e.startsWith('gone') ? 'opt_out' : null);
    AR.autoReplyDeps.hit = async (bucket, window, max) => {
      if (siteDown && bucket.startsWith('autoreply-site:')) return null;
      const k = `${bucket}|${window}`; counts.set(k, (counts.get(k) || 0) + 1); return counts.get(k) <= max;
    };
    AR.autoReplyDeps.ceilingNotice = async (siteId, day) => { told.push({ siteId, day }); };
    const kinds = ['enquiry', 'booking', 'join'];
    const verdicts = [];
    for (let i = 0; i < 200; i++) verdicts.push(await AR.autoReplyVerdict(kinds[i % 3], SID, `visitor${i}@mail.example`));
    ok('200 different addresses in a day, any kind: all go', verdicts.every((v) => v === 'send') && AR.SITE_AUTO_REPLIES_PER_DAY === 200);
    ok('…the 201st waits for tomorrow', await AR.autoReplyVerdict('enquiry', SID, 'one-more@mail.example') === 'site_ceiling');
    ok('…and a booking\'s confirmation too, all kinds count together', await AR.autoReplyVerdict('booking', SID, 'booker@mail.example') === 'site_ceiling');
    ok('…the site and its studio are told once that day', told.length === 1 && told[0].siteId === SID && told[0].day === '2026-11-21', JSON.stringify(told));
    const siteCount = counts.get(`${AR.siteCeilingBucket(SID)}|${AR.dayWindow(Date.now())}`);
    ok('the per-address rule first: a second reply to one address is held back, and not counted for the site', await AR.autoReplyVerdict('enquiry', SID, 'visitor0@mail.example') === 'sent_today' && counts.get(`${AR.siteCeilingBucket(SID)}|${AR.dayWindow(Date.now())}`) === siteCount);
    ok('…nor is an address on the do-not-send list', await AR.autoReplyVerdict('enquiry', SID, 'gone@mail.example') === 'unsubscribed' && counts.get(`${AR.siteCeilingBucket(SID)}|${AR.dayWindow(Date.now())}`) === siteCount);
    ok('another site has its own 200', await AR.autoReplyVerdict('enquiry', OTHER, 'one-more@mail.example') === 'send');
    const nowFn = AR.autoReplyDeps.now;
    AR.autoReplyDeps.now = () => Date.now() + 86_400_000;
    ok('the next day starts again', await AR.autoReplyVerdict('enquiry', SID, 'next-day@mail.example') === 'send');
    AR.autoReplyDeps.now = nowFn;
    siteDown = true;
    ok('a site count that can\'t be read: a booking\'s own confirmation still goes, an optional reply doesn\'t', await AR.autoReplyVerdict('booking', OTHER, 'b1@mail.example', { failOpen: true }) === 'send' && await AR.autoReplyVerdict('enquiry', OTHER, 'b2@mail.example') === 'unchecked');
    Object.assign(AR.autoReplyDeps, real);
  }

  // ═══ 2. the notice ═══
  {
    db.reset({ presence_sites: [{ id: SID, client_id: CLIENT }], presence_plan_notices: [] });
    await AR.autoReplyDeps.ceilingNotice(SID, '2026-11-21');
    await AR.autoReplyDeps.ceilingNotice(SID, '2026-11-21');
    const n = db.tables.presence_plan_notices;
    ok('the notice is written on the site\'s own bell, once for the day, and the table takes its kind', n.length === 1 && n[0].kind === 'auto_reply_ceiling' && n[0].client_id === CLIENT && n[0].period === 'day:2026-11-21', JSON.stringify(n));
    ok('…in plain words: what stopped, what still works, what to do', /Automatic replies paused for today: 200 sent/.test(n[0].headline) && /still arrive/.test(n[0].body) && /Spam/.test(n[0].body) && !/—/.test(n[0].body + n[0].headline));
    ok('…a report, not a to-do: the studio sees it in its news for the site; at its own site it stays on the Website page', noticeTier('auto_reply_ceiling') === 'update' && SITE_NEWS_KINDS.has('auto_reply_ceiling') && STUDIO_WEBSITE_NOTICE_KINDS.has('auto_reply_ceiling'));
    const lines = siteNews([{ id: 'n1', site_id: SID, kind: 'auto_reply_ceiling', period: 'day:2026-11-21', headline: n[0].headline, body: n[0].body, created_at: '2026-11-21T19:00:00Z' }], { [SID]: 'Kismet Bakery' }, '2026-11-21T20:00:00Z');
    ok('…the studio\'s line names the site and opens its enquiries', lines.length === 1 && /^Kismet Bakery: Automatic replies paused/.test(lines[0].title) && lines[0].link === 'Open the enquiries' && /^\/inbox\.html\?client=[^#]+#enquiries$/.test(lines[0].href), JSON.stringify(lines[0]));
    ok('the other two new kinds go where they help', noticeHrefFor({ kind: 'upload_refused' }) === '/files.html' && SITE_NEWS_KINDS.has('email_not_sent') && noticeTier('email_not_sent') === 'needs_you');
  }

  // ═══ 3. tickets: 30 minutes on pages that ask every 20 ═══
  {
    const t0 = Math.floor(Date.now() / 1000);
    const tk = await FC.issueTicket(SID, t0);
    ok('a ticket 29 minutes old is good', await FC.readTicket(tk, SID, t0 + 29 * 60) === 'ok' && FC.TICKET_MAX_AGE_S === 30 * 60);
    ok('…31 minutes old is stale', await FC.readTicket(tk, SID, t0 + 31 * 60) === 'stale');
    ok('the pages ask again every 20 minutes, well inside the 30 (with time to wait out the three seconds)', TICKET_FRESH_MS === 20 * 60_000 && TICKET_FRESH_MS + TICKET_SETTLE_MS < FC.TICKET_MAX_AGE_S * 1000);
    const now = Date.now(), H = 3600_000;
    const before = FC.sendCheckOf({ since: new Date(now - 30 * 24 * H).toISOString() }, now);
    ok('a site published only before this change: its pages ask every 11 hours, so tickets stay good for a day', before.checking && before.maxAgeS === 24 * 3600);
    const justNow = FC.sendCheckOf({ since: new Date(now - 30 * 24 * H).toISOString(), short_since: new Date(now - H).toISOString() }, now);
    ok('…published again an hour ago: a day still, while the old pages already open in a browser go', justNow.maxAgeS === 24 * 3600);
    const later = FC.sendCheckOf({ since: new Date(now - 30 * 24 * H).toISOString(), short_since: new Date(now - 13 * H).toISOString() }, now);
    ok('…13 hours on: 30 minutes', later.checking && later.maxAgeS === 30 * 60);
    ok('a site never published with tickets isn\'t checked', !FC.sendCheckOf(null, now).checking && !FC.sendCheckOf({}, now).checking);
    // the reserved row, written at publish
    db.reset({ presence_sales_templates: [{ id: crypto.randomUUID(), site_id: SID, kind: 'proposal', name: RESERVED_NAMES.formCheck, title: '', body: JSON.stringify({ since: '2026-10-01T00:00:00Z' }), deleted_at: null, updated_at: '2026-10-01T00:00:00Z' }] });
    await FC.startCheckingSends(SID);
    const row = () => JSON.parse(db.tables.presence_sales_templates.find((x) => x.name === RESERVED_NAMES.formCheck).body);
    const first = row();
    ok('the first publish with this change writes when the short tickets began, and keeps when the checks began', first.since === '2026-10-01T00:00:00Z' && first.short_since === new Date(now).toISOString(), JSON.stringify(first));
    const writes = db.writes('presence_sales_templates').length;
    await FC.startCheckingSends(SID);
    ok('…later publishes write nothing', db.writes('presence_sales_templates').length === writes && row().short_since === first.short_since);
    // judged as a form send: the same 2-hour-old ticket, on a site 13 hours into short tickets, and on one before
    const old = await FC.issueTicket(SID, t0 - 2 * 3600);
    db.reset({ presence_sales_templates: [{ id: crypto.randomUUID(), site_id: SID, kind: 'proposal', name: RESERVED_NAMES.formCheck, title: '', body: JSON.stringify({ since: '2026-10-01T00:00:00Z', short_since: new Date(now - 13 * H).toISOString() }), deleted_at: null, updated_at: '2026-10-01T00:00:00Z' }] });
    const send = { trap: false, ticket: old, email: 'sam@mail.example', name: 'Sam', message: 'Hello' };
    ok('a two-hour-old ticket on a site with short tickets: kept in Spam, as one with no check', await FC.judgeSend(SID, send) === 'no_check');
    db.reset({ presence_sales_templates: [{ id: crypto.randomUUID(), site_id: SID, kind: 'proposal', name: RESERVED_NAMES.formCheck, title: '', body: JSON.stringify({ since: '2026-10-01T00:00:00Z' }), deleted_at: null, updated_at: '2026-10-01T00:00:00Z' }] });
    ok('…on a site not yet published again: still a real message', await FC.judgeSend(SID, send) === null);
  }

  // ═══ 4. a booking past the ceiling ═══
  {
    const { notifyOwnerOfBooking } = await import(`${P}/routes/booking.ts`);
    db.reset({ presence_sites: [{ id: SID, client_id: CLIENT }], presence_plan_notices: [], presence_identity: [] });
    await notifyOwnerOfBooking(SID, { id: 'a1', type_name: 'Haircut', slot_start_local: '2026-11-24T10:00', customer_name: 'Sam', customer_email: 'sam@mail.example' }, 'confirmed', true);
    const n = db.tables.presence_plan_notices.find((x) => x.kind === 'new_booking');
    ok('the owner\'s alert says the customer got no confirmation, and to confirm with them', !!n && /didn’t email them a confirmation/.test(n.body) && /confirm with them yourself/.test(n.body), n && n.body);
    db.reset({ presence_sites: [{ id: SID, client_id: CLIENT }], presence_plan_notices: [], presence_identity: [] });
    await notifyOwnerOfBooking(SID, { id: 'a2', type_name: 'Haircut', slot_start_local: '2026-11-24T11:00', customer_name: 'Ana' }, 'confirmed');
    ok('…and an ordinary booking\'s alert is as it was', !/confirmation/.test(db.tables.presence_plan_notices.find((x) => x.kind === 'new_booking').body));
  }

  // ═══ 5. the form post rate ═══
  ok('a site\'s forms take 20 posts a minute and 300 an hour (it was 60 a minute)', FORM_POSTS_PER_MINUTE === 20 && FORM_POSTS_PER_HOUR === 300);
} finally { restore(); }

const passed = results.filter(Boolean).length;
console.log(`\n════ AUTOMATIC REPLY CEILING + SHORT TICKETS (builder item 391): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
