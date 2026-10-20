import { test, expect } from '@playwright/test';
import { installApp } from '../../../../tests/e2e/helpers/app';
import { PRESENCE_API } from './fixtures';
import { Walk, quiet } from './walk';

const shell = (p: import('@playwright/test').Page) => p.locator('#dds-shell');

test('O1 publish a change', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o1-publish');
  await w.start('/today.html');
  await w.click(shell(page).getByRole('button', { name: /^Website/ }), 'Website (sidebar section)');
  await w.click(shell(page).getByRole('link', { name: 'Business info' }), 'Business info');
  await w.shot('1-business');
  const tag = page.locator('#view-business').getByRole('textbox').nth(1);
  await w.type(tag, 'Neighbourhood kitchen, open late', 'tagline');
  await w.click(page.locator('#btnPublish'), 'Publish · 2 (top bar)');
  await w.shot('2-ritual');
  await w.click(page.getByRole('button', { name: /Publish these 2 changes/ }), 'Publish these 2 changes');
  await w.shot('3-published');
  w.finish();
});

test('O2 schedule a change', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o2-schedule');
  await w.start('/today.html');
  await w.click(shell(page).getByRole('button', { name: /^Website/ }), 'Website (sidebar section)');
  await w.click(shell(page).getByRole('link', { name: 'Publish' }), 'Publish');
  w.note('the schedule panel is on the page already (Oct 20 gap 1) — Schedule it is outlined until the panel has focus');
  await w.shot('1-ritual-panel');
  await w.click(page.getByRole('button', { name: 'Schedule it' }), 'Schedule it (date prefilled +24h)');
  await w.shot('2-scheduled');
  w.finish({ route: 'ritual' });
});

test('O2b schedule from an old Scheduled-changes bookmark', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o2b-schedule-bookmark');
  w.note('schedule.html is retired — an old bookmark or email link lands on the publish page with the schedule block open');
  await w.start('/schedule.html');
  await w.shot('1-forwarded');
  await w.click(page.getByRole('button', { name: 'Schedule it' }), 'Schedule it (date prefilled +24h)');
  await w.shot('2-scheduled');
  w.finish({ route: 'forwarded to presence.html#schedule' });
});

test('O3 connect a domain', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o3-domain');
  await w.start('/today.html');
  await page.locator('#dds-search').click();
  await page.locator('.dds-palette input').fill('domain');
  await page.waitForTimeout(600);
  const hits = await page.locator('.dds-palette .res').allInnerTexts();
  w.note(`⌘K "domain" → ${hits.length} result(s) ${JSON.stringify(hits.map((h) => h.replace(/\n/g, ' / ')))}`);
  await page.keyboard.press('Escape');
  await w.click(shell(page).getByRole('button', { name: /^Website/ }), 'Website (sidebar section)');
  await w.click(shell(page).getByRole('link', { name: 'Domain & email' }), 'Domain & email (menu)');
  const focused = await page.getByPlaceholder('yourbusiness.com').evaluate((el) => el === document.activeElement);
  w.note(`the desk opens on "type your domain", field ${focused ? 'already focused' : 'NOT focused'}`);
  await w.shot('1-desk');
  await w.type(page.getByPlaceholder('yourbusiness.com'), 'marlowskitchen.com', 'domain');
  await w.click(page.getByRole('button', { name: /Connect it/ }), 'Connect it →');
  await w.shot('2-connected');
  w.finish();
});

test('O3b connect a domain from the Website overview card', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o3b-domain-card');
  await w.start('/today.html');
  await w.click(shell(page).getByRole('button', { name: /^Website/ }), 'Website (sidebar section)');
  await w.click(shell(page).getByRole('link', { name: 'Website', exact: true }), 'Website');
  await w.shot('1-overview');
  await w.click(page.locator('#domainCard').getByRole('button', { name: 'Connect your domain' }), 'Connect your domain (overview card)');
  await w.type(page.getByPlaceholder('yourbusiness.com'), 'marlowskitchen.com', 'domain');
  await w.click(page.getByRole('button', { name: /Connect it/ }), 'Connect it →');
  w.finish();
});

test('O4 add a page', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o4-add-page');
  await w.start('/today.html');
  await page.locator('#dds-search').click();
  await page.locator('.dds-palette input').fill('page');
  await page.waitForTimeout(600);
  w.note(`⌘K "page" → ${await page.locator('.dds-palette .res').count()} result(s)`);
  await page.keyboard.press('Escape');
  await w.click(shell(page).getByRole('button', { name: /^Website/ }), 'Website (sidebar section)');
  await w.click(shell(page).getByRole('link', { name: 'Add a page' }), 'Add a page (menu)');
  await w.shot('1-name');
  await w.type(page.getByPlaceholder(/Services, Gallery/), 'Catering', 'page name');
  await w.click(page.getByRole('button', { name: /Next: pick a layout/ }), 'Next: pick a layout');
  await w.click(page.getByRole('button', { name: /Blank page/ }), 'Blank page');
  await w.shot('2-created');
  w.note('then + Add section to put anything on it, then Publish · N → Publish these N changes (2 more clicks, see O1)');
  w.finish();
});

test('O5 reply to an enquiry', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o5-reply-enquiry');
  await w.start('/today.html');
  await w.click(page.getByRole('link', { name: /Take care of it/ }), 'Take care of it → (Today, Needs you)');
  w.note('leads.html is retired — the nudge deep-links the enquiry itself (#enquiries?sel=lead:l1, Oct 20 gap 2): the composer is open on arrival');
  await w.shot('1-composer');
  await w.type(page.locator('#leadBody'), 'Hi Sam,\n\nHappy to quote — what size is the patio?', 'the reply');
  await w.click(page.getByRole('button', { name: 'Send reply' }), 'Send reply');
  await w.shot('2-sent');
  w.note('sent by email from Studio OS (POST /forms/inbox/:id/reply); the reply shows under the enquiry; mailto stays as "Use your email app instead"');
  w.finish();
});

test('O5b reply to an enquiry from the Inbox', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o5b-reply-enquiry-inbox');
  await w.start('/today.html');
  await w.click(shell(page).getByRole('link', { name: 'Inbox' }), 'Inbox');
  await w.click(page.locator('#rows').getByRole('option').filter({ hasText: 'Sam Rivera' }), 'the enquiry row');
  await w.type(page.locator('#leadBody'), 'Hi Sam,\n\nHappy to quote — what size is the patio?', 'the reply');
  await w.click(page.getByRole('button', { name: 'Send reply' }), 'Send reply');
  w.finish();
});
