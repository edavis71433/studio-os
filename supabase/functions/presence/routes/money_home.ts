// ── GET /sales/money-home?today=YYYY-MM-DD (sales item 173, the money wall) ──────
// What the Invoices page's band and cards need beyond its own rows: money in by month (the
// last twelve, the studio's own months, invoices and retainer charges less what went back)
// and Stripe's side of this month (paid online, Stripe's fees, what reached the bank, the
// next payout and its day). Stripe is read for the platform's own studio only, the way the
// bookkeeper file's payouts are (routes/accounting_export.ts seesStripeBooks): every pay link
// is made with the platform's Stripe, so a studio drilled into a client, a seat, or anyone
// else gets `stripe: null`. A Stripe that can't be read answers stripe: null too, and says
// so, never a blank strip read as zero. The two Stripe calls (balance transactions, payouts)
// are on the restricted key's list already (commerce/stripe_key.ts KEY_NEEDS).
import { json } from '../../_shared/http.ts';
import { svc, svcPages } from '../lib/db.ts';
import { callerToday } from '../lib/sales_lifecycle.ts';
import { revenueByMonth } from '../lib/sales_reports.ts';
import { retainerPayments } from '../lib/invoice_billing.ts';
import { RETURNED_SELECT, returnedPayments } from '../lib/money_returns.ts';
import { studioZone, localClock } from '../lib/studio_clock.ts';
import { homeMonths, stripeStrip } from '../lib/money_home.ts';
import { stripeConfigured, listPaymentBalanceTransactions, listPayouts } from '../commerce/stripe.ts';
import { seesStripeBooks } from './accounting_export.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const DAY = 86400;

export async function handleMoneyHome(req: Request, site: SiteRow, principal: Principal, cors: Record<string, string>): Promise<Response> {
  const nowIso = new Date().toISOString();
  const today = callerToday(new URL(req.url).searchParams.get('today'), nowIso);
  const since = new Date(Date.parse(today + 'T00:00:00Z') - 400 * DAY * 1000).toISOString();
  // the months: paid invoices (parts are paid rows of their own), retainer charges, what went back
  const [paidR, evR, retR, tz] = await Promise.all([
    svcPages(`presence_invoices?site_id=eq.${site.id}&deleted_at=is.null&status=eq.paid&paid_at=gte.${encodeURIComponent(since)}&select=amount_cents,paid_at`, 'paid_at').catch(() => null),
    svcPages(`presence_deal_events?site_id=eq.${site.id}&kind=eq.invoice_paid&detail->>retainer=eq.true&created_at=gte.${encodeURIComponent(since)}&select=kind,detail,created_at`, 'created_at').catch(() => null),
    svcPages(`presence_money_returns?site_id=eq.${site.id}&counted_cents=gt.0&counted_at=gte.${encodeURIComponent(since)}&select=${RETURNED_SELECT}`, 'counted_at').catch(() => null),
    studioZone(site.id),
  ]);
  if (!paidR) return json({ error: 'read_failed', message: 'The months couldn’t load just now.' }, 502, cors);
  const rev = revenueByMonth(paidR.rows, nowIso, evR ? retainerPayments(evR.rows) : [], retR ? returnedPayments(retR.rows) : [], tz);
  const months = homeMonths(rev.months);
  // Stripe's side of this month, for the platform's own studio
  let stripe: ReturnType<typeof stripeStrip> | null = null;
  let stripeFailed = false;
  if (seesStripeBooks(principal) && stripeConfigured()) {
    const local = localClock(tz || undefined, Date.now());
    const month = local.ymd.slice(0, 7);
    const start = Math.floor(Date.parse(month + '-01T00:00:00Z') / 1000) - 12 * 3600;   // the studio's month, with a day's grace at its edges
    const nowSec = Math.floor(Date.now() / 1000);
    try {
      const [bts, pos] = await Promise.all([listPaymentBalanceTransactions(start, nowSec + DAY, 10), listPayouts(start, nowSec + 45 * DAY, 3)]);
      stripe = stripeStrip(month, bts.data, pos.data, nowSec, bts.more || pos.more);
    } catch { stripeFailed = true; }
  }
  return json({ data: { today, months, total_12_cents: months.reduce((n, m) => n + m.cents, 0), stripe, stripe_failed: stripeFailed, stripe_books: seesStripeBooks(principal) } }, 200, cors);
}
void rows;
