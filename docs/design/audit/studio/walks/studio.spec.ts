import { test, expect, Page } from '@playwright/test';
import { Walk, shell, studio } from './studio';
import { MARLOW_SITE, DEAL, WON_DEAL, PID, CONNECTIONS } from './fixtures';

// The ten studio jobs (docs/design/STUDIO-AUDIT-2026-10.md §3). Each starts where the
// agency owner starts: agency.html, the landing page for an agency account.

const palette = async (page: Page, q: string) => {
  await page.locator('#dds-search').click();
  await page.locator('.dds-palette input').fill(q);
  await page.waitForTimeout(600);
  const hits = await page.locator('.dds-palette .res').allInnerTexts();
  await page.keyboard.press('Escape');
  return hits.map((h) => h.replace(/\n/g, ' / '));
};
const profile = async (page: Page, w: Walk, item: string) => {
  await w.click(page.locator('#dds-profile'), 'Account menu (overflow)');
  await w.click(page.locator('.dds-pop a.row', { hasText: item }), item + ' (overflow)');
};

test('S0 the studio home — what the agency owner lands on', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's0-home');
  await w.start('/agency.html');
  await w.shot('1-agency');
  const nav = await shell(page).locator('.dds-nav').innerText().catch(() => '');
  w.note(`primary bar: ${nav.replace(/\s+/g, ' ').trim()}`);
  for (const q of ['client', 'add client', 'new client', 'invite', 'team', 'billing', 'plan', 'health', 'kit', 'marlow']) {
    const hits = await palette(page, q);
    w.note(`⌘K "${q}" → ${hits.length} ${JSON.stringify(hits.slice(0, 4))}`);
  }
  await w.click(page.locator('#dds-profile'), 'Account menu');
  w.note(`overflow rows: ${JSON.stringify(await page.locator('.dds-pop a.row').allInnerTexts())}`);
  await w.shot('2-overflow');
  await page.keyboard.press('Escape');
  await page.locator('.client, tr[data-open]').first().scrollIntoViewIfNeeded().catch(() => {});
  w.finish();
});

test('S1 onboard a new client from zero (Customers → Add a customer)', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's1-onboard');
  await w.start('/agency.html');
  w.note(`agency.html has ${await page.getByRole('button', { name: /add/i }).count()} "add" buttons`);
  await w.click(shell(page).getByRole('button', { name: /^Customers/ }), 'Customers (sidebar section)');
  await w.click(shell(page).getByRole('link', { name: 'Customers', exact: true }), 'Customers');
  await w.shot('1-roster');
  await w.click(page.locator('#addCust'), '+ Add a customer');
  await w.shot('2-dialog');
  await w.type(page.locator('#cu-name'), 'Jo Park', 'their name');
  await w.type(page.locator('#cu-email'), 'jo@parkflorist.com', 'email');
  await w.type(page.locator('#cu-biz'), 'Park Florist', 'business name');
  w.note(`kind of work default: "${await page.locator('#cu-edition option:checked').innerText()}"`);
  await w.click(page.locator('#cu-submit'), 'Set up + invite');
  await w.shot('3-invited');
  w.note(`done screen: ${(await page.locator('#cust-done').innerText()).replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  await w.click(page.locator('#cu-close'), 'Done');
  w.note('next: the new row has "Open record" and "Their website"; a starter kit is applied from agency.html (Studio → Apply a kit… → …to client → Apply = 3 more clicks); nothing is published and no domain is connected');
  w.finish();
});

test('S1b onboard from a won deal (Pipeline → Convert)', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's1b-convert');
  await w.start('/agency.html');
  await w.click(shell(page).getByRole('link', { name: 'Pipeline' }), 'Pipeline');
  await w.shot('1-pipeline');
  await w.click(page.getByText('Bright Dental — redesign').first(), 'the won deal');
  await w.click(page.getByRole('tab', { name: 'Billing' }).or(page.getByRole('button', { name: 'Billing' })), 'Billing tab');
  await page.locator('#convert').scrollIntoViewIfNeeded().catch(() => {});
  await w.shot('2-convert');
  await w.click(page.locator('#convert'), 'Convert — set up their workspace');
  await w.shot('3-plan');
  const yes = page.getByRole('button', { name: /Yes, add them/ });
  if (await yes.count()) { await w.click(yes, 'Yes, add them as my customer'); await w.shot('4-converted'); }
  w.finish();
});

test('S2 find a client and open their workspace (drill in, exit)', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's2-drill');
  await w.start('/agency.html');
  const marlow = page.locator('tr', { hasText: 'Marlow’s Kitchen' });
  w.note(`row says: ${(await marlow.innerText()).replace(/\s+/g, ' ').trim()}`);
  await w.click(marlow.getByRole('button', { name: 'Their website' }), 'Their website (row action)');
  await w.shot('1-scoped-website');
  const bar = page.locator('#dds-ctxbar');
  w.note(`context bar: ${(await bar.innerText().catch(() => '(none)')).replace(/\s+/g, ' ').trim()}`);
  w.note(`brand: ${(await shell(page).locator('.dds-brand').innerText()).replace(/\s+/g, ' ').trim()}`);
  w.note(`primary bar scoped: ${(await shell(page).locator('.dds-nav').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()}`);
  await w.click(bar.getByRole('link', { name: 'Switch client' }), 'Switch client (context bar)');
  await w.shot('2-switch-client');
  w.note(`"Switch client" lands on ${new URL(page.url()).pathname} — h1 "${await page.locator('h1').first().innerText()}"`);
  await w.click(page.locator('tr', { hasText: 'Bright Dental' }).getByRole('button', { name: 'Their website' }), 'Their website (Bright Dental)');
  await w.click(page.locator('#dds-ctxbar').getByRole('link', { name: 'Exit to Studio' }), 'Exit to Studio');
  w.note(`back on ${new URL(page.url()).pathname}`);
  w.finish();
});

test('S2b open a client’s record from the Studio', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's2b-record');
  await w.start('/agency.html');
  await w.click(page.locator('tr', { hasText: 'Marlow’s Kitchen' }).getByRole('button', { name: 'Open record' }), 'Open record (row action)');
  await w.shot('1-record');
  w.note(`record URL ${new URL(page.url()).search}; action bar: ${JSON.stringify(await page.locator('#actbar .abtn').allInnerTexts())}`);
  w.note(`tabs: ${JSON.stringify(await page.getByRole('tab').allInnerTexts())}`);
  w.finish();
});

test('S3 publish a change for a client', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's3-publish-for-client');
  await w.start('/agency.html');
  await w.click(page.locator('tr', { hasText: 'Marlow’s Kitchen' }).getByRole('button', { name: 'Their website' }), 'Their website');
  const bi = shell(page).getByRole('link', { name: 'Business info' });
  if (!(await bi.isVisible().catch(() => false))) await w.click(shell(page).getByRole('button', { name: /^Website/ }), 'Website (sidebar section)');
  else w.note('the Website section is already open in the scoped builder — no section click');
  await w.click(bi, 'Business info');
  await w.type(page.locator('#view-business').getByRole('textbox').nth(1), 'Neighbourhood kitchen, open late', 'tagline');
  await w.click(page.locator('#btnPublish'), 'Publish · 2');
  await w.shot('1-ritual');
  const ritual = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  w.note(`ritual mentions the client by name: ${/Marlow/.test(ritual) ? 'yes' : 'NO'}; says "your site"/"you": ${/your (live )?site|came from you/i.test(ritual) ? 'yes' : 'no'}`);
  await w.click(page.getByRole('button', { name: /Publish these 2 changes/ }), 'Publish these 2 changes');
  await w.shot('2-published');
  w.note(`receipt: ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').match(/.{0,120}(came from you|published|live).{0,120}/i)?.[0] || ''}`);
  w.finish();
});

test('S4 connect Search Console for a client (the operator OAuth path)', async ({ page }) => {
  await studio(page);
  let connectScope = '';
  await page.route('**/functions/v1/presence/connections/google_search_console/connect', (route) => {
    connectScope = route.request().headers()['x-dds-scope-site'] || '';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { mode: 'oauth', authorize_url: '/connections-callback.html?code=abc&state=xyz', state: 'xyz' } }) });
  });
  let cbScope = '';
  await page.route('**/functions/v1/presence/connections/google_search_console/callback', (route) => {
    cbScope = route.request().headers()['x-dds-scope-site'] || '';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { connected: true, message: 'Connected.' } }) });
  });
  const w = new Walk(page, 's4-connect-for-client');
  await w.start('/agency.html');
  await w.click(page.locator('tr', { hasText: 'Marlow’s Kitchen' }).getByRole('button', { name: 'Their website' }), 'Their website');
  await profile(page, w, 'Connections');
  w.note(`connections URL ${new URL(page.url()).pathname}${new URL(page.url()).search}; h1 "${await page.locator('h1').first().innerText()}"`);
  const own = (await page.locator('#svc-google_search_console').innerText()).replace(/\s+/g, ' ');
  w.note(`row copy: ${own.slice(0, 220)}`);
  await w.shot('1-connections-scoped');
  await w.click(page.locator('#svc-google_search_console button[data-connect]'), 'Connect');
  await page.waitForURL(/connections-callback/);
  await page.waitForTimeout(800);
  await w.shot('2-callback');
  w.note(`connect leg scope header: ${connectScope === MARLOW_SITE ? 'the client ✓' : connectScope || '(none)'}; callback leg: ${cbScope === MARLOW_SITE ? 'the client ✓' : cbScope || '(none)'}`);
  w.note(`callback h1 "${await page.locator('#card h1').innerText().catch(() => '')}"; way out → ${await page.getByRole('link', { name: 'Back to your connections' }).getAttribute('href')}`);
  w.note('(Google’s consent screen is the real step 3 — it is the operator’s own Google account that signs in, not the client’s)');
  w.finish();
});

test('S4b Connections from Settings while scoped drops the client', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's4b-settings-connections');
  await w.start(`/presence.html?client=${MARLOW_SITE}`);
  await profile(page, w, 'Settings');
  w.note(`settings URL ${new URL(page.url()).search}; cards: ${JSON.stringify(await page.locator('#cards .setcard .t').allInnerTexts())}`);
  const href = await page.locator('[data-card="connections"]').getAttribute('href');
  const noscope = await page.locator('[data-card="connections"]').getAttribute('data-noscope');
  w.note(`Connections card href=${href} data-noscope=${noscope} → leaves the client`);
  w.note(`Domains & email card href=${await page.locator('[data-card="domains"]').getAttribute('href')} (admin-health, operators only)`);
  w.note(`Plan & billing card present while scoped: ${await page.locator('[data-card="billing"]').count()}`);
  await w.shot('1-settings-scoped');
  w.finish();
});

test('S5 send a proposal, the agreement and a deposit request', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's5-proposal-agreement-deposit');
  await w.start('/agency.html');
  await w.click(shell(page).getByRole('link', { name: 'Pipeline' }), 'Pipeline');
  w.note(`tiles: ${(await page.locator('.stats').innerText().catch(() => '')).replace(/\s+/g, ' ').trim()}`);
  await w.click(page.getByText('Cedar Garage — new website').first(), 'the deal');
  await w.shot('1-deal');
  await w.click(page.getByRole('tab', { name: 'Billing' }).or(page.getByRole('button', { name: 'Billing' })), 'Billing tab');
  await w.shot('2-billing');
  await w.click(page.locator('[data-send-proposal]').first(), 'Send → (proposal)');
  await w.shot('3-proposal-sent');
  await w.click(page.locator('[data-send-contract]').first(), 'Send for signature → (agreement)');
  await w.shot('4-agreement-sent');
  await w.click(page.locator('#sendDeposit'), 'Request a deposit');
  await w.type(page.locator('#invForm input[type=number]').first(), '2500', 'deposit amount');
  await w.click(page.locator('#invForm button[type=submit]'), 'Save (the deposit mini-form’s button)');
  await w.shot('5-deposit');
  w.note('three separate emails to the client (proposal, agreement, deposit) — PR #29 (open) folds them into one link');
  w.finish();
});

test('S6 start a project and ask the client to approve something', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's6-project-approval');
  await w.start('/agency.html');
  await w.click(shell(page).getByRole('link', { name: 'Projects' }), 'Projects');
  await w.shot('1-projects');
  await w.click(page.locator('#newProject'), '+ New project');
  await w.type(page.locator('#np-name'), 'Cedar Garage website', 'project name');
  w.note(`customer options: ${JSON.stringify(await page.locator('#np-customer option').allInnerTexts())}; templates: ${JSON.stringify(await page.locator('#np-template option').allInnerTexts())}`);
  await page.locator('#np-template').selectOption('website'); w.typed++; w.note('   pick: Website build template');
  await w.shot('2-new-project');
  await page.route('**/functions/v1/presence/projects', (route) => route.request().method() === 'POST'
    ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { id: PID }, templated: true }) }) : route.fallback());
  await w.click(page.getByRole('button', { name: 'Create project' }), 'Create project');
  await w.shot('3-record');
  w.note(`record buttons: ${JSON.stringify((await page.locator('#rec .btn, .rec-head .btn, .rechead .btn').allInnerTexts()).slice(0, 8))}`);
  await w.click(page.locator('#addAppr'), '+ Request (Approvals)');
  await w.type(page.locator('#apForm input').first(), 'Homepage design', 'what needs approval');
  await w.click(page.locator('#apForm').getByRole('button', { name: /Save|Request|Send/ }), 'Save');
  await w.shot('4-requested');
  w.note('the client gets "Needs your OK — Homepage design" by email; the request is project-level (subject_type project), not tied to the deliverable');
  w.finish();
});

test('S7 invoice a client from their record', async ({ page }) => {
  await studio(page, { '/crm/record': { data: {
    identity: { contact_id: 'ct-1', deal_id: DEAL, client_id: 'c-marlow', customer_site_id: MARLOW_SITE, project_id: PID },
    header: { name: 'Marlow’s Kitchen', company: '', email: 'ana@marlowskitchen.com', phone: '', status: 'customer' },
    highlights: {}, sections: { overview: true, messages: true, deal: true, delivery: true, details: true }, default_tab: 'overview',
    canonical: { key: 'project', value: PID },
  } } });
  const w = new Walk(page, 's7-invoice');
  await w.start('/agency.html');
  await w.click(page.locator('tr', { hasText: 'Marlow’s Kitchen' }).getByRole('button', { name: 'Open record' }), 'Open record');
  await w.shot('1-record');
  await w.click(page.locator('#act-invoice'), 'Send invoice (action bar)');
  await w.shot('2-form');
  await w.type(page.locator('#bf-amt'), '1200', 'amount');
  await w.type(page.locator('#bf-title'), 'Design phase', 'label');
  await w.click(page.locator('#bf-go'), 'Send invoice');
  await w.shot('3-sent');
  w.finish();
});

test('S7b money across clients — where the studio sees who owes it', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's7b-money');
  await w.start('/agency.html');
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  w.note(`agency.html mentions money: ${/\$|owe|outstanding|overdue|invoice/i.test(body) ? body.match(/.{0,60}(\$|owe|outstanding|overdue|invoice).{0,60}/i)?.[0] : 'no'}`);
  await w.click(shell(page).getByRole('link', { name: 'Pipeline' }), 'Pipeline');
  await w.shot('1-pipeline-tiles');
  const seeWho = page.getByRole('link', { name: /see who/ }).or(page.getByRole('button', { name: /see who/ }));
  if (await seeWho.count()) { await w.click(seeWho, 'see who → (Outstanding tile)'); await w.shot('2-who-owes'); }
  else w.note('no "see who →" on the Outstanding tile with this fixture');
  await w.click(shell(page).getByRole('link', { name: 'Today' }), 'Today (studio level = the agency’s own site)');
  await w.shot('3-today-studio');
  w.note(`Today h1 "${await page.locator('h1').first().innerText()}"; money band: ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').match(/.{0,80}(owes? you|outstanding|overdue).{0,80}/i)?.[0] || 'none'}`);
  w.finish();
});

test('S8 work the Inbox — reply to a client’s message', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's8-inbox');
  await w.start('/agency.html');
  await w.click(shell(page).getByRole('link', { name: 'Inbox' }), 'Inbox');
  await w.shot('1-inbox');
  w.note(`rows: ${JSON.stringify((await page.locator('#rows [role=option]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 90)))}`);
  await w.click(page.locator('#rows [role=option]').filter({ hasText: 'Marlow’s Kitchen' }).first(), 'the client’s thread');
  await w.shot('2-thread');
  await w.type(page.locator('#msgBody'), 'Done — Saturday is now 9–5 on the draft; publishing tonight.', 'the reply');
  await w.click(page.locator('#msgForm').getByRole('button', { name: 'Send' }), 'Send');
  await w.shot('3-sent');
  w.note(`pane actions: ${JSON.stringify((await page.locator('#rpane button, #rpane a.btn').allInnerTexts()).map((t) => t.trim()).filter(Boolean).slice(0, 10))}`);
  w.finish();
});

test('S8b work the Inbox — a support request: reply and resolve', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's8b-inbox-support');
  await w.start('/inbox.html');
  await w.click(page.locator('#rows [role=option]').filter({ hasText: 'Saturday hours' }).first(), 'the support request');
  await w.shot('1-support');
  w.note(`pane actions: ${JSON.stringify((await page.locator('#rpane button').allInnerTexts()).map((t) => t.trim()).filter(Boolean))}`);
  await w.type(page.locator('#supBody'), 'Changed — Saturday now reads 9–5.', 'the reply');
  await w.click(page.locator('#supReplyResolve'), 'Reply and resolve');
  await w.shot('2-resolved');
  w.finish();
});

test('S9 invite a client reviewer (Sharing & access) — from the studio level', async ({ page }) => {
  await studio(page);
  const scopes: string[] = [];
  page.on('request', (r) => { if (/\/portal\/members/.test(r.url())) scopes.push(r.headers()['x-dds-scope-site'] ?? '(absent)'); });
  const w = new Walk(page, 's9-invite');
  await w.start('/agency.html');
  await profile(page, w, 'Sharing & access');
  await w.shot('1-sharing');
  w.note(`h1 "${await page.locator('h1').first().innerText()}"; breadcrumb: ${(await page.getByRole('navigation', { name: 'Breadcrumb' }).innerText().catch(() => '')).replace(/\s+/g, ' ')}`);
  w.note(`role options: ${JSON.stringify(await page.locator('#role option').allInnerTexts())}; people listed: ${JSON.stringify(await page.locator('.people .rowitem').allInnerTexts())}`);
  await w.type(page.locator('#email'), 'ana@marlowskitchen.com', 'email');
  await w.click(page.getByRole('button', { name: 'Send invite' }), 'Send invite');
  await w.shot('2-invited');
  w.note(`members calls carried scope: ${JSON.stringify(Array.from(new Set(scopes)))} — at studio level this is the AGENCY’s own site, so the reviewer is invited to Bright Studio, not to Marlow’s`);
  w.finish();
});

test('S9b invite a reviewer to a CLIENT’s site (scoped)', async ({ page }) => {
  await studio(page);
  const scopes: string[] = [];
  page.on('request', (r) => { if (/\/portal\/(members|shares)/.test(r.url())) scopes.push(r.headers()['x-dds-scope-site'] ?? '(absent)'); });
  const w = new Walk(page, 's9b-invite-scoped');
  await w.start(`/presence.html?client=${MARLOW_SITE}`);
  await profile(page, w, 'Sharing & access');
  w.note(`URL ${new URL(page.url()).pathname}${new URL(page.url()).search}; context bar: ${(await page.locator('#dds-ctxbar').innerText().catch(() => '(none)')).replace(/\s+/g, ' ').trim().slice(0, 60)}`);
  await w.type(page.locator('#email'), 'ana@marlowskitchen.com', 'email');
  await w.click(page.getByRole('button', { name: 'Send invite' }), 'Send invite');
  await w.shot('1-scoped-sharing');
  w.note(`members/shares calls carried scope header: ${JSON.stringify(Array.from(new Set(scopes)))} (the page shows "Studio › Marlow’s Kitchen" but the invite goes to whichever site the JWT resolves to)`);
  w.finish();
});

test('S10 check platform health and the studio’s own plan', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's10-health-billing');
  await w.start('/agency.html');
  const door = page.getByRole('link', { name: /Platform health/ });
  w.note(`health doorway on agency.html: ${await door.count() ? 'yes (staff probe passed)' : 'no'} — y=${await door.boundingBox().then((b) => b && Math.round(b.y)).catch(() => '?')}`);
  await w.click(door, 'Platform health → (agency.html, below the kits)');
  await w.shot('1-admin-health');
  w.note(`admin-health h1 "${await page.locator('h1').first().innerText()}"; drill links: ${JSON.stringify(await page.locator('.cf a').allInnerTexts())}`);
  await w.click(shell(page).getByRole('link', { name: 'Studio' }), 'Studio (back)');
  await profile(page, w, 'Settings');
  await w.shot('2-settings');
  w.note(`billing card: ${(await page.locator('[data-card="billing"]').innerText().catch(() => '(none)')).replace(/\s+/g, ' ').trim()}`);
  await w.click(page.locator('[data-card="billing"]'), 'Plan & billing');
  await page.waitForTimeout(1200);
  await w.shot('3-plan');
  const bill = page.locator('#billingCard, .billing-card, [data-billing]').first();
  w.note(`lands on ${new URL(page.url()).pathname}${new URL(page.url()).hash}; billing card text: ${(await bill.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160) || '(no billing card painted with this fixture)'}`);
  w.note(`buttons on the page named Manage/Update: ${await page.getByRole('button', { name: /Manage billing|Update payment/ }).count()}`);
  w.finish();
});

test('S11 the Today page as the agency sees it, and the queues door', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's11-queues');
  await w.start('/agency.html');
  const q = page.locator('#queues');
  w.note(`queues: ${(await q.innerText().catch(() => '(none)')).replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  await w.click(q.getByRole('link').first(), 'first queue row (→ the client’s Today)');
  await w.shot('1-client-today');
  w.note(`landed ${new URL(page.url()).pathname}${new URL(page.url()).search}; context bar: ${(await page.locator('#dds-ctxbar').innerText().catch(() => '(none)')).replace(/\s+/g, ' ').trim().slice(0, 80)}`);
  w.note(`Needs you on the client’s Today: ${(await page.locator('body').innerText()).replace(/\s+/g, ' ').match(/Needs you.{0,160}/)?.[0] || ''}`);
  w.finish();
});

test('S12 apply a starter kit to a new client', async ({ page }) => {
  await studio(page);
  const w = new Walk(page, 's12-kit');
  await w.start('/agency.html');
  await page.locator('.kitcard').scrollIntoViewIfNeeded();
  await w.shot('1-kits');
  await page.locator('#kitPick').selectOption({ index: 1 }); w.typed++;
  await page.locator('#kitToSite').selectOption({ index: 3 }); w.typed++;
  await w.click(page.locator('#kitApply'), 'Apply');
  await w.shot('2-applied');
  w.note(`kit card y=${await page.locator('.kitcard').boundingBox().then((b) => b && Math.round(b.y))} on a page where the roster comes first`);
  expect(CONNECTIONS).toBeTruthy();
  w.finish();
});
