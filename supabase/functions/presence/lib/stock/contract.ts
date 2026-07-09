// ── Phase T · Stock Library (FD-T10) — the provider CONTRACT ─────────────────
// The Stock Library is NOT a second app or a second DAM. It is a browse-and-import
// surface: a customer searches a curated royalty-free source, selects an image, and
// it is IMPORTED into their OWN Files (presence_media) via the existing upload
// pipeline. From then on it is an ordinary asset — same storage, variants, usage
// tracking, tagging, search, approvals, and publishing. Nothing external is ever
// referenced on the published site (constitution Part 4: zero external origins) —
// the image is self-hosted the moment it's imported.
//
// Providers sit behind this contract so the DEFAULT can be swapped (Pexels →
// Unsplash → a paid source) WITHOUT changing the customer experience.

export interface StockImage {
  id: string;           // provider-native id (opaque to us)
  thumb: string;        // a browse-thumbnail URL (shown only in the picker, never on the site)
  alt: string;          // a description (becomes the imported asset's alt text)
  width?: number;
  height?: number;
  credit?: string;      // photographer/source — stored as provenance metadata
}

export interface StockDownload {
  bytes: Uint8Array;
  mime: string;
  width?: number;
  height?: number;
}

export interface StockLicense {
  name: string;
  url: string;
  commercial: boolean;            // may be used on a customer's commercial site
  attribution_required: boolean;  // must the site credit the source
  self_host: boolean;             // may the image be downloaded + self-hosted (required for Part 4)
}

export interface StockProvider {
  key: string;
  name: string;
  license: StockLicense;
  /** true only when the provider's API key is configured (owner-gated, like GSC). */
  available(): boolean;
  /** browse: a page of results for a query (read-only; no import). */
  search(query: string, page: number): Promise<StockImage[]>;
  /** fetch the full image bytes for one result, to import into the customer's storage. */
  download(id: string): Promise<StockDownload | null>;
}
