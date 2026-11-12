// ── Slice 8b: the portal "Your website" card — pure helpers + wiring pins ────
//   deno run --allow-read tests/presence/client_website_test.mjs
// The sentence/degradation helpers live inline in client.html (no bundler to
// import from) and are mirrored here 1:1, the portal_ux_test.mjs way — keep
// both copies in sync. Structural pins lock the /client/website-stats route:
// registered beside the other client routes, same handler shape, reusing the
// slice-8 dashboard's pure helpers so studio and portal numbers always agree —
// and every pre-existing /client/* dispatch untouched.

// ── mirrors (verbatim) of the pure helpers in client.html ──
const esc=(s)=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function wsCardState(d){if(!d||d.published!==true)return'hidden';const m=d.month;if(!m)return'bare';if(m.has_data===false||!(m.visitors>0))return'empty';return'stats';}
function wsSiteInfo(d){const s=(d&&d.site)||{};const url=typeof s.url==='string'&&/^https:\/\//.test(s.url)?s.url:'';return{url,host:url.replace(/^https:\/\//,''),published_at:(typeof s.last_published_at==='string'&&s.last_published_at)||''};}
function rel(iso){const t=Date.parse(iso);if(!isFinite(t))return'';const s=Math.floor((Date.now()-t)/1000);if(s<60)return'just now';const m=Math.floor(s/60);if(m<60)return m+(m===1?' min ago':' mins ago');const h=Math.floor(m/60);if(h<24)return h+(h===1?' hour ago':' hours ago');const d=Math.floor(h/24);if(d<7)return d+(d===1?' day ago':' days ago');return new Date(t).toLocaleDateString('en-US',{month:'short',day:'numeric'});}
function wsPeople(n){n=Math.max(0,n|0);return n===1?'1 person':n+' people';}
function wsLeadHtml(m){
  m=m||{};
  let h='<b>'+esc(wsPeople(m.visitors))+'</b> visited your website this month';
  const a=Math.max(0,m.actions|0);
  h+=a>0?' — and it brought in <b>'+esc(String(a))+(a===1?' tap':' taps')+' to call, email or book</b>.':'.';
  const src=m.top_source&&m.top_source.source?String(m.top_source.source):'';
  if(src)h+=src==='Direct'?' Most came straight to your website.':' Most arrived from <b>'+esc(src)+'</b>.';
  return h;
}
function wsGscQualifier(period,nowMs){
  const m=/^(\d{4})-(\d{2})$/.exec(String(period||''));
  if(!m)return'';
  const d=new Date(nowMs==null?Date.now():nowMs);
  const cur=d.getUTCFullYear()+'-'+('0'+(d.getUTCMonth()+1)).slice(-2);
  if(m[0]===cur)return'';
  const names=['January','February','March','April','May','June','July','August','September','October','November','December'];
  const n=names[Number(m[2])-1];
  return n?' · in '+n:'';
}
function wsTiles(m,search){
  const v=Math.max(0,(m&&m.visitors)|0),a=Math.max(0,(m&&m.actions)|0);
  const t=[[String(v),(v===1?'visitor':'visitors')+' this month'],[String(a),(a===1?'tap':'taps')+' to call, email or book']];
  if(search&&search.clicks!=null)t.push([String(Math.max(0,search.clicks|0)),'clicks from Google search'+wsGscQualifier(search.period)]);
  return t;
}
function wsSparkPoints(weekly,w,h,pad){
  const a=(weekly||[]).map(n=>Math.max(0,n|0));
  if(a.length<2)return'';
  pad=pad==null?6:pad;
  const max=Math.max(1,Math.max.apply(null,a));
  const dx=w/(a.length-1);
  const r=(x)=>Math.round(x*10)/10;
  return a.map((n,i)=>r(i*dx)+','+r(h-pad-(n/max)*(h-2*pad))).join(' ');
}
function wsPageLabel(p){p=String(p||'');const seg=p.replace(/\/+$/,'').split('/').pop()||'';const t=seg.replace(/\.[a-z0-9]+$/i,'').replace(/[-_]+/g,' ').trim();return t?t.charAt(0).toUpperCase()+t.slice(1):'Home page';}
function wsSourceLabel(s){s=String(s||'');return s==='Direct'?'Straight to your site':s;}
function wsCount(n,one,many){n=Math.max(0,n|0);return n+' '+(n===1?one:many);}
function wsTermLine(t){const c=Math.max(0,(t&&t.clicks)|0),i=Math.max(0,(t&&t.impressions)|0);return c>0?wsCount(c,'click','clicks'):(i===1?'seen once':'seen '+i+' times');}
function wsFullHtml(m,search){
  let h='';
  const wk=((m&&m.weekly)||[]).map(n=>Math.max(0,n|0));
  if(wk.length>1){
    h+='<h3 class="wsh">Visitors, week by week</h3><p class="muted" style="font-size:12.5px;margin:0 0 4px">The last 12 weeks, oldest to newest.</p>'
      +'<svg class="wsspark" style="height:72px" viewBox="0 0 520 72" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline fill="none" stroke="var(--p)" stroke-width="2.5" opacity=".85" points="'+wsSparkPoints(wk,520,72,8)+'"/></svg>'
      +'<span class="sr-only">'+esc('Visitors per week, oldest to newest: '+wk.join(', ')+'.')+'</span>';
  }
  const pages=((m&&m.top_pages)||[]).slice(0,5);
  if(pages.length)h+='<h3 class="wsh">Your most-visited pages</h3><div class="wslist">'+pages.map(p=>'<div class="wsrow"><span>'+esc(wsPageLabel(p.path))+'</span><span class="wsnum">'+esc(wsCount(p.views,'view','views'))+'</span></div>').join('')+'</div>';
  const srcs=((m&&m.sources)||[]).slice(0,5);
  if(srcs.length)h+='<h3 class="wsh">Where people came from</h3><div class="wslist">'+srcs.map(s=>'<div class="wsrow"><span>'+esc(wsSourceLabel(s.source))+'</span><span class="wsnum">'+esc(String(Math.max(0,s.share|0)))+'%</span></div>').join('')+'</div>';
  const terms=((search&&search.top_terms)||[]).slice(0,5);
  if(terms.length)h+='<h3 class="wsh">What people searched on Google</h3><div class="wslist">'+terms.map(t=>'<div class="wsrow"><span>“'+esc(t.term)+'”</span><span class="wsnum">'+esc(wsTermLine(t))+'</span></div>').join('')+'</div>';
  return h;
}
function wsCardHtml(d){
  const state=wsCardState(d);
  if(state==='hidden')return'';
  const priv='<span class="wspriv">Counted privately — no cookies, no tracking of individual people.</span>';
  const site=wsSiteInfo(d);
  const pic='<div class="wspic" id="wspic"><div class="wsini" aria-hidden="true">✦</div></div>';
  const bar='<div class="wsbar"><span class="pill-live">Live</span>'+(site.url?'<a class="wsdomain" href="'+esc(site.url)+'" target="_blank" rel="noopener">'+esc(site.host)+' ↗</a>':'')+(site.published_at?'<span class="wswhen">Published '+esc(rel(site.published_at))+'</span>':'')+'</div>';
  const see=site.url?'<a class="btn wssee" href="'+esc(site.url)+'" target="_blank" rel="noopener">See your site</a>':'';
  // 'bare' = the stats read inside the route failed (month:null) — the picture
  // and the live link still work, and the card says the numbers couldn't be
  // checked rather than pretending there are none (the A4 honesty rule).
  if(state!=='stats')return '<div class="card wscard">'+pic+'<div class="wsin"><span class="tag">Your website</span>'+bar
    +'<h3>'+(state==='empty'?'Your website is ready to be found.':'Your website, at a glance.')+'</h3>'
    +'<p class="wslead">'+(state==='empty'?'Stats will appear here as people visit — check back soon.':'We couldn’t check your visitor numbers just now — your site itself is fine.')+'</p>'
    +'<div class="wsfoot">'+see+priv+'</div></div></div>';
  const m=d.month,search=d.search;
  const wk=(m.weekly||[]).map(n=>Math.max(0,n|0));
  const pts=wsSparkPoints(wk,520,54,6);
  const full=wsFullHtml(m,search);
  return '<div class="card wscard">'+pic+'<div class="wsin"><span class="tag">Your website</span>'+bar
    +'<h3>People are finding you.</h3>'
    +'<p class="wslead">'+wsLeadHtml(m)+(m.truncated?' <span class="muted" style="font-size:12px">· based on recent activity</span>':'')+'</p>'
    +(pts?'<svg class="wsspark" viewBox="0 0 520 54" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline fill="none" stroke="var(--p)" stroke-width="2.5" opacity=".85" points="'+pts+'"/></svg><span class="sr-only">'+esc('Visitors per week, oldest to newest: '+wk.join(', ')+'.')+'</span>':'')
    +'<div class="wsmini">'+wsTiles(m,search).map(t=>'<div class="m"><p class="n">'+esc(t[0])+'</p><p class="l">'+esc(t[1])+'</p></div>').join('')+'</div>'
    +(full?'<div id="wsfull" hidden>'+full+'</div>':'')
    +'<div class="wsfoot">'+see+(full?'<button type="button" id="wsmore" class="wsmore" aria-expanded="false" aria-controls="wsfull">See the full picture →</button>':'')+priv+'</div></div></div>';
}

const results=[];
const ok=(n,p)=>{results.push({n,p});console.log(`${p?'PASS':'FAIL'}  ${n}`);};

// ═══ wsCardState — hidden / bare / empty / stats ═══
ok('state: no payload / route missing / not published → hidden (the card never renders)',
  wsCardState(null)==='hidden' && wsCardState({})==='hidden' && wsCardState({published:false,month:{visitors:9}})==='hidden');
ok('state: published but the month read FAILED (month:null) → bare — the picture and live link still render, but the card never claims the empty story for a transient DB failure',
  wsCardState({published:true,month:null})==='bare' && wsCardState({published:true})==='bare');
ok('state: published with a SUCCESSFUL zero-visitor read (or has_data:false) → the gentle empty state',
  wsCardState({published:true,month:{visitors:0,has_data:false}})==='empty'
  && wsCardState({published:true,month:{visitors:0,has_data:true}})==='empty'
  && wsCardState({published:true,month:{visitors:9,has_data:false}})==='empty');
ok('state: published with visitors → stats', wsCardState({published:true,month:{visitors:214}})==='stats');

// ═══ wsSiteInfo — the live address + published-when, https-only ═══
ok('site info: https url passes through with its host; last_published_at carried',
  JSON.stringify(wsSiteInfo({site:{url:'https://maria.example',last_published_at:'2026-11-01T00:00:00Z'}}))
  ===JSON.stringify({url:'https://maria.example',host:'maria.example',published_at:'2026-11-01T00:00:00Z'}));
ok('site info: a non-https url (or none, or junk types) yields NO link — the card never links http or javascript:',
  wsSiteInfo({site:{url:'http://x.example'}}).url==='' && wsSiteInfo({site:{url:'javascript:alert(1)'}}).url===''
  && wsSiteInfo({}).url==='' && wsSiteInfo(null).url==='' && wsSiteInfo({site:{url:42,last_published_at:9}}).published_at==='');
ok('bare card: carries the picture slot, the live link and the couldn\'t-check line (never the "ready to be found" story)',
  (()=>{const h=wsCardHtml({published:true,month:null,site:{url:'https://maria.example'}});
    return h.includes('id="wspic"') && h.includes('maria.example ↗') && h.includes('We couldn’t check your visitor numbers just now')
      && !h.includes('ready to be found');})());
ok('empty card: picture slot + "ready to be found" + See your site when the url is known',
  (()=>{const h=wsCardHtml({published:true,month:{visitors:0,has_data:true},site:{url:'https://maria.example'}});
    return h.includes('id="wspic"') && h.includes('ready to be found') && h.includes('>See your site</a>');})());
ok('stats card: picture slot + LIVE pill + domain link + the stats story together',
  (()=>{const h=wsCardHtml({published:true,month:{visitors:214,actions:2},site:{url:'https://maria.example',last_published_at:new Date(Date.now()-3*86400000).toISOString()}});
    return h.includes('id="wspic"') && h.includes('pill-live') && h.includes('maria.example ↗')
      && h.includes('Published 3 days ago') && h.includes('People are finding you.');})());
ok('hostile: a hostile site url never becomes a link, a hostile host string is escaped',
  !wsCardHtml({published:true,month:{visitors:5},site:{url:'javascript:alert(1)'}}).includes('javascript:')
  && wsCardHtml({published:true,month:{visitors:5},site:{url:'https://x.example/"><img onerror=x>'}}).includes('&quot;&gt;&lt;img'));

// ═══ wsPeople — pluralization ═══
ok('people: 1 → "1 person", n → "n people", junk → "0 people"',
  wsPeople(1)==='1 person' && wsPeople(214)==='214 people' && wsPeople(-3)==='0 people' && wsPeople(NaN)==='0 people');

// ═══ wsLeadHtml — the sentence, from real numbers ═══
const FULL_M={visitors:214,actions:11,top_source:{source:'Google',share:41}};
ok('lead: the full sentence bolds the counts and names the top source',
  wsLeadHtml(FULL_M)==='<b>214 people</b> visited your website this month — and it brought in <b>11 taps to call, email or book</b>. Most arrived from <b>Google</b>.');
ok('lead: zero actions drops the brought-in clause (a clean full stop instead)',
  wsLeadHtml({visitors:40,actions:0,top_source:{source:'Google'}})==='<b>40 people</b> visited your website this month. Most arrived from <b>Google</b>.');
ok('lead: no top source drops the arrival clause',
  wsLeadHtml({visitors:40,actions:2})==='<b>40 people</b> visited your website this month — and it brought in <b>2 taps to call, email or book</b>.');
ok('lead: one visitor reads "1 person" / "1 tap"; Direct reads as plain English, never "from Direct"',
  wsLeadHtml({visitors:1,actions:1,top_source:{source:'Direct'}})==='<b>1 person</b> visited your website this month — and it brought in <b>1 tap to call, email or book</b>. Most came straight to your website.');
ok('lead: actions are EVENTS, not people — more taps than visitors still reads true (never "3 of them" for 1 person)',
  wsLeadHtml({visitors:1,actions:3})==='<b>1 person</b> visited your website this month — and it brought in <b>3 taps to call, email or book</b>.');
ok('lead: a hostile source label is escaped',
  wsLeadHtml({visitors:5,actions:0,top_source:{source:'<img onerror=x>'}}).includes('&lt;img onerror=x&gt;'));

// ═══ wsGscQualifier — GSC period labeling (" · in June" when the data lags) ═══
const JUL_NOW=Date.parse('2026-07-17T12:00:00Z');
ok('gsc qualifier: a lagging period names its month',
  wsGscQualifier('2026-06',JUL_NOW)===' · in June' && wsGscQualifier('2001-05',JUL_NOW)===' · in May');
ok('gsc qualifier: the current calendar month needs no qualifier',
  wsGscQualifier('2026-07',JUL_NOW)==='');
ok('gsc qualifier: malformed periods yield NO qualifier, never a wrong one',
  wsGscQualifier('junk',JUL_NOW)==='' && wsGscQualifier('',JUL_NOW)==='' && wsGscQualifier(null,JUL_NOW)===''
  && wsGscQualifier('2026-13',JUL_NOW)==='' && wsGscQualifier('2026-00',JUL_NOW)==='');

// ═══ wsTiles — three tiles with GSC, two without ═══
const T3=wsTiles({visitors:214,actions:11},{clicks:38});
ok('tiles: with GSC → visitors · taps to call/email/book · Google clicks',
  JSON.stringify(T3)===JSON.stringify([['214','visitors this month'],['11','taps to call, email or book'],['38','clicks from Google search']]));
ok('tiles: no GSC (null/undefined/unavailable) → the Google tile is dropped, the other two stay',
  wsTiles({visitors:214,actions:11},null).length===2 && wsTiles({visitors:214,actions:11},undefined).length===2
  && wsTiles({visitors:214,actions:11},{unavailable:true}).length===2);
ok('tiles: singular labels — one visitor, one tap', wsTiles({visitors:1,actions:1},null)[0][1]==='visitor this month'
  && wsTiles({visitors:1,actions:1},null)[1][1]==='tap to call, email or book');
ok('tiles: a lagging GSC period qualifies the Google tile label',
  wsTiles({visitors:5,actions:0},{clicks:38,period:'2001-05'})[2][1]==='clicks from Google search · in May');

// ═══ wsSparkPoints — pure polyline geometry ═══
const PTS=wsSparkPoints([0,5,10],100,54,6);
ok('spark: oldest left, newest right; max hits the top pad, zero sits on the bottom pad',
  PTS==='0,48 50,27 100,6');
ok('spark: fewer than 2 points (or none) draws nothing',
  wsSparkPoints([7],100,54,6)==='' && wsSparkPoints([],100,54,6)==='' && wsSparkPoints(null,100,54,6)==='');
ok('spark: an all-zero series stays a flat line on the bottom pad (no divide-by-zero)',
  wsSparkPoints([0,0,0],100,54,6)==='0,48 50,48 100,48');
ok('spark: junk values clamp to zero, never NaN in the points',
  !wsSparkPoints([3,NaN,-2,'x',8],100,54,6).includes('NaN'));

// ═══ wsPageLabel / wsSourceLabel / wsCount / wsTermLine — plain-voice rows ═══
ok('page label: / → Home page; slugs humanize; extensions drop',
  wsPageLabel('/')==='Home page' && wsPageLabel('')==='Home page' && wsPageLabel('/our-services')==='Our services'
  && wsPageLabel('/about/')==='About' && wsPageLabel('/contact.html')==='Contact');
ok('source label: Direct reads as "Straight to your site"; anything else passes through',
  wsSourceLabel('Direct')==='Straight to your site' && wsSourceLabel('Google')==='Google');
ok('count: singular/plural + junk-safe', wsCount(1,'view','views')==='1 view' && wsCount(12,'view','views')==='12 views' && wsCount(NaN,'view','views')==='0 views');
ok('term line: clicks when there are clicks; "seen" otherwise ("seen once" for 1)',
  wsTermLine({clicks:12,impressions:300})==='12 clicks' && wsTermLine({clicks:1,impressions:9})==='1 click'
  && wsTermLine({clicks:0,impressions:5})==='seen 5 times' && wsTermLine({clicks:0,impressions:1})==='seen once');

// ═══ hostile strings through EVERY wsFullHtml/wsCardHtml sink ═══
{
  const EVIL='<img src=x onerror=alert(1)>';
  const m={visitors:5,actions:2,top_source:{source:EVIL},weekly:[1,2,3],
    top_pages:[{path:'/'+EVIL,views:5}],sources:[{source:EVIL,share:40}],has_data:true};
  const search={clicks:2,top_terms:[{term:EVIL,clicks:2,impressions:9}]};
  const full=wsFullHtml(m,search);
  ok('hostile: wsFullHtml escapes page paths, source labels and search terms (no raw <img> ever)',
    !full.includes('<img') && full.includes('&lt;img'));
  const card=wsCardHtml({published:true,month:m,search});
  ok('hostile: wsCardHtml escapes every sink end-to-end (lead, tiles, breakdown)',
    !card.includes('<img') && card.includes('&lt;img'));
}
// ═══ truncation honesty: a capped month says "based on recent activity" ═══
ok('truncated month → the card carries the "based on recent activity" note; untruncated never does',
  wsCardHtml({published:true,month:{...FULL_M,weekly:[1,2],truncated:true},search:null}).includes('· based on recent activity')
  && !wsCardHtml({published:true,month:{...FULL_M,weekly:[1,2]},search:null}).includes('based on recent activity'));

// ═══ structural pins — the route + its reuse of the ONE aggregation path ═══
const ROOT=new URL('../../',import.meta.url);
const read=(p)=>Deno.readTextFileSync(new URL(p,ROOT));
const cd=read('supabase/functions/presence/routes/client_delivery.ts');
const vs=read('supabase/functions/presence/lib/visit_stats.ts');
const idx=read('supabase/functions/presence/index.ts');
const page=read('client.html');

ok('route: handleClientWebsiteStats exists with the standard client-handler signature',
  /export async function handleClientWebsiteStats\(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>\)/.test(cd));
ok('route: unpublished sites short-circuit to published:false (the portal hides the card)',
  /const published = site\.status === 'live' \|\| !!site\.last_published_at;\s*\n\s*if \(!published\) return json\(\{ data: \{ published: false/.test(cd));
ok('route: the visits read is scoped to the caller\'s OWN site, and counted in the database (item 207)',
  /readVisitStats\(site\.id, \{ startMs, weeks: DASH_WEEKS, nowMs \}\)/.test(cd) && !/presence_visits\?/.test(cd.slice(cd.indexOf('export async function handleClientWebsiteStats'), cd.indexOf('// search: null = genuinely not connected'))));
ok('route: reuses the slice-8 pure helpers (dashRange · sourceShares) and the dashboard\'s own visits read',
  /from '\.\.\/lib\/analytics_dashboard\.ts'/.test(cd) && /dashRange\('this_month', nowMs\)/.test(cd)
  && /weekly: stats\.weekly \|\| \[\]/.test(cd) && /sourceShares\(agg\.topSources, agg\.visitors\)/.test(cd));
ok('route: exact calendar boundary — the count starts at the true month start, in the database and on the row path',
  /p_start: iso\(w\.startMs\)/.test(vs) && /ms >= w\.startMs && ms < end/.test(vs) && /ts >= p_start/.test(read('supabase/migrations/0191_visit_stats.sql')));
ok('route: reuses the dashboard\'s GSC reads (readGsc + readSearchTerms from routes/analytics.ts)',
  /import \{ readGsc, readSearchTerms \} from '\.\/analytics\.ts';/.test(cd)
  && /readSearchTerms\(site\.client_id \|\| '', gsc\.period\)/.test(cd));
ok('route: a FAILED GSC read is distinguishable from not-connected (unavailable:true vs null)',
  cd.includes('if (!gsc || !gsc.ok) search = { unavailable: true };') && cd.includes('else if (gsc.hasData)'));
ok('route: the portal search payload names its period (same string the studio shows)',
  /clicks: gsc\.clicks, impressions: gsc\.impressions, period: gsc\.period/.test(cd));
ok('route: the month payload carries the truncation flag (only the row path before 0191 can set it)',
  /truncated: stats\.truncated/.test(cd));
ok('route: tolerant reads — each section null on failure, never a 500 for the card',
  /const safe = async <T>\(p: Promise<T>\): Promise<T \| null>[\s\S]*?safe\(readVisitStats\(/.test(cd)
  && /let month: unknown = null;/.test(cd) && /let search: unknown = null;/.test(cd));
ok('wiring: GET /client/website-stats dispatched beside the other client routes',
  /route === '\/client\/website-stats' && method === 'GET'\) return handleClientWebsiteStats\(req, site, principal, cors\)/.test(idx));
// ── item 179: the stats payload carries the site's own facts, and the picture route ──
ok('route: the stats payload carries the live address (siteOrigin) + last_published_at',
  /site: \{ url: siteOrigin\(site\) \|\| null, last_published_at: site\.last_published_at \|\| null \}/.test(cd));
ok('route: handleClientWebsiteThumb exists with the standard client-handler signature',
  /export async function handleClientWebsiteThumb\(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>\)/.test(cd));
ok('route: the thumb reuses the ONE renderer (agency renderThumb, dynamic import) with the same size cap',
  /await import\('\.\.\/agency\/sites\.ts'\)/.test(cd) && /renderThumb\(site\)/.test(cd) && /THUMB_MAX_CHARS/.test(cd));
ok('route: a monitor-edition site (hosted elsewhere) answers 404, never a render attempt',
  /site\.edition === 'monitor'.*hosted_elsewhere/.test(cd));
ok('route: the thumb answer is no-store (its photo links expire)',
  /handleClientWebsiteThumb[\s\S]*?'Cache-Control': 'no-store'/.test(cd));
ok('wiring: GET /client/website-thumb dispatched beside website-stats',
  /route === '\/client\/website-thumb' && method === 'GET'\) return handleClientWebsiteThumb\(req, site, principal, cors\)/.test(idx));
ok('page: the picture frame is sandboxed with scripts OFF and drawn once per load (in-flight promise cached)',
  page.includes("f.setAttribute('sandbox','allow-same-origin')")
  && page.includes("if(!PORTAL.wsthumbFetch)PORTAL.wsthumbFetch=api('/client/website-thumb')")
  && page.includes('PORTAL.wsthumb=undefined;PORTAL.wsthumbFetch=null;'));
ok('wiring: every pre-existing /client/* dispatch is untouched',
  ['handleClientProjects','handleClientProject','handleClientReport','handleClientMessages','handleClientDeliverableDownload',
   'handleClientApprovalDecide','handleClientSurvey','handleClientSurveyRespond','handleClientNotifications','handleClientNotificationsRead',
   'handleClientSupport','handleClientSupportOne','handleClientSupportMessage','handleClientBilling','handleClientDocuments',
   'handleClientBook','handleClientTaskDone','handleClientUploadUrl','handleClientUploadCreate','handleClientServices','handleClientFaq'].every((h)=>idx.includes(h+'(')));
ok('page: client.html fetches /client/website-stats and hides the slot on any non-OK read',
  page.includes("api('/client/website-stats')") && /id="home-website" hidden/.test(page));
ok('page: at most ONE in-flight website-stats fetch (the promise itself is cached)',
  page.includes('if(!PORTAL.wstatsFetch)PORTAL.wstatsFetch=api(\'/client/website-stats\')')
  && page.includes('PORTAL.wstats=await PORTAL.wstatsFetch;')
  && page.includes('PORTAL.wstats=undefined;PORTAL.wstatsFetch=null;'));
ok('page: the disclosure button carries aria-expanded + aria-controls and toggles in place',
  page.includes('aria-expanded="false" aria-controls="wsfull"') && page.includes("btn.setAttribute('aria-expanded',open?'false':'true')"));
ok('page: the sparkline SVG is aria-hidden with the values present as sr-only text',
  /wsspark" viewBox="0 0 520 54" preserveAspectRatio="none" aria-hidden="true"/.test(page)
  && page.includes("Visitors per week, oldest to newest: '+wk.join(', ')"));
ok('page: the privacy line matches what the collector actually does (cookie-less)',
  page.includes('Counted privately — no cookies, no tracking of individual people.'));

// keep the mirrors honest: the page carries the exact same helper definitions
for(const fn of ['wsCardState','wsSiteInfo','wsPeople','wsLeadHtml','wsGscQualifier','wsTiles','wsSparkPoints','wsPageLabel','wsSourceLabel','wsCount','wsTermLine','wsFullHtml','wsCardHtml']){
  const m=String({wsCardState,wsSiteInfo,wsPeople,wsLeadHtml,wsGscQualifier,wsTiles,wsSparkPoints,wsPageLabel,wsSourceLabel,wsCount,wsTermLine,wsFullHtml,wsCardHtml}[fn]);
  ok(`mirror: client.html defines ${fn} verbatim`,page.includes(m));
}

const passed=results.filter(r=>r.p).length,failed=results.length-passed;
console.log(`\n════ CLIENT WEBSITE CARD: ${passed}/${results.length} PASSED ════`);
if(failed)Deno.exit(1);
