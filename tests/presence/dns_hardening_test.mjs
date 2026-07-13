// ── DNS misconfig hardening — pure logic (DNS-study #5 + apex de-risk) ────────
//   deno run --allow-read --allow-env --allow-net tests/presence/dns_hardening_test.mjs
// The two PURE decision cores of the DNS-hardening sweeps:
//   • emailAuthNudgeDue / emailAuthGaps / emailAuthNudgeCopy
//       (commerce/lifecycle.ts) — the N-day persistence threshold, the
//       "only when unauthenticated" gate, the named-gap copy. Send-once itself is
//       the notice dedupe (proven in email_send_once / website_notices); here the
//       DECISION boundary is proven (a fresh or authenticated gap is never due).
//   • apexMatchesExpected / apexGuidance / NETLIFY_APEX_IP (platform/dns.ts) —
//       the apex-target verification (expected vs live, drift vs unresolved) and
//       the ONE authoritative apex constant.
// All pure — no DB, no network, no clock (an injected `nowIso`).
import {
  EMAIL_AUTH_NUDGE_DAYS, emailAuthGaps, emailAuthNudgeDue, emailAuthNudgeCopy,
} from '../../supabase/functions/presence/commerce/lifecycle.ts';
import {
  NETLIFY_APEX_IP, apexGuidance, apexMatchesExpected,
} from '../../supabase/functions/presence/platform/dns.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

const NOW = '2026-07-20T12:00:00Z';
const daysAgo = (d) => new Date(Date.parse(NOW) - d * 86400_000).toISOString();

// ═══ emailAuthGaps — stable named order (SPF, DMARC, DKIM) ═══
ok('gaps: none → empty', emailAuthGaps({ spfMissing: false, dmarcMissing: false, dkimMissing: false }).length === 0);
ok('gaps: all three, stable order', JSON.stringify(emailAuthGaps({ spfMissing: true, dmarcMissing: true, dkimMissing: true })) === JSON.stringify(['SPF', 'DMARC', 'DKIM']));
ok('gaps: DKIM only', JSON.stringify(emailAuthGaps({ spfMissing: false, dmarcMissing: false, dkimMissing: true })) === JSON.stringify(['DKIM']));

// ═══ emailAuthNudgeDue — persistence threshold + unauthenticated gate ═══
ok('due: persistent SPF gap (8d ≥ 7) → due', (() => { const r = emailAuthNudgeDue({ spfMissing: true, dmarcMissing: false, dkimMissing: false, sinceIso: daysAgo(8), nowIso: NOW }); return r.due === true && JSON.stringify(r.gaps) === JSON.stringify(['SPF']); })());
ok('due: fresh gap (3d < 7) → NOT due (grace to self-resolve)', emailAuthNudgeDue({ spfMissing: true, dmarcMissing: true, dkimMissing: false, sinceIso: daysAgo(3), nowIso: NOW }).due === false);
ok('due: exactly at threshold (7d) → due', emailAuthNudgeDue({ spfMissing: false, dmarcMissing: true, dkimMissing: false, sinceIso: daysAgo(EMAIL_AUTH_NUDGE_DAYS), nowIso: NOW }).due === true);
ok('due: no gaps (fully authenticated) → NOT due even if old', emailAuthNudgeDue({ spfMissing: false, dmarcMissing: false, dkimMissing: false, sinceIso: daysAgo(90), nowIso: NOW }).due === false);
ok('due: gaps present but sinceIso null → NOT due (unknown age)', emailAuthNudgeDue({ spfMissing: true, dmarcMissing: false, dkimMissing: false, sinceIso: null, nowIso: NOW }).due === false);
ok('due: DKIM-only persistent gap → due', (() => { const r = emailAuthNudgeDue({ spfMissing: false, dmarcMissing: false, dkimMissing: true, sinceIso: daysAgo(10), nowIso: NOW }); return r.due === true && JSON.stringify(r.gaps) === JSON.stringify(['DKIM']); })());
ok('due: custom threshold respected (14d threshold, 8d gap → not yet)', emailAuthNudgeDue({ spfMissing: true, dmarcMissing: false, dkimMissing: false, sinceIso: daysAgo(8), nowIso: NOW }, 14).due === false);
ok('due: malformed sinceIso → NOT due (never nudge on garbage)', emailAuthNudgeDue({ spfMissing: true, dmarcMissing: false, dkimMissing: false, sinceIso: 'not-a-date', nowIso: NOW }).due === false);

// ═══ emailAuthNudgeCopy — owner-facing, names the gaps, singular/plural ═══
{
  const one = emailAuthNudgeCopy(['SPF'], 'Acme Co');
  const many = emailAuthNudgeCopy(['SPF', 'DMARC', 'DKIM'], 'Acme Co');
  ok('copy: headline is the calm spam warning', /messages may go to spam/i.test(one.headline));
  ok('copy: single gap named without a list join', one.body.includes('missing SPF,') && !one.body.includes('missing SPF, DMARC'));
  ok('copy: multiple gaps joined with "and"', many.body.includes('SPF, DMARC and DKIM'));
  ok('copy: business name woven into subject/html', many.subject.includes('Acme Co') && many.html.includes('Acme Co'));
  ok('copy: empty business name degrades gracefully', emailAuthNudgeCopy(['SPF'], '').subject.includes('your business'));
}

// ═══ NETLIFY_APEX_IP — the ONE authoritative constant ═══
ok('apex const: is a valid IPv4', /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(NETLIFY_APEX_IP) && NETLIFY_APEX_IP.split('.').every((o) => Number(o) <= 255));

// ═══ apexGuidance — A record from the constant + ALIAS-preference wording ═══
{
  const g = apexGuidance('acme.com', 'acme.netlify.app');
  ok('guidance: A record value comes from the ONE constant', g.record.type === 'A' && g.record.value === NETLIFY_APEX_IP && g.record.name === 'acme.com');
  ok('guidance: prefers ALIAS/ANAME/flattening when target known', /ALIAS|ANAME|flattening/i.test(g.recommended) && g.recommended.includes('acme.netlify.app'));
  ok('guidance: no target → still names the fallback IP + the flattening option', (() => { const n = apexGuidance('acme.com', null); return n.record.value === NETLIFY_APEX_IP && /ALIAS|ANAME|flattening/i.test(n.recommended); })());
}

// ═══ apexMatchesExpected — verification: expected vs live, drift vs unresolved ═══
const EXP = { target: 'acme.netlify.app', ip: NETLIFY_APEX_IP };
ok('apex: A record == expected IP → ok', apexMatchesExpected({ aRecords: [NETLIFY_APEX_IP], cnames: [] }, EXP).ok === true);
ok('apex: CNAME/ALIAS flattened to target → ok', apexMatchesExpected({ aRecords: [], cnames: ['acme.netlify.app'] }, EXP).ok === true);
ok('apex: trailing dot + case are normalized → ok', apexMatchesExpected({ aRecords: [], cnames: ['ACME.NETLIFY.APP.'] }, EXP).ok === true);
{
  const drift = apexMatchesExpected({ aRecords: ['203.0.113.9'], cnames: [] }, EXP);
  ok('apex: resolves to WRONG address → drift (resolved, not ok)', drift.ok === false && drift.resolved === true && /instead of/i.test(drift.reason));
}
{
  const unresolved = apexMatchesExpected({ aRecords: [], cnames: [] }, EXP);
  ok('apex: nothing resolves → NOT drift (resolved=false; that is dns_apex_unresolved)', unresolved.ok === false && unresolved.resolved === false);
}
ok('apex: target null but A matches IP → ok (A-record path still valid)', apexMatchesExpected({ aRecords: [NETLIFY_APEX_IP], cnames: [] }, { target: null }).ok === true);
ok('apex: defaults expected.ip to the constant when omitted', apexMatchesExpected({ aRecords: [NETLIFY_APEX_IP], cnames: [] }, { target: null }).ok === true);

const passed = results.filter((r) => r.p).length;
console.log(`\n════ DNS HARDENING (pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
