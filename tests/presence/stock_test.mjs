// ── Phase T · Stock Library (FD-T10) — provider contract + parsing ───────────
//   deno run --allow-read --allow-env tests/presence/stock_test.mjs
// The network is owner-key-gated; these cover the PURE parts (mapping, license,
// registry, availability) — the import path reuses importImage (the media
// pipeline) and is exercised by the deploy smoke.
import { photoToImage, parseSearch, downloadUrlFor, pexels } from '../../supabase/functions/presence/lib/stock/pexels.ts';
import { stockProvider } from '../../supabase/functions/presence/lib/stock/registry.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };

const photo = { id: 123, width: 4000, height: 3000, photographer: 'Sam Rivera', alt: 'A tidy workshop', src: { medium: 'https://img/med.jpg', large2x: 'https://img/l2x.jpg', large: 'https://img/l.jpg', original: 'https://img/o.jpg' } };

ok('photoToImage maps id/thumb/alt/credit', (() => { const i = photoToImage(photo); return i.id === '123' && i.thumb === 'https://img/med.jpg' && i.alt === 'A tidy workshop' && i.credit === 'Sam Rivera'; })());
ok('photoToImage rejects a photo with no src', photoToImage({ id: 5 }) === null && photoToImage(null) === null);
ok('photoToImage falls back to a default alt', photoToImage({ id: 9, src: { medium: 'x' } }).alt === 'Stock photo');
ok('parseSearch maps + filters', (() => { const arr = parseSearch({ photos: [photo, { id: 0 }, { nope: 1 }] }); return arr.length === 1 && arr[0].id === '123'; })());
ok('parseSearch handles a missing photos array', parseSearch({}).length === 0 && parseSearch(null).length === 0);
ok('downloadUrlFor prefers the largest self-hostable', downloadUrlFor(photo) === 'https://img/l2x.jpg' && downloadUrlFor({ src: { medium: 'm' } }) === 'm' && downloadUrlFor({}) === null);

// license: the reason Pexels is the recommended default
ok('Pexels license permits commercial use + self-hosting, no required attribution', pexels.license.commercial && pexels.license.self_host && !pexels.license.attribution_required);
ok('registry returns a provider (Pexels default) with a search + download + available API', (() => { const p = stockProvider(); return p.key === 'pexels' && typeof p.search === 'function' && typeof p.download === 'function' && typeof p.available === 'function'; })());
ok('provider is unavailable without an API key (owner-gated, honest)', pexels.available() === false);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ STOCK LIBRARY: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
