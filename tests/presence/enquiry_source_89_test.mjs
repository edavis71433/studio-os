// ── Sales item 89: an enquiry notes where its visitor came from ───────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/enquiry_source_89_test.mjs
// The pure rules (lib/visit_source.ts: which visit, where it began, what "How did they
// find you?" starts as), the note written after a form is sent (routes/visit_source.ts,
// on the in-memory PostgREST), the Inbox rows carrying it, the privacy page saying so,
// and the pages and the route wired to it.
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const SUB = 'aaaaaaaa-0000-4000-8000-000000000001', SUB2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const db = installFakePostgrest();
const V = await import('../../supabase/functions/presence/lib/visit_source.ts');
const { noteVisitSource } = await import('../../supabase/functions/presence/routes/visit_source.ts');
const { hashIp, handleFormInbox } = await import('../../supabase/functions/presence/routes/commercial.ts');
const { VISITS_SALT } = await import('../../supabase/functions/presence/routes/collect.ts');
const { visitorDayHash } = await import('../../supabase/functions/presence/lib/visits.ts');
const { privacyBody } = await import('../../supabase/functions/presence/lib/legal_pages.ts');
const read = (p) => Deno.readTextFile(new URL('../../' + p, import.meta.url));
const [inbox, index] = await Promise.all([read('inbox.html'), read('supabase/functions/presence/index.ts')]);

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const T = Date.parse('2026-11-11T18:00:00Z'), iso = (ms) => new Date(ms).toISOString(), MIN = 60_000;
const view = (ms, ref_host = '', path = '/', utm = {}) => ({ ts: iso(ms), path, ref_host, utm_source: utm.source || '', utm_medium: utm.medium || '', utm_campaign: utm.campaign || '' });

// ═══ the rules ═══
{
  const google = view(T - 20 * MIN, 'google.com', '/services');
  ok('the visit the form was sent in: its first page', V.landingOf([google, view(T - 18 * MIN, '', '/about'), view(T - 2 * MIN, '', '/contact')], T)?.path === '/services');
  ok('a page view half an hour after the last one starts a new visit', V.landingOf([view(T - 5 * 60 * MIN, 'facebook.com', '/'), view(T - 10 * MIN, 'bing.com', '/menu'), view(T - 1 * MIN, '', '/contact')], T)?.ref_host === 'bing.com');
  ok('came back straight to send it: the earlier visit that day says where they found you', V.landingOf([view(T - 4 * 60 * MIN, 'google.com', '/services'), view(T - 3 * MIN, '', '/'), view(T - 1 * MIN, '', '/contact')], T)?.ref_host === 'google.com');
  ok('only straight visits: the latest one', V.landingOf([view(T - 4 * 60 * MIN, '', '/a'), view(T - 2 * MIN, '', '/b')], T)?.path === '/b');
  ok('page views after the form are not counted', V.landingOf([view(T + 10 * MIN, 'google.com', '/later')], T) === null);
  ok('no page views, no visit', V.landingOf([], T) === null && V.enquiryVisit([], T) === null);
  const cases = [
    [view(T, 'google.com'), 'Google', 'a Google search'],
    [view(T, 'maps.google.com'), 'Google', 'Google Maps'],
    [view(T, '', '/', { source: 'google', medium: 'cpc' }), 'Google', 'a Google ad'],
    [view(T, '', '/', { source: 'gbp' }), 'Google', 'Google'],
    [view(T, 'facebook.com'), 'Social', 'Facebook'],
    [view(T, 'l.instagram.com'), 'Social', 'Instagram'],
    [view(T, 'nextdoor.com'), 'Social', 'a link on nextdoor.com'],
    [view(T, 'yelp.com'), 'Referral', 'Yelp'],
    [view(T, 'harborchamber.org'), 'Referral', 'a link on harborchamber.org'],
    [view(T, 'bing.com'), 'Other', 'a Bing search'],
    [view(T, 'chatgpt.com'), 'Other', 'ChatGPT'],
    [view(T, '', '/', { source: 'spring-sale' }), 'Other', 'a link tagged spring-sale'],
    [view(T, ''), '', 'straight to the site'],
  ];
  const wrong = cases.filter(([v, f, w]) => V.foundViaOf(v) !== f || V.cameFrom(v) !== w).map(([v, f, w]) => `${v.ref_host || v.utm_source || 'direct'}: ${V.foundViaOf(v)}/${V.cameFrom(v)} (want ${f}/${w})`);
  ok('where a visit began, in "How did they find you?" and in words', wrong.length === 0, wrong.join('; '));
  ok('every answer is one of the seven picks or none', cases.every(([v]) => ['', 'Google', 'Referral', 'Word of mouth', 'Social', 'Repeat client', 'Website', 'Other'].includes(V.foundViaOf(v))));
  const e = V.enquiryVisit([view(T - 9 * MIN, 'google.com', '/services/' + 'x'.repeat(400), { campaign: 'c'.repeat(200) })], T);
  ok('what the enquiry keeps: where from, the first page and when, each capped', e?.from === 'a Google search' && e.found_via === 'Google' && e.landing.length === 200 && e.utm_campaign.length === 80 && e.at === iso(T - 9 * MIN));
  ok('the Inbox reads a kept visit and nothing else', V.leadVisit({ __visit: e })?.found_via === 'Google' && V.leadVisit({ __visit: 'google' }) === null && V.leadVisit({ __visit: [] }) === null && V.leadVisit(null) === null && V.leadVisit({ message: 'hi' }) === null);
}

// ═══ the note, after the form is sent ═══
const IP = '203.0.113.7', UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const sentReq = (headers = {}) => new Request(`https://fn.test/functions/v1/presence/forms/${SITE}/submit`, { method: 'POST', headers: { 'x-forwarded-for': IP, 'user-agent': UA, ...headers } });
const now = Date.now(), dayOf = (ms) => iso(ms).slice(0, 10);
const me = await visitorDayHash(IP, UA, SITE, dayOf(now), VISITS_SALT), meYesterday = await visitorDayHash(IP, UA, SITE, dayOf(now - 86_400_000), VISITS_SALT);
const stranger = await visitorDayHash('198.51.100.9', UA, SITE, dayOf(now), VISITS_SALT);
const ipHash = await hashIp(sentReq());
const visit = (ms, hash, ref_host, path, extra = {}) => ({ id: Math.floor(ms / 1000) % 1e9, site_id: SITE, ts: iso(ms), kind: 'pageview', path, ref_host, utm_source: '', utm_medium: '', utm_campaign: '', visitor_hash: hash, ...extra });
const submission = (id, extra = {}) => ({ id, site_id: SITE, form_kind: 'contact', name: 'Lena Ortiz', email: 'lena@example.com', phone: '', message: 'Do you redo dental sites?', source_page: '/contact', status: 'new', spam: false, fields: { service: 'Website' }, ip_hash: ipHash, created_at: iso(now + 200), ...extra });
{
  db.reset({
    presence_form_submissions: [submission(SUB)],
    presence_visits: [
      visit(now - 25 * MIN, me, 'google.com', '/services'), visit(now - 24 * MIN, me, '', '/about'), visit(now - 1 * MIN, me, '', '/contact'),
      visit(now - 30 * MIN, stranger, 'facebook.com', '/'),                                     // someone else on the same site
      visit(now - 26 * MIN, me, 'yelp.com', '/', { site_id: OTHER }),                           // the same person on another site
    ],
  });
  const wrote = await noteVisitSource(sentReq(), SITE, now);
  const f = db.tables.presence_form_submissions[0].fields;
  ok('a sent form notes where its visitor came from', wrote === true && f.__visit?.from === 'a Google search' && f.__visit.found_via === 'Google' && f.__visit.landing === '/services');
  ok('the form\'s own answers stay as they were', f.service === 'Website');
  ok('only this visitor\'s page views on this site are read', !db.log.some((l) => l.method === 'GET' && l.url.startsWith('/rest/v1/presence_visits?') && !l.url.includes(`site_id=eq.${SITE}`)) && db.log.some((l) => l.url.startsWith('/rest/v1/presence_visits?') && l.url.includes(me) && l.url.includes(meYesterday)));
  ok('a second run leaves the note as it is', (await noteVisitSource(sentReq(), SITE, now)) === false);
  const rows = await (await handleFormInbox({ id: SITE }, {})).json();
  const row = rows.data?.submissions?.[0];
  ok('the Inbox row carries the visit, and still not the form\'s raw answers', row?.visit?.from === 'a Google search' && row.visit.found_via === 'Google' && !('fields' in row));
}
{
  db.reset({ presence_form_submissions: [submission(SUB)], presence_visits: [visit(now - 3 * MIN, me, 'google.com', '/')] });
  ok('Do Not Track: nothing is noted', (await noteVisitSource(sentReq({ dnt: '1' }), SITE, now)) === false && !db.tables.presence_form_submissions[0].fields.__visit);
  ok('no page views from this visitor: nothing is noted', (await noteVisitSource(new Request('https://fn.test/x', { method: 'POST', headers: { 'x-forwarded-for': IP, 'user-agent': 'Other browser' } }), SITE, now)) === false && !db.tables.presence_form_submissions[0].fields.__visit);
  ok('an enquiry from an earlier minute is not this one', (await noteVisitSource(sentReq(), SITE, now + 10 * MIN)) === false && !db.tables.presence_form_submissions[0].fields.__visit);
}
{
  db.reset({ presence_form_submissions: [submission(SUB, { created_at: iso(now - 3_000) }), submission(SUB2, { created_at: iso(now + 900), fields: {} })], presence_visits: [visit(now - 2 * MIN, me, '', '/')] });
  await noteVisitSource(sentReq(), SITE, now);
  const [a, b] = db.tables.presence_form_submissions;
  ok('two quick sends: the newest gets the note, a straight visit says so with no pick', !a.fields.__visit && b.fields.__visit?.from === 'straight to the site' && b.fields.__visit.found_via === '');
}
{
  const seed = () => db.reset({ presence_form_submissions: [submission(SUB)], presence_visits: [visit(now - 3 * MIN, me, 'google.com', '/')] });
  const attempt = async () => { try { return await noteVisitSource(sentReq(), SITE, now); } catch { return 'threw'; } };
  seed(); db.fail.add('presence_visits');
  ok('the page views can\'t be read: nothing is noted, nothing thrown', (await attempt()) === false && !db.tables.presence_form_submissions[0].fields.__visit);
  seed(); db.failMethod.set('presence_form_submissions', 'PATCH');
  ok('the note can\'t be saved: it says so, nothing thrown', (await attempt()) === false);
  seed(); db.fail.add('presence_form_submissions');
  ok('the enquiry can\'t be found: nothing is noted, nothing thrown', (await attempt()) === false);
}

// ═══ the privacy page says so ═══
{
  const c = { identity: { business_name: 'Harbor Dental' }, settings: {}, sections: [] };
  const say = /your message also notes where that visit began: the name of the website you came from or the campaign tag in the link, and the first page you opened/;
  ok('privacy: a site with a form and the visit counter says a message notes where the visit began', say.test(privacyBody(c, 'November 11, 2026', { formEndpoint: 'https://fn.test/forms/x/submit' })));
  ok('privacy: no form, or the counter off, and it says nothing of the kind', !say.test(privacyBody(c, 'November 11, 2026', {})) && !say.test(privacyBody({ ...c, settings: { visit_counter: false } }, 'November 11, 2026', { formEndpoint: 'https://fn.test/forms/x/submit' })));
}

// ═══ wiring ═══
ok('the form route notes the visit after answering the visitor', /const sentAt = Date\.now\(\), res = await handleFormSubmit\(req, m\[1\], cors\); runAfterResponse\(noteVisitSource\(req, m\[1\], sentAt\)\.catch\(\(\) => false\)\); return res;/.test(index));
ok('Inbox: the enquiry shows where the visit began and its first page', /const came=v\.from&&v\.from!=='straight to the site'\?'Came from '\+v\.from:'Came straight to the site';/.test(inbox) && /<span class="pchip src">\$\{esc\(came\)\}<\/span><span class="muted">first page: /.test(inbox) && /\$\{visitHtml\(l\)\}/.test(inbox));
ok('Inbox: "How did they find you?" starts from the visit, until settled', /const foundOf=\(l\)=>l\.found_pick!==undefined\?l\.found_pick:/.test(inbox) && /\$\{foundHtml\(l,settled\)\}/.test(inbox) && /filled in from their visit/.test(inbox));
ok('Inbox: Make it a deal and Make customer carry it to the person and the deal', (inbox.match(/const fv=foundOf\(l\),found=fv\?\{found_via:fv\}:\{\};/g) || []).length === 2 && (inbox.match(/source_submission_id:id,\.\.\.found\}/g) || []).length === 2 && (inbox.match(/phone:l\.phone\|\|'',\.\.\.found\}/g) || []).length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
