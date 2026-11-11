// ── Builder list item 131: a client's site sends its forms from the page ─────
// A visitor's message used to be a plain form post to the server's own address
// (…supabase.co/functions/v1/presence/forms/<site>/submit). When all went well the
// server sent them back to the site's thank-you page; but a slow or sleeping server,
// a busy minute or a lost connection left them on a blank page at a strange address,
// and their words were gone from view.
//
// Now every page that holds one of the site's forms carries one small script that
// sends it from the page: the button says "Sending…", the thank-you shows where the
// form was, and when the server refuses it, or says nothing for 15 seconds, the
// visitor is told plainly that it didn't send and how else to reach the business,
// with everything they typed still in the boxes. With scripts off, the plain form
// post works exactly as before (the server still answers it with a page).
//
// The business's phone and email ride on <body> (data-reach-tel, data-reach-mail) on
// those pages, so the booking widget's script (also here, bookingScript) can say the
// same "call or email" line when booking fails. Both already show on every page.
//
// Pure: no I/O, no clock. Deterministic bytes, so goldens stay stable. All visitor-
// facing text is built with createElement and textContent, never parsed as HTML.
// No imports: a browser test (tests/e2e/site-send.spec.ts) drives this very script, and
// e2e.yml runs the browser suite for a change to this file (it names it), so nothing
// this file pulls in would go untested by the browser.

type FileMap = Record<string, string | Uint8Array>;
/** The parts of a site's content and address this file reads (lib/render_types.ts has the rest). */
interface ReachContent { identity?: { phone?: string; email?: string }; locations?: Array<{ phone?: string }> }
interface SendSite { formEndpoint?: string; bookEndpoint?: string }
// the same escaping as lib/markdown.ts esc() and attr(), which the templates use
const esc = (s: unknown): string => String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const attr = esc;

/** The routes a client's site calls from its visitors' browsers: the form send,
 *  booking, and (item 140) the time ticket for either. index.ts answers them with
 *  visitorCors (the site has its own address). */
export const VISITOR_ROUTE = /^\/(?:forms\/[0-9a-f-]{36}\/(?:submit|ticket)|book\/[0-9a-f-]{36}(?:\/types|\/slots|\/ticket)?)$/;

/** How long the page waits for an answer before it says the message didn't send. */
export const SEND_WAIT_MS = 15000;
/** Item 147: a "Photo or file" field's limit per file (lib/forms.ts FILE_FIELD.mb), checked
 *  in the page so nobody waits for a big upload the server would refuse. */
export const FILE_MAX_MB = 10;
/** Item 140: a send waits until its time ticket is this old (the server wants three
 *  seconds; the half second covers its rounding), and asks for a new one after 11 hours. */
export const TICKET_SETTLE_MS = 3500;
export const TICKET_FRESH_MS = 11 * 3600_000;

export interface SiteReach { tel: string; mail: string }

/** The phone and email a visitor can use instead: the first location's phone (or the
 *  business's), and the business email when it looks like one. The templates show the same. */
export function siteReach(c: ReachContent | null | undefined): SiteReach {
  const tel = String(c?.locations?.[0]?.phone || c?.identity?.phone || '').trim().slice(0, 40);
  const mail = String(c?.identity?.email || '').trim().slice(0, 254);
  return { tel: /\d/.test(tel) ? tel : '', mail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) ? mail : '' };
}

const STYLE = `<style>.ps-note{margin:12px 0 0}.ps-note:empty{margin:0}.ps-note.is-err{border-left:3px solid #b42318;padding-left:10px}.ps-note a{color:inherit;text-decoration:underline}.ps-sent{padding:18px 20px;border:1px solid var(--line,#ddd);border-radius:10px;margin:24px 0 0}.ps-sent:focus{outline:2px solid var(--accent,#5b3fa0);outline-offset:2px}.ps-sent p{margin:0;font-weight:600}</style>`;

/** The page's sender: one per page, for every form that posts to the site's address. */
export function senderTag(endpoint: string): string {
  const js = `(function(){
if(!window.fetch||!window.FormData||!document.addEventListener)return;
var EP=${JSON.stringify(endpoint).replace(/</g, '\\u003c')},WAIT=${SEND_WAIT_MS},B=document.body;
var TKURL=EP.replace(/\\/submit$/,'/ticket'),TK='',TKAT=0,TKP=null;
function ticket(){if(TK&&Date.now()-TKAT<${TICKET_FRESH_MS})return Promise.resolve(TK);if(TKP)return TKP;
TKP=fetch(TKURL,{headers:{accept:'application/json'}}).then(function(r){if(!r.ok)throw new Error('ticket '+r.status);return r.json();}).then(function(j){TK=(j&&j.data&&j.data.ticket)||'';TKAT=Date.now();TKP=null;return TK;},function(e){TKP=null;throw e;});return TKP;}
function settled(){return new Promise(function(res){setTimeout(res,Math.max(0,TKAT+${TICKET_SETTLE_MS}-Date.now()));});}
var SAY={gone:'Your message didn’t send. What you wrote is still here, so you can try again in a minute.',busy:'A lot of messages were sent from here just now. Wait a minute, then send it again.',closed:'This form isn’t taking messages right now.'};
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function txt(p,s){p.appendChild(document.createTextNode(s));}
function reach(p){var tel=B.getAttribute('data-reach-tel')||'',mail=B.getAttribute('data-reach-mail')||'';if(!tel&&!mail)return;
txt(p,' You can also ');if(tel){txt(p,'call ');var a=el('a',null,tel);a.href='tel:'+tel.replace(/[^0-9+]/g,'');p.appendChild(a);}
if(tel&&mail)txt(p,' or ');if(mail){txt(p,'email ');var m=el('a',null,mail);m.href='mailto:'+mail;p.appendChild(m);}txt(p,'.');}
function note(f){var p=f.querySelector('.ps-note');if(!p){p=el('p','ps-note');p.setAttribute('aria-live','polite');f.appendChild(p);}return p;}
function btnOf(f){return f.querySelector('button[type=submit],input[type=submit]');}
function busy(f,on){var b=btnOf(f);if(on){f.setAttribute('data-sending','1');f.setAttribute('aria-busy','true');if(b){b.setAttribute('data-label',b.tagName==='INPUT'?b.value:b.textContent);b.disabled=true;if(b.tagName==='INPUT')b.value='Sending…';else b.textContent='Sending…';}}
else{f.removeAttribute('data-sending');f.removeAttribute('aria-busy');if(b){var l=b.getAttribute('data-label');if(l!=null){if(b.tagName==='INPUT')b.value=l;else b.textContent=l;}b.disabled=false;}}}
function tooBig(f){var ins=f.querySelectorAll('input[type=file]');for(var i=0;i<ins.length;i++){var fs=ins[i].files||[];for(var j=0;j<fs.length;j++)if(fs[j].size>${FILE_MAX_MB}*1048576)return {input:ins[i],name:fs[j].name};}return null;}
function firstBad(f){var es=f.elements;for(var i=0;i<es.length;i++){var e=es[i];if(!e.willValidate||e.disabled)continue;
var w=e.closest?e.closest('[data-field]'):null;if(w&&w.hidden)continue;var s=e.closest?e.closest('.ff-step'):null;if(s&&s.hidden)continue;
if(e.checkValidity&&!e.checkValidity())return e;}return null;}
function fail(f,kind,msg,field){busy(f,false);var p=note(f);p.className='ps-note is-err';p.textContent=msg||SAY[kind]||SAY.gone;if(kind!=='check')reach(p);
if(field){var e=f.querySelector('[name="'+String(field).replace(/[^a-z0-9_]/gi,'')+'"]');if(e&&e.focus){try{e.focus();}catch(_){}}}}
function sent(f,msg){var box=el('div','ps-sent');box.setAttribute('role','status');box.setAttribute('tabindex','-1');box.appendChild(el('p',null,msg||'Thank you, your message was sent.'));
f.parentNode.insertBefore(box,f);f.style.display='none';try{box.focus();}catch(_){}}
function send(f,ev){ev.preventDefault();if(f.getAttribute('data-sending'))return;
var bad=firstBad(f);if(bad){if(bad.reportValidity)bad.reportValidity();else if(bad.focus)bad.focus();return;}
var big=tooBig(f);if(big){fail(f,'check','“'+big.name+'” is bigger than ${FILE_MAX_MB} MB. Try a smaller one.');try{big.input.focus();}catch(_){}return;}
var sp=f.querySelector('input[name=source_page]');if(sp)sp.value=location.pathname.slice(0,300);
var p=note(f);p.className='ps-note';p.textContent='';busy(f,true);
var ac=window.AbortController?new AbortController():null,over=false;
var slow=setTimeout(function(){if(!over)p.textContent='Still sending…';},6000);
function end(){over=true;clearTimeout(slow);clearTimeout(cap);}
var cap=setTimeout(function(){if(over)return;end();if(ac)ac.abort();fail(f,'gone');},WAIT);
ticket().then(settled).then(function(){if(over)return null;var fd=new FormData(f);if(TK)fd.append('_tk',TK);
return fetch(EP,{method:'POST',body:fd,headers:{accept:'application/json'},signal:ac?ac.signal:undefined});})
.then(function(r){if(!r)return null;return r.json().then(function(j){return {s:r.status,j:j};},function(){return {s:r.status,j:null};});})
.then(function(o){if(over||!o)return;end();var d=o.j&&o.j.data;
if(o.s>=200&&o.s<300&&d&&d.ok){if(d.redirect){location.href=d.redirect;return;}busy(f,false);sent(f,d.message);return;}
if(o.s===400&&o.j&&o.j.message){fail(f,'check',o.j.message,o.j.field);return;}
fail(f,o.s===429?'busy':(o.s===404?'closed':'gone'));})
.catch(function(){if(over)return;end();fail(f,'gone');});}
document.addEventListener('submit',function(ev){var f=ev.target;if(f&&f.getAttribute&&f.getAttribute('action')===EP)send(f,ev);},false);
document.addEventListener('focusin',function(ev){var f=ev.target&&ev.target.form;if(f&&f.getAttribute('action')===EP)ticket().catch(function(){});},false);
})();`;
  return `${STYLE}<script>${js.replace(/<\//g, '<\\/')}</script>`;
}

// ── Phase BK: the booking widget's first-party enhancer ──────────────────────
// A minimal, self-contained IIFE (same posture as the form block's inline enhancer:
// scoped to the widget on the page, ZERO external origins). It calls the site's own
// /book/:siteId endpoints (/types, /slots, POST) — read from data-book. All dynamic
// UI is built with createElement + textContent, so owner/customer data is never
// interpolated into HTML. Deterministic string (no clock/random), so goldens stay
// stable. The only HTML-parser hazard in an inline script is the literal "</" that
// could close the tag early — guarded below (the script contains none, but we escape
// defensively). Comparison operators (< >) are safe inside a <script> raw-text element.
// Item 131: every call gives up after SEND_WAIT_MS, so a sleeping server never leaves the
// widget spinning, and when booking can't load or a booking didn't go through it says so
// and offers the business's phone and email (injectSender below puts them on <body>).
export function bookingScript(): string {
  const js = `(function(){
var W=document.querySelector('.booking-widget[data-book]');if(!W)return;
var EP=W.getAttribute('data-book');var stage=W.querySelector('.bk-stage');
var S={types:[],type:null,date:'',slot:'',cfg:{}},WAIT=${SEND_WAIT_MS};
var MO=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var NOT_BOOKED='Your booking didn’t go through, so nothing is booked yet. Please try again.';
var TK='',TKAT=0;
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e;}
function clr(){while(stage.firstChild)stage.removeChild(stage.firstChild);}
function msg(t){clr();var p=el('p','bk-msg',t);stage.appendChild(p);return p;}
function call(u,o){var ac=window.AbortController?new AbortController():null;if(ac)o.signal=ac.signal;var t=setTimeout(function(){if(ac)ac.abort();},WAIT);
return fetch(u,o).then(function(r){clearTimeout(t);return r.json().then(function(j){return {s:r.status,j:j};},function(){return {s:r.status,j:null};});},function(e){clearTimeout(t);throw e;});}
function getj(u){return call(u,{headers:{accept:'application/json'}}).then(function(o){if(o.s<200||o.s>=300)throw new Error('status '+o.s);return o.j;});}
function ticket(){if(TK&&Date.now()-TKAT<${TICKET_FRESH_MS})return Promise.resolve(TK);return getj(EP+'/ticket').then(function(j){TK=((j&&j.data)||{}).ticket||'';TKAT=Date.now();return TK;});}
function settled(){return new Promise(function(res){setTimeout(res,Math.max(0,TKAT+${TICKET_SETTLE_MS}-Date.now()));});}
ticket().catch(function(){});
function reach(p,lead){var B=document.body,tel=B.getAttribute('data-reach-tel')||'',mail=B.getAttribute('data-reach-mail')||'';if(!tel&&!mail)return p;
p.appendChild(document.createTextNode(' '+lead+' '));if(tel){p.appendChild(document.createTextNode('call '));var a=el('a',null,tel);a.href='tel:'+tel.replace(/[^0-9+]/g,'');p.appendChild(a);}
if(tel&&mail)p.appendChild(document.createTextNode(' or '));if(mail){p.appendChild(document.createTextNode('email '));var m=el('a',null,mail);m.href='mailto:'+mail;p.appendChild(m);}
p.appendChild(document.createTextNode('.'));return p;}
function ftime(hm){var p=hm.split(':');var h=+p[0],m=p[1];var ap=h<12?'AM':'PM';var h12=(h%12===0)?12:(h%12);return h12+':'+m+' '+ap;}
function fdate(d){var p=d.split('-');return MO[(+p[1])-1]+' '+(+p[2]);}
function back(fn){var b=el('button','bk-back','← Back');b.type='button';b.addEventListener('click',fn);return b;}
msg('Loading…');
getj(EP+'/types').then(function(res){var d=(res&&res.data)||{};if(!d.enabled||!d.types||!d.types.length){reach(msg('Online booking isn’t available right now.'),'To book,');return;}S.types=d.types;S.cfg=d;services();}).catch(function(){reach(msg('Online booking isn’t loading right now.'),'To book,');});
function services(){clr();stage.appendChild(el('p','bk-step','1. Choose a service'));var list=el('div','bk-services');S.types.forEach(function(t){var b=el('button','bk-service');b.type='button';b.appendChild(el('span','bk-svc-name',t.name));b.appendChild(el('span','bk-svc-meta',t.duration_min+' min'+(t.price_text?(' · '+t.price_text):'')));if(t.description)b.appendChild(el('span','bk-svc-desc',t.description));b.addEventListener('click',function(){S.type=t;pickDate();});list.appendChild(b);});stage.appendChild(list);}
function pickDate(){clr();stage.appendChild(back(services));stage.appendChild(el('p','bk-step','2. Pick a day for '+S.type.name));var inp=el('input','bk-date');inp.type='date';var now=new Date();inp.min=now.toISOString().slice(0,10);if(S.cfg.max_days_ahead){inp.max=new Date(now.getTime()+S.cfg.max_days_ahead*86400000).toISOString().slice(0,10);}inp.addEventListener('change',function(){S.date=inp.value;if(S.date)slots();});stage.appendChild(inp);}
function slots(){clr();stage.appendChild(back(pickDate));stage.appendChild(el('p','bk-step','3. Choose a time'));var load=el('p','bk-msg','Finding open times…');stage.appendChild(load);getj(EP+'/slots?type='+encodeURIComponent(S.type.id)+'&date='+encodeURIComponent(S.date)).then(function(res){var sl=((res&&res.data)||{}).slots||[];if(load.parentNode)stage.removeChild(load);if(!sl.length){stage.appendChild(el('p','bk-msg','No open times that day — try another.'));return;}var grid=el('div','bk-slots');sl.forEach(function(s){var b=el('button','bk-slot',ftime(s.split('T')[1]));b.type='button';b.addEventListener('click',function(){S.slot=s;details();});grid.appendChild(b);});stage.appendChild(grid);}).catch(function(){if(load.parentNode)stage.removeChild(load);stage.appendChild(reach(el('p','bk-msg','We couldn’t load the times for that day. Go back and pick the day again, or try another.'),'You can also'));});}
function field(lb,nm,ty,req){var w=el('label','bk-field');w.appendChild(el('span',null,lb+(req?' *':'')));var i=el(ty==='textarea'?'textarea':'input');if(ty!=='textarea')i.type=ty;i.name=nm;if(req)i.required=true;w.appendChild(i);return {w:w,i:i};}
function details(){clr();stage.appendChild(back(slots));stage.appendChild(el('p','bk-step','4. Your details'));var f=el('form','bk-form');var nm=field('Your name','name','text',true),em=field('Email','email','email',false),ph=field('Phone','phone','tel',false),nt=field('Anything we should know?','note','textarea',false);f.appendChild(nm.w);f.appendChild(em.w);f.appendChild(ph.w);f.appendChild(nt.w);var hp=el('div','bk-hp');var hpi=el('input');hpi.name='_hp';hpi.tabIndex=-1;hpi.setAttribute('autocomplete','off');hp.appendChild(hpi);f.appendChild(hp);f.appendChild(el('p','bk-summary',S.type.name+' — '+fdate(S.date)+' at '+ftime(S.slot.split('T')[1])));var btn=el('button','bk-submit btn','Confirm booking');btn.type='submit';f.appendChild(btn);var err=el('p','bk-err');f.appendChild(err);
function again(t,o){btn.disabled=false;btn.textContent='Confirm booking';err.textContent=t;if(!o||o.s>=500)reach(err,'You can also');}
function send(second){return ticket().then(settled).then(function(){return call(EP,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({type_id:S.type.id,slot_start:S.slot,name:nm.i.value,email:em.i.value,phone:ph.i.value,note:nt.i.value,_hp:hpi.value,_tk:TK})});}).then(function(o){if(o.s===400&&o.j&&o.j.error==='check'&&!second){TK='';return send(true);}return o;});}
f.addEventListener('submit',function(ev){ev.preventDefault();err.textContent='';if(!nm.i.value.trim()){err.textContent='Please add your name.';return;}if(!em.i.value.trim()&&!ph.i.value.trim()){err.textContent='Leave an email or phone so they can confirm.';return;}btn.disabled=true;btn.textContent='Booking…';send(false).then(function(o){if(o.s>=200&&o.s<300&&o.j&&o.j.data&&o.j.data.ok){done(o.j.data.message);}else{again((o.s<500&&o.j&&o.j.message)||NOT_BOOKED,o);if(o.s===409){setTimeout(function(){S.slot='';slots();},1800);}}}).catch(function(){again(NOT_BOOKED,null);});});stage.appendChild(f);}
function done(m){clr();var d=el('div','bk-done');d.appendChild(el('p','bk-done-ic','✓'));d.appendChild(el('p','bk-done-msg',m||'Thanks — your booking request was received.'));stage.appendChild(d);}
})();`;
  return `<script>${js.replace(/<\//g, '<\\/')}</script>`;
}

// ── Builder list item 146: the "Join our list" box ───────────────────────────
/** What a visitor agrees to with the box; the contact keeps it as the record of their yes. */
export const SIGNUP_CONSENT = 'Yes, send me updates by email. I can unsubscribe at any time.';
/** The box's form (the Newsletter section draws its heading and words around it). It posts
 *  to the site's form address with form_kind=signup, so the sender above sends it in the
 *  page with its time ticket; with no address (the builder's canvas) it has no action.
 *  `buttonAttrs` carries the in-place editor's stamp for the button's words. */
export function signupForm(id: string, endpoint: string | undefined, button: string, buttonAttrs = ''): string {
  const action = endpoint ? ` action="${attr(endpoint)}"` : '';
  return `<form class="card nl-form" method="post"${action}><input type="hidden" name="form_kind" value="signup"><input type="hidden" name="source_page" value="/">` +
    `<p class="hp" aria-hidden="true"><label for="${attr(id)}-hp">Leave this field empty</label><input id="${attr(id)}-hp" name="_hp" tabindex="-1" autocomplete="off"></p>` +
    `<div class="nl-row"><label class="nl-label" for="${attr(id)}-email">Your email</label><input type="email" id="${attr(id)}-email" name="email" required maxlength="254" autocomplete="email" placeholder="you@example.com"><button class="btn" type="submit"${buttonAttrs}>${esc(button)}</button></div>` +
    `<p class="nl-consent"><label><input type="checkbox" name="consent" value="yes" required> ${esc(SIGNUP_CONSENT)}</label></p></form>`;
}

/** Item 131: each page that holds a site form gets the sender, and each page with a
 *  site form or the booking widget gets the business's phone and email on <body>.
 *  Pages with neither, and a render with no addresses (the builder's canvas), stay
 *  byte for byte as they were. */
export function injectSender(fileMap: FileMap, content: ReachContent | null | undefined, site: SendSite): FileMap {
  const formMark = site.formEndpoint ? `action="${attr(site.formEndpoint)}"` : '';
  const bookMark = site.bookEndpoint ? `data-book="${attr(site.bookEndpoint)}"` : '';
  if (!formMark && !bookMark) return fileMap;
  const reach = siteReach(content);
  const onBody = (reach.tel ? ` data-reach-tel="${attr(reach.tel)}"` : '') + (reach.mail ? ` data-reach-mail="${attr(reach.mail)}"` : '');
  const tag = site.formEndpoint ? senderTag(site.formEndpoint) : '';
  const out: FileMap = {};
  for (const [path, contents] of Object.entries(fileMap)) {
    const hasForm = typeof contents === 'string' && path.endsWith('.html') && !!formMark && contents.includes(formMark);
    const hasBook = typeof contents === 'string' && path.endsWith('.html') && !!bookMark && contents.includes(bookMark);
    if (!hasForm && !hasBook) { out[path] = contents; continue; }
    let html = contents as string;
    if (onBody) html = html.replace(/<body(?=[\s>])/, `<body${onBody}`);
    if (hasForm && html.includes('</body>')) html = html.replace('</body>', `${tag}</body>`);
    out[path] = html;
  }
  return out;
}
