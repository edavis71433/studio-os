/* ── The blog's writing screen (builder list item 40, Nov 2026) ─────────────────
 * Opened from Blog in the website builder (presence.html), loaded on first use. The
 * post fills the screen the way it will look on the site, in the site's own fonts and
 * colours; the tools float over it: one pill bar on top, and the Post settings card on
 * the right (a sheet from the bottom on a phone). Words save as you type. Publish puts
 * this one post live on its own (POST /posts/:id/publish), or it goes out at a day and
 * time; nothing else in the draft goes with it.
 *
 * The text is the post's markdown (lib/markdown.ts: paragraphs, ## headings, lists,
 * quotes, **bold**, *italic*, [links](https://…)), edited in place, and a photo from
 * Files is a line of its own, ![description](media:<id> "caption") (lib/blog.ts).
 * presence.html passes in everything that touches the account (`host`), so this file
 * reads and writes nothing on its own.
 */
(function () {
  "use strict";
  const CSS = `
.bs{position:fixed;inset:0;z-index:90;display:flex;background:var(--bs-bg);color:var(--bs-ink)}
.bs[hidden]{display:none}
.bs-scroll{flex:1;overflow:auto;-webkit-overflow-scrolling:touch}
.bs-bar{position:sticky;top:14px;z-index:3;margin:14px auto 0;width:max-content;max-width:calc(100% - 28px);display:flex;align-items:center;gap:4px;padding:6px 8px;border-radius:999px;background:var(--dds-card,#fff);color:var(--dds-ink,#171522);box-shadow:var(--dds-shadow-pop,0 20px 48px -12px rgba(23,21,34,.24));font:500 13px/1.2 var(--dds-sans,Inter,system-ui,sans-serif);flex-wrap:nowrap;overflow-x:auto}
.bs-bar button{font:inherit;color:inherit;background:none;border:0;border-radius:999px;min-height:36px;min-width:36px;padding:0 10px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;white-space:nowrap}
.bs-bar button:hover{background:var(--dds-up,#f7f6fb)}
.bs-bar button:focus-visible,.bs-card button:focus-visible,.bs-menu button:focus-visible{outline:2px solid var(--dds-p,#6d3fd4);outline-offset:2px}
.bs-bar .bs-back{background:var(--dds-up,#f7f6fb);font-weight:600}
.bs-bar .bs-sep{width:1px;height:22px;background:var(--dds-line,#e7e6ef);margin:0 4px;flex:0 0 auto}
.bs-bar .bs-state{color:var(--dds-soft,#55526a);padding:0 8px;display:inline-flex;align-items:center;gap:6px}
.bs-dot{width:7px;height:7px;border-radius:999px;background:var(--dds-good,#11744a);flex:0 0 auto}
.bs-dot.sched{background:var(--dds-info,#245fa0)}.bs-dot.warn{background:var(--dds-warn,#94530a)}
.bs-bar .bs-photo{background:var(--dds-p-soft,#f0ebfd);color:var(--dds-p,#6d3fd4);font-weight:600}
.bs-bar .bs-preview{border:1px solid var(--dds-line-strong,#d6d4e2)}
.bs-bar .bs-pub{background:var(--dds-grad-btn,linear-gradient(135deg,#6d3fd4 0%,#7a4bdd 100%));color:var(--dds-on-p,#fff);font-weight:600;padding:0 14px}
.bs-bar .bs-pub:hover{background:var(--dds-grad-btn,linear-gradient(135deg,#6d3fd4 0%,#7a4bdd 100%));filter:brightness(1.06)}
.bs-bar b{font-weight:700}.bs-bar i{font-family:Georgia,serif;font-style:italic;font-size:15px}
.bs-post{max-width:700px;margin:0 auto;padding:44px 24px 140px;padding-right:24px}
.bs.has-card .bs-post{margin-right:max(24px,calc(50% - 350px + 190px));margin-left:max(24px,calc(50% - 350px - 190px))}
.bs-kicker{color:var(--bs-accent);font:700 12px/1.2 var(--bs-body);letter-spacing:.12em;text-transform:uppercase;margin:0 0 12px;min-height:14px}
.bs-title{display:block;width:100%;border:0;background:transparent;color:var(--bs-ink);font:700 clamp(30px,5vw,46px)/1.15 var(--bs-display);resize:none;padding:0;margin:0;overflow:hidden}
.bs-title::placeholder{color:var(--bs-soft);opacity:.7}
.bs .bs-title:focus,.bs .bs-body:focus{outline:none}   /* the caret shows where you are; the shell's ring would box the whole post */
.bs .bs-title{font-size:clamp(30px,5vw,46px)!important}   /* the phone rule holding fields at 16px is for small fields; a title stays a title */
.bs-byline{color:var(--bs-soft);font:italic 15px/1.4 var(--bs-body);margin:12px 0 22px;display:flex;align-items:center;gap:10px}
.bs-av{width:30px;height:30px;border-radius:999px;background:var(--bs-line);color:var(--bs-ink);display:inline-grid;place-items:center;font:700 11px/1 var(--dds-sans,Inter,sans-serif);font-style:normal;overflow:hidden;flex:0 0 auto}
.bs-av img{width:100%;height:100%;object-fit:cover}
.bs-cover{position:relative;border-radius:var(--bs-radius);overflow:hidden;margin:0 0 26px;background:var(--bs-line)}
.bs-cover img{display:block;width:100%;height:auto;max-height:440px;object-fit:cover}
.bs-cover.empty{display:flex;align-items:center;justify-content:center;min-height:120px;border:1.5px dashed var(--bs-line);background:transparent}
.bs-pill{font:600 12.5px/1 var(--dds-sans,Inter,sans-serif);background:var(--dds-card,#fff);color:var(--dds-ink,#171522);border:0;border-radius:999px;padding:9px 13px;box-shadow:var(--dds-shadow,0 8px 24px -8px rgba(23,21,34,.18));cursor:pointer;min-height:36px}
.bs-cover .bs-pill{position:absolute;top:14px;right:14px}
.bs-body{font:18px/1.7 var(--bs-body);color:var(--bs-ink);min-height:240px;outline:none}
.bs-body p{margin:0 0 1em}.bs-body h2{font:700 26px/1.25 var(--bs-display);margin:1.4em 0 .5em}.bs-body h3{font:700 21px/1.3 var(--bs-display);margin:1.2em 0 .4em}
.bs-body ul,.bs-body ol{margin:0 0 1em 1.3em}.bs-body blockquote{border-left:3px solid var(--bs-accent);margin:0 0 1em;padding-left:16px;color:var(--bs-soft)}
.bs-body a{color:var(--bs-accent)}
.bs-body:empty::before{content:attr(data-placeholder);color:var(--bs-soft);opacity:.75}
.bs-fig{position:relative;margin:22px 0;cursor:pointer;user-select:none}
.bs-fig img{display:block;width:100%;height:auto;border-radius:var(--bs-radius)}
.bs-fig figcaption{color:var(--bs-soft);font:italic 14px/1.4 var(--bs-body);margin-top:8px}
.bs-fig.on img{outline:2px solid var(--dds-p,#6d3fd4);outline-offset:2px}
.bs-figtools{position:absolute;top:12px;left:12px;display:flex;gap:2px;padding:4px;border-radius:999px;background:var(--dds-card,#fff);box-shadow:var(--dds-shadow-pop,0 20px 48px -12px rgba(23,21,34,.24));font:500 12.5px/1 var(--dds-sans,Inter,sans-serif)}
.bs-figtools button{font:inherit;background:none;border:0;border-radius:999px;padding:8px 10px;color:var(--dds-ink,#171522);cursor:pointer;min-height:32px}
.bs-figtools button:hover{background:var(--dds-up,#f7f6fb)}.bs-figtools .rm{color:var(--dds-bad,#bf3535)}
.bs-card{position:fixed;top:76px;right:14px;bottom:14px;width:380px;z-index:4;overflow:auto;background:var(--dds-card,#fff);color:var(--dds-ink,#171522);border-radius:20px;box-shadow:var(--dds-shadow-pop,0 20px 48px -12px rgba(23,21,34,.24));padding:20px;font:14px/1.45 var(--dds-sans,Inter,system-ui,sans-serif);display:flex;flex-direction:column;gap:18px}
.bs-card[hidden]{display:none}
.bs-card h2{font:600 20px/1.2 var(--dds-serif,Fraunces,Georgia,serif);margin:0;flex:1}
.bs-card .bs-head{display:flex;align-items:center;gap:10px}
.bs-card .bs-quiet{font:600 13px/1 var(--dds-sans,Inter,sans-serif);color:var(--dds-p,#6d3fd4);background:none;border:0;cursor:pointer;padding:8px 4px;min-height:36px}
.bs-card label,.bs-card .bs-lbl{display:block;font-weight:600;font-size:12.5px;margin:0 0 7px}
.bs-card input[type=text],.bs-card input[type=date],.bs-card input[type=time],.bs-card select,.bs-card textarea{width:100%;box-sizing:border-box;font:inherit;font-size:16px;color:inherit;background:var(--dds-card,#fff);border:1px solid var(--dds-line-strong,#d6d4e2);border-radius:10px;padding:9px 11px;min-height:42px}
.bs-card textarea{min-height:76px;resize:vertical;line-height:1.45}
.bs-card .bs-hint{color:var(--dds-soft,#55526a);font-size:12.5px;line-height:1.4;margin:7px 0 0}
.bs-card .bs-count{color:var(--dds-faint,#69667d);font-size:11.5px;text-align:right;margin-top:4px}
.bs-card .bs-count.over{color:var(--dds-bad,#bf3535)}
.bs-seg{display:flex;gap:4px;padding:4px;border-radius:999px;background:var(--dds-up,#f7f6fb)}
.bs-seg button{flex:1;font:500 13px/1 var(--dds-sans,Inter,sans-serif);border:0;border-radius:999px;background:none;color:var(--dds-soft,#55526a);min-height:36px;cursor:pointer}
.bs-seg button[aria-pressed="true"]{background:var(--dds-ink,#171522);color:var(--dds-card,#fff);font-weight:600}
.bs-row{display:flex;gap:8px}.bs-row>*{flex:1;min-width:0}
.bs-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.bs-add{display:inline-block;margin-top:6px;font:600 12px/1 var(--dds-sans,Inter,sans-serif);color:var(--dds-p,#6d3fd4);background:none;border:0;padding:6px 0;cursor:pointer;min-height:32px}
.bs-switch{display:flex;align-items:center;gap:10px;font-weight:500;cursor:pointer}
.bs-switch input{width:18px;height:18px;accent-color:var(--dds-p,#6d3fd4)}
.bs-danger{font:600 13px/1 var(--dds-sans,Inter,sans-serif);color:var(--dds-bad,#bf3535);background:none;border:0;padding:8px 0;cursor:pointer;text-align:left;min-height:36px}
.bs-menu{position:fixed;z-index:6;width:min(360px,calc(100vw - 28px));background:var(--dds-card,#fff);color:var(--dds-ink,#171522);border-radius:18px;box-shadow:var(--dds-shadow-pop,0 20px 48px -12px rgba(23,21,34,.24));padding:8px;font:14px/1.4 var(--dds-sans,Inter,system-ui,sans-serif)}
.bs-menu[hidden]{display:none}
.bs-menu .bs-mlbl{font:600 11.5px/1 var(--dds-sans,Inter,sans-serif);letter-spacing:.06em;text-transform:uppercase;color:var(--dds-faint,#69667d);padding:8px 10px}
.bs-menu button{display:block;width:100%;text-align:left;font:inherit;color:inherit;background:none;border:0;border-radius:12px;padding:11px 12px;cursor:pointer}
.bs-menu button:hover,.bs-menu button.lead{background:var(--dds-p-soft,#f0ebfd)}
.bs-menu button strong{display:block;font-weight:600;font-size:14px}
.bs-menu button span{display:block;color:var(--dds-soft,#55526a);font-size:12.5px;margin-top:3px}
.bs-menu button.lead strong{color:var(--dds-p,#6d3fd4)}
.bs-menu button:disabled{opacity:.55;cursor:default}
.bs-menu .bs-mnote{background:var(--dds-up,#f7f6fb);border-radius:12px;padding:10px 12px;color:var(--dds-soft,#55526a);font-size:12.5px;margin-top:4px}
.bs-done{position:fixed;z-index:7;left:50%;bottom:28px;transform:translateX(-50%);width:min(380px,calc(100vw - 28px));background:var(--dds-card,#fff);color:var(--dds-ink,#171522);border-radius:20px;box-shadow:var(--dds-shadow-pop,0 20px 48px -12px rgba(23,21,34,.24));padding:20px;font:14px/1.45 var(--dds-sans,Inter,system-ui,sans-serif)}
.bs-done h3{font:600 20px/1.2 var(--dds-serif,Fraunces,Georgia,serif);margin:0 0 8px}
.bs-done p{margin:0 0 14px;color:var(--dds-soft,#55526a)}
.bs-done .bs-acts{display:flex;gap:8px;flex-wrap:wrap}
.bs-done a,.bs-done button{font:600 13px/1 var(--dds-sans,Inter,sans-serif);border-radius:999px;padding:11px 16px;text-decoration:none;cursor:pointer;min-height:40px;display:inline-flex;align-items:center}
.bs-done .go{background:var(--dds-grad-btn,linear-gradient(135deg,#6d3fd4 0%,#7a4bdd 100%));color:var(--dds-on-p,#fff);border:0}
.bs-done .out{background:var(--dds-card,#fff);color:var(--dds-ink,#171522);border:1px solid var(--dds-line-strong,#d6d4e2)}
.bs-done .x{position:absolute;top:10px;right:10px;background:none;border:0;color:var(--dds-soft,#55526a);padding:8px;min-height:36px}
.bs-tools{display:none}
.bs.previewing .bs-card,.bs.previewing .bs-tools,.bs.previewing .bs-cover .bs-pill,.bs.previewing .bs-bar>:not(.bs-back):not(.bs-endpv){display:none!important}
.bs.previewing .bs-post{margin:0 auto!important}
.bs-bar .bs-endpv{background:var(--dds-p-soft,#f0ebfd);color:var(--dds-p,#6d3fd4);font-weight:600}
@media (max-width:900px){.bs.has-card .bs-post{margin:0 auto}.bs-card{left:0;right:0;top:auto;bottom:0;width:auto;max-height:78vh;border-radius:24px 24px 0 0}.bs-bar .bs-fmt,.bs-bar .bs-photo,.bs-bar .bs-preview,.bs-bar .bs-sep{display:none}
.bs-tools{display:flex;position:fixed;left:12px;right:12px;bottom:12px;z-index:3;align-items:center;gap:2px;padding:6px 8px;border-radius:999px;background:var(--dds-card,#fff);box-shadow:var(--dds-shadow-pop,0 20px 48px -12px rgba(23,21,34,.24));font:600 13px/1 var(--dds-sans,Inter,sans-serif)}
.bs-tools button{font:inherit;color:var(--dds-ink,#171522);background:none;border:0;border-radius:999px;min-width:44px;min-height:44px;cursor:pointer}
.bs-tools .bs-set{margin-left:auto;background:var(--dds-p-soft,#f0ebfd);color:var(--dds-p,#6d3fd4);padding:0 14px}
.bs-post{padding:30px 18px 120px}.bs-bar{top:10px;margin-top:10px}}
@media (prefers-reduced-motion:no-preference){.bs-card,.bs-menu,.bs-done{transition:opacity .2s ease-out}}
`;
  let injected = false;
  const inject = () => { if (injected) return; injected = true; const s = document.createElement("style"); s.id = "blogStudioCss"; s.textContent = CSS; document.head.appendChild(s); };
  const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ICON = {
    back: '<path d="M15 6l-6 6 6 6"/>', caret: '<path d="m6 9 6 6 6-6"/>', link: '<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1"/><path d="M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    quote: '<path d="M7 7h4v6H5v-2a4 4 0 0 1 2-4zM15 7h4v6h-6v-2a4 4 0 0 1 2-4z"/>', img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
    sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    send: '<path d="M4 12h12M12 6l6 6-6 6"/>', cal: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>',
  };
  const icon = (n, s) => `<svg width="${s || 16}" height="${s || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

  /* ── the post's markdown, both ways ── */
  const IMG_LINE = /^!\[([^\]\n]{0,200})\]\(media:([0-9a-f-]{36})(?:\s+"([^"\n]{0,200})")?\)$/i;
  const safeHref = (u) => /^(https:\/\/|mailto:|tel:)\S+$/i.test(String(u || "").trim()) ? String(u).trim() : "";
  function inlineMd(t) {
    let s = escH(t);
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, url) => { const href = safeHref(url.replace(/&amp;/g, "&")); return href ? `<a href="${escH(href)}">${text}</a>` : text; });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    return s;
  }
  function figureHtml(id, alt, caption, mediaOf) {
    const m = mediaOf(id) || {};
    return `<figure class="bs-fig" contenteditable="false" data-media="${escH(id)}" data-alt="${escH(alt)}" data-caption="${escH(caption)}">${m.thumb ? `<img src="${escH(m.thumb)}" alt="${escH(alt || m.alt_text || "")}">` : `<div class="bs-cover empty">${escH(alt || "A photo from Files")}</div>`}${caption ? `<figcaption>${escH(caption)}</figcaption>` : ""}</figure>`;
  }
  /** The post's markdown as the editor's blocks. */
  function mdToHtml(md, mediaOf) {
    const out = []; let para = [], list = null, quote = [];
    const flushP = () => { if (para.length) { out.push(`<p>${para.map(inlineMd).join("<br>")}</p>`); para = []; } };
    const flushL = () => { if (list) { out.push(`<${list.kind}>${list.items.map((i) => `<li>${inlineMd(i)}</li>`).join("")}</${list.kind}>`); list = null; } };
    const flushQ = () => { if (quote.length) { out.push(`<blockquote><p>${quote.map(inlineMd).join("<br>")}</p></blockquote>`); quote = []; } };
    const flush = () => { flushP(); flushL(); flushQ(); };
    for (const raw of String(md || "").replace(/\r\n/g, "\n").split("\n")) {
      const t = raw.trim();
      if (!t) { flush(); continue; }
      const im = t.match(IMG_LINE);
      if (im) { flush(); out.push(figureHtml(im[2].toLowerCase(), im[1], im[3] || "", mediaOf)); continue; }
      const hd = t.match(/^(#{1,3})\s+(.*)$/);
      if (hd) { flush(); const n = hd[1].length === 3 ? 3 : 2; out.push(`<h${n}>${inlineMd(hd[2])}</h${n}>`); continue; }
      const ul = t.match(/^[-*]\s+(.*)$/), ol = t.match(/^\d+[.)]\s+(.*)$/);
      if (ul || ol) { flushP(); flushQ(); const kind = ul ? "ul" : "ol"; if (!list || list.kind !== kind) { flushL(); list = { kind, items: [] }; } list.items.push((ul || ol)[1]); continue; }
      const q = t.match(/^>\s?(.*)$/);
      if (q) { flushP(); flushL(); quote.push(q[1]); continue; }
      flushL(); flushQ(); para.push(t);
    }
    flush();
    return out.join("") || "<p><br></p>";
  }
  /** The editor's blocks as the post's markdown. Anything pasted or typed that isn't one of
   *  the post's own kinds of block comes back as plain words. */
  function htmlToMd(root) {
    const inline = (node) => {
      let s = "";
      node.childNodes.forEach((c) => {
        if (c.nodeType === 3) { s += c.nodeValue.replace(/ /g, " "); return; }
        if (c.nodeType !== 1) return;
        const tag = c.tagName;
        if (tag === "BR") { s += "\n"; return; }
        const inner = inline(c);
        if (!inner.trim()) { s += inner; return; }
        if (tag === "STRONG" || tag === "B") s += `**${inner.trim()}**`;
        else if (tag === "EM" || tag === "I") s += `*${inner.trim()}*`;
        else if (tag === "A") { const href = safeHref(c.getAttribute("href")); s += href ? `[${inner.trim()}](${href})` : inner; }
        else s += inner;
      });
      return s;
    };
    const lines = (text) => text.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
    const blocks = [];
    const walk = (parent) => parent.childNodes.forEach((n) => {
      if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) blocks.push(t); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName;
      if (tag === "FIGURE" && n.dataset.media) {
        const alt = String(n.dataset.alt || "").replace(/[\]\n]/g, " ").trim(), cap = String(n.dataset.caption || "").replace(/["\n]/g, " ").trim();
        blocks.push(`![${alt}](media:${n.dataset.media}${cap ? ` "${cap}"` : ""})`); return;
      }
      if (tag === "H1" || tag === "H2") { const t = lines(inline(n)).join(" "); if (t) blocks.push("## " + t); return; }
      if (tag === "H3" || tag === "H4") { const t = lines(inline(n)).join(" "); if (t) blocks.push("### " + t); return; }
      if (tag === "UL" || tag === "OL") { const items = [...n.children].filter((li) => li.tagName === "LI").map((li, i) => (tag === "UL" ? "- " : `${i + 1}. `) + lines(inline(li)).join(" ")).filter((l) => !/^(- |\d+\. )$/.test(l)); if (items.length) blocks.push(items.join("\n")); return; }
      if (tag === "BLOCKQUOTE") { const ls = lines(inline(n)); if (ls.length) blocks.push(ls.map((l) => "> " + l).join("\n")); return; }
      if (tag === "DIV" && [...n.children].some((c) => /^(P|H[1-4]|UL|OL|BLOCKQUOTE|FIGURE|DIV)$/.test(c.tagName))) { walk(n); return; }
      const ls = lines(inline(n)); if (ls.length) blocks.push(ls.join("\n"));
    });
    walk(root);
    return blocks.join("\n\n").slice(0, 20000);
  }

  /* ── the site's clock ── */
  const PART = (d, tz) => { const o = {}; new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).forEach((p) => { o[p.type] = p.value; }); return o; };
  /** "2026-11-18" and "09:00" on the site's clock → the instant, as ISO. */
  function zonedToUtc(day, time, tz) {
    const [y, m, d] = String(day).split("-").map(Number), [hh, mm] = String(time).split(":").map(Number);
    if (![y, m, d, hh, mm].every(Number.isFinite)) return "";
    let guess = Date.UTC(y, m - 1, d, hh, mm);
    for (let i = 0; i < 2; i++) { const p = PART(new Date(guess), tz); const seen = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute); guess += Date.UTC(y, m - 1, d, hh, mm) - seen; }
    return new Date(guess).toISOString();
  }
  /** The instant as the site's day and time: { day: "2026-11-18", time: "09:00" }. */
  function utcToZoned(iso, tz) { const p = PART(new Date(iso), tz); return { day: `${p.year}-${p.month}-${p.day}`, time: `${String(+p.hour % 24).padStart(2, "0")}:${p.minute}` }; }
  const whenWords = (iso, tz) => new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(",", "").replace(/ (\d{1,2}:\d{2}) (AM|PM)$/, (_m, t, ap) => ` at ${t} ${ap.toLowerCase()}`);
  const clockName = (tz) => { try { const n = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName"); return n ? n.value.replace(/ (Standard|Daylight) Time$/, " time") : tz; } catch (_) { return tz; } };
  const slugify = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  const initials = (name) => String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  /* ── the screen ── */
  let OPEN = null;
  function open(post, host) {
    inject();
    if (OPEN) OPEN.close();
    const tz = host.timezone || "America/Los_Angeles";
    const p = { ...post };
    const look = host.look || {};
    const root = h("div", "bs has-card");
    root.setAttribute("role", "dialog"); root.setAttribute("aria-modal", "true"); root.setAttribute("aria-label", "Writing a blog post");
    for (const [k, v] of Object.entries({ bg: look.bg, ink: look.ink, soft: look.soft, accent: look.accent, line: look.line, display: look.display, body: look.body, radius: look.radius })) if (v) root.style.setProperty("--bs-" + k, v);
    const scroll = h("div", "bs-scroll"); root.appendChild(scroll);

    // the pill bar
    const bar = h("div", "bs-bar"); bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Post tools");
    const btn = (cls, html, label) => { const b = h("button", cls); b.type = "button"; b.innerHTML = html; if (label) { b.setAttribute("aria-label", label); b.title = label; } return b; };
    const back = btn("bs-back", icon("back") + "<span>All posts</span>");
    const state = h("span", "bs-state"); state.setAttribute("role", "status"); state.setAttribute("aria-live", "polite");
    const fmt = (cmd, html, label) => { const b = btn("bs-fmt", html, label); b.addEventListener("mousedown", (e) => e.preventDefault()); b.addEventListener("click", () => format(cmd)); return b; };
    const photoBtn = btn("bs-photo", icon("img") + "<span>Photo</span>", "Add a photo from Files");
    const preview = btn("bs-preview", "Preview", "Open the post as it will look, in a new tab");
    const pub = btn("bs-pub", "<span>Publish</span>" + icon("caret", 14));
    pub.setAttribute("aria-haspopup", "menu"); pub.setAttribute("aria-expanded", "false");
    bar.append(back, state, h("span", "bs-sep"), fmt("h2", "<b>H</b>", "Heading"), fmt("bold", "<b>B</b>", "Bold"), fmt("italic", "<i>I</i>", "Italic"), fmt("link", icon("link"), "Link"), fmt("list", icon("list"), "List"), fmt("quote", icon("quote"), "Quote"), photoBtn, h("span", "bs-sep"), preview, pub);
    scroll.appendChild(bar);

    // the post, as it will look
    const art = h("article", "bs-post");
    const kicker = h("p", "bs-kicker");
    const title = h("textarea", "bs-title"); title.rows = 1; title.maxLength = 160; title.placeholder = "Give it a title"; title.setAttribute("aria-label", "Title"); title.value = p.title === "Untitled post" ? "" : (p.title || "");
    const byline = h("p", "bs-byline");
    const cover = h("div", "bs-cover");
    const body = h("div", "bs-body"); body.contentEditable = "true"; body.setAttribute("role", "textbox"); body.setAttribute("aria-multiline", "true"); body.setAttribute("aria-label", "The post"); body.dataset.placeholder = "Start writing. Add a photo from the bar above.";
    body.innerHTML = mdToHtml(p.body_md, host.mediaOf);
    art.append(kicker, title, byline, cover, body);
    scroll.appendChild(art);

    // phone tools
    const tools = h("div", "bs-tools"); tools.setAttribute("role", "toolbar"); tools.setAttribute("aria-label", "Writing tools");
    const tfmt = (cmd, html, label) => { const b = btn("", html, label); b.addEventListener("mousedown", (e) => e.preventDefault()); b.addEventListener("click", () => format(cmd)); return b; };
    const tPhoto = btn("", icon("img", 17), "Add a photo from Files");
    const tSet = btn("bs-set", icon("sliders") + "<span>Settings</span>");
    tools.append(tfmt("h2", "<b>H</b>", "Heading"), tfmt("bold", "<b>B</b>", "Bold"), tfmt("link", icon("link", 17), "Link"), tfmt("list", icon("list", 17), "List"), tPhoto, tSet);
    root.appendChild(tools);

    // the Post settings card
    const card = h("aside", "bs-card"); card.setAttribute("aria-label", "Post settings");
    root.appendChild(card);
    const menu = h("div", "bs-menu"); menu.setAttribute("role", "menu"); menu.hidden = true; root.appendChild(menu);
    document.body.appendChild(root);
    document.documentElement.classList.add("bs-open");   // presence.html steps the app's own bars aside, as Edit mode does
    const phone = () => window.matchMedia("(max-width: 900px)").matches;
    if (phone()) { card.hidden = true; root.classList.remove("has-card"); }

    /* saving: one PATCH at a time, the latest words win */
    let saving = false, again = null, failed = false, liveDirty = false, closed = false;
    const label = () => {
      const dot = (cls) => `<span class="bs-dot${cls ? " " + cls : ""}"></span>`;
      const tail = failed ? "Not saved, try again" : saving || again ? "Saving…" : "Saved";
      if (p.status === "scheduled" && p.published_at) state.innerHTML = dot("sched") + escH(`Scheduled · ${whenWords(p.published_at, tz)}`);
      else if (p.status === "published") state.innerHTML = dot(liveDirty ? "warn" : "") + escH(liveDirty ? `Live · ${tail === "Saved" ? "Edits not on your site yet" : tail}` : "Live");
      else state.innerHTML = dot(failed ? "warn" : "") + escH(`Draft · ${tail}`);
    };
    async function flush() {
      if (!again || saving) return;
      const patch = again; again = null; saving = true; failed = false; label();
      try { const r = await host.api("PATCH", `/posts/${p.id}`, patch); Object.assign(p, r.data || patch); if (p.status === "published" && Object.keys(patch).some((k) => k !== "status" && k !== "published_at")) liveDirty = true; host.onSaved(p); }
      catch (err) { failed = true; again = { ...patch, ...(again || {}) }; host.toast(host.nice(err), true); }
      saving = false; label(); paintByline();
      if (again && !failed) flush();
    }
    let timer = null;
    const queue = (patch, now) => { again = { ...(again || {}), ...patch }; label(); clearTimeout(timer); timer = setTimeout(flush, now ? 0 : 700); };
    const settle = async () => { clearTimeout(timer); await flush(); while (saving) await new Promise((r) => setTimeout(r, 60)); if (again && !failed) await flush(); };
    const grow = () => { title.style.height = "auto"; title.style.height = title.scrollHeight + "px"; };
    title.addEventListener("input", () => { grow(); queue({ title: title.value.trim() || "Untitled post" }); if (!p.published_at && !p._slugTouched) { const s = slugify(title.value); if (s) { p._slugDraft = s; const a = card.querySelector("#bsSlug"); if (a) a.value = s; } } });
    title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); body.focus(); } });
    body.addEventListener("input", () => queue({ body_md: htmlToMd(body) }));
    body.addEventListener("paste", (e) => {
      const text = (e.clipboardData || window.clipboardData).getData("text/plain");
      if (text == null) return;
      e.preventDefault();
      const html = String(text).split(/\n{2,}/).map((part) => `<p>${escH(part).replace(/\n/g, "<br>")}</p>`).join("");
      document.execCommand("insertHTML", false, html);
    });
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (_) { /* older browsers write divs, which save the same */ }

    function format(cmd) {
      body.focus();
      if (cmd === "bold" || cmd === "italic") document.execCommand(cmd);
      else if (cmd === "h2") { const cur = document.queryCommandValue("formatBlock"); document.execCommand("formatBlock", false, /^h2$/i.test(cur) ? "p" : "h2"); }
      else if (cmd === "quote") { const cur = document.queryCommandValue("formatBlock"); document.execCommand("formatBlock", false, /^blockquote$/i.test(cur) ? "p" : "blockquote"); }
      else if (cmd === "list") document.execCommand("insertUnorderedList");
      else if (cmd === "link") {
        const sel = window.getSelection(); const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        host.askText("Link to", { hint: "A web address that starts with https://, or an email or phone link.", placeholder: "https://", ok: "Add the link" }).then((url) => {
          const href = safeHref(url); if (!url) return; if (!href) { host.toast("Use a full address that starts with https://", true); return; }
          body.focus(); if (range) { sel.removeAllRanges(); sel.addRange(range); }
          if (range && !range.collapsed) document.execCommand("createLink", false, href);
          else document.execCommand("insertHTML", false, `<a href="${escH(href)}">${escH(href.replace(/^https:\/\//, ""))}</a>`);
          queue({ body_md: htmlToMd(body) });
        });
        return;
      }
      queue({ body_md: htmlToMd(body) });
    }

    /* photos inside the text */
    let figOn = null;
    const figTools = h("div", "bs-figtools"); figTools.setAttribute("role", "toolbar"); figTools.setAttribute("aria-label", "Photo tools");
    const ft = (t, cls) => { const b = h("button", cls, t); b.type = "button"; figTools.appendChild(b); return b; };
    const fReplace = ft("Replace"), fDesc = ft("Description"), fCap = ft("Caption"), fRm = ft("Remove", "rm");
    const selectFig = (f) => { if (figOn) figOn.classList.remove("on"); figOn = f; if (!f) { figTools.remove(); return; } f.classList.add("on"); f.appendChild(figTools); };
    body.addEventListener("click", (e) => { const f = e.target.closest(".bs-fig"); if (f && !e.target.closest(".bs-figtools")) selectFig(f); else if (!f) selectFig(null); });
    const refreshFig = (f) => { const n = h("div"); n.innerHTML = figureHtml(f.dataset.media, f.dataset.alt, f.dataset.caption, host.mediaOf); const nf = n.firstChild; f.replaceWith(nf); selectFig(nf); queue({ body_md: htmlToMd(body) }); };
    fReplace.addEventListener("click", () => host.openPicker((id) => { if (!id || !figOn) return; const m = host.mediaOf(id) || {}; figOn.dataset.media = id; figOn.dataset.alt = m.alt_text || figOn.dataset.alt || ""; refreshFig(figOn); }));
    fDesc.addEventListener("click", () => { const f = figOn; host.askText("Describe this photo", { hint: "For people who can’t see it, and for Google.", value: f.dataset.alt || "", ok: "Save" }).then((v) => { if (v == null) return; f.dataset.alt = v.trim().slice(0, 200); refreshFig(f); }); });
    fCap.addEventListener("click", () => { const f = figOn; host.askText("A caption under the photo", { hint: "Leave it empty for none.", value: f.dataset.caption || "", ok: "Save" }).then((v) => { if (v == null) return; f.dataset.caption = v.trim().slice(0, 200); refreshFig(f); }); });
    fRm.addEventListener("click", () => { const f = figOn; selectFig(null); if (f) f.remove(); queue({ body_md: htmlToMd(body) }); });
    let lastRange = null;
    document.addEventListener("selectionchange", () => { const s = window.getSelection(); if (s && s.rangeCount && body.contains(s.anchorNode)) lastRange = s.getRangeAt(0).cloneRange(); });
    const addPhoto = () => host.openPicker((id) => {
      if (!id) return;
      const m = host.mediaOf(id) || {};
      const n = h("div"); n.innerHTML = figureHtml(id, m.alt_text || "", "", host.mediaOf);
      const fig = n.firstChild, after = h("p"); after.innerHTML = "<br>";
      let block = lastRange && body.contains(lastRange.startContainer) ? lastRange.startContainer : null;
      while (block && block.parentNode !== body) block = block.parentNode;
      if (block) block.after(fig, after); else body.append(fig, after);
      queue({ body_md: htmlToMd(body) });
      host.toast("Your photo is in the post. Its description comes from Files; change it with Description.");
    });
    photoBtn.addEventListener("click", addPhoto); tPhoto.addEventListener("click", addPhoto);

    /* the cover, byline and kicker */
    function paintCover() {
      cover.innerHTML = ""; cover.classList.toggle("empty", !p.hero_media_id);
      const m = p.hero_media_id ? host.mediaOf(p.hero_media_id) : null;
      if (m && m.thumb) { const img = h("img"); img.src = m.thumb; img.alt = m.alt_text || ""; cover.appendChild(img); }
      const b = h("button", "bs-pill", p.hero_media_id ? "Change cover" : "Add a cover photo"); b.type = "button";
      b.addEventListener("click", () => host.openPicker((id) => { if (id === undefined) return; p.hero_media_id = id || null; paintCover(); queue({ hero_media_id: p.hero_media_id }, true); }));
      cover.appendChild(b);
    }
    function paintByline() {
      const lists = host.lists();
      const cat = lists.categories.find((c) => c.id === p.category), au = lists.authors.find((a) => a.id === p.author);
      kicker.textContent = cat ? cat.name : "";
      byline.innerHTML = "";
      if (au) { const av = h("span", "bs-av"); const m = au.photo_media_id ? host.mediaOf(au.photo_media_id) : null; if (m && m.thumb) { const img = h("img"); img.src = m.thumb; img.alt = ""; av.appendChild(img); } else av.textContent = initials(au.name); av.setAttribute("aria-hidden", "true"); byline.appendChild(av); }
      const when = p.status === "scheduled" && p.published_at ? whenWords(p.published_at, tz) : p.published_at ? new Date(p.published_at).toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }) : "Not published yet";
      byline.appendChild(document.createTextNode((au ? `By ${au.name} · ` : "") + when));
    }

    /* the Post settings card */
    let pickTime = p.status === "scheduled";
    function paintCard() {
      const lists = host.lists();
      const sched = p.status === "scheduled" && p.published_at ? utcToZoned(p.published_at, tz) : utcToZoned(new Date(Date.now() + 86400000).toISOString(), tz);
      const live = p.status === "published";
      const cats = lists.categories.map((c) => `<option value="${escH(c.id)}"${c.id === p.category ? " selected" : ""}>${escH(c.name)}</option>`).join("");
      const aus = lists.authors.map((a) => `<option value="${escH(a.id)}"${a.id === p.author ? " selected" : ""}>${escH(a.name)}</option>`).join("");
      const sum = String(p.excerpt || "");
      card.innerHTML = `
<div class="bs-head"><h2>Post settings</h2><button type="button" class="bs-quiet" data-k="hide">${phone() ? "Done" : "Hide"}</button></div>
${live ? `<div><span class="bs-lbl">It went out</span><p class="bs-hint" style="margin:0">${escH(p.published_at ? new Date(p.published_at).toLocaleString("en-US", { timeZone: tz, dateStyle: "medium", timeStyle: "short" }) : "")}. Publish again from the bar to put your edits on your site.</p></div>` : `
<div><span class="bs-lbl" id="bsWhenL">When it goes out</span>
<div class="bs-seg" role="group" aria-labelledby="bsWhenL"><button type="button" data-k="now" aria-pressed="${!pickTime}">Now</button><button type="button" data-k="pick" aria-pressed="${pickTime}">Pick a day and time</button></div>
<div class="bs-row" style="margin-top:8px"${pickTime ? "" : " hidden"} data-k="whenrow"><input type="date" id="bsDay" aria-label="Day" value="${sched.day}"><input type="time" id="bsTime" aria-label="Time" value="${sched.time}" step="900"></div>
<p class="bs-hint">${pickTime ? `${escH(clockName(tz))}, your business’s clock. It goes on your site by 15 minutes past that time at the latest, even if nobody is signed in.` : "Publish from the bar to put it on your site in about a minute."}</p></div>`}
<div class="bs-two"><div><label for="bsCat">Category</label><select id="bsCat"><option value="">None</option>${cats}</select><button type="button" class="bs-add" data-k="newcat">+ New category</button></div>
<div><label for="bsAu">Written by</label><select id="bsAu"><option value="">Nobody named</option>${aus}</select><button type="button" class="bs-add" data-k="newau">+ Add an author</button></div></div>
<div><label for="bsSum">Summary</label><textarea id="bsSum" maxlength="300" placeholder="One or two sentences about the post">${escH(sum)}</textarea><div class="bs-count" id="bsSumN"></div><p class="bs-hint">Shows on your Updates page, in Google results, and at the top of the email when you send it to your list.</p></div>
<div><label for="bsTags">Tags</label><input type="text" id="bsTags" value="${escH((p.tags || []).join(", "))}" placeholder="events, seasonal"><p class="bs-hint">Separate with commas. Visitors can filter your Updates page by them.</p></div>
<div><label for="bsSlug">Web address</label><input type="text" id="bsSlug" value="${escH(p._slugDraft || p.slug || "")}"${p.published_at ? " readonly" : ""} spellcheck="false"><p class="bs-hint">${escH((host.origin || "") + "/updates/")}… ${p.published_at ? "It stays as it is now, so links to it keep working." : "Set when it first goes live, then it stays, so links to it keep working."}</p></div>
<label class="bs-switch"><input type="checkbox" id="bsGoogle"${p.noindex ? "" : " checked"}> Show this post on Google</label>
${host.canDelete && !host.canDelete() ? "" : `<button type="button" class="bs-danger" data-k="remove">Remove post</button>`}`;
      const $c = (sel) => card.querySelector(sel);
      $c('[data-k="hide"]').addEventListener("click", () => toggleCard(false));
      const sumBox = $c("#bsSum"), sumN = $c("#bsSumN");
      const count = () => { const n = sumBox.value.trim().length; sumN.textContent = `${n} of 160`; sumN.classList.toggle("over", n > 160); };
      count();
      sumBox.addEventListener("input", () => { count(); queue({ excerpt: sumBox.value.trim() }); });
      $c("#bsTags").addEventListener("change", (e) => queue({ tags: host.splitTags(e.target.value) }, true));
      $c("#bsCat").addEventListener("change", (e) => { p.category = e.target.value; paintByline(); queue({ category: p.category }, true); });
      $c("#bsAu").addEventListener("change", (e) => { p.author = e.target.value; paintByline(); queue({ author: p.author }, true); });
      $c("#bsGoogle").addEventListener("change", (e) => queue({ noindex: !e.target.checked }, true));
      const slug = $c("#bsSlug");
      if (!p.published_at) slug.addEventListener("change", () => { const s = slugify(slug.value); slug.value = s; p._slugTouched = true; if (s) queue({ slug: s }, true); });
      $c('[data-k="newcat"]').addEventListener("click", async () => {
        const name = await host.askText("A new category", { hint: "Like News, Recipes or Events. Each category gets its own page on your site.", ok: "Add it" });
        if (!name || !name.trim()) return;
        const made = await host.addCategory(name.trim()); if (!made) return;
        p.category = made.id; paintCard(); paintByline(); queue({ category: made.id }, true);
      });
      $c('[data-k="newau"]').addEventListener("click", async () => {
        const name = await host.askText("Who wrote it?", { hint: "Their name shows on each post they write. Add a line about them in Categories and authors.", ok: "Add" });
        if (!name || !name.trim()) return;
        const made = await host.addAuthor(name.trim()); if (!made) return;
        p.author = made.id; paintCard(); paintByline(); queue({ author: made.id }, true);
      });
      const rm = $c('[data-k="remove"]'); if (rm) rm.addEventListener("click", async () => { await settle(); if (await host.removePost(p)) close(true); });
      if (!live) {
        const seg = (k) => $c(`[data-k="${k}"]`);
        seg("now").addEventListener("click", () => { pickTime = false; paintCard(); });
        seg("pick").addEventListener("click", () => { pickTime = true; paintCard(); setTimeout(() => { const d = $c("#bsDay"); if (d) d.focus(); }, 0); });
        const day = $c("#bsDay"), time = $c("#bsTime");
        const changed = () => { if (p.status === "scheduled") { const iso = zonedToUtc(day.value, time.value, tz); if (iso) schedule(iso); } };
        if (day) { day.addEventListener("change", changed); time.addEventListener("change", changed); }
      }
    }
    function toggleCard(show) {
      const on = show === undefined ? card.hidden : show;
      card.hidden = !on; root.classList.toggle("has-card", on && !phone());
      bar.querySelectorAll(".bs-showcard").forEach((b) => b.remove());
      if (!on && !phone()) { const b = btn("bs-showcard", icon("sliders") + "<span>Settings</span>"); b.addEventListener("click", () => toggleCard(true)); bar.insertBefore(b, preview); }
      if (on) { const f = card.querySelector("select, input, textarea, button"); if (f && phone()) f.focus(); }
    }
    tSet.addEventListener("click", () => toggleCard(true));

    /* Publish, schedule, update, take down */
    function chosenTime() { if (!pickTime) return ""; const d = card.querySelector("#bsDay"), t = card.querySelector("#bsTime"); return d && t ? zonedToUtc(d.value, t.value, tz) : ""; }
    function openMenu() {
      const items = [];
      const when = chosenTime();
      if (p.status === "published") {
        items.push(["update", "Publish my edits", "Your site gets this post as it is now, in about a minute. Nothing else in your draft goes with it.", true]);
        items.push(["unpublish", "Take it off your site", "It goes back to your drafts. You can publish it again any time.", false]);
      } else if (p.status === "scheduled") {
        items.push(["now", "Publish now instead", "It goes on your site in about a minute.", false]);
        items.push(["resched", when && when !== p.published_at ? `Move it to ${whenWords(when, tz)}` : "Change the time", "Pick a new day and time in Post settings.", true]);
        items.push(["cancel", "Cancel the schedule", "It goes back to your drafts.", false]);
      } else if (pickTime) {
        items.push(["sched", when ? `Schedule for ${whenWords(when, tz)}` : "Pick a day and time first", "We put it on your site then, even if nobody is signed in. Change or cancel it any time before.", true, !when]);
        items.push(["now", "Publish now", "It goes on your site in about a minute. Nothing else in your draft goes with it.", false]);
      } else {
        items.push(["now", "Publish now", "It goes on your site in about a minute. Nothing else in your draft goes with it.", true]);
        items.push(["pick", "Pick a day and time", "We put it on your site then, even if nobody is signed in.", false]);
      }
      menu.innerHTML = `<div class="bs-mlbl">${p.status === "published" ? "This post is live" : "Publish"}</div>` + items.map(([k, t, s, lead, off]) => `<button type="button" role="menuitem" data-m="${k}"${lead ? ' class="lead"' : ""}${off ? " disabled" : ""}><strong>${escH(t)}</strong><span>${escH(s)}</span></button>`).join("")
        + (host.siteLive ? "" : `<div class="bs-mnote">Your site isn’t live yet, so the post waits and goes out with your first publish.</div>`);
      const r = pub.getBoundingClientRect();
      menu.style.top = Math.min(window.innerHeight - 40, r.bottom + 8) + "px";
      menu.style.left = Math.max(14, Math.min(window.innerWidth - 14 - Math.min(360, window.innerWidth - 28), r.right - 360)) + "px";
      menu.hidden = false; pub.setAttribute("aria-expanded", "true");
      const first = menu.querySelector("button:not([disabled])"); if (first) first.focus();
    }
    const closeMenu = () => { menu.hidden = true; pub.setAttribute("aria-expanded", "false"); };
    pub.addEventListener("click", () => (menu.hidden ? openMenu() : closeMenu()));
    menu.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.stopPropagation(); closeMenu(); pub.focus(); }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const bs = [...menu.querySelectorAll("button:not([disabled])")]; const i = bs.indexOf(document.activeElement); const n = bs[(i + (e.key === "ArrowDown" ? 1 : bs.length - 1)) % bs.length]; if (n) n.focus(); }
    });
    document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target) && !pub.contains(e.target)) closeMenu(); }, true);
    menu.addEventListener("click", async (e) => {
      const b = e.target.closest("button[data-m]"); if (!b || b.disabled) return;
      const k = b.dataset.m; closeMenu();
      if (k === "pick") { pickTime = true; toggleCard(true); paintCard(); setTimeout(() => { const d = card.querySelector("#bsDay"); if (d) d.focus(); }, 0); return; }
      if (k === "resched") { pickTime = true; toggleCard(true); const when = chosenTime(); if (when && when !== p.published_at) await schedule(when); else setTimeout(() => { const d = card.querySelector("#bsDay"); if (d) d.focus(); }, 0); return; }
      if (k === "sched") { const when = chosenTime(); if (when) await schedule(when); return; }
      if (k === "cancel") { await settle(); try { const r = await host.api("PATCH", `/posts/${p.id}`, { status: "draft" }); Object.assign(p, r.data); pickTime = false; host.onSaved(p); paintCard(); paintByline(); label(); host.toast("Not scheduled any more. It’s a draft again."); } catch (err) { host.toast(host.nice(err), true); } return; }
      if (k === "unpublish") { await settle(); try { const r = await host.api("POST", `/posts/${p.id}/unpublish`); p.status = "draft"; liveDirty = false; host.onSaved(p); paintCard(); paintByline(); label(); host.toast((r.data && r.data.message) || "It’s a draft again."); } catch (err) { host.toast(host.nice(err), true); } return; }
      if (k === "now" || k === "update") await publishNow(k === "update");
    });
    async function schedule(when) {
      await settle();
      try {
        const r = await host.api("PATCH", `/posts/${p.id}`, { status: "scheduled", published_at: when, ...(p._slugDraft && !p.published_at && !p._slugTouched ? { slug: p._slugDraft } : {}) });
        Object.assign(p, r.data); host.onSaved(p); paintCard(); paintByline(); label();
        done("Scheduled", `“${p.title}” goes on your site ${whenWords(p.published_at, tz)}. Once it’s live, Email it to your list appears on its card.`, null);
      } catch (err) { host.toast(host.nice(err), true); }
    }
    async function publishNow(update) {
      await settle();
      if (!p.title || p.title === "Untitled post" || !htmlToMd(body).trim()) { host.toast("Give it a title and write something first.", true); return; }
      pub.disabled = true; const was = pub.innerHTML; pub.innerHTML = "<span>Publishing…</span>";
      try {
        if (!p.published_at && p._slugDraft && !p._slugTouched && p._slugDraft !== p.slug) { const s = await host.api("PATCH", `/posts/${p.id}`, { slug: p._slugDraft }); Object.assign(p, s.data); }
        const r = await host.api("POST", `/posts/${p.id}/publish`);
        const d = r.data || {};
        p.status = "published"; if (!p.published_at) p.published_at = new Date().toISOString();
        liveDirty = false; host.onSaved(p); paintCard(); paintByline(); label();
        if (d.live) done(update ? "Your edits are live" : "Your post is live", `“${p.title}” is on your Updates page.${update ? "" : " Want your customers to hear about it?"}`, d.url || null);
        else host.toast(d.message || "Saved. It goes out with your next publish.");
      } catch (err) { host.toast(host.nice(err), true); }
      pub.disabled = false; pub.innerHTML = was;
    }
    let doneCard = null;
    function done(head, words, url) {
      if (doneCard) doneCard.remove();
      doneCard = h("div", "bs-done"); doneCard.setAttribute("role", "status");
      doneCard.innerHTML = `<button type="button" class="x" aria-label="Close">${icon("x")}</button><h3>${escH(head)}</h3><p>${escH(words)}</p><div class="bs-acts">${url && host.emailHref ? `<a class="go" href="${escH(host.emailHref(p))}">Email it to your list</a><a class="out" href="${escH(url)}" target="_blank" rel="noopener">View it</a>` : ""}</div>`;
      doneCard.querySelector(".x").addEventListener("click", () => { doneCard.remove(); doneCard = null; });
      root.appendChild(doneCard);
      const go = doneCard.querySelector("a.go"); if (go) go.addEventListener("click", async (e) => { e.preventDefault(); await settle(); location.href = go.href; });
    }
    // Preview: the post alone, as a visitor reads it; one button brings the tools back
    const endPv = btn("bs-endpv", "Back to writing");
    preview.addEventListener("click", () => {
      selectFig(null); closeMenu(); root.classList.add("previewing"); body.contentEditable = "false"; title.readOnly = true;
      bar.appendChild(endPv); endPv.focus();
    });
    endPv.addEventListener("click", () => { root.classList.remove("previewing"); body.contentEditable = "true"; title.readOnly = false; endPv.remove(); preview.focus(); });

    /* closing */
    async function close(removed) {
      if (closed) return; closed = true;
      if (!removed) await settle();
      document.removeEventListener("keydown", onKey, true);
      root.remove(); OPEN = null; document.documentElement.classList.remove("bs-open");
      host.onClose(removed ? null : p);
    }
    back.addEventListener("click", () => close(false));
    const onKey = (e) => {
      if (e.key !== "Escape" || !menu.hidden) return;
      if (document.querySelector("dialog[open], .scrim.on")) return;   // an ask box or the photo picker above: it closes itself
      if (figOn) { selectFig(null); return; }
      if (root.classList.contains("previewing")) { endPv.click(); return; }
      if (phone() && !card.hidden) { toggleCard(false); return; }
      close(false);
    };
    document.addEventListener("keydown", onKey, true);

    paintCover(); paintByline(); paintCard(); label();
    setTimeout(() => { grow(); (title.value ? body : title).focus(); }, 0);
    OPEN = { close, post: p, flush: settle };
    return OPEN;
  }
  window.DDSBlogStudio = { open, mdToHtml, htmlToMd, zonedToUtc, utcToZoned, whenWords, slugify, current: () => OPEN };
})();
