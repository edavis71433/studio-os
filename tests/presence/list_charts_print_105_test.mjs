// ── Sales item 105: charts on a list and a printable list ─────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/list_charts_print_105_test.mjs
// The deal and contact list reads carry found_via for the charts (falling back to
// the older reads); the kit's bar lists count what they are given and nothing
// else; the chart colours stay readable in both themes; the pages wire it all.
import { installFakePostgrest } from './fake_pgrst.mjs';
const SITE = '11111111-1111-4111-8111-111111111111', U = '33333333-3333-4333-8333-333333333333';
const D1 = 'dddddddd-0000-4000-8000-000000000001', D2 = 'dddddddd-0000-4000-8000-000000000002';
const C1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const db = installFakePostgrest();
const S = await import('../../supabase/functions/presence/routes/sales.ts');
const read = (p) => Deno.readTextFile(new URL('../../' + p, import.meta.url));
const [shell, css, pipe, contacts] = await Promise.all([read('shell.js'), read('shell.css'), read('pipeline.html'), read('contacts.html')]);

let pass = 0, fail = 0; const failed = [];
const ok = (n, c, note = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n, note); } };
const site = { id: SITE, client_id: null, status: 'live', edition: 'presence' };
const owner = { kind: 'client', userId: U, email: 'owner@studio.test', jwt: 'jwt-owner', requestId: 't' };
const req = (path) => new Request(`https://fn.test/functions/v1/presence${path}`, { method: 'GET' });
const res = async (r) => ({ status: r.status, body: await r.json().catch(() => null) });
const deal = (id, extra = {}) => ({ id, site_id: SITE, title: 'Deal', stage: 'lead', source: 'manual', expected_value_cents: 0, expected_close: null, contact_id: null, converted_client_id: null, next_step: '', next_step_at: null, found_via: '', deleted_at: null, updated_at: '2026-11-10T10:00:00Z', ...extra });
const contact = (id, extra = {}) => ({ id, site_id: SITE, name: 'Ana', email: 'ana@example.com', phone: '', company: '', client_id: null, found_via: '', job_title: '', phone2: '', address: {}, tags: [], deleted_at: null, updated_at: '2026-11-10T10:00:00Z', ...extra });
// an older database: any read that names found_via is refused, as PostgREST does for a column it doesn't know
async function withoutFoundVia(table, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = decodeURIComponent(String(url));
    if (u.includes(`/rest/v1/${table}?`) && (init.method || 'GET') === 'GET' && /select=[^&]*found_via/.test(u)) return new Response(JSON.stringify({ code: '42703', message: `column ${table}.found_via does not exist` }), { status: 400 });
    return real(url, init);
  };
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const selects = (table) => db.log.filter((l) => l.method === 'GET' && l.url.startsWith(`/rest/v1/${table}?`)).map((l) => (/select=([^&]*)/.exec(l.url) || [])[1] || '');

// ═══ the reads ═══
{
  db.reset({ presence_deals: [deal(D1, { found_via: 'Google' }), deal(D2)], presence_deal_events: [], presence_contracts: [] });
  const r = await res(await S.handleSalesDeals(req('/sales/deals?limit=100'), site, owner, {}));
  ok('deals list: each deal says where it came from', r.status === 200 && r.body.data.find((d) => d.id === D1)?.found_via === 'Google' && r.body.data.find((d) => d.id === D2)?.found_via === '');
  ok('deals list: one read, found_via in its select', selects('presence_deals').length === 1 && /found_via/.test(selects('presence_deals')[0]) && /next_step,next_step_at/.test(selects('presence_deals')[0]));
  db.reset({ presence_deals: [deal(D1, { found_via: 'Google' })], presence_deal_events: [], presence_contracts: [] });
  const old = await withoutFoundVia('presence_deals', async () => res(await S.handleSalesDeals(req('/sales/deals?limit=100'), site, owner, {})));
  ok('before APPLY-0143 the deals list still loads, by the read without found_via', old.status === 200 && old.body.data.length === 1);
}
{
  db.reset({ presence_contacts: [contact(C1, { found_via: 'Referral', tags: ['restaurant'] })] });
  const r = await res(await S.handleSalesContacts(req('/sales/contacts?limit=100&total=1'), site, owner, {}));
  ok('contacts list: each person says how they found you', r.status === 200 && r.body.data[0]?.found_via === 'Referral' && /found_via/.test(selects('presence_contacts')[0]));
  db.reset({ presence_contacts: [contact(C1)] });
  const old = await withoutFoundVia('presence_contacts', async () => res(await S.handleSalesContacts(req('/sales/contacts?limit=100'), site, owner, {})));
  const sel = selects('presence_contacts');
  ok('before APPLY-0143 the contacts list still loads, by a read without found_via', old.status === 200 && old.body.data.length === 1 && sel.some((s) => !/found_via/.test(s)));
}

// ═══ the kit's bar lists (shell.js charts) ═══
{
  const start = shell.indexOf('    function charts(panels, foot) {'), end = shell.indexOf('    // pointing at a row');
  const esc2 = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const charts = start > 0 && end > start ? new Function('esc2', shell.slice(start, end) + '; return charts;')(esc2) : null;
  ok('the kit has charts(panels, foot)', typeof charts === 'function');
  if (charts) {
    const h = charts([
      { title: 'Deals by stage', rows: [{ label: 'New lead', n: 4, extra: '$6,500' }, { label: 'Qualified', n: 0, extra: '$0' }, { label: 'Won', n: 1, extra: '$4,800' }], unit: ['deal', 'deals'], extra: true },
      { title: 'Where they came from', rows: [{ label: 'Google', n: 3 }, { label: 'Not recorded', n: 2, none: true }], unit: ['deal', 'deals'] },
      { title: 'Tags', rows: [], empty: 'No one in this view has a tag yet.' },
    ], 'From the 5 deals in this view.');
    const rows = [...h.matchAll(/<li class="dc-row([^"]*)" data-tip="([^"]*)"><span class="dc-l">([^<]*)<\/span><span class="dc-track" aria-hidden="true"><span class="dc-fill" style="width:(\d+)%"><\/span><\/span><span class="dc-n">(\d+)/g)];
    ok('a row of nothing is left out (Qualified, 0)', rows.length === 4 && !rows.some((m) => m[3] === 'Qualified'));
    ok('bars are as long as their count against the longest row', rows[0][4] === '100' && rows[1][4] === '25' && rows[2][4] === '100' && rows[3][4] === '67');
    ok('the count is written beside every bar, with its word for a screen reader', rows.map((m) => m[5]).join() === '4,1,3,2' && h.includes('<span class="sr-only"> deals</span>') && h.includes('<span class="sr-only"> deal</span>'));
    ok('the second figure (a stage\'s value) only where the panel asks for it', (h.match(/class="dc-v"/g) || []).length === 2 && h.includes('<ul class="dc-bars has-v">') && h.includes('<span class="dc-v">$4,800</span>'));
    ok('"Not recorded" is the grey row', rows[3][1] === ' none' && rows[2][1] === '');
    ok('pointing at a row says its count, value and share of the view', rows[0][2] === 'New lead: 4 deals, $6,500 · 80% of this view' && rows[3][2] === 'Not recorded: 2 deals · 40% of this view');
    ok('an empty panel says so in words', h.includes('<h3>Tags</h3><p class="dc-none">No one in this view has a tag yet.</p>'));
    ok('the footnote says what was counted', h.endsWith('<p class="dc-foot">From the 5 deals in this view.</p>'));
    ok('labels are escaped', charts([{ title: '<b>', rows: [{ label: '<i>x</i>', n: 1 }] }], '').includes('&lt;i&gt;x&lt;/i&gt;'));
  }
  ok('the kit exports charts, chartTips and printList', /charts: charts, chartTips: chartTips, printList: printList \};/.test(shell));
  ok('printList hides the page while it prints and gives it back after (afterprint, or the next tap or key)', /document\.body\.setAttribute\('data-print', 'list'\)/.test(shell) && /window\.addEventListener\('afterprint', back\)/.test(shell) && /document\.addEventListener\('pointerdown', back, true\)/.test(shell));
}

// ═══ colours: readable in both themes (WCAG 3:1 for a mark against what is next to it) ═══
{
  const lum = (h) => { const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const tok = (block, name) => { const h = (new RegExp(`--dds-${name}:\\s*#([0-9a-f]{6}|[0-9a-f]{3})\\b`).exec(block) || [])[1]; return h ? '#' + (h.length === 3 ? [...h].map((c) => c + c).join('') : h) : undefined; };
  const light = /:root\[data-theme="light"\]\{[^}]*\}/.exec(css)?.[0] || '', dark = /:root\[data-theme="dark"\]\{[^}]*\}/.exec(css)?.[0] || '';
  for (const [name, b] of [['light', light], ['dark', dark]]) {
    const card = tok(b, 'card'), bar = tok(b, 'chart'), none = tok(b, 'chart-none'), track = tok(b, 'chart-track');
    ok(`${name}: the bar stands out from the card and the track`, bar && ratio(bar, card) >= 3 && ratio(bar, track) >= 3, `${bar} on ${card}/${track}`);
    ok(`${name}: the grey "Not recorded" bar stands out from its track`, none && ratio(none, track) >= 3, `${none} on ${track}`);
  }
  const count = (name) => (css.match(new RegExp(`--dds-${name}:`, 'g')) || []).length;
  ok('the chart colours sit in all four theme blocks', count('chart') === 4 && count('chart-none') === 4 && count('chart-track') === 4);
  ok('on paper only the list shows, and never on screen', css.includes('body[data-print="list"]>*:not(#ddsPrint){display:none!important}') && css.includes('#ddsPrint{display:none}'));
}

// ═══ the pages ═══
{
  ok('Pipeline: the charts repaint with the meta line, so every search, filter and chip moves them', /el\.textContent=m;\n  paintCharts\(\);/.test(pipe));
  ok('Pipeline: the board counts its open cards, the list and table their filtered deals', /const dealsInView=\(\)=>VIEW==='board'\?boardVisible\(\):visibleDeals\(\);/.test(pipe));
  ok('Pipeline: the list and the table each have one order, which the print reads too', /const list=listOrder\(visibleDeals\(\)\);/.test(pipe) && /const list=tableOrder\(visibleDeals\(\)\);/.test(pipe) && /if\(VIEW==='table'\)return tableOrder\(list\);/.test(pipe));
  ok('Pipeline: on a phone Charts and Print are in More', /#colsWrap,#chartsBtn,#printBtn\{display:none!important\}/.test(pipe) && /data-more="charts"/.test(pipe) && /data-more="print"/.test(pipe));
  ok('Pipeline: Charts is remembered', /const CHARTS_KEY='dds-charts:pipeline';/.test(pipe));
  ok('Contacts: the charts repaint with the list (a search, a tag, Show more)', (contacts.match(/paintCharts\(\);\n\}/g) || []).length === 2);
  ok('Contacts: Print first loads the rest of the view, up to 1,000 people', /for\(let i=0;i<10&&moreToLoad\(\);i\+\+\)/.test(contacts) && /if\(!r\.ok\|\|!takePage\(r,s\)\)break;/.test(contacts));
  ok('Contacts: Show more and Print share one page-append', /if\(!takePage\(r,s\)\)\{renderListZone\(\);return;\}/.test(contacts));
  ok('Contacts: the tools stay at the studio level with the rest of the header\'s tools', /\$\{inClient\(\)\?'':`<div class="ltools">[^`]*id="chartsBtn"[^`]*id="printBtn"/.test(contacts));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('Failed:\n  ' + failed.join('\n  ')); Deno.exit(1); }
