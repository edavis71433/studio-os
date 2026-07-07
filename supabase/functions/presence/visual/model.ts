// ── AI Visual Studio — the image-model caller ───────────────────────────────
// The ONLY generative call in the Studio. Gated exactly like the Writer's model
// (writer/model.ts): with no key configured it returns null, and the whole
// Studio honestly reports "not available on this environment yet" — it NEVER
// fabricates an image or fakes success. Injectable so the entire workflow tests
// without a live model. Never throws; a failure is a plain, recoverable result.
//
// Live activation is owner setup (a dashboard step, like Stripe in L1 and the
// connected write flag in L4.3): set VISUAL_MODEL_KEY (and optionally
// VISUAL_MODEL_URL / VISUAL_MODEL_NAME). Until then the capability is dark.

/** One generation request → N images as raw bytes. Model-agnostic. */
export type ImageModelFn = (req: {
  prompt: string; negative: string; width: number; height: number; count: number;
}) => Promise<{ ok: boolean; images: Uint8Array[]; model: string; error?: string }>;

const b64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** Whether live generation is switched on for this environment. */
export function visualConfigured(): boolean { return !!(Deno.env.get('VISUAL_MODEL_KEY') || '').trim(); }

/** The configured image model, or null when the environment has no key. The
 *  endpoint is documented and config-driven; the exact request shaping is a
 *  per-provider detail set at app registration (like the connected adapters). */
export function imageModel(): ImageModelFn | null {
  const key = (Deno.env.get('VISUAL_MODEL_KEY') || '').trim();
  if (!key) return null;
  const url = (Deno.env.get('VISUAL_MODEL_URL') || 'https://api.openai.com/v1/images/generations').trim();
  const model = (Deno.env.get('VISUAL_MODEL_NAME') || 'gpt-image-1').trim();
  return async ({ prompt, negative, width, height, count }) => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, prompt: `${prompt}\n\nAvoid: ${negative}`,
          n: Math.max(1, Math.min(4, count)),
          size: `${width}x${height}`,
          response_format: 'b64_json',
        }),
        signal: AbortSignal.timeout(60000),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok || j?.error) return { ok: false, images: [], model, error: String(j?.error?.message || `image_error_${res.status}`).slice(0, 200) };
      const rows = Array.isArray(j?.data) ? j.data : [];
      const images = rows.map((d: any) => (d?.b64_json ? b64ToBytes(d.b64_json) : null)).filter(Boolean) as Uint8Array[];
      return { ok: images.length > 0, images, model, error: images.length ? undefined : 'empty' };
    } catch (e) {
      return { ok: false, images: [], model, error: (e as Error)?.message?.slice(0, 200) || 'fetch_failed' };
    }
  };
}
