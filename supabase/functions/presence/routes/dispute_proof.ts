// ── GET /sales/disputes/:id/proof: the proof for a disputed payment, in one zip (sales item 127) ──
// When a client disputes a payment, Stripe gives the studio a deadline to send proof, and
// Studio OS holds the best there is. One download, for the answer in Stripe:
//   Signed-agreement-*.pdf   each signed agreement on the deal, with its certificate of record
//                            (who signed, when, from where, the document's fingerprint)
//   Proposal-*.pdf           the accepted proposal: what they agreed to buy
//   Receipt-*.pdf            the disputed invoice as the paid receipt it now is
//   history.txt              the deal's history, oldest first: what was sent, opened, signed and paid;
//                            then the project's: milestones met, files delivered, approvals, messages
//   READ-ME.txt              what each file is and where it goes in Stripe's form
// :id is the dispute's row (presence_money_returns), which must be this studio's.
// Owners always; a team seat only when its role may see everything and download it, like
// the bookkeeper file. A read that fails downloads nothing and says so.
import { json } from '../../_shared/http.ts';
import { svc } from '../lib/db.ts';
import { zipStore } from '../lib/zip_csv.ts';
import { siteCan, isSiteRole } from '../lib/site_roles.ts';
import { UUID_RE } from '../lib/uuid.ts';
import type { SiteRow } from '../lib/site.ts';
import type { Principal } from '../../_shared/auth.ts';

const rows = (r: { json?: unknown }) => (Array.isArray((r as any)?.json) ? (r as any).json : []) as any[];
const usd = (c: unknown) => '$' + ((Number(c) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: unknown) => { const t = Date.parse(String(iso || '')); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : ''; };

/** The READ-ME: what is in the zip, and where each file goes in Stripe's answer. Pure. */
export function proofReadMe(p: { what: string; amount: number; due: string; files: string[]; signed: boolean; accepted: boolean }): string {
  return [
    `Proof for the disputed payment: ${p.what} (${usd(p.amount)})`,
    p.due ? `Answer in Stripe by ${p.due}.` : '',
    '',
    'What is in here:',
    ...p.files.map((f) => `  ${f}`),
    '',
    'Where each one goes in Stripe (open the dispute, then Counter dispute):',
    ...(p.signed ? ['  The signed agreement: under the customer\'s signature, or service documentation. Its last page is the certificate of who signed, when and from where.'] : []),
    ...(p.accepted ? ['  The proposal: under service documentation. It shows what they chose to buy.'] : []),
    '  The receipt: under receipt. It is the invoice, showing what they paid and when.',
    '  history.txt: under customer communication, or service documentation. It shows every step, from the first message to the payment, and the work delivered.',
    '',
    'Add a few plain sentences of your own: what the work was, when it was delivered, and how they agreed to it.',
    '',
  ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\r\n');
}

/** The history as plain lines, oldest first, a section for the deal and one for each
 *  project it became. Pure. */
export function historyText(sections: Array<{ heading: string; items: Array<{ at: string; text: string }> }>): string {
  const out: string[] = [];
  for (const sec of sections) {
    if (!sec.items.length) continue;
    out.push(sec.heading, '');
    for (const it of sec.items.slice().sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))) out.push(`${day(it.at)}  ${String(it.text || '').replace(/\s+/g, ' ').trim()}`);
    out.push('');
  }
  return out.join('\r\n');
}

/** One project event in words: what happened, and what it was about when the event names it. Pure. */
export function projectEventText(kind: string, detail: Record<string, unknown> | null, label: (k: string) => string): string {
  const d = detail || {};
  const about = String(d.title || d.name || d.label || d.file_name || d.subject || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const decision = typeof d.decision === 'string' ? d.decision : typeof d.status === 'string' && kind === 'approval_decided' ? d.status : '';
  return label(kind) + (about ? `: ${about}` : '') + (decision ? ` (${decision})` : '');
}

export async function handleDisputeProof(_req: Request, site: SiteRow, principal: Principal, id: string, cors: Record<string, string>): Promise<Response> {
  if (!UUID_RE.test(id)) return json({ error: 'bad_request' }, 400, cors);
  const role = String((principal as any)?.member?.role || '');
  if (role && (!isSiteRole(role) || !siteCan(role, 'export') || !siteCan(role, 'view_all'))) {
    return json({ error: 'forbidden', message: 'The proof for a dispute is for the studio’s owner.' }, 403, cors);
  }
  const r = await svc(`presence_money_returns?id=eq.${id}&site_id=eq.${site.id}&kind=eq.dispute&select=id,invoice_id,deal_id,amount_cents,due_by,applies_to&limit=1`);
  if (!r.ok) return json({ error: 'read_failed', message: 'The dispute couldn’t load just now, so nothing was downloaded. Try again in a moment.' }, 502, cors);
  const dsp = rows(r)[0];
  if (!dsp) return json({ error: 'not_found', message: 'That dispute isn’t here.' }, 404, cors);

  const [{ docRow }, { docContextFor }, { documentPdf, pdfFileName }, { loadEmailBrand }, { mergeDealTimeline }, { notifLabel }] = await Promise.all([
    import('./sales.ts'), import('../lib/doc_context.ts'), import('../lib/doc_pdf.ts'), import('../lib/email_brand.ts'), import('../crm/deal_activity.ts'), import('../lib/notifications.ts'),
  ]);
  const brand = await loadEmailBrand(site.id).catch(() => undefined);
  const files: Array<{ name: string; data: Uint8Array }> = [];
  const enc = new TextEncoder();
  const add = (name: string, data: Uint8Array) => {
    let n = name, k = 2;
    while (files.some((f) => f.name === n)) n = name.replace(/(\.\w+)?$/, `-${k++}$1`);
    files.push({ name: n, data });
  };
  const pdfOf = async (kind: 'invoice' | 'contract' | 'proposal', docId: string): Promise<boolean> => {
    const row = await docRow(kind, docId, site.id);
    if (!row) return false;
    const ctx = await docContextFor(site.id, kind, row).catch(() => null);
    const { deal_id: _d, ...data } = row;
    add(pdfFileName(kind, row), documentPdf(kind, data, brand, ctx));
    return true;
  };

  let what = 'Retainer charge', signed = false, accepted = false, title = '';
  try {
    if (dsp.invoice_id && UUID_RE.test(String(dsp.invoice_id))) {
      const inv = await docRow('invoice', String(dsp.invoice_id), site.id);
      if (inv) what = String(inv.title || 'Invoice');
      await pdfOf('invoice', String(dsp.invoice_id));
    }
    if (dsp.deal_id && UUID_RE.test(String(dsp.deal_id))) {
      const dealId = String(dsp.deal_id);
      const [deal, ks, ps, evs, pjs] = await Promise.all([
        svc(`presence_deals?id=eq.${dealId}&site_id=eq.${site.id}&select=title&limit=1`),
        svc(`presence_contracts?deal_id=eq.${dealId}&site_id=eq.${site.id}&status=eq.signed&deleted_at=is.null&select=id&order=signed_at.asc`),
        svc(`presence_proposals?deal_id=eq.${dealId}&site_id=eq.${site.id}&status=eq.accepted&deleted_at=is.null&select=id&order=decided_at.asc`),
        svc(`presence_deal_events?deal_id=eq.${dealId}&site_id=eq.${site.id}&select=id,kind,from_stage,to_stage,detail,actor,created_at&order=created_at.asc&limit=1000`),
        svc(`presence_projects?deal_id=eq.${dealId}&site_id=eq.${site.id}&deleted_at=is.null&select=id,name&order=created_at.asc&limit=5`),
      ]);
      if (!deal.ok || !ks.ok || !ps.ok || !evs.ok || !pjs.ok) throw new Error('read');
      title = String(rows(deal)[0]?.title || '');
      if (!dsp.invoice_id) what = `Retainer charge${title ? ': ' + title : ''}`;
      for (const k of rows(ks)) signed = (await pdfOf('contract', String(k.id))) || signed;
      for (const p of rows(ps)) accepted = (await pdfOf('proposal', String(p.id))) || accepted;
      // the project the deal became: the work being delivered, step by step
      const sections: Array<{ heading: string; items: Array<{ at: string; text: string }> }> = [{ heading: `History of ${title || 'the deal'}, oldest first`, items: mergeDealTimeline(rows(evs)).map((it) => ({ at: it.at, text: it.text })) }];
      for (const pj of rows(pjs)) {
        const pe = await svc(`presence_project_events?project_id=eq.${pj.id}&site_id=eq.${site.id}&select=kind,detail,created_at&order=created_at.asc&limit=1000`);
        if (!pe.ok) throw new Error('read');
        sections.push({ heading: `The project${pj.name ? ': ' + String(pj.name) : ''}, oldest first`, items: rows(pe).map((e: any) => ({ at: String(e.created_at || ''), text: projectEventText(String(e.kind || ''), e.detail, notifLabel) })) });
      }
      add('history.txt', enc.encode(historyText(sections)));
    }
  } catch {
    return json({ error: 'read_failed', message: 'The proof couldn’t be gathered just now, so nothing was downloaded. Try again in a moment.' }, 502, cors);
  }
  const due = dsp.due_by ? new Date(Date.parse(String(dsp.due_by))).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';
  files.unshift({ name: 'READ-ME.txt', data: enc.encode(proofReadMe({ what, amount: Number(dsp.amount_cents) || 0, due, files: files.map((f) => f.name), signed, accepted })) });
  const zip = zipStore(files);
  const slug = (title || what).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'payment';
  return new Response(zip.buffer as ArrayBuffer, { status: 200, headers: { ...cors, 'Access-Control-Expose-Headers': 'Content-Disposition', 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="dispute-proof-${slug}.zip"`, 'Cache-Control': 'no-store' } });
}
