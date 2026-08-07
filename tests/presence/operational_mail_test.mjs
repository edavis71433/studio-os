// ── B1: operational mail is never silenced by a marketing unsubscribe ────────
//   deno run --allow-read tests/presence/operational_mail_test.mjs
//
// A marketing unsubscribe must not be able to kill "your scheduled jobs are
//      failing" or "your site is down". Every send addressed to OPS_ALERT_EMAIL
//      (the PLATFORM OPERATOR's own address, about his own platform) is
//      operational and carries critical:true; genuinely PROMOTIONAL mail to
//      customers must NOT. `critical` still respects bounce/complaint — that is
//      correct and is pinned here so it can't be "fixed" away.
//
// (The readability of the text/plain part those sends carry is B2, pinned in
//  tests/presence/email_plaintext_test.mjs.)
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// ── a tiny balanced-paren call extractor ─────────────────────────────────────
// Regexes can't see the end of a multi-line sendEmail(...) call, and "does this
// call carry critical:true" is exactly a whole-call question. Walks the source
// skipping string/template literals so a `)` inside copy never closes a call.
function callSitesOf(src, fn) {
  const out = [];
  const needle = fn + '(';
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) {
    // not a call if it's part of a longer identifier (e.g. `mySendEmail(`)
    if (i > 0 && /[A-Za-z0-9_$.]/.test(src[i - 1])) { i += needle.length; continue; }
    let j = i + needle.length, depth = 1, quote = null;
    for (; j < src.length && depth > 0; j++) {
      const c = src[j];
      if (quote) { if (c === '\\') { j++; continue; } if (c === quote) quote = null; continue; }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '(') depth++;
      else if (c === ')') depth--;
    }
    out.push({ args: src.slice(i + needle.length, j - 1), at: i });
    i = j;
  }
  return out;
}
const callsOf = (src, fn) => callSitesOf(src, fn).map((c) => c.args);
/** First top-level argument of an extracted argument string. */
function firstArg(args) {
  let depth = 0, quote = null;
  for (let j = 0; j < args.length; j++) {
    const c = args[j];
    if (quote) { if (c === '\\') { j++; continue; } if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) return args.slice(0, j).trim();
  }
  return args.trim();
}
const hasCritical = (args) => /critical:\s*true/.test(args);

// ═══════════════════════════════════════════════════════════════════════════
// B1 — every OPS_ALERT_EMAIL send is critical
// ═══════════════════════════════════════════════════════════════════════════
// The boundary is the RECIPIENT, not the wording: mail addressed to the platform
// operator about the platform is operational, full stop.
//
// ── WHY THE SITE LIST IS DERIVED, NOT WRITTEN DOWN ──────────────────────────
// It used to be a hand-maintained four-file array with a `>= 5` floor, and that
// is a guard which silently stops guarding. Two more operator sends landed
// (lib/scope.ts — the scoped-access audit alert; routes/commerce.ts — the
// deletion-request alert) and were in NEITHER the list nor the floor, so
// deleting `critical:true` from either left this suite fully green: a marketing
// unsubscribe could switch off a failing audit log and nothing would say so.
//
// So the list is computed. Every .ts under supabase/functions/ is scanned for
// sendEmail calls whose FIRST argument is — or is bound from — OPS_ALERT_EMAIL,
// and every one of them must carry critical:true. A ninth operator send added
// tomorrow is covered the day it lands, with no list to remember to update.
//
// Binding resolution is NEAREST-PRECEDING-ASSIGNMENT, the same way a reader
// resolves it: for `sendEmail(to, …)`, find the last place `to` was bound before
// that call and ask whether THAT line reads OPS_ALERT_EMAIL. A file-wide "any
// name ever bound from the env var" rule is too coarse — commerce/lifecycle.ts
// binds `to` from OPS_ALERT_EMAIL for the weekly digest and, four hundred lines
// later, from `a.customer_email` for a booking reminder, and conflating them
// would have this guard demanding critical:true on customer mail. Comment lines
// are skipped, so prose naming the env var (routes/system.ts's manifest,
// service_bridge.ts's rung doc) can never invent a binding.
const FN_ROOT = new URL('supabase/functions/', ROOT);
function walkTs(dir, out = []) {
  for (const e of [...Deno.readDirSync(dir)].sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (e.isDirectory) walkTs(new URL(e.name + '/', dir), out);
    else if (e.name.endsWith('.ts')) out.push(new URL(e.name, dir));
  }
  return out;
}
const isProse = (line) => line.startsWith('//') || line.startsWith('*') || line.startsWith('/*');
/** The source line of the last binding of `name` before offset `at` ('' if none).
 *  Sees plain declarations/assignments AND destructures (`const { to } = …`). */
function bindingBefore(src, name, at) {
  const re = new RegExp(`(?:const|let|var)\\s+(?:${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\})\\s*=|^[ \\t]*${name}\\s*=[^=]`, 'gm');
  let m, best = -1;
  while ((m = re.exec(src)) !== null) {
    if (m.index >= at) break;
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    if (isProse(src.slice(lineStart, src.indexOf('\n', m.index)).trim())) continue;
    best = lineStart;
  }
  if (best < 0) return '';
  const end = src.indexOf('\n', best);
  return src.slice(best, end === -1 ? src.length : end);
}

const OPS_SENDS = [];   // { label, args }
for (const url of walkTs(FN_ROOT)) {
  const label = decodeURIComponent(url.href.slice(ROOT.href.length));
  const src = Deno.readTextFileSync(url);
  if (!/OPS_ALERT_EMAIL/.test(src)) continue;
  for (const { args, at } of callSitesOf(src, 'sendEmail')) {
    const first = firstArg(args);
    if (!/^[A-Za-z_$][\w$]*$/.test(first)) continue;                 // a literal / expression recipient, not a binding
    if (!/OPS_ALERT_EMAIL/.test(bindingBefore(src, first, at))) continue;
    OPS_SENDS.push({ label, args });
  }
}
const byFile = new Map();
for (const s of OPS_SENDS) { if (!byFile.has(s.label)) byFile.set(s.label, []); byFile.get(s.label).push(s.args); }

for (const [label, calls] of byFile) {
  const missing = calls.filter((a) => !hasCritical(a));
  ok(`B1 ${label}: every OPS_ALERT_EMAIL send passes critical:true (${calls.length} call(s))`,
    missing.length === 0, `${missing.length} without critical: ${missing.map((m) => m.slice(0, 70).replace(/\s+/g, ' ')).join(' | ')}`);
}

// The derived scan is only a guard while it still REACHES the known sites — a
// renamed file or a refactored binding must fail here, not quietly shrink the
// scan to nothing. These are the eight operator-directed sends that exist today:
//   ops/scheduler.ts ·1   monitor/heartbeat.ts ·1   commerce/deletion.ts ·1
//   commerce/lifecycle.ts ·3 (two alerts + the weekly digest, whose recipient is
//                             a local `to` read from OPS_ALERT_EMAIL)
//   lib/scope.ts ·1       routes/commerce.ts ·1
const MUST_COVER = [
  'supabase/functions/presence/ops/scheduler.ts',
  'supabase/functions/presence/monitor/heartbeat.ts',
  'supabase/functions/presence/commerce/deletion.ts',
  'supabase/functions/presence/commerce/lifecycle.ts',
  'supabase/functions/presence/lib/scope.ts',
  'supabase/functions/presence/routes/commerce.ts',
];
for (const path of MUST_COVER) {
  ok(`B1 scan reaches ${path.replace('supabase/functions/presence/', '')}`, (byFile.get(path) || []).length > 0,
    'the derived scan found no OPS_ALERT_EMAIL send here — file moved, or the recipient binding changed shape?');
}
ok('B1: the derived scan covers every operational alert site (>= 8)', OPS_SENDS.length >= 8,
  `saw ${OPS_SENDS.length}: ${[...byFile].map(([f, c]) => `${f.split('/').pop()}·${c.length}`).join(' ')}`);

// One send the nearest-binding resolver deliberately cannot claim: the studio
// notification in lib/service_bridge.ts takes its recipient from a helper
// (studioRecipient) whose LAST rung falls back to OPS_ALERT_EMAIL on the
// platform's own agency site. The scan sees only `sendEmail(to, …)` where `to`
// came out of a destructure, so it is pinned by hand here rather than left to a
// resolver that would have to inline a function to be right.
{
  const sb = read('supabase/functions/presence/lib/service_bridge.ts');
  ok('B1 lib/service_bridge.ts: the studio notification (OPS_ALERT_EMAIL is its last recipient rung) is critical',
    /Deno\.env\.get\('OPS_ALERT_EMAIL'\)/.test(sb) &&
    callsOf(sb, 'sendEmail').filter((a) => firstArg(a) === 'to').every((a) => hasCritical(a)));
}

// The weekly digest is the one operational send whose recipient is bound to a
// local `to` (it IS OPS_ALERT_EMAIL — read at the top of runWeeklyDigest).
{
  const life = read('supabase/functions/presence/commerce/lifecycle.ts');
  const digest = life.slice(life.indexOf('export async function runWeeklyDigest'));
  const body = digest.slice(0, digest.indexOf('\n}\n') + 1);
  ok('B1 weekly digest: recipient really is OPS_ALERT_EMAIL', /const to = Deno\.env\.get\('OPS_ALERT_EMAIL'\)/.test(body));
  const calls = callsOf(body, 'sendEmail');
  ok('B1 weekly digest: exactly one send', calls.length === 1, `saw ${calls.length}`);
  ok('B1 weekly digest: passes critical:true — an unsubscribe must not silence the owner’s own weekly digest',
    calls.length === 1 && hasCritical(calls[0]));
}

// ── the BOUNDARY, asserted in the negative ───────────────────────────────────
// runProspectNurture is genuinely PROMOTIONAL outbound to a PROSPECT (a lead who
// ran the free review). An opt-out must keep silencing it — that is what the
// unsubscribe page promises. If this ever gains critical:true it is a defect.
{
  const life = read('supabase/functions/presence/commerce/lifecycle.ts');
  const nurture = life.slice(life.indexOf('export async function runProspectNurture'));
  const body = nurture.slice(0, nurture.indexOf('\n}\n') + 1);
  const calls = callsOf(body, 'sendEmail');
  ok('B1 boundary: the prospect-nurture drip is marketing — NEVER critical', calls.length === 1 && !hasCritical(calls[0]));
}
// The lapse/win-back wind-down copy to a CUSTOMER is marketing-adjacent and is
// deliberately left alone (only the genuinely transactional slot passes the flag).
{
  const life = read('supabase/functions/presence/commerce/lifecycle.ts');
  ok('B1 boundary: the customer wind-down nudge keeps its per-copy critical decision (not blanket-flagged)',
    /sendEmail\(email, copy\.subject, copy\.html, undefined, critical\)/.test(life) && /sendEmail\(email, copy\.subject, copy\.html\)\)\) emails\+\+/.test(life));
}

// ── critical still respects bounce/complaint (must stay true) ────────────────
{
  const core = read('supabase/functions/_shared/email_infra.ts');
  ok('B1: critical overrides ONLY opt_out — a bounce/complaint still suppresses',
    /if \(opts\?\.critical && reason === 'opt_out'\) return \{ ok: true, reason \};/.test(core));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ OPERATIONAL MAIL CRITICALITY (B1): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
