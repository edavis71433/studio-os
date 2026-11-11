// ── Builder list item 148: one calm pop-up per site, with timing rules ───────
// Off unless the owner switches it on. One small card: a heading, a few words, and
// either the "Join our list" box (item 146) or one or two buttons. It shows after some
// seconds or once the visitor has scrolled part of the page; on every page, the home
// page only, or the pages picked; between two dates if set; on phones only if allowed.
// Closed (or a button used), it stays away for a day, a week, two weeks or a month;
// after someone joins the list, here or anywhere on the site, never again. No exit
// tricks, no countdowns: a native <dialog>, so Escape and the close button work and the
// page behind can't be reached until it's closed. It remembers in the visitor's own
// browser (localStorage, not a cookie, never sent anywhere); the privacy page says so.
//
// Item 147's last piece rides along: a link to "#form-<form id>" (a button, a banner,
// the pop-up's own button) opens that form in the same kind of dialog, or scrolls to it
// when the page already shows it.
//
// Pure: the dates are checked in the visitor's browser, so a pop-up starts and stops on
// its days without a republish; the drawing reads only the snapshot.
import { esc, attr, safeHref } from './markdown.ts';
import { renderForm, type FormDefinition } from './forms.ts';
import { popupTags, POPUP_STYLE, POPUP_CLOSE, FORM_LINK_SCRIPT, type PopupSettings } from './site_send.ts';
export { POPUP_AGAIN_DAYS, type PopupSettings } from './site_send.ts';
import { vocabFor } from './industry_vocab.ts';

type FileMap = Record<string, string | Uint8Array>;

/** The page keys "These pages" can pick; an owner's own page is page:<slug>. */
export const POPUP_PAGE_KEYS = ['home', 'offerings', 'about', 'faq', 'contact', 'updates'] as const;

const s = (x: unknown, n: number) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A pop-up button's link: a page of the site, https, tel or mailto, or #form-<id>. */
export function popupHref(url: unknown): string | null {
  const u = String(url ?? '').trim();
  if (/^\/(?!\/)[\w\-./]*$/.test(u)) return u;
  return safeHref(u);
}

/** The stored setting, made safe and complete; null when it isn't switched on or can't show. */
export function normalizePopup(raw: unknown): PopupSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, any>;
  const heading = s(r.heading, 80);
  const buttons = (Array.isArray(r.buttons) ? r.buttons : []).map((b: any) => ({ label: s(b?.label, 40), url: popupHref(b?.url) || '' })).filter((b) => b.label && b.url).slice(0, 2);
  const action = r.action === 'buttons' ? 'buttons' : 'signup';
  if (r.on !== true || !heading || (action === 'buttons' && !buttons.length)) return null;
  const num = (x: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(x)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const picked = (Array.isArray(r.picked) ? r.picked : []).map(String).filter((k: string) => (POPUP_PAGE_KEYS as readonly string[]).includes(k) || /^page:[a-z0-9-]{1,60}$/.test(k)).slice(0, 40);
  const pages = r.pages === 'home' ? 'home' : r.pages === 'pick' && picked.length ? 'pick' : 'all';
  return {
    on: true, heading, text: s(r.text, 240), action, buttons: action === 'buttons' ? buttons : [],
    after: r.after === 'scroll' ? 'scroll' : 'seconds', seconds: num(r.seconds, 3, 60, 8), scroll: num(r.scroll, 10, 90, 50),
    pages, picked: pages === 'pick' ? picked : [],
    again: (['day', 'week', 'two_weeks', 'month'] as const).includes(r.again) ? r.again : 'week',
    phones: r.phones !== false,
    from: DATE.test(String(r.from || '')) ? String(r.from) : '', until: DATE.test(String(r.until || '')) ? String(r.until) : '',
  };
}

/** A form in a dialog, for a "#form-<id>" link on a page that doesn't show the form. */
export function formDialog(def: FormDefinition, formEndpoint?: string): string {
  return `<dialog id="form-${attr(def.id)}" class="ps-pop ps-pop-form" aria-labelledby="form-${attr(def.id)}-h"><div class="ps-pop-in">${POPUP_CLOSE}<h2 id="form-${attr(def.id)}-h">${esc(def.title || 'Send us a message')}</h2>${renderForm(def, { esc, attr, safeHref, formEndpoint })}</div></dialog>`;
}
// The pages a pop-up never shows on: where a message lands, the legal pages, search, a
// missing page, and a forward's stub (it carries no body to show it over).
const NEVER = new Set(['thanks/index.html', 'not-sent/index.html', 'privacy/index.html', 'accessibility/index.html', 'search/index.html', '404.html']);
function popupFiles(p: PopupSettings, files: string[], offeringPath: string): Set<string> {
  if (p.pages === 'home') return new Set(['index.html']);
  if (p.pages === 'all') return new Set(files);
  const key: Record<string, string> = { home: 'index.html', about: 'about/index.html', faq: 'faq/index.html', contact: 'contact/index.html', updates: 'updates/index.html', offerings: `${offeringPath.replace(/^\/|\/$/g, '')}/index.html` };
  return new Set(p.picked.map((k) => (k.startsWith('page:') ? `${k.slice(5)}/index.html` : key[k])).filter(Boolean));
}

interface PopupContent { settings?: { popup?: unknown; industry?: string; blocks?: unknown[]; pages?: Array<{ slug?: string; blocks?: unknown[] }> } }
/** Item 148: the pop-up on its pages, and a dialog for each form a "#form-<id>" link on
 *  a page asks for. Runs before injectSender, so these forms get the page's sender too. */
export function injectPopup(fileMap: FileMap, content: PopupContent | null | undefined, site: { formEndpoint?: string }): FileMap {
  const p = normalizePopup(content?.settings?.popup);
  const forms = new Map<string, FormDefinition>();
  for (const list of [content?.settings?.blocks || [], ...(content?.settings?.pages || []).map((pg) => pg?.blocks || [])]) {
    for (const b of list as any[]) if (b && b.type === 'form' && typeof b.id === 'string' && Array.isArray(b.fields) && !forms.has(b.id)) forms.set(b.id, b as FormDefinition);
  }
  const pages = Object.keys(fileMap).filter((k) => k.endsWith('.html') && !NEVER.has(k) && typeof fileMap[k] === 'string' && !(fileMap[k] as string).includes('http-equiv="refresh"'));
  const onPop = p ? popupFiles(p, pages, vocabFor(content?.settings?.industry).offeringPath) : new Set<string>();
  if (!onPop.size && !forms.size) return fileMap;
  const pop = p ? popupTags(p, site.formEndpoint) : '';
  const out: FileMap = { ...fileMap };
  for (const k of pages) {
    let html = fileMap[k] as string;
    let add = onPop.has(k) ? pop : '';
    const wanted = new Set([...(html + add).matchAll(/href="#form-([a-z0-9_]{1,40})"/g)].map((m) => m[1]).filter((id) => forms.has(id)));
    for (const id of wanted) if (!html.includes(`id="presence-form-${id}"`)) add += formDialog(forms.get(id)!, site.formEndpoint);
    if (wanted.size) add += FORM_LINK_SCRIPT;
    if (!add || !html.includes('</body>')) continue;
    html = html.replace('</body>', `${POPUP_STYLE}${add}</body>`);
    out[k] = html;
  }
  return out;
}
