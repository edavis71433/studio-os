import type { Page } from '@playwright/test';

// ── shell.js landing late ────────────────────────────────────────────────────
// Every app page loads shell.js with defer: it runs once the page has parsed, just before
// DOMContentLoaded, and on a slow phone it can still be downloading after the page's own script
// has drawn. A spec holds it back to see what the page does meanwhile. Two things to know:
// - goto needs `waitUntil: 'commit'`: the load event waits on the held script.
// - WebKit paints nothing while a deferred script is on its way (it still runs the page's script),
//   so Playwright's click never sees the element settle. A press made before the release is sent
//   from script (`dispatchEvent('click')`); after it, real clicks work.

/** Hold shell.js on the wire. The page runs without it; the function returned lets it through. */
export async function holdShell(page: Page): Promise<() => void> {
  let letGo = () => {};
  const gate = new Promise<void>((r) => { letGo = r; });
  await page.route('**/shell.js', async (route) => { await gate; await route.continue().catch(() => { /* the test ended first */ }); });
  return letGo;
}
