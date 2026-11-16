import { test, expect, type Page, type Route } from '@playwright/test';
import { installApp } from './helpers/app';

// Builder item 212: what tests/presence/money_signature_test.mjs used to check by reading
// pipeline.html as text, checked here in the deal page itself (studio audit 2026-10, change 7:
// the deal page keeps ONE filled button per view). tests/e2e/pipeline.spec.ts › "deal page —
// one filled button per view" covers convert, both documents, a drafted agreement, the won and
// converted headers and the tab switches; this spec covers the rest the old text checks held:
// a drafted proposal's Send and "+ Agreement" as Billing's one, the quiet record link in the
// back bar, the Path bar's do-next staying quiet when the path repaints on Billing, the quiet
// "Sign the agreement first", and a converted deal's quiet project link and Resend welcome
// email (#resendInvite), which no spec pressed. Every write a test makes the page send is
// answered by a route the test registered on purpose; any other write fails the test.

const DEAL = '11111111-1111-4111-8111-111111111111';
const PROJECT = '55555555-5555-4555-8555-555555555555';
const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

const CONTACT = { id: 'ct-1', name: 'Jordan Ellis', email: 'jordan@larkspur.example', phone: '', company: 'Larkspur Bakery', notes: '' };
const dealDetail = (deal: Record<string, unknown>, more: Record<string, unknown> = {}) => ({ data: {
  deal: { id: DEAL, title: 'Larkspur website', stage: 'qualified', expected_value_cents: 320000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-1', converted_client_id: null, created_project_id: null, retainer: null, ...deal },
  contact: CONTACT, proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: past(2), ...more,
} });
const PROPOSAL = (status: string) => ({ id: 'p-1', title: 'Website build', status, version: 1, line_items: [{ label: 'Build', qty: 1, unit_cents: 320000 }], first_viewed_at: null, expires_at: null, sent_at: status === 'draft' ? null : past(3) });
const API = (detail: unknown) => ({
  '/sales/deals': { data: [{ id: DEAL, title: 'Larkspur website', stage: 'qualified', source: 'manual', expected_value_cents: 320000, contact_id: 'ct-1', converted_client_id: null, updated_at: past(1) }] },
  [`/sales/deals/${DEAL}`]: detail,
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 320000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [CONTACT] }, '/sales/templates': { data: [] }, '/sales/services': { data: [] },
  '/sales/receivables': { data: { items: [], total_cents: 0 } }, '/identity': { data: { business_name: 'Example Studio' } },
});

/** Every write the page sends must match one of `planned`; anything else is answered 500 and
 *  listed in `unplanned`, which each test expects to stay empty. GETs go on to the fixtures. */
type Planned = { method: string; path: RegExp; answer: (route: Route) => Promise<void> | void };
async function guardWrites(page: Page, planned: Planned[]) {
  const sent: Array<{ method: string; path: string; body: unknown }> = [];
  const unplanned: string[] = [];
  await page.route('**/functions/v1/presence/**', async (route) => {
    const r = route.request();
    if (r.method() === 'GET' || r.method() === 'HEAD') return route.fallback();
    const path = new URL(r.url()).pathname.replace(/^.*\/functions\/v1\/presence/, '');
    const plan = planned.find((p) => p.method === r.method() && p.path.test(path));
    if (!plan) { unplanned.push(`${r.method()} ${path}`); return route.fulfill(json({ error: 'unplanned' }, 500)); }
    let body: unknown = null; try { body = r.postDataJSON(); } catch { body = r.postData(); }
    sent.push({ method: r.method(), path, body });
    return plan.answer(route);
  });
  return { sent, unplanned };
}
// the filled (primary) buttons showing in a scope, leaving out the More ▾ menu's own rows
const filledIn = (page: Page, scope: string) => page.locator(`${scope} .btn:not(.ghost):visible`).filter({ hasNot: page.locator('.more-menu .btn') });
const openBilling = async (page: Page) => { await page.goto(`/pipeline.html?deal=${DEAL}&dtab=billing`); await expect(page.locator('#dtab-billing')).toHaveAttribute('aria-selected', 'true'); };

test.describe('the deal page’s one filled button', () => {
  test('a drafted proposal: its row Send is Billing’s one', async ({ page }) => {
    await installApp(page, { api: API(dealDetail({ stage: 'qualified' }, { proposals: [PROPOSAL('draft')] })) });
    const w = await guardWrites(page, []);
    await openBilling(page);
    await expect(page.locator('#dpanel-billing [data-send-proposal="p-1"]')).toBeVisible();
    await expect(filledIn(page, '#detailInner')).toHaveCount(1);
    await expect(filledIn(page, '#detailInner').first()).toHaveAttribute('data-send-proposal', 'p-1');
    await expect(page.locator('#addProp')).toHaveClass(/ghost/);
    await expect(page.locator('#addCon')).toHaveClass(/ghost/);
    expect(w.unplanned).toEqual([]);
  });

  test('a sent proposal and no agreement: + Agreement is Billing’s one', async ({ page }) => {
    await installApp(page, { api: API(dealDetail({ stage: 'proposal' }, { proposals: [PROPOSAL('sent')] })) });
    const w = await guardWrites(page, []);
    await openBilling(page);
    await expect(page.locator('#addCon')).toBeVisible();
    await expect(filledIn(page, '#detailInner')).toHaveCount(1);
    await expect(filledIn(page, '#detailInner').first()).toHaveAttribute('id', 'addCon');
    await expect(page.locator('#addProp')).toHaveClass(/ghost/);
    expect(w.unplanned).toEqual([]);
  });

  test('the back bar’s record link is quiet, and opens this deal’s record as the studio', async ({ page }) => {
    await installApp(page, { api: API(dealDetail({ stage: 'qualified' })) });
    const w = await guardWrites(page, []);
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    const link = page.locator('.backbar').getByRole('link', { name: 'Open customer record →' });
    await expect(link).toBeVisible();
    await expect(link).toHaveClass(/ghost/);
    await expect(link).toHaveAttribute('href', `/crm.html?deal=${DEAL}&client=`);
    await link.click();
    await expect(page).toHaveURL(new RegExp(`/crm\\.html\\?deal=${DEAL}&client=$`));
    expect(w.unplanned).toEqual([]);
  });

  test('the path repainted on Billing keeps its do-next quiet', async ({ page }) => {
    await installApp(page, { api: API(dealDetail({ stage: 'proposal' })) });
    const w = await guardWrites(page, []);
    await openBilling(page);
    const current = page.locator('#pathHost .pstep.current');
    await expect(page.locator('#markComplete')).toHaveClass(/ghost/);
    await expect(current).toHaveAttribute('aria-expanded', 'true');
    await current.click();                                            // the stage guidance closes: the path is drawn again
    await expect(page.locator('#pathHost .pstep.current')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#markComplete')).toHaveClass(/ghost/);   // …and its do-next is still quiet here
    await expect(filledIn(page, '#detailInner')).toHaveCount(1);
    await page.locator('#detailInner .tabs [data-dtab="overview"]').click();
    await expect(page.locator('#markComplete')).not.toHaveClass(/ghost/);
    expect(w.unplanned).toEqual([]);
  });

  test('before a signature the convert card offers only a quiet, disabled Sign the agreement first', async ({ page }) => {
    await installApp(page, { api: API(dealDetail({ stage: 'proposal' }, { proposals: [PROPOSAL('sent')] })) });
    const w = await guardWrites(page, []);
    await openBilling(page);
    const wait = page.locator('#convWrap').getByRole('button', { name: 'Sign the agreement first' });
    await expect(wait).toBeVisible();
    await expect(wait).toBeDisabled();
    await expect(wait).toHaveClass(/ghost/);
    await expect(page.locator('#convert')).toHaveCount(0);
    expect(w.unplanned).toEqual([]);
  });

  test('a converted deal: Open their project and Resend welcome email are quiet, and Resend sends it again', async ({ page }) => {
    const converted = dealDetail({ stage: 'won', converted_client_id: 'c-larkspur', created_project_id: PROJECT }, { contracts: [{ id: 'k-1', title: 'Service agreement', status: 'signed', signer_name: 'Jordan Ellis', signed_at: past(5), version: 1, terms_snapshot: null, body: 'Agreed.' }] });
    await installApp(page, { api: API(converted) });
    const w = await guardWrites(page, [{ method: 'POST', path: new RegExp(`^/sales/deals/${DEAL}/resend-invite$`), answer: (r) => r.fulfill(json({ data: { sent: true, email: 'jordan@larkspur.example' } })) }]);
    await openBilling(page);
    const project = page.getByRole('link', { name: 'Open their project →' });
    await expect(project).toHaveClass(/ghost/);
    await expect(project).toHaveAttribute('href', `/projects.html?project=${PROJECT}`);
    const resend = page.locator('#resendInvite');
    await expect(resend).toHaveText('Resend welcome email');
    await expect(resend).toHaveClass(/ghost/);
    await expect(resend).toHaveAttribute('title', /jordan@larkspur\.example/);
    await resend.click();
    await expect.poll(() => w.sent.map((s) => s.path)).toEqual([`/sales/deals/${DEAL}/resend-invite`]);
    await expect(page.locator('.dds-toast').filter({ hasText: 'Welcome email sent to jordan@larkspur.example' })).toBeVisible();
    expect(w.unplanned).toEqual([]);
  });

  test('a converted deal with no email on the contact offers no Resend', async ({ page }) => {
    const converted = dealDetail({ stage: 'won', converted_client_id: 'c-larkspur' }, { contact: { ...CONTACT, email: '' } });
    await installApp(page, { api: API(converted) });
    const w = await guardWrites(page, []);
    await openBilling(page);
    await expect(page.locator('#dpanel-billing')).toContainText('there was no client email on this deal, so no sign-in invitation was sent');
    await expect(page.locator('#resendInvite')).toHaveCount(0);
    expect(w.unplanned).toEqual([]);
  });
});
