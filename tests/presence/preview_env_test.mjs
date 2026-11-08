// ── Phase T · Preview Environment (FD-T20) — pure helpers ────────────────────
//   deno run --allow-read --allow-env tests/presence/preview_env_test.mjs
import { previewBadgeHtml, injectPreviewBadge, hashPreviewPassword, newPreviewToken, shapePreviewStatus, signPreviewImages, absoluteLibraryFonts } from '../../supabase/functions/presence/lib/preview_env.ts';
import { renderSiteBlocks } from '../../supabase/functions/presence/lib/site_blocks.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };

// badge
ok('badge names the business + carries the marker id', previewBadgeHtml('Joe’s Plumbing').includes('Joe’s Plumbing') && previewBadgeHtml('x').includes('id="presence-preview-badge"'));
ok('badge escapes hostile business names', previewBadgeHtml('<script>x</script>').includes('&lt;script&gt;') && !previewBadgeHtml('<script>x</script>').includes('<script>x'));
ok('inject places the badge before </body>', (() => { const h = injectPreviewBadge('<html><body><h1>hi</h1></body></html>', 'A'); return h.indexOf('presence-preview-badge') < h.indexOf('</body>') && h.indexOf('presence-preview-badge') > h.indexOf('<h1>'); })());
ok('inject is idempotent (never doubles the badge)', (() => { let h = injectPreviewBadge('<body></body>', 'A'); h = injectPreviewBadge(h, 'A'); return (h.match(/presence-preview-badge/g) || []).length === 1; })());
ok('inject with no </body> appends', injectPreviewBadge('<p>bare</p>', 'A').includes('presence-preview-badge'));

// password hashing
{
  const a = await hashPreviewPassword('open sesame');
  const b = await hashPreviewPassword('open sesame');
  const c = await hashPreviewPassword('different');
  ok('password hash is deterministic + 64 hex', a === b && /^[0-9a-f]{64}$/.test(a));
  ok('different passwords → different hashes', a !== c);
  ok('empty / whitespace password → "" (open link)', (await hashPreviewPassword('')) === '' && (await hashPreviewPassword('   ')) === '');
}

// token
ok('a fresh token is long, hex, unguessable, and unique', (() => { const t1 = newPreviewToken(), t2 = newPreviewToken(); return /^[0-9a-f]{64}$/.test(t1) && t1 !== t2; })());

// status shaping
{
  const st = shapePreviewStatus({
    draftChanges: 3,
    preview: { token: 'abcd', snapshot_id: 's1', updated_at: '2026-07-09T00:00:00Z', password_hash: 'h' },
    live: { last_published_at: '2026-07-01T00:00:00Z', summary: '2 changes' },
    baseUrl: 'https://ref.supabase.co/',
  });
  ok('status: preview exists, url built, password flagged', st.preview.exists && st.preview.url.endsWith('/p/abcd') && st.preview.has_password);
  ok('status: draft change count + live published', st.draft.unpublished_changes === 3 && st.live.published && st.live.summary === '2 changes');
  const none = shapePreviewStatus({ draftChanges: 0, preview: null, live: null, baseUrl: 'https://x/' });
  ok('status: no preview → exists false, no url; live unpublished', !none.preview.exists && none.preview.url === null && !none.live.published);
}

// item 60: photos in a draft. The picture's sources and the <img>'s own srcset point at
// /img/ files that exist only on a published site; every candidate must be signed, or dropped.
{
  const urls = {
    '/img/aa-400.webp': 'https://sb/sign/a400w?token=t1', '/img/aa-800.webp': 'https://sb/sign/a800w?token=t2', '/img/aa-1600.webp': 'https://sb/sign/a1600w?token=t3',
    '/img/aa-400.avif': 'https://sb/sign/a400a?token=t4', '/img/aa-800.avif': 'https://sb/sign/a800a?token=t5', '/img/aa-1600.avif': 'https://sb/sign/a1600a?token=t6',
  };
  const pic = '<picture><source type="image/avif" srcset="/img/aa-400.avif 400w, /img/aa-800.avif 800w, /img/aa-1600.avif 1600w" sizes="100vw"><source type="image/webp" srcset="/img/aa-400.webp 400w, /img/aa-800.webp 800w, /img/aa-1600.webp 1600w" sizes="100vw"><img src="/img/aa-800.webp" srcset="/img/aa-400.webp 400w, /img/aa-800.webp 800w, /img/aa-1600.webp 1600w" sizes="100vw" alt="Our dining room"></picture>';
  const out = signPreviewImages(pic, urls);
  ok('preview: no /img/ address survives anywhere in a fully signed picture', !out.includes('/img/'));
  ok('preview: every srcset candidate keeps its width', (out.match(/ 1600w/g) || []).length === 3 && out.includes('https://sb/sign/a400a?token=t4 400w'));
  ok('preview: the plain src is signed too', out.includes('src="https://sb/sign/a800w?token=t2"'));
  const part = signPreviewImages(pic, { '/img/aa-800.webp': 'https://sb/sign/a800w?token=t2' });
  ok('preview: a srcset with an unsigned candidate is dropped, never left pointing at /img/', !part.includes('/img/') && !part.includes('srcset='));
  ok('preview: a picture source left with nothing goes, the <img> stays with its signed src', !part.includes('<source') && part.includes('<img src="https://sb/sign/a800w?token=t2"') && part.includes('alt="Our dining room"'));
  const vid = '<video controls poster="/img/aa-800.webp"><source src="https://cdn.example/v.mp4" type="video/mp4"></video>';
  ok('preview: a video source is not a picture source and is kept', signPreviewImages(vid, urls).includes('<source src="https://cdn.example/v.mp4" type="video/mp4">'));
  ok('preview: a page with no pictures is unchanged', signPreviewImages('<h1>Hi</h1>', urls) === '<h1>Hi</h1>');
  // the real section engine's output, end to end: a gallery of two photos
  const media = (k) => ({ variants: { w400: `/img/${k}-400.webp`, w800: `/img/${k}-800.webp`, w1600: `/img/${k}-1600.webp` }, alt: `photo ${k}`, width: 1600, height: 1067 });
  const real = renderSiteBlocks([{ type: 'gallery', title: 'Inside', images: [media('bb'), media('cc')], captions: [] }], { esc: (x) => String(x), attr: (x) => String(x), safeHref: (x) => String(x) }).map((r) => r.html).join('');
  const all = {}; for (const k of ['bb', 'cc']) for (const w of [400, 800, 1600]) for (const f of ['webp', 'avif']) all[`/img/${k}-${w}.${f}`] = `https://sb/sign/${k}${w}${f}?token=x`;
  ok('preview: the section engine draws a picture with /img/ sources (the case being fixed)', real.includes('<source type="image/avif" srcset="/img/bb-400.avif 400w'));
  ok('preview: the section engine\'s own gallery keeps no /img/ address once signed', !signPreviewImages(real, all).includes('/img/'));
}
// a shared draft link is served from the functions host; the site's fonts live on the app
ok('preview: library fonts point at the app on a shared link', absoluteLibraryFonts("@font-face{src:url(/fonts/library/inter-400.woff2) format('woff2')}", 'https://app.example.com/') === "@font-face{src:url(https://app.example.com/fonts/library/inter-400.woff2) format('woff2')}");
ok('preview: other addresses are left alone', absoluteLibraryFonts('url(/assets/a.css) url(https://x/fonts/library/a.woff2)', 'https://app.example.com') === 'url(/assets/a.css) url(https://x/fonts/library/a.woff2)');

const passed = results.filter((r) => r.p).length;
console.log(`\n════ PREVIEW ENV: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
