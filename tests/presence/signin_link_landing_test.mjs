// ── An invite's sign-in link lands somewhere that signs the person in (MC-3) ──
// Seen on production 2026-11-05: the "Sign in to get started" link in an invite carried
// a redirect to "/", the marketing home page, which has no sign-in code. The person saw
// the home page, signed out, with no error. mintSignInLink sent `redirect_to` inside
// `options`, which GoTrue's admin API ignores, so it used the project's Site URL.
//
// This drives the real mintSignInLink and addSiteMember against a stub that treats the
// body the way production did: only a top-level `redirect_to` counts, and it must be on
// the allow-list read from the dashboard that day. No Supabase, no outside call.
//   · the link asks for the page it means to, and survives the invite → magic link step
//   · each role lands on a door whose session the pages after it can read
//   · no caller of generate_link nests the redirect again
//
//   deno run --allow-read --allow-env --allow-net tests/presence/signin_link_landing_test.mjs
const SITE_URL = 'https://app.davisdigitalstudio.com';
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', SITE_URL, RESEND_API_KEY: 'fake', RESEND_KEY: 'fake' })) Deno.env.set(k, v);

const P = '../../supabase/functions/presence';
const { mintSignInLink, addSiteMember } = await import(`${P}/lib/workspace.ts`);
const { SITE_ROLES, capabilitiesOf, seesFullWorkspace } = await import(`${P}/lib/site_roles.ts`);
const { landingFor } = await import(`${P}/lib/navigation.ts`);

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const SITE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALLOWED = [/^https:\/\/app\.davisdigitalstudio\.com\//, /^https:\/\/davisdigitalstudio\.com\//];
let minted, emails, seats, refuse, gotrueDown;
function reset() { minted = []; emails = []; seats = []; refuse = new Set(); gotrueDown = false; }

const reply = (body, status = 200) => new Response(body === null ? '' : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url), 'http://stub.local');
  const body = init.body ? JSON.parse(init.body) : null;
  if (u.hostname === 'api.resend.com') { emails.push(body); return reply({ id: 'email-1' }); }
  if (u.pathname === '/auth/v1/admin/generate_link') {
    if (gotrueDown) throw new Error('down');
    minted.push(body);
    if (refuse.has(body.type)) return reply({ msg: 'already registered' }, 422);
    // production's rule: a top-level redirect_to on the allow-list, else the Site URL
    const asked = typeof body.redirect_to === 'string' && ALLOWED.some((a) => a.test(body.redirect_to)) ? body.redirect_to : `${SITE_URL}/`;
    return reply({ action_link: `http://stub.local/auth/v1/verify?type=${body.type}&redirect_to=${encodeURIComponent(asked)}` });
  }
  // item 53: an invite reads whether the email is already here, then inserts the row and reads it back
  if (u.pathname === '/rest/v1/presence_site_members') { if ((init.method || 'GET') === 'GET') return reply([]); seats.push(body); return reply([{ id: 'seat-' + seats.length, ...body }], 201); }
  if (u.pathname.startsWith('/rest/v1/')) return reply([]);
  return reply({}, 404);
};

const landsOn = (link) => new URL(new URL(link).searchParams.get('redirect_to')).pathname;
const quiet = (fn) => async (...a) => { const e = console.error, w = console.warn; console.error = () => {}; console.warn = () => {}; try { return await fn(...a); } finally { console.error = e; console.warn = w; } };

// ═══ 1. the link asks for the page it means to ═══
{
  reset();
  const link = await mintSignInLink('new@example.com', '/portal.html');
  ok('mint: redirect_to is at the top of the body', minted[0]?.redirect_to === `${SITE_URL}/portal.html`, JSON.stringify(minted[0]));
  ok('mint: nothing is nested in options, which GoTrue ignores', !('options' in minted[0]));
  ok('mint: a new person gets an invite first', minted[0].type === 'invite' && minted[0].email === 'new@example.com');
  ok('mint: the link lands on that page, not the home page', landsOn(link) === '/portal.html', landsOn(link));

  reset();
  refuse.add('invite');
  const again = await mintSignInLink('known@example.com', '/agency.html');
  ok('mint: an existing person falls through to a magic link', minted.map((b) => b.type).join() === 'invite,magiclink');
  ok('mint: …and the magic link lands on the same page', minted[1].redirect_to === `${SITE_URL}/agency.html` && landsOn(again) === '/agency.html');

  reset();
  refuse.add('invite'); refuse.add('magiclink');
  ok('mint: GoTrue refusing both gives no link, so callers fall back', await mintSignInLink('x@example.com', '/portal.html') === '');
  reset();
  gotrueDown = true;
  ok('mint: GoTrue unreachable gives no link and never throws', await mintSignInLink('x@example.com', '/portal.html') === '');

  reset();
  Deno.env.delete('SITE_URL');
  await mintSignInLink('x@example.com', '/portal.html');
  ok('mint: with no SITE_URL it uses the production host, which forwards to the app', minted[0].redirect_to === 'https://davisdigitalstudio.com/portal.html');
  Deno.env.set('SITE_URL', SITE_URL);
}

// ═══ 2. each role lands on a door whose session the next page can read ═══
{
  const realmOf = (page) => read(page).match(/storageKey:\s*'(dds-[a-z]+-auth)'/)?.[1];
  const DOOR = { client_reviewer: 'portal.html', business_staff: 'studio.html', developer: 'studio.html', business_owner: 'studio.html' };
  ok('roles: this covers every role', SITE_ROLES.every((r) => r in DOOR) && Object.keys(DOOR).length === SITE_ROLES.length);
  for (const role of SITE_ROLES) {
    reset();
    const out = await quiet(addSiteMember)(SITE_A, 'Member@Example.com', role, 'owner', { allowDeveloper: true });   // as platform staff: Developer is paused for everyone else
    const asked = minted[0]?.redirect_to;
    ok(`invite ${role}: saved and emailed`, out.ok === true && out.emailed === true && seats[0]?.role === role && seats[0]?.email === 'member@example.com', JSON.stringify(out));
    ok(`invite ${role}: lands on /${DOOR[role]}`, asked === `${SITE_URL}/${DOOR[role]}`, asked);
    ok(`invite ${role}: the email carries that link`, emails.length === 1 && String(emails[0].html).includes(encodeURIComponent(asked)));
    const landing = landingFor({ role, edition: 'presence', capabilities: capabilitiesOf(role), isAgency: false, isOperator: false, siteLive: true });
    ok(`invite ${role}: the door and the page after it (${landing}) share one session`, realmOf(DOOR[role]) && realmOf(DOOR[role]) === realmOf(landing.slice(1)), `${realmOf(DOOR[role])} / ${realmOf(landing.slice(1))}`);
  }
  ok('roles: the studio door is for whoever sees the full workspace', SITE_ROLES.every((r) => seesFullWorkspace(r) === (DOOR[r] === 'studio.html')));

  // A managed client and an agency member go through the same minter from elsewhere.
  ok('client welcome: lands on the client door, then client.html, in one session', /mintSignInLink\(email, '\/portal\.html'\)/.test(read('supabase/functions/presence/routes/sales.ts')) && realmOf('portal.html') === realmOf('client.html'));
  ok('agency invite: lands on the agency page, which reads its own session', /next: '\/agency\.html'/.test(read('supabase/functions/presence/agency/routes.ts')) && realmOf('agency.html') === 'dds-portal-auth');
}

// ═══ 3. the pages these links land on, and the page they used to ═══
{
  const notOptedOut = (page) => !/detectSessionInUrl:\s*false/.test(read(page));
  for (const page of ['portal.html', 'studio.html', 'agency.html']) {
    ok(`${page}: loads the auth client and reads the session the link puts in the URL`, /supabase\.createClient\(/.test(read(page)) && /auth\.getSession\(\)/.test(read(page)) && notOptedOut(page));
  }
  ok('portal.html: an expired or used link gets a message and a way forward', /if \(\/error=\/\.test\(hash\)\)/.test(read('portal.html')) && /expired or was already used/.test(read('portal.html')));
  ok('why this mattered: the home page has no sign-in code', !/createClient|getSession|access_token/.test(read('index.html')));
}

// ═══ 4. nothing nests the redirect again ═══
{
  const callers = [];
  const walk = (dir) => {
    for (const f of Deno.readDirSync(new URL(dir, ROOT))) {
      if (f.isDirectory) walk(`${dir}${f.name}/`);
      else if (f.name.endsWith('.ts') && read(`${dir}${f.name}`).includes('admin/generate_link')) callers.push(`${dir}${f.name}`);
    }
  };
  walk('supabase/functions/');
  ok('callers: found them', callers.length >= 2, callers.join(', '));
  for (const file of callers) {
    const calls = read(file).split('admin/generate_link').slice(1).map((s) => s.slice(0, 400));
    ok(`callers: ${file} sends redirect_to at the top, never in options`, calls.every((c) => /JSON\.stringify\(\{[^}]*\bredirect_to:/.test(c) && !/options:/.test(c)));
  }
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ SIGN-IN LINK LANDING: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
