// ── B2: sendEmail's text/plain alternative reads like prose, not a run-on ────
//   deno run --allow-read --allow-env --allow-net tests/presence/email_plaintext_test.mjs
//
// Every Resend send carries a plain-text alternative derived from the body HTML
// (deliverability + text-only clients). It was stripping tags without breaking
// at CELL boundaries, so every table-based email in this codebase — booking,
// review, the operator notifications — read "ProjectWebsite refresh" instead of
// "Project: Website refresh": the label welded to its value. The exact plain
// part of a REAL body from this codebase is pinned below so it can't regress.
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'test-signing-key-for-hmac-only');
Deno.env.set('RESEND_KEY', 're_test_key');

const account = await import('../../supabase/functions/presence/commerce/account.ts');

// A REAL body from this codebase: the operator notification built in
// lib/service_bridge.ts (notifyStudioOfClientAction), with real values
// substituted. escHtml there emits only &amp;/&lt;/&gt;/&quot;.
const OPERATOR_NOTIFICATION_HTML =
  `<p><b>Marlow &amp; Sons</b> sent you a message</p>` +
  `<table style="margin:8px 0;border-collapse:collapse">` +
  `<tr><td style="padding:2px 12px 2px 0;color:#666">Project</td><td><b>Website refresh</b></td></tr>` +
  `<tr><td style="padding:2px 12px 2px 0;color:#666">Subject</td><td><b>Can we swap the hero photo?</b></td></tr>` +
  `</table>` +
  `<blockquote style="margin:8px 0;padding:8px 14px;border-left:3px solid #5b3fa0;color:#444">The one on the homepage is from last summer.</blockquote>` +
  `<p class="cta"><a href="https://app.example.com/crm.html?project=p1&amp;tab=messages" style="display:inline-block">Open it in your workspace →</a></p>`;

// The pinned plain part. Every label is joined to its value by a real separator
// and every row is its own line — this is the regression pin. The one blank line
// is the </tr> + </table> pair closing the fact block before the quoted excerpt;
// it is kept (a single blank line is allowed, runs of three or more collapse).
const EXPECTED_PLAIN = [
  'Marlow & Sons sent you a message',
  'Project: Website refresh',
  'Subject: Can we swap the hero photo?',
  '',
  'The one on the homepage is from last summer.',
  'Open it in your workspace →',
].join('\n');

ok('B2: htmlToPlainText is exported (the derivation is a named, testable unit)', typeof account.htmlToPlainText === 'function');

if (typeof account.htmlToPlainText === 'function') {
  const got = account.htmlToPlainText(OPERATOR_NOTIFICATION_HTML);
  ok('B2: the REAL operator-notification body derives readable plain text (exact pin)', got === EXPECTED_PLAIN,
    `\n--- got ---\n${got}\n--- want ---\n${EXPECTED_PLAIN}\n`);

  // the boundary cases the brief calls out, each on its own
  ok('B2: </td> separates label from value', account.htmlToPlainText('<td>Project</td><td>Website refresh</td>') === 'Project: Website refresh');
  ok('B2: </th> separates header cells too', account.htmlToPlainText('<th>Name</th><th>Value</th>') === 'Name: Value');
  ok('B2: </tr> ends the row (no trailing separator)', account.htmlToPlainText('<tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr>') === 'A: B\nC: D');
  ok('B2: <br>, <br/> and <br /> all break', account.htmlToPlainText('a<br>b<br/>c<br />d') === 'a\nb\nc\nd');
  ok('B2: </p> breaks', account.htmlToPlainText('<p>one</p><p>two</p>') === 'one\ntwo');
  ok('B2: </div> breaks', account.htmlToPlainText('<div>one</div><div>two</div>') === 'one\ntwo');
  ok('B2: </li> breaks — a <ul> is a list, not a run-on sentence',
    account.htmlToPlainText('<ul><li><strong>2</strong> new subscriptions</li><li><strong>0</strong> lapsed</li></ul>') === '2 new subscriptions\n0 lapsed');
  ok('B2: </blockquote> breaks (the quoted excerpt never runs into the CTA)',
    account.htmlToPlainText('<blockquote>quoted</blockquote><p class="cta">Open it →</p>') === 'quoted\nOpen it →');
  ok('B2: entities still decode', account.htmlToPlainText('<p>Tom &amp; Jerry &lt;3 &quot;x&quot;&nbsp;y</p>') === 'Tom & Jerry <3 "x" y');
  ok('B2: blank runs still collapse to one blank line', !/\n\n\n/.test(account.htmlToPlainText('<p>a</p><div></div><div></div><div></div><p>b</p>')));
  ok('B2: an empty body is an empty string (never throws)', account.htmlToPlainText('') === '' && account.htmlToPlainText(undefined) === '');

  // ── the SENTINEL is a property of the function, not a hope about its input ──
  // The cell separator is a private control character (\x01) chosen because it
  // "cannot occur in email copy". That is a claim about INPUT, and the function
  // could not enforce it: a \x01 arriving in a subject line, a filename, a client
  // message excerpt or a pasted-in body used to survive the tag strip and get
  // rewritten into ": " by the between-cells pass — `alpha\x01beta` came out
  // `alpha: beta`, a label/value split invented out of nothing. Every email body
  // in this codebase is studio-authored HTML today, so nothing hits it; the guard
  // is here because the next caller interpolates something it did not write.
  ok('B2: a stray SENTINEL in the copy cannot forge a label/value split',
    account.htmlToPlainText('<p>alphabeta</p>') === 'alphabeta',
    JSON.stringify(account.htmlToPlainText('<p>alphabeta</p>')));
  ok('B2: a stray SENTINEL cannot forge a row end either',
    account.htmlToPlainText('<td>Project</td><td>Website</td>') === 'Project: Website',
    JSON.stringify(account.htmlToPlainText('<td>Project</td><td>Website</td>')));
  ok('B2: the real cell separator still works beside a stripped one',
    account.htmlToPlainText('<td>A</td><td>B</td>') === 'A: B',
    JSON.stringify(account.htmlToPlainText('<td>A</td><td>B</td>')));
}

// ── and it is what actually rides on the wire ────────────────────────────────
// The pin above is worthless if sendEmail stops using it, so send a real message
// through the real function with fetch mocked and read the `text` field Resend
// would receive.
{
  const realFetch = globalThis.fetch;
  let sentBody = null;
  globalThis.fetch = (url, init) => {
    const u = String(url);
    if (u.includes('api.resend.com')) { sentBody = JSON.parse(init.body); return Promise.resolve(new Response('{"id":"x"}', { status: 200 })); }
    return Promise.resolve(new Response('[]', { status: 200 }));   // clean suppression store
  };
  try {
    const sent = await account.sendEmail('owner@example.com', 'Marlow & Sons sent you a message', OPERATOR_NOTIFICATION_HTML, undefined, { critical: true });
    ok('B2 wire: the send went out', sent === true && !!sentBody);
    ok('B2 wire: the text/plain alternative on the wire is the readable derivation',
      !!sentBody && sentBody.text === EXPECTED_PLAIN, sentBody ? `\n--- got ---\n${sentBody.text}\n` : 'no body captured');
    ok('B2 wire: the HTML part is untouched by the text derivation', !!sentBody && sentBody.html.includes('<td'));
  } finally { globalThis.fetch = realFetch; }
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ EMAIL PLAIN-TEXT ALTERNATIVE (B2): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
