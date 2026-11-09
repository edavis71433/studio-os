import { test, expect } from '@playwright/test';
import { installApp } from './helpers/app';

// List item 99 (Nov 8 2026): Slate keeps its own dark colours over the colour tokens, as the
// Styles panel says; Developer Mode let a developer set them with no word that they do nothing.
const files = (slug: string) => ({ data: { files: [{ path: 'theme/tokens.json', kind: 'theme', editable: true }], template: { slug, version: '1.0.0' } } });
const CUSTOMIZATION = { data: { theme_tokens: {}, custom_css: '', custom_html: '', allowed_tokens: ['accent', 'ink', 'font_body'] } };

test.describe('Developer Mode and templates that keep their own colours (item 99)', () => {
  test('on Slate, the colour tokens say they don’t change the site', async ({ page }) => {
    await installApp(page, { api: { '/dev/files': files('slate'), '/dev/customization': CUSTOMIZATION } });
    await page.goto('/developer.html');
    await expect(page.locator('[data-tok="accent"]')).toBeVisible();
    await expect(page.locator('#fixedColors')).toHaveText('Slate keeps its own dark colors, so the color tokens here don’t change your site. Fonts, text size, corners and spacing still do.');
  });

  test('on any other template, no such note', async ({ page }) => {
    await installApp(page, { api: { '/dev/files': files('meadow'), '/dev/customization': CUSTOMIZATION } });
    await page.goto('/developer.html');
    await expect(page.locator('[data-tok="accent"]')).toBeVisible();
    await expect(page.locator('#fixedColors')).toHaveCount(0);
  });
});
