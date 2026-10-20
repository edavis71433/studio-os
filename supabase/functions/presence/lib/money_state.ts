// ── Money in four states — ONE formula (Oct 2026 benchmark, item 2) ──────────
// HoneyBook and the other leaders show an invoice in one of four words:
// Paid · Processing · Upcoming · Overdue. Studio OS stores open|paid|void and
// used to derive "overdue" in three different places with three different
// todays. This is the single definition. Every surface that names an invoice's
// state — the client's Invoices tab and Needs-you row, Today's money band, the
// record's Billing tab, /client/billing, /sales/receivables and the deal read —
// runs THIS function, so two surfaces can never disagree about the same row.
//
//   paid        the server says so (status 'paid')
//   processing  a payment is in flight: Stripe told the webhook the charge is
//               still settling (processing_since — ACH and the like), or this
//               browser just came back from Stripe for it (`pending` ids) and
//               the webhook has not landed yet. Never "Paid" before the server
//               says paid; never "open" either — the client did pay.
//   upcoming    open, due in the future or undated
//   overdue     open, due_date before `todayYmd`. due_date is a DATE-ONLY
//               string, compared as y-m-d text against the CALLER's today —
//               the client's local calendar on the portal (PS2's rule), the
//               studio's local day on Today and the record, UTC on the server.
//   ''          a voided/canceled row — no money state (nothing owed, nothing
//               awaited). Callers render those as "Voided" and count nothing.
//
// The pages (client.html, today.html, crm.html) carry a VERBATIM JS mirror of
// moneyState / MONEY_WORD / MONEY_TONE / moneyBuckets (no bundler to import
// from). tests/presence/money_state_test.mjs imports this module AND extracts
// each page's copy, then runs one case table against all four — keep every
// copy byte-identical to the JS below (types aside).
export type MoneyState = 'paid' | 'processing' | 'upcoming' | 'overdue' | '';
export interface MoneyRow { id?: unknown; status?: unknown; due_date?: unknown; processing_since?: unknown; amount_cents?: unknown; amount?: unknown }
export interface MoneyBucket { count: number; cents: number }
export interface MoneyBuckets { paid: MoneyBucket; processing: MoneyBucket; upcoming: MoneyBucket; overdue: MoneyBucket }

export function moneyState(i: MoneyRow | null | undefined, todayYmd: string, pending?: string[] | null): MoneyState {
  if(!i)return'';
  const s=String(i.status||'open');
  if(s==='paid')return'paid';
  if(s==='void'||s==='canceled')return'';
  if(i.processing_since||(pending&&pending.indexOf(String(i.id))>=0))return'processing';
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(i.due_date||''));
  return(m&&todayYmd&&m[0]<String(todayYmd))?'overdue':'upcoming';
}
/** The one word per state, as the chips print it. */
export const MONEY_WORD: Record<string, string> = {paid:'Paid',processing:'Processing',upcoming:'Upcoming',overdue:'Overdue'};
/** The one colour family per state: good (green) · info (blue) · '' (neutral) · bad (red). */
export const MONEY_TONE: Record<string, string> = {paid:'good',processing:'info',upcoming:'',overdue:'bad'};
/** Count + cents per state over a list of invoice rows (amount_cents, or
 *  dollars in `amount` as /client/billing ships them). Voided rows count nowhere. */
export function moneyBuckets(list: MoneyRow[] | null | undefined, todayYmd: string, pending?: string[] | null): MoneyBuckets {
  const b: MoneyBuckets={paid:{count:0,cents:0},processing:{count:0,cents:0},upcoming:{count:0,cents:0},overdue:{count:0,cents:0}};
  for(const i of(Array.isArray(list)?list:[])){const st=moneyState(i,todayYmd,pending);if(!st)continue;const c=typeof i.amount_cents==='number'?i.amount_cents:Math.round((Number(i.amount)||0)*100);b[st].count++;b[st].cents+=c;}
  return b;
}
