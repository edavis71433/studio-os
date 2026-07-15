// ── G9 visual publish diff — pure logic (snapshot-history.html) ──────────────
//   deno run --allow-read --allow-env tests/presence/publish_diff_test.mjs
// These functions are defined inline in snapshot-history.html (a cms.css lens
// page with no bundler to import from). They are mirrored here 1:1 so the
// section-level version-diff rules — id-vs-type+index matching, deep-inequality
// "changed", rank-shift "moved", added/removed ordering, and the chip fallback
// for today's sentence-only compare payload — are locked by tests.
// Keep both copies in sync.

// ── mirrors (verbatim) of the pure helpers in snapshot-history.html ──
const BLOCK_NAMES = {
  hero:'Hero', gallery:'Photo gallery', cta:'Banner', team:'Team', partners:'Partners',
  features:'Highlights', stats:'Counters', reviews:'Star rating', reviews_wall:'Reviews',
  certifications:'Badges', pricing:'Pricing', process:'Steps', service_areas:'Service area',
  before_after:'Before / after', video:'Video', booking:'Booking', appointment:'Scheduling link',
  newsletter:'Email sign-up', map:'Map', events:'Events', social:'Social links',
  richtext:'Text', image:'Photo', image_text:'Image & words', accordion:'Expandable',
  tabs:'Tabs', carousel:'Slideshow', progress:'Meters', buttons:'Buttons', divider:'Divider',
  columns:'Columns', cards:'Cards', download:'Download', toc:'Jump links', title:'Heading',
  link_list:'Links', table:'Table', spotlight:'Spotlight', form:'Form', faq:'FAQ',
  testimonials:'Testimonials',
};
function blockName(type){ const t=String(type||'section'); return BLOCK_NAMES[t] || (t.replace(/[_-]+/g,' ').replace(/^./,c=>c.toUpperCase())); }

function blockKeys(list){
  const seen=Object.create(null), counts=Object.create(null);
  return (list||[]).map((b)=>{
    const rawId = b && b.id != null && String(b.id) !== '' ? String(b.id) : '';
    if(rawId && !seen['id:'+rawId]){ seen['id:'+rawId]=1; return 'id:'+rawId; }
    const t = (b && b.type) || 'section';
    const n = counts[t] = (counts[t]||0)+1;
    return 'ix:'+t+'#'+(n-1);
  });
}
const deepEqJson = (a,b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function diffPublishBlocks(aBlocks, bBlocks){
  const A = Array.isArray(aBlocks)?aBlocks:[], B = Array.isArray(bBlocks)?bBlocks:[];
  const ka = blockKeys(A), kb = blockKeys(B);
  const posA = new Map(ka.map((k,i)=>[k,i])), posB = new Map(kb.map((k,i)=>[k,i]));
  const rankA = new Map(); { let r=0; for(const k of ka){ if(posB.has(k)) rankA.set(k, r++); } }
  const rankB = new Map(); { let r=0; for(const k of kb){ if(posA.has(k)) rankB.set(k, r++); } }
  const out = [];
  B.forEach((b,j)=>{
    const k = kb[j], t = (b && b.type) || 'section';
    if(!posA.has(k)){ out.push({ key:k, type:t, status:'added', to_index:j }); return; }
    const i = posA.get(k);
    const changed = !deepEqJson(A[i], b);
    const moved = rankA.get(k) !== rankB.get(k);
    if(changed) out.push({ key:k, type:t, status:'changed', moved, from_index:i, to_index:j });
    else if(moved) out.push({ key:k, type:t, status:'moved', from_index:i, to_index:j });
  });
  A.forEach((a,i)=>{ if(!posB.has(ka[i])) out.push({ key:ka[i], type:(a&&a.type)||'section', status:'removed', from_index:i }); });
  return out;
}

const SECTION_NAMES = { business:'Business details', offerings:'Offerings', faqs:'FAQ', testimonials:'Testimonials', updates:'Updates', media:'Photos', site:'Site' };

function computeCompareChips(data){
  data = data || {};
  const fb = data.from && Array.isArray(data.from.blocks) ? data.from.blocks : null;
  const tb = data.to && Array.isArray(data.to.blocks) ? data.to.blocks : null;
  if(fb && tb){
    return { structured:true, chips: diffPublishBlocks(fb, tb).map((d)=>({ kind:d.status, label: blockName(d.type) + (d.status==='changed' && d.moved ? ' (also moved)' : '') })) };
  }
  const bySec = {}; const order = [];
  for(const ch of (data.changes||[])){ const s=(ch && ch.section)||'site'; if(!(s in bySec)){ bySec[s]=0; order.push(s); } bySec[s]++; }
  return { structured:false, chips: order.map((s)=>({ kind:'changed', label:(SECTION_NAMES[s]||s)+(bySec[s]>1?' · '+bySec[s]:'') })) };
}

// ── harness ──
const results=[];
const ok=(n,p)=>{results.push({n,p});console.log(`${p?'PASS':'FAIL'}  ${n}`);};
const J=(x)=>JSON.stringify(x);
const only=(d,s)=>d.filter((e)=>e.status===s);

// ═══ empty lists ═══
ok('empty: two empty lists → no differences', diffPublishBlocks([],[]).length===0);
ok('empty: null/undefined inputs never throw and diff as empty',
  diffPublishBlocks(null,undefined).length===0
  && J(diffPublishBlocks(null,[{type:'cta',text:'Hi'}]).map(e=>e.status))===J(['added']));
ok('empty: identical lists → no differences',
  diffPublishBlocks([{type:'cta',text:'Hi'},{type:'gallery',images:[]}],[{type:'cta',text:'Hi'},{type:'gallery',images:[]}]).length===0);

// ═══ added (green) ═══
{
  const d = diffPublishBlocks([{type:'cta',text:'Hi'}],[{type:'cta',text:'Hi'},{type:'gallery',images:[]}]);
  ok('added: new block in b → one added entry with its type and b-index',
    d.length===1 && d[0].status==='added' && d[0].type==='gallery' && d[0].to_index===1);
}

// ═══ removed (red) ═══
{
  const d = diffPublishBlocks([{type:'cta',text:'Hi'},{type:'video',url:'u'}],[{type:'cta',text:'Hi'}]);
  ok('removed: block gone from b → one removed entry with its a-index',
    d.length===1 && d[0].status==='removed' && d[0].type==='video' && d[0].from_index===1);
}
{
  const d = diffPublishBlocks([{type:'video',url:'u'},{type:'cta',text:'Hi'},{type:'map'}],[{type:'cta',text:'Hi'}]);
  ok('removed: surviving block does NOT count as moved when only neighbors were removed',
    J(d.map(e=>e.status).sort())===J(['removed','removed']));
}

// ═══ changed (amber) — deep inequality of the block JSON ═══
{
  const d = diffPublishBlocks([{type:'cta',text:'Hi',url:'a'}],[{type:'cta',text:'Hello',url:'a'}]);
  ok('changed: same slot, different field value → changed (not add+remove)',
    d.length===1 && d[0].status==='changed' && d[0].moved===false);
}
{
  const d = diffPublishBlocks([{type:'features',items:[{title:'x',text:'t'}]}],[{type:'features',items:[{title:'x',text:'t2'}]}]);
  ok('changed: deep nested difference is seen', d.length===1 && d[0].status==='changed');
}
ok('changed: deep-equal blocks are NOT flagged',
  diffPublishBlocks([{type:'features',items:[{title:'x'}]}],[{type:'features',items:[{title:'x'}]}]).length===0);

// ═══ moved (blue) — rank shift among matched blocks ═══
{
  const a=[{id:'c1',type:'columns'},{id:'c2',type:'columns'}];
  const b=[{id:'c2',type:'columns'},{id:'c1',type:'columns'}];
  const d = diffPublishBlocks(a,b);
  ok('moved: swapping two id-matched blocks → both moved, nothing added/removed/changed',
    d.length===2 && d.every(e=>e.status==='moved'));
}
{
  const a=[{id:'c1',type:'columns',title:'T'},{id:'c2',type:'columns'}];
  const b=[{id:'c2',type:'columns'},{id:'c1',type:'columns',title:'T2'}];
  const d = diffPublishBlocks(a,b);
  const c1 = d.find(e=>e.key==='id:c1');
  ok('moved+changed: a block that moved AND changed keeps status changed with moved:true',
    c1 && c1.status==='changed' && c1.moved===true);
}

// ═══ id-vs-index matching ═══
{
  const a=[{id:'f1',type:'form',fields:['a']},{type:'cta',text:'Hi'}];
  const b=[{type:'cta',text:'Hi'},{id:'f1',type:'form',fields:['a','b']}];
  const d = diffPublishBlocks(a,b);
  const f1 = d.find(e=>e.key==='id:f1');
  const cta = d.find(e=>e.key==='ix:cta#0');
  ok('id match: a block with a stable id is tracked across positions → changed, never add+remove (the swapped neighbor reads as moved)',
    d.length===2 && f1 && f1.status==='changed' && f1.moved===true && f1.from_index===0 && f1.to_index===1
    && cta && cta.status==='moved');
}
{
  // no ids: same type matches by occurrence index within the list
  const a=[{type:'richtext',body:'one'},{type:'richtext',body:'two'}];
  const b=[{type:'richtext',body:'one'},{type:'richtext',body:'two edited'}];
  const d = diffPublishBlocks(a,b);
  ok('index match: two same-type id-less blocks — editing the second flags ONLY the second',
    d.length===1 && d[0].status==='changed' && d[0].key==='ix:richtext#1');
}
{
  // documented index-matching limit: deleting the FIRST of two id-less same-type
  // blocks reads as "second slot removed + first slot changed" (no id to know better)
  const d = diffPublishBlocks([{type:'richtext',body:'one'},{type:'richtext',body:'two'}],[{type:'richtext',body:'two'}]);
  ok('index match: removing the first of two id-less twins → one changed + one removed (honest limit)',
    J(d.map(e=>e.status).sort())===J(['changed','removed']));
}
{
  const a=[{id:'dup',type:'cards'},{id:'dup',type:'cards'}];
  const d = diffPublishBlocks(a,a);
  ok('id match: duplicate ids never collide (second falls back to type+index) → identical lists diff empty',
    d.length===0 && J(blockKeys(a))===J(['id:dup','ix:cards#0']));
}

// ═══ ordering of the result ═══
{
  const d = diffPublishBlocks(
    [{id:'x',type:'cta',text:'a'},{id:'gone',type:'video',url:'u'}],
    [{id:'new',type:'gallery',images:[]},{id:'x',type:'cta',text:'b'}]);
  ok('order: added/changed follow b\'s order, removed entries come last',
    J(d.map(e=>e.status))===J(['added','changed','removed']));
}

// ═══ blockName — plain-word chip labels ═══
ok('names: common types get plain words', blockName('gallery')==='Photo gallery' && blockName('cta')==='Banner');
ok('names: unknown type falls back to a readable raw type', blockName('mystery_widget')==='Mystery widget');
ok('names: missing type never throws', blockName(undefined)==='Section');

// ═══ computeCompareChips — strip source selection ═══
{
  const cc = computeCompareChips({ from:{blocks:[{type:'cta',text:'a'}]}, to:{blocks:[{type:'cta',text:'b'},{type:'gallery',images:[]}]}, changes:[] });
  ok('chips: block lists present → structured chips with typed colors',
    cc.structured && J(cc.chips)===J([{kind:'changed',label:'Banner'},{kind:'added',label:'Photo gallery'}]));
}
{
  const cc = computeCompareChips({ changes:[
    {section:'business',sentence:'s1'},{section:'offerings',sentence:'s2'},{section:'business',sentence:'s3'},
  ]});
  ok('chips: sentence-only payload (today\'s /publishes/compare) → amber per-section chips with counts',
    !cc.structured && J(cc.chips)===J([{kind:'changed',label:'Business details · 2'},{kind:'changed',label:'Offerings'}]));
}
ok('chips: empty/absent payload → no chips, no crash',
  computeCompareChips(null).chips.length===0 && computeCompareChips({}).chips.length===0);

// ── verdict ──
const fails = results.filter(r=>!r.p);
console.log(`\n${results.length-fails.length}/${results.length} passed`);
if(fails.length){ console.error('FAILURES:', fails.map(f=>f.n).join(' | ')); Deno.exit(1); }
