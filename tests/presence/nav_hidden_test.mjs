// ── Builder list item 54 (Nov 2026): a studio hides the menu areas it doesn't use ──
//   deno run --allow-read --allow-env tests/presence/nav_hidden_test.mjs
//
// The studio's hidden list makes those sections ⌘K-only at studio level (the shell
// draws a section only when it has a visible item), never inside a client and never
// for a plain owner, and the list is cleaned on the way in and out.
import { buildNav, normalizeHidden, HIDEABLE_SECTIONS } from '../../supabase/functions/presence/lib/navigation.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const CAPS = ['edit', 'publish', 'invite', 'configure', 'view_all'];
const studio = (extra = {}) => ({ role: 'business_owner', edition: 'presence', capabilities: CAPS, isAgency: true, isOperator: false, editionKey: 'agency', scoped: false, siteLive: true, ...extra });
const drawn = (nav) => nav.filter((s) => s.items.some((i) => !i.hidden) && !s.utility).map((s) => s.key);
const keysOf = (nav) => nav.flatMap((s) => s.items.map((i) => i.key));

// the choices Settings shows: Home and Settings are never among them
ok('six hideable areas', HIDEABLE_SECTIONS.length === 6);
ok('Home is not hideable', !HIDEABLE_SECTIONS.some((h) => h.key === 'home'));
ok('Settings is not hideable', !HIDEABLE_SECTIONS.some((h) => h.key === 'settings'));
ok('every choice has words', HIDEABLE_SECTIONS.every((h) => h.label && h.what));

// cleaning the stored list
ok('normalize: the stored shape {hidden:[...]}', JSON.stringify(normalizeHidden({ hidden: ['sites', 'files'] })) === '["sites","files"]');
ok('normalize: a bare list', JSON.stringify(normalizeHidden(['pipeline'])) === '["pipeline"]');
ok('normalize: unknown keys and repeats drop', JSON.stringify(normalizeHidden({ hidden: ['sites', 'home', 'settings', 'sites', 42, 'nope'] })) === '["sites"]');
ok('normalize: nothing stored is nothing', normalizeHidden(null).length === 0 && normalizeHidden('x').length === 0);

// at studio level, hidden sections leave the drawn menu but keep every item for ⌘K
const full = buildNav(studio());
ok('studio level draws Sites and Pipeline by default', drawn(full).includes('sites') && drawn(full).includes('pipeline'));
const less = buildNav(studio({ hiddenSections: ['sites', 'pipeline'] }));
ok('hidden: Sites and Pipeline are not drawn', !drawn(less).includes('sites') && !drawn(less).includes('pipeline'));
ok('hidden: Home, Inbox, Customers still are', ['home', 'inbox', 'customers'].every((k) => drawn(less).includes(k)));
ok('hidden: every item is still there for ⌘K', JSON.stringify(keysOf(less)) === JSON.stringify(keysOf(full)));
ok('hidden: the Sites items are ⌘K-only', less.find((s) => s.key === 'sites').items.every((i) => i.hidden === true));
ok('hidden: utilities are untouched', JSON.stringify(less.filter((s) => s.utility)) === JSON.stringify(full.filter((s) => s.utility)));

// never inside a client, never for an owner
const scoped = buildNav(studio({ scoped: true, hiddenSections: ['files'] }));
ok('inside a client, the hidden list does nothing', drawn(scoped).includes('files'));
const owner = buildNav({ role: 'business_owner', edition: 'presence', capabilities: CAPS, isAgency: false, isOperator: false, editionKey: 'studio_os', hiddenSections: ['pipeline'] });
ok('a plain owner keeps Pipeline', drawn(owner).includes('pipeline'));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ NAV HIDDEN (item 54): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
