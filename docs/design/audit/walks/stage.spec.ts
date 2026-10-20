import { test } from '@playwright/test';
import { installApp } from '../../../../tests/e2e/helpers/app';
import { PRESENCE_API } from './fixtures';
import { quiet, SHOTS } from './walk';
test('preview stage back control', async ({ page }) => {
  await quiet(page); await installApp(page, { api: PRESENCE_API });
  await page.goto('/presence.html'); await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'See your site' }).click(); await page.waitForTimeout(800);
  const info = await page.evaluate(() => { const b = document.getElementById('btnStageClose')!; const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const st = getComputedStyle(document.getElementById('stage')!); const sh = getComputedStyle(document.getElementById('dds-shell')!); return { back: [r.left, r.top], topmost: t && (t.id || t.className), stageZ: st.zIndex, stagePos: st.position, stageTop: st.top, shellZ: sh.zIndex, shellPos: sh.position }; });
  console.log('INFO', JSON.stringify(info));
  await page.screenshot({ path: `${SHOTS}/finding-preview-back-covered.png` });
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  console.log('ON after Escape', await page.locator('#stage.on').count());
  await page.evaluate(() => (document.getElementById('btnStageClose') as HTMLButtonElement).click()); await page.waitForTimeout(400);
  console.log('ON after scripted click', await page.locator('#stage.on').count());
});
