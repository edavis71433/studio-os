// ── Sales item 92: the sign-in and password emails, read and reworded ──
//   deno run --allow-read tests/presence/auth_emails_test.mjs
// Supabase sends these itself; supabase/templates/auth/ is the record of what they
// say, pasted into the dashboard (README.md there). This keeps each one working
// (the variable its flow needs) and in the same plain voice as the product's mail.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const DIR = 'supabase/templates/auth/';
const T = {
  magic_link: { needs: ['{{ .ConfirmationURL }}', '{{ .Token }}'], says: 'Your sign-in link' },
  reset_password: { needs: ['{{ .Token }}', 'davisdigitalstudio.com/set-password'], says: 'Reset your password' },
  invite: { needs: ['{{ .Token }}', 'davisdigitalstudio.com/set-password'], says: 'Set your password' },
  confirm_signup: { needs: ['{{ .ConfirmationURL }}'], says: 'Confirm your email address' },
  change_email: { needs: ['{{ .ConfirmationURL }}', '{{ .NewEmail }}'], says: 'Confirm your new email address' },
  reauthentication: { needs: ['{{ .Token }}'], says: 'Your verification code' },
};
const readme = read(DIR + 'README.md');
for (const [name, t] of Object.entries(T)) {
  const html = read(`${DIR}${name}.html`);
  ok(`${name}: carries what its flow needs (${t.needs.join(', ')})`, t.needs.every((v) => html.includes(v)));
  ok(`${name}: its heading says what it is`, html.includes(`>${t.says}</h1>`));
  ok(`${name}: speaks for no one person and names no studio`, !/\bEric\b|\bI’ll\b|\bI'll\b|\bI\b|your studio|project portal|eric@/.test(html));
  ok(`${name}: ends with the platform’s postal line, like the product’s own emails`, html.includes('Davis Digital Studio LLC · Burbank, California'));
  ok(`${name}: says what to do if you didn’t ask for it, or how long the code lasts`, /Didn’t ask|Didn’t sign up|works for a short time|works once/.test(html));
  ok(`${name}: the README says where it goes`, readme.includes(`\`${name}.html\``));
  ok(`${name}: every link is a Supabase variable (no link baked in)`, [...html.matchAll(/href="([^"]*)"/g)].every((m) => m[1] === '{{ .ConfirmationURL }}'));
}
ok('README: the sender name changes from Eric Davis to the studio', /Sender name\*\* `Eric Davis` →\s*`Davis Digital Studio`/.test(readme));
ok('the sign-in email offers the link first and the code second, as the portal page does', (() => { const h = read(DIR + 'magic_link.html'); return h.indexOf('{{ .ConfirmationURL }}') < h.indexOf('{{ .Token }}'); })());
{
  const portal = read('portal.html');
  ok('portal.html still asks for the 6-digit code from that email', /6-digit code/.test(portal) && /type: 'email'/.test(portal));
  const setpw = read('set-password.html');
  ok('set-password.html still takes the reset and invitation codes', /type: "recovery"/.test(setpw) && /type: "invite"/.test(setpw));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ SIGN-IN AND PASSWORD EMAILS (sales item 92): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
