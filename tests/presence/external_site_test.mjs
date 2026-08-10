// ── Clients whose website we DON'T host ──────────────────────────────────────
//   deno run --allow-read --allow-env tests/presence/external_site_test.mjs
//
// Eric's book is not all greenfield builds. Some clients already have a website
// at their own domain and an established Google presence; Studio OS is the
// workspace ABOUT that site, not its host. Everything here pins the three places
// that used to assume otherwise:
//
//   1. the SEARCH GATE — an external client was told "publish the site first"
//      (commit 9d955c6) because it read the absent last_published_at as "draft".
//      They have nothing to publish, and Search Console never cared who hosts.
//   2. the GSC SYNC — the property was derived from custom_domain-or-netlify,
//      so a client's own domain could never be synced.
//   3. the VISITOR EMPTY STATE — "once your site is published, visitor numbers
//      show up here" is false forever for a site we don't serve: the beacon
//      lib/render.ts injects only lands on pages we render.
//
// The regression guard cuts both ways: a site we DO host that is still a draft
// must keep getting the publish nudge 9d955c6 shipped.
import { searchReadinessState, hostingSurface, trafficInsights } from '../../supabase/functions/presence/analytics/compose.ts';
import { gscDomainFor, propertyCandidates } from '../../supabase/functions/presence/lib/gsc.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const src = (p) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/${p}`, import.meta.url));
const page = (p) => Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url));

// ═══ 1. the search gate: external ≠ draft ═══════════════════════════════════
{
  const EXTERNAL = { hosted: false, lastPublishedAt: null, externalDomain: 'acmebakery.com', gscConnected: false, hasData: false };

  ok('external client with a known domain is NEVER told to publish',
    searchReadinessState(EXTERNAL) !== 'draft');
  ok('external client with a known domain gets the CONNECT path',
    searchReadinessState(EXTERNAL) === 'connect');
  ok('external client with no address on file is blocked on the ADDRESS, not on publishing',
    searchReadinessState({ ...EXTERNAL, externalDomain: null }) === 'no_domain');
  ok('external + connected + no month yet = the honest lag, not a connect nag',
    searchReadinessState({ ...EXTERNAL, gscConnected: true }) === 'waiting');
  ok('external + real numbers = measuring (hosting is irrelevant once data lands)',
    searchReadinessState({ ...EXTERNAL, hasData: true }) === 'measuring');

  // 9d955c6 REGRESSION GUARD — the publish nudge must survive for our own drafts.
  const OURS_DRAFT = { hosted: true, lastPublishedAt: null, externalDomain: null, gscConnected: false, hasData: false };
  ok('9d955c6 stands: a site WE host that has never been published still gets "publish first"',
    searchReadinessState(OURS_DRAFT) === 'draft');
  ok('9d955c6 stands: our draft is told to publish even when Search Console is already connected',
    searchReadinessState({ ...OURS_DRAFT, gscConnected: true }) === 'draft');
  ok('a site WE host that IS published falls through to the connect ask',
    searchReadinessState({ ...OURS_DRAFT, lastPublishedAt: '2026-05-01T00:00:00Z' }) === 'connect');
  ok('our own published+connected site gets the lag note, not a connect nag',
    searchReadinessState({ ...OURS_DRAFT, lastPublishedAt: '2026-05-01T00:00:00Z', gscConnected: true }) === 'waiting');
  // the exact shape of the bug being fixed: hosted is the ONLY differing input.
  ok('the fix is precisely the hosting question: same row, hosted flips draft → connect',
    searchReadinessState({ ...OURS_DRAFT, externalDomain: 'acmebakery.com' }) === 'draft'
    && searchReadinessState({ ...OURS_DRAFT, externalDomain: 'acmebakery.com', hosted: false }) === 'connect');
}

// ═══ 2. the honest surface: what we can and cannot show, WITH the reason ═════
{
  const ext = hostingSurface({ hosted: false, externalDomain: 'acmebakery.com' });
  ok('external: search is named as AVAILABLE', ext.search_measurable === true);
  ok('external: the search reason says Google reports on the domain whoever hosts it',
    /whoever hosts it/i.test(ext.search_reason) && ext.search_reason.includes('acmebakery.com'));
  ok('external: first-party visitors are named as UNAVAILABLE (not zero, not "yet")',
    ext.visitors_measurable === false);
  ok('external: the visitor reason gives the CAUSE — no counter on pages we don’t serve',
    /counter/i.test(ext.visitors_reason) && /host/i.test(ext.visitors_reason));
  ok('external: the reason never promises the numbers will arrive later',
    !/\byet\b|once (your|the) site is published/i.test(ext.visitors_reason));
  ok('external with no domain still explains itself (no blank, no zero)',
    (() => { const n = hostingSurface({ hosted: false, externalDomain: null });
      return n.external === true && n.domain === null && n.visitors_measurable === false && n.visitors_reason.length > 20 && n.search_reason.length > 20; })());

  const ours = hostingSurface({ hosted: true, externalDomain: null });
  ok('hosted: both surfaces are measurable and it does not claim to be external',
    ours.hosted === true && ours.external === false && ours.visitors_measurable === true && ours.search_measurable === true);
}

// ═══ 3. the visitor empty state stops lying ═════════════════════════════════
{
  const EMPTY = { visitors: 0, priorVisitors: 0, pageviews: 0, topPages: [], topSources: [], devices: [], events: { phone: 0, email: 0, cta: 0, download: 0 }, hasData: false };
  const extCards = trafficInsights(EMPTY, 'week', { hosted: false, domain: 'acmebakery.com' });
  ok('external empty traffic does NOT promise numbers after publishing',
    !/published/i.test(extCards[0].sentence));
  ok('external empty traffic states the cause and names the domain',
    /doesn’t host/i.test(extCards[0].sentence) && extCards[0].sentence.includes('acmebakery.com'));
  ok('external empty traffic reports NO number (null, never a fabricated 0)',
    extCards[0].number === null);
  ok('external empty traffic still says search is unaffected (it is)',
    /search/i.test(extCards[0].sentence));
  // no regression: our own site keeps the publish-and-share wording + the 0.
  const oursCards = trafficInsights(EMPTY, 'week', { hosted: true });
  ok('hosted empty traffic keeps the original "once your site is published" wording',
    /once your site is published/i.test(oursCards[0].sentence) && oursCards[0].number === 0);
  ok('trafficInsights stays backward-compatible with no hosting argument at all',
    /once your site is published/i.test(trafficInsights(EMPTY, 'week')[0].sentence));
}

// ═══ 4. the GSC sync targets the client's OWN domain ════════════════════════
{
  const MONITOR = { edition: 'monitor', custom_domain: null, netlify_site_id: 'abc123' };
  const picked = gscDomainFor(MONITOR, 'acmebakery.com');
  ok('monitor site syncs the EXTERNAL domain', picked && picked.domain === 'acmebakery.com' && picked.source === 'external');
  ok('monitor site NEVER falls back to a netlify subdomain (we deploy nothing for it)',
    gscDomainFor(MONITOR, null) === null);
  ok('monitor domain is normalized (scheme/www/path/case stripped) so it matches the property',
    gscDomainFor(MONITOR, 'https://WWW.AcmeBakery.com/about').domain === 'acmebakery.com');
  ok('the normalized external domain feeds the proven property candidates',
    JSON.stringify(propertyCandidates(gscDomainFor(MONITOR, 'https://www.acmebakery.com/').domain))
      === JSON.stringify(['sc-domain:acmebakery.com', 'https://acmebakery.com/', 'https://www.acmebakery.com/']));

  const HOSTED = { edition: 'presence', custom_domain: 'joesplumbing.com', netlify_site_id: 'xyz' };
  ok('hosted site still prefers its custom domain (no regression)',
    gscDomainFor(HOSTED, null).source === 'custom_domain');
  ok('hosted site still falls back to the netlify subdomain while a domain is pending',
    gscDomainFor({ edition: 'presence', custom_domain: null, netlify_site_id: 'xyz' }, null).domain === 'xyz.netlify.app');
  ok('hosted site with a recorded external domain prefers it over the netlify subdomain',
    gscDomainFor({ edition: 'presence', custom_domain: null, netlify_site_id: 'xyz' }, 'oldsite.com').source === 'external');
  ok('knowing nothing returns null — an honest "we don’t know", never a guessed property',
    gscDomainFor({ edition: 'presence', custom_domain: null, netlify_site_id: null }, null) === null);
}

// ═══ 5. the wiring: the assumptions are gone from the shipping code ═════════
{
  const sync = src('ops/gsc_sync.ts');
  ok('gsc_sync no longer derives the property from custom_domain-or-netlify inline',
    !/site\.custom_domain \|\| \(site\.netlify_site_id/.test(sync));
  ok('gsc_sync resolves the property through the edition-aware helper',
    /gscDomainFor\(site, ext\)/.test(sync));
  ok('gsc_sync reads the external address from presence_monitor_connections',
    /presence_monitor_connections\?site_id=eq\./.test(sync));
  ok('gsc_sync does NOT require OUR ownership proof first (Google does its own)',
    !/presence_monitor_connections[^`]*status=eq\.verified/.test(sync));
  ok('gsc_sync selects the edition it now branches on',
    /select=id,client_id,custom_domain,netlify_site_id,edition/.test(sync));
  ok('a monitor site with no address gets its OWN note, not a generic no_domain',
    /'no_external_domain'/.test(sync));

  const route = src('routes/analytics.ts');
  ok('the scoped board decides hosting from the site edition, never from publishing',
    /const hosted = site\.edition !== 'monitor'/.test(route));
  ok('the scoped board runs the shared pure gate rather than its own last_published_at test',
    /searchReadinessState\(\{/.test(route) && !/!gsc\.hasData && !site\.last_published_at/.test(route));
  ok('the scoped board emits the no_domain state with somewhere to record the address',
    /no_domain: true[\s\S]{0,80}record_href/.test(route));
  ok('the scoped board publishes the hosting surface so the page never has to guess',
    /hosting: hostingSurface\(/.test(route));
  ok('the portfolio band counts no_domain clients separately from drafts',
    /counts\.no_domain\+\+/.test(route) && /key: 'search_no_domain'/.test(route));
  ok('the portfolio band’s no-domain card does NOT ask anyone to publish',
    (() => { const m = route.match(/key: 'search_no_domain'[\s\S]{0,700}?\}\);/); return !!m && !/\bpublish(ing)?\b/i.test(m[0].replace(/Nothing needs publishing\./, '')); })());
  ok('the portfolio band still ships the publish card for sites we host',
    /key: 'search_draft'/.test(route));
  ok('the portfolio band batches the external addresses (no per-site query)',
    /presence_monitor_connections\?site_id=in\./.test(route));
}

// ═══ 6. recording the address — the add-a-customer seam ════════════════════
{
  const sales = src('routes/sales.ts');
  ok('the add-a-customer route accepts the client’s existing website address',
    /clean\(b\.website_url, 200\)/.test(sales));
  ok('the address is stored in presence_monitor_connections (the table 0031 already made for it)',
    /recordExistingWebsite[\s\S]{0,2200}presence_monitor_connections/.test(sales));
  ok('the address is recorded ONLY when the plan means we do not host it',
    /editionFor\(plan\) !== 'monitor'\) return null/.test(sales));
  ok('recording is idempotent — an existing connection is never re-tokenized',
    /never re-issue a proof/.test(sales) && /if \(have\) return have\.domain/.test(sales));
  ok('the response tells the caller which address was stored',
    /external_domain: externalDomain/.test(sales));

  for (const p of ['customers.html', 'contacts.html']) {
    const h = page(p);
    ok(`${p}: the dialog asks where their existing website lives`,
      /id="cu-website"/.test(h) && /Their existing website address/.test(h));
    ok(`${p}: the field appears only when the site is NOT hosted here`,
      /function cuHostedHere\(\)\{return \$\('cu-edition'\)\.value==='presence';\}/.test(h)
      && /cu-website-wrap'\);if\(w\)w\.style\.display=cuHostedHere\(\)\?'none':''/.test(h));
    ok(`${p}: the address is actually submitted to /sales/customers`,
      /website_url:\(!cuHostedHere\(\)/.test(h));
    ok(`${p}: the hint is honest about which numbers this unlocks and which it doesn’t`,
      /whoever hosts it/.test(h) && /Visitor counts still can’t come from here/.test(h));
  }
}

// ═══ 7. the analytics page renders the distinction ═════════════════════════
{
  const h = page('analytics.html');
  ok('analytics.html knows the no_domain state',
    /const gNoDom=!!\(g&&g\.no_domain\)/.test(h));
  ok('analytics.html’s CTA for a no-domain client records the address (never "Publish")',
    /gNoDom\?\[\(g&&g\.record_href\)\|\|'\/presence\.html#monitor','Add their website address'\]/.test(h));
  ok('the no-domain empty state says there is nothing to publish',
    /nothing to publish/.test(h));
  ok('the publish-first empty state is still shipped for sites we host',
    /Publish the site first/.test(h));
  ok('the "real numbers" state excludes no_domain too (no silent misread)',
    /gOk=!!\(g&&!g\.unavailable&&!g\.no_domain&&!g\.draft&&!g\.waiting\)/.test(h));
  ok('analytics.html reads the hosting surface the route now sends',
    /const host=\(w&&w\.hosting\)\|\|null/.test(h) && /const external=!!\(host&&host\.external\)/.test(h));
  ok('an external client gets a banner naming what works and what cannot',
    /bandnote/.test(h) && /Search numbers work:/.test(h) && /Visitor numbers can’t:/.test(h));
  ok('the visitor cards state the cause instead of "not measured yet"',
    /offSite=\(what\)=>emptyState\('Not measured here'/.test(h));
  ok('every first-party visitor card uses that honest state when external',
    (h.match(/external\?offSite\(/g) || []).length >= 4);
  ok('external visitor cards drop the "view website insights" link (it has nothing to show)',
    (h.match(/external\?null:\[BI,'View website insights'\]/g) || []).length >= 3);
}

// ═══ 8. Google Business Profile — the honest verdict ═══════════════════════
// Eric named GBP explicitly. It stays 'planned': its READ_ENDPOINT lists
// ACCOUNTS while its normalizer reads a LOCATION's rating/reviewCount, and no
// location is ever resolved — a connected customer would see a blank card. That
// is a defect, not a missing flag, so this pass does not flip it. Pinned here so
// the claim in the report is checkable and a future flip must fix the adapter.
{
  const providers = src('connected/providers.ts');
  const adapters = src('connected/adapters.ts');
  const gbp = providers.match(/key: 'google_business_profile'[\s\S]*?status: '(\w+)'/);
  ok('GBP is still planned (its read is not verified end-to-end)', !!gbp && gbp[1] === 'planned');
  ok('GBP’s endpoint is still the ACCOUNTS list — no location is resolved',
    /google_business_profile: 'https:\/\/mybusinessbusinessinformation\.googleapis\.com\/v1\/accounts'/.test(adapters));
  ok('GBP’s normalizer still reads location-level review fields the endpoint cannot return',
    /google_business_profile: \(r, label\) => \(\{[^}]*reviewCount/.test(adapters));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ EXTERNAL SITES (a client whose website we don’t host): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
