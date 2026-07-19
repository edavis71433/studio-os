// ── Slice 10: the Today/Home redesign (both sides) — pure helpers + pins ─────
//   deno run --allow-read tests/presence/today_home_test.mjs
// The studio's Lightning Home (today.html) and the portal Home (client.html)
// gained pure helpers that live inline in each page (no bundler to import
// from). They are mirrored here 1:1, the portal_ux_test.mjs way — keep both
// copies in sync. Structural pins lock the deploy-order-tolerant wiring: the
// This-month card renders ONLY from real /analytics/dashboard sections (no
// fake zeros), the schedule reads /bookings/appointments with an honest
// couldn't-check state, recents render as-cached with data-noscope, and the
// portal glance strip hides tiles whose datum is absent.

// ── mirrors (verbatim) of the pure helpers in today.html ──
function dateLine(nowMs){return new Date(nowMs==null?Date.now():nowMs).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'});}
const money=(c)=>'$'+((c||0)/100).toLocaleString(undefined,{maximumFractionDigits:0});
function monthTiles(d){
  d=d||{};const s=d.sales||{};const w=d.website||{};const t=[];
  if(s.won&&s.won.this_month)t.push([money(s.won.this_month.value_cents),'won this month']);
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
function todaySlots(list,ymd){return(Array.isArray(list)?list:[]).filter(a=>a&&String(a.slot_start_local||'').slice(0,10)===ymd&&(a.status==='pending'||a.status==='confirmed')).sort((a,b)=>String(a.slot_start_local).localeCompare(String(b.slot_start_local))).slice(0,6);}
function slotTime(s){const m=/T(\d\d):(\d\d)/.exec(String(s||''));if(!m)return'';let h=+m[1];const ap=h>=12?'pm':'am';h=h%12||12;return h+':'+m[2]+' '+ap;}
function localYmd(nowMs){const d=new Date(nowMs==null?Date.now():nowMs);return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);}
function safeRecents(a){return Array.isArray(a)?a.filter(function(r){return r&&r.label&&typeof r.href==='string'&&/^\/(?![/\\])/.test(r.href);}).slice(0,5):[];}

// ── mirrors (verbatim) of the pure helpers in client.html ──
function unpaidInvoices(b){return ((b&&b.invoices)||[]).filter(i=>i&&i.status!=='paid'&&i.status!=='void'&&i.status!=='canceled');}
function portalGreeting(h,name){const g=h<12?'Good morning':h<18?'Good afternoon':'Good evening';return g+(name?', '+name:'')+'.';}
function glanceData(feed,snaps,notifs,billing,projects){
  const needsOk=((feed&&feed.pending_approvals)||[]).length+(snaps||[]).reduce((a,s)=>a+((s&&s.approvals)||[]).length,0);
  const newMsgs=(notifs||[]).filter(n=>n&&!n.read&&(n.kind==='message'||n.kind==='support_message')).length;
  const dueTotal=unpaidInvoices(billing).reduce((a,i)=>a+(Number(i&&i.amount)||0),0);
  const p=(projects||[]).find(x=>x&&x.status==='active')||(projects||[])[0]||null;
  return{needsOk,newMsgs,due:dueTotal>0?'$'+dueTotal.toLocaleString('en-US'):'',project:p?{status:String(p.status||'').replace(/_/g,' '),name:p.name||'Your project'}:null};
}
function glanceTiles(g){
  g=g||{};const t=[];
  if(g.needsOk!=null)t.push({id:'glance-ok',n:String(g.needsOk),l:g.needsOk===1?'needs your OK':'need your OK'});
  if(g.newMsgs!=null)t.push({id:'glance-msgs',n:String(g.newMsgs),l:g.newMsgs===1?'new message':'new messages'});
  if(g.due)t.push({id:'glance-due',n:g.due,l:'to pay'});
  if(g.project)t.push({id:'glance-proj',n:g.project.status,l:g.project.name});
  return t;
}

const results=[];
const ok=(n,p)=>{results.push({n,p});console.log(`${p?'PASS':'FAIL'}  ${n}`);};

// ═══ monthTiles — a tile exists only when its dashboard section does ═══
const FULL_DASH={sales:{
  won:{this_month:{count:2,value_cents:385000},last_month:{count:1,value_cents:145000}},
  pipeline:{open:{count:7,value_cents:1240000},stages:[]},
  enquiries:{count:9,unanswered:3},
},website:{traffic:{visitors:214,has_data:true}}};
{
  const t=monthTiles(FULL_DASH);
  ok('tiles: a full dashboard yields all four (won · pipeline · enquiries · visitors)',
    t.length===4 && t[0][1]==='won this month' && t[1][1]==='open pipeline'
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

// ═══ todaySlots / slotTime — the schedule card's day view ═══
const APPTS=[
  {slot_start_local:'2026-07-18T14:30',status:'confirmed',type_name:'Strategy call'},
  {slot_start_local:'2026-07-18T09:00',status:'pending',type_name:'Intro'},
  {slot_start_local:'2026-07-19T10:00',status:'confirmed',type_name:'Tomorrow'},
  {slot_start_local:'2026-07-18T11:00',status:'canceled',type_name:'Gone'},
];
{
  const s=todaySlots(APPTS,'2026-07-18');
  ok('slots: only today, only pending/confirmed, sorted by start time',
    s.length===2 && s[0].type_name==='Intro' && s[1].type_name==='Strategy call');
  ok('slots: junk input yields an empty day, never a throw',
    todaySlots(null,'2026-07-18').length===0 && todaySlots([null,{}],'2026-07-18').length===0);
  ok('slots: the day is capped at six rows',
    todaySlots(Array.from({length:9},(_,i)=>({slot_start_local:'2026-07-18T0'+(i%10)+':00',status:'confirmed'})),'2026-07-18').length===6);
  ok('time: 12-hour labels with am/pm, and a blank for malformed input',
    slotTime('2026-07-18T09:05')==='9:05 am' && slotTime('2026-07-18T14:30')==='2:30 pm'
    && slotTime('2026-07-18T00:15')==='12:15 am' && slotTime('2026-07-18T12:00')==='12:00 pm' && slotTime('garbage')==='');
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

// ═══ glanceData / glanceTiles — the at-a-glance strip's honesty rules ═══
const FEED={pending_approvals:[{id:'p1'}]};
const SNAPS=[{approvals:[{id:'a1'},{id:'a2'}],todos:[]},{approvals:[]}];
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
  ok('glance: needs-OK counts feed approvals + per-project pending approvals',g.needsOk===3);
  ok('glance: new messages count ONLY unread message/support_message notifications',g.newMsgs===2);
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

// ═══ structural pins — the wiring both pages must keep ═══
const ROOT=new URL('../../',import.meta.url);
const read=(p)=>Deno.readTextFileSync(new URL(p,ROOT));
const today=read('today.html');
const portal=read('client.html');

// keep the mirrors honest: each page carries the exact same helper definitions
for(const fn of ['dateLine','monthTiles','monthTrend','todaySlots','slotTime','localYmd','safeRecents']){
  const m=String({dateLine,monthTiles,monthTrend,todaySlots,slotTime,localYmd,safeRecents}[fn]);
  ok(`mirror: today.html defines ${fn} verbatim`,today.includes(m));
}
ok('mirror: today.html defines money verbatim',today.includes(String(money)));
for(const fn of ['portalGreeting','glanceData','glanceTiles']){
  const m=String({portalGreeting,glanceData,glanceTiles}[fn]);
  ok(`mirror: client.html defines ${fn} verbatim`,portal.includes(m));
}

ok('today: the This-month card is fed by GET /analytics/dashboard, tolerated to null on failure',
  today.includes("apiGet('/analytics/dashboard').catch(()=>null)"));
ok('today: no tiles → no card (the 404/null-section path renders nothing, never zeros)',
  /function monthCardHtml\(d\)\{\s*const tiles=monthTiles\(d\);\s*if\(!tiles\.length\)return''/.test(today));
ok('today: the schedule reads GET /bookings/appointments, tolerated to null on failure',
  today.includes("apiGet('/bookings/appointments').catch(()=>null)"));
ok('today: a failed bookings read says "couldn\'t check" — it never claims a clear day',
  today.includes('We couldn’t check your bookings just now') && today.includes('Nothing booked for today'));
ok('today: recents render as-cached with data-noscope (the shell\'s scope-carry stays off them)',
  today.includes('data-noscope="1"') && today.includes("localStorage.getItem('dds-recent-records')"));
ok('today: Waiting-on-clients uses the Projects roster\'s own source (/projects + /report summaries)',
  today.includes("apiGet('/projects')") && today.includes("apiGet('/projects/'+p.id+'/report')")
  && today.includes('summary&&r.summary.pending_approvals'));
ok('today: feed rows keep the .moment.todo identity the attention math is pinned on',
  today.includes('class="moment attn todo"'));
ok('today: the greeting sub line carries the date (dateLine) before the needs count',
  today.includes('const subBits = [dateLine()];'));

ok('portal: the Home headline is the time-of-day greeting over the SAME sub line',
  portal.includes('portalGreeting(new Date().getHours(),firstName(USER))')
  && portal.includes('Everything your studio is doing with you, in one place.'));
ok('portal: the glance strip slot starts hidden and precedes the Needs-you queue (website-card adjacency intact)',
  /id="home-glance" hidden[\s\S]*id="home-needs"[\s\S]*id="home-website" hidden/.test(portal));
ok('portal: the strip fills from buildNeedsYou\'s own data (no new reads)',
  portal.includes('glanceTiles(glanceData(PORTAL.feed,snaps,PORTAL.notifs,billing,PORTAL.projects))'));
ok('portal: queue rows lead with an aria-hidden type icon (action-feed anatomy)',
  portal.includes('<span class="qico') && portal.includes('aria-hidden="true"'));
ok('portal: explicit CTAs whose accessible names keep the row title',
  portal.includes('aria-label="Review &amp; approve — ') && portal.includes('aria-label="View &amp; pay — ')
  && portal.includes('aria-label="Open to-dos — '));
ok('portal: opening the bell zeroes the live messages tile along with every other unread surface',
  portal.includes("document.querySelector('#glance-msgs .gn')"));

const passed=results.filter(r=>r.p).length,failed=results.length-passed;
console.log(`\n════ TODAY/HOME (SLICE 10): ${passed}/${results.length} PASSED ════`);
if(failed)Deno.exit(1);
