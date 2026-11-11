// ── Domain changes, told and kept safe (Nov 2026 review, builder list item 163) ──
// Findings 11, 12 and 14 of the domains file:
// - Taking a live site off its address was the most damaging single click in the
//   product, and nobody was told. Now the site's owner and the studio that looks after
//   it are emailed whenever a domain is attached, changed or removed.
// - Changing to a new domain dropped the old one cold. An old name kept on the site
//   (a Netlify "domain alias") now forwards to the current one, path and all, from the
//   next publish: Netlify serves an alias as-is, and only a domain-level rule at the very
//   top of _redirects makes it a permanent move (docs: Redirect options, "Domain-level
//   redirects"; the alias has to be on the site first).
// - The client's email records are saved when a domain is attached; if they vanish
//   later (usually deleted while connecting the website), owner and studio are told at
//   once, with the old values to put back.
import { svc } from './db.ts';
import { emailOperator } from './service_bridge.ts';
import { loadEmailBrand } from './email_brand.ts';

const first = (r: unknown) => ((r && Array.isArray((r as { json?: unknown }).json) ? ((r as { json: unknown[] }).json[0]) : null) || null) as Record<string, unknown> | null;
export const escHtml = (x: unknown) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Pure: who made a change, in the words the owner reads. A studio member acting inside the
 *  client's site, or platform staff, is "your studio"; anyone else is named by their email. */
export function byWhom(p: { scope?: unknown; kind?: string; email?: string | null }): string {
  if (p.scope || p.kind === 'staff') return 'your studio';
  return p.email ? String(p.email) : 'someone on your account';
}

export type DomainChange = 'attached' | 'changed' | 'removed' | 'mail_gone' | 'live';
/** Pure: the email for one change, plain words, no hosting company's name. */
export function domainChangeEmail(kind: DomainChange, o: { domain: string; old?: string | null; forwarded?: boolean; by?: string; builtIn?: string | null; mx?: string[]; recordsAt?: string | null }): { subject: string; html: string } {
  const d = escHtml(o.domain), by = escHtml(o.by || 'someone on your account');
  const unexpected = '<p>If this wasn’t expected, reply to this email.</p>';
  // item 164 (review domains finding 13): the moment it's live, said once
  if (kind === 'live') {
    const bare = o.domain.startsWith('www.') ? o.domain.slice(4) : o.domain;
    const pair = /^[^.]+\.[^.]+$/.test(bare) ? ` Visitors who type ${escHtml(bare)} or www.${escHtml(bare)} end up there.` : '';
    return { subject: `Your website is live at ${o.domain}`, html: `<p>Your website is live at <a href="https://${d}">${d}</a>, with the padlock on.${pair}</p><p>Share it anywhere: it’s the address to print, post and hand out.</p>` };
  }
  if (kind === 'attached') return {
    subject: `${o.domain} was connected to your website`,
    html: `<p><strong>${d}</strong> was connected to your website by ${by}.</p><p>It goes live once its two records are added where the domain’s settings are kept.</p>${unexpected}`,
  };
  if (kind === 'changed') return {
    subject: `Your website’s address is changing to ${o.domain}`,
    html: `<p>Your website is moving from <strong>${escHtml(o.old)}</strong> to <strong>${d}</strong>, by ${by}.</p>` +
      (o.forwarded ? `<p>${escHtml(o.old)} keeps working: from the next publish, visitors who use it are sent on to ${d}, to the same page.</p>` : `<p>${escHtml(o.old)} no longer shows your website.</p>`) + unexpected,
  };
  if (kind === 'removed') return {
    subject: `${o.domain} was removed from your website`,
    html: `<p><strong>${d}</strong> was removed from your website by ${by}.</p><p>Your site is still online${o.builtIn ? ` at its built-in address, <a href="https://${escHtml(o.builtIn)}">${escHtml(o.builtIn)}</a>` : ' at its built-in address'}.</p>${unexpected}`,
  };
  const recs = (o.mx || []).map((v) => `<li><code>MX ${escHtml(v)}</code></li>`).join('');
  return {
    subject: `Email for ${o.domain} may have stopped arriving`,
    html: `<p>The records that bring email to <strong>${d}</strong> are gone, so mail sent to addresses at ${d} may not arrive.</p>` +
      (recs ? `<p>They were:</p><ul>${recs}</ul>` : '') +
      `<p>Add them back ${o.recordsAt ? `at ${escHtml(o.recordsAt)}` : 'where the domain’s settings are kept'}. This usually happens when records are deleted while connecting a website: records marked MX are the email’s.</p>`,
  };
}

/** Tell the site's owner (its client's email, on the site's brand) and the studio that looks
 *  after it (the same service link the expiry reminders use). Never throws. */
export async function tellOwnerAndStudio(site: { id: string; client_id?: string | null }, mail: { subject: string; html: string }, what: string, opts: { studioOnly?: boolean; studioNote?: string } = {}): Promise<{ client: boolean; studio: boolean }> {
  const out = { client: false, studio: false };
  try {
    const [clQ, linkQ] = await Promise.all([
      !opts.studioOnly && site.client_id ? svc(`clients?id=eq.${encodeURIComponent(String(site.client_id))}&select=email&limit=1`).catch(() => null) : Promise.resolve(null),
      svc(`presence_service_links?customer_site_id=eq.${site.id}&status=eq.active&select=agency_site_id&order=created_at.desc&limit=1`).catch(() => null),
    ]);
    const to = String(first(clQ)?.email || '');
    if (to) {
      const { sendEmail } = await import('../commerce/account.ts');
      out.client = await sendEmail(to, mail.subject.slice(0, 180), mail.html, await loadEmailBrand(site.id)).catch(() => false);
    }
    const studioSite = first(linkQ)?.agency_site_id;
    if (studioSite) out.studio = await emailOperator(String(studioSite), mail.subject, mail.html + (opts.studioNote ? `<p>${opts.studioNote}</p>` : ''), what);
  } catch { /* telling is best-effort: the change itself already happened */ }
  return out;
}

/** Hand work to the runtime so it outlives the response (Supabase Edge Functions have
 *  EdgeRuntime.waitUntil); anywhere else wait at most capMs. The same policy as
 *  notifyStudioOfClientAction (lib/service_bridge.ts). Never throws. */
export async function afterResponse(work: Promise<unknown>, capMs = 3000): Promise<void> {
  try {
    const safe = work.catch(() => null);
    const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
    if (rt && typeof rt.waitUntil === 'function') { rt.waitUntil(safe); return; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([safe, new Promise((res) => { timer = setTimeout(res, capMs); })]);
    if (timer !== undefined) clearTimeout(timer);
  } catch { /* best-effort */ }
}

/** Item 164 (review domains finding 13): "your website is live" goes to the owner and the studio
 *  the first time a domain passes every check, once per domain (a settings row remembers it,
 *  written compare-and-swap so two checks at once still send one). The studio's delivery
 *  checklist ticks "Domain connected" at the same moment. True when it went out now. */
export async function announceLiveOnce(site: { id: string; client_id?: string | null }, domain: string, nowIso: string): Promise<boolean> {
  try {
    const { readReservedJson, updateReservedJson, RESERVED_NAMES } = await import('./reserved_store.ts');
    const seen = await readReservedJson(site.id, RESERVED_NAMES.domainLive) as { domain?: string } | null;
    if (seen && seen.domain === domain) return false;   // the usual case: told already, nothing written
    let fresh = false;
    const r = await updateReservedJson(site.id, RESERVED_NAMES.domainLive, (cur) => {
      const c = cur as { domain?: string; at?: string } | null;
      fresh = !(c && c.domain === domain);
      return fresh ? { domain, at: nowIso } : c;
    }, 'system');
    if (r === null || !fresh) return false;
    await tellOwnerAndStudio(site, domainChangeEmail('live', { domain }), 'domain-live');
    const { tickChecklistForCustomerSite } = await import('./service_bridge.ts');
    await tickChecklistForCustomerSite(site.id, 'domain_connected', 'domain-live', 'system').catch(() => false);
    return true;
  } catch { return false; }
}

// ── forwarding an old name (finding 12) ──
/** Pure: the domain-level rules that send each kept name to the main one, path kept, for
 *  both http and https. The main name and its www. twin are Netlify's own business. */
export function forwardingRules(aliases: string[], primary: string | null): string {
  const p = String(primary || '').toLowerCase().trim();
  if (!p) return '';
  const own = new Set([p, p.startsWith('www.') ? p.slice(4) : `www.${p}`]);
  const names = [...new Set((aliases || []).map((a) => String(a || '').toLowerCase().trim()).filter((a) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(a) && !own.has(a)))];
  return names.flatMap((a) => [`https://${a}/* https://${p}/:splat 301!`, `http://${a}/* https://${p}/:splat 301!`]).join('\n');
}
/** Pure: the site's _redirects with the forwarding rules on top (Netlify reads it top down,
 *  so a path rule never catches a forwarded name first). */
export function withForwarding(redirects: string, aliases: string[], primary: string | null): string {
  const rules = forwardingRules(aliases, primary);
  if (!rules) return redirects;
  return `# old addresses, sent on to ${String(primary).toLowerCase()} (domain changes keep them working)\n${rules}\n${redirects || ''}`;
}

// ── the client's email records (finding 14) ──
export interface DomainMail { domain: string; mx: string[]; saved_at: string; gone_alerted_at?: string | null }
/** Pure: compare the email records saved for a domain with what answers now. `alert` is true
 *  once, when saved records have vanished; `next` is what to keep (null: nothing to write). */
export function mailWatch(saved: DomainMail | null, domain: string, nowMx: string[], nowIso: string): { alert: boolean; next: DomainMail | null } {
  const mx = [...new Set(nowMx.map((v) => String(v).toLowerCase()))].sort();
  if (!saved || saved.domain !== domain) return { alert: false, next: mx.length ? { domain, mx, saved_at: nowIso, gone_alerted_at: null } : null };
  if (mx.length) {
    const same = mx.join('|') === [...saved.mx].sort().join('|');
    return { alert: false, next: same && !saved.gone_alerted_at ? null : { domain, mx, saved_at: nowIso, gone_alerted_at: null } };   // changed on purpose, or came back
  }
  if (!saved.mx.length || saved.gone_alerted_at) return { alert: false, next: null };   // nothing to lose, or already told
  return { alert: true, next: { ...saved, gone_alerted_at: nowIso } };
}
