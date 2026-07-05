import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const RESEND_KEY = Deno.env.get('RESEND_KEY') || '';
const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_KEY') || ''; // matches the ANTHROPIC_KEY secret in Supabase
const ERIC = 'eric@davisdigitalstudio.com';
const FROM = 'Davis Digital Studio <noreply@davisdigitalstudio.com>';
const PSI_KEY = Deno.env.get('PSI_KEY') || ''; // set as an Edge Function secret in Supabase; rotate the old hardcoded key in Google Cloud

// Service-role key + project URL for privileged server-side calls (creating auth users).
// These MUST be set as Edge Function secrets in Supabase (see deploy notes).
const SB_URL = Deno.env.get('SUPABASE_URL') || 'https://qksstlqzbhesadrrofgn.supabase.co';
const SB_SERVICE = Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

// ── CORS: allowlist real origins instead of '*' ──
// Add any new front-end origin here (e.g. a Netlify deploy-preview URL) if needed.
const ALLOWED_ORIGINS = [
  'https://davisdigitalstudio.com',
  'https://www.davisdigitalstudio.com',
];

function corsFor(req: Request) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dds-admin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// Kept for the email/notification helpers below that reference `cors` directly.
// Uses the canonical origin; per-request CORS is applied at the response layer.
const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-dds-admin',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
};

// ── Shared-secret gate for privileged (service-role) actions ──
// The admin panel must send this exact secret in the `x-dds-admin` header.
// Set ADMIN_SHARED_SECRET as an Edge Function secret in Supabase.
const ADMIN_SECRET = Deno.env.get('ADMIN_SHARED_SECRET') || '';
// create_client_auth + invite_client create/modify accounts and must be admin-only.
// reset_password is intentionally NOT here: clients trigger it from the portal "forgot password"
// flow, and Supabase only ever emails the real account owner. It is rate-limited instead.
const PRIVILEGED_TYPES = new Set(['create_client_auth', 'invite_client']);

function isAuthorizedAdmin(req: Request): boolean {
  if (!ADMIN_SECRET) return false; // fail closed if the secret was never set
  return req.headers.get('x-dds-admin') === ADMIN_SECRET;
}

// ── Simple in-memory per-IP rate limiter for cost-bearing AI/PSI routes ──
// Resets when the function cold-starts; good enough to stop casual abuse/cost runaway.
const RATE_LIMITED_TYPES = new Set(['psi_fetch', 'deep_audit', 'ai_critique', 'ai_critique_email', 'concierge', 'reset_password']);
const RATE_MAX = 12;            // requests allowed per window, per IP
const RATE_WINDOW_MS = 60_000;  // 1 minute
const rateHits = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') || '';
  return fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}

function isRateLimited(req: Request): boolean {
  const ip = clientIp(req);
  const now = Date.now();
  const rec = rateHits.get(ip);
  if (!rec || now > rec.resetAt) {
    rateHits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }
  rec.count++;
  return rec.count > RATE_MAX;
}

function json(payload: unknown, status = 200, corsHeaders: Record<string, string> = cors) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    status,
  });
}

async function sendEmail(to: string, subject: string, html: string) {
  return fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [to], subject, html }),
  });
}

function emailWrap(body: string) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0f0820;font-family:'Helvetica Neue',Arial,sans-serif;">${body}</body></html>`;
}

// A small branded shell for notification emails.
function notifyShell(heading: string, lines: string[], cta?: { label: string; href: string }) {
  return emailWrap(`
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <a href="https://davisdigitalstudio.com" style="font-family:Georgia,serif;font-size:18px;color:#fff;text-decoration:none;display:block;margin-bottom:20px;">Davis<span style="color:#c4aee8;">Digital</span> Studio</a>
      <div style="background:#1e1338;border-radius:16px;padding:28px;">
        <h1 style="font-family:Georgia,serif;font-size:21px;font-weight:400;color:#fff;margin:0 0 14px;">${heading}</h1>
        ${lines.map(l => `<p style="font-size:14px;color:rgba(255,255,255,0.65);line-height:1.6;margin:0 0 10px;">${l}</p>`).join('')}
        ${cta ? `<div style="text-align:center;margin-top:20px;"><a href="${cta.href}" style="display:inline-block;background:#5b3fa0;color:#fff;font-size:13px;font-weight:600;padding:11px 24px;border-radius:100px;text-decoration:none;">${cta.label}</a></div>` : ''}
      </div>
    </div>
  `);
}

// ── DEEP AUDIT ─────────────────────────────────────────────────────────────
async function deepAudit(targetUrl: string) {
  const out: any = {
    url: targetUrl, domain: '', https: false, fetchedHtml: false,
    onPage: { title: '', titleLength: 0, metaDescription: '', metaDescriptionLength: 0, canonical: null, h1Count: 0, h1Text: '', h2Count: 0, h3Count: 0, ogTitle: false, ogDescription: false, ogImage: false, ogUrl: false, twitterCard: false, wordCount: 0, imageCount: 0, imagesWithAlt: 0, internalLinks: 0, externalLinks: 0, favicon: false, langAttr: false },
    schema: { blocks: 0, types: [] as string[], hasLocalBusiness: false, hasOrganization: false, hasWebSite: false, hasBreadcrumb: false, localBusinessNAP: null as any },
    local: { phoneOnPage: false, phone: null as string | null, zipOnPage: false, googleMapsEmbed: false, hoursMentioned: false, socialLinks: [] as string[] },
    discoverability: { robotsTxt: false, robotsTxtBlocksAll: false, sitemapDeclared: false, sitemapUrl: null as string | null, sitemapXml: false, sitemapUrlCount: 0 },
  };

  // Normalize: add https:// if the visitor left off the scheme (most people do).
  let normalized = (targetUrl || '').trim();
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = 'https://' + normalized.replace(/^\/+/, '');
  }

  let u: URL;
  try { u = new URL(normalized); } catch { return out; }
  out.url = normalized;
  out.domain = u.hostname;
  out.https = u.protocol === 'https:';

  // Single fast fetch (like the original working version). Browser UA so sites don't 403 a "bot".
  const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  let html = '';
  try {
    const res = await fetch(normalized, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(9000), redirect: 'follow',
    });
    if (res.ok) {
      html = (await res.text()).slice(0, 600000);
      out.fetchedHtml = true;
    }
  } catch (_) { /* ignore */ }

  if (html) {
    const lc = html.toLowerCase();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) { out.onPage.title = titleMatch[1].replace(/\s+/g, ' ').trim(); out.onPage.titleLength = out.onPage.title.length; }
    const md1 = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
    const md2 = html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i);
    const desc = md1 ? md1[1] : (md2 ? md2[1] : '');
    out.onPage.metaDescription = desc; out.onPage.metaDescriptionLength = desc.length;
    const can = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
    out.onPage.canonical = can ? can[1] : null;
    out.onPage.h1Count = (html.match(/<h1[\s>]/gi) || []).length;
    out.onPage.h2Count = (html.match(/<h2[\s>]/gi) || []).length;
    out.onPage.h3Count = (html.match(/<h3[\s>]/gi) || []).length;
    const h1Text = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    out.onPage.h1Text = h1Text ? h1Text[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) : '';
    out.onPage.ogTitle = /<meta[^>]+property=["']og:title["']/i.test(html);
    out.onPage.ogDescription = /<meta[^>]+property=["']og:description["']/i.test(html);
    out.onPage.ogImage = /<meta[^>]+property=["']og:image["']/i.test(html);
    out.onPage.ogUrl = /<meta[^>]+property=["']og:url["']/i.test(html);
    out.onPage.twitterCard = /<meta[^>]+name=["']twitter:card["']/i.test(html);
    out.onPage.favicon = /<link[^>]+rel=["'](?:shortcut |icon|apple-touch-icon)/i.test(html);
    out.onPage.langAttr = /<html[^>]+lang=/i.test(html);
    const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
    const bodyText = (bodyMatch ? bodyMatch[0] : html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&amp;|&lt;|&gt;|&quot;|&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
    out.onPage.wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
    const imgs = html.match(/<img[^>]*>/gi) || [];
    out.onPage.imageCount = imgs.length;
    out.onPage.imagesWithAlt = imgs.filter(t => /\salt=["'][^"']/.test(t)).length;
    const anchors = html.match(/<a[^>]+href=["']([^"']+)["']/gi) || [];
    const host = u.hostname.replace(/^www\./, '');
    let internal = 0, external = 0;
    for (const a of anchors) {
      const href = (a.match(/href=["']([^"']+)["']/i) || [])[1] || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) continue;
      if (href.startsWith('/') || href.startsWith('?') || href.toLowerCase().includes(host)) internal++;
      else if (/^https?:\/\//i.test(href)) external++;
    }
    out.onPage.internalLinks = internal; out.onPage.externalLinks = external;
    const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    const schemas: any[] = [];
    for (const m of blocks) {
      try {
        const parsed = JSON.parse(m[1].trim());
        if (Array.isArray(parsed)) schemas.push(...parsed);
        else if (parsed['@graph'] && Array.isArray(parsed['@graph'])) schemas.push(...parsed['@graph']);
        else schemas.push(parsed);
      } catch (_) { /* skip */ }
    }
    out.schema.blocks = blocks.length;
    const typeStrs: string[] = [];
    for (const s of schemas) {
      if (!s || !s['@type']) continue;
      if (Array.isArray(s['@type'])) typeStrs.push(...s['@type']); else typeStrs.push(s['@type']);
    }
    out.schema.types = [...new Set(typeStrs)];
    const LB = /LocalBusiness|Restaurant|Store|Bar|CafeOrCoffeeShop|FoodEstablishment|BarOrPub|HealthAndBeautyBusiness|HomeAndConstructionBusiness|MedicalBusiness|ProfessionalService|RealEstateAgent|LegalService|Dentist|HairSalon|DaySpa/i;
    out.schema.hasLocalBusiness = typeStrs.some(t => LB.test(t));
    out.schema.hasOrganization = typeStrs.includes('Organization');
    out.schema.hasWebSite = typeStrs.includes('WebSite');
    out.schema.hasBreadcrumb = typeStrs.includes('BreadcrumbList');
    const lbSchema = schemas.find(s => s && (Array.isArray(s['@type']) ? s['@type'].some((t: string) => LB.test(t)) : LB.test(s['@type'] || '')));
    if (lbSchema) {
      out.schema.localBusinessNAP = {
        name: !!lbSchema.name, address: !!lbSchema.address, phone: !!lbSchema.telephone,
        hours: !!(lbSchema.openingHours || lbSchema.openingHoursSpecification), geo: !!lbSchema.geo,
        sameAs: !!(lbSchema.sameAs && (Array.isArray(lbSchema.sameAs) ? lbSchema.sameAs.length : 1)),
        image: !!lbSchema.image, priceRange: !!lbSchema.priceRange,
      };
    }
    const phone = bodyText.match(/(\(\d{3}\)\s*\d{3}[-.\s]?\d{4}|\d{3}[-.\s]\d{3}[-.\s]\d{4})/);
    out.local.phoneOnPage = !!phone; out.local.phone = phone ? phone[0] : null;
    out.local.zipOnPage = /\b\d{5}(-\d{4})?\b/.test(bodyText);
    out.local.googleMapsEmbed = /maps\.google\.com\/maps|google\.com\/maps\/embed|maps\.googleapis|google\.com\/maps\?/i.test(html);
    out.local.hoursMentioned = /\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b[\s\S]{0,40}\d{1,2}\s*(am|pm|:)/i.test(bodyText);
    const socials = ['facebook.com','instagram.com','twitter.com','x.com','linkedin.com','youtube.com','tiktok.com','yelp.com','pinterest.com'];
    for (const p of socials) if (lc.includes(p)) out.local.socialLinks.push(p);
  }

  // (robots.txt + sitemap probes removed: they added network round-trips that pushed
  //  total runtime past Supabase's execution limit. The review reads the page itself,
  //  which is what matters most for the visitor-facing critique.)

  return out;
}


// ===== AI WEBSITE REVIEW + CONCIERGE HELPERS (added) =====

async function aiCritique(targetUrl: string, businessType: string, goal: string) {
  // 1. Get the real facts about the page using the audit you already have.
  const audit = await deepAudit(targetUrl);

  if (!audit.fetchedHtml) {
    return { error: 'unreachable' };
  }

  // 2. Boil the audit down to a compact, factual summary for the model.
  const op = audit.onPage || {};
  const local = audit.local || {};
  const schema = audit.schema || {};
  const disc = audit.discoverability || {};

  const facts = [
    `Domain: ${audit.domain}`,
    `HTTPS (secure): ${audit.https ? 'yes' : 'NO — not secure'}`,
    `Page title: ${op.title ? `"${op.title}" (${op.titleLength} chars)` : 'MISSING'}`,
    `Meta description: ${op.metaDescription ? `"${op.metaDescription}" (${op.metaDescriptionLength} chars)` : 'MISSING'}`,
    `Main headline (H1): ${op.h1Text ? `"${op.h1Text}"` : 'MISSING'} (count: ${op.h1Count})`,
    `Subheadings (H2/H3): ${op.h2Count}/${op.h3Count}`,
    `Visible word count: ${op.wordCount}`,
    `Images: ${op.imageCount} total, ${op.imagesWithAlt} have alt text`,
    `Internal links: ${op.internalLinks}, external links: ${op.externalLinks}`,
    `Social share preview (Open Graph): title ${op.ogTitle ? 'yes' : 'no'}, image ${op.ogImage ? 'yes' : 'no'}`,
    `Canonical tag: ${op.canonical ? 'present' : 'missing'}`,
    `Favicon: ${op.favicon ? 'yes' : 'no'}`,
    `Phone number on page: ${local.phoneOnPage ? (local.phone || 'yes') : 'NO'}`,
    `Address/ZIP on page: ${local.zipOnPage ? 'yes' : 'no'}`,
    `Google Map embedded: ${local.googleMapsEmbed ? 'yes' : 'no'}`,
    `Hours listed: ${local.hoursMentioned ? 'yes' : 'no'}`,
    `Social profile links: ${(local.socialLinks && local.socialLinks.length) ? local.socialLinks.join(', ') : 'none found'}`,
    `Structured data for Google: ${schema.blocks} block(s); LocalBusiness ${schema.hasLocalBusiness ? 'yes' : 'no'}, Organization ${schema.hasOrganization ? 'yes' : 'no'}`,
    `robots.txt: ${disc.robotsTxt ? (disc.robotsTxtBlocksAll ? 'present but BLOCKS Google' : 'present') : 'missing'}`,
    `Sitemap: ${disc.sitemapXml ? `yes (${disc.sitemapUrlCount} URLs)` : 'not found'}`,
  ].join('\n');

  // 3. Prompt. Voice rules match Eric's site: plain, no jargon, no em dashes,
  //    honest, helpful first. Strict JSON out.
  const system = `You are Eric Davis, a friendly web designer in Los Angeles who runs Davis Digital Studio. A small business owner just asked for a free, honest review of their website. You are looking at REAL facts pulled from their live page (below). Your job is to tell them, in plain English, what is working and what is quietly costing them business, and what you would fix first.

Hard rules:
- Write like a real person talking to a non-technical business owner. Warm, direct, encouraging.
- NO jargon. If you must use a term, explain it in everyday words.
- NEVER use em dashes. Use commas, periods, or "and".
- Do not invent facts. Only comment on what the facts support. If something is fine, say so.
- Be honest but kind. Lead with at least one genuine strength. Do not fear-monger.
- Tie advice to THEIR goal and THEIR type of business wherever you can.
- This is free. Do not hard-sell. The point is to be useful first.

You must respond with ONLY valid JSON, no preamble, no markdown fences. Shape:
{
  "headline": "one short, specific sentence summarizing the overall state of their site",
  "intro": "2 to 3 warm sentences setting up what you found, mentioning their business type and goal naturally",
  "blocks": [
    {
      "type": "win" | "fix" | "watch",
      "label": "2-4 word custom label (optional, else omit)",
      "title": "the specific finding, plain English, under 10 words",
      "detail": "2 to 4 sentences explaining it simply and what to do about it",
      "why": "one sentence on why this matters for a business like theirs (optional)"
    }
  ]
}

Give 5 to 7 blocks total. Always include at least 1 "win". Order them most important first. Make the FIRST fix the single highest-impact thing.`;

  const user = `Business type: ${businessType}
Their #1 goal for the site: ${goal}

Real facts from their live website:
${facts}

Write the review now as JSON only.`;

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1800,
        system,
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(45000),
    });

    const aiData = await aiRes.json();
    if (aiData.error) {
      return { error: 'ai_failed', message: aiData.error.message || 'AI error' };
    }

    // Pull the text out of the content blocks.
    let text = '';
    if (Array.isArray(aiData.content)) {
      text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    }
    text = text.replace(/```json|```/g, '').trim();

    let parsed: any;
    try { parsed = JSON.parse(text); }
    catch (_) {
      // last-ditch: grab the outermost { ... }
      const m = text.match(/\{[\s\S]*\}/);
      if (m) { try { parsed = JSON.parse(m[0]); } catch (_2) { /* fall through */ } }
    }

    if (!parsed || !parsed.blocks || !Array.isArray(parsed.blocks) || !parsed.blocks.length) {
      return { error: 'parse_failed' };
    }

    // attach a couple of raw facts the front end may want later
    parsed.domain = audit.domain;
    return parsed;

  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === 'TimeoutError' || String(e).includes('timeout'));
    return { error: isTimeout ? 'timeout' : 'ai_failed', message: String(e) };
  }
}


// ============================================================================
//  HELPER 2 — branded email of the review (put next to your other email shells)
// ============================================================================
function critiqueEmailHtml(domain: string, result: any) {
  const tagColor: Record<string, string> = { win: '#1d7a45', fix: '#b5651d', watch: '#a83440' };
  const tagBg: Record<string, string> = { win: '#e8f6ee', fix: '#fdeede', watch: '#fbe9ea' };
  const tagLabel: Record<string, string> = { win: 'Working', fix: 'Worth fixing', watch: 'Keep an eye on' };

  const blocks = (result.blocks || []).map((b: any) => {
    const t = (b.type || 'fix').toLowerCase();
    const lbl = b.label || tagLabel[t] || 'Worth a look';
    return `
      <div style="background:#1e1338;border-radius:12px;padding:18px 18px 16px;margin-bottom:12px;">
        <div style="margin-bottom:8px;"><span style="font-size:11px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;padding:3px 10px;border-radius:100px;background:${tagBg[t] || '#fdeede'};color:${tagColor[t] || '#b5651d'};">${lbl}</span></div>
        <div style="font-family:Georgia,serif;font-size:17px;color:#fff;margin-bottom:7px;">${b.title || ''}</div>
        <div style="font-size:14px;color:rgba(255,255,255,0.65);line-height:1.65;">${b.detail || ''}</div>
        ${b.why ? `<div style="font-size:13px;color:rgba(196,174,232,0.85);margin-top:9px;">Why it matters: ${b.why}</div>` : ''}
      </div>`;
  }).join('');

  return emailWrap(`
    <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
      <a href="https://davisdigitalstudio.com" style="font-family:Georgia,serif;font-size:18px;color:#fff;text-decoration:none;display:block;margin-bottom:20px;">Davis<span style="color:#c4aee8;">Digital</span> Studio</a>
      <h1 style="font-family:Georgia,serif;font-size:23px;font-weight:400;color:#fff;margin:0 0 8px;">${result.headline || `Your website review for ${domain}`}</h1>
      <p style="font-size:14px;color:rgba(255,255,255,0.6);line-height:1.7;margin:0 0 22px;">${result.intro || ''}</p>
      ${blocks}
      <div style="text-align:center;margin-top:24px;">
        <a href="https://davisdigitalstudio.com/contact" style="display:inline-block;background:#5b3fa0;color:#fff;font-size:14px;font-weight:600;padding:13px 26px;border-radius:100px;text-decoration:none;">Book a free 15-minute call →</a>
      </div>
      <p style="text-align:center;font-size:12px;color:rgba(255,255,255,0.3);margin-top:22px;line-height:1.6;">This was a free first-pass review of ${domain}. Happy to talk through any of it, no charge.<br>Eric Davis · Davis Digital Studio · Los Angeles</p>
    </div>
  `);
}


const DDS_KNOWLEDGE = `
ABOUT DAVIS DIGITAL STUDIO
Davis Digital Studio is Eric Davis, a web designer in Los Angeles who builds websites and SEO for small businesses. Positioning: enterprise experience, small business heart. Fully remote, works with small businesses across the United States, local to LA. Eric brings nearly a decade of experience including managing 13 enterprise websites.

WEBSITE BUILDS (one-time pricing, every project includes a free discovery call to confirm scope and price)
1. Template — $1,500 one-time. Get online fast with a polished template build on whatever platform fits the business. Best for new businesses that need a clean, professional presence right away. Includes: your branding applied (colors, fonts, logo), up to 5 pages mobile-optimized, contact form and basic SEO setup, Google Analytics installation, 1 revision round, launch walkthrough video. You update it yourself, no code needed.
2. Custom + Photography — $3,800 one-time. A bespoke design with art-directed photography, built to rank and convert. For businesses ready to compete online. Includes: bespoke design and custom typography, art-directed photography with a shot list, mobile-first and performance-optimized, on-page SEO implementation, Google Analytics 4 and Search Console setup, Google Business Profile setup, 2 revision rounds, 30-day post-launch support. You update it yourself, no code.
3. Custom HTML — $6,500 one-time. The hand-coded version. No template limits, fastest performance, completely unique. For businesses that want the best. Includes: custom HTML, CSS, and JavaScript, mobile-first and performance-optimized, on-page SEO, Google Analytics 4 and Search Console setup, Google Business Profile setup, 2 revision rounds, 30-day post-launch support. Eric updates it since it is hand-coded.

PLATFORMS
Eric builds on any platform that fits the business: Squarespace, Webflow, or fully custom hand-coded HTML. The platform is chosen to fit the client, not forced.

TIMELINES
Template builds take 2 to 4 weeks. Custom + Photography takes 4 to 6 weeks. Custom HTML takes 6 to 10 weeks depending on scope. Rush delivery is available at a 25% surcharge.

PAYMENT
50% upfront, 50% at launch. Payment plans available. Payments are handled through Stripe.

ONGOING SUPPORT AFTER LAUNCH (3-month minimum either way)
- DIY — $0/mo. You manage updates yourself on the platform. Includes a launch walkthrough so your team can take it from here. Available on Template and Custom + Photography tiers.
- Managed — $400/mo. Eric handles updates, seasonal content, SEO monitoring, and a monthly performance report. Available on Template and Custom + Photography tiers.
- HTML Managed — $850/mo. Required for Custom HTML builds since the site is hand-coded. Eric handles every update, content change, and SEO improvement.
Every build also includes a 30-day post-launch support window at no extra cost.

AUDITS (paid, separate from a build, and the fee is credited toward any project)
- $99 — a real 1-page report you can act on, delivered in 24 hours.
- $499 — deeper audit delivered in 5 business days.
- $899 — most thorough, delivered in 7 business days.
Paid audits cover Lighthouse performance scores, mobile usability, search visibility, local presence, and a prioritized fix list in a branded report. There is also a FREE instant site score tool and a FREE AI Website Review tool on the site.

ADD-ONS (layer onto any package, priced per engagement)
- Brand Identity — from $500. Logo, color palette, typography system, and brand guidelines. This is how Eric handles logos and branding. Created with the help of AI tooling.
- Copywriting — from $400/page. Professional website copy written for clarity and conversion, with SEO keywords integrated.
- Google Ads Setup — from $600. Campaign structure, keyword targeting, and ad copy for a first paid search campaign.
- SEO Strategy roadmap — from $800. A data-driven roadmap built with SEMrush: keyword research, competitive analysis, and a 6-month content plan.
- Custom Widget or Feature — from $300. Interactive tools, calculators, quiz flows, booking integrations, or anything custom.

SEO
On-page and local SEO is built into every website project, not sold separately. Deeper SEO strategy work is available as the SEO Strategy add-on or an ongoing retainer. SEO work uses real keyword data from SEMrush, Google Business Profile optimization, on-page work, and technical fixes.

HOSTING
Eric builds the website but is not a web hosting company. He does not host sites. He builds the pages and sets them up on the platform that fits the client, and the client owns it.

EXISTING WEBSITES
If a business already has a website, Eric can make it better rather than always starting from scratch. The free AI Website Review or a paid audit is a good first step to see what is worth fixing.

WHAT MAKES A GOOD FIT FOR EACH TIER
Template fits new businesses or tight budgets that need a clean professional site quickly. Custom + Photography fits established businesses ready to invest in standing out and competing. Custom HTML fits businesses that want the absolute best, fully unique, fastest performance, no limits.
`;

// Single source of truth for the booking link, used in copy and the button.
const DDS_CALENDLY = 'https://calendly.com/eric-davisdigitalstudio/30min';


// ============================================================================
//  HELPER — the concierge conversation (put next to deepAudit / aiCritique)
// ============================================================================
async function conciergeChat(messages: Array<{ role: string; content: string }>) {
  const system = `You are the friendly site concierge for Davis Digital Studio, the web design business of Eric Davis in Los Angeles. You talk to visitors on the website. Your purpose is to remove someone's hesitation and, when they are a good fit, gently guide them to book a free discovery call. You are not a pushy salesperson. You lead with genuine help.

YOUR THREE JOBS, in order of priority:
1. Answer "can you do X" (capabilities and services).
2. Answer "what does it cost" and "how long does it take".
3. Once you have helped, warmly offer to book a free discovery call with Eric.

ABSOLUTE RULES:
- Answer ONLY from the KNOWLEDGE BASE below. It is the single source of truth.
- NEVER invent or guess a price, a timeline, a service, or a capability. If a specific number or detail is not in the knowledge base, do not make one up.
- When you genuinely cannot answer from the knowledge base, say something natural like "That is a great question for Eric directly. You can grab a free 15 to 30 minute call with him here:" and share the booking link. Do not pretend to know.
- If someone asks for an exact quote for their specific project, explain that real projects vary so the honest answer is a quick free call where Eric confirms scope and an exact price. Give them the relevant tier and its starting price from the knowledge base first, then offer the call.
- Keep the booking link natural, not spammy. Offer it when it actually helps: after you have answered their question, or when only Eric can answer. Do not paste it in every single message.

STYLE:
- Plain, warm, conversational language. Talk like a helpful human, not a brochure.
- NEVER use em dashes. Use commas, periods, or the word "and".
- Keep replies short and easy to read on a phone. Two or three short sentences is usually plenty. Use a short list only when it truly helps (like comparing the three build tiers).
- Do not open every message with "Hi". You are mid-conversation.
- Be honest about what Eric does and does not do. For example, he builds sites but does not host them.

THE BOOKING LINK is: ${DDS_CALENDLY}
When you want to offer the call, end your message with the exact token [BOOK] on its own and the website will show a booking button. Use [BOOK] when offering the call rather than pasting the raw URL into a sentence.

KNOWLEDGE BASE:
${DDS_KNOWLEDGE}`;

  // Keep only role + content, cap history length defensively.
  const clean = messages
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-16)
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));

  if (!clean.length || clean[0].role !== 'user') {
    return { reply: "Hey! I'm the studio assistant. Ask me anything about what Eric builds, what it costs, or how long it takes, and I'll point you in the right direction.", book: false };
  }

  try {
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system,
        messages: clean,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const aiData = await aiRes.json();
    if (aiData.error) {
      return { reply: "Sorry, I hit a snag just then. You can always reach Eric directly with a quick free call.", book: true, error: aiData.error.message || 'ai_error' };
    }

    let text = '';
    if (Array.isArray(aiData.content)) {
      text = aiData.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    }
    text = (text || '').trim();

    // Detect the booking token and strip it from the visible text.
    let book = false;
    if (text.includes('[BOOK]')) {
      book = true;
      text = text.replace(/\[BOOK\]/g, '').trim();
    }
    // Safety net: if the model pasted the raw URL, swap it for a button.
    if (text.includes(DDS_CALENDLY)) {
      book = true;
      text = text.split(DDS_CALENDLY).join('').replace(/\(\s*\)/g, '').replace(/:\s*$/,'').trim();
    }

    if (!text) {
      text = "Happy to help with that. Want to talk it through with Eric on a quick free call?";
      book = true;
    }

    return { reply: text, book };

  } catch (e) {
    const isTimeout = e instanceof Error && (e.name === 'TimeoutError' || String(e).includes('timeout'));
    return {
      reply: "Sorry, that took too long on my end. The fastest way to get your question answered is a quick free call with Eric.",
      book: true,
      error: isTimeout ? 'timeout' : String(e),
    };
  }
}

// ===== end added helpers =====

serve(async (req) => {
  const reqCors = corsFor(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: reqCors });

  try {
    const body = await req.json();
    const { type } = body;

    // Rate-limit the cost-bearing AI / PageSpeed routes (per IP).
    if (RATE_LIMITED_TYPES.has(type) && isRateLimited(req)) {
      return json({ error: 'rate_limited', message: 'Too many requests. Please wait a minute and try again.' }, 429, reqCors);
    }

    // Gate privileged service-role actions behind the shared admin secret.
    if (PRIVILEGED_TYPES.has(type) && !isAuthorizedAdmin(req)) {
      return json({ error: 'unauthorized' }, 401, reqCors);
    }

    // ── PSI PROXY ──
    if (type === 'psi_fetch') {
      const { url } = body;
      if (!url) return json({ error: 'No URL provided' }, 400);
      const psiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=seo&category=accessibility&key=${PSI_KEY}`;
      try {
        const psiRes = await fetch(psiUrl, { signal: AbortSignal.timeout(90000) });
        const psiData = await psiRes.json();
        if (psiData.error) return json({ error: psiData.error.message || 'PSI error', code: psiData.error.code });
        return json({ data: psiData });
      } catch (psiErr) {
        const isTimeout = psiErr instanceof Error && (psiErr.name === 'TimeoutError' || psiErr.message.includes('timeout'));
        return json({ error: isTimeout ? 'timeout' : 'fetch_failed', message: String(psiErr) });
      }
    }

    // ── DEEP AUDIT ──
    if (type === 'deep_audit') {
      const { url } = body;
      if (!url) return json({ error: 'No URL provided' }, 400);
      try { return json({ data: await deepAudit(url) }); }
      catch (e) { return json({ error: 'deep_audit_failed', message: String(e) }); }
    }

    // ── CREATE CLIENT AUTH USER (privileged — service role) ──
    // The admin panel calls this instead of hitting /auth/v1/admin/users from the browser,
    // which the public anon key is not allowed to do.
    if (type === 'create_client_auth') {
      const { email, password } = body;
      if (!email || !password) return json({ error: 'email and password required' }, 400);
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500);
      try {
        const res = await fetch(`${SB_URL}/auth/v1/admin/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
          body: JSON.stringify({ email, password, email_confirm: true }),
        });
        const data = await res.json();
        if (!res.ok) {
          return json({ error: data.msg || data.message || data.error_description || 'Could not create login', status: res.status }, 200);
        }
        return json({ ok: true, user_id: data.id || (data.user && data.user.id) || null });
      } catch (e) {
        return json({ error: 'auth_create_failed', message: String(e) }, 200);
      }
    }

    // ── INVITE CLIENT (privileged — service role) ──
    // Self-service onboarding: admin supplies an email; Supabase emails the client
    // an invite link, and THEY set their own password via the /set-password page.
    // redirectTo must be added to Supabase Auth > URL Configuration > Redirect URLs.
    if (type === 'invite_client') {
      const { email, name } = body;
      if (!email) return json({ error: 'email required' }, 400);
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500);
      try {
        const res = await fetch(`${SB_URL}/auth/v1/invite`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
          body: JSON.stringify({
            email,
            data: name ? { full_name: name } : {},
            redirect_to: 'https://davisdigitalstudio.com/set-password.html',
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          return json({ error: data.msg || data.message || data.error_description || 'Could not send invite', status: res.status }, 200);
        }
        return json({ ok: true, user_id: data.id || (data.user && data.user.id) || null });
      } catch (e) {
        return json({ error: 'invite_failed', message: String(e) }, 200);
      }
    }

    // ── PASSWORD RESET (recovery email) ──
    // Public: portal "Forgot password" calls this. Sends Supabase recovery email
    // that lands on /set-password.html where the client picks a new password.
    if (type === 'reset_password') {
      const { email } = body;
      if (!email) return json({ error: 'email required' }, 400);
      if (!SB_SERVICE) return json({ error: 'Server missing SERVICE_ROLE_KEY secret' }, 500);
      try {
        const res = await fetch(`${SB_URL}/auth/v1/recover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': SB_SERVICE, 'Authorization': `Bearer ${SB_SERVICE}` },
          body: JSON.stringify({
            email,
            redirect_to: 'https://davisdigitalstudio.com/set-password.html',
          }),
        });
        // Supabase returns 200 even if the email doesn't exist (prevents account enumeration).
        if (!res.ok) {
          let data: any = {}; try { data = await res.json(); } catch (_) {}
          return json({ error: data.msg || data.message || 'Could not send reset email', status: res.status }, 200);
        }
        return json({ ok: true });
      } catch (e) {
        return json({ error: 'reset_failed', message: String(e) }, 200);
      }
    }

    // ── AUDIT LEAD — persists to DB + sends emails ──
    if (type === 'audit_lead') {
      const { clientName, clientEmail, meta = {} } = body;
      const { url, bizType, city, score, perf, seo, a11y, lcp, fcp, cls, tbt, topIssues = [], userConfirmHtml, notifyHtml, fallback, pillars, deep, psiSkipped, tool } = meta;

      try {
        const key = SB_SERVICE || Deno.env.get('SUPABASE_ANON_KEY') || '';
        if (key) {
          await fetch(`${SB_URL}/rest/v1/audit_leads`, {
            method: 'POST',
            headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({
              tool: tool || 'audit', business_name: clientName || null, client_email: clientEmail || null,
              url: url || null, city: city || null, business_type: bizType || null,
              score: typeof score === 'number' ? score : null, pillars: pillars || null,
              core_web_vitals: (lcp || fcp || cls || tbt) ? { lcp, fcp, cls, tbt } : null,
              deep_audit: deep || null, findings: topIssues && topIssues.length ? topIssues : null,
              psi_skipped: !!psiSkipped,
            }),
          });
        }
      } catch (dbErr) { console.error('audit_leads insert failed (continuing with email):', dbErr); }

      const scoreColor = score < 45 ? '#e05555' : score < 65 ? '#f0b429' : '#6abf69';
      const ericHtml = notifyHtml || emailWrap(`
        <div style="max-width:580px;margin:0 auto;padding:32px 24px;">
          <a href="https://davisdigitalstudio.com" style="font-family:Georgia,serif;font-size:18px;color:#fff;text-decoration:none;display:block;margin-bottom:20px;">Davis<span style="color:#c4aee8;">Digital</span> Studio</a>
          <div style="background:#1e1338;border-radius:16px;padding:28px;">
            <div style="font-size:11px;color:#c4aee8;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">New Audit Lead</div>
            <h1 style="font-family:Georgia,serif;font-size:22px;font-weight:400;color:#fff;margin:0 0 4px;">${clientName}</h1>
            <a href="${url}" target="_blank" style="display:block;color:#c4aee8;text-decoration:none;font-size:13px;margin-bottom:18px;">${url}</a>
            <table style="width:100%;border-collapse:collapse;margin-bottom:18px;font-size:13px;">
              <tr><td style="padding:5px 0;color:rgba(255,255,255,0.4);width:80px;">Email</td><td><a href="mailto:${clientEmail}" style="color:#c4aee8;">${clientEmail}</a></td></tr>
              <tr><td style="padding:5px 0;color:rgba(255,255,255,0.4);">Type</td><td style="color:#fff;">${bizType || '—'}</td></tr>
              <tr><td style="padding:5px 0;color:rgba(255,255,255,0.4);">City</td><td style="color:#fff;">${city || '—'}</td></tr>
              <tr><td style="padding:5px 0;color:rgba(255,255,255,0.4);">Source</td><td style="color:#fff;">${fallback ? 'heuristic fallback' : 'PSI + deep audit'}</td></tr>
            </table>
            <div style="display:flex;gap:10px;margin-bottom:16px;">
              <div style="flex:1;background:rgba(255,255,255,0.05);border-radius:10px;padding:14px;text-align:center;"><div style="font-size:32px;font-weight:700;color:${scoreColor};">${score}</div><div style="font-size:11px;color:rgba(255,255,255,0.35);">Overall</div></div>
            </div>
            ${topIssues.length ? `<div style="font-size:10px;color:rgba(255,255,255,0.25);margin-bottom:10px;letter-spacing:1px;text-transform:uppercase;">Top issues</div>${topIssues.map((i: any, n: number) => `<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);font-size:12px;color:rgba(255,255,255,0.5);"><span style="color:${i.sev==='high'?'#e05555':i.sev==='medium'?'#f0b429':'#6abf69'};font-weight:700;">${n+1}. </span>${i.title}</div>`).join('')}` : ''}
            <div style="text-align:center;margin-top:20px;">
              <a href="mailto:${clientEmail}" style="display:inline-block;background:#5b3fa0;color:#fff;font-size:13px;font-weight:600;padding:10px 22px;border-radius:100px;text-decoration:none;margin-right:8px;">Reply to lead →</a>
              <a href="${url}" target="_blank" style="display:inline-block;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.6);font-size:13px;font-weight:600;padding:10px 22px;border-radius:100px;text-decoration:none;">Visit site →</a>
            </div>
          </div>
        </div>
      `);
      await sendEmail(ERIC, `New Audit Lead: ${clientName} (${url}) — ${score}/100`, ericHtml);
      if (clientEmail && userConfirmHtml) await sendEmail(clientEmail, `Your free site score for ${clientName}`, userConfirmHtml);
      return json({ ok: true });
    }

    // ── WELCOME — new client portal created (sent from admin createClient) ──
    if (type === 'project_complete') {
      const name = body.clientName || (body.client && body.client.name) || 'there';
      const email = body.clientEmail || (body.client && (body.client.contact_email || body.client.email)) || '';
      const surveyUrl = (body.meta && body.meta.survey_url) || body.message || 'https://davisdigitalstudio.com/project-survey';
      if (!email) return json({ error: 'no client email' }, 400);
      const html = notifyShell(
        `Your project is live, ${name} 🎉`,
        [
          `It's official, your project is complete and live. It's been a genuine pleasure building this with you.`,
          `Before you go, would you take one minute to tell me how it went? Your honest feedback helps me get better, and as a growing studio it means the world coming from someone I actually built for.`,
          `The survey is short, I promise, just a few quick questions.`,
        ],
        { label: 'Share your feedback →', href: surveyUrl }
      );
      await sendEmail(email, `Your project is live 🎉 — one quick favor`, html);
      // Notify Eric for the record
      await sendEmail(ERIC, `Project complete: ${name}`, notifyShell(`Project marked complete`, [`${name} (${email}) was marked complete and sent the satisfaction survey.`]));
      return json({ ok: true });
    }

    if (type === 'welcome') {
      const name = body.clientName || (body.client && body.client.name) || 'there';
      const email = body.clientEmail || (body.client && (body.client.contact_email || body.client.email)) || '';
      const pass = (body.meta && body.meta.password) || (body.creds && body.creds.password) || '';
      if (!email) return json({ error: 'no client email' }, 400);
      const html = notifyShell(
        `Welcome to your project portal, ${name}`,
        [
          `Your client portal is ready. This is where you'll see project progress, share files, approve work, message me, and view invoices, all in one place.`,
          `<strong>Your login</strong><br>Email: ${email}<br>Password: ${pass || '(set in your welcome details)'}`,
          `Sign in any time at the link below. I'd recommend changing your password after your first login.`,
        ],
        { label: 'Open your portal →', href: 'https://davisdigitalstudio.com/portal' }
      );
      await sendEmail(email, `Your Davis Digital Studio portal is ready`, html);
      // Also notify Eric so there's a record
      await sendEmail(ERIC, `Portal created: ${name}`, notifyShell(`New client portal created`, [`${name} (${email}) now has a portal.`]));
      return json({ ok: true });
    }

    // ── CONTACT REPLY — auto-reply to a contact form submission ──
    if (type === 'contact_reply') {
      const to = body.to || body.clientEmail;
      const name = body.name || body.clientName || 'there';
      const service = body.service || 'your project';
      if (!to) return json({ error: 'no recipient' }, 400);
      const html = notifyShell(
        `Thanks for reaching out, ${name}`,
        [
          `I got your message about ${service} and I'll get back to you personally within one business day.`,
          `In the meantime, feel free to reply to this email with anything else you'd like me to know.`,
          `— Eric Davis, Davis Digital Studio`,
        ],
        { label: 'See my work →', href: 'https://davisdigitalstudio.com/work' }
      );
      await sendEmail(to, `Thanks for reaching out to Davis Digital Studio`, html);
      return json({ ok: true });
    }

    // ── GENERIC NOTIFY — covers portal/admin notification emails to Eric ──
    // Types like client_message, brief_submitted, contract_acked, approval_needed,
    // eric_message, eric_file, invoice_reminder, etc. all land here.
    if (type && (body.clientName !== undefined || body.message !== undefined || body.subject !== undefined)) {
      const name = body.clientName || (body.client && body.client.name) || 'A client';
      const subject = body.subject || '';
      const message = body.message || '';
      const pretty = String(type).replace(/_/g, ' ');
      // Decide recipient: messages/briefs/approvals from client notify Eric;
      // eric_* notify the client.
      const toClient = String(type).startsWith('eric_') || type === 'approval_needed' || type === 'invoice_reminder';
      const recipient = toClient
        ? (body.clientEmail || (body.client && (body.client.contact_email || body.client.email)) || '')
        : ERIC;
      if (!recipient) return json({ ok: true, skipped: 'no recipient' });
      const heading = toClient ? `Update on your project` : `${name}: ${pretty}`;
      const lines = [
        subject ? `<strong>${subject}</strong>` : '',
        message ? message.replace(/\n/g, '<br>') : '',
      ].filter(Boolean);
      const cta = toClient
        ? { label: 'Open your portal →', href: 'https://davisdigitalstudio.com/portal' }
        : { label: 'Open admin →', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' };
      await sendEmail(recipient, toClient ? `Update on your project` : `${pretty} — ${name}`, notifyShell(heading, lines.length ? lines : ['(no details)'], cta));
      return json({ ok: true });
    }

        // ===== AI WEBSITE REVIEW + CONCIERGE ROUTES (added) =====
    if (type === 'ai_critique') {
      const { url, businessType, goal } = body;
      if (!url) return json({ error: 'No URL provided' }, 400);
      if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500);
      try {
        const data = await aiCritique(url, businessType || 'a small business', goal || 'getting more customers');
        if (data.error) return json({ error: data.error, message: data.message || null });
        // Silently log this review as a lead (no email needed) so Eric can reach out.
        try {
          const key = SB_SERVICE || Deno.env.get('SUPABASE_ANON_KEY') || '';
          if (key) {
            await fetch(`${SB_URL}/rest/v1/audit_leads`, {
              method: 'POST',
              headers: { 'apikey': key, 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
              body: JSON.stringify({
                tool: 'ai_critique',
                business_name: (data && data.domain) ? data.domain : null,
                url: url || null,
                business_type: businessType || null,
                findings: { goal: goal || null, summary: (data && data.summary) ? data.summary : null },
              }),
            });
          }
        } catch (_) { /* never block the review on logging */ }
        return json({ data });
      } catch (e) {
        return json({ error: 'ai_critique_failed', message: String(e) });
      }
    }

    if (type === 'ai_critique_email') {
      const { email, url, result } = body;
      if (!email || !result) return json({ error: 'email and result required' }, 400);
      const domain = (result && result.domain) ? result.domain : (url || 'your site');
      try {
        // send the visitor their copy
        await sendEmail(email, `Your free website review for ${domain}`, critiqueEmailHtml(domain, result));
        // notify Eric that a fresh lead just ran a review
        await sendEmail(ERIC, `New AI review run: ${domain}`, notifyShell(
          'Someone just ran a free AI review',
          [
            `Site: ${domain}`,
            `They asked for a copy at: ${email}`,
            `Headline: ${result.headline || '(none)'}`,
          ],
          { label: 'Open admin', href: 'https://davisdigitalstudio.com/dds-studio-manage-9k2p' }
        ));
        return json({ ok: true });
      } catch (e) {
        return json({ error: 'email_failed', message: String(e) });
      }
    }

    if (type === 'concierge') {
      const { messages } = body;
      if (!Array.isArray(messages)) return json({ error: 'messages array required' }, 400);
      if (!ANTHROPIC_KEY) return json({ error: 'Server missing ANTHROPIC_KEY secret' }, 500);
      try {
        const out = await conciergeChat(messages);
        return json({ data: out });
      } catch (e) {
        return json({ error: 'concierge_failed', message: String(e) });
      }
    }

    // ===== end added routes =====

    return json({ error: 'Unknown type' }, 400);

  } catch (err) {
    console.error('Edge function error:', err);
    return json({ error: String(err) }, 500);
  }
});
