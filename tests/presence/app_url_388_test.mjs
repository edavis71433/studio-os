// ── Builder item 388: every emailed link starts at the app's address ─────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/app_url_388_test.mjs
// Links in emails, Stripe's return addresses and sign-in links were built from SITE_URL
// (production sets it right: the app's address). Had it ever been lost, 27 places fell back
// to the main site (Squarespace now, where those pages answer "not found") and 6 to an
// address that doesn't exist. Every one now asks appBase() (_shared/app_url.ts):
//   1  the order: SITE_URL, then APP_URL, then the app's address; never a trailing slash
//   2  real link builders, with no setting at all, land on the app
//   3  tripwire: nothing in either server reads SITE_URL itself
const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const APP = 'https://app.davisdigitalstudio.com';

Deno.env.delete('SITE_URL'); Deno.env.delete('APP_URL');
const { appBase, APP_HOST } = await import('../../supabase/functions/_shared/app_url.ts');

// ═══ 1. the order ═══
ok('nothing set: the app\'s address', appBase() === APP && APP_HOST === APP);
Deno.env.set('APP_URL', 'https://app.example/');
ok('only APP_URL: that, without its trailing slash', appBase() === 'https://app.example');
Deno.env.set('SITE_URL', 'https://studio.example//');
ok('SITE_URL first, as production sets it', appBase() === 'https://studio.example');
Deno.env.set('SITE_URL', '   ');
ok('a SITE_URL of only spaces counts as unset', appBase() === 'https://app.example');
Deno.env.delete('SITE_URL'); Deno.env.delete('APP_URL');

// ═══ 2. real link builders, nothing set ═══
Deno.env.set('SUPABASE_URL', 'https://db.test');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
const asked = [];
globalThis.fetch = async (url, init = {}) => {
  asked.push({ url: String(url), body: init.body ? JSON.parse(String(init.body)) : null });
  if (String(url).endsWith('/auth/v1/admin/generate_link')) return new Response(JSON.stringify({ action_link: 'https://db.test/auth/v1/verify?token=t' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
{
  const { docViewerUrl } = await import('../../supabase/functions/presence/routes/sales.ts');
  ok('a proposal, agreement or invoice opens on the app (doc.html), not the main site', docViewerUrl('tok.sig') === `${APP}/doc.html?t=tok.sig`, docViewerUrl('tok.sig'));
  const { mintSignInLink } = await import('../../supabase/functions/presence/lib/workspace.ts');
  await mintSignInLink('pat@example.com', '/portal.html');
  const gen = asked.find((a) => a.url.endsWith('/auth/v1/admin/generate_link'));
  ok('an invite\'s one-tap sign-in lands on the app\'s portal door', gen?.body?.redirect_to === `${APP}/portal.html`, JSON.stringify(gen?.body));
  asked.length = 0;
  await mintSignInLink('pat@example.com', '/portal.html?studio=s1', 'https://from.example');
  ok('…unless the caller names the page\'s own address (a query string must survive)', asked[0]?.body?.redirect_to === 'https://from.example/portal.html?studio=s1');
}

// ═══ 3. tripwire ═══
{
  const root = new URL('../../supabase/functions/', import.meta.url);
  const offenders = [];
  const walk = (dir) => {
    for (const e of Deno.readDirSync(dir)) {
      const p = new URL(e.name + (e.isDirectory ? '/' : ''), dir);
      if (e.isDirectory) { walk(p); continue; }
      if (!e.name.endsWith('.ts') || p.pathname.endsWith('/_shared/app_url.ts')) continue;
      const src = Deno.readTextFileSync(p).replace(/\/\/[^\n]*/g, '');
      if (/Deno\.env\.get\(\s*['"]SITE_URL['"]\s*\)/.test(src)) offenders.push(p.pathname.replace(/^.*supabase\/functions\//, ''));
    }
  };
  walk(root);
  ok('no server file reads SITE_URL itself: every link asks appBase()', offenders.length === 0, offenders.join(', '));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ APP ADDRESS, ITEM 388: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
