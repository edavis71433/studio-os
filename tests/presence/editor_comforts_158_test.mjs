// ── Builder list item 158 (Nov 2026): small comforts in the editor ────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/editor_comforts_158_test.mjs
// Star the versions that matter; a gentle "appear on scroll"; the site's own small icon;
// everything that sits on every page, in one place. (The right-click menu and shortcuts,
// the code to open the draft on a phone and the Coming soon page wait for Eric's yes on
// the drawings.)
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY' })) Deno.env.set(k, v);
const P = '../../supabase/functions/presence';
const { normalizeStars, toggleStar, VERSION_STARS_MAX } = await import(`${P}/routes/publish.ts`);
const { applyMotion, motionOf, MOTION_CSS, MOTION_JS } = await import(`${P}/lib/site_motion.ts`);
const { applySiteIcon, iconPath } = await import(`${P}/lib/site_icon.ts`);
const { validateThemeTokens } = await import(`${P}/lib/devmode.ts`);
const { settingsMediaUses } = await import(`${P}/lib/dam.ts`);
const { SETTINGS_CONTENT_FIELDS, memberWriteNeeds } = await import(`${P}/lib/site_roles.ts`);
const { RESERVED_NAMES } = await import(`${P}/lib/reserved_store.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p || !note ? '' : ' — ' + note}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

// ── stars ──
ok('stars are kept per site, under their own name', RESERVED_NAMES.versionStars === '__version_stars__');
ok('only real version ids, each once', JSON.stringify(normalizeStars({ ids: [A, A.toUpperCase(), 'x', B, 5] })) === JSON.stringify([A, B]));
ok('nothing stored reads as no stars', normalizeStars(null).length === 0 && normalizeStars({ ids: 'no' }).length === 0);
ok('a new star goes first; taking one off keeps the rest', JSON.stringify(toggleStar({ ids: [A] }, B, true).ids) === JSON.stringify([B, A]) && JSON.stringify(toggleStar({ ids: [B, A] }, B, false).ids) === JSON.stringify([A]));
ok('starring twice keeps one star', toggleStar({ ids: [A] }, A, true).ids.length === 1);
ok('at most 200, the oldest falling off', VERSION_STARS_MAX === 200 && toggleStar({ ids: Array.from({ length: 200 }, (_, i) => `cccccccc-0000-4000-8000-${String(i).padStart(12, '0')}`) }, A, true).ids.length === 200);
ok('starring a version is edit, like naming one', memberWriteNeeds('/publishes/stars', 'PUT') === 'edit');
{
  const pub = read('supabase/functions/presence/routes/publish.ts'), idx = read('supabase/functions/presence/index.ts');
  ok('GET /publishes carries the stars beside the list, the list unchanged', /stars: normalizeStars\(stored\) \}, 200, cors\)/.test(pub) && /rows\.map\(\(\{ snapshot_id: _s, \.\.\.pub \}\) => pub\)/.test(pub));
  ok('only a version this site keeps can be starred: a publish or a saved checkpoint', /presence_publishes\?id=eq\.\$\{id\}&site_id=eq\.\$\{site\.id\}/.test(pub) && /presence_launches\?id=eq\.\$\{id\}&site_id=eq\.\$\{site\.id\}&status=eq\.checkpoint/.test(pub));
  ok('a star saves without losing someone else’s (compare-and-swap)', /updateReservedJson\(site\.id, RESERVED_NAMES\.versionStars, \(cur\) => toggleStar\(cur, id, body\.starred\)/.test(pub));
  ok('PUT /publishes/stars is routed', /route === '\/publishes\/stars' && method === 'PUT'\) return handleVersionStar/.test(idx));
}

// ── a gentle appear on scroll ──
{
  const page = '<!doctype html><html><head><title>x</title></head><body><main><section>a</section><section>b</section></main></body></html>';
  const map = { 'index.html': page, 'about/index.html': page, 'robots.txt': 'x', 'menu.pdf': new Uint8Array([1]) };
  ok('off, every page is exactly as it was', applyMotion(map, undefined) === map && applyMotion(map, 'fast') === map && motionOf('gentle') === 'gentle' && motionOf('on') === null);
  const on = applyMotion(map, 'gentle');
  ok('on, each page gets the style in its head and the script before its end', on['index.html'].includes('<style id="dds-motion">') && /<script id="dds-motion-js">[\s\S]*<\/script><\/body>/.test(on['index.html']) && on['about/index.html'].includes('dds-motion'));
  ok('files that aren’t pages are left alone', on['robots.txt'] === 'x' && on['menu.pdf'] === map['menu.pdf']);
  ok('a page with no <main> is left alone, and a page is never done twice', applyMotion({ 'x.html': '<body>no main</body>' }, 'gentle')['x.html'] === '<body>no main</body>' && applyMotion(on, 'gentle')['index.html'] === on['index.html']);
  ok('only visitors whose device allows motion see it', MOTION_CSS.startsWith('@media screen and (prefers-reduced-motion:no-preference)') && /prefers-reduced-motion: reduce/.test(MOTION_JS));
  ok('a section fades only as it rises, never out first', /section\.dds-rise\{opacity:0;transform:translateY\(18px\)\}/.test(MOTION_CSS) && /\.dds-up\{opacity:1;transform:none;transition:opacity/.test(MOTION_CSS));
  ok('nothing hides until the script runs, the first section never waits, and what’s on screen shows at once', !/main>section\{opacity:0/.test(MOTION_CSS) && /\.slice\(1\)/.test(MOTION_JS) && /getBoundingClientRect\(\)\.top<h\)return/.test(MOTION_JS));
  let parses = true; try { new Function(MOTION_JS); } catch (e) { parses = String(e); }
  ok('the script parses, and has no inline handlers', parses === true && !/\bon[a-z]+=/.test(MOTION_JS), String(parses));
  ok('the style setting takes "gentle" and nothing else', validateThemeTokens({ motion: 'gentle' }).tokens.motion === 'gentle' && validateThemeTokens({ motion: 'wild' }).rejected.includes('motion'));
  const render = read('supabase/functions/presence/lib/render.ts');
  ok('published pages get it; the builder’s canvas never moves', /const moved = applySiteIcon\(opts\.allSectionStyles \? drawn : applyMotion\(drawn, tokens\?\.motion\)/.test(render));
}

// ── the site's own small icon ──
{
  const icon = { variants: { w400: '/img/ab12-400.webp', w800: '/img/ab12-800.webp' } };
  ok('the smallest variant a tab can use', iconPath(icon) === '/img/ab12-400.webp' && iconPath({ variants: { w800: '/img/x-800.webp' } }) === '/img/x-800.webp');
  ok('no picture, or an odd address, is no icon', iconPath(null) === null && iconPath({ variants: {} }) === null && iconPath({ variants: { w400: 'https://elsewhere.example/x.png' } }) === null && iconPath({ variants: { w400: '//x.example/y' } }) === null);
  const page = '<head><link rel="icon" href="/favicon.svg" type="image/svg+xml"></head>';
  const map = { 'index.html': page, 'favicon.svg': '<svg/>' };
  ok('with none chosen, every page keeps the template’s letter', applySiteIcon(map, null) === map);
  const out = applySiteIcon(map, icon);
  ok('chosen, every page’s tab shows it, and a phone’s home screen too', out['index.html'] === '<head><link rel="icon" href="/img/ab12-400.webp"><link rel="apple-touch-icon" href="/img/ab12-400.webp"></head>' && out['favicon.svg'] === '<svg/>');
  ok('it counts as on the site, so Files says so and won’t lose it', JSON.stringify(settingsMediaUses({ icon_media_id: A }).get(A)) === JSON.stringify([{ surface: 'brand', label: 'your site icon (in the browser tab)', live: false }]));
  ok('it is part of the look, as the logo is (edit, not configure)', SETTINGS_CONTENT_FIELDS.has('icon_media_id'));
  const ser = read('supabase/functions/presence/lib/serializer.ts'), ds = read('supabase/functions/presence/lib/draft_settings.ts'), content = read('supabase/functions/presence/routes/content.ts');
  ok('a version carries it only when there is one, so every other site is drawn byte for byte as before', /\.\.\.\(settings\.icon_media_id \? \{ icon: ref\(settings\.icon_media_id\) \} : \{\}\)/.test(ser));
  {
    const { draftSettingsOf, settingsBack, settingsFromContent } = await import(`${P}/lib/draft_settings.ts`);
    const took = new Set();
    ok('a restore brings the icon back as that version had it; one without goes back to the letter, as the logo does',
      draftSettingsOf({ icon_media_id: A }).icon_media_id === A && draftSettingsOf({}).icon_media_id === null
      && settingsBack({ logo_media_id: null }, new Set(), took).icon_media_id === null
      && settingsFromContent({ icon: { variants: { w400: '/img/x-400.webp' } } }, () => B).icon_media_id === B && settingsFromContent({}, () => B).icon_media_id === null);
    ok('a picture since deleted from Files comes back as the letter, and is counted', settingsBack({ icon_media_id: A }, new Set([A]), took).icon_media_id === null && took.has(A));
    ok('it is named with the other defaults (0184)', /icon_media_id: null,   \/\/ builder list item 158/.test(ds) && /0161, 0184\): what a/.test(ds));
  }
  ok('Settings reads and saves everything else on a database without 0184', /const OPTIONAL_SETTINGS_COLS = \[ICON_SETTINGS_COLS, /.test(content) && /icon_media_id: \{ kind: 'uuid' \}/.test(content));
  const media = read('supabase/functions/presence/lib/media.ts'), assets = read('supabase/functions/presence/routes/assets.ts');
  ok('deleting a picture in use as the icon is refused, and both reads step down without 0184', /if \(s\.icon_media_id === mediaId\) siteRefs\.push\('your site icon'\)/.test(media) && /\.then\(\(r\) => \(r\.ok \? r : svc\(`presence_settings\?site_id=eq\.\$\{siteId\}&select=logo_media_id,og_media_id,cover_media_id,blocks/.test(media) && /select=\$\{SETTINGS_MEDIA_COLS\},icon_media_id&limit=1`\)\.then\(\(r\) => \(r\.ok \? r :/.test(assets));
  const mig = read('supabase/migrations/0184_site_icon.sql'), pack = read('docs/presence/APPLY-0184-prod.sql');
  ok('migration 0184 adds the one column, and the apply pack is safe to run twice with a check', /add column if not exists icon_media_id uuid/.test(mig) && /add column if not exists icon_media_id uuid/.test(pack) && /select column_name, data_type/.test(pack));
}

// ── the editor and Files ──
{
  const page = read('presence.html'), files = read('files.html');
  ok('Versions: a star on every kept version, and All, Published or Starred', /function verStar\(p\)/.test(page) && /api\("PUT", "\/publishes\/stars", \{ id: p\.id, starred: next \}\)/.test(page) && /\["all", "All"\], \["published", "Published"\], \["starred", "Starred \(" \+ starredN \+ "\)"\]/.test(page));
  ok('Styles › Looks: Still or Gentle motion, with what it does said', /pillRow\(card, "Motion", \[\["Still", ""\], \["Gentle motion", "gentle"\]\]/.test(page) && /saveTokens\(\{ motion: o\[1\] \}/.test(page));
  ok('Styles › Looks: the site icon, shown as a browser tab shows it, with the letter one press away', /function siteIconRow\(\)/.test(page) && /tab\.setAttribute\("role", "img"\)/.test(page) && /"How your site shows in a browser tab: "/.test(page) && /settingsPut\(\{ icon_media_id: id \}\)/.test(page));
  ok('Photos: one press to use a picture as the site icon', /mkAssign\("icon_media_id", "Site icon", "Use as site icon"\)/.test(page));
  ok('Pages: one place for everything on every page, each saying On or Off', /id="pcEvery"/.test(page) && /function pcEvery\(\)/.test(page) && ['Announcement bar', 'Pop-up', 'Phone bar', 'Header and footer', 'Not found page'].every((t) => page.includes(`"${t}"`)));
  ok('Files: Use as site icon on a photo, with the tab preview, saying when it already is', /async function setSiteIcon\(id,isIc\)\{\s*if\(isIc\)\{toast\('Already your site icon'\);return;\}\s*const r=await api\('\/settings','PUT',\{icon_media_id:id\}\)/.test(files) && /class="tabpv"/.test(files) && /is_site_icon: used\.icon/.test(read('supabase/functions/presence/routes/assets.ts')));
}

const passed = results.filter((x) => x.p).length;
console.log(`\n════ EDITOR COMFORTS (item 158, first part): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
