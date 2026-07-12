// ── Web Push sender (RFC 8291 aes128gcm + RFC 8292 VAPID) — no external deps ──
// Implemented on Deno WebCrypto so nothing new is pulled into the deploy. The
// platform uses this to notify a signed-in owner even when the app is closed
// (a lead waiting, an approval, a payment). Gated on VAPID keys — absent = no-op.
//
// Keys (owner-set secrets):
//   VAPID_PUBLIC_KEY  — base64url of the raw 65-byte uncompressed P-256 point
//   VAPID_PRIVATE_KEY — base64url of the raw 32-byte private scalar d
//   VAPID_SUBJECT     — mailto: or https: contact (defaults to support@)

const b64urlToBytes = (s: string): Uint8Array => {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};
const bytesToB64url = (buf: ArrayBuffer | Uint8Array): string => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const concat = (...arrs: Uint8Array[]): Uint8Array => {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
};
// WebCrypto in Deno's lib types wants BufferSource; a generic Uint8Array<ArrayBufferLike>
// isn't assignable. This cast at each crypto boundary is safe (real ArrayBuffer backing).
const bs = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

export function pushConfigured(): boolean {
  return !!(Deno.env.get('VAPID_PUBLIC_KEY') && Deno.env.get('VAPID_PRIVATE_KEY'));
}

/** Reconstruct the VAPID private CryptoKey (for ES256 JWT signing) from the
 *  raw public point (x,y) + private scalar d. */
async function vapidSigningKey(): Promise<{ key: CryptoKey; pub: string }> {
  const pub = Deno.env.get('VAPID_PUBLIC_KEY')!;
  const d = Deno.env.get('VAPID_PRIVATE_KEY')!;
  const raw = b64urlToBytes(pub);              // 0x04 || x(32) || y(32)
  const x = bytesToB64url(raw.slice(1, 33));
  const y = bytesToB64url(raw.slice(33, 65));
  const jwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x, y, d, ext: true, key_ops: ['sign'] };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return { key, pub };
}

/** Build the VAPID Authorization header value for a given endpoint origin. */
async function vapidAuth(endpoint: string): Promise<string> {
  const { key, pub } = await vapidSigningKey();
  const origin = new URL(endpoint).origin;
  const enc = new TextEncoder();
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const sub = Deno.env.get('VAPID_SUBJECT') || 'mailto:support@davisdigitalstudio.com';
  const payload = bytesToB64url(enc.encode(JSON.stringify({ aud: origin, exp, sub })));
  const signingInput = `${header}.${payload}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bs(enc.encode(signingInput)));
  const jwt = `${signingInput}.${bytesToB64url(sig)}`;
  return `vapid t=${jwt}, k=${pub}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', bs(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: bs(salt), info: bs(info) }, key, length * 8);
  return new Uint8Array(bits);
}

/** Encrypt the payload for one subscription (RFC 8291 aes128gcm). */
async function encrypt(payload: Uint8Array, p256dh: Uint8Array, authSecret: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  // ephemeral server ECDH keypair
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey)); // 65 bytes
  const uaPublic = await crypto.subtle.importKey('raw', bs(p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhBits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublic }, asKeys.privateKey, 256));

  // IKM = HKDF(auth_secret, ecdh, "WebPush: info\0" || ua_public || as_public, 32)
  const keyInfo = concat(enc.encode('WebPush: info\0'), p256dh, asPublicRaw);
  const ikm = await hkdf(authSecret, ecdhBits, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', bs(cek), { name: 'AES-GCM' }, false, ['encrypt']);
  const plaintext = concat(payload, new Uint8Array([0x02])); // aes128gcm padding delimiter (last record)
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bs(nonce), tagLength: 128 }, aesKey, bs(plaintext)));

  // Header: salt(16) || rs(4, uint32 BE) || idlen(1=65) || keyid(as_public 65)
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw, ct);
}

export interface PushSub { endpoint: string; p256dh: string; auth: string }

/** Send one push. Returns the HTTP status (201/200 = ok; 404/410 = gone → prune). */
export async function sendPush(sub: PushSub, msg: { title?: string; body?: string; url?: string; tag?: string }): Promise<number> {
  if (!pushConfigured()) return 0;
  const payload = new TextEncoder().encode(JSON.stringify(msg));
  const body = await encrypt(payload, b64urlToBytes(sub.p256dh), b64urlToBytes(sub.auth));
  const auth = await vapidAuth(sub.endpoint);
  const r = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': '86400',
    },
    body: bs(body) as BodyInit,
  });
  return r.status;
}
