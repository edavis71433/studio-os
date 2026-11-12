// ── The "Leave feedback" panel on a shared draft (/p/s/:token) ───────────────
// Wave-2 G11, with builder list item 159's name and picture. Imports nothing, so the
// browser spec notes-159.spec.ts draws the real panel (e2e.yml lists this file).
// Self-contained (inline CSS/JS, zero external assets — fits inside the
// published-site CSP), theme-neutral, and blind to operator data: it reads ONLY
// the {id,name} sections route and writes ONLY the token comments route — both
// authorized by the SAME signed token the visitor arrived with.
const FEEDBACK_MARKER = 'id="presence-feedback-panel"';

/** Escape a string for safe embedding inside an inline <script> as a JS string
 *  literal (JSON + unicode-escape of anything that could close the tag). Pure. */
function jsStr(s: string): string {
  return JSON.stringify(String(s ?? '')).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
}

/** Inject the fixed "Leave feedback" panel before </body>. `pfx` is the signed
 *  door's own URL (…/p/s/<token>) — sections + comments are fetched under it, so
 *  the panel holds no authority beyond the link the visitor already has.
 *  Idempotent; pure. */
export function injectFeedbackPanel(html: string, opts: { pfx: string; page: string }): string {
  if (typeof html !== 'string' || html.includes(FEEDBACK_MARKER)) return html;
  const P = jsStr(opts.pfx);
  const PG = jsStr(opts.page || '/');
  const panel = `
<div id="presence-feedback-panel">
<style>
#presence-feedback-panel{position:fixed;right:16px;bottom:56px;z-index:2147483646;font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1525}
#pfb-open{font:inherit;font-weight:700;font-size:13.5px;padding:10px 16px;border:none;border-radius:999px;background:#5b3fa0;color:#fff;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.22)}
#pfb-card{display:none;width:320px;max-width:calc(100vw - 32px);max-height:min(70vh,520px);overflow-y:auto;background:#fff;border:1px solid #e2dcee;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);padding:14px 14px 10px;margin-bottom:10px}
#presence-feedback-panel.open #pfb-card{display:block}
#pfb-card h2{font-size:15px;margin:0 0 2px;color:#3a2470}
#pfb-card .pfb-sub{font-size:12px;color:#6b6478;margin:0 0 10px}
.pfb-who{display:block;font-size:12px;font-weight:600;color:#3a2470;margin:0 0 4px}
#pfb-name{width:100%;box-sizing:border-box;font:inherit;font-size:13px;border:1px solid #d9d2e8;border-radius:8px;padding:7px;margin:0 0 10px}
.pfb-pic{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#5b3fa0;cursor:pointer;margin-top:6px}
.pfb-pic input{position:absolute;width:1px;height:1px;opacity:0}
.pfb-thumb{display:flex;align-items:center;gap:8px;margin-top:6px;font-size:12px;color:#6b6478}
.pfb-thumb img{width:64px;height:44px;object-fit:cover;border-radius:6px;border:1px solid #e2dcee}
.pfb-thumb button{font:inherit;font-size:12px;color:#a3423a;background:none;border:none;cursor:pointer;text-decoration:underline;padding:0}
.pfb-row{border-top:1px solid #efeaf7;padding:7px 0}
.pfb-name{font-weight:600;font-size:13px}
.pfb-add{font:inherit;font-size:12px;color:#5b3fa0;background:none;border:none;cursor:pointer;padding:2px 0;text-decoration:underline}
.pfb-box{width:100%;box-sizing:border-box;font:inherit;font-size:13px;border:1px solid #d9d2e8;border-radius:8px;padding:7px;margin-top:6px;min-height:56px;resize:vertical}
.pfb-send{font:inherit;font-size:12.5px;font-weight:700;margin-top:6px;padding:6px 14px;border:none;border-radius:999px;background:#5b3fa0;color:#fff;cursor:pointer}
.pfb-send[disabled]{opacity:.5;cursor:default}
.pfb-done{font-size:12.5px;color:#1f7a4d;font-weight:600;padding:6px 0}
.pfb-err{font-size:12px;color:#a3423a;padding:4px 0}
</style>
<div id="pfb-card" role="dialog" aria-label="Leave feedback on this draft">
  <h2>Leave feedback</h2>
  <p class="pfb-sub">Your notes go straight to the studio — nothing shows on the website.</p>
  <label class="pfb-who" for="pfb-name">Your name (so the studio knows who wrote)</label>
  <input id="pfb-name" type="text" maxlength="60" autocomplete="name" placeholder="e.g. Sam at the bakery">
  <div id="pfb-sections"></div>
</div>
<button type="button" id="pfb-open" aria-expanded="false">&#128172; Leave feedback</button>
<script>
(function(){
  var PFX=${P},PAGE=${PG};
  var root=document.getElementById('presence-feedback-panel');
  var btn=document.getElementById('pfb-open');
  var host=document.getElementById('pfb-sections');
  var nameBox=document.getElementById('pfb-name');
  var loaded=false;
  // item 159: the name is remembered for this visit, so it's typed once
  var NKEY='pfb-name:'+PFX;
  try{nameBox.value=sessionStorage.getItem(NKEY)||'';}catch(_){}
  nameBox.addEventListener('change',function(){try{sessionStorage.setItem(NKEY,nameBox.value.trim());}catch(_){}});
  // one picture a note, made small here (at most 1600 wide) so it travels with the note
  function shrink(file,done){
    if(!file||!/^image\\/(jpeg|png|webp|gif)$/.test(file.type)){done(null,'Choose a photo or a screenshot (JPEG, PNG or WebP).');return;}
    var img=new Image(),u=URL.createObjectURL(file);
    img.onload=function(){
      var s=Math.min(1,1600/Math.max(img.width,img.height)),w=Math.max(1,Math.round(img.width*s)),h=Math.max(1,Math.round(img.height*s));
      var c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);
      URL.revokeObjectURL(u);
      var d=c.toDataURL('image/jpeg',0.85);
      if(d.length>4200000){done(null,'That picture is too big to send.');return;}
      done({data:d,w:w,h:h});
    };
    img.onerror=function(){URL.revokeObjectURL(u);done(null,'That picture couldn\u2019t be read.');};
    img.src=u;
  }
  function boxRow(name,blockId,open){
    var row=document.createElement('div');row.className='pfb-row';
    var nm=document.createElement('div');nm.className='pfb-name';nm.textContent=name;row.appendChild(nm);
    var wrap=document.createElement('div');row.appendChild(wrap);
    function showBox(){
      wrap.textContent='';
      var ta=document.createElement('textarea');ta.className='pfb-box';ta.maxLength=2000;
      ta.placeholder='What should change here?';wrap.appendChild(ta);
      var pic=null;
      var pl=document.createElement('label');pl.className='pfb-pic';pl.appendChild(document.createTextNode('\uD83D\uDCCE Add a screenshot or photo'));
      var pi=document.createElement('input');pi.type='file';pi.accept='image/*';pl.appendChild(pi);wrap.appendChild(pl);
      var th=document.createElement('div');th.className='pfb-thumb';th.hidden=true;wrap.appendChild(th);
      var send=document.createElement('button');send.type='button';send.className='pfb-send';send.textContent='Send';
      wrap.appendChild(send);
      var err=document.createElement('div');err.className='pfb-err';wrap.appendChild(err);
      pi.addEventListener('change',function(){
        var f=pi.files&&pi.files[0];pi.value='';if(!f)return;
        err.textContent='';
        shrink(f,function(p,why){
          if(!p){err.textContent=why;return;}
          pic=p;th.textContent='';th.hidden=false;pl.hidden=true;
          var im=document.createElement('img');im.src=p.data;im.alt='The picture going with this note';th.appendChild(im);
          var rm=document.createElement('button');rm.type='button';rm.textContent='Remove';
          rm.addEventListener('click',function(){pic=null;th.hidden=true;th.textContent='';pl.hidden=false;});
          th.appendChild(rm);
        });
      });
      send.addEventListener('click',function(){
        var body=(ta.value||'').trim();
        if(!body){err.textContent='Write a note first.';return;}
        send.disabled=true;send.textContent='Sending\\u2026';err.textContent='';
        var who=(nameBox.value||'').trim();try{sessionStorage.setItem(NKEY,who);}catch(_){}
        var msg={page:PAGE,block_id:blockId,body:body};if(who)msg.name=who;if(pic){msg.image=pic.data;msg.w=pic.w;msg.h=pic.h;}
        fetch(PFX+'/comments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(msg)})
          .then(function(r){return r.json().catch(function(){return {};}).then(function(j){return {ok:r.ok,j:j};});})
          .then(function(res){
            if(res.ok){wrap.textContent='';var d=document.createElement('div');d.className='pfb-done';d.textContent='\\u2713 Thanks \\u2014 sent to the studio.';wrap.appendChild(d);}
            else{send.disabled=false;send.textContent='Send';err.textContent=(res.j&&res.j.message)||'That didn\\u2019t send \\u2014 please try again.';}
          })
          .catch(function(){send.disabled=false;send.textContent='Send';err.textContent='That didn\\u2019t send \\u2014 please try again.';});
      });
      ta.focus();
    }
    if(open){showBox();}
    else{var add=document.createElement('button');add.type='button';add.className='pfb-add';add.textContent='Add a note';
      add.addEventListener('click',function(){add.remove();showBox();});wrap.appendChild(add);}
    return row;
  }
  function load(){
    if(loaded)return;loaded=true;
    host.textContent='';
    host.appendChild(boxRow('This whole page','',true));
    fetch(PFX+'/sections?page='+encodeURIComponent(PAGE))
      .then(function(r){return r.ok?r.json():null;})
      .then(function(j){
        var secs=(j&&j.data&&j.data.sections)||[];
        secs.forEach(function(s){if(s&&s.id&&s.name)host.appendChild(boxRow(String(s.name),String(s.id),false));});
      })
      .catch(function(){/* the whole-page box still works */});
  }
  btn.addEventListener('click',function(){
    var open=root.classList.toggle('open');
    btn.setAttribute('aria-expanded',String(open));
    if(open)load();
  });
})();
</script>
</div>`;
  return html.includes('</body>') ? html.replace('</body>', `${panel}</body>`) : `${html}${panel}`;
}
