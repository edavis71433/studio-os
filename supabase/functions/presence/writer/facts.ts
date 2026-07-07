// ── The fact sheet (M9.5A) — ALL the truth the Writer may use ────────────────
// The Fact Law's positive half: everything the model is allowed to say comes
// from here — the client's own structured content, their voice profile, and
// the industry pack. If a fact isn't on this sheet, the Writer must ask or
// leave a placeholder; the guard enforces it either way.
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';

export interface FactSheet {
  business_name: string;
  tagline: string;
  description: string;
  story: string;
  service_area: string;
  phone: string;
  email: string;
  booking_url: string;
  ordering_url: string;
  address: string;             // one line, or ''
  hours_text: string;          // compact truthful summary, or ''
  offerings: Array<{ id: string; name: string; category: string; price_text: string; description: string; visible: boolean }>;
  faq_questions: string[];
  faqs_full: Array<{ id: string; question: string; answer: string; visible: boolean }>;   // M9.5B: the editor's before-text
  posts_full: Array<{ id: string; title: string; body_md: string; excerpt: string; shown: boolean }>;
  post_titles: string[];
  testimonial_count: number;
  voice: { tone_notes: string; preferred_vocabulary: string; never_claim: string };
}

const DAYS: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export async function buildFactSheet(site: SiteRow): Promise<FactSheet> {
  const [ident, loc, voice, offs, faqs, posts, tes] = await Promise.all([
    svc(`presence_identity?site_id=eq.${site.id}&select=business_name,tagline,description,story,service_area,phone,email,booking_url,ordering_url&limit=1`),
    svc(`presence_locations?site_id=eq.${site.id}&select=address_line1,city,region,postal_code,hours&limit=1`),
    // M9.5G: the Brand Profile is the ONE canonical voice source (presence_voice retired)
    svc(`presence_brand_profile?site_id=eq.${site.id}&select=voice_characteristics,personality,preferred_vocabulary,never_claims&limit=1`),
    svc(`presence_offerings?site_id=eq.${site.id}&deleted_at=is.null&select=id,name,category,price_text,description,is_visible&order=sort_order.asc&limit=100`),
    svc(`presence_faqs?site_id=eq.${site.id}&deleted_at=is.null&select=id,question,answer,is_visible&order=sort_order.asc&limit=30`),
    svc(`presence_posts?site_id=eq.${site.id}&deleted_at=is.null&select=id,title,body_md,excerpt,status&order=updated_at.desc&limit=10`),
    svc(`presence_testimonials?site_id=eq.${site.id}&deleted_at=is.null&select=id&limit=1`),
  ]);
  const i = ident.json?.[0] ?? {};
  const l = loc.json?.[0] ?? {};
  const v = voice.json?.[0] ?? {};
  const hours = Array.isArray(l.hours)
    ? l.hours.filter((d: { closed: boolean; intervals: unknown[] }) => !d.closed && (d.intervals || []).length)
        .map((d: { day: string; intervals: Array<{ open: string; close: string }> }) => `${DAYS[d.day] || d.day} ${d.intervals.map((x) => `${x.open}-${x.close}`).join(',')}`).join('; ')
    : '';
  return {
    business_name: i.business_name || '',
    tagline: i.tagline || '', description: i.description || '', story: i.story || '',
    service_area: i.service_area || '', phone: i.phone || '', email: i.email || '',
    booking_url: i.booking_url || '', ordering_url: i.ordering_url || '',
    address: [l.address_line1, l.city, l.region, l.postal_code].filter(Boolean).join(', '),
    hours_text: hours,
    offerings: (offs.json ?? []).map((o: Record<string, unknown>) => ({
      id: o.id, name: o.name, category: o.category, price_text: o.price_text || '',
      description: o.description || '', visible: o.is_visible !== false,
    })),
    faq_questions: (faqs.json ?? []).map((f: { question: string }) => f.question),
    faqs_full: (faqs.json ?? []).map((f: Record<string, unknown>) => ({
      id: f.id, question: f.question, answer: f.answer || '', visible: f.is_visible !== false,
    })) as FactSheet['faqs_full'],
    posts_full: (posts.json ?? []).map((p: Record<string, unknown>) => ({
      id: p.id, title: p.title, body_md: String(p.body_md || '').slice(0, 4000), excerpt: p.excerpt || '', shown: p.status === 'published',
    })) as FactSheet['posts_full'],
    post_titles: (posts.json ?? []).map((p: { title: string }) => p.title),
    testimonial_count: (tes.json ?? []).length,
    voice: {
      tone_notes: v.voice_characteristics || v.personality || '',
      preferred_vocabulary: v.preferred_vocabulary || '',
      never_claim: v.never_claims || '',
    },
  };
}
