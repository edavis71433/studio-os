/* ============================================================================
   DAVIS DIGITAL STUDIO — SITE CONCIERGE WIDGET
   ----------------------------------------------------------------------------
   A floating chat assistant that answers visitor questions from a fixed
   knowledge base and routes qualified people to Eric's Calendly.

   HOW TO ADD IT TO YOUR SITE
   1. Save this file as  concierge.js  in your site root (same folder as sw.js).
   2. On each page, just before </body>, add this one line:
          <script src="/concierge.js" defer></script>
      (Add it to all pages you want the concierge on. The footer/nav include
       spots are a good home. It will not load twice if added once per page.)
   3. Make sure the Edge Function has the `concierge` handler deployed
      (see clever-api-concierge-ADD.ts).

   That's it. No build step, no dependencies. It styles itself and matches
   your site (dark purple, DM Serif Display + DM Sans).
   ============================================================================ */
(function () {
  'use strict';
  if (window.__ddsConcierge) return;          // guard against double-load
  window.__ddsConcierge = true;

  var EDGE_FN = 'https://qksstlqzbhesadrrofgn.supabase.co/functions/v1/clever-api';
  var CALENDLY = 'https://calendly.com/eric-davisdigitalstudio/30min';

  // conversation history sent to the server each turn
  var history = [];
  var sending = false;
  var opened = false;

  // ---- styles -------------------------------------------------------------
  var css = `
  .dds-cc-launch{position:fixed;bottom:24px;right:24px;z-index:99995;display:inline-flex;align-items:center;gap:9px;background:#5b3fa0;color:#fff;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;font-size:14.5px;font-weight:600;padding:13px 20px 13px 17px;border-radius:100px;border:none;cursor:pointer;box-shadow:0 10px 30px rgba(91,63,160,0.38);transition:transform .14s ease,box-shadow .14s ease;}
  .dds-cc-launch:hover{transform:translateY(-2px);box-shadow:0 14px 36px rgba(91,63,160,0.46);}
  .dds-cc-launch svg{width:19px;height:19px;flex-shrink:0;}
  .dds-cc-launch.dds-hide{opacity:0;pointer-events:none;transform:translateY(8px);}

  .dds-cc-panel{position:fixed;bottom:24px;right:24px;z-index:99996;width:380px;max-width:calc(100vw - 32px);height:560px;max-height:calc(100vh - 48px);background:#fff;border-radius:20px;box-shadow:0 24px 70px rgba(15,8,32,0.45);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(16px) scale(.98);pointer-events:none;transition:opacity .2s ease,transform .2s ease;font-family:'DM Sans',-apple-system,BlinkMacSystemFont,sans-serif;}
  .dds-cc-panel.dds-open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto;}

  .dds-cc-head{background:#1e1338;padding:18px 18px 17px;position:relative;overflow:hidden;flex-shrink:0;}
  .dds-cc-head::before{content:'';position:absolute;top:-60px;right:-40px;width:220px;height:220px;border-radius:50%;background:radial-gradient(circle,rgba(91,63,160,0.5) 0%,transparent 65%);pointer-events:none;}
  .dds-cc-head-row{display:flex;align-items:center;gap:11px;position:relative;}
  .dds-cc-avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#5b3fa0,#7c5dc4);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'DM Serif Display',Georgia,serif;font-size:18px;color:#fff;}
  .dds-cc-htext{flex:1;min-width:0;}
  .dds-cc-htext h3{font-family:'DM Serif Display',Georgia,serif;font-size:17px;font-weight:400;color:#fff;margin:0;line-height:1.2;}
  .dds-cc-htext p{font-size:12px;color:rgba(255,255,255,0.55);margin:2px 0 0;line-height:1.3;}
  .dds-cc-status{display:inline-block;width:7px;height:7px;border-radius:50%;background:#5bd08a;margin-right:5px;vertical-align:middle;}
  .dds-cc-close{background:rgba(255,255,255,0.1);border:none;color:#fff;width:30px;height:30px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .14s;}
  .dds-cc-close:hover{background:rgba(255,255,255,0.2);}
  .dds-cc-close svg{width:16px;height:16px;}

  .dds-cc-body{flex:1;overflow-y:auto;padding:18px 16px 8px;background:#faf8fc;display:flex;flex-direction:column;gap:11px;}
  .dds-cc-body::-webkit-scrollbar{width:7px;}
  .dds-cc-body::-webkit-scrollbar-thumb{background:rgba(91,63,160,0.2);border-radius:10px;}

  .dds-cc-msg{max-width:84%;font-size:14.5px;line-height:1.55;padding:11px 14px;border-radius:15px;white-space:pre-wrap;word-wrap:break-word;}
  .dds-cc-bot{align-self:flex-start;background:#fff;color:#2a2336;border:1px solid rgba(91,63,160,0.1);border-bottom-left-radius:5px;box-shadow:0 2px 8px rgba(91,63,160,0.05);}
  .dds-cc-user{align-self:flex-end;background:#5b3fa0;color:#fff;border-bottom-right-radius:5px;}

  .dds-cc-book{align-self:flex-start;max-width:84%;}
  .dds-cc-book a{display:inline-flex;align-items:center;gap:8px;background:#1e1338;color:#fff;font-size:14px;font-weight:600;padding:11px 18px;border-radius:100px;text-decoration:none;box-shadow:0 6px 18px rgba(30,19,56,0.25);transition:transform .12s;}
  .dds-cc-book a:hover{transform:translateY(-1px);}
  .dds-cc-book a svg{width:16px;height:16px;}

  .dds-cc-typing{align-self:flex-start;background:#fff;border:1px solid rgba(91,63,160,0.1);border-bottom-left-radius:5px;padding:13px 16px;border-radius:15px;display:flex;gap:4px;}
  .dds-cc-typing span{width:7px;height:7px;border-radius:50%;background:#c4aee8;animation:ddsbounce 1.2s infinite ease-in-out;}
  .dds-cc-typing span:nth-child(2){animation-delay:.15s;}
  .dds-cc-typing span:nth-child(3){animation-delay:.3s;}
  @keyframes ddsbounce{0%,60%,100%{transform:translateY(0);opacity:.5;}30%{transform:translateY(-5px);opacity:1;}}

  .dds-cc-chips{display:flex;flex-wrap:wrap;gap:7px;padding:4px 2px 8px;}
  .dds-cc-chip{background:#fff;border:1.5px solid rgba(91,63,160,0.2);color:#5b3fa0;font-family:inherit;font-size:13px;font-weight:500;padding:8px 13px;border-radius:100px;cursor:pointer;transition:all .13s;}
  .dds-cc-chip:hover{background:#5b3fa0;border-color:#5b3fa0;color:#fff;}

  .dds-cc-foot{flex-shrink:0;border-top:1px solid rgba(91,63,160,0.1);padding:11px 12px;background:#fff;}
  .dds-cc-inrow{display:flex;align-items:flex-end;gap:8px;}
  .dds-cc-input{flex:1;border:1.5px solid rgba(91,63,160,0.18);border-radius:14px;padding:11px 13px;font-family:inherit;font-size:14.5px;color:#1a1523;resize:none;max-height:96px;line-height:1.4;transition:border-color .14s;}
  .dds-cc-input:focus{outline:none;border-color:#5b3fa0;}
  .dds-cc-send{flex-shrink:0;width:42px;height:42px;border-radius:12px;background:#5b3fa0;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:opacity .14s,transform .08s;}
  .dds-cc-send:hover{opacity:.9;}
  .dds-cc-send:active{transform:scale(.95);}
  .dds-cc-send:disabled{opacity:.4;cursor:not-allowed;}
  .dds-cc-send svg{width:18px;height:18px;color:#fff;}
  .dds-cc-disc{text-align:center;font-size:10.5px;color:#a99fbb;margin:7px 0 0;line-height:1.3;}

  @media(max-width:480px){
    .dds-cc-panel{bottom:0;right:0;width:100vw;max-width:100vw;height:100dvh;max-height:100dvh;border-radius:0;}
    .dds-cc-launch{bottom:18px;right:18px;}
  }
  @media(prefers-reduced-motion:reduce){
    .dds-cc-panel,.dds-cc-launch{transition:opacity .15s;}
    .dds-cc-typing span{animation:none;}
  }`;

  var style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  // ---- icons --------------------------------------------------------------
  var ICON_CHAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  var ICON_SEND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
  var ICON_CAL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

  // ---- build DOM ----------------------------------------------------------
  var launch = document.createElement('button');
  launch.className = 'dds-cc-launch';
  launch.setAttribute('aria-label', 'Open chat with the studio assistant');
  launch.innerHTML = ICON_CHAT + '<span>Questions? Ask away</span>';

  var panel = document.createElement('div');
  panel.className = 'dds-cc-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Studio assistant chat');
  panel.innerHTML =
    '<div class="dds-cc-head"><div class="dds-cc-head-row">' +
      '<div class="dds-cc-avatar">D</div>' +
      '<div class="dds-cc-htext"><h3>Studio Assistant</h3><p><span class="dds-cc-status"></span>Here to help, no pressure</p></div>' +
      '<button class="dds-cc-close" aria-label="Close chat">' + ICON_CLOSE + '</button>' +
    '</div></div>' +
    '<div class="dds-cc-body" id="ddsCcBody"></div>' +
    '<div class="dds-cc-foot">' +
      '<div class="dds-cc-inrow">' +
        '<textarea class="dds-cc-input" id="ddsCcInput" rows="1" placeholder="Ask about services, pricing, timing..." aria-label="Type your message"></textarea>' +
        '<button class="dds-cc-send" id="ddsCcSend" aria-label="Send message">' + ICON_SEND + '</button>' +
      '</div>' +
      '<p class="dds-cc-disc">Answers come from Eric\'s real services and pricing. For anything specific, you can book a free call.</p>' +
    '</div>';

  document.body.appendChild(launch);
  document.body.appendChild(panel);

  var body = panel.querySelector('#ddsCcBody');
  var input = panel.querySelector('#ddsCcInput');
  var sendBtn = panel.querySelector('#ddsCcSend');
  var closeBtn = panel.querySelector('.dds-cc-close');

  // ---- helpers ------------------------------------------------------------
  function scrollDown() { body.scrollTop = body.scrollHeight; }

  function addMsg(text, who) {
    var d = document.createElement('div');
    d.className = 'dds-cc-msg ' + (who === 'user' ? 'dds-cc-user' : 'dds-cc-bot');
    d.textContent = text;
    body.appendChild(d);
    scrollDown();
    return d;
  }

  function addBookButton() {
    var wrap = document.createElement('div');
    wrap.className = 'dds-cc-book';
    var a = document.createElement('a');
    a.href = CALENDLY;
    a.target = '_blank';
    a.rel = 'noopener';
    a.innerHTML = ICON_CAL + '<span>Book a free call</span>';
    a.addEventListener('click', function () {
      if (typeof gtag === 'function') gtag('event', 'concierge_book_click', { event_category: 'concierge' });
    });
    wrap.appendChild(a);
    body.appendChild(wrap);
    scrollDown();
  }

  function showTyping() {
    var t = document.createElement('div');
    t.className = 'dds-cc-typing';
    t.id = 'ddsCcTyping';
    t.innerHTML = '<span></span><span></span><span></span>';
    body.appendChild(t);
    scrollDown();
  }
  function hideTyping() {
    var t = document.getElementById('ddsCcTyping');
    if (t) t.remove();
  }

  var STARTERS = [
    'What do you build?',
    'How much does a website cost?',
    'How long does it take?',
    'I already have a site'
  ];

  function showStarters() {
    var wrap = document.createElement('div');
    wrap.className = 'dds-cc-chips';
    wrap.id = 'ddsCcChips';
    STARTERS.forEach(function (s) {
      var c = document.createElement('button');
      c.className = 'dds-cc-chip';
      c.textContent = s;
      c.addEventListener('click', function () { send(s); });
      wrap.appendChild(c);
    });
    body.appendChild(wrap);
    scrollDown();
  }
  function clearStarters() {
    var c = document.getElementById('ddsCcChips');
    if (c) c.remove();
  }

  // ---- send ---------------------------------------------------------------
  function send(text) {
    text = (text || input.value || '').trim();
    if (!text || sending) return;
    clearStarters();
    addMsg(text, 'user');
    history.push({ role: 'user', content: text });
    input.value = '';
    input.style.height = 'auto';
    sending = true;
    sendBtn.disabled = true;
    showTyping();

    fetch(EDGE_FN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'concierge', messages: history })
    })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        hideTyping();
        var data = (res && res.data) ? res.data : res;
        var reply = (data && data.reply) ? data.reply : "Sorry, I had trouble with that. You can always reach Eric directly with a quick free call.";
        addMsg(reply, 'bot');
        history.push({ role: 'assistant', content: reply });
        if (data && data.book) addBookButton();
      })
      .catch(function () {
        hideTyping();
        addMsg("Sorry, something went wrong on my end. The fastest way to get an answer is a quick free call with Eric.", 'bot');
        addBookButton();
      })
      .then(function () {
        sending = false;
        sendBtn.disabled = false;
        input.focus();
      });
  }

  // ---- open / close -------------------------------------------------------
  function openPanel() {
    panel.classList.add('dds-open');
    launch.classList.add('dds-hide');
    if (!opened) {
      opened = true;
      setTimeout(function () {
        addMsg("Hey there. I'm the studio assistant. Ask me what Eric builds, what it costs, or how long it takes, and I'll give you a straight answer. What's on your mind?", 'bot');
        showStarters();
      }, 250);
    }
    setTimeout(function () { input.focus(); }, 300);
  }
  function closePanel() {
    panel.classList.remove('dds-open');
    launch.classList.remove('dds-hide');
  }

  launch.addEventListener('click', openPanel);
  closeBtn.addEventListener('click', closePanel);
  sendBtn.addEventListener('click', function () { send(); });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 96) + 'px';
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('dds-open')) closePanel();
  });
})();
