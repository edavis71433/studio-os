import { test, expect, type Page } from '@playwright/test';
import { installApp, settled } from './helpers/app';
import { CONTACTS_API, PROJECTS_API, AGENCY_API, BROADCASTS_API, CUSTOMERS_API } from './tap-targets-98.fixtures';
import { SETTINGS_98 } from './tap-targets-98.settings';
import { SHARING_98 } from './tap-targets-98.sharing';
import { ANALYTICS_98 } from './tap-targets-98.analytics';
import { INBOX_98 } from './tap-targets-98.inbox';
import { PIPELINE_98 } from './tap-targets-98.pipeline-phone-numbers';
import { RECORD_98, RECORD_98_CLIENT } from './tap-targets-98.phone-tablet-walk';

// ── Builder item 98: on a touch screen, every control is a finger-sized target ─────────
// The Nov 8 review measured taps of 16 to 32px where 44px is the phone standard: link-style
// buttons, list toolbars, chips, switches, tags, the shell's brand mark. This walks back-office
// pages on the phone and tablet projects (both touch screens) and, for every control on the
// page, presses the four edges of the 44x44 box centred on it: a finger that lands anywhere in
// that box must press that control, not the page and not a neighbour. A bigger hit area that
// keeps a small look (padding, a pseudo-element) passes; two controls closer than 44px apart
// don't. A link inside a sentence is the one exception (WCAG 2.5.8 lets those be).
// The made-up businesses in the fixtures are invented.

type Miss = { el: string; text: string; w: number; h: number; side: string };

/** Every visible control whose 44x44 box isn't all its own, after scrolling each to the middle. */
async function smallTargets(page: Page): Promise<Miss[]> {
  return page.evaluate(async () => {
    const SEL = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"]';
    const name = (el: Element) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0 || cs.pointerEvents === 'none') return false;
      if (el.closest('[inert], [aria-hidden="true"], dialog:not([open]), [hidden]')) return false;
      if ((el as HTMLButtonElement).disabled) return false;
      const d = el.closest('details');   // inside a closed section (WebKit still gives it a box), all but its summary
      if (d && !(d as HTMLDetailsElement).open && !el.closest('summary')) return false;
      return true;
    };
    // a link inside a sentence: inline, with words of its own around it
    const inSentence = (el: Element) => {
      if (el.tagName !== 'A' || getComputedStyle(el).display !== 'inline') return false;
      const p = el.parentElement; if (!p) return false;
      const own = (el.textContent || '').trim().length, all = (p.textContent || '').trim().length;
      return all - own > 12 && /[a-z]{3}/i.test((p.textContent || '').replace(el.textContent || '', ''));
    };
    // the shell makes a list's whole tick-box cell the target (shell.js ddsListKit)
    const targetOf = (el: Element) => el.closest('td.pick, th.pick') || el;
    const ok = (el: Element, hit: Element | null) => {
      if (!hit) return false;
      const t = targetOf(el);
      if (t === hit || t.contains(hit)) return true;
      const lab = hit.closest('label');
      return !!(lab && ((lab as HTMLLabelElement).control === el || lab.contains(el)));
    };
    const out: { el: string; text: string; w: number; h: number; side: string }[] = [];
    const seen = new Set<Element>();
    for (const el of Array.from(document.querySelectorAll(SEL))) {
      if (!shown(el) || inSentence(el)) continue;
      const t = targetOf(el); if (seen.has(t)) continue; seen.add(t);
      t.scrollIntoView({ block: 'center', inline: 'center' });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const r = t.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;   // parked off the page until focused (the skip link)
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const probes: Array<[string, number, number]> = [['top', cx, cy - 21], ['bottom', cx, cy + 21], ['left', cx - 21, cy], ['right', cx + 21, cy]];
      const missed = probes.map(([s, x, y]) => [s, document.elementFromPoint(x, y)] as const).filter(([, hit]) => !ok(el, hit));
      if (missed.length) out.push({ el: name(el), text: (el.getAttribute('aria-label') || (el as HTMLElement).innerText || (el as HTMLInputElement).value || '').replace(/\s+/g, ' ').trim().slice(0, 50), w: Math.round(r.width), h: Math.round(r.height), side: missed.map(([s, hit]) => s + (hit ? ' (' + name(hit) + ')' : '')).join(', ') });
    }
    window.scrollTo(0, 0);
    return out;
  });
}

const PAGES: Array<{ name: string; path: string; api: Record<string, unknown>; ready: string }> = [
  { name: 'Home', path: '/agency.html', api: AGENCY_API, ready: 'header.dds-ph' },
  { name: 'Customers', path: '/customers.html', api: CUSTOMERS_API, ready: 'header.dds-ph' },
  { name: 'Contacts', path: '/contacts.html', api: CONTACTS_API, ready: 'header.dds-ph' },
  { name: 'Projects', path: '/projects.html', api: PROJECTS_API, ready: 'header.dds-ph' },
  { name: 'Send an update', path: '/broadcasts.html', api: BROADCASTS_API, ready: 'header.dds-ph' },
  { name: 'Pipeline', path: '/pipeline.html', api: PIPELINE_98, ready: 'header.dds-ph' },
  { name: 'The record', path: `/crm.html?client=${RECORD_98_CLIENT}`, api: RECORD_98, ready: '#act-invoice' },
  { name: 'Inbox', path: '/inbox.html', api: INBOX_98, ready: 'header.dds-ph' },
  { name: 'Settings', path: '/settings.html', api: SETTINGS_98, ready: 'header.dds-ph' },
  { name: 'Sharing', path: '/sharing.html', api: SHARING_98, ready: 'header.dds-ph' },
  { name: 'Analytics', path: '/analytics.html', api: ANALYTICS_98, ready: 'header.dds-ph' },
];

test.describe('every control is a finger-sized target on a touch screen (builder item 98)', () => {
  for (const pg of PAGES) {
    test(`${pg.name}`, async ({ page }) => {
      test.skip(!test.info().project.use.hasTouch, 'touch screens only: a mouse keeps the compact desktop sizes');
      await page.clock.setFixedTime(new Date('2026-11-16T18:00:00Z'));
      await installApp(page, { api: pg.api as never });
      await page.goto(pg.path);
      await expect(page.locator(pg.ready)).toBeVisible();
      await settled(page);
      const small = await smallTargets(page);
      expect(small, small.map((m) => `${m.el} "${m.text}" ${m.w}x${m.h} misses ${m.side}`).join('\n')).toEqual([]);
    });
  }
});
