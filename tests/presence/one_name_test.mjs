// ── One name per thing (list item 92) ────────────────────────────────────────
//   deno run --allow-read tests/presence/one_name_test.mjs
// The same thing went by two names on screen: the Versions tab was "Past dates" in
// Edit mode and "History" on the publish page; Edit site was still "Design"; Files
// was "photographs"; the phone's "Menu" button opened a sheet called Sections (and
// on a restaurant's phone "Menu" is also the dishes); updates were "broadcasts";
// customers were "clients". This keeps the old names off the pages and out of the
// server's own sentences. Comments and code names can keep them.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// The words a person sees: string literals and text between tags, comments left out.
const shown = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');

const CHECKS = [
  ['presence.html', ['>Past dates<', '(Design →', '"Business & settings"', '["design", "Design"]', 'No photographs in', 'media: "photographs"', 'and History will show', 'aria-pressed="false">Menu</button>']],
  ['inbox.html', ['You sent a broadcast']],
  ['crm.html', ['You sent a broadcast']],
  ['broadcasts.html', ['Recent broadcasts', 'broadcast history', 'Refresh broadcasts']],
  ['shell.js', ["'Send a broadcast'"]],
  ['agency.html', ["'No clients yet.'", "'No clients match that.'"]],
  ['analytics.html', ["'No clients yet'", ">All clients<", "title:'Clients'", 'Every client is current', 'Add your first client', 'Client by client', 'Across your clients', 'the client list', 'client-by-client', 'with this client', 'count client by client']],
  ['supabase/functions/presence/analytics/compose.ts', ["'No clients yet.'", "clients are quiet", "of your ${total} clients"]],
  ['supabase/functions/presence/routes/analytics.ts', ["'No clients yet.'"]],
  ['supabase/functions/presence/crm/activity.ts', ['You sent a broadcast']],
];
for (const [file, olds] of CHECKS) {
  const src = shown(read(file));
  for (const old of olds) ok(`${file}: no "${old}"`, !src.includes(old));
}
// and the new names are where the old ones were
const presence = read('presence.html');
ok('Edit mode’s past-versions button says Versions', /data-dcmode="timewarp"[^>]*><span class="dc-dk-l">Versions<\/span><\/button>/.test(presence));   // the dock item: an icon is drawn in front of the word at run time
ok('the phone dock’s button is named for the sheet it opens', /data-tab="sections" aria-pressed="false">Sections<\/button>/.test(presence) && /<h2>Sections<\/h2>/.test(presence));
ok('Find anything takes the places’ names from the menu', /function findPlaces\(\) \{\s*return SITE_TABS\.filter/.test(presence) && /\["design", "Edit site"\]/.test(presence));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
