// Builder item 98: the tap walk, shared by the back office's walk (tap-targets-98.spec.ts) and the
// editor's (tap-targets-98-editor.spec.ts). For every visible control it presses the four edges of
// the 44x44 box centred on it: a finger that lands anywhere in that box must press that control.
import type { Page, Frame } from '@playwright/test';

export type Miss = { el: string; text: string; w: number; h: number; side: string };

/** Every visible control whose 44x44 box isn't all its own, after scrolling each to the middle. */
export async function smallTargets(page: Page | Frame, within = 'body'): Promise<Miss[]> {
  return page.evaluate(async (within) => {
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
    for (const el of Array.from(document.querySelector(within)?.querySelectorAll(SEL) || [])) {
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
  }, within);
}

export const say = (small: Miss[]) => small.map((m) => `${m.el} "${m.text}" ${m.w}x${m.h} misses ${m.side}`).join('\n');
