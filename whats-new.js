/* What's new (builder list item 128, Nov 2026).
 * Each week's changes to the tools, a picture and a sentence each, newest first, with
 * Show me to go straight there. The entries live in /whats-new.json: each is written once,
 * with a picture taken on sample data, never a client's site, and says what changed for
 * the reader, not how it was built.
 *
 * Who sees what: a studio sees every entry; a business that runs its own site sees the
 * entries that touch a website; a client in the portal sees only the entries written for
 * clients ("New in your portal"), which never name Studio OS or show studio screens.
 * Each entry lists its readers in `who` (studio, owner, client), and may carry a `client`
 * wording of its own.
 *
 * A dot on the button says there is something new since this device last opened the
 * panel. Nothing pops up by itself.
 *
 *   window.DDSWhatsNew.open({ who, opener })   draw the panel; Escape or × closes it
 *   window.DDSWhatsNew.hasNew(who)             a promise: anything this device hasn't seen
 *   window.DDSWhatsNew.entriesFor(data, who)   the entries one reader sees, newest first
 *   window.DDSWhatsNew.weekOf(iso, today)      the Monday-to-Sunday week a day falls in
 */
(function () {
  "use strict";
  const SEEN_KEY = "dds-whats-new-seen";
  const CSS = `
.wn-scrim{position:fixed;inset:0;z-index:2147483000;background:color-mix(in srgb,var(--dds-ink,#171522) 28%,transparent);display:flex;justify-content:flex-end;align-items:stretch;padding:14px}
.wn{width:min(440px,100%);max-height:100%;display:flex;flex-direction:column;background:var(--dds-card,#fff);color:var(--dds-ink,#171522);border-radius:20px;box-shadow:var(--dds-shadow-pop,0 20px 48px -12px rgba(23,21,34,.24));font:14px/1.45 var(--dds-sans,Inter,system-ui,sans-serif);overflow:hidden}
.wn-head{display:flex;align-items:center;gap:10px;padding:18px 18px 4px}
.wn-mark{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:999px;background:var(--dds-p-soft,#f0ebfd);color:var(--dds-p,#6d3fd4);font-size:14px;flex:none}
.wn-head h2{flex:1;margin:0;font:600 20px/1.2 var(--dds-serif,Fraunces,Georgia,serif)}
.wn-x{display:inline-grid;place-items:center;width:40px;height:40px;border:0;border-radius:999px;background:none;color:var(--dds-soft,#55526a);font-size:20px;line-height:1;cursor:pointer}
.wn-x:hover{background:var(--dds-up,#f7f6fb);color:var(--dds-ink,#171522)}
.wn-sub{margin:0;padding:0 18px 10px;color:var(--dds-soft,#55526a);font-size:13px}
.wn-body{overflow:auto;padding:0 18px 18px;-webkit-overflow-scrolling:touch}
.wn-week{margin:14px 0 8px;font:700 11px/1 var(--dds-sans,Inter,sans-serif);letter-spacing:.09em;text-transform:uppercase;color:var(--dds-faint,#69667d)}
.wn-card{border:1px solid var(--dds-line,#e7e6ef);border-radius:14px;padding:10px;margin:0 0 10px}
.wn-pic{display:block;width:100%;height:auto;aspect-ratio:16/9;object-fit:cover;border-radius:10px;background:var(--dds-up,#f7f6fb)}
.wn-card h4{margin:10px 2px 2px;font:600 14.5px/1.3 var(--dds-sans,Inter,sans-serif)}
.wn-card p{margin:0 2px 6px;color:var(--dds-soft,#55526a);font-size:13px}
.wn-go{display:inline-flex;align-items:center;gap:4px;min-height:36px;margin-left:2px;color:var(--dds-p,#6d3fd4);font-weight:600;font-size:12.5px;text-decoration:none}
.wn-go:hover{text-decoration:underline}
.wn-none{color:var(--dds-soft,#55526a);font-size:13px}
.wn-x:focus-visible,.wn-go:focus-visible{outline:2px solid var(--dds-p,#6d3fd4);outline-offset:2px}
@media (max-width:560px){.wn-scrim{padding:0}.wn{width:100%;border-radius:0}}
@media (prefers-reduced-motion:no-preference){.wn{animation:wn-in .18s ease-out}@keyframes wn-in{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:none}}}
`;
  const WORDS = {
    studio: { title: "What’s new", sub: "Changes to your tools, a picture and a sentence each. New ones every week." },
    owner: { title: "What’s new", sub: "Changes to your tools, a picture and a sentence each. New ones every week." },
    client: { title: "New in your portal", sub: "What changed lately, a picture and a sentence each." },
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // Only a link inside the app: a page here, never somewhere else.
  const safeShow = (href) => (typeof href === "string" && /^\/(?!\/)[\w./#?=&%-]*$/.test(href) ? href : "");

  let data = null;
  function load() {
    if (!data) data = fetch("/whats-new.json", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { entries: [] }))
      .catch(() => ({ entries: [] }));
    return data;
  }

  /** The entries one reader sees, in their own words, newest first. Pure. */
  function entriesFor(d, who) {
    const list = (d && Array.isArray(d.entries) ? d.entries : []).filter((e) => e && typeof e.id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || "")) && Array.isArray(e.who) && e.who.includes(who));
    return list.map((e) => {
      // a client reads only words written for clients, and only their own link
      if (who === "client" && !(e.client && typeof e.client === "object")) return null;
      const w = who === "client" ? { ...e, ...e.client, show: e.client.show } : e;
      return { id: e.id, date: e.date, title: String(w.title || ""), sentence: String(w.sentence || ""), picture: String(e.picture || ""), alt: String(w.alt || e.alt || ""), show: safeShow(w.show) };
    }).filter((e) => e && e.title && e.sentence).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayOf = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
  const isoOf = (d) => d.toISOString().slice(0, 10);
  /** The Monday-to-Sunday week a day falls in, and its words: "This week · Nov 9 to 15". Pure. */
  function weekOf(iso, todayIso) {
    const d = dayOf(iso), t = dayOf(todayIso);
    if (!d || !t) return { key: "", label: "" };
    const monday = (x) => { const y = new Date(x); y.setUTCDate(y.getUTCDate() - ((y.getUTCDay() + 6) % 7)); return y; };
    const start = monday(d), end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
    const span = start.getUTCMonth() === end.getUTCMonth()
      ? `${MONTH[start.getUTCMonth()]} ${start.getUTCDate()} to ${end.getUTCDate()}`
      : `${MONTH[start.getUTCMonth()]} ${start.getUTCDate()} to ${MONTH[end.getUTCMonth()]} ${end.getUTCDate()}`;
    const weeks = Math.round((monday(t) - start) / (7 * 86400000));
    const lead = weeks <= 0 ? "This week" : weeks === 1 ? "Last week" : `${weeks} weeks ago`;
    return { key: isoOf(start), label: `${lead} · ${span}` };
  }
  const todayIso = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };

  function seen() { try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
  function markSeen(ids) { try { localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seen(), ...ids])].slice(-200))); } catch (_) { /* private mode: the dot just stays */ } }
  /** Anything this reader hasn't seen on this device. */
  function hasNew(who) { return load().then((d) => { const s = new Set(seen()); return entriesFor(d, who).some((e) => !s.has(e.id)); }); }

  function styles() {
    if (document.getElementById("wn-css")) return;
    const st = document.createElement("style"); st.id = "wn-css"; st.textContent = CSS; document.head.appendChild(st);
  }

  let open_ = null;
  function close() {
    if (!open_) return;
    const { scrim, opener, onKey } = open_;
    open_ = null;
    document.removeEventListener("keydown", onKey, true);
    scrim.remove();
    if (opener && opener.isConnected) opener.focus();
  }

  async function open(opts) {
    const who = (opts && opts.who) || "owner", opener = opts && opts.opener;
    if (open_) close();
    styles();
    const words = WORDS[who] || WORDS.owner;
    const scrim = document.createElement("div"); scrim.className = "wn-scrim";
    scrim.innerHTML = `<section class="wn" role="dialog" aria-modal="true" aria-labelledby="wnH">
<div class="wn-head"><span class="wn-mark" aria-hidden="true">✦</span><h2 id="wnH">${esc(words.title)}</h2><button type="button" class="wn-x" aria-label="Close">×</button></div>
<p class="wn-sub">${esc(words.sub)}</p><div class="wn-body" tabindex="-1"><p class="wn-none">One moment…</p></div></section>`;
    document.body.appendChild(scrim);
    const panel = scrim.querySelector(".wn"), body = scrim.querySelector(".wn-body");
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== "Tab") return;
      const f = [...panel.querySelectorAll("button, a[href], [tabindex='0']")].filter((n) => !n.disabled && n.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    open_ = { scrim, opener, onKey };
    document.addEventListener("keydown", onKey, true);
    scrim.addEventListener("click", (e) => { if (e.target === scrim) close(); });
    scrim.querySelector(".wn-x").addEventListener("click", close);
    scrim.querySelector(".wn-x").focus();

    const list = entriesFor(await load(), who);
    if (!open_ || open_.scrim !== scrim) return;   // closed while it loaded
    if (!list.length) { body.innerHTML = `<p class="wn-none">Nothing new yet. Changes show here as they arrive.</p>`; return; }
    const today = todayIso();
    let html = "", week = "";
    for (const e of list) {
      const w = weekOf(e.date, today);
      if (w.key !== week) { week = w.key; html += `<h3 class="wn-week">${esc(w.label)}</h3>`; }
      html += `<article class="wn-card" data-id="${esc(e.id)}">${e.picture ? `<img class="wn-pic" src="${esc(e.picture)}" alt="${esc(e.alt)}" loading="lazy" width="640" height="360">` : ""}<h4>${esc(e.title)}</h4><p>${esc(e.sentence)}</p>${e.show ? `<a class="wn-go" href="${esc(e.show)}">Show me <span aria-hidden="true">→</span></a>` : ""}</article>`;
    }
    body.innerHTML = html;
    markSeen(list.map((e) => e.id));
    if (opts && typeof opts.onSeen === "function") opts.onSeen();
  }

  window.DDSWhatsNew = { open, close, hasNew, entriesFor, weekOf, load };
})();
