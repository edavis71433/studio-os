// ── Migration import inventory (M14) — PURE extraction, approval-gated ──────
// Turns fetched external pages (M11's read-only fetch) into a reviewable
// inventory: per page, the text worth keeping, the images worth bringing,
// and the metadata worth preserving. This is the migration REPORT's raw
// material — NOTHING is imported by this module; content arrives only
// through the existing CMS/draft flows after the customer approves the
// migration plan. URLs and SEO survive via the redirects the plan prepares.
import { classifyPage, pageFit } from '../monitor/readiness.ts';

export interface PageInventory {
  path: string;
  title: string;
  description: string;
  kind: string;
  fit: string;
  headings: string[];
  text_preview: string;          // first ~600 chars of real body text
  word_count: number;
  images: string[];              // absolute URLs — the media-preservation list
}

export interface ImportInventory {
  pages: PageInventory[];
  media: string[];               // deduped absolute image URLs across the site
  totals: { pages: number; words: number; images: number };
}

const one = (h: string, re: RegExp) => (h.match(re) || [])[1] ?? '';
const bodyText = (h: string) => h
  .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<nav[\s\S]*?<\/nav>/gi, '').replace(/<footer[\s\S]*?<\/footer>/gi, '')
  .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export function buildImportInventory(pages: Array<{ path: string; html: string }>, baseUrl: string): ImportInventory {
  const media = new Set<string>();
  const rows: PageInventory[] = pages.map((p) => {
    const title = one(p.html, /<title>([^<]*)<\/title>/i).trim();
    const description = one(p.html, /<meta\s+name="description"\s+content="([^"]*)"/i).trim();
    const headings = [...p.html.matchAll(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/gi)]
      .map((m) => m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 8);
    const text = bodyText(p.html);
    const images: string[] = [];
    for (const m of p.html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)) {
      try {
        const u = new URL(m[1], baseUrl).href;
        if (/\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(u) && !images.includes(u)) { images.push(u); media.add(u); }
      } catch { /* malformed src — skip */ }
    }
    const kind = classifyPage(p.path, title);
    return {
      path: p.path, title, description, kind, fit: pageFit(kind, p.path),
      headings, text_preview: text.slice(0, 600), word_count: text ? text.split(/\s+/).length : 0,
      images: images.slice(0, 20),
    };
  });
  return {
    pages: rows,
    media: [...media].slice(0, 200),
    totals: { pages: rows.length, words: rows.reduce((n, r) => n + r.word_count, 0), images: media.size },
  };
}
