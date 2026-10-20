import { Page } from '@playwright/test';
// Filled = a visible button/link whose own background is dark/saturated (luminance < 0.55, alpha > 0.5).
export async function filled(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d')!;
    const lum = (c: string) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = 'rgba(0,0,0,0)'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data; return { l: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255, a: a / 255 }; };
    document.querySelectorAll('button, a, input[type=submit]').forEach((el) => {
      const e = el as HTMLElement; const r = e.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return;
      const cs = getComputedStyle(e); if (cs.visibility === 'hidden' || cs.display === 'none') return;
      if (e.closest('#dds-shell, #dds-mbar, .dds-palette')) return; if (/skip to/i.test(e.innerText || '')) return;
      const { l, a } = lum(cs.backgroundColor);
      if (a > 0.5 && l < 0.55) out.push(((e.innerText || e.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50)) + (r.top > 800 ? ' (below fold)' : ''));
    });
    return out;
  });
}
export async function snap(page: Page, name: string, dir = process.env.SHOTS!) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/${name}.png` });
}
export async function report(page: Page, label: string) {
  const f = await filled(page);
  const h1 = await page.locator('h1').first().innerText().catch(() => '');
  console.log(`@@ ${label} | ${new URL(page.url()).pathname}${new URL(page.url()).hash} | h1="${h1.trim().slice(0, 60)}" | filled=${JSON.stringify(f)}`);
}
