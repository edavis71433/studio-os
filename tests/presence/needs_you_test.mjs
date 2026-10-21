// ── "Needs you" on the studio home (Oct 2026 home rebuild) — pure tests ──────
// The list shows ONLY what needs the studio's hand: money, enquiries, support,
// late deal steps, broken things, approved plans, unpublished changes — in that
// order, one verb per row. Customer-audience moments and website evidence of
// type seo.*/search.*/accessibility.*/freshness.*/trust.* (other than ssl)
// NEVER appear, however they are handed in.
//
//   deno run --allow-read tests/presence/needs_you_test.mjs
import { buildNeedsYou, capNeedsYou, needsYouPayload, nextBySite, nextByClient, emptyLine, daysBetween, shortDate, ago, NEEDS_YOU_CAP } from '../../supabase/functions/presence/agency/needs_you.ts';

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

const NOW = '2026-10-21T15:00:00Z';
const base = () => ({
  nowIso: NOW,
  links: [{ site_id: 's1', status: 'active' }, { site_id: 's2', status: 'active' }, { site_id: 's3', status: 'archived' }],
  clientNames: { s1: 'Hettie Orange Designs', s2: 'Eric Test', s3: 'Old Client' },
  namesByClient: { c9: 'Claud Beltran' },
  sites: [
    { id: 's1', edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z', custom_domain: 'hettie.example', domain_registrar: 'GoDaddy', domain_expires_at: null },
    { id: 's2', edition: 'presence', status: 'ready', last_published_at: null, custom_domain: null },
    { id: 's3', edition: 'presence', status: 'live', last_published_at: '2026-10-01T00:00:00Z', custom_domain: 'old.example', domain_expires_at: '2026-10-25' },
  ],
});

// ═══ 1. helpers ═══
{
  ok('daysBetween counts whole days from y-m-d text', daysBetween('2026-10-21', '2026-10-24') === 3 && daysBetween('2026-10-24', '2026-10-21') === -3 && daysBetween(null, '2026-10-21') === null);
  ok('shortDate prints "Nov 3"', shortDate('2026-11-03') === 'Nov 3' && shortDate('2026-11-03T10:00:00Z') === 'Nov 3' && shortDate('') === '');
  ok('ago: today · yesterday · N days ago · a date beyond two weeks', ago('2026-10-21T01:00:00Z', '2026-10-21') === 'today' && ago('2026-10-20', '2026-10-21') === 'yesterday' && ago('2026-10-19', '2026-10-21') === '2 days ago' && ago('2026-08-08', '2026-10-21') === 'Aug 8');
}

// ═══ 2. a customer moment NEVER appears; website evidence NEVER appears ═══
{
  const i = { ...base(),
    moments: [{ site_id: 's1', moment_key: 'missing_basics', type: 'needs_attention', headline: 'A few basics are missing.' }, { site_id: 's2', moment_key: 'first_publish', type: 'needs_attention', headline: 'Your website is ready when you are.' }],
    evidence: [
      { site_id: 's1', type: 'seo.title_missing', severity: 'critical', human: '5 pages have no title.' },
      { site_id: 's1', type: 'search.sitemap_missing', severity: 'critical', human: 'No sitemap.' },
      { site_id: 's2', type: 'accessibility.img_alt_missing', severity: 'critical', human: '4 images have no descriptions.' },
      { site_id: 's2', type: 'freshness.stale', severity: 'critical', human: 'Nothing new in 90 days.' },
      { site_id: 's2', type: 'trust.team_info_missing', severity: 'critical', human: 'No faces on the site.' },
    ],
    opportunities: [{ site_id: 's1', area: 'holiday', opportunity: 'Get ready for the holidays.' }],
    reviewReports: [{ site_id: 's1', status: 'open', open_count: 3 }], brandReports: [{ site_id: 's2', status: 'open', open_count: 2 }],
  };
  const rows = buildNeedsYou(i);
  ok('customer moments never appear (they belong to the client’s Today)', rows.length === 0 && !JSON.stringify(rows).includes('basics are missing') && !JSON.stringify(rows).includes('ready when you are'));
  ok('seo/search/accessibility/freshness/trust evidence never appears', !rows.some((r) => /title|sitemap|descriptions|90 days|faces/.test(r.what)));
  ok('growth opportunities and review/brand reports never appear', !JSON.stringify(rows).includes('holiday') && !JSON.stringify(rows).includes('finding'));
  ok('…and the empty line is honest when nothing is owed', needsYouPayload(i).empty_line === 'Everything is paid and published.');
}

// ═══ 3. money sorts first: overdue (most overdue at the top), then due within 7 days ═══
{
  const i = { ...base(),
    invoices: [
      { id: 'i-soon', title: 'Balance', amount_cents: 80000, due_date: '2026-10-24', status: 'open', state: 'upcoming', deal_id: 'd1', deal: 'Hettie site', client_id: 'c1', customer_site_id: 's1', created_at: '2026-10-14T00:00:00Z' },
      { id: 'i-late3', title: 'Deposit', amount_cents: 160000, due_date: '2026-10-18', status: 'open', state: 'overdue', deal_id: 'd9', deal: 'Bacchus rebuild', client_id: 'c9', customer_site_id: null, created_at: '2026-10-10T00:00:00Z' },
      { id: 'i-late1', title: 'Invoice', amount_cents: 30000, due_date: '2026-10-20', status: 'open', state: 'overdue', deal_id: 'd2', deal: 'Eric site', client_id: 'c2', customer_site_id: 's2' },
      { id: 'i-far', title: 'Invoice', amount_cents: 50000, due_date: '2026-11-30', status: 'open', state: 'upcoming', deal_id: 'd3', client_id: 'c2', customer_site_id: 's2' },   // beyond 7 days → not a row
      { id: 'i-proc', title: 'Balance (ACH)', amount_cents: 40000, due_date: '2026-10-01', status: 'open', state: 'processing', processing_since: '2026-10-20T00:00:00Z', deal_id: 'd1', client_id: 'c1', customer_site_id: 's1' },   // paid, settling → never owed
      { id: 'i-arch', title: 'Invoice', amount_cents: 10000, due_date: '2026-10-01', status: 'open', state: 'overdue', deal_id: 'd8', client_id: 'c3', customer_site_id: 's3' },   // archived client → not a row
    ],
    enquiries: [{ id: 'e1', site_id: 's1', name: 'Maria', form_kind: 'quote', created_at: '2026-10-19T09:00:00Z' }],
    support: [{ id: 'sup1', subject: 'the gallery page', project_id: 'p1', created_at: '2026-10-19T00:00:00Z' }],
    serviceLinks: [{ project_id: 'p1', customer_client_id: 'c1', customer_site_id: 's1' }],
    deals: [{ id: 'd9', title: 'Bacchus Kitchen — new site', stage: 'proposal', next_step: 'Book the kickoff call', next_step_at: '2026-08-08', converted_client_id: 'c9', converted_site_id: null, contact_name: 'Claud Beltran' }],
    publishes: [{ site_id: 's2', status: 'failed', created_at: '2026-10-20T00:00:00Z', error_text: 'deploy: Netlify said no' }, { site_id: 's2', status: 'live', created_at: '2026-09-01T00:00:00Z' }],
    connections: [{ site_id: 's1', provider_key: 'google_search_console', status: 'expired' }],
    evidence: [{ site_id: 's1', type: 'trust.ssl_missing', severity: 'critical', human: 'The site has no HTTPS.' }, { site_id: 's1', type: 'seo.title_missing', severity: 'critical', human: '5 pages have no title.' }],
    plans: [{ id: 'pl1', site_id: 's2', title: 'Protect your email', status: 'approved' }, { id: 'pl2', site_id: 's1', title: 'Keep the domain safe', status: 'proposed' }],
    lastChange: { s1: '2026-10-20T12:00:00Z' },
  };
  const rows = buildNeedsYou(i);
  const kinds = rows.map((r) => r.kind);
  ok('overdue money sorts first, most overdue at the top, then due within 7 days', rows[0].key === 'money:i-late3' && rows[1].key === 'money:i-late1' && rows[2].key === 'money:i-soon');
  ok('money rows read "Name — invoice $X is overdue by N days" / "is due Nov 3"', rows[0].name === 'Claud Beltran' && rows[0].what === 'invoice $1,600 is overdue by 3 days' && rows[1].what === 'invoice $300 is overdue by 1 day' && rows[2].what === 'invoice $800 is due Oct 24');
  ok('a money row says when it was sent and carries ONE verb: Resend → the deal’s billing tab', rows[0].when === 'Sent Oct 10 · no payment yet' && rows[0].verb === 'Resend' && rows[0].href === '/crm.html?deal=d9&tab=billing');
  ok('an invoice due beyond 7 days, a settling payment, and an archived client’s invoice are not rows', !rows.some((r) => /i-far|i-proc|i-arch/.test(r.key)));
  ok('the fixed order: money · enquiry · support · deal · broken · plan · publish', kinds.join(',') === 'money,money,money,enquiry,support,deal,broken,broken,broken,plan,publish', kinds.join(','));
  const by = (k) => rows.find((r) => r.key === k);
  ok('enquiry: "new enquiry from Maria", 2 days ago, Reply → the client’s Inbox row', by('enquiry:e1').what === 'new enquiry from Maria' && by('enquiry:e1').when === '2 days ago · quote form' && by('enquiry:e1').verb === 'Reply' && by('enquiry:e1').href === '/inbox.html?client=s1#enquiries?sel=lead:e1');
  ok('support: named by the service link’s customer, Reply → the studio Inbox', by('support:sup1').name === 'Hettie Orange Designs' && by('support:sup1').what === 'support request: the gallery page' && by('support:sup1').verb === 'Reply' && by('support:sup1').href === '/inbox.html#support?sel=sup:sup1');
  ok('deal: the late next step, since its date, Open deal', by('deal:d9').name === 'Claud Beltran' && by('deal:d9').what === 'next step “Book the kickoff call” is 74 days late' && /due Aug 8/.test(by('deal:d9').when) && by('deal:d9').verb === 'Open deal' && by('deal:d9').href === '/crm.html?deal=d9');
  ok('broken: publish failed · SSL missing · connection expired — Fix, scoped to the client', by('broken:publish:s2').what === 'the last publish failed' && by('broken:publish:s2').href === '/presence.html?client=s2#publish'
    && by('broken:ev:s1:trust.ssl_missing').href === '/presence.html?client=s1#domain' && by('broken:conn:s1:google_search_console').what === 'Google Search Console connection has expired' && by('broken:conn:s1:google_search_console').href === '/connections.html?client=s1'
    && rows.filter((r) => r.kind === 'broken').every((r) => r.verb === 'Fix'));
  ok('seo evidence stays out even beside a critical ssl row', !rows.some((r) => /title/.test(r.what)));
  ok('plan: approved-not-applied → Apply; a PROPOSED plan (waiting on the client) is not the studio’s work', by('plan:pl1').verb === 'Apply' && by('plan:pl1').href === '/presence.html?client=s2#foundations' && !by('plan:pl2'));
  ok('publish: unpublished changes → Review', by('publish:s1').what === 'changes are sitting unpublished' && by('publish:s1').verb === 'Review' && by('publish:s1').href === '/presence.html?client=s1#publish');
  ok('every row names a customer, says what in plain words, and carries exactly one verb', rows.every((r) => r.name && r.what && r.verb && r.href && !/undefined|null/.test(r.what + r.when)));
  // the roster's Next: each client's FIRST row
  const ns = nextBySite(rows), nc = nextByClient(rows);
  ok('nextBySite: the client’s first row in order (money before enquiry) — by site and by client id', ns.s1.what === 'invoice $800 is due Oct 24' && ns.s2.what === 'invoice $300 is overdue by 1 day' && nc.c9.what === 'invoice $1,600 is overdue by 3 days' && !ns.s3);
}

// ═══ 4. the cap and "+N more" ═══
{
  const i = { ...base(), enquiries: Array.from({ length: 13 }, (_, k) => ({ id: 'e' + k, site_id: 's1', name: 'Visitor ' + k, created_at: `2026-10-${String(1 + k).padStart(2, '0')}T00:00:00Z` })) };
  const all = buildNeedsYou(i);
  const { rows, more, rest } = capNeedsYou(all);
  ok('the first 8 rows travel; the rest are counted as +N more (and shipped for an in-place expand)', NEEDS_YOU_CAP === 8 && rows.length === 8 && more === 5 && rest.length === 5 && rest[0].key === all[8].key);
  const p = needsYouPayload(i);
  ok('the payload carries rows/more/rest/total and no empty line when there are rows', p.rows.length === 8 && p.more === 5 && p.total === 13 && p.empty_line === '');
  ok('enquiries list oldest first', all[0].key === 'enquiry:e0' && all[12].key === 'enquiry:e12');
}

// ═══ 5. empty state: one honest line ═══
{
  const i = { ...base(), invoices: [{ id: 'i1', amount_cents: 160000, due_date: '2026-11-03', status: 'open', state: 'upcoming', deal_id: 'd9', client_id: 'c9', customer_site_id: null }] };
  ok('nothing due within 7 days → no rows, but the line names who owes what and when', buildNeedsYou(i).length === 0 && emptyLine(i) === 'Claud Beltran owes $1,600, due Nov 3.');
  ok('nothing open at all → "Everything is paid and published."', emptyLine(base()) === 'Everything is paid and published.');
  ok('an undated invoice → "owes $X."', emptyLine({ ...base(), invoices: [{ id: 'i2', amount_cents: 5000, due_date: null, status: 'open', client_id: 'c9' }] }) === 'Claud Beltran owes $50.');
}

// ═══ 6. money edge cases ═══
{
  const i = { ...base(), invoices: [{ id: 'i1', amount_cents: 160000, due_date: '2026-10-21', status: 'open', state: 'upcoming', deal_id: 'd9', client_id: 'c9', customer_site_id: null, created_at: '2026-10-21T08:00:00Z' }],
    reminders: [{ period: 'invremind:i1:due', at: '2026-10-21T09:00:00Z' }] };
  const [r] = buildNeedsYou(i);
  ok('due today reads "is due today"; a reminder that went out today turns Resend into Open record', r.what === 'invoice $1,600 is due today' && r.verb === 'Open record' && r.href === '/crm.html?deal=d9' && r.when === 'Reminder went out today · no payment yet');
  const [r2] = buildNeedsYou({ ...base(), invoices: [{ id: 'i3', amount_cents: 20000, due_date: '2026-10-19', status: 'open', state: 'overdue', deal_id: null, client_id: null, customer_site_id: 's1' }] });
  ok('no deal to resend from → Open record on the client’s billing tab', r2.verb === 'Open record' && r2.href === '/crm.html?client=s1&tab=billing' && r2.name === 'Hettie Orange Designs');
  ok('a domain expiring within 30 days is broken; 31+ days is not (the Website page has the 45-day window)', buildNeedsYou({ ...base(), sites: [{ id: 's1', custom_domain: 'hettie.example', domain_expires_at: '2026-11-15' }] }).length === 1
    && buildNeedsYou({ ...base(), sites: [{ id: 's1', custom_domain: 'hettie.example', domain_expires_at: '2026-11-25' }] }).length === 0);
  ok('a monitor site never gets a publish row', buildNeedsYou({ ...base(), sites: [{ id: 's1', edition: 'monitor', last_published_at: null }], lastChange: { s1: NOW } }).length === 0);
}

// ═══ 7. structure: the route and the page consume the helper ═══
{
  const routes = Deno.readTextFileSync(new URL('../../supabase/functions/presence/agency/routes.ts', import.meta.url));
  const page = Deno.readTextFileSync(new URL('../../agency.html', import.meta.url));
  ok('routes.ts serves GET /agency/needs-you from needsYouPayload and the SAME receivables loader the Outstanding surfaces use', /route === '\/agency\/needs-you'/.test(routes) && /needsYouPayload\(/.test(routes) && /loadReceivables\(own\)/.test(routes));
  ok('the needs-you gather is fixed-cost (no per-site loop)', (() => { const body = routes.slice(routes.indexOf("route === '/agency/needs-you'"), routes.indexOf('// ── client management')); return !/for\s*\(.*await svc/.test(body) && /Promise\.all/.test(body); })());
  ok('agency.html reads /agency/needs-you, never /agency/queues; no Starter kits card; roster chips are All · Needs you · Outstanding · Archived',
    /api\('\/agency\/needs-you'\)/.test(page) && !/agency\/queues/.test(page) && !/kitCardHtml|id="kitList"/.test(page) && /\[\['all','All'\],\['needs','Needs you'\],\['owed','Outstanding'\],\['archived','Archived'\]\]/.test(page));
  ok('agency.html: the roster columns are Name · Status · Next · Outstanding', /\['name','Name'/.test(page) && /\['status','Status'/.test(page) && /\['next','Next'/.test(page) && /\['owed','Outstanding'/.test(page) && !/\['edition','Edition'|\['attention','Waiting'|\['leads','Leads'|\['domain','Domain'/.test(page) && !/search issue\$\{/.test(page));
}

const fails = results.filter((r) => !r.p);
console.log(`\n════ NEEDS YOU: ${results.length - fails.length}/${results.length} PASSED ════`);
if (fails.length) Deno.exit(1);
