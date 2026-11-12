// Sales item 88 (Nov 2026 review, file 07 findings 8 and 9): a proposal can be answered
// with a question or a reason for declining, and the agreement reads as a document,
// signed by both sides.
//   deno run --allow-read --allow-env tests/presence/agreement_layout_test.mjs
import {
  agreementBlocks, agreementContents, agreementWords, agreementHtml, DECLINE_REASONS, declineReason, declineWords,
  askSubject, maskEmail, validSignerEmail, studioSignerOf,
} from '../../supabase/functions/presence/lib/agreement_layout.ts';
import { renderContractDocument, signaturesHtml } from '../../supabase/functions/presence/lib/documents.ts';
import { contractPdf } from '../../supabase/functions/presence/lib/doc_pdf.ts';
import { describeSystemEvent } from '../../supabase/functions/presence/crm/deal_activity.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

// ═══ 1. the layout rules ═══
{
  const body = `PROJECT AGREEMENT

This Project Agreement is entered into between Brightline Studio ("Studio") and Corner Café ("Client").

1. SCOPE OF WORK

Studio designs and builds the pages described in the proposal.
Anything else is quoted first.

2. PAYMENT TERMS

(a) $1,600 when this agreement is signed.
(b) $1,600 by Dec 15, 2026.
- the rest when the site goes live

11. Severability.  If any provision is held invalid, the remainder stands.

THE SITE BUILD

Studio:         Brightline Studio
Client:         Corner Café

3. The client pays within 14 days.`;
  const b = agreementBlocks(body);
  ok('title: the first line in capitals', b[0].t === 'title' && b[0].text === 'PROJECT AGREEMENT');
  ok('numbered heading', b.some((x) => x.t === 'heading' && x.n === '1' && x.text === 'SCOPE OF WORK'));
  ok('lines that follow one another are one paragraph, line break kept', b.some((x) => x.t === 'para' && x.text === 'Studio designs and builds the pages described in the proposal.\nAnything else is quoted first.'));
  ok('lettered and dashed list items', b.filter((x) => x.t === 'item').map((x) => x.mark).join(',') === '(a),(b),•');
  ok('"11. Severability.  If any…" → the heading and its words', b.some((x) => x.t === 'heading' && x.n === '11' && x.text === 'Severability') && b.some((x) => x.t === 'para' && x.text.startsWith('If any provision is held invalid')));
  ok('a short line in capitals is a heading without a number', b.some((x) => x.t === 'heading' && x.n === null && x.text === 'THE SITE BUILD'));
  ok('a summary keeps its rows', b.some((x) => x.t === 'para' && x.text === 'Studio:         Brightline Studio\nClient:         Corner Café'));
  ok('a numbered sentence stays a paragraph, word for word', b.some((x) => x.t === 'para' && x.text === '3. The client pays within 14 days.'));
  ok('headings get their own ids, numbering may restart', new Set(agreementContents(b).map((h) => h.id)).size === agreementContents(b).length);
  ok('no word is lost or moved', squash(agreementWords(b)).replace(/\(a\) |\(b\) |• /g, '').replace(/^/, '') === squash(body).replace(/\(a\) |\(b\) |- /g, '').replace(/11\. Severability\. /, '11. Severability '));
  ok('empty text → nothing', agreementBlocks('').length === 0 && agreementBlocks(null).length === 0);
  const html = agreementHtml('1. <SCRIPT>\n\nA & B <i>');
  ok('html: escaped, with the number marked', html.includes('&lt;SCRIPT&gt;') && html.includes('A &amp; B &lt;i&gt;') && html.includes('<span class="ag-n">1.</span>'));
  ok('html for email: every style inline', /style="/.test(agreementHtml('1. SCOPE\n\nWords.', { email: true })) && !/style="/.test(agreementHtml('1. SCOPE\n\nWords.')));
}

// ═══ 2. the studio's own agreements lay out cleanly, every word kept ═══
{
  const pipe = read('pipeline.html');
  const m = pipe.match(/const DDS_AGREEMENT_LEGAL=`([\s\S]*?)`;/);
  ok('the studio agreement text was found', !!m);
  if (m) {
    const legal = m[1];
    const b = agreementBlocks(legal);
    const heads = b.filter((x) => x.t === 'heading' && x.n);
    ok('the legal terms: a title and numbered sections 1 onward', b[0].t === 'title' && b[0].text === 'PROJECT AGREEMENT' && heads.length >= 15 && heads[0].n === '1' && heads[0].text === 'SCOPE OF WORK');
    ok('section 11 is "Severability", its words after', heads.some((h) => h.n === '11' && h.text === 'Severability'));
    const words = (s) => squash(s).replace(/[(]?[a-z][)]\s|•\s|-\s/g, '').split(' ').filter(Boolean);
    const inW = words(legal).join(' '), outW = words(agreementWords(b)).join(' ').replace(/(\d+)\. (\S+)/g, '$1. $2');
    ok('every word of the legal terms is still there', outW.replace(/\./g, '').length >= inW.replace(/\./g, '').length - 40, `${inW.length} vs ${outW.length}`);
  }
}

// ═══ 3. the small rules ═══
{
  ok('reasons: four, and nothing else counts', Object.keys(DECLINE_REASONS).join(',') === 'price,timing,scope,elsewhere' && declineReason('timing') === 'timing' && declineReason('bogus') === '' && declineReason({}) === '');
  ok('decline words', declineWords('timing', 'Spring would work') === 'The timing: “Spring would work”' && declineWords('price', '') === 'The price' && declineWords('', 'Too soon') === '“Too soon”' && declineWords('', '') === '');
  ok('question subject', askSubject('proposal', 'Website refresh') === 'A question about the proposal: Website refresh' && askSubject('contract', '') === 'A question about the agreement');
  ok('masked email', maskEmail('sam@cornercafe.com') === 's…@cornercafe.com' && maskEmail('') === '' && maskEmail('nope') === '');
  ok('signer email', validSignerEmail('sam@cornercafe.com') && !validSignerEmail('') && !validSignerEmail('sam@') && !validSignerEmail('a'.repeat(160) + '@x.com'));
  const sg = studioSignerOf({ signsAsName: '', ownerName: 'Alex Rivera', business: 'Brightline Studio', signsAsTitle: 'Owner' });
  ok('who signs: the setting, else the owner, else the business', sg.name === 'Alex Rivera' && sg.title === 'Owner' && studioSignerOf({ signsAsName: 'Jo Park', ownerName: 'Alex' }).name === 'Jo Park' && studioSignerOf({ business: 'Brightline Studio' }).name === 'Brightline Studio');
}

// ═══ 4. the signed document, page and PDF, shows both signatures ═══
{
  const c = { status: 'signed', title: 'Website refresh', body: 'PROJECT AGREEMENT\n\n1. SCOPE OF WORK\n\nWords.', content_hash: 'abc123', signer_name: 'Sam Lee', signer_email: 'sam@example.com', signed_at: '2026-11-11T23:42:07Z', countersigned_name: 'Alex Rivera', countersigned_title: 'Owner', countersigned_at: '2026-11-11T23:42:07Z', signed_evidence: { hash: 'abc123' } };
  const brand = { name: 'Brightline Studio', accent: '#5b3fa0', accentDark: '#3a2470' };
  const page = renderContractDocument(c, brand, { billTo: { company: 'Corner Café' } });
  ok('page: laid out, both signatures, the countersignature in the certificate', page.includes('class="agreement"') && page.includes('<span class="ag-n">1.</span>SCOPE OF WORK') && page.includes('For Corner Café') && page.includes('For Brightline Studio')
    && page.includes('Alex Rivera, Owner') && page.includes('Countersigned by</span><span>Alex Rivera, Owner for Brightline Studio'));
  ok('page: an older signature without a countersignature shows the client\'s alone', !signaturesHtml({ ...c, countersigned_name: '' }, brand, null).includes('For Brightline Studio'));
  const pdf = new TextDecoder('latin1').decode(contractPdf(c, brand, { billTo: { company: 'Corner Café' } }));
  ok('pdf: the headings, both signatures and the countersignature', pdf.includes('(1. SCOPE OF WORK) Tj') && pdf.includes('SIGNATURES') && pdf.includes('Alex Rivera') && pdf.includes('Countersigned by: Alex Rivera, Owner for Brightline Studio'));
}

// ═══ 5. the history lines ═══
{
  ok('history: a decline says why', describeSystemEvent({ kind: 'proposal_decided', detail: { decision: 'declined', reason: 'timing', note: 'Spring?' } }) === 'Proposal declined — The timing: “Spring?”' && describeSystemEvent({ kind: 'proposal_decided', detail: { decision: 'declined' } }) === 'Proposal declined');
  ok('history: a signature names the countersigner', describeSystemEvent({ kind: 'contract_signed', detail: { signer: 'Sam Lee', countersigned_by: 'Alex Rivera' } }) === 'Agreement signed — Sam Lee, countersigned by Alex Rivera');
  ok('history: a question reads as one, cut at 140', describeSystemEvent({ kind: 'client_question', detail: { on: 'contract', text: 'Can we start in May?' } }) === 'They asked about the agreement: “Can we start in May?”' && describeSystemEvent({ kind: 'client_question', detail: { text: 'x'.repeat(200) } }).endsWith('…”'));
  const pipe = read('pipeline.html');
  const src = (name) => { const mm = pipe.match(new RegExp('function ' + name + '\\([^)]*\\)\\{.*?\\n', 's')); return mm ? mm[0] : ''; };
  const mirror = new Function('DECLINE_REASONS', src('declineWords') + ';return declineWords;')(DECLINE_REASONS);
  ok('pipeline.html mirrors declineWords', [['timing', 'Spring'], ['price', ''], ['', 'x'], ['', '']].every(([r, n]) => mirror(r, n) === declineWords(r, n)));
  ok('pipeline.html: the same three history lines', pipe.includes("'Proposal declined'+(declineWords(d.reason,d.note)?' — '+declineWords(d.reason,d.note):'')") && pipe.includes("(d.countersigned_by?', countersigned by '+d.countersigned_by:'')") && pipe.includes("if(e.kind==='client_question')"));
}

// ═══ 6. the routes ═══
{
  const sales = read('supabase/functions/presence/routes/sales.ts');
  ok('decide: the reason is stored (and rides the note before 0176)', /const reason = decision === 'declined' \? declineReason\(b\.reason\) : '';/.test(sales) && /decided_reason: reason/.test(sales) && /decided_note: declineWords\(reason, note\)\.slice\(0, 500\)/.test(sales));
  ok('decide: the studio is emailed once, with what would make it a yes', /const fresh = st\?\.client_id \? await raiseNotice\(/.test(sales) && /if \(fresh\) \{[\s\S]{0,400}await emailOperator\(tok\.site_id, `They passed on the proposal/.test(sales));
  ok('sign: the email is required', /if \(!validSignerEmail\(signerEmail\)\) return json\(\{ error: 'email_needed'/.test(sales));
  ok('sign: the countersignature goes in the same write, same moment; without 0176 the signature still stands', /countersigned_name: counter\.name, countersigned_title: counter\.title, countersigned_at: signedAt/.test(sales) && /if \(!up\.ok && up\.status === 400 && counter && counter\.name\) up = await svc\(signUrl/.test(sales));
  ok('the page learns who signs for the studio, and where an answer goes', /studio_signer: signer, ask \}/.test(sales) && /studio_signer: cSigner, ask: cAsk/.test(sales));
  const ans = read('supabase/functions/presence/routes/proposal_answers.ts');
  ok('ask: rate-limited by address and by deal, a double tap lands once', /rateAllow\(`sales_ask:\$\{clientIp\(req\)\}`, 6, 600\)/.test(ans) && /rateAllow\(`sales_ask_deal:\$\{about\.dealId\}`, 12, 86400\)/.test(ans) && /isUniqueViolation\(ins\)\) return json\(\{ data: \{ sent: true, already: true \} \}/.test(ans));
  ok('ask: a support request from the deal\'s person, the deal\'s history, and the studio told', /requester: email, requester_kind: 'client'/.test(ans) && /dealEvent\(siteId, about\.dealId, 'client_question'/.test(ans) && /notifyStudioOfClientAction\(\{/.test(ans));
  ok('index.ts: POST /sales/ask is public, beside decide and sign', /if \(route === '\/sales\/ask' && method === 'POST'\) return \(await import\('\.\/routes\/proposal_answers\.ts'\)\)\.handleSalesAsk\(req, cors\);/.test(read('supabase/functions/presence/index.ts')));
  const mig = read('supabase/migrations/0176_proposal_answers_signed_by_both.sql');
  ok('0176: the columns, and the kind list carries 0167\'s plus client_question', /decided_reason text not null default ''/.test(mig) && /countersigned_at timestamptz/.test(mig) && /signs_as_name text not null default ''/.test(mig) && /'payment_undone',\s*-- added by 0176:\s*'client_question'/.test(mig));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ AGREEMENT LAYOUT & ANSWERS: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
