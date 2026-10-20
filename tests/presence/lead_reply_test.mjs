// ── Oct 2026 workflow audit, change 5: reply to a website enquiry from Studio OS ──
//   deno run --allow-read --allow-env --allow-net tests/presence/lead_reply_test.mjs
// POST /forms/inbox/:id/reply sends through the ONE send point and keeps the
// reply (fields.__studio_replies), so the enquiry, the Inbox and — once it is a
// deal — the customer record all show the answer. Pure helpers + source pins.
const R = await import('../../supabase/functions/presence/routes/commercial.ts');
const route = await Deno.readTextFile(new URL('../../supabase/functions/presence/routes/commercial.ts', import.meta.url));
const index = await Deno.readTextFile(new URL('../../supabase/functions/presence/index.ts', import.meta.url));
const inbox = await Deno.readTextFile(new URL('../../inbox.html', import.meta.url));

const results = [];
const ok = (n, p) => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// ── pure helpers ──
ok('leadReplies: absent / malformed fields → []', R.leadReplies(null).length === 0 && R.leadReplies({}).length === 0 && R.leadReplies({ __studio_replies: 'x' }).length === 0);
ok('leadReplies: keeps body + at, drops junk rows', JSON.stringify(R.leadReplies({ __studio_replies: [{ body: 'Hi', at: '2026-10-20T00:00:00Z' }, null, { at: 'x' }] })) === JSON.stringify([{ body: 'Hi', at: '2026-10-20T00:00:00Z' }]));
const html = R.leadReplyHtml('Hi Sam,\n\nYes — <b>Tuesday</b> works.\nSee you then.', 'Can I get a <quote>?');
ok('leadReplyHtml: paragraphs on blank lines, <br> on single newlines', html.startsWith('<p>Hi Sam,</p><p>') && html.includes('works.<br>See you then.</p>'));
ok('leadReplyHtml: escapes the reply AND the quoted enquiry', html.includes('&lt;b&gt;Tuesday&lt;/b&gt;') && html.includes('&lt;quote&gt;') && !html.includes('<b>'));
ok('leadReplyHtml: no original → no quote block', !R.leadReplyHtml('Thanks', '').includes('blockquote'));

// ── the route ──
ok('router: POST /forms/inbox/:id/reply → handleFormReply (jwt + principal)', /\/forms\\\/inbox\\\/\(\[0-9a-f-\]\{36\}\)\\\/reply\$/.test(index) && /handleFormReply\(req, jwt, site, principal, m\[1\], cors\)/.test(index));
ok('studio-side only (a client reviewer can never send as the studio)', /handleFormReply[\s\S]{0,200}isStudioSide\(jwt, site, principal\)\)\) return studioDenied/.test(route));
ok('the person becomes a known contact BEFORE the send (their reply threads back)', route.indexOf('await ensureLeadContact(') > -1 && route.indexOf('await ensureLeadContact(') < route.indexOf("const sent = await sendEmail("));
ok('sent through the one send point, on the site brand, reply-to = the site inbound', /sendEmail\(email, `Re: your \$\{kind\}`, leadReplyHtml\(body, String\(sub\.message \|\| ''\)\), brand, \{ critical: true, siteId: site\.id \}\)/.test(route));
ok('a failed send says nothing went out (503) and records nothing', /if \(!sent\) return json\(\{ error: 'not_sent'[\s\S]{0,140}503/.test(route) && route.indexOf("if (!sent)") < route.indexOf('__studio_replies: replies'));
ok('marks Replied (only from new/read — never un-converts) and resolves the follow-up nudge', /if \(sub\.status === 'new' \|\| sub\.status === 'read'\) patch\.status = 'replied'/.test(route) && /leadFollowupNoticeKey\(id\)/.test(route.slice(route.indexOf('handleFormReply'))));
ok('a deal from this enquiry gets the reply as an email activity (record timeline)', /source_submission_id=eq\.\$\{id\}[\s\S]{0,400}buildActivityDetail\('email', body, at\)/.test(route));
ok('replies are capped (newest kept) and bodies bounded', /\.slice\(-LEAD_REPLIES_KEPT\)/.test(route) && /LEAD_REPLY_MAX = 4000/.test(route));
ok('the inbox read returns replies, never the raw form fields', /rows\.map\(\(\{ fields, \.\.\.s \}: any\) => \(\{ \.\.\.s, replies: leadReplies\(fields\)/.test(route));

// ── the two surfaces ──
ok('inbox.html: the enquiry pane composes and POSTs …/reply; mailto is only the quiet fallback', /\/reply','POST',\{body\}/.test(inbox) && /id="leadMailto"[^>]*>Use your email app instead/.test(inbox) && !/id="leadReply"/.test(inbox));

const failed = results.filter((p) => !p).length;
console.log(`\n════ LEAD REPLY (audit change 5): ${results.length - failed}/${results.length} ${failed ? 'FAILED' : 'PASSED'} ════`);
if (failed) Deno.exit(1);
