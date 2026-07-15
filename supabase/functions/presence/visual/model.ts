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

/** One EDIT request (source image + instruction) → N images as raw bytes.
 *  Powers the background-removal quick action (G32). Model-agnostic; injectable. */
export type ImageEditModelFn = (req: {
  image: Uint8Array; mime: string; prompt: string; size: string; count: number; transparent?: boolean;
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

/** Map an image's real dimensions to the nearest edit-output size the provider
 *  supports (gpt-image-1 edits: square / landscape / portrait). Pure + exported
 *  so tests can pin the mapping. Returns { size, width, height }. */
export function editSizeFor(width?: number | null, height?: number | null): { size: string; width: number; height: number } {
  const w = Number(width) || 0, h = Number(height) || 0;
  if (w > 0 && h > 0) {
    const r = w / h;
    if (r >= 1.2) return { size: '1536x1024', width: 1536, height: 1024 };
    if (r <= 1 / 1.2) return { size: '1024x1536', width: 1024, height: 1536 };
  }
  return { size: '1024x1024', width: 1024, height: 1024 };
}

/** The configured image EDIT model (instruction-guided edits over a source image,
 *  with transparency support), or null when the environment has no key. Same
 *  honest gate as imageModel(): dark until VISUAL_MODEL_KEY is set — it never
 *  fabricates a result. The edits endpoint is derived from the configured
 *  generation URL (…/generations → …/edits) or set explicitly. */
export function imageEditModel(): ImageEditModelFn | null {
  const key = (Deno.env.get('VISUAL_MODEL_KEY') || '').trim();
  if (!key) return null;
  const genUrl = (Deno.env.get('VISUAL_MODEL_URL') || 'https://api.openai.com/v1/images/generations').trim();
  const url = (Deno.env.get('VISUAL_MODEL_EDIT_URL') || '').trim() ||
    (genUrl.endsWith('/generations') ? genUrl.replace(/\/generations$/, '/edits') : 'https://api.openai.com/v1/images/edits');
  const model = (Deno.env.get('VISUAL_MODEL_NAME') || 'gpt-image-1').trim();
  return async ({ image, mime, prompt, size, count, transparent }) => {
    try {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('n', String(Math.max(1, Math.min(4, count))));
      form.append('size', size);
      if (transparent) form.append('background', 'transparent');
      // gpt-image-* always answers base64 and rejects response_format; older
      // edit-capable models need it asked for explicitly.
      if (!model.startsWith('gpt-image')) form.append('response_format', 'b64_json');
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
      form.append('image', new Blob([image as unknown as BlobPart], { type: mime }), `source.${ext}`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },   // Content-Type set by FormData (multipart boundary)
        body: form,
        signal: AbortSignal.timeout(90000),
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
