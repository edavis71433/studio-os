// ── BR-1 · branded export cover ──────────────────────────────────────────────
// A self-contained, on-brand cover page for the EXISTING ownership export
// (platform/exporter.ts). Reuses the Brand Kit (via the same brandFromKit the
// emails use) so the export feels like one premium experience. Pure; no external
// assets; no PDF engine (it's HTML, openable anywhere — the export is already HTML).
import { esc } from './markdown.ts';
import type { EmailBrand } from './email_brand.ts';

export interface ExportCoverInfo { exportedAt: string; pages: number; photos: number; hasBrand: boolean; domain: string | null }

export function exportCoverHtml(brand: EmailBrand, info: ExportCoverInfo): string {
  const name = esc(brand.name);
  const date = esc(String(info.exportedAt || '').slice(0, 10));
  const row = (k: string, v: string) => `<div class="row"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name} — your content</title>
<style>body{margin:0;background:#faf8f5;color:#1b1525;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.6}
.wrap{max-width:640px;margin:0 auto;padding:40px 24px}.bar{height:6px;background:${brand.accent};border-radius:6px}
h1{font-family:'Iowan Old Style',Palatino,Georgia,serif;font-weight:600;font-size:30px;color:${brand.accentDark};margin:22px 0 4px;letter-spacing:-.01em}
.sub{color:#6b6478;font-size:15px}.card{background:#fff;border:1px solid #eee9e0;border-radius:14px;padding:14px 20px;margin-top:18px}
.row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f2eee6}.row:last-child{border:0}
.k{color:#6b6478}.v{font-weight:600}.note{color:#6b6478;font-size:13.5px;margin-top:18px}</style></head>
<body><div class="wrap"><div class="bar"></div>
<h1>${name}</h1><div class="sub">Your complete website &amp; content — exported ${date}.</div>
<div class="card">${row('Website pages', String(info.pages))}${row('Photos & files', String(info.photos))}${row('Brand profile', info.hasBrand ? 'Included' : '—')}${info.domain ? row('Domain', String(info.domain)) : ''}</div>
<p class="note">Everything in this export is yours — your words, your media, your brand, and your rendered website. Host it anywhere; nothing here requires Studio OS.</p>
</div></body></html>`;
}
