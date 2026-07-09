// ── Phase T · Brand Kit (FD-T9) — deterministic derivation + contrast safety ──
//   deno run --allow-read --allow-env tests/presence/brand_kit_test.mjs
import { normHex, mix, darken, lighten, contrastRatio, readableOnWhiteText, deriveBrandTokens, sanitizeBrandKit } from '../../supabase/functions/presence/lib/brand_kit.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };
const near = (a, b, e = 0.02) => Math.abs(a - b) < e;

// colour primitives
ok('normHex expands 3-digit + accepts 6-digit + rejects junk', normHex('#abc') === '#aabbcc' && normHex('2f5d8a') === '#2f5d8a' && normHex('nope') === null);
ok('contrast white/black = 21; white/white = 1', near(contrastRatio('#ffffff', '#000000'), 21, 0.1) && near(contrastRatio('#ffffff', '#ffffff'), 1));
ok('darken/lighten move toward black/white deterministically', darken('#808080', 0.5) === '#404040' && lighten('#808080', 0.5) === '#c0c0c0');
ok('mix is deterministic + symmetric endpoints', mix('#000000', '#ffffff', 0.5) === '#808080' && mix('#000000', '#ffffff', 0) === '#000000');

// contrast safety — a light brand colour yields a READABLE button
ok('a light brand (yellow) is darkened until white text is readable', (() => { const c = readableOnWhiteText('#f4d03f'); return contrastRatio('#ffffff', c) >= 4.5; })());
ok('a dark brand colour is already readable (unchanged)', readableOnWhiteText('#2f5d8a') === '#2f5d8a' && contrastRatio('#ffffff', '#2f5d8a') >= 4.5);

// derivation
{
  const dark = deriveBrandTokens({ primary: '#2f5d8a' });
  ok('dark primary → accent = primary, accent_dark darker, accent_soft light', dark.accent === '#2f5d8a' && contrastRatio('#ffffff', dark.accent_dark) > contrastRatio('#ffffff', dark.accent) && !!dark.accent_soft);
  const light = deriveBrandTokens({ primary: '#f4d03f' });
  ok('light primary → accent is readable (not the raw light colour)', light.accent !== '#f4d03f' && contrastRatio('#ffffff', light.accent) >= 4.5);
  const typed = deriveBrandTokens({ primary: '#2f5d8a', heading_font: 'editorial', body_font: 'system-ui, sans-serif', corner: '18px' });
  ok('fonts map (preset + raw stack) and corner passes to radius', /serif/.test(typed.font_display) && typed.font_body === 'system-ui, sans-serif' && typed.radius === '18px');
  const neutral = deriveBrandTokens({ primary: '#2f5d8a', neutral: '#222222' });
  ok('a neutral yields ink + soft; none omits them', neutral.ink && neutral.soft && !('ink' in deriveBrandTokens({ primary: '#2f5d8a' })));
  ok('derivation is deterministic (same kit → same tokens)', JSON.stringify(deriveBrandTokens({ primary: '#8c3b2e', corner: '2px' })) === JSON.stringify(deriveBrandTokens({ primary: '#8c3b2e', corner: '2px' })));
  ok('every derived token key is a known dev token', Object.keys(deriveBrandTokens({ primary: '#2f5d8a', neutral: '#222', heading_font: 'editorial', body_font: 'modern_sans', corner: '2px' })).every((k) => ['accent', 'accent_dark', 'accent_soft', 'ink', 'soft', 'font_display', 'font_body', 'radius'].includes(k)));
}

// sanitize
ok('sanitize requires a valid primary colour', sanitizeBrandKit({ primary: 'nope' }) === null && sanitizeBrandKit({}) === null);
ok('sanitize keeps valid fields, drops a bad logo id', (() => { const k = sanitizeBrandKit({ primary: '#2f5d8a', logo_media_id: 'not-a-uuid', secondary: '#8c3b2e', corner: '2px' }); return k.primary === '#2f5d8a' && !k.logo_media_id && k.secondary === '#8c3b2e' && k.corner === '2px'; })());
ok('sanitize accepts a valid logo UUID', sanitizeBrandKit({ primary: '#2f5d8a', logo_media_id: '11111111-1111-1111-1111-111111111111' }).logo_media_id === '11111111-1111-1111-1111-111111111111');

const passed = results.filter((r) => r.p).length;
console.log(`\n════ BRAND KIT: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
