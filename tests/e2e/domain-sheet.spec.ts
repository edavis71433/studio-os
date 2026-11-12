import { test, expect, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 162, part two (Nov 10 review, domains findings 6, 7, 8 and 24): the client's
// Domain & email sheet (presence.html renderFoundations) names the company that keeps their
// records as they type the domain and in step 1, offers the ready-made guides with one press each,
// and shows every record on request. Shapes are the real routes': GET /foundations/domain
// (routes/admin.ts handleDomain, now carrying `provider`), GET /foundations/domain/lookup
// (handleDomainLookup), POST /foundations/prepare and GET /foundations/plans (routes/foundations.ts).
const PRESENCE_API = {
  '/site': { data: { site: { id: 's1', edition: 'presence', status: 'ready', template_slug: 'business-classic', template_version: 1 }, identity: { business_name: 'Marlow’s Kitchen' }, location: {} } },
  '/offerings': { data: [] }, '/faqs': { data: [] }, '/testimonials': { data: [] }, '/posts': { data: [] },
  '/media': { data: [] }, '/settings': { data: {} }, '/health': { data: {} }, '/notes': { data: [] },
  // GET /changes returns an OBJECT (routes/room.ts handleChanges) — renderRecent
  // reads data.changes.length, so an array-shaped fixture throws in the page.
  '/changes': { data: { count: 0, first_publish: false, changes: [], blockers: 0, warnings: 0, draft_hash: 'e2e-draft-hash' } },
  '/moments': { data: [] },
  // routes newer page code calls on boot / #design — real shapes from the routes:
  '/dev/customization': { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: ['accent', 'accent_soft', 'accent_dark', 'soft', 'ink', 'bg', 'radius', 'font_display', 'font_body', 'spacing_scale', 'font_scale'], can_edit_css: false, updated_at: null, updated_by: null } },
  '/schedule': { data: { scheduled: [] } },
  '/content-library': { data: [] },
};
const ctx = (features: string[]) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: features.includes('business_moments') ? 'studio_os' : 'cms_only',
  edition_name: features.includes('business_moments') ? 'Studio OS' : 'CMS', edition_features: features,
  is_agency: false, is_operator: false, sees_full_workspace: true,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'],
  landing: '/presence.html', attention_count: 0, nav: STUDIO_NAV, plan_key: 'presence', upsell: null,
} });


const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const FOUNDATIONS = (records: unknown[] = []) => ({ data: {
  domain: { name: 'bistro.example', sentence: 'Your address is bistro.example.' },
  dns: { record_count: records.length, records, sentence: records.length ? `${records.length} records answer for bistro.example right now.` : 'Nothing to read yet.' },
  ssl: { state: 'pending', sentence: 'The security certificate is being arranged.' },
  email: { has_mail: false, spf: false, dmarc: false, sentence: 'No email runs on this domain — nothing to protect.' },
  hosting: { managed: true, sentence: 'Hosted here.' },
} });
const BASE = { ...PRESENCE_API, '/portal/context': ctx(ALL_FEATURES), '/foundations': FOUNDATIONS(), '/foundations/plans': { data: [] }, '/launch': { data: { launched: false, sentence: 'Getting there.', items: [] } } };
const WHERE = { registrar: 'Registrar B', dns_host: 'Cloudflare', records_at: { company: 'Cloudflare', sign_in: 'https://dash.cloudflare.com/', path: 'your domain, then DNS, then Records' }, renew_at: { company: 'Registrar B', sign_in: '', path: '' } };
const ATTACHED = { data: { custom_domain: 'bistro.example', health: 'dns_pending', message: '', netlify_subdomain: 'bistro.netlify.app',
  dns: { ok: false, expected_apex_ip: ['75.2.60.5'], expected_cname: 'bistro.netlify.app' }, ssl: { state: 'pending' }, provider: WHERE } };

test.describe('Domain & email sheet: their provider, the guides, every record (item 162, part two)', () => {
  test('as they type their domain, the sheet names who sold it, who keeps its records, and where to sign in', async ({ page }) => {
    const asked: string[] = [];
    await installApp(page, { api: { ...BASE, '/foundations/domain': { data: null } } });
    await page.route(/\/functions\/v1\/presence\/foundations\/domain\/lookup/, (route: Route) => {
      const name = new URL(route.request().url()).searchParams.get('name') || '';
      asked.push(name);
      if (name === 'free-name.example') return route.fulfill(json({ data: { name, found: false } }));
      return route.fulfill(json({ data: { name, found: true, registered_name: name, ...WHERE } }));
    });
    await page.goto('/presence.html#domain');
    const input = page.getByPlaceholder('yourbusiness.com');
    await expect(input).toBeFocused();
    await input.pressSequentially('bistro.example');
    const line = page.locator('[data-look="provider"]');
    await expect(line).toHaveText('Found it. It’s registered at Registrar B, and its records are kept at Cloudflare. That’s where you’ll add two records. Sign in to Cloudflare ↗');
    await expect(line.getByRole('link', { name: 'Sign in to Cloudflare ↗' })).toHaveAttribute('href', 'https://dash.cloudflare.com/');
    expect(asked[asked.length - 1]).toBe('bistro.example');
    expect(asked.length).toBeLessThan(4);                                   // asked once the typing settles, not for every letter
    await input.fill('');
    await expect(line).toBeHidden();
    await input.pressSequentially('free-name.example');
    await expect(line).toHaveText('free-name.example isn’t registered to anyone yet. Buy it at a domain company first, then come back and connect it.');
  });

  test('an attached domain: step 1 names the company that keeps the records, with its sign-in page', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations/domain': ATTACHED } });
    await page.goto('/presence.html#domain');
    const desk = page.locator('#deskResults');
    await expect(desk).toContainText('bistro.example — almost there. Two quick steps at Cloudflare:');
    const s1 = page.locator('[data-step="provider"]');
    await expect(s1).toHaveText('1. Sign in to Cloudflare, then open your domain, then DNS, then Records. Sign in to Cloudflare ↗');
    await expect(s1.getByRole('link')).toHaveAttribute('href', 'https://dash.cloudflare.com/');
    await expect(desk).not.toContainText('wherever you bought it');
  });

  test('…and while the company isn’t known yet, the general step stays', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations/domain': { data: { ...ATTACHED.data, provider: { registrar: '', dns_host: '', records_at: null, renew_at: null } } } } });
    await page.goto('/presence.html#domain');
    await expect(page.locator('#deskResults')).toContainText('1. Sign in where your domain’s settings are kept: usually the company you bought it from.');
    await expect(page.locator('[data-step="provider"]')).toHaveCount(0);
  });

  test('More help with this domain: each guide is prepared with one press and waits for their OK', async ({ page }) => {
    const prepared: unknown[] = [];
    let plans: unknown[] = [];
    await installApp(page, { api: { ...BASE, '/foundations/domain': ATTACHED } });
    await page.route(/\/functions\/v1\/presence\/foundations\/plans$/, (route: Route) => route.fulfill(json({ data: plans })));
    await page.route(/\/functions\/v1\/presence\/foundations\/prepare$/, (route: Route) => {
      prepared.push(route.request().postDataJSON());
      plans = [{ id: 'p1', kind: 'registrar_care', title: 'Keep bistro.example safely yours', summary: 'Auto-renew and privacy are the two switches that matter.', risk: 'none', status: 'proposed',
        steps: [{ what: 'Sign in to Registrar B and turn on auto-renew for bistro.example.', automated: false }] }];
      return route.fulfill(json({ data: plans[0] }));
    });
    await page.goto('/presence.html#domain');
    const more = page.locator('[data-help="more"]');
    await expect(more.getByRole('button')).toHaveText(['Make sure it renews by itself', 'The records my site needs', 'Move my domain']);
    await more.getByRole('button', { name: 'Make sure it renews by itself' }).click();
    await expect(page.locator('#deskResults')).toContainText('Waiting for your OK');
    await expect(page.locator('#deskResults')).toContainText('Keep bistro.example safely yours');
    await expect(page.locator('#deskResults')).toContainText('One small step for you: Sign in to Registrar B and turn on auto-renew for bistro.example.');
    expect(prepared).toEqual([{ goal: 'registrar_care' }]);
  });

  test('the records card shows six, and every record on request', async ({ page }) => {
    const recs = Array.from({ length: 8 }, (_, i) => ({ type: i < 2 ? 'A' : 'TXT', name: 'bistro.example', value: 'v' + i, plain: `Record number ${i + 1}` }));
    await installApp(page, { api: { ...BASE, '/foundations': FOUNDATIONS(recs), '/foundations/domain': ATTACHED } });
    await page.goto('/presence.html#domain');
    const card = page.locator('#deskResults .deskopt').filter({ hasText: '8 records answer for bistro.example right now.' });
    await expect(card).toContainText('Record number 6');
    await expect(card).not.toContainText('Record number 7');
    await card.getByRole('button', { name: 'Show all (8)' }).click();   // sheets sit beside the sidebar now (sheets-beside-sidebar.spec.ts)
    await expect(card).toContainText('Record number 8');
    await expect(card.getByRole('button', { name: /Show all/ })).toHaveCount(0);
  });

  test('on a phone: the named step and the guides fit, nothing scrolls sideways', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await installApp(page, { api: { ...BASE, '/foundations/domain': ATTACHED } });
    await page.goto('/presence.html#domain');
    await expect(page.locator('[data-step="provider"]')).toBeVisible();
    await expect(page.locator('[data-help="more"]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});

// ── Nov 10 review, builder list item 163: safer domain changes (findings 11, 12 and 14) ──
const LIVE = { data: { custom_domain: 'bistro.example', health: 'ok', provider: WHERE, all_ok: true, serving: 'latest', changes: [],
  checklist: [{ key: 'points:bistro.example', ok: true, words: 'bistro.example points here' }, { key: 'padlock', ok: true, words: 'The padlock is on' }] } };
async function trackDomainWrites(page: import('@playwright/test').Page) {
  const sent: Array<{ method: string; body: unknown }> = [];
  await page.route(/\/functions\/v1\/presence\/foundations\/domain$/, (route: Route) => {
    const method = route.request().method();
    if (method === 'GET') return route.fallback();
    sent.push({ method, body: route.request().postDataJSON() });
    return route.fulfill(json(method === 'DELETE' ? { data: { ok: true } } : { data: { custom_domain: 'new.example', health: 'dns_pending' } }));
  });
  return sent;
}

test.describe('Domain & email sheet: safer changes (item 163)', () => {
  test('removing asks for the domain typed back, and a different name removes nothing', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations/domain': LIVE } });
    const sent = await trackDomainWrites(page);
    await page.goto('/presence.html#domain');
    await page.getByRole('button', { name: 'Remove this domain' }).click();
    const dlg = page.locator('dialog[open]');
    await expect(dlg).toContainText('Remove bistro.example?');
    await expect(dlg).toContainText('To remove it, type the domain here.');
    await dlg.locator('input').fill('bistro.exampel');
    await dlg.getByRole('button', { name: 'Remove domain' }).click();
    await expect(page.locator('.dds-toast, .toast').filter({ hasText: 'That doesn’t match bistro.example, so nothing was removed.' })).toBeVisible();
    expect(sent).toEqual([]);
    await page.getByRole('button', { name: 'Remove this domain' }).click();
    await page.locator('dialog[open] input').fill('bistro.example');
    await page.locator('dialog[open]').getByRole('button', { name: 'Remove domain' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ method: 'DELETE', body: { confirm: 'bistro.example' } });
  });

  test('changing the domain keeps the old one working unless it is unticked', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations/domain': LIVE } });
    const sent = await trackDomainWrites(page);
    await page.goto('/presence.html#domain');
    await page.getByRole('button', { name: 'Change to a different domain' }).click();
    const dlg = page.locator('dialog[open]');
    await expect(dlg).toContainText('Change bistro.example to a different domain');
    const keep = dlg.getByRole('checkbox', { name: /Keep bistro\.example working/ });
    await expect(keep).toBeChecked();
    await dlg.getByRole('textbox', { name: 'The new domain' }).fill('new');
    await dlg.getByRole('button', { name: 'Change domain' }).click();
    await expect(dlg.getByRole('alert')).toHaveText('That doesn’t look like a domain yet, like newname.com.');
    expect(sent).toEqual([]);
    await dlg.getByRole('textbox', { name: 'The new domain' }).fill('https://New.Example/');
    await dlg.getByRole('button', { name: 'Change domain' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ method: 'POST', body: { domain: 'new.example', keep_old: true } });
    await expect(page.locator('.dds-toast, .toast').filter({ hasText: 'Changed. bistro.example sends visitors on to new.example from your next publish.' })).toBeVisible();
    await page.getByRole('button', { name: 'Change to a different domain' }).click();
    await page.locator('dialog[open]').getByRole('textbox', { name: 'The new domain' }).fill('other.example');
    await page.locator('dialog[open]').getByRole('checkbox').uncheck();
    await page.locator('dialog[open]').getByRole('button', { name: 'Change domain' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ method: 'POST', body: { domain: 'other.example', keep_old: false } });
  });

  test('the steps say to leave the email records alone, and the card shows recent changes', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations/domain': { data: { ...ATTACHED.data, changes: [{ at: '2026-11-10T12:00:00Z', words: 'Changed domain from old.example to bistro.example (old.example forwards), by your studio' }] } } } });
    await page.goto('/presence.html#domain');
    await expect(page.locator('[data-step="mail"]')).toHaveText('Leave anything marked MX or Mail alone: that’s your email.');
    const changes = page.locator('[data-changes="domain"]');
    await expect(changes).toContainText('Recent changes');
    await expect(changes).toContainText('Nov 10, 2026 · Changed domain from old.example to bistro.example (old.example forwards), by your studio');
    await expect(page.getByRole('button', { name: 'Change to a different domain' })).toBeVisible();   // a typo can be fixed before it goes live
  });
});

// ── Nov 10 review, builder list item 164: clearer messages (findings 13, 16, 17 and 18) ──
test.describe('Domain & email sheet: clearer messages (item 164)', () => {
  test('waiting: the steps with times, the main name, and an honest wait', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations/domain': { data: { ...ATTACHED.data, changes: [{ at: '2026-11-10T12:00:00Z', words: 'Attached domain bistro.example, by your studio' }] } } } });
    await page.goto('/presence.html#domain');
    const steps = page.locator('[data-wait="steps"] p');
    await expect(steps.nth(0)).toHaveText(/^✓ Connected here · Nov \d+, \d+:\d\d [AP]M$/);
    await expect(steps.nth(1)).toHaveText('• Records found · not yet, we looked just now');
    await expect(steps.nth(2)).toHaveText('• Padlock on · comes after the records');
    await expect(steps.nth(3)).toHaveText('• Live · we’ll email you when a check sees it. We look once a day, and each time this opens');   // item 194: the email goes when a check sees it, not "the moment"
    await expect(page.locator('[data-wait="time"]')).toHaveText('Usually within an hour of adding the records, sometimes a day or two.');
    await expect(page.locator('[data-step="main"]')).toHaveText('Visitors who type bistro.example or www.bistro.example end up on bistro.example.');
    await expect(page.locator('#deskResults')).not.toContainText('usually within an hour');
  });

  test('records in, padlock coming: said without the hosting company’s words', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations/domain': { data: { ...ATTACHED.data, health: 'ssl_pending' } } } });
    await page.goto('/presence.html#domain');
    await expect(page.locator('#deskResults')).toContainText('bistro.example: your records are in. The padlock is being switched on. Nothing for you to do.');   // item 194: one wait time on the sheet, not three
    const steps = page.locator('[data-wait="steps"] p');
    await expect(steps.nth(1)).toHaveText('✓ Records found');
    await expect(steps.nth(2)).toHaveText('• Padlock on · being switched on');
    await expect(page.locator('#deskResults')).not.toContainText('DNS is set');
  });

  test('“I need to get one” checks a name, offers spellings, and opens a domain company with it filled in', async ({ page }) => {
    const asked: string[] = [];
    await installApp(page, { api: { ...BASE, '/foundations/domain': { data: null } } });
    await page.route(/\/functions\/v1\/presence\/foundations\/domain\/lookup/, (route: Route) => {
      const name = new URL(route.request().url()).searchParams.get('name') || '';
      asked.push(name);
      return route.fulfill(json({ data: { name, found: name === 'bistronine.com' } }));
    });
    await page.goto('/presence.html#domain');
    await expect(page.locator('#deskResults')).toContainText('Right now your site is at its built-in address.');
    await page.getByRole('button', { name: 'I need to get one' }).click();
    const need = page.locator('[data-need="domain"]');
    await need.getByRole('textbox', { name: 'A name you’d like' }).fill('Bistro Nine');
    await need.getByRole('button', { name: 'Check' }).click();
    const lines = need.locator('[data-need="results"] p');
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(0)).toHaveText('bistronine.com: taken.');
    await expect(lines.nth(1)).toHaveText('bistronine.co: free. Buy at Namecheap ↗ · Buy at Porkbun ↗ · Buy at GoDaddy ↗');
    await expect(lines.nth(1).getByRole('link', { name: 'Buy at Porkbun ↗' })).toHaveAttribute('href', 'https://porkbun.com/checkout/search?q=bistronine.co');
    await expect(lines.nth(2)).toHaveAttribute('data-name', 'getbistronine.com');
    expect(asked.sort()).toEqual(['bistronine.co', 'bistronine.com', 'getbistronine.com']);
    await expect(need).toContainText('Buy it in your own name and email, and turn on auto-renew.');
  });
});

// ── Nov 10 review, builder list item 174: borrowed from Namecheap and Squarespace ──
test.describe('Domain & email sheet: borrowed from Namecheap and Squarespace (item 174)', () => {
  test('the main name is said, and www. can become it', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations/domain': LIVE } });
    const sent = await trackDomainWrites(page);
    await page.goto('/presence.html#domain');
    await expect(page.locator('[data-main="name"]')).toHaveText('Main name: bistro.example. www.bistro.example sends visitors there.');
    await page.locator('[data-main="switch"]').click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Make it the main name' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ method: 'POST', body: { domain: 'www.bistro.example' } });
  });

  test('another domain can send its visitors here, and stop', async ({ page }) => {
    const fw: Array<{ method: string; body: unknown }> = [];
    await installApp(page, { api: { ...BASE, '/foundations/domain': { data: { ...LIVE.data, forwards: ['ancient.example', 'second.example', 'www.second.example'] } } } });
    await page.route(/\/functions\/v1\/presence\/foundations\/domain\/forward$/, (route: Route) => { fw.push({ method: route.request().method(), body: route.request().postDataJSON() }); return route.fulfill(json({ data: { forwards: [] } })); });
    await page.goto('/presence.html#domain');
    const box = page.locator('[data-forwards="domain"]');
    await expect(box.locator('[data-forward="ancient.example"]')).toContainText('ancient.example sends visitors to bistro.example');
    await expect(box.locator('[data-forward="second.example"]')).toContainText('second.example and www.second.example send visitors to bistro.example');   // a pair is one line
    await expect(box.locator('[data-forward]')).toHaveCount(2);
    await box.getByRole('textbox', { name: 'A domain to send here' }).fill('https://Old.Example/');
    await box.getByRole('button', { name: 'Send it here' }).click();
    await expect.poll(() => fw.length).toBe(1);
    expect(fw[0]).toEqual({ method: 'POST', body: { domain: 'old.example' } });
    await page.locator('[data-forward="ancient.example"]').getByRole('button', { name: 'Stop' }).click();
    await page.locator('dialog[open]').getByRole('button', { name: 'Stop forwarding' }).click();
    await expect.poll(() => fw.length).toBe(2);
    expect(fw[1]).toEqual({ method: 'DELETE', body: { domain: 'ancient.example' } });
  });

  test('the email card fills every Gmail record in one pick', async ({ page }) => {
    const prepared: unknown[] = [];
    await installApp(page, { api: { ...BASE, '/foundations/domain': LIVE } });
    await page.route(/\/functions\/v1\/presence\/foundations\/prepare$/, (route: Route) => { prepared.push(route.request().postDataJSON()); return route.fulfill(json({ data: { id: 'p1' } })); });
    await page.goto('/presence.html#domain');
    await page.locator('[data-pick="gmail"]').getByRole('button', { name: 'Set up Gmail on this domain' }).click();
    await expect.poll(() => prepared.length).toBe(1);
    expect(prepared[0]).toEqual({ goal: 'email_setup', provider: 'google_workspace' });
  });
});

// Builder list item 193 (Nov 12 review, code findings 13 to 17): the sheet tells the truth.
// "Live and secure" only when the checks ran; one email-protection plan, for whoever runs the
// client's email; an approved plan says who does what next, and the studio can finish it.
test.describe('Domain & email sheet: it tells the truth (item 193)', () => {
  const MAIL = (over: Record<string, unknown> = {}) => {
    const f = FOUNDATIONS();
    return { data: { ...f.data, email: { has_mail: true, spf: false, dmarc: false, provider: 'Microsoft 365', sentence: 'Email runs on this domain but isn’t fully protected yet — a small plan fixes that.' }, ...over } };
  };
  const PLAN = (status: string) => ({ id: 'p1', kind: 'email_auth', title: 'Protect email sent from @bistro.example', summary: 'A few small records tell inboxes your mail is really from you.', risk: 'Low.', status,
    steps: [{ what: 'Add Microsoft 365’s sender record', automated: false, records: [{ type: 'TXT', name: 'bistro.example', value: 'v=spf1 include:spf.protection.outlook.com ~all' }] }] });
  const NO_LIST = { data: { ...LIVE.data, checklist: undefined, all_ok: undefined, check_failed: true } };

  test('when the checks couldn’t run it says so and offers Check again, never “live and secure”', async ({ page }) => {
    let asked = 0;
    await installApp(page, { api: { ...BASE } });
    await page.route(/\/functions\/v1\/presence\/foundations\/domain$/, (route: Route) => { asked++; return route.fulfill(json(asked === 1 ? NO_LIST : LIVE)); });
    await page.goto('/presence.html#domain');
    const desk = page.locator('#deskResults');
    await expect(desk.locator('[data-domain="unchecked"]')).toHaveText('We couldn’t check bistro.example just now.');
    await expect(desk).not.toContainText('live and secure');
    await desk.getByRole('button', { name: 'Check again' }).click();
    await expect(desk.locator('[data-domain="live"]')).toHaveText('✓ bistro.example is live and secure.');
    expect(asked).toBe(2);
  });

  test('email protection names whose records are coming, makes one plan, then gives way to it', async ({ page }) => {
    const prepared: unknown[] = [];
    let plans: unknown[] = [];
    await installApp(page, { api: { ...BASE, '/foundations': MAIL(), '/foundations/domain': LIVE } });
    await page.route(/\/functions\/v1\/presence\/foundations\/plans$/, (route: Route) => route.fulfill(json({ data: plans })));
    await page.route(/\/functions\/v1\/presence\/foundations\/prepare$/, (route: Route) => { prepared.push(route.request().postDataJSON()); plans = [PLAN('proposed')]; return route.fulfill(json({ data: plans[0] })); });
    await page.goto('/presence.html#domain');
    const desk = page.locator('#deskResults');
    await expect(desk.locator('[data-email="after"]')).toHaveText('Your email runs at Microsoft 365, so you’ll get Microsoft 365’s records to copy-paste where your domain’s settings are kept, and only the ones that are missing. We check the rest.');
    await desk.getByRole('button', { name: 'Set up email protection' }).click();
    await expect(desk.locator('[data-email="waiting"]')).toHaveText('The records to add are at the bottom, under “Waiting for your OK”.');
    await expect(desk.getByRole('button', { name: 'Set up email protection' })).toHaveCount(0);   // no second press, no second plan
    await expect(desk.locator('[data-plan="proposed"]')).toHaveCount(1);
    expect(prepared).toEqual([{ goal: 'email_auth' }]);
  });

  test('an approved plan tells the client what happens next, with no button that does nothing', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations': MAIL(), '/foundations/plans': { data: [PLAN('approved')] }, '/foundations/domain': LIVE } });
    await page.goto('/presence.html#domain');
    const card = page.locator('#deskResults [data-plan="approved"]');
    await expect(card).toContainText('approved · add the records below. It closes by itself once we find them');
    await expect(card).not.toContainText('being handled');
    await expect(card.getByRole('button', { name: 'Mark as done' })).toHaveCount(0);
  });

  test('the studio gets Mark as done, and pressing it finishes the plan', async ({ page }) => {
    const done: string[] = [];
    let plans: unknown[] = [PLAN('approved')];
    const studio = ctx(ALL_FEATURES); (studio.data as Record<string, unknown>).is_agency = true;
    await installApp(page, { api: { ...BASE, '/portal/context': studio, '/foundations': MAIL(), '/foundations/domain': LIVE } });
    await page.route(/\/functions\/v1\/presence\/foundations\/plans$/, (route: Route) => route.fulfill(json({ data: plans })));
    await page.route(/\/functions\/v1\/presence\/foundations\/plans\/p1\/done$/, (route: Route) => { done.push(route.request().method()); plans = [{ ...PLAN('applied') }]; return route.fulfill(json({ data: { id: 'p1', status: 'applied', notes: [] } })); });
    await page.goto('/presence.html#domain');
    const card = page.locator('#deskResults [data-plan="approved"]');
    await expect(card).toContainText('approved · mark it done once the work is finished');
    await card.getByRole('button', { name: 'Mark as done' }).click();
    await expect(page.locator('#deskResults [data-plan]')).toHaveCount(0);
    await expect(page.locator('#deskResults')).not.toContainText('Waiting for your OK');
    expect(done).toEqual(['POST']);
  });

  test('a plan whose records were just found leaves the list on the same open', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations': MAIL({ cleared_plans: ['p1'] }), '/foundations/plans': { data: [PLAN('approved')] }, '/foundations/domain': LIVE } });
    await page.goto('/presence.html#domain');
    await expect(page.locator('#deskResults')).toContainText('where your site lives');
    await expect(page.locator('#deskResults [data-plan]')).toHaveCount(0);
    await expect(page.locator('#deskResults').getByRole('button', { name: 'Set up email protection' })).toHaveCount(1);
  });
});

// Builder list item 194 (Nov 12 review, code findings 18 to 26): the smaller fixes on the sheet.
test.describe('Domain & email sheet: the smaller fixes (item 194)', () => {
  const WAIT = 'Usually within an hour of adding the records, sometimes a day or two.';
  const PAIR = [{ type: 'A', host: '@', name: 'bistro.example', value: '75.2.60.5' }, { type: 'CNAME', host: 'www', name: 'www.bistro.example', value: 'bistro.netlify.app' }];

  test('one checklist: the launch list is gone from the sheet, and it is never asked for', async ({ page }) => {
    let launchAsked = 0;
    await installApp(page, { api: { ...BASE, '/foundations/domain': LIVE } });
    await page.route(/\/functions\/v1\/presence\/launch$/, (route: Route) => { launchAsked++; return route.fulfill(json({ data: { launched: false, sentence: 'Getting there.', items: [{ step: 'DNS answering', state: 'done', how: 'The domain resolves.' }] } })); });
    await page.goto('/presence.html#domain');
    const desk = page.locator('#deskResults');
    await expect(desk.locator('[data-domain="live"]')).toBeVisible();
    await expect(desk).not.toContainText('DNS answering');
    await expect(desk).not.toContainText('getting launched');
    expect(launchAsked).toBe(0);
  });

  test('a sub-name gets one record for itself, never "@" and "www"', async ({ page }) => {
    const sub = { data: { ...ATTACHED.data, custom_domain: 'shop.bistro.example', shape: 'sub', records: [{ type: 'CNAME', host: 'shop', name: 'shop.bistro.example', value: 'bistro.netlify.app' }], names: [{ name: 'shop.bistro.example', points: false, leftovers: [] }] } };
    await installApp(page, { api: { ...BASE, '/foundations/domain': sub } });
    await page.goto('/presence.html#domain');
    const desk = page.locator('#deskResults');
    await expect(desk.locator('[data-step="records"]')).toHaveText('2. Add this one record exactly — tap Copy so there are no typos:');
    await expect(desk.locator('.dnsrec')).toHaveCount(1);
    await expect(desk.locator('.dnsrec-v')).toHaveText('CNAME   shop   →   bistro.netlify.app');
    await expect(desk).not.toContainText('A   @');
  });

  test('every Copy button says what it copies', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations/domain': { data: { ...ATTACHED.data, records: PAIR } } } });
    await page.goto('/presence.html#domain');
    const desk = page.locator('#deskResults');
    await expect(desk.getByRole('button', { name: 'Copy the value of the A record for @: 75.2.60.5' })).toBeVisible();
    await expect(desk.getByRole('button', { name: 'Copy the value of the CNAME record for www: bistro.netlify.app' })).toBeVisible();
    await expect(desk.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(0);
  });

  test('the domain box has a name a screen reader can say', async ({ page }) => {
    await installApp(page, { api: { ...BASE, '/foundations/domain': { data: null } } });
    await page.goto('/presence.html#domain');
    await expect(page.getByRole('textbox', { name: 'Your domain' })).toBeFocused();
  });

  test('records in for one name only: it shows the one still missing instead of “nothing for you to do”', async ({ page }) => {
    const half = { data: { ...ATTACHED.data, health: 'ssl_pending', records: PAIR, wait: WAIT, names: [{ name: 'bistro.example', points: true, leftovers: [] }, { name: 'www.bistro.example', points: false, leftovers: [] }] } };
    await installApp(page, { api: { ...BASE, '/foundations/domain': half } });
    await page.goto('/presence.html#domain');
    const desk = page.locator('#deskResults');
    await expect(desk.locator('[data-domain="one-more"]')).toHaveText('bistro.example: its record is in. One more to add, for www.bistro.example:');
    await expect(desk.locator('.dnsrec-v')).toHaveText('CNAME   www   →   bistro.netlify.app');
    await expect(desk).not.toContainText('Nothing for you to do');
    await expect(desk.locator('[data-wait="time"]')).toHaveText(WAIT);
    await expect(desk).not.toContainText('a few minutes');
  });

  test('a forwarded domain says waiting and shows its records until a check has seen them', async ({ page }) => {
    const fwd = { data: { ...LIVE.data, forwards: ['old.example', 'www.old.example', 'seen.example'],
      forward_checks: [{ name: 'old.example', points: false, records: [{ type: 'A', host: '@', name: 'old.example', value: '75.2.60.5' }] }, { name: 'www.old.example', points: false, records: [{ type: 'CNAME', host: 'www', name: 'www.old.example', value: 'bistro.netlify.app' }] }, { name: 'seen.example', points: true, records: [] }] } };
    await installApp(page, { api: { ...BASE, '/foundations/domain': fwd } });
    await page.goto('/presence.html#domain');
    const box = page.locator('[data-forwards="domain"]');
    await expect(box.locator('[data-forward="old.example"]')).toHaveAttribute('data-state', 'waiting');
    await expect(box.locator('[data-forward="old.example"]')).toContainText('old.example is waiting for its records. It sends visitors to bistro.example once they point here:');
    await expect(box.locator('.dnsrec-v')).toHaveText(['A   @   →   75.2.60.5', 'CNAME   www   →   bistro.netlify.app']);
    await expect(box.locator('[data-forward="seen.example"]')).toHaveAttribute('data-state', 'sending');
    await expect(box.locator('[data-forward="seen.example"]')).toContainText('seen.example sends visitors to bistro.example');
  });

  test('email records in a plan are shown the way the provider’s form wants them', async ({ page }) => {
    const plan = { id: 'p1', kind: 'email_auth', title: 'Protect email sent from @bistro.example', summary: 'A few small records.', risk: 'Low.', status: 'proposed',
      steps: [{ what: 'Add the records', automated: false, records: [{ type: 'TXT', name: 'bistro.example', value: 'v=spf1 include:spf.protection.outlook.com ~all' }, { type: 'TXT', name: '_dmarc.bistro.example', value: 'v=DMARC1; p=none' }] }] };
    await installApp(page, { api: { ...BASE, '/foundations/plans': { data: [plan] }, '/foundations/domain': LIVE } });
    await page.goto('/presence.html#domain');
    const card = page.locator('#deskResults [data-plan="proposed"]');
    await expect(card.locator('.dnsrec-v')).toHaveText(['TXT   @   →   v=spf1 include:spf.protection.outlook.com ~all', 'TXT   _dmarc   →   v=DMARC1; p=none']);
    await expect(card).not.toContainText('_dmarc.bistro.example');
    await expect(card.getByRole('button', { name: 'Copy the value of the TXT record for _dmarc: v=DMARC1; p=none' })).toBeVisible();
  });
});
