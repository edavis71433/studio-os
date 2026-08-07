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
function callsOf(src, fn) {
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
    out.push(src.slice(i + needle.length, j - 1));
    i = j;
  }
  return out;
}
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
// The recipient variable names this codebase uses for the operator's ops
// address. The boundary is the RECIPIENT, not the wording: mail addressed to
// the platform operator about the platform is operational, full stop.
const OPS_RECIPIENT = /^(OPS_ALERT_EMAIL|ops)$/;

const OPS_FILES = [
  ['ops/scheduler.ts', 'supabase/functions/presence/ops/scheduler.ts'],
  ['monitor/heartbeat.ts', 'supabase/functions/presence/monitor/heartbeat.ts'],
  ['commerce/deletion.ts', 'supabase/functions/presence/commerce/deletion.ts'],
  ['commerce/lifecycle.ts', 'supabase/functions/presence/commerce/lifecycle.ts'],
];

let opsSeen = 0;
for (const [label, path] of OPS_FILES) {
  const src = read(path);
  const opsCalls = callsOf(src, 'sendEmail').filter((a) => OPS_RECIPIENT.test(firstArg(a)));
  opsSeen += opsCalls.length;
  ok(`B1 ${label}: found at least one OPS_ALERT_EMAIL send to check`, opsCalls.length > 0,
    'the scanner found none — recipient variable renamed?');
  const missing = opsCalls.filter((a) => !hasCritical(a));
  ok(`B1 ${label}: every OPS_ALERT_EMAIL send passes critical:true (${opsCalls.length} call(s))`,
    missing.length === 0, `${missing.length} without critical: ${missing.map((m) => m.slice(0, 70).replace(/\s+/g, ' ')).join(' | ')}`);
}
// 5 direct OPS_ALERT_EMAIL sends (scheduler ·1, heartbeat ·1, deletion ·1,
// lifecycle ·2) + the weekly digest, checked separately below = 6 in all.
ok('B1: the ops-alert scan covered every direct operational alert site (>= 5)', opsSeen >= 5, `saw ${opsSeen}`);

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
