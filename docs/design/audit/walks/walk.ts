import { Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import { filled } from './probe';

export const SHOTS = process.env.AUDIT_SHOTS || 'docs/design/audit';
export const LOG = process.env.AUDIT_LOG || '/tmp/audit-walks.jsonl';

// Records every click, every page change and the filled button(s) at each step.
export class Walk {
  clicks = 0; typed = 0; pages: string[] = []; steps: string[] = [];
  constructor(public page: Page, public job: string) {}
  private where() { const u = new URL(this.page.url()); return u.pathname + u.search + u.hash; }
  async start(path: string) {
    await this.page.goto(path); await this.page.waitForLoadState('networkidle'); await this.page.waitForTimeout(400);
    this.pages.push(this.where());
    this.steps.push(`start ${this.where()} · filled ${JSON.stringify(await filled(this.page))}`);
  }
  async click(loc: Locator, what: string, opts: { noCount?: boolean } = {}) {
    const before = this.where();
    await loc.first().click({ timeout: 6000 });
    if (!opts.noCount) this.clicks++;
    await this.page.waitForLoadState('networkidle').catch(() => {}); await this.page.waitForTimeout(500);
    const after = this.where();
    if (after.split('#')[0] !== before.split('#')[0]) this.pages.push(after);
    else if (after !== before) this.pages.push(after);
    this.steps.push(`${opts.noCount ? '·' : this.clicks}. click "${what}"${after !== before ? ` → ${after}` : ''} · filled ${JSON.stringify(await filled(this.page))}`);
  }
  async type(loc: Locator, text: string, what: string) {
    await loc.first().fill(text); this.typed++;
    this.steps.push(`   type ${what}`);
  }
  note(s: string) { this.steps.push(`   note: ${s}`); }
  async shot(n: string) { await this.page.waitForTimeout(500); await this.page.screenshot({ path: `${SHOTS}/${this.job}-${n}.png` }); this.steps.push(`   📷 ${this.job}-${n}.png`); }
  finish(extra: Record<string, unknown> = {}) {
    const distinct = Array.from(new Set(this.pages.map((p) => p.split('?')[0].split('#')[0])));
    const rec = { job: this.job, clicks: this.clicks, typed: this.typed, pageChanges: this.pages.length - 1, distinctPages: distinct, steps: this.steps, ...extra };
    fs.appendFileSync(LOG, JSON.stringify(rec) + '\n');
    console.log(`\n### ${this.job}: ${this.clicks} clicks, ${this.typed} fields, pages ${distinct.join(' → ')}\n` + this.steps.join('\n'));
  }
}

export async function quiet(page: Page) {
  // no onboarding hints / tour in the walks — they cover the controls being counted
  await page.addInitScript(() => { document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = '.dds-hint{display:none!important}'; document.head.appendChild(s); }); });
}
