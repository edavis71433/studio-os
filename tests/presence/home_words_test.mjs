// ── Home, the Inbox, Help and the account menu say what is true (list item 96) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/home_words_test.mjs
// Home's Needs you gave an August enquiry a bare date, so it looked as fresh as last
// week's, and nothing let the studio clear what had gone stale; the Inbox counted the
// same old rows as waiting. Home's top row said "Platform: 3 areas need a look", staff
// wording on the owner's page, under the title "Studio". Help sent a studio to Today
// (which forwards it) and linked Customers to an empty record picker; the account menu
// showed codes ("business owner · presence"); the client card had two buttons to Home.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const { ago, needsYouPayload, OLD_DAYS } = await import('../../supabase/functions/presence/agency/needs_you.ts');

// ═══ how old: words, not a bare date ═══
{
  const T = '2026-11-08';
  ok('two weeks or less in days, as before', ago('2026-11-06', T) === '2 days ago' && ago('2026-10-25', T) === '14 days ago');
  ok('then weeks', ago('2026-10-24', T) === '2 weeks ago' && ago('2026-09-13', T) === '8 weeks ago');
  ok('then months, then "over a year"', ago('2026-09-09', T) === '2 months ago' && ago('2026-07-01', T) === '4 months ago' && ago('2025-10-01', T) === 'over a year ago');
  ok('a month is the line for "old"', OLD_DAYS === 30);
}

// ═══ which items Home can clear ═══
const NOW = '2026-11-08T12:00:00.000Z';
const C1 = 'c1c1c1c1-0000-4000-8000-000000000001', C2 = 'c2c2c2c2-0000-4000-8000-000000000002';
const base = {
  nowIso: NOW,
  links: [{ site_id: C1, status: 'active' }, { site_id: C2, status: 'archived' }],
  clientNames: { [C1]: 'Harbor Cafe' },
};
{
  const p = needsYouPayload({
    ...base,
    enquiries: [
      { id: 'e-old', site_id: C1, name: 'Ana', created_at: '2026-08-02T10:00:00Z' },     // three months: old
      { id: 'e-new', site_id: C1, name: 'Ben', created_at: '2026-11-01T10:00:00Z' },     // a week: not old
      { id: 'e-arch', site_id: C2, name: 'Cy', created_at: '2026-07-01T10:00:00Z' },     // an archived client's: not on the list at all
    ],
    support: [
      { id: 's-stale', subject: 'Logo', created_at: '2026-07-03T09:00:00Z', updated_at: '2026-07-04T09:00:00Z' },   // no word for four months
      { id: 's-live', subject: 'Hours', created_at: '2026-07-03T09:00:00Z', updated_at: '2026-11-05T09:00:00Z' },   // opened in July, answered this week
    ],
    own: { site_id: 'own', enquiries: [
      { id: 'o-1', name: 'Dee', email: 'dee@example.com', status: 'new', tier: 'needs_you', created_at: '2026-09-20T10:00:00Z' },
      { id: 'o-2', name: 'Dee', email: 'dee@example.com', status: 'new', tier: 'needs_you', created_at: '2026-08-15T10:00:00Z' },
    ], messages: [], notices: [], deals: [] },
  });
  const rows = [...p.rows, ...p.rest];
  const row = (key) => rows.find((r) => r.key === key);
  ok('an old client enquiry says how old it is', /^3 months ago/.test(row('enquiry:e-old')?.when || ''), row('enquiry:e-old')?.when);
  ok('a support request still says when it was opened, in words', row('support:s-stale')?.when === 'Opened 4 months ago', row('support:s-stale')?.when);
  const items = p.old?.items || [];
  const has = (kind, id) => items.some((i) => i.kind === kind && i.ids.includes(id));
  ok('old: the enquiry from August, with its client’s account to clear it in', items.some((i) => i.kind === 'enquiry' && i.site_id === C1 && i.ids.join() === 'e-old'));
  ok('old: not last week’s enquiry, nor an archived client’s', !has('enquiry', 'e-new') && !has('enquiry', 'e-arch'));
  ok('old: a support request with no word on it for a month, not one answered this week', has('support', 's-stale') && !has('support', 's-live'));
  ok('old: one person’s own enquiries go together, every one of them', items.some((i) => i.kind === 'enquiry' && i.site_id === null && i.ids.slice().sort().join() === 'o-1,o-2'));
  ok('the count is the rows, not the messages in them', p.old.count === 3 && items.length === 3, JSON.stringify(p.old));
}
{
  // the list shows 8 and carries 40 more; the old count covers the whole list
  const many = Array.from({ length: 60 }, (_, n) => ({ id: `e${n}`, site_id: C1, name: `P${n}`, created_at: '2026-08-01T10:00:00Z' }));
  const p = needsYouPayload({ ...base, enquiries: many });
  ok('old counts every row, past the 48 the page is sent', p.total === 60 && p.rows.length + p.rest.length === 48 && p.old.count === 60);
}
{
  const p = needsYouPayload({ ...base, enquiries: [{ id: 'x', site_id: C1, name: 'Eve', created_at: '2026-11-07T10:00:00Z' }] });
  ok('nothing old: the count is 0', p.old.count === 0 && p.old.items.length === 0);
}

// ═══ the pages ═══
const ag = read('agency.html');
ok('Home is titled Home, as the menu says', /<title>Home — Studio OS<\/title>/.test(ag));
ok('Home says how many have waited over a month, and offers to clear them', /\$\{old\} of these \$\{old===1\?'has':'have'\} waited over a month\. <button type="button" class="linkbtn" id="needsClearOld">/.test(ag));
ok('clearing asks first, in place', /k\.confirmIn\(btn,\{text:`Clear \$\{n\} item/.test(ag) && /if\(!n\|\|!k\|\|!k\.confirmIn\)return;/.test(ag));
ok('an enquiry is marked read inside its client’s account; a support request is closed', /apiSend\('POST','\/forms\/inbox\/'\+encodeURIComponent\(id\),\{status:'read'\},it\.site_id\|\|''\)/.test(ag) && /apiSend\('PATCH','\/support\/'\+encodeURIComponent\(id\),\{status:'closed'\}\)/.test(ag) && /if\(site\)h\['x-dds-scope-site'\]=site;/.test(ag));
ok('then the list is read fresh', /mountNeeds\(true\);/.test(ag) && /api\('\/agency\/needs-you'\+\(fresh\?'\?fresh=1':''\)\)/.test(ag));
ok('the platform line left Home', !/healthDoor|healthLine|\/admin\/health-center/.test(ag));
ok('the role reads as words', /account_manager:'Account manager'/.test(ag) && /● \$\{esc\(roleWords\(ME&&ME\.role\)\)\}/.test(ag));

const inbox = read('inbox.html');
ok('the Inbox says how many waiting ones are over a month old', /waiting for a reply\$\{oldN\?`, \$\{oldN\} over a month old`:''\}/.test(inbox) && /\$\{newN\} new\$\{oldN\?`, \$\{oldN\} over a month old`:''\}/.test(inbox));

const shell = read('shell.js');
ok('the account menu names the role and the plan in words', /business_owner: 'Owner', business_staff: 'Team member', client_reviewer: 'Client'/.test(shell) && /CTX\.edition_name \+ ' plan'/.test(shell) && !/role\.replace\(\/_\/g, ' '\), edition\]/.test(shell));
ok('the client card has one way back', />Back to studio<\/a>/.test(shell) && !/>Switch client<\/a>/.test(shell) && !/>Exit to studio<\/a>/.test(shell));

const help = read('help.html');
ok('Help’s map links what the menu has: Customers, not the record picker', /<a href="\/customers\.html">Customers<\/a>/.test(help) && !/<a href="\/crm\.html">Customers<\/a>/.test(help));
ok('a studio gets its own map, starting at Home', /id="map-studio" hidden>For a studio, <a href="\/agency\.html">Home<\/a>/.test(help) && /if \(!ctx \|\| !ctx\.is_agency\) return;/.test(help));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) Deno.exit(1);
