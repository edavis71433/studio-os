// ── HTML inline-script parse gate ─────────────────────────────────────────────
// leads.html shipped DEAD for days (one unclosed paren → whole-page SyntaxError,
// perpetual spinner) and nothing in CI could notice. This gate machine-parses
// every root page's inline <script> blocks so a broken page fails the sweep,
// not a customer. Pure filesystem; no network.
//
//   deno run --allow-read tests/presence/html_parse_test.mjs
const ROOT = new URL('../../', import.meta.url);
let pages = 0, blocks = 0;
const failures = [];
for await (const e of Deno.readDir(ROOT)) {
  if (!e.isFile || !e.name.endsWith('.html')) continue;
  pages++;
  const html = await Deno.readTextFile(new URL(e.name, ROOT));
  // plain inline scripts only — src= and type= (module/json-ld) blocks are skipped
  for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    blocks++;
    try { new Function(m[1]); } catch (err) {
      failures.push(`${e.name}: ${String(err && err.message).slice(0, 140)}`);
    }
  }
}
const pass = failures.length === 0;
console.log(`${pass ? 'PASS' : 'FAIL'}  html parse gate — ${pages} pages, ${blocks} inline blocks${pass ? ', 0 failures' : ''}`);
for (const f of failures) console.log(`  BROKEN → ${f}`);
console.log(`\n════ HTML PARSE GATE: ${pass ? '1/1 PASSED' : 'FAILED'} ════`);
if (!pass) Deno.exit(1);
