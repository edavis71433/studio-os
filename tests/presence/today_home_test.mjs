// ── Slice 10: the Today/Home redesign (both sides) — pure helpers + pins ─────
//   deno run --allow-read tests/presence/today_home_test.mjs
// The studio's Lightning Home (today.html) and the portal Home (client.html)
// gained pure helpers that live inline in each page (no bundler to import
// from). They are mirrored here 1:1, the portal_ux_test.mjs way — keep both
// copies in sync. Structural pins lock the deploy-order-tolerant wiring: the
// This-month card renders ONLY from real /analytics/dashboard sections (no
// fake zeros), the schedule reads /bookings/appointments per-row in the SITE's
// timezone with a dormant-vs-transient split (404/403 hides the card; a 5xx
// says couldn't-check), recents render as-cached with data-noscope, and the
// portal glance strip hides any tile whose source read FAILED.

// ── mirrors (verbatim) of the pure helpers in today.html ──
function greet(h){h=h==null?new Date().getHours():h;return h<12?'Good morning.':h<18?'Good afternoon.':'Good evening.';}
function dateLine(nowMs){return new Date(nowMs==null?Date.now():nowMs).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});}
const money=(c)=>'$'+((c||0)/100).toLocaleString(undefined,{maximumFractionDigits:0});
function monthTiles(d){
  d=d||{};const s=d.sales||{};const w=d.website||{};const t=[];
  // D3 sibling: the number is summed EXPECTED deal value — the label says so.
  if(s.won&&s.won.this_month)t.push([money(s.won.this_month.value_cents),'expected value won']);
  if(s.pipeline&&s.pipeline.open)t.push([money(s.pipeline.open.value_cents),'open pipeline']);
  if(s.enquiries&&s.enquiries.count!=null)t.push([String(s.enquiries.count),s.enquiries.count===1?'new enquiry':'new enquiries']);
  if(w.traffic&&w.traffic.has_data!==false&&w.traffic.visitors!=null)t.push([String(w.traffic.visitors),'site visitors']);
  return t;
}
function monthTrend(s){
  const won=(s&&s.won)||null;if(!won||!won.this_month||!won.last_month)return'';
  const a=won.this_month.value_cents||0,b=won.last_month.value_cents||0;
  if(!a&&!b)return'';
  return a>b?'Ahead of last month on won work.':a<b?'A quieter month than last, so far.':'Level with last month, so far.';
}
function siteYmd(tz,nowMs){if(tz){try{return new Intl.DateTimeFormat('en-CA',{timeZone:String(tz)}).format(new Date(nowMs==null?Date.now():nowMs));}catch(_){/* unknown zone → browser-local */}}return localYmd(nowMs);}
function todaySlots(list,nowMs){return(Array.isArray(list)?list:[]).filter(a=>a&&String(a.slot_start_local||'').slice(0,10)===siteYmd(a.timezone,nowMs)&&(a.status==='pending'||a.status==='confirmed')).sort((a,b)=>String(a.slot_start_local).localeCompare(String(b.slot_start_local))).slice(0,6);}
function slotTime(s){const m=/T(\d\d):(\d\d)/.exec(String(s||''));if(!m)return'';let h=+m[1];const ap=h>=12?'pm':'am';h=h%12||12;return h+':'+m[2]+' '+ap;}
function localYmd(nowMs){const d=new Date(nowMs==null?Date.now():nowMs);return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
function safeRecents(a){return Array.isArray(a)?a.filter(function(r){return r&&r.label&&typeof r.href==='string'&&/^\/(?![/\\])/.test(r.href);}).slice(0,5):[];}

// ── mirrors (verbatim) of the pure helpers in client.html ──
function unpaidInvoices(b){return ((b&&b.invoices)||[]).filter(i=>i&&i.status!=='paid'&&i.status!=='void'&&i.status!=='canceled');}
function portalGreeting(h,name){const g=h<12?'Good morning':h<18?'Good afternoon':'Good evening';return g+(name?', '+name:'')+'.';}
function snapWaiting(s){return((s&&s.approvals)||[]).length+((s&&s.todos)||[]).length;}
function glanceData(feed,snaps,notifs,billing,projects,failed){
  failed=failed||{};
  const needsOk=(failed.feed||failed.snaps)?null:((feed&&feed.pending_approvals)||[]).length+(snaps||[]).reduce((a,s)=>a+snapWaiting(s),0);
  const newMsgs=failed.notifs?null:(notifs||[]).filter(n=>n&&!n.read&&n.kind==='message').length;
  // a FAILED billing read hides the to-pay tile BY CONTRACT — never because a
  // failed read's dueTotal happened to compute 0 (a fake $0 is still a lie)
  const dueTotal=failed.billing?0:unpaidInvoices(billing).reduce((a,i)=>a+(Number(i&&i.amount)||0),0);
  const p=(projects||[]).find(x=>x&&x.status==='active')||(projects||[])[0]||null;
  return{needsOk,newMsgs,due:dueTotal>0?'$'+dueTotal.toLocaleString('en-US'):'',project:p?{status:String(p.status||'').replace(/_/g,' '),name:p.name||'Your project'}:null};
}
function glanceTiles(g){
  g=g||{};const t=[];
  if(g.needsOk!=null)t.push({id:'glance-ok',n:String(g.needsOk),l:g.needsOk===1?'needs your OK':'need your OK'});
  if(g.newMsgs!=null)t.push({id:'glance-msgs',n:String(g.newMsgs),l:g.newMsgs===1?'new message':'new messages'});
  if(g.due)t.push({id:'glance-due',n:g.due,l:'to pay'});
  if(g.project)t.push({id:'glance-proj',n:g.project.status,l:g.project.name});
  return(g.needsOk!=null||g.newMsgs!=null)?t:[];
}

const results=[];
const ok=(n,p)=>{results.push({n,p});console.log(`${p?'PASS':'FAIL'}  ${n}`);};

// ═══ greet — the studio greeting's time-of-day boundaries (X5 mirror) ═══
// 11:59 is still h=11 (morning) and 12:00 flips to afternoon; 17:59 is h=17
// (afternoon) and 18:00 flips to evening — same frame as portalGreeting.
ok('greet: morning through 11, afternoon from 12 through 17, evening from 18',
  greet(0)==='Good morning.' && greet(11)==='Good morning.'
  && greet(12)==='Good afternoon.' && greet(17)==='Good afternoon.'
  && greet(18)==='Good evening.' && greet(23)==='Good evening.');

// ═══ monthTiles — a tile exists only when its dashboard section does ═══
const FULL_DASH={sales:{
  won:{this_month:{count:2,value_cents:385000},last_month:{count:1,value_cents:145000}},
  pipeline:{open:{count:7,value_cents:1240000},stages:[]},
  enquiries:{count:9,unanswered:3},
},website:{traffic:{visitors:214,has_data:true}}};
{
  const t=monthTiles(FULL_DASH);
  ok('tiles: a full dashboard yields all four (won · pipeline · enquiries · visitors)',
    t.length===4 && t[0][1]==='expected value won' && t[1][1]==='open pipeline'
    && t[2][0]==='9' && t[2][1]==='new enquiries' && t[3][0]==='214' && t[3][1]==='site visitors');
  ok('tiles: money renders from cents with a $ and no decimals',
    t[0][0].replace(/,/g,'')==='$3850' && t[1][0].replace(/,/g,'')==='$12400' && money(0)==='$0');
}
ok('tiles: null sections drop their tiles — never a fake zero',
  monthTiles({sales:{won:null,pipeline:null,enquiries:null},website:{traffic:null}}).length===0
  && monthTiles({})?.length===0 && monthTiles(null).length===0);
ok('tiles: has_data:false traffic drops the visitors tile (slice-8 discipline)',
  monthTiles({sales:{},website:{traffic:{visitors:0,has_data:false}}}).length===0
  && monthTiles({sales:{},website:{traffic:{visitors:0,has_data:true}}}).length===1);
ok('tiles: one enquiry reads singular',
  monthTiles({sales:{enquiries:{count:1}},website:{}})[0][1]==='new enquiry');

// ═══ monthTrend — only from two REAL months ═══
ok('trend: ahead / behind / level from real month pairs',
  monthTrend(FULL_DASH.sales)==='Ahead of last month on won work.'
  && monthTrend({won:{this_month:{value_cents:100},last_month:{value_cents:900}}})==='A quieter month than last, so far.'
  && monthTrend({won:{this_month:{value_cents:500},last_month:{value_cents:500}}})==='Level with last month, so far.');
ok('trend: a missing month (or two silent zeros) says nothing',
  monthTrend(null)==='' && monthTrend({won:{this_month:{value_cents:100}}})===''
  && monthTrend({won:{this_month:{value_cents:0},last_month:{value_cents:0}}})==='');

// ═══ todaySlots / siteYmd — the schedule card's day view, per-row timezone ═══
const NOW=Date.UTC(2026,6,18,12,0,0);   // a fixed instant: 2026-07-18T12:00Z
const ymdIn=(tz)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz}).format(new Date(NOW));
const HERE=localYmd(NOW);               // the host-local calendar date at NOW
const nextDay=(ymd)=>{const d=new Date(ymd+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);};
const APPTS=[
  {slot_start_local:HERE+'T14:30',status:'confirmed',type_name:'Strategy call'},
  {slot_start_local:HERE+'T09:00',status:'pending',type_name:'Intro'},
  {slot_start_local:nextDay(HERE)+'T10:00',status:'confirmed',type_name:'Tomorrow'},
  {slot_start_local:HERE+'T11:00',status:'canceled',type_name:'Gone'},
];
{
  const s=todaySlots(APPTS,NOW);
  ok('slots: only today, only pending/confirmed, sorted by start time',
    s.length===2 && s[0].type_name==='Intro' && s[1].type_name==='Strategy call');
  ok('slots: junk input yields an empty day, never a throw',
    todaySlots(null,NOW).length===0 && todaySlots([null,{}],NOW).length===0);
  ok('slots: the day is capped at six rows',
    todaySlots(Array.from({length:9},(_,i)=>({slot_start_local:HERE+'T0'+(i%10)+':00',status:'confirmed'})),NOW).length===6);
  ok('time: 12-hour labels with am/pm, and a blank for malformed input',
    slotTime('2026-07-18T09:05')==='9:05 am' && slotTime('2026-07-18T14:30')==='2:30 pm'
    && slotTime('2026-07-18T00:15')==='12:15 am' && slotTime('2026-07-18T12:00')==='12:00 pm' && slotTime('garbage')==='');
}
// T1: each row is judged in its OWN site timezone. Kiritimati (UTC+14) and
// Etc/GMT+12 (UTC-12) sit 26 hours apart, so no host timezone can share a
// calendar date with both — the site's date decides, never the viewer's.
{
  const KIRI=ymdIn('Pacific/Kiritimati'), WEST=ymdIn('Etc/GMT+12');
  const names=todaySlots([
    {slot_start_local:KIRI+'T10:00',timezone:'Pacific/Kiritimati',status:'confirmed',type_name:'kiri-today'},
    {slot_start_local:nextDay(KIRI)+'T10:00',timezone:'Pacific/Kiritimati',status:'confirmed',type_name:'kiri-tomorrow'},
    {slot_start_local:WEST+'T11:00',timezone:'Etc/GMT+12',status:'confirmed',type_name:'west-today'},
    {slot_start_local:HERE+'T12:00',timezone:'No/Such_Zone',status:'confirmed',type_name:'bad-zone'},
  ],NOW).map(a=>a.type_name);
  ok('slots: a row is "today" by ITS site\'s calendar date, not the viewer\'s',
    names.includes('kiri-today') && names.includes('west-today') && !names.includes('kiri-tomorrow'));
  ok('slots: an invalid timezone falls back to the browser-local date',
    names.includes('bad-zone'));
  ok('siteYmd: real zones format YYYY-MM-DD; missing/invalid fall back to localYmd',
    /^\d{4}-\d{2}-\d{2}$/.test(KIRI) && siteYmd('Pacific/Kiritimati',NOW)===KIRI && KIRI!==WEST
    && siteYmd(undefined,NOW)===localYmd(NOW) && siteYmd('No/Such_Zone',NOW)===localYmd(NOW));
}
ok('ymd/date: localYmd and dateLine are well-formed for any instant',
  /^\d{4}-\d{2}-\d{2}$/.test(localYmd()) && /^[A-Z][a-z]+, [A-Z][a-z]+ \d{1,2}$/.test(dateLine()));

// ═══ safeRecents — the same strict guard shell.js applies on read ═══
ok('recents: same-origin-path hrefs only — protocol-relative and backslash tricks are dropped',
  safeRecents([{label:'A',href:'/crm.html?client=x'},{label:'B',href:'//evil.example'},{label:'C',href:'/\\evil'},{label:'D',href:'https://evil.example'},{label:'',href:'/x'},null]).length===1);
ok('recents: capped at five, non-arrays yield empty',
  safeRecents(Array.from({length:9},(_,i)=>({label:'r'+i,href:'/crm.html?client='+i}))).length===5
  && safeRecents('nope').length===0 && safeRecents(null).length===0);

// ═══ portalGreeting — time-of-day boundaries, name optional ═══
ok('greeting: morning <12, afternoon <18, evening after',
  portalGreeting(0,'')==='Good morning.' && portalGreeting(11,'')==='Good morning.'
  && portalGreeting(12,'')==='Good afternoon.' && portalGreeting(17,'')==='Good afternoon.'
  && portalGreeting(18,'')==='Good evening.' && portalGreeting(23,'')==='Good evening.');
ok('greeting: the first name joins only when we truly have one',
  portalGreeting(9,'Sam')==='Good morning, Sam.' && portalGreeting(9,'')==='Good morning.');

// ═══ snapWaiting — ONE definition of "needs your OK" (tile === card) ═══
ok('snapWaiting: pending approvals + flagged to-dos, defensive on shape',
  snapWaiting({approvals:[1,2],todos:[3]})===3 && snapWaiting({approvals:[1]})===1
  && snapWaiting({})===0 && snapWaiting(null)===0);

// ═══ glanceData / glanceTiles — the at-a-glance strip's honesty rules ═══
const FEED={pending_approvals:[{id:'p1'}]};
const SNAPS=[{approvals:[{id:'a1'},{id:'a2'}],todos:[{id:'t1'}]},{approvals:[]}];
const NOTIFS=[
  {kind:'message',read:false},{kind:'support_message',read:false},
  {kind:'message',read:true},{kind:'approval_requested',read:false},
];
const BILLING={invoices:[
  {id:'i1',amount:500,status:'open'},{id:'i2',amount:250,status:'sent'},
  {id:'i3',amount:900,status:'paid'},{id:'i4',amount:100,status:'void'},
]};
const PROJECTS=[{id:'x',name:'Old thing',status:'complete'},{id:'y',name:'Website redesign',status:'active'}];
{
  const g=glanceData(FEED,SNAPS,NOTIFS,BILLING,PROJECTS);
  ok('glance: needs-OK = feed approvals + per-project snapWaiting (approvals AND to-dos — same count as the cards)',
    g.needsOk===4 && g.needsOk===FEED.pending_approvals.length+SNAPS.reduce((a,s)=>a+snapWaiting(s),0));
  ok('glance: new messages count ONLY unread kind==="message" — support_message rows (own-filing updated_at churn) never count',
    g.newMsgs===1);
  ok('glance: the due amount sums unpaid invoices only (paid/void/canceled excluded)',g.due==='$750');
  ok('glance: the project tile prefers the active project and humanizes its status',
    g.project.name==='Website redesign' && g.project.status==='active'
    && glanceData(null,[],[],null,[{id:'z',name:'On hold',status:'on_hold'}]).project.status==='on hold');
  const t=glanceTiles(g);
  ok('glance: four tiles when every datum exists, in strip order',
    t.length===4 && t[0].id==='glance-ok' && t[1].id==='glance-msgs' && t[2].id==='glance-due' && t[3].id==='glance-proj');
  ok('glance: plural/singular labels follow the counts',
    glanceTiles({needsOk:1}).length===1 && glanceTiles({needsOk:1})[0].l==='needs your OK'
    && t[0].l==='need your OK' && glanceTiles({newMsgs:1})[0].l==='new message');
}
{
  const g=glanceData(null,[],[],null,[]);
  ok('glance: absent data → nothing due, no project — those tiles hide (no fake zeros)',
    g.due==='' && g.project===null && glanceTiles(g).length===2);
  ok('glance: zero counts are REAL data and stay visible as 0',
    glanceTiles(g)[0].n==='0' && glanceTiles(g)[1].n==='0');
  ok('glance: an empty input object renders no tiles at all',glanceTiles({}).length===0 && glanceTiles(null).length===0);
}
// C1: per-source failure honesty — a failed read NULLS its count (tile hidden),
// and with BOTH counts failed the whole strip hides (due/project never stand alone).
{
  const gf=glanceData(FEED,SNAPS,NOTIFS,BILLING,PROJECTS,{feed:true});
  ok('glance: a failed feed read nulls needs-OK — hidden, never a fake zero',
    gf.needsOk===null && !glanceTiles(gf).some(t=>t.id==='glance-ok') && glanceTiles(gf).some(t=>t.id==='glance-msgs'));
  ok('glance: a failed per-project snapshot read ALSO nulls needs-OK (a partial count is not a count)',
    glanceData(FEED,SNAPS,NOTIFS,BILLING,PROJECTS,{snaps:true}).needsOk===null);
  const gn=glanceData(FEED,SNAPS,NOTIFS,BILLING,PROJECTS,{notifs:true});
  ok('glance: failed notifications null the messages tile',
    gn.newMsgs===null && !glanceTiles(gn).some(t=>t.id==='glance-msgs') && glanceTiles(gn).some(t=>t.id==='glance-ok'));
  ok('glance: with BOTH count sources failed the strip renders NOTHING — even with real due/project data',
    glanceTiles(glanceData(FEED,SNAPS,NOTIFS,BILLING,PROJECTS,{feed:true,notifs:true})).length===0);
  // PS1: the due tile hides BY CONTRACT on a failed billing read — even when the
  // (stale/garbage) billing object still carries unpaid invoices, due must be ''.
  const gb=glanceData(FEED,SNAPS,NOTIFS,BILLING,PROJECTS,{billing:true});
  ok('glance: a failed billing read hides the to-pay tile by contract — never a fake $0 (or a stale $750)',
    gb.due==='' && !glanceTiles(gb).some(t=>t.id==='glance-due') && glanceTiles(gb).some(t=>t.id==='glance-ok'));
  ok('glance: a SUCCESSFUL billing read still sums unpaid invoices (the contract gates failure, not success)',
    glanceData(FEED,SNAPS,NOTIFS,BILLING,PROJECTS,{}).due==='$750');
}

// ═══ structural pins — the wiring both pages must keep ═══
const ROOT=new URL('../../',import.meta.url);
const read=(p)=>Deno.readTextFileSync(new URL(p,ROOT));
const today=read('today.html');
const portal=read('client.html');

// keep the mirrors honest: each page carries the exact same helper definitions
for(const fn of ['greet','dateLine','monthTiles','monthTrend','siteYmd','todaySlots','slotTime','localYmd','safeRecents']){
  const m=String({greet,dateLine,monthTiles,monthTrend,siteYmd,todaySlots,slotTime,localYmd,safeRecents}[fn]);
  ok(`mirror: today.html defines ${fn} verbatim`,today.includes(m));
}
ok('mirror: today.html defines money verbatim',today.includes(String(money)));
for(const fn of ['portalGreeting','snapWaiting','glanceData','glanceTiles']){
  const m=String({portalGreeting,snapWaiting,glanceData,glanceTiles}[fn]);
  ok(`mirror: client.html defines ${fn} verbatim`,portal.includes(m));
}

ok('today: the This-month card is fed by GET /analytics/dashboard, tolerated to null on failure',
  today.includes("apiGet('/analytics/dashboard').catch(()=>null)"));
ok('today: no tiles → no card (the 404/null-section path renders nothing, never zeros)',
  /function monthCardHtml\(d\)\{\s*const tiles=monthTiles\(d\);\s*if\(!tiles\.length\)return''/.test(today));
ok('today: the schedule read splits dormant (404/403) from transient failure',
  today.includes("apiGet('/bookings/appointments').catch((e)=>e===404||e===403?'dormant':null)"));
ok('today: a dormant bookings route renders NO schedule card (a missing feature is not a hiccup)',
  /function scheduleHtml\(list\)\{\s*if\(list==='dormant'\)return''/.test(today));
ok('today: a transiently-failed bookings read says "couldn\'t check" — it never claims a clear day',
  today.includes('We couldn’t check your bookings just now') && today.includes('Nothing booked for today'));
ok('today: recents render as-cached with data-noscope (the shell\'s scope-carry stays off them)',
  today.includes('data-noscope="1"') && today.includes("localStorage.getItem('dds-recent-records')"));
// D6 refactor: the per-project /report read moved behind the shared REPORTS
// cache (projectReport). The pin still requires the card's DATA SOURCE to be
// /projects + per-project /report — rerouting the card to any other read (or
// bypassing the cache) must redden this.
ok('today: Waiting-on-clients uses the Projects roster\'s own source (/projects + per-project /report, via the REPORTS cache)',
  today.includes("apiGet('/projects')") && today.includes("apiGet('/projects/'+id+'/report')")
  && /waitingCard\(\)\{[\s\S]*?projectReport\(p\.id\)/.test(today)
  && today.includes('summary&&r.summary.pending_approvals'));
ok('today: feed rows keep the .moment.todo identity the attention math is pinned on',
  today.includes('class="moment attn todo"'));
ok('today: the greeting sub line carries the date (dateLine) before the needs count',
  today.includes('const subBits = [dateLine()];'));
// T3: real headings — section labels are <h2>, feed row headlines <h3>, so a
// screen reader's heading nav sees the page structure, not just the h1.
ok('today: section labels are REAL h2 headings (no styled-div stand-ins remain)',
  today.includes('<h2 class="seclab">') && today.includes('<h2 class="rh">')
  && !today.includes('<div class="seclab"') && !today.includes('<div class="rh">'));
ok('today: feed row headlines are h3 under the "Needs you" h2',
  today.includes('<h3 class="fhead">') && !today.includes('<span class="fhead">'));
// T4: an all-degraded rail collapses — no permanent empty ~30% column.
ok('today: an empty rail drops the aside and lets main span full width (norail)',
  today.includes('.cols.norail{grid-template-columns:minmax(0,1fr)}')
  && today.includes("cols${railEmpty?' norail':''}") && today.includes("railEmpty?' hidden':''"));
ok('today: a late Waiting-on-clients card revives a collapsed rail',
  /host\.hidden=false;[\s\S]{0,200}getElementById\('col-rail'\)[\s\S]{0,120}classList\.remove\('norail'\)/.test(today));

ok('portal: the Home headline is the time-of-day greeting over the SAME sub line',
  portal.includes('portalGreeting(new Date().getHours(),firstName(USER))')
  && portal.includes('Everything your studio is doing with you, in one place.'));
ok('portal: the glance strip slot starts hidden and precedes the Needs-you queue (website-card adjacency intact)',
  /id="home-glance" hidden[\s\S]*id="home-needs"[\s\S]*id="home-website" hidden/.test(portal));
ok('portal: the strip fills from buildNeedsYou\'s own data (no new reads), carrying per-source failure flags',
  portal.includes('glanceTiles(glanceData(PORTAL.feed,snaps,PORTAL.notifs,billing,PORTAL.projects,failed))'));
ok('portal: the project cards\' glance line shares snapWaiting with the tile (one count, everywhere)',
  portal.includes('const waiting=snapWaiting(s);'));
ok('portal: load() records feed/notification read failures for the strip',
  portal.includes('PORTAL.feedFailed=!feed.ok') && portal.includes('PORTAL.notifsFailed=!(n&&n.ok)'));
// PS1: a failed /client/projects read is recorded (client persona only — a
// reviewer's 403 is contract, not failure), feeds the glance's failed.snaps,
// and Home's projects section renders the couldn't-load line, never the 🚀 card.
ok('portal: load() records a client\'s failed projects read; a reviewer\'s 403 stays calm',
  portal.includes("PORTAL.projectsFailed=PORTAL.persona==='client'&&!(proj&&proj.ok)"));
ok('portal: the glance treats a failed projects read as a failed snaps source',
  portal.includes('snaps:snaps.some(s=>s&&s.failed)||!!PORTAL.projectsFailed'));
ok('portal: a failed projects read renders the couldn\'t-load line instead of the first-run card',
  portal.includes('P.projectsFailed') && portal.includes('We couldn’t load your projects just now — please try again in a moment.'));
ok('portal: the rolebadge derives from persona, never projects.length',
  portal.includes("P.persona==='client'?'Your workspace':'Client view'")
  && !portal.includes("projects.length?'Your workspace':'Client view'"));
// PS1: the Needs-you queue's per-source failure lines — any failed source keeps
// its own calm line, and ONLY all-sources-ok-and-empty earns "all caught up".
ok('portal: ensureBilling records PORTAL.billingFailed on a failed read (B1\'s named flag)',
  portal.includes('PORTAL.billingFailed=true') && portal.includes('PORTAL.billingFailed=false'));
ok('portal: the queue renders per-source couldn\'t-check lines for feed / projects / snaps / billing',
  portal.includes('We couldn’t check on pending approvals just now — please try again in a moment.')
  && portal.includes('We couldn’t check on some of your projects just now — please try again in a moment.')
  && portal.includes('We couldn’t check on invoices just now — please try again in a moment.'));
ok('portal: ONLY an all-sources-ok-and-empty queue may claim "You\'re all caught up."',
  portal.includes('if(!items.length&&!srcFails.length)') && portal.includes('You’re all caught up.'));
ok('portal: the bell panel renders the failed branch and SKIPS the mark-seen POST on it',
  portal.includes('notifPanelHtml(PORTAL.notifs,PORTAL.notifsFailed)')
  && portal.includes('We couldn’t check just now — try again in a moment.')
  && /if\(PORTAL\.notifsFailed\)return;[\s\S]*?api\('\/client\/notifications\/read','POST'/.test(portal));
ok('portal: Recent updates gates its empty copy on feedFailed — the couldn\'t-load line first',
  portal.includes('We couldn’t load recent updates just now — please try again in a moment.')
  && /if\(P\.feedFailed\)html\+=[\s\S]{0,200}else if\(!moments\.length\)html\+=emptyCard\('Nothing new to share/.test(portal));
ok('portal: ensureSnaps marks a FAILED per-project read (failed:true), distinct from an empty one',
  /if\(!r\.ok\)throw 0;/.test(portal) && portal.includes('failed:true,milestones:[]'));
ok('portal: queue rows lead with an aria-hidden type icon (action-feed anatomy)',
  /<span class="qico[^"]*" aria-hidden="true">/.test(portal));
ok('portal: explicit CTAs whose accessible names keep the row title',
  portal.includes('aria-label="Review &amp; approve — ') && portal.includes('aria-label="View &amp; pay — ')
  && portal.includes('aria-label="Open to-dos — '));
ok('portal: opening the bell re-renders the messages tile WHOLE — number and pluralized label together',
  portal.includes("document.getElementById('glance-msgs')") && portal.includes('glanceTiles({newMsgs:0})[0]')
  && !portal.includes("document.querySelector('#glance-msgs .gn')"));

const passed=results.filter(r=>r.p).length,failed=results.length-passed;
console.log(`\n════ TODAY/HOME (SLICE 10): ${passed}/${results.length} PASSED ════`);
if(failed)Deno.exit(1);
