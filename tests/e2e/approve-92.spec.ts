import { test, expect, Page } from '@playwright/test';

// Sales item 92 (Nov 2026): the one-tap approval page says who is asking (the studio, by
// name), shows what is being approved (the words of a Google post, what changes, what
// stays the same, whether it can be undone), and "Not yet" can say what should change.
// Drawn in Figma: page "One-tap approval page — sales item 92". Every name is made up.

const PENDING = { data: {
  title: 'Publish a post to your Google listing', kind: 'connected', business_name: 'Corner Café',
  summary: 'A short update in your own words is posted to your Google listing.',
  studio: { name: 'Brightline Studio', logo_url: null },
  tag: 'Google listing', post: 'Spring hours start Monday: open until 8pm on weekdays.',
  changes: ['A new post appears on your Google listing.'],
  stays: ['Your hours, phone, address, photos and reviews are untouched.', 'Nothing on your own website changes.'],
  undo: { reversible: true, how: 'The post can be deleted from your listing in one step.' },
} };
async function serve(page: Page) {
  const posts: any[] = [];
  await page.route('**/functions/v1/presence/approve**', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PENDING) });
    const body = route.request().postDataJSON();
    posts.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { ok: true, decision: body.decision === 'approve' ? 'approved' : 'set_aside' } }) });
  });
  return posts;
}

test.describe('The approval page shows what is being approved (sales item 92)', () => {
  test('who is asking, the post’s words, what changes, what stays, and whether it can be undone', async ({ page }) => {
    await serve(page);
    await page.goto('/approve.html?token=tok');
    await expect(page.locator('.brand')).toHaveText('BBrightline Studio');
    await expect(page).toHaveTitle('Review & approve — Brightline Studio');
    await expect(page.getByText('Davis Digital Studio')).toHaveCount(0);
    await expect(page.locator('.tag')).toHaveText('Google listing');
    await expect(page.getByText('“Spring hours start Monday: open until 8pm on weekdays.”')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What changes' })).toBeVisible();
    await expect(page.getByText('A new post appears on your Google listing.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What stays the same' })).toBeVisible();
    await expect(page.getByText('Nothing on your own website changes.')).toBeVisible();
    await expect(page.getByText('Yes. The post can be deleted from your listing in one step.')).toBeVisible();
  });
  test('Not yet asks what should change, sends the note, and says who it went to', async ({ page }) => {
    const posts = await serve(page);
    await page.goto('/approve.html?token=tok');
    await page.getByRole('button', { name: 'Not yet' }).click();
    await expect(page.getByText('Nothing is changed. Your note goes to Brightline Studio.')).toBeVisible();
    await page.getByLabel('What should change? (optional)').fill('Can we say open late on Fridays too?');
    await page.getByRole('button', { name: 'Send note' }).click();
    await expect(page.getByText('Sent to Brightline Studio.')).toBeVisible();
    await expect(page.getByText('Nothing was changed. They’ll look at your note and come back to you.')).toBeVisible();
    expect(posts).toEqual([{ token: 'tok', decision: 'reject', note: 'Can we say open late on Fridays too?' }]);
  });
  test('Back keeps everything as it was; Not yet with no note still tells the studio', async ({ page }) => {
    const posts = await serve(page);
    await page.goto('/approve.html?token=tok');
    await page.getByRole('button', { name: 'Not yet' }).click();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    expect(posts).toEqual([]);
    await page.getByRole('button', { name: 'Not yet' }).click();
    await page.getByRole('button', { name: 'Send note' }).click();
    await expect(page.getByText('Nothing was changed. Brightline Studio has been told.')).toBeVisible();
    expect(posts).toEqual([{ token: 'tok', decision: 'reject', note: '' }]);
  });
  test('Approve thanks them in the studio’s name', async ({ page }) => {
    const posts = await serve(page);
    await page.goto('/approve.html?token=tok');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Approved, thank you.')).toBeVisible();
    await expect(page.getByText('Brightline Studio will take it from here.', { exact: false })).toBeVisible();
    expect(posts[0]).toMatchObject({ decision: 'approve' });
  });
});
