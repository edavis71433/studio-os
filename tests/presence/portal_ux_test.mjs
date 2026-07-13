// ── Client-portal UX helpers — pure logic (client.html) ──────────────────────
//   deno run --allow-read tests/presence/portal_ux_test.mjs
// These functions are defined inline in client.html (the end-client portal SPA)
// where there is no bundler to import from. They are mirrored here 1:1 so the
// chip-visibility, notification-bucketing/grouping, anchor→section mapping, and
// name-derivation rules are locked by tests. Keep both copies in sync.

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

const passed=results.filter(r=>r.p).length, failed=results.length-passed;
console.log(`\n════ PORTAL UX HELPERS: ${passed}/${results.length} PASSED ════`);
if(failed) Deno.exit(1);
