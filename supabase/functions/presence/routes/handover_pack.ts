// ── The hand-over pack for a client who leaves (sales item 93) ─────────────────
//   GET  /handover/pack     the zip (lib/handover_pack.ts says what is in it). The
//                           studio scoped into the client (the record's More menu), or
//                           the business's own owner (the portal's Help tab).
//   POST /handover/notify   the studio emails the business's owner that the pack is
//                           ready in their portal. Once in two minutes at most.
// Making the pack changes nothing: the site stays live until the studio pauses it.
// A read of their customers or invoices that fails builds nothing and says so: a
// hand-over with holes in it is worse than none. A file that can't be fetched comes
// as a link instead, said in photos-and-files/LINKS.txt.
import { json } from '../../_shared/http.ts';
import { svc, svcPages } from '../lib/db.ts';
import { toCsv, zipStore } from '../lib/zip_csv.ts';
import { readReservedJson, updateReservedJson, RESERVED_NAMES } from '../lib/reserved_store.ts';
import { invoiceNo } from '../lib/documents.ts';
import { customerCsvs, invoicesCsv, domainText, ownsText, startHereHtml, planFiles, safeName, uniqueNames, PACK_LINK_DAYS, type DomainFacts } from '../lib/handover_pack.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown } | null) => (r && Array.isArray((r as any).json) ? (r as any).json : []) as any[];
const SB_URL = () => Deno.env.get('SUPABASE_URL') || '';
const SB_SERVICE = () => Deno.env.get('SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
export const NOTIFY_GAP_MS = 120_000;

/** The studio that looks after this business, by its link, and its name. */
async function studioOf(site: SiteRow): Promise<{ siteId: string | null; name: string }> {
  const link = rows(await svc(`presence_service_links?customer_site_id=eq.${site.id}&status=eq.active&select=agency_site_id&order=created_at.desc&limit=1`).catch(() => null))[0];
  const siteId = link?.agency_site_id ? String(link.agency_site_id) : null;
  if (!siteId) return { siteId: null, name: 'your studio' };
  const { loadEmailBrand } = await import('../lib/email_brand.ts');
  const b = await loadEmailBrand(siteId).catch(() => null);
  return { siteId, name: (b && b.name) || 'your studio' };
}
const extOf = (path: string, mime: string) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(path); if (m) return '.' + m[1].toLowerCase();
  return ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'application/pdf': '.pdf' } as Record<string, string>)[mime] || '';
};
/** Who handles their email, from the domain's MX records ("Google Workspace", or the host's name). */
export function mailHostOf(mx: string[]): string {
  const all = mx.join(' ').toLowerCase();
  if (!all) return '';
  if (/google\.com|googlemail\.com/.test(all)) return 'Google Workspace';
  if (/outlook\.com|office365|protection\.outlook/.test(all)) return 'Microsoft 365';
  if (/zoho\./.test(all)) return 'Zoho Mail';
  if (/secureserver\.net/.test(all)) return 'GoDaddy email';
  if (/registrar-servers\.com|privateemail/.test(all)) return 'Namecheap email';
  const host = /(?:^|\s)\d*\s*([a-z0-9.-]+\.[a-z]{2,})\.?$/.exec(mx[0].toLowerCase());
  return host ? host[1].split('.').slice(-2).join('.') : '';
}

export async function handleHandoverPack(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const role = String((principal as any)?.member?.role || '');
  const studio = !!(principal as any)?.scope;
  // the studio, scoped in, or the business's own owner: their customers and money are in it
  if (!studio && role && role !== 'business_owner') return json({ error: 'forbidden', message: 'The hand-over pack is for the business’s owner.' }, 403, cors);
  if (req.method === 'POST') return notify(site, principal, studio, cors);

  const S = site.id;
  const madeAt = new Date().toISOString();
  const [{ dnsRecords }, { signOriginal, fetchVariants, BUCKET }, { getTemplate, renderSnapshot }, { serializeDraft }, { siteOrigin }] = await Promise.all([
    import('../lib/domain_health.ts'), import('../lib/media.ts'), import('../lib/render.ts'), import('../lib/serializer.ts'), import('../lib/site.ts')]);
  // the website as publish draws it, with its photos at the sizes its pages ask for, and no
  // form, booking or visit-counter address: a site that runs on any host (a form becomes email)
  const drawSite = async () => {
    const t = getTemplate(String((site as any).template_slug || ''), String((site as any).template_version || ''));
    if (!t) return null;
    const { snapshot, mediaManifest } = await serializeDraft(S, t.manifest, { templateSlug: String((site as any).template_slug), templateVersion: String((site as any).template_version), now: madeAt });
    const pages = await renderSnapshot(snapshot, { baseUrl: siteOrigin(site) });
    const photos = await fetchVariants(mediaManifest).catch(() => ({ files: {} as Record<string, Uint8Array>, failed: ['all'] }));
    return { pages, photos, business: String((snapshot.content as any)?.identity?.business_name || '') };
  };
  const [ex, mediaQ, subsQ, apptQ, revQ, invQ, siteQ, notes, connQ, who] = await Promise.all([
    drawSite().catch(() => null),
    svcPages(`presence_media?site_id=eq.${S}&deleted_at=is.null&select=id,storage_path,alt_text,mime,bytes`, 'created_at').catch(() => null),
    svcPages(`presence_form_submissions?site_id=eq.${S}&spam=is.false&select=created_at,form_kind,name,email,phone,message,source_page,status`, 'created_at').catch(() => null),
    svcPages(`presence_appointments?site_id=eq.${S}&select=slot_start,slot_start_local,type_name,customer_name,customer_email,customer_phone,duration_min,price_cents,status,note`, 'created_at').catch(() => null),
    svcPages(`presence_reviews?site_id=eq.${S}&select=created_at,reviewer_name,reviewer_email,rating,body,status,owner_reply`, 'created_at').catch(() => null),
    site.client_id ? svcPages(`presence_invoices?customer_client_id=eq.${encodeURIComponent(String(site.client_id))}&deleted_at=is.null&select=id,title,amount_cents,status,due_date,paid_at,created_at,number,payment_for,paid_method,processing_since`, 'created_at').catch(() => null) : Promise.resolve({ rows: [], truncated: false }),
    svc(`presence_sites?id=eq.${S}&select=custom_domain,domain_registrar,domain_expires_at,domain_dns_host,domain_registered_name&limit=1`).catch(() => null),
    readReservedJson(S, RESERVED_NAMES.domainNotes),
    svc(`presence_connections?site_id=eq.${S}&select=provider_key,status&limit=50`).catch(() => null),
    studioOf(site),
  ]);
  if (!ex || !mediaQ || !subsQ || !apptQ || !revQ || !invQ) {
    return json({ error: 'read_failed', message: 'We couldn’t gather everything for the pack just now, so nothing was downloaded. Try again in a moment.' }, 502, cors);
  }
  const business = ex.business.trim() || 'This business';
  const files: Array<{ name: string; data: Uint8Array }> = [];
  const enc = new TextEncoder();
  const text = (name: string, s: string) => files.push({ name, data: enc.encode(s) });

  // the website, every page as plain files, and the photos its pages show
  const pages = Object.entries(ex.pages).filter(([, v]) => typeof v === 'string') as Array<[string, string]>;
  for (const [path, body] of pages) text(`website/${path.replace(/^\/+/, '')}`, body);
  for (const [path, bytes] of Object.entries(ex.pages)) if (bytes instanceof Uint8Array) files.push({ name: `website/${path.replace(/^\/+/, '')}`, data: bytes });
  for (const [path, bytes] of Object.entries(ex.photos.files)) files.push({ name: `website/${path.replace(/^\/+/, '')}`, data: bytes });
  if (ex.photos.failed.length) text('website/PHOTOS-MISSING.txt', `${ex.photos.failed.length} photo size${ex.photos.failed.length === 1 ? '' : 's'} couldn't be fetched when this pack was made, so a page may show an empty frame. The full-size photos are in photos-and-files/.\r\n`);

  // their photos and files: the smaller ones inside, a very large one (or one that won't come) as a link
  // each named for what it shows (its alt text or document name), with its own extension
  const names = uniqueNames(mediaQ.rows.map((m: any) => {
    const path = String(m.storage_path || ''), base = String(m.alt_text || '').slice(0, 60) || (path.split('/').pop() || '').replace(/\.[a-z0-9]{2,5}$/i, '');
    return safeName(base, `file-${String(m.id).slice(0, 8)}`).replace(/\.[a-z0-9]{2,5}$/i, '') + extOf(path, String(m.mime || ''));
  }));
  const media = mediaQ.rows.map((m: any, i: number) => ({ id: String(m.id), path: String(m.storage_path || ''), mime: String(m.mime || ''), bytes: Number(m.bytes) || 0, name: names[i] }));
  const plan = planFiles(media);
  const linked = [...plan.linked];
  const auth = { Authorization: `Bearer ${SB_SERVICE()}`, apikey: SB_SERVICE() };
  for (let i = 0; i < plan.inside.length; i += 6) {
    await Promise.all(plan.inside.slice(i, i + 6).map(async (m) => {
      try {
        const r = await fetch(`${SB_URL()}/storage/v1/object/authenticated/${BUCKET}/${m.path.replace(`${BUCKET}/`, '')}`, { headers: auth });
        if (!r.ok) { linked.push(m); return; }
        files.push({ name: `photos-and-files/${m.name}`, data: new Uint8Array(await r.arrayBuffer()) });
      } catch { linked.push(m); }
    }));
  }
  if (linked.length) {
    const lines = await Promise.all(linked.map(async (m) => `${m.name}\r\n  ${(await signOriginal(m.path, PACK_LINK_DAYS * 86400).catch(() => null)) || '(this one couldn’t be linked; ask your studio for it)'}\r\n`));
    text('photos-and-files/LINKS.txt', [`These files are too large to fit in the pack, or didn't come through. Each link downloads the file and works for ${PACK_LINK_DAYS} days.`, '', ...lines].join('\r\n'));
  }

  // their customers, and their invoices from the studio
  const csvs = customerCsvs({ submissions: subsQ.rows, appointments: apptQ.rows, reviews: revQ.rows });
  for (const c of csvs) text(c.name, c.text);
  const inv = invoicesCsv(invQ.rows, invoiceNo);
  text('invoices-from-us.csv', inv.text);

  // the domain: the registry's facts, the studio's notes, and the records live now
  const sr = rows(siteQ)[0] || {};
  const domain = sr.custom_domain ? String(sr.custom_domain) : null;
  const n = (notes && typeof notes === 'object' ? notes : {}) as { account?: string; renews?: string; note?: string };
  const records: DomainFacts['records'] = [];
  let mx: string[] = [];
  if (domain) {
    const bare = String(sr.domain_registered_name || (domain.startsWith('www.') ? domain.slice(4) : domain));
    const ask = async (name: string, type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT') => { for (const v of await dnsRecords(name, type).catch(() => [] as string[])) records.push({ name, type, value: v }); };
    await Promise.all([...new Set([bare, `www.${bare}`, domain])].flatMap((nm) => (['A', 'AAAA', 'CNAME'] as const).map((t) => ask(nm, t))).concat([ask(bare, 'MX'), ask(bare, 'TXT'), ask(`_dmarc.${bare}`, 'TXT')]));
    mx = records.filter((r) => r.type === 'MX').map((r) => r.value);
  }
  const facts: DomainFacts = { domain, registrar: String(sr.domain_registrar || ''), expires_at: sr.domain_expires_at || null, dns_host: String(sr.domain_dns_host || ''), whose: String(n.account || '').trim(), auto_renew: n.renews === 'yes' ? true : n.renews === 'no' ? false : null, note: String(n.note || '').trim(), records };
  text('their-domain.txt', domainText(facts, who.name));
  const conns = rows(connQ).filter((c: any) => c.status === 'connected').map((c: any) => String(c.provider_key));
  text('who-owns-what.txt', ownsText({ studio: who.name, business, domain, registrar: facts.registrar, whose: facts.whose, google_listing: conns.includes('google_business_profile'), search_console: conns.includes('google_search_console'), mail_host: mailHostOf(mx) }));
  text('START-HERE.html', startHereHtml({ business, studio: who.name, made_at: madeAt, pages: pages.filter(([p]) => p.endsWith('.html')).length, files_inside: plan.inside.length - (linked.length - plan.linked.length), files_linked: linked.length,
    counts: { enquiries: csvs[0].count, bookings: csvs[1].count, reviews: csvs[2].count }, invoices: inv.count, domain }));
  const zip = zipStore(files);
  const slug = safeName(business.toLowerCase(), 'business').replace(/[^a-z0-9-]+/g, '').slice(0, 40) || 'business';
  return new Response(zip.buffer as ArrayBuffer, { status: 200, headers: { ...cors, 'Access-Control-Expose-Headers': 'Content-Disposition', 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="hand-over-pack-${slug}-${madeAt.slice(0, 10)}.zip"`, 'Cache-Control': 'no-store' } });
}

/** The studio tells the business's owner that the pack is waiting in their portal. */
async function notify(site: SiteRow, principal: Principal, studio: boolean, cors: Record<string, string>): Promise<Response> {
  if (!studio) return json({ error: 'forbidden', message: 'Only your studio can send this.' }, 403, cors);
  const owner = rows(await svc(`clients?id=eq.${encodeURIComponent(String(site.client_id || ''))}&select=name,email,contact_email&limit=1`).catch(() => null))[0];
  const to = String(owner?.contact_email || owner?.email || '').trim();
  if (!to) return json({ error: 'no_email', message: 'This business has no email address on file, so there is no one to send it to.' }, 422, cors);
  // once in two minutes at most: a second press is never a second email
  const now = Date.now();
  let refused = false;
  const kept = await updateReservedJson(site.id, RESERVED_NAMES.handoverPack, (cur: any) => {
    const last = Date.parse(String(cur?.sent_at || ''));
    if (Number.isFinite(last) && now - last < NOTIFY_GAP_MS) { refused = true; return cur; }
    return { sent_at: new Date(now).toISOString(), sent_to: to, by: principal.email || principal.userId || null };
  }, principal.email || principal.userId || 'system');
  if (refused) return json({ error: 'double_tap', message: 'That email went a moment ago.' }, 409, cors);
  if (!kept) return json({ error: 'write_failed', message: 'That didn’t send just now. Try again.' }, 502, cors);
  const who = await studioOf(site);
  const { sendEmail } = await import('../commerce/account.ts');
  const { loadEmailBrand } = await import('../lib/email_brand.ts');
  const brand = who.siteId ? await loadEmailBrand(who.siteId).catch(() => undefined) : undefined;
  const base = (Deno.env.get('APP_URL') || 'https://app.davisdigitalstudio.com').replace(/\/$/, '');
  const portal = who.siteId ? `${base}/portal.html?studio=${encodeURIComponent(who.siteId)}` : `${base}/client.html`;
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
  const first = String(owner?.name || '').trim().split(/\s+/)[0] || '';
  const sent = await sendEmail(to, 'Your hand-over pack is ready',
    `<p>${first ? `Hi ${esc(first)},` : 'Hello,'}</p><p>Everything you need to run your website on your own is ready in one download: your website as plain files, your photos and files, your domain and the records that keep your email working, your customers' enquiries, bookings and reviews, and your invoices from ${esc(who.name)}.</p><p>Sign in to your portal, open <strong>Help</strong>, and press <strong>Download your hand-over pack</strong>.</p><p class="cta"><a href="${esc(portal)}" style="display:inline-block;background:${brand?.accent || '#5b3fa0'};color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none">Open your portal</a></p>`,
    brand, { critical: true, siteId: who.siteId || undefined });
  if (!sent) {
    // the email didn't leave: the next press may try again at once
    await updateReservedJson(site.id, RESERVED_NAMES.handoverPack, () => ({ sent_at: null }), 'system').catch(() => null);
    return json({ error: 'send_failed', message: 'The email didn’t go out just now. Try again.' }, 502, cors);
  }
  return json({ data: { sent: true, to } }, 200, cors);
}
