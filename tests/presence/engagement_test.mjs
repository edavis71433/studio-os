// ── List item 157: button presses and time on a page ────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/engagement_test.mjs
// The visit counter notes the words on a button (and on a phone or email link) when it's
// pressed, and how long a page stayed open and in view, sent once as the visitor leaves.
// The collector cleans both before they're kept; Analytics turns them into "which
// buttons get pressed" and the middle time a page stays open. No cookies, no storage.
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY' })) Deno.env.set(k, v);
const P = '../../supabase/functions/presence';
const { trackerScript, cleanLabel, cleanMs, isVisitKind, engagementOf } = await import(`${P}/lib/visits.ts`);
const { handleCollect } = await import(`${P}/routes/collect.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const read = (p) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));

// ═══ 1. the counter on the page ═══
{
  const t = trackerScript('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'https://x.supabase.co/functions/v1/presence');
  ok('kinds: a button press and a page\'s time are kinds the collector takes', isVisitKind('button') && isVisitKind('leave') && !isVisitKind('click'));
  ok('tracker: a link drawn as a button (.btn) is a button press, unless it calls, emails or downloads', t.includes("a.hasAttribute('data-cta')?'cta':b?'button'") && t.indexOf("?'phone'") < t.indexOf("b?'button'") && t.indexOf("?'email'") < t.indexOf("b?'button'"));
  ok('tracker: the words go only with a button, a call or an email, never a plain link', t.includes("var l=b||k==='cta'||k==='phone'||k==='email'?") && t.includes("s({k:k,p:location.pathname,l:l})"));
  ok('tracker: a page\'s time is only the time it was in view, sent once, capped at half an hour', t.includes("document.visibilityState==='visible'?Date.now():0") && t.includes('if(!gone&&seen>=1000){gone=1;') && t.includes('Math.min(seen,1800000)') && t.includes("addEventListener('pagehide',leave)"));
  ok('tracker: still no cookie and no storage', !/document\.cookie|localStorage|sessionStorage/.test(t));
}

// ═══ 2. what the collector keeps ═══
{
  ok('label: one line of text, no markup', cleanLabel('  Book\n a   table  ') === 'Book a table' && cleanLabel('Book <b>now</b>') === 'Book b now /b', cleanLabel('Book <b>now</b>'));
  ok('label: long words are cut', cleanLabel('x'.repeat(90)).length === 60 && cleanLabel(null) === '');
  ok('time: under a second is nothing; past half an hour is half an hour', cleanMs(999) === null && cleanMs('4500') === 4500 && cleanMs(9_999_999) === 1_800_000 && cleanMs('soon') === null);

  let writes, answer;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/rest/v1/rpc/rate_hit' || u.pathname.includes('rate')) return new Response(JSON.stringify(true), { status: 200 });
    if (u.pathname === '/rest/v1/presence_visits') { const b = JSON.parse(init.body); writes.push(b); return new Response(null, { status: answer(b) }); }
    return new Response('[]', { status: 200 });
  };
  const SITE = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  const hit = async (body, statusFor = () => 201) => {
    writes = []; answer = statusFor;
    await handleCollect(new Request(`http://stub.local/functions/v1/presence/px/${SITE}`, { method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', origin: 'https://site.example' } }), SITE, {});
    return writes;
  };
  let w = await hit({ k: 'button', p: '/menu/', l: '  See the menu\n ' });
  ok('collect: a button press keeps its cleaned words', w.length === 1 && w[0].kind === 'button' && w[0].label === 'See the menu' && w[0].ms === undefined);
  w = await hit({ k: 'leave', p: '/menu/', ms: 42_000 });
  ok('collect: a page\'s time is kept in milliseconds, with no words', w.length === 1 && w[0].kind === 'leave' && w[0].ms === 42_000 && w[0].label === undefined);
  w = await hit({ k: 'leave', p: '/menu/' });
  ok('collect: a page\'s time without a time is dropped', w.length === 0);
  w = await hit({ k: 'pageview', p: '/', l: 'sneaky' });
  ok('collect: a page view never carries words', w.length === 1 && w[0].label === undefined);
  w = await hit({ k: 'phone', p: '/', l: 'Call us' }, (b) => (b.label ? 400 : 201));
  ok('collect: before migration 0156, a call is still kept, without its words', w.length === 2 && w[0].label === 'Call us' && w[1].label === undefined && w[1].kind === 'phone');
  w = await hit({ k: 'button', p: '/', l: 'Book' }, (b) => (b.label ? 400 : 201));
  ok('collect: before migration 0156, a button press waits for it (no second try)', w.length === 1);
}

// ═══ 3. what Analytics says ═══
{
  const r = (kind, path, label, ms, v) => ({ kind, path, label, ms, visitor_hash: v });
  const e = engagementOf([
    r('button', '/', 'Book a table', null, 'a'), r('button', '/', 'Book a table', null, 'a'), r('button', '/', 'book a table', null, 'b'),
    r('phone', '/contact/', 'Call us', null, 'c'), r('button', '/menu/', 'See the menu', null, 'd'),
    r('cta', '/', '', null, 'e'),   // no words: not a named button
    r('leave', '/', null, 30_000, 'a'), r('leave', '/', null, 90_000, 'b'), r('leave', '/', null, 60_000, 'c'),
    r('leave', '/menu/', null, 10_000, 'd'), r('leave', '/menu/', null, 500, 'e'),   // under a second: not counted
  ]);
  ok('buttons: the same words on the same page are one button, whatever the case, most pressed first', e.buttons[0].label === 'Book a table' && e.buttons[0].presses === 3 && e.buttons[0].people === 2 && e.buttons[0].path === '/');
  ok('buttons: calls and other pages are their own rows; a press with no words is left out', e.buttons.length === 3 && e.buttons.some((b) => b.kind === 'phone' && b.label === 'Call us') && !e.buttons.some((b) => !b.label));
  ok('time: the middle visit per page, in seconds, the busiest page first', JSON.stringify(e.time.pages) === JSON.stringify([{ path: '/', seconds: 60, visits: 3 }, { path: '/menu/', seconds: 10, visits: 1 }]), JSON.stringify(e.time.pages));
  ok('time: and the middle visit for the whole site', e.time.median_seconds === 45);
  ok('time: no visits, no number (never a zero)', engagementOf([]).time.median_seconds === null && engagementOf([]).buttons.length === 0);
  const an = read('supabase/functions/presence/routes/analytics.ts');
  ok('reads: the visits reads (Analytics, the client portal, the monthly report) leave these rows out, so they never crowd visits past the cap', (an.match(/kind=not\.in\.\(button,leave\)/g) || []).length === 2 && /kind=not\.in\.\(button,leave\)/.test(read('supabase/functions/presence/routes/client_delivery.ts')) && /presence_visits\?[^`]*kind=not\.in\.\(button,leave\)/.test(read('supabase/functions/presence/ops/monthly_report.ts')));
  ok('reads: the buttons and times have a read of their own, this period only', /kind=in\.\(button,cta,phone,email,leave\)&select=ts,kind,path,label,ms,visitor_hash/.test(an) && /\.\.\.engagementFrom\(engageR, startMs\)/.test(an));
}

// ═══ 4. the privacy page and the migration ═══
{
  ok('privacy: the counter\'s description names buttons and time on a page', read('supabase/functions/presence/lib/legal_pages.ts').includes('a button, a download or a link to another website, it notes which kind of link it was and, for a button, a phone number or an email address, the words on it. When you leave a page, it notes how long the page was open'));   // item 151 adds how quickly it showed
  for (const [name, src] of [['migration 0156', read('supabase/migrations/0156_button_presses_time_on_page.sql')], ['apply pack 0156', read('docs/presence/APPLY-0156-prod.sql')]]) {
    ok(`${name}: adds the words and the time, and the two kinds`, /add column if not exists label text not null default '';/.test(src) && /add column if not exists ms integer;/.test(src) && /check \(kind in \('pageview','phone','email','cta','download','outbound','button','leave'\)\)/.test(src));
  }
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ ENGAGEMENT (item 157): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
