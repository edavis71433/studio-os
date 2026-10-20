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
  await w.click(page.getByRole('button', { name: /Publish later/ }), 'Publish later — pick a time…');
  await w.shot('1-ritual-panel');
  await w.click(page.getByRole('button', { name: 'Schedule it' }), 'Schedule it (date prefilled +24h)');
  await w.shot('2-scheduled');
  w.finish({ route: 'ritual' });
});

test('O2b schedule via Scheduled publishes page', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o2b-schedule-page');
  await w.start('/today.html');
  await w.click(shell(page).getByRole('button', { name: /^Website/ }), 'Website (sidebar section)');
  await w.click(shell(page).getByRole('link', { name: 'Scheduled publishes' }), 'Scheduled publishes');
  await w.shot('1-schedule-page');
  const when = page.locator('input[type=datetime-local], input[type=date]').first();
  if (await when.count()) { const d = new Date(Date.now() + 3 * 86400000); await w.type(when, d.toISOString().slice(0, 16), 'when'); }
  await w.click(page.getByRole('button', { name: /Schedule publish/ }), 'Schedule publish');
  await w.shot('2-scheduled');
  w.finish({ route: 'schedule.html' });
});

test('O3 connect a domain', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o3-domain');
  await w.start('/today.html');
  // is "domain" findable from ⌘K?
  await page.keyboard.press('Meta+k'); await page.keyboard.press('Control+k').catch(() => {});
  await page.locator('.dds-palette input').fill('domain');
  await page.waitForTimeout(600);
  const hits = await page.locator('.dds-palette .res').allInnerTexts();
  w.note(`⌘K "domain" → ${hits.length} results ${JSON.stringify(hits)}`);
  await page.keyboard.press('Escape');
  await w.click(shell(page).getByRole('button', { name: /^Website/ }), 'Website (sidebar section)');
  await w.click(shell(page).getByRole('link', { name: 'Website', exact: true }), 'Website');
  await w.click(page.getByRole('link', { name: /Domain & email/ }).or(page.getByRole('button', { name: /Domain & email/ })), 'Domain & email (builder rail)');
  await w.shot('1-desk');
  await w.click(page.getByRole('button', { name: 'I already have a domain' }), 'I already have a domain');
  await w.type(page.getByPlaceholder('yourbusiness.com'), 'marlowskitchen.com', 'domain');
  await w.click(page.getByRole('button', { name: /Connect it/ }), 'Connect it →');
  await w.shot('2-connected');
  w.finish();
});

test('O4 add a page', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o4-add-page');
  await w.start('/today.html');
  await w.click(shell(page).getByRole('button', { name: /^Website/ }), 'Website (sidebar section)');
  await w.click(shell(page).getByRole('link', { name: 'Design' }), 'Design');
  await w.shot('1-design');
  await w.click(page.getByRole('button', { name: /^\+\s*Page|＋\s*Page/ }), '+ Page');
  await w.type(page.getByPlaceholder(/Services, Gallery/), 'Catering', 'page name');
  await w.click(page.getByRole('button', { name: /Next: pick a layout/ }), 'Next: pick a layout');
  await w.shot('2-layout');
  await w.click(page.getByRole('button', { name: /Blank page/ }), 'Blank page');
  await w.shot('3-created');
  w.note('then + Add section to put anything on it, then Publish · N → Publish these N changes (2 more clicks, see O1)');
  w.finish();
});

test('O5 reply to an enquiry', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o5-reply-enquiry');
  await w.start('/today.html');
  await w.click(page.getByRole('link', { name: /Take care of it/ }), 'Take care of it → (Today, Needs you)');
  await w.shot('1-enquiries');
  const reply = page.locator('a.reply').first();
  w.note(`Reply is a link: href=${(await reply.getAttribute('href'))?.slice(0, 60)}… — the reply is written in the mail app, not in Studio OS`);
  w.clicks++; w.steps.push(`${w.clicks}. click "Reply" → leaves Studio OS (mailto:)`);
  w.finish();
});

test('O5b reply to an enquiry from the Inbox', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  const w = new Walk(page, 'o5b-reply-enquiry-inbox');
  await w.start('/today.html');
  await w.click(shell(page).getByRole('link', { name: 'Inbox' }), 'Inbox');
  await w.click(page.getByText('Sam Rivera').first(), 'the enquiry row');
  await w.shot('1-inbox-enquiry');
  const r = page.locator('#leadReply');
  w.note(`Reply here is also mailto: ${(await r.getAttribute('href').catch(() => ''))?.slice(0, 40)}`);
  w.finish();
});
