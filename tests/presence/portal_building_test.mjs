// ── Builder list item 179, reopened: the portal while a website isn't live yet ──
//   deno run --allow-read tests/presence/portal_building_test.mjs
// Every client site starts unpublished, and the first build of Home only drew a
// live one: no website card, an empty half on a computer, and the platform's name
// where the studio's belongs. The card's helpers live inline in client.html, so
// they are lifted out of the page and run here; the server half is imported.
import { starterQuestions, isQuestionnaireTitle, STARTER_QUESTIONNAIRE_TITLE } from '../../supabase/functions/presence/lib/starter_questionnaire.ts';
import { normalizeQuestions } from '../../supabase/functions/presence/lib/intake.ts';

const results=[];const ok=(name,p)=>{results.push({name,p:!!p});console.log(`${p?'PASS':'FAIL'}  ${name}`);};
const read=(p)=>Deno.readTextFileSync(new URL(p,import.meta.url));
const page=read('../../client.html');
// lift one top-level function out of the page by matching its braces
function lift(name){const i=page.indexOf('\nfunction '+name+'(');if(i<0)throw new Error('missing '+name);let d=0,j=page.indexOf('{',i);for(;j<page.length;j++){if(page[j]==='{')d++;else if(page[j]==='}'&&--d===0)break;}return page.slice(i+1,j+1);}
const esc=(s)=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const rel=()=>'2 days ago';
const {wsDraftOf,wsBuildState,wsBuildHtml}=new Function('esc','rel',lift('wsDraftOf')+lift('wsBuildState')+lift('wsBuildHtml')+';return {wsDraftOf,wsBuildState,wsBuildHtml};')(esc,rel);

const NOT_LIVE={published:false,month:null,search:null};
const ap=(status,over={})=>({a:{id:'a1',subject_type:'website',status,summary:'Does this feel like your shop?',decided_at:'2026-11-10T00:00:00Z',...over},pid:'p1'});

// ═══ which state ═══
ok('state: a live site is not this card’s business', wsBuildState({published:true},null)==='hidden' && wsBuildState(null,null)==='hidden' && wsBuildState({},ap('pending'))==='hidden');
ok('state: not live, nothing shared → building', wsBuildState(NOT_LIVE,null)==='building');
ok('state: a draft waiting for an OK → ready', wsBuildState(NOT_LIVE,ap('pending'))==='ready');
ok('state: approved → approved', wsBuildState(NOT_LIVE,ap('approved'))==='approved');
ok('state: a change was asked for → building again', wsBuildState(NOT_LIVE,ap('changes_requested'))==='building');
ok('draft: the newest website approval of the first project that has one', (()=>{const d=wsDraftOf([{id:'p0',website:null},{id:'p1',website:{id:'a9'}},{id:'p2',website:{id:'a8'}}]);return d&&d.pid==='p1'&&d.a.id==='a9';})() && wsDraftOf([])===null && wsDraftOf(null)===null);

// ═══ the words ═══
const building=wsBuildHtml('building',null,2,'Marlow & Co');
ok('building: says it isn’t live, who is building it, and what comes next', building.includes('Being built') && building.includes('Your website is on its way.') && building.includes('Marlow &amp; Co is building it.') && building.includes('Next: the 2 things under Needs you.'));
ok('building: one thing reads as one thing; nothing waiting promises the draft', wsBuildHtml('building',null,1,'S').includes('the one thing under Needs you') && wsBuildHtml('building',null,0,'S').includes('You’ll get a draft to look at here as soon as it’s ready.'));
ok('building: no button, the picture faded until the studio shares it', !building.includes('<button') && building.includes('class="wspic dim"'));
const ready=wsBuildHtml('ready',ap('pending'),1,'Marlow & Co');
ok('ready: the one filled button opens the draft itself', ready.includes('Draft ready') && ready.includes('class="approve wsreview"') && ready.includes('data-ws-apr="a1"') && ready.includes('data-ws-proj="p1"') && ready.includes('>Review the draft</button>'));
ok('ready: the studio’s question in its own words, picture clear', ready.includes('Marlow &amp; Co asked: “Does this feel like your shop?”') && ready.includes('class="wspic"'));
ok('ready: no question → asks them to have a look', wsBuildHtml('ready',ap('pending',{summary:''}),0,'S').includes('Have a look and tell S what you think.'));
const approved=wsBuildHtml('approved',ap('approved'),0,'Marlow & Co');
ok('approved: says so, when, and what happens next; the draft stays one press away', approved.includes('You approved your website.') && approved.includes('2 days ago · Marlow &amp; Co is getting it ready to go live.') && approved.includes('>See the draft again</button>') && !approved.includes('class="approve'));
ok('a change asked for: says the studio is on it', wsBuildHtml('building',ap('changes_requested'),0,'S').includes('You asked for a change. S is working on it'));
ok('never a number, a Live pill or an address before the site is live', [building,ready,approved].every(h=>!h.includes('visit')&&!h.includes('>Live<')&&!h.includes('href=')));
ok('hostile words are escaped in every state', (()=>{const x='"><img src=x onerror=1>';return [wsBuildHtml('building',null,1,x),wsBuildHtml('ready',ap('pending',{summary:x,id:x}),1,x),wsBuildHtml('approved',ap('approved'),1,x)].every(h=>!h.includes('<img'));})());
ok('hidden draws nothing', wsBuildHtml('hidden',null,0,'S')==='');

// ═══ the page: wiring ═══
ok('page: an unpublished site gets the card, built from the projects', /if\(!h&&PORTAL\.wstats&&PORTAL\.wstats\.published===false\)\{\s*const snaps=await ensureSnaps\(\);/.test(page));
ok('page: a client’s slot holds its place while loading; nothing to show closes it', page.includes('P.persona===\'client\'?`<section id="home-website"><div class="card wscard" aria-hidden="true">') && page.includes('if(!h){wsSlotOff();return;}'));
ok('page: Home packs densely, so an empty slot never leaves an empty half', /body\.homeview #main\{[^}]*grid-auto-flow:row dense/.test(page));
ok('page: the tour comes after the website and what needs them', page.indexOf('html+=welcomeCardHtml();')>page.indexOf('<section id="home-projects">'));
ok('page: the draft review is not a to-do of its own; an answered questionnaire stops asking', page.includes("t.status!=='done'&&todoKind(t)!=='review'") && page.includes('filter(sv=>sv&&!sv.answered)'));
ok('page: the platform’s stand-in name never shows', page.includes("function studioNamed(){const s=PORTAL.ctx&&PORTAL.ctx.studio;return !!(s&&!s.is_default&&s.name&&String(s.name).trim());}") && page.includes("function studioInitial(){return studioNamed()?studioBrand().charAt(0).toUpperCase():'✦';}"));
ok('page: a known client’s Home reads leave in one round', page.includes('const early=rememberedClient();') && page.includes("nP||api('/client/notifications')"));
ok('page: Messages asks for requests and previews together, and a computer opens the newest still going', page.includes('}catch(_){}}).concat([supP]));') && page.includes("openConv((MC.rows.find(r=>r.status!=='resolved'&&r.status!=='closed')||MC.rows[0]).id,true);"));
ok('page: callers share one project read; the boot starts it, and billing, beside the notifications', page.includes('if(!PORTAL.snapsFetch){const p=snapsRead().finally(()=>{if(PORTAL.snapsFetch===p)PORTAL.snapsFetch=null;});PORTAL.snapsFetch=p;}') && page.includes('const pre=PORTAL.billingFetch;PORTAL.billingFetch=null;') && page.includes("else if(toHome){wsStatsStart();wsThumbStart();if(partOn('invoices')&&!PORTAL.billing&&!PORTAL.billingFetch)PORTAL.billingFetch=api('/client/billing').catch(()=>null);if(!PORTAL.snapsBoot)PORTAL.snapsBoot=ensureSnaps();papersStart();}") && page.indexOf('else if(toHome){wsStatsStart();wsThumbStart();')<page.indexOf("const [n,a]=PORTAL.persona==='client'?await"));
ok('page: the card says Your website and its state on one line; the questionnaire says what it is for', page.includes('<div class="wsin"><div class="wsbar"><span class="tag">Your website</span>\'+pill+\'</div>') && page.includes('questionnaireOf([sv])?`Your answers help ${studioBrand()} write your pages.`:\'\''));
ok('page: a phone keeps a Needs you row on one line', page.includes('@media (max-width:560px){.qrow{flex-wrap:nowrap}'));

// ═══ speed: the server beside the database, and the last Home at once (items 226 to 228) ═══
ok('page: every server read asks to run beside the database (x-region, Oregon)', page.includes("const FN_REGION='us-west-2';") && /const H=\(\)=>Object\.assign\(\{[^}]*'x-region':FN_REGION\}/.test(page));
ok('page: the last Home is kept per person, for a week, without the site picture or the tour', page.includes("const HOME_CACHE_PREFIX='dds-portal-home:';") && page.includes('const HOME_CACHE_DAYS=7;') && page.includes("return(USER&&USER.id)?HOME_CACHE_PREFIX+USER.id:'';") && page.includes("m.querySelectorAll('iframe,#welcome').forEach(e=>e.remove());"));
ok('page: kept only once Needs you and the website card are in, and only while Home is still showing', page.includes("Promise.allSettled([buildNeedsYou(),cardOn('website')?loadWebsiteCard():null]).then(()=>{if(view===VIEW_SEQ)saveHomeCache();});") && page.includes("main.querySelector('#needs-body .skel')"));
ok('page: the kept Home cannot be pressed and says it is busy', page.includes("for(const el of[main,nav]){el.setAttribute('inert','');el.setAttribute('aria-busy','true');}"));
ok('page: shown only when the visit lands on Home', page.includes('if(landsOnHome()&&!PREVIEW)paintHomeCache();') && /function landsOnHome\(\)\{[^\n]*q\.get\('support'\)\|\|q\.get\('project'\)\|\|q\.get\('approval'\)\|\|q\.get\('paid'\)\|\|q\.get\('connect'\)[^\n]*!localStorage\.getItem\(RETURN_KEY\)/.test(page));
ok('page: wiped on sign-out, when nobody is signed in, and for a studio owner', page.includes('clearHomeCaches();try{await sb.auth.signOut();}') && /function signedOut\(\)\{if\(PREVIEW\)\{[^\n]*return;\}[^\n]*\n\s*dropHomeCacheView\(\);clearHomeCaches\(\);/.test(page) && page.includes("function ownerNote(){dropHomeCacheView();clearHomeCaches();"));
ok('page: the fresh Home replaces it whole once its reads are in, waiting 4 s at most', page.includes('new Promise(r=>setTimeout(r,4000))]);dropHomeCacheView();}') && page.indexOf('dropHomeCacheView();}\n  showNav();')>0);

// ═══ the server half ═══
const sb=read('../../supabase/functions/presence/routes/studio_brand.ts');
ok('server: a studio with no Business details shows its account’s name', sb.includes('const name = named ? b.name : (await accountNameOf(siteId)) || b.name;') && sb.includes("is_default: name === EMAIL_BRAND_DEFAULT.name && !b.logoUrl"));
const q=starterQuestions();
ok('starter questionnaire: five plain questions the survey rules accept', q.length===5 && normalizeQuestions(q).ok && new Set(q.map(x=>x.key)).size===5 && q.every(x=>x.type==='text'&&x.label.length<120));
ok('starter questionnaire: its title is one the portal treats as the questionnaire', isQuestionnaireTitle(STARTER_QUESTIONNAIRE_TITLE) && isQuestionnaireTitle('Client intake') && !isQuestionnaireTitle('How did we do?') && page.includes('/questionnaire|intake|brief/i'));
const bridge=read('../../supabase/functions/presence/lib/service_bridge.ts'), cd=read('../../supabase/functions/presence/routes/client_delivery.ts');
ok('server: a new checklist brings the questionnaire; answering it ticks the step', bridge.includes('await seedStarterQuestionnaire(siteId, projectId);') && cd.includes("await tickChecklistStep(s, survey.project_id, 'questionnaire_returned'"));
ok('server: the bundle marks what this person already answered', cd.includes("answered.has(String(r.id)) ? { ...r, answered: true } : r"));
const mig=read('../../supabase/migrations/0213_starter_questionnaire.sql'), pack=read('../../docs/presence/APPLY-0213-prod.sql');
ok('migration 0213 and its pack carry the same five questions as the code', q.every(x=>mig.includes(`"key":"${x.key}","label":"${x.label}"`)&&pack.includes(`"key":"${x.key}","label":"${x.label}"`)) && mig.split('insert into')[1]===pack.split('insert into')[1]);

const passed=results.filter(r=>r.p).length,failed=results.length-passed;
console.log(`\n════ PORTAL WHILE BUILDING: ${passed}/${results.length} PASSED ════`);
if(failed)Deno.exit(1);
