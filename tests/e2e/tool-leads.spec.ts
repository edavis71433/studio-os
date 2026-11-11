import { test, expect, Page } from '@playwright/test';
import { installApp } from './helpers/app';

// Free-tool leads on Prospects (sales review item 114). Hermetic: the API is
// stubbed; every name is made up. A Site Review / AI Visibility request shows
// with its score and report, one click makes a contact AND a deal, and anyone
// the server refuses (403: not platform staff) simply never sees the section.

const L1 = '44444444-4444-4444-8444-444444444444';
const DEAL = '55555555-5555-4555-8555-555555555555';
const CONTACT = '66666666-6666-4666-8666-666666666666';
const toolLead = (over: Record<string, unknown> = {}) => ({
  id: L1, created_at: '2026-11-09T12:00:00Z', tool: 'site_review', tool_word: 'Site Review',
  business_name: 'Cedar Core Plumbing', client_email: 'pat@cedarcore.example', url: 'https://cedarcore.example',
  city: 'Burbank', business_type: 'Plumber', score: 41, status: 'new', contact_id: null, deal_id: null,
  report_url: 'https://tools.example/report.html?id=rep-1', ...over,
});

/** The page's lead + prospects API, method-aware; returns the calls it saw. */
async function withLeads(page: Page, state: { leads: unknown[] | null }) {
  const calls: string[] = [];
  await page.route('**/functions/v1/presence/sales/tool-leads**', async (route) => {
    const m = route.request().method();
    const path = new URL(route.request().url()).pathname.replace(/^.*\/presence/, '');
    calls.push(`${m} ${path}`);
    const ok = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (state.leads === null) return ok({ error: 'forbidden', message: 'Free-tool leads are the platform’s own enquiries — staff only.' }, 403);
    if (/\/convert$/.test(path)) {
      const l = state.leads[0] as Record<string, unknown>;
      l.deal_id = DEAL; l.contact_id = CONTACT; l.status = 'converted';
      return ok({ data: { deal: { id: DEAL, title: 'Cedar Core Plumbing', stage: 'lead' }, contact: { id: CONTACT } } }, 201);
    }
    if (m === 'PATCH') { state.leads = (state.leads as Record<string, unknown>[]).filter((l) => l.id !== path.split('/').pop()); return ok({ data: toolLead({ status: 'not_a_fit' }) }); }
    return ok({ data: state.leads });
  });
  await page.route('**/functions/v1/presence/sales/prospects**', async (route) => {
    calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname.replace(/^.*\/presence/, '')}`);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) });
  });
  return calls;
}

test.describe('Free-tool leads on Prospects (item 114)', () => {
  test('a lead shows with its score and report, and one click makes the contact and the deal', async ({ page }) => {
    await installApp(page);
    const calls = await withLeads(page, { leads: [toolLead()] });
    await page.goto('/prospects.html');
    const card = page.locator('#leadsCard');
    await expect(card.getByRole('heading', { name: 'Free-tool leads' })).toBeVisible();
    const row = card.locator('.saved-row').first();
    await expect(row).toContainText('Cedar Core Plumbing');
    await expect(row).toContainText('Site Review · 41/100');
    await expect(row.getByRole('link', { name: 'pat@cedarcore.example' })).toHaveAttribute('href', 'mailto:pat@cedarcore.example');
    await expect(row.getByRole('link', { name: 'See their report' })).toHaveAttribute('href', 'https://tools.example/report.html?id=rep-1');
    await row.getByRole('button', { name: '→ Contact + deal' }).click();
    await expect(page.locator('.dds-toast, #toast').last()).toContainText('Contact and deal started.');
    await expect(row.getByRole('link', { name: 'Open the deal' })).toHaveAttribute('href', `/pipeline.html?deal=${DEAL}`);
    await expect(row.getByRole('link', { name: 'Open the contact' })).toHaveAttribute('href', `/crm.html?contact=${CONTACT}`);
    await expect(row.getByRole('button', { name: '→ Contact + deal' })).toHaveCount(0);
    expect(calls.filter((c) => c.endsWith('/convert')).length).toBe(1);
  });

  test('Not a fit clears the lead; a name with markup stays text', async ({ page }) => {
    await installApp(page);
    const sneaky = toolLead({ business_name: '<img src=x onerror=alert(1)> Plumbing' });
    await withLeads(page, { leads: [sneaky] });
    await page.goto('/prospects.html');
    const card = page.locator('#leadsCard');
    await expect(card.locator('.saved-row').first()).toContainText('<img src=x onerror=alert(1)> Plumbing');
    await card.getByRole('button', { name: 'Not a fit' }).click();
    await expect(page.locator('.dds-toast, #toast').last()).toContainText('Marked not a fit.');
    await expect(page.locator('#leadsCard')).toHaveCount(0);
  });

  test('someone the server refuses never sees the section, and Prospects still works', async ({ page }) => {
    await installApp(page);
    await withLeads(page, { leads: null });
    await page.goto('/prospects.html');
    await expect(page.getByRole('heading', { name: 'No prospects yet' })).toBeVisible();
    await expect(page.locator('#leadsCard')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Free-tool leads' })).toHaveCount(0);
  });
});
