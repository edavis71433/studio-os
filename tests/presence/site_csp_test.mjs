// ── List item 144: a published site runs only the scripts we wrote into it ───
// File 06 of the Nov 10 review, finding 9: every published site was sent
// "default-src 'self' https: data: 'unsafe-inline'", so any script from any secure
// address could run, and so could any script written into a page. At publish the
// rule is now worked out from the site's own pages (lib/site_csp.ts): each inline
// script is named by its SHA-256, nothing else runs, and the scripts may talk to our
// server only. A site that loads code from elsewhere keeps the old rule.
//   deno run --allow-read --allow-env tests/presence/site_csp_test.mjs
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { publishedCspFor, siteHomes } from '../../supabase/functions/presence/lib/site_csp.ts';
import { PUBLISHED_CSP_RESPONSE, mergeSecurityHeaders } from '../../supabase/functions/presence/lib/security_headers.ts';
import { lockPages, newPageLock } from '../../supabase/functions/presence/lib/page_access.ts';
import { TEMPLATES, fixture as sampleOf, fullFixture } from './full_fixture.mjs';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));

const SERVER = 'https://fnhost.supabase.co';
const SITE_ID = '11111111-2222-4333-8444-555555555555';
Deno.env.set('SUPABASE_URL', SERVER);   // the visit counter writes our server's address into each page
const SITE = { baseUrl: 'https://client.example', siteId: SITE_ID, formEndpoint: `${SERVER}/functions/v1/presence/forms/${SITE_ID}/submit`, bookEndpoint: `${SERVER}/functions/v1/presence/book/${SITE_ID}` };
const HOMES = siteHomes({ id: SITE_ID, custom_domain: 'client.example', netlify_site_id: 'n1' });

const directives = (csp) => new Map(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
// the browser's view of a page's scripts, worked out here on its own: every <script> that
// runs (no type, or a JavaScript or module type), its text with line ends as \n
async function scriptHashes(files) {
  const out = new Set();
  for (const [k, v] of Object.entries(files)) {
    if (!k.endsWith('.html') || typeof v !== 'string') continue;
    for (const m of v.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
      const type = (/type="([^"]+)"/.exec(m[1]) || [])[1] || '';
      if (type && type !== 'module' && type !== 'text/javascript') continue;
      if (/\ssrc=/.test(m[1]) || !m[2].trim()) continue;
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m[2].replace(/\r\n?/g, '\n'))));
      out.add(`'sha256-${btoa(String.fromCharCode(...d))}'`);
    }
  }
  return out;
}

// ═══ 1. every template, its own sample and every section the builder offers ═══
for (const slug of TEMPLATES) {
  for (const [label, snap] of [['sample', sampleOf(slug)], ['every section', fullFixture(slug)]]) {
    const files = await renderSnapshot(snap, SITE);
    const csp = await publishedCspFor([files], SERVER, HOMES);
    const d = directives(csp);
    const want = await scriptHashes(files);
    const script = d.get('script-src') || [];
    ok(`${slug} (${label}): a tight rule, not the old open one`, csp !== PUBLISHED_CSP_RESPONSE && script[0] === "'self'" && !script.includes("'unsafe-inline'") && !script.includes('https:'), csp.slice(0, 120));
    ok(`${slug} (${label}): every script the pages run is named, and nothing else`, want.size > 0 && script.length === want.size + 1 && [...want].every((h) => script.includes(h)), `${want.size} scripts`);
    ok(`${slug} (${label}): the pages may talk to our server only`, (d.get('connect-src') || []).join(' ') === `'self' ${SERVER}`);
    ok(`${slug} (${label}): a form posts to our server and comes back to the site`, (d.get('form-action') || []).join(' ') === `'self' ${SERVER} ${HOMES.join(' ')}`);
    ok(`${slug} (${label}): no framing, no plugins, no <base>`, (d.get('frame-ancestors') || [])[0] === "'none'" && (d.get('object-src') || [])[0] === "'none'" && (d.get('base-uri') || [])[0] === "'self'");
    ok(`${slug} (${label}): pictures from any secure address still show; styles unchanged`, (d.get('img-src') || []).join(' ') === "'self' data: blob: https:" && (d.get('style-src') || []).join(' ') === "'self' 'unsafe-inline'");
    if (label === 'sample') ok(`${slug}: the same pages give the same rule (a publish is reproducible)`, csp === await publishedCspFor([await renderSnapshot(snap, SITE)], SERVER, HOMES));
  }
}

// ═══ 2. a password page: the lock's script, and the page's own once it opens ═══
{
  const snap = sampleOf('business-classic');
  const drawn = await renderSnapshot(snap, SITE);
  // a script only this page has (say, a booking step), so only its drawn copy can name it
  drawn['about/index.html'] = drawn['about/index.html'].replace('</body>', '<script>document.documentElement.dataset.only="about"</script></body>');
  const lock = await newPageLock('open sesame');
  const sealed = await lockPages(drawn, [{ slug: 'about', title: 'About', ...lock }]);
  const csp = await publishedCspFor([drawn, sealed], SERVER, HOMES);
  const script = directives(csp).get('script-src') || [];
  const lockOnly = await scriptHashes({ 'about/index.html': sealed['about/index.html'] });
  const opened = await scriptHashes({ 'about/index.html': drawn['about/index.html'] });
  ok('a sealed page: the lock\'s script is named', sealed['about/index.html'] !== drawn['about/index.html'] && [...lockOnly].every((h) => script.includes(h)));
  ok('a sealed page: its own scripts are named too, for when it opens', opened.size > 0 && [...opened].every((h) => script.includes(h)));
  const withoutDrawn = directives(await publishedCspFor([sealed], SERVER, HOMES)).get('script-src') || [];
  ok('(which is why the drawn copy is read: from the sealed map alone they would be missing)', [...opened].some((h) => !withoutDrawn.includes(h)));
}

// ═══ 3. pages that need more keep the old rule ═══
{
  const page = (body) => ({ 'index.html': `<!doctype html><html><head></head><body>${body}</body></html>` });
  const plain = await publishedCspFor([page('<script>document.body.dataset.x=1</script>')], SERVER, HOMES);
  ok('a page with our own script only gets the tight rule', plain !== PUBLISHED_CSP_RESPONSE);
  ok('a script loaded from another address keeps the old rule', await publishedCspFor([page('<script src="https://cdn.example.net/x.js"></script>')], SERVER) === PUBLISHED_CSP_RESPONSE);
  ok('so does one loaded with no scheme (//host)', await publishedCspFor([page('<script src="//cdn.example.net/x.js"></script>')], SERVER) === PUBLISHED_CSP_RESPONSE);
  ok('a script of the site\'s own file is fine (self)', await publishedCspFor([page('<script src="/assets/a.js"></script>')], SERVER) !== PUBLISHED_CSP_RESPONSE);
  ok('a script that loads code from elsewhere (an ad tag) keeps the old rule',
    await publishedCspFor([page("<script>var s=document.createElement('script');s.src='https://www.googletagmanager.com/gtag/js?id=G-X';document.head.appendChild(s)</script>")], SERVER) === PUBLISHED_CSP_RESPONSE);
  ok('a script that only calls our server is fine', await publishedCspFor([page(`<script>fetch('${SERVER}/functions/v1/presence/x')</script>`)], SERVER) !== PUBLISHED_CSP_RESPONSE);
  ok('our server is known by its name, with or without a port', await publishedCspFor([page("<script>fetch('http://127.0.0.1:4799/functions/v1/presence/x')</script>")], 'http://127.0.0.1:4799') !== PUBLISHED_CSP_RESPONSE);
  ok('an inline handler keeps the old rule', await publishedCspFor([page('<button onclick="go()">Go</button>')], SERVER) === PUBLISHED_CSP_RESPONSE);
  ok('a javascript: link keeps the old rule', await publishedCspFor([page('<a href="javascript:go()">Go</a>')], SERVER) === PUBLISHED_CSP_RESPONSE);
  ok('search data and JSON-LD never run, so they are not named, and their addresses don\'t count',
    await publishedCspFor([page('<script type="application/ld+json">{"url":"https://schema.org/x"}</script><script type="application/json">{"u":"https://x.example"}</script>')], SERVER) === "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://fnhost.supabase.co; form-action 'self' https://fnhost.supabase.co; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  const crlf = directives(await publishedCspFor([page('<script>a()\r\nb()</script>')], SERVER)).get('script-src') || [];
  const lf = directives(await publishedCspFor([page('<script>a()\nb()</script>')], SERVER)).get('script-src') || [];
  ok('line ends are read the way the browser reads them', crlf.join() === lf.join() && crlf.length === 2);
}

// ═══ 4. the addresses a site answers on ═══
ok('homes: the domain, with and without www, and the Netlify address',
  JSON.stringify(HOMES) === JSON.stringify(['https://client.example', 'https://www.client.example', `https://presence-${SITE_ID.replace(/-/g, '').slice(0, 12)}.netlify.app`]));
ok('homes: a www domain adds the bare one', JSON.stringify(siteHomes({ id: SITE_ID, custom_domain: 'www.client.example' }).slice(0, 2)) === JSON.stringify(['https://www.client.example', 'https://client.example']));
ok('homes: a site not hosted yet has none', siteHomes({ id: SITE_ID }).length === 0);

// ═══ 5. the header file, and the publish wiring ═══
{
  const tight = "default-src 'self'; script-src 'self'";
  const merged = mergeSecurityHeaders('/assets/*\n  Cache-Control: public\n', tight);
  ok('the publish writes the site\'s own rule into _headers', merged.includes(`Content-Security-Policy: ${tight}\n`) && merged.includes('/assets/*\n  Cache-Control: public'));
  ok('without one (the offline page) the header is as before', mergeSecurityHeaders('').includes(`Content-Security-Policy: ${PUBLISHED_CSP_RESPONSE}\n`));
  const pub = read('supabase/functions/presence/routes/publish.ts');
  const at = (s) => pub.indexOf(s);
  ok('publish: the rule is worked out from the drawn pages and the sealed ones', /const drawn = fileMap;[^\n]*\n\s*fileMap = await lockPages\(fileMap[^\n]*\n\s*csp = await publishedCspFor\(\[drawn, fileMap\], fnBase \? new URL\(fnBase\)\.origin : '', siteHomes\(site\)\);/.test(pub));
  ok('publish: and goes into _headers before anything deploys', at('csp = await publishedCspFor(') > 0 && at(", csp);") > at('csp = await publishedCspFor(') && at(", csp);") < at('deployFileMap('));
  ok('the pages\' own <meta> rule is unchanged (the canvas and the goldens draw as before)', read('supabase/functions/presence/lib/render.ts').includes(`export const PUBLISHED_CSP = "default-src 'self' https: data: 'unsafe-inline'; object-src 'none'; base-uri 'self'";`));
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) Deno.exit(1);
