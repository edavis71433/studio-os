// ── The studio's Sites and Domains pages, Pin and Duplicate (builder list items 43, 45, 52) ─
// agency/sites.ts builds both pages from batched reads and keeps one new fact, each
// member's pins, in a reserved row. This suite pins:
//   · the pure builders: plan and renewal words, the website's state (Home's rule plus
//     offline, not answering, paused), who can edit, last opened, pins, the order of the
//     cards, each domain's status (the same 30-day line as Needs you) and the built-in
//     addresses, and the thumbnail trim (no scripts, frames or srcsets; one photo size);
//   · the routes, driven through the real handleAgency() against an in-memory
//     PostgREST (no Supabase, no credentials, nothing leaves): what GET /agency/sites
//     and /agency/domains answer, a real thumbnail drawn from a template's sample site,
//     pins kept per member, and Duplicate writing only to the NEW site.
//   deno run --allow-read --allow-env tests/presence/studio_sites_test.mjs
import {
  planOf, siteState, teamOf, lastOpenedBySite, normalizePins, setPinned, buildSites, domainStatus, buildDomains,
  thumbVariant, trimForThumb, signThumb, PLAN_WORDS, MAX_PINS,
} from '../../supabase/functions/presence/agency/sites.ts';
import { handleAgency } from '../../supabase/functions/presence/agency/routes.ts';
import { RESERVED_NAMES } from '../../supabase/functions/presence/lib/reserved_store.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const NOW = '2026-11-08T12:00:00.000Z';
const inDays = (n) => new Date(Date.parse(NOW) + n * 86400000).toISOString();

// ═══ 1. plans, in plain words ═══
{
  ok('plan: no entitlement reads "No plan on file"', planOf(null, NOW).words === 'No plan on file' && planOf(null, NOW).renews.kind === 'none');
  ok('plan: a watch plan is "Watch", with no renewal when nothing is billed here', planOf({ client_id: 'c', plan: 'presence_monitor', status: 'active' }, NOW).words === 'Watch' && planOf({ client_id: 'c', plan: 'presence_monitor' }, NOW).renews.kind === 'none');
  ok('plan: a trial says when it ends', JSON.stringify(planOf({ client_id: 'c', plan: 'presence', trial_ends_at: inDays(5), current_period_end: inDays(40) }, NOW).renews) === JSON.stringify({ kind: 'trial', at: inDays(5) }));
  ok('plan: a finished trial falls back to the renewal', planOf({ client_id: 'c', plan: 'presence', trial_ends_at: inDays(-5), current_period_end: inDays(40) }, NOW).renews.kind === 'renews');
  ok('plan: a cancelled plan says when it ends, not that it renews', planOf({ client_id: 'c', plan: 'presence_managed', current_period_end: inDays(9), cancel_at_period_end: true }, NOW).renews.kind === 'ends');
  ok('plan: the term rides along; a key we have no words for is still readable', planOf({ client_id: 'c', plan: 'presence', term: 'annual' }, NOW).term === 'annual' && planOf({ client_id: 'c', plan: 'some_new_plan' }, NOW).words === 'Some new plan');
  ok('plan: every catalog rung has words (no CMS or OS jargon)', ['presence_monitor', 'cms_only', 'business_os_only', 'presence', 'presence_managed', 'agency', 'enterprise'].every((k) => PLAN_WORDS[k] && !/CMS|OS\b|Presence/.test(PLAN_WORDS[k])));
}

// ═══ 2. the website's own state ═══
{
  const live = { edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z' };
  ok('state: a watch plan is hosted elsewhere, whatever else', siteState({ ...live, edition: 'monitor' }).key === 'elsewhere');
  ok('state: never published is "Not live yet" (Home\'s rule)', siteState({ edition: 'presence', status: 'ready', last_published_at: null }).words === 'Not live yet');
  ok('state: published once counts as live even before status flips (Home\'s rule)', siteState({ edition: 'presence', status: 'ready', last_published_at: '2026-10-01T00:00:00Z' }).key === 'live');
  ok('state: taken offline says so', siteState(live, { id: 's', offline_at: '2026-11-01T00:00:00Z' }).words === 'Offline');
  ok('state: one missed probe is a blip, two is "Not answering"', siteState(live, { id: 's', uptime_fail_streak: 1 }).key === 'live' && siteState(live, { id: 's', uptime_fail_streak: 2 }).words === 'Not answering');
  ok('state: a paused site says paused', siteState({ ...live, status: 'paused' }).key === 'paused');
}

// ═══ 3. who can edit ═══
{
  const studio = [{ email: 'Eric@Studio.example', role: 'owner' }, { email: 'am@studio.example', role: 'account_manager' }, { email: 'des@studio.example', role: 'designer' }, { email: 'ro@studio.example', role: 'readonly' }];
  const seats = [
    { site_id: 's', email: 'staff@client.example', role: 'business_staff', status: 'active' },
    { site_id: 's', email: 'rev@client.example', role: 'client_reviewer', status: 'active' },
    { site_id: 's', email: 'dev@client.example', role: 'developer', status: 'invited' },
    { site_id: 's', email: 'gone@client.example', role: 'business_staff', status: 'revoked' },
    { site_id: 's', email: 'owner@client.example', role: 'business_owner', status: 'active' },
  ];
  const owner = { id: 'c', name: 'Pat Owner', email: 'owner@client.example' };
  const t = teamOf({ studio, seats, owner, portalClient: false, me: 'eric@studio.example' });
  ok('team: only the studio roles that may open a client (owner, admin, account manager)', t.filter((m) => m.side === 'studio').map((m) => m.email).join(',') === 'eric@studio.example,am@studio.example');
  ok('team: "me" is found case-insensitively', t.find((m) => m.email === 'eric@studio.example').me === true && t.filter((m) => m.me).length === 1);
  ok('team: their side lists the owner and the seats that can edit; a reviewer only reviews; a revoked seat is gone', t.filter((m) => m.side === 'client').map((m) => m.email).join(',') === 'owner@client.example,staff@client.example,dev@client.example');
  ok('team: one entry per person (the owner\'s seat does not list them twice), invited is marked', t.filter((m) => m.email === 'owner@client.example').length === 1 && t.find((m) => m.email === 'dev@client.example').invited === true);
  const portal = teamOf({ studio, seats: [], owner, portalClient: true, me: '' });
  ok('team: a client the studio serves through the portal reviews and approves — not listed as an editor', !portal.some((m) => m.side === 'client'));
}

// ═══ 4. last opened, and pins ═══
{
  const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const M1 = '11111111-1111-4111-8111-111111111111', M2 = '22222222-2222-4222-8222-222222222222';
  const opened = lastOpenedBySite([{ client_site_id: A, created_at: '2026-11-07T10:00:00Z' }, { client_site_id: B, created_at: '2026-11-06T10:00:00Z' }, { client_site_id: A, created_at: '2026-11-01T10:00:00Z' }, { client_site_id: null, created_at: 'x' }]);
  ok('opened: the newest visit per site wins', opened[A] === '2026-11-07T10:00:00Z' && opened[B] === '2026-11-06T10:00:00Z' && Object.keys(opened).length === 2);
  let pins = setPinned(null, M1, A, true);
  pins = setPinned(pins, M1, B, true);
  pins = setPinned(pins, M2, C, true);
  ok('pins: a new pin goes to the front of that member\'s list', pins[M1].join(',') === [B, A].join(','));
  ok('pins: one member\'s pins never touch another\'s', pins[M2].join(',') === C && setPinned(pins, M1, A, false)[M2].join(',') === C);
  ok('pins: unpinning removes it, and an empty list leaves no key', setPinned(setPinned(pins, M1, A, false), M1, B, false)[M1] === undefined);
  ok('pins: pinning twice keeps one copy', setPinned(pins, M1, A, true)[M1].join(',') === [A, B].join(','));
  ok('pins: what isn\'t a uuid is dropped, lists are capped', JSON.stringify(normalizePins({ [M1]: [A, 'nope', A], bogus: [B], [M2]: 'x' })) === JSON.stringify({ [M1]: [A] }) && normalizePins({ [M1]: Array.from({ length: 80 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) })[M1].length === MAX_PINS);
}

// ═══ 5. the cards: what each carries, and their order ═══
{
  const row = (over) => ({ site_id: '', name: '', edition: 'presence', status: 'ready', archived: false, tags: [], domain: null, domain_registrar: null, domain_expires_at: null, last_published_at: '2026-10-01T00:00:00Z', last_change_at: null, unpublished_changes: false, billing_issue: false, ...over });
  const portfolio = [
    row({ site_id: 's-zed', name: 'Zed Bakery' }),
    row({ site_id: 's-amy', name: 'Amy Dental', domain: 'amydental.example' }),
    row({ site_id: 's-bob', name: 'Bob Garage', edition: 'monitor', domain: 'bobgarage.example', last_published_at: null }),
    row({ site_id: 's-cal', name: 'Cal Cafe', last_published_at: null, last_change_at: '2026-11-02T00:00:00Z' }),
  ];
  const rows = buildSites({
    portfolio,
    extras: [{ id: 's-zed', client_id: 'c-zed', netlify_site_id: 'nf-1' }, { id: 's-amy', client_id: 'c-amy', netlify_site_id: 'nf-2' }, { id: 's-cal', client_id: 'c-cal', created_at: '2026-09-01T00:00:00Z' }],
    plans: [{ client_id: 'c-amy', plan: 'presence', current_period_end: inDays(20) }],
    seats: [], owners: [], portalSites: [], studio: [{ email: 'me@studio.example', role: 'owner' }], me: 'me@studio.example',
    opened: { 's-amy': '2026-11-01T00:00:00Z', 's-bob': '2026-11-05T00:00:00Z' },
    pins: ['s-zed'], nowIso: NOW,
  });
  ok('order: pinned first, then last opened, then by name', rows.map((r) => r.site_id).join(',') === 's-zed,s-bob,s-amy,s-cal');
  const by = Object.fromEntries(rows.map((r) => [r.site_id, r]));
  ok('card: the address is their domain, else the built-in one, else nothing yet', by['s-amy'].address === 'https://amydental.example' && /^https:\/\/presence-[0-9a-z]+\.netlify\.app$/.test(by['s-zed'].address) && by['s-cal'].address === '');
  ok('card: a watch plan\'s address is the site they host themselves', by['s-bob'].address === 'https://bobgarage.example');
  ok('card: the thumbnail is the live page, the draft before the first publish, none for a site we only watch', by['s-zed'].thumb === 'live' && by['s-cal'].thumb === 'draft' && by['s-bob'].thumb === null);
  ok('card: the plan joins through the site\'s client', by['s-amy'].plan.words === 'Website + tools' && by['s-amy'].plan.renews.kind === 'renews' && by['s-zed'].plan.words === 'No plan on file');
  ok('card: last updated is the last change, else the last publish, else when the site began', by['s-cal'].updated_at === '2026-11-02T00:00:00Z' && by['s-amy'].updated_at === '2026-10-01T00:00:00Z');
  ok('card: pinned and opened ride along for the page', by['s-zed'].pinned === true && by['s-amy'].pinned === false && by['s-bob'].opened_at === '2026-11-05T00:00:00Z');
}

// ═══ 6. the domains ═══
{
  const base = { site_id: 's', name: 'X', edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z', custom_domain: 'x.example', uptime_ok: true };
  ok('domain: expired says how long ago', domainStatus({ ...base, domain_expires_at: inDays(-3) }, NOW).words === 'Expired 3 days ago' && domainStatus({ ...base, domain_expires_at: inDays(-3) }, NOW).tone === 'bad');
  ok('domain: within 30 days is expiring — the line Needs you uses', domainStatus({ ...base, domain_expires_at: inDays(30) }, NOW).key === 'expiring' && domainStatus({ ...base, domain_expires_at: inDays(31) }, NOW).key === 'connected');
  ok('domain: "Expires today" and "in 1 day" read right', domainStatus({ ...base, domain_expires_at: NOW }, NOW).words === 'Expires today' && domainStatus({ ...base, domain_expires_at: inDays(1) }, NOW).words === 'Expires in 1 day');
  ok('domain: a watch plan\'s domain is on their own host', domainStatus({ ...base, edition: 'monitor' }, NOW).key === 'elsewhere');
  ok('domain: a site not live yet, offline, or not answering says so', domainStatus({ ...base, status: 'ready', last_published_at: null }, NOW).key === 'not_live' && domainStatus({ ...base, offline_at: NOW }, NOW).key === 'offline' && domainStatus({ ...base, uptime_fail_streak: 2 }, NOW).words === 'Not answering');
  ok('domain: answering the probe is "Connected"; never probed is "Not checked yet"', domainStatus(base, NOW).words === 'Connected' && domainStatus({ ...base, uptime_ok: null }, NOW).words === 'Not checked yet');
  const d = buildDomains([
    { ...base, site_id: 'a', name: 'Fine', custom_domain: 'fine.example', domain_expires_at: inDays(300), domain_registrar: 'Registrar A' },
    { ...base, site_id: 'b', name: 'Soon', custom_domain: 'soon.example', domain_expires_at: inDays(12) },
    { ...base, site_id: 'c', name: 'Gone', custom_domain: 'gone.example', domain_expires_at: inDays(-1) },
    { ...base, site_id: 'd', name: 'Sooner', custom_domain: 'sooner.example', domain_expires_at: inDays(4) },
    { ...base, site_id: 'e', name: 'Built in', custom_domain: null, netlify_site_id: 'nf' },
    { ...base, site_id: 'f', name: 'Never hosted', custom_domain: null, netlify_site_id: null },
    { ...base, site_id: 'g', name: 'Watched', edition: 'monitor', custom_domain: null, netlify_site_id: 'nf' },
  ], NOW);
  ok('domains: the most urgent first — expired, then expiring soonest', d.domains.map((x) => x.domain).join(',') === 'gone.example,sooner.example,soon.example,fine.example');
  ok('domains: each carries its provider and expiry', d.domains.find((x) => x.domain === 'fine.example').provider === 'Registrar A' && d.domains.find((x) => x.domain === 'soon.example').days_left === 12);
  ok('domains: built-in addresses are the hosted sites with no domain yet (not a watch plan, not a site with no hosting)', d.builtin.length === 1 && d.builtin[0].site_id === 'e' && /\.netlify\.app$/.test(d.builtin[0].address));
}

// ═══ 7. the thumbnail trim ═══
{
  const manifest = [
    { media_id: 'm1', storage_path: 'presence-media/s/m1.jpg', variants: [{ name: 'sm', width: 400, format: 'webp', output_path: '/img/hero-400.webp' }, { name: 'md', width: 800, format: 'webp', output_path: '/img/hero-800.webp' }, { name: 'lg', width: 1600, format: 'webp', output_path: '/img/hero-1600.webp' }, { name: 'md', width: 800, format: 'avif', output_path: '/img/hero-800.avif' }] },
    { media_id: 'm2', storage_path: 'presence-media/s/m2.jpg', variants: [{ name: 'md', width: 800, format: 'webp', output_path: '/img/unused-800.webp' }] },
    { media_id: 'm3', storage_path: 'presence-media/s/menu.pdf', variants: [{ name: 'original', width: 0, format: 'original', output_path: '/files/menu.pdf' }] },
  ];
  ok('thumb: the photo size is the WebP nearest 800px', thumbVariant(manifest[0]).output_path === '/img/hero-800.webp' && thumbVariant(manifest[2]) === null);
  const html = `<html><head><link rel="preload" href="/x.woff2"><link rel="icon" href="/favicon.svg"><link rel="canonical" href="https://preview.invalid/"><script type="application/ld+json">{}</script></head><body>
    <picture><source type="image/avif" srcset="/img/hero-800.avif 800w"><img src="/img/hero-1600.webp" srcset="/img/hero-400.webp 400w, /img/hero-1600.webp 1600w" sizes="100vw"></picture>
    <iframe src="https://maps.example/embed"></iframe><video autoplay muted src="/v.mp4"></video><noscript><img src="/px.gif"></noscript>
    <a href="https://preview.invalid/menu/">Menu</a><script>alert(1)</script></body></html>`;
  const t = trimForThumb(html, manifest);
  ok('thumb: no scripts, frames, noscript, preloads, icons or srcsets survive', !/<script|<iframe|<noscript|rel="preload"|rel="icon"|srcset=|sizes=|<source/i.test(t.html));
  ok('thumb: video never downloads or plays', /<video preload="none"/.test(t.html) && !/autoplay/.test(t.html));
  ok('thumb: every size of a shown photo points at the one chosen size', /src="\/img\/hero-800\.webp"/.test(t.html) && !/hero-1600/.test(t.html));
  ok('thumb: only photos the page shows are signed, one size each', t.sign.length === 1 && t.sign[0].variants.length === 1 && t.sign[0].variants[0].output_path === '/img/hero-800.webp');
  ok('thumb: the still-picture style goes in the head; preview links lose the fake host', /<style>html,body\{overflow:hidden!important/.test(t.html) && !t.html.includes('https://preview.invalid'));
  const signed = signThumb(t.html, t.pathOf, { '/img/hero-800.webp': 'https://stub.supabase.co/storage/v1/object/sign/x?token=1' });
  ok('thumb: the chosen size gets its signed address', signed.includes('src="https://stub.supabase.co/storage/v1/object/sign/x?token=1"'));
  ok('thumb: a photo that couldn\'t be signed becomes a blank pixel, never a broken box', /src="data:image\/gif;base64,/.test(signThumb(t.html, t.pathOf, {})));
}

// ═══ 8. the routes, through the real handleAgency() ═══
const AG = 'aaaaaaaa-0000-4000-8000-000000000001';
const ME = '11111111-1111-4111-8111-111111111111', PAT = '22222222-2222-4222-8222-222222222222', RO = '33333333-3333-4333-8333-333333333333';
const UID = '99999999-0000-4000-8000-000000000009';
const S1 = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', S2 = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', S3 = 'c3c3c3c3-c3c3-4c3c-8c3c-c3c3c3c3c3c3', NEW = 'd4d4d4d4-d4d4-4d4d-8d4d-d4d4d4d4d4d4';
const OWN = 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5', ARCH = 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6', STRANGER = '0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a';
const C1 = 'c1000000-0000-4000-8000-000000000001', C2 = 'c2000000-0000-4000-8000-000000000002', C3 = 'c3000000-0000-4000-8000-000000000003', CN = 'c4000000-0000-4000-8000-000000000004', CO = 'c5000000-0000-4000-8000-000000000005';
const SNAP = '5a5a5a5a-5a5a-4a5a-8a5a-5a5a5a5a5a5a';
const fixture = JSON.parse(await Deno.readTextFile(new URL('../../supabase/functions/presence/templates/business-classic/1.0.0/fixture.json', import.meta.url)));
let T, writes;
// the routes read the real clock, so their fixtures are dated from it
const LIVE = Date.now();
const liveDays = (n) => new Date(LIVE + n * 86400000).toISOString();
function reset() {
  T = {
    presence_agency_members: [
      { id: ME, agency_id: AG, email: 'eric@studio.example', role: 'owner', status: 'active', user_id: UID },
      { id: PAT, agency_id: AG, email: 'pat@studio.example', role: 'account_manager', status: 'active' },
      { id: RO, agency_id: AG, email: 'ro@studio.example', role: 'readonly', status: 'active' },
    ],
    presence_agency_clients: [
      { site_id: S1, agency_id: AG, status: 'active', tags: ['bistro'], owner_email: '', assigned: [], notes: '', onboarded_at: NOW },
      { site_id: S2, agency_id: AG, status: 'active', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: NOW },
      { site_id: S3, agency_id: AG, status: 'active', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: NOW },
      { site_id: NEW, agency_id: AG, status: 'active', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: NOW },
      { site_id: ARCH, agency_id: AG, status: 'archived', tags: [], owner_email: '', assigned: [], notes: '', onboarded_at: NOW },
    ],
    presence_sites: [
      { id: S1, client_id: C1, edition: 'presence', status: 'live', last_published_at: '2026-10-20T00:00:00Z', custom_domain: 'bistro.example', domain_registrar: 'Registrar A', domain_expires_at: liveDays(10), domain_checked_at: NOW, netlify_site_id: 'nf-1', template_slug: 'business-classic', template_version: '1.0.0', uptime_ok: true, uptime_fail_streak: 0, offline_at: null, created_at: '2026-01-01T00:00:00Z' },
      { id: S2, client_id: C2, edition: 'monitor', status: 'ready', last_published_at: null, custom_domain: 'garage.example', domain_registrar: '', domain_expires_at: null, netlify_site_id: null, template_slug: 'business-classic', template_version: '1.0.0', created_at: '2026-02-01T00:00:00Z' },
      { id: S3, client_id: C3, edition: 'presence', status: 'ready', last_published_at: null, custom_domain: null, netlify_site_id: 'nf-3', template_slug: 'atelier', template_version: '1.0.0', created_at: '2026-03-01T00:00:00Z' },
      { id: NEW, client_id: CN, edition: 'presence', status: 'ready', last_published_at: null, custom_domain: null, netlify_site_id: null, template_slug: 'atelier', template_version: '1.0.0', created_at: NOW },
      { id: ARCH, client_id: 'c-arch', edition: 'presence', status: 'live', last_published_at: '2026-01-01T00:00:00Z', custom_domain: 'old.example', netlify_site_id: 'nf-x', template_slug: 'business-classic', template_version: '1.0.0' },
      { id: OWN, client_id: CO, edition: 'presence', status: 'live', last_published_at: '2026-09-01T00:00:00Z', custom_domain: 'mystudio.example', domain_registrar: 'Registrar B', domain_expires_at: liveDays(200), netlify_site_id: 'nf-own', template_slug: 'business-classic', template_version: '1.0.0', uptime_ok: true },
      { id: STRANGER, client_id: 'c-x', edition: 'presence', status: 'live', last_published_at: '2026-01-01T00:00:00Z', custom_domain: 'not-yours.example', template_slug: 'business-classic', template_version: '1.0.0' },
    ],
    clients: [{ id: C1, name: 'Bistro Nine', email: 'owner@bistro.example' }, { id: C2, name: 'Garage Ten', email: 'owner@garage.example' }, { id: C3, name: 'Cafe Eleven', email: 'owner@cafe.example' }, { id: CN, name: 'New Place', email: 'new@place.example' }],
    presence_entitlements: [{ client_id: C1, product: 'presence', plan: 'presence', status: 'active', term: 'monthly', current_period_end: liveDays(25), trial_ends_at: null, cancel_at_period_end: false }, { client_id: C2, product: 'presence', plan: 'presence_monitor', status: 'active' }],
    presence_site_members: [{ site_id: S1, email: 'staff@bistro.example', role: 'business_staff', status: 'active' }, { site_id: S1, email: 'rev@bistro.example', role: 'client_reviewer', status: 'active' }],
    presence_service_links: [{ agency_site_id: OWN, customer_site_id: S2, customer_client_id: C2, status: 'active' }],
    presence_scoped_access_events: [
      { operator_user_id: UID, client_site_id: S3, outcome: 'allowed', route: '/portal/context', created_at: '2026-11-08T09:00:00Z' },
      { operator_user_id: UID, client_site_id: S1, outcome: 'allowed', route: '/portal/context', created_at: '2026-11-07T09:00:00Z' },
      { operator_user_id: UID, client_site_id: S1, outcome: 'allowed', route: '/preview', created_at: '2026-11-08T10:00:00Z' },   // one of a page's many requests, not a page load
      { operator_user_id: UID, client_site_id: S2, outcome: 'denied', route: '/portal/context', created_at: '2026-11-08T11:00:00Z' },
      { operator_user_id: 'someone-else', client_site_id: S2, outcome: 'allowed', route: '/portal/context', created_at: '2026-11-08T11:30:00Z' },
    ],
    presence_sales_templates: [],
    presence_publishes: [{ id: 'p1', site_id: S1, status: 'live', snapshot_id: SNAP, created_at: '2026-10-20T00:00:00Z' }],
    presence_snapshots: [{ id: SNAP, site_id: S1, content: fixture.content, content_contract_version: fixture.content_contract_version, template_slug: fixture.template_slug, template_version: fixture.template_version, created_at: fixture.created_at, dev_customization: null,
      media_manifest: [{ media_id: 'm1', storage_path: 'presence-media/s1/leeks.jpg', variants: [400, 800, 1600].map((w) => ({ name: `w${w}`, width: w, format: 'webp', output_path: `/img/leeks-${w}.webp` })) }] }],
    presence_offerings: [
      { site_id: S1, name: 'Tasting menu', category: 'Dinner', description: 'Seven courses', price_text: '$90', sort_order: 0, deleted_at: null, is_visible: true },
      { site_id: S1, name: 'Hidden one', category: 'Dinner', description: '', price_text: '', sort_order: 1, deleted_at: null, is_visible: false },
    ],
    presence_faqs: [{ site_id: S1, question: 'Do you take bookings?', answer: 'Yes, online.', sort_order: 0, deleted_at: null, is_visible: true }],
    presence_voice: [{ site_id: S1, tone_notes: 'Warm and brief', preferred_vocabulary: '', never_claim: '' }],
    presence_settings: [{ site_id: S1, industry_key: 'restaurant', category_order: ['Dinner'] }],
    presence_dev_customizations: [{ site_id: S1, theme_tokens: { accent: '#7a2e2e' } }],
  };
  writes = [];
}
function match(r, k, v) {
  if (v.startsWith('eq.')) return String(r[k]) === decodeURIComponent(v.slice(3));
  if (v.startsWith('neq.')) return String(r[k]) !== decodeURIComponent(v.slice(4));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
  if (v === 'is.null') return r[k] === null || r[k] === undefined;
  if (v === 'not.is.null') return r[k] !== null && r[k] !== undefined;
  if (v === 'is.true') return r[k] === true;
  if (v === 'is.false') return r[k] === false;
  return true;
}
const CTRL = ['select', 'limit', 'order', 'on_conflict'];
// or=(user_id.eq.X,email.eq.Y): any one alternative matches (lib/scope.ts's member lookup uses it)
const anyOf = (r, v) => v.slice(1, -1).split(',').some((alt) => { const [col, ...rest] = alt.split('.'); return match(r, col, rest.join('.')); });
function rowsFor(table, params) {
  let rows = (T[table] || []).filter((r) => [...params.entries()].every(([k, v]) => CTRL.includes(k) || (k === 'or' ? anyOf(r, v) : match(r, k, v))));
  const order = params.get('order');
  if (order) { const [col, dir] = order.split('.'); rows = rows.slice().sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)); }
  const lim = Number(params.get('limit')); if (lim) rows = rows.slice(0, lim);
  return rows;
}
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const method = (init.method || 'GET').toUpperCase();
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.pathname.includes('/storage/v1/object/sign/')) { writes.push({ table: 'storage:sign', method, path: u.pathname }); return reply({ signedURL: u.pathname.replace('/storage/v1', '') + '?token=t' }); }
  const table = u.pathname.replace(/^.*\/rest\/v1\//, '');
  const auth = String((init.headers || {}).Authorization || '');
  // asUser (lib/site.ts resolveSite): the studio's sign-in owns OWN; any other caller owns nothing
  if (method === 'GET' && table === 'presence_sites' && /jwt-studio/.test(auth)) return reply(T.presence_sites.filter((s) => s.id === OWN));
  if (method === 'GET' && /jwt-/.test(auth)) return reply([]);
  if (method === 'GET') return reply(rowsFor(table, u.searchParams));
  const body = init.body ? JSON.parse(init.body) : null;
  writes.push({ table, method, body, query: u.search });
  if (method === 'POST' && table === 'presence_sales_templates') { const row = { id: 'rt-' + (T.presence_sales_templates.length + 1), updated_at: NOW, deleted_at: null, ...body }; T.presence_sales_templates.push(row); return reply([row], 201); }
  if (method === 'PATCH') { const hit = rowsFor(table, u.searchParams); hit.forEach((r) => Object.assign(r, body)); return reply(hit); }
  if (method === 'POST') { const rows = (Array.isArray(body) ? body : [body]).map((r, n) => ({ id: `${table}-${(T[table] || []).length + n + 1}`, ...r })); (T[table] = T[table] || []).push(...rows); return reply(rows, 201); }
  return reply([]);
};
const asMember = (over = {}) => ({ agency_id: AG, member_id: ME, email: 'eric@studio.example', role: 'owner', agency_name: 'Bright Studio', seat_limit: 5, client_limit: 25, plan: 'agency', branding: {}, ...over });
const PRINCIPAL = { kind: 'client', userId: UID, email: 'eric@studio.example' };
async function call(member, method, route, body, { jwt = 'jwt-studio', principal = PRINCIPAL } = {}) {
  const req = new Request('http://stub.local/functions/v1/presence' + route, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json', 'x-dds-user-jwt': jwt } });
  const res = await handleAgency(req, route.split('?')[0], method, member, principal, {});
  return { status: res.status, body: await res.json() };
}

// ── GET /agency/sites ──
{
  reset();
  const r = await call(asMember(), 'GET', '/agency/sites');
  const rows = r.body.data || [];
  const by = Object.fromEntries(rows.map((x) => [x.site_id, x]));
  ok('sites: 200 with every ACTIVE client site (archived stays on Home\'s Archived view)', r.status === 200 && rows.length === 4 && !by[ARCH] && !by[STRANGER] && !by[OWN]);
  ok('sites: last opened first, from this member\'s own page loads inside a client (a denied visit, someone else\'s, or a page\'s other requests don\'t count)', rows[0].site_id === S3 && rows[1].site_id === S1 && by[S1].opened_at === '2026-11-07T09:00:00Z' && by[S2].opened_at === null);
  ok('sites: plan and renewal come from the client\'s entitlement', by[S1].plan.words === 'Website + tools' && by[S1].plan.renews.kind === 'renews' && by[S2].plan.words === 'Watch');
  ok('sites: who can edit — the studio\'s owner and account manager (not readonly), and their editing seat', by[S1].team.map((m) => m.email).join(',') === 'eric@studio.example,pat@studio.example,owner@bistro.example,staff@bistro.example');
  ok('sites: a client served through the portal isn\'t listed as an editor', !by[S2].team.some((m) => m.side === 'client'));
  ok('sites: states and thumbnails — live, hosted elsewhere, not live yet', by[S1].state === 'live' && by[S1].thumb === 'live' && by[S2].state === 'elsewhere' && by[S2].thumb === null && by[S3].thumb === 'draft');
  ok('sites: the domain line carries the expiry the daily check found', by[S1].domain === 'bistro.example' && by[S1].domain_expires_at === liveDays(10));
  ok('sites: can_pin (a studio site to keep pins on) and can_duplicate (owner) ride along; nothing partial', r.body.can_pin === true && r.body.can_duplicate === true && r.body.partial === false);
  const ro = await call(asMember({ member_id: RO, role: 'readonly', email: 'ro@studio.example' }), 'GET', '/agency/sites');
  ok('sites: a view-only member reads the page but isn\'t offered Duplicate, nor a door into a client', ro.status === 200 && ro.body.can_duplicate === false && ro.body.can_open === false && r.body.can_open === true);
  const roS1 = ro.body.data.find((x) => x.site_id === S1);
  ok('sites: …and, unable to open a client, doesn\'t get the client\'s own people by name (the studio\'s team stays named)', roS1.team.filter((m) => m.side === 'client').every((m) => m.who === 'Someone on their side' && m.email === '') && roS1.team.filter((m) => m.side === 'client').length === 2 && roS1.team.some((m) => m.email === 'eric@studio.example'));
  const noOwn = await call(asMember(), 'GET', '/agency/sites', null, { jwt: 'jwt-nobody' });
  ok('sites: with no studio site to keep pins on, Pin isn\'t offered', noOwn.status === 200 && noOwn.body.can_pin === false && noOwn.body.data.length === 4);
  // builder item 53: who owns each site, said on the card, and the studio's role said once
  ok('owners: each card names its owner (the contact holds no name here, so the email)', by[S1].owner && by[S1].owner.email === 'owner@bistro.example' && by[S1].owner.name === 'owner@bistro.example');
  ok('owners: no transfer is waiting (before 0177 the read just finds none)', rows.every((x) => x.transfer === null));
  ok('owners: the studio is the Website manager; a view-only seat reads View only, and no owner by name', r.body.studio_role === 'Website manager' && r.body.can_people === true && ro.body.studio_role === 'View only' && ro.body.can_people === false && roS1.owner.name === 'The owner' && roS1.owner.email === '');
  ok('sites: reading the page writes nothing', writes.length === 0);
}

// ── PUT /agency/sites/:id/pin ──
{
  reset();
  const p1 = await call(asMember(), 'PUT', `/agency/sites/${S2}/pin`, { pinned: true });
  ok('pin: 200 and the member\'s pins come back', p1.status === 200 && p1.body.data.pinned === true && p1.body.data.pins.join(',') === S2);
  const row = T.presence_sales_templates.find((t) => t.name === RESERVED_NAMES.sitePins);
  ok('pin: kept in ONE reserved row on the studio\'s own site, keyed by member', !!row && row.site_id === OWN && row.kind === 'proposal' && JSON.parse(row.body)[ME][0] === S2);
  await call(asMember({ member_id: PAT, role: 'account_manager', email: 'pat@studio.example' }), 'PUT', `/agency/sites/${S1}/pin`, { pinned: true });
  const both = JSON.parse(T.presence_sales_templates.find((t) => t.name === RESERVED_NAMES.sitePins).body);
  ok('pin: a second member\'s pin sits beside the first, same row', T.presence_sales_templates.length === 1 && both[ME].join(',') === S2 && both[PAT].join(',') === S1);
  const list = await call(asMember(), 'GET', '/agency/sites');
  ok('pin: the pinned site comes first on the page, ahead of the last opened', list.body.data[0].site_id === S2 && list.body.data[0].pinned === true && list.body.data.filter((x) => x.pinned).length === 1);
  const off = await call(asMember(), 'PUT', `/agency/sites/${S2}/pin`, { pinned: false });
  ok('pin: unpinning answers an empty list and leaves the other member\'s pin', off.status === 200 && off.body.data.pins.length === 0 && JSON.parse(T.presence_sales_templates[0].body)[PAT].join(',') === S1);
  ok('pin: "pinned" must be true or false', (await call(asMember(), 'PUT', `/agency/sites/${S1}/pin`, { pinned: 'yes' })).status === 400);
  ok('pin: a site that isn\'t yours (or is archived) is not found', (await call(asMember(), 'PUT', `/agency/sites/${STRANGER}/pin`, { pinned: true })).status === 404 && (await call(asMember(), 'PUT', `/agency/sites/${ARCH}/pin`, { pinned: true })).status === 404);
  ok('pin: no studio site → an honest 409, nothing written', (await call(asMember(), 'PUT', `/agency/sites/${S1}/pin`, { pinned: true }, { jwt: 'jwt-nobody' })).status === 409);
  ok('pin: the reserved name stays out of the templates list (it is in RESERVED_NAMES)', Object.values(RESERVED_NAMES).includes('__site_pins__'));
}

// ── GET /agency/sites/:id/thumb ──
{
  reset();
  const t = await call(asMember(), 'GET', `/agency/sites/${S1}/thumb`);
  const html = t.body.data?.html || '';
  ok('thumb: a live site\'s home page comes back drawn from its live version', t.status === 200 && t.body.data.version === 'live' && /Vermilion/.test(html));
  ok('thumb: self-contained and inert — the stylesheet inlined, no scripts, no srcsets, no external links', /<style>/.test(html) && !/<script/i.test(html) && !/srcset=/.test(html) && !/<link[^>]+stylesheet/.test(html));
  ok('thumb: the photo is ONE signed size (800px), not all of them', /src="\/storage\/v1\/object\/sign\/presence-media\/s1\/leeks\.jpg\?token=t"/.test(html) && writes.filter((w) => w.table === 'storage:sign').length === 1);
  ok('thumb: a site we only watch has nothing of ours to draw', (await call(asMember(), 'GET', `/agency/sites/${S2}/thumb`)).body.error === 'hosted_elsewhere');
  ok('thumb: another studio\'s site is not found', (await call(asMember(), 'GET', `/agency/sites/${STRANGER}/thumb`)).status === 404);
  ok('thumb: drawing a picture writes nothing to the database', writes.every((w) => w.table === 'storage:sign'));
}

// ── POST /agency/sites/:id/duplicate ──
{
  reset();
  const asPat = asMember({ member_id: PAT, role: 'account_manager', email: 'pat@studio.example' });
  ok('duplicate: a view-only member is refused', (await call(asMember({ member_id: RO, role: 'readonly' }), 'POST', `/agency/sites/${S1}/duplicate`, { site_id: NEW })).status === 403);
  ok('duplicate: an already-live site is never overwritten', (await call(asPat, 'POST', `/agency/sites/${S3}/duplicate`, { site_id: S1 })).body.error === 'not_new');
  ok('duplicate: a site we only watch has no setup to copy', (await call(asPat, 'POST', `/agency/sites/${S2}/duplicate`, { site_id: NEW })).body.error === 'hosted_elsewhere');
  ok('duplicate: both sites must be yours', (await call(asPat, 'POST', `/agency/sites/${STRANGER}/duplicate`, { site_id: NEW })).status === 404 && (await call(asPat, 'POST', `/agency/sites/${S1}/duplicate`, { site_id: STRANGER })).status === 404);
  ok('duplicate: the refusals wrote nothing', writes.length === 0);
  const d = await call(asPat, 'POST', `/agency/sites/${S1}/duplicate`, { site_id: NEW });
  ok('duplicate: 200 with what was copied — the look, a service, an FAQ, the voice and colors', d.status === 200 && d.body.data.look && d.body.data.applied.offerings === 1 && d.body.data.applied.faqs === 1 && d.body.data.applied.voice === true && d.body.data.applied.colors === true && d.body.data.applied.industry === 'restaurant');
  ok('duplicate: every write lands on the NEW site; the source is never touched', writes.length > 0 && writes.every((w) => {
    const bodies = Array.isArray(w.body) ? w.body : [w.body];
    return !String(w.query).includes(S1) && bodies.every((b) => !b || !('site_id' in b) || b.site_id === NEW);
  }));
  ok('duplicate: the look is the source\'s template, set on the new site', T.presence_sites.find((s) => s.id === NEW).template_slug === 'business-classic' && T.presence_sites.find((s) => s.id === S1).template_slug === 'business-classic');
  ok('duplicate: a hidden service stays behind, and no business facts travel', T.presence_offerings.filter((o) => o.site_id === NEW).map((o) => o.name).join(',') === 'Tasting menu');
  const ev = writes.filter((w) => w.table === 'presence_change_events');
  ok('duplicate: the new site\'s history says where it started', ev.length >= 1 && ev.every((w) => w.body.site_id === NEW) && ev.some((w) => /Started from Bistro Nine’s setup/.test(w.body.summary || '')));
}

// ── GET /agency/domains ──
{
  reset();
  const r = await call(asMember(), 'GET', '/agency/domains');
  const doms = r.body.data?.domains || [];
  ok('domains: 200 with the clients\' domains and the studio\'s own, archived and strangers left out', r.status === 200 && doms.map((d) => d.domain).sort().join(',') === 'bistro.example,garage.example,mystudio.example');
  ok('domains: the expiring one first, with its provider and days left', doms[0].domain === 'bistro.example' && doms[0].status === 'expiring' && doms[0].provider === 'Registrar A' && doms[0].days_left === 10);
  ok('domains: the studio\'s own domain is marked as its own', doms.find((d) => d.domain === 'mystudio.example').own === true);
  ok('domains: a hosted site with no domain yet is listed on its built-in address', (r.body.data.builtin || []).map((b) => b.site_id).join(',') === S3);
  const ro = await call(asMember({ member_id: RO, role: 'readonly' }), 'GET', '/agency/domains');
  ok('domains: a view-only member reads it too; nothing is written', ro.status === 200 && writes.length === 0);
}

// ── the starter-kit routes, now on the same helpers as Duplicate (agency/kit_io.ts) ──
{
  reset();
  T.presence_starter_kits = [];
  const made = await call(asMember(), 'POST', '/agency/kits', { site_id: S1, name: 'Bistro starter' });
  const kit = T.presence_starter_kits[0];
  ok('kits: saving a kit still reads the site\'s setup — visible services only, FAQs, voice, colors, industry, template', made.status === 200 && made.body.data.offerings === 1 && made.body.data.faqs === 1 && kit && kit.payload.template_slug === 'business-classic' && kit.payload.voice.tone_notes === 'Warm and brief' && kit.payload.industry_key === 'restaurant' && kit.payload.offerings.map((o) => o.name).join(',') === 'Tasting menu');
  kit.id = 'abcdabcd-abcd-4bcd-8bcd-abcdabcdabcd'; kit.agency_id = AG;
  writes = [];
  const applied = await call(asMember(), 'POST', `/agency/kits/${kit.id}/apply`, { site_id: S3 });
  ok('kits: applying still fills the empty site and reports it', applied.status === 200 && applied.body.data.applied.offerings === 1 && applied.body.data.applied.colors === true && Array.isArray(applied.body.data.skipped));
  ok('kits: …and its history names the kit, on that site only', writes.filter((w) => w.table === 'presence_change_events').every((w) => w.body.site_id === S3) && writes.some((w) => w.table === 'presence_change_events' && /Applied the “Bistro starter” starter kit/.test(w.body.summary || '')));
  const again = await call(asMember(), 'POST', `/agency/kits/${kit.id}/apply`, { site_id: S3 });
  ok('kits: applying twice never overwrites (fill-only-empty holds)', again.status === 200 && again.body.data.applied.offerings === 0 && again.body.data.skipped.some((s) => /offerings/.test(s)));
}

// ── the browser test's fakes use only what the routes send (site_read_shape_test's rule) ──
{
  const spec = await Deno.readTextFile(new URL('../e2e/studio-sites.spec.ts', import.meta.url));
  // the top-level keys of an object literal, nested {…} and […] skipped
  const topKeys = (src) => { let depth = 0, flat = ''; for (const ch of src.replace(/'[^']*'/g, "''")) { if ('{['.includes(ch)) depth++; if (depth === 0) flat += ch; if ('}]'.includes(ch)) depth--; } return [...flat.matchAll(/(\w+):/g)].map((m) => m[1]); };
  const between = (s, a, b) => { const i = s.indexOf(a); return i < 0 ? '' : s.slice(i + a.length, s.indexOf(b, i + a.length)); };
  const fakeSite = topKeys(between(spec, 'const site = (over: Record<string, unknown>) => ({', '...over'));
  const sample = buildSites({ portfolio: [{ site_id: 's', name: 'n', edition: 'presence', status: 'live', tags: [], domain: null, domain_registrar: null, domain_expires_at: null, last_published_at: null, last_change_at: null, unpublished_changes: false, billing_issue: false }], extras: [], plans: [], seats: [], owners: [], portalSites: [], studio: [], me: '', opened: {}, pins: [], nowIso: NOW })[0];
  const realSite = Object.keys(sample);
  ok('shape: the fake site row has exactly the keys buildSites sends', fakeSite.length > 10 && fakeSite.slice().sort().join(',') === realSite.slice().sort().join(','), `fake only: ${fakeSite.filter((k) => !realSite.includes(k))} · real only: ${realSite.filter((k) => !fakeSite.includes(k))}`);
  const fakeDomain = topKeys(between(spec, "{ domain: 'gone.example',", '},').replace(/^/, "domain: 'x',"));
  const d = buildDomains([{ site_id: 'a', name: 'A', edition: 'presence', status: 'live', custom_domain: 'a.example', netlify_site_id: 'n' }, { site_id: 'b', name: 'B', edition: 'presence', status: 'live', custom_domain: null, netlify_site_id: 'n' }], NOW);
  const realDomain = Object.keys(d.domains[0]);
  ok('shape: the fake domain row has exactly the keys buildDomains sends', fakeDomain.slice().sort().join(',') === realDomain.slice().sort().join(','), `fake: ${fakeDomain} · real: ${realDomain}`);
  const fakeBuiltin = topKeys(between(spec, "builtin: [{", '}]'));
  ok('shape: the fake built-in row has exactly the keys buildDomains sends', fakeBuiltin.slice().sort().join(',') === Object.keys(d.builtin[0]).sort().join(','), `fake: ${fakeBuiltin}`);
}

// ═══ 9. one domain: the side panel, notes, and Check now (builder list item 162) ═══
{
  reset();
  const quietly = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
  const d = await quietly(() => call(asMember(), 'GET', `/agency/domains/${S1}`));
  ok('domain detail: 200 with the row, the records list and the notes (empty to start)', d.status === 200 && d.body.data.domain === 'bistro.example' && Array.isArray(d.body.data.records) && d.body.data.notes.renews === 'unknown' && d.body.data.notes.account === '', JSON.stringify(d.body).slice(0, 200));
  ok('domain detail: the studio’s own domain opens too', (await quietly(() => call(asMember(), 'GET', `/agency/domains/${OWN}`))).status === 200);
  ok('domain detail: someone else’s site is not yours', (await quietly(() => call(asMember(), 'GET', `/agency/domains/${STRANGER}`))).status === 404);
  ok('domain detail: a site with no domain of its own has no panel', (await quietly(() => call(asMember(), 'GET', `/agency/domains/${S3}`))).status === 404);
  const put = await call(asMember(), 'PUT', `/agency/domains/${S1}/notes`, { account: '  The client’s own GoDaddy  ', renews: 'yes', renews_confirmed_at: '2026-11-11', note: 'Card ends 2027', junk: 'x' });
  ok('notes: saved, tidied, signed', put.status === 200 && put.body.data.account === 'The client’s own GoDaddy' && put.body.data.renews === 'yes' && put.body.data.renews_confirmed_at === '2026-11-11' && put.body.data.updated_by === 'eric@studio.example' && !('junk' in put.body.data));
  ok('notes: kept in a reserved row on the CLIENT’s site', T.presence_sales_templates.some((t) => t.site_id === S1 && t.name === '__domain_notes__' && /Card ends 2027/.test(t.body)));
  ok('notes: read back in the panel', (await quietly(() => call(asMember(), 'GET', `/agency/domains/${S1}`))).body.data.notes.note === 'Card ends 2027');
  ok('notes: a read-only seat can look but not write', (await call(asMember({ member_id: RO, role: 'readonly' }), 'PUT', `/agency/domains/${S1}/notes`, { note: 'x' })).status === 403 && (await quietly(() => call(asMember({ member_id: RO, role: 'readonly' }), 'GET', `/agency/domains/${S1}`))).status === 200);
  ok('notes: "don’t know" carries no confirmed date', (await call(asMember(), 'PUT', `/agency/domains/${S1}/notes`, { renews: 'unknown', renews_confirmed_at: '2026-11-11' })).body.data.renews_confirmed_at === null);
  T.presence_sites.find((x) => x.id === S1).domain_checked_at = new Date().toISOString();
  const soon = await call(asMember(), 'POST', `/agency/domains/${S1}/check`);
  ok('check now: not twice inside a minute', soon.status === 429 && /a minute/.test(soon.body.message));
  T.presence_sites.find((x) => x.id === S1).domain_checked_at = '2026-01-01T00:00:00Z';
  writes = [];
  const chk = await quietly(() => call(asMember(), 'POST', `/agency/domains/${S1}/check`));
  ok('check now: runs the same check as the daily watch and answers with the panel', chk.status === 200 && chk.body.data.domain === 'bistro.example' && writes.some((w) => w.table === 'presence_sites' && w.method === 'PATCH' && 'domain_checked_at' in (w.body || {})), JSON.stringify(chk.body).slice(0, 160));
  ok('check now: a site without its own domain says so', (await call(asMember(), 'POST', `/agency/domains/${S3}/check`)).status === 409);
  ok('check now: not for someone else’s site', (await call(asMember(), 'POST', `/agency/domains/${STRANGER}/check`)).status === 404);
}

// ═══ 10. the panel, part two: where to go, mail and history (item 162, findings 6, 7 and 23) ═══
{
  reset();
  const quietly = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
  T.presence_sites.find((x) => x.id === S1).domain_dns_host = 'Cloudflare';
  T.presence_change_events = [
    { site_id: S1, entity_type: 'domain', action: 'create', summary: 'Attached domain bistro.example', actor_kind: 'operator', created_at: '2026-10-01T09:00:00Z' },
    { site_id: S2, entity_type: 'domain', action: 'create', summary: 'Attached domain garage.example', actor_kind: 'operator', created_at: '2026-10-02T09:00:00Z' },
    { site_id: S1, entity_type: 'settings', action: 'update', summary: 'Changed the colours', actor_kind: 'operator', created_at: '2026-10-03T09:00:00Z' },
  ];
  T.presence_plan_notices = [{ client_id: C1, kind: 'domain_expiry', status: 'active', period: 'exp:bistro.example:2026-11-18:30', created_at: '2026-10-19T00:00:00Z' }];
  const r = await quietly(() => call(asMember(), 'GET', `/agency/domains/${S1}`));
  const d = r.body.data || {};
  ok('panel: records at the company that runs the DNS, renewal at the seller, and the seller’s name left alone', r.status === 200 && d.where && d.where.records_at.company === 'Cloudflare' && d.where.records_at.sign_in === 'https://dash.cloudflare.com/' && d.where.renew_at.company === 'Registrar A' && d.provider === 'Registrar A', JSON.stringify(d.where));
  ok('panel: mail in one line', d.mail && d.mail.has_mail === false && d.mail.words === 'No email runs on this domain.');
  ok('panel: this domain’s history only, newest first, saying who', (d.history || []).map((h) => h.words).join(' | ') === '30-day reminder sent to the client and you | Attached domain bistro.example, by your studio', JSON.stringify(d.history));
}

// ═══ 11. item 174: the notes save merges what it's sent; every row says whether it renews by itself ═══
{
  reset();
  const quietly = async (fn) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.error = e; console.warn = w; } };
  await call(asMember(), 'PUT', `/agency/domains/${S1}/notes`, { account: 'The client’s own account', note: 'Card ends 2027', renews: 'unknown' });
  const r = await call(asMember(), 'PUT', `/agency/domains/${S1}/notes`, { renews: 'yes', renews_confirmed_at: '2026-11-11' });
  ok('notes: a one-field save (the row’s switch) keeps the account and the note', r.status === 200 && r.body.data.renews === 'yes' && r.body.data.renews_confirmed_at === '2026-11-11' && r.body.data.account === 'The client’s own account' && r.body.data.note === 'Card ends 2027', JSON.stringify(r.body));
  const list = await quietly(() => call(asMember(), 'GET', '/agency/domains'));
  const row = (list.body.data.domains || []).find((d) => d.site_id === S1);
  const other = (list.body.data.domains || []).find((d) => d.site_id === S2);
  ok('the list carries it on the row, and "don’t know" where nobody said', row && row.renews === 'yes' && row.renews_confirmed_at === '2026-11-11' && other && other.renews === 'unknown', JSON.stringify(row));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { console.error('FAILURES'); Deno.exit(1); }
