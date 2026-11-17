// ── The DOOR for a client whose website lives on another platform ────────────
//   deno run --allow-read --allow-env tests/presence/external_client_door_test.mjs
//
// Eric's report, after the external-clients work shipped: the analytics card
// said "Add their website address →" but the link landed on a screen with no
// affordance in sight, and the Add-a-customer dropdown had no selection for
// "their site is on another platform AND I want it tracked". Three defects,
// each pinned here with its fix:
//
//   1. THE CTA WAS A DEAD END — /presence.html#monitor routed nowhere (no
//      HASH_VIEWS entry) and #monitorCard was hidden for every edition but
//      'monitor'. Now #monitor opens the Business view, scrolls to the card,
//      and the card renders for monitor-edition sites AND hosted sites that
//      have never published (a rebuild-in-progress).
//   2. THE DROPDOWN SPLIT THE REAL CASE — two <option>s shared
//      value="business_os_only", so "build elsewhere and track it" was
//      indistinguishable from "no site work". Values are distinct now, and the
//      website field shows exactly when a site exists somewhere we don't host.
//   3. NO DOOR FOR AN EXISTING CLIENT — edition was set at creation and
//      /monitor/connect refused every non-monitor site, so a hosted-edition
//      client could never gain an external domain. The gate now refuses only a
//      site that is hosted AND published; the edition itself is never flipped
//      (provisionForSignup re-syncs edition from the plan, so a bare flip is
//      both unstable and — via the index.ts M11 write boundary — lossy).
import { searchReadinessState } from '../../supabase/functions/presence/analytics/compose.ts';
import { gscDomainFor, propertyCandidates } from '../../supabase/functions/presence/lib/gsc.ts';
import { editorSource } from './editor_source.mjs';   // builder item 38: the editor is four files now

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const src = (p) => Deno.readTextFileSync(new URL(`../../supabase/functions/presence/${p}`, import.meta.url));
const page = (p) => { if (p === 'presence.html') return editorSource(); return Deno.readTextFileSync(new URL(`../../${p}`, import.meta.url)); };   // builder item 38: the editor is four files now

// ═══ 1. the pure chain: record a domain → readiness flips → sync finds it ════
// The whole end-to-end, in the pure layer: an existing hosted-edition client
// with an unpublished site starts trapped at 'draft'; the moment a domain is
// recorded (presence_monitor_connections), the SAME site row reads 'connect',
// then 'waiting' once GSC is connected — and the sync's property resolution
// picks that exact domain up without an edition flip.
{
  const REBUILD = { hosted: true, lastPublishedAt: null, externalDomain: null, gscConnected: false, hasData: false };
  ok('before recording: a hosted unpublished client is at "draft" (publish is still the default ask)',
    searchReadinessState(REBUILD) === 'draft');
  ok('recording a domain flips the SAME client draft → connect (no edition flip, no publish)',
    searchReadinessState({ ...REBUILD, externalDomain: 'acmebakery.com' }) === 'connect');
  ok('connecting GSC then reads "waiting" — the honest lag, not another nag',
    searchReadinessState({ ...REBUILD, externalDomain: 'acmebakery.com', gscConnected: true }) === 'waiting');
  ok('real numbers land as "measuring" exactly as for every other client',
    searchReadinessState({ ...REBUILD, externalDomain: 'acmebakery.com', gscConnected: true, hasData: true }) === 'measuring');
  // a PUBLISHED hosted site is untouched by all of this: its own domain rules.
  ok('a published hosted site never enters the draft/no_domain trap (regression pin)',
    searchReadinessState({ ...REBUILD, lastPublishedAt: '2026-06-01T00:00:00Z' }) === 'connect'
    && searchReadinessState({ ...REBUILD, lastPublishedAt: '2026-06-01T00:00:00Z', externalDomain: 'acmebakery.com' }) === 'connect');

  // the sync side: for a presence-edition site with no custom domain, the
  // recorded external address outranks the never-deployed netlify subdomain.
  const picked = gscDomainFor({ edition: 'presence', custom_domain: null, netlify_site_id: 'xyz' }, 'https://www.acmebakery.com/');
  ok('gsc_sync would target the recorded domain for this hosted-edition site',
    picked && picked.domain === 'acmebakery.com' && picked.source === 'external');
  ok('…and feeds the proven Search Console property candidates',
    JSON.stringify(propertyCandidates(picked.domain))
      === JSON.stringify(['sc-domain:acmebakery.com', 'https://acmebakery.com/', 'https://www.acmebakery.com/']));
  ok('once a custom domain is attached (site launched here), it takes over from the external record',
    gscDomainFor({ edition: 'presence', custom_domain: 'acmebakery.com', netlify_site_id: 'xyz' }, 'oldplace.com').source === 'custom_domain');
}

// ═══ 2. the readiness gate reads the recorded address for hosted drafts ══════
{
  const route = src('routes/analytics.ts');
  ok('the scoped board reads presence_monitor_connections for hosted sites too — until they publish',
    /const needsExt = !\(hosted && site\.last_published_at\);/.test(route) && /const extConn = needsExt \?/.test(route));   // H7: read in the first batch now
  ok('a published hosted site ignores any stale external record (its own domain is the property)',
    /Once a hosted site HAS published/.test(route));
  ok('the draft payload now carries record_href — the alternative door, not just publish_href',
    /draft: true, publish_href: '\/presence\.html#publish', record_href: '\/presence\.html#monitor'/.test(route));

  const compose = src('analytics/compose.ts');
  ok('the pure gate documents WHY a recorded address unlocks a hosted draft',
    /if \(x\.hosted && !x\.lastPublishedAt && !x\.externalDomain\) return 'draft';/.test(compose));
}

// ═══ 3. the CTA lands on a page that can act ════════════════════════════════
{
  const h = page('presence.html');
  ok('presence.html routes the #monitor hash (the CTA no longer lands on "the other screenshot")',
    /if \(h === "monitor"\) \{\s*\n\s*go\("business"\);/.test(h));
  ok('#monitor scrolls the monitor card into view once visibility is decided',
    /monitorCard"\);\s*\n\s*if \(m && !m\.hidden\) \{ m\.scrollIntoView/.test(h));
  ok('the monitor card renders for monitor-edition sites AND hosted sites that never published',
    /const monitorEdition = S\.site\?\.edition === "monitor";/.test(h)
    && /const unpublishedHosted = !monitorEdition && !\(S\.site && S\.site\.last_published_at\);/.test(h)
    && /if \(!monitorEdition && !unpublishedHosted\) \{ \$\("monitorCard"\)\.hidden = true; return; \}/.test(h));
  ok('a hosted rebuild gets its own wording — record the address, building here continues',
    /Already live somewhere else\? Add that website’s address/.test(h)
    && /"Add the website’s address"/.test(h));
  ok('a PUBLISHED hosted site keeps the card hidden — no second "website" surface competing with the real one',
    /edition 'presence', PUBLISHED\s*→ hidden/.test(h.replace(/\s+/g, ' ')) || /PUBLISHED    → hidden/.test(h));

  const a = page('analytics.html');
  ok('the draft empty state names the alternative door (record the address) beside "publish"',
    /Already live on another platform\? <a href="\$\{esc\(withScope\(g\.record_href\)\)\}">Record that website’s address<\/a>/.test(a));
  ok('the alternative link appears only when the server sent record_href (older payloads degrade cleanly)',
    /const recordAlt=gDraft&&g&&g\.record_href/.test(a));
  ok('the alternative link carries the operator’s client scope (withScope), like every CTA on the page',
    /withScope\(g\.record_href\)/.test(a));
}

// ═══ 4. the server-side door: /monitor for an existing client ═══════════════
{
  const m = src('routes/monitor.ts');
  ok('POST /monitor/connect refuses ONLY a site that is hosted AND published',
    /if \(site\.edition !== 'monitor' && site\.last_published_at\) \{/.test(m));
  ok('the refusal explains itself — the hosted site’s own address is the property',
    /hosted and published here — its own address is what Google reports on/.test(m));
  ok('the gate documents why the edition is NOT flipped (provision re-sync + M11 write boundary)',
    /bare edition flip is\s*\/\/\s*unsafe \(provisionForSignup re-syncs edition from the entitlement plan/.test(m));
  ok('GET /monitor/connection reads via the service role — a scoped operator sees the existing connection',
    /export async function handleMonitorGet\(_jwt: string[\s\S]{0,900}?await svc\(`presence_monitor_connections\?site_id=eq\.\$\{site\.id\}/.test(m));
  ok('…because the asUser read answered null for operators and one more tap re-tokenized a VERIFIED row',
    /merge-duplicate a fresh token over a VERIFIED row/.test(m));
  ok('verify/readiness/disconnect are untouched (verification still gates observation, not Search Console)',
    /export async function handleMonitorVerify/.test(m) && /export async function handleMonitorDisconnect/.test(m));
}

// ═══ 5. the dropdown: distinct values, no stranded case ═════════════════════
// Builder item 102: Home, Customers and Contacts open ONE box (customer-add.js), so the
// checks read that file; the drift pin that compared two hand-kept copies became "no page
// keeps a copy of its own".
{
  const box = page('customer-add.js');
  const dlg = box.slice(box.indexOf("'<dialog id=\"custDlg\""), box.indexOf("'</dialog>'") + 12);
  // builder item 241: adding a customer saves them and nothing else, so the box asks no kind of work;
  // the external case (their site lives somewhere else) is its own step on their profile
  ok('the box asks no kind of work (it saves the customer and nothing else)', !/<option value=|cu-edition|cuPlan/.test(dlg));
  // (their profile's "Their site lives somewhere else?" is driven in tests/e2e/customers-241.spec.ts; the route in customers_241_test.mjs)

  // an unknown edition key would silently become the HOSTED plan server-side
  // (pickPlan defaults to 'presence') — so the raw option value must never
  // reach the wire, and the server whitelist must not contain the UI-only key.
  const sales = src('routes/sales.ts');
  ok('the server plan whitelist knows nothing of the UI-only no-site key (it must be mapped client-side)',
    !/business_os_no_site/.test(sales) && /CONVERT_PLANS = new Set\(\['presence', 'cms_only', 'business_os_only', 'presence_monitor', 'presence_managed'\]\)/.test(sales));

  // ── no drift left to pin: no page keeps its own copy of the box, and all three load the one
  const pages = ['agency.html', 'customers.html', 'contacts.html'].map((p) => [p, page(p)]);
  ok('no page keeps its own Add a customer box (Home, Customers and Contacts)',
    pages.every(([, t]) => !t.includes('<dialog id="custDlg"') && !t.includes('function cuPlan')));
  ok('Home, Customers and Contacts all load the one box and open it from there',
    pages.every(([, t]) => t.includes('<script src="/customer-add.js"></script>') && t.includes('window.ddsAddCustomer.mount(')));
}

// ═══ verdict ════════════════════════════════════════════════════════════════
const failed = results.filter((r) => !r.p);
console.log(`\n════ EXTERNAL CLIENT DOOR (record a website for an existing client): ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { console.log('Failed:'); failed.forEach((f) => console.log(`  ✗ ${f.n}`)); Deno.exit(1); }
