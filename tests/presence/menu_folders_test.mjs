// ── Folders in the menu (builder list item 48, second half, Nov 2026) ──
// A folder is a menu heading with no page of its own: its dropdown lists the pages put in it.
// The editor keeps it in the stored menu as { label, href: "#f-…", folder: true, children }.
// This proves:
//   · the snapshot keeps a folder that holds pages, as { label, href: '', folder, children },
//     drops an empty one, cleans its pages' links like any other, and never nests a folder
//   · the menu draws a folder as a heading that opens its dropdown (focusable, not a link),
//     marks it current on one of its pages, and escapes its name
//   · every template draws it, and the site's other links are unchanged
//
//   deno run --allow-read tests/presence/menu_folders_test.mjs
import { buildSnapshot } from '../../supabase/functions/presence/lib/serializer.ts';
import { renderNavList } from '../../supabase/functions/presence/lib/site_nav.ts';
import { esc, attr } from '../../supabase/functions/presence/lib/markdown.ts';
import { getTemplate, renderSnapshot, listTemplates } from '../../supabase/functions/presence/lib/render.ts';

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) { pass++; } else { fail++; console.log('FAIL  ' + n); } };
const NOW = '2026-11-10T12:00:00Z';
const rows = (settings) => ({ presence_identity: [{ business_name: 'Marlow’s Kitchen' }], presence_locations: [], presence_offerings: [], presence_testimonials: [], presence_faqs: [], presence_posts: [], presence_redirects: [], presence_dev_customizations: [], presence_media: [], presence_reviews: [], presence_content_library: [], presence_settings: [settings] });
const navOf = (settings, slug = 'business-classic') => {
  const t = getTemplate(slug, '1.0.0');
  return buildSnapshot(rows(settings), t.manifest, { templateSlug: slug, templateVersion: '1.0.0', now: NOW }).snapshot;
};
const PAGES = [{ slug: 'catering', title: 'Catering', blocks: [] }, { slug: 'lessons', title: 'Lessons', blocks: [] }];
const STORED = [
  { label: 'Home', href: '/' },
  { label: '  Services  ', href: '#f-ab12cd', folder: true, children: [{ label: 'Catering', href: '/catering/' }, { label: 'Lessons', href: '/lessons/' }, { label: 'Bad', href: 'javascript:alert(1)' }, { label: 'Nested', href: '#f-zz', folder: true }] },
  { label: 'Later', href: '#f-ef34gh', folder: true },
  { label: 'Contact', href: '/contact/' },
];

// ── the snapshot ──
{
  const nav = navOf({ pages: PAGES, nav: STORED }).content.settings.nav;
  ok('a folder with pages is kept as a heading with no link', JSON.stringify(nav[1]) === JSON.stringify({ label: 'Services', href: '', folder: true, children: [{ label: 'Catering', href: '/catering/' }, { label: 'Lessons', href: '/lessons/' }] }));
  ok('an empty folder is left out', !nav.some((x) => x.label === 'Later'));
  ok('the other items are as they were', JSON.stringify(nav.map((x) => x.label)) === JSON.stringify(['Home', 'Services', 'Contact']));
  ok('a link in a folder is cleaned like any other, and a folder never nests', nav[1].children.every((k) => k.href.startsWith('/')) && !JSON.stringify(nav).includes('#f-'));
  ok('a folder with no name is left out', !navOf({ pages: PAGES, nav: [{ label: '  ', href: '#f-1', folder: true, children: [{ label: 'Catering', href: '/catering/' }] }, { label: 'Home', href: '/' }] }).content.settings.nav.some((x) => x.folder));
  ok('an item that only claims to be a folder by its address is just a bad link', !navOf({ pages: PAGES, nav: [{ label: 'Odd', href: '#f-1', children: [{ label: 'Catering', href: '/catering/' }] }, { label: 'Home', href: '/' }] }).content.settings.nav.some((x) => x.label === 'Odd'));
}

// ── the menu ──
{
  const nav = [{ label: 'Home', href: '/' }, { label: 'Services', href: '', folder: true, children: [{ label: 'Catering', href: '/catering/' }, { label: 'Lessons', href: '/lessons/' }] }];
  const html = renderNavList(nav, '/', esc, attr);
  ok('a folder is a dropdown whose name is not a link', html.includes('<li class="has-sub nav-folder"><a role="button" tabindex="0" aria-haspopup="true" style="cursor:pointer">Services<span class="sub-caret" aria-hidden="true">▾</span></a><ul class="subnav">'));
  ok('its pages are links in its dropdown', html.includes('<li><a href="/catering/">Catering</a></li><li><a href="/lessons/">Lessons</a></li></ul></li>'));
  ok('no empty link is drawn for it', !html.includes('href=""'));
  ok('on one of its pages it is marked current', renderNavList(nav, '/lessons/', esc, attr).includes('<a role="button" tabindex="0" aria-current="page"'));
  ok('its name is escaped', renderNavList([{ label: '<img src=x onerror=alert(1)>', href: '', folder: true, children: [{ label: 'A', href: '/a/' }] }], '/', esc, attr).includes('&lt;img src=x onerror=alert(1)&gt;'));
  ok('an empty folder that got this far draws nothing', renderNavList([{ label: 'Later', href: '', folder: true }], '/', esc, attr) === '');
}

// ── every template draws it ──
for (const { slug, version } of listTemplates()) {
  const snap = navOf({ pages: PAGES, nav: STORED }, slug);
  snap.template_version = version;
  const out = await renderSnapshot(snap, { baseUrl: 'https://example.test' });
  const home = out['index.html'] || '', page = out['lessons/index.html'] || '';
  ok(`[${slug}] the folder heads its dropdown on every page`, home.includes('class="has-sub nav-folder"') && page.includes('class="has-sub nav-folder"'));
  ok(`[${slug}] its pages are linked and drawn`, home.includes('href="/catering/"') && home.includes('href="/lessons/"') && page.length > 0);
  ok(`[${slug}] on its page the folder is current`, /<a role="button" tabindex="0" aria-current="page"[^>]*>Services/.test(page));
}

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  menu folders — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
if (!done) Deno.exit(1);
