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
    await expect(page.locator('#deskResults')).toContainText('1. Open your domain’s DNS settings (at GoDaddy, Namecheap — wherever you bought it).');
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
    // By keyboard: on a tablet the app's sidebar covers the left edge of every sheet on this page
    // (the sheets centre on the whole screen; the toasts were moved beside the sidebar, the sheets
    // weren't). Reported as its own fix; the button works either way.
    await card.getByRole('button', { name: 'Show all (8)' }).press('Enter');
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
