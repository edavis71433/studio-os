// ── Sites: the studio's client tools (builder list item 176, Nov 2026) ───────
// Two entries on a card's ⋯ menu and a line on each card, from Wix Studio's
// agency tools:
//   • Ask for their content — the content form: pick the questions for the
//     kind of business, get a link (or email it), read what came back. The
//     client's side is intake.html; their photos land in the site's Files.
//   • Hand-over kit — who to call, how-tos, video links and files, shown under
//     Help in the client's portal once it's turned on.
// Everything goes through agency/client_tools.ts. sites.html owns the page and
// its helpers ($, esc, api, apiSend, toast, day, scoped, SITES, META); this file
// only adds the menu items, the card lines and the three dialogs, and it is
// loaded before the page's own script, so nothing here runs until it's called.
(function(){
  'use strict';
  let TOOLS={},TSEQ=0,BUSY=false;
  const css=`
  .ctl{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:11.5px;font-weight:600;border:none;border-radius:999px;padding:3px 10px;margin:2px 6px 0 0;cursor:pointer;text-decoration:none;background:var(--p-soft);color:var(--p)}
  .ctl.warn{background:var(--warn-soft);color:var(--warn)} .ctl.good{background:var(--good-soft);color:var(--good)} .ctl.quiet{background:var(--bg);color:var(--soft);border:1px solid var(--line)}
  .ctl:hover{filter:brightness(.97);text-decoration:underline}
  .lrow1 #weekBtn{order:1;margin-left:auto} .lrow1 #newSiteBtn{order:2;margin-left:0!important}
  dialog.ct{max-width:640px}
  .ct .dbody h3{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
  .ct .lead{font-size:13.5px;color:var(--soft);margin:-4px 0 12px;line-height:1.5}
  .ct .ctchip{font-size:11.5px;font-weight:600;border-radius:999px;padding:2px 10px;background:var(--p-soft);color:var(--p)}
  .ct .ctchip.warn{background:var(--warn-soft);color:var(--warn)} .ct .ctchip.good{background:var(--good-soft);color:var(--good)} .ct .ctchip.quiet{background:var(--bg);color:var(--soft)}
  .ct .kinds{display:flex;flex-wrap:wrap;gap:8px;margin:2px 0 6px}
  .ct .kinds label{margin:0;display:inline-flex;align-items:center;font-size:12.5px;font-weight:600;color:var(--soft);border:1px solid var(--line);border-radius:999px;padding:6px 12px;cursor:pointer;background:var(--card);min-height:36px}
  .ct .kinds input{position:absolute;opacity:0;width:1px;height:1px}
  .ct .kinds label:has(input:checked){background:var(--p-soft);border-color:var(--p);color:var(--p)}
  .ct .kinds label:has(input:focus-visible){outline:2px solid var(--p);outline-offset:2px}
  .ct .qhead{display:flex;align-items:baseline;gap:8px;margin:12px 0 6px;font-size:13px;color:var(--soft)} .ct .qhead b{font-weight:600}
  .ct .qhead span{font-size:12px;color:var(--faint)}
  .ct .list{border:1px solid var(--line);border-radius:12px;overflow:hidden}
  .ct .qrow{display:flex;align-items:center;gap:12px;padding:10px 14px;margin:0;border-top:1px solid var(--line);cursor:pointer;color:var(--ink);font-size:13.5px;font-weight:400}
  .ct .qrow:first-child{border-top:none}
  .ct .qrow input{width:18px;height:18px;flex:0 0 auto;accent-color:var(--p);margin:0}
  .ct .qrow .qw{flex:1 1 auto;min-width:0} .ct .qrow .qw b{display:block;font-weight:600} .ct .qrow .qw small{display:block;font-size:12.5px;color:var(--faint)}
  .ct .x{flex:0 0 auto;font:inherit;border:none;background:none;color:var(--soft);cursor:pointer;font-size:16px;min-width:36px;min-height:36px;border-radius:8px} .ct .x:hover{background:var(--p-soft);color:var(--p)}
  .ct .tag{flex:0 0 auto;font-size:11.5px;font-weight:600;border-radius:999px;padding:2px 9px;background:var(--p-soft);color:var(--p)} .ct .tag.words{background:var(--bg);color:var(--soft);border:1px solid var(--line)}
  .ct .inrow{display:flex;gap:8px;align-items:center} .ct .inrow input,.ct .inrow select{flex:1 1 auto;min-width:0}
  .ct .inrow .btn{flex:0 0 auto}
  .ct select,.ct textarea{font:inherit;font-size:15px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:var(--dds-r,8px);padding:8px 10px;outline:none}
  .ct select{flex:0 0 auto!important;width:auto}
  .ct textarea{width:100%;resize:vertical;min-height:64px;line-height:1.45} .ct textarea:focus,.ct select:focus{border-color:var(--p)}
  .ct .acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px} .ct .acts .sp{flex:1 1 auto}
  .ct .alist{border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-top:6px}
  .ct .arow{padding:12px 16px;border-top:1px solid var(--line)} .ct .arow:first-child{border-top:none}
  .ct .arow .aq{font-size:12.5px;font-weight:600;color:var(--soft);margin-bottom:4px}
  .ct .arow .aa{font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere} .ct .arow .aa.none{color:var(--faint)}
  .ct .thumbs{display:flex;flex-wrap:wrap;gap:8px} .ct .thumbs a{display:block;width:96px;text-decoration:none;color:var(--soft);font-size:11.5px;overflow:hidden}
  .ct .thumbs img{width:96px;height:72px;object-fit:cover;border-radius:8px;border:1px solid var(--line);display:block;background:var(--bg)}
  .ct .thumbs .doc{width:96px;height:72px;border-radius:8px;border:1px solid var(--line);display:grid;place-items:center;font-weight:700;color:var(--p);background:var(--p-soft)}
  .ct .thumbs span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
  .ct .grid2{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
  @media (max-width:560px){.ct .grid2{grid-template-columns:1fr}}
  .ct .facts{background:var(--bg);border-radius:12px;padding:12px 14px;font-size:13px;display:grid;grid-template-columns:auto 1fr;gap:4px 14px}
  .ct .facts dt{color:var(--faint)} .ct .facts dd{margin:0;font-weight:600;overflow-wrap:anywhere}
  .ct .sub{font-size:13px;font-weight:600;color:var(--soft);margin:16px 0 6px;display:flex;gap:8px;align-items:baseline} .ct .sub small{font-weight:400;color:var(--faint);font-size:12px}
  .ct .grow{padding:10px 12px;border-top:1px solid var(--line);display:grid;gap:6px} .ct .grow:first-child{border-top:none}
  .ct .grow .gtop{display:flex;gap:8px;align-items:center} .ct .grow .gtop input{flex:1 1 auto}
  .ct .files{max-height:220px;overflow:auto}
  .ct .switch{display:inline-flex;align-items:center;gap:8px;margin:0;font-size:13.5px;font-weight:600;color:var(--ink);cursor:pointer}
  .ct .switch input{width:40px;height:24px;appearance:none;-webkit-appearance:none;border-radius:999px;background:var(--line);position:relative;cursor:pointer;margin:0;transition:background .15s}
  .ct .switch input::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:left .15s}
  .ct .switch input:checked{background:var(--p)} .ct .switch input:checked::after{left:19px}
  @media (prefers-reduced-motion:reduce){.ct .switch input,.ct .switch input::after{transition:none}}
  .ct .hint{font-size:12.5px;color:var(--faint);margin-top:8px;line-height:1.5}
  `;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  const siteOf=(id)=>SITES.find(x=>x.site_id===id)||null;
  const nameOf=(id)=>{const s=siteOf(id);return(s&&s.name)||'this client';};
  const plural=(n,w)=>n+' '+w+(n===1?'':'s');
  function dialog(id){
    let d=document.getElementById(id);
    if(!d){d=document.createElement('dialog');d.id=id;d.className='ct';d.setAttribute('aria-labelledby',id+'-h');d.innerHTML='<div class="dbody" id="'+id+'-body"></div>';document.body.appendChild(d);
      // Chrome fires close a frame late: a dialog that was opened again in between keeps what it shows now
      d.addEventListener('close',()=>{if(d.open)return;const b=document.getElementById(id+'-body');if(b)b.innerHTML='';});}
    return d;
  }
  function show(id,html,focusSel){
    const d=dialog(id);document.getElementById(id+'-body').innerHTML=html;
    if(!d.open)d.showModal();
    const f=focusSel&&d.querySelector(focusSel);if(f)f.focus();
    return d;
  }
  const say=(r,fallback)=>(r&&r.body&&typeof r.body.message==='string'&&r.body.message)||fallback;

  // ── the card lines ──
  function formLine(f){
    if(!f)return'';
    if(f.unread)return['good','Words and photos arrived · Read them','answers'];
    if(f.status==='closed')return['quiet','Content form · link stopped','content'];
    if(f.sent_at)return['good','Content form sent back '+day(f.sent_at),'answers'];
    if(f.answered)return['warn','Content form · '+f.answered+' of '+f.total+' answered','content'];
    if(f.opened_at)return['warn','Content form · opened, nothing answered yet','content'];
    return['quiet',f.emailed_at?'Content form · emailed, not opened yet':'Content form · link ready to send','content'];
  }
  function kitLine(k){
    if(!k)return'';
    return k.shown?['','Hand-over kit · in their portal','kit']:['quiet','Hand-over kit · not in their portal yet','kit'];
  }
  function paint(){
    document.querySelectorAll('[data-tools]').forEach(el=>{
      const id=el.getAttribute('data-tools'),t=TOOLS[id]||{};
      const lines=[formLine(t.intake),kitLine(t.kit)].filter(Boolean);
      el.hidden=!lines.length;
      el.innerHTML=lines.map(([cls,w,act])=>`<button type="button" class="ctl ${cls}" data-ct="${act}" data-site="${esc(id)}">${esc(w)}</button>`).join('');
    });
  }
  document.addEventListener('click',(e)=>{
    const b=e.target&&e.target.closest&&e.target.closest('[data-ct]');if(!b)return;
    const id=b.getAttribute('data-site'),act=b.getAttribute('data-ct');
    if(act==='answers')openAnswers(id);else if(act==='kit')openKit(id);else openIntake(id);
  });
  async function mount(){
    const gen=++TSEQ;
    let r;try{r=await api('/agency/site-tools');}catch(_){return;}
    if(gen!==TSEQ||!r.ok||!r.body||!r.body.data)return;   // best-effort: the cards are whole without it
    TOOLS=r.body.data;paint();
  }
  async function refresh(id){
    const r=await api('/agency/site-tools').catch(()=>null);
    if(r&&r.ok&&r.body&&r.body.data){TOOLS=r.body.data;paint();}
    else if(id&&TOOLS[id])paint();
  }

  // ── the ⋯ menu ──
  // only a seat that can change them (manage_clients, the server's own check — the page has it as
  // can_duplicate) gets these doors; any seat can open a card's line to read what came back
  function menuHtml(s){
    if(!META.can_duplicate)return'';
    return `<button type="button" role="menuitem" data-intake="${esc(s.site_id)}">Ask for their content</button><button type="button" role="menuitem" data-kit="${esc(s.site_id)}">Hand-over kit</button>`;
  }
  function wireMenu(m,s,close){
    const a=m.querySelector('[data-intake]');if(a)a.addEventListener('click',()=>{close();openIntake(s.site_id);});
    const k=m.querySelector('[data-kit]');if(k)k.addEventListener('click',()=>{close();openKit(s.site_id);});
  }

  // ══ the content form ══
  let IN=null;   // {site, data, picks:Set, own:[{label,kind}], kind}
  async function openIntake(id){
    show('intakeDlg','<div class="spin" role="status" aria-label="Loading"></div>');
    const r=await api('/agency/sites/'+encodeURIComponent(id)+'/intake').catch(()=>null);
    if(!r||!r.ok){show('intakeDlg',`<h3 id="intakeDlg-h">The content form</h3><p class="lead">${esc(say(r,'We couldn’t open it just now — please try again.'))}</p><div class="row2"><button type="button" class="btn" data-close>Close</button></div>`,'[data-close]');wireClose('intakeDlg');return;}
    const d=r.body.data;
    IN={site:id,data:d};
    if(d.form)paintReady();else startPick(d.can_edit?null:'view');
  }
  function startPick(fromForm){
    const d=IN.data,f=d.form;
    const kind=(f&&f.kind)||'other';
    const bank=d.bank[kind]||[];
    IN.kind=kind;
    IN.picks=new Set(f?f.questions.filter(q=>!q.own).map(q=>q.id):bank.filter(q=>q.on).map(q=>q.id));
    IN.own=f?f.questions.filter(q=>q.own).map(q=>({label:q.label,kind:q.kind})):[];
    if(fromForm==='view'){show('intakeDlg',`<h3 id="intakeDlg-h">The content form</h3><p class="lead">There’s no content form for ${esc(nameOf(IN.site))} yet, and your role can’t make one.</p><div class="row2"><button type="button" class="btn" data-close>Close</button></div>`,'[data-close]');wireClose('intakeDlg');return;}
    paintPick(!!f);
  }
  function paintPick(editing){
    const d=IN.data,bank=d.bank[IN.kind]||[];
    const rows=bank.map(q=>`<label class="qrow"><input type="checkbox" data-q="${esc(q.id)}"${IN.picks.has(q.id)?' checked':''}><span class="qw"><b>${esc(q.label)}</b><small>${esc(q.hint)}</small></span><span class="tag${q.kind==='files'?'':' words'}">${q.kind==='files'?'Photos':'Words'}</span></label>`).join('')
      +IN.own.map((o,n)=>`<div class="qrow"><span class="qw"><b>${esc(o.label)}</b><small>Your own question</small></span><span class="tag${o.kind==='files'?'':' words'}">${o.kind==='files'?'Photos':'Words'}</span><button type="button" class="x" data-own-x="${n}" aria-label="Remove “${esc(o.label)}”">✕</button></div>`).join('');
    const ticked=bank.filter(q=>IN.picks.has(q.id)).length+IN.own.length;
    show('intakeDlg',`<h3 id="intakeDlg-h">Ask ${esc(nameOf(IN.site))} for their words and photos</h3>
      <p class="lead">They fill in a short form from a link, with no sign-in. It saves as they type, and their photos go straight into this site’s Files.</p>
      <label id="ct-kind-l">What kind of business?</label>
      <div class="kinds" role="radiogroup" aria-labelledby="ct-kind-l">${d.kinds.map(k=>`<label><input type="radio" name="ct-kind" value="${esc(k.key)}"${k.key===IN.kind?' checked':''}>${esc(k.label)}</label>`).join('')}</div>
      <div class="qhead"><b>Questions</b><span id="ct-count">${ticked} ticked · untick any you don’t need</span></div>
      <div class="list" id="ct-qs">${rows}</div>
      <label for="ct-own">Your own question</label>
      <div class="inrow"><input id="ct-own" maxlength="140" placeholder="e.g. Is there anything you never want on the site?" autocomplete="off"><select id="ct-own-kind" aria-label="Answered with"><option value="words">Words</option><option value="files">Photos</option></select><button type="button" class="btn ghost" id="ct-own-add">Add</button></div>
      <div class="row2"><button type="button" class="btn ghost" id="ct-cancel">${editing?'Back':'Cancel'}</button><button type="button" class="btn" id="ct-make">${editing?'Save the questions':'Make the link'}</button></div>`,'#ct-make');
    const dlg=dialog('intakeDlg');
    dlg.querySelectorAll('input[name="ct-kind"]').forEach(r=>r.addEventListener('change',()=>{
      IN.kind=r.value;IN.picks=new Set((d.bank[IN.kind]||[]).filter(q=>q.on).map(q=>q.id));paintPick(editing);
      const again=dialog('intakeDlg').querySelector('input[name="ct-kind"][value="'+CSS.escape(IN.kind)+'"]');if(again)again.focus();
    }));
    dlg.querySelectorAll('[data-q]').forEach(c=>c.addEventListener('change',()=>{const id=c.getAttribute('data-q');if(c.checked)IN.picks.add(id);else IN.picks.delete(id);
      const n=(d.bank[IN.kind]||[]).filter(q=>IN.picks.has(q.id)).length+IN.own.length;const ct=$('ct-count');if(ct)ct.textContent=n+' ticked · untick any you don’t need';}));
    dlg.querySelectorAll('[data-own-x]').forEach(b=>b.addEventListener('click',()=>{IN.own.splice(Number(b.getAttribute('data-own-x')),1);paintPick(editing);const o=$('ct-own');if(o)o.focus();}));
    const addOwn=()=>{const o=$('ct-own'),label=o.value.trim();if(label.length<3){toast('Write the question first.',true);o.focus();return;}
      if(IN.own.length>=5){toast('Add up to 5 of your own questions.',true);return;}
      IN.own.push({label,kind:$('ct-own-kind').value});paintPick(editing);const o2=$('ct-own');if(o2)o2.focus();};
    $('ct-own-add').addEventListener('click',addOwn);
    $('ct-own').addEventListener('keydown',(e)=>{if(e.key==='Enter'){e.preventDefault();addOwn();}});
    $('ct-cancel').addEventListener('click',()=>{if(editing)paintReady();else dialog('intakeDlg').close();});
    $('ct-make').addEventListener('click',async()=>{
      if(BUSY)return;const b=$('ct-make');
      if(!IN.picks.size&&!IN.own.length){toast('Tick at least one question.',true);return;}
      BUSY=true;b.disabled=true;b.textContent=editing?'Saving…':'Making the link…';
      const bankIds=(d.bank[IN.kind]||[]).map(q=>q.id);
      const r=await apiSend('PUT','/agency/sites/'+encodeURIComponent(IN.site)+'/intake',{kind:IN.kind,picks:bankIds.filter(x=>IN.picks.has(x)),own:IN.own}).catch(()=>null);
      BUSY=false;
      if(!r||!r.ok){b.disabled=false;b.textContent=editing?'Save the questions':'Make the link';toast(say(r,'That didn’t save — please try again.'),true);return;}
      IN.data.form=r.body.data.form;paintReady();refresh(IN.site);
      if(editing)toast('Saved. The same link shows the new questions.');
    });
  }
  function formChip(f){
    if(f.status==='closed')return['quiet','Link stopped'];
    if(f.unread)return['good','Sent back · '+f.answered+' of '+f.total+' answered'];
    if(f.sent_at)return['good','Sent back '+day(f.sent_at)];
    if(f.answered)return['warn','Started · '+f.answered+' of '+f.total+' answered'];
    if(f.opened_at)return['warn','Opened · nothing answered yet'];
    return['quiet','Not opened yet'];
  }
  function paintReady(){
    const d=IN.data,f=d.form,edit=!!d.can_edit;
    const [cls,w]=formChip(f);
    const when=f.saved_at?'Last saved '+day(f.saved_at)+'. ':'';
    const sent=f.emailed_at?`Emailed to ${esc(f.emailed_to||'them')} ${esc(day(f.emailed_at))}. `:'';
    show('intakeDlg',`<h3 id="intakeDlg-h">${esc(nameOf(IN.site))}’s content form <span class="ctchip ${cls}">${esc(w)}</span></h3>
      <p class="lead">${esc(when)}${sent}${f.status==='open'?'You’ll get an email when they press Send.':'The link is stopped: it shows nothing that was written on it.'} ${plural(f.questions.length,'question')}.</p>
      <label for="ct-link">The link</label>
      <div class="inrow"><input id="ct-link" readonly value="${esc(f.link)}"><button type="button" class="btn ghost" id="ct-copy">Copy link</button></div>
      ${edit&&f.status==='open'?`<label for="ct-to">Email it to</label>
      <div class="inrow"><input id="ct-to" type="email" maxlength="254" autocomplete="off" placeholder="their@email.com" value="${esc(f.emailed_to||d.owner_email||'')}"><button type="button" class="btn" id="ct-send">Send</button></div>
      <p class="hint">The email comes from your studio, with your logo. Their replies come to you.</p>`:''}
      <div class="acts">${f.answered||f.sent_at?'<button type="button" class="btn ghost" id="ct-read">Read the answers</button>':''}${edit?`<button type="button" class="btn ghost" id="ct-change">Change the questions</button><button type="button" class="btn ghost" id="ct-state">${f.status==='open'?'Stop the link':'Open it again'}</button>`:''}<span class="sp"></span><button type="button" class="btn" data-close>Done</button></div>`,'#ct-copy');
    wireClose('intakeDlg');
    $('ct-copy').addEventListener('click',()=>copy(f.link,$('ct-link')));
    const rd=$('ct-read');if(rd)rd.addEventListener('click',()=>{dialog('intakeDlg').close();openAnswers(IN.site);});
    const ch=$('ct-change');if(ch)ch.addEventListener('click',()=>startPick(true));
    const sw=$('ct-state');if(sw)sw.addEventListener('click',async()=>{
      if(BUSY)return;BUSY=true;sw.disabled=true;
      const r=await apiSend('POST','/agency/sites/'+encodeURIComponent(IN.site)+'/intake/state',{open:f.status!=='open'}).catch(()=>null);BUSY=false;
      if(!r||!r.ok){sw.disabled=false;toast(say(r,'That didn’t save — please try again.'),true);return;}
      IN.data.form=r.body.data.form;paintReady();refresh(IN.site);toast(IN.data.form.status==='open'?'The link works again.':'The link is stopped.');
    });
    const sd=$('ct-send');if(sd)sd.addEventListener('click',async()=>{
      const to=$('ct-to').value.trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)){toast('Enter their email address.',true);$('ct-to').focus();return;}
      if(BUSY)return;BUSY=true;sd.disabled=true;sd.textContent='Sending…';
      const r=await apiSend('POST','/agency/sites/'+encodeURIComponent(IN.site)+'/intake/email',{to}).catch(()=>null);BUSY=false;
      if(!r||!r.ok){sd.disabled=false;sd.textContent='Send';toast(say(r,'That didn’t send — please try again.'),true);return;}
      IN.data.form=r.body.data.form;paintReady();refresh(IN.site);toast('Sent to '+to+'.');
    });
  }
  async function copy(text,input){
    try{await navigator.clipboard.writeText(text);toast('Link copied.');}
    catch(_){if(input){input.focus();input.select();}toast('Your browser didn’t allow copying here — the link is selected, so copy it yourself.',true);}
  }
  function wireClose(id){const d=dialog(id);d.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>d.close()));}

  // ── their words and photos ──
  async function openAnswers(id){
    show('answersDlg','<div class="spin" role="status" aria-label="Loading"></div>');
    const r=await api('/agency/sites/'+encodeURIComponent(id)+'/intake/answers').catch(()=>null);
    if(!r||!r.ok){show('answersDlg',`<h3 id="answersDlg-h">Their words and photos</h3><p class="lead">${esc(say(r,'We couldn’t open them just now — please try again.'))}</p><div class="row2"><button type="button" class="btn" data-close>Close</button></div>`,'[data-close]');wireClose('answersDlg');return;}
    const f=r.body.data.form,list=r.body.data.answers||[];
    const files=list.reduce((n,a)=>n+(a.files||[]).length,0);
    const sentLine=f.sent_at?'Sent '+day(f.sent_at):'Not sent yet — this is what’s saved so far';
    const rows=list.map(a=>`<div class="arow"><div class="aq">${esc(a.label)}${a.files&&a.files.length?' · '+plural(a.files.length,'file'):''}</div>${a.kind==='files'
      ?(a.files.length?`<div class="thumbs">${a.files.map(x=>`<a href="${esc(x.url||'#')}" target="_blank" rel="noopener" title="${esc(x.name)}">${x.thumb_url?`<img src="${esc(x.thumb_url)}" alt="${esc(x.name)}" loading="lazy">`:`<span class="doc" aria-hidden="true">${x.mime==='application/pdf'?'PDF':'Photo'}</span>`}<span>${esc(x.name)}</span></a>`).join('')}</div>`:'<div class="aa none">Nothing added yet</div>')
      :(a.text?`<div class="aa">${esc(a.text)}</div>`:'<div class="aa none">Not answered yet</div>')}</div>`).join('');
    show('answersDlg',`<h3 id="answersDlg-h">${esc(nameOf(id))}’s words and photos ${f.sent_at?'<span class="ctchip good">Arrived</span>':'<span class="ctchip warn">In progress</span>'}</h3>
      <p class="lead">${esc(sentLine)} · ${f.answered} of ${f.total} answered${files?' · '+plural(files,'file')+', in this site’s Files under “From the content form”':''}.</p>
      <div class="alist">${rows}</div>
      <div class="acts"><button type="button" class="btn ghost" id="ca-copy">Copy all the words</button><a class="btn ghost" style="text-decoration:none;display:inline-flex;align-items:center" href="${esc(scoped('/files.html',id))}">Open their Files</a><span class="sp"></span><button type="button" class="btn" data-close>Close</button></div>`,'[data-close]');
    wireClose('answersDlg');
    $('ca-copy').addEventListener('click',async()=>{
      const text=list.filter(a=>a.kind!=='files').map(a=>a.label+'\n'+(a.text||'(not answered)')).join('\n\n');
      try{await navigator.clipboard.writeText(text);toast('Copied every answer.');}catch(_){toast('Your browser didn’t allow copying here.',true);}
    });
    refresh(id);   // opening them marks them read
  }

  // ══ the hand-over kit ══
  let KIT=null;   // {site, data, kit}
  async function openKit(id){
    show('kitDlg','<div class="spin" role="status" aria-label="Loading"></div>');
    const r=await api('/agency/sites/'+encodeURIComponent(id)+'/kit').catch(()=>null);
    if(!r||!r.ok){show('kitDlg',`<h3 id="kitDlg-h">Hand-over kit</h3><p class="lead">${esc(say(r,'We couldn’t open it just now — please try again.'))}</p><div class="row2"><button type="button" class="btn" data-close>Close</button></div>`,'[data-close]');wireClose('kitDlg');return;}
    KIT={site:id,data:r.body.data,kit:JSON.parse(JSON.stringify(r.body.data.kit))};
    paintKit();
  }
  function readKitForm(){
    const k=KIT.kit,dlg=dialog('kitDlg');
    k.contact={name:$('kt-name').value.trim(),phone:$('kt-phone').value.trim(),email:$('kt-email').value.trim(),hours:$('kt-hours').value.trim()};
    k.guides=[...dlg.querySelectorAll('[data-guide]')].map(g=>({title:g.querySelector('input').value.trim(),body:g.querySelector('textarea').value.trim()}));
    k.videos=[...dlg.querySelectorAll('[data-video]')].map(v=>({title:v.querySelector('[data-vt]').value.trim(),url:v.querySelector('[data-vu]').value.trim()}));
    k.files=[...dlg.querySelectorAll('[data-file]:checked')].map(c=>c.getAttribute('data-file'));
    k.shown=$('kt-shown').checked;
    return k;
  }
  function paintKit(focusSel){
    const d=KIT.data,k=KIT.kit,edit=!!d.can_edit,ro=edit?'':' disabled';
    const f=d.facts||{};
    const who=d.owner&&d.owner.name?d.owner.name:'they';
    const facts=[['Address',f.address?String(f.address).replace(/^https?:\/\//,''):'Not live yet'],['Live since',f.live_since?day(f.live_since):'Not yet'],['Domain renews',f.domain_expires_at?day(f.domain_expires_at)+(f.domain_registrar?' · with '+f.domain_registrar:''):(f.domain?'Not known':'No domain of their own')]];
    const files=(d.files||[]);
    show('kitDlg',`<h3 id="kitDlg-h">Hand-over kit for ${esc(nameOf(KIT.site))}</h3>
      <p class="lead">What ${esc(who)} sees under Help in their portal: who to call, how to do the everyday things, and the facts of their website.</p>
      <div class="sub">Who to call</div>
      <div class="grid2"><div><label for="kt-name">Name</label><input id="kt-name" maxlength="80" value="${esc(k.contact.name)}"${ro}></div><div><label for="kt-phone">Phone</label><input id="kt-phone" maxlength="40" value="${esc(k.contact.phone)}"${ro}></div>
      <div><label for="kt-email">Email</label><input id="kt-email" type="email" maxlength="254" value="${esc(k.contact.email)}"${ro}></div><div><label for="kt-hours">When to reach you</label><input id="kt-hours" maxlength="120" placeholder="Weekdays 9 to 5" value="${esc(k.contact.hours)}"${ro}></div></div>
      <div class="sub">Their website <small>filled in for you</small></div>
      <dl class="facts">${facts.map(([a,b])=>`<dt>${esc(a)}</dt><dd>${esc(b)}</dd>`).join('')}</dl>
      <div class="sub">How-tos</div>
      <div class="list" id="kt-guides">${k.guides.map((g,n)=>`<div class="grow" data-guide="${n}"><div class="gtop"><input aria-label="How-to title" maxlength="80" value="${esc(g.title)}"${ro}>${edit?`<button type="button" class="x" data-guide-x="${n}" aria-label="Remove “${esc(g.title)}”">✕</button>`:''}</div><textarea aria-label="What to do" maxlength="600" rows="2"${ro}>${esc(g.body)}</textarea></div>`).join('')||'<div class="grow"><span class="hint" style="margin:0">No how-tos yet.</span></div>'}</div>
      ${edit&&k.guides.length<8?'<div class="acts" style="margin-top:8px"><button type="button" class="btn ghost" id="kt-guide-add">+ Add a how-to</button></div>':''}
      <div class="sub">Videos <small>a link to each: YouTube, Vimeo, Loom…</small></div>
      <div class="list" id="kt-videos">${k.videos.map((v,n)=>`<div class="grow" data-video="${n}"><div class="gtop"><input data-vt aria-label="Video title" maxlength="80" placeholder="A 3-minute tour of your website" value="${esc(v.title)}"${ro}>${edit?`<button type="button" class="x" data-video-x="${n}" aria-label="Remove “${esc(v.title||'this video')}”">✕</button>`:''}</div><input data-vu aria-label="Video link" type="url" maxlength="500" placeholder="https://" value="${esc(v.url)}"${ro}></div>`).join('')||'<div class="grow"><span class="hint" style="margin:0">No videos yet.</span></div>'}</div>
      ${edit&&k.videos.length<8?'<div class="acts" style="margin-top:8px"><button type="button" class="btn ghost" id="kt-video-add">+ Add a video link</button></div>':''}
      <div class="sub">Files <small>from their Files · tick up to ten</small></div>
      <div class="list files">${files.length?files.map(x=>`<label class="qrow"><input type="checkbox" data-file="${esc(x.id)}"${k.files.indexOf(x.id)>=0?' checked':''}${ro}><span class="qw"><b>${esc(x.name)}</b><small>${x.mime==='application/pdf'?'Document':'Photo'} · ${esc(day(x.created_at))}</small></span></label>`).join(''):'<div class="grow"><span class="hint" style="margin:0">Nothing in their Files yet.</span></div>'}</div>
      <div class="acts"><label class="switch"><input type="checkbox" id="kt-shown" role="switch"${k.shown?' checked':''}${ro}>In their portal</label><span class="sp"></span>
        ${edit&&k.shown&&d.saved&&d.owner?'<button type="button" class="btn ghost" id="kt-tell">Tell them it’s ready</button>':''}${edit?'<button type="button" class="btn" id="kt-save">Save</button>':'<button type="button" class="btn" data-close>Close</button>'}</div>
      <p class="hint" id="kt-note">${esc(kitNote(d,k))}</p>`,focusSel||(edit?'#kt-name':'[data-close]'));
    wireClose('kitDlg');
    if(!edit)return;
    const dlg=dialog('kitDlg');
    dlg.querySelectorAll('[data-guide-x]').forEach(b=>b.addEventListener('click',()=>{readKitForm();KIT.kit.guides.splice(Number(b.getAttribute('data-guide-x')),1);paintKit('#kt-guide-add');}));
    dlg.querySelectorAll('[data-video-x]').forEach(b=>b.addEventListener('click',()=>{readKitForm();KIT.kit.videos.splice(Number(b.getAttribute('data-video-x')),1);paintKit('#kt-video-add');}));
    const ga=$('kt-guide-add');if(ga)ga.addEventListener('click',()=>{readKitForm();KIT.kit.guides.push({title:'',body:''});paintKit('[data-guide="'+(KIT.kit.guides.length-1)+'"] input');});
    const va=$('kt-video-add');if(va)va.addEventListener('click',()=>{readKitForm();KIT.kit.videos.push({title:'',url:''});paintKit('[data-video="'+(KIT.kit.videos.length-1)+'"] [data-vt]');});
    dlg.querySelectorAll('[data-file]').forEach(c=>c.addEventListener('change',()=>{if(dlg.querySelectorAll('[data-file]:checked').length>10){c.checked=false;toast('Pick up to ten files.',true);}}));
    $('kt-save').addEventListener('click',async()=>{
      if(BUSY)return;const k=readKitForm(),b=$('kt-save');
      BUSY=true;b.disabled=true;b.textContent='Saving…';
      const r=await apiSend('PUT','/agency/sites/'+encodeURIComponent(KIT.site)+'/kit',k).catch(()=>null);BUSY=false;
      if(!r||!r.ok){b.disabled=false;b.textContent='Save';toast(say(r,'That didn’t save — please try again.'),true);return;}
      KIT.kit=r.body.data.kit;KIT.data.saved=true;KIT.data.kit=KIT.kit;paintKit('#kt-save');refresh(KIT.site);
      toast(KIT.kit.shown?'Saved. It’s in their portal under Help.':'Saved. It isn’t in their portal until you switch it on.');
    });
    const em=$('kt-tell');if(em)em.addEventListener('click',async()=>{
      if(BUSY)return;BUSY=true;em.disabled=true;em.textContent='Sending…';
      const r=await apiSend('POST','/agency/sites/'+encodeURIComponent(KIT.site)+'/kit/email',{}).catch(()=>null);BUSY=false;
      if(!r||!r.ok){em.disabled=false;em.textContent='Tell them it’s ready';toast(say(r,'That didn’t send — please try again.'),true);return;}
      KIT.kit=r.body.data.kit;paintKit('#kt-save');refresh(KIT.site);toast('Sent. They’ll find it under Help in their portal.');
    });
  }
  function kitNote(d,k){
    const bits=[];
    if(!d.saved)bits.push('Not saved yet — these are suggestions to start from.');
    else if(k.updated_at)bits.push('Saved '+day(k.updated_at)+'.');
    if(k.emailed_at)bits.push('They were told '+day(k.emailed_at)+'.');
    if(!d.owner)bits.push('This site has no owner with a portal yet, so they’ll see it once you invite them.');
    return bits.join(' ');
  }

  // ── links from elsewhere: Plan my week, the email, a bookmark ──
  function fromHash(){
    const m=/^#(answers|content|kit)=([0-9a-f-]{36})$/.exec(location.hash||'');
    if(!m||!siteOf(m[2]))return;
    try{history.replaceState(null,'',location.pathname+location.search);}catch(_){}
    if(m[1]==='answers')openAnswers(m[2]);else if(m[1]==='kit')openKit(m[2]);else openIntake(m[2]);
  }
  let FIRST=true;
  window.ClientTools={
    menuHtml,wireMenu,paint,
    /** after every render of the cards: fill their lines; the first time, follow a link's hash */
    mount(){mount();if(FIRST){FIRST=false;fromHash();}},
  };
  window.addEventListener('hashchange',fromHash);
})();
