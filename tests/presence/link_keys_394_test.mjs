// ── Builder item 394: every kind of signed link has a key of its own ───────────
//   deno run --allow-read --allow-env --allow-net tests/presence/link_keys_394_test.mjs
// Links for proposals, agreements and estimates, shared drafts, approvals, bookings, form
// tickets and Join our list could all fall back to the scheduler's secret (in plain text in
// the job list until Nov 9), and every unsubscribe link was signed with the database key
// itself (Nov 22 2026 review, file 07 finding 9). _shared/link_keys.ts now gives each kind
// a key derived from one root. Every date here is pinned (nowMs is passed in).
//   1  the derivation: a SHA-256 and HMAC written out, checked against WebCrypto
//   2  the root: LINK_SECRET, then APPROVAL_SECRET, then the database key; never the scheduler's
//   3  kinds can't sign each other's links, and no key is a root itself
//   4  old links: open until Feb 21 2027 (the scheduler-signed kind included), then no more;
//      emailed links signed with the database key keep opening while that key is the same
//   5  each real signer and reader round-trips with the server's own key
//   6  tripwire: no link signer reads the scheduler's secret
const results = [];
const ok = (n, p, note = '') => { results.push(!!p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const hex = (b) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const BEFORE = Date.parse('2026-12-01T12:00:00Z'), AFTER = Date.parse('2027-02-22T12:00:00Z');

const clear = () => { for (const k of ['LINK_SECRET', 'APPROVAL_SECRET', 'PREVIEW_LINK_SECRET', 'STATE_SIGNING_SECRET', 'SCHEDULER_SECRET', 'SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) Deno.env.delete(k); };
clear();
Deno.env.set('SUPABASE_URL', 'https://db.test');
const L = await import('../../supabase/functions/_shared/link_keys.ts');

// ═══ 1. the derivation ═══
{
  let bad = 0, n = 0;
  for (const len of [0, 1, 55, 56, 64, 65, 300]) for (const kl of [1, 32, 64, 65, 150]) {
    const m = crypto.getRandomValues(new Uint8Array(len)), k = crypto.getRandomValues(new Uint8Array(kl));
    const key = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    n += 2;
    if (hex(L.sha256(m)) !== hex(await crypto.subtle.digest('SHA-256', m))) bad++;
    if (hex(L.hmacSha256(k, m)) !== hex(await crypto.subtle.sign('HMAC', key, m))) bad++;
  }
  ok(`SHA-256 and HMAC agree with WebCrypto (${n} cases)`, bad === 0, `${bad} differ`);
  ok('a key is 64 hex characters', /^[0-9a-f]{64}$/.test(L.deriveLinkKey('root', 'sales')));
}

// ═══ 2. the root ═══
{
  clear(); Deno.env.set('SCHEDULER_SECRET', 'sched'); Deno.env.set('SERVICE_ROLE_KEY', 'db-key');
  ok('only the scheduler\'s secret and the database key: the database key is the root, never the scheduler\'s', JSON.stringify(L.linkRoots()) === '["db-key"]' && L.linkKey('sales') === L.deriveLinkKey('db-key', 'sales'));
  Deno.env.set('APPROVAL_SECRET', 'approval');
  ok('APPROVAL_SECRET set: it is the root', L.linkRoots()[0] === 'approval' && L.linkKey('booking') === L.deriveLinkKey('approval', 'booking'));
  Deno.env.set('LINK_SECRET', 'link-root');
  ok('LINK_SECRET set: it comes first', JSON.stringify(L.linkRoots()) === '["link-root","approval","db-key"]');
  Deno.env.set('PREVIEW_LINK_SECRET', 'preview-own');
  ok('a kind with a secret of its own uses it (shared drafts and PREVIEW_LINK_SECRET)', L.linkKey('preview') === 'preview-own');
  clear();
  ok('no secret at all: no key, so nothing is signed', L.linkKey('sales') === '' && L.linkKeysAccepted('sales', BEFORE).length === 0);
}

// ═══ 3. kinds apart ═══
{
  clear(); Deno.env.set('APPROVAL_SECRET', 'approval'); Deno.env.set('SERVICE_ROLE_KEY', 'db-key');
  const KINDS = ['sales', 'retainer_card', 'preview', 'approval', 'booking', 'form_ticket', 'spam_link', 'join', 'email_unsubscribe', 'email_open', 'email_image', 'address_hash', 'ip_hash'];
  const keys = KINDS.map((k) => L.linkKey(k));
  ok('every kind has its own key', new Set(keys).size === KINDS.length);
  ok('no key is a root itself (a key that leaked gives no root away)', keys.every((k) => !['approval', 'db-key'].includes(k)));
  const { signSalesToken, verifySalesToken } = await import('../../supabase/functions/presence/routes/sales.ts');
  const p = { t: 'proposal', id: '11111111-1111-4111-8111-111111111111', site_id: '22222222-2222-4222-8222-222222222222', exp: 2_000_000_000 };
  const forged = await signSalesToken(p, L.linkKey('preview'));
  ok('a link signed with another kind\'s key doesn\'t open (a draft link\'s key can\'t sign a proposal)', (await verifySalesToken(forged, L.linkKey('sales'), 1_800_000_000)) === null);
}

// ═══ 4. old links ═══
{
  clear(); Deno.env.set('SCHEDULER_SECRET', 'sched'); Deno.env.set('SERVICE_ROLE_KEY', 'db-key');
  ok('a card link signed the old way (the scheduler\'s secret, when nothing else was set) opens before Feb 21 2027', L.linkKeysAccepted('retainer_card', BEFORE).includes('sched'));
  ok('…and not after (every such link has expired by then anyway)', !L.linkKeysAccepted('retainer_card', AFTER).includes('sched') && L.linkKeysAccepted('retainer_card', AFTER).length > 0);
  ok('a link that never expires (a receipt or a signed agreement, a booking\'s change-or-cancel) keeps its old key after Feb 21 2027', L.linkKeysAccepted('sales', AFTER).includes('sched') && L.linkKeysAccepted('booking', AFTER).includes('sched'));
  const check = (key) => async (k) => k === key;
  ok('signedWithAny follows the same dates', (await L.signedWithAny('form_ticket', L.linkKey('form_ticket'), check('sched'), BEFORE)) && !(await L.signedWithAny('form_ticket', L.linkKey('form_ticket'), check('sched'), AFTER)));
  ok('a key the caller brings (a test\'s own) is tried alone, never widened', !(await L.signedWithAny('form_ticket', 'some-other-key', check('sched'), BEFORE)) && await L.signedWithAny('form_ticket', 'some-other-key', check('some-other-key'), BEFORE));
  ok('emailed links signed with the database key keep opening while that key is the same', L.linkKeysAccepted('email_unsubscribe', AFTER).includes('db-key') && L.linkKeysAccepted('email_image', AFTER).includes('db-key'));
  ok('…and hashes have no old key to keep (they are not links)', L.linkKeysAccepted('address_hash', BEFORE).every((k) => k !== 'sched' && k !== 'db-key'));
  Deno.env.set('APPROVAL_SECRET', 'approval');
  const signedFromApproval = L.deriveLinkKey('approval', 'join');
  Deno.env.set('LINK_SECRET', 'later');
  ok('setting LINK_SECRET later breaks no link: one signed from the earlier root still opens, any day', L.linkKey('join') !== signedFromApproval && L.linkKeysAccepted('join', AFTER).includes(signedFromApproval));
  Deno.env.delete('LINK_SECRET'); Deno.env.delete('APPROVAL_SECRET');
}

// ═══ 5. the real signers, with the server's own key ═══
{
  clear(); Deno.env.set('SCHEDULER_SECRET', 'sched'); Deno.env.set('SERVICE_ROLE_KEY', 'db-key');
  const { hmacHex } = await import('../../supabase/functions/_shared/hmac.ts');
  const NOW = 1_800_000_000;
  const S = await import('../../supabase/functions/presence/routes/sales.ts');
  const p = { t: 'flow', id: '11111111-1111-4111-8111-111111111111', site_id: '22222222-2222-4222-8222-222222222222', exp: NOW + 86400 };
  const tok = await S.signSalesToken(p, S.linkSecret());
  ok('sales: a link signed today opens', (await S.verifySalesToken(tok, S.linkSecret(), NOW))?.id === p.id && S.linkSecret() !== 'sched');
  const body = tok.split('.')[0];
  const old = `${body}.${await hmacHex('sched', body)}`;
  const oldSig = old.split('.')[1];
  ok('sales: a link signed with the scheduler\'s secret before this change still opens, before and after Feb 21 2027 (receipts are kept for good)', (await L.signedWithAny('sales', S.linkSecret(), async (k) => (await hmacHex(k, body)) === oldSig, BEFORE)) && (await L.signedWithAny('sales', S.linkSecret(), async (k) => (await hmacHex(k, body)) === oldSig, AFTER)));
  const F = await import('../../supabase/functions/presence/lib/form_check.ts');
  const site = '33333333-3333-4333-8333-333333333333';
  const ticket = await F.issueTicket(site, NOW);
  ok('form tickets: issued and read with their own key', (await F.readTicket(ticket, site, NOW + 10)) === 'ok' && F.ticketsOn());
  const spam = await F.spamLinkToken(site, '44444444-4444-4444-8444-444444444444', NOW);
  ok('"This was spam" links: their own key, apart from the ticket\'s', (await F.readSpamLinkToken(spam, NOW))?.siteId === site && (await F.readSpamLinkToken(spam, NOW, L.linkKey('form_ticket'))) === null);
  const B = await import('../../supabase/functions/presence/lib/booking_links.ts');
  const appt = '55555555-5555-4555-8555-555555555555';
  ok('booking links: made and read', (await B.readManageToken(await B.manageToken(appt))) === appt);
  const J = await import('../../supabase/functions/presence/lib/join_confirm.ts');
  ok('Join our list links: made and read', (await J.readJoinLinkToken(await J.joinLinkToken(site, 'pat@example.com', '/', NOW), NOW))?.email === 'pat@example.com');
  const P = await import('../../supabase/functions/presence/lib/preview_link.ts');
  const pt = await P.signPreviewToken({ site_id: site, exp: NOW + 60, scope: 'preview' }, P.previewLinkSecret());
  ok('shared draft links: made and read', (await P.verifyPreviewToken(pt, P.previewLinkSecret(), NOW)).ok === true);
  const C = await import('../../supabase/functions/presence/lib/commercial.ts');
  const at = await C.signApprovalToken({ site_id: site, kind: 'connected', plan_id: 'p1', exp: NOW + 60 }, L.linkKey('approval'));
  ok('one-tap approvals: made and read', (await C.verifyApprovalToken(at, L.linkKey('approval'), NOW)).ok === true);
  const R = await import('../../supabase/functions/presence/routes/retainer_card.ts');
  const ct = await R.signCardToken('66666666-6666-4666-8666-666666666666', site, NOW, R.cardLinkSecret());
  ok('the retainer card link: made and read', (await R.readCardToken(ct, R.cardLinkSecret(), NOW))?.ok === true);
  const E = await import('../../supabase/functions/_shared/email_infra.ts');
  const t = await E.unsubscribeToken('Pat@Example.com');
  const oldKey = await crypto.subtle.importKey('raw', new TextEncoder().encode('db-key'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const oldTok = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', oldKey, new TextEncoder().encode('unsub:pat@example.com'))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 32);
  ok('unsubscribe: a new link has its own key, and one in an older email still works', t !== oldTok && await E.unsubscribeTokenOk('pat@example.com', t) && await E.unsubscribeTokenOk('PAT@example.com', oldTok) && !(await E.unsubscribeTokenOk('pat@example.com', 'x'.repeat(32))));
  const media = '77777777-7777-4777-8777-777777777777';
  ok('photos and open counters in emails: their own keys, checked the same way', await E.imageTokenOk(media, await E.imageToken(media)) && await E.openTokenOk(media, await E.openToken(media)) && (await E.imageToken(media)) !== (await E.openToken(media)));
}

// ═══ 6. tripwire ═══
{
  const root = new URL('../../supabase/functions/presence/', import.meta.url);
  // the places that may still read the scheduler's secret, none of them a link: its own check of
  // the jobs (routes/system.ts), the billing echo's older fall-back (routes/commerce.ts), and the
  // two-step code store (lib/fresh_code.ts, next in the follow-up once its open pull request lands)
  const ALLOWED = new Set(['routes/system.ts', 'routes/commerce.ts', 'lib/fresh_code.ts']);
  const readers = [];
  const walk = (dir) => { for (const e of Deno.readDirSync(dir)) { const p = new URL(e.name + (e.isDirectory ? '/' : ''), dir); if (e.isDirectory) walk(p); else if (e.name.endsWith('.ts') && /Deno\.env\.get\(\s*'SCHEDULER_SECRET'\s*\)/.test(Deno.readTextFileSync(p))) readers.push(p.pathname.replace(/^.*\/presence\//, '')); } };
  walk(root);
  const extra = readers.filter((f) => !ALLOWED.has(f));
  ok('no link signer in the main server reads the scheduler\'s secret', extra.length === 0, extra.join(', '));
}

const passed = results.filter(Boolean).length;
console.log(`\n════ LINK KEYS, ITEM 394: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
