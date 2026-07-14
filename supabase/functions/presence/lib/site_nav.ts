// ── Editable GLOBAL navigation — shared render helper ────────────────────────
// The header/footer are global: every page of every template renders through the
// template's shell(), so ONE settings.nav drives the top nav on all pages. This
// helper turns the validated nav model (label + safe href + one level of dropdown
// children) into the same accessible, ZERO-JS <li> list every template already uses
// inside <nav class="primary"><ul>…</ul></nav>. Dropdowns open on hover/focus-within
// (CSS only — no script) and fall back to a nested static list on phones.
//
// The serializer is the authoritative validator (safe hrefs only, caps, one depth);
// this helper only ESCAPES for output. Never emits script, style, or raw markup.

export interface NavRenderItem { label: string; href: string; children?: Array<{ label: string; href: string }> }

/** Render the <li> items for a custom nav (goes inside the template's existing
 *  <nav class="primary"><ul>…</ul>). `currentPath` marks the active link. */
export function renderNavList(
  nav: NavRenderItem[],
  currentPath: string,
  esc: (s: string) => string,
  attr: (s: string) => string,
): string {
  const cur = (href: string) => (href === currentPath ? ' aria-current="page"' : '');
  return nav.map((it) => {
    const kids = Array.isArray(it.children) ? it.children : [];
    if (kids.length) {
      const active = it.href === currentPath || kids.some((k) => k.href === currentPath);
      const sub = kids.map((k) => `<li><a href="${attr(k.href)}"${cur(k.href)}>${esc(k.label)}</a></li>`).join('');
      return `<li class="has-sub"><a href="${attr(it.href)}"${active ? ' aria-current="page"' : ''} aria-haspopup="true">${esc(it.label)}<span class="sub-caret" aria-hidden="true">▾</span></a><ul class="subnav">${sub}</ul></li>`;
    }
    return `<li><a href="${attr(it.href)}"${cur(it.href)}>${esc(it.label)}</a></li>`;
  }).join('');
}

/** The extra CSS a dropdown nav needs — appended to a template's stylesheet ONLY when
 *  the owner set a custom nav (so sites without one stay byte-identical). Reuses each
 *  template's own tokens (--sheet/--line/--ink). Zero JS: :hover + :focus-within. */
export const NAV_DROPDOWN_CSS = `nav.primary li.has-sub{position:relative}
nav.primary .sub-caret{font-size:.7em;margin-left:4px;opacity:.75}
nav.primary ul.subnav{position:absolute;left:0;top:100%;min-width:190px;margin:0;padding:6px;list-style:none;background:var(--sheet,var(--card,#fff));border:1px solid var(--line,#e6e6e6);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.14);display:none;z-index:60}
nav.primary li.has-sub:hover>ul.subnav,nav.primary li.has-sub:focus-within>ul.subnav{display:block}
nav.primary ul.subnav li{display:block;margin:0}
nav.primary ul.subnav a{display:block;white-space:nowrap;border-radius:7px}
@media (max-width:720px){nav.primary ul.subnav{position:static;display:block;box-shadow:none;border:none;padding:2px 0 2px 14px;min-width:0;background:transparent}}`;
