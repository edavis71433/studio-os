// ── The twelve optimization providers (M10) ─────────────────────────────────
// Pure functions, same Provider interface as M9.0: (input, emit) → measured
// observations. No I/O, no clock, no interpretation, no scores, no customer
// language beyond the catalog's observation sentences. Each stands alone —
// the registry runner already guarantees a throwing provider contributes
// nothing and poisons nothing. When a probe wasn't possible (input.opt fields
// null), a provider observes NOTHING rather than guessing — absence of
// evidence is recorded honestly by the run's provider record.
import type { ObservationInput } from '../evidence/collect.ts';
import type { Provider } from '../evidence/providers.ts';
import { normName, normPrice, digitsOnly } from './knowledge.ts';

const all = (html: string, re: RegExp) => [...html.matchAll(re)];
const bodyText = (h: string) => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const daysBetween = (a: string, b: string) => Math.floor((new Date(a).getTime() - new Date(b).getTime()) / 86400000);

export const OPTIMIZATION_PROVIDERS: Provider[] = [

  { name: 'infrastructure', provide(i, emit) {
    const o = i.opt; if (!o?.domain) return;
    if (o.dns) {
      if (!o.dns.apex) emit('infrastructure.dns_apex_unresolved', 'dns', o.domain, { domain: o.domain, status: 'NXDOMAIN/empty' });
      if (!o.dns.www) emit('infrastructure.dns_www_unresolved', 'dns', `www.${o.domain}`, { domain: o.domain });
    }
    if (o.domainExpires) {
      const days = daysBetween(o.domainExpires, i.now);
      if (days >= 0 && days <= 45) emit('infrastructure.domain_expiring', 'rdap', o.domain, { domain: o.domain, expires: o.domainExpires, days });
    }
    if (o.httpProbe) {
      if (!o.httpProbe.redirectsToHttps && o.httpProbe.status > 0 && o.httpProbe.status < 500) {
        emit('infrastructure.http_not_redirected', 'probe', o.domain, { domain: o.domain, status: o.httpProbe.status });
      }
      if (o.httpProbe.hops >= 3) emit('infrastructure.redirect_chain', 'probe', o.domain, { from: `http://${o.domain}/`, hops: o.httpProbe.hops });
    }
  } },

  { name: 'email_auth', provide(i, emit) {
    const o = i.opt; if (!o?.domain || !o.dns) return;
    if (!o.dns.mx) return;                                  // no mail on this domain — nothing to authenticate
    if (!o.dns.spf) emit('infrastructure.spf_missing', 'dns', o.domain, { domain: o.domain });
    if (!o.dns.dmarc) emit('infrastructure.dmarc_missing', 'dns', o.domain, { domain: o.domain });
  } },

  { name: 'technical_seo', provide(i, emit) {
    const o = i.opt;
    if (o?.robotsTxt) {
      // a global block: "User-agent: *" section containing "Disallow: /" exactly
      const sections = o.robotsTxt.split(/(?=user-agent:)/i);
      const star = sections.find((s) => /^user-agent:\s*\*/i.test(s.trim()));
      if (star && /^\s*disallow:\s*\/\s*$/im.test(star)) emit('seo.robots_blocks_all', 'live', 'robots.txt');
    }
    if (o?.sitemapXml && i.pages.length) {
      const listed = all(o.sitemapXml, /<loc>([^<]+)<\/loc>/gi).map((m) => { try { return new URL(m[1]).pathname; } catch { return m[1]; } });
      const norm = (p: string) => (p.replace(/\/$/, '') || '/');
      const set = new Set(listed.map(norm));
      for (const p of i.pages) {
        if (!set.has(norm(p.path))) emit('seo.sitemap_page_missing', 'live', p.path, { page: p.path, count: listed.length });
      }
    }
    // orphan pages: in the file map but linked from nowhere
    if (i.fileMapFrom !== 'none' && i.pages.length > 1) {
      const linked = new Set<string>(['/']);
      for (const p of i.pages) for (const m of all(p.html, /href="(\/[^"#?]*)"/gi)) {
        linked.add((m[1].replace(/\/$/, '') || '/'));
      }
      for (const p of i.pages) {
        const norm = (p.path.replace(/\/$/, '') || '/');
        if (!linked.has(norm)) emit('seo.orphan_page', 'render', p.path, { page: p.path });
      }
    }
    // duplicate pages: identical normalized body text
    const seen = new Map<string, string>();
    for (const p of i.pages) {
      const body = bodyText(p.html);
      if (body.length < 80) continue;
      const key = body.toLowerCase();
      if (seen.has(key)) emit('seo.duplicate_page', 'render', `${seen.get(key)}≡${p.path}`, { a: seen.get(key)!, b: p.path });
      else seen.set(key, p.path);
    }
  } },

  { name: 'aeo', provide(i, emit) {
    const faqs = i.draft.faqs || [];   // snapshot faqs are the visible set
    const ld = i.pages.flatMap((p) => all(p.html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi).map((m) => m[1]));
    const parsed = ld.map((b) => { try { return JSON.parse(b); } catch { return null; } }).filter(Boolean);
    const types = new Set(parsed.flatMap((j) => (Array.isArray(j) ? j : [j]).map((n) => String((n as Record<string, unknown>)['@type'] || ''))));
    if (faqs.length >= 2 && !types.has('FAQPage')) emit('aeo.faq_schema_missing', 'render', '/', { count: faqs.length });
    if (parsed.length && ![...parsed].some((j) => 'sameAs' in ((Array.isArray(j) ? j[0] : j) || {}))) {
      const social = i.draft.identity?.social;
      const hasSocial = social && typeof social === 'object' && Object.values(social).some(Boolean);
      if (!hasSocial) emit('aeo.entity_links_missing', 'render', '/');
    }
    if (faqs.length >= 2) {
      const avg = Math.round(faqs.reduce((n, f) => n + String(f.answer || '').split(/\s+/).filter(Boolean).length, 0) / faqs.length);
      if (avg > 0 && avg < 15) emit('aeo.answers_thin', 'content', '', { avg, floor: 15 });
    }
    const home = i.pages.find((p) => p.path === '/');
    if (home) {
      const text = home.html;
      const loc = i.draft.locations?.[0];
      const missing: string[] = [];
      if (!i.draft.identity?.business_name || !text.includes(i.draft.identity.business_name)) missing.push('name');
      if (loc?.address_line1 && !text.includes(loc.address_line1)) missing.push('address');
      if (i.draft.identity?.phone && !text.includes(String(i.draft.identity.phone).slice(-4))) missing.push('phone');
      const hasHours = (loc?.hours || []).some((d) => !d.closed && (d.intervals || []).length);
      if (hasHours && !/\d{1,2}(:\d{2})?\s*(am|pm|–|-)/i.test(bodyText(text))) missing.push('hours');
      if (missing.length) emit('aeo.citation_facts_incomplete', 'render', '/', { missing: missing.join(', ') });
    }
    const desc = String(i.draft.identity?.description || '');
    const city = String(i.draft.locations?.[0]?.city || '');
    const area = String(i.draft.identity?.service_area || '');
    if (desc.split(/\s+/).length >= 15 && (city || area)) {
      const hit = (city && desc.toLowerCase().includes(city.toLowerCase())) || (area && desc.toLowerCase().includes(area.toLowerCase()));
      if (!hit) emit('aeo.location_terms_missing', 'draft', 'description');
    }
  } },

  { name: 'accessibility_deep', provide(i, emit) {
    for (const p of i.pages) {
      const fields = all(p.html, /<(input|select|textarea)\b[^>]*>/gi)
        .filter((m) => !/type="(hidden|submit|button)"/i.test(m[0]) && !/aria-label|aria-labelledby/i.test(m[0]));
      const labeledIds = new Set(all(p.html, /<label\b[^>]*\bfor="([^"]+)"/gi).map((m) => m[1]));
      const unlabeled = fields.filter((m) => { const id = (m[0].match(/\bid="([^"]+)"/i) || [])[1]; return !id || !labeledIds.has(id); });
      if (unlabeled.length) emit('accessibility.form_label_missing', 'render', p.path, { page: p.path, count: unlabeled.length });
      const pos = all(p.html, /tabindex="(\d+)"/gi).find((m) => Number(m[1]) > 0);
      if (pos) emit('accessibility.tabindex_positive', 'render', p.path, { page: p.path, value: pos[1] });
      for (const m of all(p.html, /<[^>]*aria-hidden="true"[\s\S]{0,400}?>/gi)) {
        const rest = p.html.slice(m.index!, m.index! + 600);
        if (/<(a|button)\b/i.test(rest)) { emit('accessibility.aria_hidden_focusable', 'render', p.path, { page: p.path }); break; }
      }
    }
  } },

  { name: 'performance_deep', provide(i, emit) {
    const h = i.opt?.homeProbe; if (!h) return;
    if (h.contentType.includes('text/html') && !h.contentEncoding) emit('performance.compression_missing', 'live', h.url, { type: h.contentType });
    if (!h.cacheControl) emit('performance.cache_headers_missing', 'live', h.url);
    const BUDGET = 1800;
    if (h.ms > BUDGET) emit('performance.slow_response', 'live', h.url, { url: h.url, ms: h.ms, budget: BUDGET });
  } },

  { name: 'local_presence_deep', provide(i, emit) {
    // NAP consistency: the phone rendered anywhere must be THE phone
    const draftPhone = digitsOnly(String(i.draft.identity?.phone || ''));
    if (!draftPhone) return;
    for (const p of i.pages) {
      const rendered = [...new Set((bodyText(p.html).match(/\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}/g) || []).map(digitsOnly))];
      const stranger = rendered.find((r) => r !== draftPhone);
      if (stranger) {
        emit('local_presence.nap_inconsistent', 'render', p.path, { field: 'phone', a: draftPhone, b: stranger });
        break;
      }
    }
  } },

  { name: 'reputation', provide(i, emit) {
    const dated = (i.draft.testimonials || []).map((t) => t.quote_date).filter(Boolean).sort().reverse() as string[];
    if (dated.length >= 3) {
      const gap = daysBetween(dated[0], dated[1]);
      if (gap >= 180) emit('reviews.velocity_slowing', 'content', '', { gap, threshold: 180 });
    }
  } },

  { name: 'analytics', provide(_i, emit) {
    // honest observation of absence — no analytics destination exists yet;
    // when one does, this provider grows trend observations, same contract
    emit('analytics.not_connected', 'destinations', '');
  } },

  { name: 'trust_deep', provide(i, emit) {
    if (!String(i.draft.identity?.story || '').trim()) emit('trust.team_info_missing', 'draft', 'story');
  } },

  { name: 'visual_assets', provide(i, emit) {
    if (!i.mediaRows.length) { emit('media.imagery_none', 'media', ''); return; }
    const home = i.pages.find((p) => p.path === '/');
    if (home && !/property="og:image"/i.test(home.html)) emit('media.og_image_missing', 'render', '/', { page: '/' });
    const sig = new Map<string, number>();
    for (const m of i.mediaRows) {
      if (m.bytes == null || m.width == null) continue;
      const k = `${m.bytes}|${m.width}|${m.height}`;
      sig.set(k, (sig.get(k) || 0) + 1);
    }
    const dupes = [...sig.values()].filter((n) => n > 1).length;
    if (dupes) emit('media.duplicate_image', 'media', '', { count: dupes });
  } },

  { name: 'knowledge', provide(i, emit) {
    const docs = i.opt?.knowledgeDocs || [];
    if (!docs.length) return;
    const offerings = (i.draft.offerings || []).filter((o) => o.is_visible !== false);
    const byName = new Map(offerings.map((o) => [normName(o.name), o]));
    const sitePhone = digitsOnly(String(i.draft.identity?.phone || ''));
    const hasHours = (i.draft.locations?.[0]?.hours || []).some((d) => !d.closed && (d.intervals || []).length);
    for (const doc of docs) {
      const x = doc.extracted;
      let unlisted = 0;
      for (const item of x.items || []) {
        const site = byName.get(normName(item.name));
        if (!site) {
          if (unlisted++ < 5) emit('knowledge.item_unlisted', 'document', `${doc.id}:${item.name}`, { doc: doc.filename, name: item.name, price: item.price_text });
        } else if (site.price_text && item.price_text && normPrice(site.price_text) && normPrice(item.price_text) &&
                   normPrice(site.price_text) !== normPrice(item.price_text)) {
          emit('knowledge.price_mismatch', 'document', `${doc.id}:${item.name}`, { doc: doc.filename, name: item.name, doc_price: item.price_text, site_price: site.price_text });
        }
      }
      const docPhone = (x.phones || []).map(digitsOnly).find((p) => sitePhone && p !== sitePhone);
      if (docPhone) emit('knowledge.phone_mismatch', 'document', doc.id, { doc: doc.filename, doc_phone: docPhone.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3'), site_phone: String(i.draft.identity?.phone || '') });
      if ((x.hours_lines || []).length && !hasHours) emit('knowledge.hours_available', 'document', doc.id, { doc: doc.filename, count: x.hours_lines.length });
    }
  } },
];
