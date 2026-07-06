// ── Publish validation: snapshot vs manifest (M3.75 §1.1 taxonomy) ──────────
// BLOCKERS refuse the publish with plain-language, field-anchored errors.
// WARNINGS ride along in the publish confirmation. Render never sees an
// invalid snapshot: this runs first, always.
import { normalizeSnapshotContent } from './render_types.ts';
import type { Snapshot, TemplateManifest } from './render_types.ts';

export interface ValidationResult {
  ok: boolean;
  blockers: Array<{ field: string; message: string }>;
  warnings: Array<{ field: string; message: string }>;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const TIME_RE = /^([01]\d|2[0-4]):[0-5]\d$/;

export function validateSnapshot(snapshot: Snapshot, manifest: TemplateManifest): ValidationResult {
  const b: ValidationResult['blockers'] = [];
  const w: ValidationResult['warnings'] = [];
  const c = normalizeSnapshotContent(snapshot.content);
  const i = c.identity;

  // identity
  if (!i?.business_name?.trim()) b.push({ field: 'identity.business_name', message: 'Your business name is required before publishing.' });
  if (!i?.description?.trim()) b.push({ field: 'identity.description', message: 'A short description is required — it becomes your About section.' });
  if (!i?.phone?.trim() && !i?.email?.trim()) b.push({ field: 'identity.phone', message: 'Add a phone number or an email so customers can reach you.' });
  if (!i?.seo_title?.trim() || !i?.seo_description?.trim()) w.push({ field: 'identity.seo_title', message: 'Search title/description are empty — using your name and description instead.' });
  if (!i?.booking_url?.trim()) w.push({ field: 'identity.booking_url', message: 'No reservation link — the site will point people to your menu instead.' });

  // locations + hours (a LIST by contract; v1 requires exactly one)
  const locMax = manifest.entities['locations']?.max ?? 1;
  if ((c.locations?.length ?? 0) > locMax) b.push({ field: 'locations', message: `This template supports up to ${locMax} location${locMax > 1 ? 's' : ''}.` });
  const l = c.locations?.[0] ?? null;
  if (!l) b.push({ field: 'location', message: 'Your address and hours are required before publishing.' });
  else {
    for (const [f, label] of [['address_line1', 'street address'], ['city', 'city'], ['region', 'state'], ['postal_code', 'ZIP code'], ['timezone', 'timezone']] as const) {
      if (!(l as any)[f]?.trim?.()) b.push({ field: `location.${f}`, message: `Your ${label} is required before publishing.` });
    }
    const days = Array.isArray(l.hours) ? l.hours : [];
    const seen = new Set(days.map((d) => d.day));
    const need = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    if (days.length !== 7 || !need.every((d) => seen.has(d))) {
      b.push({ field: 'location.hours', message: 'Hours must cover all seven days (mark days you’re closed as closed).' });
    } else {
      for (const d of days) {
        if (d.closed) continue;
        if (!d.intervals?.length) { b.push({ field: `location.hours.${d.day}`, message: `${d.day}: add opening hours or mark the day closed.` }); continue; }
        if (d.intervals.length > 3) b.push({ field: `location.hours.${d.day}`, message: `${d.day}: at most 3 time ranges per day.` });
        for (const iv of d.intervals) {
          if (!TIME_RE.test(iv.open) || !TIME_RE.test(iv.close)) b.push({ field: `location.hours.${d.day}`, message: `${d.day}: times must be HH:MM (24-hour).` });
        }
      }
      if (days.every((d) => d.closed)) w.push({ field: 'location.hours', message: 'Every day is marked closed — publishing a site that says you’re never open.' });
    }
    if ((l.holiday_exceptions?.length ?? 0) > 40) b.push({ field: 'location.holiday_exceptions', message: 'At most 40 holiday exceptions.' });
  }

  // collections vs caps
  const caps = manifest.entities;
  const capCheck = (name: string, len: number) => {
    const max = caps[name]?.max;
    if (max && len > max) b.push({ field: name, message: `Too many ${name} (${len}) — this template supports up to ${max}.` });
  };
  capCheck('offerings', c.offerings?.length ?? 0);
  capCheck('testimonials', c.testimonials?.length ?? 0);
  capCheck('faqs', c.faqs?.length ?? 0);
  capCheck('posts', c.posts?.length ?? 0);

  for (const o of c.offerings ?? []) {
    if (!o.name?.trim() || !o.category?.trim()) b.push({ field: `offerings.${o.id}`, message: 'Every menu item needs a name and a category.' });
  }
  if ((c.offerings?.length ?? 0) === 0) w.push({ field: 'offerings', message: 'Your menu is empty — the menu page will say it’s being updated.' });
  if ((c.faqs?.length ?? 0) === 0) w.push({ field: 'faqs', message: 'No FAQs yet — they help customers and search engines alike.' });

  const slugs = new Set<string>();
  for (const p of c.posts ?? []) {
    if (!p.title?.trim() || !p.body_md?.trim()) b.push({ field: `posts.${p.id}`, message: 'Published posts need a title and body.' });
    if (!SLUG_RE.test(p.slug ?? '')) b.push({ field: `posts.${p.id}`, message: `Post link “${p.slug}” isn’t valid — lowercase letters, numbers, and dashes only.` });
    if (slugs.has(p.slug)) b.push({ field: `posts.${p.id}`, message: `Two posts share the link “${p.slug}”.` });
    slugs.add(p.slug);
  }

  // redirects: format + single-hop, loop-free (cross-row rules live here)
  const froms = new Set((c.redirects ?? []).map((r) => r.from_path));
  if ((c.redirects?.length ?? 0) > 500) b.push({ field: 'redirects', message: 'At most 500 redirects.' });
  for (const r of c.redirects ?? []) {
    if (!r.from_path?.startsWith('/') || r.from_path.includes('://') || r.from_path.includes('?')) b.push({ field: 'redirects', message: `Redirect source “${r.from_path}” must be a site path like /old-page.` });
    if (!(r.to_path?.startsWith('/') || /^https:\/\//.test(r.to_path ?? ''))) b.push({ field: 'redirects', message: `Redirect target “${r.to_path}” must be a site path or an https link.` });
    if (r.to_path === r.from_path) b.push({ field: 'redirects', message: `Redirect “${r.from_path}” points at itself.` });
    if (r.to_path?.startsWith('/') && froms.has(r.to_path)) b.push({ field: 'redirects', message: `Redirect “${r.from_path}” chains into another redirect (“${r.to_path}”) — point it at the final destination.` });
  }

  // contract/template compatibility
  if (snapshot.content_contract_version !== manifest.content_contract_version) {
    b.push({ field: 'snapshot', message: 'This site’s template needs an upgrade before publishing (content version mismatch).' });
  }

  return { ok: b.length === 0, blockers: b, warnings: w };
}
