// ── Client-experience audit: "the client is never left wondering what happens
//    next" — structural guards for the four client-facing email moments ────────
//   #1 the welcome/invite email speaks as the STUDIO (never the platform)
//   #4 "your site is live" emails the bridged client, once, from both doors
//   #5 the marketing enquiry is acknowledged (the contact page's promise is kept)
//   #6 a portal-composer (auth-uid) support requester gets the studio's reply
//
//   deno run --allow-read tests/presence/client_experience_emails_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const sales = read('supabase/functions/presence/routes/sales.ts');
const bridge = read('supabase/functions/presence/lib/service_bridge.ts');
const pub = read('supabase/functions/presence/routes/publish.ts');
const rec = read('supabase/functions/presence/lib/deploy_reconcile.ts');
const intake = read('supabase/functions/presence/routes/service_intake.ts');
const clever = read('supabase/functions/clever-api/index.ts');
const contact = read('contact.html');

// ═══ #1 · The welcome/invite email — the studio's, never the platform's ══════
const inviteStart = sales.indexOf('async function sendCustomerInvite');
const inviteEnd = sales.indexOf('\n}', inviteStart) + 2;
const invite = sales.slice(inviteStart, inviteEnd);
ok('invite: helper exists and takes the studio siteId', inviteStart > 0 && /sendCustomerInvite\(siteId: string, email: string/.test(invite));
ok('invite: loads the STUDIO email brand (loadEmailBrand on the caller’s site)', /loadEmailBrand\(siteId\)/.test(invite));
ok('invite: the send carries that brand (not the platform default shell)', /\n  brand, \{ critical: true \}/.test(invite) && !/\n  undefined, \{ critical: true \}/.test(invite));
ok('invite: subject is studio-voiced — "Your client portal is ready — <studio>"', /`Your client portal is ready\$\{studioName \? ` — \$\{studioName\}` : ''\}`/.test(invite));
// comments may still NAME the platform (the secrecy-rule explanation does); the
// sent subject/body must not — so strip comments, then look for the string.
ok('invite: "Studio OS" appears NOWHERE in the subject or body', !/Studio OS/.test(invite.split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\/\* .*?\*\//g, '')).join('\n').replace(/EMAIL_BRAND_DEFAULT/g, '')));
ok('invite: an unnamed studio degrades to a BARE subject, never the platform name', /brand\.name !== EMAIL_BRAND_DEFAULT\.name \? brand\.name : ''/.test(invite));
ok('invite: says what the portal is FOR (progress · messages · files/approvals · invoices)', /progress/.test(invite) && /message me directly/.test(invite) && /share files and approve work/.test(invite) && /invoice/.test(invite));
ok('invite: the set-password CTA is kept (signed link → client portal)', /generateSetPasswordLink\(email, `\$\{base\}\/set-password\.html\?next=\/client\.html`\)/.test(invite));
ok('invite: sends exactly ONCE (one sendEmail call in the helper)', (invite.match(/sendEmail\(/g) || []).length === 1);
ok('invite: every caller passes its own site id (convert, resend, add-customer)', (sales.match(/sendCustomerInvite\(site\.id, email, /g) || []).length === 3 && !/sendCustomerInvite\(email,/.test(sales));

// ═══ #4 · "Your website is live" — the bridged client hears it, once ═════════
const liveStart = bridge.indexOf('export async function emailCustomerSiteLive');
const liveEnd = bridge.indexOf('\n}', liveStart) + 2;
const liveFn = bridge.slice(liveStart, liveEnd);
ok('site-live: helper exists in the ONE bridge-email home (service_bridge.ts)', liveStart > 0);
ok('site-live: resolves the ACTIVE service link (tenant-safe — unbridged sites send nothing)', /presence_service_links\?customer_site_id=eq\.\$\{customerSiteId\}&status=eq\.active/.test(liveFn));
ok('site-live: includes the real live URL (custom domain, else the netlify host)', /custom_domain/.test(liveFn) && /netlify_site_id/.test(liveFn) && /https:\/\/\$\{host\}/.test(liveFn));
ok('site-live: reuses emailBridgedCustomer (studio brand + critical + project deep link)', /return await emailBridgedCustomer\(String\(link\.agency_site_id\), String\(link\.project_id\)/.test(liveFn));
ok('site-live: subject is the celebration — "Your website is live — here’s the link"', /'Your website is live — here’s the link'/.test(liveFn));
ok('site-live: one warm what-happens-next sentence (the walkthrough), never "the system"', /walk through everything together/.test(liveFn) && !/the system/i.test(liveFn));
ok('site-live: never throws (best-effort catch → false)', /catch \{ return false; \}/.test(liveFn));
// send-once: BOTH doors gate the email on the checklist tick's FRESH transition —
// tickChecklistStep's PATCH matches only status=neq.done rows (race-safe in
// Postgres: the loser re-evaluates the WHERE and matches nothing), so a
// re-publish / re-reconcile can never re-send.
ok('site-live: publish door sends ONLY on a fresh tick', /tickChecklistForCustomerSite\(site\.id, 'site_live', 'publish', 'system'\)\.catch\(\(\) => false\)\s*\n\s*\.then\(\(fresh\) => fresh \? emailCustomerSiteLive\(site\.id\) : false\)/.test(pub));
ok('site-live: reconcile door (async deploys) sends ONLY on a fresh tick', /const fresh = await m\.tickChecklistForCustomerSite\(String\(p\.site_id\), 'site_live', 'publish-reconcile', 'system'\);\s*\n\s*if \(fresh\) await m\.emailCustomerSiteLive\(String\(p\.site_id\)\);/.test(rec));
ok('site-live: the tick’s idempotency IS the dedupe (PATCH matches only not-done rows)', /status=neq\.done/.test(bridge));
ok('site-live: no operator duplicate — the helper emails the CLIENT only', !/emailOperator|notifyStudioOfClientAction|studioRecipient/.test(liveFn));

// ═══ #6 · Support replies reach portal-composer clients’ inboxes ═════════════
const srStart = intake.indexOf('async function emailStudioSupportReply');
const srEnd = intake.indexOf('\n}', srStart) + 2;
const sr = intake.slice(srStart, srEnd);
ok('support-reply: the literal-email branch is kept (email-native requesters unchanged)', /if \(EMAIL_RE\.test\(requester\)\)/.test(sr) && /sendEmail\(requester, 'A reply from your studio', replyHtml, brand, \{ critical: true, siteId: site\.id \}\)/.test(sr));
ok('support-reply: an auth-uid requester is RESOLVED, not skipped — F3 stamp first, else clientIdForRequester', /reqRow\?\.client_id && UUID_RE\.test\(String\(reqRow\.client_id\)\)/.test(sr) && /clientIdForRequester\(site\.id, \{ userId: requester \}\)/.test(sr));
ok('support-reply: the resolved client is emailed via the ONE bridge channel', /emailCustomerByClient\(site\.id, clientId, 'A reply from your studio', replyHtml\)/.test(sr));
ok('support-reply: the 15-minute throttle guards BOTH branches (probe precedes them)', (() => {
  const throttle = sr.indexOf('15 * 60 * 1000');
  const emailBranch = sr.indexOf('EMAIL_RE.test(requester))');
  const uidBranch = sr.indexOf('clientIdForRequester');
  return throttle > 0 && emailBranch > throttle && uidBranch > throttle;
})());
ok('support-reply: no reachable inbox ⇒ LOUD warn, never silence', /console\.warn\(`\[support-reply\]/.test(sr) && !/skip silently/.test(sr));
ok('support-reply: still best-effort (never blocks or fails the studio’s reply)', /catch \(e\)/.test(sr) && /non-fatal/.test(sr));

// ═══ #5 · The marketing enquiry acknowledgement ═══════════════════════════════
// EVIDENCE of which path the live form hits: contact.html’s PRIMARY submit posts
// type:"lead_intake" to clever-api; Formspree is only the CRM-down fallback. So
// the ack belongs in lead_intake — and now lives there.
ok('enquiry: the live contact form’s primary path IS clever-api lead_intake', /type: "lead_intake"/.test(contact) && /functions\/v1\/clever-api/.test(contact));
const liStart = clever.indexOf("if (type === 'lead_intake')");
const liEnd = clever.indexOf("// ── LEAD LIST", liStart);
const li = clever.slice(liStart, liEnd);
ok('enquiry: lead_intake now acknowledges the enquirer (was dead code with zero callers)', /emailOk\(lemail, `Thanks for reaching out to Davis Digital Studio`/.test(li));
ok('enquiry: ack wording keeps the page’s promise ("personally, usually within one business day")', /personally, usually within one business day/.test(li));
ok('enquiry: ack is from Eric with a real Reply-To (CLIENT_OPTS)', /CLIENT_OPTS\);/.test(li));
ok('enquiry: ack only with a plausible email, and NEVER fails the intake (try/catch)', /lemail && \/\^\[\^\\s@\]\+@\[\^\\s@\]\+\\\.\[\^\\s@\]\+\$\/\.test\(lemail\)/.test(li) && /never fail intake over the ack/.test(li));
ok('enquiry: sends once (exactly one ack send in lead_intake)', (li.match(/emailOk\(lemail/g) || []).length === 1);
ok('enquiry: Eric’s own notification is untouched', /sendEmail\(ERIC, `New lead: /.test(li));
// The Formspree fallback sends NO ack — the thanks panel now hides its "you’ll
// get a confirmation email" line on that path instead of promising one.
ok('enquiry: fallback path is honest — ack promise hidden when Formspree carried it', /showThanks\(true\)/.test(contact) && /showThanks\(false\)/.test(contact) && /id="ackFoot"/.test(contact) && /ackFoot\.style\.display = 'none'/.test(contact));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ CLIENT-EXPERIENCE EMAILS (structural): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
