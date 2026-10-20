import { Page } from '@playwright/test';
import { installApp } from '../../../../../tests/e2e/helpers/app';
import { AGENCY_CTX, SCOPED_CTX, SCOPED_API, STUDIO_API, PORTFOLIO } from './fixtures';
import { quiet } from '../../walks/walk';

export { Walk } from '../../walks/walk';
export const shell = (p: Page) => p.locator('#dds-shell');

/** The agency owner, signed in. /portal/context answers by the scope header: the
 *  studio context without one, the drilled client's context with one — exactly
 *  how the server decides it (lib/scope.ts). */
export async function studio(page: Page, extra: Record<string, unknown> = {}) {
  await quiet(page);
  await page.addInitScript(() => { try { localStorage.setItem('dds-display:agency', 'table'); localStorage.setItem('dds-display:customers', 'table'); } catch { /* */ } });
  await installApp(page, { api: { ...SCOPED_API, ...extra } });
  await page.route('**/functions/v1/presence/portal/context', (route) => {
    const s = route.request().headers()['x-dds-scope-site'] || '';
    const client = PORTFOLIO.find((c) => c.site_id === s);
    const body = s ? SCOPED_CTX(client ? client.name : 'Unknown client', s) : AGENCY_CTX;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}
export const API = STUDIO_API;
