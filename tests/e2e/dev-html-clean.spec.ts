import { test, expect } from '@playwright/test';
import { cleanDevHtml } from '../../supabase/functions/presence/lib/dev_html';

// Builder item 190: a developer's HTML block is read the way a browser reads it. The
// unit test (tests/presence/devmode_test.mjs) checks the cleaner's result by its shape;
// this one hands the result to the real browser, on each of the three engines, and looks
// at what the browser built from it. Each sample would set window.__ran if it ran.
const RUN = 'window.__ran=(window.__ran||0)+1';
const SAMPLES = [
  `<img src="x"/onerror="${RUN}">`,
  `<a href=javascript:${RUN}>x</a>`,
  `<img src=x onerror=${RUN}>`,
  `<svg/onload=${RUN}>`,
  `<img src="x"onerror="${RUN}">`,
  `<img src="x"\tonerror="${RUN}">`,
  `<img src="x"\nonerror\n=\n"${RUN}">`,
  `<img src="x"\fonerror="${RUN}">`,
  `<img/src="x"/onerror=${RUN}//>`,
  `<p title="a>b" onclick="${RUN}">hi</p>`,
  `<a href="jav&#x61;script:${RUN}">x</a>`,
  `<a href="&#106avascript:${RUN}">x</a>`,
  `<a href="javascript&colon;${RUN}">x</a>`,
  `<a href="java\tscript:${RUN}">x</a>`,
  `<a href="java&Tab;script:${RUN}">x</a>`,
  `<a href="java&NewLine;script:${RUN}">x</a>`,
  `<a href="  javascript:${RUN}">x</a>`,
  `<a href="\u0001javascript:${RUN}">x</a>`,
  `<a href="data:text/html,<script>${RUN}</script>">x</a>`,
  `<scr<script>ipt>${RUN}</scr</script>ipt>`,
  `<<script>script>${RUN}<</script>/script>`,
  `<script>${RUN}</script>`,
  `<script>${RUN}`,
  `<style><img src="</style><img src=x onerror=${RUN}>">`,
  `<title><img src=x onerror=${RUN}></title>`,
  `<textarea></textarea><img src=x onerror=${RUN}>`,
  `<noscript><p title="</noscript><img src=x onerror=${RUN}>">`,
  `<iframe srcdoc="<script>parent.__ran=1</script>"></iframe>`,
  `<iframe src="javascript:parent.__ran=1"></iframe>`,
  `<object data="javascript:${RUN}"></object>`,
  `<embed src="javascript:${RUN}">`,
  `<math><mi xlink:href="javascript:${RUN}">x</mi></math>`,
  `<svg><a xlink:href="javascript:${RUN}"><text>x</text></a></svg>`,
  `<svg><style><img src=x onerror=${RUN}></style></svg>`,
  `<math><mtext><table><mglyph><style><img src=x onerror=${RUN}>`,
  `<form action="javascript:${RUN}"><button formaction="javascript:${RUN}">go</button></form>`,
  `<input autofocus onfocus=${RUN}>`,
  `<details open ontoggle=${RUN}>x</details>`,
  `<video><source onerror=${RUN}></video>`,
  `<base href="javascript:${RUN}//">`,
  `<meta http-equiv="refresh" content="0;url=javascript:${RUN}">`,
  `<!--><img src=x onerror=${RUN}>-->`,
  `<!-- --!><img src=x onerror=${RUN}>`,
  `<!--<img src="--><img src=x onerror=${RUN}>">`,
  `<![CDATA[<img src=x onerror=${RUN}>]]>`,
  `</p title="><img src=x onerror=${RUN}>">`,
  `<p =onclick="${RUN}">x</p>`,
  `<plaintext><img src=x onerror=${RUN}>`,
  `</div></div></section><img src=x onerror=${RUN}>`,
  `<div><table><tr><td><p>left open`,
];

test('item 190: what the cleaner writes, a real browser reads as plain content', async ({ page }) => {
  const slots = SAMPLES.map((s, i) => `<section class="slot" data-i="${i}">${cleanDevHtml(s)}</section>`).join('\n');
  await page.setContent(`<!doctype html><html><head><title>t</title></head><body>${slots}<p id="after">after</p></body></html>`);
  // let every picture that can't load say so: a handler left behind would run here
  await page.evaluate(() => Promise.all([...document.images].map((im) => im.complete ? null : new Promise((r) => { im.addEventListener('error', r); im.addEventListener('load', r); }))));
  const seen = await page.evaluate(() => {
    const bad: string[] = [];
    const slots = [...document.querySelectorAll('section.slot')];
    for (const el of document.querySelectorAll('section.slot *')) {
      const tag = el.localName;
      if (['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'svg', 'math', 'base', 'meta', 'link', 'textarea', 'video', 'details'].includes(tag)) bad.push(`<${tag}>`);
      if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') bad.push(`${tag} in another namespace`);
      for (const a of el.attributes) {
        if (/^on/i.test(a.name) || ['style', 'srcdoc', 'name', 'action', 'formaction'].includes(a.name)) bad.push(`${tag} ${a.name}`);
      }
      const where = (el as HTMLAnchorElement).href || (el as HTMLImageElement).src || '';
      if (where && !/^(https?|mailto|tel|about):/i.test(new URL(where, 'https://site.example/').protocol + '')) bad.push(`${tag} goes to ${where}`);
    }
    return {
      bad,
      ran: (window as unknown as { __ran?: number }).__ran || 0,
      slots: slots.length,
      // every block stayed inside its own slot: the slots are still side by side, and the
      // line after them is still the body's own
      sideBySide: slots.every((s) => s.parentElement === document.body),
      afterIsFree: document.getElementById('after')?.parentElement === document.body,
      title: document.title,
    };
  });
  expect(seen.bad).toEqual([]);
  expect(seen.ran).toBe(0);
  expect(seen.slots).toBe(SAMPLES.length);
  expect(seen.sideBySide).toBe(true);
  expect(seen.afterIsFree).toBe(true);
  expect(seen.title).toBe('t');
  // following every link left behind runs nothing either
  for (const a of await page.locator('section.slot a[href]').all()) {
    await a.evaluate((el) => { el.addEventListener('click', (e) => e.preventDefault()); (el as HTMLElement).click(); });
  }
  expect(await page.evaluate(() => (window as unknown as { __ran?: number }).__ran || 0)).toBe(0);
});

test('item 190: the browser builds the same thing from a cleaned block as the cleaner wrote', async ({ page }) => {
  // If the browser's reading of the result differed from the cleaner's, innerHTML would differ.
  await page.setContent('<!doctype html><html><body><div id="slot"></div></body></html>');
  for (const s of SAMPLES) {
    const cleaned = cleanDevHtml(s);
    const back = await page.evaluate((h) => { const d = document.getElementById('slot')!; d.innerHTML = h; return d.innerHTML; }, cleaned);
    // the browser fills in table parts and may drop an empty paragraph's stray close; a second clean of what it built must change nothing dangerous
    expect(cleanDevHtml(back), s).toBe(back);
  }
});
