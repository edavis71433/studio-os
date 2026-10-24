// ── Deep audit site discovery (Oct 2026) ────────────────────────────────────
// The Free Site Review's deep audit never fetched robots.txt or the sitemap,
// so every site was told "No sitemap.xml found" (−3) and "No robots.txt"
// (−1). Social profiles were found by searching the raw HTML, so Squarespace's
// xmlns:fb attribute counted as a Facebook page and "x.com" matched inside
// "dropbox.com". This suite covers supabase/functions/_shared/site_discovery.ts
// with a stubbed fetch (no network) and checks how clever-api wires it in.
//
//   deno run --allow-read tests/presence/site_discovery_test.mjs
import {
  parseRobotsTxt, sitemapInfo, looksLikeHtml, sameSite, socialProfiles, checkDiscoverability, fetchPublic,
} from '../../supabase/functions/_shared/site_discovery.ts';

const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ── robots.txt ──
const R = (t) => parseRobotsTxt(t, 'https://www.example.com/robots.txt');
ok('robots: "Disallow: /" for * blocks the site', R('User-agent: *\nDisallow: /\n').blocksAll === true);
ok('robots: empty Disallow allows everything', R('User-agent: *\nDisallow:\n').blocksAll === false);
ok('robots: no rules at all allows everything', R('').blocksAll === false);
ok('robots: a Googlebot group overrides *', R('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n').blocksAll === false);
ok('robots: Googlebot blocked even if * is open', R('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nAllow: /\n').blocksAll === true);
ok('robots: Allow /$ beats Disallow /* for the homepage (tie goes to allow)', R('User-agent: *\nDisallow: /*\nAllow: /$\n').blocksAll === false);
ok('robots: agents listed together share the rules', R('User-agent: Bingbot\nUser-agent: *\nDisallow: /\n').blocksAll === true);
ok('robots: other bots blocked does not block Google', R('User-agent: GPTBot\nDisallow: /\n').blocksAll === false);
ok('robots: comments and CRLF are handled', R('# hello\r\nUser-agent: * # all\r\nDisallow: / # nope\r\n').blocksAll === true);
const sq = 'User-agent: *\nDisallow: /config\nDisallow: /search\nDisallow: /account$\nDisallow: /api/\nDisallow: /static/\nDisallow: /*?author=*\nDisallow: /*&author=*\nDisallow: /*?tag=*\n\nSitemap: https://www.example.com/sitemap.xml\n';
ok('robots: a Squarespace robots.txt does not block the site', R(sq).blocksAll === false);
ok('robots: Sitemap lines are collected', eq(R(sq).sitemaps, ['https://www.example.com/sitemap.xml']));
ok('robots: relative Sitemap lines resolve against the site', eq(R('Sitemap: /sitemap_index.xml').sitemaps, ['https://www.example.com/sitemap_index.xml']));
ok('robots: non-http Sitemap values are ignored', eq(R('Sitemap: ftp://example.com/s.xml\nSitemap: javascript:alert(1)').sitemaps, []));

// ── sitemap ──
const urlset = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://www.example.com/</loc></url><url><loc>https://www.example.com/about</loc></url></urlset>';
const index = '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://www.example.com/a.xml</loc></sitemap><sitemap><loc>https://www.example.com/b.xml</loc></sitemap><sitemap><loc>https://www.example.com/c.xml</loc></sitemap></sitemapindex>';
ok('sitemap: a urlset is valid and counted', eq(sitemapInfo(urlset), { valid: true, isIndex: false, locCount: 2 }));
ok('sitemap: a sitemap index is valid', eq(sitemapInfo(index), { valid: true, isIndex: true, locCount: 3 }));
ok('sitemap: an HTML page is not a sitemap', sitemapInfo('<!doctype html><html><body>Not found</body></html>').valid === false);
ok('sitemap: a namespace prefix is fine', sitemapInfo('<ns:urlset xmlns:ns="x"><ns:url><ns:loc>a</ns:loc></ns:url></ns:urlset>').locCount === 1);
ok('html sniff: catches soft-404 pages', looksLikeHtml('\n<!DOCTYPE html><html lang="en">') && !looksLikeHtml('User-agent: *\nDisallow:'));

// ── same site ──
ok('sameSite: www and bare domain', sameSite('www.example.com', 'example.com'));
ok('sameSite: subdomain', sameSite('shop.example.com', 'www.example.com'));
ok('sameSite: look-alike domains are not the same site', !sameSite('example.com.evil.net', 'example.com') && !sameSite('evil-example.com', 'example.com'));

// ── social and business profiles ──
const S = (html, schemas) => socialProfiles(html, 'https://www.example.com/', schemas);
ok('profiles: Squarespace xmlns:fb is not a Facebook page', eq(S('<html xmlns:og="http://opengraphprotocol.org/schema/" xmlns:fb="http://www.facebook.com/2008/fbml" lang="en-US"><body>hi</body></html>'), []));
ok('profiles: "x.com" inside dropbox.com does not count', eq(S('<a href="https://www.dropbox.com/s/abc">file</a><a href="https://netflix.com/title">t</a>'), []));
ok('profiles: a real X profile counts', eq(S('<a href="https://x.com/davisdigital">X</a>'), ['x.com']));
ok('profiles: twitter.com maps to x.com', eq(S('<a class="icon" href="https://twitter.com/davisdigital">t</a>'), ['x.com']));
ok('profiles: share buttons are not profiles', eq(S('<a href="https://www.facebook.com/sharer/sharer.php?u=x">s</a><a href="https://twitter.com/intent/tweet?url=x">t</a><a href="https://www.linkedin.com/shareArticle?mini=true">l</a><a href="https://pinterest.com/pin/create/button/?url=x">p</a>'), []));
ok('profiles: bare platform links (template placeholders) are not profiles', eq(S('<a href="https://www.instagram.com/">ig</a><a href="https://facebook.com">fb</a>'), []));
ok('profiles: link redirectors are not profiles', eq(S('<a href="https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com">x</a>'), []));
ok('profiles: mobile hosts and duplicates fold together', eq(S('<a href="https://m.facebook.com/davis">a</a><a href=\'https://www.facebook.com/davis\'>b</a>'), ['facebook.com']));
ok('profiles: Google Business Profile links count', eq(S('<a href="https://g.page/r/CV98nU10G7WnEBM">r</a>'), ['Google Business Profile'])
  && eq(S('<a href="https://www.google.com/maps/place/Davis">m</a>'), ['Google Business Profile'])
  && eq(S('<a href="https://maps.app.goo.gl/abc123">m</a>'), ['Google Business Profile'])
  && eq(S('<a href="https://share.google/CID49Kp9sJSN0769G">s</a>'), ['Google Business Profile'])
  && eq(S('<a href="https://search.google.com/local/writereview?placeid=x">w</a>'), ['Google Business Profile']));
ok('profiles: a Google search link is not a profile', eq(S('<a href="https://www.google.com/search?q=davis">g</a>'), []));
ok('profiles: JSON-LD sameAs counts', eq(S('<p>no links</p>', [{ '@type': 'ProfessionalService', sameAs: ['https://g.page/r/CV98nU10G7WnEBM', 'https://www.linkedin.com/in/eric-davis-4b1034b8/'] }]), ['Google Business Profile', 'linkedin.com']));
ok('profiles: nested sameAs (in @graph members) counts', eq(S('', [{ '@type': 'WebSite', publisher: { '@type': 'Organization', sameAs: 'https://www.instagram.com/davis' } }]), ['instagram.com']));
ok('profiles: relative and non-web links are ignored', eq(S('<a href="/contact">c</a><a href="mailto:a@b.co">m</a><a href="tel:+1">t</a><a href="javascript:void(0)">j</a>'), []));

// ── fetching (stubbed) ──
const guard = async (raw) => {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol) || /^(127\.|10\.|169\.254\.|192\.168\.)/.test(u.hostname) || u.hostname === 'localhost') throw new Error('blocked');
  return u;
};
const gzip = async (text) => new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
function stub(routes) {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push(url);
    const r = routes[url];
    if (r === 'hang') return new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('timeout', 'TimeoutError'))));
    if (!r) return Promise.resolve(new Response('Not found', { status: 404 }));
    if (r.redirect) return Promise.resolve(new Response(null, { status: r.status || 301, headers: { location: r.redirect } }));
    return Promise.resolve(new Response(r.body, { status: r.status || 200 }));
  };
  return { calls, fetchImpl };
}
const SITE = 'https://www.example.com/';
const D = (routes, budgetMs) => { const s = stub(routes); return checkDiscoverability(SITE, guard, 'test-ua', { fetchImpl: s.fetchImpl, budgetMs }).then((d) => ({ d, calls: s.calls })); };

{
  const { d, calls } = await D({ 'https://www.example.com/robots.txt': { body: sq }, 'https://www.example.com/sitemap.xml': { body: urlset } });
  ok('discovery: robots.txt and sitemap found (the usual Squarespace setup)', d.robotsTxt && !d.robotsTxtBlocksAll && d.sitemapDeclared && d.sitemapXml && d.sitemapUrlCount === 2 && d.sitemapUrl === 'https://www.example.com/sitemap.xml' && !d.sitemapIsIndex);
  ok('discovery: no extra requests when the declared sitemap is /sitemap.xml', calls.length === 2, calls.join(' '));
}
{
  const { d } = await D({ 'https://www.example.com/robots.txt': { body: '<!doctype html><html><body>Page not found</body></html>' } });
  ok('discovery: an HTML answer for /robots.txt is not a robots file', !d.robotsTxt && !d.sitemapXml && !d.sitemapDeclared);
}
{
  const { d } = await D({ 'https://www.example.com/sitemap.xml': { redirect: 'https://www.example.com/sitemap_index.xml' }, 'https://www.example.com/sitemap_index.xml': { body: index } });
  ok('discovery: follows a same-site redirect to a sitemap index', !d.robotsTxt && d.sitemapXml && d.sitemapIsIndex && d.sitemapUrlCount === 3);
}
{
  const { d, calls } = await D({ 'https://www.example.com/robots.txt': { body: 'User-agent: *\nDisallow:\nSitemap: https://evil.example/sitemap.xml\n' }, 'https://www.example.com/sitemap.xml': { body: urlset } });
  ok('discovery: an off-site declared sitemap is reported but never fetched', d.sitemapDeclared && !calls.some((c) => c.includes('evil.example')) && d.sitemapXml && d.sitemapUrl === 'https://www.example.com/sitemap.xml');
}
{
  const { d, calls } = await D({ 'https://www.example.com/robots.txt': { redirect: 'http://127.0.0.1/robots.txt', status: 302 } });
  ok('discovery: a redirect to a private address is never followed', !d.robotsTxt && !calls.some((c) => c.includes('127.0.0.1')));
}
{
  const { d } = await D({ 'https://www.example.com/robots.txt': { body: 'User-agent: *\nDisallow: /\n' } });
  ok('discovery: a robots.txt that blocks everything is flagged', d.robotsTxt && d.robotsTxtBlocksAll);
}
{
  const gz = await gzip(urlset);
  const { d } = await D({ 'https://www.example.com/robots.txt': { body: 'Sitemap: https://www.example.com/sitemap.xml.gz\n' }, 'https://www.example.com/sitemap.xml.gz': { body: gz } });
  ok('discovery: a gzipped sitemap file is read', d.sitemapXml && d.sitemapUrlCount === 2 && d.sitemapUrl === 'https://www.example.com/sitemap.xml.gz');
}
{
  const big = '<urlset>' + '<url><loc>https://www.example.com/p</loc></url>'.repeat(80000) + '</urlset>';   // ~3.7MB
  const { d } = await D({ 'https://www.example.com/sitemap.xml': { body: big } });
  ok('discovery: a very large sitemap is read up to the cap', d.sitemapXml && d.sitemapUrlCount > 40000 && d.sitemapUrlCount < 80000, String(d.sitemapUrlCount));
}
{
  const t0 = Date.now();
  const { d } = await D({ 'https://www.example.com/robots.txt': 'hang', 'https://www.example.com/sitemap.xml': 'hang', 'https://www.example.com/sitemap_index.xml': 'hang' }, 1500);
  const ms = Date.now() - t0;
  ok('discovery: a site that never answers stays within the time budget', !d.robotsTxt && !d.sitemapXml && ms < 3000, `${ms} ms`);
}
{
  const s = stub({ 'https://www.example.com/a': { redirect: 'https://www.example.com/b' }, 'https://www.example.com/b': { redirect: 'https://www.example.com/a' } });
  const r = await fetchPublic('https://www.example.com/a', guard, { ua: 'x', accept: '*/*', timeoutMs: 1000, maxBytes: 1000, fetchImpl: s.fetchImpl });
  ok('fetch: redirect loops stop', r === null && s.calls.length <= 4);
}

// ── wiring in clever-api ──
const src = Deno.readTextFileSync(new URL('../../supabase/functions/clever-api/index.ts', import.meta.url));
ok('clever-api: imports the discovery helpers', /import \{ checkDiscoverability, socialProfiles \} from '\.\.\/_shared\/site_discovery\.ts'/.test(src));
ok('clever-api: deepAudit runs the guarded discovery on the final URL', /checkDiscoverability\(out\.url, assertPublicHttpUrl, BROWSER_UA\)/.test(src) && /if \(disc\) out\.discoverability = disc;/.test(src));
ok('clever-api: social links come from real profile links, not a text search', /out\.local\.socialLinks = socialProfiles\(html, out\.url, schemas\)/.test(src) && !/lc\.includes\(p\)/.test(src));
ok('clever-api: lite PSI keeps Lighthouse 13 checklist details', /details\.type === 'checklist' \? \{ details: \{ type: 'checklist', items: a\.details\.items \} \}/.test(src));

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
