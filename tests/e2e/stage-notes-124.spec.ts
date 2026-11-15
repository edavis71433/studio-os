import { test, expect, type Page } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES } from './helpers/app';

// Sales item 124 (Nov 2026, drawn in Figma and agreed): each deal stage carries a short
// "what to do now" note the studio can edit, under the stage bar on the deal (Pipeline's
// deal and the record), and all six in Settings › Deal stages. Hermetic; names made up.

const DEAL = '11111111-1111-4111-8111-111111111111';
const LABELS = { lead: 'New lead', qualified: 'Qualified', proposal: 'Proposal sent', contract: 'Agreement out', won: 'Won', lost: 'Not a fit' };
const STARTER = {
  lead: 'Reply the same day. A quick call beats an email.\nAsk what they need, by when, and roughly what they want to spend.',
  qualified: 'Send the proposal while it is fresh.',
  proposal: 'Follow up two days after it goes out. A quick call beats another email.\nAsk what they’d change: the price, the timing or the pages?',
  contract: 'Check they’ve signed, and nudge them after two days.',
  won: 'Send the welcome and the kickoff details.',
  lost: 'Note why it didn’t fit.',
};
const stages = (notes: Record<string, string> = STARTER, custom: Record<string, string> = {}) => ({ data: { labels: LABELS, custom: {}, defaults: LABELS, chances: { lead: 10, qualified: 25, proposal: 50, contract: 75, won: 100, lost: 0 }, chance_defaults: {}, notes, notes_custom: custom, note_defaults: STARTER } });
const past = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
const PIPE_API = {
  '/sales/deals': { data: [{ id: DEAL, title: 'Acme website', stage: 'proposal', source: 'manual', expected_value_cents: 500000, expected_close: null, contact_id: 'ct-1', converted_client_id: null, updated_at: past(1), next_step: null, next_step_at: null, last_contacted_at: null }] },
  [`/sales/deals/${DEAL}`]: { data: { deal: { id: DEAL, title: 'Acme website', stage: 'proposal', expected_value_cents: 500000, expected_close: null, next_step: null, next_step_at: null, notes: '', contact_id: 'ct-1', converted_client_id: null, retainer: null }, contact: { id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', notes: '' }, proposals: [], contracts: [], events: [], timeline: [], invoices: [], last_contacted_at: null } },
  [`/sales/deals/${DEAL}/tasks`]: { data: [] },
  '/sales/summary': { data: { total: 1, open: { count: 1, value_cents: 500000 }, won_month: { count: 0, value_cents: 0 }, win_rate: { pct: null, won: 0, lost: 0 }, by_stage: [], ar: {} } },
  '/sales/contacts': { data: [{ id: 'ct-1', name: 'Sam Rivera', email: 'sam@example.com', phone: '', company: 'Acme', updated_at: past(1) }] },
  '/sales/templates': { data: [] }, '/sales/services': { data: [] }, '/sales/receivables': { data: { items: [], total_cents: 0 } },
  '/identity': { data: { business_name: 'Test Studio' } },
};
/** PUT /sales/stages { note }: answer as the server does, remembering what was sent. */
async function notesServer(page: Page) {
  const sent: Array<Record<string, unknown>> = [];
  let notes = { ...STARTER } as Record<string, string>, custom: Record<string, string> = {};
  await page.route('**/functions/v1/presence/sales/stages', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stages(notes, custom)) });
    const b = route.request().postDataJSON(); sent.push(b);
    const { stage, text } = b.note;
    if (String(text).trim()) { notes = { ...notes, [stage]: String(text).trim() }; custom = { ...custom, [stage]: String(text).trim() }; }
    else { notes = { ...notes, [stage]: (STARTER as Record<string, string>)[stage] }; const { [stage]: _gone, ...rest } = custom; custom = rest; }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stages(notes, custom)) });
  });
  return sent;
}

test.describe('item 124 — what to do now, under the stage bar', () => {
  test('Pipeline’s deal: the starter note shows; Edit note changes it for every deal at that stage', async ({ page }) => {
    await installApp(page, { api: PIPE_API });
    const sent = await notesServer(page);
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    const note = page.locator('#pathHost .stage-note');
    await expect(note.getByRole('heading', { name: 'What to do now' })).toBeVisible();
    await expect(note.locator('.sn-chip')).toHaveText('Proposal sent');
    await expect(note.locator('.sn-steps li')).toHaveCount(2);
    await expect(note.locator('.sn-foot')).toContainText('A starter note for every deal at Proposal sent.');
    await note.getByRole('button', { name: 'Edit note' }).click();
    const box = page.getByLabel('What to do now at Proposal sent, one step a line');
    await expect(box).toBeFocused();
    await box.fill('Call on day two\nAsk about the budget');
    await page.getByRole('button', { name: 'Save for every deal' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ note: { stage: 'proposal', text: 'Call on day two\nAsk about the budget' } });
    await expect(note.locator('.sn-steps li')).toHaveText(['Call on day two', 'Ask about the budget']);
    await expect(note.locator('.sn-foot')).toContainText('Your studio’s note for every deal at Proposal sent.');
    await expect(page.locator('.dds-toast, #toast').last()).toContainText('Saved for every deal at Proposal sent.');
    // and back to the starter
    await note.getByRole('button', { name: 'Edit note' }).click();
    await page.getByRole('button', { name: 'Put back the starter note' }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toEqual({ note: { stage: 'proposal', text: '' } });
    await expect(note.locator('.sn-foot')).toContainText('A starter note');
  });

  test('Escape leaves the note as it was; nothing is sent', async ({ page }) => {
    await installApp(page, { api: PIPE_API });
    const sent = await notesServer(page);
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    const note = page.locator('#pathHost .stage-note');
    await note.getByRole('button', { name: 'Edit note' }).click();
    await page.getByLabel('What to do now at Proposal sent, one step a line').fill('Something half-typed');
    await page.keyboard.press('Escape');
    await expect(note.getByRole('button', { name: 'Edit note' })).toBeFocused();
    await expect(note.locator('.sn-steps')).not.toContainText('Something half-typed');
    expect(sent.length).toBe(0);
  });

  test('a seat that can’t change settings sees the note but no Edit note', async ({ page }) => {
    const STAFF = { data: { site_role: 'business_staff', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'comment', 'approve', 'export', 'connect'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV } };
    await installApp(page, { api: { ...PIPE_API, '/portal/context': STAFF } });
    await notesServer(page);
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    const note = page.locator('#pathHost .stage-note');
    await expect(note.locator('.sn-steps li').first()).toBeVisible();
    await expect(note.getByRole('button', { name: 'Edit note' })).toBeHidden();
  });

  test('Settings › Deal stages: all six notes, one opened and saved', async ({ page }) => {
    const OWNER = { data: { site_role: 'business_owner', edition: 'presence', edition_key: 'studio_os', edition_name: 'Studio OS', edition_features: ALL_FEATURES, is_agency: true, is_operator: false, sees_full_workspace: true, capabilities: ['edit', 'publish', 'invite', 'configure', 'use_developer_mode', 'view_all'], landing: '/agency.html', attention_count: 0, nav: STUDIO_NAV } };
    await installApp(page, { api: { '/portal/context': OWNER, '/identity': { data: { business_name: 'Brightline Studio' } }, '/settings': { data: {} } } });
    const sent = await notesServer(page);
    await page.goto('/settings.html#stages');
    const rows = page.locator('#stageNotes .sn-row');
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(4)).toContainText('Won');
    await expect(rows.nth(5)).toContainText('Not a fit');
    await expect(rows.nth(2).locator('.sn-kind')).toHaveText('Starter note');
    await page.getByRole('button', { name: 'Edit the note for Proposal sent' }).click();
    const box = page.getByLabel('What to do now at Proposal sent, one step a line');
    await expect(box).toBeFocused();
    await box.fill('Call on day two');
    await rows.nth(2).getByRole('button', { name: 'Save note' }).click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]).toEqual({ note: { stage: 'proposal', text: 'Call on day two' } });
    await expect(rows.nth(2).locator('.sn-kind')).toHaveText('Your note');
    await expect(page.locator('#snNoteMsg')).toHaveText('Saved. Every deal at Proposal sent shows it.');
  });

  test('when the notes can’t be read, what the deal knows still shows (they signed: convert them), with no Edit note', async ({ page }) => {
    const signed = { ...PIPE_API,
      [`/sales/deals/${DEAL}`]: { data: { ...PIPE_API[`/sales/deals/${DEAL}`].data, deal: { ...PIPE_API[`/sales/deals/${DEAL}`].data.deal, stage: 'contract' }, contracts: [{ id: 'k-1', title: 'Service agreement', status: 'signed', signed_at: past(1), version: 1 }] } },
      '/sales/stages': { data: { labels: LABELS, custom: {}, defaults: LABELS, chances: { lead: 10, qualified: 25, proposal: 50, contract: 75, won: 100, lost: 0 }, chance_defaults: {} } },   // an older server: no notes
    };
    await installApp(page, { api: signed });
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    const note = page.locator('#pathHost .stage-note');
    await expect(note.locator('.sn-fact')).toContainText('They’ve signed.');
    await expect(note.locator('#guideConvert')).toBeVisible();
    await expect(note.locator('.sn-steps')).toHaveCount(0);
    await expect(note.getByRole('button', { name: 'Edit note' })).toHaveCount(0);
  });

  test('on a phone the note sits under the stage bar and Edit note is a full-width button', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout');
    await installApp(page, { api: PIPE_API });
    await notesServer(page);
    await page.goto(`/pipeline.html?deal=${DEAL}`);
    const note = page.locator('#pathHost .stage-note');
    await expect(note.locator('.sn-steps li').first()).toBeVisible();
    const edit = note.getByRole('button', { name: 'Edit note' });
    const [eb, nb] = await Promise.all([edit.boundingBox(), note.boundingBox()]);
    expect(eb && nb && eb.height >= 44 && eb.width > nb.width * 0.8).toBeTruthy();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
