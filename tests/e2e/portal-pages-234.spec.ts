import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list item 234 (Nov 2026), drawn in Figma first (page "Client portal — from the
// Agiled check"): pages the studio makes for its clients (words, links, videos and files,
// for every client or chosen ones) and up to six quick links, at the top of the client's
// Help. A page opens full screen with a back arrow; a file asks for a fresh link.

const PID = '22222222-2222-4222-8222-222222222222';
const P1 = '11111111-aaaa-4aaa-8aaa-111111111111', P2 = '55555555-eeee-4eee-8eee-555555555555', L1 = '33333333-cccc-4ccc-8ccc-333333333333', L2 = '66666666-ffff-4fff-8fff-666666666666';
const M1 = '44444444-dddd-4ddd-8ddd-444444444444';
const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', S2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const STUDIO = { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false };
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

// ── the client's Help ──
const CLIENT_CTX = (off: string[] = []) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS',
  edition_features: ['website', 'client_portal'], is_agency: false, is_operator: false, sees_full_workspace: true,
  is_client_portal: false, is_managed_client: true, capabilities: ['view_all'], landing: '/client.html', attention_count: 0,
  nav: [], studio: STUDIO, client_first_name: 'Maria', portal: { off, welcome: '', home_off: [] },
} });
const PAGES = { data: {
  pages: [
    { id: P1, title: 'Welcome guide', sub: 'How we’ll work together', words: 'How we’ll work together\n\nEach week you get a short update here.', updated_at: '2026-11-10T00:00:00Z',
      items: [{ kind: 'link', label: 'Brand board', url: 'https://example.com/brand' }, { kind: 'video', label: 'A two-minute tour', url: 'https://video.example/tour' }, { kind: 'file', label: 'Logo pack', media_id: M1 }] },
  ],
  links: [{ id: L1, label: 'Your website', to: 'https://example.com/' }, { id: L2, label: 'Book a call', to: 'book' }],
} };
const CLIENT_API = (off: string[] = []) => ({
  '/portal/context': CLIENT_CTX(off),
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
  [`/client/projects/${PID}`]: { data: { project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: [], events: [], surveys: [], progress: { total: 0, done: 0, pct: 0 }, deliverables: [], approvals: [] } },
  '/client/documents': { data: { documents: [] } },
  '/client/billing': { data: { invoices: [] } },
  '/client/reports': { data: { reports: [] } },
  '/client/support': { data: [] },
  '/client/faq': { data: { html: '', faq: { items: [] } } },
  '/client/kit': { data: null },
  '/client/portal-pages': PAGES,
  [`/client/portal-pages/files/${M1}`]: { data: { url: 'https://files.example/logo-pack.zip' } },
});

test.describe('item 234 — the studio’s pages and quick links, on the client’s Help', () => {
  test('pages from the studio and quick links sit at the top of Help, above Quick answers', async ({ page }) => {
    await installApp(page, { api: CLIENT_API() });
    await page.goto('/client.html#help');
    const pages = page.locator('#sec-pages');
    await expect(pages.getByRole('heading', { name: 'From Marlow & Co' })).toBeVisible();
    await expect(pages.getByRole('button', { name: /Welcome guide/ })).toContainText('How we’ll work together');
    const links = page.locator('#sec-qlinks');
    await expect(links.getByRole('link', { name: 'Your website ↗' })).toHaveAttribute('href', 'https://example.com/');
    await expect(links.getByRole('link', { name: 'Your website ↗' })).toHaveAttribute('target', '_blank');
    await expect(links.getByRole('button', { name: 'Book a call' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Quick answers' })).toBeVisible();
  });

  test('a page opens full screen with a back arrow; its file asks for a fresh link', async ({ page }) => {
    await page.addInitScript(() => { (window as unknown as { __opened: string[] }).__opened = []; window.open = ((u: string) => { (window as unknown as { __opened: string[] }).__opened.push(String(u)); return null; }) as typeof window.open; });
    await installApp(page, { api: CLIENT_API() });
    await page.goto('/client.html#help');
    await page.locator('#sec-pages').getByRole('button', { name: /Welcome guide/ }).click();
    await expect(page.getByRole('heading', { name: 'Welcome guide', level: 1 })).toBeFocused();
    await expect(page.locator('.ppage p')).toHaveCount(2);
    await expect(page.getByRole('link', { name: 'Brand board ↗' })).toHaveAttribute('href', 'https://example.com/brand');
    await expect(page.getByRole('link', { name: '▶ A two-minute tour ↗' })).toBeVisible();
    await page.getByRole('button', { name: '⬇ Logo pack' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://files.example/logo-pack.zip']);
    await expect(page.locator('#tabnav [data-tab="help"]')).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: '‹ Help' }).click();
    await expect(page.locator('#sec-pages')).toBeVisible();
  });

  test('a quick link to a place the studio turned off for this client isn’t drawn', async ({ page }) => {
    await installApp(page, { api: CLIENT_API(['book']) });
    await page.goto('/client.html#help');
    await expect(page.locator('#sec-qlinks').getByRole('link', { name: 'Your website ↗' })).toBeVisible();
    await expect(page.locator('#sec-qlinks').getByRole('button', { name: 'Book a call' })).toHaveCount(0);
  });
});

// ── the studio's Settings ──
const AGENCY_CTX = { data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, attention_stale: false, scope: null,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 4, nav: STUDIO_NAV,
} };
const SETTINGS_API = {
  '/identity': { data: { site_id: 'own', business_name: 'Brightline Studio', email: 'hello@brightline.example' } },
  '/settings': { data: { industry_key: 'salon' } },
  '/agency/nav': { data: { hidden: [], choices: [], can_edit: true } },
};
const STORE = (over: Record<string, unknown> = {}) => ({ data: {
  pages: [
    { id: P1, title: 'Welcome guide', words: 'How we’ll work together', items: [], who: 'all', updated_at: '2026-11-10T12:00:00Z' },
    { id: P2, title: 'Brand files', words: 'Your logo', items: [], who: [S1, S2], updated_at: '2026-11-12T12:00:00Z' },
  ],
  links: [{ id: L1, label: 'Your website', to: 'https://davisdigitalstudio.com/' }, { id: L2, label: 'Book a call', to: 'book' }],
  clients: [{ site_id: S1, name: 'Bacchus Kitchen' }, { site_id: S2, name: 'Harbor Dental' }],
  limits: { pages: 20, links: 6, items: 12, title: 80, words: 5000 }, can_edit: true, ...over,
} });
async function studio(page: Page, over: Record<string, unknown> = {}) {
  await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX, '/agency/portal/pages': STORE(over),
    '/assets': { data: { assets: [{ id: M1, name: 'Logo pack.zip', kind: 'file' }, { id: '77777777-0000-4000-8000-777777777777', name: 'Private to one client.pdf', client_private: true }], total: 2, shown: 2 } } } });
  const sent: Array<{ url: string; method: string; body: Record<string, unknown> | null }> = [];
  await page.route(/\/functions\/v1\/presence\/agency\/portal\/(pages|links)\/[^/?]+$/, (r) => {
    const req = r.request(); const body = req.method() === 'PUT' ? req.postDataJSON() : null;
    sent.push({ url: req.url().replace(/^.*\/agency\/portal/, '/agency/portal'), method: req.method(), body });
    const cur = STORE().data;
    return r.fulfill(json(200, { data: { pages: req.method() === 'PUT' && /\/pages\//.test(req.url()) ? [...cur.pages, { id: req.url().split('/').pop(), ...body, updated_at: '2026-11-15T12:00:00Z' }] : cur.pages, links: cur.links } }));
  });
  await page.goto('/settings.html#portalPages');
  await expect(page.locator('#portalPages')).toBeVisible();
  return sent;
}

test.describe('item 234 — Settings › Pages for your clients', () => {
  test('the list says who sees each page and when it changed; quick links say where they go', async ({ page }) => {
    await studio(page);
    const rows = page.locator('#portalPageRows');
    await expect(rows.locator(`[data-page-row="${P1}"]`)).toContainText('All clients · changed Nov 10');
    await expect(rows.locator(`[data-page-row="${P2}"]`)).toContainText('Bacchus Kitchen and Harbor Dental');
    await expect(page.locator('#portalLinkRows')).toContainText('davisdigitalstudio.com');
    await expect(page.locator('#portalLinkRows')).toContainText('Your booking page');
  });

  test('a new page: words, a link and a file, for chosen clients, saved by its own id', async ({ page }) => {
    const sent = await studio(page);
    await page.getByRole('button', { name: 'New page' }).click();
    const dlg = page.getByRole('dialog', { name: 'New page' });
    await expect(dlg).toBeVisible();
    await dlg.getByLabel('Title').fill('How we work');
    await dlg.getByLabel('Words').fill('Each week you get a short update.');
    await dlg.getByRole('button', { name: 'Add a link' }).click();
    await dlg.getByLabel('Name').fill('Our process');
    await dlg.getByLabel('Address').fill('http://example.com');
    await dlg.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dlg.locator('#pgErr')).toHaveText('The address needs to start with https://.');
    await dlg.getByLabel('Address').fill('https://example.com/process');
    await dlg.getByRole('button', { name: 'Add', exact: true }).click();
    await dlg.getByRole('button', { name: 'Add a file' }).click();
    await expect(dlg.locator('#pgFileList').getByRole('button')).toHaveCount(1);   // the client-private file isn't offered
    await dlg.locator('#pgFileList').getByRole('button', { name: 'Logo pack.zip' }).click();
    await expect(dlg.locator('#pgItems li')).toHaveCount(2);
    await dlg.getByLabel('Chosen clients').check();
    await dlg.getByLabel('Harbor Dental').check();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].method).toBe('PUT');
    expect(sent[0].url).toMatch(/^\/agency\/portal\/pages\/[0-9a-f-]{36}$/);
    expect(sent[0].body).toEqual({ title: 'How we work', words: 'Each week you get a short update.', items: [{ kind: 'link', label: 'Our process', url: 'https://example.com/process' }, { kind: 'file', label: 'Logo pack.zip', media_id: M1 }], who: [S2], home: false });   // home: item 280
    await expect(dlg).toBeHidden();
    await expect(page.getByText('Saved. It’s at the top of their Help.')).toBeVisible();
  });

  test('a quick link to a place in the portal; delete asks twice', async ({ page }) => {
    const sent = await studio(page);
    await page.getByRole('button', { name: 'Add a link' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add a link' });
    await dlg.getByLabel('Name').fill('Write to us');
    await dlg.getByLabel('Where it goes').selectOption('messages');
    await expect(dlg.getByLabel('Address')).toBeHidden();
    await dlg.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].body).toEqual({ label: 'Write to us', to: 'messages' });
    await page.locator(`[data-edit-page="${P1}"]`).click();
    const ed = page.getByRole('dialog', { name: 'Welcome guide' });
    await ed.getByRole('button', { name: 'Delete page' }).click();
    await expect(ed.getByRole('button', { name: 'Press again to delete the page' })).toBeVisible();
    expect(sent.length).toBe(1);
    await ed.getByRole('button', { name: 'Press again to delete the page' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toMatchObject({ method: 'DELETE', url: `/agency/portal/pages/${P1}` });
  });

  test('a role that can’t change them opens a page to read, with nothing to add', async ({ page }) => {
    await studio(page, { can_edit: false });
    await expect(page.getByRole('button', { name: 'New page' })).toBeHidden();
    await expect(page.locator('#portalNewLink')).toBeHidden();
    await page.locator(`[data-edit-page="${P1}"]`).click();
    const dlg = page.getByRole('dialog', { name: 'Welcome guide' });
    await expect(dlg.getByLabel('Title')).toBeDisabled();
    await expect(dlg.getByRole('button', { name: 'Save' })).toBeHidden();
  });
});
