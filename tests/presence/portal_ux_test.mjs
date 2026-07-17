// ── Client-portal UX helpers — pure logic (client.html) ──────────────────────
//   deno run --allow-read tests/presence/portal_ux_test.mjs
// These functions are defined inline in client.html (the end-client portal SPA)
// where there is no bundler to import from. They are mirrored here 1:1 so the
// chip-visibility, notification-bucketing/grouping, anchor→section mapping,
// name-derivation, milestone-Path, queue-unread, and timeline-attribution rules
// are locked by tests. Keep both copies in sync.

// ── mirrors (verbatim) of the pure helpers in client.html ──
function chipsFor(d){
  d=d||{};const chips=[];
  if(d.hasOverview)chips.push({id:'sec-overview',label:'Overview'});
  if((d.approvals||[]).filter(a=>a&&a.status==='pending').length)chips.push({id:'sec-approvals',label:'Approvals'});
  if((d.deliverables||[]).length)chips.push({id:'sec-files',label:'Files'});
  if(d.hasMessages)chips.push({id:'sec-messages',label:'Messages'});
  if(d.hasSupport)chips.push({id:'sec-support',label:'Support'});
  return chips;
}
function notifBucket(iso,nowMs){const t=Date.parse(iso);if(!isFinite(t))return'Earlier';const days=Math.floor((nowMs-t)/86400000);if(days<=0)return'Today';if(days<7)return'This week';return'Earlier';}
function groupNotifs(items,nowMs){const order=['Today','This week','Earlier'];const map={};for(const it of(items||[])){const b=notifBucket(it&&it.created_at,nowMs);(map[b]=map[b]||[]).push(it);}return order.filter(b=>map[b]&&map[b].length).map(b=>({bucket:b,items:map[b]}));}
function sectionForAnchor(a){a=String(a||'').replace(/^#/,'');if(a.indexOf('approval')===0)return'sec-approvals';if(a.indexOf('file')===0||a.indexOf('deliverable')===0)return'sec-files';if(a.indexOf('message')===0)return'sec-messages';if(a.indexOf('support')===0)return'sec-support';if(a.indexOf('survey')===0)return'sec-surveys';if(a.indexOf('milestone')===0)return'sec-milestones';if(a.indexOf('task')===0)return'sec-todos';return'sec-overview';}
function firstName(u){if(!u)return'';const m=(u.user_metadata||{});const n=(m.name||m.full_name||'').trim();if(n)return n.split(/\s+/)[0];const e=(u.email||'').split('@')[0];if(e&&/^[a-z]+([._-][a-z]+)?$/i.test(e)){const p=e.split(/[._-]/)[0];return p.charAt(0).toUpperCase()+p.slice(1);}return'';}
const esc=(s)=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function pathSteps(ms){
  let firstOpen=true;
  return (ms||[]).filter(m=>m&&m.title).map(m=>{
    if(m.status==='complete')return{m,state:'done'};
    if(firstOpen){firstOpen=false;return{m,state:'current'};}
    return{m,state:'upcoming'};
  });
}
function pathStepText(s){
  if(s.state==='done'){const t=Date.parse(s.m.completed_at||'');return'done'+(isFinite(t)?' '+new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric'}):'');}
  return s.state+(s.m.due_date?', due '+s.m.due_date:'');
}
function pathSummary(steps){
  const done=steps.filter(s=>s.state==='done').length;
  const cur=steps.find(s=>s.state==='current');
  return `Milestones: ${done} of ${steps.length} complete${cur?`, now at ${cur.m.title}`:''}.`;
}
function pathChevrons(steps,mini){
  const spans=steps.map(s=>`<span class="pstep ${s.state}" title="${esc(`${s.m.title} — ${pathStepText(s)}`)}" aria-hidden="true">${s.state==='done'?'✓ ':''}${esc(s.m.title)}</span>`).join('');
  if(mini)return `<div class="path mini" aria-hidden="true">${spans}</div>`;   // decorative inside the card button (F15)
  const label='Milestones: '+steps.map(s=>`${s.m.title} — ${pathStepText(s)}`).join('; ');
  return `<div class="path" role="img" aria-label="${esc(label)}">${spans}</div>`;
}
function miniPathHtml(ms){const steps=pathSteps(ms);return steps.length?pathChevrons(steps,true)+`<span class="sr-only">${esc(pathSummary(steps))}</span>`:'';}
function unreadKeysFrom(notifs){
  const keys=new Set();
  for(const n of (notifs||[])){
    if(!n||n.read)continue;const href=String(n.href||'');
    const a=href.match(/#approval-([a-z0-9-]+)/i);if(a)keys.add('approval-'+a[1]);
    const t=href.match(/#task-([a-z0-9-]+)/i);if(t)keys.add('task-'+t[1]);
    const sv=href.match(/\/projects\/([a-z0-9-]+)#surveys/i);if(sv)keys.add('surveys-'+sv[1]);
    // 'client_action' = the studio flagged an EXISTING task as needing the client
    // (the primary to-do flow). Its href carries NO task anchor (notifHref's
    // default drops detail.task_id), so the honest granularity is PROJECT-level:
    // an unread client_action for project P lights P's to-do rows.
    if(n.kind==='client_action'){const p=href.match(/\/projects\/([a-z0-9-]+)/i);if(p)keys.add('todos-'+p[1]);}
    // slice 5 (Messages split view): per-conversation unread dots. A 'message'
    // notification lights its PROJECT's thread row (href '/projects/<id>#messages');
    // a 'support_message' one lights its REQUEST's row (hrefs carry the id as
    // '?support=<id>' — the derived support rows — or '#support-<id>' — project
    // events). Kind-gated so e.g. '#messages' anchors on other kinds add nothing.
    if(n.kind==='message'){const pm=href.match(/\/projects\/([a-z0-9-]+)#messages/i);if(pm)keys.add('msgs-'+pm[1]);}
    if(n.kind==='support_message'){const sm=href.match(/[?&]support=([a-z0-9-]+)/i)||href.match(/#support-([a-z0-9-]+)/i);if(sm)keys.add('support-'+sm[1]);}
  }
  return keys;
}
function convRows(projects,support,latest){
  const names={};for(const p of (projects||[]))if(p&&p.id)names[p.id]=p.name;
  const rows=[];
  for(const p of (projects||[])){
    if(!p||!p.id)continue;
    const fetched=Object.prototype.hasOwnProperty.call(latest||{},p.id);
    const lm=fetched?(latest||{})[p.id]:null;
    rows.push({id:'proj:'+p.id,kind:'project',pid:p.id,title:p.name||'Project',when:(lm&&lm.created_at)||'',
      preview:lm?(lm.body||''):(fetched?'No messages yet — say hello any time.':'Open this conversation'),
      unfetched:!fetched,chip:'Message',chipCls:'',unreadKey:'msgs-'+p.id});
  }
  for(const rq of (support||[])){
    if(!rq||!rq.id)continue;
    const status=String(rq.status||'open');
    // recency prefers last_activity_at (new function builds — replies only INSERT
    // and never bump updated_at) with the updated_at fallback for old builds.
    rows.push({id:'sup:'+rq.id,kind:'support',sid:rq.id,pid:rq.project_id||'',title:rq.subject||'Support request',
      when:rq.last_activity_at||rq.updated_at||'',preview:rq.project_id?(names[rq.project_id]||'A project request'):'A conversation with your studio',
      chip:'Support · '+status.replace(/_/g,' '),chipCls:'support',status,unreadKey:'support-'+rq.id});
  }
  rows.sort(convCompare);
  return rows;
}
// newest activity first; among rows with no timestamp, fetched (confirmed-empty)
// rows come before unfetched ones — an unfetched row makes no recency claim.
function convCompare(a,b){const w=String(b.when).localeCompare(String(a.when));if(w)return w;return (a.unfetched?1:0)-(b.unfetched?1:0);}
function supportThreadItems(rq,msgs){
  const items=[];
  if(rq&&rq.body&&rq.created_at)items.push({type:'message',title:'You opened this request',body:rq.body,at:rq.created_at});
  for(const m of (msgs||[])){
    if(!m||!m.created_at)continue;
    const mine=(m.from==='client'||m.from==='studio')?m.from==='client':!(m.author_kind==='staff'||m.author_kind==='system');
    items.push({type:'message',title:mine?'You replied':'Your studio replied',body:m.body||'',at:m.created_at});
  }
  items.sort((a,b)=>a.at<b.at?1:a.at>b.at?-1:0);
  return items;
}
function subjectFromMessage(v){return (String(v==null?'':v).split('\n')[0]||'').slice(0,60)||'New message';}
function msgFromMap(events){
  const map={};
  for(const e of (events||[])){const dd=(e&&e.kind==='message'&&e.detail)||null;if(dd&&dd.message_id&&(dd.from==='studio'||dd.from==='client'))map[dd.message_id]=dd.from;}
  return map;
}
function projMsgItem(m,fromById){
  if(!m||!m.created_at)return null;
  const from=fromById?fromById[m.id]:undefined;
  const mine=from?from==='client':!(m.author_kind==='staff'||m.author_kind==='system');
  return{type:'message',title:mine?'You sent a message':'Your studio sent a message',body:m.body||'',at:m.created_at};
}
function projEventItem(e){
  if(!e||!e.created_at||e.kind==='message')return null;
  const dd=e.detail||{};const mine=dd.from==='client';const t=dd.title?' — '+String(dd.title):'';
  if(e.kind==='approval_decided'){
    const word=dd.decision==='approved'?'approved a change':dd.decision==='changes_requested'?'requested changes':dd.decision==='rejected'?'declined a change':'decided an approval';
    return{type:'approve',title:(mine?'You ':'Someone ')+word,body:null,at:e.created_at};
  }
  const M={
    project_created:['system','Your project began'],
    status_change:['system','Project status changed'],
    task_created:['task','A to-do was added'+t],
    task_status_change:['task','A to-do moved along'+t],
    task_done:['task',(mine?'You':'Your studio')+' marked a to-do done'+t],
    milestone_created:['system','A milestone was set'+t],
    milestone_completed:['approve','Milestone complete'+t],
    deliverable_added:['file','Your studio shared a file'+t],
    client_upload:['file','You sent a file'+t],
    approval_requested:['approve','Your OK was requested'+t],
    survey_requested:['task','A survey is ready for you'],
    survey_submitted:['task',(mine?'You':'Someone')+' answered a survey'],
    support_opened:['message',(mine?'You':'Your studio')+' opened a support request'],
    support_message:['message','New reply on a support request'],
    support_resolved:['message','A support request was resolved'],
    note:['note','A note was shared with you'],
  };
  const m=M[e.kind]||['system',String(e.kind||'activity').replace(/_/g,' ').replace(/^./,c=>c.toUpperCase())];
  return{type:m[0],title:m[1],body:null,at:e.created_at};
}

const results=[];
const ok=(n,p)=>{results.push({n,p});console.log(`${p?'PASS':'FAIL'}  ${n}`);};
const idsOf=(cs)=>cs.map(c=>c.id);

// ═══ chipsFor — content-gated section chips ═══
ok('chips: Messages + Support always present (composer / open-a-request CTA)',
  JSON.stringify(idsOf(chipsFor({hasMessages:true,hasSupport:true})))===JSON.stringify(['sec-messages','sec-support']));
ok('chips: Overview only when there is a summary',
  idsOf(chipsFor({hasOverview:true,hasMessages:true,hasSupport:true}))[0]==='sec-overview');
ok('chips: Approvals only when at least one is pending',
  idsOf(chipsFor({approvals:[{status:'pending'}],hasMessages:true,hasSupport:true})).includes('sec-approvals')
  && !idsOf(chipsFor({approvals:[{status:'approved'}],hasMessages:true,hasSupport:true})).includes('sec-approvals'));
ok('chips: Files only when a deliverable exists',
  idsOf(chipsFor({deliverables:[{id:'x'}],hasMessages:true,hasSupport:true})).includes('sec-files')
  && !idsOf(chipsFor({deliverables:[],hasMessages:true,hasSupport:true})).includes('sec-files'));
ok('chips: full set is in canonical order Overview·Approvals·Files·Messages·Support',
  JSON.stringify(idsOf(chipsFor({hasOverview:true,approvals:[{status:'pending'}],deliverables:[{id:'d'}],hasMessages:true,hasSupport:true})))
  ===JSON.stringify(['sec-overview','sec-approvals','sec-files','sec-messages','sec-support']));
ok('chips: null/empty bundle yields no chips (no crash)', chipsFor().length===0 && chipsFor(null).length===0);

// ═══ notifBucket — calm recency buckets ═══
const NOW=Date.parse('2026-07-13T12:00:00Z');
ok('bucket: same day → Today', notifBucket('2026-07-13T01:00:00Z',NOW)==='Today');
ok('bucket: 3 days ago → This week', notifBucket('2026-07-10T12:00:00Z',NOW)==='This week');
ok('bucket: 20 days ago → Earlier', notifBucket('2026-06-23T12:00:00Z',NOW)==='Earlier');
ok('bucket: unparseable date → Earlier (never throws)', notifBucket('not-a-date',NOW)==='Earlier');

// ═══ groupNotifs — ordered, non-empty groups, order preserved within ═══
const G=groupNotifs([
  {label:'a',created_at:'2026-07-13T09:00:00Z'},
  {label:'b',created_at:'2026-07-11T09:00:00Z'},
  {label:'c',created_at:'2026-06-01T09:00:00Z'},
  {label:'d',created_at:'2026-07-13T08:00:00Z'},
],NOW);
ok('group: three buckets in Today→This week→Earlier order',
  JSON.stringify(G.map(g=>g.bucket))===JSON.stringify(['Today','This week','Earlier']));
ok('group: items keep their input order within a bucket',
  G[0].items.length===2 && G[0].items[0].label==='a' && G[0].items[1].label==='d');
ok('group: empty input → no groups', groupNotifs([],NOW).length===0 && groupNotifs(null,NOW).length===0);

// ═══ sectionForAnchor — notification href anchor → chip section id ═══
ok('anchor: #approvals / #approval-123 → sec-approvals',
  sectionForAnchor('#approvals')==='sec-approvals' && sectionForAnchor('approval-123')==='sec-approvals');
ok('anchor: #files & #deliverable → sec-files',
  sectionForAnchor('#files')==='sec-files' && sectionForAnchor('deliverable-1')==='sec-files');
ok('anchor: #messages → sec-messages', sectionForAnchor('#messages')==='sec-messages');
ok('anchor: #support-99 → sec-support', sectionForAnchor('#support-99')==='sec-support');
ok('anchor: #task-7 → sec-todos, #milestones → sec-milestones, #surveys → sec-surveys',
  sectionForAnchor('#task-7')==='sec-todos' && sectionForAnchor('#milestones')==='sec-milestones' && sectionForAnchor('#surveys')==='sec-surveys');
ok('anchor: unknown / empty → sec-overview', sectionForAnchor('')==='sec-overview' && sectionForAnchor('#whatever')==='sec-overview');

// ═══ firstName — friendly, never guessy ═══
ok('name: user_metadata.name wins', firstName({user_metadata:{name:'Ada Lovelace'},email:'x@y.com'})==='Ada');
ok('name: full_name fallback', firstName({user_metadata:{full_name:'Grace Hopper'}})==='Grace');
ok('name: clean email local-part is capitalized', firstName({email:'maria@shop.com'})==='Maria');
ok('name: dotted email uses first token', firstName({email:'john.doe@shop.com'})==='John');
ok('name: numeric/opaque email → empty (no guessing)', firstName({email:'a1b2c3@shop.com'})==='');
ok('name: no user → empty', firstName(null)==='' && firstName(undefined)==='');

// ═══ pathSteps — done / current (first open) / upcoming ═══
const MS=[
  {id:'m1',title:'Design',status:'complete',completed_at:'2026-07-01T12:00:00Z'},
  {id:'m2',title:'Build',status:'open',due_date:'2026-07-20'},
  {id:'m3',title:'Launch',status:'open'},
];
const PS=pathSteps(MS);
ok('path: complete → done, first open → current, rest → upcoming',
  JSON.stringify(PS.map(s=>s.state))===JSON.stringify(['done','current','upcoming']));
ok('path: single open milestone → one current step',
  JSON.stringify(pathSteps([{title:'Kickoff',status:'open'}]).map(s=>s.state))===JSON.stringify(['current']));
ok('path: single complete milestone → one done step',
  JSON.stringify(pathSteps([{title:'Kickoff',status:'complete'}]).map(s=>s.state))===JSON.stringify(['done']));
ok('path: empty / null / untitled entries → no steps',
  pathSteps([]).length===0 && pathSteps(null).length===0 && pathSteps([{status:'open'},null]).length===0);

// ═══ pathChevrons — chevron markup, tooltips with dates, aria per variant ═══
const FULL=pathChevrons(PS,false), MINI=pathChevrons(PS,true);
ok('chevrons: one .pstep per step with its state class',
  (FULL.match(/class="pstep /g)||[]).length===3 && FULL.includes('pstep done') && FULL.includes('pstep current') && FULL.includes('pstep upcoming'));
ok('chevrons: full Path narrates itself (role=img + milestone label)',
  FULL.includes('role="img"') && FULL.includes('aria-label="Milestones: '));
ok('chevrons: aria narration + tooltips carry the dates (done <date> / due <date>)',
  FULL.includes('Design — done ') && FULL.includes('Build — current, due 2026-07-20')
  && MINI.includes('title="Design — done ') && MINI.includes('title="Build — current, due 2026-07-20"'));
ok('chevrons: the mini Path is decorative (aria-hidden, no role=img) — F15',
  MINI.includes('aria-hidden="true"') && !MINI.includes('role="img"'));
ok('chevrons: a single milestone renders exactly one chevron (both variants)',
  (pathChevrons(pathSteps([{title:'Kickoff',status:'open'}]),false).match(/class="pstep /g)||[]).length===1
  && (pathChevrons(pathSteps([{title:'Kickoff',status:'open'}]),true).match(/class="pstep /g)||[]).length===1);
ok('chevrons: no steps → an empty full Path with no chevrons', !pathChevrons([],false).includes('pstep'));
ok('mini path html: sr-only progress phrase accompanies the hidden chevrons; empty → \'\'',
  miniPathHtml(MS).includes('class="sr-only"') && miniPathHtml(MS).includes('Milestones: 1 of 3 complete, now at Build.')
  && miniPathHtml([])==='');

// ═══ unreadKeysFrom — Home queue dots from the notifications read-state ═══
const PIDX='11111111-1111-4111-8111-111111111111';
const KEYS=unreadKeysFrom([
  {kind:'approval_requested',href:`/projects/${PIDX}#approval-a1`,read:false},
  {kind:'task_created',href:`/projects/${PIDX}#task-t9`,read:false},
  {kind:'survey_requested',href:`/projects/${PIDX}#surveys`,read:false},
  {kind:'client_action',href:`/projects/${PIDX}`,read:false},
  {kind:'approval_requested',href:`/projects/${PIDX}#approval-a2`,read:true},
  null,
]);
ok('unread: approval / task / surveys anchors produce their row keys',
  KEYS.has('approval-a1') && KEYS.has('task-t9') && KEYS.has('surveys-'+PIDX));
ok('unread: client_action (no task anchor in its href) lights the PROJECT’s to-dos',
  KEYS.has('todos-'+PIDX));
ok('unread: read + null notifications add nothing',
  !KEYS.has('approval-a2') && KEYS.size===4 && unreadKeysFrom(null).size===0);
ok('unread: a read client_action adds no project key',
  !unreadKeysFrom([{kind:'client_action',href:`/projects/${PIDX}`,read:true}]).has('todos-'+PIDX));

// ═══ unreadKeysFrom — slice 5's per-conversation keys (Messages split view) ═══
const MKEYS=unreadKeysFrom([
  {kind:'message',href:`/projects/${PIDX}#messages`,read:false},
  {kind:'support_message',href:'/client.html?support=s-gen',read:false},
  {kind:'support_message',href:`/projects/${PIDX}#support-s-prj`,read:false},
  {kind:'message',href:`/projects/${PIDX}#messages`,read:true},
  {kind:'deliverable_added',href:`/projects/${PIDX}#messages`,read:false},   // wrong kind — no key
]);
ok('unread: a message notification lights its project thread row',
  MKEYS.has('msgs-'+PIDX));
ok('unread: support_message lights its request row from either href shape',
  MKEYS.has('support-s-gen') && MKEYS.has('support-s-prj'));
ok('unread: the conversation keys are kind-gated and skip read items',
  MKEYS.size===3);

// ═══ convRows — the Messages tab's conversation list ═══
// `latest` semantics: a message = fetched with messages; null = fetched, thread
// CONFIRMED empty; key absent = unfetched (beyond the preview cap / fetch failed).
const CPROJ=[{id:'p1',name:'Website redesign'},{id:'p2',name:'Brand refresh'},{id:'p3',name:'Retainer'},null];
const CSUP=[
  {id:'s1',subject:'Logo tweak',status:'open',project_id:null,updated_at:'2026-07-06T00:00:00Z'},
  {id:'s2',subject:'Copy fixes',status:'in_progress',project_id:'p1',updated_at:'2026-07-08T00:00:00Z'},
  null,{},
];
const CROWS=convRows(CPROJ,CSUP,{p1:{created_at:'2026-07-07T00:00:00Z',body:'Welcome aboard!'},p2:null});
ok('conv: one row per project + one per support request; null/id-less entries skipped',
  CROWS.length===5);
ok('conv: sorted newest-activity first; timestamp-less rows sink — fetched-empty before unfetched',
  JSON.stringify(CROWS.map(r=>r.id))===JSON.stringify(['sup:s2','proj:p1','sup:s1','proj:p2','proj:p3']));
ok('conv: a project row carries the latest message as preview + its recency + a Message chip',
  (()=>{const r=CROWS.find(x=>x.id==='proj:p1');return r.title==='Website redesign'&&r.preview==='Welcome aboard!'&&r.when==='2026-07-07T00:00:00Z'&&r.chip==='Message'&&r.unreadKey==='msgs-p1';})());
ok('conv: only a FETCHED-and-empty thread claims "No messages yet"',
  (()=>{const r=CROWS.find(x=>x.id==='proj:p2');return r.preview==='No messages yet — say hello any time.'&&r.when===''&&r.unfetched===false;})());
ok('conv: an unfetched row (beyond the cap / failed fetch) gets the neutral preview, claims nothing',
  (()=>{const r=CROWS.find(x=>x.id==='proj:p3');return r.preview==='Open this conversation'&&r.when===''&&r.unfetched===true;})());
ok('conv: a support chip carries the status with underscores humanized',
  (()=>{const r=CROWS.find(x=>x.id==='sup:s2');return r.chip==='Support · in progress'&&r.chipCls==='support'&&r.unreadKey==='support-s2';})());
ok('conv: project-scoped support previews its project name; general previews the studio line',
  CROWS.find(x=>x.id==='sup:s2').preview==='Website redesign'
  && CROWS.find(x=>x.id==='sup:s1').preview==='A conversation with your studio');
ok('conv: support recency prefers last_activity_at (replies never bump updated_at) over updated_at',
  convRows([],[{id:'s9',subject:'X',status:'open',project_id:null,updated_at:'2026-07-01T00:00:00Z',last_activity_at:'2026-07-09T00:00:00Z'}],{})[0].when==='2026-07-09T00:00:00Z'
  && convRows([],[{id:'s9',subject:'X',status:'open',project_id:null,updated_at:'2026-07-01T00:00:00Z'}],{})[0].when==='2026-07-01T00:00:00Z');
ok('conv: empty/null inputs → no rows (no crash)', convRows(null,null,null).length===0);

// ═══ supportThreadItems — attribution: server `from` field first, author_kind fallback ═══
const STI=supportThreadItems(
  {body:'Could we nudge the logo left?',created_at:'2026-07-05T00:00:00Z',status:'open'},
  [
    {body:'On it — new version tomorrow.',author_kind:'staff',created_at:'2026-07-06T00:00:00Z'},
    {body:'Thanks!',author_kind:'client',created_at:'2026-07-07T00:00:00Z'},
    {body:'ghost',author_kind:'client'},   // no created_at → skipped
  ]);
ok('support thread: the request body is always the requester\'s ("You opened this request")',
  STI.some(i=>i.title==='You opened this request'&&i.body==='Could we nudge the logo left?'));
ok('support thread: staff/system replies attribute to the studio; other kinds to you',
  STI.some(i=>i.title==='Your studio replied'&&i.body==='On it — new version tomorrow.')
  && STI.some(i=>i.title==='You replied'&&i.body==='Thanks!'));
ok('support thread: newest first; dateless replies are skipped',
  STI.length===3 && STI[0].body==='Thanks!' && STI[2].title==='You opened this request');
ok('support thread: a body-less request adds no item; empty msgs fine',
  supportThreadItems({created_at:'2026-07-05T00:00:00Z'},[]).length===0
  && supportThreadItems(null,null).length===0);
ok('support thread: the server’s from field wins over author_kind (the operator IS kind client)',
  (()=>{const it=supportThreadItems({body:'b',created_at:'2026-07-01T00:00:00Z'},[
    {body:'from the studio',author_kind:'client',from:'studio',created_at:'2026-07-02T00:00:00Z'},
    {body:'from me',author_kind:'client',from:'client',created_at:'2026-07-03T00:00:00Z'},
    {body:'old build',author_kind:'staff',created_at:'2026-07-04T00:00:00Z'},
  ]);return it.some(i=>i.title==='Your studio replied'&&i.body==='from the studio')
    &&it.some(i=>i.title==='You replied'&&i.body==='from me')
    &&it.some(i=>i.title==='Your studio replied'&&i.body==='old build');})());
ok('support thread: an unrecognized from falls back to the author_kind heuristic',
  supportThreadItems(null,[{body:'x',author_kind:'staff',from:'bogus',created_at:'2026-07-02T00:00:00Z'}])[0].title==='Your studio replied'
  && supportThreadItems(null,[{body:'y',author_kind:'client',from:'bogus',created_at:'2026-07-02T00:00:00Z'}])[0].title==='You replied');

// ═══ subjectFromMessage — the general composer's first-line-subject rule ═══
ok('subject: the first line becomes the subject',
  subjectFromMessage('Logo question\nWhere is the source file?')==='Logo question');
ok('subject: capped at 60 chars', subjectFromMessage('x'.repeat(80)).length===60);
ok('subject: empty → "New message"', subjectFromMessage('')==='New message' && subjectFromMessage(null)==='New message');

// ═══ msgFromMap + projMsgItem — event-map attribution (author_kind can’t tell sides) ═══
const EVMAP=msgFromMap([
  {kind:'message',detail:{message_id:'mg1',from:'studio'},created_at:'2026-07-05T00:00:00Z'},
  {kind:'message',detail:{message_id:'mg2',from:'client'},created_at:'2026-07-06T00:00:00Z'},
  {kind:'deliverable_added',detail:{title:'x'},created_at:'2026-07-06T00:00:00Z'},
  {kind:'message',detail:{message_id:'mg9',from:'bogus'},created_at:'2026-07-06T00:00:00Z'},
]);
ok('msg map: only message events with a valid from land in the map',
  EVMAP.mg1==='studio' && EVMAP.mg2==='client' && !('mg9' in EVMAP) && Object.keys(EVMAP).length===2);
ok('msg: detail.from=studio wins over author_kind=client (the operator IS kind client)',
  projMsgItem({id:'mg1',author_kind:'client',body:'hi',created_at:'2026-07-05T00:00:00Z'},EVMAP).title==='Your studio sent a message');
ok('msg: detail.from=client → "You sent a message"',
  projMsgItem({id:'mg2',author_kind:'client',body:'hi',created_at:'2026-07-06T00:00:00Z'},EVMAP).title==='You sent a message');
ok('msg: no matching event → the old author_kind heuristic (staff→studio, else you)',
  projMsgItem({id:'zz',author_kind:'staff',body:'hi',created_at:'2026-07-06T00:00:00Z'},EVMAP).title==='Your studio sent a message'
  && projMsgItem({id:'zz',author_kind:'client',body:'hi',created_at:'2026-07-06T00:00:00Z'},EVMAP).title==='You sent a message');
ok('msg: null / missing created_at → null (never a phantom item)',
  projMsgItem(null,EVMAP)===null && projMsgItem({id:'mg1',body:'x'},EVMAP)===null);

// ═══ projEventItem — typed timeline items from bundle events ═══
ok('event: kind=message events are skipped (the real message bodies render instead)',
  projEventItem({kind:'message',detail:{message_id:'mg1',from:'studio'},created_at:'2026-07-05T00:00:00Z'})===null);
ok('event: approval_decided narrates the decision + the side (detail.from)',
  projEventItem({kind:'approval_decided',detail:{decision:'approved',from:'client'},created_at:'2026-07-05T00:00:00Z'}).title==='You approved a change'
  && projEventItem({kind:'approval_decided',detail:{decision:'changes_requested'},created_at:'2026-07-05T00:00:00Z'}).title==='Someone requested changes');
ok('event: deliverable_added → typed file item with the title appended',
  (()=>{const it=projEventItem({kind:'deliverable_added',detail:{title:'Homepage mockup'},created_at:'2026-07-06T00:00:00Z'});return it.type==='file'&&it.title==='Your studio shared a file — Homepage mockup';})());
ok('event: unknown kinds degrade to a capitalized system item; no created_at → null',
  (()=>{const it=projEventItem({kind:'weird_thing',created_at:'2026-07-06T00:00:00Z'});return it.type==='system'&&it.title==='Weird thing';})()
  && projEventItem({kind:'note'})===null);

const passed=results.filter(r=>r.p).length, failed=results.length-passed;
console.log(`\n════ PORTAL UX HELPERS: ${passed}/${results.length} PASSED ════`);
if(failed) Deno.exit(1);
