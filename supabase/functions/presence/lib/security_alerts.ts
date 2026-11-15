// ── The owner is told (builder list item 191, Nov 2026) ───────────────────────
// Namecheap emails the account holder when certain things change (Nov 12 review, file 04
// finding 10). A business's owner now gets an email when a co-owner is added, when a
// handover of the site starts, and when its domain is removed: whoever did it, even the
// owner themself, so a stolen sign-in can't do it quietly. It names who, what and when,
// says what to do if it wasn't expected, comes in the business's own colours, and can't be
// unsubscribed from (critical). Closing the account already sends its own email.
import { loadEmailBrand } from './email_brand.ts';
import { ownerFacts, ownerEmailsOf } from './site_transfer.ts';

export type AlertKind = 'coowner_added' | 'transfer_started' | 'domain_removed';
export interface AlertFacts { business: string; who: string; by: string; at: string; confirmedWith: 'app' | 'email' | 'none'; detail?: string }

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const when = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : '';
};

/** The alert's subject, headline and body. Pure. */
export function alertEmail(kind: AlertKind, f: AlertFacts): { subject: string; html: string } {
  const head = {
    coowner_added: `${f.who} is now a co-owner of ${f.business}`,
    transfer_started: `${f.business} is being handed to ${f.who}`,
    domain_removed: `${f.who} was removed from ${f.business}`,
  }[kind];
  const what = {
    coowner_added: `${f.by} invited ${f.who} to ${f.business} as a co-owner. A co-owner can change pages, settings, money and people.`,
    transfer_started: `${f.by} started handing ${f.business} to ${f.who}. Nothing changes until ${f.who} accepts.`,
    domain_removed: `${f.by} removed the domain ${f.who} from ${f.business}. The website still answers at its Studio OS address.`,
  }[kind];
  const ifNot = {
    coowner_added: 'If not: open People to remove them, then change your password and tell your studio.',
    transfer_started: 'If not: open People and press Stop, then change your password and tell your studio.',
    domain_removed: 'If not: ask your studio to put it back, then change your password.',
  }[kind];
  const rows: Array<[string, string]> = [
    ['What', { coowner_added: 'A co-owner was invited', transfer_started: 'A handover was started', domain_removed: 'A domain was removed' }[kind]],
    ['Who did it', f.by],
    ['When', when(f.at)],
    ['Confirmed with', f.confirmedWith === 'app' ? 'A code from their authenticator app' : f.confirmedWith === 'email' ? 'A code emailed to them' : 'Their sign-in'],
  ];
  const table = `<table style="margin:14px 0;border-collapse:collapse;width:100%;background:#f3effb;border-radius:12px">${rows.map(([k, v]) => `<tr><td style="padding:8px 14px;color:#55526a;width:140px">${esc(k)}</td><td style="padding:8px 14px"><b>${esc(v)}</b></td></tr>`).join('')}</table>`;
  return {
    subject: head,
    html: `<p><b>${esc(head)}.</b></p><p>${esc(what)}</p>${table}<p>If you or your studio meant this, there’s nothing to do.</p><p><b>${esc(ifNot)}</b></p>` +
      `<p style="color:#6b6478;font-size:13px">A security alert from Studio OS to the owner of ${esc(f.business)}. These can’t be switched off.</p>`,
  };
}

/** The outside calls; tests swap them. */
export const alertDeps = {
  owner: async (siteId: string): Promise<{ to: string; business: string } | null> => {
    const facts = await ownerFacts(siteId).catch(() => null);
    const to = ownerEmailsOf(facts)[0];
    return to ? { to, business: String(facts?.client?.name || '').trim() } : null;
  },
  send: async (to: string, subject: string, html: string, siteId: string): Promise<boolean> => {
    const { sendEmail } = await import('../commerce/account.ts');   // lazy: account pulls in the email shell
    return await sendEmail(to, subject, html, await loadEmailBrand(siteId), { critical: true });
  },
};

/** Email a site's owner that one of the three happened. False when the site has no owner
 *  with an address, or the email didn't go; never throws, never blocks the action. */
export async function alertOwner(siteId: string, kind: AlertKind, f: Omit<AlertFacts, 'business' | 'at'> & { business?: string; at?: string }): Promise<boolean> {
  try {
    const owner = await alertDeps.owner(siteId);
    if (!owner) return false;
    const mail = alertEmail(kind, { business: f.business || owner.business || 'your website', at: f.at || new Date().toISOString(), who: f.who, by: f.by, confirmedWith: f.confirmedWith, detail: f.detail });
    return await alertDeps.send(owner.to, mail.subject, mail.html, siteId);
  } catch { return false; }
}
