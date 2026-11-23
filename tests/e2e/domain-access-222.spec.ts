import { test, expect, Page, Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installApp, STUDIO_LEVEL_NAV, ALL_FEATURES } from './helpers/app';
import { pinClock } from './helpers/clock';

// Builder list item 222 (Nov 12 review, file 04, finding 2), drawn in Figma ("Files Trash and
// Ask for access", section B) and approved: a domain's panel has a card for the studio's access.
// Ask for access opens a sheet that shows the email the client gets (the server writes it:
// POST /agency/domains/:site/access with preview), then sends it; the card waits until someone
// presses It arrived. The list's row carries a pill, and a chip shows while one waits.

const studioContext = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'agency', edition_name: 'Agency', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, is_client_portal: false,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_LEVEL_NAV, plan_key: 'agency', upsell: null,
} };
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const row = (over: Record<string, unknown>) => ({ domain: 'x.example', site_id: 's0', name: 'X', own: false, status: 'connected', status_words: 'Connected', tone: 'good', days_left: 200, provider: 'Namecheap', expires_at: '2027-06-19T00:00:00Z', checked_at: new Date().toISOString(), record: 'ok', padlock_until: null, checks: [], dns_host: '', lock: true, warnings: [], registered_at: null, renews: 'unknown', renews_confirmed_at: null, access: null, hosted: true, ...over });
const BAKERY = row({ domain: 'brightbakery.com', site_id: 's1', name: 'Bright Bakery', status: 'partly', status_words: 'Waiting on records', tone: 'warn' });
const HARBOR = row({ domain: 'harbordental.com', site_id: 's2', name: 'Harbor Dental', provider: 'GoDaddy', access: { status: 'arrived', since: '2026-11-12T10:00:00Z' } });
const JUNIPER = row({ domain: 'juniperfloral.co', site_id: 's3', name: 'Juniper Floral Co.', provider: 'Hover', access: { status: 'asked', since: '2026-11-13T10:00:00Z' } });
const OWN = row({ domain: 'mystudio.example', site_id: 'own', name: 'Bright Studio', own: true });
const DOMAINS = { data: { domains: [BAKERY, HARBOR, JUNIPER, OWN], builtin: [] }, partial: false };
const COMPANIES = ['Namecheap', 'GoDaddy', 'Cloudflare', 'Squarespace Domains', 'Porkbun', 'Wix', 'Network Solutions', 'DNSimple', 'DigitalOcean', 'IONOS', 'Amazon Route 53', 'Hover', 'Another company'];
const detail = (d: Record<string, unknown>, over: Record<string, unknown> = {}) => ({ data: {
  ...d, dns_host_full: '', statuses: ['active'], records: [], all_checks: [], warnings: [], history: [], forwards: [], mail: { words: '' },
  where: { registrar: d.provider, dns_host: '', records_at: { company: d.provider, sign_in: 'https://ap.www.namecheap.com/domains/list/', path: 'Domain List' }, renew_at: null },
  notes: { account: '', renews: 'unknown', renews_confirmed_at: null, note: '', updated_by: null, updated_at: null },
  access: null, access_companies: [String(d.provider), ...COMPANIES.filter((c) => c !== d.provider)], access_invite: 'hello@davisdigital.studio', ...over } });
const STEPS = ['Sign in to Namecheap and open Domain List.', 'Press Manage next to brightbakery.com, then open Sharing & Transfer.', 'Under Share Access, type hello@davisdigital.studio as the New Manager and press Add.', 'Pick “Give manager some permissions”, untick everything, then tick only “Manage Host Records”.', 'Type your own Namecheap password to confirm.'];
const TEXT = ['Hi Dana,', '', 'To finish connecting brightbakery.com to your new website, we need to change its DNS records at Namecheap. You can give us access to just the records, without sharing your password:', '', ...STEPS.map((s, i) => `${i + 1}. ${s}`), '', 'That’s it. Namecheap sends us an invitation, and we take it from there.', '', 'Sign in to Namecheap: https://ap.www.namecheap.com/domains/list/', '', 'You keep your password, your account and the right to renew or move the domain. You can take our access away any time, on the same Namecheap page.', '', 'Davis Digital Studio'].join('\n');
const VIEW = { to: 'owner@brightbakery.com', to_name: 'Bright Bakery', studio: 'Davis Digital Studio', subject: 'Give Davis Digital Studio access to brightbakery.com’s records', text: TEXT, steps: STEPS, company: 'Namecheap', called: 'Share Access', exact: true, caveat: '', studio_note: 'Needs a Namecheap account at this address, and the invitation must be accepted within 7 days.', asks: 'email', sign_in: 'https://ap.www.namecheap.com/domains/list/', invite_ok: true };
const ASKED = { domain: 'brightbakery.com', status: 'asked', company: 'Namecheap', invite: 'hello@davisdigital.studio', to: 'owner@brightbakery.com', asked_at: '2026-11-15T10:00:00Z', last_asked_at: '2026-11-15T10:00:00Z', asks: 1, asked_by: 'eric@studio.example', arrived_at: null, arrived_by: null };

// a server from before item 222 sends no access fields at all
const before222 = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('access')));

async function openDomains(page: Page, opts: { preview?: (body: any) => { status: number; body: unknown }; detailOver?: Record<string, unknown>; oldServer?: boolean } = {}) {
  const writes: Array<{ method: string; path: string; body: any }> = [];
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  const list = opts.oldServer ? { ...DOMAINS, data: { ...DOMAINS.data, domains: DOMAINS.data.domains.map(before222) } } : DOMAINS;
  await installApp(page, { api: { '/portal/context': studioContext, '/agency/domains': list,
    // the records plan offered when a company can't share, answered as routes/foundations.ts answers it (builder item 212)
    'POST /foundations/prepare': (sent: { kind?: string; preview?: boolean }) => ({ data: { id: 'plan-1', kind: sent?.kind || 'dns_records', title: 'Add the records', summary: '', steps: [], risk: '', reversible: true, rollback_note: '', requires_approval: true, status: 'proposed', extra: {}, decided_at: null, applied_at: null, created_at: '2026-11-15T12:00:00Z', ...(sent?.preview ? { preview: true } : {}) } }) } });
  await page.route(/\/functions\/v1\/presence\/agency\/domains\/[^/]+(\/(notes|check|access))?$/, async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/presence/, '');
    const method = route.request().method();
    const site = path.split('/')[3];
    const d = [BAKERY, HARBOR, JUNIPER, OWN].find((x) => x.site_id === site) || BAKERY;
    if (method === 'GET') { const det = detail(d, opts.detailOver); return route.fulfill(json(opts.oldServer ? { data: before222(det.data) } : det)); }
    const body = route.request().postDataJSON();
    writes.push({ method, path, body });
    if (path.endsWith('/access') && method === 'POST' && body?.preview) {
      const r = opts.preview ? opts.preview(body) : { status: 200, body: { data: { ...VIEW, company: body.company } } };
      return route.fulfill(json(r.body, r.status));
    }
    if (path.endsWith('/access') && method === 'POST') return route.fulfill(json({ data: { ...VIEW, access: ASKED } }));
    if (path.endsWith('/access') && method === 'PUT') return route.fulfill(json({ data: { access: body.arrived ? { ...ASKED, status: 'arrived', arrived_at: new Date().toISOString(), arrived_by: 'eric@studio.example' } : ASKED } }));
    if (path.endsWith('/access') && method === 'DELETE') return route.fulfill(json({ data: { access: null } }));
    return route.fulfill(json({ data: { ok: true } }));
  });
  await page.goto('/domains.html');
  await expect(page.locator('table[aria-label="Domains"] tbody tr')).toHaveCount(4);
  return { writes, errors, previews: () => writes.filter((w) => w.body?.preview) };
}
const openPanel = async (page: Page, domain: string) => {
  await page.locator(`tr[data-domain="${domain}"] [data-detail]`).click();
  await expect(page.locator('#dpanel #dpTitle')).toHaveText(domain);
};

test.describe('Domains: Ask for access (item 222)', () => {
  test('the list: a pill under each name that has an ask, a chip while one waits, and the count in the line', async ({ page }) => {
    await pinClock(page, '2026-11-15T18:00:00Z');   // the fixtures' dates are fixed in 2026; from January a page adds the year (builder item 101)
    const t = await openDomains(page);
    await expect(page.locator('tr[data-domain="harbordental.com"] .acc')).toHaveText('Access: yes');
    await expect(page.locator('tr[data-domain="harbordental.com"] .acc')).toHaveClass(/\byes\b/);
    await expect(page.locator('tr[data-domain="juniperfloral.co"] .acc')).toHaveText('Access: asked Nov 13');
    await expect(page.locator('tr[data-domain="brightbakery.com"] .acc')).toHaveCount(0);
    await expect(page.locator('[data-filter="access"]')).toHaveText('Waiting on access1');
    await expect(page.locator('.lmeta')).toContainText('1 waiting on access');
    await page.locator('[data-filter="access"]').click();
    await expect(page.locator('table[aria-label="Domains"] tbody tr')).toHaveCount(1);
    await expect(page.locator('table[aria-label="Domains"] tbody tr')).toHaveAttribute('data-domain', 'juniperfloral.co');
    expect(t.errors).toEqual([]);
  });

  test('the panel: the card says where the records are kept; the sheet shows the email the client gets, then sends it', async ({ page }) => {
    await pinClock(page, '2026-11-15T18:00:00Z');   // the fixtures' dates are fixed in 2026; from January a page adds the year (builder item 101)
    const t = await openDomains(page);
    await openPanel(page, 'brightbakery.com');
    const card = page.locator('#dpanel .dp-acc');
    await expect(card.locator('h3')).toHaveText('Get into its records without their password');
    await expect(card).toContainText('Its records are kept at Namecheap. Ask Bright Bakery to give your studio the DNS records only.');
    await card.getByRole('button', { name: 'Ask for access' }).click();
    const sheet = page.locator('dialog#accDlg[open]');
    await expect(sheet.locator('#accTitle')).toHaveText('Ask Bright Bakery for access');
    await expect(sheet.locator('#accCo')).toHaveValue('Namecheap');
    await expect(sheet.locator('#accCo')).toBeFocused();
    await expect(sheet.locator('#accInv')).toHaveValue('hello@davisdigital.studio');
    await expect(sheet.locator('#accInvHint')).toHaveText('Needs a Namecheap account at this address, and the invitation must be accepted within 7 days.');
    await expect(sheet.locator('.acc-meta')).toContainText('Bright Bakery <owner@brightbakery.com>');
    await expect(sheet.locator('.acc-mail .band')).toHaveText('Davis Digital Studio');
    await expect(sheet.locator('.acc-mail ol li')).toHaveCount(5);
    await expect(sheet.locator('.acc-mail ol li').nth(3)).toHaveText('Pick “Give manager some permissions”, untick everything, then tick only “Manage Host Records”.');
    await expect(sheet.locator('.acc-mail .keep')).toContainText('You keep your password');
    await expect(sheet.locator('.acc-mail .signin')).toHaveText('Sign in to Namecheap');
    // a line of their own goes to the preview, after a pause
    await sheet.locator('#accNote').fill('Thanks, Dana!');
    await expect.poll(() => t.previews().some((w) => w.body.note === 'Thanks, Dana!')).toBe(true);
    await sheet.getByRole('button', { name: 'Send to owner@brightbakery.com' }).click();
    await expect(page.locator('dialog#accDlg[open]')).toHaveCount(0);
    const sent = t.writes.filter((w) => w.method === 'POST' && !w.body?.preview);
    expect(sent).toEqual([{ method: 'POST', path: '/agency/domains/s1/access', body: { company: 'Namecheap', invite: 'hello@davisdigital.studio', note: 'Thanks, Dana!' } }]);
    // the card now waits, and says so
    await expect(card.locator('h3')).toHaveText('Waiting for access');
    await expect(card.locator('.since')).toHaveText('Asked Nov 15');
    await expect(card.locator('.dp-track li')).toHaveText([/^Asked Bright Bakery, with Namecheap’s steps/, 'They add hello@davisdigital.studio at Namecheap', 'The invitation arrives and you accept it']);
    await expect(page.locator('#dpMsg')).toHaveText('Sent to owner@brightbakery.com. It waits here until you tick it off.');
    await expect(card.getByRole('button', { name: 'It arrived' })).toBeFocused();
    await expect(page.locator('tr[data-domain="brightbakery.com"] .acc')).toHaveText('Access: asked Nov 15');
    // It arrived ticks it off, and Undo goes back to waiting
    await card.getByRole('button', { name: 'It arrived' }).click();
    await expect(card.locator('h3')).toHaveText('Access arrived');
    await expect(card.getByRole('link', { name: 'Sign in to Namecheap ↗' })).toHaveAttribute('href', 'https://ap.www.namecheap.com/domains/list/');
    await card.getByRole('button', { name: 'Undo' }).click();
    await expect(card.locator('h3')).toHaveText('Waiting for access');
    await card.getByRole('button', { name: 'Not needed' }).click();
    await expect(card.locator('h3')).toHaveText('Get into its records without their password');
    expect(t.writes.filter((w) => !w.body?.preview).map((w) => `${w.method} ${w.path} ${JSON.stringify(w.body)}`)).toEqual([
      'POST /agency/domains/s1/access {"company":"Namecheap","invite":"hello@davisdigital.studio","note":"Thanks, Dana!"}',
      'PUT /agency/domains/s1/access {"arrived":true}',
      'PUT /agency/domains/s1/access {"arrived":false}',
      'DELETE /agency/domains/s1/access null',
    ]);
    expect(t.errors).toEqual([]);
  });

  test('a company that can\'t share: the sheet says so and offers the records instead; no email: copy the message', async ({ page, context }, info) => {
    const t = await openDomains(page, { preview: (body) => body.company === 'Hover'
      ? { status: 422, body: { error: 'cannot_share', message: 'Hover has no way to share access. Send the client the records to add instead.', company: 'Hover' } }
      : { status: 200, body: { data: { ...VIEW, company: body.company, to: '', to_name: '' } } } });
    await openPanel(page, 'brightbakery.com');
    await page.locator('#dpanel .dp-acc').getByRole('button', { name: 'Ask for access' }).click();
    const sheet = page.locator('dialog#accDlg[open]');
    await expect(sheet.locator('.acc-meta')).toContainText('No email on their record');
    await expect(sheet.locator('#accSend')).toBeDisabled();
    await expect(sheet.locator('#accMsg')).toHaveText('This client has no email on their record yet. Copy the message and send it yourself, or add their email first.');
    if (info.project.name === 'desktop-chromium') {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await sheet.getByRole('button', { name: 'Copy the message' }).click();
      await expect(sheet.locator('#accMsg')).toHaveText('Copied. Paste it into an email or a text to the client.');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('Subject: Give Davis Digital Studio access to brightbakery.com’s records');
    }
    await sheet.locator('#accCo').selectOption('Hover');
    await expect(sheet.locator('.acc-cant')).toContainText('Hover can’t share access from the client’s side.');
    await expect(sheet.locator('#accSend')).toBeDisabled();
    await sheet.getByRole('button', { name: 'Send the records instead' }).click();
    await expect(page.locator('dialog#accDlg[open]')).toHaveCount(0);
    expect(t.writes.filter((w) => !w.body?.preview)).toEqual([]);
  });

  test('We already have it ticks it off without an ask; Escape closes the sheet first, then the panel', async ({ page }) => {
    const t = await openDomains(page);
    await openPanel(page, 'brightbakery.com');
    const card = page.locator('#dpanel .dp-acc');
    await card.getByRole('button', { name: 'Ask for access' }).click();
    await expect(page.locator('dialog#accDlg[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog#accDlg[open]')).toHaveCount(0);
    await expect(page.locator('#dpanel')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Ask for access' })).toBeFocused();
    await card.getByRole('button', { name: 'We already have it' }).click();
    await expect(card.locator('h3')).toHaveText('Access arrived');
    expect(t.writes.filter((w) => !w.body?.preview).map((w) => `${w.method} ${JSON.stringify(w.body)}`)).toEqual(['PUT {"arrived":true}']);
    await page.keyboard.press('Escape');
    await expect(page.locator('#dpanel')).toBeHidden();
  });

  test('the studio’s own domain has no access card', async ({ page }) => {
    await openDomains(page);
    await openPanel(page, 'mystudio.example');
    await expect(page.locator('#dpanel .dp-acc')).toHaveCount(0);
  });

  test('before the server update goes live: no card, no pill and no chip, so nothing offers a button that can’t work yet', async ({ page }) => {
    const { writes, errors } = await openDomains(page, { oldServer: true });
    await expect(page.locator('table[aria-label="Domains"] .acc')).toHaveCount(0);
    await expect(page.locator('[data-filter="access"]')).toHaveCount(0);
    await openPanel(page, 'brightbakery.com');
    await expect(page.locator('#dpanel #dpCheck')).toBeVisible();   // the detail has painted
    await expect(page.locator('#dpanel .dp-acc')).toHaveCount(0);
    expect(writes).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  test('a phone: the sheet comes up from the bottom, the message folds away, and the buttons are easy to press', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'a phone-width layout');
    await openDomains(page);
    await openPanel(page, 'brightbakery.com');
    await page.locator('#dpanel .dp-acc').getByRole('button', { name: 'Ask for access' }).click();
    const sheet = page.locator('dialog#accDlg[open]');
    await expect(sheet.locator('.acc-mail')).toBeHidden();   // folded: "What Bright Bakery gets"
    await sheet.locator('.acc-pv summary').click();
    await expect(sheet.locator('.acc-mail')).toBeVisible();
    const [box, send] = await Promise.all([sheet.boundingBox(), sheet.locator('#accSend').boundingBox()]);
    const vp = page.viewportSize()!;
    expect(Math.round(box!.y + box!.height)).toBeGreaterThanOrEqual(vp.height - 2);   // its foot sits on the bottom edge
    expect(send!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('a tablet: the panel card and the sheet fit, nothing scrolls sideways', async ({ page }, info) => {
    test.skip(info.project.name !== 'tablet', 'a tablet-width layout');
    await openDomains(page);
    await openPanel(page, 'brightbakery.com');
    await expect(page.locator('#dpanel .dp-acc')).toBeVisible();
    await page.locator('#dpanel .dp-acc').getByRole('button', { name: 'Ask for access' }).click();
    const sheet = page.locator('dialog#accDlg[open]');
    await expect(sheet.locator('.acc-mail ol li')).toHaveCount(5);
    const box = await sheet.boundingBox();
    const vp = page.viewportSize()!;
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 1);
  });

  test('the card and the sheet pass an accessibility check, light and dark', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'one scan is enough');
    test.slow();
    await openDomains(page);
    await openPanel(page, 'brightbakery.com');
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      const r = await new AxeBuilder({ page }).include('#dpanel .dp-acc').withTags(['wcag2a', 'wcag2aa']).analyze();
      expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${scheme}: ${v.id}`)).toEqual([]);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('#dpanel .dp-acc').getByRole('button', { name: 'Ask for access' }).click();
    await expect(page.locator('dialog#accDlg[open] .acc-mail ol li')).toHaveCount(5);
    const r = await new AxeBuilder({ page }).include('dialog#accDlg').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

// ── Builder item 396: Check now can email the client, so it is a manager's ──
test.describe('Domains: Check now asks for the manager role (item 396)', () => {
  test('a view-only seat: Check now is greyed with the reason, and nothing is sent', async ({ page }) => {
    await pinClock(page, '2026-11-15T18:00:00Z');
    const t = await openDomains(page, { detailOver: { can_manage: false } });
    await openPanel(page, 'brightbakery.com');
    await expect(page.locator('#dpCheck')).toBeDisabled();
    await expect(page.locator('#dpMsg')).toHaveText('Checking a domain can email the client, so it’s for a manager. Your role reads the last check.');
    expect(t.writes.filter((w) => w.path.endsWith('/check'))).toEqual([]);
  });

  test('a manager: Check now is there as before (and an older server, which says nothing, keeps it too)', async ({ page }) => {
    await pinClock(page, '2026-11-15T18:00:00Z');
    await openDomains(page, { detailOver: { can_manage: true } });
    await openPanel(page, 'brightbakery.com');
    await expect(page.locator('#dpCheck')).toBeEnabled();
    await expect(page.locator('#dpMsg')).toHaveText('');
  });
});
