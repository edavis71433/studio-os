// ── Phase DAM-1: Files — pure logic (kinds, names, where-used, versions, PDF) ──
//   deno run --allow-read --allow-env tests/presence/files_test.mjs
import { fileKind, displayName, isFavorite, usageSummary, carryForwardMetadata } from '../../supabase/functions/presence/lib/dam.ts';
import { IMAGE_MIME, DOC_MIME, MIME_ALLOW, isDocMime, isImageMime } from '../../supabase/functions/presence/lib/media.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// ── file kind ──
ok('fileKind: image mimes → image', fileKind('image/jpeg') === 'image' && fileKind('image/webp') === 'image');
ok('fileKind: application/pdf → document', fileKind('application/pdf') === 'document');
ok('fileKind: unknown → other', fileKind('') === 'other' && fileKind('text/plain') === 'other');

// ── display name: human title wins, else cleaned filename, else kind ──
ok('displayName: metadata.title wins', displayName({ metadata: { title: 'Spring Menu' }, storage_path: 'presence-media/s/abc.jpg' }) === 'Spring Menu');
ok('displayName: falls back to a clean filename', displayName({ storage_path: 'presence-media/s/brochure.pdf', mime: 'application/pdf' }) === 'brochure');
ok('displayName: a bare uuid filename falls through to a kind label', displayName({ storage_path: 'presence-media/s/3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg', mime: 'image/jpeg' }) === 'Photo');
ok('displayName: document kind label when nothing else', displayName({ storage_path: 'presence-media/s/0123456789abcdef0123.pdf', mime: 'application/pdf' }) === 'Document');

// ── favorite ──
ok('isFavorite reads metadata.favorite', isFavorite({ metadata: { favorite: true } }) === true && isFavorite({ metadata: {} }) === false && isFavorite({}) === false);

// ── usage summary (website awareness) ──
ok('usageSummary: unused → calm, not sensitive', (() => { const s = usageSummary([]); return s.total === 0 && s.live === 0 && !s.sensitive && /not used/i.test(s.headline); })());
ok('usageSummary: single use names the place', (() => { const s = usageSummary([{ surface: 'services', label: '“Haircut”', live: false }]); return s.total === 1 && /Haircut/.test(s.headline); })());
ok('usageSummary: brand logo is replace-sensitive even when not live', usageSummary([{ surface: 'brand', label: 'your logo', live: false }]).sensitive === true);
ok('usageSummary: anything LIVE is replace-sensitive + counted', (() => { const s = usageSummary([{ surface: 'services', label: '“Latte”', live: true }, { surface: 'blog', label: 'the update “Hi”', live: false }]); return s.sensitive && s.live === 1 && s.total === 2 && /live/i.test(s.headline); })());

// ── carry-forward on replace (new version inherits organization) ──
{
  const oldA = { collection: 'Brand', tags: ['logo', 'primary'], brand: true, metadata: { title: 'Logo' } };
  const newA = { collection: '', tags: ['new'], brand: false, metadata: {} };
  const cf = carryForwardMetadata(oldA, newA);
  ok('carryForward: inherits collection when new has none', cf.collection === 'Brand');
  ok('carryForward: merges tags (union, new first)', cf.tags.includes('new') && cf.tags.includes('logo') && cf.tags.includes('primary'));
  ok('carryForward: preserves brand flag', cf.brand === true);
  ok('carryForward: preserves the human title', cf.metadata && cf.metadata.title === 'Logo');
}
{
  // when the new file already has its own organization, don't clobber it
  const oldA = { collection: 'Brand', tags: ['logo'], brand: true, metadata: { title: 'Old' } };
  const newA = { collection: 'Photos', tags: ['logo'], brand: true, metadata: { title: 'New' } };
  const cf = carryForwardMetadata(oldA, newA);
  ok('carryForward: keeps the new file’s own collection/title', cf.collection === undefined && cf.metadata === undefined);
}

// ── PDF is a first-class file in the ONE store ──
ok('media: images allow-list unchanged', isImageMime('image/jpeg') && isImageMime('image/png') && isImageMime('image/webp'));
ok('media: PDF is an allowed document type', isDocMime('application/pdf') && MIME_ALLOW.has('application/pdf'));
ok('media: PDF is NOT treated as an image (no transform path)', !isImageMime('application/pdf'));
ok('media: no stray types leaked into the allow-list', [...MIME_ALLOW].every((m) => IMAGE_MIME.has(m) || DOC_MIME.has(m)));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ FILES (DAM-1): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
