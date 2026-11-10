// ── BR-1 · branded email shell (one email engine, brand-kit-driven) ──────────
//   deno run --allow-read --allow-env tests/presence/email_brand_test.mjs
import { brandFromKit, brandEmailShell, EMAIL_BRAND_DEFAULT } from '../../supabase/functions/presence/lib/email_brand.ts';
import { contrastRatio } from '../../supabase/functions/presence/lib/brand_kit.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };

// brand derivation (reuses brand_kit contrast safety)
ok('default is Studio OS purple', EMAIL_BRAND_DEFAULT.name === 'Studio OS' && EMAIL_BRAND_DEFAULT.accent === '#5b3fa0');
ok('dark brand → accent = brand colour', brandFromKit({ primary: '#2f5d8a' }, "Joe’s").accent === '#2f5d8a' && brandFromKit({ primary: '#2f5d8a' }, "Joe’s").name === "Joe’s");
ok('light brand → readable accent (white text stays legible)', (() => { const b = brandFromKit({ primary: '#f4d03f' }, 'x'); return b.accent !== '#f4d03f' && contrastRatio('#ffffff', b.accent) >= 4.5; })());
ok('no kit / no name → the Studio OS default', brandFromKit(null, '').name === 'Studio OS' && brandFromKit(undefined, null).accent === '#5b3fa0');

// the shell
{
  const shell = brandEmailShell('<p>Hello world</p>', brandFromKit({ primary: '#8c3b2e' }, "Marlow’s Kitchen"));
  ok('shell wraps into a full email doc', /^<!doctype html>/i.test(shell) && shell.includes('</html>'));
  ok('shell carries the brand name + accent + the body', shell.includes("Marlow’s Kitchen") && shell.includes('#8c3b2e') && shell.includes('<p>Hello world</p>'));
  ok('shell escapes a hostile brand name', brandEmailShell('<p>x</p>', { name: '<script>evil</script>', accent: '#000', accentDark: '#000' }).includes('&lt;script&gt;'));
  ok('shell is idempotent — a full document is not double-wrapped', brandEmailShell(shell, EMAIL_BRAND_DEFAULT) === shell);
  ok('default brand applies when none passed', brandEmailShell('<p>hi</p>').includes('Studio OS'));
  ok('uses a table layout + inline styles (email-client-safe, no external assets)', shell.includes('role="presentation"') && shell.includes('style=') && !/https?:\/\//.test(shell));
}

// builder list item 59: the studio's logo in place of its name, when it set one
{
  const brand = { ...brandFromKit({ primary: '#8c3b2e' }, 'Marlow & Co'), logoUrl: 'https://store.example/sign/logo.png?token=abc' };
  const shell = brandEmailShell('<p>hi</p>', brand);
  ok('a logo is drawn as an image with the name as its alt text', /<img src="https:\/\/store\.example\/sign\/logo\.png\?token=abc" alt="Marlow &amp; Co"/.test(shell));
  ok('the logo stands in for the name line (the footer still names the studio)', !/font-size:19px[^>]*>Marlow &amp; Co</.test(shell) && /Sent by Marlow &amp; Co on Studio OS/.test(shell));
  ok('a logo that is not https is ignored', !/<img/.test(brandEmailShell('<p>hi</p>', { ...brand, logoUrl: 'http://x/logo.png' })) && !/<img/.test(brandEmailShell('<p>hi</p>', { ...brand, logoUrl: 'javascript:alert(1)' })));
  ok('without a logo the name is drawn as before', /font-size:19px[^>]*>Marlow &amp; Co</.test(brandEmailShell('<p>hi</p>', { ...brand, logoUrl: null })));
  ok('a hostile logo URL is escaped', !/"><script/.test(brandEmailShell('<p>hi</p>', { ...brand, logoUrl: 'https://x/a.png"><script>1</script>' })));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ EMAIL BRAND: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
