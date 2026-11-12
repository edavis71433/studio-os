import { expect, type Page } from '@playwright/test';

// Builder item 165 (Figma 295:3): the one page header every page draws (shell.css .dds-ph).
// The rules, checked the same way on every page:
//   the title is always there, an h1 in the serif, 30px on a computer, no emoji, no dot;
//   the icon comes from the one icon set, in a soft tile;
//   one line under the title says what is here (with real counts where there are any);
//   actions sit on the right, at most one of them filled;
//   a view picker sits beside the title, never instead of it;
//   a trail only when the page lives inside another ("Settings ›");
//   on a phone the filled action goes full width under the title and the others behind ⋯.
export interface HeaderWant {
  title: string | RegExp;
  icon: string;                   // the data-ic key
  line?: string | RegExp | null;  // null: the page has no line (none should); omitted: any non-empty line
  trail?: string;                 // "Settings": the trail says where the page lives
  picker?: string | RegExp;       // the view picker's words, beside the title
  filled?: string | RegExp | null;// the one filled action (null: none)
  tabs?: string[];                // the tabs under the header, in order
}
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

export async function expectOneHeader(page: Page, want: HeaderWant): Promise<void> {
  const head = page.locator('header.dds-ph').first();
  await expect(head).toBeVisible();
  await expect(page.locator('header.dds-ph')).toHaveCount(1);
  const h1 = head.locator('h1');
  await expect(h1).toHaveText(want.title);
  await expect(page.locator('h1:visible')).toHaveCount(1);                           // one title on the page
  await expect(head.locator(`.dds-ph-ic[data-ic="${want.icon}"]`)).toBeVisible();
  const phone = (page.viewportSize()?.width || 0) < 761;
  const font = await h1.evaluate((el) => { const cs = getComputedStyle(el); return { size: parseFloat(cs.fontSize), family: cs.fontFamily }; });
  expect(font.family).toMatch(/Fraunces/);
  expect(font.size).toBe(phone ? 26 : 30);
  expect(EMOJI.test((await head.locator('.dds-ph-row').innerText()) || '')).toBe(false);
  const line = head.locator('.dds-ph-line');
  if (want.line === null) await expect(line).toHaveCount(0);
  else if (want.line) await expect(line).toHaveText(want.line);
  else await expect(line).not.toBeEmpty();
  if (want.trail) await expect(head.locator('.dds-ph-trail')).toContainText(want.trail);
  else await expect(head.locator('.dds-ph-trail')).toHaveCount(0);
  if (want.picker) {
    const pick = head.locator('.dds-ph-tl .dds-ph-pick');
    await expect(pick).toContainText(want.picker);
    const hb = (await h1.boundingBox())!, pb = (await pick.boundingBox())!;
    if (!phone) expect(Math.abs((pb.y + pb.height / 2) - (hb.y + hb.height / 2))).toBeLessThan(hb.height);   // beside the title, not under it
  }
  // at most one filled action, and it is the one asked for
  const filled = head.locator('.dds-ph-acts .btn.primary, .dds-ph-acts button.primary, .dds-ph-acts .dds-ph-fill');
  if (want.filled === null) await expect(filled).toHaveCount(0);
  else if (want.filled) { await expect(filled).toHaveCount(1); await expect(filled).toContainText(want.filled); }
  else expect(await filled.count()).toBeLessThanOrEqual(1);
  if (want.tabs) await expect(head.locator('.dds-ph-tabs > a, .dds-ph-tabs > button')).toHaveText(want.tabs);
  if (phone && want.filled) {
    // the filled action takes the width under the title
    const fb = (await filled.boundingBox())!, rb = (await head.locator('.dds-ph-row').boundingBox())!;
    expect(fb.width).toBeGreaterThan(rb.width - 4);
    expect(fb.height).toBeGreaterThanOrEqual(44);
  }
  if (phone && (await head.locator('.dds-ph-more > *').count()) > 0) {
    // the other actions wait behind ⋯
    await expect(head.locator('.dds-ph-dots')).toBeVisible();
    await expect(head.locator('.dds-ph-more')).toBeHidden();
  }
}
