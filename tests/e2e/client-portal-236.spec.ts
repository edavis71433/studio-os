import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Builder list items 236 and 232 (Nov 2026), drawn in Figma first (page "Client portal —
// from the Agiled check"). The studio's Client portal page: the portal's address with Copy
// and Open, where its clients stand, a five-step set-up list, and See a client's portal.
// A client's portal card in Settings says when they were invited and last in, opens their
// portal as they see it, and sends a sign-in link (a new invite once the last ran out).

const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', S2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const ADDRESS = `https://app.example/portal.html?studio=cccccccc-3333-4333-8333-cccccccccccc`;
const json = (status: number, body: unknown) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
// the shell's one date format (builder item 101): "Nov 4", and "Dec 20, 2026" for a day in another year
const dayWords = (iso: string) => { const d = new Date(iso); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}) }); };

const AGENCY_CTX = (over: Record<string, unknown> = {}) => ({ data: {
  site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES,
  is_agency: true, is_operator: false, sees_full_workspace: true, attention_stale: false, scope: null,
  capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 4, nav: STUDIO_NAV, ...over,
} });
const OVERVIEW = (over: Record<string, unknown> = {}) => ({ data: {
  address: ADDRESS,
  counts: { active: 4, waiting: 1, expired: 0, recent: 3 },
  clients: [
    { site_id: S1, name: 'Bacchus Kitchen', state: 'joined', invited_at: daysAgo(40), seen_at: daysAgo(2) },
    { site_id: S2, name: 'Harbor Dental', state: 'waiting', invited_at: daysAgo(3), seen_at: null },
  ],
  setup: [{ key: 'logo', done: true }, { key: 'parts', done: false }, { key: 'welcome', done: false }, { key: 'preview', done: false }, { key: 'invite', done: true }],
  can_edit: true, ...over,
} });

test.describe('item 236 — the studio’s Client portal page', () => {
  test('the address with Copy and Open, four numbers, and the set-up list with its next steps', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': AGENCY_CTX(), '/agency/portal/overview': OVERVIEW() } });
    await page.goto('/client-portal.html');
    await expect(page.getByRole('heading', { name: 'Client portal', level: 1 })).toBeVisible();
    await expect(page.getByText('What your clients see, and who has joined.')).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Your portal’s address' })).toHaveValue(ADDRESS);
    const open = page.getByRole('link', { name: 'Open', exact: true });
    await expect(open).toHaveAttribute('href', ADDRESS);
    await expect(open).toHaveAttribute('target', '_blank');
    await expect(page.getByRole('button', { name: 'Copy', exact: true })).toBeVisible();
    const counts = page.locator('.counts');
    for (const [k, v] of [['Active clients', '4'], ['Waiting to join', '1'], ['Invites run out', '0'], ['In the last 30 days', '3']]) {
      await expect(counts.locator('div', { hasText: k }).locator('b')).toHaveText(v);
    }
    await expect(page.locator('#setN')).toHaveText('2 of 5 done');
    const step = (k: string) => page.locator(`[data-step="${k}"]`);
    await expect(step('logo')).toHaveClass(/done/);
    await expect(step('logo').locator('.sbtn')).toHaveCount(0);
    await expect(step('parts').getByRole('link', { name: 'Choose' })).toHaveAttribute('href', '/settings.html#portalParts');
    await expect(step('welcome').getByRole('link', { name: 'Write it' })).toHaveAttribute('href', '/settings.html#portalHome');
    await expect(step('preview').getByRole('button', { name: 'Open' })).toBeVisible();
    await expect(step('invite')).toHaveClass(/done/);
    await expect(page.getByRole('link', { name: 'Invite a client' })).toHaveAttribute('href', '/agency.html#add');
  });

  test('See a client’s portal picks a client, then opens their portal as they see it', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': AGENCY_CTX(), '/agency/portal/overview': OVERVIEW() } });
    await page.goto('/client-portal.html');
    await page.getByRole('button', { name: 'See a client’s portal' }).click();
    const pick = page.getByRole('dialog', { name: 'See a client’s portal' });
    await expect(pick).toBeVisible();
    await expect(pick.locator('li')).toHaveCount(2);
    await expect(pick.locator('li', { hasText: 'Bacchus Kitchen' })).toContainText('Last in 2 days ago');
    await expect(pick.locator('li', { hasText: 'Harbor Dental' })).toContainText('hasn’t signed in yet');
    await expect(pick.getByRole('link', { name: 'See Harbor Dental’s portal' })).toHaveAttribute('href', `/client.html?preview=${S2}&back=%2Fclient-portal.html`);
    await pick.getByRole('button', { name: 'Close' }).click();
    await expect(pick).toBeHidden();
    // the set-up step opens the same list
    await page.locator('[data-step="preview"]').getByRole('button', { name: 'Open' }).click();
    await expect(pick).toBeVisible();
  });

  test('a role that can’t manage clients has no Invite a client; no clients yet, nothing to see', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': AGENCY_CTX(), '/agency/portal/overview': OVERVIEW({ can_edit: false, clients: [], counts: { active: 0, waiting: 0, expired: 0, recent: 0 } }) } });
    await page.goto('/client-portal.html');
    await expect(page.getByRole('heading', { name: 'Client portal', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Invite a client' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'See a client’s portal' })).toBeDisabled();
  });

  test('a business that isn’t a studio is told so; a failed read offers Try again', async ({ page }) => {
    await installApp(page, { api: { '/portal/context': AGENCY_CTX({ is_agency: false }) } });
    await page.route('**/functions/v1/presence/agency/portal/overview', (r) => r.fulfill(json(403, { error: 'forbidden' })));
    await page.goto('/client-portal.html');
    await expect(page.getByRole('heading', { name: 'This isn’t a studio account.' })).toBeVisible();
    await page.goto('about:blank');
    await installApp(page, { api: { '/portal/context': AGENCY_CTX() } });
    await page.route('**/functions/v1/presence/agency/portal/overview', (r) => r.fulfill(json(502, { error: 'read_failed' })));
    await page.goto('/client-portal.html');
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

// ── a client's portal card in Settings (item 232's drawing) ──
const SETTINGS_API = {
  '/identity': { data: { site_id: 'own', business_name: 'Brightline Studio', email: 'hello@brightline.example' } },
  '/settings': { data: { industry_key: 'salon' } },
  '/agency/nav': { data: { hidden: [], choices: [], can_edit: true } },
};
const PARTS = ['messages', 'book', 'services', 'invoices', 'proposals', 'agreements', 'files', 'reports', 'help'].map((key) => ({ key, label: key, sub: '' }));
const PORTALSET = { data: { off: [], welcome: '', home_off: [], parts: PARTS, cards: [], welcome_max: 500, can_edit: true, clients: [{ site_id: S2, name: 'Harbor Dental', choices: {} }] } };
const person = (over: Record<string, unknown>) => ({ data: { site_id: S2, name: 'Harbor Dental', email: 'maria@harbor.example', state: 'joined', invited_at: daysAgo(12), seen_at: daysAgo(2), can_edit: true, ...over } });
async function openCard(page: Page, who: Record<string, unknown>) {
  await installApp(page, { api: { ...SETTINGS_API, '/portal/context': AGENCY_CTX({ scope: { site_id: S2, name: 'Harbor Dental' } }), '/agency/portal': PORTALSET, [`/agency/portal/people/${S2}`]: person(who) } });
  const posts: string[] = [];
  await page.route(/\/functions\/v1\/presence\/agency\/portal\/clients\/[^/]+\/sign-in-link$/, (r) => { posts.push(r.request().url()); return r.fulfill(json(200, { data: { site_id: S2, sent: true, email: 'maria@harbor.example' } })); });
  await page.goto(`/settings.html?client=${S2}#portalParts`);
  await expect(page.locator('#portalWho')).toBeVisible();
  return posts;
}

test.describe('item 232 — a client’s portal card', () => {
  test('when they were invited and last in, their portal, and a sign-in link', async ({ page }) => {
    const invited = daysAgo(12);
    const posts = await openCard(page, { invited_at: invited });
    await expect(page.locator('#portalWhoLine')).toHaveText(`Invited ${dayWords(invited)} · last in 2 days ago`);
    await expect(page.getByRole('link', { name: 'See Harbor Dental’s portal' })).toHaveAttribute('href', `/client.html?preview=${S2}&back=${encodeURIComponent(`/settings.html?client=${S2}#portalParts`)}`);
    await page.getByRole('button', { name: 'Send a sign-in link' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toContain(`/agency/portal/clients/${S2}/sign-in-link`);
    await expect(page.getByText('Sent a sign-in link to maria@harbor.example.')).toBeVisible();
  });

  test('an invite that ran out offers a new one; nobody invited yet has no button', async ({ page }) => {
    const invited = daysAgo(20);
    await openCard(page, { state: 'expired', invited_at: invited, seen_at: null });
    await expect(page.locator('#portalWhoLine')).toHaveText(`Invited ${dayWords(invited)} · the invite ran out`);
    await expect(page.getByRole('button', { name: 'Send a new invite' })).toBeVisible();
    await page.goto('about:blank');
    await openCard(page, { state: 'none', invited_at: null, seen_at: null, email: '' });
    await expect(page.locator('#portalWhoLine')).toHaveText('Not invited yet. Invite them from their site on Sites.');
    await expect(page.locator('#portalLink')).toBeHidden();
  });
});
