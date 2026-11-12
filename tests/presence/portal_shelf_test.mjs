// ── The papers shelf in the client portal (builder list item 179, part four) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/portal_shelf_test.mjs
// The server half: every invoice on the shelf opens as the studio's branded copy,
// a receipt once it's paid; a withdrawn invoice opens nothing.
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const AGENCY = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
Deno.env.set('APPROVAL_SECRET', 'test-secret');
const CD = await import('../../supabase/functions/presence/routes/client_delivery.ts');
const { readDocToken } = await import('../../supabase/functions/presence/lib/documents.ts');

const SITE = { id: 'f0f0f0f0-0000-4000-8000-000000000000', client_id: CUSTOMER };
const realFetch = globalThis.fetch;
const jr = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
const inv = (id, status, over = {}) => ({ id, title: 'Invoice ' + id, description: '', amount_cents: 45000, status, due_date: '2099-01-01', paid_at: status === 'paid' ? '2026-10-02T00:00:00Z' : null, stripe_url: 'https://pay.example/x', created_at: '2026-10-01T00:00:00Z', site_id: AGENCY, ...over });
const ids = { paid: '0a000000-0000-4000-8000-000000000001', open: '0a000000-0000-4000-8000-000000000002', voided: '0a000000-0000-4000-8000-000000000003', nosite: '0a000000-0000-4000-8000-000000000004' };
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('presence_invoices')) return jr([inv(ids.paid, 'paid'), inv(ids.open, 'open'), inv(ids.voided, 'void'), inv(ids.nosite, 'open', { site_id: null })]);
  return jr([]);
};
const res = await CD.handleClientBilling(new Request('https://x/client/billing'), SITE, { kind: 'client' }, {});
const list = (await res.json()).data.invoices;
const by = (id) => list.find((i) => i.id === id);
const tokenOf = (u) => decodeURIComponent(new URL(u).searchParams.get('t') || '');
{
  const paid = by(ids.paid), open = by(ids.open);
  ok('shelf: a paid invoice opens as its receipt, an unpaid one as the invoice (doc.html)', /\/doc\.html\?t=/.test(paid.view_url || '') && /\/doc\.html\?t=/.test(open.view_url || ''));
  const tp = await readDocToken(tokenOf(paid.view_url), 'test-secret');
  ok('shelf: the link names exactly that invoice on the studio’s site', !!tp && tp.k === 'invoice' && tp.id === ids.paid && tp.site_id === AGENCY);
  ok('shelf: a withdrawn invoice opens nothing; one with no studio site opens nothing', by(ids.voided).view_url === null && by(ids.nosite).view_url === null);
  ok('shelf: paying still works as before (Pay only while waiting)', open.pay_url === 'https://pay.example/x' && paid.pay_url === null && by(ids.voided).pay_url === null);
  ok('shelf: the studio’s site id itself never travels', list.every((i) => !('site_id' in i)));
}
globalThis.fetch = realFetch;

// ── The page half: the shelf's pure helpers, mirrored verbatim from client.html
// (the checks below fail the moment the page's copy drifts). ──
function fmtMoney(n){n=Number(n)||0;return'$'+n.toLocaleString('en-US',{minimumFractionDigits:Number.isInteger(n)?0:2,maximumFractionDigits:2});}
const MONEY_WORD={paid:'Paid',processing:'Processing',upcoming:'Upcoming',overdue:'Overdue'};
function moneyState(i,todayYmd,pending){
  if(!i)return'';
  const s=String(i.status||'open');
  if(s==='paid')return'paid';
  if(s==='void'||s==='canceled')return'';
  if(i.processing_since||(pending&&pending.indexOf(String(i.id))>=0))return'processing';
  const m=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(i.due_date||''));
  return(m&&todayYmd&&m[0]<String(todayYmd))?'overdue':'upcoming';
}
const CLIENT_UPLOAD_NOTE='Uploaded by the client';
function isClientUpload(f){return !!f&&(f.client_upload===true||String(f.note||'').startsWith(CLIENT_UPLOAD_NOTE));}
function approvalForFile(approvals,fid){return (approvals||[]).find(a=>a&&a.subject_type==='deliverable'&&a.subject_id===fid)||null;}
function shelfDate(s){s=String(s||'');const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s);if(m)return new Date(+m[1],+m[2]-1,+m[3]);const t=Date.parse(s);return isFinite(t)?new Date(t):null;}
function shelfDay(s,now){const d=shelfDate(s);if(!d)return'';return d.toLocaleDateString('en-US',d.getFullYear()===now.getFullYear()?{month:'short',day:'numeric'}:{month:'short',day:'numeric',year:'numeric'});}
function shelfMonth(s,now){const d=shelfDate(s);if(!d)return'Earlier';return d.toLocaleDateString('en-US',d.getFullYear()===now.getFullYear()?{month:'long'}:{month:'long',year:'numeric'});}
function shelfUrl(u){u=String(u||'');return /^(https:\/\/|\/(?!\/))/i.test(u)?u:'';}
function shelfRows(invoices,docs,snaps,todayYmd,pending,now){
  const rows=[];
  for(const i of (invoices||[])){
    if(!i||!i.id)continue;
    const st=moneyState(i,todayYmd,pending);const amt=i.amount?fmtMoney(i.amount):'';
    const pay=(st==='upcoming'||st==='overdue')&&/^https:\/\//.test(String(i.pay_url||''))?i.pay_url:'';
    const view=shelfUrl(i.view_url);
    const info=[amt,st==='paid'?(i.paid_at?'paid '+shelfDay(i.paid_at,now):'paid'):st==='processing'?'':st?(i.due_date?'due '+shelfDay(i.due_date,now):''):'withdrawn'].filter(Boolean).join(' · ');
    const act=st==='paid'?(view?{verb:'Receipt',href:view}:null):st==='processing'?{note:'processing',inv:i}:!st?null:pay?{verb:'Pay',href:pay,pay:true}:view?{verb:'View',href:view}:{note:'details'};
    rows.push({cat:'invoices',kind:'Invoice',title:i.name||'Invoice',info,when:String(i.created_at||i.due_date||''),chip:st?MONEY_WORD[st]:'Voided',tone:st==='paid'?'sig':st==='overdue'?'od':st==='processing'?'pr':st?'':'mute',act});
  }
  for(const d of (docs||[])){
    if(!d||!d.id)continue;
    const view=shelfUrl(d.view_url);const amt=d.amount?fmtMoney(d.amount):'';
    if(d.kind==='contract'){
      const signed=!!d.signed_at||d.status==='signed';
      rows.push({cat:'agreements',kind:'Agreement',title:d.title||'Agreement',info:signed?'signed '+shelfDay(d.signed_at||d.created_at,now):'waiting for your signature',when:String(d.created_at||''),
        chip:signed?'Signed':'Your signature',tone:signed?'sig':'ask',act:view?{verb:signed?'View':'Look',href:view}:null});
      continue;
    }
    const est=d.kind==='estimate';const st=String(d.status||'sent');
    const yes=est?st==='approved':st==='accepted',no=st==='declined',old=st==='superseded',open=!yes&&!no&&!old;
    rows.push({cat:'proposals',kind:est?'Estimate':'Proposal',title:d.title||(est?'Estimate':'Proposal'),
      info:[amt,yes?(est?'approved':'accepted'):no?(est?'not now':'declined'):old?'replaced by a newer one':'waiting for your OK'].filter(Boolean).join(' · '),when:String(d.created_at||''),
      chip:yes?(est?'Approved':'Accepted'):no?(est?'Not now':'Declined'):old?'Replaced':'Your OK',tone:yes?'sig':open?'ask':'mute',act:view?{verb:open?'Look':'View',href:view}:null});
  }
  for(const sn of (snaps||[])){
    if(!sn||sn.failed)continue;
    for(const f of (sn.deliverables||[])){
      if(!f||!f.id)continue;
      const mine=isClientUpload(f);const ap=approvalForFile(sn.approvals,f.id);   // a snapshot keeps only the approvals still waiting
      rows.push({cat:'files',kind:mine?'File you sent':'File from your studio',title:f.title||'File',info:mine?'You sent this':'From your studio',when:String(f.created_at||''),
        chip:ap?'Your OK':mine?'You shared':'',tone:ap?'ask':'you',act:ap?{verb:'Look',apr:ap.id,pid:sn.id}:{verb:'Save',dl:f.id}});
    }
  }
  rows.sort((a,b)=>b.when.localeCompare(a.when));   // newest first, across kinds
  return rows;
}
function shelfGroups(rows,now){const out=[];let cur=null;for(const r of (rows||[])){const m=shelfMonth(r.when,now);if(!cur||cur.month!==m){cur={month:m,rows:[]};out.push(cur);}cur.rows.push(r);}return out;}
function shelfCounts(rows){const c={all:0,invoices:0,proposals:0,agreements:0,files:0};for(const r of (rows||[])){c.all++;c[r.cat]=(c[r.cat]||0)+1;}return c;}
function shelfOwe(unpaid){
  const due=(unpaid||[]).filter(i=>i&&(Number(i.amount)||0)>0);if(!due.length)return null;
  const next=due.slice().sort((a,b)=>String(a.due_date||'9999').localeCompare(String(b.due_date||'9999')))[0];
  return {total:due.reduce((a,i)=>a+(Number(i.amount)||0),0),count:due.length,next};
}
const PAGE = Deno.readTextFileSync(new URL('../../client.html', import.meta.url));
for (const f of [fmtMoney, moneyState, isClientUpload, approvalForFile, shelfDate, shelfDay, shelfMonth, shelfUrl, shelfRows, shelfGroups, shelfCounts, shelfOwe]) {
  ok(`mirror: client.html defines ${f.name} verbatim`, PAGE.includes(String(f)));
}
ok('mirror: MONEY_WORD and CLIENT_UPLOAD_NOTE verbatim', PAGE.includes("const MONEY_WORD={paid:'Paid',processing:'Processing',upcoming:'Upcoming',overdue:'Overdue'};") && PAGE.includes("const CLIENT_UPLOAD_NOTE='Uploaded by the client';"));

const NOW = new Date(2026, 10, 11, 12, 0, 0), TODAY = '2026-11-11';
const row = (rows, title) => rows.find((r) => r.title === title);
{
  const invs = [
    { id: 'i1', name: 'Second half', amount: 450, status: 'open', due_date: '2026-11-14', created_at: '2026-11-04T15:00:00Z', pay_url: 'https://pay.example/i1', view_url: 'https://app.example/doc.html?t=1' },
    { id: 'i2', name: 'Late one', amount: 90, status: 'open', due_date: '2026-11-01', created_at: '2026-10-20T15:00:00Z', pay_url: 'https://pay.example/i2' },
    { id: 'i3', name: 'Settling', amount: 150, status: 'open', processing_since: '2026-11-10T00:00:00Z', due_date: '2026-11-20', created_at: '2026-11-02T15:00:00Z', pay_url: 'https://pay.example/i3' },
    { id: 'i4', name: 'Just paid here', amount: 75, status: 'open', due_date: '2026-11-20', created_at: '2026-11-03T15:00:00Z', pay_url: 'https://pay.example/i4' },
    { id: 'i5', name: 'Deposit', amount: 600, status: 'paid', paid_at: '2026-10-02T15:00:00Z', created_at: '2026-10-01T15:00:00Z', view_url: 'https://app.example/doc.html?t=5' },
    { id: 'i6', name: 'Paid, no copy', amount: 20, status: 'paid', created_at: '2026-09-01T15:00:00Z', view_url: 'javascript:alert(1)' },
    { id: 'i7', name: 'Withdrawn', amount: 50, status: 'void', created_at: '2026-09-02T15:00:00Z' },
    { id: 'i8', name: 'No link, a copy', amount: 30, status: 'open', due_date: '2026-12-01', created_at: '2026-09-03T15:00:00Z', pay_url: 'http://pay.example/plain', view_url: '/doc.html?t=8' },
    { id: 'i9', name: 'No link, no copy', amount: 30, status: 'open', due_date: '2026-12-01', created_at: '2026-09-04T15:00:00Z' },
  ];
  const r = shelfRows(invs, [], [], TODAY, ['i4'], NOW);
  const a = row(r, 'Second half');
  ok('invoice: waiting → Upcoming, Pay in this tab, "$450 · due Nov 14"', a.chip === 'Upcoming' && a.tone === '' && a.act.verb === 'Pay' && a.act.pay === true && a.act.href === 'https://pay.example/i1' && a.info === '$450 · due Nov 14' && a.kind === 'Invoice' && a.cat === 'invoices');
  ok('invoice: past due → Overdue (the warning tone), still Pay', row(r, 'Late one').chip === 'Overdue' && row(r, 'Late one').tone === 'od' && row(r, 'Late one').act.verb === 'Pay');
  ok('invoice: a payment settling → Processing, never Pay, the confirming note', row(r, 'Settling').chip === 'Processing' && row(r, 'Settling').tone === 'pr' && row(r, 'Settling').act.note === 'processing' && row(r, 'Settling').info === '$150');
  ok('invoice: one this browser just paid → Processing too (no second charge)', row(r, 'Just paid here').chip === 'Processing' && row(r, 'Just paid here').act.note === 'processing');
  const d = row(r, 'Deposit');
  ok('invoice: paid → Paid, the receipt, "$600 · paid Oct 2"', d.chip === 'Paid' && d.tone === 'sig' && d.act.verb === 'Receipt' && d.act.href === 'https://app.example/doc.html?t=5' && !d.act.pay && d.info === '$600 · paid Oct 2');
  ok('invoice: a copy link that is not the studio’s https page opens nothing', row(r, 'Paid, no copy').act === null);
  ok('invoice: withdrawn → Voided, quiet, nothing to do', row(r, 'Withdrawn').chip === 'Voided' && row(r, 'Withdrawn').tone === 'mute' && row(r, 'Withdrawn').act === null && row(r, 'Withdrawn').info === '$50 · withdrawn');
  ok('invoice: no https pay link but a copy → View (a plain-http pay link is never offered)', row(r, 'No link, a copy').act.verb === 'View' && row(r, 'No link, a copy').act.href === '/doc.html?t=8');
  ok('invoice: no pay link and no copy → the payment-details note', row(r, 'No link, no copy').act.note === 'details');
}
{
  const docs = [
    { kind: 'contract', id: 'c1', title: 'Website agreement', status: 'signed', signed_at: '2026-09-03T18:00:00Z', created_at: '2026-09-03T16:00:00Z', view_url: 'https://app.example/doc.html?t=c1' },
    { kind: 'contract', id: 'c2', title: 'Care agreement', status: 'sent', created_at: '2026-10-10T16:00:00Z', view_url: 'https://app.example/doc.html?t=c2' },
    { kind: 'proposal', id: 'p1', title: 'Your new website', status: 'accepted', amount: 2400, created_at: '2026-09-03T15:00:00Z', view_url: 'https://app.example/doc.html?t=p1' },
    { kind: 'proposal', id: 'p2', title: 'Care plan', status: 'sent', amount: 0, created_at: '2026-10-11T15:00:00Z', view_url: 'https://app.example/doc.html?t=p2' },
    { kind: 'proposal', id: 'p3', title: 'Old idea', status: 'declined', created_at: '2026-08-01T15:00:00Z', view_url: 'https://app.example/doc.html?t=p3' },
    { kind: 'proposal', id: 'p4', title: 'First draft', status: 'superseded', created_at: '2026-08-02T15:00:00Z' },
    { kind: 'estimate', id: 'e1', title: 'Spring refresh', status: 'sent', amount: 1200, created_at: '2026-10-21T15:00:00Z', view_url: 'https://app.example/doc.html?t=e1' },
    { kind: 'estimate', id: 'e2', title: 'Logo', status: 'approved', amount: 300, created_at: '2026-10-22T15:00:00Z', view_url: 'https://app.example/doc.html?t=e2' },
    { kind: 'estimate', id: 'e3', title: 'Signage', status: 'declined', amount: 80, created_at: '2026-10-23T15:00:00Z' },
  ];
  const r = shelfRows([], docs, [], TODAY, [], NOW);
  const s1 = row(r, 'Website agreement'), s2 = row(r, 'Care agreement');
  ok('agreement: signed → Signed, View, "signed Sep 3"', s1.cat === 'agreements' && s1.kind === 'Agreement' && s1.chip === 'Signed' && s1.tone === 'sig' && s1.act.verb === 'View' && s1.info === 'signed Sep 3');
  ok('agreement: waiting → Your signature, Look', s2.chip === 'Your signature' && s2.tone === 'ask' && s2.act.verb === 'Look' && s2.info === 'waiting for your signature');
  ok('proposal: accepted → Accepted, "$2,400 · accepted", View', row(r, 'Your new website').chip === 'Accepted' && row(r, 'Your new website').info === '$2,400 · accepted' && row(r, 'Your new website').act.verb === 'View' && row(r, 'Your new website').cat === 'proposals');
  ok('proposal: waiting → Your OK, Look; no amount, no "$0"', row(r, 'Care plan').chip === 'Your OK' && row(r, 'Care plan').tone === 'ask' && row(r, 'Care plan').act.verb === 'Look' && row(r, 'Care plan').info === 'waiting for your OK');
  ok('proposal: declined and replaced read quietly', row(r, 'Old idea').chip === 'Declined' && row(r, 'Old idea').tone === 'mute' && row(r, 'First draft').chip === 'Replaced' && row(r, 'First draft').act === null);
  ok('estimate: waiting → Your OK with its amount; approved → Approved; declined → Not now', row(r, 'Spring refresh').kind === 'Estimate' && row(r, 'Spring refresh').chip === 'Your OK' && row(r, 'Spring refresh').info === '$1,200 · waiting for your OK'
    && row(r, 'Logo').chip === 'Approved' && row(r, 'Logo').tone === 'sig' && row(r, 'Signage').chip === 'Not now' && row(r, 'Signage').info === '$80 · not now');
}
{
  const snaps = [
    { id: 'p1', name: 'Website build', approvals: [{ id: 'ap1', subject_type: 'deliverable', subject_id: 'f3', status: 'pending' }], deliverables: [
      { id: 'f1', title: 'Homepage mockup.png', note: '', created_at: '2026-11-03T15:00:00Z' },
      { id: 'f2', title: 'Kitchen photos.jpg', note: 'Uploaded by the client. Filed.', created_at: '2026-10-15T15:00:00Z' },
      { id: 'f3', title: 'Logo options.pdf', note: '', created_at: '2026-10-16T15:00:00Z' },
    ] },
    { id: 'p2', name: 'Broken', failed: true, approvals: [], deliverables: [{ id: 'fx', title: 'never shown' }] },
  ];
  const r = shelfRows([], [], snaps, TODAY, [], NOW);
  ok('file: from the studio → Save (download)', row(r, 'Homepage mockup.png').kind === 'File from your studio' && row(r, 'Homepage mockup.png').act.verb === 'Save' && row(r, 'Homepage mockup.png').act.dl === 'f1' && row(r, 'Homepage mockup.png').chip === '');
  ok('file: one you sent → "File you sent", You shared', row(r, 'Kitchen photos.jpg').kind === 'File you sent' && row(r, 'Kitchen photos.jpg').chip === 'You shared');
  ok('file: waiting for your OK → Your OK, Look opens the approval in place', row(r, 'Logo options.pdf').chip === 'Your OK' && row(r, 'Logo options.pdf').act.apr === 'ap1' && row(r, 'Logo options.pdf').act.pid === 'p1');
  ok('file: a project that failed to load adds nothing (its line says so instead)', !row(r, 'never shown') && r.length === 3);
}
{
  const r = shelfRows(
    [{ id: 'i1', name: 'Nov invoice', amount: 10, status: 'open', due_date: '2026-11-30', created_at: '2026-11-04T15:00:00Z' }],
    [{ kind: 'proposal', id: 'p', title: 'Sep proposal', status: 'sent', created_at: '2026-09-03T15:00:00Z' }, { kind: 'proposal', id: 'q', title: 'Last year', status: 'sent', created_at: '2025-12-20T15:00:00Z' }],
    [{ id: 'p1', name: 'P', approvals: [], deliverables: [{ id: 'f', title: 'Oct file', created_at: '2026-10-05T15:00:00Z' }, { id: 'g', title: 'Undated file' }] }],
    TODAY, [], NOW);
  ok('order: newest first across kinds, undated last', r.map((x) => x.title).join('|') === 'Nov invoice|Oct file|Sep proposal|Last year|Undated file');
  const g = shelfGroups(r, NOW);
  ok('months: this year by name, another year with its year, undated under Earlier', g.map((x) => x.month).join('|') === 'November|October|September|December 2025|Earlier' && g[0].rows.length === 1);
  const c = shelfCounts(r);
  ok('counts: per filter and in all', c.all === 5 && c.invoices === 1 && c.proposals === 2 && c.files === 2 && c.agreements === 0);
}
{
  ok('owe: nothing unpaid → no card', shelfOwe([]) === null && shelfOwe(null) === null && shelfOwe([{ id: 'z', amount: 0 }]) === null);
  const o = shelfOwe([{ id: 'a', name: 'A', amount: 100, due_date: '2026-12-01' }, { id: 'b', name: 'B', amount: 50.5, due_date: '2026-11-20' }, { id: 'c', name: 'C', amount: 10 }]);
  ok('owe: the total, how many, and the one due first (undated last)', o.total === 160.5 && o.count === 3 && o.next.id === 'b');
}
{
  const d = shelfDate('2026-11-14');
  ok('dates: a bare day is that day on the client’s calendar', d.getFullYear() === 2026 && d.getMonth() === 10 && d.getDate() === 14 && d.getHours() === 0);
  ok('dates: nothing, or nonsense, is no date', shelfDate('') === null && shelfDate('soon') === null && shelfDay('', NOW) === '' && shelfMonth('', NOW) === 'Earlier');
  ok('links: the studio’s https pages and same-site paths only', shelfUrl('https://a.example/x') === 'https://a.example/x' && shelfUrl('/doc.html?t=1') === '/doc.html?t=1'
    && shelfUrl('//evil.example/x') === '' && shelfUrl('http://a.example') === '' && shelfUrl('javascript:alert(1)') === '' && shelfUrl(null) === '');
}
const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
if (failed) Deno.exit(1);
