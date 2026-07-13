// ── AVIF images + Website-Health polish wins (pure) ──────────────────────────
//   deno run --allow-read --allow-env tests/presence/avif_health_test.mjs
// Covers: (1) AVIF variant path/format alongside WebP at each width; the published
// <picture> offering avif + webp sources with an <img> fallback (alt/lazy/dims
// preserved). (2) the "always online" reassurance line. (3) SSL-expiry surfacing
// that formats a date and degrades cleanly when absent.
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { variantPath, originalPath } from '../../supabase/functions/presence/lib/serializer.ts';
import { buildWebsiteHealth } from '../../supabase/functions/presence/lib/website_health.ts';

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; } else { fail++; console.log('FAIL ', name); } };

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const SITE = { baseUrl: 'https://vermilionandvine.example' };

// ═══ 1. variantPath: AVIF alongside WebP at each width ═══
{
  const sp = 'siteid/abc-123.webp';
  const widths = [400, 800, 1600];
  for (const w of widths) {
    const webp = variantPath(sp, w);          // default format
    const webp2 = variantPath(sp, w, 'webp');
    const avif = variantPath(sp, w, 'avif');
    ok(`1 webp default @${w}`, webp === webp2 && /^\/img\/[0-9a-f]{8}-\d+\.webp$/.test(webp));
    ok(`1 avif @${w} same base, .avif ext`, avif === webp.replace(/\.webp$/, '.avif') && avif.endsWith(`-${w}.avif`));
    ok(`1 avif @${w} distinct from webp`, avif !== webp);
  }
  // widths produce distinct paths (no collision across sizes)
  const avifSet = new Set(widths.map((w) => variantPath(sp, w, 'avif')));
  ok('1 three distinct avif widths', avifSet.size === 3);
}

// ═══ 1b. originalPath: a NON-image file (PDF Download) served verbatim under /files ═══
{
  const pdf = 'siteid/menu-2026.pdf';
  const op = originalPath(pdf, 'application/pdf');
  ok('1b pdf original path is a stable /files/<hash>.pdf', /^\/files\/[0-9a-f]{8}\.pdf$/.test(op));
  ok('1b original path is deterministic (same storage_path → same path)', originalPath(pdf, 'application/pdf') === op);
  ok('1b original path is NOT an image variant path (distinct namespace)', !op.startsWith('/img/') && op !== variantPath(pdf, 1600));
  // ext derives from the mime, with a sane fallback for anything unmapped
  ok('1b ext follows the mime', originalPath('x/y.pdf', 'application/pdf').endsWith('.pdf') && originalPath('x/y', 'application/octet-stream').endsWith('.bin'));
}

// ═══ 2. published render → <picture> with avif + webp + <img> fallback ═══
{
  const fixture = JSON.parse(read('supabase/functions/presence/templates/restaurant-classic/1.0.0/fixture.json'));
  const files = renderSnapshot(fixture, SITE);
  const html = Object.entries(files).filter(([k]) => k.endsWith('.html')).map(([, v]) => String(v)).join('\n');

  ok('2 emits <picture> wrapper', html.includes('<picture>'));
  ok('2 avif <source> first', html.includes('<source type="image/avif" srcset='));
  ok('2 webp <source> present', html.includes('<source type="image/webp" srcset='));
  ok('2 self-hosted avif variants referenced', /\/img\/[\w-]+\.avif \d+w/.test(html));

  // Inspect one full <picture>…</picture> block for correctness.
  const m = html.match(/<picture>[\s\S]*?<\/picture>/);
  ok('2 has a complete picture block', !!m);
  if (m) {
    const pic = m[0];
    const avifSrc = pic.match(/type="image\/avif" srcset="([^"]*)"/);
    const webpSrc = pic.match(/type="image\/webp" srcset="([^"]*)"/);
    ok('2 avif+webp srcsets both parsed', !!avifSrc && !!webpSrc);
    // same width descriptors on both formats (avif sits at the SAME widths as webp)
    const widthsOf = (s) => (s.match(/\s(\d+)w/g) || []).map((x) => x.trim()).sort();
    ok('2 avif widths == webp widths', JSON.stringify(widthsOf(avifSrc[1])) === JSON.stringify(widthsOf(webpSrc[1])));
    ok('2 avif srcset is all .avif', avifSrc[1].split(',').every((e) => /\.avif\s+\d+w/.test(e.trim())));
    ok('2 webp srcset is all .webp', webpSrc[1].split(',').every((e) => /\.webp\s+\d+w/.test(e.trim())));
    // ultimate fallback <img> preserved inside the picture: alt + dimensions + webp src
    const imgTag = pic.match(/<img\b[^>]*>/);
    ok('2 <img> fallback present', !!imgTag);
    ok('2 <img> keeps non-empty alt', /alt="[^"]+"/.test(imgTag[0]));
    ok('2 <img> keeps dimensions', /width="\d+" height="\d+"/.test(imgTag[0]));
    ok('2 <img> src is a self-hosted webp', /src="\/img\/[\w-]+\.webp"/.test(imgTag[0]));
  }
  // no external origin sneaks in through the new markup
  ok('2 no external avif/webp origin', !/srcset="[^"]*https?:\/\//.test(html));

  // Lazy-load preservation: inject a gallery block (a below-the-fold, lazy image)
  // and confirm its <picture>'s <img> still carries loading="lazy" + decoding + alt.
  const withBlock = structuredClone(fixture);
  withBlock.content.settings = withBlock.content.settings || {};
  withBlock.content.settings.blocks = [{
    type: 'gallery', title: 'Our space', images: [{
      alt: 'The dining room at dusk',
      variants: { w400: '/img/room-400.webp', w800: '/img/room-800.webp', w1600: '/img/room-1600.webp' },
      width: 1600, height: 1000,
    }],
  }];
  const bHtml = Object.entries(renderSnapshot(withBlock, SITE)).filter(([k]) => k.endsWith('.html')).map(([, v]) => String(v)).join('\n');
  const galleryPic = (bHtml.match(/<picture>[\s\S]*?<\/picture>/g) || []).find((p) => p.includes('/img/room-'));
  ok('2 gallery block rendered as <picture>', !!galleryPic);
  if (galleryPic) {
    const gImg = galleryPic.match(/<img\b[^>]*>/)[0];
    ok('2 lazy image keeps loading="lazy"', gImg.includes('loading="lazy"'));
    ok('2 lazy image keeps decoding="async"', gImg.includes('decoding="async"'));
    ok('2 lazy image keeps its alt', gImg.includes('alt="The dining room at dusk"'));
    ok('2 gallery avif source derived at same widths',
      galleryPic.includes('<source type="image/avif" srcset="/img/room-400.avif 400w, /img/room-800.avif 800w, /img/room-1600.avif 1600w"'));
  }
}

// ═══ 3. Website Health — "always online" reassurance ═══
const L = (step, state) => ({ step, state });
const HEALTHY_LAUNCH = [
  L('Domain connected', 'done'), L('DNS answering', 'done'), L('Security certificate active', 'done'),
  L('Website published', 'done'), L('Search indexing requested', 'done'),
  L('Analytics connected', 'done'), L('Email authenticated', 'done'),
];
const base = {
  now: '2026-07-08T12:00:00Z', site_status: 'live', has_unpublished_changes: false, publish_failed: false,
  last_published_at: '2026-07-06T09:00:00Z', missing_count: 0, missing_href: null, scheduled: false,
  launch: HEALTHY_LAUNCH, connections: [], contact_form_working: false, versions_saved: true,
  domain: 'yourshop.com',
};
const build = (over) => buildWebsiteHealth({ ...base, ...over });
const titled = (h, t) => h.categories.flatMap((c) => c.checks).find((c) => c.title === t);

{
  const h = build({});
  const c = titled(h, 'Your website keeps working even during maintenance');
  ok('3 always-online line present on a live site', !!c && c.state === 'ok');
  ok('3 always-online copy is truthful (global network, not one server)',
    c && /global network, not one server/.test(c.why));
  ok('3 always-online is reassurance, never counted as attention', h.attention_count === 0);
  // A never-published site has no live pages → the line is omitted (honesty rule).
  const nh = build({ site_status: 'never_published', last_published_at: null, launch: HEALTHY_LAUNCH.map((x) => x.step === 'Website published' ? L(x.step, 'todo') : x) });
  ok('3 omitted before first publish', !titled(nh, 'Your website keeps working even during maintenance'));
}

// ═══ 4. Website Health — SSL expiry surfacing (formats + degrades) ═══
{
  // with an expiry → "Secure until {date} — renews automatically", date formatted
  const h = build({ ssl_expires_at: '2027-07-12T00:00:00Z' });
  const c = titled(h, 'Your connection is secure');
  ok('4 secure check present', !!c && c.state === 'ok');
  ok('4 surfaces a formatted expiry date', c && c.why.includes('Secure until 12 July 2027'));
  ok('4 reassures auto-renew (not an owner chore)', c && /renews automatically/.test(c.why));

  // no expiry → degrades cleanly to the plain secure line (no "Secure until")
  const h2 = build({ ssl_expires_at: null });
  const c2 = titled(h2, 'Your connection is secure');
  ok('4 degrades cleanly when absent', !!c2 && !c2.why.includes('Secure until'));

  // unparseable date → also degrades (never prints a bad date)
  const h3 = build({ ssl_expires_at: 'not-a-date' });
  const c3 = titled(h3, 'Your connection is secure');
  ok('4 degrades on unparseable date', !!c3 && !c3.why.includes('Secure until'));

  // no custom domain → the secure check is omitted entirely (unchanged honesty rule),
  // so an SSL expiry never leaks onto a site we can't verify.
  const h4 = build({ domain: null, ssl_expires_at: '2027-07-12T00:00:00Z' });
  ok('4 no secure claim without a custom domain', !titled(h4, 'Your connection is secure'));
}

console.log(fail === 0
  ? `\n════ AVIF + HEALTH: ${pass}/${pass} PASS ════`
  : `\n${fail} FAILURE(S), ${pass} passed`);
if (fail) Deno.exit(1);
