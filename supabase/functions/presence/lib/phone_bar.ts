// ── The phone bar: Call, Directions, Hours and Email along the bottom of every page, on phones only (builder list item 122, Nov 2026) ──
// One choice turns it on, Light or Dark (the style setting phone_bar, lib/devmode.ts); with
// none, or Off, every page is left exactly as it was. The buttons come from the business
// details, and each shows only when there's something behind it: a number to call, an address
// to go to, opening hours to read, an email to write to. Hours opens a small tray with the
// week. Every page that shows the site's footer gets the bar (a page that hides its footer
// hides this too), drawn after the template, so all eight templates carry it alike. On a
// wider screen, and on paper, it isn't shown. This file imports nothing, so a browser spec
// can draw a page with it and reach only this file.
type FileMap = Record<string, string | Uint8Array>;
interface Interval { open: string; close: string }
interface Details {
  identity?: { phone?: string; email?: string } | null;
  locations?: Array<{
    address_line1?: string; address_line2?: string; city?: string; region?: string; postal_code?: string;
    phone?: string; timezone?: string; hours?: Array<{ day: string; closed?: boolean; intervals?: Interval[] }>;
    temporarily_closed?: boolean; temporarily_closed_note?: string;
  }> | null;
}
export interface BarButton { key: 'call' | 'directions' | 'hours' | 'email'; label: string; href?: string }

export const PHONE_BARS = ['off', 'light', 'dark'] as const;
const BAR_H = 64;   // px, the bar's height above the phone's own home strip
const DAYS: Array<[string, string]> = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ICONS: Record<BarButton['key'], string> = {
  call: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  directions: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  hours: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
};

/** The setting as stored: 'light' or 'dark', else null (off). Pure. */
export function phoneBarOf(raw: unknown): 'light' | 'dark' | null {
  return raw === 'light' || raw === 'dark' ? raw : null;
}

// The number to dial: the location's own if it has one (as the templates' footers do), else
// the main one; an extension at the end is dropped, since a phone can't dial it.
function dialable(c: Details | null | undefined): string {
  const loc = (c?.locations || [])[0] || {};
  const raw = String(loc.phone || c?.identity?.phone || '').trim().replace(/\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i, '');
  const d = raw.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return d.replace(/\D/g, '').length >= 7 ? d : '';
}

/** The bar's buttons for these business details, in order. Pure. */
export function phoneBarButtons(c: Details | null | undefined): BarButton[] {
  const out: BarButton[] = [];
  const loc = (c?.locations || [])[0] || {};
  const tel = dialable(c);
  if (tel) out.push({ key: 'call', label: 'Call', href: 'tel:' + tel });
  const line1 = String(loc.address_line1 || '').trim();
  if (line1) {
    const place = [line1, loc.address_line2, loc.city, [loc.region, loc.postal_code].map((x) => String(x || '').trim()).filter(Boolean).join(' ')]
      .map((x) => String(x || '').trim()).filter(Boolean).join(', ');
    out.push({ key: 'directions', label: 'Directions', href: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(place) });
  }
  if (loc.temporarily_closed || (loc.hours || []).some((d) => !d.closed && (d.intervals || []).length)) out.push({ key: 'hours', label: 'Hours' });
  const email = String(c?.identity?.email || '').trim();
  if (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) out.push({ key: 'email', label: 'Email', href: 'mailto:' + email });
  return out;
}

// 9am, 5:30pm: the way the templates write a time
function fmtTime(t: string): string {
  const [h, m] = String(t).split(':').map(Number);
  if (!Number.isFinite(h)) return esc(t);
  const am = h < 12 || h === 24; const hr = ((h + 11) % 12) + 1;
  return `${hr}${m ? ':' + String(m).padStart(2, '0') : ''}${am ? 'am' : 'pm'}`;
}

// The tray behind Hours: the week, or that the business is closed for now.
function hoursTray(c: Details | null | undefined): string {
  const loc = (c?.locations || [])[0] || {};
  if (loc.temporarily_closed) {
    const note = String(loc.temporarily_closed_note || '').trim();
    return `<div class="dds-pb-tray"><p class="dds-pb-h">Temporarily closed</p>${note ? `<p>${esc(note)}</p>` : ''}</div>`;
  }
  const byDay = new Map((loc.hours || []).map((d) => [d.day, d]));
  const rows = DAYS.map(([k, name]) => {
    const d = byDay.get(k);
    const val = !d || d.closed || !(d.intervals || []).length ? 'Closed' : (d.intervals || []).map((i) => `${fmtTime(i.open)}–${fmtTime(i.close)}`).join(', ');
    return `<tr data-day="${k}"><th scope="row">${name}</th><td>${esc(val)}</td></tr>`;
  }).join('');
  const tz = String(loc.timezone || '').trim();
  return `<div class="dds-pb-tray"${tz ? ` data-tz="${esc(tz)}"` : ''}><p class="dds-pb-h">Opening hours</p><table><tbody>${rows}</tbody></table></div>`;
}

/** The bar's markup for these details, or '' when there's nothing to put on it. Pure. */
export function phoneBarHtml(c: Details | null | undefined): string {
  const buttons = phoneBarButtons(c);
  if (!buttons.length) return '';
  const icon = (k: BarButton['key']) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[k]}</svg>`;
  return '<div class="dds-pb-gap" aria-hidden="true"></div><nav class="dds-phonebar" aria-label="Call, find or write to us">' + buttons.map((b) =>
    b.key === 'hours'
      ? `<details class="dds-pb-hours"><summary>${icon('hours')}Hours</summary>${hoursTray(c)}</details>`
      : `<a href="${esc(b.href!)}"${b.key === 'directions' ? ' target="_blank" rel="noopener"' : ''}>${icon(b.key)}${b.label}</a>`).join('') + '</nav>';
}

// A hex colour as [r, g, b], or null. #rgb, #rgba, #rrggbb and #rrggbbaa, as the accent token allows.
function rgbOf(hex: unknown): [number, number, number] | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(String(hex || '').trim());
  if (!m || ![3, 4, 6, 8].includes(m[1].length)) return null;
  const h = m[1].length <= 4 ? m[1].slice(0, 3).split('').map((x) => x + x).join('') : m[1].slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function contrastOnWhite(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

/** The light bar's icon colour: the site's accent when it reads on white (3 to 1 or better),
 *  else the bar's own dark ink. Pure. */
export function lightIconColour(accent: unknown): string {
  const rgb = rgbOf(accent);
  return rgb && contrastOnWhite(rgb) >= 3 ? '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('') : INK;
}
const INK = '#1d1b19', DARK = '#201b17';

function css(mode: 'light' | 'dark', icon: string): string {
  const bg = mode === 'dark' ? DARK : '#fff', fg = mode === 'dark' ? '#fff' : INK, line = mode === 'dark' ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.09)';
  const safe = 'env(safe-area-inset-bottom,0px)';
  return '.dds-phonebar,.dds-pb-gap{display:none}@media screen and (max-width:720px){'
    + `.dds-pb-gap{display:block;height:calc(${BAR_H}px + ${safe})}`
    + `.dds-phonebar{position:fixed;left:0;right:0;bottom:0;z-index:60;display:flex;box-sizing:border-box;height:calc(${BAR_H}px + ${safe});margin:0;padding:0 4px ${safe};`
    + `background:${bg};color:${fg};border-top:1px solid ${line};box-shadow:0 -6px 20px rgba(0,0,0,.08);font-family:inherit}`
    + '.dds-phonebar>a,.dds-pb-hours{flex:1 1 0;min-width:0}'
    + `.dds-phonebar>a,.dds-pb-hours>summary{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;height:${BAR_H}px;color:inherit;`
    + 'font-family:inherit;font-size:12px;font-weight:600;line-height:1.2;letter-spacing:.01em;text-decoration:none;cursor:pointer;list-style:none;-webkit-tap-highlight-color:transparent}'
    + '.dds-pb-hours>summary::-webkit-details-marker{display:none}'
    + '.dds-phonebar>a:active,.dds-pb-hours>summary:active{opacity:.6}'
    + '.dds-phonebar>a:focus-visible,.dds-pb-hours>summary:focus-visible{outline:2px solid currentColor;outline-offset:-6px;border-radius:12px}'
    + `.dds-phonebar svg{width:22px;height:22px;fill:none;stroke:${icon};stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}`
    + `.dds-pb-tray{position:absolute;left:8px;right:8px;bottom:calc(100% + 8px);box-sizing:border-box;padding:14px 16px;border-radius:14px;background:${bg};color:${fg};`
    + `border:1px solid ${line};box-shadow:0 10px 32px rgba(0,0,0,.18);font-size:14px;line-height:1.5;text-align:left}`
    + '.dds-pb-tray p{margin:0 0 6px}.dds-pb-tray .dds-pb-h{font-weight:700;margin-bottom:8px}'
    + '.dds-pb-tray table{width:100%;border-collapse:collapse}.dds-pb-tray th,.dds-pb-tray td{padding:3px 0;font-weight:400;text-align:left;vertical-align:top}'
    + '.dds-pb-tray td{text-align:right}.dds-pb-tray tr[data-today] th,.dds-pb-tray tr[data-today] td{font-weight:700}'
    // a draft's preview banner and its comments button sit above the bar, not on it
    + `.dds-phonebar~#presence-preview-badge{bottom:calc(${BAR_H}px + ${safe})!important}`
    + `.dds-phonebar~#presence-feedback-panel{bottom:calc(${BAR_H + 60}px + ${safe})}`
    + '}@media print{.dds-phonebar,.dds-pb-gap{display:none!important}}';
}

// Closes the tray on a tap elsewhere or Escape, and marks today's row in the business's own time zone.
const JS = `(function(){var d=document.querySelector('.dds-pb-hours');if(!d)return;document.addEventListener('click',function(e){if(d.open&&!d.contains(e.target))d.open=false});document.addEventListener('keydown',function(e){if(e.key==='Escape'&&d.open){d.open=false;d.querySelector('summary').focus()}});try{var t=d.querySelector('[data-tz]'),z=t&&t.getAttribute('data-tz'),o={weekday:'short'};if(z)o.timeZone=z;var k=new Intl.DateTimeFormat('en-US',o).format(new Date()).slice(0,3).toLowerCase(),r=d.querySelector('tr[data-day="'+k+'"]');if(r)r.setAttribute('data-today','')}catch(e){}})();`;

/** Every page that shows the site's footer, with the bar, for this choice, these details and
 *  this accent (the site's own, for the light bar's icons). Off, or nothing to put on the bar,
 *  leaves every page exactly as it was. Pure. */
export function applyPhoneBar(fileMap: FileMap, raw: unknown, details: Details | null | undefined, accent?: unknown): FileMap {
  const mode = phoneBarOf(raw);
  if (!mode) return fileMap;
  const bar = phoneBarHtml(details);
  if (!bar) return fileMap;
  const out: FileMap = {};
  for (const [path, html] of Object.entries(fileMap)) {
    if (typeof html !== 'string' || !path.endsWith('.html') || !html.includes('<footer class="site"') || !html.includes('</body>') || html.includes('class="dds-phonebar"')) { out[path] = html; continue; }
    // the accent the page itself carries, unless the owner picked their own
    const icon = mode === 'light' ? lightIconColour(rgbOf(accent) ? accent : (/--accent:\s*(#[0-9a-f]{3,8})\b/i.exec(html) || [])[1]) : '#fff';
    const style = `<style id="dds-phonebar-css">${css(mode, icon)}</style>`;
    const tail = bar + (bar.includes('dds-pb-hours') ? `<script id="dds-phonebar-js">${JS}</script>` : '');
    // replaced through a function, so a $ in an email or a note is never read as a pattern
    out[path] = (html.includes('</head>') ? html.replace('</head>', () => style + '</head>') : style + html).replace('</body>', () => tail + '</body>');
  }
  return out;
}
