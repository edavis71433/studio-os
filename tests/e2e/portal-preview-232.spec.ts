import { test, expect, type Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder list item 232 (Nov 2026), drawn in Figma first (page "Client portal — from the
// Agiled check"): a studio sees a client's portal exactly as the client does
// (client.html?preview=<their site>). Read-only: nothing pressed is saved, sent or paid,
// nothing is marked as read, and this device keeps nothing of it. A strip across the top
// says so, with Back to the client.

const S1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const PID = '22222222-2222-4222-8222-222222222222';
const STUDIO = { name: 'Marlow & Co', logo_url: null, accent: '#8c3b2e', is_default: false };
const MSG = 'This is a preview: nothing is saved, sent or paid.';
const ymd = (offsetDays: number) => {
  const t = new Date(Date.now() + offsetDays * 86400000);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
};
// what the server answers a preview's context: the client's own, plus who they are
const PREVIEW_CTX = { data: {
  site_role: 'business_owner', capabilities: ['view_all'], studio: STUDIO, client_first_name: 'Maria',
  portal: { off: [], welcome: '', home_off: [] }, edition: 'presence', site_live: true,
  is_agency: false, is_operator: false, is_managed_client: true, sees_full_workspace: true, is_client_portal: false,
  landing: '/client.html', scope: null, attention_count: 0, attention_stale: false, studio_requests: [], businesses: [], business: null, nav: [],
  preview: { site_id: S1, name: 'Harbor Dental', email: 'maria@harbor.example' },
} };
const INVOICES = [{ id: 'i1', name: 'Website build, second half', amount: 450, status: 'open', due_date: ymd(3), created_at: '2026-11-04T15:00:00Z', pay_url: 'https://pay.example/i1', view_url: 'https://docs.example/i1' }];
const API = {
  '/portal/context': PREVIEW_CTX,
  '/portal/feed': { data: { role: 'business_owner', moments: [], notices: [], pending_approvals: [], last_published: null } },
  '/client/notifications': { data: [], unread_count: 0 },
  '/client/projects': { data: [{ id: PID, name: 'Website build', status: 'active' }] },
  [`/client/projects/${PID}`]: { data: { project: { id: PID, name: 'Website build', status: 'active' }, milestones: [], tasks: [], events: [], surveys: [], progress: { total: 0, done: 0, pct: 0 }, deliverables: [], approvals: [] } },
  [`/client/projects/${PID}/report`]: { data: { summary: null } },
  [`/client/projects/${PID}/messages`]: { data: [] },
  '/client/documents': { data: { documents: [] } },
  '/client/billing': { data: { invoices: INVOICES } },
  '/client/reports': { data: { reports: [] } },
  '/client/support': { data: [] },
  '/client/faq': { data: { html: '', faq: { items: [] } } },
  '/client/kit': { data: null },
};
type Seen = { path: string; method: string; headers: Record<string, string> };
function watch(page: Page) {
  const seen: Seen[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.includes('/functions/v1/presence/')) seen.push({ path: u.pathname.replace(/^.*\/functions\/v1\/presence/, ''), method: r.method(), headers: r.headers() }); });
  return seen;
}
const writes = (seen: Seen[]) => seen.filter((s) => s.method !== 'GET');
const kept = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => /^dds-portal-(home|persona|papers):|^dds-studio-brand$/.test(k)));

test.describe('item 232 — a studio sees a client’s portal as they do', () => {
  test('a strip says it’s a preview and goes back; every read asks as the client, saying it’s a preview', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: API });
    await page.goto(`/client.html?preview=${S1}&back=%2Fclient-portal.html`);
    await expect(page.locator('#home-hero')).toBeVisible();
    const bar = page.locator('#pvbar');
    await expect(bar).toContainText('You’re seeing Harbor Dental’s portal as Harbor Dental sees it. Nothing you press is saved or sent, and nothing is marked as read.');
    await expect(bar.getByRole('link', { name: 'Back to Harbor Dental' })).toHaveAttribute('href', '/client-portal.html');
    await expect(page.locator('#home-hero h1')).toContainText('Maria');
    const reads = seen.filter((s) => s.path === '/portal/context' || s.path.startsWith('/client/'));
    expect(reads.length).toBeGreaterThan(2);
    expect(reads.every((s) => s.headers['x-dds-preview'] === '1' && s.headers['x-dds-scope-site'] === S1)).toBe(true);
    // the mark-read never goes out
    expect(writes(seen)).toEqual([]);
  });

  test('a message isn’t sent and a payment isn’t opened: each says it’s a preview', async ({ page }) => {
    const seen = watch(page);
    await installApp(page, { api: API });
    await page.goto(`/client.html?preview=${S1}&project=${PID}`);
    await page.locator('#msg').fill('Can we move the call?');
    await page.locator('#send').click();
    await expect(page.locator('#toast')).toHaveText(MSG);
    await page.locator('#tabnav [data-tab="documents"]').click();
    const pay = page.getByRole('link', { name: /^Pay \$450/ });
    await expect(pay).toBeVisible();
    await pay.click();
    await expect(page.locator('#toast')).toHaveText(MSG);
    expect(new URL(page.url()).pathname).toBe('/client.html');
    expect(writes(seen)).toEqual([]);
  });

  test('their account shows their email, never the studio’s; sign-out stays here', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto(`/client.html?preview=${S1}`);
    await page.locator('#tabnav [data-tab="help"]').click();
    const you = page.locator('#sec-you');
    await expect(you).toContainText('maria@harbor.example');
    await expect(you).not.toContainText('owner@example.com');
    await expect(page.locator('#acctTwoLine')).toHaveText('Theirs to set: not shown in a preview.');
    await page.locator('#signout2').click();
    await expect(page.locator('#toast')).toHaveText(MSG);
    expect(new URL(page.url()).pathname).toBe('/client.html');
  });

  test('this device keeps nothing of a preview', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto(`/client.html?preview=${S1}`);
    await expect(page.locator('#home-hero')).toBeVisible();
    await expect(page.locator('#tabnav [data-tab="documents"]')).toBeVisible();   // Documents decided (an invoice), not remembered
    await page.waitForTimeout(300);
    expect(await kept(page)).toEqual([]);
  });

  test('a back address that leaves the app is ignored for the client’s own card', async ({ page }) => {
    await installApp(page, { api: API });
    await page.goto(`/client.html?preview=${S1}&back=https%3A%2F%2Felsewhere.example%2F`);
    await expect(page.locator('#pvbar .pvback')).toHaveAttribute('href', `/settings.html?client=${S1}#portalParts`);
  });
});
