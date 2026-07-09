// ── Phase T · Stock Library — Pexels adapter (FD-T10) ────────────────────────
// The RECOMMENDED default provider. The Pexels License permits free commercial
// use, modification, and self-hosting, with NO required attribution — the best
// long-term fit for customers self-hosting images on their own sites. Owner-gated
// on PEXELS_API_KEY (like GSC): absent → available() is false and the routes
// answer honestly (503 not_available). Network calls are thin wrappers around the
// PURE parse helpers below, which the test suite covers without any network.
import type { StockProvider, StockImage, StockDownload } from './contract.ts';

const API = 'https://api.pexels.com/v1';
const key = () => Deno.env.get('PEXELS_API_KEY') || '';

/** Map one Pexels photo object → our StockImage. Pure. */
export function photoToImage(p: any): StockImage | null {
  if (!p || !p.id || !p.src) return null;
  const thumb = p.src.medium || p.src.small || p.src.tiny || p.src.original;
  if (!thumb) return null;
  return {
    id: String(p.id),
    thumb: String(thumb),
    alt: String(p.alt || '').trim() || 'Stock photo',
    width: Number(p.width) || undefined,
    height: Number(p.height) || undefined,
    credit: p.photographer ? String(p.photographer) : undefined,
  };
}

/** Parse a Pexels search response body → StockImage[]. Pure. */
export function parseSearch(body: any): StockImage[] {
  const photos = Array.isArray(body?.photos) ? body.photos : [];
  return photos.map(photoToImage).filter((x: StockImage | null): x is StockImage => !!x);
}

/** The best downloadable URL for a photo object (largest self-hostable). Pure. */
export function downloadUrlFor(p: any): string | null {
  return p?.src?.large2x || p?.src?.large || p?.src?.original || p?.src?.medium || null;
}

function mimeFromUrl(u: string): string {
  const clean = u.split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

export const pexels: StockProvider = {
  key: 'pexels',
  name: 'Pexels',
  license: { name: 'Pexels License', url: 'https://www.pexels.com/license/', commercial: true, attribution_required: false, self_host: true },
  available: () => !!key(),
  async search(query: string, page: number): Promise<StockImage[]> {
    if (!key()) return [];
    const q = encodeURIComponent(query.trim() || 'business');
    const r = await fetch(`${API}/search?query=${q}&per_page=24&page=${Math.max(1, page || 1)}`, { headers: { Authorization: key() } });
    if (!r.ok) return [];
    return parseSearch(await r.json());
  },
  async download(id: string): Promise<StockDownload | null> {
    if (!key() || !/^\d+$/.test(String(id))) return null;
    const meta = await fetch(`${API}/photos/${id}`, { headers: { Authorization: key() } });
    if (!meta.ok) return null;
    const p = await meta.json();
    const url = downloadUrlFor(p);
    if (!url) return null;
    const img = await fetch(url);
    if (!img.ok) return null;
    const bytes = new Uint8Array(await img.arrayBuffer());
    return { bytes, mime: mimeFromUrl(url), width: Number(p.width) || undefined, height: Number(p.height) || undefined };
  },
};
