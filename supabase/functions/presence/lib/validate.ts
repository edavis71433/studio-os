// Identity validation — the structural subset of G1 §1 enforced at the write
// boundary (maxima, formats, closed field set). No custom fields: unknown keys
// are rejected, never stored. Control chars stripped except \n (the portal NUL
// lesson). Returns a cleaned object of ONLY provided, valid fields.

type Rule = { max: number; email?: boolean; url?: boolean; social?: boolean };
const IDENTITY_FIELDS: Record<string, Rule> = {
  business_name:   { max: 120 },
  description:     { max: 600 },
  phone:           { max: 40 },
  email:           { max: 254, email: true },
  tagline:         { max: 140 },
  story:           { max: 2500 },
  service_area:    { max: 200 },
  booking_url:     { max: 500, url: true },
  ordering_url:    { max: 500, url: true },
  seo_title:       { max: 60 },
  seo_description: { max: 160 },
  social:          { max: 0, social: true },
};
const SOCIAL_KEYS = new Set(['instagram', 'facebook', 'linkedin', 'x', 'youtube', 'tiktok', 'yelp', 'google_maps']);

function clean(s: string): string {
  // strip control chars except \n; NFC normalize; trim
  let out = '';
  for (const ch of String(s)) { const c = ch.codePointAt(0)!; if (c === 10 || c >= 32) out += ch; }
  return out.normalize('NFC').trim();
}

export function validateIdentity(payload: any): { ok: boolean; errors: { field: string; message: string }[]; clean: Record<string, any>; fields: string[] } {
  const errors: { field: string; message: string }[] = [];
  const result: Record<string, any> = {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, errors: [{ field: '_', message: 'Expected a JSON object of identity fields.' }], clean: {}, fields: [] };
  }
  for (const key of Object.keys(payload)) {
    if (!(key in IDENTITY_FIELDS)) {
      errors.push({ field: key, message: `Unknown field. Presence has a fixed set of business facts; custom fields aren't allowed.` });
      continue;
    }
    const rule = IDENTITY_FIELDS[key];
    const v = payload[key];
    if (rule.social) {
      if (v == null) { result.social = {}; continue; }
      if (typeof v !== 'object' || Array.isArray(v)) { errors.push({ field: 'social', message: 'Social must be an object of platform links.' }); continue; }
      const soc: Record<string, string> = {};
      let bad = false;
      for (const sk of Object.keys(v)) {
        if (!SOCIAL_KEYS.has(sk)) { errors.push({ field: `social.${sk}`, message: 'Unsupported social platform.' }); bad = true; continue; }
        const sv = clean(String(v[sk] ?? ''));
        if (sv && !/^https:\/\//i.test(sv)) { errors.push({ field: `social.${sk}`, message: 'Must be an https link.' }); bad = true; continue; }
        if (sv.length > 500) { errors.push({ field: `social.${sk}`, message: 'Link is too long (max 500).' }); bad = true; continue; }
        if (sv) soc[sk] = sv;
      }
      if (!bad) result.social = soc;
      continue;
    }
    const s = clean(String(v ?? ''));
    if (s.length > rule.max) { errors.push({ field: key, message: `Too long (max ${rule.max}).` }); continue; }
    if (rule.email && s && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) { errors.push({ field: key, message: 'Doesn’t look like an email address.' }); continue; }
    if (rule.url && s && !/^https:\/\//i.test(s)) { errors.push({ field: key, message: 'Must be an https link.' }); continue; }
    result[key] = s;
  }
  return { ok: errors.length === 0, errors, clean: result, fields: Object.keys(result) };
}
