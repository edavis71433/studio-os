// ── Connected Platform token encryption (L4.1) ──────────────────────────────
// Delegated provider tokens are encrypted at rest with AES-256-GCM before they
// ever touch the database. The key is an environment secret (CONNECTION_ENC_KEY,
// 32 bytes base64) held only by the edge function — the database stores only
// ciphertext + iv, never a usable token, and reads never return either to a
// client. If the key is absent the platform refuses to store a token rather than
// store it in the clear (fail closed).
const RAW = Deno.env.get('CONNECTION_ENC_KEY') || '';

export function encryptionConfigured(): boolean { return RAW.length >= 16; }

async function key(): Promise<CryptoKey> {
  // accept base64 or raw; hash to a stable 256-bit key so any sufficiently long
  // secret works, while a proper 32-byte base64 key is used verbatim in spirit.
  const bytes = new TextEncoder().encode(RAW);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface Sealed { ciphertext: string; iv: string; }

export async function seal(plaintext: string): Promise<Sealed | null> {
  if (!encryptionConfigured()) return null;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const k = await key();
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, new TextEncoder().encode(plaintext));
    return { ciphertext: b64(new Uint8Array(ct)), iv: b64(iv) };
  } catch { return null; }
}

export async function open(sealed: Sealed): Promise<string | null> {
  if (!encryptionConfigured() || !sealed?.ciphertext || !sealed?.iv) return null;
  try {
    const k = await key();
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(sealed.iv) }, k, unb64(sealed.ciphertext));
    return new TextDecoder().decode(pt);
  } catch { return null; }
}
