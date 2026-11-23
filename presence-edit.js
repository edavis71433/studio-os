// ── The website editor's Edit mode (builder item 38) ────────────────────────────
// Loaded by presence-core.js the first time Edit mode is wanted, or once the page has settled.
// It runs in the same global scope as presence-core.js, after it: everything there is already
// defined. Its functions replace the stand-ins presence-core.js keeps for them, and its own
// set-up below (the canvas's frame, the panels' buttons, the keys) runs as it loads.
// One own page's stored settings, changed in one write (undefined takes a setting off).
// Item 121: the page a broken link shows: one of the owner's own pages (slug), or none (""), the
// ready-made page. One save marks that page and clears the mark from every other.
function pgSetNotFound(slug) {
  return pgTurn(async () => {
    if (!(await dcSavePendingEdits())) return false;
    const build = () => ({ pages: dcPagesArr().map((x) => { const nx = { ...x }; if (slug && x.slug === slug) nx.notFound = true; else delete nx.notFound; return nx; }) });
    try {
      await settingsPut(build); renderPagesBar(); scheduleChangesRefresh();
      toast(slug ? "Broken links will show “" + ((dcPageObj(slug) || {}).title || slug) + "”. Publish to apply." : "Broken links will show the ready-made page. Publish to apply.");
      return true;
    } catch (err) { toast(nice(err), true); return false; }
  });
}
function mountEditCards() {
  if (EDIT_CARDS) return;
  EDIT_CARDS = true;
  remountInPlace("designCard", mountDesignCard);
}
// The section's Style tab, opened from "Pick colours": the faint pair is said first, and each
// background from the site's colours shows how well the words read on it.
function ueFaintFor(idx) { const f = UE.faint; return f && f.slug === DC_PAGE && f.bi === idx ? f : null; }
function ueFaintBanner(idx, st) {
  const f = ueFaintFor(idx); if (!f) return null;
  const fg = st.text_color || f.fg, bg = st.bg_color || f.bg;
  let r = 0; try { r = ovContrast(fg, bg); } catch (_) { return null; }
  const ok = r + 0.005 >= f.min;
  const box = el("div", "ue-faint" + (ok ? " ok" : "")); box.setAttribute("role", "status");
  box.appendChild(el("b", null, ok ? "These words read easily now" : "These words are too faint on this background"));
  box.appendChild(el("span", null, r.toFixed(1) + " to 1 now." + (ok ? "" : " Any background below with a tick reads easily.")));
  return box;
}
function ueRateSwatches(idx, st, row, shades) {
  const f = ueFaintFor(idx); if (!f || !row) return;
  const fg = st.text_color || f.fg;
  row.classList.add("ue-rated");
  shades.forEach((hex, i) => {
    const b = row.children[i + 1]; if (!b) return;
    let r = 0; try { r = ovContrast(fg, hex); } catch (_) { return; }
    const ok = r + 0.005 >= f.min;
    b.dataset.ratio = r.toFixed(1) + (ok ? " ✓" : ""); b.dataset.ok = ok ? "1" : "0";
    b.setAttribute("aria-label", b.getAttribute("aria-label") + ", " + r.toFixed(1) + " to 1, " + (ok ? "easy to read" : "too faint"));
  });
}
// Item 84: one read of the template list for the gallery and the Template card (each read it
// at start-up). Setting LOOKS back to null, as a template change does, reads it again.
let LOOKS_READ = null;
function loadLooks() {
  if (LOOKS) return Promise.resolve(LOOKS);
  if (!LOOKS_READ) LOOKS_READ = api("GET", "/site/templates").then((r) => (LOOKS = r.data)).finally(() => { LOOKS_READ = null; });
  return LOOKS_READ;
}
// PT-2C: each family's visual signature for the preview cards. Unknown/future
// families fall back to a neutral swatch derived from the platform accent.
const LOOK_SWATCH = {
  "business-classic": { bg: "#f7f7f5", ink: "#1c2430", accent: "#23635a", font: "system-ui,-apple-system,sans-serif", tag: "Modern · clean cards" },
  "restaurant-classic": { bg: "#fbf7f0", ink: "#2a2018", accent: "#9c4a2f", font: "Georgia,'Times New Roman',serif", tag: "Warm · hospitality" },
  "editorial": { bg: "#f6f3ec", ink: "#1a1a1c", accent: "#6d232a", font: "'Iowan Old Style',Palatino,Georgia,serif", tag: "Editorial · print serif" },
};
function lookSwatch(slug) { return LOOK_SWATCH[slug] || { bg: "#f2f0f5", ink: "#2a2536", accent: "#5b3fa0", font: "system-ui,sans-serif", tag: "Template family" }; }
// Edit mode's Preview is the same screen, on the page being edited, with what was just typed.
async function dcOpenPreview() {
  if (IPE) ipeCommit();
  if (!(await dcSavePendingEdits())) return;
  PV.page = dcPagePath();
  await openPreview("draft");
}
// Item 85: Hide or a move from the canvas also drew the page into the Preview screen,
// hidden behind Edit mode: two full renders for one Hide. Opening Preview draws it anyway.
function previewIfOpen() { if ($("stage") && $("stage").classList.contains("on")) loadPreview(); }
// The sid / render key for one BLOCKS_WORK index (tray badges, Hide fallback) —
// the same sidecar, read in the other direction.
function ddsSidFor(bi) {
  const meta = ddsMetaFor(DC_PAGE || "") || [];
  for (let i = 0; i < meta.length; i++) if (meta[i] && meta[i].src_index === bi) return meta[i].sid;
  return null;
}
function ddsKeyFor(bi) {
  const meta = ddsMetaFor(DC_PAGE || "") || [];
  for (let i = 0; i < meta.length; i++) if (meta[i] && meta[i].src_index === bi) return meta[i].key;
  return null;
}
function eeEditCore(view) {                      // open the core-section tab
  closePreview();
  const v = view || "design";
  if (v === "design") { go("design"); if (typeof openSettingsPanel === "function") openSettingsPanel("styles"); return; }
  // Builder item 314: the tab's own form opens in a card beside the page; the editor is never left.
  if ($("view-design").classList.contains("on") && dcHostView(v)) return;
  go(v);
  toastAction(`You’re on the ${eeTabWord(view)} tab.`, "Back to your page", () => go("design"), 10000);
}
// The tab's form, moved into the settings panel while the card is open and put back where it
// was when the card closes. Its fields keep their ids, so every save and Undo works as on its tab.
let HOSTED_VIEW = null;
function dcHostView(view) {
  const node = $("view-" + view), p = $("settingsPanel"), scroll = p && p.querySelector(".dc-panel-scroll"); if (!node || !scroll) return false;
  dcUnhostView();
  HOSTED_VIEW = { node, parent: node.parentNode, next: node.nextSibling, view };
  openSettingsPanel("core", eeTabWord(view));
  node.classList.add("dc-hosted"); scroll.prepend(node); scroll.scrollTop = 0;
  if (view === "updates" && typeof renderPosts === "function") renderPosts();
  return true;
}
function dcUnhostView() {
  const h = HOSTED_VIEW; if (!h) return; HOSTED_VIEW = null;
  if (document.activeElement && h.node.contains(document.activeElement)) document.activeElement.blur();   // a field saves on change
  h.node.classList.remove("dc-hosted");
  if (h.parent) h.parent.insertBefore(h.node, h.next && h.next.parentNode === h.parent ? h.next : null);
}
function eeTabWord(view) {                       // the tab's own label, which follows the site's vocabulary (Menu/Services)
  const b = $("nav") && $("nav").querySelector(`[data-view="${view}"]`);
  return b ? b.textContent : "Business";
}
// A double-click never leaves Edit mode by surprise. A core section's words live on
// another tab until core sections move onto the canvas, so say where and offer the way.
let EE_CORE_TOAST = null;
// Item 314: on a built-in page an unstamped section's words are that page's (About's, the FAQ's).
function dcCoreView(c) { const bp = dcBuiltinPage(); return bp && !c.key ? bp.view : c.view; }
function eeDoubleClickTarget(secEl) {
  const c = eeClassify(secEl); c.view = dcCoreView(c);
  if (c.kind === "block") { eeEditBlock(c.bi); return; }
  if (c.view === "design") { eeEditCore(c.view); return; }
  if (EE_CORE_TOAST) EE_CORE_TOAST.remove();
  EE_CORE_TOAST = toastAction(`These words come from your ${eeTabWord(c.view)} tab.`, "Edit them there", () => eeEditCore(c.view), 8000);   // the name, tagline and About text can be typed right here (ideStart)
}
function eeHideKey(key) {                        // reuse the sections-visibility machinery
  if (!key) return;
  Promise.resolve(saveSections(() => (S.settings && S.settings.sections_order) || [], () => [...new Set([...sectionsHiddenNow(), key])])).then(previewIfOpen);
}

/* ── Slice B (builder redesign §2.2b, AC-5): the Page Information menu — ONE
   place for everything about this page/site. Deep-links, not rebuilds: every
   entry calls machinery that already exists (openRitual, shareDraftLink/G6, the
   G10 offline routes, the G7 page operations via dcPageMenuItems, the Business
   search-field builders, openPreview). Hard move (Eric, 2026-07-16): Share draft
   left the dc-bar, the offline ACTION left History (History keeps a read-only
   status line), and per-page search fields for pages you build left Business. ── */
let PI_OPEN = null;
function dcRelTime(iso) {
  const t = Date.parse(iso || ""); if (!Number.isFinite(t)) return "";
  // floor, not round: "1 hour ago" must not become "2 hours ago" at 90 minutes,
  // and an edit made this morning must not read "yesterday" at 23.5 hours.
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function closePageInfoMenu(refocus) {
  if (!PI_OPEN) return;
  document.removeEventListener("mousedown", PI_OPEN.onDown, true);
  document.removeEventListener("keydown", PI_OPEN.onKey, true);
  PI_OPEN.menu.remove(); PI_OPEN = null;
  const b = $("btnPageInfo");
  if (b) { b.setAttribute("aria-expanded", "false"); if (refocus !== false) { try { b.focus(); } catch (_) {} } }
}
function togglePageInfoMenu() {
  if (PI_OPEN) { closePageInfoMenu(); return; }
  const btn = $("btnPageInfo"); if (!btn) return;
  const m = el("div", "pp-pop pi-pop"); m.id = "pageInfoMenu"; m.setAttribute("role", "menu"); m.setAttribute("aria-label", "Page information");
  // 1. passive provenance — only when the data exists (it rides 409s; the guard
  //    itself stays optimistic_lock — this SHOWS who moved the draft, no lock UI)
  const lc = S.lastChange || null;
  if (lc && (lc.actor_kind || lc.at)) {
    const when = lc.at ? dcRelTime(lc.at) : "";
    const provText = "Last edit: " + lcWho(lc) + (when ? " · " + when : "");
    // a role=menu may only contain menuitems — the passive line rides the menu's
    // accessible NAME instead, and the visual div is hidden from the tree.
    m.setAttribute("aria-label", "Page information — " + provText);
    const prov = el("div", "pi-prov", provText); prov.setAttribute("aria-hidden", "true");
    m.appendChild(prov);
  }
  const mi = (label, fn, opts) => {
    const b = el("button", "pp-pop-item" + (opts && opts.danger ? " danger" : ""), label);
    b.type = "button"; b.setAttribute("role", "menuitem");
    if (opts && opts.id) b.id = opts.id;
    if (opts && opts.title) b.title = opts.title;
    b.addEventListener("click", () => { closePageInfoMenu(); fn(); });
    m.appendChild(b); return b;
  };
  mi("Publish now…", () => openRitual(), { id: "piPublishNow", title: "Review every change, then put it live — the same door as the Publish button" });
  mi("Publish later / scheduled changes…", () => openRitual({ schedule: true }), { id: "piPublishLater", title: "Pick a time — your changes go live on their own; see or cancel anything already scheduled" });
  mi("Share a draft link…", () => shareDraftLink(), { id: "piShareDraft", title: "Copy a private, expiring link to this draft — no sign-in needed to view" });
  mi(onAPhone() ? "Open in my browser…" : "Open on my phone…", () => openOnPhone(), { id: "piOnPhone", title: "See this draft on your phone, the way a visitor would: a code its camera opens, for the same private link" });
  // Take offline / bring back (G10) — state from the SAME /preview/status
  // History uses, cached in S.previewStatus so reopens paint instantly, then
  // revalidated in the background. A fetch failure must NOT hide the item —
  // after the hard move this menu is the action's ONLY home; it degrades to a
  // disabled, honest label instead. Never-published sites hide it (nothing to
  // take offline), and revalidation can bring it back.
  let offAction = null;
  const offBtn = mi("Take offline / bring back…", () => { if (offAction) offAction(); }, { id: "piOffline" });
  offBtn.dataset.needs = "configure";
  offBtn.disabled = true;
  const setOffState = (live) => {
    if (!PI_OPEN || PI_OPEN.menu !== m) return;
    if (!live || !live.published) { offBtn.hidden = true; return; }
    offBtn.hidden = false; offBtn.disabled = false;
    if (live.offline_since) { offBtn.textContent = "Bring back online"; offBtn.classList.remove("danger"); offAction = siteBringOnline; }
    else { offBtn.textContent = "Take site offline…"; offBtn.classList.add("danger"); offAction = siteTakeOffline; }
  };
  if (S.previewStatus) setOffState(S.previewStatus.live);
  api("GET", "/preview/status")
    .then((r) => { S.previewStatus = r.data || null; setOffState(r.data && r.data.live); })
    .catch(() => { if (PI_OPEN && PI_OPEN.menu === m && offBtn.disabled && !offBtn.hidden) offBtn.textContent = "Offline controls — couldn’t check just now"; });
  // Page properties — the SAME items (and functions) the ⋯ menus offer, for the
  // page open on the canvas. The ⋯ on pills/tree rows stays (it acts on ANY page).
  const propLabel = () => "Page properties: " + dcPageTitle(DC_PAGE) + " ";
  const propBtn = el("button", "pp-pop-item", propLabel() + "▸");
  propBtn.type = "button"; propBtn.id = "piPageProps"; propBtn.setAttribute("role", "menuitem"); propBtn.setAttribute("aria-expanded", "false");
  const grp = el("div", "pi-grp"); grp.hidden = true;
  dcPageMenuItems(DC_PAGE, () => closePageInfoMenu()).forEach((b2) => { b2.setAttribute("role", "menuitem"); grp.appendChild(b2); });
  propBtn.addEventListener("click", () => {
    grp.hidden = !grp.hidden;
    propBtn.setAttribute("aria-expanded", String(!grp.hidden));
    propBtn.textContent = propLabel() + (grp.hidden ? "▸" : "▾");
  });
  m.appendChild(propBtn); m.appendChild(grp);
  mi("Page settings…", () => pgOpenSettings({ href: dcPagePath() }), { id: "piSearchShare", title: "This page’s name, address, place in the menu and how it shows on Google" });
  mi("Usable by everyone…", () => openUsable(), { id: "piUsable", title: "Check the draft for photos without a description, faint words and buttons that only say “Click here”" });
  document.body.appendChild(m);
  // ≤760px: the bottom-sheet presentation the slide-over panels already use
  if (window.matchMedia && window.matchMedia("(max-width:760px)").matches) {
    m.classList.add("sheet");
  } else {
    const r = btn.getBoundingClientRect(), mh = m.offsetHeight || 0;
    m.style.top = (r.bottom + 6 + mh > window.innerHeight - 8 ? Math.max(8, r.top - 6 - mh) : r.bottom + 6) + "px";   // the button sits low in the Pages card: open upward
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 12)) + "px";
  }
  btn.setAttribute("aria-expanded", "true");
  const onDown = (e) => { if (!m.contains(e.target) && !btn.contains(e.target)) closePageInfoMenu(false); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); closePageInfoMenu(); return; }
    if (e.key === "Tab") { closePageInfoMenu(false); return; }   // menu convention: Tab leaves — close, let focus move on
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Home" || e.key === "End") {
      const items = Array.from(m.querySelectorAll('[role="menuitem"]')).filter((it) => !it.disabled && !it.hidden && it.offsetParent !== null);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement);
      const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
        : e.key === "ArrowDown" ? (i < 0 ? 0 : (i + 1) % items.length)
        : (i <= 0 ? items.length - 1 : i - 1);
      items[next].focus();
    }
  };
  document.addEventListener("mousedown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  PI_OPEN = { menu: m, onDown, onKey };
  setTimeout(() => { try { const f = m.querySelector(".pp-pop-item:not(:disabled)"); if (f) f.focus(); } catch (_) {} }, 20);
}
/* ── G11: per-section review comments — the operator side of the feedback loop.
   Toggle Comments → per-section count badges appear in the Content tree
   tray; click one to read the thread (newest first), reply, resolve, or remove.
   The client's notes arrive through the shared-draft link (Share draft): the
   /p/s/:token page carries a "Leave feedback" panel keyed by the SAME stable
   section ids, so both sides of the conversation land in the same threads. ── */
let CM_ON = false, CM_THREADS = null, CM_BUSY = false, CM_PENDING = null;
// G13: the stable section ids come from the SERVER (the /settings section_meta
// sidecar via ddsSidFor / ddsMetaFor, and the canvas' data-dds-sid stamps) —
// the old client mirror of lib/section_comments.ts is retired.
function cmThreadFor(slug, bid) { const s = slug || "", b = bid || ""; return (CM_THREADS || []).find((t) => t.page_slug === s && t.block_id === b) || null; }
function cmOpenFor(slug, bid) { const t = cmThreadFor(slug, bid); return t ? t.open_count : 0; }
function cmTotalOpen() { return (CM_THREADS || []).reduce((n, t) => n + t.open_count, 0); }
async function cmLoad() { CM_THREADS = (((await api("GET", "/comments")).data || {}).threads) || []; }
function cmSyncButton() {
  const b = $("btnComments"); if (!b) return;
  const n = CM_ON ? cmTotalOpen() : 0;
  // The label (and its open-note count) only — the segment button's on/aria-pressed
  // state has exactly ONE writer, dcModeSync, so the two can never disagree.
  (b.querySelector(".dc-dk-l") || b).textContent = "Notes" + (CM_ON && n ? " (" + n + ")" : "");
}
function cmToggle() {
  if (CM_BUSY) return CM_PENDING;   // a load is already in flight — join it, never a silent no-op
  if (CM_ON) { CM_ON = false; CM_THREADS = null; cmSyncButton(); closeCommentsPanel(); dcRefreshTree(); return; }
  CM_BUSY = true;
  const b = $("btnComments"); if (b) (b.querySelector(".dc-dk-l") || b).textContent = "Loading…";
  CM_PENDING = (async () => {
    try {
      await cmLoad(); CM_ON = true;
      dcRefreshTree();   // item 99: the Contents list drops its move, settings and remove buttons while Notes is on (the off path redraws it too)
      if (DC_MODE === "comments") cmRenderList();   // builder item 284: the Notes card …unless the user already moved on mid-load
    } catch (err) { toast(nice(err), true); }
    CM_BUSY = false; CM_PENDING = null; cmSyncButton();
  })();
  return CM_PENDING;
}
// The count badge on a tray row: always visible when a thread has open notes;
// a quiet hover affordance otherwise, so a thread can be STARTED anywhere.
function cmBadge(slug, bid, name) {
  const n = cmOpenFor(slug, bid);
  const t = cmThreadFor(slug, bid);
  const btn = el("button", "cm-badge" + (n ? "" : " zero"), n ? String(n) : undefined);
  if (!n) btn.innerHTML = uiIcon("message", 13);
  btn.type = "button";
  btn.title = n ? (n === 1 ? "1 open note here — read & reply" : n + " open notes here — read & reply")
    : (t && t.comments.length ? "Resolved notes here — read them" : "Leave a note here");
  btn.setAttribute("aria-label", "Comments: " + name);
  btn.addEventListener("click", (e) => { e.stopPropagation(); openCommentsThread(slug, bid, name); });
  return btn;
}
// The thread panel — a right slide-over like Design settings, but WITHOUT a
// scrim so the tray (and its badges) stays reachable while reading threads.
function closeCommentsPanel() {
  const p = $("commentsPanel"); if (!p) return;
  p.classList.remove("on"); p.setAttribute("aria-hidden", "true");
}
// Builder item 284: the Notes button lit up and opened nothing you could see (the Layers list
// grew badges, and the button stayed lit after Escape). Now it opens a Notes card: the whole
// page and every section, each with its open count or "Leave a note", and the words "No notes
// yet. Click a section to leave one" while there are none. A section's row, or the section on
// the page, opens its thread; the thread's Close comes back to this list; the card's Close
// and Escape leave Notes mode (closeDesignPanels).
let CM_VIEW = "list";   // what the comments card shows: the list, or one thread
function dcBlockName(bi) {
  const b = (BLOCKS_WORK || [])[bi]; if (!b) return "Section";
  const def = (typeof BLOCK_DEFS !== "undefined" ? BLOCK_DEFS : []).find((x) => x.type === b.type);
  return (def && def.name) || b.type || "Section";
}
function cmRenderList() {
  const p = $("commentsPanel"), host = $("cmPanelBody"); if (!p || !host) return;
  closeSettingsPanel(); closePagesCard(false); closeTrayPanel();
  if (!p.classList.contains("on")) PANEL_LASTFOCUS = document.activeElement;
  CM_VIEW = "list";
  const tt = $("cmPanelTitle"); if (tt) tt.textContent = "Notes";
  host.textContent = "";
  const wrap = el("div"); wrap.style.cssText = "padding:12px 14px 22px";
  const rows = [[DC_PAGE, "", "Whole page — " + dcPageTitle(DC_PAGE)]];
  const doc = dcFrameDoc(), main = doc && doc.getElementById("main");
  if (main) dcBlockSections(main).forEach(({ el: sec, bi }) => { const sid = (sec.getAttribute && sec.getAttribute("data-dds-sid")) || ddsSidFor(bi); if (sid) rows.push([DC_PAGE, sid, dcBlockName(bi)]); });
  const open = cmTotalOpen();
  wrap.appendChild(el("div", "cm-empty", open ? (open === 1 ? "1 open note on this draft." : open + " open notes on this draft.") + " Click a section to read or add to its notes." : "No notes yet. Click a section to leave one."));
  const list = el("div", "cm-list"); list.setAttribute("role", "list");
  rows.forEach(([slug, bid, name]) => {
    const r = el("div", "cm-row"); r.setAttribute("role", "listitem");
    const b = el("button", "cm-row-n", name); b.type = "button"; b.addEventListener("click", () => openCommentsThread(slug, bid, name));
    r.appendChild(b); r.appendChild(cmBadge(slug, bid, name));
    list.appendChild(r);
  });
  wrap.appendChild(list);
  host.appendChild(wrap);
  p.classList.add("on"); p.setAttribute("aria-hidden", "false");
  setTimeout(() => { try { $("btnCommentsClose").focus(); } catch (_) {} }, 40);
}
function openCommentsThread(slug, bid, name) {
  const p = $("commentsPanel"); if (!p) return;
  closeSettingsPanel(); closePagesCard(false);
  CM_VIEW = "thread";
  if (!p.classList.contains("on")) PANEL_LASTFOCUS = document.activeElement;
  const tt = $("cmPanelTitle"); if (tt) tt.textContent = name;
  cmRenderThread(slug, bid, name);
  p.classList.add("on"); p.setAttribute("aria-hidden", "false");
  setTimeout(() => { try { $("btnCommentsClose").focus(); } catch (_) {} }, 40);
}
// Item 159: a thread shows its open notes, its done ones, or all; Open first while any is open.
let CM_FILTER = null;   // null = choose by the thread: open when it has any, else all
// one picture a note, made small in the browser first (the same as the client's panel)
function cmShrink(file) {
  return new Promise((resolve, reject) => {
    if (!file || !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) { reject(new Error("Choose a photo or a screenshot (JPEG, PNG or WebP).")); return; }
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * k)), h = Math.max(1, Math.round(img.height * k));
      const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(u); resolve({ data: c.toDataURL("image/jpeg", 0.85), w, h });
    };
    img.onerror = () => { URL.revokeObjectURL(u); reject(new Error("That picture couldn’t be read.")); };
    img.src = u;
  });
}
function cmRenderThread(slug, bid, name) {
  const host = $("cmPanelBody"); if (!host) return;
  host.textContent = "";
  const t = cmThreadFor(slug, bid);
  const wrap = el("div"); wrap.style.cssText = "padding:12px 14px 22px";
  wrap.appendChild(el("div", "hint", (bid ? "Notes on this section" : "Notes on the whole page") + " · " + (slug ? "/" + slug + "/" : "home page")));
  if (!t || !t.comments.length) {
    wrap.appendChild(el("div", "cm-empty", "No notes here yet. Write the first one below — and when you share the draft link, your client's feedback lands right here, section by section."));
  } else {
    if (t.open_count > 0) {
      const res = el("button", "cm-resolveall", "✓ Resolve this thread (" + t.open_count + ")"); res.type = "button";
      res.addEventListener("click", () => cmResolveThread(slug, bid, name));
      wrap.appendChild(res);
    }
    const done = t.comments.length - t.open_count;
    const show = CM_FILTER || (t.open_count ? "open" : "all");
    const seg = el("div", "cm-filter"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Show notes");
    [["open", "Open (" + t.open_count + ")"], ["done", "Done (" + done + ")"], ["all", "All"]].forEach(([k, label]) => {
      const b = el("button", null, label); b.type = "button"; b.dataset.cmFilter = k; b.setAttribute("aria-pressed", String(show === k));
      b.addEventListener("click", () => { CM_FILTER = k; cmRenderThread(slug, bid, name); const nb = $("cmPanelBody").querySelector('[data-cm-filter="' + k + '"]'); if (nb) nb.focus(); });
      seg.appendChild(b);
    });
    wrap.appendChild(seg);
    const shown = t.comments.filter((c) => show === "all" || (show === "open" ? c.status === "open" : c.status === "resolved"));
    if (!shown.length) wrap.appendChild(el("div", "cm-none", show === "open" ? "Nothing open here. Every note is done." : "No notes are done here yet."));
    shown.forEach((c) => wrap.appendChild(cmItem(c, slug, bid, name)));   // already newest-first from the server
  }
  const ta = el("textarea", "cm-reply"); ta.maxLength = 2000;
  ta.placeholder = t && t.comments.length ? "Write a reply…" : "Write a note…";
  ta.setAttribute("aria-label", "Your note");
  wrap.appendChild(ta);
  // item 159: a picture with the note (a screenshot of what you mean)
  let pic = null;
  const att = el("label", "cm-attach"); att.appendChild(document.createTextNode("Add a screenshot or photo"));
  const fin = el("input"); fin.type = "file"; fin.accept = "image/*"; att.appendChild(fin);
  const thumb = el("div", "cm-thumb"); thumb.hidden = true;
  fin.addEventListener("change", async () => {
    const f = fin.files && fin.files[0]; fin.value = ""; if (!f) return;
    try {
      pic = await cmShrink(f);
      thumb.textContent = ""; thumb.hidden = false; att.hidden = true;
      const im = el("img"); im.src = pic.data; im.alt = "The picture going with this note"; thumb.appendChild(im);
      const rm = el("button", null, "Remove"); rm.type = "button";
      rm.addEventListener("click", () => { pic = null; thumb.hidden = true; thumb.textContent = ""; att.hidden = false; });
      thumb.appendChild(rm);
    } catch (err) { toast(nice(err), true); }
  });
  wrap.append(att, thumb);
  const sendLabel = t && t.comments.length ? "Reply" : "Add note";
  const send = el("button", "cm-send", sendLabel); send.type = "button";
  send.addEventListener("click", async () => {
    const body = ta.value.trim(); if (!body) { toast("Write a note first.", true); return; }
    send.disabled = true; send.textContent = "Sending…";
    const msg = { page_slug: slug || "", block_id: bid || "", body };
    if (pic) Object.assign(msg, { image: pic.data, w: pic.w, h: pic.h });
    try { await api("POST", "/comments", msg); CM_FILTER = null; await cmLoad(); cmSyncButton(); dcRefreshTree(); cmRenderThread(slug, bid, name); }
    catch (err) { send.disabled = false; send.textContent = sendLabel; toast(nice(err), true); }
  });
  wrap.appendChild(send);
  host.appendChild(wrap);
}
function cmItem(c, slug, bid, name) {
  const it = el("div", "cm-item" + (c.status === "resolved" ? " resolved" : ""));
  const who = el("div", "cm-who");
  who.appendChild(el("span", "cm-k" + (c.author_kind === "client" ? " client" : ""), c.author_kind === "client" ? "Client" : "You"));
  if (c.author_kind === "client" && c.author_name) who.appendChild(el("span", "cm-name", c.author_name));   // item 159: the name they gave
  who.appendChild(el("span", null, new Date(c.created_at).toLocaleString()));
  if (c.status === "resolved") who.appendChild(el("span", null, "· resolved"));
  it.appendChild(who);
  it.appendChild(el("div", "cm-body", c.body));   // textContent — never markup
  if (c.picture && c.picture.url) {   // item 159: the note's picture, a link that lasts ten minutes
    const a = el("a", "cm-pic"); a.href = c.picture.url; a.target = "_blank"; a.rel = "noopener";
    a.title = "Open the picture full size";
    const im = el("img"); im.src = c.picture.url; im.alt = "Picture sent with this note"; im.loading = "lazy";
    if (c.picture.w && c.picture.h) { im.width = c.picture.w; im.height = c.picture.h; }
    a.appendChild(im); it.appendChild(a);
  }
  const acts = el("div", "cm-itemacts");
  if (c.status === "open") {
    const r = el("button", null, "Resolve"); r.type = "button";
    r.addEventListener("click", () => cmAct("/comments/" + c.id + "/resolve", slug, bid, name, "Resolved."));
    acts.appendChild(r);
  }
  const d = el("button", null, "Remove"); d.dataset.needs = "delete"; d.type = "button";
  d.addEventListener("click", () => cmAct("/comments/" + c.id + "/delete", slug, bid, name, "Removed."));
  acts.appendChild(d);
  it.appendChild(acts);
  return it;
}
async function cmAct(path, slug, bid, name, okMsg) {
  try { await api("POST", path, {}); await cmLoad(); cmSyncButton(); dcRefreshTree(); cmRenderThread(slug, bid, name); toast(okMsg); }
  catch (err) { toast(nice(err), true); }
}
async function cmResolveThread(slug, bid, name) {
  const t = cmThreadFor(slug, bid); if (!t) return;
  try {
    for (const c of t.comments.filter((x) => x.status === "open")) await api("POST", "/comments/" + c.id + "/resolve", {});
    await cmLoad(); cmSyncButton(); dcRefreshTree(); cmRenderThread(slug, bid, name);
    toast("Thread resolved.");
  } catch (err) { toast(nice(err), true); }
}
// Threads whose section was later REMOVED from the page still surface (never
// silently lost) — one calm row per orphaned thread at the end of the tray.
function cmOrphanRows(host, main) {
  if (!CM_ON) return;
  // G13: LIVE section ids = the canvas DOM's stamped sids (the same render truth
  // the badges key new threads by) UNIONed with the sidecar's stored-list sids.
  // The DOM term keeps a resolve-divergent page honest (its rendered #N sids
  // aren't in the sidecar); the sidecar term keeps a windowed-out or render-
  // dropped section — still in the stored list, still editable — from surfacing
  // as "removed", and covers a stampless stale render. Residual divergence: a
  // thread keyed by a STORED-list sid on a divergent page can still match the
  // wrong same-type sibling — display-only (an orphan/badge row; never an index
  // into BLOCKS_WORK, never an edit action). Neither source available → surface
  // nothing rather than everything.
  const ids = [];
  if (main && main.querySelectorAll) Array.prototype.forEach.call(main.querySelectorAll("[data-dds-sid]"), (n) => ids.push(n.getAttribute("data-dds-sid")));
  const meta = ddsMetaFor(DC_PAGE || "");
  if (meta) meta.forEach((e) => { if (e && e.sid) ids.push(e.sid); });
  if (!ids.length && !meta) return;
  (CM_THREADS || []).filter((t) => t.page_slug === (DC_PAGE || "") && t.block_id && ids.indexOf(t.block_id) === -1).forEach((t) => {
    const row = el("div", "dc-tree-row core under-page");
    const mn = el("button", "dc-tree-main"); mn.type = "button"; mn.title = "Read this feedback";
    mn.appendChild(Object.assign(el("span", "dc-tree-ico"), { innerHTML: uiIcon("message") }));
    const txt = el("span", "dc-tree-txt");
    txt.appendChild(el("span", "dc-tree-name", "Feedback on a removed section"));
    txt.appendChild(el("span", "dc-tree-meta", t.block_id));
    mn.appendChild(txt);
    mn.addEventListener("click", () => openCommentsThread(DC_PAGE, t.block_id, "Removed section"));
    row.appendChild(mn);
    row.appendChild(cmBadge(DC_PAGE, t.block_id, "Removed section"));
    host.appendChild(row);
  });
}
// ── Phase CP-2: the Design Studio — every choice curated, contrast-safe, no code ──
// All controls write the SAME dev-token layer (one machinery). Owners = tokens
// only; a developer's custom CSS/HTML is never touched. Publish applies.
const PALETTES = [
  { key: "", name: "Original", accent: "" },
  { key: "terracotta", name: "Warm terracotta", accent: "#8c3b2e", tokens: { accent: "#8c3b2e", accent_dark: "#6f2e24", ink: "#241d1a", soft: "#6b5f58" } },
  { key: "evergreen", name: "Evergreen", accent: "#23635a", tokens: { accent: "#23635a", accent_dark: "#17453f", ink: "#1c2430", soft: "#5b6572" } },
  { key: "harbor", name: "Harbor blue", accent: "#2f5d8a", tokens: { accent: "#2f5d8a", accent_dark: "#224566", ink: "#1b2530", soft: "#5a6570" } },
  { key: "plum", name: "Quiet plum", accent: "#5b3fa0", tokens: { accent: "#5b3fa0", accent_dark: "#463079", ink: "#221e2c", soft: "#635d70" } },
  { key: "espresso", name: "Espresso", accent: "#5d4037", tokens: { accent: "#5d4037", accent_dark: "#43302a", ink: "#25201d", soft: "#6d625c" } },
  { key: "slate", name: "Modern slate", accent: "#37474f", tokens: { accent: "#37474f", accent_dark: "#263238", ink: "#1e262a", soft: "#5c686e" } },
];
const TYPE_PRESETS = [
  { key: "", name: "Original", tokens: {} },
  { key: "classic_serif", name: "Classic serif", tokens: { font_display: "Georgia, 'Iowan Old Style', 'Times New Roman', serif", font_body: "Georgia, 'Times New Roman', serif" } },
  { key: "modern_sans", name: "Modern sans", tokens: { font_display: "system-ui, -apple-system, 'Segoe UI', sans-serif", font_body: "system-ui, -apple-system, 'Segoe UI', sans-serif" } },
  { key: "editorial", name: "Editorial", tokens: { font_display: "Georgia, 'Iowan Old Style', serif", font_body: "system-ui, -apple-system, 'Segoe UI', sans-serif" } },
  { key: "friendly", name: "Friendly rounded", tokens: { font_display: "'Avenir Next Rounded', 'Trebuchet MS', system-ui, sans-serif", font_body: "'Trebuchet MS', system-ui, sans-serif" } },
  { key: "typewriter", name: "Understated mono", tokens: { font_display: "'Courier New', ui-monospace, monospace", font_body: "system-ui, -apple-system, sans-serif" } },
];
// FD-T3: complete "looks" — one tap sets a coordinated palette + type + shape
// (all through the SAME token layer; every palette is contrast-checked). A look is
// a variant of the one engine, not a new template (constitution Part 4).
// Item 333: the twelve Eric picked in Figma (section D), grouped by mood, Original first, and what a
// look clears so the next one leaves nothing of the last behind, are the server's one list
// (lib/style_looks.ts), sent with /dev/customization beside the font library; + New site's openings
// for a kind of business start a site in the same looks. Each sets its colours, its two library
// fonts, its button set and corners, and names itself (look), which brings its own small layer of
// rules so every word reads on every template (lib/site_looks.ts). tests/presence/style_looks_333_test.mjs
// reads every word of every template under each; tests/e2e/style-looks-333.spec.ts draws the tiles.
let STYLE_LOOKS = [];
let LOOK_CLEAR = {};
// A dark look's colours only read together: a colour, background or brand colour picked over one
// starts again from the template's own, on a light page (routes/dev.ts does the same for the kit).
const DARK_LOOK_CLEAR = { scheme: "", bg: "", ink: "", soft: "", accent: "", accent_dark: "", card: "", line: "", wash: "", accent_band: "", look: "" };
const SIZE_OPTS = [ ["Cozy","0.95"], ["Standard",""], ["Larger","1.08"] ];
const CORNER_OPTS = [ ["Sharp","2px"], ["Soft",""], ["Round","18px"] ];
const BG_OPTS = [ ["Bright",""], ["Warm","#faf6ee"], ["Cool","#f3f5f7"] ];
const DENSITY_OPTS = [ ["Compact","0.82"], ["Comfortable",""], ["Airy","1.18"] ];
// DS-8: deterministic suggestion by industry (no model call — instant, explainable)
const SUGGEST = { restaurant:["terracotta","classic_serif"], coffee_shop:["espresso","editorial"], bar:["slate","editorial"],
  salon:["plum","editorial"], barber:["slate","classic_serif"], spa:["evergreen","editorial"], fitness:["slate","modern_sans"],
  plumber:["harbor","modern_sans"], hvac:["harbor","modern_sans"], electrician:["harbor","modern_sans"], contractor:["slate","modern_sans"],
  landscaping:["evergreen","modern_sans"], cleaning:["harbor","modern_sans"], roofing:["slate","modern_sans"], home_services:["harbor","modern_sans"],
  law:["slate","classic_serif"], accounting:["harbor","classic_serif"], insurance:["harbor","modern_sans"], consulting:["slate","editorial"],
  marketing:["plum","modern_sans"], real_estate:["slate","editorial"], photography:["slate","editorial"],
  medical:["harbor","modern_sans"], dental:["harbor","modern_sans"], veterinary:["evergreen","friendly"],
  retail:["plum","modern_sans"], nonprofit:["evergreen","editorial"], church:["espresso","classic_serif"], professional:["slate","editorial"] };
let DESIGN_FONTS = [];   // the curated library (lib/fonts.ts), sent with /dev/customization
// lib/fonts.ts fontFaceCss over libraryFontsIn: the same rules, so the canvas loads a picked
// font straight away. Change both together.
function dcFontFaces(tokens) {
  const named = [];
  ["font_display", "font_body"].forEach((k) => {
    const first = String((tokens || {})[k] || "").split(",")[0].replace(/['"]/g, "").trim().toLowerCase();
    const f = first && DESIGN_FONTS.find((x) => x.css.toLowerCase() === first);
    if (f && !named.includes(f)) named.push(f);
  });
  return named.map((f) => f.weights.map((w) => `@font-face{font-family:'${f.css}';src:url(/fonts/library/${f.id}-${w}.woff2) format('woff2');font-weight:${w};font-style:normal;font-display:swap}`).join("")).join("");
}
// The canvas shows a style the moment it's picked: the same :root variables the server
// writes into #presence-dev (render.ts devLayerFragments), set in place. Custom CSS in
// that element stays, and a cleared choice falls back to the template's own default.
// False when there's no canvas to patch.
function dcPatchTokens(tokens) {
  const doc = dcFrameDoc(); if (!doc || !doc.head) return false;
  const vars = Object.entries(tokens || {}).flatMap(([k, v]) => {
    const key = k.replace(/[^a-z0-9_]/gi, ""), val = String(v).replace(/[^#0-9a-zA-Z_.,%()\-\s]/g, "");
    return key.includes("_") ? [`--${key}:${val}`, `--${key.replace(/_/g, "-")}:${val}`] : [`--${key}:${val}`];
  }).join(";");
  let st = doc.getElementById("presence-dev");
  const rest = st ? st.textContent.replace(/^:root\{[^}]*\}/, "").replace(/^(?:@font-face\{[^}]*\})+/, "") : "";
  if (!vars && !rest) { if (st) st.remove(); return true; }
  if (!st) { st = doc.createElement("style"); st.id = "presence-dev"; doc.head.appendChild(st); }
  st.textContent = (vars ? `:root{${vars}}` : "") + dcFontFaces(tokens) + rest;
  return true;
}
// A pick shows at once and saves behind. The next pick builds on it before it has saved,
// so two quick picks keep both; a failed save puts the page back if nothing came after.
let TOKENS_SEQ = 0;
// Item 333: what a ready-made look sets that the server draws (lib/site_looks.ts), so the canvas is drawn again;
// and the openings' own settings, which change what the welcome section draws (lib/template_kit.ts).
const LOOK_DRAWN = ["look", "scheme", "heading_case", "heading_weight", "button_radius", "button_shadow", "hero_card", "hero_photo", "hero_band"];
async function saveTokens(change, msg) {
  if (DESIGN_TOKENS && DESIGN_TOKENS.scheme && !("scheme" in change) && ["accent", "accent_dark", "ink", "soft", "bg"].some((k) => k in change)) change = { ...DARK_LOOK_CLEAR, ...change };   // item 333
  const before = DESIGN_TOKENS, next = { ...DESIGN_TOKENS };
  const redraw = "buttons" in change || "forms" in change;   // item 217: the server draws a set's own style (lib/site_buttons.ts)
  const lookDrawn = LOOK_DRAWN.some((k) => k in change);
  for (const [k, v] of Object.entries(change)) { if (v === "" || v == null) delete next[k]; else next[k] = v; }
  const seq = ++TOKENS_SEQ;
  const put = api("PUT", "/dev/customization", { theme_tokens: next });   // Undo reads the tokens from before, here
  DESIGN_TOKENS = next;
  // a page going dark or light waits for the server's drawing: its cards and bands change with it
  const shown = String((before && before.scheme) || "") === String(next.scheme || "") && dcPatchTokens(next);
  try {
    await put;
    if (seq === TOKENS_SEQ) designCardRedraw();
    toast(msg + ". Publish to see it live."); scheduleChangesRefresh(); stageStale();
    if (!shown || redraw || lookDrawn) refreshDesignPreview();
  } catch (err) {
    if (seq === TOKENS_SEQ) { DESIGN_TOKENS = before; if (shown) dcPatchTokens(before); designCardRedraw(); }
    toast(nice(err), true);
  }
}
// Item 333: the card is drawn again where it stands, so a pick never moves the panel. The panel
// keeps its scroll, and the choice that had the keyboard keeps it: a look's tile by its look, any
// other control by its place among the card's controls.
function designCardRedraw() {
  const old = $("designCard"); if (!old) return mountDesignCard(false);
  const sc = old.closest(".dc-panel-scroll"), top = sc ? sc.scrollTop : 0;
  const controls = (root) => [...root.querySelectorAll("button, input, select, textarea, summary, a[href]")];
  const ae = document.activeElement, had = ae && ae !== old && old.contains(ae);
  const look = had && ae.classList.contains("st-look") ? ae.dataset.look : null, at = had ? controls(old).indexOf(ae) : -1;
  return remountInPlace("designCard", () => mountDesignCard(false), true).then(() => {
    if (sc) sc.scrollTop = top;
    const nu = $("designCard"); if (!nu || !had) return;
    const t = look !== null ? [...nu.querySelectorAll(".st-look")].find((x) => x.dataset.look === look) : controls(nu)[at];
    if (t) t.focus({ preventScroll: true });
  });
}
// the tab a Styles row belongs to (the floating studio's Styles card hides the others)
function stab(rowEl, tab) { const w = rowEl && (rowEl.classList && rowEl.classList.contains("ins-field") ? rowEl : rowEl.parentNode); if (w && w.dataset) w.dataset.stab = tab; return rowEl; }
// ── Item 302: how sections come in as visitors scroll, picked from tiles that move ──
// Still, or one of four (lib/site_motion.ts): gentle (fades up), slide (in from the side), scale (grows
// from a touch smaller), zoom (the gentle rise and a slow zoom on the welcome photo). Each tile plays
// its own motion when the pointer rests on it or it has the keyboard, and the chosen one plays once as
// the card opens. A device asking for less motion sees the tiles still.
const MOTIONS = [
  ["", "Still", "Nothing moves. Every section is simply there."],
  ["gentle", "Gentle", "Each section fades up a little as visitors scroll to it."],
  ["slide", "Slide", "Each section slides in from the side, left and right in turn."],
  ["scale", "Scale", "Each section grows in from a touch smaller."],
  ["zoom", "Zoom", "The gentle rise, and the welcome photo zooms in slowly over the first few seconds."],
];
function motionRow(host, T) {
  const wrap = el("div", "ins-field");
  wrap.appendChild(el("div", "ins-lbl", "Motion"));
  const row = el("div", "ins-motions"); row.setAttribute("role", "group"); row.setAttribute("aria-label", "Motion");
  const now = String(T.motion || "");
  const says = el("p", "ins-says");
  MOTIONS.forEach(([v, name]) => {
    const b = el("button", "ins-motion"); b.type = "button"; b.dataset.motion = v || "still"; b.setAttribute("aria-pressed", String(now === v));
    const pic = el("span", "ins-motion-pic"); pic.setAttribute("aria-hidden", "true");
    pic.append(el("i", "ph"), el("i", "ln"), el("i", "ln s"));
    b.append(pic, document.createTextNode(name));
    const play = () => { pic.classList.remove("play"); void pic.offsetWidth; pic.classList.add("play"); };
    b.addEventListener("mouseenter", play); b.addEventListener("focus", play);
    b.addEventListener("click", () => { if (v === String((DESIGN_TOKENS && DESIGN_TOKENS.motion) || "")) return; saveTokens({ motion: v }, v ? "Motion: " + name.toLowerCase() : "Motion: still"); row.querySelectorAll(".ins-motion").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); says.textContent = MOTIONS.find((m) => m[0] === v)[2] + MOTION_KIND; });
    if (now === v && v) setTimeout(play, 300);
    row.appendChild(b);
  });
  wrap.appendChild(row);
  says.textContent = (MOTIONS.find((m) => m[0] === now) || MOTIONS[0])[2] + MOTION_KIND;
  wrap.appendChild(says);
  host.appendChild(wrap);
  return wrap;
}
const MOTION_KIND = " Anyone whose device asks for less motion sees the site still, and nothing waits to show.";
// The header's two arrangements. Styles has the row, and so does the Pages card's Header and footer;
// `after` lets the second redraw its own row once the pick has landed.
function navStyleRow(host, after, label) {
  return pillRow(host, label || "Header", [["Standard", ""], ["Centered", "centered"]], (o) => String((S.settings && S.settings.nav_style) || "") === o[1],
    async (o) => { try { await settingsPut({ nav_style: o[1] }); const c2 = $("designCard"); if (c2) c2.remove(); mountDesignCard(); toast("Header: " + o[0] + " — publish to apply"); scheduleChangesRefresh(); refreshDesignPreview(); if (after) after(); } catch (err) { toast(nice(err), true); } });
}
// Item 330: what the picked front-page layout does, in a line, for the three new ones. 'panel' and
// 'editorial' need a photo (the cover, a service's or a published update's); without one the site
// opens as Type only, and the line says so.
function heroLayoutSays(v) {
  const st = S.settings || {};
  const photo = !!st.cover_media_id || (S.offerings || []).some((o) => o.media_id && o.is_visible !== false) || (S.posts || []).some((p) => p.status === "published" && p.hero_media_id);
  const noPhoto = photo ? "" : " Until your site has a photo, it opens as Type only.";
  if (v === "panel") return "Your tagline as the headline, on a soft tint of your colour, with your photo running to the edge." + noPhoto;
  if (v === "editorial") return "Your tagline as a big centred headline, then up to three of your photos in a row. It reads best with the Centered header." + noPhoto;
  if (v === "type") return "Your tagline in big words " + ((DESIGN_TOKENS || {}).hero_band === "off" ? "on the page itself" : "on a band of your colour") + ", then the facts your site has: reviews, today’s hours, your phone and the places you serve.";
  return "";
}
// The openings made for a kind of business (lib/kind_openings.ts) start a site with one more choice
// beside its layout; each is a style setting the server draws, and each can be changed here: a card
// on the welcome photo, the colour panel's photo side, Type only on the page or on its band.
const CARD_OPTS = [["Nothing", ""], ["A form asking for an estimate", "estimate"], ["Today’s hours and booking", "today"]];
const HERO_SIDES = {
  photo: { key: "hero_card", label: "On the photo", opts: CARD_OPTS },
  "photo-light": { key: "hero_card", label: "On the photo", opts: CARD_OPTS },
  panel: { key: "hero_photo", label: "Where the photo sits", opts: [["On the right", ""], ["On the left", "left"]] },
  type: { key: "hero_band", label: "Behind the words", opts: [["A band of your colour", ""], ["The page itself", "off"]] },
};
function pillRow(host, label, opts, isOn, onPick, style) {
  const wrapEl = el("div"); wrapEl.style.cssText = "margin-top:12px";
  wrapEl.appendChild(Object.assign(el("div", null, label), { style: "font-size:12px;font-weight:600;margin-bottom:6px" }));
  if (style === "swatch") {   // round colour swatches; the name is the accessible name, as the pill's words were
    const rowEl = el("div", "ins-swatches");
    opts.forEach((o) => {
      const on = isOn(o);
      const b = el("button", "ins-sw" + (on ? " on" : "")); b.type = "button";
      b.style.background = o.accent || "linear-gradient(135deg,#8c3b2e,#23635a)";
      b.setAttribute("aria-label", (o.name || o[0]) + (on ? " ✓" : "")); b.title = o.name || o[0]; b.setAttribute("aria-pressed", String(on));
      b.addEventListener("click", () => onPick(o));
      rowEl.appendChild(b);
    });
    wrapEl.appendChild(rowEl); host.appendChild(wrapEl);
    return rowEl;
  }
  const rowEl = el("div"); rowEl.style.cssText = "display:flex;gap:7px;flex-wrap:wrap";
  opts.forEach((o) => {
    const on = isOn(o);
    const b = el("button", null, "");
    b.type = "button";
    b.style.cssText = "display:flex;align-items:center;gap:6px;font:inherit;font-size:12px;padding:5px 11px;border-radius:999px;cursor:pointer;border:2px solid " + (on ? "var(--plum,#5b3fa0)" : "var(--line,#ddd)") + ";background:" + (on ? "var(--plum-tint,#faf7ff)" : "transparent");
    if (o.accent !== undefined) { const dot = el("span"); dot.style.cssText = "width:13px;height:13px;border-radius:50%;display:inline-block;background:" + (o.accent || "linear-gradient(135deg,#8c3b2e,#23635a)") + ";border:1px solid rgba(0,0,0,.15)"; b.appendChild(dot); }
    b.appendChild(document.createTextNode((o.name || o[0]) + (on ? " ✓" : "")));
    b.addEventListener("click", () => onPick(o));
    rowEl.appendChild(b);
  });
  wrapEl.appendChild(rowEl); host.appendChild(wrapEl);
  return rowEl;
}
// The main colours in a logo: its picture drawn small, the pixels binned, the fullest bins
// first (transparent, near-white and near-grey pixels skipped). Up to five, as hex.
async function logoPalette(mediaId) {
  const m = (S.media || []).find((x) => String(x.id) === String(mediaId));
  const src = m && (m.thumb || m.url); if (!src) throw new Error("no picture");
  const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => res(i); i.onerror = () => rej(new Error("load")); i.src = src; });
  const c = document.createElement("canvas"); c.width = 48; c.height = 48;
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0, 48, 48);
  const d = ctx.getImageData(0, 0, 48, 48).data;   // throws on a cross-origin picture without CORS
  const bins = new Map();
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
    if (a < 128) continue;
    if (r > 235 && g > 235 && b > 235) continue;                           // the paper behind the logo
    if (Math.max(r, g, b) - Math.min(r, g, b) < 12 && r > 170) continue;   // light greys
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 }; bin.n++; bin.r += r; bin.g += g; bin.b += b; bins.set(key, bin);
  }
  const hex = (v) => Math.round(v).toString(16).padStart(2, "0");
  const sorted = [...bins.values()].sort((x, y) => y.n - x.n).map((bin) => ({ n: bin.n, rgb: [bin.r / bin.n, bin.g / bin.n, bin.b / bin.n] }));
  const out = [];
  sorted.forEach((s) => {
    if (out.length >= 5) return;
    const far = out.every((o) => Math.abs(o[0] - s.rgb[0]) + Math.abs(o[1] - s.rgb[1]) + Math.abs(o[2] - s.rgb[2]) > 60);   // distinct enough to be a different colour
    if (far) out.push(s.rgb);
  });
  return out.map(([r, g, b]) => "#" + hex(r) + hex(g) + hex(b));
}
async function mountBrandKitCard() {
  const host = $("designHost"); if (!host || $("brandKitCard")) return;
  let kit = null;
  try { kit = (await api("GET", "/dev/brand-kit")).data.brand_kit; } catch (_) { return; } // not owner/dev → no card
  const T = DESIGN_TOKENS || {};
  const st = {
    // item 197: the site's logo is the one its settings hold (a saved kit can hold an older one)
    logo_media_id: S.settings && "logo_media_id" in S.settings ? (S.settings.logo_media_id || null) : ((kit && kit.logo_media_id) || null),
    primary: normHexJs((kit && kit.primary) || T.accent) || dcSiteColours().accent,   // item 277: the site's own colour, never the studio's purple
  };
  // Item 94: type and corners are set in one place, Colors and fonts below. This card showed
  // the same two choices again, and the two could disagree on which was ticked. The kit now
  // takes them as they stand when it is built or re-applied, so it never puts an older one back.
  const typeAndCorners = () => { const t = DESIGN_TOKENS || {}; return { heading_font: t.font_display || undefined, body_font: t.font_body || undefined, corner: t.radius || "" }; };
  const miniBtn = "font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  const card = el("div", "field"); card.id = "brandKitCard"; card.style.marginTop = "18px"; card.dataset.stab = "colours";
  card.appendChild(el("label", null, "Logo and brand colour"));
  card.appendChild(el("div", "hint", "Set your logo and colour once. Buttons, links and forms follow."));
  // logo
  const logoRow = el("div"); logoRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-top:8px";
  const logoWrap = el("span"); const paintLogo = () => { logoWrap.textContent = ""; if (st.logo_media_id) logoWrap.appendChild(mediaThumb(st.logo_media_id)); };
  paintLogo();
  const logoBtn = el("button", null, st.logo_media_id ? "Change logo" : "Choose logo"); logoBtn.type = "button"; logoBtn.style.cssText = miniBtn;
  const showLogo = () => { paintLogo(); logoBtn.textContent = st.logo_media_id ? "Change logo" : "Choose logo"; };
  // Item 197 (review finding 39): a picked logo showed here and was saved only by "Build & apply
  // brand kit", so the Header card's "Add a logo", which comes here, lost it without a word. It saves now.
  logoBtn.addEventListener("click", () => openPicker(async (id) => {
    const was = st.logo_media_id;
    st.logo_media_id = id || null; showLogo();
    if (st.logo_media_id === ((S.settings && S.settings.logo_media_id) || null)) return;
    try {
      await settingsPut({ logo_media_id: st.logo_media_id });
      toast(id ? "Logo saved. Publish to show it on your live site." : "Logo taken off. Publish to take it off your live site.");
      scheduleChangesRefresh(); refreshDesignPreview();
      if ($("hfCard") && $("hfCard").dataset.which === "header") renderHFCard("header");
    } catch (err) { st.logo_media_id = was; showLogo(); toast(nice(err), true); }
  }));
  logoRow.append(logoWrap, logoBtn); card.appendChild(logoRow);
  // brand colour
  const colorRow = el("div"); colorRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-top:10px";
  colorRow.appendChild(Object.assign(el("span", null, "Brand colour"), { style: "font-size:12px;font-weight:600" }));
  const colorInput = el("input"); colorInput.type = "color"; colorInput.value = st.primary; colorInput.style.cssText = "width:44px;height:32px;border:1px solid var(--line,#ddd);border-radius:8px;background:none;cursor:pointer";
  const hexInput = el("input"); hexInput.type = "text"; hexInput.value = st.primary; hexInput.style.cssText = "width:110px;padding:7px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px";
  colorInput.addEventListener("input", () => { hexInput.value = colorInput.value; st.primary = colorInput.value; });
  hexInput.addEventListener("change", () => { const h = normHexJs(hexInput.value); if (h) { st.primary = h; colorInput.value = h; hexInput.value = h; } });
  colorRow.append(colorInput, hexInput); card.appendChild(colorRow);
  // Colours from my logo: read the logo's main colours and offer each as the brand colour
  const fromLogo = el("div", "st-logo");
  const lb = el("button", "dc-actbtn", "Colours from my logo"); lb.type = "button"; lb.title = "Read the main colours in your logo and offer them as the brand colour";
  const out = el("div", "ins-swatches"); out.hidden = true; out.setAttribute("aria-live", "polite");
  lb.addEventListener("click", async () => {
    if (!st.logo_media_id) { toast("Choose a logo first, then its colours can be read."); try { logoBtn.focus(); } catch (_) {} return; }
    lb.disabled = true; lb.textContent = "Reading your logo…";
    const cols = await logoPalette(st.logo_media_id).catch(() => null);
    lb.disabled = false; lb.textContent = "Colours from my logo";
    out.textContent = ""; out.hidden = false;
    if (!cols || !cols.length) { out.appendChild(el("span", "hint", "Couldn’t read the colours from that logo. Pick the colour above instead.")); return; }
    out.appendChild(Object.assign(el("span", "hint", "From your logo — tap one to make it the brand colour:"), { style: "flex:0 0 100%;margin:0" }));
    cols.forEach((h) => {
      const b = el("button", "ins-sw"); b.type = "button"; b.style.background = h; b.title = h; b.setAttribute("aria-label", "Use " + h + " from your logo as the brand colour");
      b.addEventListener("click", () => {
        const safe = ovDarkenUntil(h, "#ffffff", 4.5);   // buttons carry white words: keep them readable
        st.primary = safe; colorInput.value = safe; hexInput.value = safe;
        out.querySelectorAll(".ins-sw").forEach((x) => x.classList.toggle("on", x === b));
        toast(safe === h ? "Brand colour set — Build & apply brand kit to use it" : "Brand colour set, darkened a little so white text stays readable — Build & apply brand kit to use it");
      });
      out.appendChild(b);
    });
  });
  fromLogo.append(lb, out); card.appendChild(fromLogo);
  card.appendChild(el("div", "hint", "Type and corners are set under Colours and fonts. The kit keeps whatever they are when you apply it."));
  // apply
  const apply = el("button", null, "Build & apply brand kit"); apply.type = "button";
  apply.style.cssText = "font:inherit;font-size:13px;font-weight:600;margin-top:14px;padding:8px 16px;border-radius:999px;border:2px solid var(--plum,#5b3fa0);background:var(--plum-tint,#faf7ff);color:var(--plum-deep,#3a2470);cursor:pointer";
  apply.addEventListener("click", async () => {
    const brand_kit = { logo_media_id: st.logo_media_id, primary: st.primary, ...typeAndCorners() };
    try {
      const r = await api("PUT", "/dev/brand-kit", { brand_kit });
      DESIGN_TOKENS = (r.data && r.data.applied_tokens) || DESIGN_TOKENS;
      if (st.logo_media_id) S.settings = { ...(S.settings || {}), logo_media_id: st.logo_media_id };
      const c = $("designCard"); if (c) c.remove(); mountDesignCard();
      toast("Applied. Publish to take it live"); scheduleChangesRefresh(); refreshDesignPreview();
    } catch (err) { toast(nice(err), true); }
  });
  card.appendChild(apply);
  // ── G30: one-tap "Apply my brand" — re-applies the SAVED kit to everything
  // (palette + type + corners through the one token layer), then reports which
  // library images can honestly be re-made in the brand palette. Only shown once
  // a kit is saved; the builder button above stays the first-run path.
  if (kit) {
    const row2 = el("div"); row2.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px";
    const applySaved = el("button", null, "Apply my brand"); applySaved.type = "button";
    applySaved.style.cssText = "font:inherit;font-size:13px;font-weight:600;padding:8px 16px;border-radius:999px;border:1px solid var(--plum,#5b3fa0);background:var(--plum,#5b3fa0);color:var(--fill-ink,#fff);cursor:pointer";
    applySaved.title = "One tap: re-apply your saved logo and colour to the whole site, with the type and corners you have now";
    row2.appendChild(applySaved);
    row2.appendChild(el("span", "hint", "Re-applies your saved brand to the whole site in one tap."));
    const report = el("div"); report.style.cssText = "margin-top:8px";
    applySaved.addEventListener("click", async () => {
      applySaved.disabled = true; const was = applySaved.textContent; applySaved.textContent = "Applying…";
      try {
        // the saved kit takes today's type and corners first, so re-applying it can't bring back older ones
        const now = typeAndCorners();
        if ((kit.heading_font || undefined) !== now.heading_font || (kit.body_font || undefined) !== now.body_font || String(kit.corner || "") !== now.corner) {
          await api("PUT", "/dev/brand-kit", { brand_kit: { logo_media_id: kit.logo_media_id || null, primary: kit.primary, ...now } });
          Object.assign(kit, now);
        }
        const r = await api("POST", "/dev/brand-kit/apply", {});
        const d = (r && r.data) || {};
        DESIGN_TOKENS = d.applied_tokens || DESIGN_TOKENS;
        const c = $("designCard"); if (c) c.remove(); mountDesignCard();
        toast("Brand applied — publish to take it live"); scheduleChangesRefresh(); refreshDesignPreview();
        renderBrandImageryReport(report, d);
      } catch (err) { toast(nice(err), true); }
      applySaved.disabled = false; applySaved.textContent = was;
    });
    card.append(row2, report);
  }
  host.appendChild(card);
}
// G30 imagery half, honestly scoped: AI-made images re-GENERATE in the brand
// palette through the existing approval-gated /visual routes (options land in
// AI Visual Studio to review and approve). Uploaded photos are never recolored —
// repainting a real photo would misrepresent it — and the report says so.
function renderBrandImageryReport(host, d) {
  host.innerHTML = "";
  const im = (d && d.imagery) || {}; const list = im.recolorable || [];
  if (!list.length && !im.not_recolorable_count) return;
  if (window.ddsLacks && window.ddsLacks("approve")) return;   // builder item 220: a Designer makes no AI images (keeping one is an approval)
  const box = el("div"); box.style.cssText = "margin-top:10px;border:1px solid var(--plum-line,#e6ddf5);background:var(--plum-tint,#faf7ff);border-radius:10px;padding:10px 12px";
  box.appendChild(Object.assign(el("div", null, "Your images, on-brand"), { style: "font-size:12px;font-weight:600;margin-bottom:4px" }));
  if (list.length) {
    box.appendChild(el("div", "hint", "These AI-made images can be re-created in your brand palette — each comes back as options to review and approve in the Visual Studio."));
    list.forEach((it) => {
      const rowEl = el("div"); rowEl.style.cssText = "display:flex;align-items:center;gap:10px;padding:6px 0";
      rowEl.appendChild(mediaThumb(it.media_id));
      const lbl = el("span", null, (it.alt_text || it.brief || "AI-made image").slice(0, 70));
      lbl.style.cssText = "flex:1;min-width:120px;font-size:12.5px";
      const b = el("button", null, "Re-create in my palette"); b.type = "button";
      b.style.cssText = "font:inherit;font-size:12px;padding:5px 12px;border-radius:999px;border:1px solid var(--plum,#5b3fa0);background:transparent;color:var(--plum-deep,#3a2470);cursor:pointer";
      b.addEventListener("click", async () => {
        b.disabled = true; b.textContent = "Making options…";
        try {
          await api("POST", "/visual/generate", { kind: it.kind || "general", subject: it.brief || it.alt_text || "the same image, in my brand colours", palette: d.palette || [], count: 2 });
          b.textContent = "Options ready ✓";
          toast("Options ready — review and approve them in the Visual Studio");
        } catch (err) { toast(nice(err), true); b.disabled = false; b.textContent = "Re-create in my palette"; }
      });
      rowEl.append(lbl, b); box.appendChild(rowEl);
    });
    const lk = el("a", null, "Open the Visual Studio to review →");
    lk.href = "/visual-studio.html"; lk.style.cssText = "font-size:12.5px;color:var(--plum,#5b3fa0);font-weight:600;text-decoration:none";
    box.appendChild(lk);
  }
  if (im.not_recolorable_count) {
    box.appendChild(el("div", "hint", im.not_recolorable_count + " uploaded photo" + (im.not_recolorable_count === 1 ? "" : "s") + " stay exactly as they are — we never repaint a real photo."));
  }
  host.appendChild(box);
}
// The curated fonts, one list for headings and one for body text, each name shown in its
// own face. Folded until opened: opening it loads each family's regular weight to draw the
// names. A site only ever carries the families it picks.
// A look is "on" when every token it sets is what the site has (Original: none of them set).
function lookIsOn(l) {
  const T = DESIGN_TOKENS || {}; const keys = Object.keys(LOOK_CLEAR);
  const t = l.tokens || {};
  if (!Object.keys(t).length) return keys.every((k) => !T[k]);
  return keys.every((k) => String(T[k] || "") === String(t[k] || ""));
}
// Item 333: each ready-made look drawn small in its own fonts, colours and button, two across:
// its mood, its name as a heading, a line of words and a button. The one in use is ringed and says
// On. A tap marks it at once and saves behind; the card is then drawn again where it stands
// (designCardRedraw), so the panel keeps its place and the tile keeps the keyboard.
function lookTiles(host, label, looks, isOn, onPick) {
  const wrap = el("div", "ins-field"); wrap.dataset.stab = "looks"; wrap.style.marginTop = "4px";
  wrap.appendChild(el("div", "ins-lbl", label));
  wrap.appendChild(el("p", "ins-says", "Tap one to try it on the page. The panel stays where it is."));
  lookFaces(looks);
  const grid = el("div", "st-looks"); grid.setAttribute("role", "group"); grid.setAttribute("aria-label", label);
  const mark = (b, on) => { b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); b.querySelector(".st-look-on").hidden = !on; };
  looks.forEach((l) => {
    const b = el("button", "st-look"); b.type = "button"; b.dataset.look = l.key || "";
    b.setAttribute("aria-label", l.name); b.title = l.name + " · " + l.mood;
    Object.entries(lookDrawing(l)).forEach(([k, v]) => b.style.setProperty(k, v));
    const pic = el("span", "st-look-pic"); pic.setAttribute("aria-hidden", "true");
    pic.append(el("span", "st-look-mood", l.mood), el("span", "st-look-h", l.name), el("span", "st-look-t", "Open until six."), el("span", "st-look-b", "Book now"), el("span", "st-look-on", "On"));
    b.appendChild(pic);
    mark(b, isOn(l));
    b.addEventListener("click", () => {
      if (b.classList.contains("on")) return;   // already this look: nothing to save
      grid.querySelectorAll(".st-look").forEach((x) => mark(x, x === b));
      onPick(l);
    });
    grid.appendChild(b);
  });
  wrap.appendChild(grid); host.appendChild(wrap);
  return wrap;
}
// A look's tile colours, faces and button, as CSS variables (presence.css .st-look). The button is
// filled the way the site fills it (lib/site_buttons.ts buttonChoice): white words on the accent,
// or on its darker shade, or else the darkest words that read on the accent.
function lookDrawing(l) {
  const t = l.tokens || {}, sans = "system-ui, -apple-system, 'Segoe UI', sans-serif";
  const ink = t.ink || "#1d1b22", acc = t.accent || ink, dark = t.accent_dark || acc;
  let fill = acc, on = "#ffffff";
  if (ovContrast("#ffffff", acc) < 4.5) {
    if (ovContrast("#ffffff", dark) >= 4.5) fill = dark;
    else on = [ink, "#111111", "#000000"].find((x) => ovContrast(x, acc) >= 4.5) || "#000000";
  }
  const display = t.font_display || sans, set = t.buttons || "";
  const size = 17 * (t.font_scale ? 1.18 : 1) * (/^Caveat\b/.test(display) ? 1.35 : 1);
  return {
    "--lk-bg": t.bg || "#ffffff", "--lk-ink": ink, "--lk-soft": t.soft || "#5b5866", "--lk-mood": t.accent_dark || ink,
    "--lk-fill": fill, "--lk-on": on, "--lk-display": display, "--lk-body": t.font_body || sans,
    "--lk-hw": t.heading_weight === "400" ? "400" : "700", "--lk-hs": size.toFixed(1) + "px", "--lk-hcase": t.heading_case === "upper" ? "uppercase" : "none",
    "--lk-br": set === "pill" ? "999px" : set === "square" ? "0" : t.button_radius ? Math.round(parseInt(t.button_radius, 10) / 2) + "px" : "6px",
    "--lk-bcase": set === "square" ? "uppercase" : "none", "--lk-bls": set === "square" ? ".08em" : "0",
    "--lk-bsh": t.button_shadow === "offset" ? "2px 2px 0 " + ink : "none",
  };
}
// The looks' faces, so each tile shows its real type: dcFontFaces' rules for every library family
// a look names, once for the page. A face loads when a tile first draws words in it.
function lookFaces(looks) {
  if ($("lookFaces") || !DESIGN_FONTS.length) return;
  const rules = new Set(looks.flatMap((l) => dcFontFaces(l.tokens).match(/@font-face\{[^}]*\}/g) || []));
  if (!rules.size) return;
  const st = document.createElement("style"); st.id = "lookFaces"; st.textContent = [...rules].join("");
  document.head.appendChild(st);
}
// ── Item 217: Styles › Buttons. One set restyles every button on the site, the main one and the
// second beside it, and one form style every box people type into (lib/site_buttons.ts draws
// them on the site; tests/presence/button_sets_test.mjs ties these lists to it). Each tile is a
// small drawing in this site's colours: white or dark words on the fill, as the server picks them.
const BUTTON_SET_OPTS = [["Your template’s", ""], ["Filled", "filled"], ["Outline", "outline"], ["Pill", "pill"], ["Square", "square"], ["Underline", "underline"]];
const FORM_STYLE_OPTS = [["Template’s", ""], ["Line", "line"], ["Soft", "soft"], ["Round", "round"]];
function buttonSetColours() {
  const c = dcSiteColours(), hx = (v, d) => normHexJs(v) || d;
  const paper = hx(c.paper, "#ffffff"), ink = hx(c.ink, "#000000"), accent = hx(c.accent, ink), dark = hx(c.accentDark, accent);
  const fill = ovContrast("#ffffff", accent) >= 4.5 || ovContrast("#ffffff", dark) < 4.5 ? accent : dark;
  const line = [dark, accent, ink].find((h) => ovContrast(h, paper) >= 4.5) || ink;
  return { paper, card: hx(c.card, paper), ink, fill, line, on: ovContrast("#ffffff", fill) >= 4.5 ? "#ffffff" : ink };
}
// The tiles take the colours the canvas draws with. The Styles card is built before the canvas
// has drawn, so opening the Buttons tab paints them again (stylesTab).
function buttonSetPaint(root) {
  const col = buttonSetColours();
  (root || document).querySelectorAll(".st-set-pic").forEach((pic) => [["--bs-paper", col.paper], ["--bs-card", col.card], ["--bs-ink", col.ink], ["--bs-fill", col.fill], ["--bs-on", col.on], ["--bs-line", col.line]].forEach(([k, v]) => pic.style.setProperty(k, v)));
}
function buttonSetRows(card, T) {
  const tiles = (label, says, opts, kind, cur, onPick, draw) => {
    const wrap = el("div", "ins-field st-group"); wrap.dataset.stab = "buttons";
    wrap.append(el("div", "ins-lbl", label), el("p", "ins-says", says));
    const grid = el("div", "st-sets " + kind); grid.setAttribute("role", "group"); grid.setAttribute("aria-label", label);
    opts.forEach((o) => {
      const on = cur === o[1];
      const b = el("button", "st-set" + (on ? " on" : "")); b.type = "button"; b.setAttribute("aria-pressed", String(on));
      const pic = el("span", "st-set-pic " + kind + "-" + (o[1] || "own")); pic.setAttribute("aria-hidden", "true");
      draw(pic);
      b.append(pic, el("span", "st-set-l", o[0] + (on ? " ✓" : "")));
      b.addEventListener("click", () => { if (!on) onPick(o); });
      grid.appendChild(b);
    });
    wrap.appendChild(grid); card.appendChild(wrap);
  };
  tiles("Button set", "Every button on the site at once: the main one and the second one beside it, on every page and section.",
    BUTTON_SET_OPTS, "bs", String(T.buttons || ""), (o) => saveTokens({ buttons: o[1], button_radius: "", button_shadow: "" }, o[1] ? "Buttons: " + o[0] : "Buttons: your template’s own"),   // item 333: the set's own corners, no look's shadow
    (pic) => pic.append(el("i", "bs-main", "Book"), el("i", "bs-second", "See menu")));
  tiles("Forms", "The boxes people type into, on every form, sign-up and booking.",
    FORM_STYLE_OPTS, "fs", String(T.forms || ""), (o) => saveTokens({ forms: o[1] }, o[1] ? "Forms: " + o[0] : "Forms: your template’s own"),
    (pic) => pic.append(el("i", "fs-f"), el("i", "fs-f short")));
  card.appendChild(el("div", "hint", "Every set stays readable on light, dark and accent sections. It is checked on every template and palette. Nothing reaches your live site until you publish.")).dataset.stab = "buttons";
  buttonSetPaint(card);
}
// The two faces in use, each a row that opens the font library (or the Type row when there is none).
function fontRows(card, T) {
  const wrap = el("div", "ins-field"); wrap.dataset.stab = "fonts"; wrap.style.marginTop = "4px";
  wrap.appendChild(el("div", "ins-lbl", "Fonts · fewer fonts, faster site"));
  const firstOf = (v) => String(v || "").split(",")[0].replace(/['"]/g, "").trim();
  const nameOf = (tok) => {
    const v = T[tok]; if (!v) return "Original";
    const lib = (DESIGN_FONTS || []).find((f) => firstOf(v).toLowerCase() === String(f.css).toLowerCase()); if (lib) return lib.family;
    const pre = TYPE_PRESETS.find((p) => p.tokens && p.tokens[tok] === v); if (pre) return pre.name;
    return fontWords(firstOf(v)) || "Original";
  };
  [["font_display", "Headings"], ["font_body", "Text"]].forEach(([tok, k]) => {
    const b = el("button", "st-fontrow"); b.type = "button"; b.title = "Change the " + k.toLowerCase() + " font";
    b.appendChild(el("span", "k", k));
    const v = el("span", "v", nameOf(tok)); if (T[tok]) v.style.fontFamily = T[tok]; b.appendChild(v);
    b.insertAdjacentHTML("beforeend", uiIcon("chevron", 14));
    b.addEventListener("click", () => {
      const lib = card.querySelector("details.fontlib");
      if (lib) { FONT_LIB_OPEN = true; lib.open = true; const grp = lib.querySelector('[aria-label="' + (tok === "font_display" ? "Headings" : "Body text") + ' font"]'); (grp || lib).scrollIntoView({ block: "nearest", behavior: "smooth" }); const f = grp && grp.querySelector("button"); if (f) f.focus({ preventScroll: true }); return; }
      const type = [...card.querySelectorAll("[data-stab='fonts'] button")].find((x) => !x.classList.contains("st-fontrow")); if (type) { type.scrollIntoView({ block: "nearest" }); type.focus({ preventScroll: true }); }
    });
    wrap.appendChild(b);
  });
  card.appendChild(wrap);
}
// Builder item 327: fontWords() (a font the browser picks, named in words) lives in presence-core.js: the Styles tab uses it too (item 431)
function mountFontLibrary(card, T) {
  if (!DESIGN_FONTS.length) return;
  const firstOf = (v) => String(v || "").split(",")[0].replace(/['"]/g, "").trim().toLowerCase();
  if (!document.getElementById("fontLibraryFaces")) {
    const st = document.createElement("style"); st.id = "fontLibraryFaces";
    st.textContent = DESIGN_FONTS.map((f) => `@font-face{font-family:'${f.css}';src:url(/fonts/library/${f.id}-400.woff2) format('woff2');font-weight:400;font-display:swap}`).join("");
    document.head.appendChild(st);
  }
  const box = el("details", "fontlib"); box.style.cssText = "margin-top:12px"; box.dataset.stab = "fonts";
  const sum = el("summary", null, "More fonts: " + DESIGN_FONTS.length + " to choose from"); sum.style.cssText = "font-size:12px;font-weight:600;cursor:pointer";
  box.appendChild(sum);
  if (FONT_LIB_OPEN) box.open = true;
  box.addEventListener("toggle", () => { FONT_LIB_OPEN = box.open; });
  [["font_display", "Headings", "Headings: "], ["font_body", "Body text", "Body text: "]].forEach(([tok, label, msg]) => {
    box.appendChild(Object.assign(el("div", null, label), { style: "font-size:12px;font-weight:600;margin:10px 0 6px" }));
    const grid = el("div"); grid.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:6px";
    grid.setAttribute("role", "group"); grid.setAttribute("aria-label", label + " font");
    // item 119: the fonts the site already uses come first (this one's pick, then the other's),
    // so reusing one is the easy choice: fewer fonts, faster site
    const other = firstOf(T[tok === "font_display" ? "font_body" : "font_display"]);
    const rank = (f) => (firstOf(T[tok]) === f.css.toLowerCase() ? 0 : other === f.css.toLowerCase() ? 1 : 2);
    DESIGN_FONTS.map((f, i) => [f, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([f]) => f).forEach((f) => {
      const on = firstOf(T[tok]) === f.css.toLowerCase(), used = !on && other === f.css.toLowerCase();
      const b = el("button", null, f.family + (on ? " ✓" : used ? " · in use" : "")); b.type = "button";
      b.setAttribute("aria-pressed", String(on));
      b.style.cssText = "font-family:'" + f.css + "'," + f.fallback + ";font-size:15px;text-align:left;padding:7px 10px;border-radius:10px;cursor:pointer;background:" + (on ? "var(--plum-tint,#faf7ff)" : "transparent") + ";border:2px solid " + (on ? "var(--plum,#5b3fa0)" : "var(--line,#ddd)");
      b.addEventListener("click", () => saveTokens({ [tok]: f.css + ", " + f.fallback }, msg + f.family));
      grid.appendChild(b);
    });
    box.appendChild(grid);
  });
  card.appendChild(box);
}
let FONT_LIB_OPEN = false;   // stays open across the card's remount after a pick
async function mountDesignCard(fresh = true) {
  const host = $("designHost") || $("view-business"); if (!host || $("designCard")) return;
  if (fresh) {   // a remount right after this page's own save already holds the tokens
    try {
      const r = await api("GET", "/dev/customization"); DESIGN_DEV = r.data || null; DESIGN_TOKENS = (r.data && r.data.theme_tokens) || {}; DESIGN_FONTS = (r.data && r.data.font_library) || [];
      STYLE_LOOKS = (r.data && Array.isArray(r.data.looks)) ? r.data.looks : []; LOOK_CLEAR = (r.data && r.data.look_clear) || {};
    }
    catch (_) { return; } // not an owner/developer on this site → no card
  }
 
  await mountBrandKitCard();   // FD-T9: brand kit is the source of truth, above the granular controls
  const card = el("div", "field"); card.id = "designCard"; card.style.marginTop = "18px";
  card.appendChild(el("label", null, "Colours and fonts"));
  const T = DESIGN_TOKENS;
  // FD-T3: complete looks — a coordinated one-tap starting point (then fine-tune below).
  // This is the front door the owner reaches for first, so it leads the card and
  // explains itself (a look restyles the whole site; publishing stays approval-first).
  // The floating studio: each look is a small picture of itself, the one in use ticked.
  if (STYLE_LOOKS.length) {   // a server from before the one list sends none: the card leaves the tiles out
    const looksWrap = lookTiles(card, "Ready-made looks", STYLE_LOOKS, lookIsOn, (l) => saveTokens({ ...LOOK_CLEAR, ...(l.tokens || {}) }, (l.name || "Original") + " style"));
    looksWrap.appendChild(el("div", "hint", "One tap restyles your whole site: colours, fonts and buttons together, always readable. Nothing reaches your live site until you publish."));
  }
  const fixedColors = FIXED_COLOR_TEMPLATES.has((S.site && S.site.template_slug) || "");
  if (fixedColors) card.appendChild(el("div", "hint", "This template keeps its own dark colours, so the colour and background choices don't change it. Fonts, text size, corners and spacing do.")).dataset.stab = "colours";
  else if (T.scheme) card.appendChild(el("div", "hint", "This look has a dark page. A colour or background picked here goes back to a light page.")).dataset.stab = "colours";   // item 333 (saveTokens)
  // item 118: which colour themes this page's sections wear (the canvas tags each one while this tab is open)
  const nowRow = el("div", "ins-field"); nowRow.id = "stThemesNow"; nowRow.dataset.stab = "colours";
  nowRow.append(el("div", "ins-lbl", "Colour themes on this page"), el("p", "ins-says"));
  card.appendChild(nowRow);
  // colors
  if (!fixedColors) stab(pillRow(card, "Colours", PALETTES, (p) => (p.accent ? String(T.accent || "").toLowerCase() === p.accent : !T.accent),
    (p) => saveTokens(p.key ? { ...p.tokens } : { accent: "", accent_dark: "", ink: "", soft: "" }, p.key ? p.name : "Original colours"), "swatch"), "colours");
  // type
  fontRows(card, T);
  stab(pillRow(card, "Type", TYPE_PRESETS, (t) => (t.key ? T.font_display === t.tokens.font_display : !T.font_display),
    (t) => saveTokens(t.key ? { ...t.tokens } : { font_display: "", font_body: "" }, t.key ? t.name : "Original type")), "fonts");
  mountFontLibrary(card, T);
  // size / corners / background / density
  stab(pillRow(card, "Text size", SIZE_OPTS, (o) => String(T.font_scale || "") === o[1], (o) => saveTokens({ font_scale: o[1] }, "Text size: " + o[0])), "text");
  stab(pillRow(card, "Corners", CORNER_OPTS, (o) => String(T.radius || "") === o[1], (o) => saveTokens({ radius: o[1] }, "Corners: " + o[0])), "looks");
  if (!fixedColors) stab(pillRow(card, "Background", BG_OPTS, (o) => String(T.bg || "") === o[1], (o) => saveTokens({ bg: o[1] }, "Background: " + o[0])), "colours");
  stab(pillRow(card, "Spacing", DENSITY_OPTS, (o) => String(T.spacing_scale || "") === o[1], (o) => saveTokens({ spacing_scale: o[1] }, "Spacing: " + o[0])), "text");
  // DS-6/DS-7: layout choices — every template family renders both variants,
  // each in its own visual voice, so the controls show for all templates (G2).
  // item 292: words over the welcome photo, under a dark veil or a light one
  // item 330: three more, each its own layout (lib/template_openings.ts HERO_LAYOUTS has the same names)
  const heroRow = [["Classic", ""], ["Photo beside text", "split"], ["Words over the photo", "photo"], ["Words over a light photo", "photo-light"],
    ["Split: words on a colour panel", "panel"], ["Centred editorial", "editorial"], ["Type only", "type"]];
  const heroNow = String((S.settings && S.settings.hero_layout) || "");
  const heroPills = stab(pillRow(card, "Front-page layout", heroRow, (o) => heroNow === o[1],
    async (o) => { try { await settingsPut({ hero_layout: o[1] }); const c2 = $("designCard"); if (c2) c2.remove(); mountDesignCard(); toast("Layout: " + o[0] + ". Publish to apply."); scheduleChangesRefresh(); refreshDesignPreview(); } catch (err) { toast(nice(err), true); } }), "looks");
  heroPills.classList.add("ins-heros");   // a full 44px tap on a touch screen (presence.css)
  const heroSays = heroLayoutSays(heroNow);
  if (heroSays) heroPills.parentNode.appendChild(Object.assign(el("p", "hint", heroSays), { id: "heroSays" }));
  const side = HERO_SIDES[heroNow];
  if (side) {
    const sideRow = stab(pillRow(card, side.label, side.opts, (o) => String(T[side.key] || "") === o[1], (o) => saveTokens({ [side.key]: o[1] }, side.label + ": " + o[0])), "looks");
    sideRow.classList.add("ins-heros"); sideRow.id = "heroSide";   // a full 44px tap on a touch screen, as the layouts
  }
  stab(navStyleRow(card), "looks");
  // item 158: a gentle "appear on scroll" (lib/site_motion.ts), and the site's own small icon (lib/site_icon.ts)
  stab(motionRow(card, T), "looks");   // item 302: four choices, each shown moving
  card.appendChild(siteIconRow());
  buttonSetRows(card, T);   // item 217
  // DS-8: suggest for my business (deterministic; owner approves by clicking Apply)
  const ik = (S.settings && S.settings.industry_key) || "generic";
  const sug = SUGGEST[ik];
  if (sug) {
    const [pk, tk] = sug;
    const p = PALETTES.find((x) => x.key === pk), t = TYPE_PRESETS.find((x) => x.key === tk);
    const already = p && t && String(T.accent || "").toLowerCase() === p.accent && T.font_display === t.tokens.font_display;
    if (p && t && !already) {
      const rowEl = el("div"); rowEl.style.cssText = "margin-top:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"; rowEl.dataset.stab = "colours";
      rowEl.appendChild(el("span", "hint", "Suggested for your kind of business: " + p.name + " + " + t.name + "."));
      const b = el("button", null, "Apply suggestion");
      b.type = "button"; b.style.cssText = "font:inherit;font-size:12px;padding:5px 12px;border-radius:999px;border:2px solid var(--plum,#5b3fa0);background:var(--plum-tint,#faf7ff);cursor:pointer";
      b.addEventListener("click", () => saveTokens({ ...p.tokens, ...t.tokens }, p.name + " + " + t.name));
      rowEl.appendChild(b);
      card.appendChild(rowEl);
    }
  }
  card.appendChild(el("div", "hint", "Designed, readable combinations: contrast is checked so your site always stays easy to read. You can restore any earlier version.")).dataset.stab = "looks";
  if (DESIGN_TOKENS && Object.keys(DESIGN_TOKENS).length && !PALETTES.some((p) => p.accent && String(DESIGN_TOKENS.accent || "").toLowerCase() === p.accent) && DESIGN_TOKENS.accent) {
    card.appendChild(el("div", "hint", "A developer set custom colours. Picking a palette replaces them.")).dataset.stab = "colours";
  }
  host.appendChild(card);
  mountSectionsCard();
  mountBlocksCard();
  mountFormsCard();    // Phase FB — the custom form builder (typed, structured, safe)
  mountDevCssCard();   // "Developer" story, layer 1 — advanced Custom CSS, off the no-code path
  mountTemplateGallery();   // #1 — template-first, big-preview gallery (top of the view)
  mountBlockTray();         // #3 — persistent, searchable add-block tray (left rail)
  renderPagesBar();         // Multi-page: Home + custom pages, click to author each
}
// ── Custom CSS (advanced) — the first layer of the safe "Developer" story ─────
// Deliberately OFF the main no-code path: a collapsed disclosure that appears ONLY
// for a user who can author custom CSS (can_edit_css from /dev/customization — the
// developer capability). Styling only: the server sanitizes to inert CSS (no
// scripts, no <style> breakout, no third-party url()) at save AND at render, and it
// applies to this owner's own published site, versioned with the snapshot. Saves
// through the SAME /dev/customization path as Design Studio (one machinery).
// Item 85: asked once per page. An owner without the capability has no card to find, so
// every redraw of the Styles cards used to ask the server again.
let DEV_CSS_ALLOWED = null;
let DESIGN_DEV = null;   // item 84: the colors card's read of /dev/customization, which this card reuses
async function mountDevCssCard() {
  const host = $("designHost") || $("view-business"); if (!host || $("devCssCard") || DEV_CSS_ALLOWED === false) return;
  let data = DESIGN_DEV;
  if (!data) { try { data = (await api("GET", "/dev/customization")).data; } catch (_) { return; } }
  DEV_CSS_ALLOWED = !!(data && data.can_edit_css);
  if (!DEV_CSS_ALLOWED) return;   // owners see the palette, not the advanced editor

  const wrap = el("details", "field"); wrap.id = "devCssCard"; wrap.style.marginTop = "18px"; wrap.dataset.stab = "looks";
  const sum = el("summary", null, "Custom CSS (advanced)");
  sum.style.cssText = "cursor:pointer;font-weight:600;font-size:13px;color:var(--plum-deep,#3a2470);list-style:none;padding:2px 0";
  wrap.appendChild(sum);
  wrap.appendChild(el("div", "hint", "Advanced: add your own CSS to fine-tune the look. Styling only — scripts aren’t allowed, so your site stays safe and fast. Changes apply next time you publish."));

  const ta = el("textarea"); ta.value = data.custom_css || "";
  ta.spellcheck = false; ta.setAttribute("aria-label", "Custom CSS");
  ta.style.cssText = "width:100%;min-height:200px;margin-top:10px;padding:11px;border:1px solid var(--line,#ddd);border-radius:8px;background:var(--card,#fff);color:var(--ink,#1b1525);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px;line-height:1.5;resize:vertical;tab-size:2";
  ta.placeholder = ".hero h1 { letter-spacing: -.02em; }";
  wrap.appendChild(ta);

  const note = el("div", "hint", ""); note.style.marginTop = "8px";
  const save = el("button", null, "Save custom CSS"); save.type = "button";
  save.style.cssText = "font:inherit;font-size:13px;font-weight:600;margin-top:12px;padding:8px 16px;border-radius:999px;border:2px solid var(--plum,#5b3fa0);background:var(--plum-tint,#faf7ff);color:var(--plum-deep,#3a2470);cursor:pointer";
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      const r = await api("PUT", "/dev/customization", { theme_tokens: DESIGN_TOKENS, custom_css: ta.value });
      const saved = (r.data && r.data.saved && r.data.saved.custom_css) || "";
      ta.value = saved;   // reflect exactly what was stored (post-sanitize)
      const adjusted = r.data && r.data.sanitized && r.data.sanitized.css;
      note.textContent = adjusted ? "Saved. Some CSS wasn’t allowed and was adjusted for safety." : "";
      toast("Custom CSS saved — publish to take it live"); scheduleChangesRefresh(); refreshDesignPreview();
    } catch (err) { toast(nice(err), true); }
    finally { save.disabled = false; }
  });
  wrap.appendChild(save); wrap.appendChild(note);
  host.appendChild(wrap);
}
// ── FD-T-LIB: the "Add a section" library — purpose-grouped, with familiar-name
//    aliases so owners recognize sections by the words they already know (carousel,
//    accordion, icon grid…). These reference BLOCK_DEFS *types* only — no type is
//    renamed. Every addable def appears under exactly one header below. ──
const SECTION_GROUPS = [
  { label: "Show your work", note: "Photos, video and the people behind the work.",
    types: ["gallery", "carousel", "before_after", "image", "image_text", "video", "team", "partners"] },
  { label: "Build trust", note: "Proof that turns visitors into customers.",
    types: ["features", "stats", "progress", "cards", "reviews_wall", "reviews", "certifications", "pricing", "process"] },
  { label: "Get customers to act", note: "Clear next steps — book, sign up, find you, or grab a file.",
    types: ["cta", "spotlight", "buttons", "booking", "appointment", "newsletter", "download", "map"] },
  { label: "Text & layout", note: "Your own words, columns, expandable details, and spacing.",
    types: ["stack", "title", "richtext", "columns", "tabs", "accordion", "table", "link_list", "divider", "toc"] },
  { label: "Info & updates", note: "Where you work, what's coming, and where to follow.",
    types: ["service_areas", "events", "social"] },
];
// A muted secondary label shown only where the common word differs from ours —
// display-only; the stored block.type never changes.
const SECTION_ALIAS = {
  stack: "build your own: heading, text, photo, button",
  gallery: "carousel / grid", before_after: "before/after slider", video: "embed",
  team: "staff / about us", partners: "logo cloud / clients",
  features: "highlights / icon grid", stats: "counters / metrics", reviews: "star rating",
  certifications: "badges / accreditations", pricing: "plans / tiers", process: "steps / timeline",
  cta: "banner", appointment: "book / schedule (link out)", booking: "appointments / scheduler", newsletter: "email sign-up", map: "location map",
  service_areas: "service area", events: "calendar", social: "social icons",
  richtext: "text / paragraph", image: "photo", image_text: "image + words",
  accordion: "expandable / toggle", tabs: "tabbed sections", carousel: "slideshow", progress: "skill bars / meters", buttons: "button / link", divider: "spacer / line",
  columns: "columns / grid", cards: "feature cards / tiles", download: "file / PDF", toc: "on this page / jump links",
  title: "heading / section title", link_list: "links / resources", table: "data table / grid", spotlight: "highlight / feature banner",
};
// Builder item 324: the words an owner types into the search, for the tiles that answer them.
// Searched, never shown: the line under a tile stays short.
const SECTION_FINDS = {
  accordion: "faq faqs questions answers", tabs: "faq questions", toc: "jump links",
  reviews_wall: "testimonial testimonials reviews what customers say", reviews: "testimonial testimonials stars",
  partners: "clients brands", cta: "contact call hero", spotlight: "hero welcome", title: "headline",
  image_text: "about story", image: "picture", gallery: "pictures portfolio",
  newsletter: "form subscribe mailing list", booking: "form reservations reserve contact", appointment: "contact reservations reserve",
  map: "contact address directions location find us", social: "contact instagram facebook follow",
  pricing: "menu prices price list", richtext: "blog article story about", link_list: "blog articles", events: "calendar classes",
  team: "about us people", stats: "numbers", service_areas: "where we work locations",
};
// The things an owner looks for that aren't a section to add: a tile each, in its group, that opens
// where it is made (the Forms card adds a contact form; the rest are edited beside the page).
const SECTION_ROUTES = [
  { key: "contact_form", group: "Get customers to act", icon: "mail", name: () => "Contact form", alias: "message / enquiry form", finds: "form forms contact enquiry inquiry message get in touch email us",
    says: "Add a contact form to this page; its answers come to your Inbox", go: () => trayAddContactForm() },
  { key: "opening_photo", group: "Show your work", icon: "image", name: () => "Opening with a photo", alias: "hero / welcome", finds: "hero opening welcome banner cover top header photo",
    says: "Choose how your home page opens: words over your photo, or beside it", go: () => trayOpenHeroLayouts() },
  { key: "hours", group: "Info & updates", icon: "clock", name: () => "Hours", alias: "opening times", finds: "hours opening times open closed when schedule",
    says: "Your opening hours, in Business details beside the page", go: () => trayOpenBusiness("bizHoursH", "#hoursGrid input, #hoursGrid button") },
  { key: "menu", group: "Info & updates", icon: "list", name: () => vocabCap((typeof VOCAB === "object" && VOCAB && VOCAB.label) || "Menu"), alias: "price list", finds: "menu services food drinks dishes price list prices offerings",
    says: "What you offer and its prices, beside the page", go: () => eeEditCore("offerings") },
  { key: "updates", group: "Info & updates", icon: "text", name: () => "Updates", alias: "blog / news", finds: "blog posts news articles updates",
    says: "Your Updates page, your site’s blog, beside the page", go: () => eeEditCore("updates") },
];
// The CORE sections aren't blocks — they're edited in their own tabs. We surface
// them read-only so an owner hunting for "hero / FAQ" sees they already have them.
// Each chip routes via go() to the view that edits it.
const CORE_SECTIONS = [
  ["Hero", "business"], ["About", "business"], ["Services / Menu", "offerings"],
  ["Testimonials", "testimonials"], ["FAQ", "faqs"], ["Updates", "updates"],
  ["Hours", "business"], ["Location", "business"], ["Contact", "business"],
];
// Item 158: the site's own small icon, shown the way a browser tab shows it. With none, the
// template's letter in the site's colour; "Choose a picture" opens Photos, and the letter
// comes back with one press. It's a page setting like the logo, so it goes live on publish.
function siteIconRow() {
  const row = el("div", "si-row"); row.dataset.stab = "looks"; row.id = "siteIconRow";
  const paint = () => {
    row.textContent = "";
    row.appendChild(el("div", "si-lbl", "Site icon"));
    const id = S.settings && S.settings.icon_media_id, m = id && (S.media || []).find((x) => x.id === id);
    const name = String((S.identity && S.identity.business_name) || "").trim() || "Your website", letter = name.charAt(0).toUpperCase();
    const tab = el("div", "si-tab"); tab.setAttribute("role", "img");
    tab.setAttribute("aria-label", "How your site shows in a browser tab: " + (m && m.thumb ? "your picture" : "the letter " + letter) + " and " + name);
    if (m && m.thumb) { const im = el("img"); im.src = m.thumb; im.alt = ""; tab.appendChild(im); }
    else tab.appendChild(el("span", "si-letter", letter));
    tab.appendChild(el("span", "si-name", name));
    row.appendChild(tab);
    row.appendChild(el("div", "hint", id ? "Your picture, in every browser tab and on a phone’s home screen. A square picture with little detail shows best." : "Now: the first letter of your business name, in your colour. Pick a square picture with little detail for a sharper mark."));
    const acts = el("div", "si-acts");
    const choose = el("button", null, id ? "Choose another picture" : "Choose a picture"); choose.type = "button";
    choose.addEventListener("click", () => openPicker((pick) => { if (pick) setSiteIcon(pick, paint); }));
    acts.appendChild(choose);
    if (id) { const back = el("button", null, "Use the letter"); back.type = "button"; back.addEventListener("click", () => setSiteIcon(null, paint)); acts.appendChild(back); }
    row.appendChild(acts);
  };
  paint();
  return row;
}
async function setSiteIcon(id, after) {
  try {
    await settingsPut({ icon_media_id: id });
    S.settings = { ...(S.settings || {}), icon_media_id: id };
    toast(id ? "Site icon set — publish to apply" : "Back to the letter — publish to apply"); scheduleChangesRefresh();
    if (after) after();
  } catch (err) { toast(nice(err), true); }
}
function mediaThumb(id) {
  const m = (S.media || []).find((x) => x.id === id);
  const wrap = el("span"); wrap.style.cssText = "display:inline-block;width:52px;height:52px;border-radius:8px;overflow:hidden;background:var(--wash,#eee);vertical-align:middle";
  if (m && m.thumb) { const img = el("img"); img.src = m.thumb; img.alt = m.alt_text || ""; img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block"; wrap.appendChild(img); }
  return wrap;
}
let BLOCK_SUGGEST = null;   // FD-T4: { blocks:[type…], note } from the server (no client-side preset map)
let CL_ITEMS = null;        // CL-1: saved content-library items (null = not loaded)
let CL_SHOW = false;
let CL_LOADING = false;     // CL-LINK: one-shot guard for the lazy saved-items load
async function clSave(idx) {   // CL-1: save a crafted section to the reusable library
  const blk = BLOCKS_WORK[idx]; const def = BLOCK_DEFS.find((d) => d.type === blk.type);
  const name = await askText("Name this saved section", { value: blk.title || (def && def.name) || "Saved section", ok: "Save" });
  if (name === null) return;
  api("POST", "/content-library", { name, block: blk }).then(() => { CL_ITEMS = null; toast("Saved to your content library"); }).catch((err) => toast(nice(err), true));
}
async function clInsert(block) {   // CL-1: insert a saved block into the SAME editor (no second editor)
  if (!block || !block.type) return;
  const def = BLOCK_DEFS.find((d) => d.type === block.type);
  const copy = JSON.parse(JSON.stringify(block));
  // MULTI-INSTANCE (columns/cards): always add a fresh copy with a new id — never
  // offer to replace, since a site can hold several.
  if (def && def.multi) { copy.id = uniqueBlockId(block.type); BLOCKS_WORK.push(copy); }
  else if (!BLOCK_SINGLETON.has(block.type)) { BLOCKS_WORK.push(copy); }   // repeatable → just add another copy
  else {
    const at = BLOCKS_WORK.findIndex((b) => b.type === block.type);
    if (at >= 0) {
      if (!(await askYes("You already have a “" + ((def && def.name) || block.type) + "” section. Replace it with the saved one?", { ok: "Replace it", danger: true }))) return;
      const now = BLOCKS_WORK.findIndex((b) => b.type === block.type);   // read again: the list can move while the question is up
      if (now >= 0) BLOCKS_WORK[now] = copy; else BLOCKS_WORK.push(copy);
    }
    else BLOCKS_WORK.push(copy);
  }
  CL_SHOW = false; renderBlocksCard(); toast("Inserted a copy");
}
// CL-LINK: insert a saved section as a LINK — the page stores only a reference to
// the saved item; at publish, it resolves to the saved section's CURRENT content,
// so editing the saved section updates every linked placement. Opt-in, alongside
// the copy option above. (The server resolves the ref at serialize time.)
function clInsertLink(item) {
  if (!item || !item.id) return;
  BLOCKS_WORK.push({ type: "linked", ref: item.id });
  CL_SHOW = false; renderBlocksCard(); toast("Linked — edits to the saved section update everywhere");
}
function clItemById(ref) { return (CL_ITEMS || []).find((x) => x.id === ref) || null; }
// CL-LINK: push the edited saved-section content back to the ONE library item — this
// updates every linked placement (at next publish). Then revert this slot to a link.
async function clUpdateSource(idx) {
  const blk = BLOCKS_WORK[idx]; const ref = blk && blk._clEdit; if (!ref) return;
  const clean = { ...blk }; delete clean._clEdit;   // strip the transient edit marker
  try {
    const r = await api("PUT", "/content-library/" + ref, { block: clean });
    if (CL_ITEMS && r && r.data) { const it = CL_ITEMS.find((x) => x.id === ref); if (it) { it.block = r.data.block; it.name = r.data.name; } }
    BLOCKS_WORK[idx] = { type: "linked", ref };
    renderBlocksCard();
    toast("Updated — every linked spot shows this after you publish");
  } catch (err) { toast(nice(err), true); }
}
// CL-LINK: a linked placement — a labeled, read-only chip (its content is the saved
// section). Opt-in labeling makes the difference from a copy unmistakable, and a
// missing/deleted saved section degrades gracefully (the spot just won't appear).
function renderLinkedChip(blk, idx, card) {
  const miniBtn = "font:inherit;font-size:12px;padding:2px 9px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  const item = clItemById(blk.ref);
  const sub = el("div"); sub.id = "blkSub-" + idx; sub.className = "blk-sub"; sub.style.cssText = "border:1px solid var(--plum-line,#d9cef0);border-radius:12px;padding:12px 14px;margin-top:10px;background:var(--plum-tint,#faf7ff)";
  const head = el("div"); head.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap";
  const nm = el("div", null, "Linked section" + (item ? " · " + item.name : "")); nm.style.cssText = "flex:1;min-width:150px;font-weight:600;font-size:13px;color:var(--plum-deep,#3a2470)";
  const up = icoBtn("up", "Move this section up", null, 14), dn = icoBtn("down", "Move this section down", null, 14), rm = el("button", null, "Remove");
  [up, dn, rm].forEach((b) => { b.type = "button"; b.style.cssText = miniBtn; });
  up.disabled = idx === 0; dn.disabled = idx === BLOCKS_WORK.length - 1;
  if (up.disabled) up.style.opacity = ".35"; if (dn.disabled) dn.style.opacity = ".35";
  up.addEventListener("click", () => { if (idx === 0 || lockStop(idx)) return; panelSwap(idx, idx - 1); renderBlocksCard(); });
  dn.addEventListener("click", () => { if (idx === BLOCKS_WORK.length - 1 || lockStop(idx)) return; panelSwap(idx, idx + 1); renderBlocksCard(); });
  rm.addEventListener("click", () => { if (lockStop(idx)) return; panelRemove(idx); renderBlocksCard(); });
  head.append(nm, up, dn, rm); sub.appendChild(head);
  if (!item && CL_ITEMS !== null) {
    sub.appendChild(el("div", "hint", "The saved section this links to was removed, so this spot simply won’t appear on your site. Remove it here to tidy up."));
    card.appendChild(sub); return;
  }
  const typeName = item ? ((BLOCK_DEFS.find((d) => d.type === (item.block && item.block.type)) || {}).name || "") : "";
  sub.appendChild(el("div", "hint", "Linked" + (typeName ? " " + typeName.toLowerCase() : "") + " — edits to the saved section update everywhere it’s linked. Edit the saved section to change it in every spot, or make it independent to edit just this one."));
  const row = el("div"); row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px";
  const edit = el("button", null, "Edit the saved section"); edit.type = "button"; edit.style.cssText = "font:inherit;font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;border:2px solid var(--plum,#5b3fa0);background:var(--sheet,#fff);color:var(--plum-deep,#3a2470);cursor:pointer";
  edit.disabled = !item;
  edit.addEventListener("click", () => {
    const it = clItemById(blk.ref); if (!it || !it.block) { toast("Loading the saved section…"); return; }
    BLOCKS_WORK[idx] = Object.assign(JSON.parse(JSON.stringify(it.block)), { _clEdit: blk.ref }); renderBlocksCard();
    // G8: editing a LIVE-LINKED entry first shows where it appears
    const uses = Array.isArray(it.used_on) ? it.used_on : [];
    if (uses.length > 1) toast("This section appears on: " + uses.map((u) => u.title).join(", ") + " — changes will show everywhere");
  });
  const indep = el("button", null, "Make independent"); indep.type = "button"; indep.style.cssText = miniBtn;
  indep.addEventListener("click", () => { const it = clItemById(blk.ref); if (!it || !it.block) { toast("Loading the saved section…"); return; } const copy = JSON.parse(JSON.stringify(it.block)); const d = BLOCK_DEFS.find((x) => x.type === copy.type); if (d && d.multi) copy.id = uniqueBlockId(copy.type); BLOCKS_WORK[idx] = copy; renderBlocksCard(); toast("Now independent — edits here won’t affect other places"); });
  row.append(edit, indep); sub.appendChild(row);
  card.appendChild(sub);
}
function dcPageTitle(slug) { const b = dcBuiltinPage(slug); if (b) return b.title; const p = dcPageList().find((x) => x.slug === slug); return p ? p.title : "Home"; }
// The page tabs live in the Pages card now (renderPagesCard, drawn with the Pages tab's lists).
function renderPagesBar() {
  if (typeof renderPagesList === "function") renderPagesList();
  formsFollowPage();
  dcSyncPageSwitch();
}
// the page on the canvas, scrolled into the card's view
function pagesBarReveal() {
  const sc = $("pcBody"), cur = sc && sc.querySelector(".pc-row.on"); if (!cur) return;
  const a = sc.getBoundingClientRect(), b = cur.getBoundingClientRect();
  if (b.top < a.top || b.bottom > a.bottom) sc.scrollTop += b.top - a.top - 60;
}
// G13: a page change replaces BLOCKS_WORK or reads the stored draft, so what this page
// still holds is written first, while DC_PAGE still says whose it is: an open in-place
// session, a commit in its ~1.2s debounce, a panel edit in its 700ms timer. A save
// already on its way is waited out too, because the caller needs to know it worked.
// It loops because the page stays open during the wait. False = a
// save failed: its message is up and the words are still in the list, so the caller
// stays on this page. keepSession leaves an open session typing, for a write that isn't
// a page change (a form's timer can fire while someone types on the canvas).
async function dcSavePendingEdits(keepSession) {
  if (IDE && !keepSession) ideEnd(true);
  await Promise.all([IDE_SAVING, debounceFlush("identity:"), debounceFlush("location:")]);
  for (;;) {
    if (IPE && !keepSession) ipeCommit();
    const put = BLOCKS_PUT || (IPE_SAVE_T != null || IPE_SAVE_PENDING ? ipeSaveNow() : blocksDirty() ? blocksSaveNow() : null);
    if (!put) return true;
    if (!(await put)) return false;
  }
}
// Point the editor at a page, canvas at the top. The caller has just run dcSavePendingEdits.
// The document still on the canvas is the page just left, and its stamps index a list
// that's gone: whatever it sent would land on this page at the same index. So it stays
// in view but inert until this page's document loads, and dcFrameDoc stops offering it.
// A past version in Timewarp stays readable, since no load comes until "Back to today".
let DC_PAGE_OPENS = 0;   // which opening of a page this is; a read or a load belongs to one
function dcOpenPage(slug) {
  DC_PAGE = slug; DC_PAGE_OPENS++; DC_SCROLL = null; DC_FOCUS_BI = null; dcResetHistory(); BLOCKS_WORK = currentBlocks(); BLOCK_FOCUS = null;
  const frame = $("designPreview");
  if (!frame || (DC_MODE === "timewarp" && DC_TW_LOADED)) return;
  if (PDRAG) pdFinish(false);   // a drag from the old rows or document can't land on this list
  frame.inert = true; dcRefreshTree();
}
// The page a link on the canvas points at, as the canvas names it: "" for Home, a page's slug,
// else null (another site, a post, an anchor).
function dcPageForHref(href) {
  let path = String(href || "").trim(); if (!path) return null;
  try { const u = new URL(path, "https://x.example/"); if (u.origin !== "https://x.example") return null; path = u.pathname; } catch (_) { return null; }
  if (!/\/$/.test(path)) path += "/";
  if (path === "/") return "";
  const m = /^\/([a-z0-9-]+)\/$/.exec(path);
  if (m && dcPageObj(m[1])) return m[1];
  return typeof dcBuiltinForPath === "function" ? dcBuiltinForPath(path) : null;
}
// Where a switch waiting on its save is headed. Another click only changes this, so the
// last page asked for wins however slow the save is.
let DC_SWITCH_TO = null;
async function dcSwitchPage(slug) {
  slug = slug || "";
  if (DC_SWITCH_TO != null) { DC_SWITCH_TO = slug; return false; }
  if (slug === DC_PAGE) return true;
  DC_SWITCH_TO = slug;
  const saved = await dcSavePendingEdits();
  const to = DC_SWITCH_TO; DC_SWITCH_TO = null;
  if (!saved) return false;
  if (to === DC_PAGE) return to === slug;
  // Slice D (least-code choice): a page switch leaves Timewarp — the banner's
  // date claim must never sit over a freshly-loaded draft. Preview simply stays
  // on: the new page loads chrome-free, which is exactly what Preview means.
  if (DC_MODE === "timewarp") dcSetMode("edit");
  dcOpenPage(to);
  renderPagesBar(); renderBlocksCard(); refreshDesignPreview();
  toast("Now editing: " + dcPageTitle(DC_PAGE));
  return to === slug;
}
// ── Builder list item 216: Add a page with a picture of every ready-made page ──
// Grouped by what the page is for (GET /pages/ready, lib/page_layouts.ts; the pictures are
// thumbs/pages, made by scripts/thumbnails), and the studio's own saved pages on top
// (GET /agency/pages). A saved page lands with its photos copied into this site
// (POST /pages/from-saved). One native <dialog>: the page behind is inert, Escape closes it
// and focus goes back where it was. On a phone it is a sheet, the groups chips along the top.
let AP_READY = null;     // { groups, pages, recommended } once read
let AP_SAVED = null;     // the studio's saved pages once read
let AP_SAVED_ON = false; // the studio's list answered (before the backend deploy it can't)
let AP_SMALL = false;    // the Small pictures switch, for this visit
async function apReady() {
  if (AP_READY) return AP_READY;
  try {
    const d = (await api("GET", "/pages/ready")).data;
    if (d && Array.isArray(d.pages) && d.pages.length) { AP_READY = d; return d; }
  } catch (_) { /* a server from before item 216: its home layouts, below */ }
  if (BLOCK_SUGGEST === null || BLOCK_SUGGEST === undefined) { try { BLOCK_SUGGEST = (await api("GET", "/blocks/suggested")).data || false; } catch (_) { BLOCK_SUGGEST = false; } }
  const starters = (BLOCK_SUGGEST && Array.isArray(BLOCK_SUGGEST.starters)) ? BLOCK_SUGGEST.starters : [];
  return { groups: [{ key: "home", name: "Home pages", line: "Whole front pages, laid out for a kind of business." }],
    pages: starters.map((s) => ({ ...s, group: "home", title: "Welcome", slug: "welcome" })), recommended: BLOCK_SUGGEST ? BLOCK_SUGGEST.recommendedStarter : null };
}
async function apSaved(fresh) {
  if (!S.isStudio) return [];
  if (AP_SAVED && !fresh) return AP_SAVED;
  try {
    const r = await api("GET", "/agency/pages");
    AP_SAVED = Array.isArray(r && r.data) ? r.data : [];
    AP_SAVED_ON = !!r && r.available !== false;
  } catch (_) { AP_SAVED = []; AP_SAVED_ON = false; }   // before the deploy, or unreadable: no Saved group, quietly
  return AP_SAVED;
}
const apSlug = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "page";
const apCount = (n, one) => n + " " + one + (n === 1 ? "" : "s");
const apDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
// The dialog. "add" (＋ Add page) names the new page and offers the studio's saved pages;
// "apply" (an empty page's Choose a template) drops a layout onto the page on the canvas.
// Resolves null (closed), or { kind: "blank" | "ready" | "saved", name, blocks, slug, saved }.
async function dcChoosePageLayout(opts) {
  opts = opts || {};
  const add = opts.mode !== "apply";
  const opener = document.activeElement;
  const [ready, saved] = await Promise.all([apReady(), add ? apSaved() : Promise.resolve([])]);
  const toName = (S.identity && S.identity.business_name) || "";
  return new Promise((resolve) => {
    const dlg = el("dialog", "ap-dlg" + (AP_SMALL ? " small" : "")); dlg.setAttribute("aria-labelledby", "apTitle");
    const head = el("div", "ap-head"), tt = el("div", "ap-tt");
    const h = el("h2", "ap-h", add ? "Add a page" : "Choose a layout for “" + (opts.title || "this page") + "”"); h.id = "apTitle";
    tt.append(h, el("p", "ap-sub", add ? "Pick a page by how it looks. It arrives as sections you can change, with words for you to replace." : "Pick a layout by how it looks. It arrives on this page as sections you can change."));
    head.appendChild(tt);
    let nameIn = null, typed = false;
    if (add) {
      const lab = el("label", "ap-name"); lab.appendChild(el("span", null, "Page name"));
      nameIn = el("input"); nameIn.type = "text"; nameIn.maxLength = 60; nameIn.autocomplete = "off"; nameIn.placeholder = "e.g. Services, Gallery, Pricing";
      nameIn.addEventListener("input", () => { typed = !!nameIn.value.trim(); sync(); });
      nameIn.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); goNow(); } });
      lab.appendChild(nameIn); head.appendChild(lab);
    }
    const size = el("div", "ap-size"); size.setAttribute("role", "group"); size.setAttribute("aria-label", "Picture size");
    [["Big pictures", false], ["Small", true]].forEach(([label, small]) => {
      const b = el("button", null, label); b.type = "button"; b.setAttribute("aria-pressed", String(AP_SMALL === small));
      b.addEventListener("click", () => { AP_SMALL = small; dlg.classList.toggle("small", small); size.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
      size.appendChild(b);
    });
    head.appendChild(size);
    const close = el("button", "pillbtn ap-close", "Close"); close.type = "button"; close.addEventListener("click", () => finish(null));
    head.appendChild(close);
    const body = el("div", "ap-body");
    const nav = el("nav", "ap-nav"); nav.setAttribute("aria-label", "Kinds of page");
    const chips = el("div", "ap-chips"); chips.setAttribute("role", "group"); chips.setAttribute("aria-label", "Kinds of page");
    const grid = el("div", "ap-grid");
    body.append(nav, chips, grid);
    const foot = el("div", "ap-foot");
    const line = el("p", "ap-line"); line.setAttribute("aria-live", "polite");
    const cancel = el("button", "pillbtn ap-cancel", "Cancel"); cancel.type = "button"; cancel.addEventListener("click", () => finish(null));
    const go = el("button", "pillbtn inked ap-go"); go.type = "button"; go.addEventListener("click", () => goNow());
    foot.append(line, cancel, go);
    dlg.append(head, body, foot);

    let pick = null;                 // { kind, item }
    const cards = [];                // { btn, item }
    const BLANK = { key: "_blank", name: "Blank page", blocks: [] };
    const sections = {};             // group key → its <section>
    const toGroup = (key) => { const s = sections[key]; if (s) { s.scrollIntoView({ block: "start" }); chips.querySelectorAll(".ap-chip").forEach((c) => c.classList.toggle("on", c.dataset.group === key)); } };
    const navItem = (label, key, onClick, o) => {
      const b = el("button", "ap-nb" + (o && o.strong ? " strong" : "")); b.type = "button"; if (key) b.dataset.key = key;
      b.appendChild(el("span", "ap-nbt", label));
      if (o && o.count !== undefined) b.appendChild(el("span", "ap-cnt", String(o.count)));
      b.addEventListener("click", onClick); nav.appendChild(b); return b;
    };
    const chip = (label, group, onClick) => { const b = el("button", "ap-chip", label); b.type = "button"; b.dataset.group = group; b.addEventListener("click", onClick); chips.appendChild(b); return b; };
    const choose = (kind, item, scroll) => {
      pick = { kind, item };
      cards.forEach((c) => { const on = c.item === item; c.btn.classList.toggle("on", on); c.btn.setAttribute("aria-pressed", String(on)); });
      nav.querySelectorAll(".ap-nb[data-key]").forEach((b) => b.classList.toggle("on", b.dataset.key === (item.key || item.id)));
      if (nameIn && !typed) nameIn.value = kind === "ready" ? (item.title || item.name) : kind === "saved" ? item.name : "";
      if (scroll) { const c = cards.find((x) => x.item === item); if (c) c.btn.scrollIntoView({ block: "nearest" }); }
      sideFor(kind === "saved" ? item : null);
      sync();
    };
    const card = (kind, item, recommended) => {
      const b = el("button", "ap-card"); b.type = "button"; b.setAttribute("aria-pressed", "false"); b.dataset.key = item.key || item.id;
      if (kind === "ready") {
        const img = el("img", "ap-pic"); img.src = "/thumbs/pages/" + item.key + ".jpg"; img.alt = ""; img.loading = "lazy"; img.width = 440; img.height = 460;
        img.addEventListener("error", () => img.classList.add("gone"));
        b.appendChild(img);
      } else {
        // a saved page's picture: its own sections' pictures, in order
        const st = el("span", "ap-stack"); st.setAttribute("aria-hidden", "true");
        (Array.isArray(item.outline) ? item.outline : []).slice(0, 5).forEach((t) => { const im = el("img"); im.src = "/thumbs/sections/" + t + ".jpg"; im.alt = ""; im.loading = "lazy"; im.addEventListener("error", () => im.remove()); st.appendChild(im); });
        b.appendChild(st);
      }
      const nm = el("span", "ap-cname"); nm.appendChild(el("span", "ap-cn", item.name));
      if (recommended) nm.appendChild(el("span", "ap-sugg", "Suggested"));
      nm.appendChild(el("span", "ap-picked", "✓ Picked"));
      b.appendChild(nm);
      const sum = item.summary || {};
      b.appendChild(el("span", "ap-cline", kind === "ready" ? (item.description || "")
        : ((item.from_name ? "From " + item.from_name : "Saved") + (item.created_at ? " · " + apDate(item.created_at) : "") + "\n" + apCount(sum.sections || 0, "section") + (sum.photos ? " · " + apCount(sum.photos, "photo") : ""))));
      b.addEventListener("click", () => choose(kind, item));
      b.addEventListener("dblclick", () => { choose(kind, item); goNow(); });
      cards.push({ btn: b, item });
      return b;
    };
    const group = (key, name, lineText) => {
      const sec = el("section", "ap-grp"); sec.dataset.group = key; sec.setAttribute("aria-labelledby", "apG-" + key);
      const gh = el("h3", "ap-gh", name); gh.id = "apG-" + key;
      sec.append(gh, el("p", "ap-gline", lineText));
      grid.appendChild(sec); sections[key] = sec;
      return sec;
    };
    // the studio's saved pages, and what comes across with the picked one
    let side = null;
    const sideFor = (it) => {
      if (!side) return;
      side.hidden = !it; side.innerHTML = "";
      if (!it) return;
      const sum = it.summary || {};
      side.appendChild(el("h4", "ap-sh", it.name));
      side.appendChild(el("strong", null, "What comes across"));
      const ul = el("ul");
      const li = (yes, text) => { const x = el("li", yes ? "yes" : "no"); x.appendChild(el("b", null, yes ? "✓" : "✕")); x.appendChild(el("span", null, text)); ul.appendChild(x); };
      li(true, apCount(sum.sections || 0, "section") + ", with their words and layout");
      if (sum.photos) li(true, apCount(sum.photos, "photo") + ", copied into this site’s Files");
      if (it.from_name && toName && it.from_name !== toName) li(true, "“" + it.from_name + "” in the words becomes “" + toName + "”");
      li(false, "Never: business details, hours, reviews, or links to the old business’s pages");
      side.appendChild(ul);
      if (S.ctx && S.ctx.scope) side.appendChild(el("p", "ap-note", "Until each copied section is changed, Publish lists it as copied from another site, so nothing goes live by accident. One press keeps them as they are."));
      const acts = el("div", "ap-acts2");
      const ren = el("button", "textact", "Rename"); ren.type = "button";
      ren.addEventListener("click", async () => {
        const name = await askText("Rename this saved page", { value: it.name, ok: "Rename" });
        if (!name || !name.trim() || name.trim() === it.name) return;
        try { await api("PATCH", "/agency/pages/" + it.id, { name: name.trim() }); it.name = name.trim(); const c = cards.find((x) => x.item === it); if (c) c.btn.querySelector(".ap-cn").textContent = it.name; if (nameIn && !typed) nameIn.value = it.name; sideFor(it); sync(); toast("Renamed."); }
        catch (err) { toast(nice(err), true); }
      });
      const rm = el("button", "textact danger", "Remove from studio"); rm.type = "button";
      rm.addEventListener("click", async () => {
        if (!(await askYes("Remove “" + it.name + "” from your studio? Sites it was added to keep their page.", { ok: "Remove", danger: true }))) return;
        try {
          await api("DELETE", "/agency/pages/" + it.id);
          AP_SAVED = (AP_SAVED || []).filter((x) => x !== it);
          const c = cards.find((x) => x.item === it); if (c) { c.btn.remove(); cards.splice(cards.indexOf(c), 1); }
          const cnt = nav.querySelector(".ap-nb[data-group='saved'] .ap-cnt"); if (cnt) cnt.textContent = String(AP_SAVED.length);
          pick = null; sideFor(null); sync(); toast("Removed from your studio.");
        } catch (err) { toast(nice(err), true); }
      });
      acts.append(ren, rm); side.appendChild(acts);
    };
    if (add) {
      navItem("＋  Blank page", "_blank", () => choose("blank", BLANK), { strong: true });
      chip("Blank", "_blank", () => choose("blank", BLANK));
      if (S.isStudio && AP_SAVED_ON) {
        const sb = navItem("★  Saved by your studio", null, () => toGroup("saved"), { strong: true, count: saved.length }); sb.dataset.group = "saved";
        chip("Saved", "saved", () => toGroup("saved"));
        const sec = group("saved", "Saved by your studio", "Pages you saved from any client’s site. Only your studio sees this group; clients never do.");
        if (!saved.length) sec.appendChild(el("p", "ap-empty", "Nothing saved yet. Open a page’s ⋯ menu and choose Save to your studio."));
        else {
          const wrap = el("div", "ap-saved-wrap"), list = el("div", "ap-cards");
          saved.forEach((it) => list.appendChild(card("saved", it)));
          side = el("aside", "ap-side"); side.hidden = true; side.setAttribute("aria-label", "What comes across");
          wrap.append(list, side); sec.appendChild(wrap);
        }
      }
    }
    const groups = Array.isArray(ready.groups) ? ready.groups : [];
    groups.forEach((g) => {
      const pages = (ready.pages || []).filter((p) => p.group === g.key);
      if (!pages.length) return;
      const lbl = el("div", "ap-gl", g.name); nav.appendChild(lbl);
      if (g.key === "home") navItem(apCount(pages.length, "home page"), null, () => toGroup("home"), { count: pages.length });
      else pages.forEach((p) => navItem(p.name, p.key, () => choose("ready", p, true)));
      chip(g.key === "home" ? "Home" : g.name, g.key, () => toGroup(g.key));
      const sec = group(g.key, g.name, g.line || "");
      const list = el("div", "ap-cards");
      // the home layout this kind of business suits comes first
      const ordered = g.key === "home" && ready.recommended ? [...pages.filter((p) => p.key === ready.recommended), ...pages.filter((p) => p.key !== ready.recommended)] : pages;
      ordered.forEach((p) => list.appendChild(card("ready", p, g.key === "home" && p.key === ready.recommended)));
      sec.appendChild(list);
    });
    if (!cards.length && !add) grid.appendChild(el("p", "ap-empty", "No ready-made layouts could be read just now. Add sections to this page from Add."));
    function sync() {
      const nm = nameIn ? nameIn.value.trim() : "";
      if (!pick) {
        line.textContent = add ? "Pick a page, or start with a blank one." : "Pick a layout for this page.";
        go.textContent = add ? "Add the page" : "Use this layout"; go.disabled = true; return;
      }
      const it = pick.item, sum = it.summary || {};
      line.textContent = pick.kind === "blank" ? "A blank page. Add sections to it once it’s made."
        : pick.kind === "ready" ? it.name + " comes in with " + apCount((it.blocks || []).length, "section") + ". Its words are examples to replace; nothing is live until you publish."
        : it.name + " comes in as a new page with " + apCount(sum.sections || 0, "section") + (sum.photos ? " and " + apCount(sum.photos, "photo") : "") + ". Nothing is live until you publish.";
      if (add && !nm) line.textContent += " Give it a name first.";
      go.textContent = !add ? "Use this layout" : pick.kind === "saved" ? "Add " + (nm || it.name) + " to this site" : "Add the " + (nm || "new") + " page";
      go.disabled = add && !nm;
    }
    function goNow() {
      if (!pick || go.disabled) return;
      const nm = nameIn ? nameIn.value.trim().slice(0, 60) : "";
      const it = pick.item;
      if (pick.kind === "saved") finish({ kind: "saved", name: nm, saved: it });
      else finish({ kind: pick.kind, name: nm, blocks: it.blocks || [], slug: pick.kind === "ready" && (!typed || nm === (it.title || it.name)) ? it.slug : null });
    }
    let done = false;
    function finish(v) {
      if (done) return; done = true;
      try { dlg.close(); } catch (_) {}
      dlg.remove();
      // back where it was; ＋ Add page closes the Pages card first, so its switch takes the focus then
      const back = [opener, opts.returnTo].find((n) => n && n !== document.body && n.isConnected && n.getClientRects().length > 0 && !n.closest("[aria-hidden='true'],[inert]"));
      try { if (back) back.focus({ preventScroll: true }); } catch (_) {}
      resolve(v);
    }
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    document.body.appendChild(dlg);
    sync();
    dlg.showModal();
    setTimeout(() => { try { (nameIn || (cards[0] && cards[0].btn) || close).focus({ preventScroll: true }); } catch (_) {} }, 20);
  });
}
async function dcAddPage() {
  const pick = await dcChoosePageLayout({ mode: "add", returnTo: $("dcPageSwitch") });
  if (!pick) return;
  const title = String(pick.name || "").trim().slice(0, 60);
  if (!title) return;
  const base = pick.slug && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(pick.slug) ? pick.slug.slice(0, 40) : apSlug(title);
  const taken = new Set(dcPagesArr().map((p) => p.slug));
  let slug = base, n = 1; while (taken.has(slug) || DC_PAGE_RESERVED.has(slug)) slug = base + "-" + (++n);
  if (pick.kind === "saved") return dcAddSavedPage(pick.saved, title, slug);
  if (!(await dcSavePendingEdits())) return;
  const blocks = JSON.parse(JSON.stringify(pick.blocks || [])).map((b) => { if (b && b.id) b.id = uniqueBlockId(b.type + "_" + b.id); return b; });
  try {
    await settingsPut(() => {
      const body = { pages: [...dcPagesArr(), { slug, title, blocks }] };
      if (pgHasCustomNav() && S.settings.nav.length < PG_NAV_MAX) body.nav = [...S.settings.nav, { label: title.slice(0, 40), href: "/" + slug + "/" }];
      return body;
    });
    if (!(await dcSavePendingEdits())) { renderPagesBar(); return; }   // anything typed during that write stays on its own page
    dcOpenPage(slug);
    renderPagesBar(); renderBlocksCard(); refreshDesignPreview();
    toast("Page “" + title + "” created. Change its words, then publish.");
  } catch (err) { toast(nice(err), true); }
}
// A page saved to the studio lands here: the server copies its photos and saved sections into
// this site and rewrites the page list from what it has stored, so this takes a turn too.
async function dcAddSavedPage(saved, title, slug) {
  if (!(await dcSavePendingEdits())) return;
  try {
    const d = await settingsTurn(async () => {
      const r = await api("POST", "/pages/from-saved", { saved_id: saved.id, title, slug });
      const got = (r && r.data) || {};
      S.settings = { ...(S.settings || {}), pages: Array.isArray(got.pages) ? got.pages : dcPagesArr(), ...(Array.isArray(got.nav) ? { nav: got.nav } : {}) };
      return got;
    });
    CL_ITEMS = null;   // the saved sections it links to are this site's own now
    if (!(await dcSavePendingEdits())) { renderPagesBar(); return; }
    if (d.slug) dcOpenPage(d.slug);
    renderPagesBar(); renderBlocksCard(); refreshDesignPreview();
    api("GET", "/media").then((m) => { if (m && Array.isArray(m.data)) S.media = m.data; }).catch(() => {});   // its photos are in Files now
    toast("“" + (d.title || title) + "” added from your studio. Change its words for this business, then publish." + (d.photos_failed ? " " + apCount(d.photos_failed, "photo") + " couldn’t be copied." : ""));
  } catch (err) { toast(nice(err), true); }
}
// Apply a chosen layout to the CURRENT (empty) page: the empty canvas's "Choose a template".
async function dcPickAndApplyLayout() {
  const pick = await dcChoosePageLayout({ mode: "apply", title: dcPageTitle(DC_PAGE) || "this page" });
  if (!pick || !pick.blocks || !pick.blocks.length) return;
  BLOCKS_WORK = JSON.parse(JSON.stringify(pick.blocks)).map((b) => { if (b && b.id) b.id = uniqueBlockId(b.type + "_" + b.id); return b; });
  BLOCK_FOCUS = 0; dcCaptureScroll(); renderBlocksCard(); saveBlocks();
}
// ★ Save to your studio (item 216, the studio only): this page, with its sections and copies of
// its photos, kept by the studio to add to any client's site from Add a page.
const AP_PURPOSES = [["introduce", "Introduce"], ["sell", "Sell"], ["show", "Show"], ["home", "Home page"]];
function apGuessPurpose(slug, title) {
  if (!slug) return "home";
  const t = (String(title || "") + " " + slug).toLowerCase();
  if (/servic|price|menu|book|shop|order|product|offer|package|rate/.test(t)) return "sell";
  if (/galler|work|portfolio|review|event|before|project|photo|testimonial/.test(t)) return "show";
  return "introduce";
}
async function dcSavePageToStudio(slug) {
  const p = slug ? dcPageObj(slug) : null;
  const title = slug ? String((p && p.title) || slug) : "Home";
  const biz = (S.identity && S.identity.business_name) || "This business";
  const opener = document.activeElement;
  const ans = await new Promise((resolve) => {
    const dlg = el("dialog", "ap-save"); dlg.setAttribute("aria-labelledby", "apSaveH");
    const form = el("form");
    const h = el("h2", "ap-h", "Save to your studio"); h.id = "apSaveH";
    form.append(h, el("p", "ap-sub", "Saved with its sections and copies of its photos, so it stays even if this site closes. Add it to any client’s site from Add a page."));
    const lab = el("label", "ap-name"); lab.appendChild(el("span", null, "Name"));
    const nm = el("input"); nm.type = "text"; nm.maxLength = 80; nm.value = title; nm.autocomplete = "off"; lab.appendChild(nm); form.appendChild(lab);
    const pf = el("div", "ap-purpose"), pl = el("span", "ap-plbl", "What is it for?"); pl.id = "apPurposeL"; pf.appendChild(pl);
    const pills = el("div", "ap-pills"); pills.setAttribute("role", "radiogroup"); pills.setAttribute("aria-labelledby", "apPurposeL");
    let purpose = apGuessPurpose(slug, title);
    const pickPurpose = (k, focus) => { purpose = k; pills.querySelectorAll(".ap-pill").forEach((x) => { const on = x.dataset.purpose === k; x.setAttribute("aria-checked", String(on)); x.tabIndex = on ? 0 : -1; if (on && focus) x.focus(); }); };
    AP_PURPOSES.forEach(([k, label]) => {
      const b = el("button", "ap-pill", label); b.type = "button"; b.dataset.purpose = k; b.setAttribute("role", "radio");
      b.addEventListener("click", () => pickPurpose(k));
      b.addEventListener("keydown", (e) => {
        const i = AP_PURPOSES.findIndex((x) => x[0] === k), step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
        if (step) { e.preventDefault(); pickPurpose(AP_PURPOSES[(i + step + AP_PURPOSES.length) % AP_PURPOSES.length][0], true); }
      });
      pills.appendChild(b);
    });
    pickPurpose(purpose);
    pf.append(pills, el("p", "ap-hint", "It shows in that group of Add a page, beside the ready-made pages."));
    form.appendChild(pf);
    const stay = el("div", "ap-stay"); stay.append(el("strong", null, "What stays behind"), el("p", null, biz + "’s business details, hours, reviews and contact details never travel. Its name in the words is swapped for the next business’s name."));
    form.appendChild(stay);
    const row = el("div", "ap-acts"), c = el("button", "pillbtn", "Cancel"), ok = el("button", "pillbtn inked", "Save to studio");
    c.type = "button"; ok.type = "submit"; row.append(c, ok); form.appendChild(row);
    dlg.appendChild(form); document.body.appendChild(dlg);
    let done = false;
    const finish = (v) => { if (done) return; done = true; try { dlg.close(); } catch (_) {} dlg.remove(); try { if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true }); } catch (_) {} resolve(v); };
    c.addEventListener("click", () => finish(null));
    form.addEventListener("submit", (e) => { e.preventDefault(); const name = nm.value.trim(); if (!name) { nm.focus(); return; } finish({ name, purpose }); });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    dlg.showModal(); setTimeout(() => { try { nm.focus(); nm.select(); } catch (_) {} }, 20);
  });
  if (!ans) return;
  if (!(await dcSavePendingEdits())) return;   // the studio keeps the page as saved, so what was just typed goes first
  try {
    await api("POST", "/agency/pages", { site_id: S.site && S.site.id, slug: slug || "", name: ans.name, purpose: ans.purpose });
    AP_SAVED = null;
    toast("Saved to your studio. Add it to any client’s site from Add a page.");
  } catch (err) { toast(nice(err), true); }
}
async function dcSaveNav(nav) {
  try {
    const clean = dcCleanNav(nav);
    await settingsPut({ nav: clean });
    refreshDesignPreview();
    toast(clean.length ? "Menu saved — publish to update your live site" : "Menu reset to automatic");
  } catch (err) { toast(nice(err), true); }
}
// The page-operation items, SHARED: the ⋯ menus (page pills + tree rows) and the
// Page ▾ menu's "Page properties" group build from this one list, so the two
// homes can never drift. Every action is the existing G7 function; `close`
// dismisses the host menu before the action runs.
function dcPageMenuItems(slug, close) {
  const isHome = !slug;
  const p = isHome ? null : dcPageObj(slug);
  const items = [];
  const mk = (label, fn, o) => {
    const b = el("button", "pp-pop-item" + (o && o.danger ? " danger" : ""), label); b.type = "button";
    b.addEventListener("click", () => { close(); fn(); });
    items.push(b);
  };
  mk("Page settings…", () => pgOpenSettings({ href: isHome ? "/" : "/" + slug + "/" }));
  if (!isHome) {
    mk("Rename", () => dcRenamePage(slug));
    mk((p && p.hideNav) ? "Show in menu" : "Hide from menu", () => dcTogglePageNav(slug));
  }
  // G7: duplicate any page (Home too) — a full copy you then edit independently
  mk("Duplicate page", () => dcDuplicatePage(slug));
  // item 216: the studio keeps this page to add to any client's site from Add a page
  if (S.isStudio) mk("★ Save to your studio…", () => dcSavePageToStudio(slug));
  // Clear the template/sections off the canvas → a blank page (works on Home too)
  mk("Clear page (start blank)", () => dcClearPage(slug));
  if (!isHome) mk("Delete page", () => dcDeletePage(slug), { danger: true });
  return items;
}
function dcPageMenu(slug, anchor) {
  const m = el("div", "pp-pop");
  dcPageMenuItems(slug, () => m.remove()).forEach((b) => m.appendChild(b));
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.cssText = "position:fixed;z-index:300;top:" + (r.bottom + 4) + "px;left:" + Math.max(8, r.left - 70) + "px;background:var(--sheet,#fff);border:1px solid var(--line,#ddd);border-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.18);padding:6px;display:flex;flex-direction:column;min-width:150px";
  // the pages card can sit low on the screen (a phone's sheet): open upward when there is no room below, and never past the right edge
  { const mh = m.offsetHeight || 0, mw = m.offsetWidth || 0;
    if (r.bottom + 4 + mh > window.innerHeight - 8) m.style.top = Math.max(8, r.top - 4 - mh) + "px";
    m.style.left = Math.max(8, Math.min(parseFloat(m.style.left) || 8, window.innerWidth - mw - 8)) + "px"; }
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener("mousedown", off, true); } };
  setTimeout(() => document.addEventListener("mousedown", off, true), 0);
}
async function dcTogglePageNav(slug) {
  if (!(await dcSavePendingEdits())) return;   // this list is built from the saved pages
  const toggled = () => {
    const pages = dcPagesArr().map((x) => { if (x.slug !== slug) return x; const nx = { ...x }; if (nx.hideNav) delete nx.hideNav; else nx.hideNav = true; return nx; });
    const body = { pages };
    if (pgHasCustomNav()) {
      const href = "/" + slug + "/", hide = !!(pages.find((x) => x.slug === slug) || {}).hideNav, m = pgModel(), e = pgEntry(m, { href });
      if (hide && e && e.it) { const item = pgLift(m, e); (item.children || []).forEach((k) => m.nav.push(k)); }
      if (!hide && e && !e.it) m.nav.push({ label: pgLabelFor(e.pg), href });
      const clean = dcCleanNav(m.nav); if (clean.length) body.nav = clean;
    }
    return body;
  };
  try { await settingsPut(toggled); renderPagesBar(); refreshDesignPreview(); toast(dcPageObj(slug) && dcPageObj(slug).hideNav ? "Hidden from the menu — still reachable by its link" : "Shown in the menu"); } catch (err) { toast(nice(err), true); }
}
// G7: duplicate a page ('' = Home) server-side — deep copy with fresh section ids,
// "<Title> copy" + a "-copy" address; the response carries the whole new pages list.
async function dcDuplicatePage(slug) {
  if (!(await dcSavePendingEdits())) return;   // the server copies the stored page
  try {
    // the server rewrites the page list from what it has stored, so this takes a turn too
    const d = await settingsTurn(async () => {
      const r = await api("POST", "/pages/duplicate", { slug: slug || "" });
      const copy = (r && r.data) || {};
      S.settings = { ...(S.settings || {}), pages: Array.isArray(copy.pages) ? copy.pages : dcPagesArr() };
      return copy;
    });
    if (!(await dcSavePendingEdits())) { renderPagesBar(); return; }   // anything typed during the copy stays on its own page
    if (d.slug) dcOpenPage(d.slug);
    renderPagesBar(); renderBlocksCard(); refreshDesignPreview();
    toast("Duplicated — now editing “" + (d.title || "the copy") + "”. Publish when it’s ready.");
  } catch (err) { toast(nice(err), true); }
}
// G7: rename = the display title AND (optionally) the page address. A changed
// address rides a `prev_slug` marker so the SERVER forwards the old link through
// the existing redirects manager (only if the page was ever live) — and the menu +
// per-page search settings follow the new address in the same save.
async function dcRenamePage(slug) {
  const p = dcPageObj(slug); if (!p) return;
  const name = await askText("Rename this page", { value: p.title || "", ok: "Next" });
  if (!name || !name.trim()) return;
  const title = name.trim().slice(0, 60);
  const addr = await askText("Page address", { value: slug, ok: "Save", hint: "This page’s link: yoursite.com/…/. Lowercase letters, numbers and dashes. If you change it, visitors to the old link are sent to the new one automatically." });
  if (addr === null) return;
  await dcSavePageName(slug, title, addr);
}
// Gives back the page's address after the save, or null if nothing was saved.
async function dcSavePageName(slug, title, addr) {
  if (!(await dcSavePendingEdits())) return null;   // this list is built from the saved pages
  const old = dcPageObj(slug); if (!old) return null;
  const newSlug = String(addr || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || slug;
  const renamed = newSlug !== slug;
  if (renamed) {
    const taken = new Set(dcPagesArr().filter((x) => x.slug !== slug).map((x) => x.slug));
    if (taken.has(newSlug) || DC_PAGE_RESERVED.has(newSlug)) { toast("That address is already used by another page — pick a different one.", true); return null; }
  }
  const build = () => {
    const pages = dcPagesArr().map((x) => (x.slug === slug ? (renamed ? { ...x, title, slug: newSlug, prev_slug: slug } : { ...x, title }) : x));
    const body = { pages };
    if (pgHasCustomNav()) {
      // keep the menu pointing at the new address, and its label if it was the page's name
      const oldHref = "/" + slug + "/", newHref = "/" + newSlug + "/", oldTitle = old.title || slug;
      const swap = (it) => (it && it.href === oldHref ? { ...it, href: newHref, label: it.label === oldTitle ? title.slice(0, 40) : it.label } : it);
      const next = S.settings.nav.map((it) => { const t = swap(it); return (t.children && t.children.length) ? { ...t, children: t.children.map(swap) } : t; });
      if (JSON.stringify(next) !== JSON.stringify(S.settings.nav)) body.nav = next;
    }
    if (renamed) {
      // keep the per-page search settings pointing at the new address
      const pseo = (S.settings && S.settings.page_seo) || {};
      if (pseo["page:" + slug]) { const map = { ...pseo }; map["page:" + newSlug] = map["page:" + slug]; delete map["page:" + slug]; body.page_seo = map; }
      const nix = (S.settings && S.settings.pages_noindex) || [];
      if (nix.includes("page:" + slug)) body.pages_noindex = nix.map((k) => (k === "page:" + slug ? "page:" + newSlug : k));
      // item 197 (review finding 37): a pop-up set to show on "these pages" kept the old address and stopped showing there
      const pop = S.settings && S.settings.popup;
      if (pop && Array.isArray(pop.picked) && pop.picked.includes("page:" + slug)) body.popup = { ...pop, picked: pop.picked.map((k) => (k === "page:" + slug ? "page:" + newSlug : k)) };
    }
    return body;
  };
  try {
    await settingsPut(build, () => { if (renamed && DC_PAGE === slug) DC_PAGE = newSlug; });   // the next write finds this page under its new address
    renderPagesBar(); renderBlocksCard(); refreshDesignPreview();
    toast(renamed ? "Renamed — visitors to the old link are redirected to the new address once you publish" : "Renamed — publish to update your live site");
    return newSlug;
  } catch (err) { toast(nice(err), true); return null; }
}
async function dcDeletePage(slug) {
  const p = dcPageObj(slug); if (!p) return;
  const title = p.title || slug;
  // G7: delete-awareness — one cheap server check for anything pointing AT this page
  let warn = "";
  try {
    const refs = (await api("GET", "/pages/refs?slug=" + encodeURIComponent(slug))).data || {};
    const bits = [];
    if (refs.redirects && refs.redirects.length) bits.push((refs.redirects.length === 1 ? "a forward points" : refs.redirects.length + " forwards point") + " to it (" + refs.redirects.join(", ") + ")");
    if (refs.pages && refs.pages.length) bits.push("other pages link to it (" + refs.pages.map((x) => x.title).join(", ") + ")");
    if (refs.library && refs.library.length) bits.push("saved sections link to it (" + refs.library.join(", ") + ")");
    if (bits.length) warn = "\n\nHeads up — " + bits.join("; ") + ". Those links will stop working until you update them.";
  } catch (_) { /* the check is best-effort — the confirm still asks plainly */ }
  if (!(await askYes("Delete the page “" + title + "”? Its sections will be removed. Your live site is unchanged until you publish." + warn, { ok: "Delete page", danger: true }))) return;
  if (!(await dcSavePendingEdits())) return;   // the checkpoint and the Undo below keep the stored page
  // a durable safety point beyond the 20-second Undo (best-effort, never blocks the delete)
  try { await api("POST", "/publishes/checkpoints", { name: ("Before deleting “" + title + "”").slice(0, 80) }); } catch (_) {}
  let at = -1, removed = null, navBefore = null;
  const build = () => {
    const all = dcPagesArr(); at = all.findIndex((x) => x.slug === slug);
    removed = all[at];
    const pages = all.filter((x) => x.slug !== slug);
    // take the page's search-appearance entries with it (same "page:<slug>" keys
    // dcRenamePage migrates) — orphaned entries would silently noindex a FUTURE
    // page that reuses this slug, and they count against the publish cap.
    const body = { pages };
    const dkey = "page:" + slug;
    const pseo = (S.settings && S.settings.page_seo) || {};
    if (pseo[dkey]) { const map = { ...pseo }; delete map[dkey]; body.page_seo = map; }
    const nix = (S.settings && S.settings.pages_noindex) || [];
    if (nix.includes(dkey)) body.pages_noindex = nix.filter((k) => k !== dkey);
    // and off a custom menu, its dropdown staying on the top level; a menu left empty goes back to automatic
    navBefore = pgHasCustomNav() ? S.settings.nav : null;
    if (navBefore) {
      const gone = "/" + slug + "/", next = [];
      navBefore.forEach((it) => {
        const kids = (it.children || []).filter((k) => k.href !== gone);
        if (it.href === gone) { kids.forEach((k) => next.push(k)); return; }
        const { children, ...rest } = it;
        next.push(kids.length ? { ...rest, children: kids } : rest);
      });
      body.nav = next;
    }
    return body;
  };
  try {
    await settingsPut(build);
    if (DC_PAGE === slug) { await dcSavePendingEdits(); dcOpenPage(""); }   // anything typed during that write went with the page, not onto Home
    renderPagesBar(); renderBlocksCard(); refreshDesignPreview();
    // G7: an honest Undo — we still hold the full page (it lives in the draft
    // settings row), so putting it back IS a true restore; a checkpoint (above)
    // covers anything beyond the toast's window.
    toastAction("Page “" + title + "” deleted", "Undo", async () => {
      if (!(await dcSavePendingEdits())) return;   // this list is built from the saved pages
      const restored = () => {
        const cur = dcPagesArr().slice();
        if (cur.some((x) => x.slug === removed.slug)) return null;
        cur.splice(Math.min(at < 0 ? cur.length : at, cur.length), 0, removed);
        return navBefore ? { pages: cur, nav: navBefore } : { pages: cur };
      };
      try {
        if (!(await settingsPut(restored))) { toast("That page is already back"); return; }
        renderPagesBar(); renderBlocksCard(); refreshDesignPreview(); toast("Page “" + title + "” restored");
      } catch (err) { toast(nice(err), true); }
    }, 20000);
  } catch (err) { toast(nice(err), true); }
}
// Clear a page's sections back to a blank canvas (removes the applied template).
// Works on Home and custom pages; undoable; live site unchanged until publish.
async function dcClearPage(slug) {
  slug = slug || "";
  if (slug !== DC_PAGE && !(await dcSwitchPage(slug))) return;   // clear the page you picked
  if (!Array.isArray(BLOCKS_WORK) || !BLOCKS_WORK.length) { toast("This page is already blank"); return; }
  if (BLOCKS_WORK.some(lockedForMe)) { toast(LOCK_PAGE_SAY + " so it can’t be cleared. Ask them if it needs to change.", true); return; }   // item 195: as Delete and Cut do
  if (!(await askYes("Clear all sections from “" + dcPageTitle(slug) + "” and start from a blank canvas? You can Undo this, and your live site is unchanged until you publish.", { ok: "Clear the page", danger: true }))) return;
  dcCaptureScroll(); BLOCKS_WORK = []; BLOCK_FOCUS = null; renderBlocksCard(); saveBlocks();
}
function blockText(def, blk) {
  if (def.areasSimple) return (blk.areas || []).join("\n");
  return (blk[def.field] || []).map(def.fmt).join("\n");
}
function textToBlock(def, title, text) {
  const b = { type: def.type }; if (title) b.title = title;
  if (def.areasSimple) { b.areas = text.split("\n").map((s) => s.trim()).filter(Boolean); return b; }
  b[def.field] = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => def.parse(l.split("|").map((s) => s.trim())));
  return b;
}
// A stable, unique id for a MULTI-INSTANCE block (columns/cards), unique among
// the current working blocks so its render key (block_<type>_<id>) never collides.
function uniqueBlockId(prefix) {
  const taken = new Set((BLOCKS_WORK || []).map((b) => b && b.id).filter(Boolean));
  let id = prefix, n = 1;
  while (taken.has(id)) id = prefix + "_" + (++n);
  return id;
}
// A freshly-added block is PRE-FILLED with short, editable placeholder content, so it
// renders on the canvas immediately (never a blank/dropped section) and the owner just
// edits the words — the same "never a cold start" idea as the starter layouts.
function emptyBlock(def) {
  const b = { type: def.type };
  if (def.stackSimple) { b.items = [{ kind: "heading", text: "Your heading" }, { kind: "text", body: "Say a little more here: who you help and how." }, { kind: "button", buttons: [{ label: "Get in touch", url: "/contact/" }] }]; return b; }   // item 57
  if (def.structured === "columns") { b.id = uniqueBlockId("columns"); b.columns = [{ body: "**Column one**\n\nA little about this." }, { body: "**Column two**\n\nAnd a little about this." }]; return b; }
  if (def.structured === "cards") { b.id = uniqueBlockId("cards"); b.cards = [{ heading: "A highlight", text: "A short line about it." }, { heading: "Another", text: "One more short line." }]; return b; }
  if (def.downloadSimple) { return b; }   // file_id set by the picker
  if (def.tocSimple) { return b; }         // nothing to fill — auto-built at render
  if (def.ctaSimple) { b.text = "Ready to get started? Add your phone, email or a booking link."; return b; }
  if (def.reviewsSimple) { b.rating = 5; b.count = 0; return b; }
  if (def.reviewsWallSimple) { b.max = 12; return b; }   // approved reviews injected at publish
  if (def.apptSimple) { b.url = ""; return b; }
  if (def.bookingSimple) { b.intro = ""; return b; }
  if (def.newsletterSimple) { b.url = ""; b.collect = true; return b; }   // item 146: a new box collects into your own list
  if (def.mapSimple) { b.address = ""; return b; }
  if (def.mediaKind === "gallery") { b.image_ids = []; return b; }
  if (def.mediaKind === "video") { b.url = ""; return b; }
  if (def.mediaKind === "ba") { b.items = []; return b; }
  if (def.proseSimple) { b.body = "Write your text here — tell visitors who you are and what you do, in a friendly sentence or two."; return b; }
  if (def.imageSimple) { return b; }   // image_id set by the picker
  if (def.imageTextSimple) { b.body = "Write the text that sits beside your image."; b.side = "left"; return b; }
  if (def.dividerSimple) { b.style = "line"; b.size = "medium"; return b; }
  if (def.titleSimple) { b.title = "Your heading"; b.subtitle = ""; return b; }
  if (def.spotlightSimple) { b.title = "Something worth highlighting"; b.eyebrow = ""; b.body = "A sentence or two that draws the eye."; return b; }
  if (def.tableSimple) { b.headers = ["Column A", "Column B"]; b.rows = [["Row 1", "Detail"], ["Row 2", "Detail"]]; return b; }
  if (def.structured === "accordion") { b.items = [{ summary: "A common question", body: "Answer it here." }]; return b; }
  if (def.structured === "tabs") { b.tabs = [{ label: "Tab one", body: "What goes in the first tab." }, { label: "Tab two", body: "And the second." }]; return b; }
  if (def.structured === "carousel") { b.slides = []; return b; }   // slides added via the picker
  if (def.structured === "progress") { b.items = [{ label: "A strength", percent: 80 }]; return b; }
  if (def.structured === "buttons") { b.buttons = [{ label: "Learn more", url: "https://example.com", style: "primary" }]; return b; }
  if (def.areasSimple) { b.areas = ["Your area", "A nearby town"]; return b; }
  // The line-based (field) blocks — seed one guiding row so the section renders on add.
  const SEED = {
    features: [{ title: "What makes you great", text: "Say it in a clear line." }, { title: "A second strength", text: "Keep it specific." }, { title: "A third reason", text: "Something true about you." }],
    stats: [{ value: "100+", label: "Happy customers" }, { value: "10 yrs", label: "In business" }, { value: "5★", label: "Average rating" }],
    process: [{ step: "Get in touch", detail: "The easy first step." }, { step: "We make a plan", detail: "What happens next." }, { step: "You get results", detail: "The outcome." }],
    pricing: [{ name: "Starter", price_text: "$—", features: ["What's included", "A second line"] }, { name: "Most popular", price_text: "$—", features: ["The best value", "Key benefits"] }],
    certifications: [{ name: "Licensed & insured", issuer: "Your state" }],
    events: [{ name: "An upcoming event", detail: "Add the details." }],
    social: [{ network: "instagram", url: "https://instagram.com/yourbusiness" }],
    link_list: [{ label: "A useful link", url: "https://example.com" }, { label: "Another link", url: "https://example.com" }],
  };
  b[def.field] = SEED[def.type] ? JSON.parse(JSON.stringify(SEED[def.type])) : [];
  return b;
}
function dcHistoryInit() { if (DC_HIST_LAST == null) { DC_HIST_LAST = histSnap(); updateUndoButtons(); } }
function dcLiveFromPanel() { LIVE_WANTED = true; dcLiveSoon(); }
function dcLiveSoon() { clearTimeout(LIVE_T); LIVE_T = setTimeout(dcLiveNow, 200); }   // only the section panel asks (dcLiveFromPanel)
async function dcLiveNow() {
  LIVE_T = null;
  const doc = dcFrameDoc(), main = doc && doc.getElementById("main");
  if (!main || IPE || IDE || DDS_SRCMAP || DC_MODE !== "edit" || !BLOCKS_WORK || DC_HIST_LAST == null) return;
  let saved; try { saved = JSON.parse(DC_HIST_LAST); } catch (_) { return; }
  if (!Array.isArray(saved) || saved.length !== BLOCKS_WORK.length) return;
  // Against what the canvas shows: leaving a field the live redraw already drew asked for the
  // same drawing again (item 85).
  const shown = (i) => (LIVE_DRAWN && LIVE_DRAWN.has(i) ? LIVE_DRAWN.get(i) : JSON.stringify(saved[i]));
  const changed = BLOCKS_WORK.map((b, i) => (JSON.stringify(b) === shown(i) ? -1 : i)).filter((i) => i >= 0);
  if (!changed.length || changed.length > 2) return;
  const seq = ++LIVE_SEQ, opened = DC_PAGE_OPENS, list = JSON.parse(JSON.stringify(BLOCKS_WORK));
  let swapped = false, cols = false;
  for (const i of changed) {
    let html;
    try { html = (await api("POST", "/preview/section", { blocks: list, index: i })).data.html; } catch (_) { return; }   // the save's redraw still comes
    if (typeof html !== "string") return;   // not a drawing of the section (a function from before the route): leave it to the redraw
    if (seq !== LIVE_SEQ || opened !== DC_PAGE_OPENS || dcFrameDoc() !== doc || DDS_SRCMAP) return;   // a newer edit, a page change or a redraw took over
    const old = Array.prototype.find.call(main.children, (n) => { const c = eeClassify(n); return c.kind === "block" && c.bi === i; });
    if (!old) continue;
    const tpl = doc.createElement("template"); tpl.innerHTML = html;
    const nu = tpl.content.firstElementChild;
    if (nu) old.replaceWith(nu); else old.hidden = true;   // an emptied section draws nothing, as on the site
    swapped = true;
    if (list[i] && list[i].type === "columns") cols = true;
    (LIVE_DRAWN = LIVE_DRAWN || new Map()).set(i, JSON.stringify(list[i]));
  }
  // The Contents list's rows find a swapped section again when clicked (dcTreeRow); a Columns
  // section's rows hold its columns too, so that one rebuilds the list.
  if (swapped) try { dcInjectCanvas(doc, main, true); if (cols) dcBuildTree(main); } catch (_) { /* chrome is best-effort */ }
  // item 315: "+ Add a row" opens the new row's first words for typing
  const lf = LIVE_FOCUS; LIVE_FOCUS = null;
  if (swapped && lf && !IPE) try {
    const sec = Array.prototype.find.call(main.children, (n) => { const c = eeClassify(n); return c.kind === "block" && c.bi === lf.bi; });
    const f = sec && sec.querySelector('[data-dds-field="' + lf.path + '"]');
    if (f) { f.scrollIntoView({ block: "nearest" }); ipeStart(doc, f, sec); const sel = doc.getSelection(), r = doc.createRange(); r.selectNodeContents(f); sel.removeAllRanges(); sel.addRange(r); }
  } catch (_) {}
}
// ── T-STARTER: apply a pre-arranged, pre-filled starter layout. Replaces the
//    working sections with a ready-made set the owner then EDITS (never a blank
//    canvas). Reuses the existing block-save (PUT /settings), so the server
//    re-validates every starter block through the same validator. Never silently
//    overwrites — confirms first when the owner already has sections.
async function applyStarterLayout(starter) {
  if (!starter || !Array.isArray(starter.blocks) || !starter.blocks.length) return;
  if ((BLOCKS_WORK || []).some(lockedForMe)) { toast(LOCK_PAGE_SAY + " so a layout can’t replace its sections. Ask them if it needs to change.", true); return; }   // item 195
  const hasContent = Array.isArray(BLOCKS_WORK) && BLOCKS_WORK.length > 0;
  if (hasContent && !(await askYes("Start from the “" + starter.name + "” layout? This replaces your current sections with a ready-made set you can then edit. Your existing sections will be removed.", { ok: "Use this layout", danger: true }))) return;
  // Deep copy so the shared suggestion payload is never mutated, and MULTI-INSTANCE
  // ids (columns/cards) stay unique against anything already in the working set.
  BLOCKS_WORK = JSON.parse(JSON.stringify(starter.blocks)).map((b) => {
    if (b && b.id) b.id = uniqueBlockId(b.type + "_" + b.id);
    return b;
  });
  BLOCK_FOCUS = 0;
  saveBlocks();   // reuse the existing save → server validateBlocks() proves every block
}
function mountBlocksCard() {
  const host = $("designHost"); if (!host || $("blocksCard")) return;
  // Behind a slow read the canvas lands before this card, so the list may already
  // hold an in-place commit. Replacing it here saved the old text and said "Saved".
  if (!BLOCKS_WORK) BLOCKS_WORK = currentBlocks();
  const card = el("div", "field"); card.id = "blocksCard"; card.style.marginTop = "18px";
  host.appendChild(card);
  card.addEventListener("change", () => { if (!LIVE_PROBE) { LIVE_TYPING = null; blocksSaveSoon(); dcLiveFromPanel(); } });   // field handlers run first; this sees their result
  // Item 26, part two: typing shows on the canvas as you type. Each keystroke runs the
  // field's own commit (a change event this card's save listener lets pass), then the
  // section redraws; the save still waits for the field to be left. Only for sections whose
  // editor rebuilds the whole section on each commit (LIVE_TYPE_OK): the others edit the
  // object they were drawn from, which a commit mid-typing could leave behind.
  card.addEventListener("input", (e) => {
    const t = e.target;
    if (!t || !/^(INPUT|TEXTAREA)$/.test(t.tagName) || (t.tagName === "INPUT" && !/^(text|search|url|email|tel|number)$/.test(t.type))) return;
    whisper("topWhisper", "unsaved");   // item 81: the words save when the field is left
    const b = BLOCK_SOLO != null && BLOCKS_WORK ? BLOCKS_WORK[BLOCK_SOLO] : null;
    if (!b || !LIVE_TYPE_OK.has(b.type)) return;
    LIVE_PROBE = true; LIVE_TYPING = t;
    try { t.dispatchEvent(new Event("change", { bubbles: true })); } finally { LIVE_PROBE = false; }
    dcLiveFromPanel();
  });
  renderBlocksCard();
  // FD-T4: industry-recommended blocks (server preset — no client duplication)
  if (BLOCK_SUGGEST === null) api("GET", "/blocks/suggested").then((r) => { BLOCK_SUGGEST = r.data || false; renderBlocksCard(); }).catch(() => { BLOCK_SUGGEST = false; });
}
// Phase T-STYLE: a section's "look" (background / width / spacing / alignment) is
// orthogonal to its content. The per-type editors below rebuild their block object
// from their own fields, so carry the chosen look across every rebuild.
// Builder item 253: the lock rides along too, so a change to any field of a locked section keeps
// it locked (the client's save was refused and their words lost; the studio's quietly unlocked it).
function wLook(idx, o) { const p = BLOCKS_WORK[idx]; if (p && p.look) o.look = p.look; if (p && p.style) o.style = p.style; if (p && p.show_from) o.show_from = p.show_from; if (p && p.show_until) o.show_until = p.show_until; if (p && p.variant) o.variant = p.variant; if (p && p.anchor) o.anchor = p.anchor; if (p && p._clEdit) o._clEdit = p._clEdit; if (p && p.lock) o.lock = p.lock; if (p && typeof p.featured === "number") o.featured = p.featured; return o; }   // item 329: and the raised plan
// Wave-1 G4: per-block STYLE VARIANTS — 2–3 curated looks per section type, rendered
// by the shared block engine (mirrors site_blocks.ts BLOCK_VARIANTS; the server
// re-validates, unknown values fall back to the default). The default is stored as
// NO `variant` key, so untouched sections stay byte-identical.
const BLOCK_VARIANT_OPTS = {
  reviews_wall: [["Cards", ""], ["Big quotes", "quotes"], ["Compact strip", "strip"]],
  accordion: [["Accordion", ""], ["Open, in two columns", "two-column"], ["Questions beside the heading", "side"], ["Numbered questions", "numbered"]],
  cta: [["Banner", ""], ["Card", "card"]],
  pricing: [["Cards", ""], ["Price list", "list"], ["Printed price list", "menu"], ["Three plans", "plans"]],
  gallery: [["Grid", ""], ["Mosaic", "masonry"], ["Filmstrip", "filmstrip"]],
  // item 329: the bold designs picked in Figma (the Layout tab draws each one live)
  features: [["Grid", ""], ["Numbered", "numbered"], ["Icon tiles on a dark band", "tiles"]],
  image_text: [["Photo beside the words", ""], ["Photo off the edge", "overlap"], ["Photo in a colour frame", "frame"]],
};
// A "Style" pill row inside the block editor (reuses the Design Studio pillRow).
// Writes block.variant into the working copy — saved by the existing "Save sections".
function blockVariantRow(idx, blk, sub) {
  if (sub.classList && sub.classList.contains("ins-pane")) { insLiveLayouts(sub, idx, blk); return; }   // the inspector: each arrangement drawn live (item 224)
  const opts = BLOCK_VARIANT_OPTS[blk && blk.type]; if (!opts) return;
  const isOn = (o) => String((BLOCKS_WORK[idx] && BLOCKS_WORK[idx].variant) || "") === o[1];
  const pick = (o) => { const b = { ...BLOCKS_WORK[idx] }; if (o[1]) b.variant = o[1]; else delete b.variant; BLOCKS_WORK[idx] = b; renderBlocksCard(); dcLiveFromPanel(); };
  pillRow(sub, "Style", opts, isOn, pick);
  designExtras(sub, idx, blk, false);
}
// Item 329: what a bold design adds under its section's layout choice: which side the photo sits on
// (Photo off the edge, Photo in a colour frame), which plan is raised (Three plans), and a word on a
// printed price list holding more prices than the other designs show. `inPane`: the inspector's
// Layout tab (the classic panel keeps its own "Image on the" choice).
function designExtras(host, idx, blk, inPane) {
  if (!blk) return;
  const set = (patch) => { BLOCKS_WORK[idx] = { ...BLOCKS_WORK[idx], ...patch }; renderBlocksCard(); dcLiveFromPanel(); };
  if (inPane && blk.type === "image_text" && (blk.variant === "overlap" || blk.variant === "frame")) {
    insTiles(host, "Photo side", [["On the left", "left"], ["On the right", "right"]], (o) => (blk.side === "right" ? "right" : "left") === o[1], (o) => set({ side: o[1] }), (o) => "image_text:" + o[1]).parentNode.dataset.group = "photo-side";
  }
  const tiers = blk.type === "pricing" && Array.isArray(blk.tiers) ? blk.tiers : null;
  if (tiers && blk.variant === "plans") {
    const f = el("div", "ins-field"); f.dataset.group = "featured";
    const id = "dsFeatured" + idx, lab = el("label", "ins-lbl", "Most popular plan"); lab.htmlFor = id;
    const sel = el("select"); sel.id = id;
    const now = typeof blk.featured === "number" ? blk.featured : (tiers.length === 3 ? 2 : 0);   // the server's default: the middle one of three
    [[0, "None"]].concat(tiers.map((t, i) => [i + 1, (t && t.name) || "Plan " + (i + 1)])).forEach(([v, l]) => { const o = el("option", null, l); o.value = String(v); if (v === now) o.selected = true; sel.appendChild(o); });
    sel.addEventListener("change", () => set({ featured: Number(sel.value) }));
    f.append(lab, sel, el("p", "ins-says", "It stands taller, in your accent colour, with a “Most popular” badge."));
    host.appendChild(f);
  }
  if (tiers && blk.variant === "menu" && tiers.length > 4) {
    const n = el("p", "ins-says"); n.dataset.group = "menu-note";
    n.textContent = "The printed price list shows up to 16 prices, in two columns. Cards, Price list and Three plans show the first four, so switching to one of them leaves the rest out.";
    host.appendChild(n);
  }
}
// A calm, collapsed "Look of this section" control row — plain words, smart defaults,
// no CSS. Lives INSIDE the block you're already editing (no separate panel). The
// options are enumerated; the server re-validates and only known values are stored.
function blockLookRow(idx, blk, sub) {
  const cur = (blk && blk.look) || {};
  const chosen = Object.keys(cur).some((k) => cur[k]);
  if (sub && sub.content) {   // the inspector's panes: each choice on the tab it belongs to
    const panes = sub;
    const bands = [["", "Default"], ["tinted", "Tinted"], ["plain", "Plain"], ["accent", "Accent band"], ["dark", "Dark band"]];
    insThemes(panes.style, idx, cur, (blk && blk.style) || {});   // items 49 and 118: the band is the section's colour theme
    insTiles(panes.layout, "Width", [["Normal", ""], ["Full width", "full"]], (o) => (cur.width || "") === o[1], (o) => lookSet(idx, "width", o[1]), (o) => "width:" + (o[1] || "normal"));
    pillRow(panes.layout, "Spacing", [["Tight", "tight"], ["Normal", ""], ["Roomy", "roomy"]], (o) => (cur.spacing || "") === o[1], (o) => lookSet(idx, "spacing", o[1]));
    pillRow(panes.layout, "Text", [["Default", ""], ["Centered", "center"]], (o) => (cur.align || "") === o[1], (o) => lookSet(idx, "align", o[1]));
    insLinkName(panes.layout, idx, blk);   // item 225
    insEdgeRow(panes.layout, idx, cur);    // item 225
    pillRow(panes.when, "Show on", [["All screens", ""], ["Desktop only", "mobile"], ["Phones only", "desktop"]], (o) => (cur.hideOn || "") === o[1], (o) => lookSet(idx, "hideOn", o[1]));
    return;
  }
  const OPTS = [
    ["background", "Background", [["", "Default"], ["tinted", "Tinted"], ["plain", "Plain"], ["accent", "Accent band"], ["dark", "Dark band"]]],
    ["width", "Width", [["", "Normal"], ["full", "Full width"]]],
    ["spacing", "Spacing", [["", "Normal"], ["tight", "Tight"], ["roomy", "Roomy"]]],
    ["align", "Text", [["", "Default"], ["center", "Centered"]]],
    ["hideOn", "Show on", [["", "All screens"], ["mobile", "Desktop only (hide on phones)"], ["desktop", "Phones only (hide on desktop)"]]],
  ];
  const det = el("details"); det.style.cssText = "margin-top:10px;border-top:1px dashed var(--line,#e5e5e5);padding-top:8px";
  if (chosen) det.open = true;
  const sum = el("summary", null, "Style of this section" + (chosen ? "  ·  customised" : ""));
  sum.style.cssText = "cursor:pointer;font-size:12px;font-weight:600;color:var(--soft,#6b6478)";
  det.appendChild(sum);
  const row = el("div"); row.style.cssText = "display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:8px";
  const selects = {};
  OPTS.forEach(([key, label, opts]) => {
    const w = el("label"); w.style.cssText = "font-size:12px;color:var(--soft,#6b6478)"; w.appendChild(document.createTextNode(label + " "));
    const se = el("select"); se.style.cssText = "font:inherit;font-size:13px;margin-left:4px;padding:4px 6px;border:1px solid var(--line,#ddd);border-radius:8px";
    opts.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if ((cur[key] || "") === v) o.selected = true; se.appendChild(o); });
    selects[key] = se; w.appendChild(se); row.appendChild(w);
  });
  const commit = () => {
    const look = {};
    Object.keys(selects).forEach((k) => { const v = selects[k].value; if (v) look[k] = v; });
    const b = { ...BLOCKS_WORK[idx], look: Object.keys(look).length ? look : undefined };
    // G27 mutual exclusion (one background owner at a time — the server drops
    // look.background whenever style.bg_color is present): choosing a background
    // band here clears the custom style background (and its contrast ack, since
    // that's a color change), then redraws so the style row tells the truth.
    if (look.background && b.style && b.style.bg_color) {
      const s = { ...b.style }; delete s.bg_color; delete s.contrast_ack;
      if (Object.keys(s).length) b.style = s; else delete b.style;
      BLOCKS_WORK[idx] = b; renderBlocksCard(); return;
    }
    BLOCKS_WORK[idx] = b;
  };
  Object.values(selects).forEach((se) => se.addEventListener("change", commit));
  det.appendChild(row);
  det.appendChild(el("div", "hint", "Optional — give this section a soft background, make it full-width, or change its spacing. It stays readable and accessible on every screen."));
  sub.appendChild(det);
}
function ovMix(a, b, t) { const A = ovRgb(a), B = ovRgb(b); return "#" + A.map((v, i) => Math.max(0, Math.min(255, Math.round(v + (B[i] - v) * t))).toString(16).padStart(2, "0")).join(""); }
// The brand_kit readableOnWhiteText loop, generalized to any pair: darken `color`
// in fixed 0.08 steps until it reads against `against` (caps at 20 steps).
function ovDarkenUntil(color, against, min) { let c = color; for (let i = 0; i < 20 && ovContrast(against, c) < min; i++) c = ovMix(c, "#000000", 0.08); return c; }
// Curated brand shades first, free hex behind "Custom…" (Eric, 2026-07-16):
// client-side mix() tints/shades of the site accent + neutrals, per well.
function ovShades(key) {
  const T = DESIGN_TOKENS || {}, site = dcSiteColours();   // item 277: a new site's palette is the template's, not the studio's purple
  const acc = normHexJs(T.accent) || normHexJs(site.accent) || site.accent;
  const ink = normHexJs(T.ink) || normHexJs(site.ink) || site.ink;
  let list;
  if (key === "text_color") list = [ink, ovMix(acc, "#000000", 0.55), ovMix(acc, "#000000", 0.3), acc, "#ffffff"];
  else if (key === "bg_color") list = ["#ffffff", ovMix(acc, "#ffffff", 0.92), ovMix(acc, "#ffffff", 0.8), ovMix(ink, "#ffffff", 0.94), ovMix(acc, "#000000", 0.45)];
  else list = [acc, ovMix(acc, "#000000", 0.16), ovMix(acc, "#000000", 0.32), ovMix(acc, "#ffffff", 0.3)];
  return list.filter((h, i) => list.indexOf(h) === i);
}
// Remember which section's style popover the owner opened, so the full redraw
// after every pick doesn't collapse it under them.
let OV_STYLE_OPEN = null;
function blockStyleRow(idx, blk, sub, flat) {
  const st = (BLOCKS_WORK[idx] && BLOCKS_WORK[idx].style) || {};
  const chosen = ["text_color", "bg_color", "accent", "font", "size", "align"].some((k) => st[k]);
  // flat: the inspector's Style tab, where everything is in the open; otherwise the list's fold
  const det = flat ? el("div", "ins-style") : el("details");
  if (!flat) {
    det.style.cssText = "margin-top:8px;border-top:1px dashed var(--line,#e5e5e5);padding-top:8px";
    det.open = chosen || OV_STYLE_OPEN === idx;
    det.addEventListener("toggle", () => { if (det.open) OV_STYLE_OPEN = idx; else if (OV_STYLE_OPEN === idx) OV_STYLE_OPEN = null; });
    const sum = el("summary", null, "Style this section" + (chosen ? "  ·  customised" : "  ·  optional"));
    sum.style.cssText = "cursor:pointer;font-size:12px;font-weight:600;color:var(--soft,#6b6478)";
    det.appendChild(sum);
  }
  // One writer: patch keys in (empty string = back to default → key deleted); an
  // empty object is deleted whole. A color change clears contrast_ack (§5) and a
  // custom background evicts the look's background band (§3 mutual exclusion).
  const setStyle = (patch, colorChange) => {
    const b = { ...BLOCKS_WORK[idx] };
    const s = { ...(b.style || {}) };
    Object.keys(patch).forEach((k) => { if (patch[k]) s[k] = patch[k]; else delete s[k]; });
    if (colorChange) delete s.contrast_ack;
    if (patch.bg_color && b.look && b.look.background) {
      const lk = { ...b.look }; delete lk.background;
      if (Object.keys(lk).length) b.look = lk; else delete b.look;
    }
    if (Object.keys(s).length) b.style = s; else delete b.style;
    BLOCKS_WORK[idx] = b;
    renderBlocksCard();
    dcLiveFromPanel();   // item 26: a style pick shows on the canvas before its save
  };
  // Enumerated picks — pillRows; the FIRST option is the default, stored as ABSENT
  // (the BLOCK_STYLE_FIELDS convention, matching parseStyle exactly).
  // the inspector's Style tab: the colour theme leads (insThemes), then colours, then type
  const typeRows = () => {
    if (flat) det.appendChild(el("div", "ins-group", "Type"));
    pillRow(det, "Font", [["Default", ""], ["Heading face", "display"], ["Body face", "body"]],
      (o) => String(st.font || "") === o[1], (o) => setStyle({ font: o[1] }));
    pillRow(det, "Text size", [["Smaller", "s"], ["Normal", ""], ["Larger", "l"], ["Extra large", "xl"]],
      (o) => String(st.size || "") === o[1], (o) => setStyle({ size: o[1] }));
    pillRow(det, "Alignment", [["Default", ""], ["Left", "left"], ["Centered", "center"], ["Right", "right"]],
      (o) => String(st.align || "") === o[1], (o) => setStyle({ align: o[1] }));
  };
  if (!flat) typeRows();
  else {
    det.appendChild(el("div", "ins-group", "Colours · from your site"));
    const faint = ueFaintBanner(idx, st); if (faint) det.appendChild(faint);   // item 150: opened from "Pick colours"
  }
  // Three color wells — curated brand shades first, the Brand-Kit color-input+hex
  // pair behind "Custom…", and a "Default" clear chip each.
  const well = (label, key) => {
    const cur = st[key] || "";
    const shades = ovShades(key);
    if (flat) {   // round swatches from the site's own colours, the slashed circle for the default
      const row = insSwatches(det, label, [["", "Default"], ...shades.map((h) => [h, h])], cur, (v) => setStyle({ [key]: v }, true));
      if (key === "bg_color") ueRateSwatches(idx, st, row, shades);   // item 150: which backgrounds keep the words easy to read
      const isCustom = !!cur && !shades.includes(cur);
      const cust = el("button", "ai-chip" + (isCustom ? " ai-main" : ""), "Custom…" + (isCustom ? " ✓" : "")); cust.type = "button"; row.appendChild(cust);
      const pairRow = el("div"); pairRow.style.cssText = "display:flex;align-items:center;gap:10px;flex:0 0 100%"; pairRow.hidden = !isCustom;
      const colorInput = el("input"); colorInput.type = "color"; colorInput.value = cur || shades[0]; colorInput.style.cssText = "width:44px;height:32px;border:1px solid var(--line,#ddd);border-radius:8px;background:none;cursor:pointer;padding:0";
      const hexInput = el("input"); hexInput.type = "text"; hexInput.value = isCustom ? cur : ""; hexInput.placeholder = "#8c3b2e"; hexInput.setAttribute("aria-label", label + " as a hex colour"); hexInput.style.cssText = "width:120px";
      colorInput.addEventListener("input", () => { hexInput.value = colorInput.value; });
      colorInput.addEventListener("change", () => setStyle({ [key]: colorInput.value }, true));
      hexInput.addEventListener("change", () => { const h = normHexJs(hexInput.value); if (h) setStyle({ [key]: h }, true); });
      pairRow.append(colorInput, hexInput); row.appendChild(pairRow);
      cust.addEventListener("click", () => { pairRow.hidden = !pairRow.hidden; if (!pairRow.hidden) hexInput.focus(); });
      return;
    }
    const wrap = el("div"); wrap.style.cssText = "margin-top:12px";
    wrap.appendChild(Object.assign(el("div", null, label), { style: "font-size:12px;font-weight:600;margin-bottom:6px" }));
    const row = el("div"); row.style.cssText = "display:flex;gap:7px;flex-wrap:wrap;align-items:center";
    const pillCss = (on) => "font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;cursor:pointer;border:2px solid " + (on ? "var(--plum,#5b3fa0)" : "var(--line,#ddd)") + ";background:" + (on ? "var(--plum-tint,#faf7ff)" : "transparent");
    const dflt = el("button", null, "Default" + (cur ? "" : " ✓")); dflt.type = "button"; dflt.style.cssText = pillCss(!cur);
    dflt.addEventListener("click", () => setStyle({ [key]: "" }, true));
    row.appendChild(dflt);
    shades.forEach((h) => {
      const on = cur === h;
      const b = el("button"); b.type = "button"; b.title = h;
      b.setAttribute("aria-label", label + " " + h + (on ? " (chosen)" : ""));
      b.style.cssText = "width:26px;height:26px;border-radius:50%;cursor:pointer;background:" + h + ";border:2px solid " + (on ? "var(--plum,#5b3fa0)" : "var(--hair-2,rgba(0,0,0,.18))");
      b.addEventListener("click", () => setStyle({ [key]: h }, true));
      row.appendChild(b);
    });
    const isCustom = !!cur && !shades.includes(cur);
    const cust = el("button", null, "Custom…" + (isCustom ? " ✓" : "")); cust.type = "button"; cust.style.cssText = pillCss(isCustom);
    row.appendChild(cust);
    wrap.appendChild(row);
    const pairRow = el("div"); pairRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-top:8px";
    pairRow.hidden = !isCustom;
    const colorInput = el("input"); colorInput.type = "color"; colorInput.value = cur || shades[0]; colorInput.style.cssText = "width:44px;height:32px;border:1px solid var(--line,#ddd);border-radius:8px;background:none;cursor:pointer";
    const hexInput = el("input"); hexInput.type = "text"; hexInput.value = isCustom ? cur : ""; hexInput.placeholder = "#8c3b2e"; hexInput.style.cssText = "width:110px;padding:7px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px";
    colorInput.addEventListener("input", () => { hexInput.value = colorInput.value; });
    colorInput.addEventListener("change", () => setStyle({ [key]: colorInput.value }, true));
    hexInput.addEventListener("change", () => { const h = normHexJs(hexInput.value); if (h) setStyle({ [key]: h }, true); });
    pairRow.append(colorInput, hexInput);
    cust.addEventListener("click", () => { pairRow.hidden = !pairRow.hidden; if (!pairRow.hidden) hexInput.focus(); });
    wrap.appendChild(pairRow);
    det.appendChild(wrap);
  };
  well(flat ? "Text colour" : "Text", "text_color");
  well(flat ? "Background" : "Background", "bg_color");
  well(flat ? "Buttons" : "Accent", "accent");
  // LIVE CONTRAST (§5) — a chip per governing pair, with the one-tap fix beside a
  // failing one. Recomputed on every redraw (every pick redraws), so it's live.
  const pairs = ovStylePairs(st);
  if (pairs.length) {
    const crow = el("div"); crow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:10px";
    pairs.forEach((p) => {
      const pass = p.ratio >= 4.5;
      const chip = el("span", null, p.name + " · Contrast " + p.ratio.toFixed(1) + (pass ? " — passes" : " — hard to read (needs 4.5)"));
      chip.style.cssText = "font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;" + (pass ? "background:var(--sage-soft);color:var(--sage)" : "background:var(--clay-soft);color:var(--clay)");
      crow.appendChild(chip);
      if (!pass) {
        const fix = el("button", null, "Darken until readable"); fix.type = "button";
        fix.style.cssText = "font:inherit;font-size:12px;font-weight:600;padding:2px 10px;border-radius:999px;border:1px solid var(--clay);background:transparent;color:var(--clay);cursor:pointer";
        fix.addEventListener("click", () => setStyle({ [p.key]: ovDarkenUntil(p.color, p.fixAgainst, 4.5) }, true));
        crow.appendChild(fix);
      }
    });
    det.appendChild(crow);
    if (pairs.some((p) => p.siteBg)) det.appendChild(Object.assign(el("div", "hint", "Text is checked against your page background."), { style: "margin-top:4px" }));
  }
  if (flat) typeRows();
  det.appendChild(el("div", "hint", flat ? "Only this section changes. Everything else keeps your site’s overall design." : "Optional: give just this section its own colours, face, size or alignment. Everything else keeps your site's overall design."));
  sub.appendChild(det);
}
// Phase EXP: auto-expiring content — an optional "Show this from / until" window on
// any section. A holiday-hours notice, a limited-time special, a seasonal banner, an
// event post: the owner sets the dates once and it appears and retires by itself.
// Dates only (plain, intuitive); blank = always show. The server normalizes + the
// render omits the section outside its window, and the platform auto-republishes the
// live site at the boundary — so nobody has to remember to take it down.
function blockWindowRow(idx, blk, sub, flat) {
  const from = (blk && blk.show_from ? String(blk.show_from) : "").slice(0, 10);
  const until = (blk && blk.show_until ? String(blk.show_until) : "").slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const set = !!(from || until);
  const det = flat ? el("div", "ins-when") : el("details");
  if (!flat) { det.style.cssText = "margin-top:8px;border-top:1px dashed var(--line,#e5e5e5);padding-top:8px"; if (set) det.open = true; }
  // A small state chip so the owner sees at a glance what's scheduled or expired.
  let chip = "", chipCss = "";
  if (from && from > today) { chip = "Scheduled — starts " + from; chipCss = "background:var(--dds-warn-soft,#fff4e0);color:var(--dds-warn,#8a5a00)"; }
  else if (until && until < today) { chip = "Expired — ended " + until; chipCss = "background:color-mix(in srgb,var(--ink,#1b1525) 7%,transparent);color:var(--soft,#6b6478)"; }
  else if (until) { chip = "Showing until " + until; chipCss = "background:var(--sage-soft,#eaf7ee);color:var(--sage,#1c6b34)"; }
  else if (from) { chip = "Showing since " + from; chipCss = "background:var(--sage-soft,#eaf7ee);color:var(--sage,#1c6b34)"; }
  const sum = el(flat ? "div" : "summary", flat ? "ins-lbl" : null);
  if (!flat) sum.style.cssText = "cursor:pointer;font-size:12px;font-weight:600;color:var(--soft,#6b6478);display:flex;align-items:center;gap:8px;flex-wrap:wrap";
  else sum.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap";
  sum.appendChild(document.createTextNode("Show this only for a while" + (set || flat ? "" : "  ·  optional")));
  if (chip) { const c = el("span", null, chip); c.style.cssText = "font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;" + chipCss; sum.appendChild(c); }
  det.appendChild(sum);
  const row = el("div"); row.style.cssText = "display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:8px";
  const mk = (label, val) => {
    const w = el("label"); w.style.cssText = "font-size:12px;color:var(--soft,#6b6478);display:flex;align-items:center;gap:6px";
    w.appendChild(document.createTextNode(label));
    const inp = el("input"); inp.type = "date"; inp.value = val;
    inp.style.cssText = "font:inherit;font-size:13px;padding:4px 6px;border:1px solid var(--line,#ddd);border-radius:8px";
    w.appendChild(inp); row.appendChild(w); return inp;
  };
  const fi = mk("Show from", from), ui = mk("Until", until);
  const commit = () => {
    const b = { ...BLOCKS_WORK[idx] };
    if (fi.value) b.show_from = fi.value; else delete b.show_from;
    if (ui.value) b.show_until = ui.value; else delete b.show_until;
    BLOCKS_WORK[idx] = b;
    renderBlocksCard();   // redraw so the state chip updates immediately
  };
  [fi, ui].forEach((inp) => inp.addEventListener("change", commit));
  det.appendChild(row);
  det.appendChild(el("div", "hint", "Optional — this section appears on the “Show from” date and comes down by itself after “Until”. Leave both blank to always show. The change goes live on its own at the right time (publish once to set it)."));
  sub.appendChild(det);
}
function renderBlocksCard() {
  const card = $("blocksCard"); if (!card) return; card.textContent = "";
  dcHistoryInit();   // capture the loaded state as the undo baseline (once, before any edit)
  blocksSaveSoon();  // every change to the list comes through here: save it if it differs
  const focusIdx = BLOCK_FOCUS; BLOCK_FOCUS = null;   // FD-T-LIB: consume the one-shot focus target
  const solo = PANEL_MODE === "section" && BLOCK_SOLO != null && BLOCKS_WORK[BLOCK_SOLO] ? BLOCK_SOLO : null;
  if (STK_ITEM != null && !(solo !== null && (stkItems(solo) || [])[STK_ITEM])) STK_ITEM = null;   // item 57: a block's card, while its block is there
  { const sp = $("settingsPanel"); if (sp) { if (STK_ITEM != null) sp.dataset.blk = "1"; else delete sp.dataset.blk; } }
  // CL-LINK: a linked section needs the saved-items list to show its name + let it be
  // edited. Lazy-load it once when any placement is a link (or being edited from one).
  if (CL_ITEMS === null && !CL_LOADING && BLOCKS_WORK.some((b) => b && (b.type === "linked" || b._clEdit))) {
    CL_LOADING = true;
    api("GET", "/content-library").then((r) => { CL_ITEMS = (r && r.data) || []; }).catch(() => { CL_ITEMS = []; }).then(() => { CL_LOADING = false; renderBlocksCard(); });
  }
  const inputCss = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-bottom:6px;box-sizing:border-box";
  const miniBtn = "font:inherit;font-size:12px;padding:2px 9px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  if (solo === null) {
    card.appendChild(el("label", null, "Your sections"));
    card.appendChild(el("div", "hint", "Every section on this page. Changes save themselves; nothing goes live until you publish."));
  }
  // ── T-STARTER: "Start from a layout" — one click lays out a full, PRE-FILLED set
  //    of sections (guiding placeholder copy the owner edits), tuned to the business
  //    type. Especially inviting when the page is empty (no cold-start blank canvas).
  if (solo === null && BLOCK_SUGGEST && Array.isArray(BLOCK_SUGGEST.starters) && BLOCK_SUGGEST.starters.length) {
    const recKey = BLOCK_SUGGEST.recommendedStarter;
    const empty = !BLOCKS_WORK.length;
    const panel = el("div"); panel.style.cssText = "margin-top:12px;padding:14px;border:1px solid var(--plum-line,#e6ddf5);background:var(--plum-tint,#faf7ff);border-radius:12px";
    panel.appendChild(Object.assign(el("div", null, "Start from a layout"), { style: "font-weight:600;font-size:13px;color:var(--plum-deep,#3a2470)" }));
    panel.appendChild(el("div", "hint", empty
      ? "New here? Pick a ready-made layout — a full set of sections, already filled with guiding text you just edit. Nothing blank to stare at."
      : "Pick a ready-made layout to replace your sections with a filled-in starting point you can edit. We’ll ask before replacing anything."));
    // Recommended layout first; the rest keep their listed order (stable sort).
    const ordered = BLOCK_SUGGEST.starters.slice().sort((a, b) => (b.key === recKey ? 1 : 0) - (a.key === recKey ? 1 : 0));
    const grid = el("div"); grid.style.cssText = "margin-top:10px;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px";
    ordered.forEach((st) => {
      const isRec = st.key === recKey;
      const b = el("button"); b.type = "button";
      b.style.cssText = "text-align:left;font:inherit;padding:10px 12px;border-radius:10px;border:" + (isRec ? "2px solid var(--plum,#5b3fa0)" : "1px solid var(--line,#ddd)") + ";background:var(--sheet,#fff);color:inherit;cursor:pointer;display:flex;flex-direction:column;gap:3px;min-width:0";
      b.appendChild(Object.assign(el("div", null, (isRec ? "✦ " : "") + st.name), { style: "font-weight:600;font-size:12.5px" + (isRec ? ";color:var(--plum-deep,#3a2470)" : "") }));
      b.appendChild(Object.assign(el("div", null, st.description), { style: "font-size:12px;color:var(--soft,#888);line-height:1.4" }));
      const n = Array.isArray(st.blocks) ? st.blocks.length : 0;
      b.appendChild(Object.assign(el("div", null, n + " ready-made section" + (n === 1 ? "" : "s") + (isRec ? " · recommended for you" : "")), { style: "font-size:12px;color:var(--soft,#a99);margin-top:2px" }));
      b.addEventListener("click", () => applyStarterLayout(st));
      grid.appendChild(b);
    });
    panel.appendChild(grid);
    card.appendChild(panel);
  }
  BLOCKS_WORK.forEach((blk, idx) => {
    if (solo !== null && idx !== solo) return;
    if (solo === null) card.appendChild(blkGap(idx));   // #3/#4 — Notion "+" insert point + drop-line target above this section
    // CL-LINK: a link renders as a read-only chip (a block being edited FROM a link
    // carries a real type + _clEdit, so it falls through to its normal editor below).
    if (blk && blk.type === "linked") { renderLinkedChip(blk, idx, card); return; }
    const def = BLOCK_DEFS.find((d) => d.type === blk.type); if (!def) return;
    const box = el("div"); box.id = "blkSub-" + idx; box.className = "blk-sub"; box.style.cssText = "border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:12px 14px;margin-top:10px";
    const head = el("div"); head.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px";
    // the panel's title already names this section when it's the only one showing
    const nm = el("div", null, solo !== null ? (blk.mediaNote || "") : def.name + (blk.mediaNote ? "  ·  " + blk.mediaNote : "")); nm.style.cssText = "flex:1;font-weight:600;font-size:13px";
    const up = icoBtn("up", "Move this section up", null, 14), dn = icoBtn("down", "Move this section down", null, 14), rm = el("button", null, "Remove");
    [up, dn, rm].forEach((b) => { b.type = "button"; b.style.cssText = miniBtn; });
    up.disabled = idx === 0; dn.disabled = idx === BLOCKS_WORK.length - 1;
    if (up.disabled) up.style.opacity = ".35"; if (dn.disabled) dn.style.opacity = ".35";
    up.addEventListener("click", () => { if (idx === 0 || lockStop(idx)) return; panelSwap(idx, idx - 1); if (BLOCK_SOLO === idx) BLOCK_SOLO = idx - 1; renderBlocksCard(); });
    dn.addEventListener("click", () => { if (idx === BLOCKS_WORK.length - 1 || lockStop(idx)) return; panelSwap(idx, idx + 1); if (BLOCK_SOLO === idx) BLOCK_SOLO = idx + 1; renderBlocksCard(); });
    rm.addEventListener("click", () => { if (lockStop(idx)) return; const wasSolo = solo !== null; panelRemove(idx); if (wasSolo) closeSettingsPanel(); renderBlocksCard(); });
    const sv = el("button", null, "Save for reuse"); sv.type = "button"; sv.title = "Save this section to your content library"; sv.style.cssText = miniBtn;
    sv.addEventListener("click", () => clSave(idx));   // CL-1
    head.append(nm, sv, up, dn, rm); box.appendChild(head);
    // CL-LINK: editing the SINGLE SOURCE (reached via a linked chip) — swap the
    // toolbar for a clear "update everywhere" flow so it can't be mistaken for a
    // normal, page-only edit.
    if (blk._clEdit) {
      box.style.borderColor = "var(--plum-line,#d9cef0)"; box.style.background = "var(--plum-tint,#faf7ff)";
      head.textContent = "";
      const it = clItemById(blk._clEdit);
      const lbl = el("div", null, "Editing saved section" + (it ? " · " + it.name : "")); lbl.style.cssText = "flex:1;min-width:150px;font-weight:600;font-size:13px;color:var(--plum-deep,#3a2470)";
      const upd = el("button", null, "Update everywhere"); upd.type = "button"; upd.style.cssText = "font:inherit;font-size:12px;font-weight:600;padding:4px 12px;border-radius:999px;border:2px solid var(--plum,#5b3fa0);background:var(--plum-tint,#faf7ff);color:var(--plum-deep,#3a2470);cursor:pointer";
      const cxl = el("button", null, "Cancel"); cxl.type = "button"; cxl.style.cssText = miniBtn;
      upd.addEventListener("click", () => clUpdateSource(idx));
      cxl.addEventListener("click", () => { BLOCKS_WORK[idx] = { type: "linked", ref: blk._clEdit }; renderBlocksCard(); });
      head.append(lbl, upd, cxl);
      box.appendChild(Object.assign(el("div", "hint", "This is your saved section. Changes here update every place it’s linked — after you Update and publish. “Cancel” keeps it as it was."), { style: "margin:0 0 8px;font-size:12px;color:var(--plum)" }));
    }
    // The floating studio: one section's editor is the inspector card. Its fields land on the
    // Content tab and its look, layout and timing on their own tabs; the pill on the page
    // already moves, duplicates and deletes, so the row of small buttons stays with the list.
    else if (solo !== null) head.remove();
    const panes = solo !== null ? insPanes(box) : null;
    // item 57: a block of a Blocks section has a card of its own, Content and Style, nothing of the section's
    if (panes && def.stackSimple && STK_ITEM != null) { stkItemCard(idx, STK_ITEM, panes); card.appendChild(box); return; }
    if (panes) {   // Layout keeps the two arrows: a keyboard's way to move, and the list's own pair
      const pos = el("div", "ins-field"); pos.appendChild(el("div", "ins-lbl", "Position on the page"));
      const row = el("div", "ins-swatches"); up.className = dn.className = "dc-actbtn"; up.style.cssText = dn.style.cssText = ""; up.title = "Move this section up"; dn.title = "Move this section down";
      up.setAttribute("aria-label", "Move up"); dn.setAttribute("aria-label", "Move down");
      if (up.disabled) up.style.opacity = ".35"; if (dn.disabled) dn.style.opacity = ".35";
      row.append(up, dn); pos.appendChild(row); panes.layout.appendChild(pos);
    }
    const sub = panes ? panes.content : box;
    if (panes) insHead(blk, def);
    const ti = el("input"); ti.type = "text"; ti.placeholder = "Section heading (optional)"; ti.value = blk.title || ""; ti.style.cssText = inputCss;
    ti.addEventListener("change", () => { BLOCKS_WORK[idx] = { ...BLOCKS_WORK[idx], title: ti.value.trim() }; if (panes) insHead(BLOCKS_WORK[idx], def); });
    if (def.stackSimple) { /* item 57: a Blocks section's heading is one of its blocks */ }
    else if (panes) { const f = el("div", "ins-field"); ti.id = "insTitle-" + idx; const l = el("label", "ins-lbl", "Heading"); l.htmlFor = ti.id; f.append(l, ti); sub.appendChild(f); }
    else sub.appendChild(ti);
    // "Write with AI" on the section heading itself — covers headings everywhere
    // (a divider/auto table-of-contents has no heading to write).
    if (!def.dividerSimple && !def.tocSimple && !def.stackSimple) sub.appendChild(aiField(ti, { field: "heading" }));
    if (def.stackSimple) stkSectionCard(idx, sub, panes);
    else if (def.ctaSimple) {
      const t = el("input"), bt = el("input"), u = el("input");
      t.placeholder = "Banner text"; t.value = blk.text || ""; bt.placeholder = "Button label (optional)"; bt.value = blk.button || ""; u.placeholder = "Where the button goes (optional link)"; u.value = blk.url || "";
      [t, bt, u].forEach((inp) => { inp.type = "text"; inp.style.cssText = inputCss; });
      const commit = () => { BLOCKS_WORK[idx] = wLook(idx, { type: "cta", title: ti.value.trim(), text: t.value.trim(), button: bt.value.trim(), url: u.value.trim() }); };
      [t, bt, u].forEach((inp) => inp.addEventListener("change", commit));
      sub.append(t, aiField(t, { field: "banner text" }), bt, u);
      linkPick(u);   // item 225
    } else if (def.reviewsSimple) {
      const rt = el("input"), ct = el("input"), sc = el("input");
      rt.type = "number"; rt.min = "1"; rt.max = "5"; rt.step = "0.1"; rt.placeholder = "Your rating (e.g. 4.9)"; rt.value = blk.rating || "";
      ct.type = "number"; ct.min = "1"; ct.step = "1"; ct.placeholder = "How many reviews (e.g. 120)"; ct.value = blk.count || "";
      sc.type = "text"; sc.placeholder = "Where from (e.g. Google) — optional"; sc.value = blk.source || "";
      [rt, ct, sc].forEach((inp) => { inp.style.cssText = inputCss; });
      const commit = () => { BLOCKS_WORK[idx] = wLook(idx, { type: "reviews", title: ti.value.trim(), rating: parseFloat(rt.value) || 0, count: parseInt(ct.value, 10) || 0, source: sc.value.trim() }); };
      [rt, ct, sc].forEach((inp) => inp.addEventListener("change", commit));
      sub.append(rt, ct, sc);
      sub.appendChild(el("div", "hint", "Use your real rating — it shows as stars with the count (e.g. “4.9 out of 5 — from 120 reviews on Google”)."));
    } else if (def.reviewsWallSimple) {
      const mx = el("input"); mx.type = "number"; mx.min = "1"; mx.max = "50"; mx.step = "1"; mx.placeholder = "How many to show (e.g. 12)"; mx.value = blk.max || 12; mx.style.cssText = inputCss;
      const commit = () => { BLOCKS_WORK[idx] = wLook(idx, { type: "reviews_wall", title: ti.value.trim(), max: parseInt(mx.value, 10) || 12 }); };
      mx.addEventListener("change", commit);
      sub.appendChild(mx);
      const go = el("button", null, "Collect & approve reviews →"); go.type = "button"; go.style.cssText = miniBtn;
      go.addEventListener("click", () => { location.hash = "#reviews"; });
      sub.appendChild(go);
      sub.appendChild(el("div", "hint", "Shows the real, owner-approved reviews from your Reviews tab, with their stars. Google shows no stars in its results for reviews you collect on your own site. Nothing appears until you approve a review and publish. (If there are none yet, this section stays hidden.)"));
    } else if (def.apptSimple) {
      const t = el("input"), bt = el("input"), u = el("input");
      t.placeholder = "A short line (optional) — e.g. Ready when you are."; t.value = blk.text || "";
      bt.placeholder = "Button label (e.g. Book now)"; bt.value = blk.button || "";
      u.placeholder = "Your booking link (e.g. your Calendly or booking page)"; u.value = blk.url || "";
      [t, bt, u].forEach((inp) => { inp.type = "text"; inp.style.cssText = inputCss; });
      const commit = () => { BLOCKS_WORK[idx] = wLook(idx, { type: "appointment", title: ti.value.trim(), text: t.value.trim(), button: bt.value.trim(), url: u.value.trim() }); };
      [t, bt, u].forEach((inp) => inp.addEventListener("change", commit));
      sub.append(t, aiField(t, { field: "banner text" }), bt, u);
      linkPick(u);   // item 225
      sub.appendChild(el("div", "hint", "Visitors tap the button and land on your booking page — nothing external loads on your site."));
    } else if (def.bookingSimple) {
      const t = el("input"); t.type = "text"; t.style.cssText = inputCss;
      t.placeholder = "A short intro (optional) — e.g. Pick a service and a time that suits you."; t.value = blk.intro || "";
      t.addEventListener("change", () => { BLOCKS_WORK[idx] = wLook(idx, { type: "booking", title: ti.value.trim(), intro: t.value.trim() }); });
      sub.appendChild(t); sub.appendChild(aiField(t, { field: "banner text" }));
      const go = el("button", null, "Set up services & hours →"); go.type = "button"; go.style.cssText = miniBtn;
      go.addEventListener("click", () => { location.hash = "#bookings"; });
      sub.appendChild(go);
      sub.appendChild(el("div", "hint", "This section shows a calm, mobile-friendly booking widget on your site. Your services, hours, and appointments live in the Bookings tab — first-party, no external calendar."));
    } else if (def.newsletterSimple) {
      // Builder list item 146: the box collects emails into your own list (Send an update writes
      // to them), or the button sends visitors to another company's sign-up page.
      const t = el("input"), bt = el("input"), u = el("input"), mode = el("select", "nl-mode"), why = el("div", "hint");
      mode.setAttribute("aria-label", "Where sign-ups go");
      mode.innerHTML = '<option value="collect">Collect emails here, into your own list</option><option value="link">Send people to another sign-up page</option>';
      mode.value = blk.url && !blk.collect ? "link" : "collect";
      t.placeholder = "A short line (optional) — e.g. Get updates from us."; t.value = blk.text || "";
      bt.placeholder = "Button label (e.g. Sign up)"; bt.value = blk.button || "";
      u.placeholder = "Your sign-up link (e.g. your Mailchimp or newsletter page)"; u.value = blk.url || "";
      [t, bt, u].forEach((inp) => { inp.type = "text"; inp.style.cssText = inputCss; });
      const show = () => { const link = mode.value === "link"; u.hidden = !link; why.textContent = link ? "Visitors tap the button and land on your sign-up page — nothing external loads on your site." : "Visitors type their email and tick yes. They join your list, and you write to them from Send an update; every email has an unsubscribe link."; };
      const commit = () => { const link = mode.value === "link"; BLOCKS_WORK[idx] = wLook(idx, { type: "newsletter", title: ti.value.trim(), text: t.value.trim(), button: bt.value.trim(), url: link ? u.value.trim() : "", collect: !link }); };
      [t, bt, u].forEach((inp) => inp.addEventListener("change", commit));
      mode.addEventListener("change", () => { show(); commit(); });
      sub.append(mode, t, aiField(t, { field: "banner text" }), bt, u, why); show();
    } else if (def.mapSimple) {
      const ad = el("input"), du = el("input");
      ad.placeholder = "Your address (shown as text)"; ad.value = blk.address || "";
      du.placeholder = "Directions link (optional — if empty, we link to a map search of your address)"; du.value = blk.directions_url || "";
      [ad, du].forEach((inp) => { inp.type = "text"; inp.style.cssText = inputCss; });
      const commit = () => { BLOCKS_WORK[idx] = wLook(idx, { type: "map", title: ti.value.trim(), address: ad.value.trim(), directions_url: du.value.trim(), image_media_id: BLOCKS_WORK[idx].image_media_id || undefined }); };
      [ad, du].forEach((inp) => inp.addEventListener("change", commit));
      sub.append(ad, du);
      const picRow = el("div"); picRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-top:4px";
      if (blk.image_media_id) picRow.appendChild(mediaThumb(blk.image_media_id));
      const pick = el("button", null, blk.image_media_id ? "Change map image" : "Add a map image (optional)"); pick.type = "button"; pick.style.cssText = miniBtn;
      pick.addEventListener("click", () => { commit(); openPicker((id) => { BLOCKS_WORK[idx].image_media_id = id || undefined; renderBlocksCard(); }); });
      picRow.appendChild(pick); sub.appendChild(picRow);
      sub.appendChild(el("div", "hint", "Privacy-safe by design: your own image plus a “Get directions” link — no third-party map embed, so no trackers on your site."));
    } else if (def.proseSimple) {
      const ta = el("textarea"); ta.value = blk.body || ""; ta.setAttribute("data-k", "body_md");   // hook: rich-text toolbar auto-attaches (MutationObserver)
      ta.placeholder = "Write your text here…"; ta.rows = Math.max(4, (blk.body || "").split("\n").length + 1);
      ta.style.cssText = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;line-height:1.6;box-sizing:border-box";
      ta.addEventListener("change", () => { BLOCKS_WORK[idx] = wLook(idx, { type: "richtext", title: ti.value.trim(), body: ta.value.trim() }); });
      sub.appendChild(ta);
      sub.appendChild(aiField(ta, {}));
      sub.appendChild(el("div", "hint", "Use the formatting buttons above — headings, bold, links and lists all work."));
    } else if (def.imageSimple) {
      const picRow = el("div"); picRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px";
      if (blk.image_id) picRow.appendChild(mediaThumb(blk.image_id));
      const pick = el("button", null, blk.image_id ? "Change image" : "Choose an image"); pick.type = "button"; pick.style.cssText = miniBtn;
      const cap = el("input"), alt = el("input"), lk = el("input");
      cap.placeholder = "Caption (optional)"; cap.value = blk.caption || "";
      alt.placeholder = "Describe the image for screen readers (alt text)"; alt.value = blk.alt || "";
      lk.placeholder = "Link when the image is clicked (optional)"; lk.value = blk.link || "";
      [cap, alt, lk].forEach((inp) => { inp.type = "text"; inp.style.cssText = inputCss; });
      // A11y: mark a purely decorative image so it's hidden from screen readers
      // (alt="" + role="presentation") rather than forcing meaningless alt text.
      const decWrap = el("label"); decWrap.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12.5px;margin:2px 0 6px";
      const dec = el("input"); dec.type = "checkbox"; dec.checked = !!blk.decorative; dec.style.cssText = "width:auto;margin:0";
      decWrap.append(dec, document.createTextNode("This image is decorative (screen readers skip it — no alt text needed)"));
      const commit = () => { BLOCKS_WORK[idx] = wLook(idx, { type: "image", title: ti.value.trim(), image_id: BLOCKS_WORK[idx].image_id || undefined, caption: cap.value.trim(), alt: alt.value.trim(), link: lk.value.trim(), decorative: dec.checked || undefined }); alt.disabled = dec.checked; alt.style.opacity = dec.checked ? ".5" : "1"; };
      [cap, alt, lk].forEach((inp) => inp.addEventListener("change", commit));
      dec.addEventListener("change", commit);
      alt.disabled = dec.checked; alt.style.opacity = dec.checked ? ".5" : "1";
      pick.addEventListener("click", () => { commit(); openPicker((id) => { BLOCKS_WORK[idx].image_id = id || undefined; renderBlocksCard(); }); });
      picRow.appendChild(pick); sub.appendChild(picRow); sub.append(cap, aiField(cap, { field: "caption" }), alt, decWrap, lk); linkPick(lk);
      sub.appendChild(el("div", "hint", "Alt text helps screen readers and search — describe what's in the photo. Tick “decorative” only for backgrounds/flourishes that add no information."));
    } else if (def.imageTextSimple) {
      const picRow = el("div"); picRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px";
      if (blk.image_id) picRow.appendChild(mediaThumb(blk.image_id));
      const pick = el("button", null, blk.image_id ? "Change image" : "Choose an image"); pick.type = "button"; pick.style.cssText = miniBtn;
      const ta = el("textarea"); ta.value = blk.body || ""; ta.setAttribute("data-k", "body_md");   // hook: rich-text toolbar auto-attaches
      ta.placeholder = "Write the text that sits beside the image…"; ta.rows = Math.max(4, (blk.body || "").split("\n").length + 1);
      ta.style.cssText = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;line-height:1.6;box-sizing:border-box;margin-bottom:6px";
      const sideWrap = el("label", "hint", "Image on the "); const side = el("select");
      [["left", "left"], ["right", "right"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if ((blk.side || "left") === v) o.selected = true; side.appendChild(o); });
      side.style.cssText = "font:inherit;font-size:13px;margin-left:6px;padding:4px 6px;border:1px solid var(--line,#ddd);border-radius:8px"; sideWrap.appendChild(side);
      const bl = el("input"), bu = el("input");
      bl.placeholder = "Button label (optional)"; bl.value = (blk.button && blk.button.label) || "";
      bu.placeholder = "Button link (optional)"; bu.value = (blk.button && blk.button.url) || "";
      [bl, bu].forEach((inp) => { inp.type = "text"; inp.style.cssText = inputCss; });
      // item 329: Photo in a colour frame leads its words with a big number and a short line, shown
      // when both are filled; the two labelled fields appear while that design is in use
      const numField = (label, key, max, ph) => {
        const f = el("div", "ins-field"), id = "itNum-" + key + "-" + idx, l = el("label", "ins-lbl", label); l.htmlFor = id;
        const i = el("input"); i.type = "text"; i.id = id; i.maxLength = max; i.placeholder = ph; i.value = blk[key] || ""; i.style.cssText = inputCss;
        f.append(l, i); f.input = i; return f;
      };
      const nums = blk.variant === "frame" ? [numField("Big number (optional)", "number", 12, "15"), numField("What the number counts (optional)", "number_label", 60, "years planting gardens")] : [];
      const commit = () => {
        const o = { type: "image_text", title: ti.value.trim(), image_id: BLOCKS_WORK[idx].image_id || undefined, body: ta.value.trim(), side: side.value === "right" ? "right" : "left" }; const L = bl.value.trim(), U = bu.value.trim(); if (L && U) o.button = { label: L, url: U };
        const was = BLOCKS_WORK[idx] || {};
        ["number", "number_label"].forEach((k, n) => { const v = nums.length ? nums[n].input.value.trim() : String(was[k] || ""); if (v) o[k] = v; });
        BLOCKS_WORK[idx] = wLook(idx, o);
      };
      [ta, side, bl, bu, ...nums.map((f) => f.input)].forEach((inp) => inp.addEventListener("change", commit));
      pick.addEventListener("click", () => { commit(); openPicker((id) => { BLOCKS_WORK[idx].image_id = id || undefined; renderBlocksCard(); }); });
      // item 224: in the inspector the photo's side is an arrangement on the Layout tab; the
      // select stays behind the scenes so a Content edit keeps the side that was picked there
      const inPane = sub.classList && sub.classList.contains("ins-pane");
      picRow.appendChild(pick); sub.appendChild(picRow); sub.append(...nums, ta, aiField(ta, {}), ...(inPane ? [] : [sideWrap]), bl, bu); linkPick(bu);
      sub.appendChild(el("div", "hint", inPane ? "Which side the photo sits on is under Layout. On phones the image and text stack automatically." : "On phones the image and text stack automatically."));
    } else if (def.dividerSimple) {
      const styWrap = el("label", "hint", "Style "); const sty = el("select");
      [["line", "A line"], ["space", "Empty space"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if ((blk.style || "line") === v) o.selected = true; sty.appendChild(o); });
      const szWrap = el("label", "hint", "Size "); const sz = el("select");
      [["small", "Small"], ["medium", "Medium"], ["large", "Large"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if ((blk.size || "medium") === v) o.selected = true; sz.appendChild(o); });
      [sty, sz].forEach((se) => { se.style.cssText = "font:inherit;font-size:13px;margin-left:6px;padding:4px 6px;border:1px solid var(--line,#ddd);border-radius:8px"; });
      const commit = () => { BLOCKS_WORK[idx] = { type: "divider", style: sty.value === "space" ? "space" : "line", size: (["small", "large"].includes(sz.value) ? sz.value : "medium") }; };
      [sty, sz].forEach((se) => se.addEventListener("change", commit));
      styWrap.appendChild(sty); szWrap.appendChild(sz);
      const row = el("div"); row.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;align-items:center"; row.append(styWrap, szWrap);
      sub.appendChild(row);
      sub.appendChild(el("div", "hint", "Purely visual — a divider line or blank space between sections. (The heading above is ignored for dividers.)"));
    } else if (def.downloadSimple) {
      const picRow = el("div"); picRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:8px";
      if (blk.file_id) picRow.appendChild(mediaThumb(blk.file_id));
      const pick = el("button", null, blk.file_id ? "Change file" : "Choose a file"); pick.type = "button"; pick.style.cssText = miniBtn;
      const lb = el("input"); lb.type = "text"; lb.placeholder = "Download label (optional — e.g. 2026 Menu)"; lb.value = blk.label || ""; lb.style.cssText = inputCss;
      const commit = () => { BLOCKS_WORK[idx] = wLook(idx, { type: "download", title: ti.value.trim(), file_id: BLOCKS_WORK[idx].file_id || undefined, label: lb.value.trim() || undefined }); };
      lb.addEventListener("change", commit);
      pick.addEventListener("click", () => { commit(); openPicker((id) => { BLOCKS_WORK[idx].file_id = id || undefined; renderBlocksCard(); }); });
      picRow.appendChild(pick); sub.appendChild(picRow); sub.appendChild(lb);
      sub.appendChild(el("div", "hint", "Visitors get a clear “Download …” link. The file is served from your own site — nothing external loads."));
    } else if (def.tocSimple) {
      sub.appendChild(el("div", "hint", "Nothing to fill in — this builds an “On this page” jump list automatically from your section headings. Give the sections above headings and place this near the top."));
    } else if (def.titleSimple) {
      const st = el("input"); st.type = "text"; st.placeholder = "Subtitle (optional)"; st.value = blk.subtitle || ""; st.style.cssText = inputCss;
      st.addEventListener("change", () => { BLOCKS_WORK[idx] = wLook(idx, { type: "title", title: ti.value.trim(), subtitle: st.value.trim() || undefined }); });
      sub.appendChild(st);
      sub.appendChild(el("div", "hint", "Type the heading in the title field above; the subtitle is an optional line beneath it."));
    } else if (def.spotlightSimple) {
      const ey = el("input"); ey.type = "text"; ey.placeholder = "Eyebrow — a small label above the heading (optional)"; ey.value = blk.eyebrow || ""; ey.style.cssText = inputCss;
      const ta = el("textarea"); ta.value = blk.body || ""; ta.setAttribute("data-k", "body_md"); ta.placeholder = "A sentence or two…"; ta.rows = Math.max(3, (blk.body || "").split("\n").length + 1);
      ta.style.cssText = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;line-height:1.6;box-sizing:border-box;margin:6px 0";
      const bl = el("input"), bu = el("input");
      bl.placeholder = "Button label (optional)"; bl.value = (blk.button && blk.button.label) || "";
      bu.placeholder = "Button link (optional)"; bu.value = (blk.button && blk.button.url) || "";
      [bl, bu].forEach((inp) => { inp.type = "text"; inp.style.cssText = inputCss; });
      const commit = () => { const o = { type: "spotlight", title: ti.value.trim() }; const E = ey.value.trim(); if (E) o.eyebrow = E; const B = ta.value.trim(); if (B) o.body = B; const L = bl.value.trim(), U = bu.value.trim(); if (L && U) o.button = { label: L, url: U }; BLOCKS_WORK[idx] = wLook(idx, o); };
      [ey, ta, bl, bu].forEach((inp) => inp.addEventListener("change", commit));
      sub.append(ey, ta, aiField(ta, {}), bl, bu);
      linkPick(bu);   // item 225
      sub.appendChild(el("div", "hint", "A prominent highlight band. The heading goes in the title field above."));
    } else if (def.tableSimple) {
      renderTableBlockBody(blk, idx, sub, ti);   // builder item 315: a grid of cells, add a row or a column
    } else if (def.structured === "columns") {
      renderColumnsBlockBody(blk, idx, sub, ti);
      sub.appendChild(el("div", "hint", def.hint));
    } else if (def.structured === "cards") {
      renderCardsBlockBody(blk, idx, sub, ti);
      sub.appendChild(el("div", "hint", def.hint));
    } else if (def.mediaKind) {
      renderMediaBlockBody(def, blk, idx, sub, ti);
      sub.appendChild(el("div", "hint", def.hint));
    } else if (def.structured === "team") {
      renderTeamBlockBody(blk, idx, sub, ti);
      sub.appendChild(el("div", "hint", def.hint));
    } else if (def.structured === "accordion") {
      renderAccordionBlockBody(blk, idx, sub, ti);
    } else if (def.structured === "tabs") {
      renderTabsBlockBody(blk, idx, sub, ti);
    } else if (def.structured === "carousel") {
      renderCarouselBlockBody(blk, idx, sub, ti);
    } else if (def.structured === "progress") {
      renderProgressBlockBody(blk, idx, sub, ti);
      sub.appendChild(el("div", "hint", def.hint));
    } else if (def.structured === "buttons") {
      renderButtonsBlockBody(blk, idx, sub, ti);
      sub.appendChild(el("div", "hint", def.hint));
    } else if (def.field || def.areasSimple) {
      renderRowsBlockBody(def, blk, idx, sub, ti);   // builder item 315: one card per item, named fields (item 304's line icons are on each card)
    }
    // Wave-1 G4: the "Style" pill row — only for block types with curated variants.
    blockVariantRow(idx, blk, panes ? panes.layout : sub);
    // Phase T-STYLE: the shared "Look of this section" options — every content
    // section, but not the presentational divider or the auto-built table of contents.
    if (!def.dividerSimple && !def.tocSimple) blockLookRow(idx, blk, panes || sub);
    // G27: the per-element style overrides popover — same sections as the look row.
    if (!def.dividerSimple && !def.tocSimple) blockStyleRow(idx, blk, panes ? panes.style : sub, !!panes);
    // Phase EXP: the shared "Show this only for a while" window — same set of sections
    // (a spacer/auto TOC has nothing to schedule).
    if (!def.dividerSimple && !def.tocSimple) blockWindowRow(idx, blk, panes ? panes.when : sub, !!panes);
    if (panes) { insFinish(panes, idx, blk, def); insLockNote(box, panes, idx, blk); }
    card.appendChild(box);
    // FD-T-LIB: a just-added section scrolls into view and takes focus, so it's
    // never "added but invisible" below the fold.
    // Item 77: someone already typing in this section's fields keeps the caret; on a busy
    // phone the timer can fire late, and the next words went into the heading.
    if (idx === focusIdx) setTimeout(() => { try {
      const ae = document.activeElement, typing = ae && ae !== ti && box.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
      if (panes) {
        // One section's card opens at its top, the first field in view. Centring it put the
        // Heading under the tabs whenever the fields ran taller than the card (a phone, always).
        const sc = box.closest(".dc-panel-scroll"); if (sc && !typing) sc.scrollTop = 0;
        if (INS_TAB !== "content") return;   // opened on Style, Layout or When: the tab keeps the focus
        if (!typing) ti.focus({ preventScroll: true });   // the caret in the heading, and nothing scrolls to put it there
        return;
      }
      box.scrollIntoView({ behavior: "smooth", block: "center" });
      if (!typing) ti.focus();
    } catch (_) {} }, 40);
  });
  if (solo === null) card.appendChild(blkGap(BLOCKS_WORK.length));   // #3/#4 — trailing "+" insert point / drop-line target
  if ($("designTray")) renderBlockTray();   // #3 — keep the tray's "already added" states in sync
  if (solo !== null) return;   // one section's editor: the add library and saved sections stay in "All sections"
  const present = new Set(BLOCKS_WORK.map((b) => b.type));
  // Every type is addable more than once now — only true singletons (toc / reviews
  // wall) drop out of the menu once the page already has one.
  const addable = BLOCK_DEFS.filter((d) => !(BLOCK_SINGLETON.has(d.type) && present.has(d.type)));
  // ── FD-T-LIB: "Already on your site" — your CORE sections live in their own tabs.
  //    Chips route there so an owner isn't hunting for a "hero / FAQ" to add when
  //    they already have one. Read-only; reuses go().
  {
    const core = el("div"); core.style.cssText = "margin-top:18px;padding:12px 14px;border:1px solid var(--line,#e5e5e5);border-radius:12px;background:var(--wash,#faf9fb)";
    core.appendChild(Object.assign(el("div", null, "Already on your site"), { style: "font-weight:600;font-size:12.5px" }));
    core.appendChild(el("div", "hint", "These main sections are edited in their own tabs — tap one to jump there. That's why they aren't in the “Add a section” list below."));
    const chips = el("div"); chips.style.cssText = "margin-top:8px;display:flex;gap:7px;flex-wrap:wrap";
    CORE_SECTIONS.forEach(([label, view]) => {
      const c = el("button", null, label); c.type = "button"; c.title = "Edit your " + label + " section";
      c.style.cssText = "font:inherit;font-size:12px;padding:4px 11px;border-radius:999px;border:1px solid var(--line,#ddd);background:transparent;color:inherit;cursor:pointer";
      c.addEventListener("click", () => go(view));
      chips.appendChild(c);
    });
    core.appendChild(chips);
    card.appendChild(core);
  }
  // ── FD-T-LIB: one prominent, purpose-grouped "Add a section" library. Reuses
  //    BLOCK_DEFS + emptyBlock; each addable def appears once, under a familiar
  //    header, with a muted alias for recognition. The server suggestion folds in
  //    as a highlighted first "Recommended for you" group. Added → scroll + focus.
  if (addable.length) {
    const lib = el("div"); lib.style.cssText = "margin-top:18px";
    lib.appendChild(el("label", null, "Add a section"));
    lib.appendChild(el("div", "hint", "Pick a ready-made section for your home page, then fill it in — no design needed. Familiar names are shown underneath."));
    const groupGrid = () => { const g = el("div"); g.style.cssText = "margin-top:8px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px"; return g; };
    const addBtn = (d) => {
      const b = el("button"); b.type = "button";
      b.style.cssText = "text-align:left;font:inherit;padding:9px 12px;border-radius:10px;border:1px solid var(--line,#ddd);background:var(--sheet,#fff);color:inherit;cursor:pointer;display:flex;flex-direction:column;gap:2px;min-width:0";
      b.appendChild(Object.assign(el("div", null, "+ " + d.name), { style: "font-weight:600;font-size:12.5px" }));
      if (SECTION_ALIAS[d.type]) b.appendChild(Object.assign(el("div", null, SECTION_ALIAS[d.type]), { style: "font-size:12px;color:var(--soft,#888)" }));
      b.addEventListener("click", () => { dcCaptureScroll(); const at = addBlockAt(d, BLOCKS_WORK.length); if (MEDIA_FILL_TYPES.has(d.type)) { DC_FOCUS_BI = null; eeEditBlock(at); } else { saveBlocks(); } });
      return b;
    };
    // Recommended for you — the server suggestion, folded in as the lead group.
    let recTypes = [];
    if (BLOCK_SUGGEST && Array.isArray(BLOCK_SUGGEST.blocks)) {
      recTypes = BLOCK_SUGGEST.blocks.filter((t) => !present.has(t) && BLOCK_DEFS.some((d) => d.type === t));
    }
    const recSet = new Set(recTypes);
    if (recTypes.length) {
      const wrap = el("div"); wrap.style.cssText = "margin-top:12px;padding:12px 14px;border:1px solid var(--plum-line,#e6ddf5);background:var(--plum-tint,#faf7ff);border-radius:12px";
      wrap.appendChild(Object.assign(el("div", null, "✦ Recommended for you"), { style: "font-weight:600;font-size:12.5px;color:var(--plum-deep,#3a2470)" }));
      wrap.appendChild(el("div", "hint", BLOCK_SUGGEST.note || "A good fit for your kind of business."));
      const grid = groupGrid();
      recTypes.forEach((t) => { const d = BLOCK_DEFS.find((x) => x.type === t); if (d) grid.appendChild(addBtn(d)); });
      wrap.appendChild(grid);
      if (recTypes.length > 1) {
        const all = el("button", null, "Add all recommended"); all.type = "button";
        all.style.cssText = "font:inherit;font-size:12px;margin-top:10px;padding:6px 13px;border-radius:999px;border:2px solid var(--plum,#5b3fa0);background:var(--sheet,#fff);color:var(--plum-deep,#3a2470);cursor:pointer";
        all.addEventListener("click", () => { dcCaptureScroll(); let firstAt = null; recTypes.forEach((t) => { const d = BLOCK_DEFS.find((x) => x.type === t); if (d) { const at = addBlockAt(d, BLOCKS_WORK.length); if (firstAt === null) firstAt = at; } }); if (firstAt !== null) { BLOCK_FOCUS = firstAt; DC_FOCUS_BI = firstAt; DC_FOCUS_SOFT = false; } saveBlocks(); });   /* recommended set is content blocks — safe to save + render */
        wrap.appendChild(all);
      }
      lib.appendChild(wrap);
    }
    // Recommended-first WITHIN each purpose group: the server `order` (built from
    // site_components' industries[] model + vertical presets) floats the blocks that
    // suit this business to the top of their group. Stable — everything else keeps
    // its listed order, and NOTHING is hidden (the whole group still shows).
    const ORDER = (BLOCK_SUGGEST && Array.isArray(BLOCK_SUGGEST.order)) ? BLOCK_SUGGEST.order : [];
    const rank = (t) => { const i = ORDER.indexOf(t); return i === -1 ? 999 : i; };
    // Purpose groups — every remaining addable def under exactly one familiar header.
    SECTION_GROUPS.forEach((grp) => {
      const defs = grp.types.map((t) => addable.find((d) => d.type === t)).filter((d) => d && !recSet.has(d.type));
      defs.sort((a, b) => rank(a.type) - rank(b.type));
      if (!defs.length) return;
      const wrap = el("div"); wrap.style.cssText = "margin-top:14px";
      wrap.appendChild(Object.assign(el("div", null, grp.label), { style: "font-weight:600;font-size:12.5px" }));
      wrap.appendChild(el("div", "hint", grp.note));
      const grid = groupGrid();
      defs.forEach((d) => grid.appendChild(addBtn(d)));
      wrap.appendChild(grid);
      lib.appendChild(wrap);
    });
    card.appendChild(lib);
  }
  // ── CL-1: Saved sections — reuse a section you crafted, later. Same block model
  //    + editor (save/insert/delete unchanged). Empty = a quiet secondary note, not
  //    an open panel that reads as broken.
  {
    const libRow = el("div"); libRow.style.cssText = "margin-top:18px;padding-top:14px;border-top:1px solid var(--line,#eee)";
    if (CL_ITEMS === null) {
      const link = el("button", null, "Saved sections — reuse later"); link.type = "button";
      link.style.cssText = "font:inherit;font-size:12.5px;font-weight:600;padding:0;border:none;background:none;color:inherit;cursor:pointer";
      const hint = el("span", "hint", "  — show"); hint.style.fontWeight = "400"; link.appendChild(hint);
      link.addEventListener("click", async () => { CL_SHOW = true; try { CL_ITEMS = (await api("GET", "/content-library")).data || []; } catch (_) { CL_ITEMS = []; } renderBlocksCard(); });
      libRow.appendChild(link);
    } else if (!CL_ITEMS.length) {
      libRow.appendChild(Object.assign(el("div", null, "Saved sections — reuse later"), { style: "font-weight:600;font-size:12.5px" }));
      libRow.appendChild(el("div", "hint", "No saved sections yet. Use “Save” on any section above to keep a copy you can reuse here — in a launch, or after a rebuild."));
    } else {
      const head = el("div"); head.style.cssText = "display:flex;align-items:center;gap:8px";
      head.appendChild(Object.assign(el("div", null, "Saved sections — reuse later"), { style: "flex:1;font-weight:600;font-size:12.5px" }));
      const tog = el("button", null, CL_SHOW ? "Hide" : "Show (" + CL_ITEMS.length + ")"); tog.type = "button";
      tog.style.cssText = "font:inherit;font-size:12px;padding:4px 11px;border-radius:999px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
      tog.addEventListener("click", () => { CL_SHOW = !CL_SHOW; renderBlocksCard(); });
      head.append(tog); libRow.appendChild(head);
      if (CL_SHOW) {
        // CL-LINK: two ways to reuse a saved section — a Copy (independent) or a Link
        // (edits to the saved section update everywhere it’s linked). Spelled out so
        // the choice is never a guess.
        libRow.appendChild(Object.assign(el("div", "hint", "Insert a copy = an independent section you edit on its own. Link = it stays tied to this saved section, so editing the saved section updates every linked spot."), { style: "margin-top:6px;font-size:12px" }));
        const list = el("div"); list.style.cssText = "margin-top:8px;display:flex;flex-direction:column;gap:6px";
        CL_ITEMS.forEach((it) => {
          const wrap = el("div"); wrap.style.cssText = "border:1px solid var(--line,#eee);border-radius:8px;padding:6px 10px";
          const row = el("div"); row.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap";
          row.appendChild(Object.assign(el("span", null, it.name), { style: "flex:1;min-width:120px;font-size:12.5px" }));
          row.appendChild(Object.assign(el("span", null, (BLOCK_DEFS.find((d) => d.type === (it.block && it.block.type)) || {}).name || (it.block && it.block.type) || ""), { style: "font-size:12px;color:var(--soft,#888)" }));
          // G8: where-used — how many pages LIVE-LINK this saved section; expands to name them
          const used = Array.isArray(it.used_on) ? it.used_on : [];
          if (used.length) {
            const uc = el("button", null, "used on " + used.length + " page" + (used.length === 1 ? "" : "s")); uc.type = "button";
            uc.title = "Show which pages link this saved section";
            uc.style.cssText = "font:inherit;font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--plum-line,#d9cef0);background:var(--plum-tint,#faf7ff);color:var(--plum-deep,#3a2470);cursor:pointer";
            const usedLine = el("div", "hint", "Linked on: " + used.map((u) => u.title).join(", ") + " — editing the saved section changes it everywhere it’s linked.");
            usedLine.style.cssText = "margin-top:5px;font-size:12px"; usedLine.hidden = true;
            uc.addEventListener("click", () => { usedLine.hidden = !usedLine.hidden; });
            row.appendChild(uc); wrap.appendChild(row); wrap.appendChild(usedLine);
          } else wrap.appendChild(row);
          const ins = el("button", null, "Insert a copy"); ins.type = "button"; ins.title = "An independent copy you edit on its own"; ins.style.cssText = "font:inherit;font-size:12px;padding:4px 11px;border-radius:999px;border:1px solid var(--plum,#5b3fa0);background:transparent;color:var(--plum-deep,#3a2470);cursor:pointer";
          ins.addEventListener("click", () => clInsert(it.block));
          const lnk = el("button", null, "Link"); lnk.type = "button"; lnk.title = "Edits to this saved section update everywhere it’s linked"; lnk.style.cssText = "font:inherit;font-size:12px;padding:4px 11px;border-radius:999px;border:2px solid var(--plum,#5b3fa0);background:var(--plum-tint,#faf7ff);color:var(--plum-deep,#3a2470);cursor:pointer";
          lnk.addEventListener("click", () => clInsertLink(it));
          const del = icoBtn("x", "Remove from library", null, 14); del.dataset.needs = "delete"; del.style.cssText = "font:inherit;font-size:14px;padding:2px 9px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
          del.addEventListener("click", async () => {
            // G8: deleting a LIVE-LINKED entry first names the pages it appears on
            if (used.length && !(await askYes("“" + it.name + "” appears on: " + used.map((u) => u.title).join(", ") + ". Removing it from the library removes it from " + (used.length === 1 ? "that page" : "those pages") + " at your next publish. Remove anyway?", { ok: "Remove anyway", danger: true }))) return;
            try { await api("DELETE", "/content-library/" + it.id); CL_ITEMS = CL_ITEMS.filter((x) => x.id !== it.id); toast("Removed from library"); renderBlocksCard(); } catch (err) { toast(nice(err), true); }
          });
          row.append(ins, lnk, del); list.appendChild(wrap);
        });
        libRow.appendChild(list);
      }
    }
    card.appendChild(libRow);
  }
  card.appendChild(el("div", "hint", "Empty sections won’t appear on your site."));
}
// ── The builder's "Write with AI" — one control for every text field ────────
// Reuses the studio Writer (POST /writer/rewrite): improve, shorten, lengthen,
// change tone, or write-from-a-prompt when the field is empty. It PROPOSES a
// draft; the owner taps "Use it" and it fills THIS field through the field's own
// change handler (updating BLOCKS_WORK) — nothing publishes, nothing is stored
// server-side. Voice grounding, the honest "not switched on" (503) note, and the
// hard cost ceiling all live in the route. Same ✦ affordance as the rest of the
// studio; propose-then-approve is the moat, kept intact.
const AI_TONES = ["friendlier", "more professional", "warmer", "more confident", "calmer", "more playful"];
// Express-Rewrite parity: preset tone chips (label → the AI_TONES direction sent
// to the route) and up to 3 candidates per ask (count:3 — old servers that
// answer a single {text} still work; the picker just shows one).
const AI_TONE_PRESETS = [["Friendly", "friendlier"], ["Professional", "more professional"], ["Confident", "more confident"], ["Playful", "more playful"]];
const AI_REWRITE_COUNT = 3;
function aiField(inputEl, opts) {
  opts = opts || {};
  const label = opts.field || "";
  const miniPill = "font:inherit;font-size:12px;padding:4px 11px;border-radius:999px;border:1px solid var(--line,#ddd);background:var(--sheet,#fff);cursor:pointer";
  const usePill = "font:inherit;font-size:12px;font-weight:600;padding:4px 13px;border-radius:999px;border:2px solid var(--plum,#5b3fa0);background:var(--plum-tint,#faf7ff);color:var(--plum-deep,#3a2470);cursor:pointer";
  const wrap = el("div", "ai-wrap"); wrap.style.cssText = "margin:0 0 8px";
  const chips = el("div", "ai-chips");
  const trigger = el("button", "ai-chip ai-main", "✦ Write with AI"); trigger.type = "button"; trigger.title = "Draft or improve this text — you approve before anything changes";
  chips.appendChild(trigger);
  // two quick asks beside it; each works from the words already in the field
  const quick = (lbl, body) => {
    const b = el("button", "ai-chip", lbl); b.type = "button"; b.title = lbl + " — a draft to pick from, nothing changes until you use it";
    b.addEventListener("click", () => { if (!curText()) { panel.hidden = false; menu(); return; } panel.hidden = false; go(body()); });
    chips.appendChild(b);
  };
  quick("Shorter", () => ({ action: "shorten", text: curText() }));
  quick("Warmer", () => ({ action: "tone", text: curText(), tone: "warmer" }));
  wrap.appendChild(chips);
  const panel = el("div"); panel.hidden = true; panel.style.cssText = "margin-top:8px;border:1px solid var(--plum-line,#e6ddf5);background:var(--plum-tint,#faf7ff);border-radius:10px;padding:10px 12px";
  wrap.appendChild(panel);
  const curText = () => (inputEl.value || "").trim();
  const place = (t) => {
    inputEl.value = t;
    if (inputEl.tagName === "TEXTAREA") inputEl.rows = Math.max(3, t.split("\n").length + 1);
    inputEl.dispatchEvent(new Event("change", { bubbles: true }));   // reuse the field's own commit → BLOCKS_WORK
  };
  const go = (body) => {
    panel.innerHTML = ""; panel.appendChild(Object.assign(el("div", "hint", "Writing… you’ll see drafts to pick from."), { style: "margin:0" }));
    api("POST", "/writer/rewrite", Object.assign({ field: label || undefined, count: AI_REWRITE_COUNT }, body))
      .then((r) => {
        const d = (r && r.data) || {};
        const opts2 = (Array.isArray(d.options) && d.options.length ? d.options : [d.text]).filter(Boolean);
        result(opts2, body);
      })
      .catch((err) => {
        panel.innerHTML = "";
        panel.appendChild(Object.assign(el("div", "hint", nice(err)), { style: "margin:0 0 8px" }));
        const back = el("button", null, "Back"); back.type = "button"; back.style.cssText = miniPill; back.addEventListener("click", menu);
        panel.appendChild(back);
      });
  };
  // Express parity: up to 3 candidates, each with its own "Use" — still
  // propose-then-approve; nothing changes until one is chosen.
  function result(options, body) {
    panel.innerHTML = "";
    const many = options.length > 1;
    panel.appendChild(Object.assign(el("div", "hint", many ? "Pick the one that reads right — nothing changes until you use one:" : "A draft — nothing changes until you use it:"), { style: "margin:0 0 6px" }));
    options.forEach((text, i) => {
      const box = el("div"); box.style.cssText = "white-space:pre-wrap;font-size:13px;line-height:1.5;background:var(--sheet,#fff);border:1px solid var(--plum-line,#e6ddf5);border-radius:8px;padding:8px 10px;max-height:180px;overflow:auto" + (i ? ";margin-top:8px" : ""); box.textContent = text;
      const use = el("button", null, many ? "Use this one" : "Use it"); use.type = "button"; use.style.cssText = usePill + ";margin-top:6px";
      use.addEventListener("click", () => { place(text); panel.hidden = true; panel.innerHTML = ""; toast("Placed in your draft — publish when it reads right"); });
      panel.append(box, use);
    });
    const acts = el("div"); acts.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px";
    const again = el("button", null, "Try again"); again.type = "button"; again.style.cssText = miniPill; again.addEventListener("click", () => go(body));
    const cancel = el("button", null, "Cancel"); cancel.type = "button"; cancel.style.cssText = miniPill; cancel.addEventListener("click", () => { panel.hidden = true; panel.innerHTML = ""; });
    acts.append(again, cancel); panel.appendChild(acts);
  }
  function menu() {
    panel.innerHTML = "";
    const has = curText().length > 0;
    // item 328: the voice the writer writes in, from Business details
    const vl = el("div", "hint ai-voice", voiceWords()); vl.hidden = !vl.textContent; panel.appendChild(vl);
    voiceLoad().then(() => { vl.textContent = voiceWords(); vl.hidden = !vl.textContent; });
    panel.appendChild(Object.assign(el("div", "hint", has ? "Pick one — you’ll see a draft before anything changes." : "Tell me what this should say — I’ll draft it from your business’s own facts."), { style: "margin:0 0 8px" }));
    if (has) {
      const row = el("div"); row.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center";
      [["Improve", "improve"], ["Shorten", "shorten"], ["Lengthen", "lengthen"]].forEach(([l, a]) => {
        const b = el("button", null, l); b.type = "button"; b.style.cssText = miniPill; b.addEventListener("click", () => go({ action: a, text: curText() })); row.appendChild(b);
      });
      panel.appendChild(row);
      // Tone preset chips (Express parity) — one tap asks for 3 candidates in that
      // direction; the extra directions stay reachable in the "More tones" select.
      const toneRow = el("div"); toneRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px";
      toneRow.appendChild(Object.assign(el("span", "hint", "Tone:"), { style: "margin:0" }));
      AI_TONE_PRESETS.forEach(([lbl, tone]) => {
        const b = el("button", null, lbl); b.type = "button"; b.style.cssText = miniPill;
        b.addEventListener("click", () => go({ action: "tone", text: curText(), tone })); toneRow.appendChild(b);
      });
      const presetVals = AI_TONE_PRESETS.map(([, v]) => v);
      const rest = AI_TONES.filter((t) => !presetVals.includes(t));
      if (rest.length) {
        const toneSel = el("select"); toneSel.style.cssText = "font:inherit;font-size:12px;padding:4px 6px;border:1px solid var(--line,#ddd);border-radius:8px";
        const ph = el("option", null, "More tones…"); ph.value = ""; toneSel.appendChild(ph);
        rest.forEach((t) => { const o = el("option", null, t); o.value = t; toneSel.appendChild(o); });
        toneSel.addEventListener("change", () => { if (toneSel.value) go({ action: "tone", text: curText(), tone: toneSel.value }); });
        toneRow.appendChild(toneSel);
      }
      panel.appendChild(toneRow);
    } else if (opts.write !== false) {
      const pin = el("input"); pin.type = "text"; pin.placeholder = "e.g. a warm welcome line for the top of the page";
      pin.style.cssText = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;box-sizing:border-box";
      const b = el("button", null, "Draft it"); b.type = "button"; b.style.cssText = usePill; b.style.marginTop = "8px";
      const submit = () => { const p = pin.value.trim(); if (!p) { pin.focus(); return; } go({ action: "write", prompt: p }); };
      b.addEventListener("click", submit);
      pin.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } });
      panel.append(pin, b);
    } else {
      panel.appendChild(Object.assign(el("div", "hint", "Write a first line here, then I can improve it."), { style: "margin:0" }));
    }
  }
  trigger.addEventListener("click", () => { panel.hidden = !panel.hidden; if (!panel.hidden) menu(); else panel.innerHTML = ""; });
  return wrap;
}
// FD-T17 media block editors — pick photos from your library (openPicker → media id).
function renderMediaBlockBody(def, blk, idx, sub, ti) {
  const miniBtn = "font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  const inputCss = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-bottom:6px;box-sizing:border-box";
  const commitTitle = () => { BLOCKS_WORK[idx].title = ti.value.trim(); };
  const cur = () => BLOCKS_WORK[idx];   // item 77: the section as it stands, not the copy this panel was drawn from
  if (def.mediaKind === "gallery") {
    // Wave-2 G18: only the gallery block carries per-image captions + the zoom
    // lightbox — partners shares this picker but stores neither key.
    const isGallery = def.type === "gallery";
    const ids = Array.isArray(blk.image_ids) ? blk.image_ids : [];
    const grid = el("div"); grid.style.cssText = "display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px";
    // item 317: the order is changed with the arrows under each photo, or by dragging one onto another
    const moveTo = (from, to) => {
      if (to < 0 || to >= ids.length || from === to) return;
      commitTitle(); const b = cur(); const [id] = b.image_ids.splice(from, 1); b.image_ids.splice(to, 0, id);
      if (Array.isArray(b.captions)) { const [c] = b.captions.splice(from, 1); b.captions.splice(to, 0, c); }
      renderBlocksCard(); dcLiveFromPanel();
    };
    ids.forEach((id, k) => {
      const cell = el("div", "gal-cell"); cell.dataset.k = String(k);
      const chip = el("span"); chip.style.cssText = "position:relative;display:inline-block";
      chip.appendChild(mediaThumb(id));
      const x = icoBtn("x", "Remove this photo", null, 12);
      x.style.cssText = "position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:var(--clay,#a3423a);color:var(--fill-ink,#fff);cursor:pointer;font-size:13px;line-height:1";
      // captions[] stays INDEX-ALIGNED with image_ids — a removed photo takes its
      // caption with it (the server re-validates the same alignment).
      x.addEventListener("click", () => { commitTitle(); cur().image_ids.splice(k, 1); if (Array.isArray(BLOCKS_WORK[idx].captions)) BLOCKS_WORK[idx].captions.splice(k, 1); renderBlocksCard(); });
      chip.appendChild(x); cell.appendChild(chip);
      const mv = el("div", "gal-mv");
      const left = icoBtn("up", "Move photo " + (k + 1) + " earlier", null, 14); left.disabled = k === 0; left.addEventListener("click", () => moveTo(k, k - 1));
      const right = icoBtn("down", "Move photo " + (k + 1) + " later", null, 14); right.disabled = k === ids.length - 1; right.addEventListener("click", () => moveTo(k, k + 1));
      mv.append(left, right); cell.appendChild(mv);
      cell.draggable = true;
      cell.addEventListener("dragstart", (e) => { RW_DRAG = k; cell.classList.add("rw-dragging"); try { e.dataTransfer.setData("text/plain", String(k)); } catch (_) {} });
      cell.addEventListener("dragend", () => { RW_DRAG = null; cell.classList.remove("rw-dragging"); grid.querySelectorAll(".rw-over").forEach((n) => n.classList.remove("rw-over")); });
      cell.addEventListener("dragover", (e) => { if (RW_DRAG == null || RW_DRAG === k) return; e.preventDefault(); cell.classList.add("rw-over"); });
      cell.addEventListener("dragleave", () => cell.classList.remove("rw-over"));
      cell.addEventListener("drop", (e) => { if (RW_DRAG == null || RW_DRAG === k) return; e.preventDefault(); moveTo(RW_DRAG, k); });
      if (isGallery) {
        const cap = el("input"); cap.type = "text"; cap.placeholder = "Caption (optional)"; cap.maxLength = 160;
        cap.value = (Array.isArray(blk.captions) && blk.captions[k]) || "";
        cap.style.cssText = "width:100%;padding:5px 6px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:12px;box-sizing:border-box";
        cap.addEventListener("change", () => {
          // write through BLOCKS_WORK[idx] (not the render-time blk) — a heading
          // edit replaces the block object, and captions must land on the live one
          const cur = BLOCKS_WORK[idx];
          const caps = ids.map((_, i) => (i === k ? cap.value.trim().slice(0, 160) : ((Array.isArray(cur.captions) && cur.captions[i]) || "")));
          if (caps.some(Boolean)) cur.captions = caps; else delete cur.captions;   // all-empty stores NO key
        });
        cell.appendChild(cap);
      }
      grid.appendChild(cell);
    });
    sub.appendChild(grid);
    const add = el("button", null, "+ Add photos"); add.type = "button"; add.style.cssText = miniBtn;
    add.addEventListener("click", () => { commitTitle(); openPicker((got) => { const list = Array.isArray(got) ? got : got ? [got] : []; if (list.length) { const b = BLOCKS_WORK[idx]; b.image_ids = (b.image_ids || []).concat(list); if (Array.isArray(b.captions)) list.forEach(() => b.captions.push("")); renderBlocksCard(); } }, { many: true }); });   // item 317: several at once
    sub.appendChild(add);
    if (isGallery) {
      // G18 (DM-11): the opt-in, zero-JS tap-to-zoom lightbox — a FIELD, not a
      // variant, so it composes with grid/masonry/filmstrip. Writes zoom: true /
      // removes the key (absent = off, byte-identical), the variant-pill pattern.
      pillRow(sub, "Tap to zoom", [["Off", ""], ["On", "1"]],
        (o) => (BLOCKS_WORK[idx] && BLOCKS_WORK[idx].zoom === true ? "1" : "") === o[1],
        (o) => { commitTitle(); const b = { ...BLOCKS_WORK[idx] }; if (o[1]) b.zoom = true; else delete b.zoom; BLOCKS_WORK[idx] = b; renderBlocksCard(); });
      sub.appendChild(el("div", "hint", "On: visitors can tap any photo to see it larger — works on every phone, no app, even with scripts off."));
    }
  } else if (def.mediaKind === "video") {
    const url = el("input"); url.type = "text"; url.placeholder = "Video link (YouTube, Vimeo…)"; url.value = blk.url || ""; url.style.cssText = inputCss;
    const cap = el("input"); cap.type = "text"; cap.placeholder = "Caption (optional)"; cap.value = blk.caption || ""; cap.style.cssText = inputCss;
    const commit = () => { BLOCKS_WORK[idx] = wLook(idx, { type: "video", title: ti.value.trim(), url: url.value.trim(), caption: cap.value.trim(), poster_id: BLOCKS_WORK[idx].poster_id || undefined }); };
    url.addEventListener("change", commit); cap.addEventListener("change", commit);
    sub.append(url, cap, aiField(cap, { field: "caption" }));
    const posterRow = el("div"); posterRow.style.cssText = "display:flex;align-items:center;gap:10px;margin-top:4px";
    if (blk.poster_id) posterRow.appendChild(mediaThumb(blk.poster_id));
    const pick = el("button", null, blk.poster_id ? "Change poster" : "Add poster image"); pick.type = "button"; pick.style.cssText = miniBtn;
    pick.addEventListener("click", () => { commit(); openPicker((id) => { BLOCKS_WORK[idx].poster_id = id || undefined; renderBlocksCard(); }); });
    posterRow.appendChild(pick); sub.appendChild(posterRow);
  } else if (def.mediaKind === "ba") {
    const items = Array.isArray(blk.items) ? blk.items : [];
    items.forEach((pair, k) => {
      const row = el("div"); row.style.cssText = "border:1px dashed var(--line,#ddd);border-radius:10px;padding:8px;margin-bottom:8px";
      const pics = el("div"); pics.style.cssText = "display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap";
      ["before_id", "after_id"].forEach((key, j) => {
        const cell = el("div"); cell.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:4px";
        cell.appendChild(el("span", "hint", j ? "After" : "Before"));
        if (pair[key]) cell.appendChild(mediaThumb(pair[key]));
        const pb = el("button", null, pair[key] ? "Change" : "Choose"); pb.type = "button"; pb.style.cssText = miniBtn;
        pb.addEventListener("click", () => { commitTitle(); openPicker((id) => { if (id) { cur().items[k][key] = id; renderBlocksCard(); } }); });
        cell.appendChild(pb); pics.appendChild(cell);
      });
      row.appendChild(pics);
      const cap = el("input"); cap.type = "text"; cap.placeholder = "Caption (optional)"; cap.value = pair.caption || ""; cap.style.cssText = inputCss + ";margin-top:8px";
      cap.addEventListener("change", () => { cur().items[k].caption = cap.value.trim(); });
      row.appendChild(cap);
      const rm = el("button", null, "Remove pair"); rm.type = "button"; rm.style.cssText = miniBtn;
      rm.addEventListener("click", () => { commitTitle(); cur().items.splice(k, 1); renderBlocksCard(); });
      row.appendChild(rm); sub.appendChild(row);
    });
    const add = el("button", null, "+ Add a pair"); add.type = "button"; add.style.cssText = miniBtn;
    add.addEventListener("click", () => { commitTitle(); (BLOCKS_WORK[idx].items = BLOCKS_WORK[idx].items || []).push({ before_id: "", after_id: "" }); renderBlocksCard(); });
    sub.appendChild(add);
  }
}
// ── Builder item 315: the list sections are edited as item cards, not lines with "|" ──
// One card per item with named fields, a date picker for events, drag (or the arrows) to
// reorder, Remove, and "+ Add a …". The stored shape is unchanged (the same items the lines
// made), and "Type them as lines" keeps the old box for pasting a list in.
const ROW_FIELDS = {
  features: { one: "feature", fields: [["title", "Title", 80], ["text", "Short description", 240], ["icon", "Icon", 20, "icon"]], blank: { title: "A new feature", text: "Say what it is." } },
  stats: { one: "number", fields: [["value", "Number", 24], ["label", "What it counts", 60]], blank: { value: "1", label: "A new number" } },
  process: { one: "step", fields: [["step", "Step", 80], ["detail", "Detail", 300]], blank: { step: "A new step", detail: "What happens here." } },
  pricing: { one: "tier", fields: [["name", "Name", 60], ["price_text", "Price", 40], ["features", "What’s included, one per line", 600, "lines"]], blank: { name: "A new tier", price_text: "$—", features: ["What’s included"] } },
  certifications: { one: "certification", fields: [["name", "Name", 100], ["issuer", "Issued by", 120]], blank: { name: "A new certification" } },
  service_areas: { one: "area", fields: [["name", "Area", 60]], blank: { name: "A new area" } },
  social: { one: "link", fields: [["network", "Network: instagram, facebook, tiktok, youtube…", 40], ["url", "Link", 400, "url"]], blank: { network: "instagram", url: "https://instagram.com/yourbusiness" } },
  events: { one: "event", fields: [["name", "Event", 100], ["date", "Date", 10, "date"], ["time", "Time (optional)", 40], ["detail", "Detail (optional)", 240], ["url", "Link (optional)", 400, "url"], ["place", "Place (optional: left empty, it is at your own address)", 160]], blank: { name: "A new event", detail: "Add the details." } },
  link_list: { one: "link", fields: [["label", "Label", 80], ["url", "Link", 400, "url"]], blank: { label: "A new link", url: "https://example.com" } },
};
const rwPath = (def, k, key) => (def.areasSimple ? "areas." + k : def.field + "." + k + "." + key);
function rowsOf(def, blk) { if (def.areasSimple) return (Array.isArray(blk.areas) ? blk.areas : []).map((a) => ({ name: a })); return Array.isArray(blk[def.field]) ? blk[def.field] : []; }
function rowsSet(def, idx, rows) {
  const b = BLOCKS_WORK[idx]; if (!b) return;
  if (def.areasSimple) b.areas = rows.map((r) => String(r.name || "").trim()).filter(Boolean);
  else b[def.field] = rows;
}
const RW_IN = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;box-sizing:border-box;margin:0";
function renderRowsBlockBody(def, blk, idx, sub, ti) {
  const spec = ROW_FIELDS[def.type]; if (!spec) return;
  const cur = () => BLOCKS_WORK[idx];
  const commitTitle = () => { cur().title = ti.value.trim(); };
  const rows = rowsOf(def, cur()).map((r) => ({ ...r }));
  const put = () => { commitTitle(); rowsSet(def, idx, rows.map((r) => ({ ...r }))); };
  const list = el("div", "rw-list"); list.setAttribute("role", "list"); list.setAttribute("aria-label", spec.one + "s");
  const again = () => { put(); renderBlocksCard(); dcLiveFromPanel(); };
  const move = (k, to) => { if (to < 0 || to >= rows.length) return; const [r] = rows.splice(k, 1); rows.splice(to, 0, r); RW_FOCUS = { idx, k: to }; again(); };
  rows.forEach((r, k) => {
    const card = el("div", "rw-card"); card.setAttribute("role", "listitem"); card.dataset.k = String(k);
    const head = el("div", "rw-head");
    const grip = el("span", "rw-grip"); grip.innerHTML = typeof PG_GRIP === "string" ? PG_GRIP : "⠿"; grip.setAttribute("aria-hidden", "true"); grip.title = "Drag to reorder";
    head.appendChild(grip);
    head.appendChild(el("span", "rw-n", vocabCap(spec.one) + " " + (k + 1)));
    const up = icoBtn("up", "Move " + spec.one + " " + (k + 1) + " up", "rw-b", 14); up.disabled = k === 0; up.addEventListener("click", () => move(k, k - 1));
    const dn = icoBtn("down", "Move " + spec.one + " " + (k + 1) + " down", "rw-b", 14); dn.disabled = k === rows.length - 1; dn.addEventListener("click", () => move(k, k + 1));
    const rm = icoBtn("x", "Remove " + spec.one + " " + (k + 1), "rw-b rw-rm", 14); rm.addEventListener("click", () => { rows.splice(k, 1); again(); });
    head.append(up, dn, rm); card.appendChild(head);
    spec.fields.forEach(([key, label, max, kind]) => {
      if (kind === "icon") { card.appendChild(rwIconPick(r, k, spec.one, put, again, idx)); return; }   // item 304's line icons, on each card
      let inp;
      const val = r[key];
      if (kind === "lines") { inp = el("textarea"); inp.value = Array.isArray(val) ? val.join("\n") : String(val || ""); inp.rows = Math.max(2, inp.value.split("\n").length + 1); }
      else if (kind === "date" && (!val || /^\d{4}-\d{2}-\d{2}$/.test(String(val)))) { inp = el("input"); inp.type = "date"; inp.value = val || ""; }
      else { inp = el("input"); inp.type = kind === "url" ? "url" : "text"; inp.value = String(val == null ? "" : val); inp.maxLength = max; inp.placeholder = label; }
      inp.style.cssText = RW_IN; inp.setAttribute("aria-label", label + ", " + spec.one + " " + (k + 1));
      inp.addEventListener("change", () => {
        if (kind === "lines") r[key] = inp.value.split("\n").map((s) => s.trim()).filter(Boolean);
        else { const v = inp.value.trim(); if (v) r[key] = v; else delete r[key]; }
        put();
      });
      if (kind === "url" && typeof linkPick === "function") { card.appendChild(inp); linkPick(inp); }
      else card.appendChild(inp);
      if (kind === "lines" || key === "text" || key === "detail") card.appendChild(aiField(inp, { field: label, write: false }));
    });
    // drag to reorder with a mouse; the arrows do it for a finger and a keyboard
    card.draggable = true;
    card.addEventListener("dragstart", (e) => { RW_DRAG = k; card.classList.add("rw-dragging"); try { e.dataTransfer.setData("text/plain", String(k)); e.dataTransfer.effectAllowed = "move"; } catch (_) {} });
    card.addEventListener("dragend", () => { RW_DRAG = null; card.classList.remove("rw-dragging"); list.querySelectorAll(".rw-over").forEach((x) => x.classList.remove("rw-over")); });
    card.addEventListener("dragover", (e) => { if (RW_DRAG == null || RW_DRAG === k) return; e.preventDefault(); card.classList.add("rw-over"); });
    card.addEventListener("dragleave", () => card.classList.remove("rw-over"));
    card.addEventListener("drop", (e) => { if (RW_DRAG == null || RW_DRAG === k) return; e.preventDefault(); move(RW_DRAG, k); });
    list.appendChild(card);
  });
  sub.appendChild(list);
  const add = el("button", "dc-actbtn", "+ Add a " + spec.one); add.type = "button";
  add.addEventListener("click", () => { rows.push({ ...spec.blank }); RW_FOCUS = { idx, k: rows.length - 1, first: true }; again(); });
  sub.appendChild(add);
  const fold = el("details", "rw-fold"); fold.appendChild(el("summary", null, "Type them as lines instead"));
  const ta = el("textarea"); ta.value = blockText(def, cur()); ta.rows = Math.max(3, ta.value.split("\n").length + 1); ta.style.cssText = RW_IN + ";margin-top:6px";
  ta.setAttribute("aria-label", "The " + spec.one + "s, one per line");
  ta.addEventListener("change", () => { const t2 = ti.value.trim(); BLOCKS_WORK[idx] = wLook(idx, textToBlock(def, t2, ta.value)); renderBlocksCard(); });
  fold.append(ta, el("div", "hint", def.hint)); if (def.icons) fold.appendChild(iconGrid(ta)); sub.appendChild(fold);   // item 304's grid works on the lines too
  if (RW_FOCUS && RW_FOCUS.idx === idx) {
    const f = RW_FOCUS; RW_FOCUS = null;
    const c = list.children[f.k]; const target = c && (f.first ? c.querySelector("input,textarea") : c.querySelector(".rw-b"));
    if (target) setTimeout(() => { try { target.focus({ preventScroll: true }); if (f.first && target.select) target.select(); c.scrollIntoView({ block: "nearest" }); } catch (_) {} }, 0);
  }
}
let RW_DRAG = null, RW_FOCUS = null, RW_ICON_OPEN = null;   // RW_ICON_OPEN: "<section index>:<card index>" whose icons are showing
// A feature's icon on its card: what it is now, and a press opens item 304's line icons (in the
// site's accent colour), None, and a box for a typed emoji. Stored as "icon:<name>" or the emoji.
function rwIconPick(r, k, one, put, again, idx) {
  const wrap = el("div", "rw-icon");
  const cur = String(r.icon || ""), line = /^icon:/.test(cur) ? cur.slice(5) : "";
  const accent = dcSiteColours().accent;
  const svg = (name, px) => '<svg viewBox="0 0 24 24" width="' + px + '" height="' + px + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + LINE_ICONS[name] + "</svg>";
  const key = idx + ":" + k, open = RW_ICON_OPEN === key;   // a redraw makes new row objects, so the card is named by place
  const btn = el("button", "rw-icon-now"); btn.type = "button"; btn.setAttribute("aria-expanded", String(open));
  btn.setAttribute("aria-label", "Icon for " + one + " " + (k + 1) + ": " + (line ? (ICON_WORDS[line] || line) : cur ? cur : "none") + ". Press to change it");
  wrap.style.setProperty("--rw-accent", accent);   // the line icons draw in the site's accent colour
  if (line && LINE_ICONS[line]) { const i = el("span", "rw-icon-pic"); i.innerHTML = svg(line, 20); btn.appendChild(i); }
  else if (cur) btn.appendChild(el("span", "rw-icon-pic", cur));
  btn.appendChild(el("span", null, line ? (ICON_WORDS[line] || line) : cur ? "Emoji" : "Add an icon"));
  btn.addEventListener("click", () => { RW_ICON_OPEN = open ? null : key; again(); });
  wrap.appendChild(btn);
  if (!open) return wrap;
  const set = (v) => { if (v) r.icon = v; else delete r.icon; RW_ICON_OPEN = null; again(); };
  const grid = el("div", "ins-icons"); grid.setAttribute("role", "group"); grid.setAttribute("aria-label", "Line icons, in your accent colour");
  const none = el("button", "ins-icon rw-icon-none", "None"); none.type = "button"; none.setAttribute("aria-pressed", String(!cur)); none.addEventListener("click", () => set(""));
  grid.appendChild(none);
  Object.keys(LINE_ICONS).forEach((name) => {
    const b = el("button", "ins-icon"); b.type = "button"; b.title = ICON_WORDS[name] || name; b.setAttribute("aria-label", ICON_WORDS[name] || name); b.setAttribute("aria-pressed", String(line === name));
    b.innerHTML = svg(name, 22);
    b.addEventListener("click", () => set("icon:" + name));
    grid.appendChild(b);
  });
  wrap.appendChild(grid);
  const emo = el("input"); emo.type = "text"; emo.maxLength = 12; emo.placeholder = "Or type an emoji"; emo.value = line ? "" : cur; emo.style.cssText = RW_IN;
  emo.setAttribute("aria-label", "Or type an emoji, " + one + " " + (k + 1));
  emo.addEventListener("change", () => set(emo.value.trim()));
  wrap.appendChild(emo);
  return wrap;
}
function renderTableBlockBody(blk, idx, sub, ti) {
  const cur = () => BLOCKS_WORK[idx];
  const headers = (Array.isArray(blk.headers) ? blk.headers : []).map(String), rows = (Array.isArray(blk.rows) ? blk.rows : []).map((r) => (Array.isArray(r) ? r.map(String) : []));
  const cols = Math.max(headers.length, ...rows.map((r) => r.length), 1);
  while (headers.length < cols) headers.push("");
  rows.forEach((r) => { while (r.length < cols) r.push(""); });
  const put = () => { BLOCKS_WORK[idx] = wLook(idx, { type: "table", title: ti.value.trim(), headers: headers.map((h) => h.trim()), rows: rows.map((r) => r.map((c) => c.trim())) }); };
  const again = () => { put(); renderBlocksCard(); dcLiveFromPanel(); };
  const grid = el("div", "rw-table"); grid.style.setProperty("grid-template-columns", "repeat(" + cols + ",minmax(96px,1fr)) 36px");
  const cell = (val, label, onChange, head) => {
    const inp = el("input"); inp.type = "text"; inp.value = val; inp.maxLength = head ? 80 : 200; inp.setAttribute("aria-label", label); inp.style.cssText = RW_IN + (head ? ";font-weight:600" : "");
    inp.addEventListener("change", () => { onChange(inp.value); put(); });
    return inp;
  };
  headers.forEach((h, c) => grid.appendChild(cell(h, "Column " + (c + 1) + " heading", (v) => { headers[c] = v; }, true)));
  const rmc = icoBtn("x", "Remove the last column", "rw-b rw-rm", 14); rmc.disabled = cols <= 1;
  rmc.addEventListener("click", () => { headers.pop(); rows.forEach((r) => r.pop()); again(); });
  grid.appendChild(rmc);
  rows.forEach((r, k) => {
    r.forEach((v, c) => grid.appendChild(cell(v, "Row " + (k + 1) + ", " + (headers[c] || "column " + (c + 1)), (nv) => { r[c] = nv; })));
    const rm = icoBtn("x", "Remove row " + (k + 1), "rw-b rw-rm", 14); rm.addEventListener("click", () => { rows.splice(k, 1); again(); }); grid.appendChild(rm);
  });
  sub.appendChild(grid);
  const acts = el("div", "rw-acts");
  const addR = el("button", "dc-actbtn", "+ Add a row"); addR.type = "button"; addR.addEventListener("click", () => { rows.push(headers.map(() => "")); RW_FOCUS = { idx, k: rows.length - 1, first: true }; again(); });
  const addC = el("button", "dc-actbtn dc-ghost", "+ Add a column"); addC.type = "button"; addC.addEventListener("click", () => { headers.push(""); rows.forEach((r) => r.push("")); again(); });
  acts.append(addR, addC); sub.appendChild(acts);
  if (RW_FOCUS && RW_FOCUS.idx === idx) { const f = RW_FOCUS; RW_FOCUS = null; const inputs = grid.querySelectorAll("input"); const t = inputs[(f.k + 1) * cols]; if (t) setTimeout(() => { try { t.focus({ preventScroll: true }); } catch (_) {} }, 0); }
  const fold = el("details", "rw-fold"); fold.appendChild(el("summary", null, "Type it as lines instead"));
  const ta = el("textarea");
  const toText = () => { const lines = []; if (headers.some(Boolean)) lines.push(headers.join(" | ")); rows.forEach((r) => lines.push(r.join(" | "))); return lines.join("\n"); };
  ta.value = toText(); ta.placeholder = "Name | Price | Notes\nBasic | $10 | Great to start"; ta.rows = Math.max(4, ta.value.split("\n").length + 1);
  ta.style.cssText = RW_IN + ";margin-top:6px;font:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px";
  ta.setAttribute("aria-label", "The table as lines, cells split by |");
  ta.addEventListener("change", () => {
    const lines = ta.value.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim());
    const cells = (l) => l.split("|").map((c) => c.trim());
    BLOCKS_WORK[idx] = wLook(idx, { type: "table", title: ti.value.trim(), headers: lines.length ? cells(lines[0]) : [], rows: lines.slice(1).map(cells) });
    renderBlocksCard();
  });
  fold.append(ta, el("div", "hint", "One row per line, cells split by “ | ”. The first line is the header row. It scrolls sideways on phones.")); sub.appendChild(fold);
}
// "+ Add a row" on the page: a new item with sample words goes on the end, the section is drawn
// again at once, and the new item's first words are opened for typing (dcLiveNow).
function dcAddRow(bi) {
  const b = BLOCKS_WORK[bi]; if (!b || lockStop(bi)) return;
  const def = BLOCK_DEFS.find((x) => x.type === b.type) || {};
  if (b.type === "table") {
    const headers = Array.isArray(b.headers) ? b.headers : [], rows = Array.isArray(b.rows) ? b.rows.slice() : [];
    const w = Math.max(headers.length, ...(rows.map((r) => (r || []).length)), 1);
    rows.push(Array.from({ length: w }, (_, i) => (i ? "" : "New row")));
    b.rows = rows; LIVE_FOCUS = { bi, path: "rows." + (rows.length - 1) + ".0" };
  } else {
    const spec = ROW_FIELDS[b.type]; if (!spec) return;
    const rows = rowsOf(def, b).slice(); rows.push({ ...spec.blank });
    rowsSet(def, bi, rows);
    LIVE_FOCUS = { bi, path: rwPath(def, rows.length - 1, spec.fields[0][0]) };
  }
  if ($("blocksCard") && PANEL_MODE === "section" && BLOCK_SOLO === bi) renderBlocksCard(); else blocksSaveSoon();
  dcLiveFromPanel();
}
let LIVE_FOCUS = null;   // after the live redraw: the field to open for typing
// FD-T18 structured team editor — name/role/bio + an optional photo per person.
function renderTeamBlockBody(blk, idx, sub, ti) {
  const miniBtn = "font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  const inputCss = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-bottom:6px;box-sizing:border-box";
  const commitTitle = () => { BLOCKS_WORK[idx].title = ti.value.trim(); };
  const cur = () => BLOCKS_WORK[idx];   // item 77: the section as it stands, not the copy this panel was drawn from
  const members = Array.isArray(blk.members) ? blk.members : [];
  members.forEach((m, k) => {
    const row = el("div"); row.style.cssText = "border:1px dashed var(--line,#ddd);border-radius:10px;padding:8px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap";
    const photo = el("div"); photo.style.cssText = "display:flex;flex-direction:column;align-items:center;gap:4px";
    if (m.media_id) photo.appendChild(mediaThumb(m.media_id));
    const pb = el("button", null, m.media_id ? "Change photo" : "Add photo"); pb.type = "button"; pb.style.cssText = miniBtn;
    pb.addEventListener("click", () => { commitTitle(); openPicker((id) => { cur().members[k].media_id = id || undefined; renderBlocksCard(); }); });
    photo.appendChild(pb);
    const fields = el("div"); fields.style.cssText = "flex:1;min-width:180px";
    const nm = el("input"); nm.type = "text"; nm.placeholder = "Name"; nm.value = m.name || ""; nm.style.cssText = inputCss;
    const role = el("input"); role.type = "text"; role.placeholder = "Role (optional)"; role.value = m.role || ""; role.style.cssText = inputCss;
    const bio = el("input"); bio.type = "text"; bio.placeholder = "Short bio (optional)"; bio.value = m.bio || ""; bio.style.cssText = inputCss;
    const commit = () => { cur().members[k] = { name: nm.value.trim(), role: role.value.trim() || undefined, bio: bio.value.trim() || undefined, media_id: cur().members[k]?.media_id }; };
    [nm, role, bio].forEach((inp) => inp.addEventListener("change", commit));
    fields.append(nm, role, bio, aiField(bio, { field: "", write: false }));
    const rm = el("button", null, "Remove"); rm.type = "button"; rm.style.cssText = miniBtn;
    rm.addEventListener("click", () => { commitTitle(); cur().members.splice(k, 1); renderBlocksCard(); });
    row.append(photo, fields, rm); sub.appendChild(row);
  });
  const add = el("button", null, "+ Add person"); add.type = "button"; add.style.cssText = miniBtn;
  add.addEventListener("click", () => { commitTitle(); (BLOCKS_WORK[idx].members = BLOCKS_WORK[idx].members || []).push({ name: "" }); renderBlocksCard(); });
  sub.appendChild(add);
}
// r3 accordion editor — expandable panels (summary + markdown body; toolbar auto-attaches).
function renderAccordionBlockBody(blk, idx, sub, ti) {
  const miniBtn = "font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  const inputCss = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-bottom:6px;box-sizing:border-box";
  const commitTitle = () => { BLOCKS_WORK[idx].title = ti.value.trim(); };
  const cur = () => BLOCKS_WORK[idx];   // item 77: the section as it stands, not the copy this panel was drawn from
  if (blk.variant === "side") {   // item 329: Questions beside the heading has a short line under its heading
    const f = el("div", "ins-field"), id = "accIntro-" + idx, l = el("label", "ins-lbl", "A short line under the heading (optional)"); l.htmlFor = id;
    const i = el("input"); i.type = "text"; i.id = id; i.maxLength = 200; i.placeholder = "Still not sure? Ask us anything."; i.value = blk.intro || ""; i.style.cssText = inputCss;
    i.addEventListener("change", () => { const v = i.value.trim(); if (v) cur().intro = v; else delete cur().intro; });
    f.append(l, i); sub.appendChild(f);
  }
  const items = Array.isArray(blk.items) ? blk.items : [];
  items.forEach((it, k) => {
    const row = el("div"); row.style.cssText = "border:1px dashed var(--line,#ddd);border-radius:10px;padding:8px;margin-bottom:8px";
    const sm = el("input"); sm.type = "text"; sm.placeholder = "Label (what people click to expand)"; sm.value = it.summary || ""; sm.style.cssText = inputCss;
    const bd = el("textarea"); bd.value = it.body || ""; bd.setAttribute("data-k", "body_md"); bd.placeholder = "The details inside…";
    bd.rows = Math.max(3, (it.body || "").split("\n").length + 1);
    bd.style.cssText = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;line-height:1.6;box-sizing:border-box";
    const commit = () => { cur().items[k] = { summary: sm.value.trim(), body: bd.value.trim() }; };
    sm.addEventListener("change", commit); bd.addEventListener("change", commit);
    row.append(sm, aiField(sm, { field: "question", write: false }), bd, aiField(bd, { field: "answer" }));
    const rm = el("button", null, "Remove"); rm.type = "button"; rm.style.cssText = miniBtn;
    rm.addEventListener("click", () => { commitTitle(); cur().items.splice(k, 1); renderBlocksCard(); });
    row.appendChild(rm); sub.appendChild(row);
  });
  if (items.length < 10) {
    const add = el("button", null, "+ Add panel"); add.type = "button"; add.style.cssText = miniBtn;
    add.addEventListener("click", () => { commitTitle(); (BLOCKS_WORK[idx].items = BLOCKS_WORK[idx].items || []).push({ summary: "", body: "" }); renderBlocksCard(); });
    sub.appendChild(add);
  }
}
// r3 tabs editor — a row of tabs, each: a label + markdown body + optional image.
function renderTabsBlockBody(blk, idx, sub, ti) {
  const miniBtn = "font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  const inputCss = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-bottom:6px;box-sizing:border-box";
  const commitTitle = () => { BLOCKS_WORK[idx].title = ti.value.trim(); };
  const cur = () => BLOCKS_WORK[idx];   // item 77: the section as it stands, not the copy this panel was drawn from
  const tabs = Array.isArray(blk.tabs) ? blk.tabs : [];
  tabs.forEach((t, k) => {
    const row = el("div"); row.style.cssText = "border:1px dashed var(--line,#ddd);border-radius:10px;padding:8px;margin-bottom:8px";
    row.appendChild(Object.assign(el("div", "hint", "Tab " + (k + 1)), { style: "font-weight:600;margin-bottom:4px" }));
    const lb = el("input"); lb.type = "text"; lb.placeholder = "Tab label (what people click)"; lb.value = t.label || ""; lb.style.cssText = inputCss;
    const photo = el("div"); photo.style.cssText = "display:flex;align-items:center;gap:8px;margin:6px 0";
    if (t.image_id) photo.appendChild(mediaThumb(t.image_id));
    const pb = el("button", null, t.image_id ? "Change image" : "Add image (optional)"); pb.type = "button"; pb.style.cssText = miniBtn;
    pb.addEventListener("click", () => { commitTitle(); openPicker((id) => { cur().tabs[k].image_id = id || undefined; renderBlocksCard(); }); });
    photo.appendChild(pb);
    const bd = el("textarea"); bd.value = t.body || ""; bd.setAttribute("data-k", "body_md"); bd.placeholder = "What’s inside this tab…";
    bd.rows = Math.max(3, (t.body || "").split("\n").length + 1);
    bd.style.cssText = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;line-height:1.6;box-sizing:border-box";
    const commit = () => { cur().tabs[k] = { label: lb.value.trim(), body: bd.value.trim(), image_id: cur().tabs[k]?.image_id || undefined }; };
    [lb, bd].forEach((inp) => inp.addEventListener("change", commit));
    row.append(lb, photo, bd, aiField(bd, {}));
    if (tabs.length > 1) {
      const rm = el("button", null, "Remove tab"); rm.type = "button"; rm.style.cssText = miniBtn;
      rm.addEventListener("click", () => { commitTitle(); cur().tabs.splice(k, 1); renderBlocksCard(); });
      row.appendChild(rm);
    }
    sub.appendChild(row);
  });
  if (tabs.length < 6) {
    const add = el("button", null, "+ Add tab"); add.type = "button"; add.style.cssText = miniBtn;
    add.addEventListener("click", () => { commitTitle(); (BLOCKS_WORK[idx].tabs = BLOCKS_WORK[idx].tabs || []).push({ label: "New tab", body: "" }); renderBlocksCard(); });
    sub.appendChild(add);
  }
  sub.appendChild(el("div", "hint", "Up to 6 tabs. Keyboard-friendly, and they stack neatly on phones — no code, works everywhere."));
}
// r3 carousel editor — a swipeable slideshow: each slide is an image + optional caption.
function renderCarouselBlockBody(blk, idx, sub, ti) {
  const miniBtn = "font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  const inputCss = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-bottom:6px;box-sizing:border-box";
  const commitTitle = () => { BLOCKS_WORK[idx].title = ti.value.trim(); };
  const cur = () => BLOCKS_WORK[idx];   // item 77: the section as it stands, not the copy this panel was drawn from
  const slides = Array.isArray(blk.slides) ? blk.slides : (blk.slides = []);
  slides.forEach((sl, k) => {
    const row = el("div"); row.style.cssText = "border:1px dashed var(--line,#ddd);border-radius:10px;padding:8px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start";
    if (sl.image_id) row.appendChild(mediaThumb(sl.image_id));
    const col = el("div"); col.style.cssText = "flex:1;min-width:0";
    const cap = el("input"); cap.type = "text"; cap.placeholder = "Caption (optional)"; cap.value = sl.caption || ""; cap.style.cssText = inputCss;
    cap.addEventListener("change", () => { cur().slides[k].caption = cap.value.trim() || undefined; });
    const acts = el("div"); acts.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
    const ch = el("button", null, sl.image_id ? "Change image" : "Choose image"); ch.type = "button"; ch.style.cssText = miniBtn;
    ch.addEventListener("click", () => { commitTitle(); openPicker((id) => { if (id) { cur().slides[k].image_id = id; renderBlocksCard(); } }); });
    const rm = el("button", null, "Remove"); rm.type = "button"; rm.style.cssText = miniBtn;
    rm.addEventListener("click", () => { commitTitle(); cur().slides.splice(k, 1); renderBlocksCard(); });
    // item 317: slides reorder with the arrows (44px on a touch screen)
    const mv = (to) => { if (to < 0 || to >= slides.length) return; commitTitle(); const s2 = cur().slides; const [x] = s2.splice(k, 1); s2.splice(to, 0, x); renderBlocksCard(); dcLiveFromPanel(); };
    const up = icoBtn("up", "Move slide " + (k + 1) + " earlier", "rw-b", 14); up.disabled = k === 0; up.addEventListener("click", () => mv(k - 1));
    const dn = icoBtn("down", "Move slide " + (k + 1) + " later", "rw-b", 14); dn.disabled = k === slides.length - 1; dn.addEventListener("click", () => mv(k + 1));
    acts.append(ch, rm, up, dn);
    col.append(cap, acts); row.appendChild(col); sub.appendChild(row);
  });
  if (slides.length < 12) {
    const add = el("button", null, "+ Add slides"); add.type = "button"; add.style.cssText = miniBtn;
    add.addEventListener("click", () => { commitTitle(); openPicker((got) => { const list = (Array.isArray(got) ? got : got ? [got] : []).slice(0, 12 - slides.length); if (list.length) { const b = BLOCKS_WORK[idx]; b.slides = (b.slides || []).concat(list.map((id) => ({ image_id: id }))); renderBlocksCard(); } }, { many: true }); });   // item 317
    sub.appendChild(add);
  }
  sub.appendChild(el("div", "hint", "Up to 12 slides. Visitors swipe on phones or scroll with the keyboard — no plugins, and every image keeps its alt text."));
}
// r3 progress editor — labeled bars, each a label + a 0–100% level.
function renderProgressBlockBody(blk, idx, sub, ti) {
  const miniBtn = "font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  const commitTitle = () => { BLOCKS_WORK[idx].title = ti.value.trim(); };
  const cur = () => BLOCKS_WORK[idx];   // item 77: the section as it stands, not the copy this panel was drawn from
  const items = Array.isArray(blk.items) ? blk.items : (blk.items = []);
  items.forEach((it, k) => {
    const row = el("div"); row.style.cssText = "border:1px dashed var(--line,#ddd);border-radius:10px;padding:8px;margin-bottom:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap";
    const lb = el("input"); lb.type = "text"; lb.placeholder = "Label (e.g. Design, Capacity)"; lb.value = it.label || ""; lb.style.cssText = "flex:1;min-width:140px;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;box-sizing:border-box";
    const pctWrap = el("label", "hint", ""); pctWrap.style.cssText = "display:flex;align-items:center;gap:6px";
    const pct = el("input"); pct.type = "number"; pct.min = "0"; pct.max = "100"; pct.value = String(typeof it.percent === "number" ? it.percent : 60);
    pct.style.cssText = "width:74px;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px";
    pctWrap.append(pct, el("span", "hint", "%"));
    const commit = () => { cur().items[k] = { label: lb.value.trim(), percent: Math.max(0, Math.min(100, parseInt(pct.value, 10) || 0)) }; };
    lb.addEventListener("change", commit); pct.addEventListener("change", commit);
    row.append(lb, pctWrap);
    if (items.length > 1) {
      const rm = el("button", null, "Remove"); rm.type = "button"; rm.style.cssText = miniBtn;
      rm.addEventListener("click", () => { commitTitle(); cur().items.splice(k, 1); renderBlocksCard(); });
      row.appendChild(rm);
    }
    sub.appendChild(row);
  });
  if (items.length < 8) {
    const add = el("button", null, "+ Add bar"); add.type = "button"; add.style.cssText = miniBtn;
    add.addEventListener("click", () => { commitTitle(); (BLOCKS_WORK[idx].items = BLOCKS_WORK[idx].items || []).push({ label: "", percent: 60 }); renderBlocksCard(); });
    sub.appendChild(add);
  }
  sub.appendChild(el("div", "hint", "Up to 8 bars. Each is a real labeled progress meter — screen-reader friendly."));
}
// r3 buttons editor — up to three real action links (label + url + look).
function renderButtonsBlockBody(blk, idx, sub, ti) {
  const miniBtn = "font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  const inputCss = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-bottom:6px;box-sizing:border-box";
  const commitTitle = () => { BLOCKS_WORK[idx].title = ti.value.trim(); };
  const cur = () => BLOCKS_WORK[idx];   // item 77: the section as it stands, not the copy this panel was drawn from
  const buttons = Array.isArray(blk.buttons) ? blk.buttons : [];
  buttons.forEach((bt, k) => {
    const row = el("div"); row.style.cssText = "border:1px dashed var(--line,#ddd);border-radius:10px;padding:8px;margin-bottom:8px";
    const lb = el("input"); lb.type = "text"; lb.placeholder = "Button label (e.g. Get a quote)"; lb.value = bt.label || ""; lb.style.cssText = inputCss;
    const ur = el("input"); ur.type = "text"; ur.placeholder = "Where it goes (link)"; ur.value = bt.url || ""; ur.style.cssText = inputCss;
    const stWrap = el("label", "hint", "Style "); const st = el("select");
    [["primary", "Filled"], ["outline", "Outline"]].forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if ((bt.style || "primary") === v) o.selected = true; st.appendChild(o); });
    st.style.cssText = "font:inherit;font-size:13px;margin-left:6px;padding:4px 6px;border:1px solid var(--line,#ddd);border-radius:8px"; stWrap.appendChild(st);
    const commit = () => { cur().buttons[k] = { label: lb.value.trim(), url: ur.value.trim(), style: st.value === "outline" ? "outline" : "primary" }; };
    [lb, ur, st].forEach((inp) => inp.addEventListener("change", commit));
    row.append(lb, aiField(lb, { field: "button label" }), ur, stWrap);
    linkPick(ur);   // item 225
    const rm = el("button", null, "Remove"); rm.type = "button"; rm.style.cssText = miniBtn;
    rm.addEventListener("click", () => { commitTitle(); cur().buttons.splice(k, 1); renderBlocksCard(); });
    row.appendChild(rm); sub.appendChild(row);
  });
  if (buttons.length < 3) {
    const add = el("button", null, "+ Add button"); add.type = "button"; add.style.cssText = miniBtn;
    add.addEventListener("click", () => { commitTitle(); (BLOCKS_WORK[idx].buttons = BLOCKS_WORK[idx].buttons || []).push({ label: "", url: "", style: "primary" }); renderBlocksCard(); });
    sub.appendChild(add);
  }
}
// r4 columns editor — 2–3 columns, each: text (markdown) + optional image + button.
function renderColumnsBlockBody(blk, idx, sub, ti) {
  const miniBtn = "font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  const inputCss = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-bottom:6px;box-sizing:border-box";
  const commitTitle = () => { BLOCKS_WORK[idx].title = ti.value.trim(); };
  const cur = () => BLOCKS_WORK[idx];   // item 77: the section as it stands, not the copy this panel was drawn from
  const cols = Array.isArray(blk.columns) ? blk.columns : [];
  cols.forEach((c, k) => {
    const row = el("div"); row.style.cssText = "border:1px dashed var(--line,#ddd);border-radius:10px;padding:8px;margin-bottom:8px";
    row.appendChild(Object.assign(el("div", "hint", "Column " + (k + 1)), { style: "font-weight:600;margin-bottom:4px" }));
    const photo = el("div"); photo.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px";
    if (c.image_id) photo.appendChild(mediaThumb(c.image_id));
    const pb = el("button", null, c.image_id ? "Change image" : "Add image (optional)"); pb.type = "button"; pb.style.cssText = miniBtn;
    pb.addEventListener("click", () => { commitTitle(); openPicker((id) => { cur().columns[k].image_id = id || undefined; renderBlocksCard(); }); });
    photo.appendChild(pb); row.appendChild(photo);
    const bd = el("textarea"); bd.value = c.body || ""; bd.setAttribute("data-k", "body_md"); bd.placeholder = "This column’s text…";
    bd.rows = Math.max(3, (c.body || "").split("\n").length + 1);
    bd.style.cssText = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;line-height:1.6;box-sizing:border-box;margin-bottom:6px";
    const bl = el("input"), bu = el("input");
    bl.placeholder = "Button label (optional)"; bl.value = (c.button && c.button.label) || "";
    bu.placeholder = "Button link (optional)"; bu.value = (c.button && c.button.url) || "";
    [bl, bu].forEach((inp) => { inp.type = "text"; inp.style.cssText = inputCss; });
    // per-column WIDTH on the 12-unit grid (Adobe Layout Mode). "Auto" = equal share.
    const wrap = el("div"); wrap.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px";
    wrap.appendChild(Object.assign(el("span", "hint", "Width"), { style: "font-weight:600" }));
    const wsel = el("select"); wsel.style.cssText = "padding:6px 8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px";
    const WIDTHS = [[0, "Auto (equal)"], [3, "¼ — narrow"], [4, "⅓"], [6, "½ — half"], [8, "⅔"], [9, "¾ — wide"], [12, "Full row"]];
    WIDTHS.forEach(([v, lab]) => { const o = el("option", null, lab); o.value = String(v); if ((c.span || 0) === v) o.selected = true; wsel.appendChild(o); });
    wrap.appendChild(wsel);
    const commit = () => { const o = { body: bd.value.trim(), image_id: cur().columns[k]?.image_id || undefined }; const L = bl.value.trim(), U = bu.value.trim(); if (L && U) o.button = { label: L, url: U }; const sp = parseInt(wsel.value, 10) || 0; if (sp) o.span = sp; cur().columns[k] = o; };
    [bd, bl, bu].forEach((inp) => inp.addEventListener("change", commit));
    wsel.addEventListener("change", () => { commit(); renderBlocksCard(); });
    row.append(bd, aiField(bd, {}), bl, bu, wrap);
    linkPick(bu);   // item 225
    // #184: OR drop a component into this column (a video, a feature list, stats, a
    // table…). Picking one shows its own mini-editor; a column renders its component
    // when set, otherwise the text/image/button above.
    const compRow = el("div"); compRow.style.cssText = "margin-top:8px;padding-top:8px;border-top:1px dashed var(--line,#eee)";
    const cLab = el("label", "hint", "Or drop a component here: "); cLab.style.fontWeight = "600";
    const cSel = el("select"); cSel.style.cssText = "padding:6px 8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-left:6px";
    [["", "— none (use the text above) —"], ["video", "Video"], ["features", "Feature list"], ["stats", "Stats / numbers"], ["pricing", "Pricing"], ["table", "Table"], ["title", "Heading"], ["richtext", "Rich text"], ["link_list", "Link list"], ["accordion", "Accordion"]].forEach(([v, lab]) => { const o = el("option", null, lab); o.value = v; if (((c.block && c.block.type) || "") === v) o.selected = true; cSel.appendChild(o); });
    cSel.addEventListener("change", () => { commit(); const t = cSel.value; if (!t) { delete cur().columns[k].block; } else { const d = BLOCK_DEFS.find((x) => x.type === t); cur().columns[k].block = d ? emptyBlock(d) : { type: t }; } renderBlocksCard(); });
    cLab.appendChild(cSel); compRow.appendChild(cLab);
    if (c.block && c.block.type) { const host = el("div"); host.style.cssText = "margin-top:8px"; renderCellBlockEditor(c.block, (nb) => { cur().columns[k].block = nb; }, host); compRow.appendChild(host); }
    row.appendChild(compRow);
    if (cols.length > 1) {
      const rm = el("button", null, "Remove column"); rm.type = "button"; rm.style.cssText = miniBtn;
      rm.addEventListener("click", () => { commitTitle(); cur().columns.splice(k, 1); dcRebalanceSpans(BLOCKS_WORK[idx]); renderBlocksCard(); });
      row.appendChild(rm);
    }
    sub.appendChild(row);
  });
  if (cols.length < 6) {
    const add = el("button", null, "+ Add column"); add.type = "button"; add.style.cssText = miniBtn;
    add.addEventListener("click", () => { commitTitle(); const b = (BLOCKS_WORK[idx].columns = BLOCKS_WORK[idx].columns || []); b.push({ body: "" }); dcRebalanceSpans(BLOCKS_WORK[idx]); renderBlocksCard(); });
    sub.appendChild(add);
  }
  sub.appendChild(el("div", "hint", "1–6 columns on a responsive grid — set each column’s width, or drag the dividers right on the page. Everything stacks to one column on phones automatically."));
}
// #184: the mini-editor for a component dropped INTO a column cell. Bounded to a
// curated, simple set (video + the line-based grids + heading/rich-text/table); each
// writes a valid nested block via save(). The server re-validates it like any block.
function renderCellBlockEditor(cb, save, host) {
  const inputCss = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-bottom:6px;box-sizing:border-box";
  const taCss = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;line-height:1.6;box-sizing:border-box;margin-bottom:6px";
  const t = cb.type;
  if (t === "video") {
    const u = el("input"); u.type = "text"; u.placeholder = "Video link (YouTube, Vimeo, or an .mp4)"; u.value = cb.url || ""; u.style.cssText = inputCss;
    const cap = el("input"); cap.type = "text"; cap.placeholder = "Caption (optional)"; cap.value = cb.caption || ""; cap.style.cssText = inputCss;
    const commit = () => save({ type: "video", url: u.value.trim(), caption: cap.value.trim() || undefined });
    [u, cap].forEach((i) => i.addEventListener("change", commit));
    host.append(u, cap, el("div", "hint", "A poster + link — nothing external loads on your live page."));
    return;
  }
  if (t === "title") {
    const h = el("input"); h.type = "text"; h.placeholder = "Heading"; h.value = cb.title || ""; h.style.cssText = inputCss;
    const st = el("input"); st.type = "text"; st.placeholder = "Subtitle (optional)"; st.value = cb.subtitle || ""; st.style.cssText = inputCss;
    const commit = () => save({ type: "title", title: h.value.trim(), subtitle: st.value.trim() || undefined });
    [h, st].forEach((i) => i.addEventListener("change", commit));
    host.append(h, st);
    return;
  }
  if (t === "richtext") {
    const ta = el("textarea"); ta.value = cb.body || ""; ta.setAttribute("data-k", "body_md"); ta.rows = 4; ta.placeholder = "Write your text…"; ta.style.cssText = taCss;
    ta.addEventListener("change", () => save({ type: "richtext", body: ta.value.trim() }));
    host.append(ta, aiField(ta, {}));
    return;
  }
  if (t === "table") {
    const ta = el("textarea");
    const lines = []; if ((cb.headers || []).length) lines.push(cb.headers.join(" | ")); (cb.rows || []).forEach((r) => lines.push((r || []).join(" | ")));
    ta.value = lines.join("\n"); ta.placeholder = "Name | Price\nBasic | $10\nPro | $25"; ta.rows = 4; ta.style.cssText = taCss + ";font-family:ui-monospace,monospace";
    ta.addEventListener("change", () => { const ls = ta.value.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim()); const cells = (l) => l.split("|").map((x) => x.trim()); save({ type: "table", headers: ls.length ? cells(ls[0]) : [], rows: ls.slice(1).map(cells) }); });
    host.append(ta, el("div", "hint", "One row per line, columns split by “ | ”. First line = headers."));
    return;
  }
  if (t === "accordion") {
    const ta = el("textarea");
    ta.value = (cb.items || []).map((it) => [it.summary || "", it.body || ""].join(" | ")).join("\n");
    ta.placeholder = "A question | the answer\nAnother | its answer"; ta.rows = 4; ta.style.cssText = taCss;
    ta.addEventListener("change", () => { const items = ta.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const p = l.split("|").map((x) => x.trim()); return { summary: p[0] || "", body: p[1] || "" }; }).filter((it) => it.summary); save({ type: "accordion", items }); });
    host.append(ta, el("div", "hint", "One row per line:  summary | details"));
    return;
  }
  const def = BLOCK_DEFS.find((d) => d.type === t);
  if (def && def.field && def.parse && def.fmt) {
    const ta = el("textarea");
    ta.value = (cb[def.field] || []).map(def.fmt).join("\n");
    ta.placeholder = def.hint || ""; ta.rows = 4; ta.style.cssText = taCss;
    ta.addEventListener("change", () => { const arrv = ta.value.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => def.parse(l.split("|").map((x) => x.trim()))); const o = { type: t }; o[def.field] = arrv; save(o); });
    host.appendChild(ta);
    if (def.hint) host.appendChild(el("div", "hint", def.hint));
    return;
  }
  host.appendChild(el("div", "hint", "Edit this component from the main section list."));
}
// r4 feature-cards editor — a grid of cards (image + title + text + optional link).
function renderCardsBlockBody(blk, idx, sub, ti) {
  const miniBtn = "font:inherit;font-size:12px;padding:5px 11px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  const inputCss = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-bottom:6px;box-sizing:border-box";
  const commitTitle = () => { BLOCKS_WORK[idx].title = ti.value.trim(); };
  const cur = () => BLOCKS_WORK[idx];   // item 77: the section as it stands, not the copy this panel was drawn from
  const cards = Array.isArray(blk.cards) ? blk.cards : [];
  cards.forEach((c, k) => {
    const row = el("div"); row.style.cssText = "border:1px dashed var(--line,#ddd);border-radius:10px;padding:8px;margin-bottom:8px";
    const photo = el("div"); photo.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:6px";
    if (c.image_id) photo.appendChild(mediaThumb(c.image_id));
    const pb = el("button", null, c.image_id ? "Change image" : "Add image (optional)"); pb.type = "button"; pb.style.cssText = miniBtn;
    pb.addEventListener("click", () => { commitTitle(); openPicker((id) => { cur().cards[k].image_id = id || undefined; renderBlocksCard(); }); });
    photo.appendChild(pb); row.appendChild(photo);
    const hd = el("input"), tx = el("input"), lk = el("input");
    hd.placeholder = "Card title"; hd.value = c.heading || "";
    tx.placeholder = "A line of text (optional)"; tx.value = c.text || "";
    lk.placeholder = "Link (optional)"; lk.value = c.link || "";
    [hd, tx, lk].forEach((inp) => { inp.type = "text"; inp.style.cssText = inputCss; });
    const commit = () => { cur().cards[k] = { heading: hd.value.trim(), text: tx.value.trim() || undefined, image_id: cur().cards[k]?.image_id || undefined, link: lk.value.trim() || undefined }; };
    [hd, tx, lk].forEach((inp) => inp.addEventListener("change", commit));
    row.append(hd, tx, aiField(tx, { field: "caption" }), lk);
    linkPick(lk);   // item 225
    const rm = el("button", null, "Remove card"); rm.type = "button"; rm.style.cssText = miniBtn;
    rm.addEventListener("click", () => { commitTitle(); cur().cards.splice(k, 1); renderBlocksCard(); });
    row.appendChild(rm); sub.appendChild(row);
  });
  if (cards.length < 8) {
    const add = el("button", null, "+ Add card"); add.type = "button"; add.style.cssText = miniBtn;
    add.addEventListener("click", () => { commitTitle(); (BLOCKS_WORK[idx].cards = BLOCKS_WORK[idx].cards || []).push({ heading: "" }); renderBlocksCard(); });
    sub.appendChild(add);
  }
}

// ══ Phase FB: the custom form builder — typed fields, no code box ══════════════
// Forms live in the SAME settings.blocks array as content blocks (as type:"form")
// so there is ONE storage + one publish pipeline (no new table). The server
// (lib/forms.ts) is the authoritative safety gate; this UI can only ever produce
// whitelisted, typed fields — never raw HTML/JS. Saved as you go, mirroring
// the content-block editor above.
const FF_TYPES = [["text", "Short text"], ["textarea", "Long text (paragraph)"], ["email", "Email"], ["phone", "Phone"], ["number", "Number"], ["date", "Date"], ["select", "Dropdown (pick one)"], ["radio", "Choose one"], ["checkbox", "Checkboxes (pick many)"], ["consent", "Consent checkbox"], ["rating", "Star rating"], ["file", "Photo or file"]];
const FF_CHOICE = ["select", "radio", "checkbox"];
const FF_KINDS = [["contact", "Message / contact"], ["quote", "Quote / request"], ["booking", "Booking"]];
const FF_OPS = [["equals", "equals"], ["notEquals", "does not equal"], ["isEmpty", "is empty"], ["notEmpty", "is not empty"], ["contains", "contains"], ["gt", "greater than"], ["lt", "less than"]];
const FF_ACTIONS = [["show", "show it"], ["hide", "hide it"], ["require", "make it required"], ["optional", "make it optional"]];
const FORM_PRESETS_UI = [
  { key: "contact", name: "Contact form", def: { type: "form", id: "contact", title: "Contact us", kind: "contact", submit_label: "Send message", confirmation_text: "Thanks — we’ll be in touch soon.", fields: [{ key: "name", label: "Your name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }, { key: "phone", label: "Phone (optional)", type: "phone" }, { key: "message", label: "How can we help?", type: "textarea", required: true }] } },
  { key: "quote", name: "Quote request", def: { type: "form", id: "quote", title: "Request a quote", kind: "quote", submit_label: "Request a quote", confirmation_text: "Got it — we’ll send your quote shortly.", fields: [{ key: "name", label: "Your name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }, { key: "phone", label: "Phone", type: "phone" }, { key: "service", label: "What do you need?", type: "select", required: true, choices: ["General enquiry", "A new project", "Ongoing work", "Something else"] }, { key: "budget", label: "Rough budget", type: "select", choices: ["Not sure yet", "Under $1,000", "$1,000–$5,000", "$5,000+"] }, { key: "details", label: "Tell us more", type: "textarea", required: true }] } },
  { key: "application", name: "Application", def: { type: "form", id: "application", title: "Apply now", kind: "quote", submit_label: "Submit application", confirmation_text: "Thanks for applying — we’ll review and get back to you.", fields: [{ key: "name", label: "Full name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }, { key: "phone", label: "Phone", type: "phone", required: true }, { key: "position", label: "Position you’re applying for", type: "text", required: true }, { key: "experience", label: "Relevant experience", type: "textarea", required: true }, { key: "start_date", label: "Earliest start date", type: "date" }, { key: "consent", label: "I agree to be contacted about my application.", type: "consent", required: true }] } },
  { key: "booking", name: "Booking intake", def: { type: "form", id: "booking", title: "Request a booking", kind: "booking", submit_label: "Request booking", confirmation_text: "Thanks — we’ll confirm your booking soon.", fields: [{ key: "name", label: "Your name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }, { key: "phone", label: "Phone", type: "phone", required: true }, { key: "date", label: "Preferred date", type: "date", required: true }, { key: "party_size", label: "How many people?", type: "number", min: 1, max: 100 }, { key: "notes", label: "Anything we should know?", type: "textarea" }] } },
  { key: "blank", name: "Blank form", def: { type: "form", id: "form", title: "New form", kind: "contact", fields: [{ key: "name", label: "Your name", type: "text", required: true }, { key: "email", label: "Email", type: "email", required: true }] } },
];
const FF_IN = "width:100%;padding:8px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:13px;margin-bottom:6px;box-sizing:border-box;background:var(--card,#fff)";
const FF_BTN = "font:inherit;font-size:12px;padding:2px 9px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
let FORMS_PAGE = "";      // the page FORMS_WORK belongs to ("" = home)
function formsHostBlocks(slug) {
  if (slug) { const p = dcPageObj(slug); return Array.isArray(p && p.blocks) ? p.blocks : []; }
  return Array.isArray(S.settings && S.settings.blocks) ? S.settings.blocks : [];
}
function currentForms(slug = FORMS_PAGE) { return formsHostBlocks(slug).filter((b) => b && b.type === "form"); }
// A published form posts only its id, so an id has to be unique across the whole site.
function allFormIds() {
  const ids = new Set((FORMS_WORK || []).map((f) => f.id));
  ["", ...dcPagesArr().map((p) => p && p.slug).filter(Boolean)].forEach((s) => currentForms(s).forEach((f) => ids.add(f.id)));
  return ids;
}
function formsLoad() {
  FORMS_PAGE = DC_PAGE;
  FORMS_WORK = currentForms().map((f) => JSON.parse(JSON.stringify(f)));
  renderFormsCard();
  FORMS_BASE = JSON.stringify(FORMS_WORK);
}
// The Pages bar re-renders on every page switch: bring the Forms card along, saving
// what was typed on the page being left rather than dropping it.
function formsFollowPage() {
  if (!$("formsCard") || FORMS_PAGE === DC_PAGE) return;
  clearTimeout(FORMS_SAVE_T); FORMS_SAVE_T = null;
  if (JSON.stringify(FORMS_WORK) !== FORMS_BASE) { saveForms().finally(formsLoad); return; }
  formsLoad();
}
function ffSlug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40); }
function ffUniqueId(base, taken) { let id = ffSlug(base) || "form"; let n = 1; while (taken.has(id)) id = ffSlug(base) + "_" + (++n); taken.add(id); return id; }
function ffSel(options, value, onchange) {
  const s = el("select"); s.style.cssText = FF_IN + ";width:auto;min-width:120px";
  options.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; if (v === value) o.selected = true; s.appendChild(o); });
  s.addEventListener("change", () => onchange(s.value)); return s;
}
let FORMS_SAVING = false;
async function saveForms() {
  whisper("topWhisper", "saving");
  FORMS_SAVING = true;
  try {
    // Built from the saved list below, so section edits reach it first.
    if (!(await dcSavePendingEdits(true))) { whisper("topWhisper", "failed"); return; }
    await settingsTurn(putForms);
    whisper("topWhisper", "saved"); scheduleChangesRefresh(); refreshDesignPreview();
  } catch (err) { whisper("topWhisper", "failed"); toast(nice(err), true); }
  finally { FORMS_SAVING = false; }
}
async function putForms() {
  const sentForms = JSON.stringify(FORMS_WORK);
  // Forms keep their place on the page (a save used to drag them all to the bottom);
  // a form removed here drops out, a new one lands at the end.
  const withForms = (list) => {
    const work = new Map(FORMS_WORK.map((f) => [f.id, f]));
    const placed = new Set();
    const next = [];
    list.forEach((b) => {
      if (!b || b.type !== "form") { next.push(b); return; }
      if (work.has(b.id)) { next.push(work.get(b.id)); placed.add(b.id); }
    });
    FORMS_WORK.forEach((f) => { if (!placed.has(f.id)) next.push(f); });
    return next;
  };
  const next = withForms(formsHostBlocks(FORMS_PAGE)), sentList = JSON.stringify(next);
  let r;
  if (FORMS_PAGE) {
    const pages = dcPagesArr().map((p) => (p && p.slug === FORMS_PAGE ? { ...p, blocks: next } : p));
    UNDO_QUIET++; const put = api("PUT", "/settings", { pages }); UNDO_QUIET--;   // a form is a section: it gets a snapshot like the others, below
    r = await put;
    S.settings = r.data || { ...S.settings, pages };
  } else {
    UNDO_QUIET++; const put = api("PUT", "/settings", { blocks: next }); UNDO_QUIET--;
    r = await put;
    S.settings = r.data || { ...S.settings, blocks: next };
  }
  // Keep the content-block editor in sync. A section edit made while this was out is newer
  // than what came back: it stays, with the form change under it, and saves next.
  if (typeof BLOCKS_WORK !== "undefined") {
    if (!blocksDirty()) { BLOCKS_WORK = currentBlocks(); if (FORMS_PAGE === DC_PAGE) dcHistoryRecord(); dcHistoryCommit(); }
    else if (FORMS_PAGE === DC_PAGE) { BLOCKS_WORK = JSON.parse(JSON.stringify(withForms(BLOCKS_WORK))); dcHistoryRecord(); DC_HIST_LAST = sentList; updateUndoButtons(); blocksSaveSoon(); }
  }
  const ae = document.activeElement;
  if (JSON.stringify(FORMS_WORK) !== sentForms) { FORMS_BASE = sentForms; formsSaveSoon(); }   // newer edits than what came back: keep them, save them next
  else if (ae && ae.matches && ae.matches("#formsCard input, #formsCard textarea, #formsCard select")) FORMS_BASE = sentForms;   // never rebuild under a field being typed in
  else {
    FORMS_WORK = currentForms().map((f) => JSON.parse(JSON.stringify(f)));
    renderFormsCard();
    FORMS_BASE = JSON.stringify(FORMS_WORK);
  }
}
// Forms follow the same rule as sections: a difference from the last save is saved.
let FORMS_SAVE_T = null;
// Builder item 251: a form edit in its 0.7 s wait, on its way, or failed (the close-tab warning asks)
function formsPending() { return FORMS_SAVE_T != null || !!FORMS_SAVING || !!(FORMS_WORK && JSON.stringify(FORMS_WORK) !== FORMS_BASE); }
if (typeof SAVE_PARTS !== "undefined") SAVE_PARTS.push({ pending: formsPending, retry: formsSaveNow });   // the core's close-tab warning and retry (items 250, 251)
function formsSaveSoon(ms) { clearTimeout(FORMS_SAVE_T); FORMS_SAVE_T = setTimeout(formsSaveNow, ms === undefined ? 700 : ms); }
async function formsSaveNow() {
  clearTimeout(FORMS_SAVE_T); FORMS_SAVE_T = null;
  if (FORMS_SAVING) { formsSaveSoon(); return; }
  if (FORMS_WORK && JSON.stringify(FORMS_WORK) !== FORMS_BASE) await saveForms();
}
function mountFormsCard() {
  const host = $("designHost"); if (!host || $("formsCard")) return;
  const card = el("div", "field"); card.id = "formsCard"; card.style.marginTop = "18px";
  host.appendChild(card);
  card.addEventListener("change", () => formsSaveSoon());
  formsLoad();
}
// Bump ?v= whenever form-answers.js changes: browsers keep a .js file for a day.
let FORM_ANSWERS = null;
function openFormAnswers(form, btn) {
  if (!FORM_ANSWERS) FORM_ANSWERS = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "/form-answers.js?v=1";
    s.onload = () => window.DDSFormAnswers ? res(window.DDSFormAnswers) : rej(new Error("missing"));
    s.onerror = () => rej(new Error("load"));
    document.head.appendChild(s);
  }).catch((e) => { FORM_ANSWERS = null; throw e; });   // a failed load can be tried again
  FORM_ANSWERS.then((m) => m.open({ formId: form.id, page: FORMS_PAGE, title: form.title || "Form", get: (route) => api("GET", route), opener: btn }))
    .catch(() => toast("The answers couldn’t open just now. Try again in a moment."));
}
function renderFormsCard() {
  const card = $("formsCard"); if (!card) return; card.textContent = "";
  const formsPage = FORMS_PAGE ? dcPageObj(FORMS_PAGE) : null;
  card.appendChild(el("label", null, "Forms on " + (FORMS_PAGE ? "“" + ((formsPage && formsPage.title) || FORMS_PAGE) + "”" : "your home page")));
  card.appendChild(el("div", "hint", "Build any form from typed fields — contact, quote, application or booking. Every form is automatically mobile-friendly, accessible and safe. Each form shows as a section on the page you’re editing. Switch pages to add one elsewhere. Changes save themselves; nothing goes live until you publish."));
  const commitForm = (fi, patch) => { FORMS_WORK[fi] = { ...FORMS_WORK[fi], ...patch }; };
  const commitField = (fi, xi, patch) => { const fs = FORMS_WORK[fi].fields.slice(); fs[xi] = { ...fs[xi], ...patch }; FORMS_WORK[fi] = { ...FORMS_WORK[fi], fields: fs }; };

  FORMS_WORK.forEach((form, fi) => {
    form.fields = form.fields || []; form.rules = form.rules || [];
    const panel = el("div"); panel.style.cssText = "border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:12px 14px;margin-top:12px";
    const head = el("div"); head.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:8px";
    const nm = el("div", null, form.title || "Form"); nm.style.cssText = "flex:1;font-weight:600;font-size:13px";
    const rm = el("button", null, "Remove form"); rm.type = "button"; rm.style.cssText = FF_BTN;
    rm.addEventListener("click", async () => { const f = FORMS_WORK[fi]; if (await askYes("Remove this form?", { ok: "Remove form", danger: true })) { const at = FORMS_WORK.indexOf(f); if (at >= 0) FORMS_WORK.splice(at, 1); renderFormsCard(); } });
    // Builder list item 147: this form's own table of answers (form-answers.js, loaded on first use)
    const ans = el("button", "ff-btn", "Answers"); ans.type = "button";
    ans.addEventListener("click", () => openFormAnswers(form, ans));
    head.append(nm, ans, rm); panel.appendChild(head);
    // Item 148: a button anywhere on the site opens this form in a pop-up with this link
    panel.appendChild(el("div", "hint", "To open this form from any button or banner, give it the link #form-" + form.id + " (it opens over the page)."));

    // form settings
    const ti = el("input"); ti.type = "text"; ti.placeholder = "Form title"; ti.value = form.title || ""; ti.style.cssText = FF_IN;
    ti.addEventListener("change", () => commitForm(fi, { title: ti.value.trim() }));
    panel.appendChild(el("div", "hint", "Form title (shown above the form)")); panel.appendChild(ti);
    const kindRow = el("div"); kindRow.style.cssText = "display:flex;gap:10px;align-items:center;margin:2px 0 8px;flex-wrap:wrap";
    kindRow.appendChild(el("span", "hint", "This is a")); kindRow.appendChild(ffSel(FF_KINDS, form.kind || "contact", (v) => commitForm(fi, { kind: v })));
    panel.appendChild(kindRow);

    // fields
    panel.appendChild(el("div", "hint", "Fields — reorder with ↑ ↓. Every field is typed and validated for you. Give fields different “page/step” numbers to split a long form into steps with Back/Next and a progress bar (leave them all on 1 for a single page). Tick “prefilled from a link” to let a link fill a field in — e.g. yoursite.com/contact?email=… on a “reply to this enquiry” link."));
    form.fields.forEach((fld, xi) => {
      const row = el("div"); row.style.cssText = "border:1px solid var(--hair,#eee);border-radius:9px;padding:9px 10px;margin-top:8px;background:var(--sheet,#fbfaf8)";
      const top = el("div"); top.style.cssText = "display:flex;gap:6px;align-items:center;flex-wrap:wrap";
      const lab = el("input"); lab.type = "text"; lab.placeholder = "Question / label"; lab.value = fld.label || ""; lab.style.cssText = FF_IN + ";flex:1;min-width:150px;margin:0";
      lab.addEventListener("change", () => commitField(fi, xi, { label: lab.value.trim() }));
      const typeSel = ffSel(FF_TYPES, fld.type || "text", (v) => { commitField(fi, xi, { type: v }); renderFormsCard(); });
      top.append(lab, typeSel);
      const up = icoBtn("up", "Move this field up", null, 14), dn = icoBtn("down", "Move this field down", null, 14), del = icoBtn("x", "Remove this field", null, 14);
      [up, dn, del].forEach((b) => { b.type = "button"; b.style.cssText = FF_BTN; });
      up.disabled = xi === 0; dn.disabled = xi === form.fields.length - 1;
      up.addEventListener("click", () => { const fs = FORMS_WORK[fi].fields; [fs[xi - 1], fs[xi]] = [fs[xi], fs[xi - 1]]; renderFormsCard(); });
      dn.addEventListener("click", () => { const fs = FORMS_WORK[fi].fields; [fs[xi + 1], fs[xi]] = [fs[xi], fs[xi + 1]]; renderFormsCard(); });
      del.addEventListener("click", () => { FORMS_WORK[fi].fields.splice(xi, 1); renderFormsCard(); });
      top.append(up, dn, del); row.appendChild(top);

      // per-field options
      const opts = el("div"); opts.style.cssText = "margin-top:7px;display:flex;flex-direction:column;gap:5px";
      const reqL = el("label"); reqL.style.cssText = "font-size:12px;display:inline-flex;align-items:center;gap:6px";
      const req = el("input"); req.type = "checkbox"; req.checked = !!fld.required; req.style.cssText = "width:auto;margin:0";
      req.addEventListener("change", () => commitField(fi, xi, { required: req.checked }));
      reqL.append(req, document.createTextNode("Required")); opts.appendChild(reqL);
      if (FF_CHOICE.includes(fld.type)) {
        const ch = el("textarea"); ch.placeholder = "One choice per line"; ch.value = (fld.choices || []).join("\n"); ch.rows = Math.max(2, (fld.choices || []).length); ch.style.cssText = FF_IN + ";margin:0";
        ch.addEventListener("change", () => commitField(fi, xi, { choices: ch.value.split("\n").map((s) => s.trim()).filter(Boolean) }));
        opts.appendChild(ch);
        if (fld.type === "checkbox") {
          const mL = el("label"); mL.style.cssText = reqL.style.cssText; const m = el("input"); m.type = "checkbox"; m.checked = !!fld.multiple; m.style.cssText = "width:auto;margin:0";
          m.addEventListener("change", () => commitField(fi, xi, { multiple: m.checked })); mL.append(m, document.createTextNode("Allow more than one")); opts.appendChild(mL);
        }
      } else if (fld.type === "number" || fld.type === "date") {
        const mm = el("div"); mm.style.cssText = "display:flex;gap:6px";
        const mn = el("input"), mx = el("input"); mn.placeholder = "Min (optional)"; mx.placeholder = "Max (optional)";
        mn.type = mx.type = fld.type === "date" ? "date" : "number"; mn.value = fld.min != null ? fld.min : ""; mx.value = fld.max != null ? fld.max : "";
        [mn, mx].forEach((i) => { i.style.cssText = FF_IN + ";margin:0"; });
        const cm = () => commitField(fi, xi, { min: mn.value === "" ? undefined : (fld.type === "date" ? mn.value : Number(mn.value)), max: mx.value === "" ? undefined : (fld.type === "date" ? mx.value : Number(mx.value)) });
        mn.addEventListener("change", cm); mx.addEventListener("change", cm); mm.append(mn, mx); opts.appendChild(mm);
      }
      if (fld.type !== "consent") {
        const help = el("input"); help.type = "text"; help.placeholder = "Helper text (optional)"; help.value = fld.help || ""; help.style.cssText = FF_IN + ";margin:0";
        help.addEventListener("change", () => commitField(fi, xi, { help: help.value.trim() })); opts.appendChild(help);
      }
      // FB-2: multi-step grouping (a "page" number) + prefill-from-link opt-in.
      const adv = el("div"); adv.style.cssText = "display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:2px";
      const stepWrap = el("label"); stepWrap.style.cssText = "font-size:12px;display:inline-flex;align-items:center;gap:6px";
      const stepIn = el("input"); stepIn.type = "number"; stepIn.min = "1"; stepIn.max = "12"; stepIn.value = fld.step != null ? fld.step : ""; stepIn.placeholder = "1";
      stepIn.style.cssText = "width:56px;padding:5px 7px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:12px";
      stepIn.addEventListener("change", () => commitField(fi, xi, { step: stepIn.value === "" ? undefined : Math.max(1, Math.min(12, Math.trunc(Number(stepIn.value)) || 1)) }));
      stepWrap.append(document.createTextNode("Page/step"), stepIn); adv.appendChild(stepWrap);
      if (fld.type !== "consent" && fld.type !== "file") {   // a link can't choose a visitor's files (item 147)
        const pfL = el("label"); pfL.style.cssText = "font-size:12px;display:inline-flex;align-items:center;gap:6px";
        const pf = el("input"); pf.type = "checkbox"; pf.checked = !!fld.prefill; pf.style.cssText = "width:auto;margin:0";
        pf.addEventListener("change", () => commitField(fi, xi, { prefill: pf.checked }));
        pfL.append(pf, document.createTextNode("Can be prefilled from a link")); adv.appendChild(pfL);
      }
      opts.appendChild(adv);
      row.appendChild(opts); panel.appendChild(row);
    });
    const addF = el("button", null, "+ Add field"); addF.type = "button"; addF.style.cssText = FF_BTN; addF.style.marginTop = "8px";
    addF.addEventListener("click", () => { FORMS_WORK[fi].fields = (FORMS_WORK[fi].fields || []).concat({ key: "field_" + (form.fields.length + 1), label: "", type: "text" }); renderFormsCard(); });
    panel.appendChild(addF);

    // smart rules (optional) — the whitelisted conditional logic
    const rulesBox = el("details"); rulesBox.style.cssText = "margin-top:10px";
    const rsum = el("summary", null, "Smart rules (optional) — show/hide fields based on answers"); rsum.style.cssText = "cursor:pointer;font-size:12.5px;font-weight:600;color:var(--plum-deep,#3a2470)";
    rulesBox.appendChild(rsum);
    const fieldOpts = form.fields.filter((f) => f.key).map((f) => [f.key, f.label || f.key]);
    (form.rules || []).forEach((rule, ri) => {
      rule.when = rule.when || {}; rule.then = rule.then || {};
      const rr = el("div"); rr.style.cssText = "display:flex;gap:5px;align-items:center;flex-wrap:wrap;margin-top:7px;font-size:12px";
      const commitRule = (patch) => { const rs = FORMS_WORK[fi].rules.slice(); rs[ri] = { when: { ...rs[ri].when }, then: { ...rs[ri].then }, ...patch }; if (patch.when) rs[ri].when = { ...rs[ri].when, ...patch.when }; if (patch.then) rs[ri].then = { ...rs[ri].then, ...patch.then }; FORMS_WORK[fi] = { ...FORMS_WORK[fi], rules: rs }; };
      rr.appendChild(el("span", null, "When"));
      rr.appendChild(ffSel(fieldOpts.length ? fieldOpts : [["", "—"]], rule.when.field || "", (v) => commitRule({ when: { field: v } })));
      rr.appendChild(ffSel(FF_OPS, rule.when.op || "equals", (v) => { commitRule({ when: { op: v } }); renderFormsCard(); }));
      if (rule.when.op !== "isEmpty" && rule.when.op !== "notEmpty") {
        const val = el("input"); val.type = "text"; val.placeholder = "value"; val.value = rule.when.value != null ? rule.when.value : ""; val.style.cssText = FF_IN + ";width:110px;margin:0";
        val.addEventListener("change", () => commitRule({ when: { value: val.value } })); rr.appendChild(val);
      }
      rr.appendChild(el("span", null, "→"));
      rr.appendChild(ffSel(FF_ACTIONS, rule.then.action || "show", (v) => commitRule({ then: { action: v } })));
      rr.appendChild(ffSel(fieldOpts.length ? fieldOpts : [["", "—"]], rule.then.target || "", (v) => commitRule({ then: { target: v } })));
      const rdel = icoBtn("x", "Remove this rule", null, 14); rdel.style.cssText = FF_BTN;
      rdel.addEventListener("click", () => { FORMS_WORK[fi].rules.splice(ri, 1); renderFormsCard(); });
      rr.appendChild(rdel); rulesBox.appendChild(rr);
    });
    const addR = el("button", null, "+ Add rule"); addR.type = "button"; addR.style.cssText = FF_BTN; addR.style.marginTop = "8px";
    addR.addEventListener("click", () => { FORMS_WORK[fi].rules = (FORMS_WORK[fi].rules || []).concat({ when: { field: (fieldOpts[0] || [""])[0], op: "equals", value: "" }, then: { action: "show", target: (fieldOpts[0] || [""])[0] } }); renderFormsCard(); });
    rulesBox.appendChild(addR);
    panel.appendChild(rulesBox);

    // after-submit settings
    const after = el("details"); after.style.cssText = "margin-top:8px";
    const asum = el("summary", null, "After they send it"); asum.style.cssText = rsum.style.cssText;
    after.appendChild(asum);
    const sub = el("input"); sub.type = "text"; sub.placeholder = "Submit button label (e.g. Send)"; sub.value = form.submit_label || ""; sub.style.cssText = FF_IN + ";margin-top:8px";
    sub.addEventListener("change", () => commitForm(fi, { submit_label: sub.value.trim() })); after.appendChild(sub);
    const conf = el("input"); conf.type = "text"; conf.placeholder = "Thank-you message"; conf.value = form.confirmation_text || ""; conf.style.cssText = FF_IN;
    conf.addEventListener("change", () => commitForm(fi, { confirmation_text: conf.value.trim() })); after.appendChild(conf);
    const redir = el("input"); redir.type = "text"; redir.placeholder = "Or redirect to a link (optional, https://…)"; redir.value = form.redirect_url || ""; redir.style.cssText = FF_IN;
    redir.addEventListener("change", () => commitForm(fi, { redirect_url: redir.value.trim() })); after.appendChild(redir);
    panel.appendChild(after);

    card.appendChild(panel);
  });

  // add a form (from a preset)
  const addWrap = el("div"); addWrap.style.cssText = "margin-top:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap";
  addWrap.appendChild(el("span", "hint", "Add a form:"));
  FORM_PRESETS_UI.forEach((p) => {
    const b = el("button", null, p.name); b.type = "button"; b.style.cssText = FF_BTN;
    b.addEventListener("click", () => ffAddPreset(p));
    addWrap.appendChild(b);
  });
  card.appendChild(addWrap);

  formsSaveSoon();
}
// a form from a preset, at the end of the page the card is on (also the section search's Contact form tile, item 324)
function ffAddPreset(p) {
  const taken = allFormIds();
  const copy = JSON.parse(JSON.stringify(p.def)); copy.id = ffUniqueId(copy.id, taken); copy.rules = copy.rules || [];
  FORMS_WORK.push(copy); renderFormsCard();
}
// ── Phase CP-2 (DS-2): your home page — section visibility + order ──
const HOME_SECTION_DEFS = [ ["hero", "Welcome"], ["about", "About"], ["offerings", "What you offer"], ["testimonials", "Testimonials"], ["faqs", "Questions"] ];
// Whether this template lets the welcome section move. Read off the canvas: a template
// that honors its place stamps data-dds-movable on it. null until a home page with a
// welcome section has been drawn.
let DC_HERO_MOVES = null;
// The home page's built-in sections in their saved order, read the way the templates read
// it: the saved keys first, the rest in their usual order, and the welcome section first
// until the saved order names it.
function homeOrderNow() {
  const saved = ((S.settings && S.settings.sections_order) || []).filter((k) => HOME_SECTION_DEFS.some(([d]) => d === k));
  const lead = saved.includes("hero") ? [] : ["hero"];
  return [...lead, ...saved, ...HOME_SECTION_DEFS.map(([k]) => k).filter((k) => !saved.includes(k) && !lead.includes(k))];
}
// The home page's built-in sections that follow the saved order, top to bottom as drawn.
// Every template orders About, offerings, reviews and questions; the welcome section
// joins them where the template stamps it movable.
function dcCoreKeys(main) {
  if (DC_PAGE || !main) return [];
  const out = [];
  Array.prototype.forEach.call(main.querySelectorAll(":scope > [data-dds-core]"), (sec) => {
    const k = sec.getAttribute("data-dds-core");
    if (HOME_SECTION_DEFS.some(([d]) => d === k) && (k !== "hero" || sec.hasAttribute("data-dds-movable"))) out.push(k);
  });
  return out;
}
// One place up or down among the sections on show. Hidden and empty ones keep their
// place in the saved order, so the move lands next to the neighbour that can be seen.
let DC_FOCUS_CORE = null;   // the section just moved: the redraw brings it into view, and the left list's button keeps focus
function dcMoveCore(key, dir, fromTree) {
  const doc = dcFrameDoc(), onShow = new Set(dcCoreKeys(doc && doc.getElementById("main")));
  // Item 79: worked out when the move's turn comes, from the order the last move left (the
  // canvas catches up after), so two quick presses make two moves; worked out at the press,
  // the second repeated the first. Which sections are on show doesn't change with a move.
  const moved = () => {
    const shown = homeOrderNow().filter((k) => onShow.has(k));
    const i = shown.indexOf(key), j = i + dir;
    if (i < 0 || j < 0 || j >= shown.length) return null;
    const order = homeOrderNow().filter((k) => k !== key);
    const at = order.indexOf(shown[j]);
    order.splice(dir < 0 ? at : at + 1, 0, key);
    return order;
  };
  if (!moved()) return;
  DC_FOCUS_CORE = { key, dir, tree: !!fromTree };
  saveSections(moved, sectionsHiddenNow);
}
const sectionsHiddenNow = () => (S.settings && S.settings.sections_hidden) || [];
function remountSectionsCard() {   // in place, so the card keeps its spot among the others
  const old = $("sectionsCard"); if (!old) return;
  const parent = old.parentNode, next = old.nextSibling;
  old.remove(); mountSectionsCard();
  const nu = $("sectionsCard"); if (nu && parent && nu.parentNode === parent) parent.insertBefore(nu, next);
}
// The order and the hidden list may be functions, read when the write's turn comes (item 79).
async function saveSections(order, hidden) {
  try {
    const r = await settingsPut(() => {
      const o = typeof order === "function" ? order() : order;
      return o ? { sections_order: o, sections_hidden: typeof hidden === "function" ? hidden() : hidden } : null;
    });
    if (!r) { DC_FOCUS_CORE = null; return; }   // the move had nowhere left to go
    remountSectionsCard();
    toast("Home page updated — publish to apply"); scheduleChangesRefresh(); refreshDesignPreview();
  } catch (err) { DC_FOCUS_CORE = null; toast(nice(err), true); }
}
// The Styles list's order, and one swap in it, as they stand when a write's turn comes (item 79).
function cardOrderNow(heroPinned) {
  const o = homeOrderNow();
  return heroPinned ? ["hero", ...o.filter((k) => k !== "hero")] : o;
}
function swapInCard(key, dir, heroPinned) {
  const o = cardOrderNow(heroPinned), i = o.indexOf(key), j = i + dir;
  if (i < 0 || j < 0 || j >= o.length || (heroPinned && (key === "hero" || o[j] === "hero"))) return null;
  [o[i], o[j]] = [o[j], o[i]];
  return o;
}
function mountSectionsCard() {
  const host = $("designHost") || $("view-business"); if (!host || $("sectionsCard")) return;
  const hidden = new Set((S.settings && S.settings.sections_hidden) || []);
  let order = homeOrderNow();
  // A template that keeps the welcome section on top shows it there, with no arrows.
  const heroPinned = DC_HERO_MOVES === false;
  if (heroPinned) order = ["hero", ...order.filter((k) => k !== "hero")];
  const card = el("div", "field"); card.id = "sectionsCard"; card.style.marginTop = "18px"; card.dataset.stab = "looks";
  card.appendChild(el("label", null, "Your home page"));
  order.forEach((key, idx) => {
    const def = HOME_SECTION_DEFS.find(([k]) => k === key); if (!def) return;
    const rowEl = el("div"); rowEl.style.cssText = "display:flex;align-items:center;gap:9px;padding:7px 0;border-bottom:1px dashed var(--line,#eee)";
    const cb = el("input"); cb.type = "checkbox"; cb.checked = !hidden.has(key); cb.id = "sec-" + key;
    cb.addEventListener("change", () => saveSections(() => cardOrderNow(heroPinned), () => { const h = new Set(sectionsHiddenNow()); cb.checked ? h.delete(key) : h.add(key); return [...h]; }));
    const lb = el("label", null, def[1]); lb.setAttribute("for", "sec-" + key); lb.style.cssText = "flex:1;margin:0;font-weight:400";
    const still = heroPinned && key === "hero";
    const up = icoBtn("up", "Move up", null, 14); up.disabled = still || idx <= (heroPinned ? 1 : 0);
    const dn = icoBtn("down", "Move down", null, 14); dn.disabled = still || idx === order.length - 1;
    if (still) up.title = dn.title = "This template keeps the welcome section at the top";
    [up, dn].forEach((b) => b.style.cssText = "font:inherit;font-size:12px;padding:2px 9px;border-radius:8px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer" + (b.disabled ? ";opacity:.35;cursor:default" : ""));
    up.addEventListener("click", () => { if (!up.disabled) saveSections(() => swapInCard(key, -1, heroPinned), sectionsHiddenNow); });
    dn.addEventListener("click", () => { if (!dn.disabled) saveSections(() => swapInCard(key, 1, heroPinned), sectionsHiddenNow); });
    rowEl.append(cb, lb, up, dn);
    card.appendChild(rowEl);
  });
  card.appendChild(el("div", "hint", "Choose which sections appear on your home page, and their order. Unchecked sections are kept, never lost."));
  host.appendChild(card);
  mountLookCard();
  // On the Design view go() has already asked for this paint. Asking again from
  // here, a slow read later, replaced a canvas someone could already be working on.
  if (!$("view-design").classList.contains("on")) refreshDesignPreview();
}
// ── CP-2.5: the Look card — the template switcher's discoverable front door ──
async function mountLookCard() {
  const host = $("designHost"); if (!host || $("lookCard")) return;
  let looks = null;
  try { looks = await loadLooks(); } catch (_) { return; }
  if (!looks || (looks.templates || []).length < 2) return;
  const card = el("div", "field"); card.id = "lookCard"; card.style.marginTop = "18px"; card.dataset.stab = "looks";
  card.appendChild(el("label", null, "Template"));
  const cur = looks.templates.find((t) => t.slug === looks.current.slug);
  card.appendChild(el("div", "hint", "Your template sets your whole layout. Colours and fonts are just below. You're on the “" + ((cur && cur.name) || looks.current.slug) + "” template. Try another safely and preview it with your real content before deciding."));
  const b = el("button", null, "Try another template →");
  b.type = "button";
  b.style.cssText = "font:inherit;font-size:12.5px;margin-top:8px;padding:7px 14px;border-radius:999px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  b.addEventListener("click", () => { TG_OPEN = true; renderTemplateGallery(); const g = $("designGallery"); if (g) g.scrollIntoView({ block: "nearest" }); });
  card.appendChild(b);
  host.appendChild(card);
}

// ════════════════════════════════════════════════════════════════════════════
// DESIGN STUDIO REDESIGN — editor UX only. Everything below REUSES the existing
// engine: /site/templates + /site/template (gallery), BLOCK_DEFS + emptyBlock +
// BLOCKS_WORK + renderBlocksCard (tray/insert), and the SAME reorder model the
// ↑/↓ arrows use (drag). THE MOAT: every action edits the structured block LIST
// (append / move by index) — never an x/y coordinate, never overlap — so the
// served render stays auto-responsive & accessible exactly as before. No new
// origins; propose-then-approve (Save sections → publish) is unchanged.
// ════════════════════════════════════════════════════════════════════════════

// ── #5 — bigger device toggle for the live canvas (pure CSS width on the frame;
//    the render engine is untouched — this only resizes the preview viewport) ──
(function initDesignDeviceToggle() {
  const seg = $("dpDevSeg"); if (!seg) return;
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    const dev = b.dataset.dpdev;
    seg.querySelectorAll("button").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
    const stage = $("dpStage"); if (stage) stage.className = "dp-stage" + (dev === "desktop" ? "" : " dev-" + dev);
    dcZoomSync(); setTimeout(dcThemeTags, 260);   // the frame finishes changing width first
  });
  let resized = null;
  window.addEventListener("resize", () => { clearTimeout(resized); resized = setTimeout(dcColourAids, 150); });
})();
let DC_TW_LOADED = false;   // a past version is on the canvas — draft refreshes must not repaint over it
let DC_TW_SEQ = 0;          // orphans in-flight Timewarp lookups (a newer pick, or leaving the mode)
function dcModeSync() {
  const seg = $("dcModeSeg");
  if (seg) seg.querySelectorAll("button").forEach((b) => {
    const on = b.dataset.dcmode === DC_MODE;
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
  });
  const canvas = $("designCanvas");
  if (canvas) canvas.classList.toggle("dc-mode-view", DC_MODE === "timewarp");
  const dv = $("view-design"); if (dv) dv.classList.toggle("dc-mode-view", DC_MODE === "timewarp");
  const tw = $("dcTwBar"); if (tw) tw.hidden = DC_MODE !== "timewarp";
}
async function dcSetMode(mode) {
  mode = ["edit", "comments", "timewarp"].indexOf(mode) >= 0 ? mode : "edit";
  if (mode === DC_MODE) { if (mode === "comments") dcSetMode("edit"); return; }   // Comments keeps its G11 toggle-off
  if (IPE) ipeCommit();   // G13 slice 2: leaving Edit banks the in-flight text
  const prev = DC_MODE;
  const twWasLoaded = prev === "timewarp" && DC_TW_LOADED;   // captured before the reset just below
  if (prev === "comments" && CM_ON) cmToggle();   // the exact G11 OFF path (sync branch)
  if (prev === "timewarp") {
    DC_TW_LOADED = false; DC_TW_SEQ++; DC_TW_SHOWN = null;   // a lookup still in flight must not land after we leave
    const dt = $("dcTwDate"); if (dt) dt.value = "";
    const msg = $("dcTwMsg"); if (msg) msg.textContent = "";
  }
  DC_MODE = mode; dcModeSync();
  if (mode !== "edit" && DC_HIDEBAR) DC_HIDEBAR();   // item 99: on a phone the toolbar stays up after a tap, so Comments would inherit its Delete
  if (mode === "comments") {
    if (!CM_ON) await cmToggle();   // the G11 ON path — joins an in-flight load rather than no-opping
    if (DC_MODE !== "comments") { if (CM_ON) cmToggle(); }   // user left while threads loaded — run the OFF path
    else if (!CM_ON) { DC_MODE = "edit"; dcModeSync(); }     // load failed (cmToggle toasted) — fall back honestly
  }
  const wasView = prev === "timewarp";
  const isView = DC_MODE === "timewarp";
  if (isView) closeDesignPanels();   // view modes read like a visitor — no editing panels over them
  if (isView && !wasView) dcTwList();   // builder item 322: the saved versions, above the page
  // Reload the frame only when crossing the editing/viewing boundary (the load
  // handler injects chrome in Edit/Comments, withholds it in Preview/Timewarp) —
  // or when leaving a landed Timewarp, whose past render must give way to the draft.
  if (wasView !== isView || twWasLoaded) refreshDesignPreview();
}
// Links and forms never navigate the canvas away, in any mode (the same spirit as the stage's
// link guard): view modes read like a visitor and the page scrolls freely; in Edit mode a press
// keeps its editing meaning (the menu opens the Pages card, a tap picks a section) and the
// browser never follows the link. Item 244: Edit mode had no guard of its own.
function dcGuardNav(doc) {
  try {
    if (!doc || doc.__dcNavGuard) return;   // once per document: dcWatchNav and the load both bring it
    doc.__dcNavGuard = true;
    doc.addEventListener("click", (e) => { const a = e.target && e.target.closest && e.target.closest("a"); if (a) e.preventDefault(); }, true);
    doc.addEventListener("submit", (e) => e.preventDefault(), true);
  } catch (_) { /* guard is best-effort; pointer events stay scoped to the frame */ }
}
// Item 288: the phone menu on the canvas. The page's own script never runs in the editor's frame
// (item 190), so the editor does what it would: the Menu button opens and closes the sheet, and
// Escape closes it. The Header card's "View the phone menu" opens it the same way.
function dcMenuToggle(on) {
  try {
    const doc = $("designPreview").contentDocument, m = doc.querySelector(".site-menu"), b = doc.querySelector(".menu-btn");
    if (!m || !b) return;
    const open = on == null ? !m.classList.contains("open") : !!on;
    m.classList.toggle("open", open); b.setAttribute("aria-expanded", open ? "true" : "false");
  } catch (_) {}
}
function dcMenuWire(doc) {
  try {
    if (!doc || doc.__dcMenuWire) return;
    doc.__dcMenuWire = true;
    doc.addEventListener("click", (e) => { const b = e.target && e.target.closest && e.target.closest(".menu-btn"); if (b) { e.preventDefault(); e.stopPropagation(); dcMenuToggle(); } }, true);
    doc.addEventListener("keydown", (e) => { if (e.key === "Escape") dcMenuToggle(false); });
  } catch (_) {}
}
// Item 244: a page written to the canvas can be pressed before its load event, which waits for
// its pictures, and the guard used to come only at load: every save draws the canvas again, so
// on a slow connection a press on the business name while a photo was still coming loaded
// another page into the canvas. For 300 frames after each write (a few seconds; the new page is
// in the canvas within a few), every frame guards whatever document is there before the browser
// paints it, so a page is guarded before anyone can see it, let alone press it. The load guards
// it too. Counting from the write, not the load, means a page whose photos never come doesn't
// keep the watch running, and an older page's load landing just after a write can't cut short
// the watch for the new one.
function dcWatchNav(frame) {
  let watch = 0, left = 0;   // frames still to watch since the last write
  const look = () => {
    try { dcGuardNav(frame.contentDocument); } catch (_) {}
    watch = --left > 0 ? requestAnimationFrame(look) : 0;
  };
  new MutationObserver(() => { left = 300; if (!watch) watch = requestAnimationFrame(look); }).observe(frame, { attributes: true, attributeFilter: ["srcdoc"] });
}
// Timewarp: picking a date calls the EXISTING route History's version tools use
// (renderVersionTools — identical fetch shape), then renders that kept version
// through the same /preview?publish_id= query the stage's openPublishPreview
// path uses — here into the canvas frame, read-only.
async function dcTimewarpGo() {
  const dt = $("dcTwDate"); if (!dt || DC_MODE !== "timewarp") return;
  const msg = $("dcTwMsg");
  const seq = ++DC_TW_SEQ;   // a newer pick (or leaving the mode) orphans this lookup
  DC_TW_SHOWN = null; dcTwPressed();   // a date, not one of the listed versions
  if (!dt.value) {   // date cleared — stay in Timewarp but hand the canvas back to the draft
    DC_TW_LOADED = false; if (msg) msg.textContent = ""; refreshDesignPreview(); return;
  }
  if (msg) msg.textContent = "Looking back…";
  try {
    const d = (await api("GET", `/publishes/timewarp?date=${encodeURIComponent(dt.value)}`)).data;
    if (seq !== DC_TW_SEQ || DC_MODE !== "timewarp") return;   // superseded while fetching
    const frame = $("designPreview");
    if (frame) {
      const path = dcPagePath();   // the page open on the canvas
      const html = await apiHtml(`/preview?publish_id=${encodeURIComponent(d.publish_id)}&page=${encodeURIComponent(path)}`);
      if (seq !== DC_TW_SEQ || DC_MODE !== "timewarp") return;
      DP_PAINT_OPEN = DC_PAGE_OPENS;
      frame.srcdoc = frameWall(html);   // item 190
    }
    DC_TW_LOADED = true;
    const when = new Date(dt.value + "T12:00:00").toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    // The server knows when the date resolves to the CURRENT live version — say so
    // (History's Timewarp surfaces the same d.message) instead of claiming history.
    if (msg) msg.textContent = d.is_current ? (d.message || "That’s how your website looks right now.") : "Your site as it looked on " + when + ".";
  } catch (err) {
    if (seq !== DC_TW_SEQ || DC_MODE !== "timewarp") return;
    DC_TW_LOADED = false; dt.value = "";   // cleared, so the SAME date can be re-picked (change wouldn't re-fire)
    if (msg) msg.textContent = "Couldn’t look back just now — this is today’s draft.";
    refreshDesignPreview();   // never leave a stale past render sitting under a failed lookup
    toast(nice(err), true);
  }
}

// Builder item 322: the dock's Versions lists the saved versions, newest first, above the page:
// the publishes and the checkpoints the Versions list under Site settings shows. A press draws
// that version on the canvas through the same /preview the Versions list's View uses (a publish
// by publish_id, a checkpoint by launch_id); a date still finds the version live that day.
let DC_TW_VERS = [], DC_TW_SHOWN = null, DC_TW_LIST_SEQ = 0;
async function dcTwList() {
  const host = $("dcTwList"); if (!host) return;
  const seq = ++DC_TW_LIST_SEQ;
  host.textContent = ""; host.appendChild(el("span", "dc-twnone", "Finding your versions…"));
  let pubs = [], cps = [], failed = false;
  try {
    const [p, c] = await Promise.all([api("GET", "/publishes"), api("GET", "/publishes/checkpoints").catch(() => ({ data: [] }))]);
    pubs = Array.isArray(p && p.data) ? p.data : []; cps = Array.isArray(c && c.data) ? c.data : [];
  } catch (_) { failed = true; }
  if (seq !== DC_TW_LIST_SEQ || DC_MODE !== "timewarp") return;
  DC_TW_VERS = dcTwVersions(pubs, cps);
  dcTwPaint(failed);
}
// PURE: the versions the dock lists, newest first: no failed publish (there is nothing to draw), at most VERSIONS_SHOWN
function dcTwVersions(pubs, cps) {
  const list = (x) => (Array.isArray(x) ? x : []);
  return [...list(pubs).filter((v) => v && v.id && v.at && v.status !== "failed").map((v) => ({ id: v.id, at: v.at, live: v.status === "live", name: v.label || "", says: v.summary || "" })),
    ...list(cps).filter((c) => c && c.id && (c.at || c.created_at)).map((c) => ({ id: c.id, at: c.at || c.created_at, saved: true, name: c.name || "", says: "" }))]
    .sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, VERSIONS_SHOWN);
}
function dcTwPaint(failed) {
  const host = $("dcTwList"); if (!host) return;
  host.textContent = "";
  if (!DC_TW_VERS.length) { host.appendChild(el("span", "dc-twnone", failed ? "Your versions couldn’t load just now. Pick a date instead." : "No saved versions yet. Each time you publish, one is kept here.")); return; }
  DC_TW_VERS.forEach((v) => {
    const b = el("button", "dc-tw-v"); b.type = "button"; b.dataset.twVer = v.id;
    b.appendChild(document.createTextNode(verWhen(v.at)));
    b.appendChild(el("small", null, v.live ? "Live now" : v.saved ? "Saved, never live" : "Published"));
    b.title = (v.name ? "“" + v.name + "”: " : "") + (v.saved ? "a checkpoint of your draft" : v.says || "a version you published");
    b.addEventListener("click", () => dcTwShow(v));
    host.appendChild(b);
  });
  dcTwPressed();
}
function dcTwPressed() { const host = $("dcTwList"); if (host) host.querySelectorAll(".dc-tw-v").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.twVer === DC_TW_SHOWN))); }
async function dcTwShow(v) {
  if (DC_MODE !== "timewarp") return;
  const msg = $("dcTwMsg"), dt = $("dcTwDate");
  const seq = ++DC_TW_SEQ;   // a newer press, a date, or leaving the mode orphans this one
  if (dt) dt.value = "";
  DC_TW_SHOWN = v.id; dcTwPressed();
  if (msg) msg.textContent = "Looking back…";
  try {
    const html = await apiHtml(`/preview?${v.saved ? "launch_id" : "publish_id"}=${encodeURIComponent(v.id)}&page=${encodeURIComponent(dcPagePath())}`);
    if (seq !== DC_TW_SEQ || DC_MODE !== "timewarp") return;
    const frame = $("designPreview");
    if (frame) { DP_PAINT_OPEN = DC_PAGE_OPENS; frame.srcdoc = frameWall(html); }   // item 190
    DC_TW_LOADED = true;
    const d = new Date(v.at), when = d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    if (msg) msg.textContent = v.saved ? "Your draft as you saved it on " + when + "." : "Your site as you published it on " + when + (v.live ? ". It’s what’s live now." : ".");
  } catch (err) {
    if (seq !== DC_TW_SEQ || DC_MODE !== "timewarp") return;
    DC_TW_LOADED = false; DC_TW_SHOWN = null; dcTwPressed();
    if (msg) msg.textContent = "Couldn’t show that version just now. This is today’s draft.";
    refreshDesignPreview();   // never leave a stale past render under a failed lookup
    toast(nice(err), true);
  }
}

// ── #2 — on-demand panels (canvas-dominant layout) ──────────────────────────
// The tray and the design settings are NOT permanent rails. Each opens as a
// slide-over and closes again, so the live canvas keeps the majority of the
// screen. The tray has NO scrim (the canvas stays a visible drop target while
// dragging a section onto it); the settings panel dims behind a scrim.
let PANEL_LASTFOCUS = null;
let DC_RAIL_TAB = "contents";
function closeTrayPanel() {
  const p = $("trayPanel"); if (!p) return;
  p.classList.remove("on"); p.setAttribute("aria-hidden", "true");
  dcLeftSync();
}
// Slice C: the left rail has THREE tabs — Blocks (the add-section palette),
// Files (a compact asset browser) and Content tree (the page's component tree) —
// mirroring AEM's Components + Assets + Content Tree rails.
function dcRailTabName(name) { return (name === "add" || name === "files" || name === "blocks") ? name : "contents"; }
// the card's title and the quiet line under it, per tab (the floating studio, part two)
const TRAY_WORDS = { add: ["Add a section", "Drag a tile onto the page, or tap it"], files: ["Photos", "Tap one to place it in the section"], contents: ["Layers", "Every section on this page, and the blocks inside each"], blocks: ["Add a block", "Goes at the end of the section"] };
function dcRailTab(name) {
  DC_RAIL_TAB = dcRailTabName(name);
  const w = TRAY_WORDS[DC_RAIL_TAB], tt = $("trayTitle"), ts = $("traySub"), tp = $("trayPanel");
  if (tt) tt.textContent = w[0];
  if (ts) { ts.textContent = w[1]; ts.hidden = false; }
  if (tp) { tp.setAttribute("aria-label", w[0]); tp.dataset.tab = DC_RAIL_TAB; }
  dcLeftSync();
  [["add", $("tabAdd"), $("designTray")],
   ["files", $("tabFiles"), $("designFilesWrap")],
   ["contents", $("tabContents"), $("designTreeWrap")],
   ["blocks", null, $("designBlockAdd")]].forEach(([key, tab, panel]) => {
    const on = DC_RAIL_TAB === key;
    if (tab) { tab.classList.toggle("on", on); tab.setAttribute("aria-selected", String(on)); }
    if (panel) panel.hidden = !on;
  });
  if (DC_RAIL_TAB === "add") mountBlockTray();
  else if (DC_RAIL_TAB === "files") mountPanelFiles();
  else if (DC_RAIL_TAB === "blocks") stkRenderAdd();
  else dcRefreshTree();
}
function openTrayPanel(tab, find) {   // find: the dock's Find, which wants the search box even on a phone
  const p = $("trayPanel"); if (!p) return;
  closeSettingsPanel(); closePagesCard(false);
  PANEL_LASTFOCUS = document.activeElement;
  p.classList.add("on"); p.setAttribute("aria-hidden", "false");
  dcLeftSync();
  const want = dcRailTabName(tab);
  dcRailTab(want);
  const tray = $("designTray"); if (tray) tray.scrollTop = 0;
  // preventScroll: this lands while the panel is still opening, about 1px wide, where
  // the intro text is hundreds of pixels tall. A plain focus scrolled the list past
  // its own search box and left it there once the panel had widened.
  // A phone's keyboard would come up over the tiles, so there Add and Photos start on Done
  // and the search box waits for a tap; Find still starts in it.
  const typeNow = find || window.innerWidth > 760;
  setTimeout(() => { try {
    (want === "add" ? (typeNow && p.querySelector("#designTray .tray-search") || $("btnTrayClose"))
      : want === "files" ? (typeNow && $("pfSearch") || $("btnTrayClose"))
      : want === "blocks" ? (typeNow && p.querySelector("#designBlockAdd .tray-search") || $("btnTrayClose"))
      : $("tabContents")).focus({ preventScroll: true });
  } catch (_) {} }, 40);
}
// clicking a rail launcher again (same tab) closes it — a clear toggle
function toggleTray(tab) {
  const p = $("trayPanel"); const want = dcRailTabName(tab);
  if (p && p.classList.contains("on") && DC_RAIL_TAB === want) { closeDesignPanels(); return; }
  openTrayPanel(want);
}
function closeSettingsPanel() {
  const p = $("settingsPanel"), sc = $("dcScrim"); if (!p) return;
  p.classList.remove("on"); p.setAttribute("aria-hidden", "true");
  if (typeof dcUnhostView === "function") dcUnhostView();   // item 314
  if (PANEL_MODE === "core") { PANEL_MODE = "styles"; p.dataset.mode = "styles"; }
  dcHFMark(null);
  dcColourAids();
  if (sc) { sc.classList.remove("on"); sc.hidden = true; }
  if (PANEL_MODE === "section") {   // back to the full list, so a later "All sections" isn't one block
    PANEL_MODE = "styles"; BLOCK_SOLO = null; STK_ITEM = null; p.dataset.mode = "styles";
    if (typeof blocksSaveSoon === "function") blocksSaveSoon(0);
    if ($("blocksCard")) renderBlocksCard();
  }
}
// One panel, one job at a time. It used to stack the template gallery, the brand
// kit, every section's full form and the form builder in a single scroll.
//   styles   — how the whole site looks
//   section  — this one section's fields, with the page visible behind it
//   sections — the full list: ready-made layouts and saved sections
//   forms    — the form builder
// ── Items 41, 50 and 123: the site's header and footer, picked on the page ──
// A press on the header or footer on the canvas outlines it, names it "Header · on every
// page" (or Footer), and opens its card: the header's logo, arrangement (two pictures), what
// it does when the page scrolls (four pictures) and the way to the menu; the footer's two
// switches and the way to the business details its words come from. The scroll choice is
// the style setting header_scroll (lib/site_header.ts on the server); with none set the
// template's own shows, read from the canvas.
const HF_SCROLLS = [
  ["scroll", "Scrolls away", "The header scrolls away with the page."],
  ["stay", "Stays on top", "The header stays at the top of the screen while visitors scroll."],
  ["hide", "Hides, comes back", "The header slides away while visitors scroll down, and comes back when they scroll up."],
  ["fade", "Fades away", "The header fades out while visitors scroll down, and comes back when they scroll up."],
];
const HF_PIC_PARTS = { standard: ["lg", "m1", "m2"], centered: ["lg", "m1", "m2"], scroll: ["bar", "l1", "l2", "l3"], stay: ["bar", "l1", "l2", "l3"], hide: ["bar", "l1", "l2", "up"], fade: ["bar", "l1", "l2", "l3"] };
function hfTiles(host, label, opts, cur, onPick) {
  host.appendChild(el("div", "ins-lbl", label));
  const row = el("div", "hf-tiles"); row.style.setProperty("--n", String(opts.length)); row.setAttribute("role", "group"); row.setAttribute("aria-label", label);
  opts.forEach(([v, name]) => {
    const b = el("button", "hf-tile"); b.type = "button"; b.dataset.v = v || "standard"; b.setAttribute("aria-pressed", String(cur === v));
    const pic = el("span", "hf-pic"); pic.dataset.pic = v || "standard"; pic.setAttribute("aria-hidden", "true");
    (HF_PIC_PARTS[v || "standard"] || []).forEach((c) => pic.appendChild(el("i", c)));
    b.append(pic, document.createTextNode(name));
    b.addEventListener("click", () => onPick(v));
    row.appendChild(b);
  });
  host.appendChild(row);
  return row;
}
// What the header does now: the owner's choice, else what the template's own does on the canvas.
function hfScrollNow() {
  const t = DESIGN_TOKENS && DESIGN_TOKENS.header_scroll; if (t) return t;
  try {
    const h = $("designPreview").contentDocument.querySelector("header.site");
    const pos = h && h.ownerDocument.defaultView.getComputedStyle(h).position;
    return pos === "sticky" || pos === "fixed" ? "stay" : "scroll";
  } catch (_) { return "stay"; }
}
function renderHFCard(which) {
  const host = $("hfCard"); if (!host) return;
  host.textContent = ""; host.dataset.which = which;
  if (which === "header") {
    host.appendChild(el("div", "ins-lbl", "Logo"));
    const lr = el("div", "hf-logo"), lg = el("span", "lg"), logo = (S.media || []).find((m) => m.id === (S.settings && S.settings.logo_media_id));
    if (logo && logo.thumb) lg.style.backgroundImage = "url(" + JSON.stringify(logo.thumb) + ")";
    lr.append(lg, el("p", null, logo ? "Your logo shows beside your name." : "No logo yet: your name shows on its own."));
    const ch = el("button", "dc-modal-cancel", logo ? "Change" : "Add a logo"); ch.type = "button"; ch.dataset.needs = "configure";
    ch.addEventListener("click", () => { openSettingsPanel("styles"); stylesTab("colours"); });
    lr.appendChild(ch); host.appendChild(lr);
    hfTiles(host, "Arrangement", [["", "Standard"], ["centered", "Centered"]], String((S.settings && S.settings.nav_style) || ""), async (v) => {
      try { await settingsPut({ nav_style: v }); toast("Header: " + (v ? "Centered" : "Standard") + " — publish to apply"); scheduleChangesRefresh(); refreshDesignPreview(); renderHFCard("header"); }
      catch (err) { toast(nice(err), true); }
    });
    if (DESIGN_DEV) {
      // item 296: the logo and the name, the logo alone, or the name alone; and the logo's height
      const T = DESIGN_TOKENS || {};
      const mode = logo ? String(T.header_brand || "both") : (T.header_brand === "name" ? "name" : "both");
      pillRow(host, "Show", [["Logo and name", "both"], ["Logo only", "logo"], ["Name only", "name"]], (o) => mode === o[1], async (o) => {
        if (o[1] === "logo" && !logo) { toast("Add a logo first, then it can stand on its own."); return; }
        await saveTokens({ header_brand: o[1] === "both" ? "" : o[1] }, "Header: " + o[0].toLowerCase());
        refreshDesignPreview(); if (PANEL_MODE === "header") renderHFCard("header");
      });
      if (logo && mode !== "name") {
        const sr = el("div", "hf-size");
        const lab = el("label", null, "Logo size"); lab.htmlFor = "hfLogoSize";
        const rg = el("input"); rg.type = "range"; rg.id = "hfLogoSize"; rg.min = "24"; rg.max = "80"; rg.step = "2"; rg.value = String(T.logo_height || 34);
        const out = el("output", null, rg.value + " px"); out.htmlFor = "hfLogoSize";
        rg.addEventListener("input", () => { out.textContent = rg.value + " px"; try { const d = $("designPreview").contentDocument; d.querySelectorAll(".brand").forEach((a) => a.style.setProperty("--logo-h", rg.value + "px")); } catch (_) {} });
        rg.addEventListener("change", async () => { await saveTokens({ logo_height: rg.value === "34" ? "" : rg.value }, "Logo size: " + rg.value + " px"); refreshDesignPreview(); });
        sr.append(lab, rg, out); host.appendChild(sr);
      }
      // item 295: the search box can be left out
      const sw = el("label", "pg-sw"); const st = el("span", null, "Show a search box in the header"); const cb = el("input"); cb.type = "checkbox"; cb.checked = T.site_search !== "off";
      sw.append(st, cb);
      cb.addEventListener("change", async () => { await saveTokens({ site_search: cb.checked ? "" : "off" }, cb.checked ? "Search box shown" : "Search box hidden"); refreshDesignPreview(); });
      host.appendChild(sw);
      const now = hfScrollNow();
      hfTiles(host, "When the page scrolls", HF_SCROLLS.map((x) => [x[0], x[1]]), now, async (v) => {
        if (v === hfScrollNow()) return;
        await saveTokens({ header_scroll: v }, "Header: " + HF_SCROLLS.find((x) => x[0] === v)[1].toLowerCase());
        refreshDesignPreview();   // the canvas draws the new behaviour
        if (PANEL_MODE === "header") renderHFCard("header");
      });
      host.appendChild(el("p", "hf-says", HF_SCROLLS.find((x) => x[0] === now)[2]));
    }
    host.appendChild(el("div", "ins-lbl", "Menu"));
    // item 288: on a phone the menu folds behind a Menu button; the canvas's page runs no script, so the editor opens it
    const ph = $("dpDevSeg") && $("dpDevSeg").querySelector('[data-dpdev="phone"]');
    if (ph) {
      const vr = el("div", "hf-row"), vm = el("button", "dc-modal-cancel", "View the phone menu"); vm.type = "button"; vm.id = "hfViewMenu";
      vm.addEventListener("click", () => { if (ph.getAttribute("aria-pressed") !== "true") ph.click(); setTimeout(() => dcMenuToggle(true), 320); });
      vr.appendChild(vm); vr.appendChild(el("span", "hint", "On a phone, visitors see your name and a Menu button; the menu and the search box open under it."));
      host.appendChild(vr);
    }
    const mr = el("div", "hf-row"), n = (typeof pgModel === "function" ? pgModel().menu.length : 0);
    mr.appendChild(el("span", null, n + (n === 1 ? " item" : " items") + " in the menu"));
    const ed = el("button", "dc-modal-cancel", "Edit the menu"); ed.type = "button"; ed.addEventListener("click", () => { closeSettingsPanel(); openPagesCard("dcPageSwitch"); });
    mr.appendChild(ed); host.appendChild(mr);
    return;
  }
  [["footer_hours", "Show opening hours"], ["footer_social", "Show social links"]].forEach(([field, label]) => {
    const row = el("label", "pg-sw"); const t = el("span", null, label); const cb = el("input"); cb.type = "checkbox";
    cb.checked = !S.settings || S.settings[field] !== false;
    row.append(t, cb);
    cb.addEventListener("change", async () => {
      const on = cb.checked;
      try { await settingsPut({ [field]: on }); toast(label.replace("Show ", "") + (on ? " shown" : " hidden") + " in the footer — publish to apply"); scheduleChangesRefresh(); refreshDesignPreview(); }
      catch (err) { toast(nice(err), true); cb.checked = !on; }
    });
    host.appendChild(row);
  });
  if (DESIGN_DEV) pbPart(host);
  host.appendChild(el("p", "hf-says", "Your address, phone and email come from your business details. Links to your privacy and accessibility pages are added for you."));
  const biz = el("button", "dc-modal-cancel", "Change the business details"); biz.type = "button";
  biz.addEventListener("click", () => { closeSettingsPanel(); exitEditMode("business"); });
  const a = el("div", "hf-row"); a.appendChild(biz); host.appendChild(a);
}
function pbButtons() {
  const i = S.identity || {}, loc = S.location || {}, out = [];
  const tel = String(loc.phone || i.phone || "").trim().replace(/\s*(?:ext\.?|extension|x|#)\s*\d+\s*$/i, "").replace(/\D/g, "");
  if (tel.length >= 7) out.push("Call");
  if (String(loc.address_line1 || "").trim() && loc.goes_to_customers !== true) out.push("Directions");   // item 334: as the live bar (lib/phone_bar.ts)
  if (loc.temporarily_closed || (loc.hours || []).some((d) => d && !d.closed && (d.intervals || []).length)) out.push("Hours");
  if (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(i.email || "").trim())) out.push("Email");
  return out;
}
function pbPart(host) {
  host.appendChild(el("div", "ins-lbl", "Phone bar · phones only"));
  const now = pbNow();
  const seg = el("div", "dc-seg hf-seg"); seg.id = "pbSeg"; seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Phone bar");
  [["", "Off"], ["light", "Light"], ["dark", "Dark"]].forEach(([v, name]) => {
    const b = el("button", null, name); b.type = "button"; b.dataset.v = v || "off"; b.setAttribute("aria-pressed", String(now === v));
    b.addEventListener("click", async () => {
      if (v === pbNow()) return;
      await saveTokens({ phone_bar: v }, "Phone bar: " + name.toLowerCase());
      refreshDesignPreview();   // the canvas draws it (at a phone's width)
      if (PANEL_MODE === "footer") renderHFCard("footer");
    });
    seg.appendChild(b);
  });
  host.appendChild(seg);
  const NEEDS = { Call: "a phone number", Directions: "an address", Hours: "opening hours", Email: "an email" };
  const and = (xs) => xs.join(", ").replace(/, ([^,]*)$/, " and $1");
  const has = pbButtons(), missing = Object.keys(NEEDS).filter((x) => has.indexOf(x) < 0);
  const says = !has.length ? "Add a phone number, an address, opening hours or an email to your business details, and the bar can show them."
    : !now ? "Call, Directions, Hours and Email along the bottom of every page on a phone, from your business details."
    : "On a phone, every page with the footer shows " + and(has) + " along the bottom."
      + (missing.length ? " Add " + and(missing.map((x) => NEEDS[x])) + " to your business details to show " + and(missing) + " too." : "");
  const p = el("p", "hf-says", says); p.id = "pbSays"; host.appendChild(p);
  // on a computer the canvas is wide, where the bar isn't shown: one press shows the page as a phone does
  const ph = $("dpDevSeg") && $("dpDevSeg").querySelector('[data-dpdev="phone"]');
  if (now && has.length && ph && ph.offsetParent && ph.getAttribute("aria-pressed") !== "true") {
    const r = el("div", "hf-row"), b = el("button", "dc-modal-cancel", "See it on a phone"); b.type = "button"; b.id = "pbSee";
    b.addEventListener("click", () => { ph.click(); b.parentNode.remove(); });
    r.appendChild(b); host.appendChild(r);
  }
}
// The header or footer whose card is open stays outlined on the canvas, its name showing.
function dcHFMark(which) {
  try {
    const doc = $("designPreview").contentDocument;
    doc.querySelectorAll("header.site,footer.site,.dds-phonebar").forEach((n) => n.classList.toggle("dc-hf-on", !!which && n.matches(which === "header" ? "header.site" : "footer.site,.dds-phonebar")));
  } catch (_) {}
}
const PANEL_TITLES = { styles: "Styles", sections: "All sections", forms: "Forms", header: "Header", footer: "Footer" };
const PANEL_SUBS = { styles: "Changes show as you pick", sections: "Ready-made layouts and saved sections", forms: "Forms on this page", header: "On every page", footer: "On every page" };
function openSettingsPanel(mode, title) {
  const p = $("settingsPanel"), sc = $("dcScrim"); if (!p) return;
  const m = PANEL_TITLES[mode] || mode === "section" || mode === "core" ? mode : "styles";
  if (PANEL_MODE === "section" && m !== "section") BLOCK_SOLO = null;
  if (m !== "core" && typeof dcUnhostView === "function") dcUnhostView();   // item 314: the tab's form goes back to its tab
  closeTrayPanel(); closeCommentsPanel(); closePagesCard(false);
  PANEL_LASTFOCUS = document.activeElement;
  PANEL_MODE = m; p.dataset.mode = m;
  const name = title || PANEL_TITLES[m] || "Styles";
  const t = $("settingsTitle"); if (t) t.textContent = name;
  const sb = $("settingsSub"); if (sb) { sb.textContent = PANEL_SUBS[m] || ""; sb.hidden = !PANEL_SUBS[m]; }
  const iseg = $("inspectorSeg"); if (iseg) iseg.hidden = m !== "section";
  const sseg = $("stylesSeg"); if (sseg) sseg.hidden = m !== "styles";
  const sfoot = $("stylesFoot"); if (sfoot) sfoot.hidden = m !== "styles";
  if (m === "section") { insSyncSeg(); const sc = p.querySelector(".dc-panel-scroll"); if (sc) sc.scrollTop = 0; }
  if (m === "styles") stylesTab(STYLES_TAB);
  p.setAttribute("aria-label", name);
  const modal = ["section", "styles", "header", "footer", "core"].indexOf(m) < 0;   // a section, a style, the header or footer: keep the page in view, undimmed
  p.setAttribute("aria-modal", String(modal));
  const cl = $("btnSettingsClose");
  if (cl) { if (modal) cl.innerHTML = uiIcon("x", 16); else cl.textContent = "Done"; cl.setAttribute("aria-label", modal ? "Close" : "Done"); cl.title = (modal ? "Close" : "Done") + " (Esc)"; }
  if (sc) {
    if (modal) { sc.hidden = false; requestAnimationFrame(() => sc.classList.add("on")); }
    else { sc.classList.remove("on"); sc.hidden = true; }
  }
  p.classList.add("on"); p.setAttribute("aria-hidden", "false");
  if (m === "sections" && $("blocksCard")) renderBlocksCard();
  if (m === "header" || m === "footer") renderHFCard(m);
  dcHFMark(m === "header" || m === "footer" ? m : null);
  dcColourAids();
  setTimeout(() => { try {
    // already in a field in this panel: leave them there, or the words go nowhere
    const ae = document.activeElement;
    if (ae && ae !== p && ae !== document.body && p.contains(ae)) return;
    // nothing scrolls to make room for the focus: the card has just been put at its top
    (m === "section" && INS_TAB === "content" && p.querySelector("#blocksCard input, #blocksCard textarea")
      || m === "section" && p.querySelector('#inspectorSeg [aria-selected="true"]') || cl).focus({ preventScroll: true });
  } catch (_) {} }, 40);
}
// ── Styles (the floating studio, part two): Looks, Fonts, Colours, Buttons (item 217) and Text.
// Each card and row in the panel is tagged with the tab it belongs to (data-stab); the rest hide.
let STYLES_TAB = "looks";
function stylesTab(name) {
  STYLES_TAB = ["looks", "fonts", "colours", "buttons", "text"].indexOf(name) >= 0 ? name : "looks";
  const p = $("settingsPanel"); if (p) p.dataset.stab = STYLES_TAB;
  const seg = $("stylesSeg"); if (seg) seg.querySelectorAll("[data-stab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.stab === STYLES_TAB)));
  const sc = p && p.querySelector(".dc-panel-scroll"); if (sc) sc.scrollTop = 0;
  if (STYLES_TAB === "buttons") buttonSetPaint();   // item 217: in the colours the canvas has drawn by now
  dcColourAids();
}
function insSyncSeg() {
  const seg = $("inspectorSeg"); if (!seg) return;
  seg.querySelectorAll("[data-itab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.itab === INS_TAB)));
}
function insTab(name) {
  INS_TAB = ["content", "style", "layout", "when"].indexOf(name) >= 0 ? name : "content";
  insSyncSeg();
  setTimeout(dcColourAids, 0);   // the tab's panes swap first
  document.querySelectorAll("#blocksCard .ins-pane").forEach((p) => { p.hidden = p.dataset.pane !== INS_TAB; });
  if (INS_TAB === "layout") insLiveWake();   // item 224: the arrangements' pictures are asked for when Layout shows
}
function insPanes(box) {
  const panes = {};
  ["content", "style", "layout", "when"].forEach((k) => { const p = el("div", "ins-pane"); p.dataset.pane = k; p.hidden = k !== INS_TAB; box.appendChild(p); panes[k] = p; });
  return panes;
}
// the card's title is the section's own heading; the line under it says what kind, and where
function insHead(blk, def) {
  const t = $("settingsTitle"), sb = $("settingsSub"), p = $("settingsPanel");
  const kind = (def && def.name) || "Section";
  const head = blk && blk.type === "stack" ? (blk.items || []).find((it) => it && it.kind === "heading" && it.text) : blk;   // a Blocks section goes by its first heading
  const name = String((head && (head.title || head.text)) || "").trim() || kind;
  if (t) t.textContent = name;
  if (sb) { sb.textContent = kind + " · on " + (typeof dcPageTitle === "function" ? dcPageTitle(DC_PAGE) : "Home"); sb.hidden = false; }
  if (p) p.setAttribute("aria-label", name);
}
// picture tiles: a small sketch per choice, the chosen one outlined in plum
function insTiles(host, label, opts, isOn, onPick, picFor) {
  const wrap = el("div", "ins-field");
  wrap.appendChild(el("div", "ins-lbl", label));
  const row = el("div", "ins-tiles");
  opts.forEach((o, i) => {
    const on = isOn(o);
    const b = el("button", "ins-tile" + (on ? " on" : "")); b.type = "button"; b.setAttribute("aria-pressed", String(on));
    const pic = el("div", "ins-tile-pic");
    const drawn = picFor ? insPic(picFor(o)) : null;
    if (drawn) pic.appendChild(drawn);
    else if (i % 3 === 1) { const r = el("div", "ins-tile-row"); r.append(el("i"), el("i")); pic.appendChild(r); const l = el("i"); l.style.width = "70%"; pic.appendChild(l); }
    else if (i % 3 === 2) { const r = el("div", "ins-tile-row"); r.append(el("i"), el("i"), el("i")); pic.appendChild(r); }
    else { const h = el("i", "h"); h.style.width = "60%"; const a = el("i"); a.style.width = "85%"; const c = el("i"); c.style.width = "85%"; pic.append(h, a, c); }
    b.appendChild(pic);
    b.appendChild(el("span", "ins-tile-l", o.name || o[0]));
    b.addEventListener("click", () => onPick(o));
    row.appendChild(b);
  });
  wrap.appendChild(row); host.appendChild(wrap);
  return row;
}
// ── Items 49 and 118: a section's colour theme, drawn in the site's own colours ──
// The five bands the server draws (lib/site_blocks.ts .block--bg-*) are the section's colour
// themes. Each tile is a little section in that theme, in this site's colours as the canvas
// has them, so picking one is picking what you see. A custom background colour (the Colours
// group below) and a theme are one background at a time, as lookSet already keeps them.
const INS_THEMES = [
  ["", "Default", "Follows your template: sections take turns with a soft band."],
  ["tinted", "Tinted", "A soft wash of your accent colour behind the section."],
  ["plain", "Plain", "No band: the section sits on the page’s own background."],
  ["accent", "Accent", "Your accent colour behind light words, with white buttons."],
  ["dark", "Dark", "Light words on a deep background, buttons in your accent colour."],
];
// The site's colours as the canvas draws them (every template names them alike), or quiet
// stand-ins before the canvas has drawn.
function dcSiteColours() {
  const out = { paper: "#f7f7f5", card: "#ffffff", ink: "#1c2430", soft: "#5b6572", accent: "#23635a", accentDark: "", band: "", wash: "#eef1ee" };
  try {
    const d = $("designPreview") && $("designPreview").contentDocument;
    const cs = d && d.documentElement && d.defaultView.getComputedStyle(d.documentElement);
    if (cs) [["paper", "--paper"], ["card", "--card"], ["ink", "--ink"], ["soft", "--soft"], ["accent", "--accent"], ["accentDark", "--accent-dark"], ["band", "--accent-band"], ["wash", "--wash"]].forEach(([k, v]) => {
      const x = cs.getPropertyValue(v).trim(); if (x && !/^var\(/.test(x)) out[k] = x;
    });
  } catch (_) {}
  if (!out.accentDark) out.accentDark = out.accent;
  if (!out.band) out.band = out.accentDark;   // behind an accent section; Slate names a deeper one (.block--bg-accent)
  return out;
}
// what a theme looks like: its background, words and button
function insThemeLook(v, c) {
  if (v === "tinted") return { bg: "color-mix(in srgb," + c.accent + " 8%," + c.paper + ")", ink: c.ink, btn: c.accent };
  if (v === "plain") return { bg: c.paper, ink: c.ink, btn: c.accent };
  if (v === "accent") return { bg: c.band, ink: "#ffffff", btn: "#ffffff" };
  if (v === "dark") return { bg: "#1a1622", ink: "#f2eef8", btn: c.band };   // its buttons are filled with the band colour (BLOCK_CSS)
  return { bg: "linear-gradient(180deg," + c.card + " 0 55%," + c.wash + " 55%)", ink: c.ink, btn: c.accent };
}
// ── Item 304: a small set of line icons for "Why choose us", in the site's accent colour ──
// The same drawings the live site uses (lib/site_blocks.ts LINE_ICONS). A press puts "icon:<name>"
// as the third part of the line the cursor is on in the list above, so the item takes it.
const LINE_ICONS = {
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  heart: '<path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.4-7 10-7 10z"/>',
  leaf: '<path d="M4 20c0-9 5-14 16-16-1 11-6 16-15 16"/><path d="M4 20l8-8"/>',
  bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0 5 5L22 8.5 15.5 2 12.7 4.3a4 4 0 0 0 2 2z"/><path d="M3 21l9.5-9.5"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
  "map-pin": '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  award: '<circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 22l5-3 5 3-1.5-8"/>',
  smile: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><path d="M9 9h.01M15 9h.01"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  truck: '<path d="M1 7h13v9H1z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="5" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 6.5c0-1.9-2.2-3-5-3s-5 1.1-5 3 2.2 2.5 5 3 5 1.6 5 3.5-2.2 3.5-5 3.5-5-1.6-5-3.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20c0-3.5 3-6 7-6s7 2.5 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M22 19c0-2.6-1.8-4.5-4.5-4.8"/>',
  chat: '<path d="M21 12a8 8 0 0 1-8 8H6l-3 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2.5 2.5"/>',
  gift: '<rect x="3" y="9" width="18" height="12" rx="2"/><path d="M12 9v12M3 14h18"/><path d="M12 9c-2-4-7-4-7-1s5 1 7 1zm0 0c2-4 7-4 7-1s-5 1-7 1z"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};
const ICON_WORDS = { star: "Star", check: "Tick", shield: "Shield", clock: "Clock", heart: "Heart", leaf: "Leaf", bolt: "Bolt", tool: "Tool", phone: "Phone", home: "Home", "map-pin": "Map pin", award: "Award", smile: "Smile", sun: "Sun", truck: "Truck", dollar: "Dollar", users: "People", chat: "Chat", calendar: "Calendar", sparkle: "Sparkle", key: "Key", gift: "Gift", eye: "Eye", lock: "Lock" };
function iconGrid(ta) {
  const wrap = el("div", "ins-field");
  wrap.appendChild(el("div", "ins-lbl", "Line icons, in your accent colour"));
  const grid = el("div", "ins-icons"); grid.setAttribute("role", "group"); grid.setAttribute("aria-label", "Line icons");
  const accent = dcSiteColours().accent;
  Object.keys(LINE_ICONS).forEach((name) => {
    const b = el("button", "ins-icon"); b.type = "button"; b.title = ICON_WORDS[name] || name; b.setAttribute("aria-label", ICON_WORDS[name] || name); b.style.color = accent;
    b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + LINE_ICONS[name] + "</svg>";
    b.addEventListener("click", () => {
      // the line the cursor is on (the first line before anything is typed): its third part becomes the icon
      const lines = ta.value.split("\n"); const at = ta.value.slice(0, ta.selectionStart || 0).split("\n").length - 1;
      const i = Math.min(at, Math.max(0, lines.length - 1));
      const parts = (lines[i] || "").split("|").map((x) => x.trim());
      while (parts.length < 2) parts.push("");
      parts[2] = "icon:" + name;
      lines[i] = parts.join(" | ");
      ta.value = lines.join("\n"); ta.dispatchEvent(new Event("change", { bubbles: true }));
      const pos = lines.slice(0, i + 1).join("\n").length; try { ta.focus(); ta.setSelectionRange(pos, pos); } catch (_) {}
    });
    grid.appendChild(b);
  });
  wrap.appendChild(grid);
  wrap.appendChild(el("p", "ins-says", "Press one to put it on the line your cursor is on. Typed emoji still work, but these look the same on every phone and computer."));
  return wrap;
}
// item 292: the sections that can carry a photo behind them (lib/site_blocks.ts PHOTO_BG_TYPES)
const PHOTO_BG_TYPES = new Set(["cta", "spotlight", "title"]);
function insThemes(host, idx, look, style) {
  const own = !!(style && style.bg_color);
  const cur = own ? null : String((look && look.background) || "");
  const c = dcSiteColours();
  const wrap = el("div", "ins-field"); wrap.dataset.group = "theme";
  wrap.appendChild(el("div", "ins-lbl", "Colour theme"));
  const row = el("div", "ins-themes"); row.setAttribute("role", "group"); row.setAttribute("aria-label", "Colour theme");
  const blkType = BLOCKS_WORK[idx] && BLOCKS_WORK[idx].type;
  const themes = PHOTO_BG_TYPES.has(blkType) ? [...INS_THEMES, ["photo", "Photo", "Your own photo behind the section, under a veil so the words read."]] : INS_THEMES;
  if (themes.length > 5) row.style.setProperty("--n", "6");
  themes.forEach(([v, name]) => {
    const b = el("button", "ins-theme"); b.type = "button"; b.dataset.theme = v || "default";
    b.setAttribute("aria-pressed", String(cur === v));
    const look2 = insThemeLook(v, c), pic = el("span", "ins-theme-pic");
    pic.style.background = look2.bg;
    const h = el("i"), l = el("i"), k = el("b"); h.style.background = look2.ink; l.style.background = look2.ink; k.style.background = look2.btn;
    pic.append(h, l, k);
    b.append(pic, document.createTextNode(name));
    if (v === "photo") { pic.classList.add("photo"); const m = look && look.photo_id && (S.media || []).find((x) => x.id === look.photo_id); if (m && m.thumb) pic.style.backgroundImage = "url(" + JSON.stringify(m.thumb) + ")"; }
    b.addEventListener("click", () => {
      if (v !== "photo") { lookSet(idx, "background", v); return; }
      // the photo tile asks for the photo first; a section that already has one keeps it
      const b0 = BLOCKS_WORK[idx] || {}, l0 = b0.look || {};
      if (l0.photo_id) { lookSetMany(idx, { background: "photo", veil: l0.veil || "dark" }); return; }
      openPicker((id) => { if (id) lookSetMany(idx, { background: "photo", photo_id: id, veil: "dark" }); });
    });
    row.appendChild(b);
  });
  wrap.appendChild(row);
  wrap.appendChild(el("p", "ins-says", own ? "A background colour of your own is set under Colours. Pick a theme to use it instead." : (themes.find((t) => t[0] === cur) || INS_THEMES[0])[2]));
  if (cur === "photo") {   // the photo's own row: change it, and the veil over it
    const pr = el("div", "hf-row");
    const ch = el("button", "dc-modal-cancel", "Change the photo"); ch.type = "button";
    ch.addEventListener("click", () => openPicker((id) => { if (id) lookSetMany(idx, { photo_id: id }); }));
    pr.appendChild(ch); wrap.appendChild(pr);
    pillRow(wrap, "Veil over the photo", [["Dark, light words", "dark"], ["Light, dark words", "light"]], (o) => String((look && look.veil) || "dark") === o[1], (o) => lookSetMany(idx, { veil: o[1] }));
  }
  host.appendChild(wrap);
  return wrap;
}
// item 292: several look keys at once (the photo, its veil and the theme land together)
function lookSetMany(idx, changes) {
  const b = { ...BLOCKS_WORK[idx] }; const look = { ...(b.look || {}) };
  Object.keys(changes).forEach((k) => { if (changes[k]) look[k] = changes[k]; else delete look[k]; });
  if (look.background !== "photo") { delete look.photo_id; delete look.veil; }
  if (Object.keys(look).length) b.look = look; else delete b.look;
  if (changes.background && b.style && b.style.bg_color) { const s = { ...b.style }; delete s.bg_color; delete s.contrast_ack; if (Object.keys(s).length) b.style = s; else delete b.style; }
  BLOCKS_WORK[idx] = b;
  renderBlocksCard();
  dcLiveFromPanel();
}
// The Layout tab's pictures: each layout drawn as itself (styles: .ins-pic[data-pic]).
const INS_PIC_PARTS = {
  "gallery:default": 6, "gallery:masonry": 6, "gallery:filmstrip": 4,
  "reviews_wall:default": 3, "reviews_wall:quotes": 3, "reviews_wall:strip": 3,
  "accordion:default": 3, "accordion:two-column": 10,
  "cta:default": ["", "k"], "cta:card": ["", "", "k"],
  "pricing:default": 3, "pricing:list": 3,
  "image_text:left": ["p", "h", "", ""], "image_text:right": ["p", "h", "", ""],
  // item 329: the bold designs
  "image_text:overlap": ["p", "k", "h", ""], "image_text:frame": ["b", "p", "h", "", ""],
  "features:default": 3, "features:numbered": ["h", "h", "h", "", "", ""], "features:tiles": 4,
  "pricing:menu": 6, "pricing:plans": ["", "k", ""],
  "accordion:side": ["h", "", "", "", ""], "accordion:numbered": ["k", "", "k", "", "k", "", "k", ""],
  "width:normal": 1, "width:full": 1,
};
function insPic(key) {
  const parts = INS_PIC_PARTS[key]; if (!parts) return null;
  const pic = el("span", "ins-pic"); pic.dataset.pic = key; pic.setAttribute("aria-hidden", "true");
  (Array.isArray(parts) ? parts : Array.from({ length: parts }, () => "")).forEach((cls) => pic.appendChild(el("i", cls || null)));
  return pic;
}
// ── Item 224: the Layout tab draws this section's own words and photos in each arrangement ──
// A section that can be arranged more than one way (BLOCK_VARIANT_OPTS, and a photo beside words
// on either side) shows each way as a small picture of itself: the server draws the section that
// way (POST /preview/section, as the canvas's live redraw does), the drawing goes in a little frame
// with the canvas's own styles, and the frame is shrunk to the tile. The tile is the button; the
// frame never takes a click, the focus or a script. Until a picture comes, and when it can't
// (offline, a server from before the route), the tile keeps its sketch. Pictures are kept by what
// they show, so the card's next redraw or a tab switch finds them at once.
const IMAGE_TEXT_SIDES = [["Photo on the left", "left"], ["Photo on the right", "right"]];
// item 329: and the two bold designs, which keep the side picked (Photo side, under them)
const IMAGE_TEXT_WAYS = IMAGE_TEXT_SIDES.concat([["Photo off the edge", "overlap"], ["Photo in a colour frame", "frame"]]);
const LIVE_PIC_W = 800;              // each arrangement is drawn this wide, then shrunk to its tile
const LIVE_PIC_AGE = 10 * 60e3;      // a drawing's photos have signed addresses: draw it again after a while
const LIVE_PICS = new Map();         // what a picture shows → { html, at }, or the promise of one on its way
let LIVE_PIC_RUNNING = 0;
const LIVE_PIC_QUEUE = [];           // a few asks at a time; the rest wait their turn
const LIVE_PIC_RO = typeof ResizeObserver === "function" ? new ResizeObserver((es) => es.forEach((e) => livePicFit(e.target))) : null;
const LIVE_PIC_WHAT = { reviews_wall: "reviews", gallery: "photos", pricing: "prices", accordion: "questions", cta: "words", image_text: "photo and words", features: "highlights" };
// the same JSON whatever order a block's keys were written in, so one picture has one name
const stableJson = (v) => JSON.stringify(v, (k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, kk) => { o[kk] = x[kk]; return o; }, {}) : x));
// the ways one section can be arranged: the choices, which one it has, and the section each way
function insArrangements(blk) {
  if (blk && blk.type === "image_text") {
    const isSide = (o) => o[1] === "left" || o[1] === "right";
    const design = blk.variant === "overlap" || blk.variant === "frame" ? blk.variant : "";
    return {
      opts: IMAGE_TEXT_WAYS,
      isOn: (o) => (isSide(o) ? !design && (blk.side === "right" ? "right" : "left") === o[1] : design === o[1]),
      with: (o) => { const b = { ...blk }; if (isSide(o)) { b.side = o[1]; delete b.variant; } else b.variant = o[1]; return b; },
      pic: (o) => "image_text:" + o[1],
    };
  }
  const opts = blk && BLOCK_VARIANT_OPTS[blk.type]; if (!opts) return null;
  return { opts, isOn: (o) => String(blk.variant || "") === o[1], with: (o) => { const b = { ...blk }; if (o[1]) b.variant = o[1]; else delete b.variant; return b; }, pic: (o) => blk.type + ":" + (o[1] || "default") };
}
function livePicAsk(job) {
  return new Promise((resolve, reject) => {
    const go = () => { LIVE_PIC_RUNNING++; job().then(resolve, reject).finally(() => { LIVE_PIC_RUNNING--; const next = LIVE_PIC_QUEUE.shift(); if (next) next(); }); };
    if (LIVE_PIC_RUNNING < 3) go(); else LIVE_PIC_QUEUE.push(go);
  });
}
// one arrangement of one section, drawn by the server from the page's list as it stands
function livePicDraw(idx, b, key) {
  const had = LIVE_PICS.get(key);
  if (had && (had.then || Date.now() - had.at < LIVE_PIC_AGE)) return had.then ? had : Promise.resolve(had);
  const list = JSON.parse(JSON.stringify(BLOCKS_WORK)); list[idx] = b;
  const p = livePicAsk(() => api("POST", "/preview/section", { blocks: list, index: idx })).then((r) => {
    const html = r && r.data && r.data.html;
    if (typeof html !== "string" || !html.trim()) throw new Error("no drawing");   // a server from before the route, or a section that draws nothing
    const got = { html, at: Date.now() };
    LIVE_PICS.set(key, got);
    return got;
  });
  p.catch(() => { if (LIVE_PICS.get(key) === p) LIVE_PICS.delete(key); });   // the next card asks again
  LIVE_PICS.set(key, p);
  if (LIVE_PICS.size > 60) LIVE_PICS.delete(LIVE_PICS.keys().next().value);   // the oldest go first
  return p;
}
// a small page holding just the section, with the canvas's own styles (never the editor's tools)
function livePicDoc(doc, html) {
  const keep = (n, names) => names.filter((a) => n && n.hasAttribute(a)).map((a) => " " + a + '="' + esc(n.getAttribute(a)) + '"').join("");
  const styles = [...doc.querySelectorAll('head style, head link[rel~="stylesheet"]')].filter((n) => !/^dds-dc-/.test(n.id || "")).map((n) => n.outerHTML).join("");
  return "<!doctype html><html" + keep(doc.documentElement, ["lang", "class"]) + '><head><meta charset="utf-8">' + styles
    + "<style>html,body{overflow:hidden!important}body{margin:0!important;padding-top:0!important;padding-bottom:0!important;min-height:0!important}</style></head><body"
    + keep(doc.body, ["class"]) + '><main id="main"' + keep(doc.getElementById("main"), ["class"]) + ">" + html + "</main></body></html>";
}
function livePicPaint(win, html) {
  const doc = dcFrameDoc(); if (!doc || !doc.head || !win.isConnected) return;   // no canvas to take the styles from: the sketch stays
  const old = win.querySelector("iframe"); if (old) old.remove();
  const fr = document.createElement("iframe");
  fr.setAttribute("sandbox", "allow-same-origin");   // nothing in it runs; the tile only reads its height
  fr.setAttribute("aria-hidden", "true"); fr.setAttribute("tabindex", "-1"); fr.inert = true; fr.title = "A small picture of this arrangement";
  fr.addEventListener("load", () => {
    let h = 0;
    try { const m = fr.contentDocument && fr.contentDocument.getElementById("main"); h = m ? Math.ceil(m.getBoundingClientRect().height) : 0; } catch (_) { /* unreadable: keep the sketch */ }
    if (h < 8) return;
    win.dataset.fh = String(h); win.style.setProperty("--fh", h + "px");
    livePicFit(win); win.classList.add("on");
  }, { once: true });
  fr.srcdoc = livePicDoc(doc, html);
  win.appendChild(fr);
}
// the drawing shrunk to the tile's width, showing at most its first 150 pixels
function livePicFit(win) {
  if (!win.isConnected) { if (LIVE_PIC_RO) LIVE_PIC_RO.unobserve(win); return; }   // a card drawn again lets its old tiles go
  const w = win.clientWidth, h = Number(win.dataset.fh) || 0; if (!w || !h) return;
  const k = w / LIVE_PIC_W;
  win.style.setProperty("--k", String(Math.round(k * 1000) / 1000));
  win.style.setProperty("--h", Math.round(Math.max(64, Math.min(150, h * k))) + "px");
}
// ask for the pictures of the tiles under `scope` that haven't asked yet (only while Layout shows)
function insLiveStart(scope) {
  if (!scope) return;
  scope.querySelectorAll(".ins-live-win:not([data-asked])").forEach((win) => {
    const job = win._live; if (!job) return;
    win.dataset.asked = "1";
    if (LIVE_PIC_RO) LIVE_PIC_RO.observe(win);
    livePicDraw(job.idx, job.b, job.key).then((got) => { if (win.isConnected) livePicPaint(win, got.html); }).catch(() => { /* the sketch stays */ });
  });
}
function insLiveWake() { insLiveStart(document.querySelector('#blocksCard .ins-pane[data-pane="layout"]:not([hidden])')); }
function insLiveLayouts(host, idx, blk) {
  const arr = insArrangements(blk); if (!arr) return;
  const wrap = el("div", "ins-field"); wrap.dataset.group = "arrangement";
  wrap.appendChild(el("div", "ins-lbl", "Layout"));
  wrap.appendChild(el("p", "ins-says", "Your own " + (LIVE_PIC_WHAT[blk.type] || "words") + ", drawn each way this section can go. Tap one to use it; Undo brings the last one back."));
  const list = el("div", "ins-live"); wrap.appendChild(list);
  const pick = (o) => {
    const now = insArrangements(BLOCKS_WORK[idx]);   // from the section as it is now, with any edit made since this card was drawn
    if (!now || now.isOn(o)) return;
    BLOCKS_WORK[idx] = now.with(o);
    renderBlocksCard(); dcLiveFromPanel();
  };
  arr.opts.forEach((o) => {
    const on = arr.isOn(o);
    const item = el("div", "ins-live-item");
    const win = el("div", "ins-live-win"), sketch = el("div", "ins-tile-pic"), pic = insPic(arr.pic(o));
    win.setAttribute("aria-hidden", "true");
    if (pic) sketch.appendChild(pic);
    win.appendChild(sketch);
    const shown = arr.with(o);
    win._live = { idx, b: shown, key: DC_PAGE + "|" + idx + "|" + stableJson(shown) };
    const b = el("button", "ins-live-tile"); b.type = "button"; b.setAttribute("aria-pressed", String(on));
    const nm = el("span", "ins-live-name"); nm.appendChild(el("span", null, o[0]));
    if (on) { const chip = el("span", "ins-live-chip", "In use"); chip.setAttribute("aria-hidden", "true"); nm.appendChild(chip); }   // pressed already says it
    b.appendChild(nm);
    b.addEventListener("click", () => pick(o));
    item.append(win, b);
    list.appendChild(item);
  });
  designExtras(wrap, idx, blk, true);   // item 329
  host.insertBefore(wrap, host.firstChild);   // the arrangement leads the tab, as drawn
  if (INS_TAB === "layout") insLiveStart(list);
}
// ── Item 118: the canvas names each section's colour theme while colours are being chosen ──
// While Styles is on Colours, or one section's card is on Style, every section on the page
// wears a small tag ("Aa · Dark"), and Styles lists the themes in use. Built-in sections keep
// the template's own colours. The tags sit in the page's frame, over the sections, and never
// take a click.
function dcThemeTagsWanted() {
  const p = $("settingsPanel");
  if (!p || !p.classList.contains("on")) return false;
  return (PANEL_MODE === "styles" && STYLES_TAB === "colours") || (PANEL_MODE === "section" && INS_TAB === "style");
}
function dcThemeOf(sec) {
  if (sec.hasAttribute("data-dds-core")) return "Template";
  const b = BLOCKS_WORK && BLOCKS_WORK[Number(sec.getAttribute("data-dds-src"))];
  if (b && b.style && b.style.bg_color) return "Own colour";
  const v = String((b && b.look && b.look.background) || "");
  const t = INS_THEMES.find((x) => x[0] === v);
  return t ? t[1] : "Default";
}
function dcThemeTags() {
  let doc = null; try { doc = $("designPreview").contentDocument; } catch (_) {}
  const old = doc && doc.getElementById("dds-dc-themes"); if (old) old.remove();
  const now = $("stThemesNow");
  if (!doc || !doc.body || !dcThemeTagsWanted()) return;
  const win = doc.defaultView, layer = doc.createElement("div");
  layer.id = "dds-dc-themes"; layer.setAttribute("aria-hidden", "true");
  const counts = new Map();
  doc.querySelectorAll("main [data-dds-core], main [data-dds-src]").forEach((sec) => {
    if (sec.parentElement && sec.parentElement.closest("[data-dds-src],[data-dds-core]")) return;   // a section inside a section is part of it
    const r = sec.getBoundingClientRect(); if (!r.height) return;
    const name = dcThemeOf(sec); counts.set(name, (counts.get(name) || 0) + 1);
    const tag = doc.createElement("span"); tag.className = "dds-theme-tag";
    const dot = doc.createElement("i"); dot.style.background = win.getComputedStyle(sec).backgroundColor;
    tag.append(dot, doc.createTextNode("Aa · " + name));
    tag.style.left = Math.round(Math.max(r.left, (DC_CHROME_INSET || 0) - win.scrollX) + win.scrollX + 12) + "px";   // clear of the dock
    tag.style.top = Math.round(r.top + win.scrollY + (sec.classList.contains("dc-hot") ? 44 : 12)) + "px";   // clear of the picked section's name chip
    layer.appendChild(tag);
  });
  doc.body.appendChild(layer);
  if (now) { const p = now.querySelector(".ins-says"); if (p) p.textContent = counts.size ? [...counts].map(([n, k]) => k + " " + n).join(" · ") : "Nothing on this page has a colour theme yet."; }
}
// ── Item 118: picking a ready-made look shows the whole page at half size (desktop) ──
function dcZoomSync() {
  const p = $("settingsPanel"), stage = $("dpStage");
  const on = !!(p && p.classList.contains("on") && PANEL_MODE === "styles" && STYLES_TAB === "looks" && window.innerWidth > 1180
    && stage && !stage.classList.contains("dev-tablet") && !stage.classList.contains("dev-phone")) && document.documentElement.classList.contains("dc-edit");
  document.documentElement.classList.toggle("dc-zoomout", on);
  if (!on) return;
  // the page keeps its own width, at half size, in the room between the dock and the Styles card
  const fr = $("designPreview").closest(".dp-frame"), dk = $("dcDock"); if (!fr) return;
  const b = fr.getBoundingClientRect(), c = p.getBoundingClientRect(), d = dk ? dk.getBoundingClientRect() : null;
  const left = d && d.width ? Math.max(0, d.right - b.left + 16) : 0, right = Math.min(b.width, c.left - b.left - 16), w = b.width / 2;
  fr.style.setProperty("--dc-zoom-x", Math.round(Math.max(0, left + Math.max(0, (right - left - w) / 2))) + "px");
}
function dcColourAids() { dcThemeTags(); dcZoomSync(); }
// round swatches; "" is the slashed circle for the default
function insSwatches(host, label, opts, cur, onPick) {
  const wrap = el("div", "ins-field");
  wrap.appendChild(el("div", "ins-lbl", label));
  const row = el("div", "ins-swatches");
  opts.forEach(([val, name]) => {
    const on = cur === val;
    const b = el("button", "ins-sw" + (on ? " on" : "") + (val ? "" : " none")); b.type = "button";
    if (val && /^#/.test(val)) b.style.background = val;
    b.title = name; b.setAttribute("aria-label", label + ": " + name + (on ? " (chosen)" : "")); b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => onPick(val));
    row.appendChild(b);
  });
  wrap.appendChild(row); host.appendChild(wrap);
  return row;
}
// one writer for the section's look (background band, width, spacing, alignment, which screens)
function lookSet(idx, key, value) {
  const b = { ...BLOCKS_WORK[idx] }; const look = { ...(b.look || {}) };
  if (value) look[key] = value; else delete look[key];
  if (key === "background" && value !== "photo") { delete look.photo_id; delete look.veil; }   // item 292
  if (Object.keys(look).length) b.look = look; else delete b.look;
  // one background owner at a time (G27): a band here clears a custom background colour
  if (key === "background" && value && b.style && b.style.bg_color) { const s = { ...b.style }; delete s.bg_color; delete s.contrast_ack; if (Object.keys(s).length) b.style = s; else delete b.style; }
  BLOCKS_WORK[idx] = b;
  renderBlocksCard();   // saves soon, as every change to the list does
  dcLiveFromPanel();
}
// ── Item 225: a link name per section, and a shaped bottom edge ──
// A section's link name is its id on the page, so a menu item or a button can jump straight to it
// ("/#hours", "/menu/#specials"). anchorTidy is lib/section_links.ts anchorOf, the same rule;
// tests/presence/section_links_225_test.mjs runs both on the same words. The bottom edge
// (look.edge) hangs the section's own colour over the top of the next one in a shape
// (lib/site_blocks.ts EDGE_CSS; EDGE_PATHS are the same shapes, pinned by the same test).
const ANCHOR_RESERVED = ["main", "top", "content", "open-now", "hours-data", "signatures", "dlpdf"];
function anchorTidy(raw) {
  const s = String(raw == null ? "" : raw).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/^#+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 40).replace(/-+$/, "");
  if (!s || ANCHOR_RESERVED.includes(s) || /^(?:f|form|lb|nl|ps|pfb|ns|dds|presence|search|tab|tabs|consent)-/.test(s)) return null;
  return s;
}
const EDGE_OPTS = [["Straight", ""], ["Wave", "wave"], ["Slant", "slant"], ["Curve", "curve"], ["Peak", "peak"], ["Zigzag", "zigzag"]];
const jumpHref = (slug, anchor) => (slug ? "/" + slug + "/" : "/") + "#" + anchor;
// every page's sections, the page open now from its working copy, the rest as saved
function dcEveryPageList() {
  const out = [["", "Home", DC_PAGE ? (S.settings && S.settings.blocks) || [] : BLOCKS_WORK || []]];
  dcPagesArr().forEach((p) => out.push([p.slug, p.title || p.slug, p.slug === DC_PAGE ? BLOCKS_WORK || [] : p.blocks || []]));
  return out;
}
function dcNamedSections() {
  const out = [];
  dcEveryPageList().forEach(([slug, page, list]) => list.forEach((b, i) => {
    if (!b || !b.anchor) return;
    const def = BLOCK_DEFS.find((d) => d.type === b.type);
    out.push({ slug, page, idx: i, anchor: b.anchor, name: String(b.title || "").trim() || (def && def.name) || "A section" });
  }));
  return out;
}
// what jumps to a section now: menu items by name, buttons and links counted
function dcLinksTo(slug, anchor) {
  const href = jumpHref(slug, anchor), items = [];
  ((S.settings && Array.isArray(S.settings.nav)) ? S.settings.nav : []).forEach((it) => [it, ...(it.children || [])].forEach((x) => { if (x && x.href === href) items.push("the menu item “" + x.label + "”"); }));
  let buttons = 0;
  dcEveryPageList().forEach(([page, , list]) => JSON.stringify(list).replace(/"(?:url|link|href)":"([^"]*)"/g, (m, u) => { if (u === href || (page === slug && u === "#" + anchor)) buttons++; return m; }));
  if (buttons) items.push(buttons === 1 ? "1 button" : buttons + " buttons");
  return items;
}
function insLinkName(host, idx, blk) {
  const wrap = el("div", "ins-field ins-link"), id = "insAnchor-" + idx;
  const lbl = el("label", "ins-lbl", "Link name"); lbl.htmlFor = id;
  const row = el("div", "ins-anchor-row"), box = el("div", "ins-anchor");
  const inp = el("input"); inp.type = "text"; inp.id = id; inp.maxLength = 40; inp.value = blk.anchor || ""; inp.autocomplete = "off"; inp.spellcheck = false;
  inp.placeholder = anchorTidy(blk.title) || "hours";
  box.append(el("span", "ins-anchor-hash", "#"), inp);
  const copy = el("button", "dc-actbtn", "Copy link"); copy.type = "button";
  row.append(box, copy);
  const says = el("p", "ins-says", "A menu item or a button can jump straight here. Short words, small letters and dashes.");
  says.id = id + "-says"; inp.setAttribute("aria-describedby", says.id);
  const used = el("p", "ins-anchor-used");
  const paintUsed = (v) => { const by = v ? dcLinksTo(DC_PAGE || "", v) : []; used.hidden = !v; used.textContent = by.length ? "Linked from " + by.join(" and ") + "." : "Nothing jumps here yet. Pick it in a menu item’s or a button’s Goes to list."; };
  paintUsed(blk.anchor || "");
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });   // Enter keeps the name, as leaving the field does
  inp.addEventListener("change", () => {
    if (LIVE_PROBE) return;   // the card's typing probe: a name is tidied and saved when the field is left
    const typed = inp.value.trim(), v = typed ? anchorTidy(typed) : "";
    says.classList.remove("bad");
    if (v === null) { says.textContent = "Your site already uses “" + typed + "” for one of its own parts. Pick another name."; says.classList.add("bad"); return; }
    if (v && dcNamedSections().some((x) => x.slug === (DC_PAGE || "") && x.anchor === v && x.idx !== idx)) { says.textContent = "Another section on this page is already called #" + v + ". Pick another name."; says.classList.add("bad"); return; }
    says.textContent = "A menu item or a button can jump straight here. Short words, small letters and dashes.";
    const b = { ...BLOCKS_WORK[idx] }; if (v) b.anchor = v; else delete b.anchor;
    BLOCKS_WORK[idx] = b; inp.value = v; paintUsed(v);   // the card's own change listener saves it
  });
  copy.addEventListener("click", async () => {
    const v = anchorTidy(inp.value) || (BLOCKS_WORK[idx] && BLOCKS_WORK[idx].anchor);
    if (!v) { inp.focus(); toast("Give the section a link name first."); return; }
    const href = jumpHref(DC_PAGE || "", v);
    try { await navigator.clipboard.writeText(href); toast("Copied " + href + ". Paste it into any button or menu item."); } catch (_) { toast("The link is " + href); }
  });
  wrap.append(lbl, row, says, used); host.appendChild(wrap);
}
// The edge tiles draw this section's colour over the next one's, as the canvas has them.
function dcEdgeColours(idx) {
  let doc = null; try { doc = dcFrameDoc(); } catch (_) {}
  const win = doc && doc.defaultView, sec = doc && doc.querySelector('main [data-dds-src="' + idx + '"]');
  const bg = (n) => { const c = n && win ? win.getComputedStyle(n).backgroundColor : ""; return c && !/^rgba\(\d+, \d+, \d+, 0\)$|^transparent$/.test(c) ? c : ""; };
  const page = bg(doc && doc.body) || dcSiteColours().paper;
  let next = sec && sec.nextElementSibling;
  while (next && win && win.getComputedStyle(next).display === "none") next = next.nextElementSibling;
  const own = bg(sec);
  return { own: own || dcSiteColours().accent, next: bg(next) || page, plain: !own };
}
function insEdgeRow(host, idx, cur) {
  const col = dcEdgeColours(idx), on = String(cur.edge || "");
  const wrap = el("div", "ins-field ins-edges");
  wrap.append(el("div", "ins-lbl", "Bottom edge"), el("p", "ins-says", col.plain
    ? "This section has no colour of its own yet, so an edge won’t show. Pick a colour theme on the Style tab first."
    : "The shape where this section meets the next one, in this section’s colour."));
  const grid = el("div", "ins-tiles ins-edge-tiles"); grid.setAttribute("role", "group"); grid.setAttribute("aria-label", "Bottom edge");
  EDGE_OPTS.forEach(([name, k]) => {
    const b = el("button", "ins-tile" + (on === k ? " on" : "")); b.type = "button"; b.setAttribute("aria-pressed", String(on === k));
    const pic = el("div", "ins-tile-pic ins-edge-pic"); pic.setAttribute("aria-hidden", "true");
    pic.innerHTML = '<svg viewBox="0 0 100 40" preserveAspectRatio="none"><rect width="100" height="40" fill="' + col.next + '"/><rect width="100" height="20" fill="' + col.own + '"/>'
      + (k ? '<path transform="translate(0 19.5) scale(1 1.6)" d="' + EDGE_PATHS[k] + '" fill="' + col.own + '"/>' : "") + "</svg>";
    b.append(pic, el("span", "ins-tile-l", name));
    b.addEventListener("click", () => lookSet(idx, "edge", k));
    grid.appendChild(b);
  });
  wrap.appendChild(grid); host.appendChild(wrap);
}
// ── Item 225: Goes to, beside a menu item's or a button's link: the site's pages, the named parts
// of them, or somewhere else (typed in the box). Picking one writes the link into the box and
// tells the box it changed, so the field's own save runs.
function linkPick(input, opts = {}) {
  if (!input || !input.parentNode || input.dataset.lp) return;
  input.dataset.lp = "1";
  const row = el("div", "lp-row"); input.replaceWith(row);
  const btn = el("button", "lp-open", "Goes to"); btn.type = "button"; btn.setAttribute("aria-haspopup", "true"); btn.setAttribute("aria-expanded", "false");
  btn.insertAdjacentHTML("beforeend", uiIcon("chevron", 12));
  const says = el("p", "lp-says");
  row.append(input, btn);
  row.insertAdjacentElement("afterend", says);
  const name = (href) => {
    const pages = dcEveryPageList(), page = (slug) => (pages.find((p) => p[0] === slug) || [])[1];
    const m = /^(?:\/(?:([a-z0-9][a-z0-9-]*)\/)?)?#([a-z0-9-]+)$/.exec(href || "");
    if (m) { const slug = href.startsWith("/") ? (m[1] || "") : (DC_PAGE || ""); const sec = dcNamedSections().find((x) => x.slug === slug && x.anchor === m[2]);
      return page(slug) == null ? "" : "Jumps to " + (sec ? sec.name : "#" + m[2]) + " on " + (slug ? "the " + page(slug) + " page" : "Home") + (sec ? "" : ", which no section there is called yet"); }
    const p = /^\/(?:([a-z0-9][a-z0-9-]*)\/)?$/.exec(href || "");
    return p && page(p[1] || "") != null ? "Opens " + (p[1] ? "the " + page(p[1]) + " page" : "Home") : "";
  };
  const paint = () => { says.textContent = name(input.value.trim()); says.hidden = !says.textContent; };
  input.addEventListener("change", paint); paint();
  const set = (href) => { input.value = href; input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); };
  btn.addEventListener("click", () => {
    const old = document.querySelector(".lp-pop"); if (old) { old.remove(); if (old.dataset.for === input.id) return; }
    if (!input.id) input.id = "lp-" + Math.random().toString(36).slice(2, 8);
    const m = el("div", "pp-pop lp-pop"); m.dataset.for = input.id; m.setAttribute("role", "menu"); m.setAttribute("aria-label", "Where it goes");
    const close = () => { m.remove(); btn.setAttribute("aria-expanded", "false"); document.removeEventListener("mousedown", off, true); window.removeEventListener("keydown", esc, true); };
    const off = (e) => { if (!m.contains(e.target) && e.target !== btn) close(); };
    const esc = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); btn.focus(); } };
    const grp = (t) => m.appendChild(el("div", "lp-grp", t));
    const item = (label, tag, href, onPick) => {
      const b = el("button", "pp-pop-item lp-item" + (href && input.value.trim() === href ? " on" : "")); b.type = "button"; b.setAttribute("role", "menuitem");
      b.append(el("span", null, label)); if (tag) b.append(el("span", "lp-tag", tag));
      b.addEventListener("click", () => { close(); if (onPick) onPick(); else { set(href); btn.focus(); } });
      m.appendChild(b);
    };
    grp("Pages"); dcEveryPageList().forEach(([slug, title]) => item(title, "", slug ? "/" + slug + "/" : "/"));
    const named = dcNamedSections();
    grp("Parts of a page");
    if (named.length) named.forEach((x) => item(x.page + " › " + x.name, "#" + x.anchor, jumpHref(x.slug, x.anchor)));
    else m.appendChild(el("p", "lp-none", "None yet. Give a section a link name on its Layout tab."));
    if (!opts.pagesOnly) { grp("Somewhere else"); item("Another website, an email or a phone…", "", "", () => { input.focus(); input.select(); }); }
    (btn.closest(".dc-modal-scrim") || document.body).appendChild(m);   // inside a dialog's own layer, so it sits above the dialog
    const r = btn.getBoundingClientRect(), mh = m.offsetHeight, mw = m.offsetWidth;
    m.style.setProperty("top", Math.round(r.bottom + 4 + mh > window.innerHeight - 8 ? Math.max(8, r.top - 4 - mh) : r.bottom + 4) + "px");
    m.style.setProperty("left", Math.round(Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8))) + "px");
    btn.setAttribute("aria-expanded", "true");
    // Escape on the window, ahead of the panel's own (a document listener that closes the card)
    setTimeout(() => { document.addEventListener("mousedown", off, true); window.addEventListener("keydown", esc, true); }, 0);
    const first = m.querySelector(".lp-item.on") || m.querySelector(".lp-item"); if (first) first.focus();
  });
}
// the footer under every tab: who can see this section, and the quiet tools
// Item 155: a locked section's card says so at its top. The studio gets the switch for the
// client's words and Unlock; the client gets only the Content tab, its words open or shut, and
// nothing else to press. Run for every section's card, so an unlocked one gets its tabs back.
function insLockNote(box, panes, idx, blk) {
  const lock = blkLock(blk), mine = lockedForMe(blk), seg = $("inspectorSeg");
  if (seg) seg.querySelectorAll("[data-itab]").forEach((b) => { b.hidden = mine && b.dataset.itab !== "content"; });
  if (!lock) return;
  const note = el("div", "ins-lock" + (mine ? "" : " studio")); note.id = "insLock";
  note.insertAdjacentHTML("afterbegin", uiIcon("lock", 16));
  note.appendChild(el("p", null, mine
    ? LOCK_SAY + (lock.words ? " You can change its words; ask your studio for anything else." : " Ask your studio if it needs to change.")
    : "Locked for your client. They see a padlock and can’t move, restyle or delete it."));
  box.insertBefore(note, box.firstChild);
  if (!mine) {
    const row = el("label", "pg-sw ins-lock-sw"); const t = el("span", null, "Client can change its words"); const cb = el("input"); cb.type = "checkbox"; cb.checked = !!lock.words;
    cb.addEventListener("change", () => dcLockBlock(idx, true, cb.checked));
    row.append(t, cb); note.appendChild(row);
    const un = el("button", "dc-modal-cancel", "Unlock"); un.type = "button"; un.addEventListener("click", () => dcLockBlock(idx, false));
    note.appendChild(un);
    return;
  }
  if (INS_TAB !== "content") insTab("content");
  // what isn't words: picking photos, adding or removing items, choices and switches
  box.querySelectorAll("button, select, input[type=checkbox], input[type=radio], input[type=file], input[type=range], input[type=color], input[type=number], input[type=date]").forEach((n) => {
    if (n.closest(".ins-lock") || (lock.words && n.closest(".ai-wrap"))) return;   // Write with AI writes words
    n.disabled = true;
  });
  if (!lock.words) box.querySelectorAll("input, textarea").forEach((n) => { if (!n.closest(".ins-lock")) n.readOnly = true; });
}
function insFinish(panes, idx, blk, def) {
  const box = panes.content.parentNode;
  const notes = { style: "This section keeps your site’s style.", layout: "Nothing to lay out here.", when: "This section always shows." };
  Object.keys(notes).forEach((k) => { if (!panes[k].childNodes.length) panes[k].appendChild(el("div", "ins-note", notes[k])); });
  if (!(blk && blk._clEdit)) {
    const keep = el("div", "ins-row"); keep.appendChild(el("span", null, "Keep a copy to reuse on other pages"));
    const sv = el("button", "dc-actbtn", "Save for reuse"); sv.type = "button"; sv.title = "Save this section to your content library";
    sv.addEventListener("click", () => clSave(idx)); keep.appendChild(sv); panes.when.appendChild(keep);
  }
  const foot = el("div", "ins-foot");
  const key = typeof ddsKeyFor === "function" ? ddsKeyFor(idx) : null;
  const hidden = !!(key && sectionsHiddenNow().indexOf(key) >= 0);
  foot.appendChild(el("span", null, hidden ? "Hidden from visitors" : "Everyone can see this section"));
  if (key) {
    const b = el("button", "dc-actbtn dc-ghost", hidden ? "Show" : "Hide"); b.type = "button";
    b.title = hidden ? "Show this section to visitors again" : "Hide this section from visitors (it stays here, ready to show again)";
    b.addEventListener("click", () => {
      if (hidden) Promise.resolve(saveSections(() => (S.settings && S.settings.sections_order) || [], () => sectionsHiddenNow().filter((k) => k !== key))).then(() => { previewIfOpen(); renderBlocksCard(); });
      else { eeHideKey(key); closeSettingsPanel(); }
    });
    foot.appendChild(b);
  }
  box.appendChild(foot);
}
function dcSyncPageSwitch() {
  const list = typeof dcPageList === "function" ? dcPageList() : [];
  const cur = list.find((p) => p.slug === DC_PAGE) || list[0];
  const nm = $("dcPageName"); if (nm) nm.textContent = dcBuiltinPage() ? dcPageTitle(DC_PAGE) : cur ? cur.title : "Home";
  const ct = $("dcPageCount"); if (ct) dcPageStatus(ct);
}
// Item 125: the page being edited says where it stands, beside its name, in the Pages card's
// words: Live (nothing on it is waiting), 2 changes (waiting to go live), Not live yet (the
// site has never been published), or what its check found (Needs a look).
function dcPageStatus(chip) {
  const ctx = pgStatusCtx(), m = typeof pgModel === "function" ? pgModel() : { menu: [], unlinked: [] };
  const bk = dcBuiltinKey(DC_PAGE);
  const pg = [...m.menu.map((e) => e.pg), ...m.unlinked].find((p) => p && (bk ? p.key === bk : p.view === "design" && (p.slug || "") === DC_PAGE));
  let word = "Live", tone = "good", says = "Nothing on this page is waiting: your live site shows it as it is here";
  const tp = pg ? hbTreePage(pg) : null;
  const acc = (pg && pg.slug && (dcPageObj(pg.slug) || {}).access) || "";   // item 196: a private or password page isn't plainly "Live"
  if (tp && HB_TREE_FLAG[tp.status]) { word = shortStatus(tp.status_label); tone = HB_TREE_FLAG[tp.status]; says = treeHint(tp); }   // item 285: two words; item 327: what they mean in the title
  else if (acc === "private") { word = "Private"; tone = ""; says = "Kept in your draft: it isn’t on your live site or in its menu"; }
  else if (!ctx.siteLive || ctx.firstPublish) { word = "Not live yet"; tone = ""; says = "Your site goes live the first time you publish"; }
  else {
    const n = pg ? ctx.changes.filter((ch) => pcChangeOn(ch, pg)).length : 0;
    if (n) { word = n + (n === 1 ? " change" : " changes"); tone = "warn"; says = n + (n === 1 ? " change on this page is" : " changes on this page are") + " waiting to go live"; }
    else if (acc === "password") { word = "Password"; tone = ""; says = "On your live site: visitors type its password to open it"; }
  }
  chip.textContent = word; chip.className = "dc-chip" + (tone ? " " + tone : ""); chip.title = says;
}
// What a page's status is read from: is the site live, and what's waiting to publish.
function pgStatusCtx() {
  const live = !!(S.health && S.health.facts && S.health.facts.website.state !== "none");
  return { live, siteLive: live || !!(typeof siteLiveUrl === "function" && siteLiveUrl()), changes: (S.changes && S.changes.changes) || [], firstPublish: !!(S.changes && S.changes.first_publish) };
}
function dcSyncLiveChip() { const c = $("dcLiveChip"); if (c) c.hidden = !(S.live ? S.live.is_live : (typeof siteLiveUrl === "function" && siteLiveUrl())); }   // item 261: the server's rule
// a tablet's left card takes the dock's place while it's open (the CSS reads this class)
// (Add, Photos and Pages; the page outline is Notes mode's own list, so it keeps the dock and its way back to Edit)
function dcLeftSync() { const t = $("trayPanel"); document.documentElement.classList.toggle("dc-lefton", !!(PAGES_OPEN || (t && t.classList.contains("on") && DC_RAIL_TAB !== "contents"))); }
function openPagesCard(fromId) {
  const c = $("pagesCard"); if (!c) return;
  closeTrayPanel(); closeSettingsPanel(); closeCommentsPanel(); dcDockMore(false);
  if (PC_PANE) PC_PANE.close(false);
  PAGES_FROM = fromId || "dcPageSwitch"; PAGES_OPEN = true;
  renderPagesList();   // the rows and their chips as things stand now
  c.classList.add("on"); c.setAttribute("aria-hidden", "false");
  ["dcPageSwitch", "dkPages"].forEach((id) => { const b = $(id); if (b) b.setAttribute("aria-expanded", "true"); });
  dcLeftSync();
  hbLoadBoardExtras("pages");   // the website map's markers, read once
  const sc = $("pcBody"); if (sc) sc.scrollTop = 0;
  pagesBarReveal();
  try { (c.querySelector(".pc-row.on .pc-open") || c.querySelector(".pc-open") || $("btnPagesClose")).focus({ preventScroll: true }); } catch (_) {}
  // a press anywhere else puts it away; its menus and the dialogs they open don't count
  PAGES_DOWN = (e) => {
    if (c.contains(e.target)) return;
    if (e.target.closest && e.target.closest("#dcPageSwitch,#dkPages,.pp-pop,.pi-pop,.dc-modal-scrim,.dc-modal,.ask,.scrim,dialog,#pageSettings,#linkSettings,#folderSettings")) return;
    closePagesCard(false);
  };
  document.addEventListener("mousedown", PAGES_DOWN, true);
}
function closePagesCard(refocus) {
  const c = $("pagesCard"); if (!c || !PAGES_OPEN) return;
  if (PC_PANE) PC_PANE.close(false);
  PAGES_OPEN = false;
  const f = $("pcFind"); if (f && f.value) { f.value = ""; pcFilter(); }   // it opens next time on every page
  c.classList.remove("on"); c.setAttribute("aria-hidden", "true");
  ["dcPageSwitch", "dkPages"].forEach((id) => { const b = $(id); if (b) b.setAttribute("aria-expanded", "false"); });
  if (PAGES_DOWN) { document.removeEventListener("mousedown", PAGES_DOWN, true); PAGES_DOWN = null; }
  dcLeftSync();
  if (refocus) { const b = $(PAGES_FROM || "dcPageSwitch"); if (b) { try { b.focus(); } catch (_) {} } }
}
function togglePagesCard(fromId) { if (PAGES_OPEN) closePagesCard(true); else openPagesCard(fromId); }
const pcDone = (close) => { const f = el("div", "pg-foot"); const d = el("button", "dc-modal-cancel pg-done", "Done"); d.type = "button"; d.addEventListener("click", () => close()); f.appendChild(d); return f; };
// Item 158 (review file 03, finding 14): everything that sits on every page, in one place.
// Each line says whether it's on, and leads to where it's changed; the phone bar's three
// choices are right here. What each one is stays where it was built.
function pcEveryState() {
  const st = S.settings || {}, pop = st.popup && typeof st.popup === "object" ? st.popup : null;
  const until = st.announcement_expires_at ? new Date(st.announcement_expires_at) : null;
  const annOn = !!String(st.announcement_text || "").trim() && !(until && until < new Date());
  const pb = pbNow();
  const tags = !!(st.google_tag_id || st.meta_pixel_id);
  return { annOn, ann: String(st.announcement_text || "").trim(), popOn: !!(pop && pop.on === true && String(pop.heading || "").trim()), pb, tags };   // the pop-up shows only switched on and with a heading (lib/popup.ts)
}
function pcEverySub() {
  const x = pcEveryState(), on = [];
  if (x.annOn) on.push("announcement bar"); if (x.popOn) on.push("pop-up"); if (x.pb) on.push("phone bar"); if (x.tags) on.push("cookie notice");
  const t = $("pcEverySub"); if (t) t.textContent = on.length ? "On now: " + on.join(", ") : "Announcement bar, pop-up, phone bar: all off";
}
function pcEvery() {
  const { box, close } = pcPane("pcEveryPane", "On every page");
  const paint = () => {
    box.textContent = "";
    const x = pcEveryState();
    box.appendChild(el("h3", "dc-modal-h", "On every page"));
    box.appendChild(el("p", "dc-modal-sub", "What sits on top of every page of your website, in one place. Changes go live when you publish."));
    const line = (id, title, state, says, go, goLabel) => {
      const r = el("div", "pc-every"); r.id = id;
      const h = el("div", "pc-every-h"); h.append(el("b", null, title), el("span", "pc-every-st" + (state === "On" ? " on" : ""), state)); r.appendChild(h);
      if (says) r.appendChild(el("p", "pc-note", says));
      if (go) { const b = el("button", "dc-modal-cancel", goLabel || "Change it"); b.type = "button"; b.addEventListener("click", go); const a = el("div", "pc-acts"); a.appendChild(b); r.appendChild(a); }
      box.appendChild(r);
      return r;
    };
    const toUpdates = (cardId) => () => { pcLeaveTo("updates"); setTimeout(() => { const c = $(cardId); if (c) { c.scrollIntoView({ block: "start", behavior: "smooth" }); const f = c.querySelector("input,button,textarea,select"); if (f) try { f.focus({ preventScroll: true }); } catch (_) {} } }, 350); };
    line("pcEveryAnn", "Announcement bar", x.annOn ? "On" : "Off", x.annOn ? "“" + x.ann + "”" : "One short notice across the top of every page, like a holiday closure.", toUpdates("annCard"), x.annOn ? "Change it" : "Add one");
    line("pcEveryPop", "Pop-up", x.popOn ? "On" : "Off", x.popOn ? "Shows to visitors by the rules you set." : "One calm pop-up with timing rules: a welcome offer or a sign-up box.", toUpdates("popCard"), x.popOn ? "Change it" : "Set one up");
    const pbBox = line("pcEveryPb", "Phone bar", x.pb ? "On" : "Off", "", null);
    pbPart(pbBox);
    pbBox.addEventListener("click", (e) => { if (e.target.closest("#pbSeg button")) setTimeout(() => { pcEverySub(); if (PC_PANE && PC_PANE.box === box) paint(); }, 50); });
    if (x.tags) line("pcEveryCookie", "Cookie notice", "On", "Your ad tags ask visitors first; the notice shows until they answer.", () => { closePagesCard(false); location.assign("/connections.html" + (location.search || "")); }, "Open ad tags");
    line("pcEveryHF", "Header and footer", "On", "Your name or logo and the menu on top; your details at the foot.", () => pcHeadFoot(), "Open");
    line("pcEveryNF", "Not found page", "On", "What someone sees after a broken or old link.", () => pcNotFound(), "Open");
    box.appendChild(pcDone(close));
  };
  paint();
}
// Header and footer: the same on every page. The header's arrangement is chosen here; the
// logo is in Styles and the footer's words are the business details.
function pcHeadFoot() {
  const { box, close } = pcPane("pcHeadFootPane", "Header and footer");
  const paint = () => {
    box.textContent = "";
    box.appendChild(el("h3", "dc-modal-h", "Header and footer"));
    box.appendChild(el("p", "dc-modal-sub", "The same on every page. Changes go live when you publish."));
    box.appendChild(el("h4", "pg-h", "Header"));
    box.appendChild(el("p", "pc-note", "Your name or logo, then the menu from this card."));
    const look = el("div"); look.dataset.needs = "configure"; navStyleRow(look, () => { if (PC_PANE && PC_PANE.box === box) paint(); }, "How it’s arranged"); box.appendChild(look);
    const logo = el("button", "dc-modal-cancel", "Change the logo"); logo.type = "button"; logo.dataset.needs = "configure";
    logo.addEventListener("click", () => { closePagesCard(false); openSettingsPanel("styles"); stylesTab("colours"); });
    const a1 = el("div", "pc-acts"); a1.style.marginTop = "12px"; a1.appendChild(logo); box.appendChild(a1);
    box.appendChild(el("h4", "pg-h", "Footer"));
    box.appendChild(el("p", "pc-note", "Your address, phone, email, opening hours and social links, from your business details, with links to your privacy and accessibility pages."));
    const biz = el("button", "dc-modal-cancel", "Change the business details"); biz.type = "button"; biz.addEventListener("click", () => pcLeaveTo("business"));
    const a2 = el("div", "pc-acts"); a2.appendChild(biz); box.appendChild(a2);
    box.appendChild(pcDone(close));
  };
  paint();
  pgFocusFirst(box);
}
// The not-found page: what a visitor sees after an old or broken link, and the forwards that
// send old addresses to the right page (the Search card's own tool).
function pcNotFound() {
  const { box, close } = pcPane("pcNotFoundPane", "Not found page");
  box.appendChild(el("h3", "dc-modal-h", "Not found page"));
  box.appendChild(el("p", "dc-modal-sub", "What someone sees after following a broken or old link."));
  // item 121: the ready-made page, or one of the owner's own (open to everyone: a password or
  // private page never answers a broken link)
  const pick = el("div", "pc-nf"); box.appendChild(pick);
  const paint = () => {
    pick.textContent = "";
    const own = dcPagesArr().filter((p) => p && p.slug && !p.access), cur = (own.find((p) => p.notFound) || {}).slug || "";
    const seg = el("div", "dc-seg pc-nf-seg"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Not found page");
    [["", "Ready-made"], ["own", "One of my pages"]].forEach(([v, name]) => {
      const b = el("button", null, name); b.type = "button"; b.dataset.v = v || "ready"; b.setAttribute("aria-pressed", String((cur ? "own" : "") === v));
      if (v && !own.length) { b.disabled = true; b.title = "Add a page of your own first"; }
      b.addEventListener("click", async () => { if ((cur ? "own" : "") === v) return; if (await pgSetNotFound(v ? own[0].slug : "")) paint(); });
      seg.appendChild(b);
    });
    pick.appendChild(seg);
    if (!cur) { pick.appendChild(el("p", "pc-note", own.length ? "Your site shows a short “That page isn’t here” page with a way back to Home." : "Your site shows a short “That page isn’t here” page with a way back to Home. Add a page of your own to use it instead.")); return; }
    const sel = el("select"); sel.id = "pcNotFoundPick";
    own.forEach((p) => { const o = el("option", null, p.title || p.slug); o.value = p.slug; o.selected = p.slug === cur; sel.appendChild(o); });
    sel.addEventListener("change", async () => { if (await pgSetNotFound(sel.value)) paint(); });
    pick.appendChild(pgField("Show this page", sel, "Its own address still works. The copy that answers broken links is kept out of Google."));
  };
  paint();
  box.appendChild(el("h4", "pg-h", "Forward old addresses"));
  box.appendChild(el("p", "pc-note", "Moved from an old website, or changed a page’s address? Send the old address to the page it lives on now."));
  box.appendChild(redirectsManager());
  box.appendChild(pcDone(close));
  pgFocusFirst(box);
}
// Search appearance: how every page reads on Google, one row each; a row opens that page's
// settings, where its headline and description are changed.
function pcSearchLook() {
  const { box, close } = pcPane("pcSearchPane", "Search appearance");
  box.appendChild(el("h3", "dc-modal-h", "Search appearance"));
  box.appendChild(el("p", "dc-modal-sub", "How each page shows on Google. Pick one to change its headline and description."));
  const list = el("div", "pc-seo");
  const hidden = new Set((S.settings && S.settings.pages_noindex) || []), seo = (S.settings && S.settings.page_seo) || {}, w = seoHomeWords();
  hbPageRows().forEach((pg) => {
    const key = pg.key === "home" ? null : pg.slug ? "page:" + pg.slug : PG_SEO_KEY[pg.key];
    let line;
    if (!key) line = w.title;
    else if (hidden.has(key)) line = "Hidden from Google";
    else line = (seo[key] && seo[key].title) || seoPageDefault(key, { name: w.name, siteDescription: w.description, offeringLabel: VOCAB.label, pageTitle: pg.title }).title;
    const b = el("button", "pc-mrow"); b.type = "button";
    const ic = el("span", "ic"); ic.innerHTML = HB_ICON[pg.icon] || HB_ICON.page; b.appendChild(ic);
    const t = el("span", "t"); t.appendChild(el("b", null, pg.title)); t.appendChild(el("span", null, line || "")); b.appendChild(t);
    b.insertAdjacentHTML("beforeend", '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>');
    b.addEventListener("click", () => pgOpenSettings({ href: pg.path }));
    list.appendChild(b);
  });
  box.appendChild(list);
  box.appendChild(pcDone(close));
  pgFocusFirst(box);
}
// a phone's dock keeps Notes, Versions, Find and Preview behind More
function dcDockMore(open) {
  const d = $("dcDock"), b = $("dkMore"); if (!d) return;
  const on = open === undefined ? !d.classList.contains("more-open") : !!open;
  d.classList.toggle("more-open", on);
  if (b) b.setAttribute("aria-expanded", String(on));
}
function exitEditMode(to) {   // to: the tab to land on (the Pages card's "Change what's on it"); else where Edit mode was opened from
  if (IPE) ipeCommit();   // bank in-place text before the canvas goes away
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();   // a focused field commits on blur
  blocksSaveNow(); formsSaveNow();
  closeDesignPanels();
  document.querySelectorAll(".scrim.on").forEach((sh) => closeSheet(sh.id));   // item 171 (E2): a sheet goes with the editor
  if (DC_MODE !== "edit") dcSetMode("edit");
  go(to || EDIT_RETURN);
}
function closeDesignPanels() {
  closePagesCard(false); dcDockMore(false); closeTrayPanel(); closeSettingsPanel(); closeCommentsPanel();
  if (DC_MODE === "comments" && !CM_BUSY) dcSetMode("edit");   // item 284: closing the Notes card leaves Notes mode, so the button isn't left lit
  if (PANEL_LASTFOCUS && PANEL_LASTFOCUS.focus) { try { PANEL_LASTFOCUS.focus(); } catch (_) {} PANEL_LASTFOCUS = null; }
}
// Item 38: the rest are Edit mode's own buttons, wired as its part (presence-edit.js) loads.
(function initDesignPanels() {
  const on = (id, fn) => { const b = $(id); if (b) b.addEventListener("click", fn); };
  on("btnTrayOpen", () => toggleTray("add")); on("btnAddFab", () => openTrayPanel("add")); on("btnTrayClose", closeDesignPanels);
  on("tabContents", () => dcRailTab("contents")); on("tabAdd", () => dcRailTab("add")); on("tabFiles", () => dcRailTab("files"));
  on("btnTreeBack", () => { dcRailTab("add"); const s = $("designTray") && $("designTray").querySelector(".tray-search"); if (s) s.focus({ preventScroll: true }); });
  on("btnSettingsOpen", () => openSettingsPanel("styles")); on("btnSettingsClose", closeDesignPanels);
  const segKeys = (seg, attr, pick) => {   // click or arrow keys move between a card's tabs
    if (!seg) return;
    seg.addEventListener("click", (e) => { const b = e.target.closest("[" + attr + "]"); if (b) pick(b.getAttribute(attr)); });
    seg.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const tabs = [...seg.querySelectorAll("[" + attr + "]")], at = tabs.indexOf(document.activeElement); if (at < 0) return;
      e.preventDefault(); const nx = tabs[(at + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; pick(nx.getAttribute(attr)); nx.focus();
    });
  };
  segKeys($("inspectorSeg"), "data-itab", insTab);
  segKeys($("stylesSeg"), "data-stab", stylesTab);
  const dg = $("designGallery"); if (dg) dg.dataset.stab = "looks";   // the template row belongs to Looks (member_ui_test pins the markup)
  // the floating studio: the page switcher, the dock, and the Pages card's own buttons
  on("dcPageSwitch", () => togglePagesCard("dcPageSwitch")); on("dkPages", () => togglePagesCard("dkPages")); on("btnPagesClose", () => closePagesCard(true));
  on("btnPageAdd", () => { closePagesCard(false); dcAddPage(); });   // the name and layout dialogs take over; the new page opens on the canvas
  on("btnPcLink", () => pgOpenLink(null)); on("btnPcFolder", () => pgOpenFolder(null)); on("btnPcAuto", pgResetNav);
  on("pcBack", () => { if (PC_PANE) PC_PANE.close(); });
  on("pcHeadFoot", pcHeadFoot); on("pcNotFound", pcNotFound); on("pcSearchLook", pcSearchLook);
  on("pcEvery", pcEvery);   // item 158
  const find = $("pcFind"); if (find) find.addEventListener("input", pcFilter);
  on("dkPhotos", () => toggleTray("files"));
  on("dkLayers", () => { dcDockMore(false); toggleTray("contents"); });   // item 57
  on("dkPreview", () => { dcDockMore(false); dcOpenPreview(); });
  on("dkMore", () => dcDockMore());
  // item 171 (E4): on a phone More closes by itself: on a press anywhere outside it, and once any other
  // dock button is used (a press on the page closes it too, in dcInjectCanvas)
  document.addEventListener("pointerdown", (e) => { const d = $("dcDock"); if (d && d.classList.contains("more-open") && !d.contains(e.target)) dcDockMore(false); }, true);
  const dk = $("dcDock"); if (dk) dk.addEventListener("click", (e) => { const b = e.target.closest && e.target.closest("button"); if (b && b.id !== "dkMore") dcDockMore(false); });
  on("dcBtnPreview", dcOpenPreview);
  on("btnPageInfo", togglePageInfoMenu);   // slice B: the Page Information menu (Share draft lives inside it now)
  // Slice D: the modes bar. #btnComments now lives INSIDE the segment (G11
  // re-homed — same id, same cmToggle machinery, driven through dcSetMode).
  const modeSeg = $("dcModeSeg");
  if (modeSeg) modeSeg.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && b.dataset.dcmode) { dcDockMore(false); dcSetMode(b.dataset.dcmode); } });
  on("dcTwBack", () => dcSetMode("edit"));
  const twd = $("dcTwDate");
  if (twd) {
    const today = new Date(), pad = (n) => String(n).padStart(2, "0");
    twd.max = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;   // History's Timewarp caps at today too
    twd.addEventListener("change", dcTimewarpGo);
  }
  on("btnCommentsClose", () => { if (CM_VIEW === "thread" && DC_MODE === "comments") cmRenderList(); else closeDesignPanels(); });   // G11; item 284: a thread's Close goes back to the Notes list
  const sc = $("dcScrim"); if (sc) sc.addEventListener("click", closeDesignPanels);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (document.querySelector("dialog[open]")) return;   // item 171 (E7): a question (or the photo editor) answers its own Escape
    if (PAGES_OPEN) {
      if (PI_OPEN) return;   // the Page menu closes itself first
      const pop = document.querySelector(".pp-pop:not(.pi-pop)"); if (pop) { e.stopPropagation(); pop.remove(); return; }   // so does a page's ⋯ menu
      e.stopPropagation();
      const f = $("pcFind");
      if (document.activeElement === f && f.value) { f.value = ""; pcFilter(); return; }   // first the words being looked for, then the card
      if (PC_PANE) PC_PANE.close(); else closePagesCard(true);
      return;
    }
    const dk = $("dcDock"); if (dk && dk.classList.contains("more-open")) { e.stopPropagation(); dcDockMore(false); return; }
    const t = $("trayPanel"), s = $("settingsPanel"), cm = $("commentsPanel");
    if ((t && t.classList.contains("on")) || (s && s.classList.contains("on")) || (cm && cm.classList.contains("on"))) { e.stopPropagation(); closeDesignPanels(); }
  }, true);
})();

// ── #1 — template-first, big-preview gallery ────────────────────────────────
// Full-width row of LARGE, realistic previews (the real /preview render, scaled).
// One clear action per card: "Start with this" → PUT /site/template, or Preview to
// see it full size first. Fine styling is the card below ("Colors and fonts").
async function mountTemplateGallery() {
  const host = $("designGallery"); if (!host) return;
  try { await loadLooks(); } catch (_) { return; }
  if (!LOOKS || !(LOOKS.templates || []).length) return;   // no template data → leave hidden
  host.hidden = false;
  renderTemplateGallery();
}
// Styles leads with the choices people make every day. The templates wait in one row
// until asked for: the list is long, and every card draws a live preview of the site.
let TG_OPEN = false;
function renderTemplateGallery() {
  const host = $("designGallery"); if (!host || !LOOKS) return;
  host.textContent = "";
  const curSlug = (LOOKS.current && LOOKS.current.slug) || "";
  const cur = (LOOKS.templates || []).find((t) => t.slug === curSlug);
  const fold = el("details", "tg-fold");
  const sum = el("summary");
  const label = el("span", "tg-cur");
  label.appendChild(el("span", "tg-h", "Template"));
  if (cur) label.appendChild(el("span", "tg-curname", cur.name));
  sum.appendChild(label);
  sum.appendChild(el("span", "tg-change", "Change"));
  fold.appendChild(sum);
  const draw = () => { if (!fold.querySelector(".tg-grid")) drawTemplateGrid(fold, curSlug); };
  fold.addEventListener("toggle", () => { TG_OPEN = fold.open; if (fold.open) draw(); });
  host.appendChild(fold);
  if (TG_OPEN) { fold.open = true; draw(); }
}
function drawTemplateGrid(fold, curSlug) {
  fold.appendChild(el("div", "hint", "A template sets your whole layout. Your words stay, only the look and structure change, and nothing goes live until you publish."));
  const grid = el("div", "tg-grid");
  // A cold-start draft has nothing real to render; render the DEMO silhouette so
  // every card shows a designed page. Once there IS real content, we render it in
  // the actual /preview pipeline (the most faithful possible preview of the look).
  LOOKS.templates.forEach((t) => {
    const sw = lookSwatch(t.slug);
    const active = t.slug === curSlug;
    const card = el("div", "tg-card" + (active ? " on" : "")); card.dataset.look = t.slug;
    // BIG, realistic preview of THIS template's design (read-only)
    const shot = el("div", "tg-shot");
    if (active) { const badge = el("span", "tg-badge", "Your current template"); shot.appendChild(badge); }
    // Item 25: the template's picture with its sample site (thumbs/templates, scripts/thumbnails).
    // Drawing every template live cost a full page render each time the gallery opened;
    // Preview shows one with this site's own words. The drawn sample stands in if the
    // picture can't load.
    const pic = el("img", "tg-pic"); pic.src = "/thumbs/templates/" + t.slug + ".jpg"; pic.alt = ""; pic.loading = "lazy"; pic.width = 640; pic.height = 440;
    pic.addEventListener("error", () => { pic.remove(); shot.appendChild(tgDemoNode(sw, t.name)); });
    shot.appendChild(pic);
    card.appendChild(shot);
    const body = el("div", "tg-body");
    body.appendChild(el("div", "tg-name", t.name));
    body.appendChild(el("div", "tg-tag", sw.tag + " · shown with sample words"));
    const act = el("div", "tg-act");
    const start = el("button", "tg-start" + (active ? " current" : ""), active ? "✓ In use" : "Start with this");
    start.type = "button";
    if (active) { start.disabled = true; }
    else start.addEventListener("click", () => applyTemplateFromGallery(t));
    act.appendChild(start);
    if (!active) {
      const tryIt = el("button", "tg-try", "Preview"); tryIt.type = "button"; tryIt.setAttribute("aria-label", "Preview " + t.name);
      tryIt.addEventListener("click", async () => { if (await dcSavePendingEdits()) openPreview("draft", { template: t.slug }); });
      act.appendChild(tryIt);
    }
    body.appendChild(act);
    card.appendChild(body);
    grid.appendChild(card);
  });
  fold.appendChild(grid);
}
// The demo silhouette: a small, on-brand canned page (nav · hero · cards · split ·
// footer) painted in the template family's colour + type. Representative sample
// only — never claims to be the owner's content; switching keeps their real words.
function tgDemoNode(sw, name) {
  const wrap = el("div", "tg-demo");
  wrap.style.cssText = "background:" + sw.bg + ";color:" + sw.ink + ";font-family:" + sw.font;
  const line = (w) => { const l = el("div", "tgd-line"); l.style.width = w; return l; };
  const nav = el("div", "tgd-nav");
  nav.appendChild(el("span", null, name));
  const links = el("span", "tgd-links"); ["Home", "About", "Services", "Contact"].forEach((x) => links.appendChild(el("span", null, x)));
  nav.appendChild(links); wrap.appendChild(nav);
  const hero = el("div", "tgd-hero");
  hero.appendChild(el("div", "tgd-h1", "Your business, beautifully online"));
  hero.appendChild(line("92%")); hero.appendChild(line("74%"));
  const btn = el("div", "tgd-btn", "Get in touch"); btn.style.background = sw.accent; hero.appendChild(btn);
  wrap.appendChild(hero);
  const cards = el("div", "tgd-cards");
  ["What we do", "How it works", "Why us"].forEach(() => {
    const c = el("div", "tgd-card"); const dot = el("div", "tgd-dot"); dot.style.background = sw.accent; c.appendChild(dot);
    c.appendChild(line("80%")); c.appendChild(line("60%")); cards.appendChild(c);
  });
  wrap.appendChild(cards);
  const split = el("div", "tgd-split");
  split.appendChild(el("div", "tgd-img"));
  const txt = el("div", "tgd-txt"); ["70%", "88%", "62%", "80%"].forEach((w) => txt.appendChild(line(w))); split.appendChild(txt);
  wrap.appendChild(split);
  wrap.appendChild(el("div", "tgd-foot", "A representative sample of the " + name + " design."));
  return wrap;
}
// Seed the canvas with the recommended pre-filled STARTER LAYOUT when the page has
// no sections yet — so picking a template (or an empty canvas) gives a real, editable
// page instead of a blank sheet. Reuses the server starters (/blocks/suggested) +
// the same validating save path. Returns true if it seeded. Safe: never overwrites
// an existing layout (only runs when BLOCKS_WORK is empty).
async function seedStarterIfEmpty() {
  if (!Array.isArray(BLOCKS_WORK)) BLOCKS_WORK = currentBlocks();
  if (BLOCKS_WORK.length) return false;
  let sug = BLOCK_SUGGEST;
  if (sug === null || sug === undefined) { try { sug = (await api("GET", "/blocks/suggested")).data; BLOCK_SUGGEST = sug || false; } catch (_) { return false; } }
  if (!sug || !Array.isArray(sug.starters) || !sug.starters.length) return false;
  const starter = sug.starters.find((s) => s.key === sug.recommendedStarter) || sug.starters[0];
  if (!starter || !Array.isArray(starter.blocks) || !starter.blocks.length) return false;
  BLOCKS_WORK = JSON.parse(JSON.stringify(starter.blocks)).map((b) => { if (b && b.id) b.id = uniqueBlockId(b.type + "_" + b.id); return b; });
  BLOCK_FOCUS = 0;
  await saveBlocks();
  return true;
}
async function applyTemplateFromGallery(t) {
  if (!Array.isArray(BLOCKS_WORK)) BLOCKS_WORK = currentBlocks();
  // Non-destructive: switching template keeps content — it re-lays-out + re-styles.
  const hasContent = (BLOCKS_WORK && BLOCKS_WORK.length) || (S.offerings || []).length || (S.identity && S.identity.business_name);
  const wasWords = vocabWords();
  if (hasContent && !(await askYes("Start with the “" + t.name + "” template? Your words stay exactly as they are — only the layout and styling change. Nothing goes live until you publish.", { ok: "Use this template" }))) return;
  try {
    const r = await api("PUT", "/site/template", { slug: t.slug });
    if (S.site) S.site.template = t.slug;
    LOOKS = null; PV.template = "";
    try { const s = await api("GET", "/site"); S.site = s.data.site; } catch (_) {}
    // A brand-new, empty page gets the recommended starter layout so picking a
    // template lands you on a real, editable page — never a blank canvas.
    let seeded = false;
    if (!hasContent) { try { seeded = await seedStarterIfEmpty(); } catch (_) {} }
    LOOKS = (await api("GET", "/site/templates")).data;
    renderTemplateGallery();
    // re-dress the styles card + refresh the canvas
    const dc = $("designCard"); if (dc) { dc.remove(); mountDesignCard(); }
    if (typeof applyVocab === "function") applyVocab();
    await pgFollowOffering(wasWords);
    scheduleChangesRefresh(); refreshDesignPreview();
    toast(seeded
      ? "Started on the " + (r.data && r.data.name ? r.data.name : t.name) + " template with a ready-made layout — edit any section, drag to reorder, then publish"
      : "Now on the " + (r.data && r.data.name ? r.data.name : t.name) + " template — publish to make it live");
  } catch (err) { toast(nice(err), true); }
}
document.querySelectorAll("#dcDock .dc-dk[data-ico]").forEach((b) => { b.insertAdjacentHTML("afterbegin", uiIcon(b.dataset.ico, 20)); });
const TRAY_GROUP_ICON = { "Show your work": "image", "Build trust": "star", "Get customers to act": "steps", "Text & layout": "text", "Info & updates": "list" };
const TRAY_TYPE_ICON_NAME = {
  gallery: "gallery", before_after: "compare", image: "image", image_text: "imagetext", video: "video", team: "people", partners: "tag",
  features: "spark", stats: "chart", cards: "cards", reviews_wall: "star", reviews: "star", certifications: "badge", pricing: "price", process: "steps",
  cta: "megaphone", buttons: "button", booking: "calendar", appointment: "calendar", newsletter: "mail", download: "download", map: "pin",
  richtext: "text", columns: "columns", accordion: "chevrons", tabs: "tabs", carousel: "carousel", progress: "progress", divider: "divider", toc: "list", service_areas: "pin", events: "calendar", social: "share",
  title: "heading", link_list: "link", table: "table", spotlight: "spark", stack: "layers",
};
const trayIcon = (type) => uiIcon(TRAY_TYPE_ICON_NAME[type] || "section");
// PURE + self-contained (no globals) so it can be unit-tested by extraction: does a
// section (its name / familiar-alias / type) match a plain-text search query?
function trayItemMatches(name, alias, type, q) {
  const needle = String(q || "").trim().toLowerCase();
  if (!needle) return true;
  const hay = (String(name || "") + " " + String(alias || "") + " " + String(type || "")).toLowerCase();
  return needle.split(/\s+/).every((w) => hay.indexOf(w) >= 0);
}
let TRAY_QUERY = "";
function mountBlockTray() {
  const host = $("designTray"); if (!host) return;
  renderBlockTray();
}
// the purpose chips' short words (the group headers keep their full names)
const TRAY_CHIP_WORD = { "Get customers to act": "Get contacted", "Text & layout": "Words" };
let TRAY_GROUP = "";   // one purpose chip, or every group
function renderBlockTray() {
  const host = $("designTray"); if (!host) return;
  host.textContent = "";
  const sw = el("div", "tray-searchwrap"); sw.insertAdjacentHTML("afterbegin", uiIcon("search", 18));
  const search = el("input", "tray-search"); search.type = "search"; search.placeholder = "Find a section"; search.value = TRAY_QUERY; search.setAttribute("aria-label", "Search sections to add");
  search.addEventListener("input", () => { TRAY_QUERY = search.value; renderBlockTray(); const s2 = $("designTray") && $("designTray").querySelector(".tray-search"); if (s2) { s2.focus(); s2.setSelectionRange(TRAY_QUERY.length, TRAY_QUERY.length); } });
  sw.appendChild(search); host.appendChild(sw);
  // what the section is for: one chip each, All first
  const chips = el("div", "tray-chips"); chips.setAttribute("role", "group"); chips.setAttribute("aria-label", "What the section is for");
  [["", "All"], ...SECTION_GROUPS.map((g) => [g.label, TRAY_CHIP_WORD[g.label] || g.label])].forEach(([key, word]) => {
    const c = el("button", "tray-chip" + (TRAY_GROUP === key ? " on" : ""), word); c.type = "button"; c.setAttribute("aria-pressed", String(TRAY_GROUP === key));
    c.addEventListener("click", () => { TRAY_GROUP = key; renderBlockTray(); const c2 = $("designTray") && $("designTray").querySelector(".tray-chip.on"); if (c2) c2.focus({ preventScroll: true }); });
    chips.appendChild(c);
  });
  host.appendChild(chips);
  const present = new Set((BLOCKS_WORK || []).map((b) => b && b.type));
  let shown = 0;
  // item 57: Blocks leads the list, a section built from any of the blocks
  const stack = BLOCK_DEFS.find((d) => d.type === "stack");
  if (stack && (!TRAY_GROUP || TRAY_GROUP === "Text & layout") && trayItemMatches(stack.name, SECTION_ALIAS.stack, "stack", TRAY_QUERY)) {
    const wrap = el("div", "tray-grp shots stk-first"), ti = trayItem(stack);
    ti.appendChild(el("span", "stk-new", "New")); wrap.appendChild(ti); host.appendChild(wrap); shown++;
  }
  SECTION_GROUPS.forEach((grp) => {
    if (TRAY_GROUP && grp.label !== TRAY_GROUP) return;
    const defs = grp.types.filter((ty) => ty !== "stack")
      .map((ty) => BLOCK_DEFS.find((d) => d.type === ty))
      .filter((d) => d && !(BLOCK_SINGLETON.has(d.type) && present.has(d.type)))
      .filter((d) => trayItemMatches(d.name, (SECTION_ALIAS[d.type] || "") + " " + (SECTION_FINDS[d.type] || ""), d.type, TRAY_QUERY));
    const routes = SECTION_ROUTES.filter((r) => r.group === grp.label && (r.key !== "contact_form" || $("formsCard")) && trayItemMatches(r.name(), r.alias + " " + r.finds, "", TRAY_QUERY));
    if (!defs.length && !routes.length) return;
    const wrap = el("div", "tray-grp shots");
    const grpH = el("div", "tray-grp-h", grp.label);
    if (TRAY_GROUP_ICON[grp.label]) grpH.insertAdjacentHTML("afterbegin", uiIcon(TRAY_GROUP_ICON[grp.label], 14));
    wrap.appendChild(grpH);
    // item 324: a tile that answers the words typed leads its group; with nothing typed, the sections lead
    const lead = TRAY_QUERY.trim() ? routes : [], rest = TRAY_QUERY.trim() ? [] : routes;
    lead.forEach((r) => { wrap.appendChild(trayRouteItem(r)); shown++; });
    defs.forEach((d) => { wrap.appendChild(trayItem(d)); shown++; });
    rest.forEach((r) => { wrap.appendChild(trayRouteItem(r)); shown++; });
    host.appendChild(wrap);
  });
  if (!shown) host.appendChild(el("div", "tray-empty", TRAY_QUERY ? "No sections match “" + TRAY_QUERY + "”." : "Every section type is already on your page. Reorder or edit them in the middle."));
  // the sections saved for reuse live in All sections; the row says how many, once known
  if (CL_ITEMS === null && !CL_LOADING) {
    CL_LOADING = true;
    api("GET", "/content-library").then((r) => { CL_ITEMS = Array.isArray(r && r.data) ? r.data : []; }).catch(() => { CL_ITEMS = []; }).then(() => { CL_LOADING = false; if ($("designTray") && $("designTray").querySelector(".tray-saved")) renderBlockTray(); });
  }
  const saved = el("button", "tray-saved"); saved.type = "button"; saved.title = "Ready-made layouts and the sections you saved for reuse";
  saved.insertAdjacentHTML("afterbegin", uiIcon("clock", 16));
  saved.appendChild(el("span", "sp", "Saved sections" + (Array.isArray(CL_ITEMS) ? " · " + CL_ITEMS.length : "")));
  saved.insertAdjacentHTML("beforeend", uiIcon("chevron", 14));
  saved.addEventListener("click", () => openSettingsPanel("sections"));
  host.appendChild(saved);
  const more = el("div", "tray-more");
  const forms = el("button", "textact", "Forms"); forms.type = "button"; forms.addEventListener("click", () => openSettingsPanel("forms")); more.appendChild(forms);
  const outline = el("button", "textact", "Page outline"); outline.type = "button"; outline.addEventListener("click", () => dcRailTab("contents")); more.appendChild(outline);
  host.appendChild(more);
}
// The section's picture, or nothing when it can't load (the name still says what it is).
function trayShot(b, type) {
  const img = el("img", "ti-shot"); img.src = "/thumbs/sections/" + type + ".jpg"; img.alt = ""; img.loading = "lazy"; img.width = 440; img.height = 248;
  img.addEventListener("error", () => { img.remove(); b.classList.remove("has-shot"); });
  b.classList.add("has-shot"); b.insertBefore(img, b.firstChild);
}
function trayItem(d) {
  const b = el("button", "tray-item"); b.type = "button";
  b.title = "Add “" + d.name + "” — click to append, or drag onto the canvas to place it";
  b.appendChild(Object.assign(el("span", "ti-ico"), { innerHTML: trayIcon(d.type) }));
  const txt = el("span", "ti-txt");
  txt.appendChild(el("span", "ti-name", d.name));
  if (SECTION_ALIAS[d.type]) txt.appendChild(el("span", "ti-alias", SECTION_ALIAS[d.type]));
  b.appendChild(txt);
  trayShot(b, d.type);
  // click = append (keyboard-accessible fallback); pointer-drag = drop into place
  b.addEventListener("click", () => { if (pdConsumeClick()) return; addBlockAt(d, BLOCKS_WORK.length); });
  b.addEventListener("pointerdown", (e) => pdStart(e, { kind: "new", type: d.type, label: d.name, icon: trayIcon(d.type) }, b));
  return b;
}

// Builder item 324: a tile that opens where the thing is made, the section tile's look without a picture
function trayRouteItem(r) {
  const b = el("button", "tray-item tray-route"); b.type = "button"; b.dataset.route = r.key; b.title = r.says;
  b.appendChild(Object.assign(el("span", "ti-ico"), { innerHTML: uiIcon(r.icon) }));
  const txt = el("span", "ti-txt");
  txt.appendChild(el("span", "ti-name", r.name()));
  txt.appendChild(el("span", "ti-alias", r.alias));
  b.appendChild(txt);
  b.addEventListener("click", () => { closeTrayPanel(); r.go(); });
  return b;
}
function trayAddContactForm() {
  openSettingsPanel("forms");
  const p = FORM_PRESETS_UI.find((x) => x.key === "contact");
  if (!p || !Array.isArray(FORMS_WORK)) return;
  ffAddPreset(p);
  toast("A contact form is at the end of this page. Change its fields here.");
}
function trayOpenHeroLayouts() {
  openSettingsPanel("styles"); stylesTab("looks");
  const pill = [...document.querySelectorAll("#settingsPanel .ins-heros button")].find((b) => b.textContent.trim() === "Words over the photo");
  if (pill) { pill.scrollIntoView({ block: "center" }); pill.focus({ preventScroll: true }); }
}
function trayOpenBusiness(headId, firstSel) {
  eeEditCore("business");
  const h = $(headId); if (!h) return;
  h.scrollIntoView({ block: "start" });
  const f = h.parentNode && h.parentNode.querySelector(firstSel); if (f) f.focus({ preventScroll: true });
}

// ── Slice C (AC-2): the Files tab — a compact asset browser IN the panel ───────
// PANEL-SCOPED state only: PF_S is this tab's own. It reuses the FL_ *ideas*
// (FL_COLS chip defs, the /assets query shape) but never touches FL_S — which owns
// #mediaGrid via FL_takeover — and its thumbnails render through
// renderMediaGrid(grid, false, onPick), the exact contract the pickers use.
const PF_CHIPS = ["all", "stock", "brand", "recent"];   // the panel is image-only, so Yours is every photo; Recent the newest two dozen
const PF_CHIP_WORD = { all: "Yours", stock: "Stock", brand: "Brand", recent: "Recent" };
const PF_CAP = 60;   // the panel grid stays light — the full Files view carries the rest
function pfQ() { const s = $("pfSearch"); return s ? s.value : ""; }   // the search box IS the query state
// ONE owner for the stock-vs-library dispatch. paintOnly = the tab-switch path:
// repaint stock from its cached results instead of re-searching the provider.
function pfRefresh(paintOnly) {
  if (PF_S.col === "stock") { paintOnly ? pfRenderStock() : pfLoadStock(); return; }
  pfLoad();   // repaints from its query cache when nothing changed
}
function mountPanelFiles() {
  const host = $("designFilesWrap"); if (!host) return;
  if (!host.querySelector(".pf-chips")) {
    host.textContent = "";
    // the floating studio's Photos card: Yours · Stock · Brand · Recent as one segmented control
    const bar = el("div", "dc-seg pf-chips"); bar.setAttribute("role", "tablist"); bar.setAttribute("aria-label", "Which photos");
    PF_CHIPS.forEach((key) => {
      const b = el("button", PF_S.col === key ? "on" : "", PF_CHIP_WORD[key] || key);
      b.type = "button"; b.dataset.col = key; b.setAttribute("role", "tab"); b.setAttribute("aria-selected", String(PF_S.col === key));
      b.addEventListener("click", () => { if (PF_S.col === key) return; PF_S.col = key; pfPaintChips(); pfRefresh(); });
      bar.appendChild(b);
    });
    host.appendChild(bar);
    const sw = el("div", "pf-search");
    const swrap = el("div", "tray-searchwrap"); swrap.insertAdjacentHTML("afterbegin", uiIcon("search", 18));
    const search = el("input", "tray-search"); search.type = "search"; search.id = "pfSearch";
    search.placeholder = "Search your photos"; search.setAttribute("aria-label", "Search your photos");
    let t = null;
    search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(pfRefresh, 280); });
    search.addEventListener("keydown", (e) => { if (e.key === "Enter" && PF_S.col === "stock") { e.preventDefault(); pfRefresh(); } });
    swrap.appendChild(search); sw.appendChild(swrap); host.appendChild(sw);
    const body = el("div", "pf-body");
    const grid = el("div", "mediagrid"); grid.id = "panelFilesGrid";
    body.appendChild(grid);
    // Upload a photo · Open Files
    const acts = el("div", "pf-acts");
    const up = el("button", "dc-actbtn", "Upload photos"); up.type = "button";
    const file = el("input"); file.type = "file"; file.id = "pfFile"; file.accept = "image/jpeg,image/png,image/webp"; file.multiple = true; file.hidden = true; file.setAttribute("aria-label", "Choose photos to upload");
    up.addEventListener("click", () => file.click());
    const link = el("button", "dc-actbtn dc-ghost", "Open Files"); link.type = "button";
    link.title = "The full Files library — versions, where-used, crops";
    link.addEventListener("click", () => { closeDesignPanels(); go("media"); });
    acts.append(up, link); body.appendChild(acts); body.appendChild(file);
    // item 317: several at once, or dropped on the panel; big ones made smaller here; the
    // descriptions asked for once they are in (dcUploadPhotos, the same door Files uses)
    const after = () => { PF_S.key = null; pfRefresh(); };
    file.addEventListener("change", async () => { const fs = Array.from(file.files || []); file.value = ""; if (!fs.length) return; up.disabled = true; try { await dcUploadPhotos(fs); } finally { up.disabled = false; } after(); });
    dcDropPhotos(body, after);
    body.appendChild(el("div", "pf-note", "Tap a photo to use it: it fills the image you’re choosing for, or becomes a new photo section. Drop photos here to add them. Edit crops, straightens and removes a background; saving always makes a new copy."));
    host.appendChild(body);
  }
  pfRefresh(true);
}
function pfPaintChips() {
  const host = $("designFilesWrap"); if (!host) return;
  host.querySelectorAll(".pf-chips [data-col]").forEach((b) => { const on = b.dataset.col === PF_S.col; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
}
// Edit on a photo in the card: the same editor as Files and the picker, a new file beside the original.
async function pfEdit(m, btn) {
  if (btn.disabled) return;
  btn.disabled = true;
  const ready = () => { btn.disabled = false; };
  let d = null;
  try { d = (await api("GET", "/assets/" + m.id)).data; } catch (err) { ready(); toast(nice(err), true); return; }
  const a = d && d.asset;
  const src = d && (d.thumb_fallback || d.download_url);
  if (!a || !src) { ready(); toast("Couldn’t open this photo for editing. Try again in a moment.", true); return; }
  let ed; try { ed = await loadPhotoEditor(); } catch (_) { ready(); toast("The photo editor didn’t load. Check your connection and try again.", true); return; }
  ready();
  const res = await ed.open({ src, fallbackSrc: d.download_url, name: a.name, mime: a.mime,
    saveLabel: "Save a copy", note: "Saving makes a new file beside the original, which stays exactly as it is.",
    cutout: d.cutout_available ? () => pickerCutout(a.id) : null, onSave: (out) => saveEditedCopy(a, out) });
  if (!res || !res.saved || !res.value) return;
  await loadMedia(); PF_S.key = null; pfRefresh();
  toast(res.value.patched ? "Saved as a new file. The original is unchanged." : "Saved as a new file. Its name and folder didn’t copy over, so set them in Files.");
}
// Chips/search narrow the grid via the SAME /assets query shape FL_qstr builds —
// but against PF_S, so the Files view's own state (FL_S) is never repointed.
function pfQstr() {
  const c = FL_COLS.find((x) => x.key === PF_S.col) || FL_COLS[0];
  const p = new URLSearchParams();
  Object.entries(c.f || {}).forEach(([k, v]) => p.set(k, v));
  if (pfQ().trim()) p.set("q", pfQ().trim());
  p.set("limit", "300");
  return p.toString();
}
async function pfLoad() {
  const grid = $("panelFilesGrid"); if (!grid) return;
  const key = PF_S.col + "\n" + pfQ().trim();
  if (PF_S.key === key) { pfPaint(grid, PF_S.allow); return; }   // unchanged query (a tab switch) → repaint from cache, no refetch
  const seq = ++PF_S.seq;
  let allow = null;   // null = unfiltered (All photos, no search): S.media as-is
  if (PF_S.col === "brand" || pfQ().trim()) {
    try {
      const r = await api("GET", "/assets?" + pfQstr());
      if (seq !== PF_S.seq) return;   // a newer chip/search won the race
      allow = new Set((((r || {}).data || {}).assets || []).filter((a) => a.kind === "image").map((a) => String(a.id)));
    } catch (_) { allow = null; }     // /assets unavailable → degrade to the full grid
  }
  if (seq !== PF_S.seq) return;
  PF_S.key = key; PF_S.allow = allow;
  pfPaint(grid, allow, seq);
}
// Paint ONLY the allowed image items through the shared per-cell builder — no
// index coupling with renderMediaGrid, no churn of hundreds of doomed cells.
function pfPaint(grid, allow, seq) {
  if (seq !== undefined && seq !== PF_S.seq) return;   // a stale loader never paints…
  if (PF_S.col === "stock") return;                    // …and never clobbers the stock pane
  grid.innerHTML = "";
  // the panel is image-only, honestly: /media can carry documents too — mirror
  // FL_load's client-side kind filter so a PDF can never ride in as a "photo section"
  let imgs = (S.media || []).filter((m) => (m.kind == null || m.kind === "image") && (!allow || allow.has(String(m.id))));
  if (PF_S.col === "recent") imgs = imgs.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || ""))).slice(0, 24);
  if (!imgs.length) {
    grid.innerHTML = `<p style="grid-column:1/-1;color:var(--ink-2);font-size:13px">${pfQ().trim() ? "No files match that search." : ((S.media || []).length ? "Nothing in this collection yet." : "No files in this collection yet.")}</p>`;
    return;
  }
  imgs.slice(0, PF_CAP).forEach((m) => {
    const c = mediaCell(grid, m, false, pfPick);   // the pickers' exact per-cell contract
    c.dataset.mid = String(m.id);                  // anchors the offer popover to THIS photo
    // drag a thumbnail onto the canvas → a new photo section at that gap (pd engine)
    c.addEventListener("pointerdown", (e) => pdStart(e, { kind: "media", mediaId: m.id, label: m.alt_text || "Photo", icon: uiIcon("image") }, c));
    if (EDITABLE_PHOTO.test(m.mime || "")) {   // the pencil in the corner: the same editor as Files
      const w = pickerEditWrap(c, m, pfEdit);
      const eb = w.querySelector(".medit"); if (eb) { eb.textContent = ""; eb.insertAdjacentHTML("afterbegin", uiIcon("pencil", 14)); }
      grid.appendChild(w);
    } else grid.appendChild(c);
  });
  if (imgs.length > PF_CAP) {
    const more = el("div", "pf-note", "Showing " + PF_CAP + " — refine your search or Open Files →");
    more.style.gridColumn = "1/-1";
    grid.appendChild(more);
  }
}
// One pick, two landings: an ARMED image slot (the picker flow is live) fills via
// the exact path #pickerGrid's onPick uses; otherwise offer a new photo section.
function pfPick(id) {
  if (pdConsumeClick()) return;   // the click that follows a real drag
  const sc = $("pickerScrim");
  if (pickerCb && sc && sc.classList.contains("on")) { const cb = pickerCb; closeSheet("pickerScrim"); cb(id); return; }
  pfOfferAdd(id);
}
let PF_OFFER = null;
function pfCloseOffer() {
  if (!PF_OFFER) return;
  PF_OFFER.remove(); PF_OFFER = null;
  document.removeEventListener("mousedown", pfOfferOff, true);
  document.removeEventListener("keydown", pfOfferKey, true);
}
function pfOfferOff(e) { if (PF_OFFER && !PF_OFFER.contains(e.target)) pfCloseOffer(); }
function pfOfferKey(e) { if (e.key === "Escape") { e.stopPropagation(); pfCloseOffer(); } }
function pfOfferAdd(id) {
  pfCloseOffer();
  const m = el("div", "pp-pop"); m.id = "pfOfferPop"; m.setAttribute("role", "menu"); m.setAttribute("aria-label", "Use this photo");
  const add = el("button", "pp-pop-item", "＋ Add as a new photo section"); add.type = "button"; add.setAttribute("role", "menuitem");
  add.addEventListener("click", () => { pfCloseOffer(); pfInsertImageAt(id, (BLOCKS_WORK || []).length); });
  m.appendChild(add);
  document.body.appendChild(m);
  // anchor to the clicked thumbnail via its data-mid stamp (no last-clicked global)
  const grid = $("panelFilesGrid");
  let anchor = grid;
  if (grid) Array.prototype.forEach.call(grid.querySelectorAll(".mcell[data-mid]"), (c) => { if (c.dataset.mid === String(id)) anchor = c; });
  const r = anchor ? anchor.getBoundingClientRect() : { bottom: 120, left: 40 };
  m.style.cssText = "position:fixed;z-index:300;background:var(--sheet,#fff);border:1px solid var(--line,#ddd);border-radius:10px;box-shadow:0 12px 34px rgba(0,0,0,.18);padding:6px;display:flex;flex-direction:column;min-width:150px";
  m.style.top = Math.max(8, Math.min(r.bottom + 4, window.innerHeight - m.offsetHeight - 8)) + "px";
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + "px";
  PF_OFFER = m;
  document.addEventListener("keydown", pfOfferKey, true);
  setTimeout(() => { document.addEventListener("mousedown", pfOfferOff, true); try { add.focus(); } catch (_) {} }, 0);
}
// Insert an image section carrying this media id — the EXISTING block-insert path
// (addBlockAt + saveBlocks); the photo rides in, so no empty slot needs arming.
function pfInsertImageAt(mediaId, at) {
  const def = BLOCK_DEFS.find((x) => x.type === "image"); if (!def) return;
  dcCaptureScroll();
  const i = addBlockAt(def, at);   // the index addBlockAt ACTUALLY used — never a copied clamp
  if (BLOCKS_WORK[i]) BLOCKS_WORK[i].image_id = mediaId;
  saveBlocks();
}
// The Stock chip — the SAME endpoints as the Files view + picker stock tabs
// (GET /stock/search, POST /stock/import), panel-scoped state, same landing as pfPick.
async function pfLoadStock() {
  const seq = ++PF_S.seq;   // stock competes in the SAME race as the library loads
  PF_S.stock.state = "loading"; pfRenderStock(seq);
  try {
    const r = await api("GET", "/stock/search?q=" + encodeURIComponent(pfQ() || "") + "&page=1");
    if (seq !== PF_S.seq) return;   // a newer chip/search won the race
    PF_S.stock.results = ((r || {}).data || {}).images || [];
    PF_S.stock.state = "ok";
  } catch (err) {
    if (seq !== PF_S.seq) return;
    if (err && err.status === 503) { PF_S.stock.state = "off"; }
    else { PF_S.stock.results = []; PF_S.stock.state = "ok"; toast(nice(err), true); }
  }
  pfRenderStock(seq);
}
function pfRenderStock(seq) {
  if (seq !== undefined && seq !== PF_S.seq) return;   // a stale loader never paints…
  if (PF_S.col !== "stock") return;                    // …and never clobbers the library grid
  const grid = $("panelFilesGrid"); if (!grid) return;
  const st = PF_S.stock;
  if (st.state === "off") { grid.innerHTML = `<div class="pf-note" style="grid-column:1/-1">Stock photos aren’t turned on yet. Add a Pexels key to search professional royalty-free photos.</div>`; return; }
  if (st.state === "loading") { grid.innerHTML = `<p style="grid-column:1/-1;color:var(--ink-2);font-size:13px">Searching…</p>`; return; }
  if (st.state == null) { grid.innerHTML = `<div class="pf-note" style="grid-column:1/-1">Search above for professional royalty-free photos — try “office”, “coffee”, “salon”…</div>`; return; }
  if (!st.results.length) { grid.innerHTML = `<div class="pf-note" style="grid-column:1/-1">No matches — try another word.</div>`; return; }
  grid.innerHTML = "";
  st.results.forEach((im) => {
    const cell = el("button", "mcell"); cell.type = "button";
    cell.setAttribute("aria-label", "Use this stock photo" + (im.credit ? " by " + im.credit : ""));
    const img = el("img"); img.src = im.thumb; img.alt = im.alt || ""; img.loading = "lazy"; cell.appendChild(img);
    if (im.credit) cell.appendChild(el("span", "alt", im.credit));
    cell.addEventListener("click", () => pfImportStock(im, cell));
    grid.appendChild(cell);
  });
}
async function pfImportStock(im, cell) {
  if (cell.dataset.busy) return; cell.dataset.busy = "1"; cell.style.opacity = ".5";
  const badge = el("span", "badge", "Adding…"); cell.appendChild(badge);
  try {
    const r = await api("POST", "/stock/import", { stock_id: im.id, alt_text: im.alt, credit: im.credit || "" });
    const mid = r && r.data && r.data.media_id;
    if (!mid) throw new Error("That photo couldn’t be added — please try another.");
    await loadMedia();   // refresh S.media so thumbnails resolve for the new id
    cell.style.opacity = ""; badge.textContent = "Added ✓"; delete cell.dataset.busy;   // reset like FL_addStock — never a stuck "Adding…"
    cell.dataset.mid = String(mid);   // the offer popover anchors here
    toast("Added to your Files");
    pfPick(mid);         // same landing: armed slot fills, else offer a photo section
  } catch (err) {
    cell.style.opacity = ""; badge.remove(); delete cell.dataset.busy;
    if (err && err.status === 503) { PF_S.stock.state = "off"; pfRenderStock(); }
    else toast(nice(err), true);
  }
}

// ── #4 — the block list model (list-order only) + Notion "+" insert gaps ────────
// A gap at index i means "insert before block i" (a trailing gap = append):
//   new  → splice emptyBlock(def) at i   (same object the click path builds)
//   move → remove from f, insert at (i>f ? i-1 : i)   — a pure list reindex.
// This is the arrows' model (adjacent swap) generalised to any target; the ↑/↓
// buttons remain as the keyboard-accessible fallback. No x/y, no overlap ever.
function dndDropIndex(from, gap) { return gap > from ? gap - 1 : gap; }   // PURE — tested by extraction
// PURE list-move shared by every reorder commit (top-level sections + columns):
// remove at `from`, re-insert at the dndDropIndex-resolved slot. Returns false for
// out-of-range or a drop back onto its own slot, so callers can skip save/render.
function spliceMove(arr, from, gap) {
  if (from == null || from < 0 || from >= arr.length) return false;
  const to = dndDropIndex(from, gap);
  if (to === from) return false;
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return true;
}
function addBlockAt(d, at) {
  if (dcBuiltinPage()) { toast("This page is built from " + dcBuiltinFrom(dcBuiltinPage().view) + ". Add sections on Home or on a page of your own."); return -1; }   // item 314
  dcSoloEnd();
  const blk = emptyBlock(d);   // REUSE the exact block factory the click path uses
  const i = Math.max(0, Math.min(at, BLOCKS_WORK.length));
  const slot = dcCanvasSlot(i);   // item 318: its place on the page, read before the list moves
  // G13 fix (review finding 1): THE insert splice (dcAddAt, the insert menu,
  // the drag-drop add, the rail's append all land here) — compose the shift
  // over the clamped index BEFORE the splice, so the canvas DOM's stale
  // data-dds-src stamps keep resolving until the save's reload re-stamps.
  dcComposeSrcMap(BLOCKS_WORK.length, (v) => dcShiftIndex(v, i, 1));
  BLOCKS_WORK.splice(i, 0, blk);
  BLOCK_FOCUS = i; DC_FOCUS_BI = i;   // canvas will scroll to + flash this new section after reload
  renderBlocksCard();
  dcCanvasAdded(i, slot);   // item 318: on the page at once
  return i;   // the index it ACTUALLY used — callers stamp the new block via this, never a re-derived clamp
}
function moveBlockTo(from, gap) {
  if (lockStop(from)) return false;   // item 155
  if (!spliceMove(BLOCKS_WORK, from, gap)) return false;
  renderBlocksCard();
  return true;
}
function blkGap(i) {
  const g = el("div", "blk-gap"); g.dataset.gap = String(i);
  const plus = el("button", "blk-plus"); plus.type = "button"; plus.textContent = "+";
  plus.setAttribute("aria-label", "Add a section here"); plus.title = "Add a section here";
  plus.addEventListener("click", (e) => { e.stopPropagation(); openInsertMenu(i, plus); });
  g.appendChild(plus);
  return g;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POINTER-BASED DRAG — the reliable replacement for native cross-frame DnD
// ═══════════════════════════════════════════════════════════════════════════════
// The OLD code used native HTML5 drag-and-drop to drop a tray item INTO the same-
// origin preview iframe. Browsers deliver drag events across a frame boundary
// unreliably, so the drop frequently never fired ("drag to the page doesn't drop").
//
// This engine never relies on native DnD. On pointerdown we setPointerCapture on the
// SOURCE element, so every pointermove/pointerup for that pointer is delivered to
// the source — even while the cursor is over the iframe. We read the iframe's
// rendered section rects (same-origin → getBoundingClientRect works) and draw a
// floating ghost + a drop-line in the PARENT document, positioned over the iframe.
// On pointerup we resolve a SINGLE list-index gap and call addBlockAt / moveBlockTo
// (never an x/y). Because capture bypasses hit-testing, the drop ALWAYS resolves.
//
//   PDRAG = { kind:'new'|'move', type?, from?, label, icon, sourceEl, pointerId,
//             iframeLocal, startX, startY, begun, lastGap, ghost }
let PDRAG = null;
let PD_JUST_DRAGGED = false;   // guards the click that follows a real drag (append)
function pdConsumeClick() { if (PD_JUST_DRAGGED) { PD_JUST_DRAGGED = false; return true; } return false; }
// PURE + self-contained (unit-tested by extraction): given candidate gaps
// [{gap,y}] and a cursor Y, return the nearest gap — always ONE list index, never
// an x/y coordinate. Ties resolve to the first (topmost) candidate.
function pdPickGap(gaps, cy) {
  let best = gaps.length ? gaps[0].gap : 0, bestD = Infinity;
  for (const g of gaps) { const d = Math.abs(g.y - cy); if (d < bestD) { bestD = d; best = g.gap; } }
  return best;
}
function pdStart(e, spec, sourceEl) {
  if (PDRAG) return;
  if (e.pointerType === "mouse" && e.button !== 0) return;   // primary button / touch / pen only
  const ps = $("pickerScrim");
  if (ps && ps.classList.contains("on")) return;   // never reorder under an ARMED picker — a pick must land on live indices
  PDRAG = Object.assign({ sourceEl: sourceEl, pointerId: e.pointerId, iframeLocal: !!spec.iframeLocal,
    startX: e.clientX, startY: e.clientY, begun: false, lastGap: null, ghost: null }, spec);
  try { sourceEl.setPointerCapture(e.pointerId); } catch (_) {}
  sourceEl.addEventListener("pointermove", pdMove);
  sourceEl.addEventListener("pointerup", pdEnd);
  sourceEl.addEventListener("pointercancel", pdCancel);
  window.addEventListener("keydown", pdKeydown, true);   // the drag claims Escape while it's live
}
// Escape CANCELS an active drag — on window capture so it runs BEFORE the panel-close
// Escape handler (the panel stays open, nothing commits). Removed in pdFinish.
function pdKeydown(e) {
  if (e.key !== "Escape" || !PDRAG) return;
  e.preventDefault(); e.stopImmediatePropagation();
  pdFinish(false);
}
// BACKSTOP: if the captured source is torn out of the DOM mid-drag (a rebuild) or
// the OS cancels the pointer, its capture events stop arriving — catch the document-
// level lostpointercapture/pointercancel and cancel, so PDRAG can never wedge shut.
document.addEventListener("lostpointercapture", (e) => { if (PDRAG && e.pointerId === PDRAG.pointerId) pdFinish(false); }, true);
document.addEventListener("pointercancel", (e) => { if (PDRAG && e.pointerId === PDRAG.pointerId) pdFinish(false); }, true);
// translate the pointer to PARENT-document viewport coords (a move grip lives INSIDE
// the iframe, so its clientX/Y are iframe-local and need the frame offset added).
function pdParentXY(e) {
  if (!PDRAG || !PDRAG.iframeLocal) return { x: e.clientX, y: e.clientY };
  const f = $("designPreview"); const fr = f ? f.getBoundingClientRect() : { left: 0, top: 0 };
  return { x: fr.left + e.clientX, y: fr.top + e.clientY };
}
function pdBegin() {
  PDRAG.begun = true;
  document.body.classList.add("pd-dragging");
  // dragging a NEW section in from the palette → tuck the rail away so the whole
  // canvas is a visible drop surface (the captured source stays in the DOM, so the
  // drag keeps receiving move/up even with the panel hidden). A Files-tab photo
  // keeps the panel until the pointer actually LEAVES it (see pdMove) — a jitter
  // inside the panel stays an honest click. Tree-row moves keep the panel open —
  // the tree IS the drop zone.
  if (PDRAG.kind === "new") { closeTrayPanel(); PDRAG.closedPanel = true; }
  const g = el("div", "pd-ghost");
  // PDRAG.icon only ever comes from uiIcon()/trayIcon() (constants), never from content
  g.appendChild(Object.assign(el("span", "pd-ico"), { innerHTML: PDRAG.icon || uiIcon("section") }));
  g.appendChild(el("span", null, (PDRAG.kind === "move" ? "Move: " : "") + (PDRAG.label || "Section")));
  if (pdReducedMotion()) g.style.transition = "none";
  document.body.appendChild(g); PDRAG.ghost = g;
  let line = document.getElementById("pdDropLine");
  if (!line) { line = el("div", "pd-dropline"); line.id = "pdDropLine"; document.body.appendChild(line); }
  line.style.display = "none";
}
// candidate gaps from the rendered preview: one "before block bi" per top-level
// block section, plus a trailing "append" gap. Y values are PARENT viewport coords.
function pdGaps() {
  const frame = $("designPreview"); if (!frame) return null;
  const fr = frame.getBoundingClientRect();
  let doc; try { doc = frame.contentDocument; } catch (_) { return null; }
  const main = doc && doc.getElementById("main"); if (!main) return null;
  // PRIMARY: snap to the injected insertion targets (they exist for every gap,
  // including the empty-page placeholder), each of which carries its list index.
  const bars = main.querySelectorAll(".dc-ins[data-gap], .dc-emptyzone[data-gap]");
  const gaps = [];
  Array.prototype.forEach.call(bars, (elx) => {
    const r = elx.getBoundingClientRect();
    gaps.push({ gap: parseInt(elx.getAttribute("data-gap"), 10) || 0, y: fr.top + r.top + r.height / 2, el: elx });
  });
  if (gaps.length) return { gaps: gaps, fr: fr };
  // FALLBACK (bars not injected yet): derive gaps from the block section rects.
  const secs = main.querySelectorAll(":scope > section, :scope > nav.block-toc");
  let lastBottom = null;
  Array.prototype.forEach.call(secs, (elx) => {
    const c = eeClassify(elx); const r = elx.getBoundingClientRect();
    if (c && c.kind === "block") { gaps.push({ gap: c.bi, y: fr.top + r.top }); lastBottom = fr.top + r.bottom; }
  });
  const appendY = lastBottom != null ? lastBottom : (fr.top + main.getBoundingClientRect().top + 8);
  gaps.push({ gap: (BLOCKS_WORK || []).length, y: appendY });
  return { gaps: gaps, fr: fr };
}
// mark ONE in-canvas insert target as the active drop-zone (AEM highlight)
function dcHiliteInsert(elx) {
  const doc = dcFrameDoc(); if (!doc) return;
  Array.prototype.forEach.call(doc.querySelectorAll(".dc-drop-active"), (n) => { if (n !== elx) n.classList.remove("dc-drop-active"); });
  if (elx) elx.classList.add("dc-drop-active");
}
function pdMove(e) {
  if (!PDRAG) return;
  const dx = e.clientX - PDRAG.startX, dy = e.clientY - PDRAG.startY;
  if (!PDRAG.begun) { if (Math.abs(dx) + Math.abs(dy) < 6) return; pdBegin(); }
  if (e.cancelable) e.preventDefault();
  const p = pdParentXY(e);
  if (PDRAG.ghost) { PDRAG.ghost.style.left = p.x + "px"; PDRAG.ghost.style.top = p.y + "px"; }
  // a Files-tab photo drag closes the panel the FIRST time it leaves the panel rect;
  // until then the panel stays put (and pdFinish won't insert — see leftPanel).
  if (PDRAG.kind === "media" && !PDRAG.leftPanel) {
    const tp = $("trayPanel"); const tr = tp && tp.getBoundingClientRect();
    if (!tr || p.x < tr.left || p.x > tr.right || p.y < tr.top || p.y > tr.bottom) {
      PDRAG.leftPanel = true; PDRAG.closedPanel = true; closeTrayPanel();
    }
  }
  // Slice C: rows dragged in the CONTENT TREE track the tree's own gaps — the same
  // single-gap list-index model. pdTreeTrack OWNS the panel bounds: it returns true
  // when it claimed the point; a top-level row carried out of the panel falls
  // through to the standard canvas tracking below (same index space, same commit).
  if ((PDRAG.zone === "tree" || PDRAG.zone === "treecol") && pdTreeTrack(p)) return;
  const info = pdGaps(); const line = document.getElementById("pdDropLine");
  if (!info) { PDRAG.lastGap = null; if (line) line.style.display = "none"; return; }
  const fr = info.fr;
  // only a valid drop when the pointer is over (or just beside) the canvas frame
  const inX = p.x >= fr.left - 24 && p.x <= fr.right + 24;
  const inY = p.y >= fr.top - 40 && p.y <= fr.bottom + 40;
  if (!inX || !inY) { PDRAG.lastGap = null; if (line) line.style.display = "none"; dcHiliteInsert(null); return; }
  const cy = Math.max(fr.top, Math.min(p.y, fr.bottom));
  const gap = pdPickGap(info.gaps, cy);
  const chosen = info.gaps.find((g) => g.gap === gap) || info.gaps[0];
  PDRAG.lastGap = gap;
  dcHiliteInsert(chosen && chosen.el ? chosen.el : null);   // light up the AEM drop-zone
  if (line) {
    const ly = Math.max(fr.top + 2, Math.min(chosen.y, fr.bottom - 4));
    line.style.display = "block";
    line.style.left = (fr.left + 14) + "px";
    line.style.width = Math.max(0, fr.width - 28) + "px";
    line.style.top = ly + "px";
  }
}
// Slice C: candidate gaps from the CONTENT TREE rows — the exact idea pdGaps()
// applies to the canvas, read from the tree instead: one "before row" gap per
// draggable row plus a trailing append gap; each carries a single LIST index.
// zone "tree" = top-level block rows (gap = the row's bi, trailing = list length);
// zone "treecol" = one container's column rows (gap = k within blk.columns).
function pdTreeGaps() {
  const host = $("designTreeList"); if (!host) return null;
  const rows = PDRAG.zone === "treecol"
    ? host.querySelectorAll('.dc-tree-row.child[data-colof="' + PDRAG.bi + '"]')
    : host.querySelectorAll(".dc-tree-row.block[data-bi]");
  if (!rows.length) return null;
  const gaps = [];
  Array.prototype.forEach.call(rows, (row, i) => {
    const r = row.getBoundingClientRect();
    const gap = PDRAG.zone === "treecol" ? i : (parseInt(row.dataset.bi, 10) || 0);
    gaps.push({ gap, y: r.top, left: r.left, width: r.width });
  });
  const last = rows[rows.length - 1].getBoundingClientRect();
  const total = PDRAG.zone === "treecol" ? rows.length : (BLOCKS_WORK || []).length;
  gaps.push({ gap: total, y: last.bottom, left: last.left, width: last.width });
  return { gaps, host };
}
// Owns the tree-panel bounds (ONE rect read, one margin constant — pdMove routes on
// the return): true = this drag's point is the tree's to handle. A "treecol" drag
// always stays here (columns never drop on the canvas); a top-level "tree" row
// outside the panel returns false and falls through to canvas tracking.
const PD_TREE_MX = 24, PD_TREE_MY = 40;
function pdTreeTrack(p) {
  const line = document.getElementById("pdDropLine");
  const host = $("designTreeList");
  const hr = host && host.getBoundingClientRect();
  const inPanel = !!hr && p.x >= hr.left - PD_TREE_MX && p.x <= hr.right + PD_TREE_MX &&
    p.y >= hr.top - PD_TREE_MY && p.y <= hr.bottom + PD_TREE_MY;
  if (!inPanel && PDRAG.zone !== "treecol") return false;
  dcHiliteInsert(null);   // a canvas drop-zone highlight never lingers over a tree drag
  const info = inPanel ? pdTreeGaps() : null;
  if (!info) { PDRAG.lastGap = null; if (line) line.style.display = "none"; return true; }
  const cy = Math.max(hr.top, Math.min(p.y, hr.bottom));
  const gap = pdPickGap(info.gaps, cy);   // the SAME single-gap resolver as the canvas
  const chosen = info.gaps.find((g) => g.gap === gap) || info.gaps[0];
  PDRAG.lastGap = gap;
  if (line) {
    line.style.display = "block";
    line.style.left = chosen.left + "px";
    line.style.width = Math.max(0, chosen.width) + "px";
    line.style.top = Math.max(hr.top + 2, Math.min(chosen.y, hr.bottom - 2)) + "px";
  }
  return true;
}
function pdFinish(commit) {
  if (!PDRAG) return;
  const drag = PDRAG; PDRAG = null;
  try { drag.sourceEl.releasePointerCapture(drag.pointerId); } catch (_) {}
  drag.sourceEl.removeEventListener("pointermove", pdMove);
  drag.sourceEl.removeEventListener("pointerup", pdEnd);
  drag.sourceEl.removeEventListener("pointercancel", pdCancel);
  window.removeEventListener("keydown", pdKeydown, true);
  document.body.classList.remove("pd-dragging");
  if (drag.ghost && drag.ghost.parentNode) drag.ghost.parentNode.removeChild(drag.ghost);
  const line = document.getElementById("pdDropLine"); if (line) line.style.display = "none";
  dcHiliteInsert(null);
  if (!drag.begun) return;               // never crossed the threshold → treat as a click
  closeInsertMenu();
  let committed = false;                 // did the drop actually change anything?
  if (commit && drag.lastGap != null) {  // a single resolved list index — never x/y
    if (drag.kind === "new") { dcAddAt(drag.type, drag.lastGap); committed = true; }
    else if (drag.kind === "move") committed = dcMove(drag.from, drag.lastGap) === true;        // canvas + tree share this commit
    else if (drag.kind === "movecol") committed = dcMoveCol(drag.bi, drag.from, drag.lastGap) === true;   // columns within a container
    else if (drag.kind === "media" && drag.leftPanel) { pfInsertImageAt(drag.mediaId, drag.lastGap); committed = true; }   // Files-tab thumb → photo section (never from inside the panel)
  }
  // swallow the follow-up click only when the drag DID something (or closed the
  // panel out from under the pointer) — a canceled/no-op jitter stays an honest
  // click: tree rows still select, thumbnails still pick.
  if (committed || drag.closedPanel) {
    PD_JUST_DRAGGED = true;
    setTimeout(() => { PD_JUST_DRAGGED = false; }, 350);   // self-clear if no click fires
  }
}
function pdEnd(e) { pdFinish(true); }
function pdCancel(e) { pdFinish(false); }
// The "+" popover: the SAME grouped, searchable add-list as the tray, but every
// pick inserts at THIS gap index (not append). One list builder, two entry points.
let INSERT_MENU = null, INSERT_MENU_OFF = [];   // what closing the menu takes back
function closeInsertMenu() {
  if (INSERT_MENU) { INSERT_MENU.remove(); INSERT_MENU = null; document.removeEventListener("keydown", insertMenuKey, true); }
  INSERT_MENU_OFF.splice(0).forEach((fn) => { try { fn(); } catch (_) {} });
}
function insertMenuKey(e) { if (e.key === "Escape") { e.stopPropagation(); closeInsertMenu(); } }
function openInsertMenu(atIndex, anchor, rectOverride) {
  closeInsertMenu();
  const menu = el("div", "blk-insertmenu"); INSERT_MENU = menu;
  // Item 82: a phone has no Escape and no hover, and a tap on the canvas never reaches this
  // page's listeners, so the menu has its own close button and a tap on the canvas closes it.
  const head = el("div"); head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px";
  head.appendChild(el("div", "tray-h", "Add a section here"));
  const x = icoBtn("x", "Close");
  x.style.cssText = "font:inherit;font-size:20px;line-height:1;min-width:44px;min-height:44px;margin:-8px -8px 0 0;border:0;background:transparent;color:var(--ink-2,#666);cursor:pointer;border-radius:10px";
  x.addEventListener("click", closeInsertMenu);
  head.appendChild(x); menu.appendChild(head);
  // If a section was copied/cut, offer to paste it right here (before the palette).
  const clip = dcClipGet();
  if (clip) {
    const cdef = BLOCK_DEFS.find((x) => x.type === clip.type);
    const pasteBtn = el("button", "tray-item"); pasteBtn.type = "button"; pasteBtn.style.cssText = "border:1px solid var(--plum,#5b3fa0);margin-bottom:8px";
    pasteBtn.appendChild(Object.assign(el("span", "ti-ico"), { innerHTML: uiIcon("clipboard") }));
    const pt = el("span", "ti-txt"); pt.appendChild(el("span", "ti-name", "Paste copied section"));
    pt.appendChild(el("span", "ti-alias", (cdef && cdef.name) || clip.type)); pasteBtn.appendChild(pt);
    pasteBtn.addEventListener("click", () => { closeInsertMenu(); dcPasteAt(atIndex); });
    menu.appendChild(pasteBtn);
  }
  const search = el("input", "tray-search"); search.type = "search"; search.placeholder = "Search sections…"; search.setAttribute("aria-label", "Search sections to add here");
  menu.appendChild(search);
  const list = el("div"); menu.appendChild(list);
  const present = new Set((BLOCKS_WORK || []).map((b) => b && b.type));
  const paint = () => {
    list.textContent = ""; let shown = 0;
    SECTION_GROUPS.forEach((grp) => {
      const defs = grp.types.map((ty) => BLOCK_DEFS.find((d) => d.type === ty))
        .filter((d) => d && !(BLOCK_SINGLETON.has(d.type) && present.has(d.type)))
        .filter((d) => trayItemMatches(d.name, SECTION_ALIAS[d.type], d.type, search.value));
      if (!defs.length) return;
      const wrap = el("div", "tray-grp shots");
      wrap.appendChild(el("div", "tray-grp-h", grp.label));
      defs.forEach((d) => {
        const b = el("button", "tray-item"); b.type = "button";
        b.appendChild(Object.assign(el("span", "ti-ico"), { innerHTML: trayIcon(d.type) }));
        const txt = el("span", "ti-txt"); txt.appendChild(el("span", "ti-name", d.name));
        if (SECTION_ALIAS[d.type]) txt.appendChild(el("span", "ti-alias", SECTION_ALIAS[d.type]));
        b.appendChild(txt);
        trayShot(b, d.type);
        b.addEventListener("click", () => { closeInsertMenu(); dcCaptureScroll(); addBlockAt(d, atIndex); if (MEDIA_FILL_TYPES.has(d.type)) { const bi = DC_FOCUS_BI; DC_FOCUS_BI = null; eeEditBlock(bi); } else { saveBlocks(); } });
        wrap.appendChild(b); shown++;
      });
      list.appendChild(wrap);
    });
    if (!shown) list.appendChild(el("div", "tray-empty", "No sections match."));
  };
  search.addEventListener("input", paint); paint();
  document.body.appendChild(menu);
  // position under the anchor (a "+" gap, a tree row, or an in-canvas insert bar —
  // rectOverride carries parent-viewport coords when the anchor lives in the iframe).
  // Clamped to the viewport; it's a fixed layer, not XY page content.
  const r = rectOverride || (anchor && anchor.getBoundingClientRect()) || { bottom: 80, left: 80 };
  menu.style.position = "fixed";
  menu.style.top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 20 - menu.offsetHeight)) + "px";
  menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + "px";
  document.addEventListener("keydown", insertMenuKey, true);
  setTimeout(() => { try { search.focus(); } catch (_) {} }, 20);
  const off = (e) => { if (INSERT_MENU && !INSERT_MENU.contains(e.target) && e.target !== anchor) closeInsertMenu(); };
  const fdoc = dcFrameDoc();
  const offCanvas = () => { if (INSERT_MENU) closeInsertMenu(); };
  setTimeout(() => {
    if (INSERT_MENU !== menu) return;   // already closed
    document.addEventListener("mousedown", off, true);
    if (fdoc) fdoc.addEventListener("pointerdown", offCanvas, true);
    INSERT_MENU_OFF.push(() => document.removeEventListener("mousedown", off, true), () => { if (fdoc) fdoc.removeEventListener("pointerdown", offCanvas, true); });
  }, 0);
}

// ── CP-2.5: live style preview — the EXISTING /preview pipeline, nothing new ──
let designPreviewTimer = null;
function dpNote(title, body, act) {
  const box = $("designPreviewEmpty"); if (!box) return;
  const t = $("dpEmptyTitle"), b = $("dpEmptyBody");
  if (t) t.textContent = title;
  if (b) b.textContent = body;
  // builder item 314: a note can carry its own one way forward in place of the two starting links
  const ea = box.querySelector(".ea");
  if (ea) {
    ea.querySelectorAll(".dp-act").forEach((n) => n.remove());
    Array.prototype.forEach.call(ea.children, (n) => { n.hidden = !!act; });
    if (act) { const a = el("button", "textact dp-act", act.label); a.type = "button"; a.addEventListener("click", act.run); ea.appendChild(a); }
  }
  box.hidden = false;
}
// Item 314 with item 297: the FAQ and Updates pages are not drawn until they have something on
// them, so opening one on the canvas says that and offers the card that fills it.
function dpBuiltinEmpty() {
  const bp = dcBuiltinPage(); if (!bp) return false;
  const frame = $("designPreview"); if (frame) frame.srcdoc = "";
  if (bp.key === "faq") dpNote("Your FAQ page isn’t on your site yet.", "It appears, here and on your live site, once it has a question.", { label: "Add a question →", run: () => eeEditCore("faqs") });
  else if (bp.key === "updates") dpNote("Your Updates page isn’t on your site yet.", "It appears, here and on your live site, once an update is published.", { label: "Write an update →", run: () => eeEditCore("updates") });
  else dpNote("This page isn’t on your site yet.", "It appears once there is something on it.", { label: "Change what’s on it →", run: () => eeEditCore(bp.view) });
  return true;
}
// G13: a repaint replaces the canvas document, and the caret and every later
// keystroke of an open in-place session would go with it — so it waits for the
// session to end (ipeEnd runs it). A commit still in its debounce holds it off too:
// that save repaints when it lands, and a read now would flash the old text back.
let DP_REPAINT_HELD = false;
let DP_PAINT_OPEN = 0;   // the page opening (DC_PAGE_OPENS) the last document written to the canvas belongs to
// Reads are numbered, and one never paints over a newer one's document. Dropping all but
// the newest would leave a stream of edits with slow reads never painting at all.
let DP_READS = 0, DP_READ_PAINTED = 0;
function dpHoldRepaint() {
  if (IPE || IDE || IDE_SAVING) { DP_REPAINT_HELD = true; return true; }
  return IPE_SAVE_T != null || IPE_SAVE_PENDING;
}
function refreshDesignPreview() {
  const frame = $("designPreview"); if (!frame) return;
  // Drawing a canvas nobody can see is a full page render per save. Opening Edit mode
  // repaints it (go), so it is never stale when it's on screen.
  if (!$("view-design").classList.contains("on")) return;
  // Slice D: a past version is on the canvas (Timewarp) — leave it there until
  // "Back to today"; the draft repaint happens on the mode change back to Edit.
  if (DC_MODE === "timewarp" && DC_TW_LOADED) return;
  DC_DRAWN = true;   // item 85: asked for at least once on this page
  clearTimeout(designPreviewTimer);
  designPreviewTimer = setTimeout(async () => {
    // Re-check at fire time AND after the fetch — a Timewarp render may have
    // landed while this repaint was debouncing or in flight; never paint the
    // draft over it while the banner still claims a past date.
    if (DC_MODE === "timewarp" && DC_TW_LOADED) return;
    if (dpHoldRepaint()) return;
    // ALWAYS render the canvas — even a brand-new draft gets a page to build ON.
    // The render engine returns a valid scaffold (nav · footer · whatever content
    // exists); dcInjectCanvas then lays a big "add your first section" drop zone
    // right on it (AEM's "Drag components here" box), so the empty page is a real
    // build surface, not a dead sheet. No early-return-on-empty any more.
    const opened = DC_PAGE_OPENS, read = ++DP_READS;
    try {
      const path = dcPagePath();   // multi-page: preview the CURRENT page
      const html = await apiHtml("/preview?version=draft&page=" + encodeURIComponent(path));
      if (opened !== DC_PAGE_OPENS) return;   // the page changed while this read was out; the new page has its own
      if (read < DP_READ_PAINTED) return;
      if (DC_MODE === "timewarp" && DC_TW_LOADED) return;
      if (dpHoldRepaint()) return;   // a session may have opened while that read was in flight
      DP_PAINT_OPEN = opened; DP_READ_PAINTED = read;
      frame.srcdoc = frameWall(html);   // item 190
      const box = $("designPreviewEmpty"); if (box) { box.hidden = true; box.classList.remove("plan"); }
    } catch (err) {
      if (opened !== DC_PAGE_OPENS || read < DP_READ_PAINTED) return;
      // a plan without the website builder: say that, not "try again" — it can't work
      if (err && err.status === 403) {
        DP_PAINT_OPEN = opened; DP_READ_PAINTED = read;
        frame.srcdoc = "";
        const box = $("designPreviewEmpty"); if (box) box.classList.add("plan");
        dpNote("Editing isn’t part of this plan.", "This plan watches a website that lives somewhere else. Design opens up on a plan with the website builder.");
        return;
      }
      if (err && err.status === 404 && dpBuiltinEmpty()) { DP_PAINT_OPEN = opened; DP_READ_PAINTED = read; return; }   // item 314 with 297
      // the big proof ("See your site") still works — say so rather than staying blank,
      // or on the page just left
      if (!frame.srcdoc || frame.inert) dpNote("The preview couldn’t load just now.",
        "Your content is safe. It’ll appear here on your next change, or use Preview above to see the whole site.");
    }
  }, 350);
}
let DC_FOCUS_BI = null; // a just-added/dropped block index → scroll the canvas to it + flash it after reload
// ── Builder item 318: the page moves the moment a section is added, moved, copied or deleted ──
// Each splice below finds its section on the canvas BEFORE the list changes (the stamps and
// DDS_SRCMAP still describe the old list), changes the list, then moves, removes or puts in
// the drawing at once. The save goes out as before and its redraw lands over this; a save the
// server refuses puts the list and the page back (putBlocks). A section drawn here carries a
// stamp no server render uses, mapped in DDS_SRCMAP, so a press on it resolves until the redraw.
let DC_FRESH_N = 0;
let DC_FOCUS_SOFT = false;   // the redraw keeps the section in view without flashing it again
function dcCanvasMain() { const doc = dcFrameDoc(), main = doc && doc.getElementById("main"); return main ? { doc, main } : null; }
function dcCanvasEl(bi) { const c = dcCanvasMain(); if (!c) return null; const hit = dcBlockSections(c.main).find((s) => s.bi === bi); return hit ? hit.el : null; }
// where a section at list index `at` goes: before the section now at `at`, else after the last one
function dcCanvasSlot(at) {
  const c = dcCanvasMain(); if (!c) return null;
  const list = dcBlockSections(c.main), before = list.find((s) => s.bi === at);
  return { doc: c.doc, main: c.main, before: before ? before.el : null, after: !before && list.length ? list[list.length - 1].el : null };
}
function dcStampFresh(el2, bi) {
  const key = 100000 + (++DC_FRESH_N);
  el2.setAttribute("data-dds-src", String(key)); el2.removeAttribute("data-dds-sid"); el2.removeAttribute("data-dds-key"); el2.removeAttribute("id");
  el2.setAttribute("data-dc-fresh", "1");
  if (!DDS_SRCMAP) dcComposeSrcMap((BLOCKS_WORK || []).length, (v) => v);
  DDS_SRCMAP[key] = bi;
}
function dcCanvasPut(slot, el2) {
  if (!slot) return false;
  if (slot.before) slot.before.before(el2);
  else if (slot.after) slot.after.after(el2);
  else { const z = slot.main.querySelector(".dc-emptyzone"); if (z) z.before(el2); else slot.main.appendChild(el2); }
  return true;
}
function dcCanvasShow(el2, flash, bi) {
  try {
    el2.scrollIntoView({ block: "nearest", behavior: pdReducedMotion() ? "auto" : "smooth" });
    if (flash) { el2.classList.add("dc-justadded"); setTimeout(() => { try { el2.classList.remove("dc-justadded"); } catch (_) {} }, 1500); }
    const doc = el2.ownerDocument; if (doc.__dcShowBar && !IPE && window.innerWidth > 760) doc.__dcShowBar(el2);
  } catch (_) {}
  if (bi != null) { DC_FOCUS_BI = bi; DC_FOCUS_SOFT = true; }   // the redraw keeps it in view, quietly
  DC_SCROLL = null;
}
function dcCanvasDrop(el2) { try { const doc = el2.ownerDocument; if (doc.__dcHideBar) doc.__dcHideBar(); el2.remove(); } catch (_) {} dcCaptureScroll(); }
// A section added here shows as a named placeholder until the save's redraw draws it for real.
function dcGhostSection(doc, name) {
  const s = doc.createElement("section"); s.className = "block wrap dc-ghost"; s.setAttribute("aria-busy", "true");
  const inner = doc.createElement("div"); inner.className = "dc-ghost-in"; inner.textContent = "Adding " + name + "…"; s.appendChild(inner);
  return s;
}
function dcCanvasAdded(bi, slot) {
  const c = dcCanvasMain(); if (!c || !slot) return;
  const def = BLOCK_DEFS.find((x) => x.type === (BLOCKS_WORK[bi] || {}).type) || {};
  const ghost = dcGhostSection(c.doc, (def.name || "section").toLowerCase());
  dcStampFresh(ghost, bi); dcCanvasPut(slot, ghost); dcCanvasShow(ghost, true, bi);
}

// ── canvas block ops — all REUSE the existing list model, then persist + redraw ──
// saveBlocks() PUTs /settings then refreshDesignPreview(), which reloads the iframe;
// the load handler re-injects the chrome and restores scroll. Nothing goes live
// until Publish.
function dcAddAt(type, gap) { const def = BLOCK_DEFS.find((x) => x.type === type); if (!def) return; dcCaptureScroll(); addBlockAt(def, gap); if (MEDIA_FILL_TYPES.has(type)) { const bi = DC_FOCUS_BI; DC_FOCUS_BI = null; eeEditBlock(bi); } else { saveBlocks(); } }
// PURE — where list index bi lands after ONE move of `from` to resolved slot
// `to` (dndDropIndex). The single permutation both stale-map compensations
// below apply; extracted so the gate can pin it. Never x/y — index math only.
function dcPermuteIndex(bi, from, to) {
  if (bi === from) return to;
  if (bi > from) bi -= 1;
  if (bi >= to) bi += 1;
  return bi;
}
// PURE sibling of dcPermuteIndex — where list index i lands after ONE non-move
// splice. delta -1 = a removal at `at`: i < at unchanged; i === at → -1 (that
// section is GONE — eeClassify's bounds-check rejects -1, taking the same
// sid-join/panel fallback a LAST-section delete already escaped through, never
// a wrong-but-in-range block); i > at shifts down. delta +1 = an insertion at
// `at`: i >= at shifts up. An i that is already -1 stays -1 (gone is gone,
// however many edits stack on top). Index math only — never x/y (moat).
function dcShiftIndex(i, at, delta) {
  if (i < 0) return -1;
  if (delta < 0) return i < at ? i : (i === at ? -1 : i - 1);
  return i >= at ? i + 1 : i;
}
// G13 fix (review finding 1): EVERY local splice of BLOCKS_WORK — not just
// dcMove's reorder — leaves the canvas DOM's data-dds-src stamps stale until
// the debounced save's reload re-stamps them (~1-3s), so a second quick action
// on the old DOM would hit the wrong section. Each splice site composes its
// index transform HERE, over the CURRENT map state, so stacked quick edits
// keep resolving. The map's keys are the DOM's stamp values — the keys the map
// already has once it exists (the stamp domain is the list AT LAST RELOAD, so
// it must survive later length changes), else 0..n-1 for the PRE-splice length
// `n` callers pass. dcInjectCanvas resets the map when a fresh render lands.
// Item 79: a move or removal from a panel shifts the canvas's stamps the way the toolbar's
// does (dcMove, dcDelete), so a hover, Edit, Hide or Delete on the canvas before the redraw
// acts on the section it shows, not the neighbour now at that index.
function panelSwap(idx, to) {
  const o = BLOCKS_WORK;
  const a = dcCanvasEl(idx), b = dcCanvasEl(to);   // item 318: the two on the page swap too
  [o[to], o[idx]] = [o[idx], o[to]];
  if (a && b) { const mark = a.ownerDocument.createComment("swap"); a.replaceWith(mark); b.replaceWith(a); mark.replaceWith(b); dcCanvasShow(a, false, to); }
  if (DDS_SIDMAP) Object.keys(DDS_SIDMAP).forEach((sid) => { DDS_SIDMAP[sid] = dcPermuteIndex(DDS_SIDMAP[sid], idx, to); });
  dcComposeSrcMap(o.length, (v) => dcPermuteIndex(v, idx, to));
}
function panelRemove(idx) {
  const el2 = dcCanvasEl(idx);
  dcComposeSrcMap(BLOCKS_WORK.length, (v) => dcShiftIndex(v, idx, -1));   // before the splice, like dcDelete
  BLOCKS_WORK.splice(idx, 1);
  if (el2) dcCanvasDrop(el2);   // item 318: off the page at once
}
function dcComposeSrcMap(n, fn) {
  const prev = DDS_SRCMAP, next = {};
  const keys = prev ? Object.keys(prev) : Array.from({ length: n }, (_, v) => v);
  keys.forEach((k) => { next[k] = fn(prev ? prev[k] : Number(k)); });
  DDS_SRCMAP = next;
}
function dcMove(from, gap) {
  dcSoloEnd();
  dcCaptureScroll();
  const el2 = dcCanvasEl(from), slot = dcCanvasSlot(gap);   // item 318: read before the list moves
  if (!moveBlockTo(from, gap)) return false;   // dropped back onto its own slot → no save, no reload
  if (el2 && slot && slot.before !== el2 && slot.after !== el2) { dcCanvasPut(slot, el2); dcCanvasShow(el2, false, dndDropIndex(from, gap)); }
  // BLOCKS_WORK just changed under the tree's feet: shift the sid→index map by
  // the same permutation, then rebuild the tree NOW — its data-bi stamps and
  // pointerdown closures must match BLOCKS_WORK even if the save/reload never
  // lands. (The save's /settings response then replaces this with server truth.)
  const to = dndDropIndex(from, gap);
  if (DDS_SIDMAP) Object.keys(DDS_SIDMAP).forEach((sid) => { DDS_SIDMAP[sid] = dcPermuteIndex(DDS_SIDMAP[sid], from, to); });
  // G13 fix: the DOM's data-dds-src stamps went stale the same way (the canvas
  // only re-stamps on reload) — COMPOSE the same permutation into the local
  // remap eeClassify applies over them. Unlike DDS_SIDMAP this is NOT replaced
  // by the /settings response (the old DOM stays stamped with pre-move indices
  // even after the save lands); it resets when dcInjectCanvas sees fresh stamps.
  dcComposeSrcMap((BLOCKS_WORK || []).length, (v) => dcPermuteIndex(v, from, to));
  dcRefreshTree();
  saveBlocks();
  return true;
}
// Slice C: reorder one COLUMN inside its container — the same single-gap list
// semantics as top-level moves (spliceMove/dndDropIndex), never x/y; saves like
// dcMove. The column object moves whole (span, image, nested component ride along).
function dcMoveCol(bi, from, gap) {
  const b = (BLOCKS_WORK || [])[bi]; if (!b || !Array.isArray(b.columns)) return false;
  if (!spliceMove(b.columns, from, gap)) return false;
  dcCaptureScroll();
  renderBlocksCard();
  dcRefreshTree();   // fresh data-k stamps + widths immediately, not only after the reload
  saveBlocks();
  return true;
}
// ── Item 155: locked sections ──
// The studio locks a section from its More menu so the client can't move, restyle, copy or
// delete it by accident: the section carries lock: { id, words } (lib/section_lock.ts on the
// server refuses a client's save that would break it). With words open the client can still
// change its words. The client sees a padlock in its name and fewer tools; only the studio
// unlocks, and the studio is never held by its own lock. A copy is never locked.
const blkLock = (b) => (b && b.lock && typeof b.lock.id === "string" ? b.lock : null);
// Item 195 (review finding 29): who may lock is decided as the server decides it
// (lib/actor_kind.ts): platform staff, or a studio working inside its client (?client=, a scope
// the server granted). On its own site a studio is that site's owner, so its lock would be refused.
const locksAsStudio = () => { const c = S.ctx; return !!(c && (c.is_operator || (c.scope && c.scope.site_id))); };
const lockedForMe = (b) => !!blkLock(b) && !locksAsStudio();
const LOCK_SAY = "Your studio locked this section so it stays as designed.";
const LOCK_PAGE_SAY = "Your studio locked a section on this page";
// Every way to move, copy, cut or delete a section asks this first (the tools are hidden too).
function lockStop(bi) { if (!lockedForMe(BLOCKS_WORK[bi])) return false; toast(LOCK_SAY + " Ask them if it needs to change.", true); return true; }
async function dcLockBlock(bi, on, words) {
  const b = BLOCKS_WORK[bi]; if (!b) return;
  if (on) {
    const id = blkLock(b) ? b.lock.id : "lk-" + ((crypto.randomUUID && crypto.randomUUID().replace(/-/g, "").slice(0, 12)) || Date.now().toString(36));
    b.lock = { id, words: words === undefined ? (blkLock(b) ? b.lock.words : true) : !!words };
  } else delete b.lock;
  renderBlocksCard();
  if (!(await saveBlocks())) return;   // item 195: said only once it saved; a refusal puts the list back and says why
  toast(!on ? "Unlocked: your client can change this section again"
    : words === undefined ? "Locked: your client can change its words, nothing else" : (b.lock.words ? "Your client can change its words" : "Your client can’t change its words either"));
}
function dcDuplicate(bi) {
  dcSoloEnd();
  const b = BLOCKS_WORK[bi]; if (!b || lockStop(bi)) return;
  const def = BLOCK_DEFS.find((x) => x.type === b.type);
  const copy = JSON.parse(JSON.stringify(b)); delete copy._clEdit; delete copy.lock;
  if (def && def.multi) copy.id = uniqueBlockId(b.type);   // multi-instance blocks get a fresh render key
  // G13 fix (review finding 1): compose the insertion shift BEFORE the splice.
  const src = dcCanvasEl(bi);   // item 318: the copy is drawn from the original at once
  dcCaptureScroll(); dcComposeSrcMap(BLOCKS_WORK.length, (v) => dcShiftIndex(v, bi + 1, 1)); BLOCKS_WORK.splice(bi + 1, 0, copy); BLOCK_FOCUS = bi + 1; DC_FOCUS_BI = bi + 1; renderBlocksCard();
  if (src) { const nu = src.cloneNode(true); nu.classList.remove("dc-hot"); nu.removeAttribute("data-dc"); dcStampFresh(nu, bi + 1); src.after(nu); try { dcInjectCanvas(src.ownerDocument, src.parentElement, true); } catch (_) {} dcCanvasShow(nu, true, bi + 1); }
  saveBlocks();
}
async function dcDelete(bi) {
  dcSoloEnd();
  const b = BLOCKS_WORK[bi]; if (!b || lockStop(bi)) return;
  const def = BLOCK_DEFS.find((x) => x.type === b.type);
  if (!(await askYes("Delete this " + (((def && def.name) || "section").toLowerCase()) + "? Your live site is unchanged until you publish.", { ok: "Delete", danger: true }))) return;
  bi = BLOCKS_WORK.indexOf(b); if (bi < 0) return;   // read again: the list can move while the question is up
  const el2 = dcCanvasEl(bi);
  // G13 fix (review finding 1): compose the removal shift BEFORE the splice
  // (pre-splice length = the DOM's stamp domain) so stale stamps keep resolving.
  dcCaptureScroll(); dcComposeSrcMap(BLOCKS_WORK.length, (v) => dcShiftIndex(v, bi, -1)); BLOCKS_WORK.splice(bi, 1); renderBlocksCard();
  if (el2) dcCanvasDrop(el2);   // item 318: gone from the page at once
  saveBlocks();
}
// ── Copy / Cut / Paste a section (AEM parity) — a section clipboard ─────────────
// The clipboard holds ONE section (deep copy), persisted to sessionStorage so it
// survives navigation within the studio. Pasting deep-copies again and gives any
// MULTI-instance block (columns/cards/form/tabs id-keyed) a fresh unique id so its
// render key never collides. Structured blocks only — never raw HTML.
const DC_CLIP_KEY = "dds-section-clip";
function dcClipGet() { try { return JSON.parse(sessionStorage.getItem(DC_CLIP_KEY) || "null"); } catch (_) { return null; } }
function dcClipSet(b) { try { sessionStorage.setItem(DC_CLIP_KEY, JSON.stringify(b)); } catch (_) {} }
function dcCopyBlock(bi) {
  const b = BLOCKS_WORK[bi]; if (!b) return;
  const copy = JSON.parse(JSON.stringify(b)); delete copy._clEdit; delete copy.lock;   // item 155: a copy is never locked
  dcClipSet(copy);
  const def = BLOCK_DEFS.find((x) => x.type === b.type);
  toast("Copied “" + ((def && def.name) || "section") + "” — use the ＋ points to paste it");
}
function dcCutBlock(bi) {
  dcSoloEnd();
  const b = BLOCKS_WORK[bi]; if (!b || lockStop(bi)) return;
  dcCopyBlock(bi);
  const el2 = dcCanvasEl(bi);
  // G13 fix (review finding 1): same removal shift as dcDelete, pre-splice.
  dcCaptureScroll(); dcComposeSrcMap(BLOCKS_WORK.length, (v) => dcShiftIndex(v, bi, -1)); BLOCKS_WORK.splice(bi, 1); renderBlocksCard();
  if (el2) dcCanvasDrop(el2);   // item 318
  saveBlocks();
  toast("Cut — paste it anywhere with the ＋ points");
}
function dcPasteAt(gap) {
  dcSoloEnd();
  const clip = dcClipGet(); if (!clip) { toast("Nothing copied yet"); return; }
  const blk = JSON.parse(JSON.stringify(clip)); delete blk._clEdit; delete blk.lock;
  if (blk.id) blk.id = uniqueBlockId(blk.type + "_" + blk.id);   // MULTI blocks get a fresh render key
  const at = Math.max(0, Math.min(gap == null ? BLOCKS_WORK.length : gap, BLOCKS_WORK.length));
  const slot = dcCanvasSlot(at);
  // G13 fix (review finding 1): compose the insertion shift BEFORE the splice.
  dcCaptureScroll(); dcComposeSrcMap(BLOCKS_WORK.length, (v) => dcShiftIndex(v, at, 1)); BLOCKS_WORK.splice(at, 0, blk); BLOCK_FOCUS = at; DC_FOCUS_BI = at; renderBlocksCard();
  dcCanvasAdded(at, slot);   // item 318
  saveBlocks();
}
const DCK_ARIA = { "⌘": "Meta", Ctrl: "Control", "⌥": "Alt", Alt: "Alt", "⇧": "Shift", Shift: "Shift", "⌫": "Backspace", Delete: "Delete", "↑": "ArrowUp", "↓": "ArrowDown" };
const dcKeysAria = (keys) => keys.map((k) => DCK_ARIA[k] || k).join("+");
function dcSectionActions(el2) {
  const c = eeClassify(el2), out = [];
  if (!c) return out;
  if (c.kind === "block") {
    const bi = c.bi, b = BLOCKS_WORK[bi] || {}, n = (BLOCKS_WORK || []).length;
    if (lockedForMe(b)) {   // item 155: a locked section offers its words at most
      if (b.lock.words) out.push({ id: "edit", label: "Edit words", icon: "pencil", keys: ["Enter"], run: () => eeEditBlock(bi) });
      return out;
    }
    out.push({ id: "edit", label: "Edit section", icon: "pencil", keys: ["Enter"], run: () => eeEditBlock(bi) });
    out.push({ id: "style", label: "Style", icon: "spark", run: () => eeEditBlock(bi, "style") });
    out.push({ id: "dup", label: "Duplicate", icon: "copy", keys: [DCK.mod, "D"], run: () => dcDuplicate(bi) });
    out.push(null);
    out.push({ id: "copy", label: "Copy", icon: "clipboard", keys: [DCK.mod, "C"], run: () => dcCopyBlock(bi) });
    out.push({ id: "cut", label: "Cut", icon: "scissors", keys: [DCK.mod, "X"], run: () => dcCutBlock(bi) });
    if (dcClipGet()) out.push({ id: "paste", label: "Paste below", icon: "clipboard", keys: [DCK.mod, "V"], run: () => dcPasteAt(bi + 1) });
    out.push(null);
    out.push({ id: "up", label: "Move up", icon: "up", keys: [DCK.alt, "↑"], off: bi <= 0, run: () => dcMove(bi, bi - 1) });
    out.push({ id: "down", label: "Move down", icon: "down", keys: [DCK.alt, "↓"], off: bi >= n - 1, run: () => dcMove(bi, bi + 2) });
    out.push({ id: "hide", label: "Hide on this page", icon: "eyeoff", run: () => eeHideKey(el2.getAttribute("data-dds-key") || ddsKeyFor(bi)) });
    if (S.isStudio) out.push(blkLock(b)   // only the studio locks and unlocks
      ? { id: "lock", label: "Unlock", icon: "unlock", run: () => dcLockBlock(bi, false) }
      : { id: "lock", label: "Lock this section", icon: "lock", run: () => dcLockBlock(bi, true) });
    out.push(null);
    out.push({ id: "del", label: "Delete", icon: "trash", keys: [DCK.del], danger: true, run: () => dcDelete(bi) });
  } else {   // a built-in section: the same few things its tools offer
    const keys = el2.parentElement ? dcCoreKeys(el2.parentElement) : [], at = c.key ? keys.indexOf(c.key) : -1;
    out.push({ id: "edit", label: "Edit section", icon: "pencil", keys: ["Enter"], run: () => eeEditCore(c.view) });
    if (at >= 0) {
      out.push(null);
      out.push({ id: "up", label: "Move up", icon: "up", keys: [DCK.alt, "↑"], off: at <= 0, run: () => dcMoveCore(c.key, -1) });
      out.push({ id: "down", label: "Move down", icon: "down", keys: [DCK.alt, "↓"], off: at >= keys.length - 1, run: () => dcMoveCore(c.key, 1) });
    }
    if (c.key) { out.push(null); out.push({ id: "remove", label: "Remove from the page", icon: "x", danger: true, run: () => eeHideKey(c.key) }); }
  }
  return out;
}
// the action a key press asks for, or null
function dcKeyAction(e) {
  const mod = KEY_MAC ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey, k = (e.key || "").toLowerCase();
  if (mod && !e.altKey && !e.shiftKey) return ({ d: "dup", c: "copy", x: "cut", v: "paste" })[k] || null;
  if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey) return e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : null;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  return e.key === "Enter" ? "edit" : (e.key === "Backspace" || e.key === "Delete") ? "del" : null;
}
// the section the keys work on: the one whose tools are showing (a pointer, a tap or a right-click picked it)
function dcPickedSection() {
  const d = dcFrameDoc(); if (!d) return null;
  const st = d.__dcBarState, bar = d.getElementById("dds-dc-bar");
  return st && st.current && st.current.isConnected && bar && bar.classList.contains("on") ? st.current : null;
}
const dcTyping = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "") || !!t.isContentEditable);
function dcHasSelection() {
  const d = dcFrameDoc();
  return !!(String(window.getSelection ? window.getSelection() : "").trim() || (d && d.getSelection && String(d.getSelection()).trim()));
}
// Keys on the editor (inDoc is the page's own document when the press happened inside it).
// They never fire while someone is typing in a box or in the page's words, and only in the editor.
function dcEditorKey(e, inDoc) {
  const dv = $("view-design"); if (!dv || !dv.classList.contains("on") || e.defaultPrevented || dcTyping(e.target)) return;
  if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {   // the list, in place of the shell's general one
    if (DCK_DLG) { e.preventDefault(); e.stopImmediatePropagation(); DCK_DLG.close(); return; }
    if (document.querySelector("dialog[open]")) return;
    e.preventDefault(); e.stopImmediatePropagation(); dcKeysSheet(); return;
  }
  if (DC_MODE !== "edit" || IPE || IDE || PDRAG || document.querySelector("dialog[open], .scrim.on")) return;
  if ($("stage").classList.contains("on") || $("ritualWrap").classList.contains("on")) return;
  const id = dcKeyAction(e); if (!id) return;
  if (stkKey(e, id, inDoc || document)) return;   // item 57: with a block picked, the keys work on the block
  const el2 = dcPickedSection(); if (!el2) return;
  // Enter and Delete belong to whatever has the focus; they reach the section only from the page itself
  const home = inDoc || document;
  if ((id === "edit" || id === "del") && e.target !== home.body && e.target !== home.documentElement && e.target !== home) return;
  if ((id === "copy" || id === "cut") && dcHasSelection()) return;   // words someone selected stay the browser's to copy
  const c = eeClassify(el2);
  if (c && c.kind === "block" && id !== "edit" && lockStop(c.bi)) { e.preventDefault(); return; }
  const act = dcSectionActions(el2).find((a) => a && a.id === id);
  if (!act || act.off) return;
  e.preventDefault(); e.stopPropagation();
  act.run();
}
document.addEventListener("keydown", (e) => dcEditorKey(e, null), true);   // ahead of the shell's own keys
// a press anywhere in the editor around the page closes a right-click menu left open on it
document.addEventListener("pointerdown", () => { const d = dcFrameDoc(); if (d && d.__dcCloseCtx) d.__dcCloseCtx(false); }, true);
// Pressed inside the page, the editor's own keys still work: undo, redo, Escape and the search.
function dcFrameKeys(doc) {
  doc.addEventListener("keydown", (e) => {
    dcEditorKey(e, doc);
    if (e.defaultPrevented || dcTyping(e.target) || IPE || IDE) return;
    const mod = e.metaKey || e.ctrlKey, k = (e.key || "").toLowerCase();
    if (!(mod && (k === "z" || k === "y" || k === "k")) && e.key !== "Escape") return;
    e.preventDefault();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: e.key, code: e.code, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, bubbles: true, cancelable: true }));
  });
}
// The list of keys, from ? or the foot of the right-click menu. Esc or Done closes it.
let DCK_DLG = null;
function dcKeysSheet() {
  if (DCK_DLG) { DCK_DLG.close(); return; }
  const back = document.activeElement;
  const dlg = el("dialog", "dck-sheet"); dlg.setAttribute("aria-labelledby", "dckTitle");
  const head = el("div", "dck-head"), hx = el("div"), h = el("h2", null, "Keyboard shortcuts"); h.id = "dckTitle";
  hx.append(h, el("p", null, "Press ? anywhere in the editor to see this."));
  const done = el("button", "dck-done", "Done"); done.type = "button";
  head.append(hx, done); dlg.appendChild(head);
  const group = (title, rows) => {
    dlg.appendChild(el("div", "dck-grp", title));
    rows.forEach(([what, keys]) => {
      const r = el("div", "dck-row"); r.appendChild(el("span", null, what));
      const ks = el("span", "dck-keys"); keys.forEach((k) => ks.appendChild(el("kbd", null, k))); r.appendChild(ks);
      dlg.appendChild(r);
    });
  };
  group("Anywhere in the editor", [["Undo", [DCK.mod, "Z"]], ["Redo", [DCK.shift, DCK.mod, "Z"]], ["Close the open card", ["Esc"]], ["Search Studio OS", [DCK.mod, "K"]], ["This list", ["?"]]]);
  group("The section you picked", [["Edit it", ["Enter"]], ["Duplicate it", [DCK.mod, "D"]], ["Copy, cut, paste below", [DCK.mod, "C", "X", "V"]], ["Move it up or down", [DCK.alt, "↑", "↓"]], ["Delete it (asks first)", [DCK.del]]]);
  group("A block you picked", [["Copy it", [DCK.mod, "D"]], ["Move it up or down", [DCK.alt, "↑", "↓"]], ["Delete it", [DCK.del]], ["Back to the whole section", ["Esc"]]]);
  dlg.appendChild(el("p", "dck-note", (KEY_MAC ? "On a Windows computer, Ctrl takes the place of ⌘ and Alt of ⌥." : "On a Mac, ⌘ takes the place of Ctrl and ⌥ of Alt.")
    + " Keys never fire while you are typing in a box or in the page’s words."));
  document.body.appendChild(dlg);
  let shut = false;
  const close = () => { if (shut) return; shut = true; DCK_DLG = null; try { dlg.close(); } catch (_) {} dlg.remove(); if (back && back.isConnected) { try { back.focus({ preventScroll: true }); } catch (_) {} } };
  done.addEventListener("click", close);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  DCK_DLG = { close };
  dlg.showModal(); done.focus();
}
// ── column controls (responsive grid) — PURE helpers, extracted + unit-tested ──
// The Columns block is the render engine's LAYOUT CONTAINER (Adobe Layout Mode):
// 1–6 columns on a 12-unit responsive grid, each column spanning part of the grid,
// all stacking to one column below 620px (site_blocks.ts cols-grid). Two knobs only,
// both integers on a grid — never x/y: the column COUNT and each column's WIDTH
// (span 1–12). Widths are resized right on the canvas by dragging the divider
// between two columns (snaps to the grid) — see dcInjectColControls / dcColResize.
function dcClampColumns(n) { n = Math.round(Number(n) || 0); return n < 1 ? 1 : (n > 6 ? 6 : n); }
function dcResizeColumns(cols, n) { n = dcClampColumns(n); const out = Array.isArray(cols) ? cols.slice(0, n) : []; while (out.length < n) out.push({ body: "" }); return out; }
// Distribute the 12 grid units as evenly as possible across n columns; the leftmost
// columns get any remainder. Always integers that sum to exactly 12.
function dcEqualSpans(n) { n = dcClampColumns(n); const base = Math.floor(12 / n), rem = 12 - base * n; return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0)); }
function dcRebalanceSpans(b) { if (!b || !Array.isArray(b.columns)) return; const s = dcEqualSpans(b.columns.length); b.columns.forEach((c, i) => { if (c) c.span = s[i]; }); }
// The spans to paint on the live canvas: the column's own span, or an equal share.
function dcLiveSpans(b, n) {
  const cols = Array.isArray(b.columns) ? b.columns : []; const eq = dcEqualSpans(n);
  return eq.map((e, i) => { const c = cols[i]; return (c && c.span >= 1 && c.span <= 12) ? c.span : e; });
}
async function dcSetColumns(bi, n) {
  const b = BLOCKS_WORK[bi]; if (!b || b.type !== "columns") return;
  n = dcClampColumns(n); const cur = Array.isArray(b.columns) ? b.columns : [];
  if (n < cur.length && cur.slice(n).some((c) => c && (c.body || c.image_id || c.button)) &&
    !(await askYes("Show " + n + " column" + (n === 1 ? "" : "s") + "? The extra column’s content will be removed.", { ok: "Remove the extra content", danger: true }))) return;
  if (BLOCKS_WORK.indexOf(b) < 0) return;   // gone while the question was up
  b.columns = dcResizeColumns(Array.isArray(b.columns) ? b.columns : [], n);
  dcRebalanceSpans(b);   // reset to even widths for the new count
  dcCaptureScroll(); renderBlocksCard(); saveBlocks();
}
// ── on-canvas column resize (drag the divider; snaps to the 12-grid) ──
// Injected per columns block. Dragging the handle between column i and i+1 shifts
// grid units between just those two (their total stays fixed), snapping to whole
// units and showing the grid guide — Adobe's blue-dot column resize. Persists on
// release. Reuses pointer-capture, so it never loses the drag over the iframe.
let DC_COLR = null;
function dcColResizeStart(e, g, i) {
  e.preventDefault(); e.stopPropagation();
  const rect = g.grid.getBoundingClientRect(); const unit = rect.width / 12;
  const spans = g.cols.map((c) => parseInt(c.getAttribute("data-span") || "0", 10) || 1);
  DC_COLR = { g: g, i: i, unit: unit, startX: e.clientX, spans: spans, handle: e.currentTarget };
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
  e.currentTarget.addEventListener("pointermove", dcColResizeMove);
  e.currentTarget.addEventListener("pointerup", dcColResizeEnd);
  e.currentTarget.addEventListener("pointercancel", dcColResizeEnd);
  g.grid.classList.add("dc-grid-show");
}
function dcColResizeMove(e) {
  if (!DC_COLR) return;
  const { g, i, unit, startX, spans } = DC_COLR;
  const total = spans[i] + spans[i + 1];
  let a = spans[i] + Math.round((e.clientX - startX) / (unit || 1));
  a = Math.max(1, Math.min(total - 1, a));
  g.cols[i].setAttribute("data-span", String(a));
  g.cols[i + 1].setAttribute("data-span", String(total - a));
}
function dcColResizeEnd(e) {
  const st = DC_COLR; DC_COLR = null; if (!st) return;
  try { st.handle.releasePointerCapture(e.pointerId); } catch (_) {}
  st.handle.removeEventListener("pointermove", dcColResizeMove);
  st.handle.removeEventListener("pointerup", dcColResizeEnd);
  st.handle.removeEventListener("pointercancel", dcColResizeEnd);
  st.g.grid.classList.remove("dc-grid-show");
  const b = BLOCKS_WORK[st.g.bi]; if (!b || !Array.isArray(b.columns)) return;
  st.g.cols.forEach((c, k) => { if (b.columns[k]) b.columns[k].span = parseInt(c.getAttribute("data-span") || "0", 10) || undefined; });
  dcCaptureScroll(); renderBlocksCard(); saveBlocks();
}
// Find every columns block on the canvas + its grid + column elements.
function dcColGrids(main) {
  const out = [];
  Array.prototype.forEach.call(main.querySelectorAll(":scope > section.block-columns"), (sec) => {
    const c = eeClassify(sec); if (!c || c.kind !== "block") return;
    const b = BLOCKS_WORK[c.bi]; if (!b || b.type !== "columns") return;
    const grid = sec.querySelector(".cols"); if (!grid) return;
    const cols = Array.prototype.slice.call(grid.querySelectorAll(":scope > .col"));
    if (cols.length) out.push({ sec: sec, grid: grid, bi: c.bi, cols: cols, b: b });
  });
  return out;
}
// Put the canvas into live grid mode for each columns block and inject a resize
// handle between adjacent columns (the last column has none).
function dcInjectColControls(doc, main) {
  dcColGrids(main).forEach((g) => {
    g.grid.classList.add("cols-grid");
    const spans = dcLiveSpans(g.b, g.cols.length);
    g.cols.forEach((col, i) => {
      col.setAttribute("data-span", String(spans[i]));
      const old = col.querySelector(":scope > .dc-colh"); if (old) old.remove();
      if (i < g.cols.length - 1) {
        const h = doc.createElement("div"); h.className = "dc-colh"; h.title = "Drag to resize these two columns";
        h.addEventListener("pointerdown", (ev) => dcColResizeStart(ev, g, i));
        col.appendChild(h);
      }
    });
  });
}

// NOTE: adding/reordering by drag no longer injects native drop-zones INTO the
// iframe. The pointer-drag engine (pdStart/pdMove/pdEnd) draws its ghost + drop-line
// in the PARENT over the iframe and reads section rects to resolve a single list-
// index gap — so the drop can never be lost across the frame boundary. See pdGaps().

// ─────────────────────────────────────────────────────────────────────────────
// G13 slice 2 · IN-PLACE TEXT EDITING (docs/design/G13-INPLACE-EDITING.md §2–3)
// Double-click a stamped text region (data-dds-field, block sections only, Edit
// mode only) → contenteditable session on that element → commit writes the
// STRING through the guarded dot-path writer into BLOCKS_WORK and rides the ONE
// debounced saveBlocks. Markdown fields (data-dds-md) edit their rendered DOM
// with a minimal B·I·Link bar and serialize back to markdown SOURCE — nothing
// read from the canvas is ever written anywhere as HTML (the server's
// escape-first renderMarkdown stays the only HTML producer). Feature-detect:
// an unstamped render (old deployed function) simply never offers the editor.
// ─────────────────────────────────────────────────────────────────────────────
// Client cap table — MUST MATCH validateBlocks' s()/ml() caps in
// supabase/functions/presence/lib/site_blocks.ts. A soft mirror by design: a
// drift only mis-warns locally; the server validator stays the moat and the
// client never widens it. '*' carries the shared block-title cap (s(title, 80));
// types with their OWN title bound (title/spotlight) override it.
const IPE_CAPS = {
  '*': { title: 80 },
  features: { 'items.N.title': 80, 'items.N.text': 240 },
  stats: { 'items.N.value': 24, 'items.N.label': 60 },
  team: { 'members.N.name': 80, 'members.N.role': 80, 'members.N.bio': 300 },
  process: { 'steps.N.step': 80, 'steps.N.detail': 300 },
  pricing: { 'tiers.N.name': 60, 'tiers.N.price_text': 40, 'tiers.N.features.N': 100 },
  certifications: { 'items.N.name': 100 },
  service_areas: { 'areas.N': 60 },
  cta: { text: 160, button: 40 },
  gallery: { 'captions.N': 160 },
  before_after: { 'items.N.caption': 120 },
  video: { caption: 160 },
  appointment: { text: 200, button: 40 },
  newsletter: { text: 200, button: 40 },
  events: { 'items.N.name': 100, 'items.N.time': 40, 'items.N.detail': 240 },
  map: { address: 200 },
  richtext: { body: 4000 },
  image: { caption: 200 },
  image_text: { body: 2000, 'button.label': 40, number: 12, number_label: 60 },   // item 329: the frame design's big number
  accordion: { 'items.N.summary': 120, 'items.N.body': 1500, intro: 200 },        // item 329: the side design's short line
  tabs: { 'tabs.N.label': 40, 'tabs.N.body': 1500 },
  carousel: { 'slides.N.caption': 160 },
  progress: { 'items.N.label': 60 },
  buttons: { 'buttons.N.label': 40 },
  booking: { intro: 400 },
  columns: { 'columns.N.body': 1200, 'columns.N.button.label': 40 },
  cards: { 'cards.N.heading': 80, 'cards.N.text': 240 },
  title: { title: 120, subtitle: 200 },
  link_list: { 'links.N.label': 80 },
  table: { 'headers.N': 80, 'rows.N.N': 200 },
  spotlight: { title: 120, eyebrow: 60, body: 800, 'button.label': 40 },
  toc: { title: 80 },
  stack: { 'items.N.text': 160, 'items.N.body': 4000, 'items.N.caption': 200, 'items.N.buttons.N.label': 40, 'items.N.address': 200 },   // item 57
};
// The cap for one stored field — numeric path segments normalize to N. null =
// no client cap (unknown type/field): the server still enforces its own bounds.
function ipeCapFor(type, path) {
  const norm = String(path || '').split('.').map((sg) => (/^\d+$/.test(sg) ? 'N' : sg)).join('.');
  const t = IPE_CAPS[type] || null;
  const v = (t && t[norm]) || IPE_CAPS['*'][norm] || null;
  return typeof v === 'number' ? v : null;
}
// PURE, guarded dot-path writer into a stored block: array indices must be in
// bounds (never extends), numeric segments only index arrays, and the target
// slot must be a string (or an absent slot on an existing parent) — a field
// path can never overwrite an object/array or vivify structure. The value is
// stored as a literal STRING: it is data, never interpreted as HTML anywhere.
function ipeSetPath(obj, path, value) {
  const segs = String(path || '').split('.').filter(Boolean);
  if (!segs.length || !obj || typeof obj !== 'object') return false;
  let cur = obj;
  for (let i = 0; i < segs.length; i++) {
    const isNum = /^\d+$/.test(segs[i]);
    const k = isNum ? Number(segs[i]) : segs[i];
    if (Array.isArray(cur) ? (!isNum || k >= cur.length) : isNum) return false;
    if (i === segs.length - 1) {
      const prev = cur[k];
      if (prev !== undefined && typeof prev !== 'string') return false;
      cur[k] = value;
      return true;
    }
    cur = cur[k];
    if (!cur || typeof cur !== 'object') return false;
  }
  return false;
}
// The same walk, reading — the unchanged-commit check.
function ipeGetPath(obj, path) {
  const segs = String(path || '').split('.').filter(Boolean);
  let cur = obj;
  for (let i = 0; i < segs.length; i++) {
    if (!cur || typeof cur !== 'object') return undefined;
    const isNum = /^\d+$/.test(segs[i]);
    if (Array.isArray(cur) ? !isNum : isNum) return undefined;
    cur = cur[isNum ? Number(segs[i]) : segs[i]];
  }
  return cur;
}
// PURE gate: in-place editing exists ONLY in Edit mode, ONLY on a stamped
// field, ONLY inside a resolved block section. Everything else — Comments/
// Preview/Timewarp, core sections, unstamped (old-function) renders — is out.
function ipeGate(mode, path, cls) {
  return mode === 'edit' && !!path && !!cls && cls.kind === 'block';
}
// PURE DOM→markdown serializer over EXACTLY renderMarkdown's output allowlist
// (lib/markdown.ts): p→paragraph, br→line break, strong/em→**/*,
// a→[text](href), h2/h3→##/###, ul/ol li→-/1., blockquote→"> ". Any OTHER node
// collapses to its content — pasted or hand-crafted markup is stripped of
// meaning, never of content (renderMarkdown's posture in reverse). Elements
// carrying their OWN data-dds-field (the image_text button riding inside the
// md container) or contenteditable="false" are other fields/chrome — skipped
// whole. Inner whitespace is preserved exactly (round-trip property §2.3).
//
// INLINE EMISSION (review findings 1+2): renderMarkdown parses strong FIRST
// ('**…**' can never span a '*'), then em ('*…*' holds only when no bare '*'
// survives once '**…**' pairs are consumed). So em may contain strong
// ('*a **b***') but never the reverse: a strong holding an em is emitted as
// SPLIT runs — '**a ***b*** c**' re-renders as strong(a) em(strong(b))
// strong(c), the exact visual the session shows (the browser bolds a nested
// em too). Same-tag nesting emits once (never '****x****'), directly-adjacent
// ems merge ('*a**b*' would tear) — and the merge sees THROUGH the
// zero-length text nodes Chromium's surroundContents leaves at its split
// points ('T("") EM T("") EM' is what two italicize gestures over one word
// really leave). A multi-line wrap emits per line ('**…**' cannot span a
// newline), a block element inside a wrap contributes a LINE BREAK, never a
// glue, and an italic wrap that would BEGIN a stored paragraph line as '* '
// hoists its leading whitespace out of the wrap (the renderer's UL rule
// would read the wrap's own star as a bullet marker). A run holding a
// literal '*' has no faithful form at all (no escape support) and stays
// unwrapped: meaning stripped, never content. The optional `notes` array
// collects human-readable degrades for the commit path to surface.
function ipeSerializeMd(root, notes) {
  // normalize() is the DOM's own canonicalization — drops zero-length text
  // nodes, coalesces fragments; representation only, never content — so the
  // adjacent-em merges below see truly adjacent siblings. Pure stub roots
  // (tests) have no normalize; the merge look-aheads also skip the residue
  // themselves, so the serializer is correct without it.
  try { if (root && typeof root.normalize === 'function') root.normalize(); } catch (_) {}
  const skip = (n) => !!(n.getAttribute && (n.getAttribute('data-dds-field') != null || n.getAttribute('contenteditable') === 'false' || (n.id && /^dds-/.test(n.id))));
  const note = (m) => { if (notes && notes.indexOf(m) < 0) notes.push(m); };
  const tagOf = (n) => (n && n.nodeType === 1 ? String(n.tagName || '').toUpperCase() : '');
  const isEm = (n) => n && n.nodeType === 1 && !skip(n) && /^(EM|I)$/.test(tagOf(n));
  // surroundContents residue: a ZERO-LENGTH text node is representation, not
  // content — a whitespace text node is real (it still blocks an em merge;
  // '*a* *b*' is already faithful).
  const isEmptyT = (n) => !!n && n.nodeType === 3 && !String(n.nodeValue || '');
  const BLOCKY = /^(P|DIV|H2|H3|H4|H5|H6|UL|OL|LI|BLOCKQUOTE|SECTION|ARTICLE|HEADER|FOOTER|TABLE|THEAD|TBODY|TR|TD|TH|FIGURE|PRE)$/;
  const wrapLines = (s2, fn) => s2.split('\n').map((l) => (l ? fn(l) : l)).join('\n');
  // An italic wrap must never BEGIN a stored line as '* ' — the renderer
  // trims each line and reads '^[-*]\s+' as a bullet (lib/markdown.ts UL
  // rule), so '*' + ' part' + '*' at a line start would FABRICATE a list out
  // of a space-leading selection. Leading whitespace hoists OUT of the wrap
  // there (' *part*'): an italic space is the same glyph as a plain one, and
  // line-leading whitespace already dies at the renderer's per-line trim,
  // styled or not — the italics survive at full fidelity. `atLS` marks a
  // call whose first line begins a stored PARAGRAPH line (only there is the
  // emission unprefixed); continuation lines after a '\n' always begin one.
  // Marker-prefixed contexts (h2/li/blockquote) keep the space inside the
  // wrap — there the emission never starts a raw line and round-trips
  // byte-true. A whitespace-only line has no wrappable body ('* *' is ALSO
  // the list trigger) and emits unwrapped.
  const emitEmStr = (s2, atLS) => (s2 ? s2.split('\n').map((l, li) => {
    if (!l) return l;
    if (l.replace(/\*\*([^*]+)\*\*/g, '').indexOf('*') >= 0) {
      note('Italic can’t hold a “*” — that part kept its stars, unstyled.');
      return l;
    }
    if (li > 0 || atLS) {
      const ws = /^(\s+)(.*)$/.exec(l);
      if (ws) return ws[2] ? ws[1] + '*' + ws[2] + '*' : l;
    }
    return '*' + l + '*';
  }).join('\n') : '');
  const emitStrongEl = (el2, ital) => {
    let res = '', seg = '';
    const flushSeg = () => {
      if (seg) res += wrapLines(seg, (l) => {
        if (l.indexOf('*') < 0) return '**' + l + '**';
        note('Bold can’t hold a “*” — that part kept its stars, unstyled.');
        return l;
      });
      seg = '';
    };
    const kids = el2.childNodes || [];
    for (let i = 0; i < kids.length; i++) {
      const ch = kids[i];
      if (isEm(ch)) {
        if (ital) { seg += inline(ch, true, true); continue; }   // both formats already active — content only
        let s2 = inline(ch, true, true);
        for (let j = i + 1; j < kids.length; j++) {   // merge THROUGH surroundContents' zero-length residue
          if (isEmptyT(kids[j])) continue;
          if (!isEm(kids[j])) break;
          s2 += inline(kids[j], true, true); i = j;
        }
        flushSeg();
        if (s2) res += s2.indexOf('*') < 0 ? wrapLines(s2, (l) => '***' + l + '***') : emitEmStr(s2);
        continue;
      }
      if (ch.nodeType === 1 && !skip(ch) && BLOCKY.test(tagOf(ch))) {
        const s2 = inline(ch, true, ital);
        if (s2) seg += (seg && !/\n$/.test(seg) ? '\n' : '') + s2;
        continue;
      }
      seg += one(ch, true, ital);
    }
    flushSeg();
    return res;
  };
  const one = (ch, bold, ital) => {
    if (ch.nodeType === 3) return String(ch.nodeValue || '').replace(/\s+/g, ' ');
    if (ch.nodeType !== 1 || skip(ch)) return '';
    const t = tagOf(ch);
    if (t === 'BR') return '\n';
    if (t === 'STRONG' || t === 'B') return bold ? inline(ch, bold, ital) : emitStrongEl(ch, ital);
    if (t === 'EM' || t === 'I') { const s2 = inline(ch, bold, true); return ital ? s2 : emitEmStr(s2); }
    if (t === 'A') {
      let href = String((ch.getAttribute && ch.getAttribute('href')) || '').trim();
      const s2 = inline(ch, bold, ital);
      if (!href || !s2) return s2;
      // review finding 3 (+6, storage direction): the link rule reads
      // [text](url) with text=[^\]]+ and url=[^)\s]+, and safeHref allows
      // https/mailto/tel only. ')' and whitespace percent-encode in the href
      // (URL-equivalent, render-safe), tel separators strip (cosmetic), and
      // ']' or a newline cannot sit in link text (no escape support) — each
      // degrade is noted for the commit toast. A scheme the render would
      // refuse anyway stays plain text: never an [x](javascript:…) lump.
      if (/^tel:/i.test(href)) href = href.replace(/[\s()]/g, '');
      else href = href.replace(/[)\s]/g, (c2) => (c2 === ')' ? '%29' : encodeURIComponent(c2)));
      const okHref = /^https:\/\/[^\s]+$/i.test(href) || /^mailto:[^\s]+@[^\s]+$/i.test(href) || /^tel:\+?[\d\-().\s]+$/i.test(href);
      if (!okHref) { note('That link’s address isn’t https, mailto, or tel — its text was kept, the link wasn’t.'); return s2; }
      const text = s2.replace(/\]/g, '').replace(/\n/g, ' ');
      if (!text.trim()) { note('That link’s text was only “]” characters — it was kept as plain text.'); return s2; }
      if (text !== s2) note('A “]” can’t sit inside a link’s text — it was removed so the link survives.');
      return '[' + text + '](' + href + ')';
    }
    return inline(ch, bold, ital);
  };
  const inline = (node, bold, ital, para) => {   // `para` = this content forms unprefixed paragraph lines
    let out = '';
    const kids = node.childNodes || [];
    for (let i = 0; i < kids.length; i++) {
      const ch = kids[i];
      if (isEm(ch) && !ital) {
        let s2 = inline(ch, bold, true);
        for (let j = i + 1; j < kids.length; j++) {   // merge THROUGH surroundContents' zero-length residue
          if (isEmptyT(kids[j])) continue;
          if (!isEm(kids[j])) break;
          s2 += inline(kids[j], bold, true); i = j;
        }
        out += emitEmStr(s2, !!para && !out.slice(out.lastIndexOf('\n') + 1).trim());
        continue;
      }
      if (ch.nodeType === 1 && !skip(ch) && BLOCKY.test(tagOf(ch))) {
        const s2 = inline(ch, bold, ital, para);
        if (s2) out += (out && !/\n$/.test(out) ? '\n' : '') + s2;
        continue;
      }
      out += one(ch, bold, ital);
    }
    return out;
  };
  const blocks = [];
  const kids = root.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const ch = kids[i];
    if (ch.nodeType === 3) { const s2 = String(ch.nodeValue || '').replace(/\s+/g, ' ').trim(); if (s2) blocks.push(s2); continue; }
    if (ch.nodeType !== 1 || skip(ch)) continue;
    const t = String(ch.tagName || '').toUpperCase();
    if (t === 'H2' || t === 'H3') { const s2 = inline(ch).trim(); if (s2) blocks.push((t === 'H2' ? '## ' : '### ') + s2); }
    else if (t === 'UL' || t === 'OL') {
      const items = []; const lk = ch.childNodes || []; let n = 0;
      for (let k = 0; k < lk.length; k++) {
        const li = lk[k];
        if (li.nodeType !== 1 || String(li.tagName).toUpperCase() !== 'LI' || skip(li)) continue;
        n++; const s2 = inline(li).trim();
        if (s2) items.push((t === 'UL' ? '- ' : n + '. ') + s2.replace(/\n/g, ' '));
      }
      if (items.length) blocks.push(items.join('\n'));
    } else if (t === 'BLOCKQUOTE') {
      const s2 = inline(ch).trim();
      if (s2) blocks.push(s2.split('\n').map((l) => '> ' + l.trim()).join('\n'));
    } else { const s2 = inline(ch, 0, 0, true).trim(); if (s2) blocks.push(s2); }   // p + any unknown block → a paragraph (unprefixed lines)
  }
  return blocks.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
// Plain read-back mirrors the validator's s() shape: collapse whitespace, trim.
function ipeReadPlain(el2) { return String(el2.textContent || '').replace(/\s+/g, ' ').trim(); }
// PURE, review fix 9: the commit-time cap clamp must not cut mid-construct —
// a torn '[text](https:/' tail would be STORED and re-render as raw noise,
// and a sliced surrogate pair is not even valid text. Back off past an
// unclosed '[…](…' or '[…' at the cut edge and past a lone high surrogate;
// everything before the tear is kept.
function ipeCleanCut(value, cap) {
  let v = String(value).slice(0, cap);
  const cc = v.charCodeAt(v.length - 1);
  if (cc >= 0xd800 && cc <= 0xdbff) v = v.slice(0, -1);          // never store half an emoji
  v = v.replace(/\[[^\]]*\]\([^)]*$/, '').replace(/\[[^\]]*$/, ''); // no unclosed link construct at the tail
  return v;
}
// 'items.2.summary' → 'summary' — the human name for announcements.
function ipeFieldLabel(path) {
  const segs = String(path || '').split('.').filter((sg) => !/^\d+$/.test(sg));
  return segs[segs.length - 1] || 'text';
}
let IPE_LIVE_MSG = null;        // review fix 8: a save-outcome announcement that must survive the repaint
// The in-place save IS the canvas auto-save, debounced ~1.2s so a burst of
// field commits collapses into ONE saveBlocks (= one undo checkpoint). If the
// timer fires while a NEW session is active, the save defers to that session's
// end — the save→srcdoc-reload cycle can never destroy an active contenteditable.
function ipeSaveSoon() {
  clearTimeout(IPE_SAVE_T);
  IPE_SAVE_T = setTimeout(() => {
    IPE_SAVE_T = null;
    if (IPE) { IPE_SAVE_PENDING = true; return; }
    ipeSaveNow();
  }, 1200);
}
function ipeSaveNow() {
  clearTimeout(IPE_SAVE_T); IPE_SAVE_T = null; IPE_SAVE_PENDING = false;
  // The save's repaint keeps the canvas where the person is now, which may be past
  // where they committed: the debounce leaves them time to scroll.
  dcCaptureScroll();
  // Review fix 8 — honest announce: the commit said "Saving…"; "Saved" is
  // announced only when the PUT actually resolved ok (saveBlocks returns
  // true). Failures announce alongside the existing failure toast. The
  // message lands in the current canvas doc AND is stashed so the repaint's
  // injection re-announces it into the fresh document.
  IPE_SAVE_INFLIGHT = true;
  return saveBlocks().then((okz) => {
    IPE_SAVE_INFLIGHT = false;
    const msg = okz ? 'Saved' : 'The save failed — see the message on screen.';
    const d = ipeCanvasDoc(); if (d) ipeAnnounce(d, msg);
    IPE_LIVE_MSG = msg;
    return okz;
  });
}
function ipeCanvasDoc() { try { const f = $('designPreview'); return f ? f.contentDocument : null; } catch (_) { return null; } }
function ipeAnnounce(doc, msg) {   // screen-reader announcement of enter/exit
  try {
    let lv = doc.getElementById('dds-ipe-live');
    if (!lv) { lv = doc.createElement('div'); lv.id = 'dds-ipe-live'; lv.setAttribute('role', 'status'); lv.setAttribute('aria-live', 'polite'); lv.className = 'ipe-sr'; doc.body.appendChild(lv); }
    lv.textContent = msg;
  } catch (_) {}
}
function ipeStart(doc, fieldEl, secEl) {
  if (doc !== dcFrameDoc()) return;           // the page just left (dcOpenPage): these stamps index another page's list
  if (IPE) ipeCommit();                       // starting a new session banks the old one
  const c = eeClassify(secEl);
  const path = fieldEl.getAttribute && fieldEl.getAttribute('data-dds-field');
  if (!ipeGate(DC_MODE, path, c) || !(BLOCKS_WORK || [])[c.bi]) { eeDoubleClickTarget(secEl); return; }   // never a dead double-click
  const lk = BLOCKS_WORK[c.bi];
  if (lockedForMe(lk) && !lk.lock.words) { eeEditBlock(c.bi); return; }   // item 155: locked with its words shut: the card says why
  const md = fieldEl.hasAttribute('data-dds-md');
  const prev = {};
  ['contenteditable', 'role', 'aria-label', 'aria-multiline', 'spellcheck'].forEach((a) => { prev[a] = fieldEl.getAttribute(a); });
  // Review finding 4: capture the PRE-SESSION serialization NOW. The commit
  // compares against THIS — never against the stored value — so a zero-typing
  // session can't "commit" the render's English fallback text or the
  // serializer's normalizations (*→-, 7.→1., #→##) into storage.
  let base = '';
  try { base = md ? ipeSerializeMd(fieldEl) : ipeReadPlain(fieldEl); } catch (_) { base = ipeReadPlain(fieldEl); }
  IPE = { doc: doc, el: fieldEl, sec: secEl, path: path, md: md, orig: fieldEl.innerHTML, prev: prev, busy: false, base: base, dirty: false };
  try { const bar = doc.getElementById('dds-dc-bar'); if (bar) bar.classList.remove('on'); } catch (_) {}   // toolbar sleeps for the session
  // plaintext-only where supported keeps rich formatting out of plain fields;
  // the paste guard below is the universal fallback either way.
  fieldEl.setAttribute('contenteditable', md ? 'true' : 'plaintext-only');
  if (!md && fieldEl.contentEditable !== 'plaintext-only') fieldEl.setAttribute('contenteditable', 'true');
  fieldEl.setAttribute("role", "textbox");
  if (md) fieldEl.setAttribute('aria-multiline', 'true');
  fieldEl.setAttribute('aria-label', 'Editing ' + ipeFieldLabel(path) + ' — ' + (md ? 'Ctrl+Enter saves' : 'Enter saves') + ', Escape cancels');
  fieldEl.setAttribute('spellcheck', 'true');
  fieldEl.classList.add('ipe-on');
  fieldEl.addEventListener('keydown', ipeKeydown);
  fieldEl.addEventListener('blur', ipeBlur);
  fieldEl.addEventListener('paste', ipePaste);
  fieldEl.addEventListener('input', ipeInput);
  fieldEl.addEventListener('drop', ipeDrop);
  fieldEl.addEventListener('dragover', ipeDragover);
  fieldEl.addEventListener('beforeinput', ipeBeforeInput);   // F-4: native format gestures route through the guarded wrap
  ipeShowBar(doc, fieldEl);   // item 316: every field has its bar
  try { fieldEl.focus(); } catch (_) {}
  // keep the double-click's own selection when it landed inside; else caret at end
  try {
    const sel = doc.getSelection();
    if (!sel.rangeCount || !fieldEl.contains(sel.anchorNode)) {
      const r = doc.createRange(); r.selectNodeContents(fieldEl); r.collapse(false);
      sel.removeAllRanges(); sel.addRange(r);
    }
  } catch (_) {}
  ipeAnnounce(doc, 'Editing ' + ipeFieldLabel(path) + '. ' + (md ? 'Control Enter' : 'Enter') + ' or Escape saves and leaves the box; Undo takes it back.');
}
function ipeKeydown(e) {
  if (!IPE) return;
  // Builder item 255: Escape keeps what was typed and leaves the box (Undo takes it back). It used
  // to throw the words away with no message and nothing to redo.
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ipeCommit(); return; }
  if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
    const k2 = String(e.key || '').toLowerCase();
    // the browser's NATIVE bold/italic would inject DOM shapes the markdown
    // subset can't hold — route ⌘/Ctrl+B/I through the same guarded wrap the
    // mini-bar uses (md fields), or swallow them (plain fields never format).
    if (k2 === 'b' || k2 === 'i') { e.preventDefault(); e.stopPropagation(); if (IPE.md) ipeWrapSel(k2 === 'b' ? 'strong' : 'em'); return; }
  }
  if (e.key === 'Enter') {
    if (!IPE.md) { e.preventDefault(); e.stopPropagation(); ipeCommit(); return; }        // plain: Enter commits (AEM UE)
    if (e.metaKey || e.ctrlKey) { e.preventDefault(); e.stopPropagation(); ipeCommit(); } // md: ⌘/Ctrl+Enter commits, Enter = paragraph
  }
}
function ipeBlur() { if (IPE && !IPE.busy) ipeCommit(); }   // click/focus-away commits (panel idiom)
// Review F-4: native formatting can arrive OUTSIDE the keydown intercept —
// the context menu, the browser's Edit menu, an IME surface — as a
// beforeinput with a format* inputType. Bold/italic route through the SAME
// guarded wrap the mini-bar uses (md fields); every other format*
// (underline, indent, justify…) has no markdown form and is swallowed, on
// plain fields all of them are. Non-format input (typing, paste, undo) is
// untouched. Best-effort by design: a script-driven execCommand fires a
// non-cancelable beforeinput in Chromium — the serializer's allowlist
// (unknown nodes collapse to content) remains the backstop there.
function ipeBeforeInput(e) {
  if (!IPE) return;
  const it = String(e.inputType || '');
  if (!/^format/.test(it)) return;
  e.preventDefault();
  if (IPE.md && (it === 'formatBold' || it === 'formatItalic')) ipeWrapSel(it === 'formatBold' ? 'strong' : 'em');
}
// any real input marks the session dirty — the belt-and-braces half of the
// finding-4 no-op gate (the serialization compare is the other half).
function ipeInput() { if (IPE) IPE.dirty = true; }
function ipePaste(e) {
  // UNCONDITIONAL paste-as-plain-text guard (plaintext-only support varies):
  // clipboard markup can never enter a field — only its text/plain content.
  if (!IPE) return;
  e.preventDefault();
  const t = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
  if (!t) return;
  ipeInsertPlain(t);
}
// Review fix 5 — the DROP mirror of the paste guard: dragged rich content
// (from the page or outside) must never enter a session as markup. The
// browser's default contenteditable drop inserts text/html wholesale, so the
// drop is always cancelled and only the text/plain flavor is inserted (at the
// caret — a small honesty trade for never holding markup).
function ipeDrop(e) {
  if (!IPE) return;
  e.preventDefault();
  const t = (e.dataTransfer && e.dataTransfer.getData && e.dataTransfer.getData('text/plain')) || '';
  if (!t) return;
  ipeInsertPlain(t);
}
function ipeDragover(e) { if (IPE) e.preventDefault(); }
// the ONE plain-text inserter paste and drop share (the range fallback fires
// no input event, so the dirty flag is set here explicitly).
function ipeInsertPlain(t) {
  if (!IPE) return;
  try { IPE.doc.execCommand('insertText', false, t); }
  catch (_) {
    try {
      const sel = IPE.doc.getSelection();
      if (sel.rangeCount) { const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(IPE.doc.createTextNode(t)); r.collapse(false); }
    } catch (_) {}
  }
  IPE.dirty = true;
}
function ipeEnd() {   // restore the element's pre-session attributes + chrome
  const s = IPE; IPE = null;
  if (!s) return null;
  try {
    s.el.classList.remove('ipe-on');
    s.el.removeEventListener('keydown', ipeKeydown);
    s.el.removeEventListener('blur', ipeBlur);
    s.el.removeEventListener('paste', ipePaste);
    s.el.removeEventListener('input', ipeInput);
    s.el.removeEventListener('drop', ipeDrop);
    s.el.removeEventListener('dragover', ipeDragover);
    s.el.removeEventListener('beforeinput', ipeBeforeInput);
    // Builder item 272: let go of the words, so an iPhone puts its keyboard away. Left focused,
    // the keyboard stayed up over the page after Return with nothing to type into.
    if (s.doc.activeElement === s.el) s.el.blur();
    Object.keys(s.prev).forEach((a) => { if (s.prev[a] == null) s.el.removeAttribute(a); else s.el.setAttribute(a, s.prev[a]); });
    ipeHideBar(s.doc);
  } catch (_) { /* the canvas may have reloaded under us — nothing to restore */ }
  if (IPE_SAVE_PENDING) { IPE_SAVE_PENDING = false; ipeSaveSoon(); }   // the deferred burst-save resumes
  if (DP_REPAINT_HELD) { DP_REPAINT_HELD = false; dcCaptureScroll(); refreshDesignPreview(); }   // the repaint this session held off
  return s;
}
function ipeCancel() {
  const s = IPE; if (!s) return;
  try { s.el.innerHTML = s.orig; } catch (_) {}   // the ORIGINAL server-rendered fragment, same document
  ipeEnd();
  ipeAnnounce(s.doc, 'Edit canceled.');
}
function ipeCommit() {
  const s = IPE; if (!s) return;
  // Read back per §2.3: markdown SOURCE for md fields, collapsed plain text
  // otherwise. The value is DATA — a string field on a structured block — and
  // is never interpreted as HTML anywhere on the way to storage.
  let value;
  const notes = [];
  try { value = s.md ? ipeSerializeMd(s.el, notes) : ipeReadPlain(s.el); } catch (_) { value = ipeReadPlain(s.el); }
  // Review finding 4 — the no-op gate: a session with no input/mini-bar event,
  // or whose serialization equals the PRE-SESSION serialization (s.base), is a
  // zero-edit session: no write, no undo checkpoint, no PUT. Comparing against
  // the STORED value here was the phantom-write bug (fallback headings and
  // serializer normalizations differ from storage with zero typing).
  const untouched = !s.dirty || value === s.base;
  // Re-resolve the section NOW: a tree-rail delete/move mid-session shifted
  // indices, and eeClassify applies the DDS_SRCMAP compensation for us.
  const c = eeClassify(s.sec);
  ipeEnd();
  if (untouched) { ipeAnnounce(s.doc, 'Done — nothing changed.'); return; }
  if (c.kind !== 'block' || !(BLOCKS_WORK || [])[c.bi]) { toast('That section is no longer on the page — this text wasn’t saved.', true); return; }
  const block = BLOCKS_WORK[c.bi];
  const cap = ipeCapFor(block.type, s.path);
  if (cap && value.length > cap) { value = ipeCleanCut(value, cap); toast('Trimmed to the field’s limit of ' + cap + ' characters.'); }
  const before = ipeGetPath(block, s.path);
  if (String(before == null ? '' : before) === value) { ipeAnnounce(s.doc, 'Done — nothing changed.'); return; }   // unchanged → no save
  if (!ipeSetPath(block, s.path, value)) { toast('That text couldn’t be saved in place — use the section’s editor panel.', true); return; }
  if (notes.length) toast(notes[0]);   // surface the serializer's honest degrades (findings 1/3)
  // Review fix 8: the PUT is still ~1.2s away — say so. "Saved" is announced
  // only when it actually resolves (ipeSaveSoon).
  ipeAnnounce(s.doc, 'Saving…');
  ipeSaveSoon();
}
// ── Builder item 319: a floating bar sits clear of the words it belongs to ──
// Above the element when the gap to whatever is above it (the thing before it in its section,
// else the section's own top) holds the bar; else below it when that gap does; else above,
// pushed to the element's right end, where a heading's words least often reach. Never under
// the dock, and never off the screen's top.
function dcFloatClear(doc, node, bar, gap) {
  const win = doc.defaultView, r = node.getBoundingClientRect(), h = bar.offsetHeight || 36, w = bar.offsetWidth || 0, ins = dcChromeInsets(), g = gap == null ? 8 : gap;
  const vw = doc.documentElement.clientWidth, sy = win.scrollY, sx = win.scrollX;
  const sec = node.closest("section,nav") || node.parentElement;
  const seen = (n) => n && n.getBoundingClientRect().height > 0;
  let p = node.previousElementSibling; while (p && !seen(p)) p = p.previousElementSibling;
  let n = node.nextElementSibling; while (n && !seen(n)) n = n.nextElementSibling;
  const prevBottom = p ? p.getBoundingClientRect().bottom : sec ? sec.getBoundingClientRect().top : -Infinity;
  const nextTop = n ? n.getBoundingClientRect().top : sec ? sec.getBoundingClientRect().bottom : Infinity;
  let y, right = false;
  if (r.top - prevBottom >= h + g && r.top - h - g >= 4) y = r.top - h - g;
  else if (nextTop - r.bottom >= h + g && r.bottom + h + g <= win.innerHeight - 4) y = r.bottom + g;
  else if (r.top - h - g >= 4) { y = r.top - h - g; right = true; }
  else y = r.bottom + g;
  const x = Math.max(sx + 8 + ins.left, Math.min((right ? r.right - w : r.left - 6) + sx, sx + vw - ins.right - w - 8));
  bar.style.setProperty("left", x + "px"); bar.style.setProperty("top", (y + sy) + "px");
}
// ── Builder item 316: one small bar on every piece of text ──
// Words with formatting (a text box, a card's words) get bold, italic, a link, heading, list
// and quote, which the stored words can hold. Every field, a heading too, gets the section's
// own words settings: left or centre, a size step and a colour from the site's palette, the
// same ones the Style tab keeps, shown on the section at once and saved with it.
const IPE_SIZES = ["", "l", "xl", "s"], IPE_SIZE_WORDS = { "": "Normal", s: "Smaller", l: "Larger", xl: "Extra large" };
function ipeBlockOf() {   // the paragraph, heading, list item or quote the caret is in
  const s = IPE; if (!s || !s.md) return null;
  try {
    const sel = s.doc.getSelection(); if (!sel.rangeCount) return null;
    let n = sel.getRangeAt(0).startContainer; if (n.nodeType === 3) n = n.parentNode;
    for (let p = n; p && p !== s.el; p = p.parentNode) { if (p.nodeType === 1 && /^(P|DIV|H2|H3|H4|LI|BLOCKQUOTE)$/.test(String(p.tagName).toUpperCase()) && s.el.contains(p)) return p; }
  } catch (_) {}
  return null;
}
function ipeRetag(node, tag) {   // the same words in another kind of block, the caret kept inside
  const s = IPE, doc = s.doc, nu = doc.createElement(tag);
  while (node.firstChild) nu.appendChild(node.firstChild);
  node.replaceWith(nu);
  s.dirty = true;
  ipeCaretIn(nu);
  return nu;
}
function ipeHeading() {   // paragraph → heading → smaller heading → paragraph
  const b = ipeBlockOf(); if (!b) return;
  const t = String(b.tagName).toUpperCase();
  if (t === 'LI' || t === 'BLOCKQUOTE') { toast('Take it out of the list or quote first.'); return; }
  ipeRetag(b, t === 'H2' ? 'h3' : t === 'H3' ? 'p' : 'h2');
  ipeShowBar(IPE.doc, IPE.el);
}
function ipeList() {
  const s = IPE, b = ipeBlockOf(); if (!b) return;
  const doc = s.doc, t = String(b.tagName).toUpperCase();
  if (t === 'LI') {   // out of the list: the item becomes a paragraph beside what's left of the list
    const ul = b.parentNode, p = ipeRetag(b, 'p');
    if (!ul || !/^(UL|OL)$/.test(String(ul.tagName).toUpperCase())) return;
    const items = Array.prototype.filter.call(ul.children, (x) => x !== p);
    const after = items.filter((x) => p.compareDocumentPosition(x) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!items.length) ul.replaceWith(p);
    else if (!after.length) ul.after(p);
    else if (after.length === items.length) ul.before(p);
    else { const rest = doc.createElement(ul.tagName.toLowerCase()); after.forEach((x) => rest.appendChild(x)); ul.after(p); p.after(rest); }
    ipeCaretIn(p);   // moving it out dropped the caret again
    s.dirty = true;
  } else if (t === 'BLOCKQUOTE') { toast('Take it out of the quote first.'); return; }
  else { const ul = doc.createElement('ul'); b.replaceWith(ul); ul.appendChild(b); ipeRetag(b, 'li'); }
  ipeShowBar(s.doc, s.el);
}
function ipeCaretIn(node) {   // moving a block drops the browser's selection: put the caret back at its end, the field focused
  try { const doc = IPE.doc, sel = doc.getSelection(), r = doc.createRange(); IPE.el.focus({ preventScroll: true }); r.selectNodeContents(node); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); } catch (_) {}
}
function ipeQuote() {
  const s = IPE, b = ipeBlockOf(); if (!b) return;
  const doc = s.doc, t = String(b.tagName).toUpperCase();
  const q = t === 'BLOCKQUOTE' ? b : (b.parentNode && String(b.parentNode.tagName).toUpperCase() === 'BLOCKQUOTE' ? b.parentNode : null);
  if (q) { const first = q.firstElementChild || q.firstChild; while (q.firstChild) q.before(q.firstChild); q.remove(); if (first) ipeCaretIn(first); s.dirty = true; }
  else if (t === 'LI') { toast('Take it out of the list first.'); return; }
  else { const nq = doc.createElement('blockquote'); b.replaceWith(nq); nq.appendChild(b); ipeCaretIn(b); s.dirty = true; }
  ipeShowBar(s.doc, s.el);
}
// The section's own words settings (the Style tab's), shown on the section at once the way
// the server draws them (lib/site_blocks.ts ov-* classes), saved with the section.
function ipeStyle(patch) {
  const s = IPE; if (!s) return;
  const c = eeClassify(s.sec); if (c.kind !== 'block' || !BLOCKS_WORK[c.bi] || lockedForMe(BLOCKS_WORK[c.bi])) return;
  const b = { ...BLOCKS_WORK[c.bi] }, st = { ...(b.style || {}) };
  Object.keys(patch).forEach((k) => { if (patch[k]) st[k] = patch[k]; else delete st[k]; });
  if ('text_color' in patch) delete st.contrast_ack;
  if (Object.keys(st).length) b.style = st; else delete b.style;
  BLOCKS_WORK[c.bi] = b;
  const sec = s.sec;
  ['left', 'center', 'right'].forEach((a) => sec.classList.toggle('ov-align-' + a, st.align === a));
  ['s', 'l', 'xl'].forEach((z) => sec.classList.toggle('ov-size-' + z, st.size === z));
  if (st.text_color) { sec.style.setProperty('--ov-ink', st.text_color); sec.classList.add('ov-ink'); } else { sec.style.removeProperty('--ov-ink'); sec.classList.remove('ov-ink'); }
  blocksSaveSoon();
  if ($('blocksCard') && PANEL_MODE === 'section') renderBlocksCard();
  ipeShowBar(s.doc, s.el);
}
function ipeShowBar(doc, el2) {
  let bar = doc.getElementById('dds-ipe-bar');
  if (!bar) {
    bar = doc.createElement('div'); bar.id = 'dds-ipe-bar';
    bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Text formatting');
    doc.body.appendChild(bar);
  }
  const s = IPE, md = !!(s && s.md), c = s ? eeClassify(s.sec) : null;
  const blk = c && c.kind === 'block' ? BLOCKS_WORK[c.bi] : null, st = (blk && blk.style) || {};
  const open = bar.classList.contains('colours');
  bar.textContent = '';
  const mk = (label, aria, fn, cls) => {
    const b = doc.createElement('button'); b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
    b.setAttribute('aria-label', aria); b.title = aria;
    // mousedown (default prevented) keeps the session's focus + selection
    b.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    return b;
  };
  const sep = () => { const n = doc.createElement('span'); n.className = 'ipe-sep'; n.setAttribute('aria-hidden', 'true'); return n; };
  if (md) {
    bar.appendChild(mk('B', 'Bold', () => ipeWrapSel('strong')));
    bar.appendChild(mk('I', 'Italic', () => ipeWrapSel('em')));
    bar.appendChild(mk('Link', 'Add a link', () => ipeLink()));
    const b = ipeBlockOf(), t = b ? String(b.tagName).toUpperCase() : '';
    bar.appendChild(mk('H', 'Heading: a paragraph becomes a heading, a heading a smaller one, then a paragraph again', ipeHeading, t === 'H2' || t === 'H3' ? 'ipe-on' : ''));
    bar.appendChild(mk('List', t === 'LI' ? 'Take this out of the list' : 'Make this a list item', ipeList, t === 'LI' ? 'ipe-on' : ''));
    const inQ = t === 'BLOCKQUOTE' || (b && b.parentNode && String(b.parentNode.tagName).toUpperCase() === 'BLOCKQUOTE');
    bar.appendChild(mk('Quote', inQ ? 'Take this out of the quote' : 'Make this a quote', ipeQuote, inQ ? 'ipe-on' : ''));
  }
  if (blk && !lockedForMe(blk)) {
    if (md) bar.appendChild(sep());
    bar.appendChild(mk('Left', 'Line up this section’s words on the left', () => ipeStyle({ align: st.align === 'left' ? '' : 'left' }), st.align === 'left' ? 'ipe-on' : ''));
    bar.appendChild(mk('Centre', 'Line up this section’s words in the centre', () => ipeStyle({ align: st.align === 'center' ? '' : 'center' }), st.align === 'center' ? 'ipe-on' : ''));
    const cur = IPE_SIZES.indexOf(st.size || '') < 0 ? '' : (st.size || ''), next = IPE_SIZES[(IPE_SIZES.indexOf(cur) + 1) % IPE_SIZES.length];
    bar.appendChild(mk('Size', 'Text size for this section: ' + IPE_SIZE_WORDS[cur] + '. Press for ' + IPE_SIZE_WORDS[next].toLowerCase(), () => ipeStyle({ size: next }), cur ? 'ipe-on' : ''));
    const col = mk('Colour', 'A colour for this section’s words, from your site’s palette', () => { bar.classList.toggle('colours'); ipeShowBar(doc, el2); }, (st.text_color ? 'ipe-on' : '') + (open ? ' ipe-open' : ''));
    col.setAttribute('aria-expanded', String(open));
    bar.appendChild(col);
    if (open) {
      const sw = (hex, aria) => {
        const b2 = doc.createElement('button'); b2.type = 'button'; b2.className = 'ipe-sw' + ((st.text_color || '') === hex ? ' ipe-on' : '') + (hex ? '' : ' ipe-none');
        if (hex) b2.style.setProperty("background", hex);
        b2.setAttribute('aria-label', aria); b2.title = aria;
        b2.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); ipeStyle({ text_color: hex }); });
        return b2;
      };
      bar.appendChild(sw('', 'The site’s usual colour'));
      ovShades('text_color').forEach((h) => bar.appendChild(sw(h, 'Words in ' + h)));
    }
  }
  bar.classList.add('on');
  // item 319: clear of the heading above; on a phone the bar takes the foot of the page, over the
  // dock, where it covers no words at all (its ten buttons would wrap to three rows up there)
  bar.classList.toggle('ipe-foot', window.innerWidth <= 760);
  if (window.innerWidth > 760) dcFloatClear(doc, el2, bar); else { bar.style.removeProperty("left"); bar.style.removeProperty("top"); }
}
function ipeHideBar(doc) { try { const b = doc.getElementById('dds-ipe-bar'); if (b) b.classList.remove('on'); } catch (_) {} }
// Direct Range wrapping (execCommand is deprecated): wrap the selection in
// strong/em; partial-node selections fall back to extract+insert.
// Review findings 1+2 semantics — a wrap is applied only when its
// serialization re-renders to the exact visual on screen:
//   · B/I with the whole selection already inside that format TOGGLES the run
//     off (the whole run — predictable, and always re-renderable);
//   · a boundary tearing partway into a strong/em snaps out to the whole
//     element first (a half-wrap has no faithful markdown form);
//   · a selection whose text holds a literal '*' is refused with an honest
//     toast (renderMarkdown has no escape support);
//   · a selection crossing a paragraph/list/heading boundary is refused with
//     an honest toast (an inline wrap can't span blocks without gluing).
function ipeWrapSel(tag) {
  const s = IPE; if (!s || !s.md) return;
  try {
    const sel = s.doc.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    if (!s.el.contains(r.commonAncestorContainer)) return;
    const sameTag = tag === 'strong' ? /^(STRONG|B)$/ : /^(EM|I)$/;
    const tagAnc = (n, re) => { let a = null; for (let p = n; p && p !== s.el; p = p.parentNode) { if (p.nodeType === 1 && re.test(String(p.tagName || '').toUpperCase())) a = p; } return a; };
    const on = tagAnc(r.commonAncestorContainer, sameTag);
    if (on) {                                    // toggle OFF: unwrap the whole run
      const par = on.parentNode;
      while (on.firstChild) par.insertBefore(on.firstChild, on);
      par.removeChild(on);
      s.dirty = true;
      return;
    }
    const sa = tagAnc(r.startContainer, /^(STRONG|B|EM|I)$/); if (sa) r.setStartBefore(sa);
    const ea = tagAnc(r.endContainer, /^(STRONG|B|EM|I)$/); if (ea) r.setEndAfter(ea);
    const BLK = /^(P|DIV|H2|H3|H4|LI|BLOCKQUOTE|TABLE|SECTION)$/;
    const nearBlock = (n) => { for (let p = n; p && p !== s.el; p = p.parentNode) { if (p.nodeType === 1 && BLK.test(String(p.tagName || '').toUpperCase())) return p; } return s.el; };
    if (nearBlock(r.startContainer) !== nearBlock(r.endContainer)) { toast('Format one paragraph at a time — that selection crosses a paragraph break.', true); return; }
    if (/\*/.test(String(r))) { toast((tag === 'strong' ? 'Bold' : 'Italic') + ' can’t wrap a “*” — that text keeps its stars as typed.', true); return; }
    const w = s.doc.createElement(tag);
    try { r.surroundContents(w); } catch (_) { w.appendChild(r.extractContents()); r.insertNode(w); }
    s.dirty = true;
    sel.removeAllRanges();
    const nr = s.doc.createRange(); nr.selectNodeContents(w); sel.addRange(nr);
  } catch (_) {}
}
async function ipeLink() {
  const s = IPE; if (!s || !s.md) return;
  s.busy = true;   // the parent dialog steals focus — that blur must not commit
  let url = '';
  try { url = await askText('Add a link', { hint: 'Where should this link go?', placeholder: 'https://…', ok: 'Add link' }); } catch (_) {}
  if (IPE !== s) return;    // the session ended some other way while the dialog was up
  s.busy = false;
  try { s.el.focus(); } catch (_) {}
  if (!url) return;
  let u = String(url).trim();
  if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u;   // rtLink's bare-domain rule
  // Review fix 6: mirror the server's safeHref allowlist (https/mailto/tel).
  // A scheme the repaint would silently un-link (javascript:, data:, http:,
  // relative tricks) must never sit in the live session DOM looking like a
  // link — refuse it honestly instead. Drift is caught by the pure pin
  // against lib/markdown.ts.
  if (!/^https:\/\/[^\s]+$/i.test(u) && !/^mailto:[^\s]+@[^\s]+$/i.test(u) && !/^tel:\+?[\d\-().\s]+$/i.test(u)) {
    toast('Links must be https, mailto, or tel — that link wasn’t added.', true);
    return;
  }
  try {
    const sel = s.doc.getSelection();
    const a = s.doc.createElement('a'); a.setAttribute('href', u); a.setAttribute('rel', 'noopener');
    if (sel.rangeCount && !sel.isCollapsed && s.el.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      const r = sel.getRangeAt(0);
      try { r.surroundContents(a); } catch (_) { a.appendChild(r.extractContents()); r.insertNode(a); }
    } else {
      a.textContent = u;
      if (sel.rangeCount && s.el.contains(sel.anchorNode)) sel.getRangeAt(0).insertNode(a); else s.el.appendChild(a);
    }
    s.dirty = true;   // a link insert fires no input event
  } catch (_) {}
}

// A live shell hint (the fixed pill, shell.js ddsHint) steps aside the moment the
// owner starts working on the canvas: same as tapping "Got it" (it stays seen),
// removed at once so nothing fading still sits over the page.
function dcDismissShellHint() {
  try {
    const h = document.querySelector(".dds-hint.show"); if (!h) return;
    const x = h.querySelector(".x"); if (x) x.click();
    h.remove();
  } catch (_) {}
}
// ── Typing into the welcome section and About on the canvas ──────────────────
// These words are the site's Business details, so typing them here is the same
// change as typing in that form: it goes through the form's own field, so the same
// autosave and the same Undo step follow. Plain text only, one line each.
const IDE_FIELDS = {
  "identity.business_name": { input: "f-business_name", max: 120, label: "your business name" },
  "identity.tagline": { input: "f-tagline", max: 140, label: "your tagline" },
  "identity.service_area": { input: "f-service_area", max: 200, label: "where you work" },
  "identity.description": { input: "f-description", max: 600, label: "your description" },
  "identity.short_description": { input: "f-short_description", max: 150, label: "your short description" },   // item 330: the line under a new opening's headline
};
// Builder item 314: the rows a built-in page or Home's built-in sections draw from the tabs' lists
// (a menu item, a question and its answer, a review) are typed on the page too. The row's stamp
// names its list and its id (template_kit prE); the part pressed says which field.
const IDE_ROWS = {
  offering: { col: "offerings", parts: [[".nm", "name", 120, "its name"], [".ds", "description", 600, "its description"], [".pr", "price_text", 40, "its price"]] },
  faq: { col: "faqs", parts: [["self", "question", 200, "the question"], ["answer", "answer", 2000, "the answer", true]] },
  testimonial: { col: "testimonials", parts: [["blockquote p", "quote", 600, "the review"]] },
};
// The row and part a press lands on: { row, el, kind, id, field, max, label, md }, or null.
function ideRowAt(target) {
  if (!target || !target.closest) return null;
  let row = target.closest("[data-pr][data-pr-id]"), el2 = null, part = null;
  if (!row) {   // a question's answer sits beside its question, not inside it
    const dd = target.closest("dd"), dt = dd && dd.previousElementSibling;
    if (dt && dt.getAttribute("data-pr") === "faq" && dt.hasAttribute("data-pr-id")) { row = dt; el2 = dd; part = IDE_ROWS.faq.parts[1]; }
    else return null;
  }
  const kind = row.getAttribute("data-pr"), spec = IDE_ROWS[kind]; if (!spec) return null;
  if (!part) {
    for (const p of spec.parts) { if (p[0] === "self") { el2 = row; part = p; break; } if (p[0] === "answer") continue; const hit = target.closest(p[0]); if (hit && row.contains(hit)) { el2 = hit; part = p; break; } }
    if (!part) { const p = spec.parts[0]; el2 = p[0] === "self" ? row : row.querySelector(p[0]); part = p; }
  }
  if (!el2) return null;
  return { row, el: el2, kind, col: spec.col, id: row.getAttribute("data-pr-id"), field: part[1], max: part[2], label: part[3], md: !!part[4] };
}
function ideCan(w, target) { return !!(w && IDE_FIELDS[w.getAttribute("data-pr")]) || !!ideRowAt(target); }
function ideStart(doc, el, target) {
  const path = el && el.getAttribute("data-pr"), spec = IDE_FIELDS[path];
  if (!spec) return ideRowStart(doc, target || el);
  if (DC_MODE !== "edit" || doc !== dcFrameDoc()) return false;
  if (IPE) ipeCommit();
  if (IDE) ideEnd(true);
  const field = path.split(".")[1];
  // an empty field is on show as the preview's sample words, so the first keystroke replaces them.
  // The form holds the newest words: the saved copy lags while a save is on its way.
  const inp = $(spec.input);
  const sample = !String((inp ? inp.value : (S.identity || {})[field]) || "").trim();
  const prev = {};
  ["contenteditable", "role", "aria-label", "spellcheck"].forEach((a) => { prev[a] = el.getAttribute(a); });
  IDE = { doc, el, field, spec, orig: el.textContent, prev, sample };
  el.setAttribute("contenteditable", "plaintext-only");
  if (el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-label", "Editing " + spec.label + ". Enter saves, Escape cancels");
  el.setAttribute("spellcheck", "true");
  el.classList.add("ipe-on");
  el.addEventListener("keydown", ideKeydown);
  el.addEventListener("blur", ideBlur);
  el.addEventListener("paste", idePaste);
  el.addEventListener("drop", idePaste);
  try { el.focus(); } catch (_) {}
  try {
    const sel = doc.getSelection(), r = doc.createRange(); r.selectNodeContents(el);
    if (!sample && sel.rangeCount && el.contains(sel.anchorNode)) return true;   // keep the double-click's own selection
    if (!sample) r.collapse(false);
    sel.removeAllRanges(); sel.addRange(r);
  } catch (_) {}
  return true;
}
function ideKeydown(e) {
  if (e.key === "Enter") { if (IDE && IDE.row && IDE.row.md && !(e.metaKey || e.ctrlKey)) return; e.preventDefault(); ideEnd(true); }   // an answer takes paragraphs; Ctrl+Enter saves it
  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); ideEnd(true); }   // item 255: Escape keeps the words too
  else if (IDE && e.key.length === 1 && !e.metaKey && !e.ctrlKey && IDE.el.textContent.length >= IDE.spec.max) {
    const sel = IDE.doc.getSelection();
    if (!sel || sel.isCollapsed) e.preventDefault();   // full: typing over a selection still works
  }
}
function ideBlur() { ideEnd(true); }
function idePaste(e) {
  if (!IDE) return;
  e.preventDefault();
  const t = String((e.clipboardData || e.dataTransfer || { getData: () => "" }).getData("text/plain") || "").replace(/\s+/g, " ");
  if (t) IDE.doc.execCommand("insertText", false, t.slice(0, Math.max(0, IDE.spec.max - IDE.el.textContent.length)));
}
// A row's words: the same session, saved with a PATCH to its list (which records the Undo step).
function ideRowStart(doc, target) {
  const r = ideRowAt(target); if (!r || DC_MODE !== "edit" || doc !== dcFrameDoc()) return false;
  if (IPE) ipeCommit();
  if (IDE) ideEnd(true);
  const el = r.el, prev = {};
  ["contenteditable", "role", "aria-label", "spellcheck"].forEach((a) => { prev[a] = el.getAttribute(a); });
  const quoted = r.field === "quote" && /^“[\s\S]*”$/.test(String(el.textContent || "").trim());
  IDE = { doc, el, row: r, spec: { max: r.max, label: r.label }, orig: el.innerHTML, origText: el.textContent, prev, sample: false, quoted };
  if (quoted) el.textContent = String(el.textContent).trim().slice(1, -1);
  el.setAttribute("contenteditable", r.md ? "true" : "plaintext-only");
  if (!r.md && el.contentEditable !== "plaintext-only") el.setAttribute("contenteditable", "true");
  el.setAttribute("role", "textbox");
  el.setAttribute("aria-label", "Editing " + r.label + ". " + (r.md ? "Ctrl+Enter" : "Enter") + " saves, Escape cancels");
  el.setAttribute("spellcheck", "true");
  el.classList.add("ipe-on");
  el.addEventListener("keydown", ideKeydown);
  el.addEventListener("blur", ideBlur);
  el.addEventListener("paste", idePaste);
  el.addEventListener("drop", idePaste);
  try { el.focus(); } catch (_) {}
  try { const sel = doc.getSelection(), rg = doc.createRange(); rg.selectNodeContents(el); if (!(sel.rangeCount && el.contains(sel.anchorNode))) { rg.collapse(false); sel.removeAllRanges(); sel.addRange(rg); } } catch (_) {}
  return true;
}
async function ideRowEnd(s, save) {
  const el = s.el, r = s.row;
  const text = r.md ? (() => { try { return ipeSerializeMd(el); } catch (_) { return String(el.textContent || ""); } })().trim().slice(0, r.max)
    : String(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, r.max);
  const was = r.md ? String(s.origText || "").trim() : String(s.origText || "").replace(/\s+/g, " ").trim().replace(/^“([\s\S]*)”$/, "$1");
  const keep = () => { el.innerHTML = s.orig; ideRelease(); };
  if (!save || text === was) return keep();
  if (!text && (r.field === "name" || r.field === "question" || r.field === "quote")) { keep(); toast("It needs some words, so it stays as it was.", true); return; }
  if (s.quoted) el.textContent = "“" + text + "”";
  whisper("topWhisper", "saving");
  try {
    const res = await api("PATCH", "/" + r.col + "/" + r.id, { [r.field]: text });
    const row = (S[r.col] || []).find((x) => x.id === r.id); if (row && res && res.data) Object.assign(row, res.data); else if (row) row[r.field] = text;
    if (UNDO_RENDER[r.col]) UNDO_RENDER[r.col]();
    whisper("topWhisper", "saved"); scheduleChangesRefresh();
    DP_REPAINT_HELD = true; ideRelease();   // drawn again from what was saved
  } catch (err) { whisper("topWhisper", "failed"); el.innerHTML = s.orig; toast(nice(err), true); ideRelease(); }
}
// save: hand the words to the Business details field; cancel: put back what was there
function ideEnd(save) {
  const s = IDE; if (!s) return;
  IDE = null;
  const el = s.el;
  if (s.row) {
    ["keydown", "blur", "paste", "drop"].forEach((t) => el.removeEventListener(t, t === "keydown" ? ideKeydown : t === "blur" ? ideBlur : idePaste));
    try { if (el.ownerDocument.activeElement === el) el.blur(); } catch (_) {}
    Object.keys(s.prev).forEach((a) => { if (s.prev[a] == null) el.removeAttribute(a); else el.setAttribute(a, s.prev[a]); });
    el.classList.remove("ipe-on");
    ideRowEnd(s, save);
    return;
  }
  ["keydown", "blur", "paste", "drop"].forEach((t) => el.removeEventListener(t, t === "keydown" ? ideKeydown : t === "blur" ? ideBlur : idePaste));
  try { if (el.ownerDocument.activeElement === el) el.blur(); } catch (_) {}   // item 272: the iPhone keyboard goes when the words are let go (as in ipeEnd)
  Object.keys(s.prev).forEach((a) => { if (s.prev[a] == null) el.removeAttribute(a); else el.setAttribute(a, s.prev[a]); });
  el.classList.remove("ipe-on");
  const text = String(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, s.spec.max);
  const keep = () => { el.textContent = s.orig; ideRelease(); };
  if (!save || text === String(s.orig).replace(/\s+/g, " ").trim()) return keep();
  if (!text && s.field === "business_name") { keep(); toast("Your business needs a name, so it stays as it was.", true); return; }
  if (!text && s.sample) return keep();   // clearing a sample changes nothing
  el.textContent = text;
  const inp = $(s.spec.input);
  if (!inp) return ideRelease();
  inp.value = text; inp.dispatchEvent(new Event("input", { bubbles: true }));
  // Saved now, not after the form's pause, so Preview, a page change or closing the tab can't
  // beat it. A redraw before it lands would paint the old words back.
  const saving = IDE_SAVING = debounceFlush("identity:" + s.field).finally(() => { if (IDE_SAVING === saving) IDE_SAVING = null; ideRelease(); });
}
// Builder item 272: iPhone Safari scrolls the whole editor up to make room for its keyboard and
// doesn't always scroll it back, which left the top bar (Exit, Preview, Publish) off the top of
// the screen with a grey gap at the bottom. The editor is a fixed full-screen layout that never
// scrolls as a page, so once the keyboard has gone it goes back to the top.
if (window.visualViewport) window.visualViewport.addEventListener("resize", () => {
  if (!document.documentElement.classList.contains("dc-edit") || IPE || IDE) return;
  if (window.visualViewport.height < window.innerHeight * 0.85) return;   // the keyboard is still up
  if (window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) { window.scrollTo(0, 0); document.body.scrollTop = 0; }
});
function ideRelease() {   // the redraw a session or its save held off
  if (!DP_REPAINT_HELD || IPE || IDE || IDE_SAVING) return;
  DP_REPAINT_HELD = false; dcCaptureScroll(); refreshDesignPreview();
}
// ── inject the editing chrome into the rendered preview document ─────────────
// live: one section was swapped in place by the live redraw (dcLiveNow). Its neighbours, the
// add-section lines between them and the Contents list still stand, so only the new section
// is wired (item 85); a full redraw rebuilds all of it.
// The editor's colours, read off the shell's tokens and handed into the frame as
// variables (--ddsdc-*). The tools inside the frame follow the shell's light and dark
// modes through them; the site itself is never touched.
let DC_CHROME_INSET = 0;   // px from the frame's left edge that the dock covers (0 on a phone, where the dock is along the bottom)
// What the floating chrome covers of the frame right now: the dock and the Add or Pages card
// on the left, the Styles or Comments card on the right. The section pill and its chip keep clear.
function dcChromeInsets() {
  const out = { left: DC_CHROME_INSET, right: 0 };
  try {
    if (window.innerWidth <= 760) return out;   // a phone's cards are sheets, under the pill's row
    const fr = $("designPreview").getBoundingClientRect();
    ["settingsPanel", "commentsPanel", "ritualWrap"].forEach((id) => { const p = $(id); if (p && p.classList.contains("on") && (id !== "ritualWrap" || p.classList.contains("as-card"))) { const r = p.getBoundingClientRect(); out.right = Math.max(out.right, Math.round(fr.right - r.left + 8)); } });
    ["trayPanel", "pagesCard"].forEach((id) => { const t = $(id); if (t && t.classList.contains("on")) { const r = t.getBoundingClientRect(); out.left = Math.max(out.left, Math.round(r.right + 8 - fr.left)); } });
  } catch (_) {}
  return out;
}
function dcChromeTokens() {
  let foot = 0;   // on a phone the dock runs along the bottom, over the frame's last strip
  try {
    const dk = $("dcDock"), fr = $("designPreview"); DC_CHROME_INSET = 0;
    if (dk && fr && window.innerWidth > 760) { const a = dk.getBoundingClientRect(), b = fr.getBoundingClientRect(); if (a.width && a.height) DC_CHROME_INSET = Math.max(0, Math.round(a.right + 8 - b.left)); }
    else if (dk && fr) { const a = dk.getBoundingClientRect(), b = fr.getBoundingClientRect(); if (a.width && a.height) foot = Math.max(0, Math.round(b.bottom - a.top + 8)); }
  } catch (_) {}
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => { const x = (cs.getPropertyValue(n) || "").trim(); return x || d; };
  const p = v("--dds-p", "#6d3fd4");
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(p);
  let rgb = "109,63,212";
  if (m) { let h = m[1]; if (h.length === 3) h = h.split("").map((c) => c + c).join(""); rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(","); }
  return ":root{--ddsdc-card:" + v("--dds-card", "#fff") + ";--ddsdc-ink:" + v("--dds-ink", "#171522") + ";--ddsdc-soft:" + v("--dds-soft", "#55526a")
    + ";--ddsdc-line:" + v("--dds-line", "#e7e6ef") + ";--ddsdc-line2:" + v("--dds-line-strong", "#d6d4e2") + ";--ddsdc-up:" + v("--dds-up", "#f7f6fb")
    + ";--ddsdc-p:" + p + ";--ddsdc-p-rgb:" + rgb + ";--ddsdc-p-soft:" + v("--dds-p-soft", "#f0ebfd") + ";--ddsdc-on-p:" + v("--dds-on-p", "#fff")
    + ";--ddsdc-grad:" + v("--dds-grad-btn", "linear-gradient(135deg,#6d3fd4 0%,#7a4bdd 100%)")
    + ";--ddsdc-bad:" + v("--dds-bad", "#bf3535") + ";--ddsdc-bad-soft:" + v("--dds-bad-soft", "#fdeaea")
    + ";--ddsdc-shadow:" + v("--dds-shadow-pop", "0 20px 48px -12px rgba(23,21,34,.24),0 2px 6px rgba(23,21,34,.06)")
    + ";--ddsdc-sans:" + v("--dds-sans", "Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif") + ";--ddsdc-foot:" + foot + "px}";
}
function dcInjectCanvas(doc, main, live) {
  const win = doc.defaultView;
  if (!doc.getElementById("dds-dc-style")) {
    const st = doc.createElement("style"); st.id = "dds-dc-style";
    st.textContent =
      // The floating studio (Nov 2026): every colour here is one of the shell's tokens,
      // handed in by dcChromeTokens (#dds-dc-tokens), so the tools follow the editor's
      // light and dark modes while the page underneath keeps its own colours.
      ".dc-hot{outline:2px solid var(--ddsdc-p)!important;outline-offset:-2px}" +
      "[data-dds-field]:hover{outline:1px dashed rgba(var(--ddsdc-p-rgb),.6);outline-offset:3px;cursor:text}" +   // says "you can type here" before anyone double-clicks
      Object.keys(IDE_FIELDS).map((p) => '[data-pr="' + p + '"]:hover').join(",") + ',[data-pr="offering"] .nm:hover,[data-pr="offering"] .ds:hover,[data-pr="offering"] .pr:hover,dt[data-pr="faq"]:hover,dt[data-pr="faq"]+dd:hover,[data-pr="testimonial"] blockquote p:hover' + "{outline:1px dashed rgba(var(--ddsdc-p-rgb),.6);outline-offset:3px;cursor:text}" +
      // the section pill: a white card of icons inside the selected section's top-right corner
      "#dds-dc-bar .dc-grip{touch-action:none;user-select:none}" +
      "#dds-dc-bar{position:absolute;z-index:2147483000;display:none;align-items:center;gap:2px;padding:4px;background:var(--ddsdc-card);border:1px solid rgba(var(--ddsdc-p-rgb),.08);border-radius:999px;box-shadow:var(--ddsdc-shadow);font-family:var(--ddsdc-sans)}" +
      "#dds-dc-bar.on{display:flex}" +
      "#dds-dc-bar .dc-b{position:relative;width:32px;height:32px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--ddsdc-soft);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font:inherit}" +
      "#dds-dc-bar .dc-b svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;display:block}" +
      "#dds-dc-bar .dc-b:hover{background:var(--ddsdc-up);color:var(--ddsdc-ink)}" +
      "#dds-dc-bar .dc-b.dc-on,#dds-dc-bar .dc-b[aria-expanded=\"true\"]{background:var(--ddsdc-p-soft);color:var(--ddsdc-p)}" +
      "#dds-dc-bar .dc-grip{cursor:grab}#dds-dc-bar .dc-grip:active{cursor:grabbing}" +
      "#dds-dc-bar .dc-danger:hover{background:var(--ddsdc-bad-soft);color:var(--ddsdc-bad)}" +
      "#dds-dc-bar .dc-b:focus-visible{outline:2px solid var(--ddsdc-p);outline-offset:1px}" +
      "#dds-dc-bar .dc-off,#dds-dc-more .dc-off{opacity:.4;pointer-events:none}" +
      ".dc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}" +
      // the name chip at the section's top left: what it is and what kind
      "#dds-dc-chip{position:absolute;z-index:2147483000;display:none;align-items:center;height:24px;max-width:min(60vw,360px);padding:0 10px;border-radius:999px;background:var(--ddsdc-p-soft);color:var(--ddsdc-p);font:600 12px/1 var(--ddsdc-sans);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:none}" +
      "#dds-dc-chip.on{display:inline-flex}" +
      // items 41, 50 and 123: the header and footer are picked like a section, and say they're on every page
      "header.site[data-dc-hf]:hover,footer.site[data-dc-hf]:hover,header.site.dc-hf-on,footer.site.dc-hf-on{outline:2px solid var(--ddsdc-p);outline-offset:-2px;cursor:pointer}" +
      ".dds-phonebar[data-dc-pb]:hover,.dds-phonebar.dc-hf-on{outline:2px solid var(--ddsdc-p);outline-offset:-2px;cursor:pointer}" +   // item 122: the phone bar belongs to the footer
      // on a phone the editor's dock covers the frame's foot: the bar sits just above it, and the page's end above both
      ".dds-phonebar{bottom:var(--ddsdc-foot,0px)!important}" +
      "html body{padding-bottom:var(--ddsdc-foot,0px)}" +   // item 171 (E5): the page's end scrolls clear of the phone's dock
      // the chip stays in the tab order (a keyboard's way in), seen only on hover, focus or while its card is open
      // it hangs off the edge (under the header, over the footer), so the name and menu stay clear to click
      ".dc-hf-chip{position:absolute;left:12px;top:calc(100% - 12px);z-index:30;display:inline-flex;align-items:center;height:24px;padding:0 10px;border:0;border-radius:999px;background:var(--ddsdc-p-soft);color:var(--ddsdc-p);font:600 12px/1 var(--ddsdc-sans);white-space:nowrap;cursor:pointer;opacity:0;pointer-events:none}" +
      "[data-dc-hf]:hover>.dc-hf-chip,.dc-hf-chip:focus-visible,.dc-hf-on>.dc-hf-chip{opacity:1;pointer-events:auto}" +
      "footer.site>.dc-hf-chip{top:-12px}" +
      ".dc-hf-chip:focus-visible{outline:2px solid var(--ddsdc-p);outline-offset:2px}" +
      // item 118: each section's colour theme, while colours are being chosen
      "#dds-dc-themes{position:absolute;left:0;top:0;width:0;height:0;z-index:2147482990;pointer-events:none}" +
      ".dds-theme-tag{position:absolute;display:inline-flex;align-items:center;gap:6px;height:24px;padding:0 10px 0 6px;border-radius:999px;background:var(--ddsdc-card);border:1px solid var(--ddsdc-line);box-shadow:0 2px 8px rgba(0,0,0,.12);color:var(--ddsdc-ink);font:600 12px/1 var(--ddsdc-sans);white-space:nowrap}" +
      ".dds-theme-tag i{width:12px;height:12px;border-radius:50%;border:1px solid var(--ddsdc-line2)}" +
      "#dds-dc-chip .dc-chip-type{font-weight:500;margin-left:5px}" +   // full strength: faded, it read 3.8 to 1 on the chip (item 158's check)
      "#dds-dc-chip.locked>svg{flex:none;width:12px;height:12px;margin-right:5px;vertical-align:-1px}" +   // item 155: a locked section's padlock
      "#dds-dc-bar .dc-b.dc-locked{color:var(--ddsdc-p)}" +
      "#dds-dc-chip.compact .dc-chip-type{display:none}" +
      // the More menu under the pill: copy, cut, hide, columns
      "#dds-dc-more{position:absolute;z-index:2147483001;display:none;flex-direction:column;min-width:200px;padding:6px;background:var(--ddsdc-card);border:1px solid rgba(var(--ddsdc-p-rgb),.08);border-radius:14px;box-shadow:var(--ddsdc-shadow);font-family:var(--ddsdc-sans)}" +
      "#dds-dc-more.on{display:flex}" +
      "#dds-dc-more .dc-mi{display:flex;align-items:center;gap:10px;height:36px;padding:0 10px;border:0;border-radius:10px;background:transparent;color:var(--ddsdc-ink);font:500 13px/1 var(--ddsdc-sans);text-align:left;white-space:nowrap;cursor:pointer}" +
      "#dds-dc-more .dc-mi svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;color:var(--ddsdc-soft)}" +
      "#dds-dc-more .dc-mi:hover{background:var(--ddsdc-up)}" +
      "#dds-dc-more .dc-danger:hover{background:var(--ddsdc-bad-soft);color:var(--ddsdc-bad)}" +
      "#dds-dc-more .dc-mi:focus-visible{outline:2px solid var(--ddsdc-p);outline-offset:-2px}" +
      // item 158: the right-click menu, at the pointer, with each action's key on its right
      "#dds-dc-ctx{position:absolute;z-index:2147483002;display:none;flex-direction:column;width:272px;max-width:calc(100vw - 16px);left:var(--dcx,0);top:var(--dcy,0);padding:6px;background:var(--ddsdc-card);border:1px solid rgba(var(--ddsdc-p-rgb),.08);border-radius:14px;box-shadow:var(--ddsdc-shadow);font-family:var(--ddsdc-sans)}" +
      "#dds-dc-ctx.on{display:flex}" +
      "#dds-dc-ctx .dc-ctx-list{display:flex;flex-direction:column}" +
      "#dds-dc-ctx .dc-ctx-h{padding:6px 10px 7px;font:500 12px/1.3 var(--ddsdc-sans);color:var(--ddsdc-soft);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      "#dds-dc-ctx .dc-mi{display:flex;align-items:center;gap:10px;min-height:34px;padding:0 10px;border:0;border-radius:10px;background:transparent;color:var(--ddsdc-ink);font:500 13px/1 var(--ddsdc-sans);text-align:left;white-space:nowrap;cursor:pointer}" +
      "#dds-dc-ctx .dc-mi svg{width:16px;height:16px;flex:none;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;color:var(--ddsdc-soft)}" +
      "#dds-dc-ctx .dc-mi:hover,#dds-dc-ctx .dc-mi:focus{background:var(--ddsdc-up);outline:none}" +
      "#dds-dc-ctx .dc-mi:focus-visible{outline:2px solid var(--ddsdc-p);outline-offset:-2px}" +
      "#dds-dc-ctx .dc-danger,#dds-dc-ctx .dc-danger svg{color:var(--ddsdc-bad)}" +
      "#dds-dc-ctx .dc-danger:hover,#dds-dc-ctx .dc-danger:focus{background:var(--ddsdc-bad-soft)}" +
      "#dds-dc-ctx .dc-off{opacity:.4;pointer-events:none}" +
      "#dds-dc-ctx .dc-all,#dds-dc-ctx .dc-all svg{color:var(--ddsdc-p);font-weight:600}" +
      "#dds-dc-ctx .dc-sep{height:1px;margin:5px 6px;background:rgba(var(--ddsdc-p-rgb),.1)}" +
      "#dds-dc-ctx .dc-keys{margin-left:auto;display:inline-flex;gap:3px;padding-left:14px}" +
      "#dds-dc-ctx kbd{min-width:20px;height:20px;padding:0 5px;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;border:1px solid rgba(var(--ddsdc-p-rgb),.18);border-radius:5px;background:var(--ddsdc-card);color:var(--ddsdc-soft);font:500 12px/1 var(--ddsdc-sans)}" +
      "[data-dc]:focus-visible{outline:2px solid var(--ddsdc-p);outline-offset:-2px}" +
      // ── insertion targets: a line between every section (and top/bottom) with a plum
      // "Add section" pill on it. Clicking one opens the section picker AT that spot; it's
      // also the drop target the drag ghost snaps to. Purely an editing overlay — never served.
      "#presence-preview-badge{display:none!important}" +
      // item 57: a Blocks section's blocks: outlined under the pointer, picked with a click, and their toolbar
      ".block-stack [data-dds-item]{cursor:pointer}" +
      ".block-stack [data-dds-item]:hover{outline:1px dashed rgba(var(--ddsdc-p-rgb),.55);outline-offset:4px}" +
      ".block-stack .dc-blk-on,.block-stack .dc-blk-on:hover{outline:2px solid var(--ddsdc-p)!important;outline-offset:4px}" +
      "#dds-dc-blk{position:absolute;z-index:2147483000;display:none;align-items:center;gap:2px;padding:4px;background:var(--ddsdc-card);border:1px solid rgba(var(--ddsdc-p-rgb),.08);border-radius:999px;box-shadow:var(--ddsdc-shadow);font-family:var(--ddsdc-sans)}" +
      "#dds-dc-blk.on{display:flex}" +
      "#dds-dc-blk .dc-blk-name{padding:0 6px 0 10px;font:600 12.5px/1 var(--ddsdc-sans);color:var(--ddsdc-ink);white-space:nowrap}" +
      "#dds-dc-blk .dc-blk-sep{width:1px;height:22px;background:var(--ddsdc-line);margin:0 2px}" +
      "#dds-dc-blk .dc-b{position:relative;width:32px;height:32px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--ddsdc-soft);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;font:inherit}" +
      "#dds-dc-blk .dc-b svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;display:block}" +
      "#dds-dc-blk .dc-b:hover{background:var(--ddsdc-up);color:var(--ddsdc-ink)}" +
      "#dds-dc-blk .dc-b.dc-on,#dds-dc-blk .dc-b[aria-expanded=\"true\"]{background:var(--ddsdc-p-soft);color:var(--ddsdc-p)}" +
      "#dds-dc-blk .dc-danger{color:var(--ddsdc-bad)}#dds-dc-blk .dc-danger:hover{background:var(--ddsdc-bad-soft);color:var(--ddsdc-bad)}" +
      "#dds-dc-blk .dc-b:focus-visible{outline:2px solid var(--ddsdc-p);outline-offset:1px}" +
      "#dds-dc-blk .dc-off{opacity:.4;pointer-events:none}" +
      "#dds-dc-blkmore{position:absolute;z-index:2147483001;display:none;flex-direction:column;min-width:210px;padding:6px;background:var(--ddsdc-card);border:1px solid rgba(var(--ddsdc-p-rgb),.08);border-radius:14px;box-shadow:var(--ddsdc-shadow);font-family:var(--ddsdc-sans)}" +
      "#dds-dc-blkmore.on{display:flex}" +
      "#dds-dc-blkmore .dc-mi{display:flex;align-items:center;gap:10px;height:36px;padding:0 10px;border:0;border-radius:10px;background:transparent;color:var(--ddsdc-ink);font:500 13px/1 var(--ddsdc-sans);text-align:left;white-space:nowrap;cursor:pointer}" +
      "#dds-dc-blkmore .dc-mi svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round;color:var(--ddsdc-soft)}" +
      "#dds-dc-blkmore .dc-mi:hover{background:var(--ddsdc-up)}#dds-dc-blkmore .dc-mi:focus-visible{outline:2px solid var(--ddsdc-p);outline-offset:-2px}" +
      "#dds-dc-bar .dc-addblk{width:auto;padding:0 12px 0 9px;gap:6px;border-radius:999px;background:var(--ddsdc-p-soft);color:var(--ddsdc-p)}" +
      "#dds-dc-bar .dc-addblk:hover{background:var(--ddsdc-p-soft);color:var(--ddsdc-p);filter:brightness(.97)}" +
      "#dds-dc-bar .dc-addblk svg{width:16px;height:16px}" +
      "#dds-dc-bar .dc-addblk-l{font:600 12px/1 var(--ddsdc-sans);white-space:nowrap}" +
      ".dc-ins{position:relative;height:16px;margin:0;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:var(--ddsdc-sans)}" +
      ".dc-ins::before{content:'';position:absolute;left:0;right:0;top:50%;height:0;border-top:2px solid rgba(var(--ddsdc-p-rgb),.35);transform:translateY(-50%);transition:border-color var(--dds-t-fast,120ms) var(--dds-ease,ease-out)}" +
      ".dc-ins:hover::before,.dc-ins:focus-within::before{border-top-color:var(--ddsdc-p)}" +
      "@media(hover:hover){.dc-ins:not(:hover):not(:focus-within):not(.dc-drop-active)::before{border-top-color:transparent}}" +
      ".dc-ins .dc-ins-pill{opacity:0;transition:opacity var(--dds-t-fast,120ms) var(--dds-ease,ease-out);position:relative;z-index:1;display:inline-flex;align-items:center;gap:6px;font:600 12px/1 var(--ddsdc-sans);color:var(--ddsdc-on-p);background:var(--ddsdc-p) var(--ddsdc-grad);border:none;border-radius:999px;padding:7px 14px 7px 11px;cursor:pointer;box-shadow:0 6px 16px -8px rgba(var(--ddsdc-p-rgb),.8);white-space:nowrap}" +
      ".dc-ins .dc-ins-pill svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}" +
      ".dc-ins:hover .dc-ins-pill,.dc-ins:focus-within .dc-ins-pill{opacity:1}" +
      // builder item 98: on a touch screen the section's tools and the add-a-section line are full 44px taps.
      // The line's own band is 44px there: a clear strip reaching into the sections either side stopped
      // WebKit tapping the section itself (builder-blocks-57's touch tests).
      "@media (pointer:coarse){#dds-dc-bar .dc-b{width:44px;height:44px}#dds-dc-bar .dc-addblk{width:auto}.dc-ins,.dc-ins.dc-drop-active{height:44px}}" +
      ".dc-ins.dc-drop-active{height:22px}" +
      ".dc-ins.dc-drop-active::before{border-top:4px solid var(--ddsdc-p)}" +
      ".dc-ins.dc-drop-active .dc-ins-pill{opacity:1}" +
      ".dc-emptyzone{margin:26px 18px;padding:44px 24px;border:2px dashed var(--ddsdc-line2);border-radius:20px;text-align:center;background:rgba(var(--ddsdc-p-rgb),.04);cursor:pointer;font-family:var(--ddsdc-sans);transition:border-color var(--dds-t-fast,120ms) var(--dds-ease,ease-out),background var(--dds-t-fast,120ms) var(--dds-ease,ease-out)}" +
      ".dc-emptyzone:hover,.dc-emptyzone.dc-drop-active{border-color:var(--ddsdc-p);background:rgba(var(--ddsdc-p-rgb),.08)}" +
      ".dc-emptyzone .dc-ez-t{font:700 18px var(--ddsdc-sans);color:#171522;margin:0 0 6px}" +
      ".dc-emptyzone .dc-ez-s{font:400 13px var(--ddsdc-sans);color:#55526a;max-width:34ch;margin:0 auto}" +
      ".dc-emptyzone .dc-ez-acts{margin-top:16px;display:flex;gap:10px;flex-wrap:wrap;justify-content:center}" +
      ".dc-emptyzone .dc-ez-btn{font:600 13.5px var(--ddsdc-sans);color:var(--ddsdc-on-p);background:var(--ddsdc-p) var(--ddsdc-grad);border:none;border-radius:999px;padding:11px 22px;cursor:pointer;box-shadow:0 6px 16px -8px rgba(var(--ddsdc-p-rgb),.8)}" +
      ".dc-emptyzone .dc-ez-btn2{font:600 13.5px var(--ddsdc-sans);color:#171522;background:#fff;border:1px solid var(--ddsdc-line2);border-radius:999px;padding:11px 20px;cursor:pointer}" +
      ".dc-emptyzone .dc-ez-btn:hover{filter:brightness(1.06)}.dc-emptyzone .dc-ez-btn2:hover{border-color:var(--ddsdc-p)}" +
      // Layout Mode: the drag-to-resize divider between two columns + the 12-unit grid guide shown while resizing.
      ".block-columns .col{position:relative}" +
      ".dc-colh{position:absolute;top:0;bottom:0;right:-13px;width:20px;cursor:col-resize;z-index:6;display:flex;align-items:center;justify-content:center;touch-action:none}" +
      ".dc-colh::before{content:'';width:5px;height:46px;max-height:60%;background:var(--ddsdc-p);border-radius:4px;box-shadow:0 0 0 3px rgba(var(--ddsdc-p-rgb),.18);opacity:.5;transition:opacity var(--dds-t-fast,120ms) var(--dds-ease,ease-out)}" +
      ".dc-colh:hover::before,.dc-colh:active::before{opacity:1}" +
      ".block-columns .cols.dc-grid-show{background-image:repeating-linear-gradient(90deg,rgba(var(--ddsdc-p-rgb),.09) 0,rgba(var(--ddsdc-p-rgb),.09) 1px,transparent 1px,transparent 8.3333%);background-position:0 0}" +
      // a just-added section pulses so a drop is never invisible
      "@keyframes dcJustAdded{0%{box-shadow:0 0 0 3px rgba(var(--ddsdc-p-rgb),.55),0 0 0 9px rgba(var(--ddsdc-p-rgb),.22)}100%{box-shadow:0 0 0 3px rgba(var(--ddsdc-p-rgb),0),0 0 0 9px rgba(var(--ddsdc-p-rgb),0)}}" +
      ".dc-justadded{animation:dcJustAdded 1.5s ease-out;border-radius:6px}" +
      // item 318: a section just added, until the server draws it
      ".dc-ghost{padding:28px 24px!important}.dc-ghost .dc-ghost-in{min-height:72px;display:flex;align-items:center;justify-content:center;border:2px dashed rgba(var(--ddsdc-p-rgb),.45);border-radius:14px;background:rgba(var(--ddsdc-p-rgb),.05);font:600 14px var(--ddsdc-sans);color:var(--ddsdc-p)}" +
      "@media (prefers-reduced-motion:reduce){.dc-justadded{animation:none;outline:3px solid rgba(var(--ddsdc-p-rgb),.5);outline-offset:-3px}}" +
      // ── G13 slice 2: the in-place text session + its md mini-bar + a11y bits ──
      ".ipe-on{outline:2px solid var(--ddsdc-p)!important;outline-offset:2px;box-shadow:0 0 0 6px rgba(var(--ddsdc-p-rgb),.14);border-radius:4px;cursor:text;caret-color:var(--ddsdc-p)}" +
      "[data-ipe]:focus-visible{outline:2px dashed var(--ddsdc-p);outline-offset:2px}" +
      "#dds-ipe-bar{position:absolute;z-index:2147483001;display:none;gap:2px;background:var(--ddsdc-card);border:1px solid rgba(var(--ddsdc-p-rgb),.08);border-radius:999px;padding:4px;box-shadow:var(--ddsdc-shadow);font-family:var(--ddsdc-sans)}" +
      "#dds-ipe-bar.on{display:flex}" +
      "#dds-ipe-bar button{font:600 12px/1 var(--ddsdc-sans);color:var(--ddsdc-ink);background:transparent;border:0;border-radius:999px;padding:0 10px;height:30px;min-width:30px;cursor:pointer}" +
      "#dds-ipe-bar button:hover{background:var(--ddsdc-up)}" +
      "#dds-ipe-bar button:focus-visible{outline:2px solid var(--ddsdc-p);outline-offset:1px}" +
      // item 316: what's on, a divider, and the palette's round swatches
      "#dds-ipe-bar button.ipe-on{background:var(--ddsdc-p-soft);color:var(--ddsdc-p)}" +
      "#dds-ipe-bar .ipe-sep{width:1px;height:20px;margin:0 2px;background:var(--ddsdc-line);align-self:center}" +
      "#dds-ipe-bar .ipe-sw{width:26px;height:26px;min-width:0;padding:0;margin:2px;border-radius:50%;border:2px solid rgba(var(--ddsdc-p-rgb),.18);align-self:center}" +
      "#dds-ipe-bar .ipe-sw.ipe-on{border-color:var(--ddsdc-p);box-shadow:0 0 0 2px var(--ddsdc-card)}" +
      "#dds-ipe-bar .ipe-sw.ipe-none{background:linear-gradient(135deg,transparent 45%,var(--ddsdc-bad) 45%,var(--ddsdc-bad) 55%,transparent 55%)}" +
      "#dds-ipe-bar{max-width:calc(100vw - 24px);flex-wrap:wrap}" +
      "#dds-ipe-bar.ipe-foot{position:fixed;left:8px;right:8px;top:auto;bottom:calc(var(--ddsdc-foot,0px) + 8px);justify-content:center;border-radius:18px}" +
      "@media (pointer:coarse){#dds-ipe-bar button{height:44px;min-width:44px}#dds-ipe-bar .ipe-sw{width:40px;height:40px}}" +
      ".ipe-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}";
    (doc.head || doc.documentElement).appendChild(st);
  }
  // the shell's colours, refreshed on every injection so a theme change follows into the frame
  let tk = doc.getElementById("dds-dc-tokens");
  if (!tk) { tk = doc.createElement("style"); tk.id = "dds-dc-tokens"; (doc.head || doc.documentElement).appendChild(tk); }
  tk.textContent = dcChromeTokens();
  let bar = doc.getElementById("dds-dc-bar");
  if (!bar) { bar = doc.createElement("div"); bar.id = "dds-dc-bar"; bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Edit this section"); doc.body.appendChild(bar); }
  // the name chip and the More menu ride along with the pill
  let chip = doc.getElementById("dds-dc-chip");
  if (!chip) { chip = doc.createElement("div"); chip.id = "dds-dc-chip"; chip.setAttribute("aria-hidden", "true"); doc.body.appendChild(chip); }
  let more = doc.getElementById("dds-dc-more");
  if (!more) { more = doc.createElement("div"); more.id = "dds-dc-more"; more.setAttribute("role", "menu"); more.setAttribute("aria-label", "More for this section"); doc.body.appendChild(more); }
  // item 158: and the right-click menu, its name above its list
  let ctx = doc.getElementById("dds-dc-ctx");
  if (!ctx) { ctx = doc.createElement("div"); ctx.id = "dds-dc-ctx"; doc.body.appendChild(ctx); }
  // Item 82: what the bar points at and its hide timer live on the document. A live redraw
  // runs this again on the same document while older sections keep their first listeners;
  // with a copy per run, leaving a redrawn section for an older one hid the bar under the
  // pointer. The bar's own two listeners go on once.
  const ds = doc.__dcBarState || (doc.__dcBarState = { current: null, hideT: null });
  // The pill sits INSIDE the selected section's top-right corner, the name chip at its
  // top left (direction A). Once the section's top edge has scrolled away the pill rides
  // the visible top, and it never leaves the section. On a narrow section the chip keeps
  // the name only; if it would still touch the pill it sits just above the section (item 51:
  // in the phone frame it dropped under the pill, onto the section's heading), or under the
  // pill when the section's top is off the screen.
  // The menu opens under the pill, or above it when the screen's end (on a phone, the dock
  // floating over the frame's last --ddsdc-foot pixels) leaves no room below: it moves with the
  // pill as the page scrolls, so its last item (Lock this section, item 155) could never be reached.
  const placeMore = () => {
    const mb = bar.querySelector('[aria-haspopup="menu"]'); if (!mb) return;
    const br = bar.getBoundingClientRect(), mw = more.offsetWidth || 200, mh = more.offsetHeight || 0;
    const foot = parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue("--ddsdc-foot")) || 0;
    const below = win.innerHeight - foot - br.bottom - 6, above = br.top - 6;
    const up = mh > below && above > below;
    more.style.top = (up ? Math.max(win.scrollY + 4, br.top + win.scrollY - 6 - mh) : br.bottom + win.scrollY + 6) + "px";
    more.style.left = Math.max(win.scrollX + 8, br.right + win.scrollX - mw) + "px";
  };
  const place = (el2) => {
    const r = el2.getBoundingClientRect();
    const top = r.top + win.scrollY, left = r.left + win.scrollX, sy = win.scrollY, sx = win.scrollX;
    const vw = doc.documentElement.clientWidth;
    const w = bar.offsetWidth || 0, h = bar.offsetHeight || 0, ins = dcChromeInsets();
    let y = Math.max(top + 8, Math.min(sy + 8, top + r.height - h - 8));
    // a short section (a heading alone) would have its words under the pill: the pill
    // sits just above it instead, or just below when the top edge is off the screen
    if (r.height < h + 28) y = top - h - 6 >= sy + 4 ? top - h - 6 : top + r.height + 6;
    // item 319: on a phone the pill is nearly as wide as the page, so inside the section it sat
    // on the first words (a second tap to type landed on it): it sits just above the section
    else if (window.innerWidth <= 760 && top - h - 6 >= sy + 4) y = top - h - 6;
    const above = y < top;
    const x = Math.max(sx + 8 + ins.left, Math.min(left + r.width - w - 8, sx + vw - ins.right - w - 8));
    bar.style.left = x + "px"; bar.style.top = y + "px";
    chip.classList.toggle("compact", r.width < 560);
    const ch = chip.offsetHeight || 24, cw = chip.offsetWidth || 0, cx = Math.max(left + 8, sx + 8 + ins.left);
    chip.style.left = cx + "px";
    // item 319: the tag sits just above the section, clear of its words, when that is on screen
    chip.style.top = (above ? (y - ch - 4 >= sy + 4 ? y - ch - 4 : top + 8) : top - ch - 6 >= sy + 4 ? top - ch - 6 : cx + cw + 8 <= x ? y + (h - ch) / 2 : y + h + 6) + "px";
    if (more.classList.contains("on")) placeMore();
  };
  // item 158: the right-click menu. It holds the section's actions with their keys, and it keeps
  // its section picked while it's open; a press elsewhere, Escape, or a choice closes it.
  const closeCtx = (back) => {
    if (!ctx.classList.contains("on")) return;
    ctx.classList.remove("on"); ctx.textContent = "";
    const b = doc.__dcCtxBack; doc.__dcCtxBack = null;
    if (back && b && b.isConnected) { try { b.focus({ preventScroll: true }); } catch (_) {} }
  };
  doc.__dcCloseCtx = closeCtx;
  const hideBar = () => { closeCtx(false); bar.classList.remove("on"); chip.classList.remove("on"); more.classList.remove("on"); doc.__dcSel = null; if (ds.current) { ds.current.classList.remove("dc-hot"); ds.current = null; } };
  doc.__dcHideBar = hideBar;   // item 318: a section taken off the page takes its tools with it
  const scheduleHide = () => { clearTimeout(ds.hideT); if (ctx.classList.contains("on")) return; ds.hideT = setTimeout(hideBar, 170); };
  // List item 31: a finger has no hover. A tap selects a section and its toolbar
  // stays until another tap selects something else or lands off every section; a
  // second tap on the selected section's words edits them in place, as a
  // double-click does with a mouse. The pretend mouse events a browser sends after
  // a tap are ignored, so they can't hide the bar a moment after the tap showed it.
  // The time of the last touch lives on the document, since every redraw of the
  // canvas runs this again and older sections keep their first listeners.
  const byTouch = () => Date.now() - (doc.__dcTouchAt || 0) < 900;
  if (!bar.__dcWired) {
    bar.__dcWired = true;
    bar.addEventListener("mouseenter", () => clearTimeout(ds.hideT));
    bar.addEventListener("mouseleave", scheduleHide);
    more.addEventListener("mouseenter", () => clearTimeout(ds.hideT));
    more.addEventListener("mouseleave", scheduleHide);
  }
  if (!ctx.__dcWired) {
    ctx.__dcWired = true;
    ctx.addEventListener("mouseenter", () => clearTimeout(ds.hideT));
    ctx.addEventListener("keydown", (e) => {   // a menu's keys: up and down, Home and End, Escape
      const items = [...ctx.querySelectorAll(".dc-mi:not(.dc-off)")], at = items.indexOf(doc.activeElement);
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); doc.__dcCloseCtx(true); return; }
      if (e.key === "Tab") { doc.__dcCloseCtx(false); return; }
      if (!/^(ArrowDown|ArrowUp|Home|End)$/.test(e.key) || !items.length) return;
      e.preventDefault(); e.stopPropagation();
      const nx = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
        : e.key === "ArrowDown" ? (at + 1) % items.length : (at <= 0 ? items.length - 1 : at - 1);
      try { items[nx].focus({ preventScroll: true }); } catch (_) {}
    });
    doc.addEventListener("pointerdown", (e) => { if (ctx.classList.contains("on") && !ctx.contains(e.target)) doc.__dcCloseCtx(false); }, true);
  }
  const mkBtn = (label, aria, fn, opts) => {
    const b = doc.createElement("button"); b.type = "button"; b.className = "dc-b" + ((opts && opts.cls) ? " " + opts.cls : "");
    b.innerHTML = (opts && opts.icon ? uiIcon(opts.icon, 18) : "") + '<span class="dc-sr"></span>';
    b.lastChild.textContent = label;
    b.setAttribute("aria-label", aria); b.title = aria;
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (fn) fn(); });
    return b;
  };
  const mkItem = (label, aria, fn, opts) => {
    const b = doc.createElement("button"); b.type = "button"; b.className = "dc-mi" + ((opts && opts.cls) ? " " + opts.cls : ""); b.setAttribute("role", "menuitem");
    b.innerHTML = (opts && opts.icon ? uiIcon(opts.icon, 16) : "") + "<span></span>";
    b.lastChild.textContent = label;
    b.setAttribute("aria-label", aria); b.title = aria;
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); more.classList.remove("on"); if (fn) fn(); });
    return b;
  };
  const ctxItem = (a) => {
    const b = doc.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem");
    b.className = "dc-mi" + (a.danger ? " dc-danger" : "") + (a.off ? " dc-off" : "") + (a.cls ? " " + a.cls : "");
    b.innerHTML = uiIcon(a.icon, 16) + "<span></span>"; b.querySelector("span").textContent = a.label;
    if (a.keys) {   // the key, drawn on the right; a screen reader hears it from aria-keyshortcuts
      const ks = doc.createElement("span"); ks.className = "dc-keys"; ks.setAttribute("aria-hidden", "true");
      a.keys.forEach((k) => { const kb = doc.createElement("kbd"); kb.textContent = k; ks.appendChild(kb); });
      b.appendChild(ks); b.setAttribute("aria-keyshortcuts", dcKeysAria(a.keys));
    }
    if (a.off) b.setAttribute("aria-disabled", "true");
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (a.off) return; closeCtx(false); a.run(); });
    return b;
  };
  const openCtx = (el2, x, y) => {
    ctx.textContent = "";
    const h = doc.createElement("div"); h.className = "dc-ctx-h"; h.id = "dds-dc-ctx-h"; h.textContent = ds.label || "This section";
    const list = doc.createElement("div"); list.className = "dc-ctx-list"; list.setAttribute("role", "menu"); list.setAttribute("aria-labelledby", h.id);
    ctx.append(h, list);
    const sep = () => { const l = list.lastChild; if (l && !l.classList.contains("dc-sep")) { const s = doc.createElement("div"); s.className = "dc-sep"; s.setAttribute("role", "separator"); list.appendChild(s); } };
    dcSectionActions(el2).forEach((a) => { if (a) list.appendChild(ctxItem(a)); else sep(); });
    sep();
    list.appendChild(ctxItem({ label: "All keyboard shortcuts", icon: "keyboard", keys: ["?"], cls: "dc-all", run: () => dcKeysSheet() }));
    ctx.classList.add("on");
    // at the pointer; turned up or in when the screen's end (on a phone, the dock) leaves no room
    const vw = doc.documentElement.clientWidth, vh = win.innerHeight, w = ctx.offsetWidth, hh = ctx.offsetHeight;
    const foot = parseFloat(win.getComputedStyle(doc.documentElement).getPropertyValue("--ddsdc-foot")) || 0;
    const left = Math.max(8, Math.min(x, vw - w - 8)), top = y + hh + 8 <= vh - foot ? y : Math.max(8, Math.min(y - hh, vh - foot - hh - 8));
    ctx.style.setProperty("--dcx", left + win.scrollX + "px"); ctx.style.setProperty("--dcy", top + win.scrollY + "px");
    doc.__dcCtxBack = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    const f = list.querySelector(".dc-mi:not(.dc-off)"); if (f) { try { f.focus({ preventScroll: true }); } catch (_) {} }
  };
  const showBar = (el2) => {
    if (IPE || DC_MODE !== "edit") return;   // G13 slice 2: the toolbar sleeps while a text session is active; item 99: and outside Edit mode, since Comments never edits
    clearTimeout(ds.hideT);
    if (ds.current && ds.current !== el2) ds.current.classList.remove("dc-hot");
    ds.current = el2; el2.classList.add("dc-hot");
    const c = eeClassify(el2); bar.textContent = ""; more.textContent = ""; more.classList.remove("on");
    const heading = ((el2.querySelector("h1,h2,h3") || {}).textContent || "").trim().slice(0, 40);
    let chipName = "", chipType = "";
    if (c.kind === "block") {
      const bi = c.bi, b = BLOCKS_WORK[bi] || {};
      const def = BLOCK_DEFS.find((x) => x.type === b.type) || {};
      chipType = def.name || b.type || "Section"; chipName = heading || chipType; if (chipName === chipType) chipType = "";
      if (lockedForMe(b)) {   // item 155: the studio locked it — its words at most, and a padlock that opens the card saying why
        if (b.lock.words) bar.appendChild(mkBtn("Edit words", "Change this section’s words", () => eeEditBlock(bi), { icon: "pencil" }));
        bar.appendChild(mkBtn("Locked", "Your studio locked this section so it stays as designed", () => eeEditBlock(bi), { cls: "dc-locked", icon: "lock" }));
      } else {
        const grip = mkBtn("Move", "Drag to move this section (or use the editor’s up/down arrows)", null, { cls: "dc-grip", icon: "grip" });
        // pointer-drag reorder — same engine as the tray. The grip lives INSIDE the
        // iframe, so its coords are iframe-local (iframeLocal:true translates them to
        // the parent for the ghost + drop-line). Resolves to one list index via dcMove.
        grip.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); pdStart(e, { kind: "move", from: bi, iframeLocal: true, label: (BLOCKS_WORK[bi] && (BLOCK_DEFS.find((x) => x.type === BLOCKS_WORK[bi].type) || {}).name) || "Section", icon: "⠿" }, grip); });
        bar.appendChild(grip);
        // item 57: a Blocks section takes new blocks here and shows them in Layers; a simple one turns into blocks first
        if (b.type === "stack" || STK_TURNS.has(b.type)) {
          const ab = mkBtn("Add block", b.type === "stack" ? "Add a block to this section" : "Add a block: this section becomes a Blocks section, its words and photos as they are", () => { if (b.type === "stack" || stkTurn(bi)) stkOpenAdd(bi); }, { cls: "dc-addblk", icon: "plus" });
          ab.lastChild.className = "dc-addblk-l";
          bar.appendChild(ab);
          if (b.type === "stack") bar.appendChild(mkBtn("Layers", "Layers: the blocks in this section", () => openTrayPanel("contents"), { icon: "layers" }));
        }
        bar.appendChild(mkBtn("Edit", "Edit this section", () => eeEditBlock(bi), { icon: "pencil" }));
        if (ROW_FIELDS[b.type] || b.type === "table") {   // item 315: a new row on the page, ready to type
          const one = b.type === "table" ? "row" : ROW_FIELDS[b.type].one;
          const ar = mkBtn("Add a " + one, "Add a " + one + " to this section", () => dcAddRow(bi), { cls: "dc-addblk", icon: "plus" });
          ar.lastChild.className = "dc-addblk-l"; bar.appendChild(ar);
        }
        bar.appendChild(mkBtn("Duplicate", "Duplicate this section", () => dcDuplicate(bi), { icon: "copy" }));
        bar.appendChild(mkBtn("Style", "Style this section — its colours, type and layout", () => eeEditBlock(bi, "style"), { icon: "spark" }));
        bar.appendChild(mkBtn("Delete", "Delete this section", () => dcDelete(bi), { cls: "dc-danger", icon: "x" }));
        // the rest behind More: copy, cut, hide, and a Columns section's column count
        more.appendChild(mkItem("Copy", "Copy this section — paste it anywhere", () => dcCopyBlock(bi), { icon: "clipboard" }));
        more.appendChild(mkItem("Cut", "Cut this section — paste it anywhere", () => dcCutBlock(bi), { icon: "scissors" }));
        // item 158: what a right-click offers is here too, for a finger: paste below and moving
        if (dcClipGet()) more.appendChild(mkItem("Paste below", "Paste the copied section below this one", () => dcPasteAt(bi + 1), { icon: "clipboard" }));
        more.appendChild(mkItem("Move up", "Move this section up", () => dcMove(bi, bi - 1), { cls: bi <= 0 ? "dc-off" : "", icon: "up" }));
        more.appendChild(mkItem("Move down", "Move this section down", () => dcMove(bi, bi + 2), { cls: bi >= BLOCKS_WORK.length - 1 ? "dc-off" : "", icon: "down" }));
        more.appendChild(mkItem("Hide", "Hide this section", () => eeHideKey(el2.getAttribute("data-dds-key") || ddsKeyFor(bi)), { icon: "eyeoff" }));
        if (b.type === "columns") {   // Layout Container: 1–6 columns; drag dividers to resize
          const nc = Array.isArray(b.columns) ? b.columns.length : 2;
          more.appendChild(mkItem(nc + (nc === 1 ? " column" : " columns"), "Columns — drag the dividers on the page to resize their widths", () => eeEditBlock(bi), { icon: "columns" }));
          more.appendChild(mkItem("Add a column", "Add a column", () => dcSetColumns(bi, nc + 1), { cls: nc >= 6 ? "dc-off" : "", icon: "plus" }));
          more.appendChild(mkItem("Remove a column", "Remove a column", () => dcSetColumns(bi, nc - 1), { cls: nc <= 1 ? "dc-off" : "", icon: "x" }));
        }
        if (locksAsStudio()) more.appendChild(blkLock(b)   // item 155: only the studio locks and unlocks
          ? mkItem("Unlock", "Unlock this section: your client can change it again", () => dcLockBlock(bi, false), { icon: "unlock" })
          : mkItem("Lock this section", "Lock this section: your client can’t move, restyle or delete it", () => dcLockBlock(bi, true), { icon: "lock" }));
        const mb = mkBtn("More", "More", null, { icon: "more" });
        mb.setAttribute("aria-haspopup", "menu"); mb.setAttribute("aria-expanded", "false");
        mb.addEventListener("click", () => { const on = !more.classList.contains("on"); more.classList.toggle("on", on); mb.setAttribute("aria-expanded", String(on)); if (on) { placeMore(); const f = more.querySelector(".dc-mi"); if (f) { try { f.focus({ preventScroll: true }); } catch (_) {} } } });
        bar.appendChild(mb);
      }
    } else {
      const bp = dcBuiltinPage(), cv = dcCoreView(c);   // item 314: on a built-in page, its own words
      chipName = heading || DC_CORE_NAME[cv] || "Section"; chipType = bp && !c.key ? "Built-in page" : "Built-in section";
      bar.appendChild(mkBtn("Edit", "Edit this section", () => eeEditCore(cv), { icon: "pencil" }));
      if (bp && !c.key) bar.appendChild(mkBtn("Page settings", "This page’s settings: its name in the menu and how it shows on Google", () => pgOpenSettings({ href: bp.path }), { icon: "cog" }));
      const keys = dcCoreKeys(main), at = c.key ? keys.indexOf(c.key) : -1;
      if (at >= 0) {
        bar.appendChild(mkBtn("Move up", "Move this section up", () => dcMoveCore(c.key, -1), { cls: at <= 0 ? "dc-off" : "", icon: "up" }));
        bar.appendChild(mkBtn("Move down", "Move this section down", () => dcMoveCore(c.key, 1), { cls: at >= keys.length - 1 ? "dc-off" : "", icon: "down" }));
      }
      if (c.key) bar.appendChild(mkBtn("Remove", "Remove this section from the page (bring it back in Styles → Your home page)", () => eeHideKey(c.key), { cls: "dc-danger", icon: "x" }));
    }
    chip.textContent = chipName;
    ds.label = chipName + (chipType ? " · " + chipType : "");   // the right-click menu's name for it
    if (chipType) { const t = doc.createElement("span"); t.className = "dc-chip-type"; t.textContent = "· " + chipType; chip.appendChild(t); }
    const locked = c.kind === "block" && !!blkLock(BLOCKS_WORK[c.bi]);   // item 155: a locked section wears a padlock in its name, for both sides
    chip.classList.toggle("locked", locked);
    if (locked) chip.insertAdjacentHTML("afterbegin", uiIcon("lock", 12));
    bar.classList.add("on"); chip.classList.add("on"); place(el2);
  };
  doc.__dcShowBar = showBar;   // item 318: the tools follow a section that just moved
  // G13: refresh the sid→index lookup from the server sidecar, then wire every
  // top-level section's hover toolbar (identity read straight off the stamps).
  // Drop targets are computed live from these section rects by the
  // pointer-drag engine (pdGaps) — no per-gap DOM nodes are injected any more.
  // KNOWN RACE (G13 review finding 2 — accepted, no code change): the
  // DDS_SRCMAP reset below trusts a frame LOAD as proof the stamps are fresh.
  // A second local edit while a preview fetch is already in flight (or a
  // failed save that schedules no reload) can land OLDER stamps here and
  // clear the remap they still needed — a stale window until the next
  // successful save→reload re-stamps and converges. The per-splice
  // compensation (dcComposeSrcMap at every BLOCKS_WORK splice) shrinks that
  // window; worst case is one mis-resolved hover, never a crash.
  if (!live) {
    ddsRebuildSidMap();
    DDS_SRCMAP = null;   // fresh canvas DOM = fresh data-dds-src stamps — the local-edit remap is consumed
    LIVE_DRAWN = null;   // and it shows the saved list
  }
  // G13 slice 2: a reload replaced any active session's document — its text was
  // already banked by refreshDesignPreview's pre-repaint commit; the stale
  // handle can't be restored, so drop it and let a deferred burst-save through.
  if (IPE) IPE = null;
  if (IDE && IDE.doc !== doc) ideEnd(true);   // a redraw is held while one is open, so this is a safety net: the typed words still save
  if (IPE_SAVE_PENDING) { IPE_SAVE_PENDING = false; ipeSaveSoon(); }
  // review fix 8: the save outcome was announced into the doc this repaint just
  // replaced — re-announce it once into the fresh document's live region.
  if (IPE_LIVE_MSG) { ipeAnnounce(doc, IPE_LIVE_MSG); IPE_LIVE_MSG = null; }
  if (!doc.body.hasAttribute("data-dc-touch")) {
    doc.body.setAttribute("data-dc-touch", "1");
    doc.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      doc.__dcTouchAt = Date.now();
      doc.__dcTapFrom = { x: e.clientX, y: e.clientY, at: Date.now() };
    }, true);
    // A tap off every section puts the toolbar away. It's read from the finger lifting, not
    // from a click: Safari sends no click for a tap on something that takes none (a footer,
    // the page's background), so on an iPhone the toolbar stayed up. A finger that moved or
    // stayed down is a scroll or a hold, not a tap.
    doc.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      const from = doc.__dcTapFrom; doc.__dcTapFrom = null;
      if (!from || Math.abs(e.clientX - from.x) > 10 || Math.abs(e.clientY - from.y) > 10 || Date.now() - from.at > 600) return;
      if (!doc.__dcSel) return;
      if (e.target.closest && e.target.closest("main > section, main > nav.block-toc, #dds-dc-bar, #dds-dc-more, #dds-ipe-bar, .dc-ins, .dc-colh, .dc-emptyzone")) return;
      hideBar();
    }, true);
  }
  const targets = main.querySelectorAll(":scope > section, :scope > nav.block-toc");
  Array.prototype.forEach.call(targets, (el2) => {
    if (!el2.hasAttribute("data-dc")) {
      el2.setAttribute("data-dc", "1");
      el2.addEventListener("mouseenter", () => { if (!byTouch()) showBar(el2); });
      el2.addEventListener("mouseleave", () => { if (!byTouch()) scheduleHide(); });
      // item 158: a right-click opens the section's actions at the pointer. Comments mode, a long
      // press and words being typed keep the browser's own menu (it has copy and paste).
      el2.addEventListener("contextmenu", (e) => {
        if (DC_MODE !== "edit" || byTouch()) return;
        if ((IPE && IPE.el && IPE.el.contains(e.target)) || (IDE && IDE.el.contains(e.target))) return;
        if (e.target.closest && e.target.closest("#dds-dc-bar,#dds-dc-more,#dds-dc-ctx,.dc-ins,.dc-colh")) return;
        e.preventDefault(); showBar(el2);
        if (!bar.classList.contains("on")) return;
        doc.__dcSel = el2; more.classList.remove("on");
        let x = e.clientX, y = e.clientY;
        if (!x && !y) { const r = el2.getBoundingClientRect(); x = r.left + 24; y = Math.max(8, r.top) + 24; }   // the menu key on a keyboard
        openCtx(el2, x, y);
      });
      el2.addEventListener("click", (e) => {
        // item 284: in Notes mode a press on a section opens its notes
        if (DC_MODE === "comments") {
          if (e.target.closest && e.target.closest(".dc-ins,#dds-dc-bar,#dds-dc-more,#dds-ipe-bar,.dc-colh,.dc-emptyzone")) return;
          const c = eeClassify(el2); if (c.kind !== "block") return;
          const sid = el2.getAttribute("data-dds-sid") || ddsSidFor(c.bi); if (!sid) return;
          e.preventDefault(); openCommentsThread(DC_PAGE, sid, dcBlockName(c.bi));
          return;
        }
        if (!byTouch()) return;   // a mouse click keeps its meaning: hover shows the bar, a double-click edits
        if (e.target.closest && e.target.closest(".dc-ins,#dds-dc-bar,#dds-dc-more,#dds-ipe-bar,.dc-colh,.dc-emptyzone")) return;
        if (IPE && IPE.el && IPE.el.contains(e.target)) return;   // typing in it already
        if (IDE && IDE.el.contains(e.target)) return;
        if (doc.__dcSel !== el2 || !bar.classList.contains("on")) {   // first tap: select it
          e.preventDefault(); showBar(el2); if (bar.classList.contains("on")) doc.__dcSel = el2;
          return;
        }
        if (DC_MODE !== "edit") return;   // Comments mode never edits
        const f = e.target.closest ? e.target.closest("[data-dds-field]") : null;
        const w = !f && e.target.closest ? e.target.closest("[data-pr]") : null;
        if (f && el2.contains(f)) { e.preventDefault(); hideBar(); ipeStart(doc, f, el2); }
        else if (((w && el2.contains(w)) || !w) && ideCan(w, e.target)) { e.preventDefault(); hideBar(); ideStart(doc, w, e.target); }
      });
      // G13 slice 2 · §2.1: double-click TEXT → edit it in place (Edit mode
      // only — the same chrome also serves Comments mode, which never edits).
      // Anything else — image, chrome, core, an unstamped section — routes to
      // the panel exactly as a single click would: never a dead double-click.
      el2.addEventListener("dblclick", (e) => {
        if (DC_MODE !== "edit") return;
        if (e.target.closest && e.target.closest(".dc-ins,#dds-dc-bar,#dds-dc-more,#dds-ipe-bar,.dc-colh,.dc-emptyzone")) return;
        if (IPE && IPE.el && IPE.el.contains(e.target)) return;   // inside the live session = word-select
        if (IDE && IDE.el.contains(e.target)) return;
        const f = e.target.closest ? e.target.closest("[data-dds-field]") : null;
        const w = !f && e.target.closest ? e.target.closest("[data-pr]") : null;   // the welcome section's and About's own words
        e.preventDefault();
        if (f && el2.contains(f)) ipeStart(doc, f, el2);
        else if (!(((w && el2.contains(w)) || !w) && ideStart(doc, w, e.target))) eeDoubleClickTarget(el2);
      });
    }
    // keyboard path (a11y contract): every stamped field is Tab-reachable in
    // the editor chrome; Enter starts the session (the session's own handler
    // takes over once active). Idempotent across re-injects via data-ipe.
    Array.prototype.forEach.call(el2.querySelectorAll("[data-pr]"), (w) => {
      if (!IDE_FIELDS[w.getAttribute("data-pr")] || w.hasAttribute("data-ipe")) return;
      w.setAttribute("data-ipe", "1");
      if (w.tabIndex < 0) w.setAttribute("tabindex", "0");
      w.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !IDE && !IPE && DC_MODE === "edit") { e.preventDefault(); e.stopPropagation(); ideStart(doc, w); }
      });
    });
    Array.prototype.forEach.call(el2.querySelectorAll("[data-dds-field]"), (f) => {
      if (f.hasAttribute("data-ipe")) return;
      f.setAttribute("data-ipe", "1");
      if (f.tabIndex < 0) f.setAttribute("tabindex", "0");
      f.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !IPE && DC_MODE === "edit") { e.preventDefault(); e.stopPropagation(); ipeStart(doc, f, el2); }
      });
    });
  });
  // The shell's one-time hint is a pill fixed to the bottom of the WINDOW, and on
  // a tablet the canvas runs under it: a heading in that strip could not be
  // double-clicked (the pill's "Got it" took the click). Starting to build IS
  // the "Got it" — the first press or key on the canvas dismisses the hint.
  if (!doc.body.hasAttribute("data-dc-hintguard")) {
    doc.body.setAttribute("data-dc-hintguard", "1");
    ["pointerdown", "keydown"].forEach((t) => doc.addEventListener(t, dcDismissShellHint, true));
    dcFrameKeys(doc);   // item 158: the section keys, and the editor's own, with the page in focus
    // item 171 (E3): a press on the page closes the Pages card, as a press anywhere else in the editor does
    doc.addEventListener("pointerdown", () => { if (PAGES_OPEN) closePagesCard(false); dcDockMore(false); }, true);   // and the phone's More (E4)
  }
  // expose a selector so the content-tree rows can flash + select a section on click
  DC_SHOWBAR = (elx) => { try { showBar(elx); } catch (_) {} };
  DC_HIDEBAR = () => { try { hideBar(); } catch (_) {} };
  try { stkInject(doc, main, live); } catch (_) {}   // item 57: the blocks inside Blocks sections, and their toolbar
  // Items 41, 50 and 123: a press on the header or footer (not on a link, the menu or words
  // being typed) opens its card; its chip says it's on every page, and is the way in by keyboard.
  try {
    [["header", "header.site", "Header · on every page"], ["footer", "footer.site", "Footer · on every page"]].forEach(([which, sel, name]) => {
      const box = doc.querySelector(sel);
      if (!box || box.hasAttribute("data-dc-hf")) return;
      box.setAttribute("data-dc-hf", which);
      if (win.getComputedStyle(box).position === "static") box.style.position = "relative";   // the chip sits inside it
      const chip = doc.createElement("button"); chip.type = "button"; chip.className = "dc-hf-chip"; chip.textContent = name;
      chip.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openSettingsPanel(which); });
      box.insertBefore(chip, box.firstChild);
      // read from the press lifting, not from a click: Safari sends no click for a press on
      // something that takes none (a footer), as the sections' taps already know
      box.addEventListener("pointerdown", (e) => { box.__dcDown = e.button ? null : { x: e.clientX, y: e.clientY, at: Date.now() }; });
      box.addEventListener("pointerup", (e) => {
        const d = box.__dcDown; box.__dcDown = null;
        if (!d || Math.abs(e.clientX - d.x) > 10 || Math.abs(e.clientY - d.y) > 10 || Date.now() - d.at > 600) return;   // a drag, a scroll or a hold
        if (DC_MODE !== "edit" || IPE) return;
        if (e.target.closest && e.target.closest("a,button,input,select,textarea,nav,[data-dds-field],[data-pr],[contenteditable=true]")) return;
        openSettingsPanel(which);
      });
    });
    if ($("settingsPanel") && $("settingsPanel").classList.contains("on")) dcHFMark(PANEL_MODE === "header" || PANEL_MODE === "footer" ? PANEL_MODE : null);
  } catch (_) {}
  // Item 122: the phone bar (drawn at a phone's width) is the footer's, so a press on it opens the
  // Footer card, where its switch is. Its links don't leave the canvas; Hours still opens the week.
  try {
    const pb = doc.querySelector(".dds-phonebar");
    if (pb && !pb.hasAttribute("data-dc-pb")) {
      pb.setAttribute("data-dc-pb", "1");
      pb.addEventListener("click", (e) => {
        if (e.target.closest && e.target.closest("a")) e.preventDefault();
        if (DC_MODE !== "edit" || IPE) return;
        if (PANEL_MODE !== "footer" || !$("settingsPanel").classList.contains("on")) openSettingsPanel("footer");
      }, true);
      if (PANEL_MODE === "footer" && $("settingsPanel") && $("settingsPanel").classList.contains("on")) pb.classList.add("dc-hf-on");
    }
  } catch (_) {}
  // Click the header menu on the canvas → open the menu editor (edit labels, links,
  // dropdowns). The header/footer are global, so this edits the menu on every page.
  try {
    const navEl = doc.querySelector("header nav.primary");
    if (navEl && !navEl.hasAttribute("data-navedit")) {
      navEl.setAttribute("data-navedit", "1");
      navEl.style.cursor = "pointer"; navEl.title = "Click to edit your menu (shown on every page)";
      navEl.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        // item 319: a link in the menu opens that page on the canvas; the menu's own bar opens the Pages card
        const a = e.target.closest && e.target.closest("a[href]"), slug = a ? dcPageForHref(a.getAttribute("href")) : null;
        if (slug != null && slug !== DC_PAGE) { dcSwitchPage(slug); return; }
        openPagesCard("dcPageSwitch");
      }, true);   // the Pages card, beside the page
    }
  } catch (_) {}
  if (!DC_PAGE) {
    const h = main.querySelector(':scope > [data-dds-core="hero"]');
    if (h && h.hasAttribute("data-dds-movable") !== DC_HERO_MOVES) { DC_HERO_MOVES = h.hasAttribute("data-dds-movable"); remountSectionsCard(); }
  }
  if (!live) dcBuildInserts(doc, main);   // AEM-style "＋ Add section" targets between sections
  try { dcInjectColControls(doc, main); } catch (_) {}   // Layout Mode column resize
  if (!live) dcBuildTree(main);           // left-rail Content Tree of every component on the page
  dcThemeTags();                          // item 118: the theme tags follow every redraw
}

// ── AEM insertion targets: a clickable/droppable "＋ Add section" bar at every gap
// between top-level sections (and a big placeholder when the page is empty). Each
// carries data-gap = the BLOCKS_WORK index to insert before. The pointer-drag ghost
// snaps to these (pdGaps reads them), and a click opens the picker AT that spot. ──
let DC_SHOWBAR = null;
let DC_HIDEBAR = null;   // item 99: leaving Edit mode puts away a toolbar a tap left up
function dcInsBar(doc, gap, label) {
  const bar = doc.createElement("div"); bar.className = "dc-ins"; bar.setAttribute("data-gap", String(gap));
  bar.setAttribute("role", "button"); bar.setAttribute("tabindex", "0"); bar.setAttribute("aria-label", label || "Add a section here");
  const pill = doc.createElement("span"); pill.className = "dc-ins-pill"; pill.innerHTML = uiIcon("plus", 14) + "<span>Add section</span>";
  bar.appendChild(pill);
  const open = (e) => { e.preventDefault(); e.stopPropagation(); dcOpenInsertFromCanvas(gap, bar); };
  bar.addEventListener("click", open);
  bar.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") open(e); });
  return bar;
}
function dcBuildInserts(doc, main) {
  Array.prototype.forEach.call(main.querySelectorAll(".dc-ins, .dc-emptyzone"), (n) => n.remove());
  if (dcBuiltinPage()) return;   // item 314: a built-in page takes no sections
  const blocks = dcBlockSections(main);
  const len = (BLOCKS_WORK || []).length;
  if (!blocks.length) {
    // empty page → one big "Drag components here" placeholder (AEM pattern)
    const z = doc.createElement("div"); z.className = "dc-emptyzone"; z.setAttribute("data-gap", "0");
    z.setAttribute("role", "button"); z.setAttribute("tabindex", "0"); z.setAttribute("aria-label", "Add your first section");
    const t = doc.createElement("div"); t.className = "dc-ez-t"; t.textContent = "Start building your page";
    const s = doc.createElement("div"); s.className = "dc-ez-s"; s.textContent = "The fastest start: drop in a ready-made layout of real sections you then edit. Or add one section at a time.";
    const acts = doc.createElement("div"); acts.className = "dc-ez-acts";
    const seed = doc.createElement("button"); seed.type = "button"; seed.className = "dc-ez-btn"; seed.textContent = "Choose a template";
    const b = doc.createElement("button"); b.type = "button"; b.className = "dc-ez-btn2"; b.textContent = "＋ Add one section";
    acts.appendChild(seed); acts.appendChild(b);
    z.appendChild(t); z.appendChild(s); z.appendChild(acts);
    seed.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); dcPickAndApplyLayout(); });
    const open = (e) => { e.preventDefault(); e.stopPropagation(); dcOpenInsertFromCanvas(0, z); };
    b.addEventListener("click", open);
    z.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") open(e); });
    main.appendChild(z);
    return;
  }
  blocks.forEach((bs) => { const bar = dcInsBar(doc, bs.bi, "Add a section here"); bs.el.parentNode.insertBefore(bar, bs.el); });
  const tail = dcInsBar(doc, len, "Add a section at the end"); main.appendChild(tail);
}
// open the section picker anchored to an in-canvas insert target (translate the
// iframe-local rect to parent-viewport coords so the menu lands next to the spot).
function dcOpenInsertFromCanvas(gap, anchorInFrame) {
  const f = $("designPreview"); const fr = f ? f.getBoundingClientRect() : { left: 0, top: 0 };
  const r = anchorInFrame.getBoundingClientRect();
  const rect = { left: fr.left + r.left, top: fr.top + r.top, bottom: fr.top + r.bottom, right: fr.left + r.right };
  closeTrayPanel();               // the picker replaces the big tray for in-canvas adds
  openInsertMenu(gap, null, rect);
}

// ═══ Builder item 57 · blocks inside a section (the Blocks section) ═══════════════
// A Blocks section (stored type "stack", shown as "Blocks") holds small blocks stacked top
// to bottom, with no free placement (Eric, Nov 12 2026; Figma node 324:789). The server draws
// each block with data-dds-item, its place in the section, and the usual field stamps, so a
// double-click types into a block as into any section (ipeStart). This part adds the nine
// kinds, picking a block on the page with its toolbar (on a phone, a bar in the dock's
// place), Add a block, a block's own card (Content and Style), the blocks' rows in Layers,
// and turning a simple section into blocks. Every change is a change to the page's section
// list, so it saves, redraws and undoes like any section edit.
const STK_KINDS = [
  { kind: "heading", name: "Heading", hint: "A big line of words", icon: "heading", group: "Words", words: "title" },
  { kind: "text", name: "Text", hint: "Paragraphs, lists and links", icon: "text", group: "Words", words: "paragraph writing words" },
  { kind: "image", name: "Image", hint: "One photo, with a caption", icon: "image", group: "Photos and video", words: "photo picture" },
  { kind: "video", name: "Video", hint: "YouTube or Vimeo, with your own picture", icon: "video", group: "Photos and video", words: "youtube vimeo film" },
  { kind: "button", name: "Button", hint: "One button, or up to three in a row", icon: "button", group: "Get in touch", words: "link call book" },
  { kind: "form", name: "Form", hint: "Name, email and a message, sent to you", icon: "form", group: "Get in touch", words: "contact enquiry quote" },
  { kind: "spacer", name: "Spacer", hint: "Empty room between blocks", icon: "spacer", group: "Space", words: "space gap" },
  { kind: "divider", name: "Divider", hint: "A thin line across", icon: "divider", group: "Space", words: "line rule" },
  { kind: "map", name: "Map", hint: "Your address and a Get directions link", icon: "pin", group: "Find us", words: "address directions location" },
];
const STK_GROUPS = ["Words", "Photos and video", "Get in touch", "Space", "Find us"];
// "embed" and its cousins: nothing from another company goes on a client's page
const STK_AWAY = /\b(embed|iframe|html|code|script|widget|instagram|facebook|tiktok|calendly|opentable|spotify)\b/i;
const stkKind = (k) => STK_KINDS.find((x) => x.kind === k) || { kind: k, name: "Block", icon: "section", hint: "", words: "" };
const STK_MAX = 20;   // the server keeps up to 20 blocks in one section
let STK_PICK = null;    // the block picked on the page: { bi, j }
let STK_FOCUS = null;   // a block just added, moved or copied: picked again once the page redraws
let STK_ADD = null;     // where Add a block puts the new one: { bi, at }
let STK_QUERY = "";
const stkItems = (bi) => { const b = (BLOCKS_WORK || [])[bi]; return b && b.type === "stack" && Array.isArray(b.items) ? b.items : null; };
function stkName(bi) { const h = (stkItems(bi) || []).find((it) => it && it.kind === "heading" && it.text); return h ? h.text : "Blocks"; }
// a few words about a block, for its row in Layers and in its section's card
function stkSay(it) {
  if (!it) return "";
  const plain = (v) => String(v || "").replace(/[*_#>`[\]()]/g, "").replace(/^\s*[-+]\s+/gm, "").replace(/\s+/g, " ").trim();
  switch (it.kind) {
    case "heading": return plain(it.text) || "No words yet";
    case "text": return plain(it.body) || "No words yet";
    case "image": return it.alt || it.caption || (it.image_id ? "A photo" : "No photo yet");
    case "button": return (it.buttons || []).map((b) => b && b.label).filter(Boolean).join(" · ") || "No words yet";
    case "video": return it.caption || (it.url ? String(it.url).replace(/^https?:\/\/(www\.)?/i, "") : "No video link yet");
    case "form": return (it.form && it.form.title) || "A form";
    case "spacer": return it.size === "s" ? "Small space" : it.size === "l" ? "Large space" : "Medium space";
    case "divider": return it.width === "s" ? "A short line" : "A line across";
    case "map": return it.address || "No address yet";
  }
  return "";
}
// Every form id on the site, Form sections and Form blocks alike: a published form posts only its id.
function stkFormIds() {
  const ids = allFormIds();
  const walk = (list) => (Array.isArray(list) ? list : []).forEach((b) => { if (b && b.type === "stack") (b.items || []).forEach((it) => { if (it && it.form && it.form.id) ids.add(it.form.id); }); });
  walk(BLOCKS_WORK); walk(S.settings && S.settings.blocks); dcPagesArr().forEach((p) => walk(p && p.blocks));
  return ids;
}
function stkNewForm(key) {
  const p = FORM_PRESETS_UI.find((x) => x.key === key) || FORM_PRESETS_UI[0];
  const f = JSON.parse(JSON.stringify(p.def)); f.id = ffUniqueId(f.id, stkFormIds());
  return f;
}
// a new block, filled in so it shows at once; a photo, a video or a map waits for its card
function stkNew(kind) {
  switch (kind) {
    case "heading": return { kind, text: "A new heading" };
    case "text": return { kind, body: "Write a few words here." };
    case "button": return { kind, buttons: [{ label: "Get in touch", url: "/contact/" }] };
    case "form": return { kind, form: stkNewForm("contact") };
    case "video": return { kind, url: "" };
    case "map": return { kind, address: "" };
  }
  return { kind };
}

// ── changing a section's blocks ──
// The section with its new list of blocks: its card and Layers redraw, and the list saves as
// any section edit does (at once for a move, a copy, an add or a delete).
function stkWrite(bi, items, now) {
  const b = (BLOCKS_WORK || [])[bi]; if (!b) return;
  BLOCKS_WORK[bi] = { ...b, items };
  dcCaptureScroll();
  renderBlocksCard();
  dcRefreshTree();
  if (now) saveBlocks();
}
// one block's fields, from its card; a key given as undefined comes off the block
function stkSet(bi, j, patch) {
  const items = (stkItems(bi) || []).slice(); if (!items[j]) return;
  const next = { ...items[j], ...patch };
  Object.keys(patch).forEach((k) => { if (patch[k] === undefined) delete next[k]; });
  items[j] = next;
  BLOCKS_WORK[bi] = { ...BLOCKS_WORK[bi], items };
}
function stkMove(bi, j, d) {
  const items = (stkItems(bi) || []).slice(), k = j + d;
  if (!items[j] || k < 0 || k >= items.length || lockStop(bi)) return;
  const t = items[j]; items[j] = items[k]; items[k] = t;
  if (STK_ITEM === j) STK_ITEM = k;
  STK_FOCUS = { bi, j: k };
  stkWrite(bi, items, true);
}
function stkCopy(bi, j) {
  const items = (stkItems(bi) || []).slice(); if (!items[j] || lockStop(bi)) return;
  if (items.length >= STK_MAX) { toast("A Blocks section holds up to " + STK_MAX + " blocks. Add another Blocks section for more."); return; }
  const copy = JSON.parse(JSON.stringify(items[j]));
  if (copy.form) copy.form.id = ffUniqueId(copy.form.id, stkFormIds());
  items.splice(j + 1, 0, copy);
  STK_FOCUS = { bi, j: j + 1 };
  stkWrite(bi, items, true);
}
function stkDelete(bi, j) {
  const items = (stkItems(bi) || []).slice(); if (!items[j] || lockStop(bi)) return;
  if (items.length === 1) { stkUnpick(); dcDelete(bi); return; }   // the last block: the section goes, after the section's own question
  const word = stkKind(items[j].kind).name;
  items.splice(j, 1);
  if (STK_ITEM === j) STK_ITEM = null; else if (STK_ITEM != null && STK_ITEM > j) STK_ITEM--;
  stkUnpick();
  stkWrite(bi, items, true);
  toastAction(word + " deleted", "Undo", dcUndo, 8000);
}
function stkAlign(bi, j, how) {
  if (lockStop(bi)) return;
  const it = (stkItems(bi) || [])[j]; if (!it) return;
  stkSet(bi, j, { align: it.align === how ? undefined : how });
  STK_FOCUS = { bi, j };
  stkWrite(bi, stkItems(bi), true);
}
function stkPhone(bi, j) {   // hide on phones, or show again
  if (lockStop(bi)) return;
  const it = (stkItems(bi) || [])[j]; if (!it) return;
  stkSet(bi, j, { hide_on_phone: it.hide_on_phone ? undefined : true });
  STK_FOCUS = { bi, j };
  stkWrite(bi, stkItems(bi), true);
  toast(it.hide_on_phone ? "Shows on phones again" : "Hidden on phones: it still shows on bigger screens");
}
function stkAdd(bi, at, kind) {
  const items = (stkItems(bi) || []).slice(); if (!stkItems(bi) || lockStop(bi)) return;
  if (items.length >= STK_MAX) { toast("A Blocks section holds up to " + STK_MAX + " blocks. Add another Blocks section for more."); return; }
  const j = Math.max(0, Math.min(at == null ? items.length : at, items.length));
  items.splice(j, 0, stkNew(kind));
  closeTrayPanel(); STK_ADD = null;
  STK_FOCUS = { bi, j };
  if (!STK_FILL.has(kind)) { stkWrite(bi, items, true); return; }
  BLOCKS_WORK[bi] = { ...BLOCKS_WORK[bi], items };
  stkEdit(bi, j, "content");
  if (kind === "image") stkPhotoPick(bi, j, "image_id");
}
// ── Text, Title, Image, Buttons, Video and Divider sections turn into blocks as they are:
// the same words, photos and looks, now blocks that more can join ──
function stkFrom(b) {
  const items = [];
  const head = (t) => { if (t) items.push({ kind: "heading", text: t }); };
  switch (b.type) {
    case "richtext": head(b.title); items.push({ kind: "text", body: b.body || "" }); break;
    case "title": items.push({ kind: "heading", text: b.title || "" }); if (b.subtitle) items.push({ kind: "text", body: b.subtitle, size: "l" }); break;
    case "image": head(b.title); items.push({ kind: "image", image_id: b.image_id, alt: b.alt, caption: b.caption, link: b.link, decorative: b.decorative || undefined }); break;
    case "buttons": head(b.title); items.push({ kind: "button", buttons: (b.buttons || []).map((x) => ({ label: x.label, url: x.url, ...(x.style === "outline" ? { style: "outline" } : {}) })) }); break;
    case "video": head(b.title || "Video"); items.push({ kind: "video", url: b.url || "", poster_id: b.poster_id, caption: b.caption }); break;
    case "divider": items.push(b.style === "space" ? { kind: "spacer", size: b.size === "small" ? "s" : b.size === "large" ? "l" : undefined } : { kind: "divider" }); break;
    default: return null;
  }
  const out = { type: "stack", items: JSON.parse(JSON.stringify(items)) };   // drops the keys left undefined
  ["look", "style", "show_from", "show_until"].forEach((k) => { if (b[k]) out[k] = b[k]; });
  return out;
}
function stkTurn(bi) {
  const b = (BLOCKS_WORK || [])[bi]; if (!b || !STK_TURNS.has(b.type) || lockStop(bi)) return false;
  const next = stkFrom(b); if (!next) return false;
  const def = BLOCK_DEFS.find((x) => x.type === b.type);
  dcSoloEnd();
  BLOCKS_WORK[bi] = next;
  dcCaptureScroll(); renderBlocksCard(); saveBlocks();
  const nm = stkName(bi) !== "Blocks" ? stkName(bi) : ((def && def.name) || "This section");
  toastAction("“" + nm + "” is made of blocks now", "Undo", dcUndo, 10000);
  return true;
}

// ── Add a block: a card beside the dock, like Add a section (the tray's "blocks" tab) ──
function stkOpenAdd(bi, at) {
  if (!stkItems(bi) || lockStop(bi)) return;
  STK_ADD = { bi, at: at == null ? stkItems(bi).length : at };
  STK_QUERY = "";
  openTrayPanel("blocks");
}
function stkRenderAdd() {
  const host = $("designBlockAdd"); if (!host) return;
  host.textContent = "";
  const a = STK_ADD, items = a ? stkItems(a.bi) : null;
  if (!items) { host.appendChild(el("div", "tray-empty", "Pick a Blocks section on the page first.")); return; }
  const ts = $("traySub");
  if (ts) { const before = items[a.at - 1]; ts.textContent = before ? "Goes under " + stkKind(before.kind).name + ", in " + stkName(a.bi) : "Goes at the top of " + stkName(a.bi); ts.hidden = false; }
  const sw = el("div", "tray-searchwrap"); sw.insertAdjacentHTML("afterbegin", uiIcon("search", 18));
  const search = el("input", "tray-search"); search.type = "search"; search.placeholder = "Find a block: heading, photo, form…"; search.value = STK_QUERY; search.setAttribute("aria-label", "Search blocks to add");
  search.addEventListener("input", () => { STK_QUERY = search.value; stkRenderAdd(); const s2 = $("designBlockAdd") && $("designBlockAdd").querySelector(".tray-search"); if (s2) { s2.focus(); s2.setSelectionRange(STK_QUERY.length, STK_QUERY.length); } });
  sw.appendChild(search); host.appendChild(sw);
  const q = STK_QUERY.trim(), away = !!q && STK_AWAY.test(q);
  if (away) {   // the drawing's answer to "embed": what does the usual job instead
    const n = el("div", "stk-away"); n.setAttribute("role", "status");
    n.appendChild(el("b", null, "Code from other websites can’t go on your page"));
    n.appendChild(el("span", null, "Your site loads nothing from other companies. That keeps it fast and private, with no cookie banner. These do the usual jobs instead:"));
    host.appendChild(n);
  }
  let shown = 0;
  STK_GROUPS.forEach((g) => {
    const kinds = STK_KINDS.filter((k) => k.group === g && (away ? (k.kind === "video" || k.kind === "map") : trayItemMatches(k.name, k.hint + " " + k.words, k.kind, q)));
    if (!kinds.length) return;
    const wrap = el("div", "tray-grp stk-grp");
    if (!away) wrap.appendChild(el("div", "tray-grp-h", g));
    kinds.forEach((k) => {
      const b = el("button", "stk-kind"); b.type = "button"; b.dataset.kind = k.kind;
      b.appendChild(Object.assign(el("span", "stk-kind-ico"), { innerHTML: uiIcon(k.icon, 20) }));
      const t = el("span", "stk-kind-t"); t.appendChild(el("b", null, k.name)); t.appendChild(el("span", null, k.hint)); b.appendChild(t);
      b.addEventListener("click", () => stkAdd(a.bi, a.at, k.kind));
      wrap.appendChild(b); shown++;
    });
    host.appendChild(wrap);
  });
  if (!shown) host.appendChild(el("div", "tray-empty", "No blocks match “" + q + "”."));
}

// ── a block's own card: the inspector with Content and Style (Layout and When are the section's) ──
function stkEdit(bi, j, tab) {
  if (!(stkItems(bi) || [])[j]) return;
  closePreview(); go("design");
  if (!$("blocksCard")) mountBlocksCard();
  BLOCK_SOLO = bi; STK_ITEM = j;
  INS_TAB = tab === "style" ? "style" : "content";
  openSettingsPanel("section", stkKind(stkItems(bi)[j].kind).name);
  BLOCK_FOCUS = bi; renderBlocksCard();
  dcRevealAbove(bi);
}
function stkHead(bi, j) {
  const t = $("settingsTitle"), sb = $("settingsSub"), p = $("settingsPanel"), it = (stkItems(bi) || [])[j];
  const name = stkKind(it && it.kind).name;
  if (t) t.textContent = name;
  if (sb) { sb.textContent = "Block in " + stkName(bi) + " · on " + dcPageTitle(DC_PAGE); sb.hidden = false; }
  if (p) p.setAttribute("aria-label", name);
}
// chips from a fixed list; the card saves and redraws the section
function stkPills(host, label, opts, cur, onPick) {
  pillRow(host, label, opts, (o) => o[1] === cur, (o) => { onPick(o[1]); renderBlocksCard(); dcLiveFromPanel(); });
}
function stkCheck(host, words, on, onChange) {
  const lab = el("label", "stk-check"); const cb = el("input"); cb.type = "checkbox"; cb.checked = !!on;
  lab.append(cb, document.createTextNode(words)); host.appendChild(lab);
  cb.addEventListener("change", () => onChange(cb.checked));
  return cb;
}
let STK_FIELD_N = 0;
function stkField(host, label, input, hint) {
  const f = el("div", "ins-field"); input.id = "stkf-" + (++STK_FIELD_N);
  const l = el("label", "ins-lbl", label); l.htmlFor = input.id;
  f.append(l, input); if (hint) f.appendChild(el("div", "hint", hint));
  host.appendChild(f);
  return input;
}
function stkInput(value, max, placeholder) {
  const i = el("input", "stk-in"); i.type = "text"; i.value = value || "";
  if (max) i.maxLength = max; if (placeholder) i.placeholder = placeholder;
  return i;
}
// a link box that offers the site's own pages: the menu's addresses and the owner's pages
function stkLinkInput(value) {
  let dl = $("stkPages");
  if (!dl) { dl = el("datalist"); dl.id = "stkPages"; document.body.appendChild(dl); }
  dl.textContent = "";
  const seen = new Set();
  const add = (href, name) => { if (!href || seen.has(href)) return; seen.add(href); const o = el("option"); o.value = href; o.label = name || href; dl.appendChild(o); };
  add("/", "Home");
  (S.settings && Array.isArray(S.settings.nav) ? S.settings.nav : []).forEach((n) => { if (n && /^\/(?!\/)/.test(String(n.href || ""))) add(n.href, n.label); (n && Array.isArray(n.children) ? n.children : []).forEach((c) => { if (c && /^\/(?!\/)/.test(String(c.href || ""))) add(c.href, c.label); }); });
  dcPagesArr().forEach((p) => { if (p && p.slug) add("/" + p.slug + "/", p.title); });
  add("/contact/", "Contact");
  const i = stkInput(value, 300, "/contact/, tel:+15550100, or https://…");
  i.setAttribute("list", "stkPages");
  return i;
}
function stkPhotoField(host, bi, j, it, key, label) {
  const f = el("div", "ins-field");
  f.appendChild(el("div", "ins-lbl", label));
  const row = el("div", "stk-photo");
  if (it[key]) row.appendChild(mediaThumb(it[key]));
  const pick = el("button", "dc-actbtn", it[key] ? "Replace" : "Choose a photo"); pick.type = "button";
  pick.addEventListener("click", () => stkPhotoPick(bi, j, key));
  row.appendChild(pick);
  if (it[key]) {
    const rm = el("button", "dc-actbtn dc-ghost", "Remove"); rm.type = "button";
    rm.addEventListener("click", () => { stkSet(bi, j, { [key]: undefined }); renderBlocksCard(); dcLiveFromPanel(); });
    row.appendChild(rm);
  }
  f.appendChild(row); host.appendChild(f);
}
function stkPhotoPick(bi, j, key) {
  openPicker((id) => { if (!id || !(stkItems(bi) || [])[j]) return; stkSet(bi, j, { [key]: id }); STK_FOCUS = { bi, j }; renderBlocksCard(); dcLiveFromPanel(); });
}
function stkButtons(host, bi, j, it) {
  const list = (Array.isArray(it.buttons) && it.buttons.length ? it.buttons : [{ label: "", url: "" }]).map((b) => ({ ...b }));
  const put = () => stkSet(bi, j, { buttons: list.map((b) => ({ label: b.label || "", url: b.url || "", ...(b.style === "outline" ? { style: "outline" } : {}) })) });
  const nth = ["First button", "Second button", "Third button"];
  list.forEach((b, k) => {
    const box = el("div", "stk-btnbox");
    if (list.length > 1) box.appendChild(el("div", "stk-btnbox-h", nth[k]));
    const w = stkField(box, "Words on the button", stkInput(b.label, 40, "Get in touch"));
    w.addEventListener("change", () => { b.label = w.value.trim(); put(); });
    const u = stkField(box, "Goes to", stkLinkInput(b.url), "A page of your site, a phone number (tel:), an email (mailto:) or a web address.");
    u.addEventListener("change", () => { b.url = u.value.trim(); put(); });
    stkPills(box, "Look", [["Main", ""], ["Outline", "outline"]], b.style === "outline" ? "outline" : "", (v) => { b.style = v || undefined; put(); });
    if (list.length > 1) {
      const rm = el("button", "dc-actbtn dc-ghost", "Remove this button"); rm.type = "button";
      rm.addEventListener("click", () => { list.splice(k, 1); put(); renderBlocksCard(); dcLiveFromPanel(); });
      box.appendChild(rm);
    }
    host.appendChild(box);
  });
  if (list.length < 3) {
    const more = el("button", "stk-addbtn", list.length === 1 ? "＋ Add a second button" : "＋ Add a third button"); more.type = "button";
    more.addEventListener("click", () => { list.push({ label: "Call us", url: "tel:", style: "outline" }); put(); renderBlocksCard(); });
    host.appendChild(more);
  }
}
// A Form block's form: a ready-made one to start from, its questions, its button and thank-you.
// Answers go to the Inbox like every form (the server finds Form blocks too: formsIn).
const STK_Q_TYPES = [["text", "Short answer"], ["textarea", "Long answer"], ["email", "Email"], ["phone", "Phone"], ["date", "Date"], ["select", "Choose one"]];
function stkFormEditor(host, bi, j, it) {
  const f = it.form ? JSON.parse(JSON.stringify(it.form)) : stkNewForm("contact");
  const put = () => stkSet(bi, j, { form: JSON.parse(JSON.stringify(f)) });
  const now = FORM_PRESETS_UI.find((p) => p.key !== "blank" && p.def.title === f.title && p.def.kind === f.kind);
  stkPills(host, "Start from", FORM_PRESETS_UI.filter((p) => p.key !== "blank").map((p) => [p.name, p.key]), now ? now.key : "", (key) => {
    const nf = stkNewForm(key); nf.id = f.id;   // the same id, so answers already sent stay with it
    stkSet(bi, j, { form: nf });
  });
  const nm = stkField(host, "Its name in your Inbox", stkInput(f.title, 80, "Contact us"));
  nm.addEventListener("change", () => { f.title = nm.value.trim() || "Form"; put(); });
  const qf = el("div", "ins-field"); qf.appendChild(el("div", "ins-lbl", "Questions"));
  (f.fields || []).forEach((q, k) => {
    const row = el("div", "stk-q");
    const lab = stkInput(q.label, 120, "Question"); lab.setAttribute("aria-label", "Question " + (k + 1));
    lab.addEventListener("change", () => { q.label = lab.value.trim() || q.label; put(); });
    const req = el("label", "stk-q-req"); const cb = el("input"); cb.type = "checkbox"; cb.checked = !!q.required; req.append(cb, document.createTextNode("Needed"));
    cb.addEventListener("change", () => { if (cb.checked) q.required = true; else delete q.required; put(); });
    const rm = icoBtn("x", "Remove this question", "stk-q-rm", 14);
    rm.addEventListener("click", () => {
      const left = f.fields.filter((x, n) => n !== k);
      if (!left.some((x) => x.type === "email" || x.type === "phone")) { toast("Keep an email or a phone question, so the answer can reach the person who asked."); return; }
      f.fields = left; put(); renderBlocksCard(); dcLiveFromPanel();
    });
    row.append(lab, req, rm); qf.appendChild(row);
  });
  const addRow = el("div", "stk-q-add");
  const ty = el("select", "stk-in"); ty.setAttribute("aria-label", "Kind of question");
  STK_Q_TYPES.forEach(([v, l]) => { const o = el("option", null, l); o.value = v; ty.appendChild(o); });
  const add = el("button", "dc-actbtn", "Add a question"); add.type = "button";
  add.addEventListener("click", () => {
    const taken = new Set((f.fields || []).map((x) => x.key));
    let key = ty.value === "textarea" ? "details" : ty.value, n = 1;
    while (taken.has(key)) key = (ty.value === "textarea" ? "details" : ty.value) + "_" + (++n);
    const q = { key, label: "New question", type: ty.value };
    if (ty.value === "select") q.choices = ["Option one", "Option two"];
    f.fields = (f.fields || []).concat([q]); put(); renderBlocksCard(); dcLiveFromPanel();
  });
  addRow.append(ty, add); qf.appendChild(addRow);
  host.appendChild(qf);
  const sb = stkField(host, "Words on its button", stkInput(f.submit_label, 40, "Send message"));
  sb.addEventListener("change", () => { f.submit_label = sb.value.trim() || undefined; put(); });
  const ok = stkField(host, "Thank-you message", stkInput(f.confirmation_text, 300, "Thanks, we’ll be in touch soon."));
  ok.addEventListener("change", () => { f.confirmation_text = ok.value.trim() || undefined; put(); });
  host.appendChild(el("div", "hint", "Answers go to your Inbox, like every form on your site."));
}
// The card itself. renderBlocksCard hands it the panes when a block of a Blocks section is open.
function stkItemCard(bi, j, panes) {
  const it = stkItems(bi)[j], c = panes.content, s = panes.style;
  stkHead(bi, j);
  [c, s].forEach((pane) => {
    const back = el("button", "stk-back"); back.type = "button";
    back.innerHTML = uiIcon("up", 14); back.appendChild(el("span", null, "All blocks in " + stkName(bi)));
    back.addEventListener("click", () => { STK_ITEM = null; renderBlocksCard(); });
    pane.appendChild(back);
  });
  const set = (patch) => stkSet(bi, j, patch);   // the card's change listener saves and redraws
  if (lockedForMe(BLOCKS_WORK[bi]) && !(BLOCKS_WORK[bi].lock && BLOCKS_WORK[bi].lock.words)) { c.appendChild(el("div", "ins-note", LOCK_SAY)); return; }
  switch (it.kind) {
    case "heading": {
      const w = stkField(c, "Words", stkInput(it.text, 160));
      w.addEventListener("change", () => set({ text: w.value.trim() }));
      c.appendChild(aiField(w, { field: "heading" }));
      break;
    }
    case "text": {
      const ta = el("textarea", "stk-in"); ta.value = it.body || ""; ta.rows = Math.max(5, String(it.body || "").split("\n").length + 1);
      ta.setAttribute("data-k", "body_md");   // the rich-text toolbar attaches itself
      stkField(c, "Words", ta, "You can also type straight onto the page: double-click the words.");
      ta.addEventListener("change", () => set({ body: ta.value }));
      c.appendChild(aiField(ta, {}));
      break;
    }
    case "image": {
      stkPhotoField(c, bi, j, it, "image_id", "Photo");
      const alt = stkField(c, "Describe the photo", stkInput(it.alt, 200), "Read aloud for people who can’t see it, and read by Google.");
      alt.disabled = !!it.decorative;
      alt.addEventListener("change", () => set({ alt: alt.value.trim() || undefined }));
      stkCheck(c, "Only decoration: screen readers skip it", it.decorative, (on) => { set({ decorative: on || undefined }); renderBlocksCard(); });
      const cap = stkField(c, "Caption", stkInput(it.caption, 200, "Add a caption (optional)"));
      cap.addEventListener("change", () => set({ caption: cap.value.trim() || undefined }));
      const lk = stkField(c, "When someone taps it", stkLinkInput(it.link), "Leave it empty and a tap does nothing.");
      lk.addEventListener("change", () => set({ link: lk.value.trim() || undefined }));
      break;
    }
    case "button": stkButtons(c, bi, j, it); break;
    case "video": {
      const u = stkField(c, "Video link", stkInput(it.url, 400, "https://www.youtube.com/watch?v=…"), "A YouTube or Vimeo address. Your page shows your picture, and a tap opens the video: nothing from YouTube loads on your page.");
      u.addEventListener("change", () => set({ url: u.value.trim() }));
      stkPhotoField(c, bi, j, it, "poster_id", "Picture over the video");
      const cap = stkField(c, "Caption", stkInput(it.caption, 200, "A few words under the video (optional)"));
      cap.addEventListener("change", () => set({ caption: cap.value.trim() || undefined }));
      break;
    }
    case "form": stkFormEditor(c, bi, j, it); break;
    case "spacer": stkPills(c, "Size", [["Small", "s"], ["Medium", ""], ["Large", "l"]], it.size || "", (v) => set({ size: v || undefined })); break;
    case "divider": stkPills(c, "Width", [["Short", "s"], ["Full width", ""]], it.width || "", (v) => set({ width: v || undefined })); break;
    case "map": {
      const ad = stkField(c, "Address", stkInput(it.address, 200, "12 Olive Ave, Burbank"), "Your page shows it with a Get directions link. No map from Google loads on your page.");
      ad.addEventListener("change", () => set({ address: ad.value.trim() || undefined }));
      const dir = stkField(c, "Directions link (optional)", stkInput(it.directions_url, 400, "Made from the address when it’s empty"));
      dir.addEventListener("change", () => set({ directions_url: dir.value.trim() || undefined }));
      stkPhotoField(c, bi, j, it, "image_id", "A photo of the place (optional)");
      break;
    }
  }
  // Style: its size, its line-up, and phones. Colours stay the section's.
  if (it.kind === "heading") stkPills(s, "Size", [["Big", ""], ["Medium", "m"], ["Small", "s"]], it.size || "", (v) => set({ size: v || undefined }));
  if (it.kind === "text") stkPills(s, "Size", [["Normal", ""], ["Large", "l"]], it.size || "", (v) => set({ size: v || undefined }));
  if (it.kind === "image") stkPills(s, "Width", [["Small", "s"], ["Medium", "m"], ["Full", ""]], it.width || "", (v) => set({ width: v || undefined }));
  if (it.kind !== "spacer") stkPills(s, "Line up", [["As the section", ""], ["Left", "left"], ["Centre", "center"], ["Right", "right"]], it.align || "", (v) => set({ align: v || undefined }));
  stkCheck(s, "Hide on phones", it.hide_on_phone, (on) => set({ hide_on_phone: on || undefined }));
  s.appendChild(el("div", "ins-note", "Colours come from the section’s colour theme, so the words stay readable on it. The section’s own card has it, on its Style tab."));
}
// The Blocks section's own card: its blocks on Content, how they line up on Layout.
function stkSectionCard(bi, sub, panes) {
  const items = stkItems(bi) || [], held = lockedForMe(BLOCKS_WORK[bi]);
  const list = el("div", "stk-list"); list.setAttribute("role", "list"); list.setAttribute("aria-label", "Blocks in this section");
  items.forEach((it, j) => {
    const k = stkKind(it.kind);
    const row = el("div", "stk-li"); row.setAttribute("role", "listitem");
    const open = el("button", "stk-li-main"); open.type = "button"; open.title = "Edit this block";
    open.appendChild(Object.assign(el("span", "stk-kind-ico"), { innerHTML: uiIcon(k.icon, 18) }));
    const t = el("span", "stk-kind-t"); t.appendChild(el("b", null, k.name)); t.appendChild(el("span", null, stkSay(it))); open.appendChild(t);
    open.addEventListener("click", () => stkEdit(bi, j, "content"));
    row.appendChild(open);
    if (!held) {
      const up = icoBtn("up", "Move this block up", "stk-li-b", 14), dn = icoBtn("down", "Move this block down", "stk-li-b", 14), rm = icoBtn("trash", "Delete this block", "stk-li-b", 14);
      up.disabled = j === 0; dn.disabled = j === items.length - 1;
      up.addEventListener("click", () => stkMove(bi, j, -1)); dn.addEventListener("click", () => stkMove(bi, j, 1)); rm.addEventListener("click", () => stkDelete(bi, j));
      row.append(up, dn, rm);
    }
    list.appendChild(row);
  });
  const f = el("div", "ins-field"); f.appendChild(el("div", "ins-lbl", "Blocks in this section")); f.appendChild(list);
  if (!held) {
    const add = el("button", "stk-addbtn", "＋ Add a block"); add.type = "button";
    add.disabled = items.length >= STK_MAX;
    add.addEventListener("click", () => stkOpenAdd(bi, items.length));
    f.appendChild(add);
  }
  sub.appendChild(f);
  if (!panes || held) return;
  const b = BLOCKS_WORK[bi];
  pillRow(panes.layout, "Width of the blocks", [["Narrow", "narrow"], ["Normal", ""], ["Wide", "wide"]], (o) => (b.column || "") === o[1], (o) => { const n = { ...BLOCKS_WORK[bi] }; if (o[1]) n.column = o[1]; else delete n.column; BLOCKS_WORK[bi] = n; renderBlocksCard(); dcLiveFromPanel(); });
  pillRow(panes.layout, "Space between blocks", [["Tight", "tight"], ["Normal", ""], ["Roomy", "roomy"]], (o) => (b.gap || "") === o[1], (o) => { const n = { ...BLOCKS_WORK[bi] }; if (o[1]) n.gap = o[1]; else delete n.gap; BLOCKS_WORK[bi] = n; renderBlocksCard(); dcLiveFromPanel(); });
  panes.layout.appendChild(el("div", "ins-note", "Blocks always stack top to bottom, so the section fits every screen by itself."));
}

// ── picking a block on the page, and its toolbar ──
// A click picks a block (a tap, on a phone): it's outlined, and its tools sit just above it,
// or under it when there's no room. On a phone the same tools take the dock's place instead
// (stkPhoneBar). A double-click still types into a block's words; on a block without words
// (a photo, a space) it opens the block's card.
function stkFind(doc, bi, j) {
  const main = doc && doc.getElementById("main"); if (!main) return null;
  const hit = dcBlockSections(main).find((x) => x.bi === bi);
  const node = hit && hit.el.classList.contains("block-stack") ? hit.el.querySelector('[data-dds-item="' + j + '"]') : null;
  return node ? { sec: hit.el, el: node } : null;
}
function stkInject(doc, main, live) {
  let tb = doc.getElementById("dds-dc-blk");
  if (!tb) { tb = doc.createElement("div"); tb.id = "dds-dc-blk"; tb.setAttribute("role", "toolbar"); tb.setAttribute("aria-label", "Edit this block"); doc.body.appendChild(tb); }
  let more = doc.getElementById("dds-dc-blkmore");
  if (!more) { more = doc.createElement("div"); more.id = "dds-dc-blkmore"; more.setAttribute("role", "menu"); more.setAttribute("aria-label", "More for this block"); doc.body.appendChild(more); }
  Array.prototype.forEach.call(main.querySelectorAll(":scope > section.block-stack"), (sec) => {
    Array.prototype.forEach.call(sec.querySelectorAll("[data-dds-item]"), (node) => {
      if (node.hasAttribute("data-dc-blk")) return;
      node.setAttribute("data-dc-blk", "1");
      if (node.tabIndex < 0) node.setAttribute("tabindex", "0");
      node.addEventListener("click", (e) => {
        if (DC_MODE !== "edit" || (IPE && IPE.el && IPE.el.contains(e.target)) || (IDE && IDE.el.contains(e.target))) return;
        if (e.target.closest && e.target.closest("a, button")) e.preventDefault();   // a link or a form on the page doesn't leave the editor
        const c = eeClassify(sec); if (c.kind !== "block") return;
        const j = Number(node.getAttribute("data-dds-item"));
        const touch = Date.now() - (doc.__dcTouchAt || 0) < 900;
        const again = STK_PICK && STK_PICK.bi === c.bi && STK_PICK.j === j;
        const f = e.target.closest ? e.target.closest("[data-dds-field]") : null;
        e.stopPropagation();   // the section's own tap (select the section) stands aside
        if (again && touch && f && node.contains(f)) { stkUnpick(); ipeStart(doc, f, sec); return; }   // a second tap on its words: type into them
        if (DC_HIDEBAR && touch) DC_HIDEBAR();
        stkPick(doc, node, c.bi, j);
      });
      node.addEventListener("dblclick", (e) => {
        if (DC_MODE !== "edit") return;
        if (e.target.closest && e.target.closest("[data-dds-field]")) return;   // the section's double-click types into the words
        e.preventDefault(); e.stopPropagation();
        const c = eeClassify(sec); if (c.kind === "block") stkEdit(c.bi, Number(node.getAttribute("data-dds-item")), "content");
      });
      // a right-click opens the whole section's menu (item 158), so the block lets go and the keys follow the menu
      node.addEventListener("contextmenu", (e) => {
        if (!STK_PICK || DC_MODE !== "edit" || Date.now() - (doc.__dcTouchAt || 0) < 900 || (IPE && IPE.el && IPE.el.contains(e.target))) return;
        stkUnpick();
      });
      node.addEventListener("keydown", (e) => {
        if (DC_MODE !== "edit" || IPE || e.target !== node || node.hasAttribute("data-dds-field")) return;   // a block's words take Enter to type into them
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        const c = eeClassify(sec); if (c.kind !== "block") return;
        stkPick(doc, node, c.bi, Number(node.getAttribute("data-dds-item")));
        const first = doc.querySelector("#dds-dc-blk button"); if (first) { try { first.focus({ preventScroll: true }); } catch (_) {} }
      });
    });
  });
  if (!doc.body.hasAttribute("data-dc-blkoff")) {
    doc.body.setAttribute("data-dc-blkoff", "1");
    // a press anywhere off the picked block and its tools puts them away
    doc.addEventListener("pointerdown", (e) => { if (STK_PICK && !(e.target.closest && e.target.closest("[data-dds-item], #dds-dc-blk, #dds-dc-blkmore, #dds-ipe-bar"))) stkUnpick(); }, true);
    doc.addEventListener("keydown", (e) => { if (e.key === "Escape" && STK_PICK && !IPE) stkUnpick(); });
  }
  // after a redraw, the block just added, moved or copied is picked again, and the picked one stays picked
  const focus = STK_FOCUS, want = focus || STK_PICK;
  if (!want) return;
  const hit = stkFind(doc, want.bi, want.j);
  if (hit) {
    stkPick(doc, hit.el, want.bi, want.j);
    if (focus) { try { hit.el.scrollIntoView({ block: "center", behavior: pdReducedMotion() ? "auto" : "smooth" }); } catch (_) {} }
  } else if (!live) stkUnpick();
}
function stkPick(doc, node, bi, j) {
  STK_PICK = { bi, j }; STK_FOCUS = null;   // a block picked before the redraw lands wins over the one the last step meant to show
  Array.prototype.forEach.call(doc.querySelectorAll(".dc-blk-on"), (n) => n.classList.remove("dc-blk-on"));
  node.classList.add("dc-blk-on");
  stkTreeMark(bi, j);
  if (window.innerWidth <= 760) { const tb = doc.getElementById("dds-dc-blk"); if (tb) tb.classList.remove("on"); stkPhoneBar(bi, j); return; }
  stkToolbar(doc, node, bi, j);
}
function stkUnpick() {
  STK_PICK = null;
  const doc = dcFrameDoc();
  if (doc) {
    Array.prototype.forEach.call(doc.querySelectorAll(".dc-blk-on"), (n) => n.classList.remove("dc-blk-on"));
    ["dds-dc-blk", "dds-dc-blkmore"].forEach((id) => { const n = doc.getElementById(id); if (n) n.classList.remove("on"); });
  }
  stkPhoneBar(null);
  stkTreeMark(null);
}
// The editor's keys (item 158) with a block picked work on the block, as its toolbar does.
// Copy, cut and paste stay with whole sections: Esc lets go of the block first.
function stkKey(e, id, home) {
  const p = STK_PICK, it = p && (stkItems(p.bi) || [])[p.j];
  const doc = it && dcFrameDoc(), hit = doc && stkFind(doc, p.bi, p.j);
  if (!hit) return false;
  if (id === "copy" || id === "cut" || id === "paste") return true;
  const t = e.target;
  if ((id === "edit" || id === "del") && t !== hit.el && t !== home.body && t !== home.documentElement && t !== home) return true;   // Enter and Delete belong to whatever has the focus
  const b = BLOCKS_WORK[p.bi];
  e.preventDefault(); e.stopPropagation();
  if (id === "edit") { if (lockedForMe(b) && !(b.lock && b.lock.words)) lockStop(p.bi); else stkEdit(p.bi, p.j, "content"); }
  else if (id === "dup") stkCopy(p.bi, p.j);
  else if (id === "up" || id === "down") stkMove(p.bi, p.j, id === "up" ? -1 : 1);
  else if (id === "del") stkDelete(p.bi, p.j);
  return true;
}
function stkToolbar(doc, node, bi, j) {
  const tb = doc.getElementById("dds-dc-blk"), more = doc.getElementById("dds-dc-blkmore"); if (!tb) return;
  const items = stkItems(bi) || [], it = items[j]; if (!it) return;
  const held = lockedForMe(BLOCKS_WORK[bi]);
  tb.textContent = ""; more.textContent = ""; more.classList.remove("on");
  const btn = (icon, label, fn, cls) => {
    const b = doc.createElement("button"); b.type = "button"; b.className = "dc-b" + (cls ? " " + cls : "");
    b.innerHTML = uiIcon(icon, 18) + '<span class="dc-sr"></span>'; b.lastChild.textContent = label;
    b.setAttribute("aria-label", label); b.title = label;
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); fn(); });
    return b;
  };
  const sep = () => { const n = doc.createElement("span"); n.className = "dc-blk-sep"; n.setAttribute("aria-hidden", "true"); return n; };
  const nm = doc.createElement("span"); nm.className = "dc-blk-name"; nm.textContent = stkKind(it.kind).name; tb.appendChild(nm);
  if (!held) {
    tb.appendChild(sep());
    tb.appendChild(btn("up", "Move this block up", () => stkMove(bi, j, -1), j <= 0 ? "dc-off" : ""));
    tb.appendChild(btn("down", "Move this block down", () => stkMove(bi, j, 1), j >= items.length - 1 ? "dc-off" : ""));
    tb.appendChild(sep());
  }
  if (!held || (BLOCKS_WORK[bi].lock && BLOCKS_WORK[bi].lock.words)) tb.appendChild(btn("pencil", "Edit this block", () => stkEdit(bi, j, "content")));
  if (!held) {
    tb.appendChild(btn("spark", "Style this block: its size and line-up", () => stkEdit(bi, j, "style")));
    if (it.kind !== "spacer") {
      tb.appendChild(btn("alignl", "Line up on the left", () => stkAlign(bi, j, "left"), it.align === "left" ? "dc-on" : ""));
      tb.appendChild(btn("alignc", "Line up in the centre", () => stkAlign(bi, j, "center"), it.align === "center" ? "dc-on" : ""));
    }
    tb.appendChild(sep());
    tb.appendChild(btn("copy", "Copy this block", () => stkCopy(bi, j)));
    tb.appendChild(btn("trash", "Delete this block", () => stkDelete(bi, j), "dc-danger"));
    const mb = btn("more", "More", () => {
      const on = !more.classList.contains("on"); more.classList.toggle("on", on); mb.setAttribute("aria-expanded", String(on));
      if (!on) return;
      const r = tb.getBoundingClientRect(), win = doc.defaultView;
      more.style.setProperty("top", (r.bottom + win.scrollY + 6) + "px");
      more.style.setProperty("left", Math.max(win.scrollX + 8, r.right + win.scrollX - (more.offsetWidth || 220)) + "px");
      const f = more.querySelector("button"); if (f) { try { f.focus({ preventScroll: true }); } catch (_) {} }
    });
    mb.setAttribute("aria-haspopup", "menu"); mb.setAttribute("aria-expanded", "false");
    tb.appendChild(mb);
    const item = (icon, label, fn) => {
      const b = doc.createElement("button"); b.type = "button"; b.className = "dc-mi"; b.setAttribute("role", "menuitem");
      b.innerHTML = uiIcon(icon, 16) + "<span></span>"; b.lastChild.textContent = label;
      b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); more.classList.remove("on"); fn(); });
      more.appendChild(b);
    };
    item("plus", "Add a block above", () => stkOpenAdd(bi, j));
    item("plus", "Add a block below", () => stkOpenAdd(bi, j + 1));
    item("eyeoff", it.hide_on_phone ? "Show on phones again" : "Hide on phones", () => stkPhone(bi, j));
  }
  tb.classList.add("on");
  stkPlace(doc, node);
}
function stkPlace(doc, node) {
  const win = doc.defaultView, tb = doc.getElementById("dds-dc-blk"); if (!tb || !node.isConnected) return;
  dcFloatClear(doc, node, tb, 10);   // item 319: clear of the block above and below
}
// On a phone the picked block's tools take the dock's place, a word under each.
function stkPhoneBar(bi, j) {
  const bar = $("dcBlkBar"); if (!bar) return;
  const items = bi == null ? null : stkItems(bi);
  const on = !!(items && items[j]) && window.innerWidth <= 760;
  document.documentElement.classList.toggle("dc-blkpick", on);
  bar.hidden = !on; bar.textContent = "";
  if (!on) return;
  const held = lockedForMe(BLOCKS_WORK[bi]);
  const tool = (icon, word, label, fn, off, cls) => {
    const b = el("button", "dc-dk" + (cls ? " " + cls : "")); b.type = "button";
    b.innerHTML = uiIcon(icon, 20); b.appendChild(el("span", "dc-dk-l", word));
    b.setAttribute("aria-label", label); b.title = label;
    if (off) b.disabled = true; else b.addEventListener("click", fn);
    bar.appendChild(b);
  };
  if (!held) {
    tool("up", "Up", "Move this block up", () => stkMove(bi, j, -1), j <= 0);
    tool("down", "Down", "Move this block down", () => stkMove(bi, j, 1), j >= items.length - 1);
  }
  tool("pencil", "Edit", "Edit this block", () => stkEdit(bi, j, "content"), held && !(BLOCKS_WORK[bi].lock && BLOCKS_WORK[bi].lock.words));
  if (!held) {
    tool("spark", "Style", "Style this block", () => stkEdit(bi, j, "style"));
    tool("copy", "Copy", "Copy this block", () => stkCopy(bi, j));
    tool("trash", "Delete", "Delete this block", () => stkDelete(bi, j), false, "stk-del");
  }
}
// ── the blocks' rows in Layers, under their section ──
function stkTreeRows(host, bi) {
  const items = stkItems(bi) || [], held = lockedForMe(BLOCKS_WORK[bi]);
  items.forEach((it, j) => {
    const k = stkKind(it.kind);
    const row = el("div", "dc-tree-row child under-page stk-row"); row.dataset.stk = bi + ":" + j;
    if (STK_PICK && STK_PICK.bi === bi && STK_PICK.j === j) row.classList.add("sel");
    const btn = el("button", "dc-tree-main"); btn.type = "button"; btn.title = "Pick this block on the page";
    btn.appendChild(Object.assign(el("span", "dc-tree-ico"), { innerHTML: uiIcon(k.icon) }));
    const txt = el("span", "dc-tree-txt"); txt.appendChild(el("span", "dc-tree-name", k.name)); txt.appendChild(el("span", "dc-tree-meta", stkSay(it)));
    btn.appendChild(txt);
    btn.addEventListener("click", () => stkPickFromTree(bi, j));
    row.appendChild(btn);
    if (!CM_ON) {
      const acts = el("span", "dc-tree-acts");
      const a = (icon, label, fn, off) => { const b = el("button"); b.type = "button"; b.innerHTML = uiIcon(icon, 14); b.title = label; b.setAttribute("aria-label", label); if (off) b.disabled = true; else b.addEventListener("click", (e) => { e.stopPropagation(); fn(); }); acts.appendChild(b); };
      a("up", held ? LOCK_SAY : "Move this block up", () => stkMove(bi, j, -1), held || j <= 0);
      a("down", held ? LOCK_SAY : "Move this block down", () => stkMove(bi, j, 1), held || j >= items.length - 1);
      a("cog", "Edit this block", () => stkEdit(bi, j, "content"));
      a("trash", held ? LOCK_SAY : "Delete this block", () => stkDelete(bi, j), held);
      row.appendChild(acts);
    }
    host.appendChild(row);
  });
  if (!CM_ON && !held && items.length < STK_MAX) {
    const add = el("button", "stk-tree-add under-page", "＋ Add a block"); add.type = "button";
    add.addEventListener("click", () => stkOpenAdd(bi, items.length));
    host.appendChild(add);
  }
}
function stkPickFromTree(bi, j) {
  const doc = dcFrameDoc(), hit = doc && stkFind(doc, bi, j);
  if (!hit) { stkEdit(bi, j, "content"); return; }   // a block that draws nothing yet (no words, no photo): its card
  try { hit.el.scrollIntoView({ behavior: pdReducedMotion() ? "auto" : "smooth", block: "center" }); } catch (_) {}
  stkPick(doc, hit.el, bi, j);
}
function stkTreeMark(bi, j) {
  const host = $("designTreeList"); if (!host) return;
  Array.prototype.forEach.call(host.querySelectorAll(".stk-row.sel"), (n) => n.classList.remove("sel"));
  if (bi == null) return;
  const r = host.querySelector('.stk-row[data-stk="' + bi + ":" + j + '"]'); if (r) r.classList.add("sel");
}

// ── CONTENT TREE (left rail) — AEM's Content Tree: every component on the page,
// top-to-bottom, each with its own settings ("meta"), reorder + hide/remove, and
// click-to-select on the canvas. Built fresh from the rendered sections each load
// so it always mirrors what's actually on the page. ──
const DC_CORE_NAME = { business: "Intro / hero", offerings: "What you offer", faqs: "Questions & answers", testimonials: "Reviews", updates: "Latest updates", design: "Section" };
function dcTreeEmpty(msg) { const host = $("designTreeList"); if (!host) return; host.textContent = ""; host.appendChild(el("div", "dc-tree-empty", msg)); }
function dcRefreshTree() { const doc = dcFrameDoc(); const main = doc && doc.getElementById("main"); if (main) dcBuildTree(main); else dcTreeEmpty("Your page is drawing… it’ll list here in a moment."); }
// The Content Tree is a real PAGE TREE: every page (Home + custom), and the page
// you're editing expands to its sections (AEM Sites-console model). Click a page to
// open it; click a section to jump to it on the canvas.
function dcBuildTree(main) {
  const host = $("designTreeList"); if (!host) return;
  // rebuilding wipes the rows — if one is mid-drag its captured source would detach
  // and the pointerup could never land (PDRAG wedged shut): cancel that drag first.
  if (PDRAG && (PDRAG.zone === "tree" || PDRAG.zone === "treecol")) pdFinish(false);
  host.textContent = "";
  // builder item 326: Layers is this page's sections, so it says so; the other pages follow it
  host.appendChild(el("div", "dc-tree-hd", "Sections on this page"));
  const pages = dcPageList(), open = pages.find((pg) => pg.slug === DC_PAGE);
  if (open) { host.appendChild(dcPageTreeRow(open, true)); dcTreeSectionRows(host, main); }   // the OPEN page expands to its sections
  else host.appendChild(el("div", "dc-tree-empty", "This page has no sections of its own. Press its words on the page to change them."));
  const rest = pages.filter((pg) => pg !== open);
  if (rest.length) host.appendChild(el("div", "dc-tree-hd dc-tree-hd-more", "Your other pages"));
  rest.forEach((pg) => host.appendChild(dcPageTreeRow(pg, false)));
  const add = el("button", "dc-tree-addpage", "＋ Add a page"); add.type = "button";
  add.addEventListener("click", dcAddPage);
  if (!CM_ON) host.appendChild(add);   // item 99: adding a page is editing, so Comments mode leaves it out
}
// One page row in the tree (Home or a custom page).
function dcPageTreeRow(pg, cur) {
  const row = el("div", "dc-tree-row pagerow" + (cur ? " sel" : ""));
  const mn = el("button", "dc-tree-main"); mn.type = "button"; mn.title = "Open this page to edit it";
  mn.appendChild(Object.assign(el("span", "dc-tree-ico"), { innerHTML: uiIcon(pg.slug ? "page" : "home") }));
  const hidden = pg.slug && dcPageObj(pg.slug) && dcPageObj(pg.slug).hideNav;
  const txt = el("span", "dc-tree-txt");
  txt.appendChild(el("span", "dc-tree-name", pg.title + (hidden ? " (hidden)" : "")));
  txt.appendChild(el("span", "dc-tree-meta", pg.slug ? ("/" + pg.slug + "/") : "home page"));
  mn.appendChild(txt);
  mn.addEventListener("click", () => dcSwitchPage(pg.slug));
  row.appendChild(mn);
  // G11: the whole-page feedback thread rides the page row while Comments is on
  if (CM_ON) row.appendChild(cmBadge(pg.slug, "", "Whole page — " + pg.title));
  const acts = el("span", "dc-tree-acts");
  const m = icoBtn("more", pg.slug ? "Rename, clear, hide or delete this page" : "Clear this page");
  m.addEventListener("click", (e) => { e.stopPropagation(); dcPageMenu(pg.slug, m); });
  acts.appendChild(m); if (!CM_ON) row.appendChild(acts);   // item 99: the page menu edits, so Comments mode leaves it out
  return row;
}
// The sections of the currently-open page, nested (indented) under its page row.
function dcTreeSectionRows(host, main) {
  const secs = main.querySelectorAll(":scope > section, :scope > nav.block-toc");
  if (!secs.length) { host.appendChild(el("div", "dc-tree-empty2", "No sections yet — use ＋ Add section on the canvas.")); cmOrphanRows(host, main); return; }
  Array.prototype.forEach.call(secs, (el2) => {
    const c = eeClassify(el2);
    const row = dcTreeRow(el2, c); row.classList.add("under-page"); host.appendChild(row);
    if (c && c.kind === "block" && el2.classList.contains("block-stack")) stkTreeRows(host, c.bi);   // item 57: its blocks, under it
    // a Columns container expands to reveal its columns (each selectable)
    if (c && c.kind === "block" && el2.classList.contains("block-columns")) {
      const b = BLOCKS_WORK[c.bi];
      const colEls = el2.querySelectorAll(".cols > .col");
      if (b && b.type === "columns" && colEls.length) {
        const spans = dcLiveSpans(b, colEls.length);
        Array.prototype.forEach.call(colEls, (colEl, k) => { const cr = dcTreeChildRow(colEl, c.bi, k, spans[k]); cr.classList.add("under-page"); host.appendChild(cr); });
      }
    }
  });
  cmOrphanRows(host, main);   // G11: feedback whose section was removed still surfaces
}
// the quiet ⠿ drag handle on tree rows: touch-action:none (like the canvas grip)
// so touch drags actually drag instead of panning; any pointer type starts here.
// Pointer-only by design — keyboard reordering stays on the rows' ↑/↓ buttons.
function dcTreeGrab(spec) {
  const g = el("button", "dc-tree-grab", "⠿"); g.type = "button"; g.tabIndex = -1;
  g.title = "Drag to reorder"; g.setAttribute("aria-hidden", "true");
  g.addEventListener("pointerdown", (e) => pdStart(e, spec, g));
  return g;
}
// a child row under a container: one column, selectable, with its own settings.
// Slice C: drag a column row to reorder it WITHIN its container (pd engine,
// zone "treecol" — per-container list order only, never x/y).
function dcTreeChildRow(colEl, bi, k, span) {
  const row = el("div", "dc-tree-row child");
  row.dataset.colof = String(bi); row.dataset.k = String(k);
  const dragSpec = { kind: "movecol", bi: bi, from: k, zone: "treecol", label: "Column " + (k + 1), icon: uiIcon("columns") };
  if (!CM_ON) row.appendChild(dcTreeGrab(dragSpec));   // touch drags start on the ⠿ handle; the row keeps pan-y. Item 99: no reordering in Comments mode
  const mainBtn = el("button", "dc-tree-main"); mainBtn.type = "button"; mainBtn.title = CM_ON ? "Select this column on the page" : "Select this column on the page — drag to reorder the columns";
  mainBtn.appendChild(Object.assign(el("span", "dc-tree-ico"), { innerHTML: uiIcon("columns") }));
  const txt = el("span", "dc-tree-txt");
  txt.appendChild(el("span", "dc-tree-name", "Column " + (k + 1)));
  txt.appendChild(el("span", "dc-tree-meta", "width " + (span || "?") + "/12"));
  mainBtn.appendChild(txt);
  if (!CM_ON) mainBtn.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") pdStart(e, dragSpec, mainBtn); });
  mainBtn.addEventListener("click", () => {
    if (pdConsumeClick()) return;   // the click that follows a real drag
    try { colEl.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
    colEl.classList.add("dc-hot"); setTimeout(() => { try { colEl.classList.remove("dc-hot"); } catch (_) {} }, 1300);
    const host = $("designTreeList"); if (host) Array.prototype.forEach.call(host.querySelectorAll(".dc-tree-row.sel"), (n) => n.classList.remove("sel"));
    row.classList.add("sel");
  });
  row.appendChild(mainBtn);
  const acts = el("span", "dc-tree-acts");
  const set = el("button"); set.innerHTML = uiIcon("cog", 14); set.type = "button"; set.title = "Edit this column"; set.setAttribute("aria-label", "Edit column " + (k + 1));
  set.addEventListener("click", (e) => { e.stopPropagation(); eeEditBlock(bi); });
  acts.appendChild(set);
  if (!CM_ON) row.appendChild(acts);   // item 99: Comments mode offers no editing; the comment badge stays
  return row;
}
// Item 85: a live redraw swaps one section's element in place and leaves this list standing,
// so a row whose element has gone finds the section now drawn at its place in the list.
function dcTreeEl(el2, c) {
  if (el2.isConnected || !c || c.kind !== "block") return el2;
  const doc = dcFrameDoc(), main = doc && doc.getElementById("main");
  return (main && Array.prototype.find.call(main.children, (n) => { const k = eeClassify(n); return k.kind === "block" && k.bi === c.bi; })) || el2;
}
function dcTreeRow(el2, c) {
  const isBlock = c && c.kind === "block";
  const b = isBlock ? (BLOCKS_WORK[c.bi] || {}) : null;
  const def = isBlock ? BLOCK_DEFS.find((x) => x.type === b.type) : null;
  const heading = ((el2.querySelector("h1,h2,h3") || {}).textContent || "").trim();
  const name = isBlock ? ((def && def.name) || b.type || "Section")
    : (heading ? heading.slice(0, 42) : (DC_CORE_NAME[c.view] || "Section"));
  const meta = isBlock ? (SECTION_ALIAS[b.type] || b.type || "section") : "built-in section";
  const icon = isBlock ? trayIcon(b.type) : uiIcon("section");
  const row = el("div", "dc-tree-row " + (isBlock ? "block" : "core"));
  if (isBlock) row.dataset.bi = String(c.bi);   // slice C: pdTreeGaps reads these
  // Slice C: drag a section row to reorder — the SAME pd engine + dcMove commit
  // as dragging the section on the canvas (single-gap list index, never x/y).
  // Touch drags start on the ⠿ handle (touch-action:none, like the canvas grip);
  // the row keeps pan-y so the tree scrolls, and drags from it are mouse-only.
  const dragSpec = isBlock ? { kind: "move", from: c.bi, zone: "tree", label: name, icon: icon } : null;
  if (isBlock && !CM_ON) row.appendChild(dcTreeGrab(dragSpec));   // item 99: no reordering in Comments mode
  const mainBtn = el("button", "dc-tree-main"); mainBtn.type = "button";
  mainBtn.title = isBlock && !CM_ON ? "Select this on the page — drag to reorder your sections" : "Select this on the page";
  mainBtn.appendChild(Object.assign(el("span", "dc-tree-ico"), { innerHTML: icon }));
  const txt = el("span", "dc-tree-txt");
  txt.appendChild(el("span", "dc-tree-name", name));
  txt.appendChild(el("span", "dc-tree-meta", meta));
  mainBtn.appendChild(txt);
  if (isBlock && !CM_ON) mainBtn.addEventListener("pointerdown", (e) => { if (e.pointerType === "mouse") pdStart(e, dragSpec, mainBtn); });
  mainBtn.addEventListener("click", () => { if (pdConsumeClick()) return; dcTreeSelect(dcTreeEl(el2, c), row); });
  row.appendChild(mainBtn);
  // G11: per-section comment badge (count when open notes exist; quiet icon to
  // start a thread). Block rows only — keyed by the stable section id, so the
  // thread survives reorders and matches the client's shared-draft feedback.
  if (CM_ON && isBlock) {
    // G13: the section's stamped sid (canvas) with the sidecar as fallback —
    // never a client recomputation of the id scheme.
    const cid = (el2.getAttribute && el2.getAttribute("data-dds-sid")) || ddsSidFor(c.bi);
    if (cid) row.appendChild(cmBadge(DC_PAGE, cid, name));
  }
  const acts = el("span", "dc-tree-acts");
  const mkA = (label, title, fn, disabled) => {
    const btn = el("button"); if (String(label).startsWith("<svg")) btn.innerHTML = label; else btn.textContent = label;
    btn.type = "button"; btn.title = title; btn.setAttribute("aria-label", title);
    if (disabled) btn.disabled = true; else btn.addEventListener("click", (e) => { e.stopPropagation(); fn(); });
    return btn;
  };
  if (isBlock) {
    const held = lockedForMe(BLOCKS_WORK[c.bi]);   // item 155: a section the studio locked stays where it is
    acts.appendChild(mkA(uiIcon("up", 14), held ? LOCK_SAY : "Move up", () => dcMove(c.bi, c.bi - 1), held || c.bi <= 0));
    acts.appendChild(mkA(uiIcon("down", 14), held ? LOCK_SAY : "Move down", () => dcMove(c.bi, c.bi + 2), held || c.bi >= (BLOCKS_WORK.length - 1)));
    acts.appendChild(mkA(uiIcon("cog", 14), "Settings for this section", () => eeEditBlock(c.bi)));
    acts.appendChild(mkA(uiIcon("trash", 14), held ? LOCK_SAY : "Remove this section", () => dcDelete(c.bi), held));
  } else {
    const keys = c.key ? dcCoreKeys(el2.parentNode) : [], at = keys.indexOf(c.key);
    if (at >= 0) {
      row.dataset.core = c.key;
      acts.appendChild(mkA(uiIcon("up", 14), "Move up", () => dcMoveCore(c.key, -1, true), at <= 0));
      acts.appendChild(mkA(uiIcon("down", 14), "Move down", () => dcMoveCore(c.key, 1, true), at >= keys.length - 1));
    }
    acts.appendChild(mkA(uiIcon("cog", 14), "Edit this section", () => eeEditCore(c.view)));
    if (c.key) acts.appendChild(mkA(uiIcon("eyeoff", 14), "Hide this section", () => eeHideKey(c.key)));
  }
  if (!CM_ON) row.appendChild(acts);   // item 99: Comments mode offers no editing; the comment badge stays
  return row;
}
function dcTreeSelect(el2, row) {
  try { el2.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {}
  if (DC_SHOWBAR) DC_SHOWBAR(el2);
  const host = $("designTreeList"); if (host) Array.prototype.forEach.call(host.querySelectorAll(".dc-tree-row.sel"), (n) => n.classList.remove("sel"));
  if (row) row.classList.add("sel");
}

// Install once: every time the canvas srcdoc (re)loads, inject the chrome and
// restore the scroll we captured before the save→reload. Guarded + best-effort:
// a chrome failure never breaks the proof.
(function installDesignCanvas() {
  const frame = $("designPreview"); if (!frame) return;
  dcWatchNav(frame);   // item 244: a page is guarded from the moment it's in the canvas, not from its load
  frame.addEventListener("load", () => {
    let doc; try { doc = frame.contentDocument; } catch (_) { return; }
    if (!doc || !doc.body) return;
    // Load waits for a document's images, so the page can change between its write and
    // here. A document from before that gets no chrome, and the canvas stays inert.
    if (DP_PAINT_OPEN !== DC_PAGE_OPENS) return;
    frame.inert = false;
    const wrap = frame.closest(".dp-frame");
    frame.removeAttribute("aria-hidden");   // the canvas is interactive (Edit) or readable (view modes), not decorative
    // Item 244: in every mode a link or a form on the page leaves the canvas on the draft. In
    // Edit mode the business name in the header (a section's buttons, the footer's links) loaded
    // the editor's own address into the frame, on every device. This runs BEFORE the #main
    // check: even a document without the landmark (an error page, an old kept version) gets it.
    dcGuardNav(doc);
    dcMenuWire(doc);   // item 288: the phone menu opens and closes on the canvas too
    // Slice D: Preview / Timewarp withhold ALL editing chrome — the injector is
    // simply never called; the page scrolls, links/forms are guarded read-only.
    if (DC_MODE === "timewarp") {
      if (wrap) { wrap.classList.remove("dc-live"); wrap.classList.add("dc-view"); }
      return;
    }
    if (wrap) { wrap.classList.remove("dc-view"); wrap.classList.add("dc-live"); }
    const main = doc.getElementById("main"); if (!main) return;
    if (!BLOCKS_WORK) BLOCKS_WORK = currentBlocks();
    try { dcInjectCanvas(doc, main); } catch (_) { /* chrome is best-effort */ }
    // Item 26: a redraw is drawn from the saved draft; a section edited since and not yet
    // saved is put back the way it's being edited, so old words never come back on screen.
    if (LIVE_WANTED && blocksDirty()) dcLiveSoon();
    // A just-added / dropped / duplicated / pasted section: scroll the canvas to it
    // and flash it, so the change is NEVER invisible (blocks render below the core
    // sections, so a silent add looked like nothing happened). Falls back to the
    // preserved scroll position for edits/moves that didn't add a section.
    if (DC_FOCUS_BI != null) {
      // Item 318: a section that moved on the page already is kept in view, without a second
      // flash. Item 319: one the redraw can't find leaves the canvas where it was, instead of
      // jumping to the page's end.
      const soft = DC_FOCUS_SOFT; DC_FOCUS_SOFT = false;
      let landed = false;
      try {
        const hit = dcBlockSections(main).find((s) => s.bi === DC_FOCUS_BI);
        if (hit && hit.el) {
          hit.el.scrollIntoView({ block: soft ? "nearest" : "center", behavior: pdReducedMotion() || soft ? "auto" : "smooth" });
          if (!soft) { hit.el.classList.add("dc-justadded"); setTimeout(() => { try { hit.el.classList.remove("dc-justadded"); } catch (_) {} }, 1500); }
          landed = true;
        }
      } catch (_) {}
      DC_FOCUS_BI = null;
      if (landed || DC_SCROLL == null) DC_SCROLL = null;
      else if (doc.defaultView) { try { doc.defaultView.scrollTo(0, DC_SCROLL); } catch (_) {} DC_SCROLL = null; }
    } else if (DC_FOCUS_CORE) {
      const f = DC_FOCUS_CORE; DC_FOCUS_CORE = null; DC_SCROLL = null;
      const hit = main.querySelector(':scope > [data-dds-core="' + f.key + '"]');
      if (hit) {
        try { hit.scrollIntoView({ block: "center", behavior: pdReducedMotion() ? "auto" : "smooth" }); } catch (_) {}
        hit.classList.add("dc-justadded");
        setTimeout(() => { try { hit.classList.remove("dc-justadded"); } catch (_) {} }, 1500);
      }
      const row = f.tree && document.querySelector('#designTreeList .dc-tree-row[data-core="' + f.key + '"]');
      const b = row && (row.querySelector('button[aria-label="' + (f.dir < 0 ? "Move up" : "Move down") + '"]:not(:disabled)') || row.querySelector("button:not(:disabled)"));
      if (b) b.focus();
    } else if (DC_SCROLL != null && doc.defaultView) { try { doc.defaultView.scrollTo(0, DC_SCROLL); } catch (_) {} DC_SCROLL = null; }
  });
})();

// this part is in: its doors in presence-core.js go straight through from here on
(window.__ddsParts || (window.__ddsParts = {}))["edit"] = true;
