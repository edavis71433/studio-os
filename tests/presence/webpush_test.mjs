// ── Web Push structural test ─────────────────────────────────────────────────
// Can't deliver a real push from CI, but we CAN prove the crypto is well-formed:
// the VAPID JWT verifies against the public key, and the aes128gcm body has the
// correct RFC 8188 header structure. Catches gross implementation bugs.
//
//   deno run --allow-env tests/presence/webpush_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };

// deterministic test VAPID keypair (generated for this test only)
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const pubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const jwkPriv = await crypto.subtle.exportKey('jwk', kp.privateKey);
const b64url = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
Deno.env.set('VAPID_PUBLIC_KEY', b64url(pubRaw));
Deno.env.set('VAPID_PRIVATE_KEY', jwkPriv.d);
Deno.env.set('VAPID_SUBJECT', 'mailto:test@example.com');

const { sendPush, pushConfigured } = await import('../../supabase/functions/presence/lib/webpush.ts');

ok('pushConfigured() true when keys set', pushConfigured());

// A fake subscription with a valid P-256 receiver key so encrypt() runs the real path.
const rxKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const rxPub = new Uint8Array(await crypto.subtle.exportKey('raw', rxKeys.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));

// Intercept fetch to capture the request instead of hitting a push service.
let captured = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => { captured = { url, init }; return Promise.resolve(new Response('', { status: 201 })); };
try {
  const status = await sendPush(
    { endpoint: 'https://push.example.com/abc', p256dh: b64url(rxPub), auth: b64url(authSecret) },
    { title: 'Test', body: 'Hello', url: '/today.html' },
  );
  ok('sendPush returns the push service status', status === 201);
} finally { globalThis.fetch = realFetch; }

ok('request carries aes128gcm content-encoding', !!captured && captured.init.headers['Content-Encoding'] === 'aes128gcm');
ok('request carries a VAPID Authorization header', !!captured && /^vapid t=.+, k=.+/.test(captured.init.headers['Authorization']));

// Verify the VAPID JWT signs correctly against the public key.
{
  const auth = captured.init.headers['Authorization'];
  const jwt = auth.match(/t=([^,]+)/)[1];
  const [h, p, s] = jwt.split('.');
  const toBytes = (u) => { const pad = '='.repeat((4 - u.length % 4) % 4); const b = atob((u + pad).replace(/-/g, '+').replace(/_/g, '/')); const a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
  const verified = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, toBytes(s), new TextEncoder().encode(`${h}.${p}`),
  );
  ok('VAPID JWT signature verifies against the public key', verified);
  const payload = JSON.parse(new TextDecoder().decode(toBytes(p)));
  ok('VAPID JWT aud = push service origin', payload.aud === 'https://push.example.com');
  ok('VAPID JWT has exp + sub', typeof payload.exp === 'number' && payload.sub === 'mailto:test@example.com');
}

// aes128gcm body structure: salt(16) + rs(4) + idlen(1)=65 + as_public(65) + ciphertext
{
  const body = new Uint8Array(await new Response(captured.init.body).arrayBuffer());
  ok('encrypted body has the aes128gcm header (idlen=65)', body.length > 86 && body[20] === 65);
  const rs = new DataView(body.buffer).getUint32(16, false);
  ok('record size field is 4096', rs === 4096);
}

const passed = results.filter(Boolean).length;
console.log(`\n════ WEB PUSH STRUCTURE: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
