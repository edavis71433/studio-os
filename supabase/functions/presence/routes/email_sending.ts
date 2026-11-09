// ── "Your sending domain" (sales review item 69, Nov 2026) ───────────────────
// Settings' Domain & email card says, in one line, which address updates and
// replies go out from, and whether the mail provider has that domain verified.
// Before this, a domain with no mail records was invisible from the app (the
// reply address bounced for months). One read of Resend's domain list, kept ten
// minutes; it never sends or changes anything.
import { json } from '../../_shared/http.ts';
import { parseAddress } from '../lib/inbound_email.ts';

export type DomainState = 'verified' | 'not_verified' | 'unknown';
interface ProviderDomain { name: string; status: string }

/** Is this domain verified with the mail provider? 'unknown' when the provider
 *  couldn't be asked (no key, a failed read): never claimed either way. Pure. */
export function domainState(domain: string, domains: ProviderDomain[] | null): DomainState {
  if (!domains || !domain) return 'unknown';
  const d = domains.find((x) => x.name === domain.toLowerCase());
  return d && d.status === 'verified' ? 'verified' : 'not_verified';
}

const KEEP_MS = 10 * 60_000;
let kept: { at: number; domains: ProviderDomain[] } | null = null;
/** Test hook: forget what was kept. */
export function forgetProviderDomains(): void { kept = null; }

async function providerDomains(): Promise<ProviderDomain[] | null> {
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.domains;
  const key = Deno.env.get('RESEND_KEY') || '';
  if (!key) return null;
  try {
    const r = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* */ } return null; }
    const j = await r.json().catch(() => null);
    const list: unknown[] = Array.isArray(j?.data) ? j.data : [];
    const domains = list.map((d: any) => ({ name: String(d?.name || '').toLowerCase(), status: String(d?.status || '') }));
    kept = { at: Date.now(), domains };   // a failed read is never kept
    return domains;
  } catch { return null; }
}

/** GET /email/sending → { from, domain, sending, replies, reply_domain, receiving } */
export async function handleEmailSending(cors: Record<string, string>): Promise<Response> {
  // the same sender every email uses (commerce/account.ts EMAIL_FROM)
  const from = parseAddress(Deno.env.get('EMAIL_FROM') || 'Davis Digital Studio <eric@davisdigitalstudio.com>').email;
  const domain = from.includes('@') ? from.slice(from.lastIndexOf('@') + 1) : '';
  const inbound = (Deno.env.get('RESEND_INBOUND_DOMAIN') || '').trim().toLowerCase();
  const domains = await providerDomains();
  return json({ data: {
    from, domain, sending: domainState(domain, domains),
    // replies to a studio's emails come back to its Inbox when the reply domain is set up
    replies: inbound ? 'inbox' : 'mailbox', reply_domain: inbound || null, receiving: inbound ? domainState(inbound, domains) : null,
  } }, 200, cors);
}
