// ── Phase AN-1: Analytics — LIVE integration (real inquiry composition) ───────
// Proves the Analytics home reads REAL first-party data (form submissions) and
// composes honest sentences + honest "not measured" cards, against real Postgres.
// Isolated throwaway rows; skips when creds absent.
//   SUPABASE_URL=<staging> SERVICE_ROLE_KEY=<sr> deno run --allow-env --allow-net --allow-read tests/presence/analytics_integration_test.mjs
const SB_URL = Deno.env.get('SUPABASE_URL') || '';
const SR = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
if (!SB_URL || !SR) { console.log('SKIP analytics_integration (creds not set)'); Deno.exit(0); }

const { svc } = await import('../../supabase/functions/presence/lib/db.ts');
const { handleAnalyticsHome, handleAnalyticsCustomers } = await import('../../supabase/functions/presence/routes/analytics.ts');
const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };
const arr = (r) => (Array.isArray(r.json) ? r.json : []);
const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

let SITE = Deno.env.get('SITE') || '';
if (!SITE) SITE = arr(await svc('presence_sites?select=id&limit=1'))[0]?.id;
const site = arr(await svc(`presence_sites?id=eq.${SITE}&select=id,client_id,status,last_published_at,template_slug,template_version,custom_domain,netlify_site_id,edition&limit=1`))[0];
if (!site) { console.log('SKIP — no site'); Deno.exit(0); }
const cors = {};
const made = [];

async function mkLead(kind, whenIso) {
  const r = await svc('presence_form_submissions', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ site_id: SITE, form_kind: kind, name: 'ITEST lead', message: 'itest', status: 'new', spam: false, created_at: whenIso }) });
  const id = arr(r)[0]?.id; if (id) made.push(id); return id;
}

try {
  // 3 this week (2 quote, 1 contact) + 1 last week
  await mkLead('quote', daysAgo(1)); await mkLead('quote', daysAgo(2)); await mkLead('contact', daysAgo(3)); await mkLead('contact', daysAgo(10));
  ok('setup: created 4 isolated inquiries', made.length === 4);

  const res = await handleAnalyticsHome(new Request('http://x/analytics?period=week'), site, cors);
  const body = await res.json();
  const d = body.data;
  const inq = (d.insights || []).find((i) => i.key === 'inquiries');
  ok('home: composes REAL inquiry count (≥3 this week)', !!inq && inq.number >= 3);
  ok('home: inquiry sentence is plain English mentioning the count', /inquir(y|ies) this week/.test(inq.sentence));
  ok('home: unread inquiries surfaced honestly', /waiting for a reply/.test(inq.detail || ''));
  // AN-2 retired the traffic "not measured" card (traffic is first-party now); the
  // only honest "not measured" left is Search/GSC. Never a fabricated number anywhere.
  ok('home: honest "not measured" (search/GSC), never a fabricated number', (d.not_measured || []).some((c) => c.key === 'search') && (d.not_measured || []).every((c) => c.number === null));
  ok('home: publishing insight present (real signal)', (d.insights || []).some((i) => i.key === 'publishing'));

  const cRes = await handleAnalyticsCustomers(new Request('http://x/analytics/customers?period=week'), site, cors);
  const cd = (await cRes.json()).data;
  ok('customers: by-kind reflects real submissions (≥2 quote)', cd.by_kind.quote >= 2);
  ok('customers: honest note — no invented repeat/conversion figures', /aren’t tracked yet/.test(cd.note));
} finally {
  for (const id of made) await svc(`presence_form_submissions?id=eq.${id}`, { method: 'DELETE' });
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ ANALYTICS LIVE INTEGRATION: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
