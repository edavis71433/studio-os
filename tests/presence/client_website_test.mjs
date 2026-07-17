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
function wsCardState(d){if(!d||d.published!==true)return'hidden';const m=d.month;if(!m||!(m.visitors>0))return'empty';return'stats';}
function wsPeople(n){n=Math.max(0,n|0);return n===1?'1 person':n+' people';}
function wsLeadHtml(m){
  m=m||{};
  let h='<b>'+esc(wsPeople(m.visitors))+'</b> visited your website this month';
  const a=Math.max(0,m.actions|0);
  h+=a>0?' — and <b>'+esc(String(a))+' of them reached out</b>: phone taps, emails and booking requests.':'.';
  const src=m.top_source&&m.top_source.source?String(m.top_source.source):'';
  if(src)h+=src==='Direct'?' Most came straight to your website.':' Most arrived from <b>'+esc(src)+'</b>.';
  return h;
}
function wsTiles(m,search){
  const v=Math.max(0,(m&&m.visitors)|0),a=Math.max(0,(m&&m.actions)|0);
  const t=[[String(v),(v===1?'visitor':'visitors')+' this month'],[String(a),'reached out or booked']];
  if(search&&search.clicks!=null)t.push([String(Math.max(0,search.clicks|0)),'clicks from Google search']);
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

const results=[];
const ok=(n,p)=>{results.push({n,p});console.log(`${p?'PASS':'FAIL'}  ${n}`);};

// ═══ wsCardState — hidden / empty / stats ═══
ok('state: no payload / route missing / not published → hidden (the card never renders)',
  wsCardState(null)==='hidden' && wsCardState({})==='hidden' && wsCardState({published:false,month:{visitors:9}})==='hidden');
ok('state: published with zero visitors (or a failed month read) → the gentle empty state',
  wsCardState({published:true,month:{visitors:0,has_data:false}})==='empty' && wsCardState({published:true,month:null})==='empty');
ok('state: published with visitors → stats', wsCardState({published:true,month:{visitors:214}})==='stats');

// ═══ wsPeople — pluralization ═══
ok('people: 1 → "1 person", n → "n people", junk → "0 people"',
  wsPeople(1)==='1 person' && wsPeople(214)==='214 people' && wsPeople(-3)==='0 people' && wsPeople(NaN)==='0 people');

// ═══ wsLeadHtml — the sentence, from real numbers ═══
const FULL_M={visitors:214,actions:11,top_source:{source:'Google',share:41}};
ok('lead: the full sentence bolds the counts and names the top source',
  wsLeadHtml(FULL_M)==='<b>214 people</b> visited your website this month — and <b>11 of them reached out</b>: phone taps, emails and booking requests. Most arrived from <b>Google</b>.');
ok('lead: zero actions drops the reach-out clause (a clean full stop instead)',
  wsLeadHtml({visitors:40,actions:0,top_source:{source:'Google'}})==='<b>40 people</b> visited your website this month. Most arrived from <b>Google</b>.');
ok('lead: no top source drops the arrival clause',
  wsLeadHtml({visitors:40,actions:2})==='<b>40 people</b> visited your website this month — and <b>2 of them reached out</b>: phone taps, emails and booking requests.');
ok('lead: one visitor reads "1 person"; Direct reads as plain English, never "from Direct"',
  wsLeadHtml({visitors:1,actions:1,top_source:{source:'Direct'}})==='<b>1 person</b> visited your website this month — and <b>1 of them reached out</b>: phone taps, emails and booking requests. Most came straight to your website.');
ok('lead: a hostile source label is escaped',
  wsLeadHtml({visitors:5,actions:0,top_source:{source:'<img onerror=x>'}}).includes('&lt;img onerror=x&gt;'));

// ═══ wsTiles — three tiles with GSC, two without ═══
const T3=wsTiles({visitors:214,actions:11},{clicks:38});
ok('tiles: with GSC → visitors · reached out · Google clicks',
  JSON.stringify(T3)===JSON.stringify([['214','visitors this month'],['11','reached out or booked'],['38','clicks from Google search']]));
ok('tiles: no GSC → the Google tile is dropped, the other two stay',
  wsTiles({visitors:214,actions:11},null).length===2 && wsTiles({visitors:214,actions:11},undefined).length===2);
ok('tiles: one visitor → singular label', wsTiles({visitors:1,actions:0},null)[0][1]==='visitor this month');

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

// ═══ structural pins — the route + its reuse of the ONE aggregation path ═══
const ROOT=new URL('../../',import.meta.url);
const read=(p)=>Deno.readTextFileSync(new URL(p,ROOT));
const cd=read('supabase/functions/presence/routes/client_delivery.ts');
const idx=read('supabase/functions/presence/index.ts');
const page=read('client.html');

ok('route: handleClientWebsiteStats exists with the standard client-handler signature',
  /export async function handleClientWebsiteStats\(_req: Request, site: SiteRow, _principal: Principal, cors: Record<string, string>\)/.test(cd));
ok('route: unpublished sites short-circuit to published:false (the portal hides the card)',
  /const published = site\.status === 'live' \|\| !!site\.last_published_at;\s*\n\s*if \(!published\) return json\(\{ data: \{ published: false/.test(cd));
ok('route: the visits read is scoped to the caller\'s OWN site (site_id=eq.${site.id})',
  /presence_visits\?site_id=eq\.\$\{site\.id\}&ts=gte\./.test(cd));
ok('route: reuses the slice-8 pure helpers (dashRange · weeklyVisitors · sourceShares · aggregateVisits)',
  /from '\.\.\/lib\/analytics_dashboard\.ts'/.test(cd) && /dashRange\('this_month', nowMs\)/.test(cd)
  && /weeklyVisitors\(vRows, nowMs\)/.test(cd) && /sourceShares\(agg\.topSources, agg\.visitors\)/.test(cd));
ok('route: reuses the dashboard\'s GSC reads (readGsc + readSearchTerms from routes/analytics.ts)',
  /import \{ readGsc, readSearchTerms \} from '\.\/analytics\.ts';/.test(cd)
  && /gsc && gsc\.hasData/.test(cd) && /readSearchTerms\(site\.client_id \|\| '', gsc\.period\)/.test(cd));
ok('route: tolerant reads — each section null on failure, never a 500 for the card',
  /const safe = async <T>\(p: Promise<T>\): Promise<T \| null>[\s\S]*?safe\(svc\(`presence_visits/.test(cd)
  && /let month: unknown = null;/.test(cd) && /let search: unknown = null;/.test(cd));
ok('wiring: GET /client/website-stats dispatched beside the other client routes',
  /route === '\/client\/website-stats' && method === 'GET'\) return handleClientWebsiteStats\(req, site, principal, cors\)/.test(idx));
ok('wiring: every pre-existing /client/* dispatch is untouched',
  ['handleClientProjects','handleClientProject','handleClientReport','handleClientMessages','handleClientDeliverableDownload',
   'handleClientApprovalDecide','handleClientSurvey','handleClientSurveyRespond','handleClientNotifications','handleClientNotificationsRead',
   'handleClientSupport','handleClientSupportOne','handleClientSupportMessage','handleClientBilling','handleClientDocuments',
   'handleClientBook','handleClientTaskDone','handleClientUploadUrl','handleClientUploadCreate','handleClientServices','handleClientFaq'].every((h)=>idx.includes(h+'(')));
ok('page: client.html fetches /client/website-stats and hides the slot on any non-OK read',
  page.includes("api('/client/website-stats')") && /id="home-website" hidden/.test(page));
ok('page: the disclosure button carries aria-expanded + aria-controls and toggles in place',
  page.includes('aria-expanded="false" aria-controls="wsfull"') && page.includes("btn.setAttribute('aria-expanded',open?'false':'true')"));
ok('page: the sparkline SVG is aria-hidden with the values present as sr-only text',
  /wsspark" viewBox="0 0 520 54" preserveAspectRatio="none" aria-hidden="true"/.test(page)
  && page.includes("Visitors per week, oldest to newest: '+wk.join(', ')"));
ok('page: the privacy line matches what the collector actually does (cookie-less)',
  page.includes('Counted privately — no cookies, no tracking of individual people.'));

// keep the mirrors honest: the page carries the exact same helper definitions
for(const fn of ['wsCardState','wsPeople','wsLeadHtml','wsTiles','wsSparkPoints','wsPageLabel','wsSourceLabel','wsCount','wsTermLine']){
  const m=String({wsCardState,wsPeople,wsLeadHtml,wsTiles,wsSparkPoints,wsPageLabel,wsSourceLabel,wsCount,wsTermLine}[fn]);
  ok(`mirror: client.html defines ${fn} verbatim`,page.includes(m));
}

const passed=results.filter(r=>r.p).length,failed=results.length-passed;
console.log(`\n════ CLIENT WEBSITE CARD: ${passed}/${results.length} PASSED ════`);
if(failed)Deno.exit(1);
