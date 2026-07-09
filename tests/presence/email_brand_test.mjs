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

const passed = results.filter((r) => r.p).length;
console.log(`\n════ EMAIL BRAND: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
