// ── Builder item 199: nobody signs up by themselves (Nov 15 2026) ─────────────
// Decided Nov 15 under Eric's "do what's best": not yet. Studios add their clients
// and invite them, and the studio publishes no prices, so self-serve sign-up is
// closed. This suite pins what that means:
//   · the sign-up routes give one fixed reply, the same for an email that has an
//     account and one that doesn't, and read nothing on the way (file 06, finding 96:
//     no lookup, no account made, nobody joined to a studio);
//   · Add a customer offers no "they'll sign up themselves" choice and no price page,
//     on Home, Customers and Contacts (finding 42);
//   · the orphan pages are gone and their addresses forward (findings 46 and 77), and
//     the partner set-up pack is retired (finding 47).
//
//   deno run --allow-read --allow-env tests/presence/no_self_signup_test.mjs
import { editorSource } from './editor_source.mjs';   // builder item 38: the editor is four files now
Deno.env.set('SUPABASE_URL', 'http://stub.local');
Deno.env.set('SERVICE_ROLE_KEY', 'SERVICE-KEY');
Deno.env.set('SUPABASE_ANON_KEY', 'ANON-KEY');
Deno.env.delete('STRIPE_SECRET');

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const exists = (p) => { try { Deno.statSync(new URL(p, ROOT)); return true; } catch { return false; } };
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

// every outside call is recorded: the closed routes must make none
const calls = [];
globalThis.fetch = async (url) => { calls.push(String(url)); return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }); };

const { handleCommerce, isPublicCommerceRoute } = await import('../../supabase/functions/presence/routes/commerce.ts');
const cors = { 'Access-Control-Allow-Origin': '*' };
const stranger = { kind: 'public', userId: null, tenantId: null, role: null, email: null, jwt: null, requestId: 'test' };
async function ask(method, route, body) {
  const req = new Request(`http://stub.local/functions/v1/presence${route}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const r = await handleCommerce(req, route.split('?')[0], method, stranger, cors);
  return { status: r.status, text: await r.text() };
}

// ═══ 1. the sign-up routes: one fixed reply, nothing read ═══
{
  calls.length = 0;
  const known = await ask('POST', '/commerce/signup', { email: 'owner@harbor.example', password: 'a-long-password-1', business_name: 'Harbor Lane', plan: 'presence', trial: true });
  const unknown = await ask('POST', '/commerce/signup', { email: 'nobody-yet@example.com', password: 'another-password-2', business_name: 'New Co', plan: 'presence_monitor', term: 'monthly' });
  const garbage = await ask('POST', '/commerce/signup', 'not even an object');
  ok('signup: 410 with error signup_closed and plain words', known.status === 410 && JSON.parse(known.text).error === 'signup_closed' && /Ask them to invite you\./.test(JSON.parse(known.text).message), known.text);
  ok('signup: the same reply whether or not the email has an account', known.status === unknown.status && known.text === unknown.text, `${known.text} | ${unknown.text}`);
  ok('signup: the same reply for a body that is not a sign-up at all', garbage.status === known.status && garbage.text === known.text);
  ok('signup: nothing is read or written on the way (no email lookup, no account, no join)', calls.length === 0, calls.join(', '));
  calls.length = 0;
  const verify = await ask('POST', '/commerce/verify', { token: 'anything' });
  const status = await ask('GET', '/commerce/checkout-status?session_id=cs_test_1');
  ok('verify and checkout-status (the old welcome page\'s two calls) give the same reply', verify.status === 410 && status.status === 410 && verify.text === known.text && status.text === known.text);
  ok('…and read nothing either', calls.length === 0, calls.join(', '));
  ok('the three stay public, so a stray client scope gets the same reply', ['signup', 'verify'].every((r) => isPublicCommerceRoute(`/commerce/${r}`, 'POST')) && isPublicCommerceRoute('/commerce/checkout-status', 'GET'));
  calls.length = 0;
  const plans = await ask('GET', '/commerce/plans');
  ok('the price list still answers (the deploy smoke test reads it)', plans.status === 200 && /"plans"/.test(plans.text));
}

// ═══ 2. the code that joined an unproved email to a studio is gone ═══
{
  const commerce = read('supabase/functions/presence/routes/commerce.ts');
  const stripe = read('supabase/functions/presence/commerce/stripe.ts');
  const sales = read('supabase/functions/presence/routes/sales.ts');
  ok('no sign-up handler, account maker or auto-join is left in commerce', !/handleSignup|handleVerify|handleCheckoutStatus|autoConnectPreListedStudio|createAuthUser|bridgeCustomerToStudio/.test(commerce));
  ok('no plan checkout and no cancelled-checkout return to the old price page', !/createSubscriptionCheckout|'mode': 'subscription'|cancel_url|pricing\.html/.test(stripe));
  ok('Add a customer\'s "connect" (the CSV import) writes no sign-up marker any more', !/notes: mark \? CONNECT_INTENT_TAG/.test(sales) && !/\+ CONNECT_INTENT_TAG/.test(sales) && /export async function ensureConnectContact\(siteId: string, emailIn: string, name: string\)/.test(sales));
  ok('the connect reply says the person was saved to contacts, not that they will connect on sign-up', /Saved \$\{email\} to your contacts\. Set them up from Add a customer when you’re ready\./.test(sales) && !/when they sign up/i.test(sales.slice(sales.indexOf('export async function handleSalesAddCustomer'))));
}

// ═══ 3. Add a customer: no sign-up choice, link or price page (one box for Home, Customers and Contacts: customer-add.js, item 102) ═══
{
  const box = read('customer-add.js');
  const dlg = box.slice(box.indexOf("'<dialog id=\"custDlg\""), box.indexOf("'</dialog>'"));
  ok('the box has no sign-up wording, link or price page', dlg.length > 1000 && !/cu-signup|sign up themselves|pricing\.html/.test(dlg));
  // Eric (Nov 15), builder item 241: adding a customer saves them and nothing else, so there's no choice to make
  ok('the box saves the customer: no choice to set them up, and it says what saving does', !/type="radio"|<select/.test(dlg) && /Saves them to your customers\. No website is made and nobody is emailed\./.test(dlg));
  for (const p of ['agency.html', 'customers.html', 'contacts.html']) ok(`${p}: the page sends no one to the old price page`, !/pricing\.html/.test(read(p)));
  ok('saving sends who they are and their business, as connect with save; never a set-up', /var body = \{ mode: 'connect', save: true, name: name \|\| undefined, business_name: business_name \|\| undefined, email: email \|\| undefined, phone: phone \|\| undefined \};/.test(box) && !/mode: 'provision'/.test(box));   // sales item 150: a phone does instead of an email
}
{
  const c = read('customers.html');
  ok('customers.html: the CSV import no longer promises people "connect when they sign up"', !/connect when they sign up/.test(c) && /saved to your contacts/.test(c));
}

// ═══ 4. the orphan pages are gone and their addresses forward; the partner pack is retired ═══
{
  const redirects = read('_redirects');
  const fwd = (path, to) => new RegExp(`^${path.replace(/[.]/g, '\\.')}\\s+${to.replace(/[.]/g, '\\.').replace(/\//g, '\\/')}\\s+301!`, 'm').test(redirects);
  for (const f of ['signup.html', 'welcome.html', 'portal-workspace.html', 'dds-studio-manage-9k2p.html', 'provision.html']) ok(`${f} is gone`, !exists(f));
  ok('/signup (both spellings) forwards to the main site\'s contact page', fwd('/signup', 'https://davisdigitalstudio.com/contact') && fwd('/signup.html', 'https://davisdigitalstudio.com/contact'));
  ok('/welcome (both spellings) forwards to the client sign-in', fwd('/welcome', '/portal.html') && fwd('/welcome.html', '/portal.html'));
  ok('/portal-workspace (both spellings) forwards to the client sign-in', fwd('/portal-workspace', '/portal.html') && fwd('/portal-workspace.html', '/portal.html'));
  ok('/dds-studio-manage-9k2p (both spellings) forwards to the studio sign-in', fwd('/dds-studio-manage-9k2p', '/studio.html') && fwd('/dds-studio-manage-9k2p.html', '/studio.html'));
  ok('the partner pack still answers 404 (both spellings) and stays off the build list', /^\/provision\s+\/404\.html\s+404!/m.test(redirects) && /^\/provision\.html\s+\/404\.html\s+404!/m.test(redirects) && /provision\.html; do/.test(read('scripts/build-public.sh')));
  const headers = read('_headers');
  ok('_headers keeps no rules for the removed pages', !/^\/(welcome|provision|portal-workspace|dds-studio-manage-9k2p)/m.test(headers));
}

// ═══ 5. nothing else links the old price page for a plan ═══
{
  const presence = editorSource();
  const fn = presence.slice(presence.indexOf('const NOTICE_ACTION = {'), presence.indexOf('// Only alerts about this website or this account reach the website page.'));
  ok('the builder\'s plan card opens Settings → Your plan, never the old price page', !/pricing\.html/.test(fn) && (fn.match(/settings\.html#billing/g) || []).length >= 7);
  const life = read('supabase/functions/presence/commerce/lifecycle.ts');
  ok('the trial and win-back emails link Your plan on the app, not the old price page', !/pricing\.html/.test(life) && /const PLAN_URL = 'https:\/\/app\.davisdigitalstudio\.com\/settings\.html#billing';/.test(life));
  ok('Help\'s "Your plan" opens Settings (item 202 already moved it)', /<details id="a-billing">[\s\S]*?href="\/settings\.html#billing"/.test(read('help.html')));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ NO SELF SIGN-UP (item 199): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
Deno.exit(passed === results.length ? 0 : 1);
