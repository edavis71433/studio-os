// ── Cut out the subject (builder items 39 + 117) ─────────────────────────────
// The photo editor's "Cut out the subject": one call to an open background-removal
// model on Replicate, 851-labs/background-remover (the MIT `transparent-background`
// library), pinned by version so the model can't change under us. Replicate fetches
// the photo itself from a short-lived signed link and answers with a link to a PNG
// whose background is see-through. Its API removes inputs, outputs and logs after an
// hour (replicate.com/docs/topics/predictions/data-retention), and its terms only
// let it use them to give the answer. Eric picked Replicate on Nov 9 2026 over
// Pixian, whose terms let it train its models on uploads with no opt-out.
//
// A model nobody has used for a while takes a minute or two to start. The first
// request waits up to WAIT_SECONDS; past that the page gets a job token and asks
// again (GET /assets/cutout/:job). The token is an HMAC over the site and the
// prediction id, so one site can never read another's. No REPLICATE_API_TOKEN →
// cutoutConfigured() is false, the editor shows no button, nothing is faked.

export const CUTOUT_MODEL = '851-labs/background-remover';
export const CUTOUT_VERSION = 'a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc';
export const CUTOUT_MAX_SIDE = 3000;          // the long side the model is sent (and the editor gets back)
export const CUTOUT_MAX_BYTES = 40 * 1024 * 1024;
const API = 'https://api.replicate.com/v1';
const WAIT_SECONDS = 50;                      // Replicate holds a request open up to 60 s

export function cutoutConfigured(): boolean { return !!(Deno.env.get('REPLICATE_API_TOKEN') || '').trim(); }
const token = () => (Deno.env.get('REPLICATE_API_TOKEN') || '').trim();

export type CutoutState =
  | { state: 'done'; output: string }
  | { state: 'waiting'; id: string }
  | { state: 'failed'; why: string };

/** Only Replicate's own delivery host is ever fetched as a result, so an answer
 *  can't point the server at anything else. Pure. */
export function isDeliveryUrl(u: unknown): boolean {
  try {
    const url = new URL(String(u));
    return url.protocol === 'https:' && (url.hostname === 'replicate.delivery' || url.hostname.endsWith('.replicate.delivery'));
  } catch { return false; }
}

/** Replicate's prediction → done (with the PNG's link), still going, or failed. Pure. */
export function readPrediction(p: unknown): CutoutState {
  const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
  const status = String(o.status || '');
  if (status === 'succeeded') {
    const out = Array.isArray(o.output) ? o.output.find((x) => typeof x === 'string') : o.output;
    return isDeliveryUrl(out) ? { state: 'done', output: String(out) } : { state: 'failed', why: 'an answer with no picture from replicate.delivery' };
  }
  if ((status === 'starting' || status === 'processing') && /^[a-z0-9]{10,64}$/.test(String(o.id || ''))) return { state: 'waiting', id: String(o.id) };
  return { state: 'failed', why: status ? `${status}: ${String(o.error || '').slice(0, 200)}` : 'no prediction' };
}

/** Start one cut-out of the photo at `imageUrl`, waiting up to WAIT_SECONDS. */
export async function startCutout(imageUrl: string, fetchImpl: typeof fetch = fetch): Promise<CutoutState> {
  try {
    const r = await fetchImpl(`${API}/predictions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json', Prefer: `wait=${WAIT_SECONDS}` },
      body: JSON.stringify({ version: CUTOUT_VERSION, input: { image: imageUrl } }),
      signal: AbortSignal.timeout((WAIT_SECONDS + 15) * 1000),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { state: 'failed', why: `HTTP ${r.status} ${String((j as Record<string, unknown> | null)?.detail || '').slice(0, 200)}` };
    return readPrediction(j);
  } catch (e) { return { state: 'failed', why: String(e).slice(0, 200) }; }
}

/** Ask after a cut-out that was still starting. */
export async function checkCutout(id: string, fetchImpl: typeof fetch = fetch): Promise<CutoutState> {
  if (!/^[a-z0-9]{10,64}$/.test(id)) return { state: 'failed', why: 'a malformed prediction id' };
  try {
    const r = await fetchImpl(`${API}/predictions/${id}`, { headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(20000) });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { state: 'failed', why: `HTTP ${r.status}` };
    return readPrediction(j);
  } catch (e) { return { state: 'failed', why: String(e).slice(0, 200) }; }
}

// ── the job token: "<prediction id>.<HMAC over site + id>" ──
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function mac(siteId: string, id: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`cutout-job:${token()}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${siteId}|${id}`))).slice(0, 32);
}
export async function jobFor(siteId: string, id: string): Promise<string> { return `${id}.${await mac(siteId, id)}`; }
/** The prediction id a job token names, or null when it wasn't made for this site. */
export async function idFromJob(siteId: string, job: string): Promise<string | null> {
  const m = /^([a-z0-9]{10,64})\.([A-Za-z0-9_-]{32})$/.exec(String(job || ''));
  if (!m) return null;
  const want = await mac(siteId, m[1]);
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0 ? m[1] : null;
}

/** A PNG starts with these eight bytes. Pure. */
export function isPng(b: Uint8Array): boolean {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  return b.byteLength > 8 && sig.every((v, i) => b[i] === v);
}
