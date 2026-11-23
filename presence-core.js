// ── The website editor: what loads with the page (builder item 38) ─────────────
// presence.html was one 1.5 MB file. Its styles are presence.css, and its script is in parts:
//   presence-core.js (this file): everything the Overview and the tabs need, loaded with the page.
//   presence-edit.js: Edit mode, the canvas and its cards, the inspector, Blocks, the add-a-section
//     tray. It loads the first time Edit mode is wanted, or once the page has settled, whichever
//     comes first, so Edit site is ready when it's pressed.
// The two share one global scope, as when they were one script. A function of Edit mode's that
// this file calls has a stand-in here (the list at the end of this header). A door, like
// mountEditCards, loads the part and then runs. Any other stand-in does nothing until the part is
// in, since nothing of Edit mode's is on screen to bring up to date. Once the part is in, it
// replaces every stand-in with its own function, so a stand-in only answers in the first moments.
// tests/presence/editor_parts_test.mjs holds this together: nothing here reaches into a part
// except through a stand-in, and a stand-in's answer is never used straight away.
const DDS_PART_SRC = {"edit":"/presence-edit.js?v=1"};
const DDS_PART_AT = {};
// every stand-in, so a call can tell whether the part has replaced it yet
const DDS_STANDINS = new Set([mountEditCards, mountDesignCard, linkPick, dcDeletePage, dcSavePageName, openSettingsPanel, mountBlocksCard, applyTemplateFromGallery, dcAddPage, openTrayPanel, dcPageMenu, dcDuplicatePage, dcClearPage, stylesTab, dcOpenPage, pcEverySub, dcSaveNav, dcSwitchPage, ipeCommit, closePagesCard, closeSettingsPanel, dcClipSet, dcSavePendingEdits, dcSyncPageSwitch, pagesBarReveal, dcRefreshTree, renderPagesBar, dcSyncLiveChip, renderBlocksCard, refreshDesignPreview, exitEditMode, dcLiveFromPanel, dcLiveSoon, formsLoad, remountSectionsCard, renderBlockTray, mountTemplateGallery, eeEditCore, pfRefresh]);
function ddsPartIn(name) { return !!(window.__ddsParts && window.__ddsParts[name]); }
// Load a part (once); answers when it is in. A failed load can be tried again.
function ddsPart(name) {
  if (DDS_PART_AT[name]) return DDS_PART_AT[name];
  const at = new Promise((res, rej) => {
    if (ddsPartIn(name)) return res();
    const s = document.createElement("script");
    s.src = DDS_PART_SRC[name];
    s.onload = () => (ddsPartIn(name) ? res() : rej(new Error("The editor's " + name + " part didn't finish loading")));
    s.onerror = () => { s.remove(); rej(new Error("The editor's " + name + " part didn't load")); };
    document.head.appendChild(s);
  });
  DDS_PART_AT[name] = at;
  at.catch(() => { delete DDS_PART_AT[name]; });
  return at;
}
// Run now if the part is in; otherwise once it is (a failed load says so once).
function ddsWith(name, fn) {
  if (ddsPartIn(name)) { fn(); return; }
  ddsPart(name).then(fn, () => toast("Part of the editor didn’t load. Check your connection and try again.", true));
}
// A stand-in's call: the part's own function once it is in; before that a door loads it first,
// and anything else does nothing.
function ddsStub(part, name, args, door) {
  const f = window[name];
  if (!DDS_STANDINS.has(f)) return f(...args);
  if (!door) return undefined;
  return ddsPart(part).then(() => {
    const g = window[name];
    if (DDS_STANDINS.has(g)) throw new Error("The editor's " + part + " part has no " + name);
    return g(...args);
  }, (err) => { toast("Part of the editor didn’t load. Check your connection and try again.", true); throw err; });
}
// ┌ the stand-ins, until presence-edit.js replaces them (tests/presence/editor_source.mjs leaves
//   them out: the suites read the code as it was, one function to a name)
function mountEditCards(...a) { return ddsStub("edit", "mountEditCards", a, true); }
function mountDesignCard(...a) { return ddsStub("edit", "mountDesignCard", a, true); }
function linkPick(...a) { return ddsStub("edit", "linkPick", a, true); }
function dcDeletePage(...a) { return ddsStub("edit", "dcDeletePage", a, true); }
function dcSavePageName(...a) { return ddsStub("edit", "dcSavePageName", a, true); }
function openSettingsPanel(...a) { return ddsStub("edit", "openSettingsPanel", a, true); }
function mountBlocksCard(...a) { return ddsStub("edit", "mountBlocksCard", a, true); }
function applyTemplateFromGallery(...a) { return ddsStub("edit", "applyTemplateFromGallery", a, true); }
function dcAddPage(...a) { return ddsStub("edit", "dcAddPage", a, true); }
function openTrayPanel(...a) { return ddsStub("edit", "openTrayPanel", a, true); }
function dcPageMenu(...a) { return ddsStub("edit", "dcPageMenu", a, true); }
function dcDuplicatePage(...a) { return ddsStub("edit", "dcDuplicatePage", a, true); }
function dcClearPage(...a) { return ddsStub("edit", "dcClearPage", a, true); }
function stylesTab(...a) { return ddsStub("edit", "stylesTab", a, true); }
function dcOpenPage(...a) { return ddsStub("edit", "dcOpenPage", a, true); }
function pcEverySub(...a) { return ddsStub("edit", "pcEverySub", a, true); }
function dcSaveNav(...a) { return ddsStub("edit", "dcSaveNav", a, true); }
function dcSwitchPage(...a) { return ddsStub("edit", "dcSwitchPage", a, true); }
function ipeCommit(...a) { return ddsStub("edit", "ipeCommit", a, false); }
function closePagesCard(...a) { return ddsStub("edit", "closePagesCard", a, false); }
function eeEditCore(...a) { return ddsStub("edit", "eeEditCore", a, true); }
function pfRefresh(...a) { return ddsStub("edit", "pfRefresh", a, false); }   // item 317: the Photos card draws again after descriptions are saved   // item 314: a built-in page's words, in a card beside the page
function closeSettingsPanel(...a) { return ddsStub("edit", "closeSettingsPanel", a, false); }
function dcClipSet(...a) { return ddsStub("edit", "dcClipSet", a, false); }
// Builder items 250 and 251: a part of the editor with saves of its own (the forms card, in the
// Edit part) tells the core here: pending() says whether something is still waiting or failed
// (the close-tab warning asks), retry() sends it again (`online`, the sign-in, Try again).
const SAVE_PARTS = [];
function partsPending() { return SAVE_PARTS.some((h) => { try { return !!h.pending(); } catch (_) { return false; } }); }
// Before Edit mode's part is in, nothing on the canvas waits to be saved; what's typed on the
// Business tab still goes first, as it always did.
async function dcSavePendingEdits(keepSession) {
  if (!DDS_STANDINS.has(window.dcSavePendingEdits)) return window.dcSavePendingEdits(keepSession);
  await Promise.all([debounceFlush("identity:"), debounceFlush("location:")]);
  return true;
}
function dcSyncPageSwitch(...a) { return ddsStub("edit", "dcSyncPageSwitch", a, false); }
function pagesBarReveal(...a) { return ddsStub("edit", "pagesBarReveal", a, false); }
function dcRefreshTree(...a) { return ddsStub("edit", "dcRefreshTree", a, false); }
function renderPagesBar(...a) { return ddsStub("edit", "renderPagesBar", a, false); }
function dcSyncLiveChip(...a) { return ddsStub("edit", "dcSyncLiveChip", a, false); }
function renderBlocksCard(...a) { return ddsStub("edit", "renderBlocksCard", a, false); }
function refreshDesignPreview(...a) { return ddsStub("edit", "refreshDesignPreview", a, false); }
function exitEditMode(...a) { return ddsStub("edit", "exitEditMode", a, false); }
function dcLiveFromPanel(...a) { return ddsStub("edit", "dcLiveFromPanel", a, false); }
function dcLiveSoon(...a) { return ddsStub("edit", "dcLiveSoon", a, false); }
function formsLoad(...a) { return ddsStub("edit", "formsLoad", a, false); }
function remountSectionsCard(...a) { return ddsStub("edit", "remountSectionsCard", a, false); }
function renderBlockTray(...a) { return ddsStub("edit", "renderBlockTray", a, false); }
function mountTemplateGallery(...a) { return ddsStub("edit", "mountTemplateGallery", a, false); }
// └ the stand-ins
// ── the page's own script, as it was ──

/* ════ The Client Room · Direction A dress over the frozen M7 movement ════
   Every API call, route, and contract is byte-identical to M7. Only the
   presentation, vocabulary, and interaction dress changed (M7.5).        */
"use strict";

/* ── environment: production by default; ?env=staging for acceptance runs ── */
const ENVS = {
  prod: { url: "https://qksstlqzbhesadrrofgn.supabase.co",
          anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrc3N0bHF6Ymhlc2FkcnJvZmduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5NzMwMDMsImV4cCI6MjA5NzU0OTAwM30.4V94Ua7z5cntPWtvtqN24TUnfY5A6K6-zCxY0iEcgYo" },
  staging: { url: "https://wjlpursnwbmlcdwbeowv.supabase.co",
          anon: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndqbHB1cnNud2JtbGNkd2Jlb3d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMyNzExMzUsImV4cCI6MjA5ODg0NzEzNX0.XAWyxx-7WsDC6Eg4nc2dlcFmHRe6NUKYEVBkjRvkGXQ" },
};
const ENV = new URLSearchParams(location.search).get("env") === "staging" ? ENVS.staging : ENVS.prod;
const FN = ENV.url + "/functions/v1/presence";
// run production's server beside its database (Oregon), not nearest the visitor: see shell.js.
// Staging's server doesn't allow the header, so it goes to production only.
const REGION_HEADER = ENV === ENVS.prod ? { "x-region": "us-west-2" } : {};
const sb = supabase.createClient(ENV.url, ENV.anon, { auth: { storageKey: "dds-portal-auth", persistSession: true, autoRefreshToken: true } });
if (ENV === ENVS.prod) window.__ddsSb = sb;   // shell.js reuses it, so this page runs one auth client

/* ── helpers ── */
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
// Item 34: one icon set. A small button drawn with the editor's own icon (uiIcon), its words kept as
// its name for screen readers and as its tooltip, instead of a typed ↑, ↓, ✕, × or ⋯.
const icoBtn = (name, label, cls, size) => { const b = el("button", cls); b.type = "button"; b.innerHTML = uiIcon(name, size || 16); b.setAttribute("aria-label", label); b.title = label; return b; };
// Says who can, where a role without configure would otherwise find a sentence and nothing to press.
const askOwner = (cls, text) => { const n = el("div", cls, text); n.hidden = true; n.dataset.ifLacks = "configure"; return n; };
// A small typed answer (or a masked password) in place of the browser's prompt(): the shell's
// one styled prompt since builder item 101 (shell-kit.js ddsAsk). Resolves the entered value, or
// null on cancel. Empty is an answer here (some fields say "leave it empty"); a password is
// never trimmed; a link can be long.
function askText(title, opts) {
  opts = opts || {};
  return window.ddsAsk({ title, text: opts.hint, value: opts.value, placeholder: opts.placeholder, password: !!opts.password, yes: opts.ok || "Save", required: false, max: opts.max || 4096 });
}
// Builder item 194 (Nov 12 review, findings 19, 23 and 26). One record, shown the way a provider's
// form wants it: the name is "@", "www" or "_dmarc", never the full name (most forms add the
// domain themselves, so _dmarc.x.com typed as shown became _dmarc.x.com.x.com). Its Copy button
// is named for what it copies; every one used to be just "Copy".
function dnsRecHost(name, domain) {
  const n = String(name || "").toLowerCase().replace(/\.$/, ""), bare = String(domain || "").toLowerCase().replace(/^www\./, "");
  if (!bare) return n;
  return n === bare ? "@" : n.endsWith("." + bare) ? n.slice(0, -(bare.length + 1)) : n;
}
function dnsRecordRow(type, host, val) {
  const r = el("div", "dnsrec"); r.dataset.rec = type + " " + host;
  const code = el("span", "dnsrec-v", type + "   " + host + "   →   " + val);
  const cp = el("button", "textact", "Copy"); cp.setAttribute("aria-label", "Copy the value of the " + type + " record for " + host + ": " + val);
  cp.addEventListener("click", () => { if (navigator.clipboard) navigator.clipboard.writeText(String(val)).then(() => toast("Copied " + val)).catch(() => {}); });
  r.appendChild(code); r.appendChild(cp); return r;
}
// The one honest wait (finding 21): the server sends it; this is the same sentence for an older server.
const DOMAIN_WAIT = "Usually within an hour of adding the records, sometimes a day or two.";
// Item 174 (Namecheap's and Squarespace's plain redirect form): another domain the client owns sends
// its visitors here, page for page, from the next publish. Its records point here too (the same two).
function forwardsBlock(dstat) {
  // its own line maker: renderFoundations' stepLine is local to it
  const stepLine = (t) => { const p = el("p", "aihint", t); p.style.marginTop = "5px"; return p; };
  const box = el("div"); box.dataset.forwards = "domain"; box.style.marginTop = "12px";
  const h = stepLine("Other domains that send visitors here"); h.style.fontWeight = "600"; box.appendChild(h);
  const list = Array.isArray(dstat.forwards) ? dstat.forwards : [];
  if (!list.length) { const e = stepLine("None yet. An old name, or a second one you own, can send its visitors to " + dstat.custom_domain + "."); e.style.color = "var(--soft,#6b6478)"; box.appendChild(e); }
  // a name and its www. are one line with one Stop (the server takes both off together)
  // builder item 194 (finding 20): a forwarded domain was shown as working the moment it was added
  // and never checked. Now it says "waiting" until a check sees its records, and shows them.
  const checks = Array.isArray(dstat.forward_checks) ? dstat.forward_checks : [];
  list.filter((n) => !(n.startsWith("www.") && list.includes(n.slice(4)))).forEach((n) => {
    const both = list.includes("www." + n);
    const mine = checks.filter((c) => c && (c.name === n || (both && c.name === "www." + n)));
    const waiting = mine.some((c) => c.points === false);
    const row = el("div", "doa"); row.dataset.forward = n; row.dataset.state = waiting ? "waiting" : "sending"; row.style.cssText = "gap:8px;flex-wrap:wrap;margin-top:4px;align-items:center";
    const what = el("span", "aihint", waiting ? n + " is waiting for its records. It sends visitors to " + dstat.custom_domain + " once they point here:" : (both ? n + " and www." + n + " send" : n + " sends") + " visitors to " + dstat.custom_domain); what.style.margin = "0";
    row.appendChild(what);
    const stop = el("button", "textact", "Stop"); stop.dataset.needs = "configure";
    stop.addEventListener("click", async () => {
      if (!(await askYes("Stop " + n + " sending visitors to " + dstat.custom_domain + "?", { ok: "Stop forwarding", danger: true }))) return;
      try { await api("DELETE", "/foundations/domain/forward", { domain: n }); toast("Stopped."); openFoundationsDesk(); } catch (err) { toast(nice(err), true); }
    });
    row.appendChild(stop); box.appendChild(row);
    if (waiting) mine.filter((c) => c.points === false).forEach((c) => (c.records || []).forEach((r) => box.appendChild(dnsRecordRow(r.type, r.host, r.value))));
  });
  const add = el("div", "doa"); add.dataset.needs = "configure"; add.style.cssText = "gap:8px;flex-wrap:wrap;margin-top:6px";
  const inp = el("input"); inp.type = "text"; inp.placeholder = "oldname.com"; inp.setAttribute("aria-label", "A domain to send here"); inp.setAttribute("autocomplete", "off");
  inp.style.cssText = "flex:1;min-width:160px;padding:7px 10px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:16px";
  const go = el("button", "textact", "Send it here");
  go.addEventListener("click", async () => {
    const d = String(inp.value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[\/?#].*$/, "");
    if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) { toast("Type a domain, like oldname.com.", true); return; }
    go.disabled = true;
    try { await api("POST", "/foundations/domain/forward", { domain: d }); toast(d + " sends visitors here from your next publish, once its records point here too."); openFoundationsDesk(); }
    catch (err) { toast(nice(err), true); go.disabled = false; }
  });
  add.appendChild(inp); add.appendChild(go); box.appendChild(add);
  const note = stepLine("Its records point here too: the same as for your main domain. It starts sending visitors with your next publish, once we’ve seen them."); note.style.color = "var(--soft,#6b6478)"; box.appendChild(note);
  return box;
}
// Item 164 (review domains finding 13): the wait, in steps with times. When the domain was connected
// here, whether its records are found, the padlock, and live (when we email). The time is the
// honest one, said one way everywhere (builder item 194, finding 21).
function waitSteps(dstat, dom) {
  // its own line maker: renderFoundations' stepLine is local to it
  const stepLine = (t) => { const p = el("p", "aihint", t); p.style.marginTop = "5px"; return p; };
  const box = el("div"); box.dataset.wait = "steps"; box.style.marginTop = "10px";
  // date and time built apart: Safari's engine joins them with " at ", Chrome's with ", "
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
  const ch = (dom && Array.isArray(dom.changes) ? dom.changes : []).find((c) => /^(Attached domain|Changed domain from) /.test(String(c.words || "")));
  const found = dstat.health === "ssl_pending" || dstat.health === "ok";
  [[true, "Connected here", ch ? when(ch.at) : ""],
   [found, "Records found", found ? "" : "not yet, we looked just now"],
   [dstat.health === "ok", "Padlock on", dstat.health === "ssl_pending" ? "being switched on" : found ? "" : "comes after the records"],
   [dstat.health === "ok", "Live", "we’ll email you when a check sees it. We look once a day, and each time this opens"],
  ].forEach(([done, label, note]) => { const l = stepLine((done ? "✓ " : "• ") + label + (note ? " · " + note : "")); l.dataset.wait = done ? "done" : "todo"; if (done) l.style.color = "var(--soft,#6b6478)"; box.appendChild(l); });
  const t = stepLine(String(dstat.wait || DOMAIN_WAIT)); t.dataset.wait = "time"; t.style.marginTop = "6px"; box.appendChild(t);
  return box;
}
// Item 163 (review domains finding 12): changing the domain asks for the new name and whether the
// old one keeps working, on by default (a business that changes names keeps its old links).
function askDomainChange(old) {
  return new Promise((resolve) => {
    const dlg = el("dialog", "ask-domain"); dlg.style.cssText = "border:none;border-radius:14px;padding:0;max-width:420px;width:92%;box-shadow:0 20px 60px rgba(30,19,56,.28);background:var(--card,#fff);color:var(--ink,#1b1525)";
    const form = el("form"); form.style.cssText = "padding:20px";
    const h = el("div", null, "Change " + old + " to a different domain"); h.id = "askDomainTitle"; h.style.cssText = "font-weight:600;margin-bottom:6px"; form.appendChild(h);
    dlg.setAttribute("aria-labelledby", h.id);
    const hint = el("div", null, "Type the new domain. You’ll get its two records to add, the same as before."); hint.style.cssText = "font-size:13px;color:var(--soft,#6b6478);margin-bottom:10px"; form.appendChild(hint);
    const inp = el("input"); inp.type = "text"; inp.placeholder = "newname.com"; inp.setAttribute("aria-label", "The new domain"); inp.setAttribute("autocomplete", "off");
    inp.style.cssText = "width:100%;font:inherit;font-size:16px;padding:9px 12px;border:1px solid var(--line,#ddd);border-radius:9px;outline:none;box-sizing:border-box"; form.appendChild(inp);
    const keep = el("label"); keep.style.cssText = "display:flex;gap:8px;align-items:flex-start;margin-top:12px;font-size:14px;line-height:1.4";
    const cb = el("input"); cb.type = "checkbox"; cb.checked = true; cb.style.marginTop = "3px";
    keep.appendChild(cb); keep.appendChild(el("span", null, "Keep " + old + " working: its visitors are sent on to the new domain, to the same page")); form.appendChild(keep);
    const err = el("div", null, ""); err.setAttribute("role", "alert"); err.style.cssText = "font-size:13px;color:var(--clay);margin-top:8px"; form.appendChild(err);
    const row = el("div"); row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;margin-top:14px";
    const cancel = el("button", null, "Cancel"); cancel.type = "button"; cancel.style.cssText = "font:inherit;font-size:13px;font-weight:600;border:1px solid var(--line,#ddd);background:transparent;color:var(--ink,#1b1525);border-radius:999px;padding:8px 16px;cursor:pointer";
    const ok = el("button", null, "Change domain"); ok.type = "submit"; ok.style.cssText = "font:inherit;font-size:13px;font-weight:600;border:1px solid var(--plum,#5b3fa0);background:var(--plum,#5b3fa0);color:var(--fill-ink);border-radius:999px;padding:8px 16px;cursor:pointer";
    row.appendChild(cancel); row.appendChild(ok); form.appendChild(row); dlg.appendChild(form); document.body.appendChild(dlg);
    let done = false; const finish = (v) => { if (done) return; done = true; try { dlg.close(); } catch (e) {} dlg.remove(); resolve(v); };
    cancel.addEventListener("click", () => finish(null));
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = String(inp.value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[\/?#].*$/, "");
      if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) { err.textContent = "That doesn’t look like a domain yet, like newname.com."; inp.focus(); return; }
      if (d === String(old).toLowerCase()) { err.textContent = "That’s the domain it has now."; inp.focus(); return; }
      finish({ domain: d, keepOld: cb.checked });
    });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); finish(null); });
    dlg.showModal(); setTimeout(() => inp.focus(), 20);
  });
}
// A styled yes/no question in place of the browser's confirm() (item 33): the shell's one
// styled question since builder item 101 (shell-kit.js ddsConfirm). The browser's box can't be
// styled, reads like a system warning, and on a phone shows the site's address over the
// question. A message written "The question? What it means." shows the question as the title
// and the rest under it, line breaks kept (so does a first paragraph and the rest). Resolves
// true for the main button, false for Cancel or Escape. A question about removing or replacing
// something (danger) starts on Cancel, so Enter never takes the risky path, and its button is red.
function askYes(message, opts) {
  opts = opts || {};
  const m = String(message ?? ""), q = m.search(/\?\s/), para = m.indexOf("\n\n");
  const ends = [q > 0 ? q + 1 : 0, para > 0 ? para : 0].filter(Boolean), cut = ends.length ? Math.min(...ends) : -1;   // the question or the first paragraph, whichever ends first
  return window.ddsConfirm({ title: cut > 0 ? m.slice(0, cut).trim() : m, text: cut > 0 ? m.slice(cut).trim() : "", yes: opts.ok || "OK", no: opts.cancel || "Cancel", danger: !!opts.danger });
}
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Phase SEARCH: client-side tag parse — mirrors lib/search_index.ts normalizeTags
// (lowercase · charset-limited · de-duped · ≤12 tags · ≤30 chars). The server
// re-normalizes on save, so this is just a friendly local preview of the result.
function splitTags(raw) {
  const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[,\n]/);
  const out = [], seen = new Set();
  for (const p of parts) {
    const t = p.toLowerCase().replace(/[^a-z0-9 &+-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!t || seen.has(t)) continue;
    seen.add(t); out.push(t);
    if (out.length >= 12) break;
  }
  return out;
}
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-US", { weekday: "long" });
function toast(msg, bad) {
  // P2-B: the ONE shared toast (success or failure) from the shell; since builder item 101 the
  // editor keeps no toast of its own (shell-kit.js ddsToast loads before this file).
  if (bad && STALE_TOAST && STALE_TOAST.isConnected && STALE_TOAST.textContent.includes(msg)) return;   // offered with its button already
  window.ddsToast(msg, bad ? "err" : "ok");
}
// Wave-1 G7: a toast that carries ONE action (Undo a page delete, Load the latest
// after an edit conflict): the shell's toast with its one button (builder item 101);
// stays up `ms` (default 20s) so the action is genuinely reachable, and a later toast
// sits above it instead of covering it.
// A save refused because the site changed elsewhere is refused again until the page
// loads that change, whichever save it was. So every such refusal offers the one way
// out, once while it's up, from apiSend; a caller's own copy of the sentence is dropped.
let STALE_TOAST = null;
function offerLoadLatest(msg) {
  if (STALE_TOAST && STALE_TOAST.parentNode) return;
  STALE_TOAST = toastAction(msg, "Load the latest", loadLatest, 30000);
}
async function loadLatest() {
  STALE_TOAST = null;
  // Builder item 278: "your unsaved edit was set aside" used to mean dropped. The first section
  // that differs from the last save goes on the editor's clipboard, so it can be pasted back.
  const kept = dcUnsavedBlock();
  try {
    await refreshAll();
    BLOCKS_WORK = currentBlocks(); BLOCK_FOCUS = null; dcResetHistory();
    renderBlocksCard(); renderPagesBar(); refreshDesignPreview();
    if (kept) { dcClipSet(kept); toast("Loaded the latest version. Your unsaved section is on the clipboard — paste it back from the Add button."); }
    else toast("Loaded the latest version." + (kept ? " Your unsaved edit was set aside." : ""));
  } catch (e2) { toast(nice(e2), true); }
}
// the first section on the page whose words differ from the last saved list (a deep copy, never locked)
function dcUnsavedBlock() {
  try {
    if (typeof blocksDirty !== "function" || !blocksDirty()) return null;
    const last = JSON.parse(DC_HIST_LAST) || [], cur = BLOCKS_WORK || [];
    const i = cur.findIndex((b, k) => b && JSON.stringify(b) !== JSON.stringify(last[k]));
    if (i < 0) return null;
    const copy = JSON.parse(JSON.stringify(cur[i])); delete copy._clEdit; delete copy.lock;
    return copy;
  } catch (_) { return null; }
}
function toastAction(msg, label, fn, ms) {
  return window.ddsToast(msg, "ok", { label, onClick: fn, ms: ms || 20000 });
}
/* ══ Rich-text writing toolbar ═══════════════════════════════════════════════
   Owner need: "normal website writing tools" on the long-form fields — Heading,
   Subheading, Bold, Italic, Link, lists, Quote — easy and intuitive. The buttons
   WRITE plain markdown into the field (over the current selection); the published
   renderer (lib/markdown.ts renderMarkdown) turns it into real semantic <h2>/<h3>/
   <a>/<ul>. No markdown knowledge required. Only the prose fields that actually
   render markdown get a toolbar (story · FAQ answers · update bodies); short and
   SEO fields (name, tagline, description, item text) stay plain. */
function rtFire(ta) { ta.dispatchEvent(new Event("input", { bubbles: true })); ta.focus(); }
// wrap the selection (or a placeholder) with inline markers — Bold / Italic
function rtWrap(ta, mark, placeholder) {
  const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
  const sel = v.slice(s, e) || placeholder;
  ta.value = v.slice(0, s) + mark + sel + mark + v.slice(e);
  ta.setSelectionRange(s + mark.length, s + mark.length + sel.length);
  rtFire(ta);
}
// add/remove a line-level marker across every line the selection touches —
// Heading / Subheading / Bullets / Numbers / Quote (toggles off if already set)
function rtLine(ta, prefix, numbered) {
  const v = ta.value, s = ta.selectionStart, e = ta.selectionEnd;
  const ls = v.lastIndexOf("\n", s - 1) + 1;
  let le = v.indexOf("\n", e); if (le === -1) le = v.length;
  const lines = v.slice(ls, le).split("\n");
  const bare = (ln) => ln.replace(/^(#{1,6}\s|>\s?|[-*]\s|\d+\.\s)/, "");
  const already = lines.every((ln) => numbered ? /^\d+\.\s/.test(ln) : ln.startsWith(prefix));
  let n = 0;
  const out = lines.map((ln) => already ? bare(ln) : (numbered ? (++n) + ". " : prefix) + bare(ln)).join("\n");
  ta.value = v.slice(0, ls) + out + v.slice(le);
  ta.setSelectionRange(ls, ls + out.length);
  rtFire(ta);
}
// Link: ask for the URL via the styled dialog, insert [text](url)
async function rtLink(ta) {
  const s = ta.selectionStart, e = ta.selectionEnd, v = ta.value;
  const sel = v.slice(s, e);
  const url = await askText("Add a link", { hint: "Where should this link go?", placeholder: "https://…", ok: "Add link" });
  if (!url) { ta.focus(); return; }
  // Make links "just work": a bare domain gets https:// so the renderer accepts it
  // (published links must be https / mailto: / tel: — anything else renders as text).
  let u = url.trim();
  if (u && !/^[a-z][a-z0-9+.-]*:/i.test(u)) u = "https://" + u;
  const text = sel || u;
  const md = "[" + text + "](" + u + ")";
  ta.value = v.slice(0, s) + md + v.slice(e);
  ta.setSelectionRange(s + 1, s + 1 + text.length);
  rtFire(ta);
}
const RT_BUTTONS = [
  { html: '<span class="b">H2</span>', label: "Heading", run: (ta) => rtLine(ta, "## ") },
  { html: '<span class="b">H3</span>', label: "Subheading", run: (ta) => rtLine(ta, "### ") },
  { html: '<span class="b">B</span>', label: "Bold", run: (ta) => rtWrap(ta, "**", "bold text") },
  { html: '<span class="i">I</span>', label: "Italic", run: (ta) => rtWrap(ta, "*", "italic text") },
  { html: "Link", label: "Add a link", run: (ta) => rtLink(ta) },
  { html: "• List", label: "Bullet list", run: (ta) => rtLine(ta, "- ") },
  { html: "1. List", label: "Numbered list", run: (ta) => rtLine(ta, "", true) },
  { html: "&ldquo; Quote", label: "Quote", run: (ta) => rtLine(ta, "> ") },
];
function attachRich(ta) {
  if (!ta || ta.dataset.rich) return; ta.dataset.rich = "1";
  const bar = el("div", "rtbar"); bar.setAttribute("role", "toolbar"); bar.setAttribute("aria-label", "Text formatting");
  RT_BUTTONS.forEach((cfg) => {
    const b = el("button", "rtbtn"); b.type = "button"; b.innerHTML = cfg.html;
    b.setAttribute("aria-label", cfg.label); b.title = cfg.label;
    // mousedown so the textarea keeps its selection; preventDefault stops focus loss
    b.addEventListener("mousedown", (e) => { e.preventDefault(); cfg.run(ta); });
    b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cfg.run(ta); } });
    bar.appendChild(b);
  });
  const hint = el("div", "rthint", "These format your text — headings help readers and screen readers.");
  ta.parentNode.insertBefore(bar, ta);
  ta.parentNode.insertBefore(hint, ta);
}
function enhanceRich(root) {
  (root || document).querySelectorAll('textarea[data-field="story"],textarea[data-k="answer"],textarea[data-k="body_md"]').forEach(attachRich);
}
// Static prose fields exist now (this script is at the end of <body>); dynamic
// editors (FAQ answers, update bodies) are added later, so watch for them too.
enhanceRich(document);
new MutationObserver((muts) => {
  for (const m of muts) for (const node of m.addedNodes) {
    if (node.nodeType !== 1) continue;
    if (node.matches && node.matches('textarea[data-field="story"],textarea[data-k="answer"],textarea[data-k="body_md"]')) attachRich(node);
    if (node.querySelectorAll) enhanceRich(node);
  }
}).observe(document.body, { childList: true, subtree: true });

// Server errors that read like a sentence still show; raw technical junk doesn't.
function nice(e) {
  const m = e && e.message ? String(e.message) : "";
  return /^[A-Z]/.test(m) && m.length < 160 && !/[{}<>]|_|\bsql\b|\bpostgres/i.test(m) ? m : "Something went wrong on our side — please try again.";
}

/* ── API: identical calls to M7 ── */
// G7 provenance, one wording: WHO last moved the draft, in plain words. Used by
// the 409 stale_draft message AND the Page ▾ menu's passive "Last edit" line.
// Item 197 (review finding 38): the studio working inside a client's site is the "operator" kind,
// which read as "someone else on your account", a stranger to the client. Seen from inside a
// client, the owner's own change is their client's.
const lcWho = (lc) => {
  if (!lc) return "someone else";
  if (lc.actor_kind === "staff" || lc.actor_kind === "operator") return "your studio";
  if (lc.actor_kind === "system") return "an automatic update";
  return studioInClient() ? "your client" : "someone else on your account";
};
// The draft version is a hash of the whole draft, so any of these moves it, whether or
// not the server checks that route against it. One at a time, in order: a write that goes
// out while another is on its way names a version that one is about to move, and is
// refused as someone else's change. Behind a write that lands, the next names the version
// that write's answer gave (see the end of apiSend); behind a refused one, the next names
// the same version and hears the same. Everything else stays out of the line, so a slow
// ask (an AI draft) can't hold up a save, and /publish still names the version that was
// reviewed. The server keeps the same list (lib/optimistic_lock.ts).
const DRAFT_WRITE = /^\/(?:settings|identity|location|offerings|testimonials|faqs|posts|pages\/(?:duplicate|from-saved)|media|stock\/import|redirects|site\/template|content-library|dev\/customization|dev\/brand-kit|restore-to-draft)(?:[/?]|$)|^\/reviews\/[^/]+\/|^\/publishes\/checkpoints\/[^/]+\/restore$|^\/writer\/drafts\/[^/]+\/accept$|^\/pages\/deleted\/[^/]+\/restore$/;
let DRAFT_LINE = Promise.resolve(), DRAFT_WRITES_OUT = 0;
const SAVE_LIMIT_MS = 20000;   // builder item 252; window.DDS_SAVE_LIMIT_MS overrides it (tests)
const SAVE_LIMIT_ROUTES = /^\/(?:settings|identity|location|offerings|testimonials|faqs|posts|redirects|dev\/customization)(?:[/?]|$)/;
let WRITES_ANSWERED = 0;   // readChanges: has a write been answered since this read left?
const READS_BY_POST = /^\/preview\/section$/;   // sent by POST for its body, but moves nothing
let DRAFT_SEED = false;    // readChanges: the state was just loaded whole, so take the version with it
let REVIEWED = null;       // the version Publish's review read, which /publish names
// named: the version this write names, when it isn't the one the page holds (/publish
// names the version that was reviewed).
async function api(method, route, body, named) {
  const undoRec = undoPlan(method, route, body);   // reads the state BEFORE this write
  // Builder item 250: honest about THIS change: it isn't saved, and it goes when the connection
  // returns (retryFailedSaves runs on `online`)
  if (!navigator.onLine) { const e = new Error("This change isn’t saved yet. We’ll send it when you’re back online."); e.offline = true; throw e; }
  const send = () => apiSend(method, route, body, undoRec, named);
  if (method === "GET" || !DRAFT_WRITE.test(route)) return send();
  DRAFT_WRITES_OUT++;
  const turn = DRAFT_LINE.then(send).finally(() => { DRAFT_WRITES_OUT--; });
  DRAFT_LINE = turn.catch(() => {});
  return turn;
}
async function apiSend(method, route, body, undoRec, named) {
  const { data } = await sb.auth.getSession();
  const jwt = data?.session?.access_token;
  // Builder item 271: a sign-in that lapsed mid-edit used to swap the editor for "Please sign in",
  // with the unsaved work out of reach. The page stays as it is; a card over it asks for the
  // sign-in, and what was waiting goes out once it's back (signInLapsed).
  if (!jwt) { signInLapsed(); const e = new Error("Your sign-in ran out. Sign in again and your changes will be sent."); e.noSession = true; throw e; }
  // M9 optimistic locking: echo the draft version (M3 hash) on writes so a stale
  // edit is refused, never silently overwriting a newer one. One place → every
  // save is protected consistently, no duplicated logic.
  // Item 82: a live section draw is a read that goes by POST; counted as a write, it made an
  // overlapping changes read (the publish review's too) throw itself away and repeat, and
  // cleared the "last edit by someone else" line.
  const mut = method !== "GET" && !READS_BY_POST.test(route);
  const version = named !== undefined ? named : S.draftHash;
  // Builder item 252: a save that stalls on a weak connection held up every save behind it
  // with no time limit (the browser ends a dead request after minutes). A quick save gets
  // about 20 seconds, then it's failed and the retry from item 250 takes over. Only the
  // quick writes: a publish, a restore or a photo upload can honestly take longer. A timed-out
  // save may still have landed: the next write then hears "stale draft" and offers Load the latest.
  const timed = mut && SAVE_LIMIT_ROUTES.test(route) && typeof AbortController === "function" ? new AbortController() : null;
  const limitT = timed ? setTimeout(() => timed.abort(), Number(window.DDS_SAVE_LIMIT_MS) || SAVE_LIMIT_MS) : null;
  const r = await fetch(FN + route, {
    method,
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ENV.anon, "x-dds-user-jwt": jwt, "x-dds-scope-site": (new URLSearchParams(location.search).get('client')||''),
      ...REGION_HEADER, ...(mut && version ? { "If-Match": version } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    ...(timed ? { signal: timed.signal } : {}),
  }).catch((err) => {
    if (timed && timed.signal.aborted) { const e = new Error("That save took too long, so it was stopped. Nothing was lost — it’ll be tried again."); e.timeout = true; throw e; }
    throw err;
  }).finally(() => { clearTimeout(limitT); if (mut) WRITES_ANSWERED++; });
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  if (!r.ok) {
    if (r.status === 409 && j && j.error === "stale_draft") {
      // someone else (or another tab) changed this site — say WHO when the server
      // knows (G7: the newest provenance event rides the 409), and let the user
      // load the latest; never overwrite the newer edit. The version it names isn't held
      // yet: nothing on this page has loaded that change, and a write waiting behind this
      // one was built without it, so it has to hear the same.
      scheduleChangesRefresh();
      const lc = j.last_change || null;
      // slice B: keep the newest provenance we've seen — the Page ▾ menu shows it
      // as a passive "Last edit" line (display only; the guard stays automatic).
      if (lc) S.lastChange = lc;
      const who = lcWho(lc);
      const e = new Error("This site was changed by " + who + " while you had it open — nothing was overwritten. Load the latest, then reapply your change.");
      e.status = 409; e.stale = true; e.lastChange = lc; e.who = who;
      if (DRAFT_WRITE.test(route)) offerLoadLatest(e.message);   // Publish has its own Try again, which reads the review afresh
      throw e;
    }
    const e = new Error((j && j.message) || "Nothing was lost — that just didn’t go through. Try once more."); e.status = r.status; e.body = j; throw e;
  }
  // A write that moves the draft leaves it at a new version, and its answer says which:
  // the next write names that one. Waiting for a /changes read instead let in anyone
  // else's change from that second, which nothing here had loaded. An answer that doesn't
  // say (a route the server doesn't check, or a server from before it said) leaves the
  // version unknown until readChanges finds it. A write that doesn't move the draft leaves
  // the version alone. The stashed 409 provenance is stale too: OUR write is now the
  // newest edit, so the "Last edit" line must not keep attributing the draft to someone else.
  if (mut) {
    const left = r.headers.get("X-Draft-Version");
    if (left) { S.draftHash = left; DRAFT_SEED = false; }
    else if (DRAFT_WRITE.test(route)) S.draftHash = null;
    S.lastChange = null;
  }
  if (undoRec) undoCommit(undoRec, j);
  // G13: every /settings read/save carries the server-computed section_meta
  // sidecar ({sid,key,src_index} per stored block, home + pages) — the ONE
  // writer of S.sectionMeta, so the canvas' sid→index join is always the
  // server's own validate-time truth, never a client recomputation.
  if (route === "/settings" && j && j.data && j.data.section_meta) { S.sectionMeta = j.data.section_meta; ddsRebuildSidMap(); }
  return j;
}
// One write to the stored settings at a time, in order. A write carries whole columns,
// so two at once are each built from an S.settings the other hasn't reached: the later
// undoes the earlier on the server, or is refused for naming a draft version the earlier
// one moved, which reads as someone else's change. So S.settings is read inside the turn:
// fn starts once the last write has landed, and the next waits until fn is done with its
// answer. Nothing inside a turn may wait on a later one (no dcSavePendingEdits).
let SETTINGS_WRITES = Promise.resolve(), SETTINGS_TURNS = 0;
function settingsTurn(fn) {
  SETTINGS_TURNS++;
  const turn = SETTINGS_WRITES.then(fn).finally(() => { SETTINGS_TURNS--; });
  SETTINGS_WRITES = turn.catch(() => {});
  return turn;
}
// The body, or a function that builds it when the turn comes (nothing back = no write).
// landed runs before the next turn, for anything the next write builds on.
function settingsPut(build, landed) {
  return settingsTurn(async () => {
    const body = typeof build === "function" ? build() : build;
    if (!body) return null;
    const r = await api("PUT", "/settings", body);
    S.settings = r.data || { ...S.settings, ...body };
    if (landed) landed();
    return r;
  });
}
async function apiHtml(route) {
  const { data } = await sb.auth.getSession();
  const jwt = data?.session?.access_token;
  const r = await fetch(FN + route, { headers: { "Authorization": "Bearer " + ENV.anon, "x-dds-user-jwt": jwt, "x-dds-scope-site": (new URLSearchParams(location.search).get('client')||''), ...REGION_HEADER } });
  const text = await r.text();
  if (!r.ok) { let j = null; try { j = JSON.parse(text); } catch {} const e = new Error((j && j.message) || "We couldn’t load that page just now."); e.status = r.status; throw e; }
  // A 200 that is not a page (a JSON envelope, an empty body) must never land
  // in a srcdoc as raw text — every caller shows its own "couldn't draw" line
  // instead (experience review #13).
  const type = String(r.headers.get("content-type") || "").toLowerCase();
  const looksHtml = /^\s*<(!doctype|html|head|body|div|section|main|header|nav|p|span|svg)/i.test(text);
  if (!looksHtml && !type.includes("text/html")) { const e = new Error("We couldn’t load that page just now."); e.status = r.status; e.notHtml = true; throw e; }
  return text;
}

/* ── state ── */
const S = { site: null, identity: null, location: null, settings: null,
  offerings: [], faqs: [], testimonials: [], posts: [], media: [],
  changes: null, health: null, publishes: [], restoreTarget: null, pendingFile: null,
  draftHash: null /* M9: current M3 draft version, sent as If-Match on writes */ };
const DAYS = [["mon","Monday"],["tue","Tuesday"],["wed","Wednesday"],["thu","Thursday"],["fri","Friday"],["sat","Saturday"],["sun","Sunday"]];
const changedIds = () => new Set((S.changes?.changes || []).map((c) => c.entity_id).filter(Boolean));

// Builder item 271: the sign-in lapsed while editing (a laptop asleep for hours, a sign-out in
// another tab). The page is kept exactly as it is; this card asks for the sign-in in a new tab
// and sends what was waiting once it's back. The stub sign-in (tests) never fires a change
// event, so the card's own button checks too.
let LAPSE_DLG = null;
function signInLapsed() {
  if (LAPSE_DLG && LAPSE_DLG.isConnected && LAPSE_DLG.open) return;
  const d = document.createElement("dialog"); d.className = "dds-dlg ask-yes"; d.id = "lapseDlg";
  d.innerHTML = `<form method="dialog"><div class="ask-msg"><h2 class="dlg-t" id="lapseTitle">Your sign-in ran out</h2><p class="dlg-d">Your page is kept exactly as it is, and nothing here is lost. Sign in again in a new tab, then come back: whatever was waiting to save goes out by itself.</p></div><div class="dlg-row"><button type="button" class="ask-cancel" id="lapseRetry">I’m signed in again</button><a class="ask-ok" id="lapseGo" href="/studio.html" target="_blank" rel="noopener">Sign in</a></div></form>`;
  d.setAttribute("aria-labelledby", "lapseTitle");
  d.querySelector("form").addEventListener("submit", (e) => e.preventDefault());
  d.querySelector("#lapseRetry").addEventListener("click", async () => {
    const { data } = await sb.auth.getSession();
    if (data && data.session) { signedInAgain(); return; }
    toast("Not signed in yet — sign in in the other tab, then press this again.", true);
  });
  document.body.appendChild(d); LAPSE_DLG = d;
  try { d.showModal(); } catch (_) { d.setAttribute("open", ""); }
}
function signedInAgain() {
  if (LAPSE_DLG) { try { LAPSE_DLG.close(); } catch (_) {} LAPSE_DLG.remove(); LAPSE_DLG = null; }
  toast("Signed in — sending what was waiting.");
  retryFailedSaves();
}
try { sb.auth.onAuthStateChange((_evt, session) => { if (session && session.access_token && LAPSE_DLG && LAPSE_DLG.open) signedInAgain(); }); } catch (_) {}
// Builder item 250: what failed to save is sent again — when the connection returns, when the
// sign-in is back, or when the "Not saved · Try again" line is pressed. Each kind of save keeps
// its own "still waiting" state, so this only has to ask each to go now.
function retryFailedSaves() {
  if (!navigator.onLine) { toast("Still offline — it’ll go when the connection returns.", true); return; }
  debounceFlush("");   // business details (a failed one is put back in the waiting list)
  if (typeof blocksDirty === "function" && blocksDirty() && !BLOCKS_SAVING) blocksSaveNow();
  SAVE_PARTS.forEach((h) => { try { if (h.pending()) h.retry(); } catch (_) {} });   // the forms card, and any part with saves of its own
  const bs = window.DDSBlogStudio && window.DDSBlogStudio.current && window.DDSBlogStudio.current();
  if (bs && bs.retry) bs.retry();
}
window.addEventListener("online", () => setTimeout(retryFailedSaves, 400));

/* ── gate ── */
function showGate(title, msg, showBtn, retry) {
  $("app").hidden = true; $("dock").style.display = "none";
  $("gate").hidden = false;
  // A signed-in owner whose page could not load gets Try again (a reload in
  // place) — never the sign-in door they are already through (experience review #41).
  const b0 = $("gateBtn");
  if (retry) { b0.href = location.href; b0.textContent = "Try again"; b0.onclick = (e) => { e.preventDefault(); location.reload(); }; }
  else { b0.href = "/studio.html"; b0.textContent = "Go to your account"; b0.onclick = null; }
  // A client reviewer who wandered in has their OWN page — honest title, and
  // send them there, never to the owner door.
  const forReviewer = /client view|shares with you/i.test(String(msg || ""));
  $("gateTitle").textContent = forReviewer ? "This is the studio's workspace" : title;
  $("gateMsg").textContent = msg;
  const b = $("gateBtn");
  b.hidden = !showBtn;
  if (forReviewer) { b.href = "/client.html"; b.textContent = "Go to your view"; }
}

/* ── navigation ── */
let EDIT_RETURN = "today";   // where Exit goes: the view you came to Edit mode from
// The Overview is the site: the title row steps aside and its buttons join the
// stage's one bar. They're the same buttons, so every other way to them still works.
function syncSiteHome(view) {
  document.documentElement.classList.toggle("site-home", view === "today");
  const acts = $("topActions"), bar = view === "today" ? $("ssBar") : document.querySelector(".topbar");
  if (acts && bar && acts.parentElement !== bar) bar.appendChild(acts);
}
function go(view, early) {
  // builder item 220: a Designer never opens a business tab, even from its address or a link
  if (isBusinessTab(view) && window.ddsLacks && window.ddsLacks("business")) view = "today";
  const stays = $("view-" + view) && $("view-" + view).classList.contains("on");
  // builder item 319: the publish card never stays over the next page opened from the sidebar
  if (!stays && $("ritualWrap") && $("ritualWrap").classList.contains("on") && typeof closeRitual === "function") closeRitual();
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("on"));
  const target = $("view-" + view); if (!target) return;
  target.classList.add("on");
  if (view !== "design") EDIT_RETURN = view;
  syncSiteHome(view);
  document.documentElement.classList.toggle("dc-edit", view === "design");
  // item 38: Edit mode is its own part (presence-edit.js); its bar is brought up once that part is in
  if (view === "design") ddsWith("edit", () => { if ($("view-design").classList.contains("on")) { pagesBarReveal(); dcSyncPageSwitch(); dcSyncLiveChip(); } });
  // Design is the builder — let it use the FULL width (canvas stretches right); every
  // other view keeps the comfortable reading measure.
  const contentEl = document.querySelector(".content");
  if (contentEl) contentEl.classList.toggle("design-wide", view === "design");
  document.querySelectorAll("#nav .navitem").forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    // on a phone the strip scrolls: keep the tab you're on in sight
    if (on) { const f = b.closest(".nav-fold"); if (f) { f.classList.add("open"); f.firstChild.setAttribute("aria-expanded", "true"); } }
  });
  document.querySelectorAll("#dock button").forEach((b) => { const on = b.dataset.tab === view || (b.dataset.tab === "sections" && view !== "today"); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
  window.scrollTo({ top: 0 });
  if (early) return;   // the pre-data switch: the view is on screen, its loaders run on the real route below
  // Item 84: a tab's own extras are read the first time it opens, never at start-up.
  if (view === "today") { loadToday(); }
  if (view === "pages") { hbLoadBoardExtras("pages"); renderPagesList(); renderRecent(); }
  closeTodoPanel();
  if (view === "history") { loadHistory(); hbLoadBoardExtras("history"); }
  if (view === "media") { loadMedia(); if (!TAB_ASKED.knowledge) { TAB_ASKED.knowledge = true; renderKnowledgeDocs(); } }
  if (view === "bookings") loadBookings();
  if (view === "reviews") loadReviews();
  if (view === "search") { loadSearch(); hbLoadBoardExtras("search"); mountSearchCard(); }
  if (view === "business" && !TAB_ASKED.monitor) { TAB_ASKED.monitor = true; renderMonitorCard(); }
  // CP-2.5: the live proof warms on entry. Item 85: already on a drawn canvas (a section's
  // Edit, its cog, a double-click on a picture) nothing has changed, so nothing is drawn
  // again; that full redraw 350 ms later also left sections below a new one resolving one
  // index off. A canvas never drawn yet (a link that opens straight on it) still is.
  // Item 38: both once Edit mode's part is in, and only if Edit mode is still the tab.
  if (view === "design") { const fresh = !stays || !DC_DRAWN; ddsWith("edit", () => { if (!$("view-design").classList.contains("on")) return; mountEditCards(); if (fresh) refreshDesignPreview(); }); }
  contextHint(view);   // PT-2C: teach in context, once
  // CP-2.6: the URL mirrors the tab — shareable, palette-routable, back-button-safe
  try { history.replaceState(null, "", "#" + view); } catch (_) {}
}
// PT-2C: one-time contextual education per surface (reuses the shell hint system).
const VIEW_HINTS = {
  design: ["edit-doubleclick", "Double-click the words in a section to change them. Everything saves itself, and nothing goes live until you publish."],
  media: ["media-inuse", "Photos marked “on your site” are in use; the rest wait here until you place them."],
  search: ["search-plain", "How people find you on Google, what to fix first, and Search Console. Each page’s own Google settings are on the Pages tab."],
};
const TOUCH_DESIGN_HINT = ["edit-tap", "Tap a section to select it, then tap its words to change them. Everything saves itself, and nothing goes live until you publish."];
let HINT_SHOWN = false;   // one tip per visit: three in a row is a lecture
function contextHint(view) {
  // A tip explains the view it opened on, so leaving that view retires it. It was
  // staying up over the next tab, on top of whatever sat at the bottom of the page.
  // A tip gets its "show" one frame after it's added; leaving inside that frame missed
  // it, and it came up over the next view (main's tablet run, Nov 8). One not yet
  // shown just goes, unseen, so it can teach another visit.
  document.querySelectorAll(".dds-hint.dds-live").forEach((h) => {
    if (!h.classList.contains("show")) { h.remove(); return; }
    const x = h.querySelector(".x"); if (x) x.click();
  });
  // A finger can't double-click: on a touch screen the editor's tip says to tap (list item 31).
  const fingers = (() => { try { return matchMedia("(hover: none), (pointer: coarse)").matches; } catch (_) { return false; } })();
  const h = view === "design" && fingers ? TOUCH_DESIGN_HINT : VIEW_HINTS[view];
  if (!h || !window.ddsHint || HINT_SHOWN) return;
  if (view === "design" && S.site && S.site.edition === "monitor") return;   // nothing to pick on a watch plan
  setTimeout(() => {
    const on = $("view-" + view);
    if (HINT_SHOWN || !on || !on.classList.contains("on")) return;
    if (window.ddsHint(h[0], h[1])) HINT_SHOWN = true;
  }, 400);
}
// ── CP-2.6: hash deep-links — the shell palette + nav route straight to tabs ──
const HASH_VIEWS = { today: "today", pages: "pages", business: "business", settings: "business", search: "search", offerings: "offerings", content: "offerings", services: "offerings", menu: "offerings", faqs: "faqs", testimonials: "testimonials", updates: "updates", media: "media", photos: "media", bookings: "bookings", appointments: "bookings", reviews: "reviews", reputation: "reviews", design: "design", history: "history", versions: "history" };
// Oct 2026 review: the FIRST paint honours the hash. boot() used to await the
// whole refreshAll() read wave before routeHash(), so a #settings / #business /
// #design link sat on the Today view's "Setting the table…" loadline for as
// long as the slowest read took — a stuck-looking page that the second (warm)
// load merely hid. The early pass only switches the visible view (go(v, true):
// no loaders, no hint, no URL write); the full routeHash() after the data
// wave runs the loaders and the data-dependent hashes (#monitor, #publish…).
function routeHashEarly() {
  const h = (location.hash || "").replace("#", "").toLowerCase() || String(new URLSearchParams(location.search).get("view") || "").toLowerCase();
  const v = HASH_VIEWS[h] || (h && $("view-" + h) ? h : "");
  if (v && v !== "today" && $("view-" + v)) go(v, true);
}
function routeHash() {
  const h = (location.hash || "").replace("#", "").toLowerCase();
  if (!h) return;
  if (h === "publish") { openRitual(); return; }
  if (h === "schedule") { openRitual({ schedule: true }); return; }   // the one place to schedule (schedule.html retired)
  if (h === "domain") { openFoundationsDesk({ domain: true }); return; }   // nav "Domain & email" → straight to "type your domain"
  if (h === "addpage") { go("design"); setTimeout(() => dcAddPage(), 300); return; }   // nav "Add a page"
  if (h === "health") { go("search"); setTimeout(() => hbScrollTo("healthCard"), 200); return; }     // website-health.html retired
  if (h === "pages") { go("pages"); return; }                   // content-tree.html retired
  if (h === "activity") { go("history"); setTimeout(() => hbScrollTo("activitySec"), 200); return; }  // timeline.html retired
  if (h === "preview") { openPreview("draft"); return; }
  if (h === "plan") { if (hasFeature("business_moments")) openCoachDesk(); return; }   // builder list item 184: a coach idea on the client's Do next list
  if (h === "foundations" || h === "export") { openFoundationsDesk(); return; }   // deep-link the technical desk (approvals + "Download everything I own" live here)
  // #monitor — the analytics "Add their website address" CTA (routes/analytics.ts
  // record_href). The card lives far down the Business view; without the scroll,
  // the link lands on a screen where the affordance it promised isn't in sight.
  if (h === "monitor") {
    go("business");
    setTimeout(() => {
      const m = $("monitorCard");
      if (m && !m.hidden) { m.scrollIntoView({ behavior: "smooth", block: "center" }); }
    }, 350);   // after boot's renderMonitorCard has decided visibility
    return;
  }
  const v = HASH_VIEWS[h];
  if (v && $("view-" + v)) go(v);
}
window.addEventListener("hashchange", routeHash);
$("dock").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.tab === "today") go("today");
  else if (b.dataset.tab === "preview") openPreview("draft");
  else if (b.dataset.tab === "publish") openRitual();
  else if (b.dataset.tab === "waiting") openWaitNote();   // builder item 220
  else openSheet("sectionsScrim");
});
// One set of tabs. The phone's Sections sheet used to list different places from
// the desktop strip, so Menu, Questions and Updates were missing on a desktop and
// Bookings and Reviews on a phone.
// One menu, grouped by job, the way Squarespace groups its Website menu. On a
// desktop it is drawn INTO the shell's sidebar under Website (mountSiteNav); on a
// phone it is the Sections sheet. Styles opens Edit mode on its Styles panel.
const SITE_MENU = [
  [null, [["today", "Overview"], ["pages", "Pages"], ["styles", "Styles"], ["media", "Files"], ["search", "Search"]]],
  ["Content", [["offerings", "Menu"], ["faqs", "Questions"], ["testimonials", "Testimonials"], ["updates", "Blog"]]],
  [null, [["bookings", "Bookings"], ["reviews", "Reviews"], ["analytics", "Analytics"]]],
  ["Site settings", [["business", "Business details"], ["domain", "Domain & email"], ["history", "Versions"], ["connections", "Connections"], ["sharing", "Sharing & access"], ["clientview", "See the client’s view"]]],
];
const SITE_TABS = SITE_MENU.flatMap((g) => g[1]);
// builder item 220: the note a Designer's pill opens: their work is saved, and who puts it live
let WAIT_FROM = null;
function openWaitNote() {
  const n = $("waitNote"); if (!n) return;
  const role = (S.ctx && S.ctx.my_role && S.ctx.my_role.name) || "";
  $("waitNoteP").textContent = (role ? "As a " + role + " here, the owner or the studio puts them live. " : "The owner or the studio puts them live. ") + "Nothing you change shows on the live site until then. Preview shows exactly what they will publish.";
  WAIT_FROM = document.activeElement; n.hidden = false; $("waitNoteOk").focus();
}
function closeWaitNote() {
  const n = $("waitNote"); if (!n || n.hidden) return;
  n.hidden = true; if (WAIT_FROM && WAIT_FROM.isConnected && WAIT_FROM.focus) WAIT_FROM.focus();
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeWaitNote(); });
document.addEventListener("click", (e) => { const n = $("waitNote"); if (n && !n.hidden && !n.contains(e.target) && !(e.target.closest && e.target.closest("#btnWaitPub, #dcBtnWait, #dockWait"))) closeWaitNote(); });
// builder item 220: the tabs about the business, not the website: a Designer never sees them
// (a function, so go() can ask it however early it runs)
function isBusinessTab(view) { return ["search", "bookings", "reviews", "analytics", "domain", "connections", "clientview"].includes(view); }
// Keeps a studio drilled into a client inside that client on the way out of this page.
function withClient(path) {
  const c = new URLSearchParams(location.search).get("client");
  if (!c) return path;
  const [base, hash] = path.split("#");
  return base + (base.indexOf("?") >= 0 ? "&" : "?") + "client=" + encodeURIComponent(c) + (hash ? "#" + hash : "");
}
// Analytics is one page rather than a second copy of the same charts here: it opens
// on its website view, without the sales band a site tab has no business showing.
function openSiteTab(view) {
  if (view === "domain") openFoundationsDesk();
  else if (view === "analytics") location.href = withClient("/analytics.html?view=website");
  else if (view === "connections") location.href = withClient("/connections.html");
  else if (view === "sharing") location.href = withClient("/sharing.html");
  else if (view === "clientview") location.href = withClient("/client.html");
  else if (view === "styles") { go("design"); setTimeout(() => { if (typeof openSettingsPanel === "function") openSettingsPanel("styles"); }, 60); }
  else go(view);
}
function gateSiteMenu() {
  document.querySelectorAll('.navitem[data-link="connections"]').forEach((n) => { n.hidden = !hasFeature("connected"); });   // Business-OS
  document.querySelectorAll('.navitem[data-link="analytics"]').forEach((n) => { n.hidden = !hasFeature("reports"); });
}
function buildSiteTabs() {
  let nav = $("nav");
  if (!nav) { nav = el("nav", "hb-tabs"); nav.id = "nav"; nav.setAttribute("aria-label", "Website sections"); }
  nav.textContent = "";
  const sheet = $("sectionsNav"); if (sheet) sheet.textContent = "";
  const cur = document.querySelector(".view.on"); const curView = cur ? cur.id.replace("view-", "") : "today";
  const item = ([view, label]) => {
    const b = el("button", "navitem", label); b.type = "button";
    // builder item 220: the business's places leave a Designer's menu (shell.js names the lack)
    if (isBusinessTab(view)) b.dataset.needs = "business";
    if (view === "domain") b.title = "Your domain, DNS records, email and the padlock — connect a custom domain here";
    else if (view === "analytics") { b.dataset.link = "analytics"; b.title = "Visitors, where they come from and your busiest pages"; }
    else if (view === "styles") { b.dataset.link = "styles"; b.title = "Colors, fonts, corners and your template"; }
    else if (view === "connections") { b.dataset.link = "connections"; b.title = "The services connected to your site"; }
    else if (view === "sharing") { b.dataset.link = "sharing"; b.dataset.needs = "owner"; b.title = "Who can sign in, and what clients can see"; }
    else if (view === "clientview") { b.dataset.link = "clientview"; b.title = "See what your client sees when they sign in"; }
    else b.dataset.view = view;   // applyVocab keeps the offerings label (Menu/Services) in sync through this
    return b;
  };
  SITE_MENU.forEach(([group, items]) => {
    // a named group folds in the sidebar, and opens on its own when you're in it
    let host = nav;
    if (group) {
      const fold = el("div", "nav-fold"); fold.dataset.grp = group;
      const head = el("button", "grp", group); head.type = "button"; head.setAttribute("aria-expanded", "false");
      head.addEventListener("click", () => { const open = fold.classList.toggle("open"); head.setAttribute("aria-expanded", String(open)); });
      fold.appendChild(head); nav.appendChild(fold); host = fold;
      if (sheet) { const g = el("div", "grp", group); g.dataset.grp = group; sheet.appendChild(g); }
    }
    items.forEach((t) => {
      const tab = item(t);
      if (t[0] === curView) { tab.classList.add("on"); tab.setAttribute("aria-current", "page"); }
      tab.addEventListener("click", () => openSiteTab(t[0]));
      host.appendChild(tab);
      if (t[0] === curView && group) { host.classList.add("open"); host.firstChild.setAttribute("aria-expanded", "true"); }
      if (!sheet) return;
      const row = item(t); row.style.padding = "10px 0"; row.style.fontSize = "15px";
      row.addEventListener("click", () => { closeSheet("sectionsScrim"); openSiteTab(t[0]); });
      sheet.appendChild(row);
    });
  });
  if (sheet) {
    const edit = el("button", "navitem", "Edit site"); edit.type = "button"; edit.style.padding = "10px 0"; edit.style.fontSize = "15px"; edit.style.fontWeight = "600";
    edit.addEventListener("click", () => { closeSheet("sectionsScrim"); go("design"); });
    sheet.insertBefore(edit, sheet.firstChild);
  }
  // a rebuild after the shell redraws keeps the site's word for it (Menu/Services);
  // on the first build VOCAB isn't initialized yet, and applyVocab sets it at boot
  try { nav.querySelectorAll('.navitem[data-view="offerings"]').forEach((n) => { n.textContent = VOCAB.label; }); } catch (_) {}
  return nav;
}
buildSiteTabs();
syncSiteHome("today");   // the page opens on the Overview; a deep link moves it on from here
// The menu lives in the shell's sidebar, under Website, as the sidebar's own inline
// list (the same idiom Customers uses). The strip under the title is the fallback
// when there is no sidebar to join. The shell redraws itself on context changes,
// which drops the list, so a redraw puts it back.
function mountSiteNav() {
  const shell = document.getElementById("dds-shell"); if (!shell) return false;
  const it = shell.querySelector('.dds-nav .sec > .it[data-href="/presence.html"]'); if (!it) return false;
  const sec = it.parentElement;
  let nav = $("nav");
  if (nav && nav.parentElement === sec) return true;
  if (!nav || !document.contains(nav)) nav = buildSiteTabs();
  nav.className = "menu site-menu";
  sec.classList.add("open", "has-site-menu");
  it.insertAdjacentElement("afterend", nav);
  // Website itself is the Overview, so it doesn't reload the page you're on
  it.addEventListener("click", (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); go("today"); });
  // A place the sidebar already lists once isn't listed twice
  const listed = (href) => !!shell.querySelector('.dds-nav .sec > a.it[data-href="' + href + '"]');
  nav.querySelectorAll('.navitem[data-view="media"]').forEach((n) => n.classList.toggle("dup", listed("/files.html")));
  nav.querySelectorAll('.navitem[data-link="analytics"]').forEach((n) => n.classList.toggle("dup", listed("/analytics.html")));
  return true;
}
(function watchShellForSiteNav() {
  // the shell draws after its context loads, and redraws when that changes
  const obs = new MutationObserver(() => { const n = $("nav"); if (!n || !n.classList.contains("site-menu") || !document.contains(n)) mountSiteNav(); });
  const startOn = (sh) => { obs.observe(sh, { childList: true }); mountSiteNav(); };
  const sh0 = document.getElementById("dds-shell");
  if (sh0) { startOn(sh0); return; }
  const wait = new MutationObserver(() => { const sh = document.getElementById("dds-shell"); if (sh) { wait.disconnect(); startOn(sh); } });
  wait.observe(document.documentElement, { childList: true, subtree: true });
})();

/* ── sheets (focus returns to where you were — keyboard users never get lost) ── */
let lastFocus = null;
function openSheet(id) {
  lastFocus = document.activeElement;
  const s = $(id); s.classList.add("on");
  const first = s.querySelector("button, input, textarea, [href]");
  if (first) first.focus();
}
function closeSheet(id) {
  $(id).classList.remove("on");
  if (id === "pickerScrim") pickerCb = null;   // a closed picker is never armed — no stale pick can land later (callers snapshot the cb first)
  if (lastFocus && lastFocus.focus) { lastFocus.focus(); lastFocus = null; }
}
document.querySelectorAll(".scrim").forEach((s) => {
  s.addEventListener("click", (e) => { if (e.target === s || e.target.closest("[data-close]")) closeSheet(s.id); });
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.querySelector("dialog[open]")) return;   // a question or card on top answers its own Escape (item 158: the phone code over Preview)
  document.querySelectorAll(".scrim.on").forEach((s) => closeSheet(s.id));
  document.querySelectorAll(".editor").forEach((n) => n.remove()); // Esc closes inline editors, untouched
  if ($("stage").classList.contains("on")) closePreview();
  if ($("ritualWrap").classList.contains("on")) closeRitual();
});

/* ── whispers & autosave (identical PUTs) ── */
const debounces = {}, debounceFns = {};
function debounce(key, fn, ms) { clearTimeout(debounces[key]); debounceFns[key] = fn; debounces[key] = setTimeout(() => { delete debounceFns[key]; fn(); }, ms); }
// Run now whatever is waiting under keys that start with this, and wait for it to finish.
function debounceFlush(prefix) {
  return Promise.all(Object.keys(debounceFns).filter((k) => k.startsWith(prefix)).map((k) => {
    clearTimeout(debounces[k]); const fn = debounceFns[k]; delete debounceFns[k];
    return Promise.resolve().then(fn).catch(() => {});
  }));
}
// Item 78: the hours and the closed note wait 0.6s before saving too, so they count.
const detailsPending = () => Object.keys(debounceFns).some((k) => /^(identity|location):|^(hours|closednote)$/.test(k));
// An inline editor (a menu item, a question, a testimonial, an update) saves each
// field as you leave it. Done just closes it, once anything pending has landed.
function editorAutosave(ed, read, patch, close) {
  let saved = JSON.stringify(read()), t = null;
  const flush = async () => {
    clearTimeout(t); t = null;
    const body = read(), sig = JSON.stringify(body);
    if (sig === saved) return true;
    whisper("topWhisper", "saving");
    try { await patch(body); saved = sig; whisper("topWhisper", "saved"); scheduleChangesRefresh(); return true; }
    catch (err) { whisper("topWhisper", "failed"); toast(nice(err), true); return false; }
  };
  ed.addEventListener("change", (e) => { if (e.target.matches("[data-k]")) { clearTimeout(t); t = setTimeout(flush, 250); } });
  ed.querySelector('[data-act="save"]').addEventListener("click", async () => { if (await flush()) close(); });
}
// Item 81: "failed" stays until the next save ("Everything saved" after a failure was untrue),
// and "unsaved" says a field holds words its save is still waiting on.
function whisper(id, state) {
  if (id === "topWhisper") whisper("dcWhisper", state);   // Edit mode shows the same one status
  const w = $(id); if (!w) return;
  w.classList.toggle("ok", state === "saved");
  w.classList.toggle("bad", state === "failed");
  w.classList.toggle("idle", !state);   // the resting line can step aside when the bar is short of room
  const idle = id === "topWhisper" || id === "dcWhisper" ? "Everything saved" : "";
  w.textContent = state === "saving" ? "Saving…" : state === "saved" ? "Saved just now" : state === "failed" ? "Not saved · Try again" : state === "unsaved" ? "Unsaved changes" : state || idle;
  // Builder item 250: "Not saved" was plain words with nothing to press. While it's failed, the
  // line is a button that sends the waiting changes again (the same as `online` does).
  if (state === "failed") { w.setAttribute("role", "button"); w.tabIndex = 0; w.title = "Send what didn’t save"; }
  else { w.removeAttribute("role"); w.removeAttribute("tabindex"); w.removeAttribute("title"); }
  if (!w._retry) {
    w._retry = true;
    const go = () => { if (w.classList.contains("bad")) { whisper(id, "saving"); retryFailedSaves(); } };
    w.addEventListener("click", go);
    w.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
  }
  if (state === "saved") setTimeout(() => { if (w.textContent === "Saved just now") { w.textContent = idle; w.classList.remove("ok"); w.classList.add("idle"); } }, 2600);
}
document.querySelectorAll("[data-sing]").forEach((inp) => {
  inp.addEventListener("input", () => {
    const sing = inp.dataset.sing, field = inp.dataset.field;
    const wid = sing === "identity" ? "save-identity" : "save-location";
    whisper(wid, "saving"); whisper("topWhisper", "saving");
    const key = sing + ":" + field;
    const run = async () => {
      try {
        await api("PUT", sing === "identity" ? "/identity" : "/location", { [field]: inp.value });
        S[sing] = { ...(S[sing] || {}), [field]: inp.value };   // the next undo step needs what's saved now
        whisper(wid, "saved"); whisper("topWhisper", "saved");
        scheduleChangesRefresh();
      } catch (err) {
        whisper(wid, ""); whisper("topWhisper", "failed"); toast(nice(err), true);
        // Builder item 250: a failed details save was forgotten, so the close-tab warning stayed
        // quiet and nothing sent it later. It waits again (unless newer typing replaced it) for
        // Try again, `online` or the next flush.
        if (!debounceFns[key]) debounceFns[key] = run;
      }
    };
    debounce(key, run, 700);
  });
});

/* ── item 127: where each detail shows, the short description, a second location ── */
// One sentence under each Business details field says where it shows on the live site.
// Checked against the eight templates: Restaurant Classic shows Where you work on its
// About page only and calls its booking button Reserve a table; the phone bar and the
// footer's hours only count when they're on.
function bizShows() {
  const rc = (S.site && S.site.template_slug) === "restaurant-classic", bar = !!pbNow();
  const footHours = !(S.settings && S.settings.footer_hours === false);   // Edit site's footer switch
  return {
    business_name: "Shows at the top of every page, in the browser tab, in Google results and on the emails you send.",
    tagline: "Shows under your name at the top of your home page.",
    short_description: "What Google, AI assistants and directories quote about you, and the line under your link when someone shares your site. One sentence: what you are, where, and what you’re known for.",
    description: "Shows on your home page and your About page. Google uses it when you have no short description or search description.",
    story: "Shows on your About page.",
    phone: bar ? "Shows in your footer and on your Contact page, on the Call button of the phone bar, and to Google." : "Shows in your footer and on your Contact page, and to Google.",
    email: "Shows in your footer and on your Contact page as an email link.",
    service_area: goesOn() ? (rc ? "Shows where an address would: in your footer, on your Contact page and on your About page. Google is told the places you serve." : "Shows where an address would: at the top of your home page, in your footer, on your Contact page and on your About page. Google is told the places you serve.")
      : rc ? "Shows on your About page." : "Shows at the top of your home page and on your About page, and tells Google the places you serve.",
    booking_url: rc ? "Your home page’s Reserve a table button opens it, and Google is told you take reservations." : "The first button at the top of your home page opens it.",
    ordering_url: "Your home page’s Order online button opens it.",
    address: "Shows in your footer and on your Contact page with a Get directions link. Google uses it for your listing.",
    locphone: "Only if it differs from your main number. It then shows with this address instead.",
    hours: `Shows on your Contact page${footHours ? " and in your footer" : ""}${bar ? ", and behind Hours on the phone bar" : ""}. Google reads them too.`,
  };
}
function paintBizShows() {
  const words = bizShows();
  document.querySelectorAll("#view-business [data-shows]").forEach((n) => { n.textContent = words[n.dataset.shows] || ""; });
  document.querySelectorAll("#view-business .biz-pin").forEach((n) => { if (!n.firstChild) n.innerHTML = uiIcon("pin", 14); });
}
// The share preview: the picture, name and line a link to the home page carries, as the
// templates choose them (the share photo, the hero photo, a menu or service photo, a
// post's cover, the logo).
function bizShareThumb() {
  const st = S.settings || {}, media = S.media || [];
  const ids = [st.og_media_id, st.cover_media_id, ...(S.offerings || []).map((o) => o.media_id), ...(S.posts || []).filter((p) => p.status === "published").map((p) => p.hero_media_id), st.logo_media_id];
  for (const id of ids) { const m = id && media.find((x) => x.id === id); if (m && m.thumb) return m.thumb; }
  return "";
}
function paintBizShort() {
  const box = $("f-short_description"); if (!box) return;
  const val = (id) => { const n = $(id); return n ? String(n.value || "").trim() : ""; };
  $("cnt-short_description").textContent = `${[...box.value].length} of 150`;
  const line = val("f-short_description") || val("f-seo_description") || val("f-description");
  $("bizShareName").textContent = val("f-business_name") || "Your business";
  const d = $("bizShareDesc"); d.textContent = line || "Add a short description and it shows here."; d.classList.toggle("empty", !line);
  $("bizShareHost").textContent = seoHost();
  const thumb = bizShareThumb(), img = $("bizShareImg");
  img.style.backgroundImage = thumb ? `url("${thumb.replace(/["\\]/g, "")}")` : "";
}
["f-short_description", "f-business_name", "f-description"].forEach((id) => { const n = $(id); if (n) n.addEventListener("input", paintBizShort); });

// A second location lives beside the first, in the location row's second_location
// (lib/second_location.ts): a name, an address, a phone, and the main location's hours or
// its own week. It saves whole with each change once it has a street and a city; before
// that it isn't a place yet, and what's stored stays. Removing it is one step back.
let PLACE2 = null;
const place2Ready = (p) => !!(p && String(p.address_line1 || "").trim() && String(p.city || "").trim());
function renderPlace2() {
  const host = $("place2"); if (!host) return;
  const p = PLACE2;
  if (!p) {
    host.innerHTML = `<button type="button" class="biz-add" id="btnPlace2">${uiIcon("plus", 14)} Add a second location</button><div class="hint">For a second shop, kitchen or office. It shows beside your main address.</div>`;
    $("btnPlace2").addEventListener("click", () => {
      PLACE2 = { label: "", address_line1: "", address_line2: "", city: "", region: "", postal_code: "", phone: "", same_hours: true, hours: [] };
      renderPlace2(); $("f2-label").focus();
    });
    return;
  }
  const bar = !!pbNow();
  host.innerHTML = `<p class="biz-place"><span class="biz-pin" aria-hidden="true">${uiIcon("pin", 14)}</span>Second location <span class="biz-new">New</span></p>
<div class="field"><label for="f2-label">A name for this place</label><input type="text" id="f2-label" data-p2="label" maxlength="60" placeholder="e.g. Glendale"><div class="hint">Visitors see it above the address, so they know which place is which.</div></div>
<div class="field"><label for="f2-address_line1">Street address</label><input type="text" id="f2-address_line1" data-p2="address_line1" maxlength="160"><div class="hint">Shows beside your main address in your footer and on your Contact page, with its own Get directions link.</div></div>
<div class="biz-row3">
<div class="field"><label for="f2-city">City</label><input type="text" id="f2-city" data-p2="city" maxlength="80"></div>
<div class="field"><label for="f2-region">State</label><input type="text" id="f2-region" data-p2="region" maxlength="40"></div>
<div class="field"><label for="f2-postal_code">ZIP</label><input type="text" class="mono" id="f2-postal_code" data-p2="postal_code" maxlength="16"></div>
</div>
<div class="field"><label for="f2-phone">Phone at this place</label><input type="tel" class="mono" id="f2-phone" data-p2="phone" maxlength="32"><div class="hint">${bar ? "Shows with this address. The phone bar keeps calling your main number." : "Shows with this address."}</div></div>
<div class="field" role="group" aria-labelledby="p2HoursL"><span class="biz-p2-lbl" id="p2HoursL">Hours</span>
<div class="biz-seg"><label><input type="radio" name="p2hours" value="same"> Same hours as the main location</label><label><input type="radio" name="p2hours" value="own"> Its own hours</label></div>
<div class="hoursgrid" id="hoursGrid2" hidden></div>
<div class="hint">Google is told you have two places, each with its address, phone and hours.</div></div>
<p class="hint" id="p2Wait" hidden>It saves once it has a street address and a city.</p>
<button type="button" class="biz-rm" id="btnPlace2Rm">Remove the second location</button>`;
  host.querySelectorAll("[data-p2]").forEach((inp) => {
    inp.value = p[inp.dataset.p2] || "";
    inp.addEventListener("input", () => { PLACE2[inp.dataset.p2] = inp.value; savePlace2(); });
  });
  host.querySelectorAll('input[name="p2hours"]').forEach((r) => {
    r.checked = (r.value === "same") === (p.same_hours !== false);
    r.addEventListener("change", () => { PLACE2.same_hours = r.value === "same"; renderPlace2Hours(); savePlace2(); });
  });
  $("btnPlace2Rm").addEventListener("click", removePlace2);
  $("p2Wait").hidden = place2Ready(p) || !(p.label || p.address_line1 || p.city);
  renderPlace2Hours();
}
// Its own week starts as a copy of the main location's, drawn like it.
function renderPlace2Hours() {
  const grid = $("hoursGrid2"); if (!grid || !PLACE2) return;
  grid.innerHTML = ""; grid.hidden = PLACE2.same_hours !== false;
  if (grid.hidden) return;
  if (!Array.isArray(PLACE2.hours) || PLACE2.hours.length !== 7) PLACE2.hours = undoClone(hoursFromState());
  PLACE2.hours.forEach((day, idx) => {
    const name = DAYS.find(([k]) => k === day.day)[1];
    const row = el("div", "hrow");
    row.appendChild(el("span", "day", name));
    const iv = (day.intervals && day.intervals[0]) || { open: "09:00", close: "17:00" };
    const open = el("input"); open.type = "time"; open.value = iv.open || "09:00"; open.disabled = !!day.closed; open.setAttribute("aria-label", name + " opens");
    const close = el("input"); close.type = "time"; close.value = iv.close || "17:00"; close.disabled = !!day.closed; close.setAttribute("aria-label", name + " closes");
    const lab = el("label", "closedlab"); const cb = el("input"); cb.type = "checkbox"; cb.checked = !!day.closed;
    lab.append(cb, document.createTextNode("Closed"));
    row.append(open, el("span", "to", "to"), close, lab);
    const save = () => { PLACE2.hours[idx] = { day: day.day, closed: cb.checked, intervals: cb.checked ? [] : [{ open: open.value || "09:00", close: close.value || "17:00" }] }; savePlace2(); };
    cb.addEventListener("change", () => { open.disabled = close.disabled = cb.checked; save(); });
    open.addEventListener("change", save); close.addEventListener("change", save);
    grid.appendChild(row);
  });
}
function savePlace2() {
  const ready = place2Ready(PLACE2), wait = $("p2Wait");
  if (wait) wait.hidden = ready;
  if (!ready) return;
  whisper("save-location", "saving"); whisper("topWhisper", "saving");
  debounce("location:second_location", async () => {
    const body = { second_location: undoClone(PLACE2) };
    try {
      await api("PUT", "/location", body);
      S.location = { ...(S.location || {}), second_location: body.second_location };   // the next undo step needs what's saved now
      whisper("save-location", "saved"); whisper("topWhisper", "saved");
      scheduleChangesRefresh();
    } catch (err) { whisper("save-location", ""); whisper("topWhisper", "failed"); toast(nice(err), true); }
  }, 700);
}
async function removePlace2() {
  clearTimeout(debounces["location:second_location"]); delete debounceFns["location:second_location"];
  const had = S.location && S.location.second_location;
  PLACE2 = null; renderPlace2();
  if (!had) return;
  whisper("save-location", "saving"); whisper("topWhisper", "saving");
  try {
    await api("PUT", "/location", { second_location: null });
    S.location = { ...(S.location || {}), second_location: null };
    whisper("save-location", "saved"); whisper("topWhisper", "saved");
    scheduleChangesRefresh();
    toastAction("Second location removed", "Put it back", () => { PLACE2 = undoClone(had); renderPlace2(); savePlace2(); });
  } catch (err) { PLACE2 = undoClone(had); renderPlace2(); whisper("save-location", ""); whisper("topWhisper", "failed"); toast(nice(err), true); }
}

/* ── hours (identical PUT /location) ── */
let HOURS_BEFORE = null;
function hoursFromState() {
  const loc = S.location || {};
  const map = new Map((loc.hours || []).map((d) => [d.day, d]));
  return DAYS.map(([d]) => map.get(d) || { day: d, closed: true, intervals: [] });
}
function renderHours() {
  const grid = $("hoursGrid"); grid.innerHTML = "";
  hoursFromState().forEach((day) => {
    const row = el("div", "hrow");
    row.appendChild(el("span", "day", DAYS.find(([k]) => k === day.day)[1]));
    const iv = day.intervals && day.intervals[0] ? day.intervals[0] : { open: "09:00", close: "17:00" };
    const open = el("input"); open.type = "time"; open.value = iv.open || "09:00"; open.disabled = !!day.closed;
    const close = el("input"); close.type = "time"; close.value = iv.close || "17:00"; close.disabled = !!day.closed;
    const lab = el("label", "closedlab"); const cb = el("input"); cb.type = "checkbox"; cb.checked = !!day.closed;
    lab.append(cb, document.createTextNode("Closed"));
    row.append(open, el("span", "to", "to"), close, lab);
    const save = () => {
      const hours = hoursFromState().map((d) => d.day === day.day
        ? { day: d.day, closed: cb.checked, intervals: cb.checked ? [] : [{ open: open.value || "09:00", close: close.value || "17:00" }] }
        : d);
      if (!HOURS_BEFORE) HOURS_BEFORE = { hours: undoClone((S.location || {}).hours) };   // S moves ahead of the write
      S.location = { ...(S.location || {}), hours };
      whisper("save-hours", "saving"); whisper("topWhisper", "saving");
      debounce("hours", async () => {
        UNDO_BEFORE = HOURS_BEFORE; HOURS_BEFORE = null;
        try { await api("PUT", "/location", { hours: S.location.hours }); whisper("save-hours", "saved"); whisper("topWhisper", "saved"); scheduleChangesRefresh(); }
        catch (err) { whisper("save-hours", ""); whisper("topWhisper", "failed"); toast(nice(err), true); }
      }, 600);
    };
    cb.addEventListener("change", () => { open.disabled = close.disabled = cb.checked; save(); });
    open.addEventListener("change", save); close.addEventListener("change", save);
    grid.appendChild(row);
  });
  // Phase T2: one-click typical hours — kills the seven-row all-closed first-run chore
  if (hoursFromState().every((d) => d.closed)) {
    const quick = el("button", null, "Use typical hours (Mon–Fri, 9–5)");
    quick.type = "button";
    quick.style.cssText = "font:inherit;font-size:12.5px;margin-top:8px;padding:6px 13px;border-radius:999px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
    quick.addEventListener("click", async () => {
      const hours = hoursFromState().map((d) => ["sat", "sun"].includes(d.day)
        ? { day: d.day, closed: true, intervals: [] }
        : { day: d.day, closed: false, intervals: [{ open: "09:00", close: "17:00" }] });
      UNDO_BEFORE = { hours: undoClone((S.location || {}).hours) };
      S.location = { ...(S.location || {}), hours };
      try { await api("PUT", "/location", { hours }); renderHours(); toast("Typical hours set — adjust any day"); scheduleChangesRefresh(); }
      catch (err) { toast(nice(err), true); }
    });
    grid.appendChild(quick);
  }
  const sw = $("closedSwitch"), note = $("f-closednote");
  sw.checked = !!(S.location && S.location.temporarily_closed);
  note.hidden = !sw.checked; note.value = (S.location && S.location.temporarily_closed_note) || "";
}
$("closedSwitch").addEventListener("change", async () => {
  const now = $("closedSwitch").checked;
  UNDO_BEFORE = { temporarily_closed: !now };
  S.location = { ...(S.location || {}), temporarily_closed: now };
  $("f-closednote").hidden = !now;
  whisper("save-hours", "saving"); whisper("topWhisper", "saving");
  try { await api("PUT", "/location", { temporarily_closed: now }); whisper("save-hours", "saved"); whisper("topWhisper", "saved"); scheduleChangesRefresh(); }
  catch (err) {
    // item 81: the switch goes back to what's saved, so it never shows a closure that didn't happen
    $("closedSwitch").checked = !now; S.location = { ...(S.location || {}), temporarily_closed: !now }; $("f-closednote").hidden = now;
    whisper("save-hours", ""); whisper("topWhisper", "failed"); toast(nice(err), true);
  }
});
// Builder list item 334: "We go to our customers". A business with no shopfront shows the
// places it serves where its address was (footer, Contact page, under the opening) and offers
// no directions; publishing asks for those places instead of a street. Here the address folds
// away (kept, unshown, so switching back brings it straight back) and Where you work moves
// into this card, where the address was. The switch shows only once the database has the
// column (migration 0255): /site says so in location_fields, and before it a save would fail.
const goesKnown = () => (S.locationFields || []).includes("goes_to_customers") || !!(S.location && "goes_to_customers" in S.location);
const goesOn = () => goesKnown() && !!(S.location && S.location.goes_to_customers === true);
function renderGoesSwitch() {
  const row = $("goesRow"); if (!row) return;
  row.hidden = !goesKnown();
  $("goesSwitch").checked = goesOn();
  paintGoes();
}
function paintGoes() {
  const on = goesOn(), field = $("areaField");
  $("bizAddr").hidden = on;
  const hint = $("goesHint"); hint.hidden = !on;
  hint.textContent = on ? "No street address or Get directions link shows on your site. It names the places you serve instead, from Where you work. Your address stays saved here, unshown." : "";
  const home = on ? $("goesArea") : $("areaHome");
  if (field && field.parentElement !== home) home.appendChild(field);
  paintBizShows();
}
$("goesSwitch").addEventListener("change", async () => {
  const now = $("goesSwitch").checked;
  UNDO_BEFORE = { goes_to_customers: !now };
  S.location = { ...(S.location || {}), goes_to_customers: now };
  paintGoes();
  if (now && !$("f-service_area").value.trim()) $("f-service_area").focus();
  whisper("save-location", "saving"); whisper("topWhisper", "saving");
  try { await api("PUT", "/location", { goes_to_customers: now }); whisper("save-location", "saved"); whisper("topWhisper", "saved"); scheduleChangesRefresh(); }
  catch (err) {
    // the switch goes back to what's saved, the way the closed switch does (item 81)
    $("goesSwitch").checked = !now; S.location = { ...(S.location || {}), goes_to_customers: !now }; paintGoes();
    whisper("save-location", ""); whisper("topWhisper", "failed"); toast(nice(err), true);
  }
});
// Item 61: the published site's visit counter, and the privacy page that describes it,
// follow this one switch. Absent means on, as every site has counted until now.
function renderVisitSwitch() {
  $("privacyWrap").hidden = !!(S.site && S.site.edition === "monitor");   // a watched website isn't ours to count
  const on = !(S.settings && S.settings.visit_counter === false);
  $("visitSwitch").checked = on;
  $("visitHint").textContent = on
    ? "Counts which pages people open and when they tap your phone number, email or links, with no cookies and no outside company. Your privacy page says so. Changes go live when you publish."
    : "Your site counts nothing, and its privacy page says so. Changes go live when you publish.";
}
$("visitSwitch").addEventListener("change", async () => {
  const now = $("visitSwitch").checked;
  whisper("save-privacy", "saving");
  try {
    await settingsPut({ visit_counter: now });
    whisper("save-privacy", "saved"); renderVisitSwitch(); scheduleChangesRefresh();
  } catch (err) {
    whisper("save-privacy", ""); $("visitSwitch").checked = !now;
    toast(nice(err), true);
  }
});
// List item 175: one switch for AI assistants. Off, the next publish asks the known AI
// crawlers to stay out in robots.txt; Google and Bing search are not affected.
function renderAiCrawlSwitch() {
  $("aiCrawlWrap").hidden = !!(S.site && S.site.edition === "monitor");   // a watched website's robots file isn't ours
  const on = !(S.settings && S.settings.ai_crawlers === false);
  $("aiCrawlSwitch").checked = on;
  $("aiCrawlHint").textContent = on
    ? "ChatGPT, Claude, Perplexity, Gemini and other AI assistants can read your site, so they can mention and recommend you. Changes go live when you publish."
    : "AI assistants are asked not to read your site, so they’re less likely to mention or recommend you. The big ones honour this, but it isn’t a lock. Google and Bing search are not affected. Changes go live when you publish.";
}
$("aiCrawlSwitch").addEventListener("change", async () => {
  const now = $("aiCrawlSwitch").checked;
  whisper("topWhisper", "saving");
  try {
    await settingsPut({ ai_crawlers: now });
    whisper("topWhisper", "saved"); renderAiCrawlSwitch(); scheduleChangesRefresh();
  } catch (err) {
    whisper("topWhisper", "failed"); $("aiCrawlSwitch").checked = !now;
    toast(nice(err), true);
  }
});
$("f-closednote").addEventListener("input", () => {
  debounce("closednote", async () => {
    try { await api("PUT", "/location", { temporarily_closed_note: $("f-closednote").value }); whisper("save-hours", "saved"); scheduleChangesRefresh(); }
    catch (err) { whisper("topWhisper", "failed"); toast(nice(err), true); }
  }, 700);
});

/* ── the menu that edits itself (identical CRUD) ── */
function categoriesInOrder() {
  const declared = (S.settings && S.settings.category_order) || [];
  const seen = new Set(declared);
  const encounter = [];
  for (const o of S.offerings) { const c = o.category || VOCAB.label; if (!seen.has(c)) { seen.add(c); encounter.push(c); } }
  return [...declared.filter((c) => S.offerings.some((o) => (o.category || VOCAB.label) === c)), ...encounter];
}
function renderOfferings() {
  const wrap = $("offeringsWrap"); wrap.innerHTML = "";
  const cats = categoriesInOrder();
  const wash = changedIds();
  if (!S.offerings.length) {
    const e = el("div", "estate");
    // Item 93: in the business's own words. A plumber saw burrata, dishes and "Mains".
    e.innerHTML = `<div class="eq">${VOCAB.example}</div><div class="eh">${esc(VOCAB.empty)}</div>`;
    const a = el("div", "ea"); const b = el("button", "pillbtn inked", `Add the first ${VOCAB.one}`);
    b.addEventListener("click", () => addDishLine(wrap, VOCAB.firstCat));
    a.appendChild(b); e.appendChild(a); wrap.appendChild(e);
  }
  cats.forEach((cat, ci) => {
    const head = el("div", "menuhead");
    head.appendChild(el("h6", null, cat));
    const n = S.offerings.filter((o) => (o.category || VOCAB.label) === cat).length;
    head.appendChild(el("span", "mv", `${n} ${n === 1 ? VOCAB.one : VOCAB.many}`));
    const ctl = el("div", "ctl");
    const up = icoBtn("up", `Move ${cat} earlier`, null, 14);
    const dn = icoBtn("down", `Move ${cat} later`, null, 14);
    up.disabled = ci === 0; dn.disabled = ci === cats.length - 1;
    up.addEventListener("click", () => moveCategory(cat, -1));
    dn.addEventListener("click", () => moveCategory(cat, +1));
    ctl.append(up, dn); head.appendChild(ctl);
    wrap.appendChild(head);
    S.offerings.filter((o) => (o.category || VOCAB.label) === cat).forEach((o) => wrap.appendChild(dishLine(o, wash)));
    const add = el("button", "addline", `＋ Add a ${VOCAB.one} to ${cat}`);
    add.addEventListener("click", () => addDishLine(add, cat));
    wrap.appendChild(add);
  });
  const ns = $("newSectionWrap"); ns.innerHTML = "";
  if (S.offerings.length) {
    const b = el("button", "addline", VOCAB.addLine);
    b.style.borderTop = "none"; b.style.marginTop = "18px";
    b.addEventListener("click", () => addDishLine(ns, ""));
    ns.appendChild(b);
  }
}
function dishLine(o, wash) {
  const holder = el("div");
  const row = el("button", "dish" + (o.is_visible === false ? " offmenu" : "") + (wash.has(o.id) && o.is_visible !== false ? " washed" : ""));
  row.setAttribute("aria-label", `Edit ${o.name}`);
  const left = el("span");
  const nm = el("span", "dn", o.name);
  if (o.is_visible === false) nm.appendChild(Object.assign(el("span", "smalltag", VOCAB.offTag), { style: "margin-left:10px;text-decoration:none;display:inline-block" }));
  left.appendChild(nm);
  if (o.description) left.appendChild(el("div", "dd", o.description));
  row.append(left, el("span", "lead"), el("span", "dp", o.price_text || "—"));
  row.addEventListener("click", () => {
    const open = holder.querySelector(".editor");
    if (open) { open.remove(); return; }
    holder.appendChild(dishEditor(o));
  });
  holder.appendChild(row);
  return holder;
}
function dishEditor(o) {
  const ed = el("div", "editor");
  ed.innerHTML = `
    <div class="erow">
      <div class="field"><label>${vocabCap(VOCAB.one)}</label><input type="text" data-k="name" value="${esc(o.name)}" maxlength="120"></div>
      <div class="field" style="max-width:130px"><label>Price</label><input type="text" data-k="price_text" aria-label="Price" value="${esc(o.price_text || "")}" maxlength="40" placeholder="${esc(VOCAB.pricePh)}"></div>
    </div>
    <div class="field"><label>Description</label><textarea data-k="description" maxlength="500" style="min-height:52px">${esc(o.description || "")}</textarea></div>
    <div class="erow">
      <div class="field"><label>Section</label><input type="text" data-k="category" value="${esc(o.category)}" maxlength="60"></div>
      <div class="field" style="max-width:200px"><label>Photograph</label><button class="textact" data-act="photo" style="background:none">${o.media_id ? "Change photograph" : "Choose one"}</button></div>
    </div>
    <div class="eacts">
      <button class="pillbtn" data-act="save">Done</button>
      <button class="textact" data-act="vis" style="background:none">${o.is_visible === false ? VOCAB.putBack : VOCAB.takeOff}</button>
      <span class="spacer"></span>
      <button class="danger" data-act="del" data-needs="delete">Remove for good</button>
    </div>`;
  ed.querySelector('[data-act="photo"]').addEventListener("click", () => openPicker(async (mediaId) => {
    try { const r = await api("PATCH", `/offerings/${o.id}`, { media_id: mediaId }); Object.assign(o, r.data); renderOfferings(); scheduleChangesRefresh(); }
    catch (err) { toast(nice(err), true); }
  }));
  ed.querySelector('[data-act="vis"]').addEventListener("click", async () => {
    try { const r = await api("PATCH", `/offerings/${o.id}`, { is_visible: o.is_visible === false });
      Object.assign(o, r.data); renderOfferings(); scheduleChangesRefresh(); }
    catch (err) { toast(nice(err), true); }
  });
  editorAutosave(ed, () => { const body = {}; ed.querySelectorAll("[data-k]").forEach((i) => { body[i.dataset.k] = i.value; }); return body; },
    async (body) => { const r = await api("PATCH", `/offerings/${o.id}`, body); Object.assign(o, r.data); }, renderOfferings);
  armDelete(ed.querySelector('[data-act="del"]'), async () => {
    try { await api("DELETE", `/offerings/${o.id}`); S.offerings = S.offerings.filter((x) => x.id !== o.id); renderOfferings(); toast("Removed"); scheduleChangesRefresh(); }
    catch (err) { toast(nice(err), true); }
  });
  return ed;
}
function addDishLine(afterNode, cat) {
  document.querySelectorAll(".editor.adding").forEach((n) => n.remove());
  const ed = el("div", "editor adding");
  ed.innerHTML = `
    <div class="erow">
      <div class="field"><label>${vocabCap(VOCAB.one)}</label><input type="text" data-k="name" maxlength="120"></div>
      <div class="field" style="max-width:130px"><label>Price</label><input type="text" data-k="price_text" aria-label="Price" maxlength="40" placeholder="${esc(VOCAB.pricePh)}"></div>
    </div>
    ${cat === "" ? `<div class="field"><label>Section</label><input type="text" data-k="category" aria-label="Section" maxlength="60" placeholder="${esc(VOCAB.catHint)}"></div>` : ""}
    <div class="eacts"><button class="pillbtn inked" data-act="add">${VOCAB.addBtn}</button><button class="quietact" data-act="cancel">Never mind</button></div>`;
  ed.querySelector('[data-act="cancel"]').addEventListener("click", () => ed.remove());
  ed.querySelector('[data-act="add"]').addEventListener("click", async () => {
    const name = ed.querySelector('[data-k="name"]').value.trim();
    const price = ed.querySelector('[data-k="price_text"]').value.trim();
    const category = cat || (ed.querySelector('[data-k="category"]')?.value.trim() || "");
    if (!name || !category) { toast(`A ${VOCAB.one} needs a name and a section.`, true); return; }
    try { const r = await api("POST", "/offerings", { name, category, price_text: price });
      S.offerings.push(r.data); renderOfferings(); toast(VOCAB.added); scheduleChangesRefresh(); }
    catch (err) { toast(nice(err), true); }
  });
  afterNode.parentNode ? afterNode.parentNode.insertBefore(ed, afterNode.nextSibling) : afterNode.appendChild(ed);
  ed.querySelector("input").focus();
}
async function moveCategory(cat, dir) {
  const cats = categoriesInOrder();
  const i = cats.indexOf(cat), j = i + dir;
  if (j < 0 || j >= cats.length) return;
  [cats[i], cats[j]] = [cats[j], cats[i]];
  const before = { category_order: undoClone((S.settings || {}).category_order || []) };   // S moves ahead of the write, so Undo is told what it was
  S.settings = { ...(S.settings || {}), category_order: cats };
  renderOfferings();
  try { await settingsPut(() => { UNDO_BEFORE = before; return { category_order: cats }; }); scheduleChangesRefresh(); }
  catch (err) { toast(nice(err), true); }
}

/* two-tap destructive confirm, in words */
function armDelete(btn, fn) {
  btn.addEventListener("click", () => {
    if (btn.dataset.armed) { fn(); return; }
    btn.dataset.armed = "1"; btn.classList.add("armed");
    const was = btn.textContent; btn.textContent = "Are you sure? This one really goes.";
    setTimeout(() => { delete btn.dataset.armed; btn.classList.remove("armed"); btn.textContent = was; }, 3400);
  });
}

/* ── questions / kind words / updates as artifacts (identical CRUD) ── */
function artifactActs(entity, collection, rerender, words) {
  const acts = el("span", "aacts");
  const edit = el("button", "quietact", "edit");
  edit.addEventListener("click", (e) => { e.stopPropagation(); const h = acts.closest(".artifact"); const open = h.querySelector(".editor"); if (open) open.remove(); else h.appendChild(simpleEditor(entity, collection, words.fields, rerender, words)); });
  acts.appendChild(edit);
  return acts;
}
function simpleEditor(entity, collection, fields, rerender, words) {
  const ed = el("div", "editor");
  ed.innerHTML = fields.map(([k, label, kind, max]) => `
    <div class="field">${label ? `<label>${label}</label>` : ""}${kind === "textarea"
      ? `<textarea data-k="${k}" maxlength="${max}">${esc(entity[k] || "")}</textarea>`
      : `<input type="text" data-k="${k}" value="${esc(entity[k] || "")}" maxlength="${max}">`}</div>`).join("") + `
    <div class="eacts">
      <button class="pillbtn" data-act="save">Done</button>
      <button class="textact" data-act="vis" style="background:none">${entity.is_visible === false ? words.show : words.hide}</button>
      <span class="spacer"></span>
      <button class="danger" data-act="del" data-needs="delete">Remove for good</button>
    </div>`;
  if (collection === "faqs") {
    const improve = el("button", "quietact", "✦ improve with help");
    improve.style.marginLeft = "18px";
    improve.addEventListener("click", () => openEditDesk("edit_faq", "faqs", entity.id, "rewrite"));
    ed.querySelector(".eacts").insertBefore(improve, ed.querySelector(".spacer"));
  }
  editorAutosave(ed, () => { const body = {}; ed.querySelectorAll("[data-k]").forEach((i) => { body[i.dataset.k] = i.value; }); return body; },
    async (body) => { const r = await api("PATCH", `/${collection}/${entity.id}`, body); Object.assign(entity, r.data); }, rerender);
  ed.querySelector('[data-act="vis"]').addEventListener("click", async () => {
    try { const r = await api("PATCH", `/${collection}/${entity.id}`, { is_visible: entity.is_visible === false });
      Object.assign(entity, r.data); rerender(); scheduleChangesRefresh(); }
    catch (err) { toast(nice(err), true); }
  });
  armDelete(ed.querySelector('[data-act="del"]'), async () => {
    try { await api("DELETE", `/${collection}/${entity.id}`);
      S[collection] = S[collection].filter((x) => x.id !== entity.id); rerender(); toast("Removed"); scheduleChangesRefresh(); }
    catch (err) { toast(nice(err), true); }
  });
  return ed;
}
function estateWithAction(quote, help, actionLabel, actionFn) {
  const e = el("div", "estate");
  e.appendChild(el("div", "eq", quote));
  e.appendChild(el("div", "eh", help));
  const a = el("div", "ea"); const b = el("button", "pillbtn inked", actionLabel);
  b.addEventListener("click", actionFn);
  a.appendChild(b); e.appendChild(a);
  return e;
}
function renderFaqs() {
  const list = $("faqList"); list.innerHTML = "";
  const wash = changedIds();
  if (!S.faqs.length) {
    list.appendChild(estateWithAction("“Do you take walk-ins?”",
      "The first question customers ask is usually the easiest to answer. Keep it here once and it answers itself forever — on your site’s Questions page.",
      "Answer the first question", () => $("btnAddFaq").click()));
    return;
  }
  S.faqs.forEach((f) => {
    const a = el("div", "artifact" + (f.is_visible === false ? " dimmed" : ""));
    const row = el("div", "arow");
    const q = el("span", "aq");
    if (wash.has(f.id) && f.is_visible !== false) q.appendChild(el("span", "washed-dot"));
    q.appendChild(document.createTextNode(f.question));
    if (f.is_visible === false) q.appendChild(Object.assign(el("span", "smalltag", "not shown"), { style: "margin-left:10px" }));
    row.appendChild(q);
    row.appendChild(artifactActs(f, "faqs", renderFaqs, { fields: [["question","Question","text",200],["answer","Answer","textarea",2000]], hide: "Take it off the page", show: "Put it back on the page" }));
    a.appendChild(row);
    a.appendChild(el("div", "aa", f.answer));
    list.appendChild(a);
  });
}
function renderTes() {
  const list = $("tesList"); list.innerHTML = "";
  const wash = changedIds();
  if (!S.testimonials.length) {
    list.appendChild(estateWithAction("“The gnocchi alone is worth the drive.”",
      "Someone has said something kind about your business. Keep it here, and it appears on your site in their words — like this one would.",
      "Keep the first kind word", () => $("btnAddTes").click()));
    return;
  }
  S.testimonials.forEach((t) => {
    const a = el("div", "artifact" + (t.is_visible === false ? " dimmed" : ""));
    const row = el("div", "arow");
    const q = el("span", "aq quote");
    if (wash.has(t.id) && t.is_visible !== false) q.appendChild(el("span", "washed-dot"));
    q.appendChild(document.createTextNode(`“${t.quote}”`));
    if (t.is_visible === false) q.appendChild(Object.assign(el("span", "smalltag", "not shown"), { style: "margin-left:10px;font-style:normal" }));
    row.appendChild(q);
    row.appendChild(artifactActs(t, "testimonials", renderTes, { fields: [["quote","Their words","textarea",600],["author","From","text",120],["source","Where they said it","text",80]], hide: "Take it off the page", show: "Put it back on the page" }));
    a.appendChild(row);
    a.appendChild(el("div", "attrib", "— " + t.author + (t.source ? ", on " + t.source : "")));
    list.appendChild(a);
  });
}
/* ── Blog (builder list item 40): every post as a card that says where it stands (Live,
 *    the day and time it goes out, or Draft), its category and who wrote it. A card opens
 *    the writing screen (blog-studio.js, loaded on first use), which saves as you type and
 *    publishes one post on its own. ── */
let BLOG_SHOW = "all", BLOG_CAT = "";
const blogLists = () => ({
  categories: Array.isArray(S.settings && S.settings.post_categories) ? S.settings.post_categories : [],
  authors: Array.isArray(S.settings && S.settings.post_authors) ? S.settings.post_authors : [],
});
const siteTz = () => (S.location && S.location.timezone) || "America/Los_Angeles";
const blogWhen = (iso) => new Date(iso).toLocaleString("en-US", { timeZone: siteTz(), weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(/, (\d{1,2}:\d{2}) (AM|PM)$/, (_m, t, ap) => " · " + t + " " + ap.toLowerCase());
const postState = (p) => (p.status === "published" ? "live" : p.status === "scheduled" ? "sched" : "draft");
const siteIsLive = () => !!(S.site && S.site.status === "live");
function paintBlogFilters() {
  const host = $("blFilters"); if (!host) return;
  const n = { all: S.posts.length, live: 0, sched: 0, draft: 0 };
  S.posts.forEach((p) => { n[postState(p)]++; });
  const cats = blogLists().categories;
  host.innerHTML = [["all", "All"], ["live", "Live"], ["sched", "Scheduled"], ["draft", "Drafts"]]
    .map(([k, w]) => `<button type="button" class="bl-pill" data-show="${k}" aria-pressed="${BLOG_SHOW === k}">${w} ${n[k]}</button>`).join("")
    + (cats.length ? `<label class="bl-catsel"><span class="sr-only">Category</span><select id="blCat"><option value="">Every category</option>${cats.map((c) => `<option value="${esc(c.id)}"${BLOG_CAT === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>` : "")
    + `<button type="button" class="bl-lists" id="btnBlogLists">${uiIcon("cog", 15)} Categories and authors</button>`;
  host.querySelectorAll("[data-show]").forEach((b) => b.addEventListener("click", () => { BLOG_SHOW = b.dataset.show; renderPosts(); }));
  const sel = $("blCat"); if (sel) sel.addEventListener("change", () => { BLOG_CAT = sel.value; renderPosts(); });
  $("btnBlogLists").addEventListener("click", openBlogLists);
}
function renderPosts() {
  const list = $("postList"); if (!list) return;
  list.innerHTML = "";
  paintBlogFilters();
  if (!S.posts.length) {
    list.appendChild(estateWithAction("Summer patio is open.",
      "Your first post can be one sentence, like this. Write it, add a photo, then publish it now or pick a day and time. It goes on your site’s Updates page.",
      "Write the first post", () => $("btnAddPost").click()));
    return;
  }
  const lists = blogLists(), wash = changedIds();
  const shown = S.posts.filter((p) => (BLOG_SHOW === "all" || postState(p) === BLOG_SHOW) && (!BLOG_CAT || p.category === BLOG_CAT));
  if (!shown.length) { list.appendChild(el("p", "bl-none", "No posts here yet.")); return; }
  shown.forEach((p) => {
    const st = postState(p), cat = lists.categories.find((c) => c.id === p.category), au = lists.authors.find((a) => a.id === p.author);
    const card = el("article", "bl-card"); card.dataset.post = p.id;
    const m = p.hero_media_id ? (S.media || []).find((x) => x.id === p.hero_media_id) : null;
    const chip = st === "live" ? "Live" : st === "sched" ? "Goes out " + blogWhen(p.published_at) : "Draft";
    const when = st === "live" && p.published_at ? fmtDate(p.published_at) : st === "sched" ? "scheduled" : "edited " + fmtDate(p.updated_at || p.published_at || new Date().toISOString());
    const action = st === "live" && siteIsLive() ? `<a class="bl-act" href="${esc(withClient("/broadcasts.html?post=" + p.id))}">${uiIcon("mail", 15)} Email it to your list</a>`
      : `<button type="button" class="bl-act" data-open>${st === "sched" ? "Change the time" : st === "live" ? "Edit" : "Keep writing"}</button>`;
    card.innerHTML = `<div class="bl-photo${m && m.thumb ? "" : " none"}">${m && m.thumb ? `<img src="${esc(m.thumb)}" alt="" loading="lazy">` : ""}</div>
      <div class="bl-body">
        <div class="bl-top"><span class="bl-chip ${st}">${esc(chip)}</span>${cat ? `<span class="bl-cat">${esc(cat.name)}</span>` : ""}${wash.has(p.id) && st === "live" ? `<span class="washed-dot" title="Changed since your last publish"></span>` : ""}</div>
        <h3 class="bl-title"><button type="button" data-open>${esc(p.title || "Untitled post")}</button></h3>
        <p class="bl-meta">${esc((au ? "By " + au.name + " · " : "") + when)}</p>
        <div class="bl-acts">${action}<button type="button" class="bl-rm" data-act="del" data-needs="delete">Remove</button></div>
      </div>`;
    card.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openPost(p)));
    card.querySelector(".bl-photo").addEventListener("click", () => openPost(p));
    armDelete(card.querySelector('[data-act="del"]'), async () => { if (await deletePost(p)) renderPosts(); });
    list.appendChild(card);
  });
}
// The writing screen shows the post in the site's own fonts and colours: the template's,
// with the owner's own choices from Styles over them.
const TEMPLATE_LOOK = {
  "atelier": { bg: "#fbfaf7", ink: "#1c1b18", soft: "#5b564c", accent: "#7a5f3a", line: "#e5e0d5", display: "Georgia,'Times New Roman',serif", body: "'Avenir Next','Helvetica Neue',system-ui,sans-serif" },
  "aurora": { bg: "#ffffff", ink: "#16171d", soft: "#636471", accent: "#3730a3", line: "#eaeaf1", display: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif", body: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" },
  "business-classic": { bg: "#f7f7f5", ink: "#1c2430", soft: "#5b6572", accent: "#17453f", line: "#e2e4e1", display: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif", body: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" },
  "editorial": { bg: "#f6f3ec", ink: "#1a1a1c", soft: "#5f5a52", accent: "#4f181d", line: "#ddd6c8", display: "'Iowan Old Style',Palatino,Georgia,serif", body: "'Iowan Old Style','Palatino Linotype',Palatino,serif" },
  "harbor": { bg: "#ffffff", ink: "#1c2434", soft: "#4a556a", accent: "#12203a", line: "#c9d5e6", display: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif", body: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" },
  "meadow": { bg: "#faf7f0", ink: "#243428", soft: "#55624f", accent: "#345c41", line: "#e4dfcd", display: "'Palatino Linotype',Palatino,Georgia,serif", body: "'Seravek','Gill Sans',system-ui,sans-serif" },
  "restaurant-classic": { bg: "#faf6ef", ink: "#241d1a", soft: "#6b5f58", accent: "#6f2e24", line: "#e7ddd0", display: "Georgia,'Iowan Old Style','Times New Roman',serif", body: "system-ui,-apple-system,'Segoe UI',sans-serif" },
  "slate": { bg: "#101216", ink: "#eef1f5", soft: "#9ba4b5", accent: "#2dd4bf", line: "#262a33", display: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif", body: "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" },
};
function blogLook() {
  const base = TEMPLATE_LOOK[(S.site && S.site.template_slug) || ""] || TEMPLATE_LOOK["business-classic"];
  const t = DESIGN_TOKENS || {};
  return { ...base, ...(t.ink ? { ink: t.ink } : {}), ...(t.soft ? { soft: t.soft } : {}), ...(t.accent_dark || t.accent ? { accent: t.accent_dark || t.accent } : {}), ...(t.bg ? { bg: t.bg } : {}),
    ...(t.font_display ? { display: t.font_display } : {}), ...(t.font_body ? { body: t.font_body } : {}), radius: t.radius || "14px" };
}
// The one place a post is removed: the card's Remove, and the writing screen's.
async function deletePost(p) {
  try { await api("DELETE", `/posts/${p.id}`); S.posts = S.posts.filter((x) => x.id !== p.id); toast("Removed"); scheduleChangesRefresh(); return true; }
  catch (err) { toast(nice(err), true); return false; }
}
let BLOG_STUDIO = null;
function loadBlogStudio() {
  if (window.DDSBlogStudio) return Promise.resolve(window.DDSBlogStudio);
  // Bump ?v= whenever blog-studio.js changes: browsers keep a .js file for a day.
  if (!BLOG_STUDIO) BLOG_STUDIO = new Promise((res, rej) => {
    const sc = document.createElement("script"); sc.src = "/blog-studio.js?v=2";
    sc.onload = () => window.DDSBlogStudio ? res(window.DDSBlogStudio) : rej(new Error("missing"));
    sc.onerror = () => rej(new Error("load"));
    document.head.appendChild(sc);
  }).catch((e) => { BLOG_STUDIO = null; throw e; });
  return BLOG_STUDIO;
}
async function blogListsPut(field, next) {
  try { await settingsPut({ [field]: next }); renderPosts(); return true; }
  catch (err) { toast(nice(err), true); return false; }
}
async function addBlogCategory(name) {
  const lists = blogLists();
  const have = lists.categories.find((c) => c.name.toLowerCase() === name.toLowerCase());
  if (have) return have;
  if (!(await blogListsPut("post_categories", [...lists.categories, { name }]))) return null;
  return blogLists().categories.find((c) => c.name.toLowerCase() === name.toLowerCase()) || null;
}
async function addBlogAuthor(name, bio) {
  const lists = blogLists();
  if (!(await blogListsPut("post_authors", [...lists.authors, { name, ...(bio ? { bio } : {}) }]))) return null;
  return blogLists().authors.filter((a) => a.name === name).slice(-1)[0] || null;
}
function blogHost() {
  const live = siteLiveUrl();
  return {
    api, toast, nice, askText, splitTags, openPicker,
    timezone: siteTz(), origin: live ? live.replace(/^https?:\/\//, "").replace(/\/$/, "") : "yoursite.com",
    siteLive: siteIsLive(), look: blogLook(),
    mediaOf: (id) => (S.media || []).find((m) => m.id === id) || null,
    lists: blogLists, addCategory: (n) => addBlogCategory(n), addAuthor: (n) => addBlogAuthor(n),
    emailHref: (p) => withClient("/broadcasts.html?post=" + p.id),
    // the writing screen offers Remove only to someone who may delete (a role without it isn't shown it)
    canDelete: () => !(window.ddsLacks && window.ddsLacks("delete")),
    removePost: async (p) => (await askYes(`Remove “${p.title || "this post"}”? It comes off your site with your next publish.`, { ok: "Remove it", danger: true })) && deletePost(p),
    onSaved: (p) => { const { _slugDraft, _slugTouched, ...clean } = p; const i = S.posts.findIndex((x) => x.id === p.id); if (i >= 0) S.posts[i] = { ...S.posts[i], ...clean }; scheduleChangesRefresh(); },
    onClose: () => { renderPosts(); const c = document.querySelector(`.bl-card[data-post] .bl-title button`); if (c) c.focus(); },
  };
}
// The two lists a post picks from. Removing a category keeps its posts; they lose the label.
function openBlogLists() {
  paintBlogLists();
  openSheet("blogListsScrim");
}
function paintBlogLists() {
  const host = $("blogListsBody"); if (!host) return;
  const lists = blogLists();
  const used = (k, id) => S.posts.filter((p) => p[k] === id).length;
  const n = (k, id) => { const c = used(k, id); return c === 1 ? "1 post" : c + " posts"; };
  const initials = (name) => String(name || "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  host.innerHTML = `<p class="bl-lbl">Categories</p>
    ${lists.categories.map((c, i) => `<div class="bl-row"><div class="bl-rowtext"><strong>${esc(c.name)}</strong><span>${n("category", c.id)}</span></div><button type="button" class="textact" data-cren="${i}">Rename</button><button type="button" class="textact bl-x" data-crm="${i}">Remove</button></div>`).join("") || `<p class="bl-empty">None yet. Each category gets its own page on your site.</p>`}
    <button type="button" class="bs-addline textact" data-cadd>+ New category</button>
    <p class="bl-lbl">Authors</p>
    ${lists.authors.map((a, i) => { const m = a.photo_media_id ? (S.media || []).find((x) => x.id === a.photo_media_id) : null;
      return `<div class="bl-row"><span class="bl-av">${m && m.thumb ? `<img src="${esc(m.thumb)}" alt="">` : esc(initials(a.name))}</span><div class="bl-rowtext"><strong>${esc(a.name)}</strong><span>${esc((a.bio ? a.bio + " · " : "") + n("author", a.id))}</span></div><button type="button" class="textact" data-aed="${i}">Edit</button><button type="button" class="textact" data-aph="${i}">Photo</button><button type="button" class="textact bl-x" data-arm="${i}">Remove</button></div>`; }).join("") || `<p class="bl-empty">Nobody yet.</p>`}
    <button type="button" class="bs-addline textact" data-aadd>+ Add an author</button>
    <p class="hint">An author is a name, an optional photo and one line about them. They show on every post that person wrote. Removing a category keeps its posts; they just lose the label.</p>`;
  const cats = () => blogLists().categories.map((c) => ({ ...c })), aus = () => blogLists().authors.map((a) => ({ ...a }));
  const save = async (field, next) => { if (await blogListsPut(field, next)) paintBlogLists(); };
  host.querySelector("[data-cadd]").addEventListener("click", async () => { const v = await askText("A new category", { hint: "Like News, Recipes or Events.", ok: "Add it" }); if (v && v.trim()) save("post_categories", [...cats(), { name: v.trim() }]); });
  host.querySelector("[data-aadd]").addEventListener("click", async () => {
    const name = await askText("Their name", { ok: "Next" }); if (!name || !name.trim()) return;
    const bio = await askText("One line about them", { hint: "Like “Owner and head chef”. Leave it empty for none.", ok: "Add" });
    save("post_authors", [...aus(), { name: name.trim(), ...(bio && bio.trim() ? { bio: bio.trim() } : {}) }]);
  });
  host.querySelectorAll("[data-cren]").forEach((b) => b.addEventListener("click", async () => { const list = cats(), c = list[+b.dataset.cren]; const v = await askText("Rename the category", { value: c.name, ok: "Rename" }); if (v && v.trim() && v.trim() !== c.name) { c.name = v.trim(); save("post_categories", list); } }));
  host.querySelectorAll("[data-crm]").forEach((b) => b.addEventListener("click", async () => { const list = cats(), c = list[+b.dataset.crm]; if (await askYes(`Remove the category “${c.name}”? Its posts stay; they just lose the label.`, { ok: "Remove it", danger: true })) save("post_categories", list.filter((x) => x.id !== c.id)); }));
  host.querySelectorAll("[data-aed]").forEach((b) => b.addEventListener("click", async () => {
    const list = aus(), a = list[+b.dataset.aed];
    const name = await askText("Their name", { value: a.name, ok: "Next" }); if (name == null || !name.trim()) return;
    const bio = await askText("One line about them", { value: a.bio || "", hint: "Leave it empty for none.", ok: "Save" }); if (bio == null) return;
    a.name = name.trim(); if (bio.trim()) a.bio = bio.trim(); else delete a.bio; save("post_authors", list);
  }));
  host.querySelectorAll("[data-aph]").forEach((b) => b.addEventListener("click", () => { const list = aus(), a = list[+b.dataset.aph]; closeSheet("blogListsScrim"); openPicker((id) => { if (id === undefined) return; if (id) a.photo_media_id = id; else delete a.photo_media_id; save("post_authors", list).then(() => openBlogLists()); }); }));
  host.querySelectorAll("[data-arm]").forEach((b) => b.addEventListener("click", async () => { const list = aus(), a = list[+b.dataset.arm]; if (await askYes(`Remove ${a.name} from your authors? Their posts stay, without a name on them.`, { ok: "Remove", danger: true })) save("post_authors", list.filter((x) => x.id !== a.id)); }));
}
async function openPost(p) {
  let studio;
  try { studio = await loadBlogStudio(); } catch (_) { toast("The writing screen didn’t load. Check your connection and try again.", true); return; }
  studio.open(p, blogHost());
}
/* add lines for the three collections */
function inlineAdd(wrapId, fields, onAdd, addLabel) {
  const wrap = $(wrapId);
  if (wrap.querySelector(".editor")) { wrap.innerHTML = ""; return; }
  wrap.innerHTML = "";
  const ed = el("div", "editor");
  ed.innerHTML = fields.map(([k, label, kind, max, ph]) => `
    <div class="field"><label>${label}</label>${kind === "textarea"
      ? `<textarea data-k="${k}" aria-label="${label}" maxlength="${max}" placeholder="${ph || ""}"></textarea>`
      : `<input type="text" data-k="${k}" aria-label="${label}" maxlength="${max}" placeholder="${ph || ""}">`}</div>`).join("") + `
    <div class="eacts"><button class="pillbtn inked" data-act="add">${addLabel}</button><button class="quietact" data-act="cancel">Never mind</button></div>`;
  ed.querySelector('[data-act="cancel"]').addEventListener("click", () => wrap.innerHTML = "");
  ed.querySelector('[data-act="add"]').addEventListener("click", async () => {
    const body = {}; ed.querySelectorAll("[data-k]").forEach((i) => body[i.dataset.k] = i.value.trim());
    await onAdd(body, () => (wrap.innerHTML = ""));
  });
  wrap.appendChild(ed);
  ed.querySelector("input,textarea").focus();
}
/* ── the writing desk (M9.5A write · M9.5B improve) — only when asked ── */
const DESK = { mode: "write", kind: null, view: null, targetId: null, action: "rewrite" };
const DESK_KINDS = {
  faqs: { sub: "A few answered questions, written from your facts — you keep only what reads right." },
  post: { sub: "An update for your Updates page — seasonal note, announcement, news." },
  identity_copy: { sub: "Your description, tagline, or story — in your voice, from your facts." },
  edit_faq: { sub: "The same question and answer, improved — every fact stays; you see before and after." },
  edit_post: { sub: "The same update, improved — every fact stays; you see before and after." },
  site_polish: { sub: "One pass over your written words — description, answers, item descriptions — improved in place. Nothing is added, nothing invented, and you review everything." },
};
function openDesk(kind, view) {
  DESK.mode = "write"; DESK.kind = kind; DESK.view = view; DESK.targetId = null;
  $("deskTitle").innerHTML = '<span class="aimark">✦</span> Draft it with help';
  $("deskSub").textContent = DESK_KINDS[kind]?.sub || "";
  $("deskInstructions").parentElement.hidden = false;
  $("deskInstructions").value = ""; $("deskResults").innerHTML = "";
  $("deskGo").hidden = false; $("deskGo").disabled = false; $("deskGo").textContent = "Write the drafts";
  openSheet("deskScrim");
}
function openEditDesk(kind, view, targetId, action) {
  DESK.mode = "edit"; DESK.kind = kind; DESK.view = view; DESK.targetId = targetId || null; DESK.action = action || "rewrite";
  $("deskTitle").innerHTML = '<span class="aimark">✦</span> Improve it with help';
  $("deskSub").textContent = DESK_KINDS[kind]?.sub || "";
  $("deskInstructions").parentElement.hidden = false;
  $("deskInstructions").value = ""; $("deskResults").innerHTML = "";
  $("deskGo").hidden = false; $("deskGo").disabled = false; $("deskGo").textContent = "Suggest improvements";
  openSheet("deskScrim");
}
$("deskGo").addEventListener("click", async () => {
  const btn = $("deskGo");
  btn.disabled = true; btn.textContent = DESK.mode === "edit" ? "Reading it over…" : "Writing…";
  $("deskResults").innerHTML = `<div class="loadline" style="padding:10px 0"><div class="lq">${DESK.mode === "edit" ? "Improving your wording…" : "Writing a draft…"}</div><div class="shimmer"></div></div>`;
  try {
    const r = DESK.mode === "edit"
      ? await api("POST", "/editor/improve", { kind: DESK.kind, action: DESK.action, target_id: DESK.targetId || undefined, instructions: $("deskInstructions").value.trim() })
      : await api("POST", "/writer/generate", { kind: DESK.kind, instructions: $("deskInstructions").value.trim() });
    const d = await api("GET", `/writer/drafts/${r.data.draft_id}`);
    renderDeskOptions(d.data);
    btn.hidden = true;
  } catch (err) {
    $("deskResults").innerHTML = "";
    btn.disabled = false; btn.textContent = "Try again";
    toast(nice(err), true);
  }
});
// Item 95: a proposed change names its field as the form above it does ("Search description"),
// not by its storage key ("seo description").
function fieldName(k) {
  const lb = document.querySelector('label[for="f-' + k + '"]');
  const t = lb && lb.textContent.trim().replace(/\s*\([^)]*\)\s*$/, "");   // "Search headline (SEO title)" → "Search headline"
  if (t) return t;
  const w = String(k).replace(/_/g, " ").replace(/^seo /, "search ");
  return w.charAt(0).toUpperCase() + w.slice(1);
}
function payloadPreview(p) {
  const bits = [];
  if (p.identity) for (const [k, v] of Object.entries(p.identity)) bits.push(`${fieldName(k)}: ${v}`);
  if (p.faqs) for (const f of p.faqs) bits.push(`Q: ${f.question}\nA: ${f.answer}`);
  if (p.post) bits.push(`${p.post.title}\n\n${p.post.body_md}`);
  if (p.offering_descriptions) for (const o of p.offering_descriptions) bits.push(o.description);
  if (p.document) bits.push(`${p.document.title}\n\n${p.document.body}`);
  return bits.join("\n\n");
}
function renderDeskOptions(draft) {
  const wrap = $("deskResults"); wrap.innerHTML = "";
  if (draft.missing_facts && draft.missing_facts.length) {
    const mf = el("p", "aihint", "It would help to know: " + draft.missing_facts.join(" · "));
    mf.style.marginBottom = "12px";
    wrap.appendChild(mf);
  }
  (draft.options || []).forEach((o, i) => {
    const card = el("div", "deskopt");
    card.appendChild(el("div", "dol", "✦ " + (o.label || o.tone)));
    if (o.compare) {
      // the compare view: before → after → what changed → why → benefit
      const before = el("div", "dop");
      before.style.cssText = "color:var(--ink-2);text-decoration:line-through 1px;max-height:110px;font-size:12.5px";
      before.textContent = Object.values(o.compare.before || {}).join("\n\n").slice(0, 600);
      card.appendChild(before);
    }
    card.appendChild(el("div", "dop", payloadPreview(o.payload)));
    if (o.compare) {
      const meta = el("p", "aihint");
      meta.textContent = `What changed: ${o.compare.change_summary}. Why: ${o.compare.why}. The gain: ${o.compare.expected_benefit}.`;
      meta.style.marginTop = "8px";
      card.appendChild(meta);
    }
    const acts = el("div", "doa");
    const keep = el("button", "pillbtn inked", "Keep this one");
    keep.addEventListener("click", async () => {
      keep.disabled = true; keep.textContent = "Placing it in your draft…";
      try {
        const r = await api("POST", `/writer/drafts/${draft.id}/accept`, { option: i });
        closeSheet("deskScrim");
        toast(r.data.note);
        await refreshAll();                     // everything the acceptance touched, reloaded
        if (DESK.view) go(DESK.view);
      } catch (err) { keep.disabled = false; keep.textContent = "Keep this one"; toast(nice(err), true); }
    });
    acts.appendChild(keep);
    wrap.appendChild(card);
  });
  const none = el("button", "quietact", "None of these — discard them all");
  none.addEventListener("click", async () => {
    try { await api("POST", `/writer/drafts/${draft.id}/discard`); } catch { /* already gone is fine */ }
    closeSheet("deskScrim");
  });
  wrap.appendChild(none);
}

/* ── the review desk (M9.5C) — findings only; fixes go through the Editor ── */
const EDIT_KIND_VIEW = { edit_identity: "business", edit_faq: "faqs", edit_offering: "offerings", edit_post: "updates", site_polish: "business" };
const WRITE_KIND_VIEW = { faqs: "faqs", identity_copy: "business", post: "updates" };
// ── M9.5G: ONE door into looking things over — tasks, not tools ──
function openStudioDesk() {
  DESK.mode = "review"; DESK.kind = null; DESK.view = "business";
  $("deskTitle").innerHTML = '<span class="aimark">✦</span> Get a review';
  $("deskSub").textContent = "Pick what you’d like help with. Nothing changes without you.";
  $("deskInstructions").value = ""; $("deskInstructions").parentElement.hidden = true;
  $("deskGo").hidden = true;
  const wrap = $("deskResults"); wrap.innerHTML = "";
  const opts = [
    ["Review", "A read-through of your wording and brand, in one report. Nothing changes.", openCombinedReviewDesk],
  ];
  // "Plan" is the Growth Coach — a Business-OS surface; a standalone CMS omits it.
  if (hasFeature("business_moments")) opts.push(["Plan", "What’s coming up: holidays, seasons and busy times worth preparing for.", openCoachDesk]);
  opts.push(["Polish", "One pass over all your wording. You approve every change.", () => { closeSheet("deskScrim"); openEditDesk("site_polish", "business", null, "readability"); }]);
  opts.forEach(([name, sub, go]) => {
    const card = el("div", "deskopt");
    card.appendChild(el("div", "dol", name));
    const p = el("p", "aihint", sub); p.style.marginTop = "6px";
    card.appendChild(p);
    const acts = el("div", "doa");
    const b = el("button", "textact", "✦ " + name);
    b.addEventListener("click", go);
    acts.appendChild(b);
    card.appendChild(acts);
    wrap.appendChild(card);
  });
  openSheet("deskScrim");
}
// ── the ONE review surface: writing quality + brand voice, one report ──
// (two engines behind it — the Reviewer and the Guardian — but the customer
//  meets a single read-through; brand concerns are the Guardian's alone)
async function openCombinedReviewDesk() {
  DESK.mode = "review"; DESK.kind = null; DESK.view = "business";
  $("deskTitle").innerHTML = '<span class="aimark">✦</span> A look over your website';
  $("deskSub").textContent = "How it reads, and whether it sounds like you — one report. Nothing changes; every note can be dismissed or handed off for improving.";
  $("deskInstructions").value = ""; $("deskInstructions").parentElement.hidden = true;
  $("deskResults").innerHTML = `<div class="loadline" style="padding:10px 0"><div class="lq">Reviewing your wording…</div><div class="shimmer"></div></div>`;
  $("deskGo").hidden = true;
  openSheet("deskScrim");
  try {
    const [rRun, bRun] = await Promise.all([
      api("POST", "/review/run", { scope: "site" }),
      api("POST", "/brand/review", { scope: "site" }),
    ]);
    const [rRep, bRep] = await Promise.all([
      api("GET", `/review/reports/${rRun.data.review_id}`),
      api("GET", `/brand/reports/${bRun.data.report_id}`),
    ]);
    const wrap = $("deskResults"); wrap.innerHTML = "";
    const n1 = renderFindingsInto(wrap, rRep.data, "/review/reports", "How it reads");
    const n2 = renderFindingsInto(wrap, bRep.data, "/brand/reports", "Whether it sounds like you");
    if (!n1 && !n2) {
      wrap.innerHTML = `<div class="estate" style="padding:20px 0"><div class="eq">Your wording looks good.</div><div class="eh">Nothing to flag.</div></div>`;
    }
  } catch (err) {
    $("deskResults").innerHTML = "";
    toast(nice(err), true);
  }
}
function renderFindingsInto(wrap, report, reportBase, heading) {
  const open = (report.findings || []).filter((f) => f.status === "open");
  if (!open.length) return 0;
  const h = el("h5", "rune", heading);
  h.style.marginTop = wrap.childNodes.length ? "26px" : "4px";
  wrap.appendChild(h);
  open.forEach((f) => {
    const card = el("div", "deskopt");
    card.appendChild(el("div", "dol", f.category.replace(/_/g, " ")));
    card.appendChild(el("div", "dop", f.finding));
    const meta = el("p", "aihint", `Why it matters: ${f.reason} The gain: ${f.expected_benefit}. ${f.suggested_action}`);
    meta.style.marginTop = "6px";
    card.appendChild(meta);
    if ((f.supporting_evidence || []).length) {
      const q = el("p", "aihint", "From your page: “" + f.supporting_evidence[0] + "”");
      q.style.marginTop = "4px";
      card.appendChild(q);
    }
    const acts = el("div", "doa");
    if (f.handoff && f.handoff.route === "editor") {
      const fix = el("button", "textact", "✦ Fix with help");
      fix.addEventListener("click", () => { closeSheet("deskScrim"); openEditDesk(f.handoff.kind, EDIT_KIND_VIEW[f.handoff.kind] || "business", f.handoff.target_id || null, f.handoff.action || "rewrite"); });
      acts.appendChild(fix);
    } else if (f.handoff && f.handoff.route === "writer") {
      const write = el("button", "textact", "✦ Draft it with help");
      write.addEventListener("click", () => { closeSheet("deskScrim"); openDesk(f.handoff.kind, WRITE_KIND_VIEW[f.handoff.kind] || "business"); });
      acts.appendChild(write);
    }
    const dis = el("button", "quietact", "Dismiss");
    dis.addEventListener("click", async () => {
      try { await api("POST", `${reportBase}/${report.id}/dismiss`, { finding_id: f.review_id }); card.remove(); }
      catch (err) { toast(nice(err), true); }
    });
    acts.appendChild(dis);
    card.appendChild(acts);
    wrap.appendChild(card);
  });
  return open.length;
}

// ── M9.5E: the Growth Coach — timed opportunities; every decision is the customer's ──
async function openCoachDesk() {
  DESK.mode = "review"; DESK.kind = null; DESK.view = "business";
  $("deskTitle").innerHTML = '<span class="aimark">✦</span> Worth planning for';
  $("deskSub").textContent = "What’s coming up for the business — holidays, seasons, small openings the site is showing. Nothing happens unless you start it; ignoring any of these is always fine.";
  $("deskInstructions").value = ""; $("deskInstructions").parentElement.hidden = true;
  $("deskResults").innerHTML = `<div class="loadline" style="padding:10px 0"><div class="lq">Checking what’s coming up…</div><div class="shimmer"></div></div>`;
  $("deskGo").hidden = true;
  openSheet("deskScrim");
  try {
    await api("POST", "/coach/run");
    const r = await api("GET", "/coach/opportunities");
    renderCoachOpps(r.data || []);
  } catch (err) {
    $("deskResults").innerHTML = "";
    toast(nice(err), true);
  }
}
function renderCoachOpps(opps) {
  const wrap = $("deskResults"); wrap.innerHTML = "";
  if (!opps.length) {
    wrap.innerHTML = `<div class="estate" style="padding:20px 0"><div class="eq">Nothing coming up.</div><div class="eh">Check back as seasons and holidays get closer.</div></div>`;
    return;
  }
  opps.forEach((o) => {
    const card = el("div", "deskopt");
    card.appendChild(el("div", "dol", (o.timing_phrase || o.area.replace(/_/g, " "))));
    card.appendChild(el("div", "dop", o.opportunity));
    const meta = el("p", "aihint", `Why now: ${o.why_it_matters} The gain: ${o.expected_benefit}. Effort: ${o.estimated_effort}.`);
    meta.style.marginTop = "6px";
    card.appendChild(meta);
    if ((o.supporting_evidence || []).length) {
      const q = el("p", "aihint", o.supporting_evidence.map((e) => e.detail).join(" · "));
      q.style.marginTop = "4px";
      card.appendChild(q);
    }
    const next = el("p", "aihint", `First step: ${o.suggested_next_step}`);
    next.style.marginTop = "4px";
    card.appendChild(next);
    const acts = el("div", "doa");
    const start = el("button", "textact", o.ai_can_draft ? "✦ Start it with help" : "I’ll take it on");
    start.addEventListener("click", async () => {
      try {
        const d = await api("POST", `/coach/opportunities/${o.id}/decide`, { decision: "accept" });
        const h = d.data.handoff;
        if (h && h.route === "writer") {
          closeSheet("deskScrim");
          openDesk(h.kind, WRITE_KIND_VIEW[h.kind] || "business");
          if (h.brief) $("deskInstructions").value = h.brief;
        } else if (h && h.route === "editor") {
          closeSheet("deskScrim");
          openEditDesk(h.kind, EDIT_KIND_VIEW[h.kind] || "business", h.target_id || null, h.action || "rewrite");
        } else {
          card.remove(); toast("Yours to run with — the first step is written above.");
        }
      } catch (err) { toast(nice(err), true); }
    });
    acts.appendChild(start);
    const later = el("button", "quietact", "Later");
    later.addEventListener("click", async () => {
      try { await api("POST", `/coach/opportunities/${o.id}/decide`, { decision: "defer" }); card.remove(); toast("Set aside — it’ll come back around."); }
      catch (err) { toast(nice(err), true); }
    });
    acts.appendChild(later);
    const dis = el("button", "quietact", "Not for us");
    dis.addEventListener("click", async () => {
      try { await api("POST", `/coach/opportunities/${o.id}/decide`, { decision: "dismiss" }); card.remove(); }
      catch (err) { toast(nice(err), true); }
    });
    acts.appendChild(dis);
    card.appendChild(acts);
    wrap.appendChild(card);
  });
}

$("btnAddFaq").addEventListener("click", () => inlineAdd("faqAddWrap",
  [["question","The question","text",200,"Do you take walk-ins?"],["answer","Your answer","textarea",2000,""]],
  async (b, done) => {
    if (!b.question || !b.answer) { toast("Both the question and your answer are needed.", true); return; }
    try { const r = await api("POST", "/faqs", b); S.faqs.push(r.data); done(); renderFaqs(); toast("Answered"); scheduleChangesRefresh(); }
    catch (err) { toast(nice(err), true); }
  }, "Keep this answer"));
// ── M12: Platform Services — the technical side, in plain words ──
let DESK_DOMAIN_INTENT = false;   // open the desk with the "I already have a domain" field ready (overview card, nav, setup step)
async function openFoundationsDesk(opts) {
  DESK_DOMAIN_INTENT = !!(opts && opts.domain);
  if (window.ddsHint) setTimeout(() => window.ddsHint("foundations", "Any change to your domain, email or security comes as a plan you approve first. Nothing changes on its own."), 400);
  DESK.mode = "review"; DESK.kind = null; DESK.view = "business";
  $("deskTitle").textContent = "Domain & email";
  $("deskSub").textContent = "Your domain, its records, the padlock, email, and hosting — what’s true right now, in plain words. Any change arrives as a plan you approve first.";
  $("deskInstructions").value = ""; $("deskInstructions").parentElement.hidden = true;
  $("deskResults").innerHTML = `<div class="loadline" style="padding:10px 0"><div class="lq">Loading your domain and email…</div><div class="shimmer"></div></div>`;
  $("deskGo").hidden = true;
  openSheet("deskScrim");
  try {
    // builder item 194 (findings 18 and 25): the launch list is off this sheet. It was a second,
    // weaker checklist (a parked domain got ticks while the card under it said "two steps left"),
    // and asking for it read the domain's records a second time on every open.
    const [f, plans, dom] = await Promise.all([api("GET", "/foundations"), api("GET", "/foundations/plans"), api("GET", "/foundations/domain").catch(() => ({ data: null }))]);
    renderFoundations(f.data, plans.data || [], dom && dom.data);
  } catch (err) {
    $("deskResults").innerHTML = "";
    toast(nice(err), true);
  }
}
function renderFoundations(f, plans, dom) {
  const wrap = $("deskResults"); wrap.innerHTML = "";
  // Nov 12 review, finding 13: plans the server finished on this very open (their records were found)
  const clearedPlans = Array.isArray(f.cleared_plans) ? f.cleared_plans : [];

  const section = (label, sentence) => {
    const card = el("div", "deskopt");
    card.appendChild(el("div", "dol", label));
    const p = el("p", "aihint", sentence); p.style.marginTop = "6px";
    card.appendChild(p);
    wrap.appendChild(card);
    return card;
  };
  // ── Your domain — a plain-language, step-by-step wizard (no AI, just clear steps).
  //    Self-serve over the complete attach→SSL→verify core; an operator scoped into
  //    a client gets the same card, so it serves both.
  const domCard = el("div", "deskopt");
  domCard.appendChild(el("div", "dol", "your domain"));
  const dstat = (dom && dom.custom_domain) ? dom : null;
  const stepLine = (t) => { const p = el("p", "aihint", t); p.style.marginTop = "5px"; return p; };
  // item 163 (review domains finding 11): taking the site off its address asks for the name typed
  // back, not one yes (the server checks it too); the owner and the studio are emailed
  const removeBtn = (label) => { const rm = el("button", "textact", label); rm.dataset.needs = "configure"; rm.style.opacity = "0.7"; rm.addEventListener("click", async () => {
    const typed = await askText("Remove " + dstat.custom_domain + "?", { hint: "Your site goes back to its built-in address, and anyone who types " + dstat.custom_domain + " stops reaching it. To remove it, type the domain here.", placeholder: dstat.custom_domain, ok: "Remove domain" });
    if (typed === null) return;
    if (String(typed).trim().toLowerCase() !== String(dstat.custom_domain).toLowerCase()) { toast("That doesn’t match " + dstat.custom_domain + ", so nothing was removed.", true); return; }
    const confirm = String(typed).trim();
    // item 191: removing it asks for a fresh code first (fresh-code.js); the refusal that asks is an answer, not a fault
    const send = (extra) => api("DELETE", "/foundations/domain", { confirm, ...extra }).then((d) => ({ ok: true, status: 200, body: d }), (err) => ({ ok: false, status: err.status || 0, body: err.body || { message: nice(err) } }));
    const r = window.ddsFresh ? await window.ddsFresh.run(send, { sb }) : await send({});
    if (r.cancelled) return;
    if (!r.ok) { toast((r.body && r.body.message) || "That didn’t go through. Nothing was removed.", true); return; }
    toast("Domain removed."); openFoundationsDesk(); }); return rm; };
  // item 163 (finding 12): a new domain can keep the old one working, sending its visitors on
  const changeBtn = () => { const b = el("button", "textact", "Change to a different domain"); b.dataset.needs = "configure"; b.dataset.change = "domain"; b.addEventListener("click", async () => {
    const ans = await askDomainChange(dstat.custom_domain);
    if (!ans) return;
    try { await api("POST", "/foundations/domain", { domain: ans.domain, keep_old: ans.keepOld }); toast(ans.keepOld ? "Changed. " + dstat.custom_domain + " sends visitors on to " + ans.domain + " from your next publish." : "Changed to " + ans.domain + "."); openFoundationsDesk(); }
    catch (err) { toast(nice(err), true); } }); return b; };

  if (dstat && dstat.health === "ok") {
    // item 134 (Nov 2026 review, domains findings 3 and 5): "live and secure" only when every
    // check passes (both names point here, nothing old left over, the padlock covers both, and
    // the domain shows THIS site); otherwise say what's left. No checklist, no claim.
    // Nov 12 review, finding 16: with no checklist the checks didn't run, so nothing is claimed.
    // A missing list used to read as "everything passed" and showed the green tick.
    const lines = Array.isArray(dstat.checklist) ? dstat.checklist : null;
    const allOk = !!lines && dstat.all_ok === true;
    const p = el("p", "aihint", !lines ? "We couldn’t check " + dstat.custom_domain + " just now." : allOk ? "✓ " + dstat.custom_domain + " is live and secure." : dstat.custom_domain + " is connected, with something left to finish:"); p.style.marginTop = "6px"; p.style.fontWeight = "600"; p.dataset.domain = !lines ? "unchecked" : allOk ? "live" : "left"; domCard.appendChild(p);
    if (!lines) { const again = el("button", "textact", "Check again"); again.dataset.check = "again"; again.addEventListener("click", () => openFoundationsDesk()); domCard.appendChild(again); }
    if (lines) lines.forEach((c) => { const l = stepLine((c.ok ? "✓ " : "• ") + String(c.words || "")); l.dataset.check = c.ok ? "ok" : "todo"; if (c.ok) l.style.color = "var(--soft,#6b6478)"; domCard.appendChild(l); });
    // item 174 (Squarespace's Primary tag and "Use www" switch): which name is the main one, and switching it
    const bareN = String(dstat.custom_domain).replace(/^www\./, "");
    if (/^[^.]+\.[^.]+$/.test(bareN)) {
      const twin = String(dstat.custom_domain).startsWith("www.") ? bareN : "www." + bareN;
      const pm = stepLine("Main name: " + dstat.custom_domain + ". " + twin + " sends visitors there."); pm.dataset.main = "name"; domCard.appendChild(pm);
      const sw = el("button", "textact", "Make " + twin + " the main name"); sw.dataset.needs = "configure"; sw.dataset.main = "switch";
      sw.addEventListener("click", async () => {
        if (!(await askYes("Make " + twin + " the main name?\n" + dstat.custom_domain + " keeps working and sends visitors there.", { ok: "Make it the main name" }))) return;
        try { await api("POST", "/foundations/domain", { domain: twin }); toast(twin + " is the main name now."); openFoundationsDesk(); } catch (err) { toast(nice(err), true); }
      });
      domCard.appendChild(sw);
    }
    const live = el("div", "doa"); live.style.cssText = "gap:8px;flex-wrap:wrap;margin-top:8px"; live.appendChild(changeBtn()); live.appendChild(removeBtn("Remove this domain")); domCard.appendChild(live);
  } else if (dstat) {
    // Attached — walk them through the two records; it goes live on its own after.
    if (dstat.health === "ssl_pending") {
      // builder item 194 (finding 21): "nothing for you to do" was decided from one name alone, so a
      // missing www. record showed up later. Both names are checked first.
      const missing = (Array.isArray(dstat.names) ? dstat.names : []).filter((n) => n && n.points === false).map((n) => n.name);
      const p = el("p", "aihint", missing.length ? dstat.custom_domain + ": its record is in. One more to add, for " + missing.join(" and ") + ":" : dstat.custom_domain + ": your records are in. The padlock is being switched on. Nothing for you to do."); p.style.marginTop = "6px"; p.style.fontWeight = "600"; p.dataset.domain = missing.length ? "one-more" : "padlock"; domCard.appendChild(p);
      (Array.isArray(dstat.records) ? dstat.records : []).filter((r) => missing.includes(r.name)).forEach((r) => domCard.appendChild(dnsRecordRow(r.type, r.host, r.value)));
    } else {
      // item 162, part two (review domains findings 6 and 7): the company that runs this domain's
      // records, by name, with its sign-in page; the steps used to guess "GoDaddy, Namecheap"
      const recAt = dstat.provider && dstat.provider.records_at;
      const p = el("p", "aihint", dstat.custom_domain + " — almost there. Two quick steps " + (recAt ? "at " + recAt.company : "where your domain’s settings are kept") + ":"); p.style.marginTop = "6px"; p.style.fontWeight = "600"; domCard.appendChild(p);
      const apex = (dstat.dns && dstat.dns.expected_apex_ip && dstat.dns.expected_apex_ip[0]) || "75.2.60.5";
      const cname = (dstat.dns && dstat.dns.expected_cname) || "your site’s built-in address";
      if (recAt) {
        const s1 = stepLine("1. Sign in to " + recAt.company + (recAt.path ? ", then open " + recAt.path : "") + ". "); s1.dataset.step = "provider";
        if (recAt.sign_in) { const a = el("a", null, "Sign in to " + recAt.company + " ↗"); a.href = recAt.sign_in; a.target = "_blank"; a.rel = "noopener"; a.style.cssText = "color:var(--plum,#5b3fa0);font-weight:600;white-space:nowrap;text-decoration:underline"; s1.appendChild(a); }
        domCard.appendChild(s1);
      } else domCard.appendChild(stepLine("1. Sign in where your domain’s settings are kept: usually the company you bought it from."));   // item 164 (finding 18): no "DNS", no guessed company
      // builder item 194 (finding 19): the records come from the server. A sub-name (shop.x.com)
      // gets ONE record for itself; it used to be shown "@" and "www", which the check never
      // looks at and which can take over the main site.
      const recs = Array.isArray(dstat.records) && dstat.records.length ? dstat.records.map((r) => [r.type, r.host, r.value || cname]) : [["A", "@", apex], ["CNAME", "www", cname]];
      const s2 = stepLine(recs.length === 1 ? "2. Add this one record exactly — tap Copy so there are no typos:" : "2. Add these two records exactly — tap Copy so there are no typos:"); s2.dataset.step = "records"; domCard.appendChild(s2);
      recs.forEach(([type, name, val]) => domCard.appendChild(dnsRecordRow(type, name, val)));
      // item 163 (review domains finding 14): the records marked MX are the client's email
      const mxLine = stepLine("Leave anything marked MX or Mail alone: that’s your email."); mxLine.dataset.step = "mail"; domCard.appendChild(mxLine);
      // item 164 (review domains finding 16): which name visitors end up on, said plainly
      const bareName = String(dstat.custom_domain).replace(/^www\./, "");
      if (/^[^.]+\.[^.]+$/.test(bareName)) { const mn = stepLine("Visitors who type " + bareName + " or www." + bareName + " end up on " + dstat.custom_domain + "."); mn.dataset.step = "main"; domCard.appendChild(mn); }
      const s3 = stepLine("That’s everything. We look again each time you open this, and every day."); s3.style.color = "var(--soft,#6b6478)"; s3.style.marginTop = "8px"; domCard.appendChild(s3);
    }
    domCard.appendChild(waitSteps(dstat, dom));   // item 164 (review domains finding 13): where it stands, with times
    const acts = el("div", "doa"); acts.style.marginTop = "8px"; acts.style.gap = "8px";
    const chk = el("button", "textact", "Check if it’s ready"); chk.addEventListener("click", () => openFoundationsDesk()); acts.appendChild(chk);
    acts.appendChild(changeBtn()); acts.appendChild(removeBtn("Remove")); domCard.appendChild(acts);
  } else {
    // No domain yet — the branching intro, plain language, two clear choices.
    domCard.appendChild(stepLine("Right now your site is at its built-in address. Want it on your own domain, like yourbusiness.com?"));   // item 164 (finding 18): it's permanent and working, not "temporary"
    domCard.appendChild(askOwner("aihint", "Ask the account owner to connect it."));
    const choose = el("div", "doa"); choose.dataset.needs = "configure"; choose.style.cssText = "gap:8px;margin-top:8px;flex-wrap:wrap";
    const haveBtn = el("button", "textact", "I already have a domain"); haveBtn.style.cssText = "border:2px solid var(--plum,#5b3fa0);background:var(--plum-tint,#faf7ff);color:var(--plum-deep,#3a2470);border-radius:999px;padding:7px 14px;font:inherit;font-weight:600;cursor:pointer";
    const needBtn = el("button", "textact", "I need to get one"); needBtn.style.cssText = "border:1px solid var(--line,#ddd);background:transparent;border-radius:999px;padding:7px 14px;font:inherit;cursor:pointer";
    choose.appendChild(haveBtn); choose.appendChild(needBtn); domCard.appendChild(choose);

    const havePanel = el("div"); havePanel.dataset.needs = "configure"; havePanel.style.cssText = "display:none;margin-top:10px";
    havePanel.appendChild(stepLine("Type your domain and we’ll connect it. You’ll get the records to add — we handle the rest."));
    const row = el("div", "doa"); row.style.cssText = "gap:8px;flex-wrap:wrap;margin-top:6px";
    const inp = el("input"); inp.type = "text"; inp.placeholder = "yourbusiness.com"; inp.setAttribute("aria-label", "Your domain"); inp.setAttribute("autocomplete", "off");
    inp.style.cssText = "flex:1;min-width:180px;padding:8px 10px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:16px";
    const connectBtn = el("button", "textact", "Connect it →");
    connectBtn.addEventListener("click", async () => {
      const domain = (inp.value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!domain) { toast("Type your domain first (e.g. yourbusiness.com).", true); return; }
      connectBtn.disabled = true;
      try { await api("POST", "/foundations/domain", { domain }); toast("Connected. Here’s what to add."); openFoundationsDesk(); }
      catch (err) { toast(nice(err), true); connectBtn.disabled = false; }
    });
    row.appendChild(inp); row.appendChild(connectBtn); havePanel.appendChild(row);
    // item 162, part two (review domains finding 7): as they type, who sold the domain and who runs
    // its records, so the steps can name the company before anything is attached
    const look = stepLine(""); look.dataset.look = "provider"; look.hidden = true; look.setAttribute("role", "status"); havePanel.appendChild(look);
    let lookT = 0, lookSeq = 0;
    inp.addEventListener("input", () => {
      clearTimeout(lookT);
      const v = (inp.value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[\/?#].*$/, "");
      const seq = ++lookSeq;
      if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(v)) { look.hidden = true; return; }
      lookT = setTimeout(async () => {
        let r = null; try { r = await api("GET", "/foundations/domain/lookup?name=" + encodeURIComponent(v)); } catch (_) { /* the line just stays away */ }
        if (seq !== lookSeq) return;
        const d = r && r.data; look.textContent = "";
        if (!d || d.found === null || d.found === undefined) { look.hidden = true; return; }
        if (d.found === false) { look.textContent = v + " isn’t registered to anyone yet. Buy it at a domain company first, then come back and connect it."; look.hidden = false; return; }
        const rec = d.records_at, ren = d.renew_at;
        const where = rec && ren && rec.company !== ren.company ? "It’s registered at " + ren.company + ", and its records are kept at " + rec.company + ". That’s where you’ll add two records."
          : rec ? "It’s at " + rec.company + ". That’s where you’ll add two records." : "";
        look.appendChild(document.createTextNode("Found it. " + where + " "));
        if (rec && rec.sign_in) { const a = el("a", null, "Sign in to " + rec.company + " ↗"); a.href = rec.sign_in; a.target = "_blank"; a.rel = "noopener"; a.style.cssText = "color:var(--plum,#5b3fa0);font-weight:600;white-space:nowrap;text-decoration:underline"; look.appendChild(a); }
        look.hidden = false;
      }, 600);
    });
    domCard.appendChild(havePanel);

    if (DESK_DOMAIN_INTENT) { DESK_DOMAIN_INTENT = false; setTimeout(() => { haveBtn.click(); inp.focus(); }, 0); }
    const needPanel = el("div"); needPanel.dataset.needs = "configure"; needPanel.style.cssText = "display:none;margin-top:10px";
    // item 164 (review domains finding 17): check a name here, with two or three spellings, then
    // open a domain company with the name filled in. Bought in their own name; no selling by us.
    needPanel.dataset.need = "domain";
    needPanel.appendChild(stepLine("Type a name you’d like and we’ll check whether it’s free."));
    const nrow = el("div", "doa"); nrow.style.cssText = "gap:8px;flex-wrap:wrap;margin-top:6px";
    const ninp = el("input"); ninp.type = "text"; ninp.placeholder = "yourbusiness"; ninp.setAttribute("aria-label", "A name you’d like"); ninp.setAttribute("autocomplete", "off");
    ninp.style.cssText = "flex:1;min-width:180px;padding:8px 10px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;font-size:16px";
    const nbtn = el("button", "textact", "Check");
    nrow.appendChild(ninp); nrow.appendChild(nbtn); needPanel.appendChild(nrow);
    const nout = el("div"); nout.dataset.need = "results"; nout.setAttribute("role", "status"); needPanel.appendChild(nout);
    // item 222 (review file 04, finding 4): the first year is often the cheap one; said before they buy
    const renew = el("div", "renewwarn"); renew.dataset.need = "renewal";
    renew.innerHTML = '<span class="rwi" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1"/></svg></span><span><b>Check the renewal price before you buy</b>The first year is often cheap, and the price after that can be much higher. Each company shows what it costs to renew, the price you’ll pay every year after.</span>';
    needPanel.appendChild(renew);
    const firm = stepLine("Buy it in your own name and email, and turn on auto-renew. Then come back and tap “I already have a domain.”"); firm.style.marginTop = "8px"; needPanel.appendChild(firm);
    const BUY = [["Namecheap", (n) => "https://www.namecheap.com/domains/registration/results/?domain=" + encodeURIComponent(n)], ["Porkbun", (n) => "https://porkbun.com/checkout/search?q=" + encodeURIComponent(n)], ["GoDaddy", (n) => "https://www.godaddy.com/domainsearch/find?domainToCheck=" + encodeURIComponent(n)]];
    let nseq = 0;
    const checkName = async () => {
      const raw = String(ninp.value || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[\/?#].*$/, "");
      const clean = (raw.includes(".") ? raw.split(".")[0] : raw).replace(/[^a-z0-9-]+/g, "").replace(/^-+|-+$/g, "");
      if (clean.length < 2) { nout.textContent = "Type a name first, like yourbusiness."; return; }
      const names = [...new Set([/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(raw) ? raw : clean + ".com", clean + ".com", clean + ".co", "get" + clean + ".com"])].slice(0, 3);
      const seq = ++nseq; nbtn.disabled = true; nout.textContent = "Checking…";
      const res = await Promise.all(names.map((n) => api("GET", "/foundations/domain/lookup?name=" + encodeURIComponent(n)).then((r) => [n, r && r.data ? r.data.found : null]).catch(() => [n, null])));
      if (seq !== nseq) return;
      nbtn.disabled = false; nout.textContent = "";
      res.forEach(([n, found]) => {
        const line = stepLine(n + (found === false ? ": free. " : found === true ? ": taken." : ": couldn’t check just now.")); line.dataset.name = n; line.dataset.free = found === false ? "yes" : found === true ? "no" : "unknown";
        if (found === false) BUY.forEach(([co, url], i) => { if (i) line.appendChild(document.createTextNode(" · ")); const a = el("a", null, "Buy at " + co + " ↗"); a.href = url(n); a.target = "_blank"; a.rel = "noopener"; a.style.cssText = "color:var(--plum,#5b3fa0);font-weight:600;white-space:nowrap;text-decoration:underline"; line.appendChild(a); });
        nout.appendChild(line);
      });
    };
    nbtn.addEventListener("click", checkName);
    ninp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); checkName(); } });
    domCard.appendChild(needPanel);

    haveBtn.addEventListener("click", () => { havePanel.style.display = "block"; needPanel.style.display = "none"; setTimeout(() => inp.focus(), 20); });
    needBtn.addEventListener("click", () => { needPanel.style.display = "block"; havePanel.style.display = "none"; });
  }
  // item 162, part two (review domains finding 8): the ready-made guides had no button anywhere.
  // Each press prepares the plan; it lands at the bottom, under "Waiting for your OK".
  if (dstat) {
    const mh = el("div"); mh.dataset.needs = "configure"; mh.dataset.help = "more"; mh.style.marginTop = "12px";
    const h = stepLine("More help with this domain"); h.style.fontWeight = "600"; mh.appendChild(h);
    const acts = el("div", "doa"); acts.style.cssText = "gap:8px;flex-wrap:wrap;margin-top:4px";
    [["registrar_care", "Make sure it renews by itself"], ["connect_domain", "The records my site needs"], ["transfer_out", "Move my domain"]].forEach(([goal, label]) => {
      const b = el("button", "textact", label); b.dataset.goal = goal;
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { await api("POST", "/foundations/prepare", { goal }); toast("Here are the steps. They’re at the bottom, waiting for your OK."); openFoundationsDesk(); }
        catch (err) { toast(nice(err), true); b.disabled = false; }
      });
      acts.appendChild(b);
    });
    mh.appendChild(acts); domCard.appendChild(mh);
  }
  if (dstat) domCard.appendChild(forwardsBlock(dstat));   // item 174: other domains that send visitors here
  // item 163 (review domains finding 11): the domain's history was written and never shown
  const changes = dom && Array.isArray(dom.changes) ? dom.changes : [];
  if (changes.length) {
    const ch = el("div"); ch.dataset.changes = "domain"; ch.style.marginTop = "12px";
    const h = stepLine("Recent changes"); h.style.fontWeight = "600"; ch.appendChild(h);
    changes.forEach((c) => { const d = new Date(c.at); const l = stepLine((isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " · ") + String(c.words || "")); l.style.color = "var(--soft,#6b6478)"; ch.appendChild(l); });
    domCard.appendChild(ch);
  }
  wrap.appendChild(domCard);

  const dnsCard = section("your domain’s records", f.dns.sentence);
  if (f.dns.records.length) {
    const words = (rs) => rs.map((r) => `${r.type} — ${r.plain}`).join(" · ");
    const list = el("p", "aihint", words(f.dns.records.slice(0, 6)));
    list.style.marginTop = "4px";
    dnsCard.appendChild(list);
    // item 162, part two (review domains finding 24): the card stopped at six, so mail and
    // verification records hid behind it
    if (f.dns.records.length > 6) {
      const all = el("button", "textact", "Show all (" + f.dns.records.length + ")"); all.dataset.records = "all";
      all.addEventListener("click", () => { list.textContent = words(f.dns.records); all.remove(); });
      dnsCard.appendChild(all);
    }
  }
  section("security — the padlock in the browser", f.ssl.sentence);
  // ── Email — the same step-by-step treatment as the domain wizard. Four states,
  //    each with a plain next step (never a dead end).
  const emailCard = section("email", f.email.sentence);
  if (!dstat) {
    const p = el("p", "aihint", "Once your domain is connected above, everything email lives here too — a business address and spam protection."); p.style.marginTop = "5px"; emailCard.appendChild(p);
  } else if (!f.email.has_mail) {
    const p = el("p", "aihint", "No email runs on this domain yet. Want an address like you@" + String(dstat.custom_domain).replace(/^www\./, "") + "? Two easy routes:"); p.style.marginTop = "5px"; emailCard.appendChild(p);
    const s1 = el("p", "aihint", "1. The company you bought your domain from usually sells email for a few dollars a month — or Google Workspace works with any domain."); s1.style.marginTop = "4px"; emailCard.appendChild(s1);
    const s2 = el("p", "aihint", "2. Once it’s set up, come back here — we’ll notice it automatically and help you protect it so your mail never lands in spam."); s2.style.marginTop = "4px"; emailCard.appendChild(s2);
    // item 174 (Squarespace's one pick that fills every record): Gmail's records, all of them, ready to copy
    const gm = el("div", "doa"); gm.dataset.needs = "configure"; gm.dataset.pick = "gmail"; gm.style.marginTop = "6px";
    const gb = el("button", "textact", "Set up Gmail on this domain");
    gb.addEventListener("click", async () => {
      gb.disabled = true;
      try { await api("POST", "/foundations/prepare", { goal: "email_setup", provider: "google_workspace" }); toast("Here are Gmail’s records. They’re at the bottom, waiting for your OK."); openFoundationsDesk(); }
      catch (err) { toast(nice(err), true); gb.disabled = false; }
    });
    gm.appendChild(gb); emailCard.appendChild(gm);
  } else if (!(f.email.spf && f.email.dmarc)) {
    const why = el("p", "aihint", "Emails you send from your domain can land in people’s spam. Setting this up adds a few small records that tell inboxes your mail is really from you."); why.style.marginTop = "5px"; emailCard.appendChild(why);
    emailCard.appendChild(askOwner("aihint", "Ask the account owner to set this up."));
    const acts = el("div", "doa"); acts.dataset.needs = "configure"; acts.style.marginTop = "6px";
    // Nov 12 review, finding 13: one plan, not one per press. While its steps wait below, the
    // button gives way to a line that says so (the server hands back the open plan too).
    const waiting = plans.some((p) => p.kind === "email_auth" && (p.status === "proposed" || p.status === "approved") && !clearedPlans.includes(p.id));
    const b = el("button", "textact", "Set up email protection"); b.dataset.email = "protect";
    b.addEventListener("click", async () => {
      b.disabled = true;
      try { const r = await api("POST", "/foundations/prepare", { goal: "email_auth" }); toast(r && r.data && r.data.already ? "Those steps are already below, waiting for you." : "Set up — the records to add are below."); openFoundationsDesk(); }
      catch (err) { toast(nice(err), true); b.disabled = false; }
    });
    if (waiting) { const w = el("p", "aihint", "The records to add are at the bottom, under “Waiting for your OK”."); w.dataset.email = "waiting"; emailCard.appendChild(w); }
    else { acts.appendChild(b); emailCard.appendChild(acts); }
    // finding 14: the records are the ones for whoever runs their email, never Google's by default
    const after = el("p", "aihint", (f.email.provider ? "Your email runs at " + f.email.provider + ", so you’ll get " + f.email.provider + "’s records" : "You’ll get a short list of records") + " to copy-paste where your domain’s settings are kept, and only the ones that are missing. We check the rest."); after.dataset.needs = "configure"; after.dataset.email = "after"; after.style.marginTop = "6px"; after.style.color = "var(--soft,#6b6478)"; emailCard.appendChild(after);
  } else {
    const okp = el("p", "aihint", "✓ All set — inboxes can trust mail from your domain. Nothing to do."); okp.style.marginTop = "5px"; okp.style.fontWeight = "600"; emailCard.appendChild(okp);
  }
  section("where your site lives (hosting)", f.hosting.sentence);

  // ── M14: the right to leave, one button — everything they own, portable ──
  {
    const card = el("div", "deskopt");
    card.appendChild(el("div", "dol", "yours to take"));
    card.appendChild(el("p", "aihint", "Your words, media, brand, redirects, and the rendered website itself — one file, hostable anywhere, no strings. Having the door is the point."));
    const acts = el("div", "doa");
    const b = el("button", "quietact", "Download everything I own");
    b.addEventListener("click", async () => {
      try {
        const r = await api("GET", "/export");
        const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "my-website-export.json";
        a.click();
        URL.revokeObjectURL(a.href);
        toast("Exported. It's all in there — and it's all yours.");
      } catch (err) { toast(nice(err), true); }
    });
    acts.appendChild(b);
    card.appendChild(acts);
    wrap.appendChild(card);
  }

  const open = plans.filter((p) => (p.status === "proposed" || p.status === "approved") && !clearedPlans.includes(p.id));
  if (open.length) {
    const h = el("h5", "rune", "Waiting for your OK");
    h.style.marginTop = "26px";
    wrap.appendChild(h);
    open.forEach((p) => {
      const card = el("div", "deskopt");
      // Nov 12 review, finding 13: an approved plan used to read as being handled when no page
      // could finish one. Now the label says who does what next, and the studio has Mark as done.
      const hasRecords = (p.steps || []).some((s) => (s.records || []).length);
      card.dataset.plan = p.status;
      card.appendChild(el("div", "dol", p.status !== "approved" ? "your decision" : S.isStudio ? "approved · mark it done once the work is finished" : hasRecords ? "approved · add the records below. It closes by itself once we find them" : "approved · your studio finishes this"));
      card.appendChild(el("div", "dop", p.title));
      const riskWord = p.risk === "low" ? "Safe to approve — easily undone." : p.risk === "medium" ? "Worth a careful look before approving." : p.risk === "high" ? "Bigger change — read the steps first." : "";
      const sum = el("p", "aihint", p.summary + (riskWord ? " " + riskWord : "")); sum.style.marginTop = "6px";
      card.appendChild(sum);
      (p.steps || []).forEach((s) => {
        const st = el("p", "aihint", (s.automated ? "Handled for you: " : "One small step for you: ") + s.what);
        st.style.marginTop = "4px";
        card.appendChild(st);
        (s.records || []).forEach((r) => {
          // the same row as the domain steps, with the name the way the provider's form wants it
          card.appendChild(dnsRecordRow(r.type, dnsRecHost(r.name, dstat && dstat.custom_domain), r.value));
        });
      });
      if (p.status === "proposed") {
        const acts = el("div", "doa");
        const ap = el("button", "textact", "Approve it");
        ap.addEventListener("click", async () => {
          try { await api("POST", `/foundations/plans/${p.id}/decide`, { decision: "approve" }); toast(hasRecords ? "Approved. Add the records below. It closes by itself once we find them." : "Approved. Your studio finishes it from here."); openFoundationsDesk(); }
          catch (err) { toast(nice(err), true); }
        });
        acts.appendChild(ap);
        const ab = el("button", "quietact", "Not now");
        ab.addEventListener("click", async () => {
          try { await api("POST", `/foundations/plans/${p.id}/decide`, { decision: "abandon" }); card.remove(); }
          catch (err) { toast(nice(err), true); }
        });
        acts.appendChild(ab);
        card.appendChild(acts);
      } else if (S.isStudio) {
        const acts = el("div", "doa"); acts.dataset.needs = "configure";
        const dn = el("button", "textact", "Mark as done"); dn.dataset.plan = "done";
        dn.addEventListener("click", async () => {
          dn.disabled = true;
          try { await api("POST", `/foundations/plans/${p.id}/done`); toast("Marked done."); openFoundationsDesk(); }
          catch (err) { toast(nice(err), true); dn.disabled = false; }
        });
        acts.appendChild(dn); card.appendChild(acts);
      }
      wrap.appendChild(card);
    });
  }
}

// ── M11: Presence Monitor — connect an existing website; observe only ──
// Who sees this card (the truth table the analytics "Add their website address"
// CTA depends on):
//   edition 'monitor'                → always. The workspace exists to watch an
//                                      external site (presence_monitor) or runs
//                                      business tools around one (business_os_only).
//   edition 'presence', UNPUBLISHED  → yes, with rebuild wording: the business may
//                                      already be live at its own domain while the
//                                      new site is drafted here. Recording that
//                                      address starts Search Console numbers now
//                                      (the gsc sync prefers a recorded external
//                                      domain over the unpublished netlify
//                                      subdomain). The edition is NOT flipped —
//                                      a bare flip is unsafe (provisionForSignup
//                                      re-syncs edition from the plan; 'monitor'
//                                      would revoke drafting/publishing).
//   edition 'presence', PUBLISHED    → hidden. The website we host IS their
//                                      website; a second "website" surface here
//                                      would compete with the true one.
async function renderMonitorCard() {
  const monitorEdition = S.site?.edition === "monitor";
  const unpublishedHosted = !monitorEdition && !(S.site && S.site.last_published_at);
  if (!monitorEdition && !unpublishedHosted) { $("monitorCard").hidden = true; return; }
  $("monitorCard").hidden = false;
  if (unpublishedHosted) {
    const sub = document.querySelector("#monitorCard .docsub");
    if (sub) sub.textContent = "Already live somewhere else? Add that website’s address and its Google search numbers can start arriving while the new site is built here. Nothing on it is ever changed.";
    $("btnMonitorConnect").textContent = "Add the website’s address";
  }
  const wrap = $("monitorStatus"); wrap.innerHTML = "";
  try {
    const r = await api("GET", "/monitor/connection");
    const c = r.data;
    $("btnMonitorConnect").hidden = !!c;
    if (!c) return;
    const card = el("div", "deskopt");
    card.appendChild(el("div", "dol", c.status === "verified" ? "watching over it" : "waiting on verification"));
    card.appendChild(el("div", "dop", c.url));
    if (c.status !== "verified") {
      // What verification does and doesn't gate, in plain words — the address
      // alone already feeds the search numbers (gsc_sync deliberately doesn't
      // wait on 'verified'); the tag only unlocks the active watching. Without
      // this line the card reads as a blocker on everything, which it isn't.
      const why = el("p", "aihint", "This proves you're authorized to watch this site (it may well be your client's — placing the tag is something you do with their access, or as part of a rebuild). It unlocks the up/down checks only. The search numbers don't wait on it: they come from Google once Search Console is connected. If the site is being replaced soon, it's fine to leave this until the new one goes live with the tag already on it.");
      why.style.marginTop = "6px";
      card.appendChild(why);
      const how = el("p", "aihint", c.instructions);
      how.style.marginTop = "6px";
      card.appendChild(how);
      if (c.last_check_note) card.appendChild(el("p", "aihint", "Last check: " + c.last_check_note));
    } else {
      card.appendChild(el("p", "aihint", `Verified ${new Date(c.verified_at).toLocaleDateString()} · looks like ${c.platform === "custom" ? "a custom site" : c.platform}`));
    }
    const acts = el("div", "doa");
    if (c.status !== "verified") {
      const v = el("button", "textact", "I’ve placed it — check now");
      v.addEventListener("click", async () => {
        try {
          const res = await api("POST", "/monitor/verify");
          toast(res.data.verified ? "Verified — observation begins." : res.data.note, !res.data.verified);
          renderMonitorCard();
        } catch (err) { toast(nice(err), true); }
      });
      acts.appendChild(v);
    }
    const d = el("button", "quietact", "Disconnect");
    d.addEventListener("click", async () => {
      try { await api("DELETE", "/monitor/connection"); toast("Disconnected."); renderMonitorCard(); }
      catch (err) { toast(nice(err), true); }
    });
    acts.appendChild(d);
    card.appendChild(acts);
    wrap.appendChild(card);
  } catch { /* quiet */ }
}
$("btnMonitorConnect").addEventListener("click", () => inlineAdd("monitorAddWrap",
  [["url", "Your website’s address", "text", 200, "https://yourbusiness.com"]],
  async (b, done) => {
    if (!b.url) { toast("The website address is needed.", true); return; }
    try {
      await api("POST", "/monitor/connect", { url: b.url, method: "meta" });
      done(); renderMonitorCard();
      toast("Connected — one small step proves it’s yours.");
    } catch (err) { toast(nice(err), true); }
  }, "Connect it"));

// ── M10: Business Knowledge Import — papers in, quiet awareness out ──
async function renderKnowledgeDocs() {
  try {
    const r = await api("GET", "/knowledge/docs");
    const wrap = $("knowledgeList"); wrap.innerHTML = "";
    (r.data || []).forEach((d) => {
      const row = el("div", "deskopt");
      row.appendChild(el("div", "dop", d.filename));
      row.appendChild(el("p", "aihint", d.items ? `${d.items} item${d.items > 1 ? "s" : ""} noticed` : "kept"));
      const acts = el("div", "doa");
      const del = el("button", "quietact", "Remove"); del.dataset.needs = "delete";
      del.addEventListener("click", async () => {
        try { await api("DELETE", `/knowledge/docs/${d.id}`); row.remove(); toast("Removed"); }
        catch (err) { toast(nice(err), true); }
      });
      acts.appendChild(del);
      row.appendChild(acts);
      wrap.appendChild(row);
    });
  } catch { /* quiet — the list is a convenience */ }
}
$("btnAddKnowledge").addEventListener("click", () => inlineAdd("knowledgeAddWrap",
  [["filename", "What is it?", "text", 120, "Spring menu · takeout flyer · price sheet"], ["content", "Paste its text here", "textarea", 50000, ""]],
  async (b, done) => {
    if (!b.filename || !b.content || b.content.trim().length < 20) { toast("A name and the document’s text are needed.", true); return; }
    try {
      const r = await api("POST", "/knowledge/import", b);
      done(); renderKnowledgeDocs();
      toast(r.data.items ? `Kept — ${r.data.items} item${r.data.items > 1 ? "s" : ""} noticed.` : "Kept.");
    } catch (err) { toast(nice(err), true); }
  }, "Keep this document"));

$("btnAddTes").addEventListener("click", () => inlineAdd("tesAddWrap",
  [["quote","Their words","textarea",600,""],["author","From","text",120,"Maria G."],["source","Where they said it (optional)","text",80,"Google · a note · in person"]],
  async (b, done) => {
    if (!b.quote || !b.author) { toast("The words and who said them are needed.", true); return; }
    try { const r = await api("POST", "/testimonials", b); S.testimonials.push(r.data); done(); renderTes(); toast("Kept"); scheduleChangesRefresh(); }
    catch (err) { toast(nice(err), true); }
  }, "Keep this kind word"));
$("btnAddPost").addEventListener("click", async () => {
  const b = $("btnAddPost"); if (b.disabled) return; b.disabled = true;
  // a draft first, so the writing screen saves into a post that already exists
  const lists = blogLists();
  const slug = "post-" + Date.now().toString(36);
  try {
    const r = await api("POST", "/posts", { title: "Untitled post", slug, status: "draft", ...(BLOG_CAT ? { category: BLOG_CAT } : {}), ...(lists.authors.length === 1 ? { author: lists.authors[0].id } : {}) });
    S.posts.unshift(r.data); renderPosts(); scheduleChangesRefresh();
    await openPost(r.data);
  } catch (err) { toast(nice(err), true); }
  b.disabled = false;
});
$("btnPostHelp").addEventListener("click", () => openDesk("post", "updates"));

/* ── Author "find anything" — search across the owner's OWN loaded content and
   jump to the right editor. Pure client-side over already-loaded state (no new
   route, no extra reads); same tokenized, title-weighted ranking as the published
   on-site search (lib/search_index.ts matchDocs). Answers "where's that FAQ I
   wrote?" without hunting through tabs. ── */
function findLabel() { try { return (VOCAB && VOCAB.label) || "Menu"; } catch (_) { return "Menu"; } }
// Item 92: the places carry the menu's own names and Edit mode its button's. They were written
// out here a second time and had drifted ("Business & settings", "Design").
function findPlaces() {
  return SITE_TABS.filter(([v]) => $("view-" + v)).map(([v, label]) => [v, v === "offerings" ? findLabel() : label]).concat([["design", "Edit site"]]);
}
function findDataset() {
  const ds = [];
  findPlaces().forEach(([v, label]) => ds.push({ view: v, kind: "Section", title: label, text: "" }));
  (S.offerings || []).forEach((o) => ds.push({ view: "offerings", kind: findLabel(), title: o.name || "", text: [o.category, o.description, o.price_text].filter(Boolean).join(" ") }));
  (S.faqs || []).forEach((f) => ds.push({ view: "faqs", kind: "Question", title: f.question || "", text: f.answer || "" }));
  (S.testimonials || []).forEach((t) => ds.push({ view: "testimonials", kind: "Testimonials", title: t.author || t.quote || "", text: t.quote || "" }));
  (S.posts || []).forEach((p) => ds.push({ view: "updates", kind: "Update", title: p.title || "", text: [p.excerpt, p.body_md, (p.tags || []).join(" ")].filter(Boolean).join(" ") }));
  return ds;
}
function findMatch(query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return [];
  const toks = q.split(/\s+/).filter(Boolean);
  return findDataset().map((d, i) => {
    const title = (d.title || "").toLowerCase();
    const hay = (title + " " + (d.text || "")).toLowerCase();
    let score = 0, ok = true;
    toks.forEach((tk) => { if (title.indexOf(tk) >= 0) score += 3; else if (hay.indexOf(tk) >= 0) score += 1; });
    toks.forEach((tk) => { if (hay.indexOf(tk) < 0) ok = false; });
    if (!ok || score === 0) return null;
    if (title.indexOf(q) === 0) score += 4; else if (hay.indexOf(q) >= 0) score += 2;
    return { d: d, score: score, i: i };
  }).filter(Boolean).sort((a, b) => b.score - a.score || a.i - b.i).slice(0, 20).map((x) => x.d);
}
function renderFind() {
  const box = $("findResults"), q = $("findInput").value;
  box.innerHTML = "";
  if (!q.trim()) { box.hidden = true; return; }
  const res = findMatch(q);
  box.hidden = false;
  if (!res.length) { box.appendChild(el("div", "findempty", "No matches. Try another word.")); return; }
  res.forEach((d) => {
    const b = el("button", "findhit"); b.type = "button"; b.setAttribute("role", "option");
    b.appendChild(el("span", "fk", d.kind));
    b.appendChild(el("span", "ft", d.title || "(untitled)"));
    if (d.text) b.appendChild(el("span", "fs", d.text.slice(0, 90)));
    b.addEventListener("click", () => { box.hidden = true; $("findInput").value = ""; go(d.view); });
    box.appendChild(b);
  });
}
$("findInput").addEventListener("input", renderFind);
$("findInput").addEventListener("focus", renderFind);
$("findInput").addEventListener("keydown", (e) => { if (e.key === "Escape") { $("findInput").value = ""; $("findResults").hidden = true; $("findInput").blur(); } });
document.addEventListener("click", (e) => { if (!e.target.closest(".findwrap")) $("findResults").hidden = true; });
document.addEventListener("keydown", (e) => {
  if (e.key !== "/") return;
  const t = e.target || {}; const tag = t.tagName || "";
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || t.isContentEditable) return;
  e.preventDefault(); $("findInput").focus();
});

/* ── photographs → the Files library (#180). GET /media still feeds S.media (block
 *    pickers + thumbnails, unchanged); the VIEW's grid renders via FL_load below. ── */
async function loadMedia() {
  // FL_load is NOT awaited: callers like importStockToBlock await loadMedia only
  // for S.media (the block thumbnail); the library grid refresh rides behind it
  // and never rejects (FL_load handles its own failures).
  try { const r = await api("GET", "/media"); S.media = r.data || []; PF_S.key = null; PF_S.allow = null; FL_load(); }   // PF cache invalidated — uploads/deletes repaint the panel Files tab
  catch (err) { toast(nice(err), true); }
}

/* ── #180: the full Files library folded into this view, namespaced FL_ (files.html
 *    defines $/esc/api/toast/S with incompatible shapes — nothing is shared, the
 *    COLS/qstr/tile ideas are ported onto presence's api(), which throws on error).
 *    files.html keeps the deep detail surface (versions, where-used, crops, replace);
 *    every tile links there. Block pickers keep the classic /media path untouched. ── */
const FL_COLS = [
  { key: "all", label: "All files", f: {} },
  { key: "fav", label: "Favorites", f: {}, favs: true },
  { key: "photos", label: "Photos", f: {}, kind: "image" },
  { key: "brand", label: "Brand", f: { brand: "true" } },
  { key: "documents", label: "Documents", f: {}, kind: "document" },
  { key: "templates", label: "Templates", f: { collection: "Templates" } },
  { key: "downloads", label: "Downloads", f: { collection: "Downloads" } },
  { key: "archive", label: "Archive", f: { status: "archived" } },
  { key: "stock", label: "Stock", stock: true },
];
const FL_S = { col: "all", q: "", sort: "recent", rows: [], counts: {}, loaded: false, seq: 0,
  stock: { state: null, results: [] } };
// Once the library has loaded, IT owns the view grid: manage-mode repaints (alt edit,
// assign, delete, boot) route here so filters/badges survive. Pickers pass manage=false.
function FL_takeover(grid) {
  if (!FL_S.loaded || grid !== $("mediaGrid")) return false;
  FL_load();
  return true;
}
function FL_qstr() {
  const c = FL_COLS.find((x) => x.key === FL_S.col) || FL_COLS[0];
  const p = new URLSearchParams();
  Object.entries(c.f || {}).forEach(([k, v]) => p.set(k, v));
  if (FL_S.q.trim()) p.set("q", FL_S.q.trim());
  p.set("limit", "300");
  return p.toString();
}
function FL_sortRows(rows) {
  const r = [...rows];
  if (FL_S.sort === "name") r.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  else if (FL_S.sort === "size") r.sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
  else r.sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0));
  return r;
}
async function FL_load() {
  const grid = $("mediaGrid"); if (!grid) return;
  loadAssetHealth();
  if (FL_S.col === "stock") { FL_paintBar(); return FL_renderStock(); }
  const seq = ++FL_S.seq;
  try {
    const [a, c] = await Promise.all([api("GET", "/assets?" + FL_qstr()), api("GET", "/assets/collections")]);
    if (seq !== FL_S.seq) return;   // a newer chip/search won the race
    let rows = (a.data && a.data.assets) || [];
    const col = FL_COLS.find((x) => x.key === FL_S.col);
    if (col && col.kind) rows = rows.filter((r) => r.kind === col.kind);
    if (col && col.favs) rows = rows.filter((r) => r.favorite);
    FL_S.rows = FL_sortRows(rows);
    FL_S.counts = {}; (c.data || []).forEach((x) => { FL_S.counts[x.name] = x.count; });
    FL_S.loaded = true;
  } catch (err) {
    if (seq !== FL_S.seq) return;
    // /assets not on this server or plan — the classic photo grid still works
    if (!FL_S.loaded) { $("flBar").hidden = true; renderMediaGrid(grid, true); return; }
    // background refresh failed AFTER a successful mutation: no error toast (the
    // action itself succeeded), and reconcile image rows against S.media so a
    // just-deleted photo can't ghost back as a stale tile. Archived images may
    // drop from this paint too — they return on the next successful load.
    FL_S.rows = FL_S.rows.filter((r) => r.kind !== "image" || S.media.some((m) => String(m.id) === String(r.id)));
  }
  FL_render();
}
function FL_paintBar() {
  const bar = $("flBar"); if (!bar) return;
  bar.hidden = false;
  const chips = $("flChips"); chips.innerHTML = "";
  FL_COLS.forEach((c) => {
    const on = FL_S.col === c.key;
    const n = c.key === "templates" ? FL_S.counts.Templates : c.key === "downloads" ? FL_S.counts.Downloads : 0;
    const b = el("button", "flchip" + (on ? " on" : ""), c.label);
    b.type = "button"; b.setAttribute("aria-pressed", String(on));
    if (n) b.appendChild(el("span", "n", String(n)));
    b.addEventListener("click", () => { if (FL_S.col === c.key) return; FL_S.col = c.key; FL_load(); });
    chips.appendChild(b);
  });
  if (!bar.dataset.wired) {
    bar.dataset.wired = "1";
    let t;
    $("flSearch").addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { FL_S.q = $("flSearch").value; FL_S.col === "stock" ? FL_loadStock() : FL_load(); }, 280); });
    $("flSearch").addEventListener("keydown", (e) => { if (e.key === "Enter" && FL_S.col === "stock") { e.preventDefault(); FL_S.q = $("flSearch").value; FL_loadStock(); } });
    $("flSort").addEventListener("change", () => { FL_S.sort = $("flSort").value; FL_S.rows = FL_sortRows(FL_S.rows); FL_render(); });
  }
}
function FL_render() {
  const grid = $("mediaGrid"); if (!grid) return;
  FL_paintBar();
  if (FL_S.col === "stock") return FL_renderStock();
  grid.innerHTML = "";
  if (!FL_S.rows.length) {
    grid.innerHTML = `<div class="estate" style="grid-column:1/-1;padding:30px 0"><div class="eq">${FL_S.q ? "No files match that search." : "Nothing here yet."}</div><div class="eh">Photos, PDFs and brand files all live here — add one above and it’s ready to place anywhere on your site.</div></div>`;
    return;
  }
  const byId = new Map(S.media.map((m) => [m.id, m]));
  FL_S.rows.forEach((a) => {
    const m = a.kind === "image" ? byId.get(a.id) : null;
    // images in the classic collection keep EVERY current behavior (logo/hero/share ·
    // alt edit · AI suggest · focus · delete) via the same cell builder
    const cell = m ? mediaCell(grid, m, true) : FL_cell(a);
    if (a.state === "pending") { const b = el("span", "badge flpend", "Pending"); if (cell.querySelector(".badge")) b.style.top = "36px"; cell.appendChild(b); }
    if (m) { const row = cell.querySelector("div"); (row || cell).appendChild(FL_openLink(a.id)); }
    grid.appendChild(cell);
  });
}
// Non-image kinds (and images the classic /media list doesn't carry, e.g. archived):
// the whole tile opens the deep view in Files — versions, where-used, crops, replace.
function FL_cell(a) {
  const cell = el("a", "mcell fldoc");
  cell.href = FL_filesHref(a.id);
  cell.title = "Open in Files — versions, where-used and replace live there";
  cell.setAttribute("aria-label", "Open " + (a.name || "file") + " in Files");
  if (a.thumb) { const img = el("img"); img.src = a.thumb; img.alt = ""; img.loading = "lazy"; cell.appendChild(img); }
  else cell.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h8l4 4v14H6z" stroke="currentColor" stroke-width="1.6"/><path d="M14 3v4h4M9 13h6M9 16h6" stroke="currentColor" stroke-width="1.5"/></svg>');
  if (a.kind === "document") cell.appendChild(el("span", "badge fldocb", "PDF"));
  const alt = el("span", "alt", a.name || "");
  const use = el("i", "usedline", a.in_use ? "at work: on your site" : "not used yet");
  use.prepend(el("i", "fldot" + (a.in_use ? " on" : "")));
  alt.appendChild(use);
  cell.appendChild(alt);
  return cell;
}
// SC-1: dynamic links out of the editor carry the agency drill-in scope too.
function FL_filesHref(id) {
  const c = new URLSearchParams(location.search).get("client");
  return "/files.html?focus=" + encodeURIComponent(id) + (c ? "&client=" + encodeURIComponent(c) : "");
}
function FL_openLink(id) {
  const a = el("a", null, "Open in Files");
  a.href = FL_filesHref(id);
  a.title = "Versions, where-used, crops and replace live in Files";
  a.style.cssText = "font:inherit;font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid var(--line, #ddd);color:inherit;text-decoration:none";
  a.addEventListener("click", (e) => e.stopPropagation());
  return a;
}
/* the Stock chip — same /stock endpoints as the picker's stock tab; imports land in
 * the library (POST /stock/import) and S.media refreshes quietly for the pickers */
async function FL_loadStock() {
  const st = FL_S.stock; st.state = "loading"; FL_render();
  try {
    const r = await api("GET", "/stock/search?q=" + encodeURIComponent(FL_S.q || "") + "&page=1");
    st.results = ((r && r.data) || {}).images || []; st.state = "ok";
  } catch (err) {
    if (err && err.status === 503) st.state = "off";
    else { st.results = []; st.state = "ok"; toast(nice(err), true); }
  }
  FL_render();
}
function FL_renderStock() {
  const grid = $("mediaGrid"), st = FL_S.stock;
  if (st.state === "off") { grid.innerHTML = `<div class="estate" style="grid-column:1/-1;padding:24px 8px"><div class="eq">Stock photos aren’t turned on yet.</div><div class="eh">Add a Pexels key to search professional royalty-free photos and add them straight to your Files — hosted on your own site.</div></div>`; return; }
  if (st.state === "loading") { grid.innerHTML = `<p style="grid-column:1/-1;color:var(--ink-2);font-size:13px">Searching…</p>`; return; }
  if (st.state == null) { grid.innerHTML = `<div class="estate" style="grid-column:1/-1;padding:24px 8px"><div class="eq">Search for a photo above.</div><div class="eh">Try “office”, “coffee”, “construction”, “salon”…</div></div>`; return; }
  if (!st.results.length) { grid.innerHTML = `<div class="estate" style="grid-column:1/-1;padding:24px 8px"><div class="eq">No matches — try another word.</div><div class="eh">Try “office”, “coffee”, “construction”, “salon”…</div></div>`; return; }
  grid.innerHTML = "";
  st.results.forEach((im) => {
    const cell = el("button", "mcell"); cell.type = "button";
    cell.setAttribute("aria-label", "Add this stock photo to your files" + (im.credit ? " — by " + im.credit : ""));
    const img = el("img"); img.src = im.thumb; img.alt = im.alt || ""; img.loading = "lazy"; cell.appendChild(img);
    if (im.credit) cell.appendChild(el("span", "alt", im.credit));
    cell.addEventListener("click", () => FL_addStock(im, cell));
    grid.appendChild(cell);
  });
}
async function FL_addStock(im, cell) {
  if (cell.dataset.busy) return; cell.dataset.busy = "1"; cell.style.opacity = ".5";
  const badge = el("span", "badge", "Adding…"); cell.appendChild(badge);
  try {
    await api("POST", "/stock/import", { stock_id: im.id, alt_text: im.alt, credit: im.credit || "" });
    cell.style.opacity = ""; badge.textContent = "Added ✓";
    toast("Added to your Files");
    api("GET", "/media").then((r) => { S.media = r.data || []; }).catch(() => {});   // keep the pickers fresh
  } catch (err) {
    cell.style.opacity = ""; badge.remove(); delete cell.dataset.busy;
    if (err && err.status === 503) { FL_S.stock.state = "off"; FL_render(); }
    else toast(nice(err), true);
  }
}

/* ── Bookings (Phase BK): the owner's native booking desk — services, weekly
 *    availability, and incoming appointments (confirm / cancel). Reuses the same
 *    api()/toast()/nice() spine as every other view. All slot logic + safety live
 *    server-side (routes/booking.ts + lib/booking.ts); this is a calm editor. ── */
const BK_DAYS = [[1,"Monday"],[2,"Tuesday"],[3,"Wednesday"],[4,"Thursday"],[5,"Friday"],[6,"Saturday"],[0,"Sunday"]];
const BK_INTERVALS = [10,15,20,30,45,60,90,120];
const BK_TZS = ["America/Los_Angeles","America/Denver","America/Chicago","America/New_York","America/Phoenix","America/Anchorage","Pacific/Honolulu","Europe/London","Australia/Sydney"];
const BK_ICSS = "width:100%;padding:8px 10px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;box-sizing:border-box";
const BK_BTN = "padding:7px 14px;border:1px solid var(--line,#ddd);border-radius:999px;background:var(--sheet,#fff);font:inherit;font-size:13px;cursor:pointer";
let BK = { settings: null, types: [] };
async function loadBookings() {
  const wrap = $("bookingsWrap"); if (!wrap) return;
  wrap.innerHTML = '<div class="loadline"><div class="lq">Loading bookings…</div><div class="shimmer"></div></div>';
  try {
    const [s, t, a] = await Promise.all([api("GET", "/bookings/settings"), api("GET", "/bookings/types"), api("GET", "/bookings/appointments")]);
    BK.settings = s.data || {}; BK.types = (t.data && t.data.types) || [];
    wrap.innerHTML = "";
    renderBookings(wrap, (a.data && a.data.appointments) || []);
  } catch (err) {
    wrap.innerHTML = "";
    const box = el("div", "card"); box.style.cssText = "padding:18px;border:1px solid var(--line,#eee);border-radius:12px";
    box.appendChild(el("p", null, err.status === 503
      ? "Online booking isn’t switched on yet. Your studio turns it on once — then this page comes to life."
      : nice(err)));
    wrap.appendChild(box);
  }
}
function bkCard(title, sub) {
  const c = el("div", "card"); c.style.cssText = "padding:18px 20px;border:1px solid var(--line,#eee);border-radius:12px;margin-bottom:18px";
  if (title) c.appendChild(el("h3", null, title)).style.cssText = "margin:0 0 4px;font-size:16px";
  if (sub) c.appendChild(el("p", "hint", sub)).style.margin = "0 0 12px";
  return c;
}
function bkField(label, node) {
  const w = el("label"); w.style.cssText = "display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600";
  w.appendChild(el("span", null, label)); w.appendChild(node); return w;
}
// Collect the full config from the availability form into the API shape.
function bkGatherSettings(root) {
  const g = (sel) => root.querySelector(sel);
  const weekly = [[], [], [], [], [], [], []];
  BK_DAYS.forEach(([idx]) => {
    const on = g(`[data-day='${idx}'] .bk-on`).checked;
    const st = g(`[data-day='${idx}'] .bk-start`).value, en = g(`[data-day='${idx}'] .bk-end`).value;
    if (on && st && en) weekly[idx] = [{ start: st, end: en }];
  });
  const closed = g(".bk-closed").value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  return {
    enabled: g(".bk-enabled").checked,
    intro: g(".bk-intro").value.trim(),
    weekly, closed_dates: closed,
    slot_interval_min: +g(".bk-interval").value,
    buffer_min: +g(".bk-buffer").value || 0,
    lead_time_hours: +g(".bk-lead").value || 0,
    max_days_ahead: +g(".bk-maxdays").value || 60,
    timezone: g(".bk-tz").value,
    auto_confirm: g(".bk-autoconfirm").checked,
  };
}
function renderBookings(wrap, appts) {
  const s = BK.settings || {};
  const askHours = askOwner("hint", "Ask the account owner to change your hours or turn online booking on or off."); askHours.style.marginBottom = "14px";
  wrap.appendChild(askHours);
  // ── 1. On/off + intro ──────────────────────────────────────────────────────
  const c1 = bkCard("Online booking", "Turn this on when your services and hours are ready. Customers see the booking widget wherever you place the “Online booking” section.");
  const form = el("div"); form.className = "bk-availform";
  const enWrap = el("label"); enWrap.style.cssText = "display:flex;align-items:center;gap:10px;font-weight:600;margin-bottom:12px";
  const en = el("input"); en.type = "checkbox"; en.className = "bk-enabled"; en.checked = !!s.enabled; en.style.width = "auto";
  enWrap.append(en, el("span", null, "Accept bookings on my website"));
  form.appendChild(enWrap);
  const introI = el("input"); introI.type = "text"; introI.className = "bk-intro"; introI.value = s.intro || ""; introI.style.cssText = BK_ICSS;
  introI.placeholder = "A short welcome line (optional) — e.g. Pick a service and a time that suits you.";
  form.appendChild(bkField("Intro shown above the widget", introI));
  c1.dataset.needs = "configure"; c1.appendChild(form); wrap.appendChild(c1);

  // ── 2. Availability + window ────────────────────────────────────────────────
  const c2 = bkCard("Your hours", "The days and times you take appointments. Slots are offered inside these hours, minus anything already booked.");
  const grid = el("div"); grid.style.cssText = "display:grid;gap:8px;margin-bottom:14px";
  BK_DAYS.forEach(([idx, name]) => {
    const ranges = (Array.isArray(s.weekly) && Array.isArray(s.weekly[idx])) ? s.weekly[idx] : [];
    const r0 = ranges[0] || {};
    const row = el("div"); row.setAttribute("data-day", idx);
    row.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";
    const on = el("input"); on.type = "checkbox"; on.className = "bk-on"; on.checked = ranges.length > 0; on.style.width = "auto";
    const lab = el("span", null, name); lab.style.cssText = "width:88px;font-size:13px;font-weight:600";
    const st = el("input"); st.type = "time"; st.className = "bk-start"; st.value = r0.start || "09:00"; st.style.cssText = "padding:6px;border:1px solid var(--line,#ddd);border-radius:8px";
    const en2 = el("input"); en2.type = "time"; en2.className = "bk-end"; en2.value = r0.end || "17:00"; en2.style.cssText = st.style.cssText;
    row.append(on, lab, st, el("span", null, "to"), en2);
    grid.appendChild(row);
  });
  c2.appendChild(grid);
  const opts = el("div"); opts.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:14px";
  const interval = el("select"); interval.className = "bk-interval"; BK_INTERVALS.forEach((m) => { const o = el("option", null, m + " min"); o.value = m; if (+m === +(s.slot_interval_min || 30)) o.selected = true; interval.appendChild(o); }); interval.style.cssText = BK_ICSS;
  const buffer = el("input"); buffer.type = "number"; buffer.className = "bk-buffer"; buffer.min = 0; buffer.max = 240; buffer.value = s.buffer_min || 0; buffer.style.cssText = BK_ICSS;
  const lead = el("input"); lead.type = "number"; lead.className = "bk-lead"; lead.min = 0; lead.max = 720; lead.value = s.lead_time_hours != null ? s.lead_time_hours : 2; lead.style.cssText = BK_ICSS;
  const maxd = el("input"); maxd.type = "number"; maxd.className = "bk-maxdays"; maxd.min = 1; maxd.max = 365; maxd.value = s.max_days_ahead || 60; maxd.style.cssText = BK_ICSS;
  const tz = el("select"); tz.className = "bk-tz"; BK_TZS.forEach((z) => { const o = el("option", null, z); o.value = z; if (z === (s.timezone || "America/Los_Angeles")) o.selected = true; tz.appendChild(o); }); if (s.timezone && !BK_TZS.includes(s.timezone)) { const o = el("option", null, s.timezone); o.value = s.timezone; o.selected = true; tz.appendChild(o); } tz.style.cssText = BK_ICSS;
  opts.append(bkField("Time between slots", interval), bkField("Gap between appointments (min)", buffer), bkField("Least notice (hours)", lead), bkField("How far ahead (days)", maxd), bkField("Time zone", tz));
  c2.appendChild(opts);
  const closed = el("input"); closed.type = "text"; closed.className = "bk-closed"; closed.value = (s.closed_dates || []).join(", "); closed.style.cssText = BK_ICSS;
  closed.placeholder = "Closed dates (optional) — e.g. 2026-12-25, 2027-01-01";
  c2.appendChild(bkField("Days you're closed", closed));
  const acWrap = el("label"); acWrap.style.cssText = "display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600;margin-top:12px";
  const ac = el("input"); ac.type = "checkbox"; ac.className = "bk-autoconfirm"; ac.checked = !!s.auto_confirm; ac.style.width = "auto";
  acWrap.append(ac, el("span", null, "Confirm bookings automatically (otherwise they wait for your OK)"));
  c2.appendChild(acWrap);
  c2.dataset.needs = "configure"; wrap.appendChild(c2);
  // Builder list item 149: your own calendar's busy times, and customers changing or canceling (booking-extras.js)
  loadBookingExtras().then((m) => m.mount(c2, { settings: s, save: (body) => api("PUT", "/bookings/settings", body), card: bkCard, toast, nice })
    .forEach((c) => { c.dataset.needs = "configure"; })).catch(() => {});
  // Saved as you go, like everything else: the two settings cards, not the services below.
  let bkSaved = JSON.stringify(bkGatherSettings(wrap));
  const bkSave = () => debounce("bk-settings", async () => {
    const payload = bkGatherSettings(wrap), sig = JSON.stringify(payload);
    if (sig === bkSaved) return;
    whisper("topWhisper", "saving");
    try { await api("PUT", "/bookings/settings", payload); BK.settings = { ...BK.settings, ...payload }; bkSaved = sig; whisper("topWhisper", "saved"); }
    catch (err) { whisper("topWhisper", "failed"); toast(nice(err), true); }
  }, 500);
  [c1, c2].forEach((c) => c.addEventListener("change", bkSave));

  // ── 3. Services ─────────────────────────────────────────────────────────────
  const c3 = bkCard("Services", "What customers can book, and how long each takes. Add a price if you like.");
  const list = el("div"); list.style.cssText = "display:grid;gap:8px;margin-bottom:12px";
  if (!BK.types.length) list.appendChild(el("p", "hint", "No services yet — add your first below."));
  BK.types.forEach((t) => list.appendChild(bkServiceRow(t)));
  c3.appendChild(list);
  c3.appendChild(bkServiceAdd());
  wrap.appendChild(c3);

  // ── 4. Upcoming appointments ────────────────────────────────────────────────
  const c4 = bkCard("Upcoming appointments", "Bookings customers have made. Confirm the ones waiting, or cancel if plans change (the customer is emailed either way).");
  const alist = el("div"); alist.style.cssText = "display:grid;gap:10px";
  if (!appts.length) alist.appendChild(el("p", "hint", "Nothing booked yet. Once your site is live and a service is set up, bookings appear here."));
  appts.forEach((a) => alist.appendChild(bkApptRow(a)));
  c4.appendChild(alist);
  wrap.appendChild(c4);
}
// Bump ?v= whenever booking-extras.js changes: browsers keep a .js file for a day.
let BOOKING_EXTRAS = null;
function loadBookingExtras() {
  if (window.DDSBookingExtras) return Promise.resolve(window.DDSBookingExtras);
  if (!BOOKING_EXTRAS) BOOKING_EXTRAS = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "/booking-extras.js?v=1";
    s.onload = () => window.DDSBookingExtras ? res(window.DDSBookingExtras) : rej(new Error("missing"));
    s.onerror = () => rej(new Error("load"));
    document.head.appendChild(s);
  }).catch((e) => { BOOKING_EXTRAS = null; throw e; });
  return BOOKING_EXTRAS;
}
function bkServiceRow(t) {
  const row = el("div"); row.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--line,#eee);border-radius:10px" + (t.active === false ? ";opacity:.55" : "");
  const meta = t.duration_min + " min" + (t.price_text ? " · " + t.price_text : "") + (t.active === false ? " · hidden" : "");
  const info = el("div"); info.style.cssText = "flex:1;min-width:160px";
  info.appendChild(el("div", null, t.name)).style.cssText = "font-weight:600";
  info.appendChild(el("div", "hint", meta)).style.margin = "2px 0 0";
  const edit = el("button", null, "Edit"); edit.style.cssText = BK_BTN;
  const del = el("button", null, "Remove"); del.dataset.needs = "delete"; del.style.cssText = BK_BTN + ";color:var(--clay,#b42318)";
  edit.addEventListener("click", () => row.replaceWith(bkServiceForm(t)));
  del.addEventListener("click", async () => {
    if (!(await askYes("Remove “" + t.name + "”? Existing appointments keep their details.", { ok: "Remove", danger: true }))) return;
    try { await api("DELETE", "/bookings/types/" + t.id); toast("Service removed"); loadBookings(); }
    catch (err) { toast(nice(err), true); }
  });
  row.append(info, edit, del); return row;
}
function bkServiceForm(t) {
  const box = el("div"); box.style.cssText = "display:grid;gap:8px;padding:12px;border:1px solid var(--plum,#5b3fa0);border-radius:10px";
  const name = el("input"); name.type = "text"; name.placeholder = "Service name (e.g. Haircut)"; name.value = (t && t.name) || ""; name.style.cssText = BK_ICSS;
  const dur = el("input"); dur.type = "number"; dur.min = 5; dur.max = 480; dur.placeholder = "Duration (minutes)"; dur.value = (t && t.duration_min) || 30; dur.style.cssText = BK_ICSS;
  const price = el("input"); price.type = "text"; price.placeholder = "Price (optional) — e.g. 40"; price.value = (t && t.price_cents != null) ? (t.price_cents / 100) : ""; price.style.cssText = BK_ICSS;
  const desc = el("input"); desc.type = "text"; desc.placeholder = "Short description (optional)"; desc.value = (t && t.description) || ""; desc.style.cssText = BK_ICSS;
  const save = el("button", null, t && t.id ? "Save" : "Add service"); save.style.cssText = "padding:8px 16px;border:none;border-radius:999px;background:var(--plum,#5b3fa0);color:var(--fill-ink,#fff);font:inherit;cursor:pointer;justify-self:start";
  save.addEventListener("click", async () => {
    const body = { name: name.value.trim(), duration_min: +dur.value || 30, description: desc.value.trim() };
    const p = parseFloat(price.value); if (isFinite(p) && p >= 0) body.price_cents = Math.round(p * 100);
    if (!body.name) { toast("Give the service a name", true); return; }
    save.disabled = true;
    try {
      if (t && t.id) await api("PATCH", "/bookings/types/" + t.id, body); else await api("POST", "/bookings/types", body);
      toast("Saved"); loadBookings();
    } catch (err) { toast(nice(err), true); save.disabled = false; }
  });
  box.append(bkField("Name", name), bkField("Duration (minutes)", dur), bkField("Price (optional)", price), bkField("Description (optional)", desc), save);
  return box;
}
function bkServiceAdd() {
  const add = el("button", null, "＋ Add a service"); add.style.cssText = "background:none;border:none;color:var(--plum,#5b3fa0);font:inherit;font-weight:600;cursor:pointer;padding:4px 0";
  const holder = el("div");
  add.addEventListener("click", () => { if (holder.firstChild) { holder.innerHTML = ""; add.textContent = "＋ Add a service"; } else { holder.appendChild(bkServiceForm(null)); add.textContent = "Close"; } });
  const box = el("div"); box.append(add, holder); return box;
}
// "2026-10-20T14:30" → "Tue, Oct 20 · 2:30 PM" (the row used to print the raw timestamp)
function bkWhenLabel(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(String(s || ""));
  if (!m) return String(s || "");
  const d = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return m[4] ? day + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : day;
}
function bkApptRow(a) {
  const row = el("div"); row.style.cssText = "display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--line,#eee);border-radius:10px";
  const info = el("div"); info.style.cssText = "flex:1;min-width:200px";
  info.appendChild(el("div", null, bkWhenLabel(a.when || a.slot_start_local) + " · " + a.type_name)).style.cssText = "font-weight:600";
  const who = [a.customer_name, a.customer_email, a.customer_phone].filter(Boolean).join(" · ");
  info.appendChild(el("div", "hint", who)).style.margin = "2px 0 0";
  if (a.note) info.appendChild(el("div", "hint", "“" + a.note + "”")).style.margin = "2px 0 0";
  const badge = el("span", null, a.status === "pending" ? "Waiting for you" : a.status === "confirmed" ? "Confirmed" : a.status);
  badge.style.cssText = "font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;" + (a.status === "pending" ? "background:var(--dds-warn-soft,#fef3c7);color:var(--dds-warn,#92400e)" : a.status === "confirmed" ? "background:var(--sage-soft,#dcfce7);color:var(--sage,#166534)" : "background:color-mix(in srgb,var(--ink,#1b1525) 8%,transparent);color:var(--soft,#555)");
  const acts = el("div"); acts.style.cssText = "display:flex;gap:8px";
  if (a.status === "pending") {
    const conf = el("button", null, "Confirm"); conf.style.cssText = BK_BTN + ";border-color:var(--plum,#5b3fa0);color:var(--plum,#5b3fa0)";
    conf.addEventListener("click", async () => { conf.disabled = true; try { await api("POST", "/bookings/appointments/" + a.id + "/confirm"); toast("Confirmed — the customer was emailed"); loadBookings(); } catch (err) { toast(nice(err), true); conf.disabled = false; } });
    acts.appendChild(conf);
  }
  const canc = el("button", null, "Cancel"); canc.style.cssText = BK_BTN + ";color:var(--clay,#b42318)";
  canc.addEventListener("click", async () => { if (!(await askYes("Cancel this booking? The customer will be emailed.", { ok: "Cancel booking", cancel: "Keep it", danger: true }))) return; canc.disabled = true; try { await api("POST", "/bookings/appointments/" + a.id + "/cancel", {}); toast("Canceled — the customer was emailed"); loadBookings(); } catch (err) { toast(nice(err), true); canc.disabled = false; } });
  acts.appendChild(canc);
  row.append(info, badge, acts); return row;
}

/* ── Reviews (Phase RV): the owner's reputation desk — ask for reviews, approve /
 *    hide / reply. Propose-then-approve: nothing shows on the site until approved,
 *    then it appears on the next publish. Reuses the same api()/toast()/nice() spine
 *    as every other view; all safety + honest schema live server-side. ── */
const RV_ICSS = "width:100%;padding:9px 11px;border:1px solid var(--line,#ddd);border-radius:9px;font:inherit;box-sizing:border-box";
async function loadReviews() {
  const wrap = $("reviewsWrap"); if (!wrap) return;
  wrap.innerHTML = '<div class="loadline"><div class="lq">Loading reviews…</div><div class="shimmer"></div></div>';
  try {
    const r = await api("GET", "/reviews");
    wrap.innerHTML = "";
    renderReviews(wrap, r.data || {});
  } catch (err) {
    wrap.innerHTML = "";
    const box = el("div", "card"); box.style.cssText = "padding:18px;border:1px solid var(--line,#eee);border-radius:12px";
    box.appendChild(el("p", null, err.status === 503
      ? "Reviews aren’t switched on yet. Your studio turns them on once — then this page comes to life."
      : nice(err)));
    wrap.appendChild(box);
  }
}
function rvCard(title, sub) {
  const c = el("div", "card"); c.style.cssText = "padding:18px 20px;border:1px solid var(--line,#eee);border-radius:12px;margin-bottom:18px";
  if (title) c.appendChild(el("h3", null, title)).style.cssText = "margin:0 0 4px;font-size:16px";
  if (sub) c.appendChild(el("p", "hint", sub)).style.margin = "0 0 12px";
  return c;
}
function rvStars(n) {
  const full = Math.max(0, Math.min(5, Math.round(+n || 0)));
  const s = el("span", null, "★".repeat(full) + "☆".repeat(5 - full));
  s.style.cssText = "color:var(--plum,#5b3fa0);letter-spacing:2px;font-size:15px"; s.setAttribute("aria-label", (full) + " out of 5"); return s;
}
function renderReviews(wrap, data) {
  const reviews = data.reviews || [], counts = data.counts || {}, agg = data.aggregate || { count: 0, average: 0 };
  const g = data.google || {};

  // ── 1. Ask for a review (item 115: it can point at the Google review box) ───
  const c1 = rvCard("Ask for a review", "Send a happy customer a friendly, branded link to leave a review. They write it — nothing is posted on their behalf.");

  // Where the request sends them: your site's review page, or the Google review box.
  const destWrap = el("div"); destWrap.style.cssText = "display:flex;gap:16px;flex-wrap:wrap;margin:0 0 12px";
  const mkDest = (value, label, disabled) => {
    const lab = el("label"); lab.style.cssText = "display:flex;align-items:center;gap:6px;font-size:13.5px" + (disabled ? ";color:var(--soft,#888)" : "");
    const rb = el("input"); rb.type = "radio"; rb.name = "rv-dest"; rb.value = value; rb.disabled = !!disabled; if (value === "site") rb.checked = true;
    lab.append(rb, el("span", null, label)); return lab;
  };
  destWrap.appendChild(el("span", null, "Send them to:")).style.cssText = "font-size:13px;font-weight:600";
  destWrap.appendChild(mkDest("site", "Your website’s review page", false));
  destWrap.appendChild(mkDest("google", "Your Google review box", !g.link));
  c1.appendChild(destWrap);
  const rvDest = () => { const r = wrap.querySelector('input[name="rv-dest"]:checked'); return r && r.value === "google" ? "google" : "site"; };

  const rowA = el("div"); rowA.style.cssText = "display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;flex-wrap:wrap";
  const em = el("input"); em.type = "email"; em.placeholder = "Customer email"; em.style.cssText = RV_ICSS;
  const nm = el("input"); nm.type = "text"; nm.placeholder = "Their name (optional)"; nm.style.cssText = RV_ICSS;
  const ask = el("button", "pillbtn", "Send request"); ask.style.cssText = "height:38px;padding:0 16px;font-size:14px";   // outlined: Publish is the page's one filled button (experience review #38)
  ask.addEventListener("click", async () => {
    const email = em.value.trim(); if (!email) { toast("Add the customer's email", true); return; }
    ask.disabled = true;
    try {
      const r = await api("POST", "/reviews/request", { email, name: nm.value.trim(), destination: rvDest() });
      toast(r.data && r.data.sent === false ? "That address has opted out — nothing sent." : "Review request sent");
      em.value = ""; nm.value = "";
    } catch (err) { toast(nice(err), true); } finally { ask.disabled = false; }
  });
  const fA = (label, node) => { const w = el("label"); w.style.cssText = "display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600"; w.appendChild(el("span", null, label)); w.appendChild(node); return w; };
  rowA.append(fA("Email", em), fA("Name", nm), ask);
  c1.appendChild(rowA);

  // The Google link's state, in plain words — and the paste-once place id.
  const gState = el("div"); gState.style.cssText = "margin-top:12px;padding:10px 12px;border:1px dashed var(--line,#ddd);border-radius:10px;font-size:13px";
  if (g.link && g.source === "google") {
    gState.appendChild(el("p", null, "Google requests use the review link from your Google listing.")).style.margin = "0";
  } else {
    if (g.link) gState.appendChild(el("p", null, "Google requests use the place id you pasted.")).style.cssText = "margin:0 0 8px";
    else if (g.connected) gState.appendChild(el("p", null, "Your Google listing is connected, but Google hasn’t approved the listing connection yet, so it hasn’t handed back your review link. Paste your place id below to send Google requests now.")).style.cssText = "margin:0 0 8px";
    else gState.appendChild(el("p", null, "To send people to your Google review box, paste your Google place id — or the full “write a review” link from Google.")).style.cssText = "margin:0 0 8px";
    if (g.can_save_place_id === false) {
      gState.appendChild(el("p", "hint", "Saving a place id needs a one-time database update by your studio first.")).style.margin = "0";
    } else {
      const rowG = el("div"); rowG.style.cssText = "display:flex;gap:8px;flex-wrap:wrap";
      const pid = el("input"); pid.type = "text"; pid.placeholder = "Google place id or “write a review” link"; pid.value = g.place_id || ""; pid.style.cssText = RV_ICSS + ";flex:1;min-width:220px";
      const sv = el("button", null, "Save Google link"); sv.dataset.needs = "configure"; sv.style.cssText = BK_BTN + ";border-color:var(--plum,#5b3fa0);color:var(--plum,#5b3fa0)";
      sv.addEventListener("click", async () => {
        sv.disabled = true;
        try {
          const r = await api("POST", "/reviews/google-link", { place_id: pid.value.trim() });
          toast(r.data && r.data.link ? "Saved — Google requests are ready" : "Cleared — requests use your website’s page");
          loadReviews();
        } catch (err) { toast(nice(err), true); sv.disabled = false; }
      });
      rowG.append(pid, sv); gState.appendChild(rowG);
    }
  }
  c1.appendChild(gState);
  c1.appendChild(el("div", "hint", "Tip: the best time to ask is right after a completed job, appointment, or sale.")).style.cssText = "margin-top:10px;font-size:12.5px";
  wrap.appendChild(c1);

  // ── 1b. Just paid you (item 115): the ticked list — an offer, never automatic ─
  const paid = data.recently_paid || [];
  if (paid.length) {
    const cp = rvCard("Just paid you", "Customers whose invoice was paid recently — the best moment to ask. Tick who to ask; each person is asked at most once a month.");
    const boxes = [];
    paid.forEach((p) => {
      const row = el("label"); row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--line,#eee);border-radius:10px;margin-bottom:6px;font-size:13.5px;cursor:pointer";
      const cb = el("input"); cb.type = "checkbox"; cb.value = p.contact_id; boxes.push(cb);
      const who = el("span", null, p.name || p.email); who.style.fontWeight = "600";
      const what = el("span", "hint", (p.purpose === "deposit" ? "Deposit" : "Paid") + (p.title ? " — " + p.title : "") + (p.paid_at ? " · " + bkWhenLabel(String(p.paid_at).slice(0, 10)) : ""));
      what.style.cssText = "font-size:12.5px";
      row.append(cb, who, what); cp.appendChild(row);
    });
    const go = el("button", "pillbtn", "Ask the ticked customers"); go.style.cssText = "height:36px;padding:0 16px;font-size:13.5px;margin-top:6px";
    go.addEventListener("click", async () => {
      const ids = boxes.filter((b) => b.checked).map((b) => b.value);
      if (!ids.length) { toast("Tick at least one customer", true); return; }
      go.disabled = true;
      try {
        const r = await api("POST", "/reviews/request", { contact_ids: ids, destination: rvDest() });
        const d = (r && r.data) || {};
        const skipped = (d.skipped || []).length;
        toast("Asked " + (d.sent || 0) + (skipped ? " — " + skipped + " skipped (asked recently, opted out, or no email)" : ""));
      } catch (err) { toast(nice(err), true); } finally { go.disabled = false; }
    });
    cp.appendChild(go);
    wrap.appendChild(cp);
  }

  // ── 1c. Your Google reviews (item 115): pulled in once Google approves ──────
  const cg = rvCard("Your Google reviews", null);
  if (g.listing && (g.listing.rating || g.listing.review_count)) {
    const line = el("div"); line.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";
    line.appendChild(rvStars(g.listing.rating));
    line.appendChild(el("span", null, (g.listing.rating || "—") + " from " + (g.listing.review_count || 0) + " Google reviews")).style.fontWeight = "600";
    cg.appendChild(line);
    const bits = [];
    if (g.listing.new_reviews) bits.push(g.listing.new_reviews + " new in the last month");
    if (g.listing.unreplied) bits.push(g.listing.unreplied + " without a reply");
    if (bits.length) cg.appendChild(el("p", "hint", bits.join(" · "))).style.cssText = "margin:8px 0 0;font-size:12.5px";
    if (g.listing.maps_uri) {
      const a = el("a", null, "Open your listing on Google →"); a.href = g.listing.maps_uri; a.target = "_blank"; a.rel = "noopener";
      a.style.cssText = "display:inline-block;margin-top:10px;font-size:13px"; cg.appendChild(a);
    }
    cg.appendChild(el("p", "hint", "Google reviews are read here, not managed here — reply to them on Google.")).style.cssText = "margin:8px 0 0;font-size:12px";
  } else {
    cg.appendChild(el("p", "hint", g.connected
      ? "Google hasn’t approved the listing connection yet. Your Google reviews will show here once it does — nothing for you to do."
      : "Not connected. Once Google approves the listing connection, connect your Google Business Profile and your Google reviews will show here."));
  }
  wrap.appendChild(cg);

  // ── 2. Waiting for you (pending) ────────────────────────────────────────────
  const pending = reviews.filter((r) => r.status === "pending");
  const c2 = rvCard("Waiting for you" + (pending.length ? " (" + pending.length + ")" : ""), "New reviews from your website. Approve the ones you're happy to show, reply if you like, or hide any you'd rather not display. Nothing here is public yet.");
  if (!pending.length) c2.appendChild(el("p", "hint", "Nothing waiting. When a customer leaves a review, it appears here for your OK."));
  pending.forEach((r) => c2.appendChild(rvRow(r)));
  wrap.appendChild(c2);

  // ── 3. Showing on your site (approved) ──────────────────────────────────────
  const approved = reviews.filter((r) => r.status === "approved");
  const c3 = rvCard("Showing on your site" + (agg.count ? " · " + (agg.average % 1 === 0 ? agg.average : agg.average.toFixed(1)) + "★ from " + agg.count : ""), "Approved reviews. Add the “Reviews wall” section to a page (Edit site → add a section) to display them — with honest star ratings for search. Changes appear the next time you publish.");
  if (!approved.length) c3.appendChild(el("p", "hint", "No approved reviews yet. Approve one above and it’ll show here."));
  approved.forEach((r) => c3.appendChild(rvRow(r)));
  wrap.appendChild(c3);

  // ── 4. Hidden (collapsed) ───────────────────────────────────────────────────
  const hidden = reviews.filter((r) => r.status === "hidden");
  if (hidden.length) {
    const c4 = rvCard("Hidden (" + hidden.length + ")", "Kept but never shown. You can approve any of these later.");
    hidden.forEach((r) => c4.appendChild(rvRow(r)));
    wrap.appendChild(c4);
  }
}
function rvRow(r) {
  const row = el("div"); row.style.cssText = "padding:12px 14px;border:1px solid var(--line,#eee);border-radius:10px;margin-bottom:8px";
  const head = el("div"); head.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap";
  head.appendChild(rvStars(r.rating));
  const who = el("span", null, r.reviewer_name || "A customer"); who.style.cssText = "font-weight:600";
  head.appendChild(who);
  if (r.created_at) { const d = el("span", "hint", bkWhenLabel(String(r.created_at).slice(0, 10))); d.style.cssText = "font-size:12px;color:var(--soft,#888)"; head.appendChild(d); }
  row.appendChild(head);
  if (r.body) { const q = el("p", null, "“" + r.body + "”"); q.style.cssText = "margin:8px 0 0;color:var(--ink,#3d3646);font-size:14px;line-height:1.5"; row.appendChild(q); }
  if (r.owner_reply) { const rp = el("p", null, "You replied: " + r.owner_reply); rp.style.cssText = "margin:6px 0 0;padding:6px 10px;border-left:3px solid var(--plum,#5b3fa0);color:var(--soft,#6b6478);font-size:13px;background:var(--bg,#faf9fc)"; row.appendChild(rp); }
  const acts = el("div"); acts.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px";
  if (r.status !== "approved") {
    const ap = el("button", null, "Approve & show"); ap.style.cssText = BK_BTN + ";border-color:var(--plum,#5b3fa0);color:var(--plum,#5b3fa0)";
    ap.addEventListener("click", async () => { ap.disabled = true; try { await api("POST", "/reviews/" + r.id + "/approve"); toast("Approved — publish to show it on your site"); loadReviews(); } catch (err) { toast(nice(err), true); ap.disabled = false; } });
    acts.appendChild(ap);
  }
  if (r.status !== "hidden") {
    const hd = el("button", null, "Hide"); hd.style.cssText = BK_BTN;
    hd.addEventListener("click", async () => { hd.disabled = true; try { await api("POST", "/reviews/" + r.id + "/hide"); toast("Hidden — it won’t show on your site"); loadReviews(); } catch (err) { toast(nice(err), true); hd.disabled = false; } });
    acts.appendChild(hd);
  }
  const rep = el("button", null, r.owner_reply ? "Edit reply" : "Reply"); rep.style.cssText = BK_BTN;
  rep.addEventListener("click", () => {
    if (row.querySelector(".rv-replybox")) { row.querySelector(".rv-replybox").remove(); return; }
    const box = el("div", "rv-replybox"); box.style.cssText = "margin-top:8px;display:flex;gap:8px;flex-wrap:wrap";
    const ta = el("textarea"); ta.value = r.owner_reply || ""; ta.placeholder = "A short public reply (optional)"; ta.maxLength = 1000; ta.style.cssText = RV_ICSS + ";min-height:60px;flex:1;min-width:220px";
    const sv = el("button", null, "Save reply"); sv.style.cssText = BK_BTN + ";border-color:var(--plum,#5b3fa0);color:var(--plum,#5b3fa0)";
    sv.addEventListener("click", async () => { sv.disabled = true; try { await api("POST", "/reviews/" + r.id + "/reply", { reply: ta.value.trim() }); toast("Reply saved — publish to update your site"); loadReviews(); } catch (err) { toast(nice(err), true); sv.disabled = false; } });
    box.append(ta, sv); row.appendChild(box);
  });
  acts.appendChild(rep);
  row.appendChild(acts);
  return row;
}
// Phase DAM: the library's plain-English health — reuses /assets/health (DAM-13).
async function loadAssetHealth() {
  const host = $("assetHealth"); if (!host) return;
  let f = [];
  try { f = ((await api("GET", "/assets/health")).data || {}).findings || []; } catch (_) { host.hidden = true; return; }
  const count = (k) => f.filter((x) => x.kind === k).length;
  const bits = [];
  if (count("missing_alt")) bits.push(count("missing_alt") + " could use a description");
  if (count("unused")) bits.push(count("unused") + " not used yet");
  if (count("oversized")) bits.push(count("oversized") + " large enough to slow a page");
  if (count("duplicate")) bits.push(count("duplicate") + " look like duplicates");
  const attn = bits.length > 0;
  host.hidden = false;
  host.style.cssText = "margin:2px 0 8px;padding:10px 16px;border-radius:11px;font-size:13.5px;border:1px solid " + (attn ? "color-mix(in srgb,var(--amber,#775d31) 35%,transparent)" : "color-mix(in srgb,var(--sage,#33664b) 30%,transparent)") + ";background:" + (attn ? "var(--dds-warn-soft,#fdf8f1)" : "var(--sage-soft,#f4faf6)") + ";color:var(--ink,#3d4a42)";
  host.textContent = attn ? ("Your library: " + bits.join(" · ") + ".") : "✓ Your library looks healthy — everything described and in good shape.";
}
// What the photo editor can open: lib/media.ts's IMAGE_MIME (a PDF has nothing to crop).
const EDITABLE_PHOTO = /^image\/(jpeg|png|webp)$/;
// onEdit: the picker's Edit (openPicker), set on each photo it can open.
function renderMediaGrid(grid, manage, onPick, onEdit) {
  if (manage && FL_takeover(grid)) return;   // #180: once loaded, the Files library owns the view grid (pickers pass manage=false — untouched)
  grid.innerHTML = "";
  if (!S.media.length) {
    if (manage) grid.innerHTML = `<div class="estate" style="grid-column:1/-1;padding:30px 0"><div class="eq">No photos yet.</div><div class="eh">Add a few of your best. They’ll be ready to place anywhere on your site.</div></div>`;
    else grid.innerHTML = `<p style="color:var(--ink-2);font-size:13px">No photos yet. Upload some, or pick from Stock photos.</p>`;   // item 317: the chooser says what to do next
    return;
  }
  S.media.forEach((m) => {
    const cell = mediaCell(grid, m, manage, onPick);
    grid.appendChild(onEdit && EDITABLE_PHOTO.test(m.mime || "") ? pickerEditWrap(cell, m, onEdit) : cell);
  });
}
// One photograph cell + its manage actions — used by the classic grid above AND by
// FL_render (#180), so images keep every behavior inside the Files library view.
function mediaCell(grid, m, manage, onPick) {
  const cell = el(onPick ? "button" : "div", "mcell"); cell.__mediaId = m.id;
  if (m.thumb) { const img = el("img"); img.src = m.thumb; img.alt = m.alt_text || ""; img.loading = "lazy"; cell.appendChild(img); }
  if (m.used_by && m.used_by.length) { const b = el("span", "badge", "On your site"); b.title = "At work: " + m.used_by.join(", "); cell.appendChild(b); }
  const alt = el("span", "alt", m.alt_text || "");
  if (m.used_by && m.used_by.length) alt.appendChild(el("i", "usedline", "at work: " + m.used_by.join(", ")));
  cell.appendChild(alt);
  if (onPick) cell.addEventListener("click", () => onPick(m.id));
  if (manage) {
    // Phase V (FD-N2/N3): one-tap logo + share-image assignment — no code, publish applies it
    const row = el("div"); row.style.cssText = "display:flex;gap:6px;margin-top:6px;flex-wrap:wrap";
    const mkAssign = (field, onLabel, offLabel) => {
      const on = S.settings && S.settings[field] === m.id;
      const b = el("button", null, on ? onLabel + " ✓" : offLabel);
      b.type = "button";
      b.style.cssText = "font:inherit;font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid " + (on ? "var(--plum,#5b3fa0)" : "var(--line, #ddd)") + ";background:" + (on ? "var(--plum,#5b3fa0)" : "transparent") + ";color:" + (on ? "var(--fill-ink,#fff)" : "inherit") + ";cursor:pointer";
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
          const body = {}; body[field] = on ? null : m.id;
          await settingsPut(body);
          renderMediaGrid(grid, true);
          toast(on ? offLabel + " cleared" : onLabel + " set — publish to apply");
          scheduleChangesRefresh();
        } catch (err) { toast(nice(err), true); }
      });
      return b;
    };
    row.appendChild(mkAssign("logo_media_id", "Logo", "Set as logo"));
    row.appendChild(mkAssign("cover_media_id", "Hero photo", "Set as hero image"));
    row.appendChild(mkAssign("og_media_id", "Share image", "Use when shared"));
    row.appendChild(mkAssign("icon_media_id", "Site icon", "Use as site icon"));   // item 158
    // Phase O: edit the photo description (alt text) after upload — a11y/SEO
    const ed = el("button", null, "Edit description");
    ed.type = "button";
    ed.style.cssText = "font:inherit;font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid var(--line, #ddd);background:transparent;cursor:pointer";
    ed.addEventListener("click", (e) => {
      e.stopPropagation();
      if (cell.querySelector(".altedit")) return;
      const inp = el("input", "altedit");
      inp.type = "text"; inp.value = m.alt_text || ""; inp.maxLength = 300;
      inp.setAttribute("aria-label", "Photo description");
      inp.style.cssText = "width:100%;margin-top:6px;padding:6px 8px;font:inherit;font-size:12px;border:1px solid var(--line,#ddd);border-radius:8px";
      const commit = async () => {
        const val = inp.value.trim();
        if (val === (m.alt_text || "") || val.length < 3) { inp.remove(); return; }
        try {
          await api("PUT", `/media/${m.id}`, { alt_text: val });
          m.alt_text = val; renderMediaGrid(grid, true);
          toast("Description updated — publish to apply");
        } catch (err) { toast(nice(err), true); inp.remove(); }
      };
      inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); commit(); } if (ev.key === "Escape") inp.remove(); });
      inp.addEventListener("blur", commit);
      cell.appendChild(inp); inp.focus(); inp.select();
    });
    row.appendChild(ed);
    // AI-proposed description + tags + caption — one tap, propose-then-approve.
    // Nothing saves until the owner accepts; the manual "Edit description" above
    // always works, so this is calm and obviously optional.
    const ai = el("button", null, "✦ Suggest with AI");
    ai.type = "button";
    ai.title = "Let AI propose a description, a few tags, and a caption — you approve or edit before anything saves";
    ai.style.cssText = "font:inherit;font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid var(--plum-line,#cfc2ee);background:color-mix(in srgb,var(--plum,#5b3fa0) 6%,transparent);color:var(--plum,#5b3fa0);cursor:pointer";
    ai.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (cell.querySelector(".aisuggest")) return;
      const label = ai.textContent; ai.disabled = true; ai.textContent = "Looking at the photo…";
      try {
        const r = await api("POST", `/assets/${m.id}/suggest`, {});
        showSuggest(cell, m, grid, (r.data || {}).proposal || {});
      } catch (err) { toast(nice(err), true); }
      finally { ai.disabled = false; ai.textContent = label; }
    });
    row.appendChild(ai);
    // Phase CP-2 (DS-5): focus point — 3×3 chooser; used wherever the site crops
    const fp = el("button", null, "Set focus");
    fp.type = "button";
    fp.style.cssText = "font:inherit;font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid var(--line, #ddd);background:transparent;cursor:pointer";
    fp.addEventListener("click", (e) => {
      e.stopPropagation();
      if (cell.querySelector(".focalgrid")) return;
      const g = el("div", "focalgrid");
      g.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:3px;margin-top:6px;width:96px";
      [["Top left",0,0],["Top",50,0],["Top right",100,0],["Left",0,50],["Center",50,50],["Right",100,50],["Bottom left",0,100],["Bottom",50,100],["Bottom right",100,100]].forEach(([nm,x,y]) => {
        const dot = el("button", null, "");
        dot.type = "button"; dot.title = "Focus: " + nm; dot.setAttribute("aria-label", "Focus point: " + nm);
        const cur = (m.focal_x === x && m.focal_y === y);
        dot.style.cssText = "width:28px;height:22px;border-radius:5px;cursor:pointer;border:1px solid var(--line,#ccc);background:" + (cur ? "var(--plum,#5b3fa0)" : "color-mix(in srgb,var(--ink,#1b1525) 8%,transparent)");
        dot.addEventListener("click", async () => {
          try { await api("PUT", `/media/${m.id}`, { focal_x: x, focal_y: y }); m.focal_x = x; m.focal_y = y; g.remove(); toast("Focus set — publish to apply"); scheduleChangesRefresh(); }
          catch (err) { toast(nice(err), true); }
        });
        g.appendChild(dot);
      });
      cell.appendChild(g);
    });
    row.appendChild(fp);
    cell.appendChild(row);
    const del = icoBtn("x", "Remove photograph: " + (m.alt_text || ""), "del", 14); del.dataset.needs = "delete"; del.title = "Move this photograph to the Trash";
    del.addEventListener("click", async () => {
      // item 218: Remove moves the photo to Files' Trash for 30 days; Files puts it back
      if (!del.dataset.armed) { del.dataset.armed = "1"; del.textContent = "?"; del.title = m.used_by?.length ? `It’s at work (${m.used_by.join(", ")}) — remove anyway?` : "Move to the Trash?"; setTimeout(() => { delete del.dataset.armed; del.innerHTML = uiIcon("x", 14); }, 3200); return; }
      try { const res = await api("DELETE", `/media/${m.id}`); S.media = S.media.filter((x) => x.id !== m.id); renderMediaGrid(grid, true); toast(res && res.data && res.data.trashed ? "Moved to the Trash. Put it back from Files within 30 days." : "Removed"); }
      catch (err) { toast(nice(err), true); }
    });
    cell.appendChild(del);
  }
  return cell;
}
// The AI proposal panel: fills editable description / tags / caption fields for the
// owner to accept or edit. It NEVER auto-saves — accepting writes alt via /media and
// tags+caption via /assets; dismissing throws the suggestion away.
function showSuggest(cell, m, grid, p) {
  const prev = cell.querySelector(".aisuggest"); if (prev) prev.remove();
  const panel = el("div", "aisuggest");
  panel.style.cssText = "margin-top:8px;padding:11px 12px;border:1px solid var(--plum-line,#d8cef0);background:color-mix(in srgb,var(--plum,#5b3fa0) 5%,transparent);border-radius:10px;font-size:12px";
  const note = el("div", null, "A suggestion — edit anything. Nothing saves until you accept.");
  note.style.cssText = "color:var(--ink-2);margin-bottom:9px;font-family:var(--serif);font-style:italic";
  panel.appendChild(note);
  const mkField = (labelText, value, max) => {
    const l = el("label", null, labelText); l.style.cssText = "display:block;font-size:12px;color:var(--ink-2);margin-bottom:2px";
    const i = el("input"); i.type = "text"; i.value = value || ""; i.maxLength = max;
    i.style.cssText = "width:100%;margin-bottom:8px;padding:6px 8px;font:inherit;font-size:12px;border:1px solid var(--line,#ddd);border-radius:8px";
    panel.appendChild(l); panel.appendChild(i); return i;
  };
  const altI = mkField("Description (alt text)", p.alt, 200);
  const tagsI = mkField("Tags", (p.tags || []).join(", "), 240);
  const capI = mkField("Caption", p.caption, 200);
  const btns = el("div"); btns.style.cssText = "display:flex;gap:16px;align-items:baseline";
  const accept = el("button", "pillbtn inked", "Accept");
  accept.type = "button";
  accept.addEventListener("click", async () => {
    const alt = altI.value.trim();
    if (alt.length < 3) { toast("A few words about the photograph first — it matters.", true); return; }
    accept.disabled = true;
    try {
      await api("PUT", `/media/${m.id}`, { alt_text: alt });
      m.alt_text = alt;
      const tags = tagsI.value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 40);
      try { await api("PATCH", `/assets/${m.id}`, { tags, caption: capI.value.trim() }); } catch (_) { /* alt is the essential save; tags/caption best-effort */ }
      panel.remove(); renderMediaGrid(grid, true);
      toast("Saved — publish to apply"); scheduleChangesRefresh();
    } catch (err) { accept.disabled = false; toast(nice(err), true); }
  });
  const dismiss = el("button", "quietact", "Dismiss");
  dismiss.type = "button";
  dismiss.addEventListener("click", () => panel.remove());
  btns.appendChild(accept); btns.appendChild(dismiss);
  panel.appendChild(btns);
  cell.appendChild(panel);
  altI.focus(); altI.select();
}
// ── Builder item 317: photos go in by the batch, descriptions asked after, big ones made smaller ──
// A phone photo is often 12 MB and 4,000 px across; the site never shows more than about
// 2,400 px, so anything past that, or past 3 MB, is redrawn at 2,400 px on its long side here
// in the browser (a PNG stays a PNG, so it keeps its transparency). The server's 10 MB rule is
// then never the thing that turns a photo away.
const PHOTO_MAX_PX = 2400, PHOTO_SHRINK_FROM = 3 * 1024 * 1024, PHOTO_MAX_BYTES = 10 * 1024 * 1024;
async function dcShrinkPhoto(file) {
  const asIs = { blob: file, mime: file.type, width: undefined, height: undefined, shrunk: false };
  let src = null;
  try { if (window.createImageBitmap) src = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) { src = null; }
  if (!src) src = await new Promise((res) => { const img = new Image(); img.onload = () => res(img); img.onerror = () => res(null); img.src = URL.createObjectURL(file); });
  if (!src) return asIs;
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight, big = Math.max(w, h);
  if (!big || (big <= PHOTO_MAX_PX && file.size <= PHOTO_SHRINK_FROM)) return { ...asIs, width: w, height: h };
  try {
    const k = Math.min(1, PHOTO_MAX_PX / big), nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k));
    const c = document.createElement("canvas"); c.width = nw; c.height = nh;
    c.getContext("2d").drawImage(src, 0, 0, nw, nh);
    const png = file.type === "image/png";
    let blob = await new Promise((res) => c.toBlob(res, png ? "image/png" : "image/jpeg", 0.86)), mime = png ? "image/png" : "image/jpeg";
    if (blob && png && blob.size > PHOTO_MAX_BYTES) { const j = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.86)); if (j) { blob = j; mime = "image/jpeg"; } }
    if (!blob) return { ...asIs, width: w, height: h };
    return { blob, mime, width: nw, height: nh, shrunk: true };
  } catch (_) { return { ...asIs, width: w, height: h }; }
}
// A first description from the file's name: "fresh-pasta_basil.jpg" → "Fresh pasta basil";
// a camera's name ("IMG_4021.HEIC") gives nothing, so it is "Photo" until they say.
function photoWords(name) {
  const words = String(name || "").replace(/\.[a-z0-9]+$/i, "").split(/[-_\s.]+/).filter((t) => t && !/^\d+$/.test(t) && !/^(img|dsc|dcim|pxl|mvimg|image|photo|screenshot|screen shot|jpeg|jpg|png|copy)$/i.test(t));
  const s = words.join(" ").trim();
  return s.length >= 3 ? s.charAt(0).toUpperCase() + s.slice(1) : "Photo";
}
// Every file in the list goes up, one after another, with its first description; then the
// descriptions are asked for in one sheet (dcDescribePhotos). Resolves the photos that landed.
async function dcUploadPhotos(files, opts) {
  const list = Array.from(files || []).filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
  const skipped = Array.from(files || []).length - list.length;
  if (skipped) toast(skipped === 1 ? "One file isn’t a JPEG, PNG or WebP photo, so it was left out." : skipped + " files aren’t JPEG, PNG or WebP photos, so they were left out.", true);
  if (!list.length) return [];
  const wid = (opts && opts.whisper) || "topWhisper", done = [];
  let shrunk = 0;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    whisper(wid, list.length === 1 ? "Bringing it in…" : "Bringing in " + (i + 1) + " of " + list.length + "…");
    try {
      const out = await dcShrinkPhoto(f); if (out.shrunk) shrunk++;
      const words = photoWords(f.name);
      const r = await api("POST", "/media/upload-url", { mime: out.mime, bytes: out.blob.size, alt_text: words, width: out.width, height: out.height });
      const put = await fetch(r.data.upload_url, { method: "PUT", headers: { "Content-Type": out.mime }, body: out.blob });
      if (!put.ok) throw new Error("“" + f.name + "” didn’t finish arriving — nothing was lost, try it once more.");
      done.push({ id: r.data.media_id, name: f.name, words });
    } catch (err) { toast(nice(err), true); }
  }
  whisper(wid, done.length ? "saved" : "");
  if (done.length) await loadMedia();
  if (done.length) toast((done.length === 1 ? "1 photo" : done.length + " photos") + " in your collection" + (shrunk ? (shrunk === 1 ? ", one made smaller for the web" : ", " + shrunk + " made smaller for the web") : ""));
  if (done.length && !(opts && opts.quiet)) dcDescribePhotos(done);
  return done;
}
// One sheet for the descriptions, after the photos are in: each with the words guessed from its
// file name, saved only where they were changed. "Later" keeps the guesses.
function dcDescribePhotos(items) {
  const d = svDialog(items.length === 1 ? "Describe this photo" : "Describe these photos", "A few words each: read aloud for people who can’t see them, and read by Google. The first guess comes from each file’s name.");
  const rows = [];
  items.forEach((it) => {
    const m = (S.media || []).find((x) => x.id === it.id) || {};
    const row = el("div", "ph-desc-row");
    const img = el("img"); img.alt = ""; if (m.thumb) img.src = m.thumb; row.appendChild(img);
    const inp = el("input"); inp.type = "text"; inp.maxLength = 200; inp.value = m.alt_text || it.words; inp.setAttribute("aria-label", "Description for " + it.name); row.appendChild(inp);
    rows.push({ it, inp, was: inp.value }); d.body.appendChild(row);
  });
  const acts = el("div", "acts");
  const save = el("button", "pillbtn sm inked", "Save descriptions"); save.type = "button";
  const later = el("button", "pillbtn sm", "Later"); later.type = "button";
  acts.append(save, later); d.body.appendChild(acts);
  later.addEventListener("click", () => d.close());
  save.addEventListener("click", async () => {
    save.disabled = true;
    const changed = rows.filter((r) => r.inp.value.trim().length >= 3 && r.inp.value.trim() !== r.was);
    try {
      for (const r of changed) { await api("PUT", `/media/${r.it.id}`, { alt_text: r.inp.value.trim() }); const m = (S.media || []).find((x) => x.id === r.it.id); if (m) m.alt_text = r.inp.value.trim(); }
      d.close(); if (changed.length) { toast("Descriptions saved"); if ($("mediaGrid")) renderMediaGrid($("mediaGrid"), true); if ($("panelFilesGrid")) pfRefresh(); }
    } catch (err) { save.disabled = false; toast(nice(err), true); }
  });
  setTimeout(() => { try { rows[0].inp.focus(); rows[0].inp.select(); } catch (_) {} }, 30);
}
// Files dropped anywhere on a host go in the same way.
function dcDropPhotos(host, onDone) {
  if (!host || host.__dcDrop) return; host.__dcDrop = true;
  host.addEventListener("dragover", (e) => { if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) { e.preventDefault(); host.classList.add("ph-over"); } });
  host.addEventListener("dragleave", () => host.classList.remove("ph-over"));
  host.addEventListener("drop", async (e) => { host.classList.remove("ph-over"); const fs = e.dataTransfer && e.dataTransfer.files; if (!fs || !fs.length) return; e.preventDefault(); const got = await dcUploadPhotos(fs); if (onDone) onDone(got); });
}
$("btnUpload").addEventListener("click", () => $("fileInput").click());
$("fileInput").setAttribute("multiple", "");
$("fileInput").addEventListener("change", async () => {
  const fs = Array.from($("fileInput").files || []); if (!fs.length) return;
  await dcUploadPhotos(fs, { whisper: "save-media" });
  $("fileInput").value = "";
});
dcDropPhotos($("mediaGrid"));
$("btnUploadCancel").addEventListener("click", () => { S.pendingFile = null; $("uploadPrep").hidden = true; $("fileInput").value = ""; });
$("btnUploadGo").addEventListener("click", async () => {
  const f = S.pendingFile, alt = $("upload-alt").value.trim();
  if (!f) return;
  if (alt.length < 3) { toast("A few words about the photograph first — it matters.", true); return; }
  whisper("save-media", "bringing it in…");
  try {
    const dims = await new Promise((res) => { const img = new Image(); img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight }); img.onerror = () => res({}); img.src = URL.createObjectURL(f); });
    const r = await api("POST", "/media/upload-url", { mime: f.type, bytes: f.size, alt_text: alt, width: dims.w, height: dims.h });
    const put = await fetch(r.data.upload_url, { method: "PUT", headers: { "Content-Type": f.type }, body: f });
    if (!put.ok) throw new Error("The photograph didn’t finish arriving — nothing was lost, try once more.");
    whisper("save-media", "saved");
    $("uploadPrep").hidden = true; $("fileInput").value = ""; S.pendingFile = null;
    await loadMedia(); toast("In the collection");
  } catch (err) { whisper("save-media", ""); toast(nice(err), true); }
});
let pickerCb = null, PICK_MANY = null;   // item 317: many: the ids picked so far
function pickerPaintGrid() {
  const onPick = pickerCb; if (!onPick) return;
  if (!PICK_MANY) { renderMediaGrid($("pickerGrid"), false, (id) => { closeSheet("pickerScrim"); onPick(id); }, editInPicker); return; }
  renderMediaGrid($("pickerGrid"), false, (id) => {
    const at = PICK_MANY.indexOf(id); if (at >= 0) PICK_MANY.splice(at, 1); else PICK_MANY.push(id);
    $("pickerGrid").querySelectorAll(".mcell").forEach((c) => { const on = PICK_MANY.includes(c.__mediaId); c.classList.toggle("picked", on); c.setAttribute("aria-pressed", String(on)); });
    pickerManyBtn();
  });
  $("pickerGrid").querySelectorAll(".mcell").forEach((c) => { c.setAttribute("aria-pressed", "false"); });
  pickerManyBtn();
}
function pickerManyBtn() {
  const b = $("btnPickMany"); if (!b) return;
  b.hidden = !PICK_MANY; b.disabled = !(PICK_MANY && PICK_MANY.length);
  b.textContent = PICK_MANY && PICK_MANY.length ? "Add " + (PICK_MANY.length === 1 ? "this photo" : PICK_MANY.length + " photos") : "Add the photos you pick";
}
// opts.many: several at once (a gallery); the callback gets the ids in the order they were picked.
function openPicker(onPick, opts) {
  pickerCb = onPick; PICK_MANY = opts && opts.many ? [] : null;
  const t = $("pickTitle"); if (t) t.textContent = PICK_MANY ? "Choose photographs" : "Choose a photograph";
  const none = $("btnPickNone"); if (none) none.hidden = !!PICK_MANY;
  pickerPaintGrid();
  // item 317: a library with nothing in it opens on Stock, searched for the kind of business
  pickerShowTab((S.media || []).length ? "mine" : "stock");
  openSheet("pickerScrim");
}
$("btnPickNone").addEventListener("click", () => { const cb = pickerCb; closeSheet("pickerScrim"); if (cb) cb(null); });
$("btnPickMany").addEventListener("click", () => { const cb = pickerCb, ids = (PICK_MANY || []).slice(); if (!ids.length) return; closeSheet("pickerScrim"); if (cb) cb(ids); });
// Upload from inside the chooser: the photos land in the library and, one, in the slot.
$("pickUploadBtn").addEventListener("click", () => $("pickUploadIn").click());
$("pickUploadIn").addEventListener("change", async () => {
  const fs = Array.from($("pickUploadIn").files || []); $("pickUploadIn").value = ""; if (!fs.length) return;
  const got = await dcUploadPhotos(fs);
  pickerAfterUpload(got);
});
function pickerAfterUpload(got) {
  if (!got.length || !pickerCb) return;
  if (PICK_MANY) { got.forEach((g) => { if (!PICK_MANY.includes(g.id)) PICK_MANY.push(g.id); }); pickerPaintGrid(); pickerShowTab("mine"); return; }
  if (got.length === 1) { const cb = pickerCb; closeSheet("pickerScrim"); cb(got[0].id); return; }
  pickerPaintGrid(); pickerShowTab("mine");
}
dcDropPhotos($("pickerMinePane"), pickerAfterUpload);

/* ── Items 39 + 117 in the picker: Edit on a photo opens the same editor as Files
 *    (image-editor.js, loaded on first use). Saving makes a NEW file beside the
 *    original, as Files does (a replaced file is soft-deleted, and media_gc removes
 *    it after 7 days), and that copy is what the slot gets. Cancel leaves the
 *    picker open on the photos. ── */
// Bump ?v= with files.html's whenever image-editor.js changes: browsers keep a .js file for a day.
let PHOTO_EDITOR = null;
function loadPhotoEditor() {
  if (window.DDSImageEditor) return Promise.resolve(window.DDSImageEditor);
  if (!PHOTO_EDITOR) PHOTO_EDITOR = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "/image-editor.js?v=2";
    s.onload = () => window.DDSImageEditor ? res(window.DDSImageEditor) : rej(new Error("missing"));
    s.onerror = () => rej(new Error("load"));
    document.head.appendChild(s);
  }).catch((e) => { PHOTO_EDITOR = null; throw e; });   // a failed load can be tried again
  return PHOTO_EDITOR;
}
function pickerEditWrap(cell, m, onEdit) {
  const wrap = el("div", "mwrap");
  const b = el("button", "medit", "Edit"); b.type = "button";
  b.setAttribute("aria-label", "Edit " + (m.alt_text || "this photo"));
  b.addEventListener("click", () => onEdit(m, b));
  wrap.append(cell, b);
  return wrap;
}
async function editInPicker(m, btn) {
  const cb = pickerCb;   // the slot this picker was opened for
  if (!cb || btn.disabled) return;
  btn.disabled = true; btn.textContent = "Opening…";
  const ready = () => { btn.disabled = false; btn.textContent = "Edit"; };
  let d = null;
  try { d = (await api("GET", "/assets/" + m.id)).data; } catch (err) { ready(); toast(nice(err), true); return; }
  const a = d && d.asset;
  const src = d && (d.thumb_fallback || d.download_url);   // the ORIGINAL's own bytes: the grid's thumb is a small re-encode
  if (!a || !src) { ready(); toast("Couldn’t open this photo for editing. Try again in a moment.", true); return; }
  let ed; try { ed = await loadPhotoEditor(); } catch (_) { ready(); toast("The photo editor didn’t load. Check your connection and try again.", true); return; }
  ready();
  if (pickerCb !== cb) return;   // the picker closed while it loaded
  const res = await ed.open({ src, fallbackSrc: d.download_url, name: a.name, mime: a.mime,
    saveLabel: "Save a copy and use it", note: "Saving makes a new file and puts it here. The original stays exactly as it is.",
    cutout: d.cutout_available ? () => pickerCutout(a.id) : null, onSave: (out) => saveEditedCopy(a, out) });
  if (!res || !res.saved || !res.value) return;
  await loadMedia();   // S.media gains the copy, so the slot's thumbnail resolves
  toast(res.value.patched ? "Saved as a new file. The original is unchanged." : "Saved as a new file. Its name and folder didn’t copy over, so set them in Files.");
  if (pickerCb !== cb) return;
  closeSheet("pickerScrim");
  cb(res.value.id);
}
const editedName = (n) => { n = String(n || "Photo").trim() || "Photo"; return /\(edited\)$/i.test(n) ? n : (n + " (edited)").slice(0, 200); };
async function blobHash(blob) {
  try {
    if (!(window.crypto && crypto.subtle)) return "";
    const h = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (_) { return ""; }
}
// files.html's saveEdited, through this page's api(): the SAME door as any upload (its
// size and file limits, the content hash), then the original's organisation.
// Returns {error} to keep the editor open with the reason.
async function saveEditedCopy(a, out) {
  const alt = String(a.alt_text || "").trim().length >= 3 ? a.alt_text : (String(a.name || "").trim().length >= 3 ? a.name : "Photo");
  let up;
  try { up = (await api("POST", "/media/upload-url", { mime: out.mime, bytes: out.blob.size, alt_text: alt, width: out.width, height: out.height, content_hash: (await blobHash(out.blob)) || undefined })).data; }
  catch (err) { return { error: err && (err.status || err.offline) ? nice(err) : "The upload couldn’t start, so nothing was saved. Try again." }; }
  let put; try { put = await fetch(up.upload_url, { method: "PUT", headers: { "Content-Type": out.mime }, body: out.blob }); } catch (_) { put = { ok: false }; }
  if (!put.ok) return { error: "The upload didn’t finish, so nothing was saved. Try again." };
  const id = up.media_id, meta = a.metadata || {};
  // a client-private photo's copy is private too, and first, before anything names it
  if (a.client_private) await api("PATCH", "/assets/" + id, { client_private: true }).catch(() => {});
  const body = { name: editedName(a.name), metadata: { edited_from: a.id, edited_from_name: String(a.name || "").slice(0, 200), edited_at: new Date().toISOString(), edits: out.edits } };
  if (a.collection) body.collection = a.collection;
  if ((a.tags || []).length) body.tags = a.tags;
  if (meta.caption) body.caption = meta.caption;
  if (a.brand) body.brand = true;
  const patched = await api("PATCH", "/assets/" + id, body).then(() => true, () => false);
  return { id, patched };
}
// "Cut out the subject" (files.html's cutoutOf, with this page's sign-in): the server
// asks Replicate (lib/cutout.ts) and answers the PNG itself, or 202 with a job to ask
// after while a quiet model starts up. Resolves the Blob, or {error} for the editor to say.
const CUTOUT_POLL_MS = 2500, CUTOUT_POLLS = 72;   // three minutes at most
async function pickerCutout(id) {
  const call = async (path, method) => {
    const { data } = await sb.auth.getSession();
    return fetch(FN + path, { method, headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ENV.anon, "x-dds-user-jwt": data?.session?.access_token || "", "x-dds-scope-site": (new URLSearchParams(location.search).get('client')||''), ...REGION_HEADER } });
  };
  const fail = "The cut-out didn’t come through, so nothing changed. Try again in a moment.";
  let r; try { r = await call("/assets/" + id + "/cutout", "POST"); } catch (_) { return { error: "The cut-out couldn’t start. Check your connection and try again." }; }
  for (let i = 0; ; i++) {
    if (r.status === 200 && /^image\/png\b/.test(r.headers.get("content-type") || "")) return await r.blob();
    const b = await r.json().catch(() => ({}));
    const job = r.status === 202 && b.data && b.data.job;
    if (!job) return { error: (b && b.message) || fail };
    if (i >= CUTOUT_POLLS) return { error: "The cut-out service is taking too long just now, so nothing changed. Try again in a few minutes." };
    await new Promise((res) => setTimeout(res, CUTOUT_POLL_MS));
    try { r = await call("/assets/cutout/" + encodeURIComponent(job), "GET"); } catch (_) { return { error: fail }; }
  }
}

/* ── FD-T10 in-builder Stock Library: search Pexels + import into Files without
 *    leaving the builder. Reuses the SAME endpoints as files.html's Stock Library
 *    (GET /stock/search, POST /stock/import). Selecting a result imports it to the
 *    user's own site (presence_media) and sets it as this block's media in one tap.
 *    Nothing auto-publishes — the imported photo enters the library + the block
 *    draft, applied via the normal publish flow. state: null|loading|ok|off ── */
const PICK_STOCK = { state: null, q: "", results: [], provider: "", license: "", error: "" };
function pickerShowTab(which) {
  const mine = which !== "stock";
  $("pickTabMine").classList.toggle("on", mine); $("pickTabMine").setAttribute("aria-selected", String(mine));
  $("pickTabStock").classList.toggle("on", !mine); $("pickTabStock").setAttribute("aria-selected", String(!mine));
  $("pickerMinePane").hidden = !mine; $("pickerStockPane").hidden = mine;
  if (!mine) {
    // item 317: Stock opens on photos for the kind of business until something else is searched for
    if (!PICK_STOCK.q && PICK_STOCK.state !== "off") { PICK_STOCK.q = stockWordsFor(); const q = $("pickStockQ"); if (q) q.value = PICK_STOCK.q; loadPickerStock(); return; }
    renderPickerStock(); const q = $("pickStockQ"); if (q) q.focus();
  }
}
const STOCK_WORDS = { restaurant: "restaurant food", coffee_shop: "coffee cafe", cafe: "cafe", bar: "bar cocktails", food_truck: "street food", retail: "shop products", fitness: "fitness gym", gym: "gym workout", yoga: "yoga studio", nonprofit: "community volunteers", church: "church community", salon: "hair salon", spa: "spa wellness", dentist: "dental clinic", plumber: "plumber tools", contractor: "home renovation", landscaper: "garden landscaping", cleaning: "clean home", photographer: "camera photography", lawyer: "law office", accountant: "office desk", realtor: "house exterior", auto: "car repair", pet: "dog grooming", generic: "small business" };
function stockWordsFor() { const k = (S.settings && S.settings.industry_key) || "generic"; return STOCK_WORDS[k] || String(k).replace(/_/g, " "); }
$("pickTabMine").addEventListener("click", () => pickerShowTab("mine"));
$("pickTabStock").addEventListener("click", () => pickerShowTab("stock"));
$("pickStockGo").addEventListener("click", () => { PICK_STOCK.q = $("pickStockQ").value.trim(); loadPickerStock(); });
$("pickStockQ").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); PICK_STOCK.q = $("pickStockQ").value.trim(); loadPickerStock(); } });
async function loadPickerStock() {
  PICK_STOCK.state = "loading"; renderPickerStock();
  try {
    const r = await api("GET", "/stock/search?q=" + encodeURIComponent(PICK_STOCK.q || "") + "&page=1");
    const d = (r && r.data) || {};
    PICK_STOCK.results = d.images || [];
    PICK_STOCK.provider = d.provider || "";
    PICK_STOCK.license = (d.license && d.license.name) || "";
    PICK_STOCK.state = "ok";
  } catch (err) {
    if (err && err.status === 503) { PICK_STOCK.state = "off"; }
    // PR 218: a refused search answers with why (a key Pexels won't take, too many
    // searches); an empty list here read "No matches" for every word
    else { PICK_STOCK.results = []; PICK_STOCK.state = "error"; PICK_STOCK.error = err && (err.status || err.offline) ? nice(err) : "The stock library couldn’t search just now. Try again in a little while."; }
  }
  renderPickerStock();
}
function renderPickerStock() {
  const grid = $("pickStockGrid"), note = $("pickStockNote"), st = PICK_STOCK.state;
  note.textContent = (st === "off" || st === "error" || st == null) ? ""
    : (PICK_STOCK.license
      ? "Royalty-free from " + PICK_STOCK.provider + " · " + PICK_STOCK.license + " · added to your Files and hosted on your own site."
      : "Professional royalty-free photos, added straight to your Files.");
  if (st === "off") { grid.innerHTML = `<div class="estate" style="grid-column:1/-1;padding:24px 8px"><div class="eq">Stock photos aren’t turned on yet.</div><div class="eh">Add a Pexels key to search professional royalty-free photos and drop them straight into this block — hosted on your own site.</div></div>`; return; }
  if (st === "loading") { grid.innerHTML = `<p style="grid-column:1/-1;color:var(--ink-2);font-size:13px">Searching…</p>`; return; }
  if (st === "error") { grid.innerHTML = `<div class="estate" role="status" style="grid-column:1/-1;padding:24px 8px"><div class="eq">${esc(PICK_STOCK.error)}</div></div>`; return; }
  if (st == null) { grid.innerHTML = `<div class="estate" style="grid-column:1/-1;padding:24px 8px"><div class="eq">Search for a photo above.</div><div class="eh">Try “office”, “coffee”, “construction”, “salon”…</div></div>`; return; }
  if (!PICK_STOCK.results.length) { grid.innerHTML = `<div class="estate" style="grid-column:1/-1;padding:24px 8px"><div class="eq">No matches — try another word.</div><div class="eh">Try “office”, “coffee”, “construction”, “salon”…</div></div>`; return; }
  grid.innerHTML = "";
  PICK_STOCK.results.forEach((im) => {
    const cell = el("button", "mcell"); cell.type = "button";
    cell.setAttribute("aria-label", "Use this stock photo" + (im.credit ? " by " + im.credit : ""));
    const img = el("img"); img.src = im.thumb; img.alt = im.alt || ""; img.loading = "lazy"; cell.appendChild(img);
    if (im.credit) cell.appendChild(el("span", "alt", im.credit));
    cell.addEventListener("click", () => importStockToBlock(im, cell));
    grid.appendChild(cell);
  });
}
// Select → import to Files (Add to my files) → set as this block's media → close.
async function importStockToBlock(im, cell) {
  if (cell.dataset.busy) return; cell.dataset.busy = "1"; cell.style.opacity = ".5";
  const badge = el("span", "badge", "Adding…"); cell.appendChild(badge);
  try {
    const r = await api("POST", "/stock/import", { stock_id: im.id, alt_text: im.alt, credit: im.credit || "" });
    const mid = r && r.data && r.data.media_id;
    if (!mid) throw new Error("That photo couldn’t be added — please try another.");
    await loadMedia();   // refresh S.media so the block preview thumbnail resolves for the new id
    toast("Added to your Files");
    const cb = pickerCb; closeSheet("pickerScrim");
    if (cb) cb(mid);
  } catch (err) {
    cell.style.opacity = ""; badge.remove(); delete cell.dataset.busy;
    if (err && err.status === 503) { PICK_STOCK.state = "off"; renderPickerStock(); }
    else toast(nice(err), true);
  }
}

/* ── Phase SKU: feature-edition gate. null features = all on (studio_os default,
   preserves today's behavior). A standalone CMS lacks the Business-OS brains
   (business_moments/connected/ai) even while it keeps full website drafting. ── */
function hasFeature(f) { return !S.features || S.features.indexOf(f) >= 0; }
// SC-1: static links out of the editor must keep the agency drill-in scope —
// dropping ?client= silently switches a scoped operator back to their own tenant.
function carryScopeOnLinks() {
  const c = new URLSearchParams(location.search).get("client");
  if (!c) return;
  document.querySelectorAll('a[href^="/today.html"], a[href^="/files.html"], a[href^="/inbox.html"], a[href^="/crm.html"], a[href^="/analytics.html"], a[href^="/schedule.html"]').forEach((a) => {
    const h = a.getAttribute("href");
    if (h.indexOf("client=") >= 0) return;
    const [pathq, hash] = h.split("#");
    a.setAttribute("href", pathq + (pathq.indexOf("?") >= 0 ? "&" : "?") + "client=" + encodeURIComponent(c) + (hash ? "#" + hash : ""));
  });
}

function applyEditionGating() {
  const isMonitor = !!(S.site && S.site.edition === "monitor");
  document.documentElement.classList.toggle("plan-watch", isMonitor);
  gateSiteMenu();
  // A watch-plan (monitor) site OBSERVES — it never publishes. Hide BOTH publish
  // affordances (desktop button + mobile dock tab) and say so once, calmly,
  // instead of letting every tap end in a server refusal.
  if (isMonitor) {
    const p = $("btnPublish"); if (p) p.style.display = "none";
    const dp = $("dockPublish"); if (dp) dp.style.display = "none";
    const up = $("btnUpload"); if (up) up.style.display = "none";   // uploads are writes too
    if (!document.getElementById("monitorNote")) {
      const n = document.createElement("div");
      n.id = "monitorNote";
      n.style.cssText = "max-width:900px;margin:10px auto 0;padding:10px 16px;border-radius:10px;background:var(--warn-soft,#f3ead9);color:var(--warn,#775d31);font-size:13.5px";
      const forClient = studioInClient();
      n.textContent = forClient
        ? "This client’s plan watches their website — it doesn’t include editing or publishing here. To build it from Studio OS, move them to a plan with the website builder."
        : "This plan watches your website — it doesn’t include editing or publishing here. To build it from Studio OS, ask us about upgrading.";
      const host = document.querySelector(".main") || document.body;
      host.insertBefore(n, host.firstChild);
    }
  }
}

/* ── the overview board: top row · stat strip · pages · waiting to publish · the
   rail cards. Every number here comes from a read the page already made (health,
   changes, settings, media, first-run) or an existing route (/forms/inbox,
   /analytics/dashboard, /search/health, /site/templates). ── */
const HB_ICON = {
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  about: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  faq: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5"/><path d="M12 17h.01"/></svg>',
  updates: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/></svg>',
  contact: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  page: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/></svg>',
  alert: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9L2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>',
};
const hbCap = (s) => { s = String(s || ""); return s.charAt(0).toUpperCase() + s.slice(1); };
// the public address of the live site (custom domain, else the hosting subdomain)
// Builder item 261: ONE rule for "is it live", made on the server (lib/site_live.ts, sent as
// GET /site's `live`): an address alone never made a site live. The address is still the site's
// once it has been published; before that there is nothing to see.
function siteLiveUrl() {
  const s = S.site; if (!s) return null;
  if (S.live && S.live.published === false) return null;
  if (s.custom_domain) return `https://${s.custom_domain}`;
  if (s.netlify_site_id) return `https://presence-${String(s.id).replace(/-/g, "").slice(0, 12)}.netlify.app`;
  return null;
}
// The site's pages: the template's standard pages + the owner's own pages from
// settings. Each standard page knows which
// diff sections land on it, so a pending change shows on the page it touches.
function hbStandardPages() {
  const v = (typeof VOCAB === "object" && VOCAB) || {};
  return [
    { key: "home", path: "/", title: "Home", sum: "Your welcome, what you offer, testimonials", view: "design", slug: "", icon: "home", sections: ["business", "testimonials", "media"] },
    { key: "menu", path: v.path || "/menu/", title: v.label || "Menu", sum: "What you offer", view: "offerings", icon: "menu", sections: ["offerings"] },
    { key: "about", path: "/about/", title: "About", sum: "Your story, in your words", view: "business", icon: "about", sections: ["business"] },
    // item 297: an empty FAQ or Updates page stays off the live site (and out of its menu) until it has something on it
    { key: "faq", path: "/faq/", title: "FAQ", sum: (S.faqs || []).length ? "The questions customers ask, answered" : "Not on your live site until it has a question", view: "faqs", icon: "faq", sections: ["faqs"] },
    { key: "updates", path: "/updates/", title: "Updates", sum: (S.posts || []).some((p) => p.status === "published") ? "News and seasonal notes" : "Not on your live site until an update is published", view: "updates", icon: "updates", sections: ["updates"] },
    { key: "contact", path: "/contact/", title: "Contact", sum: "Hours, map, how to reach you", view: "business", icon: "contact", sections: ["business"] },
  ];
}
function hbPageRows() {
  const std = hbStandardPages();
  const own = (typeof dcPagesArr === "function" ? dcPagesArr() : []).map((p) => ({
    key: "page:" + p.slug, path: "/" + p.slug + "/", title: p.title || p.slug, slug: p.slug, view: "design", icon: "page",
    sum: (Array.isArray(p.blocks) && p.blocks.length ? `${p.blocks.length} section${p.blocks.length === 1 ? "" : "s"}` : "Empty page"),
    sections: [],
  }));
  return std.concat(own);
}
function hbPageChip(pg, changes, live, firstPublish) {
  const chip = el("span", "hb-chip"); chip.appendChild(el("i", "d"));
  const tp = hbTreePage(pg);
  if (tp && HB_TREE_FLAG[tp.status]) {   // the website map's word: something here blocks publishing or deserves a look
    chip.classList.add(HB_TREE_FLAG[tp.status]); chip.appendChild(document.createTextNode(tp.status_label)); chip.title = tp.issue_count ? `${tp.issue_count} item${tp.issue_count === 1 ? "" : "s"} on this page` : "";
    return chip;
  }
  const n = firstPublish ? 0 : changes.filter((ch) => pg.sections.indexOf(ch.section) >= 0).length;
  if (n) { chip.classList.add("warn"); chip.appendChild(document.createTextNode(`${n} change${n === 1 ? "" : "s"} waiting`)); }
  else if (live) { chip.classList.add("good"); chip.appendChild(document.createTextNode("Published")); }
  else chip.appendChild(document.createTextNode("Not live yet"));
  return chip;
}
function hbOpenPage(pg) {
  if (pg.view === "design") { go("design"); if (typeof dcSwitchPage === "function") dcSwitchPage(pg.slug || ""); return; }
  go(pg.view);
}
// ── The Pages tab: every page and the top menu, in one place ──
// Main navigation is what the site's top menu shows; Not linked is every page that's live
// but off it. With no custom menu the list is the one the templates build (pgAutoNav keeps
// their order), so nothing changes on the site until someone moves a row or renames a label.
// A row is named by { href, parent }, never held across a wait, since the lists are rebuilt
// from the saved settings once any pending edit has landed.
const PG_NAV_MAX = 12, PG_KIDS_MAX = 8;
async function pgResetNav() { if (await askYes("Remove your custom menu and let the site build it automatically from your pages?", { ok: "Use the automatic menu", danger: true })) { await dcSaveNav(null); renderPagesBar(); } }
function pgHasCustomNav() { return Array.isArray(S.settings && S.settings.nav) && S.settings.nav.length > 0; }
function pgAutoNav() {
  const v = (typeof VOCAB === "object" && VOCAB) || {};
  const items = [{ label: "Home", href: "/" }, { label: v.label || "Menu", href: v.path || "/menu/" }, { label: "About", href: "/about/" }, { label: "FAQ", href: "/faq/" }, { label: "Updates", href: "/updates/" }, { label: "Contact", href: "/contact/" }];
  dcPagesArr().forEach((p) => { if (!p.hideNav) items.push({ label: p.title || p.slug, href: "/" + p.slug + "/" }); });
  return items;
}
function pgNav() { return pgHasCustomNav() ? JSON.parse(JSON.stringify(S.settings.nav)) : pgAutoNav(); }
function pgModel() {
  const pages = hbPageRows(), byHref = new Map(pages.map((p) => [p.path, p]));
  const nav = pgNav(), used = new Set(), menu = [];
  const add = (it, parent) => { const pg = byHref.get(it.href) || null; if (pg) used.add(it.href); menu.push({ it, pg, parent }); };
  nav.forEach((it) => { add(it, null); (it.children || []).forEach((k) => add(k, it)); });
  return { nav, menu, unlinked: pages.filter((p) => !used.has(p.path)) };
}
// A row's entry in a fresh model, or null if it has gone. A page that isn't in the menu has no `it`.
function pgEntry(m, ref) {
  const hit = m.menu.find((e) => e.it.href === ref.href && (e.parent ? e.parent.href : null) === (ref.parent || null));
  if (hit) return hit;
  const pg = m.unlinked.find((p) => p.path === ref.href);
  return pg ? { it: null, pg, parent: null } : null;
}
function pgLabelFor(pg) { const auto = pgAutoNav().find((x) => x.href === pg.path); return auto ? auto.label : pg.title; }
// Take a row out of the menu (or nowhere, if it was off it), and give back its menu item.
function pgLift(m, e) {
  if (!e.it) return { label: pgLabelFor(e.pg), href: e.pg.path };
  const arr = e.parent ? e.parent.children : m.nav;
  arr.splice(arr.indexOf(e.it), 1);
  if (e.parent && !e.parent.children.length) delete e.parent.children;
  return e.it;
}
// Put an item in the menu before a row: before a dropdown's row joins that dropdown,
// and an item with its own dropdown stays on the top level.
function pgLand(m, item, before) {
  if (before && before.parent) {
    if ((item.children || []).length || item.folder) { m.nav.splice(m.nav.indexOf(before.parent) + 1, 0, item); return true; }
    if (before.parent.children.length >= PG_KIDS_MAX) { toast("A dropdown holds " + PG_KIDS_MAX + " links.", true); return false; }
    before.parent.children.splice(before.parent.children.indexOf(before.it), 0, item); return true;
  }
  if (before) m.nav.splice(m.nav.indexOf(before.it), 0, item); else m.nav.push(item);
  return true;
}
function pgFlat(nav) { const out = []; nav.forEach((it) => { out.push(it.href); (it.children || []).forEach((k) => out.push(k.href)); }); return out; }
// The one write: the menu, with the pages' own "in the menu" flag and order following it, so
// the page tabs in Edit mode match and Reset to automatic keeps what was hidden.
async function pgWriteMenu(nav, okMsg, focusRef) {
  const clean = dcCleanNav(nav);
  if (!clean.length) { toast("Keep at least one page in the menu.", true); renderPagesList(); return false; }
  const dropped = nav.length - clean.length;
  const order = pgFlat(clean), at = (p) => { const i = order.indexOf("/" + p.slug + "/"); return i < 0 ? Infinity : i; };
  const build = () => {
    const cur = dcPagesArr();
    const pages = cur.map((p, i) => ({ p, i })).sort((x, y) => (at(x.p) - at(y.p)) || (x.i - y.i)).map(({ p }) => {
      const on = order.indexOf("/" + p.slug + "/") >= 0, nx = { ...p };
      if (on) delete nx.hideNav; else nx.hideNav = true;
      return nx;
    });
    const body = { nav: clean };
    if (JSON.stringify(pages) !== JSON.stringify(cur)) body.pages = pages;
    return body;
  };
  try {
    await settingsPut(build);
    renderPagesBar(); refreshDesignPreview(); scheduleChangesRefresh();
    toast(dropped > 0 ? "The menu holds " + PG_NAV_MAX + " items, so the last " + dropped + " moved to Not linked." : okMsg || "Menu updated. Publish to put it live.");
    if (focusRef) pgFocusGrab(focusRef);
    return true;
  } catch (err) { toast(nice(err), true); renderPagesList(); return false; }
}
function pgFocusGrab(ref) {
  const row = [...document.querySelectorAll(PAGES_OPEN ? "#pagesCard .pc-row" : "#view-pages .pg-row")].find((r) => r.dataset.href === ref.href && (r.dataset.parent || null) === (ref.parent || null));
  const g = row && row.querySelector(".pg-grab"); if (g) g.focus();
}
// One menu decision at a time: each reads the menu the last one left, so two quick presses
// of an arrow key can't both start from the same place. It waits on pending edits, which
// are settingsTurn writes, so it sits outside that queue and its writes go through settingsPut.
let PG_WRITES = Promise.resolve();
function pgTurn(fn) { const t = PG_WRITES.then(fn); PG_WRITES = t.catch(() => {}); return t; }
// zone "menu": before `beforeRef`, or last when it's null. zone "off": off the menu.
function pgMove(ref, zone, beforeRef, focus) { return pgTurn(() => pgMoveNow(ref, zone, beforeRef, focus)); }
async function pgMoveNow(ref, zone, beforeRef, focus) {
  if (!(await dcSavePendingEdits())) { renderPagesList(); return; }
  const m = pgModel(), e = pgEntry(m, ref); if (!e) { renderPagesList(); return; }
  if (zone === "off" && !e.it) { renderPagesList(); return; }   // it's already off the menu
  const was = JSON.stringify(m.nav), before = beforeRef ? pgEntry(m, beforeRef) : null;
  const item = pgLift(m, e);
  // item 48: dropped on an empty folder's "Drag a page here" row
  const into = beforeRef && beforeRef.href === PG_SLOT ? m.nav.find((x) => x.folder && x.href === beforeRef.parent) : null;
  if (zone !== "off" && into && !item.folder && !(item.children || []).length) {
    into.children = (into.children || []).concat([item]);
    return pgWriteMenu(m.nav, "In the “" + into.label + "” folder now. Publish to apply.", focus ? { href: ref.href, parent: into.href } : null);
  }
  if (zone === "off") {
    (item.children || []).forEach((k) => m.nav.push(k));
    return pgWriteMenu(m.nav, "Off the menu. It stays live on your site. Publish to apply.", focus ? ref : null);
  }
  if (!pgLand(m, item, before && before.it ? before : null)) { renderPagesList(); return; }
  if (JSON.stringify(m.nav) === was) { renderPagesList(); if (focus) pgFocusGrab(ref); return; }
  const parent = m.nav.find((x) => (x.children || []).indexOf(item) >= 0);
  return pgWriteMenu(m.nav, null, focus ? { href: ref.href, parent: parent ? parent.href : null } : null);
}
// Arrow keys on a row's handle do what dragging does, one place at a time.
function pgNudge(ref, dir) {
  return pgTurn(async () => {
    if (!(await dcSavePendingEdits())) return;
    const m = pgModel(), e = pgEntry(m, ref); if (!e) return;
    if (!e.it) { if (dir < 0) await pgMoveNow(ref, "menu", null, true); return; }
    const arr = e.parent ? e.parent.children : m.nav, i = arr.indexOf(e.it), j = i + dir;
    if (j < 0) return;
    if (j >= arr.length) { if (!e.parent && !(e.it.children || []).length && e.pg) await pgMoveNow(ref, "off", null, true); return; }
    [arr[i], arr[j]] = [arr[j], arr[i]];
    await pgWriteMenu(m.nav, null, ref);
  });
}
const PG_GRIP = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
const PG_GEAR = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>';
const PG_FOLDER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const PG_LINK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4 4 0 0 0 6 .4l3-3a4 4 0 0 0-5.7-5.7l-1.1 1.1"/><path d="M14 10a4 4 0 0 0-6-.4l-3 3a4 4 0 0 0 5.7 5.7l1.1-1.1"/></svg>';
function pgRow(entry, ctx) {
  const pg = entry.pg, it = entry.it, name = it ? it.label : pg.title, folder = !pg && !!(it && it.folder);
  const ref = { href: it ? it.href : pg.path, parent: entry.parent ? entry.parent.href : null };
  const row = el("div", "hb-row pg-row" + (entry.parent ? " child" : "")); row.dataset.page = pg ? pg.key : folder ? "folder" : "link"; row.dataset.href = ref.href;
  if (ref.parent) row.dataset.parent = ref.parent;
  const grab = el("button", "pg-grab"); grab.type = "button"; grab.innerHTML = PG_GRIP; grab.title = "Drag to move";
  grab.setAttribute("aria-label", "Move " + name + ". Use the up and down arrow keys.");
  grab.addEventListener("pointerdown", (e) => pgDragStart(e, row, ref, !pg || (it && (it.children || []).length > 0)));
  grab.addEventListener("keydown", (e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); pgNudge(ref, e.key === "ArrowUp" ? -1 : 1); } });
  row.appendChild(grab);
  const ic = el("span", "ic"); ic.innerHTML = pg ? (HB_ICON[pg.icon] || HB_ICON.page) : folder ? PG_FOLDER : PG_LINK; row.appendChild(ic);
  const t = el("div", "t"); t.appendChild(el("b", null, name)); t.appendChild(el("span", null, pg ? pg.sum : folder ? pgFolderSub(it) : it.href)); row.appendChild(t);
  if (pg) row.appendChild(hbPageChip(pg, ctx.changes, ctx.live, ctx.firstPublish));
  const acts = el("div", "acts");
  if (pg) {
    const edit = el("button", "pillbtn sm", "Edit"); edit.type = "button"; edit.setAttribute("aria-label", "Edit " + name);
    edit.addEventListener("click", () => hbOpenPage(pg));
    acts.appendChild(edit);
  }
  const gear = el("button", "pg-gear"); gear.type = "button"; gear.innerHTML = PG_GEAR; gear.title = "Settings"; gear.setAttribute("aria-label", "Settings for " + name);
  gear.addEventListener("click", () => { if (pg) pgOpenSettings(ref); else if (folder) pgOpenFolder(ref); else pgOpenLink(ref); });
  acts.appendChild(gear); row.appendChild(acts);
  return row;
}
// The Pages tab's two lists, and the same model drawn into the editor's Pages card.
function renderPagesList() {
  if (PG_DRAG) { PG_DRAG.stale = true; return; }   // a refresh waits for the drop, so it can't pull the row out of someone's hand
  pcEverySub();   // item 158: the On every page row says what's on
  const ctx = {
    live: !!(S.health && S.health.facts && S.health.facts.website.state !== "none"),
    changes: (S.changes && S.changes.changes) || [],
    firstPublish: !!(S.changes && S.changes.first_publish),
  };
  const m = pgModel();
  renderPagesCard(m, ctx);
  const list = $("pagesList"), off = $("pagesUnlinked"); if (!list || !off) return;
  list.innerHTML = ""; off.innerHTML = "";
  m.menu.forEach((e) => { list.appendChild(pgRow(e, ctx)); if (pgFolderEmpty(e)) list.appendChild(pgSlot(e.it, "hb-row pg-row")); });
  m.unlinked.forEach((pg) => off.appendChild(pgRow({ it: null, pg, parent: null }, ctx)));
  if (!m.unlinked.length) off.appendChild(el("div", "pg-empty", "Drag a page here to take it off the menu. It stays live on your site."));
  const auto = $("btnNavAuto"); if (auto) auto.hidden = !pgHasCustomNav();
}
// ── the editor's Pages card (the floating studio, part three) ──
// The rows above, drawn again inside Edit mode with the same model and the same writes. A page
// drawn on the canvas (Home and the owner's own pages) is a .page-pill: a press opens it here.
// The template's own pages and the menu's links open their settings, since their words live
// on other tabs.
function pcChangeOn(ch, pg) {
  if (pg.sections.indexOf(ch.section) >= 0) return true;
  // what changed in a page's sections is told per page (lib/diff.ts blockDelta): "… on your home page." or "… on “Title”."
  const s = String(ch.sentence || "");
  if (pg.key === "home") return / on your home page\.$/.test(s);
  if (!pg.slug) return false;
  const t = String(pg.title || ""), q = "“" + (t.length > 48 ? t.slice(0, 47) + "…" : t) + "”";
  return s.slice(-(q.length + 5)) === " on " + q + ".";
}
// Builder item 285: a status pill with many words pushed the page's name out of its row ("Home"
// showed only "Needs something before publishing"). The pill is a dot and two words, the whole
// sentence in its title, and the name comes first (presence.css gives it a floor).
function shortStatus(s) { s = String(s == null ? "" : s).trim(); return s.length <= 16 ? s : s.split(/\s+/).slice(0, 2).join(" "); }
function pcChip(pg, ctx) {
  const chip = el("span", "hb-chip"); chip.appendChild(el("i", "d"));
  const tp = hbTreePage(pg);
  if (tp && HB_TREE_FLAG[tp.status]) { chip.classList.add(HB_TREE_FLAG[tp.status]); chip.appendChild(el("span", "t", shortStatus(tp.status_label))); chip.title = tp.status_label; return chip; }
  if (!ctx.siteLive || ctx.firstPublish) { chip.appendChild(el("span", "t", "Not live yet")); chip.title = "Your site goes live the first time you publish"; return chip; }
  const n = ctx.changes.filter((ch) => pcChangeOn(ch, pg)).length;
  if (!n) return null;   // live and nothing waiting: nothing to say
  chip.classList.add("warn"); chip.appendChild(el("span", "t", n + (n === 1 ? " change" : " changes")));
  chip.title = n + (n === 1 ? " change is" : " changes are") + " waiting to go live";
  return chip;
}
function pcRow(entry, ctx) {
  const pg = entry.pg, it = entry.it, folder = !pg && !!(it && it.folder);
  const ref = { href: it ? it.href : pg.path, parent: entry.parent ? entry.parent.href : null };
  // item 314: every page opens on the canvas; a built-in one goes by "~" + its key (dcBuiltinPage)
  const mine = !!pg && pg.view === "design", canvas = !!pg, slug = mine ? (pg.slug || "") : canvas ? "~" + pg.key : null, on = canvas && slug === DC_PAGE;
  const name = canvas ? pg.title : it ? it.label : pg.title;   // a page on the canvas goes by its own name, as the old tabs did
  const row = el("div", "pc-row" + (canvas ? " page-pill" : "") + (on ? " on" : "") + (entry.parent ? " child" : ""));
  row.setAttribute("role", "listitem"); row.dataset.href = ref.href; row.dataset.page = pg ? pg.key : folder ? "folder" : "link";
  if (ref.parent) row.dataset.parent = ref.parent;
  const own = mine ? dcPageObj(slug) : null; if (own && own.hideNav) row.dataset.nav = "hidden";
  const grab = el("button", "pg-grab"); grab.type = "button"; grab.innerHTML = PG_GRIP; grab.title = "Drag to move";
  grab.setAttribute("aria-label", "Move " + name + ". Use the up and down arrow keys.");
  grab.addEventListener("pointerdown", (e) => pgDragStart(e, row, ref, !pg || (it && (it.children || []).length > 0)));
  grab.addEventListener("keydown", (e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); pgNudge(ref, e.key === "ArrowUp" ? -1 : 1); } });
  row.appendChild(grab);
  const ic = el("span", "ic"); ic.innerHTML = pg ? (HB_ICON[pg.icon] || HB_ICON.page) : folder ? PG_FOLDER : PG_LINK; row.appendChild(ic);
  const open = el("button", "pc-open"); open.type = "button";
  open.appendChild(el("span", "pp-name", name));
  // items 48 and 120: a landing page says what it leaves out
  const bare = own && (own.noHeader || own.noFooter) ? (own.noHeader && own.noFooter ? "No header or footer" : own.noHeader ? "No header" : "No footer") : "";
  const sub = on ? "Editing now" : folder ? pgFolderSub(it) : !pg ? it.href : canvas && it && it.label !== pg.title ? "In the menu as “" + it.label + "”" : bare || pg.sum;
  open.appendChild(el("span", "pc-sub", sub));
  if (on) open.setAttribute("aria-current", "page");
  open.title = canvas ? "Edit this page" : pg ? "This page’s settings" : folder ? "This folder’s settings" : "This link’s settings";
  row.appendChild(open);
  const acc = own && (own.access === "password" || own.access === "private") ? own.access : "";
  if (acc) {
    const a = el("span", "hb-chip pc-access" + (acc === "password" ? " p" : "")); a.dataset.access = acc; a.appendChild(el("i", "d"));
    a.appendChild(document.createTextNode(acc === "password" ? "Password" : "Private"));
    a.title = acc === "password" ? "Visitors need a password to open it" : "Kept off your live site";
    row.appendChild(a);
  }
  const chip = pg ? pcChip(pg, ctx) : null; if (chip) row.appendChild(chip);
  const gear = el("button", "pc-ico pg-gear"); gear.type = "button"; gear.innerHTML = PG_GEAR; gear.title = "Settings"; gear.setAttribute("aria-label", "Settings for " + name);
  row.appendChild(gear);
  if (mine) {
    const mn = icoBtn("more", "More for " + name, "pc-ico pp-menu");
    mn.title = slug ? "Rename, duplicate, clear or delete this page" : "Duplicate or clear this page";
    mn.addEventListener("click", () => dcPageMenu(slug, mn));
    row.appendChild(mn);
  }
  // the whole row is the target, as the old tab was: a press anywhere but its own buttons opens it
  row.addEventListener("click", (e) => {
    if (e.target.closest(".pg-grab,.pp-menu")) return;
    if (e.target.closest(".pg-gear") || !canvas) { if (pg) pgOpenSettings(ref); else if (folder) pgOpenFolder(ref); else pgOpenLink(ref); return; }
    closePagesCard(false); dcSwitchPage(slug);
  });
  return row;
}
function renderPagesCard(m, ctx) {
  const menu = $("pcMenu"), off = $("pcOff"); if (!menu || !off) return;
  const c = { ...ctx, siteLive: ctx.live || !!siteLiveUrl() };
  menu.textContent = ""; off.textContent = "";
  // One row per place in the menu, and one .page-pill per page: an automatic menu can name an
  // address twice (an own page on a built-in address), and both name the same entry.
  const seen = new Set(), tabs = new Set();
  const add = (host, e) => {
    const k = (e.it ? e.it.href : e.pg.path) + "|" + (e.parent ? e.parent.href : ""); if (seen.has(k)) return; seen.add(k);
    const r = pcRow(e, c);
    if (r.classList.contains("page-pill")) { if (tabs.has(e.pg.key)) r.classList.remove("page-pill", "on"); tabs.add(e.pg.key); }
    host.appendChild(r);
  };
  m.menu.forEach((e) => { add(menu, e); if (pgFolderEmpty(e)) menu.appendChild(pgSlot(e.it, "pc-row")); });
  const opens = new Map(); m.unlinked.forEach((pg) => opens.set(pg.path, pg));   // the page an address opens is the last named (pgModel's byHref)
  m.unlinked.forEach((pg) => { if (opens.get(pg.path) === pg) add(off, { it: null, pg, parent: null }); });
  if (!m.unlinked.length) off.appendChild(el("div", "pc-empty", "Drag a page here to take it off the menu. It stays live.")).setAttribute("role", "listitem");
  const auto = $("btnPcAuto"); if (auto) auto.hidden = !pgHasCustomNav();
  const n = hbPageRows().length, links = m.menu.filter((e) => !e.pg && !e.it.folder).length, folders = m.menu.filter((e) => e.it && e.it.folder).length;
  const sub = $("pagesSub"); if (sub) { sub.textContent = n + " pages" + (folders ? " · " + folders + (folders === 1 ? " folder" : " folders") : "") + (links ? " · " + links + (links === 1 ? " link" : " links") : ""); sub.hidden = false; }
  pcFilter();
}
// Find a page: rows whose name has the words stay; a heading with none under it goes
function pcFilter() {
  const f = $("pcFind"), q = f ? f.value.trim().toLowerCase() : "";
  let shown = 0;
  [["pcMenu", null], ["pcOff", "pcOffH"]].forEach(([id, h]) => {
    const host = $(id); if (!host) return;
    let here = 0;
    host.querySelectorAll(".pc-row").forEach((r) => { const hit = !q || r.querySelector(".pp-name").textContent.toLowerCase().indexOf(q) >= 0; r.hidden = !hit; if (hit) here++; });
    const empty = host.querySelector(".pc-empty"); if (empty) empty.hidden = !!q;
    if (h && $(h)) { $(h).hidden = !!q && !here; host.hidden = !!q && !here; }
    shown += here;
  });
  const none = $("pcNone"); if (none) { none.hidden = !q || shown > 0; none.textContent = q && !shown ? "No page has “" + f.value.trim() + "” in its name." : ""; }
}
// Dragging is pointer events on the handle, so a finger works the same as a mouse. The
// row follows the pointer; a line shows where it will land; nothing is written until the drop.
let PG_DRAG = null;
function pgDragStart(e, row, ref, menuOnly) {
  if (e.button) return;
  e.preventDefault();
  const group = [row];
  for (let n = row.nextElementSibling; n && !row.classList.contains("child") && n.classList.contains("child"); n = n.nextElementSibling) group.push(n);
  const h = e.currentTarget;
  try { h.setPointerCapture(e.pointerId); } catch (_) {}
  // the Pages tab's lists, or the same rows in the editor's Pages card (which scrolls on its own)
  const where = row.closest("#pagesCard")
    ? { menu: "pcMenu", off: "pcOff", edge: () => $("pcOffH"), rows: ".pc-row", scroller: $("pcBody") }
    : { menu: "pagesList", off: "pagesUnlinked", edge: () => $("pagesOffSec").querySelector(".hb-sec-h"), rows: ".pg-row", scroller: null };
  const d = PG_DRAG = { ref, row, group, h, menuOnly, where, y0: e.clientY, top0: where.scroller ? where.scroller.scrollTop : 0, moved: false, zone: "menu", next: null, line: el("div", "pg-dropline") };
  d.onMove = (ev) => pgDragMove(ev);
  d.onUp = () => pgDragEnd(null, false);
  d.onCancel = () => pgDragEnd(null, true);
  d.onKey = (ev) => { if (ev.key === "Escape") pgDragEnd(null, true); };
  h.addEventListener("pointermove", d.onMove);
  h.addEventListener("pointerup", d.onUp);
  h.addEventListener("pointercancel", d.onCancel);
  document.addEventListener("keydown", d.onKey, true);
}
function pgDragMove(e) {
  const d = PG_DRAG; if (!d) return;
  const W = d.where, sc = W.scroller;
  const dy = e.clientY - d.y0 + (sc ? sc.scrollTop - d.top0 : 0);
  if (!d.moved && Math.abs(dy) < 4) return;
  if (!d.moved) { d.moved = true; document.body.classList.add("pd-dragging"); d.group.forEach((r) => r.classList.add("pg-dragging")); }
  d.group.forEach((r) => { r.style.transform = "translateY(" + dy + "px)"; });
  const zone = !d.menuOnly && e.clientY >= W.edge().getBoundingClientRect().top ? "off" : "menu";
  const host = $(zone === "off" ? W.off : W.menu);
  const next = [...host.querySelectorAll(W.rows)].filter((r) => d.group.indexOf(r) < 0 && !r.hidden).find((r) => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; }) || null;
  d.zone = zone; d.next = next;
  host.insertBefore(d.line, next);
  $(W.off).classList.toggle("pc-over", zone === "off" && !!sc);
  if (sc) { const b = sc.getBoundingClientRect(); if (e.clientY < b.top + 40) sc.scrollTop -= 10; else if (e.clientY > b.bottom - 40) sc.scrollTop += 10; }
  else if (e.clientY < 60) window.scrollBy(0, -12); else if (e.clientY > innerHeight - 60) window.scrollBy(0, 12);
}
function pgDragEnd(_, cancel) {
  const d = PG_DRAG; if (!d) return;
  PG_DRAG = null;
  d.h.removeEventListener("pointermove", d.onMove);
  d.h.removeEventListener("pointerup", d.onUp);
  d.h.removeEventListener("pointercancel", d.onCancel);
  document.removeEventListener("keydown", d.onKey, true);
  document.body.classList.remove("pd-dragging");
  d.group.forEach((r) => { r.classList.remove("pg-dragging"); r.style.transform = ""; });
  d.line.remove(); $(d.where.off).classList.remove("pc-over");
  if (cancel || !d.moved) { if (d.stale) renderPagesList(); return; }
  const beforeRef = d.zone === "menu" && d.next ? { href: d.next.dataset.href, parent: d.next.dataset.parent || null } : null;
  pgMove(d.ref, d.zone, beforeRef);
}
// The one settings button: name and address, the menu, and how it shows on Google, each saved
// as it changes. Duplicate, Clear and Delete are the same page actions the Edit tabs use.
const PG_SEO_KEY = { menu: "offerings", about: "about", faq: "faq", updates: "updates", contact: "contact" };
function pgField(label, input, hint) {
  const f = el("div", "field"); const l = el("label", null, label);
  if (!input.id) input.id = "pgf-" + Math.random().toString(36).slice(2, 8);
  l.setAttribute("for", input.id); f.append(l, input);
  if (hint) f.appendChild(el("div", "hint", hint));
  return f;
}
function pgInput(value, max, placeholder) { const i = el("input"); i.type = "text"; i.value = value || ""; if (max) i.maxLength = max; if (placeholder) i.placeholder = placeholder; return i; }
function pgModal(id, title) {
  const scrim = el("div", "dc-modal-scrim"); scrim.id = id;
  const box = el("div", "dc-modal pg-settings"); box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true"); box.setAttribute("aria-label", title);
  const opener = document.activeElement;
  const close = () => {
    if (document.activeElement && box.contains(document.activeElement)) document.activeElement.blur();   // a field saves on change, and blur is what fires it
    scrim.remove(); document.removeEventListener("keydown", onKey, true);
    try { if (opener && opener.isConnected) opener.focus(); } catch (_) {}
  };
  const onKey = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  document.addEventListener("keydown", onKey, true);
  scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) close(); });
  scrim.appendChild(box); document.body.appendChild(scrim);
  return { box, close };
}
// "Show under": top of the menu, or under any other top-level item.
function pgUnderSelect(m, e) {
  const sel = el("select");
  const top = el("option", null, "The top of the menu"); top.value = ""; sel.appendChild(top);
  m.nav.filter((x) => x !== e.it).forEach((x) => { const o = el("option", null, x.label); o.value = x.href; sel.appendChild(o); });
  sel.value = e.parent ? e.parent.href : "";
  return sel;
}
function pgSetUnder(ref, parentHref) { return pgTurn(() => pgSetUnderNow(ref, parentHref)); }
async function pgSetUnderNow(ref, parentHref) {
  if (!(await dcSavePendingEdits())) return null;
  const m = pgModel(), e = pgEntry(m, ref); if (!e || !e.it) return null;
  const home = parentHref ? m.nav.find((x) => x.href === parentHref) : null;
  if (home && (home.children || []).length >= PG_KIDS_MAX) { toast("A dropdown holds " + PG_KIDS_MAX + " links.", true); return null; }
  const after = e.parent ? m.nav.indexOf(e.parent) + 1 : m.nav.length;
  const item = pgLift(m, e);
  if (home) { home.children = home.children || []; home.children.push(item); } else m.nav.splice(after, 0, item);
  await pgWriteMenu(m.nav);
  return { href: ref.href, parent: parentHref || null };
}
function pgSetLabel(ref, label) { return pgTurn(() => pgSetLabelNow(ref, label)); }
async function pgSetLabelNow(ref, label) {
  label = String(label || "").trim().slice(0, 40); if (!label) return;
  if (!(await dcSavePendingEdits())) return;
  const m = pgModel(), e = pgEntry(m, ref); if (!e || !e.it || e.it.label === label) return;
  e.it.label = label;
  await pgWriteMenu(m.nav, "Saved. Publish to apply.");
}
// The offerings page's address follows the kind of business and the template, and a custom
// menu's link to it has to as well, or it goes dead.
function pgFollowOffering(was) {
  return pgTurn(async () => {
    const now = vocabWords();
    if (was.path === now.path || !pgHasCustomNav()) return;
    const swap = (it) => (it.href === was.path ? { ...it, href: now.path, label: it.label === was.label ? now.label : it.label } : it);
    const followed = () => {
      const nav = S.settings.nav.map((it) => { const t = swap(it); return t.children ? { ...t, children: t.children.map(swap) } : t; });
      return JSON.stringify(nav) === JSON.stringify(S.settings.nav) ? null : { nav };
    };
    try { await settingsPut(followed); renderPagesBar(); refreshDesignPreview(); }
    catch (err) { toast(nice(err), true); }
  });
}
// In the menu or not. With no custom menu a custom page only flips its own flag, which
// keeps the menu automatic; a built-in page has no flag, so it needs a custom menu.
function pgSetInMenu(ref, on) { return pgTurn(() => pgSetInMenuNow(ref, on)); }
async function pgSetInMenuNow(ref, on) {
  if (!(await dcSavePendingEdits())) return;
  const m = pgModel(), e = pgEntry(m, ref); if (!e) return;
  const slug = e.pg && e.pg.slug;
  if (!pgHasCustomNav() && slug) {
    const flipped = () => ({ pages: dcPagesArr().map((x) => { if (x.slug !== slug) return x; const nx = { ...x }; if (on) delete nx.hideNav; else nx.hideNav = true; return nx; }) });
    try { await settingsPut(flipped); renderPagesBar(); refreshDesignPreview(); scheduleChangesRefresh(); toast("Saved. Publish to apply."); }
    catch (err) { toast(nice(err), true); }
    return;
  }
  if (on) { if (!e.it) { m.nav.push({ label: pgLabelFor(e.pg), href: e.pg.path }); await pgWriteMenu(m.nav, "Saved. Publish to apply."); } return; }
  if (!e.it) return;
  const item = pgLift(m, e);
  (item.children || []).forEach((k) => m.nav.push(k));
  await pgWriteMenu(m.nav, "Off the menu. It stays live on your site. Publish to apply.");
}
// Where a page's or a link's settings open: inside the Pages card while it's open, else over the page.
function pgHost(id, title) { return PAGES_OPEN ? pcPane(id, title) : pgModal(id, title); }
function pgOpenSettings(startRef) {
  const start = pgEntry(pgModel(), startRef); if (!start || !start.pg) return;
  const inCard = PAGES_OPEN;
  const { box, close } = pgHost("pageSettings", (start.pg.title || "Page") + " settings");
  let ref = { href: startRef.href, parent: startRef.parent || null };
  const paint = () => {
    const m = pgModel(), e = pgEntry(m, ref); if (!e || !e.pg) { close(); return; }
    const pg = e.pg, slug = pg.slug || "", custom = !!slug;
    const putBack = pgTyping(box);   // item 245: drawn again when a save lands, it keeps what's being typed
    // ...and "Who can see it" stays the same part, drawn again: a new one began with the Password
    // field closed, so a Password just chosen vanished, with what was being typed in it
    const access = box.querySelector('.pg-group[data-group="access"]');
    box.textContent = "";
    box.appendChild(el("h3", "dc-modal-h", pg.title + " settings"));
    box.appendChild(el("p", "pg-where", seoHost() + pg.path));
    if (custom) {
      box.appendChild(el("h4", "pg-h", "Page"));
      const name = pgInput(pg.title, 60), addr = pgInput(slug, 40);
      name.addEventListener("change", async () => { if (name.value.trim() && name.value.trim() !== pg.title) { await dcSavePageName(slug, name.value.trim().slice(0, 60), slug); paint(); } });
      addr.addEventListener("change", async () => {
        const to = await dcSavePageName(slug, pg.title, addr.value);
        if (to) ref = { href: "/" + to + "/", parent: ref.parent };
        paint();
      });
      box.appendChild(pgField("Page name", name));
      box.appendChild(pgField("Page address", addr, "Its link: yoursite.com/" + slug + "/. If you change it, visitors to the old link are sent to the new one."));
      // items 48 and 120: who can see it, and the header and footer
      box.appendChild(access && access.__pgFor === slug ? access.__pgDraw() : pgAccessGroup(slug));
      box.appendChild(pgChromeGroup(slug));
    } else {
      box.appendChild(el("p", "dc-modal-sub", pg.key === "home"
        ? "Your home page is always open to everyone, with your header and footer."
        : "Its address is " + pg.path + ". It’s built from your business details, so it’s always open to everyone, with your header and footer."));
    }
    box.appendChild(el("h4", "pg-h", "Menu"));
    const onRow = pgSwitch("Show in the menu", !!e.it);
    const on = onRow.querySelector("input");
    on.addEventListener("change", async () => {
      await pgSetInMenu(ref, on.checked);
      ref = { href: ref.href, parent: null };
      paint();
    });
    box.appendChild(onRow);
    if (e.it) {
      const lab = pgInput(e.it.label, 40);
      lab.addEventListener("change", async () => { await pgSetLabel(ref, lab.value); paint(); });
      box.appendChild(pgField("Label in the menu", lab));
      if (!(e.it.children || []).length) {
        const under = pgUnderSelect(m, e);
        under.addEventListener("change", async () => { const to = await pgSetUnder(ref, under.value); if (to) ref = to; paint(); });
        box.appendChild(pgField("Show under", under, "Pick a menu item or folder to put this page in its dropdown."));
      }
    }
    if (inCard && pg.view !== "design") {   // the template's own page: its words are kept on another tab
      box.appendChild(el("h4", "pg-h", "What’s on it"));
      const from = { business: "your business details", offerings: "the items on your " + (VOCAB.label || "Menu") + " tab", faqs: "your questions and answers", updates: "your updates" }[pg.view] || "your details";
      box.appendChild(el("p", "pc-note", "This page is built from " + from + ", so its words are changed there."));
      // item 314: the tab's form opens in a card beside the page; the editor is never left
      const go2 = el("button", "dc-modal-cancel", "Change what’s on it"); go2.type = "button"; go2.addEventListener("click", () => { close(); closePagesCard(false); eeEditCore(pg.view); });
      const acts = el("div", "pc-acts"); acts.appendChild(go2); box.appendChild(acts);
    }
    box.appendChild(el("h4", "pg-h", "On Google"));
    if (pg.key === "home") {
      box.appendChild(el("p", "dc-modal-sub", "Your home page uses the search headline and description on the Search tab. It always shows on Google."));
      if (inCard) { const go2 = el("button", "dc-modal-cancel", "Open the Search tab"); go2.type = "button"; go2.addEventListener("click", () => pcLeaveTo("search")); const acts = el("div", "pc-acts"); acts.appendChild(go2); box.appendChild(acts); }
    } else {
      const key = custom ? "page:" + slug : PG_SEO_KEY[pg.key];
      box.appendChild(seoNoindexRow(key, pg.title, "Show this page on Google"));
      box.appendChild(el("div", "hint", "Hiding it keeps the page on your website. It just stops appearing in search results."));
      box.appendChild(seoFieldsBox(key, pg.title, false));
    }
    const foot = el("div", "pg-foot");
    const action = (label, fn, danger) => { const b = el("button", "dc-modal-cancel" + (danger ? " danger" : ""), label); b.type = "button"; b.addEventListener("click", () => { close(); fn(); }); foot.appendChild(b); };
    if (pg.view === "design") {
      action("Duplicate page", async () => { await dcDuplicatePage(slug); if ($("view-pages").classList.contains("on")) go("design"); });
      action("Clear page", () => { if (!inCard) go("design"); dcClearPage(slug); });
    }
    if (custom) action("Delete page", () => dcDeletePage(slug), true);
    const done = el("button", "dc-modal-cancel pg-done", "Done"); done.type = "button"; done.addEventListener("click", close);
    foot.appendChild(done);
    box.appendChild(foot);
    putBack();
  };
  paint();
  pgFocusFirst(box);
}
// Item 245: a settings panel drawn again while someone is in it (a read or a save landing) used
// to drop what they were typing and their place. pgTyping(host), called just before the panel is
// drawn again, notes each field whose words were changed since it was drawn and the field with
// the focus, by the name on the field. The function it returns, called once the panel is drawn,
// puts the words and the focus (caret and all) back; a field given its words back that way saves
// them when it's left, as typing would have, and one that isn't drawn again saves them at once.
function pgTyping(host) {
  const nameOf = (f) => { const l = (f.id && host.querySelector('label[for="' + f.id + '"]')) || f.closest("label"); return String((l && l.textContent) || f.getAttribute("aria-label") || "").trim(); };
  const fields = () => Array.from(host.querySelectorAll("input,textarea,select")).filter((f) => !/^(hidden|button|submit|file|radio)$/.test(f.type) && nameOf(f));
  const words = (f) => f.tagName === "TEXTAREA" || (f.tagName === "INPUT" && f.type !== "checkbox");
  const act = document.activeElement;
  const kept = fields().map((f) => {
    let sel = null; if (f === act && words(f)) { try { sel = [f.selectionStart, f.selectionEnd]; } catch (_) {} }
    return { el: f, name: nameOf(f), value: f.value, typed: words(f) && f.__pgDrawn !== undefined && f.value !== f.__pgDrawn, focus: f === act, sel };
  }).filter((k) => k.typed || k.focus);
  return () => {
    const now = fields(); now.forEach((f) => { f.__pgDrawn = f.value; });
    kept.forEach((k) => {
      const f = now.find((x) => nameOf(x) === k.name);
      if (!f) { if (k.typed) k.el.dispatchEvent(new Event("change")); return; }
      if (k.typed && f.value !== k.value) {
        f.value = k.value;
        f.dispatchEvent(new Event("input", { bubbles: true }));   // what reads it as it's typed (a count, the Google preview) follows
        f.addEventListener("blur", () => { if (f.value !== f.__pgDrawn) f.dispatchEvent(new Event("change")); }, { once: true });
      }
      if (k.focus) { try { f.focus({ preventScroll: true }); if (k.sel && k.sel[0] != null) f.setSelectionRange(k.sel[0], k.sel[1]); } catch (_) {} }
    });
  };
}
// ── Items 48 and 120: who can see an own page, and its header and footer ──
// Who can see it is three cards and one sentence. Password asks for the password first and
// only then turns on; the server keeps the key made from it, never the password
// (POST /page-locks), and the publish seals the page with that key (lib/page_access.ts). A
// password already saved for the page is used again when Password is picked back. The
// header and footer are two switches, for a landing page; the canvas shows the change at
// once. All of it is a page setting like the others: it saves now and goes live on publish.
const PG_ACCESS = [
  ["everyone", "Everyone", "globe", "Everyone can see this page once you publish."],
  ["password", "Password", "lock", "Visitors type a password to open this page. It stays off Google and out of your site’s search."],
  ["private", "Private", "eyeoff", "It stays in your draft: you and your team see it here, but it isn’t on your live site, in its menu or on Google until you pick Everyone."],
];
let PG_LOCKS = null;   // this site's saved page passwords (lock ids), read once when first needed
function pgLocksRead() {
  if (PG_LOCKS) return Promise.resolve(PG_LOCKS);
  return api("GET", "/page-locks").then((r) => (PG_LOCKS = new Set(((r && r.data && r.data.ids) || []).map(String)))).catch(() => new Set());
}
// A label with a switch: a checkbox drawn as a switch, so it keeps its name and keys.
function pgSwitch(label, on) {
  const row = el("label", "pg-sw"); const t = el("span", null, label); const cb = el("input"); cb.type = "checkbox"; cb.checked = !!on;
  row.append(t, cb); return row;
}
function pgSetPage(slug, patch, okMsg) {
  return pgTurn(async () => {
    if (!(await dcSavePendingEdits())) return false;
    const build = () => {
      let hit = false;
      const pages = dcPagesArr().map((x) => {
        if (x.slug !== slug) return x;
        hit = true; const nx = { ...x, ...patch };
        Object.keys(patch).forEach((k) => { if (patch[k] === undefined) delete nx[k]; });
        return nx;
      });
      return hit ? { pages } : null;
    };
    try { await settingsPut(build); renderPagesBar(); scheduleChangesRefresh(); if (okMsg) toast(okMsg); return true; }
    catch (err) { toast(nice(err), true); return false; }
  });
}
function pgAccessGroup(slug) {
  const g = el("div", "pg-group"); g.dataset.group = "access";
  let asking = false, msg = "";   // the password field is open; why the last try didn't save
  // Item 196 (review finding 30): a page copied from another site keeps its setting, never its
  // password, so it said "Password saved" and was quietly left off the live site. It asks for one.
  const unsetOf = (page) => page.access === "password" && (!page.lock || !!(PG_LOCKS && !PG_LOCKS.has(String(page.lock))));
  let drawnUnset = null;   // item 245: what the last draw showed, so a read that changes nothing redraws nothing
  const draw = (focusOn) => {
    const page = dcPageObj(slug); if (!page) return;
    const now = page.access === "password" || page.access === "private" ? page.access : "everyone";
    const shown = asking ? "password" : now;
    const unset = unsetOf(page); drawnUnset = unset;
    g.textContent = "";
    g.appendChild(el("h4", "pg-h", "Who can see it"));
    const row = el("div", "pg-access"); row.setAttribute("role", "group"); row.setAttribute("aria-label", "Who can see it");
    PG_ACCESS.forEach(([key, label, icon]) => {
      const b = el("button", "pg-acc"); b.type = "button"; b.dataset.access = key;
      b.setAttribute("aria-pressed", String(shown === key));
      b.innerHTML = uiIcon(icon, 20); b.appendChild(el("span", null, label));
      b.addEventListener("click", () => pick(key));
      row.appendChild(b);
    });
    g.appendChild(row);
    g.appendChild(el("p", "pg-says", PG_ACCESS.find((a) => a[0] === shown)[3]));
    if (shown === "password" && !asking && !unset) {
      const saved = el("div", "pg-saved");
      const chip = el("span", "hb-chip good"); chip.appendChild(el("i", "d")); chip.appendChild(document.createTextNode("Password saved"));
      const change = el("button", "dc-modal-cancel", "Change password"); change.type = "button";
      change.addEventListener("click", () => { asking = true; msg = ""; draw("pw"); });
      saved.append(chip, change); g.appendChild(saved);
      // item 121: what the password box says: the owner's own heading and message, or its own words
      g.appendChild(el("h4", "pg-h pg-h-sub", "What the password page says"));
      const words = [["lockTitle", "Heading", 80, "This page needs a password", ""], ["lockNote", "Message", 300, "Type the password you were given to see " + (page.title || "this page") + ".", "Your logo and header show above it, as on every page."]];
      words.forEach(([field, label, max, ph, hint]) => {
        const inp = field === "lockNote" ? el("textarea") : el("input"); if (field !== "lockNote") inp.type = "text";
        inp.maxLength = max; inp.placeholder = ph; inp.value = page[field] || ""; inp.id = "pgLock-" + field; if (field === "lockNote") inp.rows = 2;
        inp.addEventListener("change", () => {
          const v = inp.value.replace(/\s+/g, " ").trim(), was = (dcPageObj(slug) || {})[field] || "";   // the page as it is now, not as the card opened
          if (v === was) return;
          pgSetPage(slug, { [field]: v || undefined }, "Password page: " + label.toLowerCase() + (v ? " saved" : " back to its own words") + ". Publish to apply.");
        });
        g.appendChild(pgField(label, inp, hint));
      });
    }
    if (asking || unset) {
      const box = el("div", "pg-pw");
      const pw = el("input"); pw.type = "password"; pw.maxLength = 100; pw.autocomplete = "new-password"; pw.placeholder = "At least 8 letters or numbers";
      // item 204: the page travels to every visitor's browser, locked, so a short password can be guessed there
      box.appendChild(pgField("Password", pw, "At least 8 letters or numbers. It keeps casual visitors out, not secrets: don’t put anything on the page you couldn’t afford to have shared. Tell it to the people who should see the page. Changing it later asks everyone again."));
      const err = el("div", "hint pg-err"); err.setAttribute("role", "alert"); err.hidden = !msg; err.textContent = msg; box.appendChild(err);
      const acts = el("div", "pc-acts");
      const save = el("button", "dc-modal-cancel pg-done", "Save password"); save.type = "button";
      const show = el("button", "dc-modal-cancel", "Show"); show.type = "button"; show.setAttribute("aria-pressed", "false");
      show.addEventListener("click", () => { const on = pw.type === "password"; pw.type = on ? "text" : "password"; show.textContent = on ? "Hide" : "Show"; show.setAttribute("aria-pressed", String(on)); });
      const cancel = el("button", "dc-modal-cancel", "Cancel"); cancel.type = "button";
      cancel.addEventListener("click", () => { asking = false; msg = ""; draw("cards"); });
      const go = () => savePassword(pw.value, save);
      save.addEventListener("click", go);
      pw.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); go(); } });
      acts.append(save, show); if (asking) acts.append(cancel); box.appendChild(acts);   // with no password yet there's nothing to go back to
      if (unset && !asking) box.insertBefore(el("p", "pg-unset", "This page asks for a password, but none is set on this site yet, so it can’t go live. Set one, or choose who can see it."), box.firstChild);
      g.appendChild(box);
      if (focusOn === "pw") setTimeout(() => { try { pw.focus({ preventScroll: true }); box.scrollIntoView({ block: "nearest" }); } catch (_) {} }, 0);
    }
    if (focusOn === "cards") { const b = row.querySelector('[aria-pressed="true"]'); if (b) { try { b.focus({ preventScroll: true }); } catch (_) {} } }
    g.querySelectorAll("input,textarea").forEach((f) => { f.__pgDrawn = f.value; });   // item 245: as drawn, so a redraw can tell what's typed since
  };
  const pick = async (key) => {
    const page = dcPageObj(slug); if (!page) return;
    const now = page.access === "password" || page.access === "private" ? page.access : "everyone";
    if (key === "password") {
      if (now === "password" || asking) return;
      // a password this page already had comes back without being typed again
      if (page.lock && (await pgLocksRead()).has(page.lock)) { await pgSetPage(slug, { access: "password" }, "Password on. Publish to apply."); draw("cards"); return; }
      asking = true; msg = ""; draw("pw"); return;
    }
    asking = false; msg = "";
    if (key === now) { draw("cards"); return; }
    await pgSetPage(slug, { access: key === "private" ? "private" : undefined },
      key === "private" ? "Kept private. Publish to take it off your live site." : "Open to everyone. Publish to apply.");
    draw("cards");
  };
  const savePassword = async (value, btn) => {
    const pw = String(value || "").trim();
    if (pw.length < 8) { msg = "Use at least 8 letters or numbers."; draw("pw"); return; }   // item 204: as lib/page_gate.ts PASSWORD_MIN
    btn.disabled = true;
    try {
      const r = await api("POST", "/page-locks", { password: pw });
      const id = r && r.data && r.data.id; if (!id) throw new Error("That didn’t save. Nothing was changed. Please try again.");
      (PG_LOCKS || (PG_LOCKS = new Set())).add(String(id));
      if (await pgSetPage(slug, { access: "password", lock: String(id) }, "Password saved. Publish to apply.")) { asking = false; msg = ""; draw("cards"); }
      else btn.disabled = false;
    } catch (err) { msg = nice(err); draw("pw"); }
  };
  draw();
  const first = dcPageObj(slug);
  if (!PG_LOCKS && first && first.access === "password") pgLocksRead().then(() => {   // item 196: is its password this site's?
    // Item 245: the answer used to draw the group again under someone typing in it: the words in
    // Heading went unsaved and the Password field lost its focus. It redraws only when it changes
    // what's shown (the password isn't this site's), keeping what's being typed and where.
    const page = dcPageObj(slug);
    if (!g.isConnected || asking || !page || unsetOf(page) === drawnUnset) return;
    const was = g.contains(document.activeElement), putBack = pgTyping(g);
    draw(); putBack();
    if (was && !g.contains(document.activeElement)) { const pw = g.querySelector('input[type="password"]'); if (pw) { try { pw.focus({ preventScroll: true }); } catch (_) {} } }   // their field went: the one it now asks for
  });
  // item 245: the panel drawn again (a new page name landing) draws this same part again, so it
  // keeps the Password field it has open and why the last try didn't save, and a password saving
  // meanwhile finishes on the part that's on screen
  g.__pgFor = slug; g.__pgDraw = () => { draw(); return g; };
  return g;
}
function pgChromeGroup(slug) {
  const g = el("div", "pg-group"); g.dataset.group = "chrome";
  g.appendChild(el("h4", "pg-h", "Header and footer"));
  const page = dcPageObj(slug) || {};
  [["noHeader", "Show the header"], ["noFooter", "Show the footer"]].forEach(([field, label]) => {
    const row = pgSwitch(label, !page[field]); const cb = row.querySelector("input");
    cb.addEventListener("change", async () => {
      const show = cb.checked;
      const ok = await pgSetPage(slug, { [field]: show ? undefined : true }, (show ? "Shown again" : "Left out") + " on this page. Publish to apply.");
      if (!ok) { cb.checked = !show; return; }
      if (DC_PAGE === slug) refreshDesignPreview();   // the page being edited shows it at once
    });
    g.appendChild(row);
  });
  g.appendChild(el("p", "pg-says", "Turn both off for a landing page, so nothing on it leads away."));
  return g;
}
// The first field takes the cursor, as it always has (a pane with none: All pages).
function pgFocusFirst(box) {
  setTimeout(() => {
    // item 245: someone already pressing or typing in the panel keeps their place (a quick press on
    // Password lost its field to the page name, put here a moment later)
    if (box.contains(document.activeElement)) return;
    const f = box.querySelector("input,select") || (PAGES_OPEN && $("pcBack"));
    if (f) { try { f.focus({ preventScroll: true }); } catch (_) {} }
  }, 30);
}
// What the server accepts in a menu link (lib/serializer.ts navHref), or null. Someone typing
// a bare domain or an email address means the obvious thing, so it's completed for them.
function pgHref(raw) {
  let v = String(raw || "").trim(); if (!v) return null;
  if (/^[^\s/:@]+@[^\s/:@]+\.[^\s/:@]+$/.test(v)) v = "mailto:" + v;
  else if (/^[^\s/:]+\.[^\s:]+$/.test(v)) v = "https://" + v;
  v = v.replace(/^http:\/\//i, "https://");
  return (v === "/" || /^\/[a-z0-9][a-z0-9-]*\/$/.test(v) || /^\/(?:[a-z0-9][a-z0-9-]*\/)?#[a-z0-9][a-z0-9-]*$/.test(v) || /^https:\/\/[^\s<>"']+$/i.test(v) || /^mailto:[^\s<>"']+$/i.test(v) || /^tel:[+0-9()\-.\s]+$/i.test(v)) ? v.slice(0, 300) : null;
}
// A link in the menu that isn't one of the site's pages. Adding one asks first; after that it saves as it changes.
function pgOpenLink(startRef) {
  const { box, close } = pgHost("linkSettings", startRef ? "Link settings" : "Add a link");
  let ref = startRef ? { href: startRef.href, parent: startRef.parent || null } : null;
  const paint = () => {
    const m = pgModel(), e = ref ? pgEntry(m, ref) : null;
    if (ref && !e) { close(); return; }
    box.textContent = "";
    box.appendChild(el("h3", "dc-modal-h", ref ? "Link settings" : "Add a link"));
    const lab = pgInput(e ? e.it.label : "", 40, "e.g. Order online"), url = pgInput(e ? e.it.href : "", 300, "yoursite.com, an email or tel:…");
    box.appendChild(pgField("Label in the menu", lab));
    box.appendChild(pgField("Links to", url));
    linkPick(url);   // item 225: a page, a named part of one, or somewhere else
    const msg = el("div", "hint pg-err"); msg.hidden = true; msg.setAttribute("role", "alert"); box.appendChild(msg);
    const bad = (t) => { msg.textContent = t; msg.hidden = false; };
    const foot = el("div", "pg-foot");
    if (!ref) {
      const add = el("button", "dc-modal-cancel pg-done", "Add to the menu"); add.type = "button";
      add.addEventListener("click", () => {
        const label = lab.value.trim().slice(0, 40), href = pgHref(url.value);
        if (!label) return bad("Give it a label for the menu.");
        if (!href) return bad("That link won’t work. Pick a page or a part of a page under Goes to, or use a web address, an email address, or tel: and a phone number.");
        pgTurn(async () => {
          if (!(await dcSavePendingEdits())) return;
          const fresh = pgModel();
          if (fresh.nav.length >= PG_NAV_MAX) return bad("The menu holds " + PG_NAV_MAX + " items. Take one off first.");
          fresh.nav.push({ label, href });
          if (await pgWriteMenu(fresh.nav)) close();
        });
      });
      const cancel = el("button", "dc-modal-cancel", "Cancel"); cancel.type = "button"; cancel.addEventListener("click", close);
      foot.append(cancel, add);
    } else {
      lab.addEventListener("change", () => { pgSetLabel(ref, lab.value); });
      url.addEventListener("change", async () => {
        const href = pgHref(url.value);
        if (!href) return bad("That link won’t work. Pick a page or a part of a page under Goes to, or use a web address, an email address, or tel: and a phone number.");
        msg.hidden = true;
        await pgTurn(async () => {
          if (!(await dcSavePendingEdits())) return;
          const fresh = pgModel(), cur = pgEntry(fresh, ref); if (!cur) return;
          cur.it.href = href;
          if (await pgWriteMenu(fresh.nav, "Saved. Publish to apply.")) { ref = { href, parent: ref.parent }; paint(); }
        });
      });
      if (!(e.it.children || []).length) {
        const under = pgUnderSelect(m, e);
        under.addEventListener("change", async () => { const to = await pgSetUnder(ref, under.value); if (to) ref = to; paint(); });
        box.appendChild(pgField("Show under", under));
      }
      const rm = el("button", "dc-modal-cancel danger", "Remove from the menu"); rm.type = "button";
      rm.addEventListener("click", async () => { close(); await pgSetInMenu(ref, false); });
      const done = el("button", "dc-modal-cancel pg-done", "Done"); done.type = "button"; done.addEventListener("click", close);
      foot.append(rm, done);
    }
    box.appendChild(foot);
  };
  paint();
  pgFocusFirst(box);
}
// ── Item 48, second half: folders in the menu ──
// A folder is a menu heading with no page of its own; its dropdown lists the pages put in it.
// It lives in the custom menu as { label, href: "#f-…", folder: true, children }: the href only
// names it here, and the server draws a folder from its pages and leaves an empty one out. It
// stays on the top level, never inside another dropdown. Removing one keeps its pages: they
// take its place at the top of the menu.
const PG_SLOT = "#end";   // the "Drag a page here" row under an empty folder
function pgFolderEmpty(e) { return !!(e.it && e.it.folder && !e.parent && !(e.it.children || []).length); }
function pgFolderSub(it) { const n = (it.children || []).length; return n ? "Folder · " + n + (n === 1 ? " page" : " pages") : "Empty folder"; }
function pgSlot(it, cls) {
  const r = el("div", cls + " child pg-slot"); r.setAttribute("role", "listitem");
  r.dataset.href = PG_SLOT; r.dataset.parent = it.href;
  r.appendChild(el("span", "pp-name", "Drag a page here, or pick “" + it.label + "” under Show under in a page’s settings"));
  return r;
}
function pgOpenFolder(startRef) {
  const { box, close } = pgHost("folderSettings", startRef ? "Folder settings" : "Add a folder");
  const ref = startRef ? { href: startRef.href, parent: null } : null;
  const paint = () => {
    const m = pgModel(), e = ref ? pgEntry(m, ref) : null;
    if (ref && (!e || !e.it || !e.it.folder)) { close(); return; }
    box.textContent = "";
    box.appendChild(el("h3", "dc-modal-h", e ? e.it.label + " folder" : "Add a folder"));
    if (!e) box.appendChild(el("p", "dc-modal-sub", "A menu heading that opens a list of pages. It has no page of its own."));
    const lab = pgInput(e ? e.it.label : "", 40, "e.g. Services");
    box.appendChild(pgField("Name in the menu", lab, e ? null : "Then drag pages into it, or pick it under Show under in a page’s settings."));
    const msg = el("div", "hint pg-err"); msg.hidden = true; msg.setAttribute("role", "alert"); box.appendChild(msg);
    const bad = (t) => { msg.textContent = t; msg.hidden = false; };
    const foot = el("div", "pg-foot");
    if (!e) {
      const add = el("button", "dc-modal-cancel pg-done", "Add to the menu"); add.type = "button";
      const go = () => {
        const label = lab.value.trim().slice(0, 40);
        if (!label) return bad("Give it a name for the menu.");
        pgTurn(async () => {
          if (!(await dcSavePendingEdits())) return;
          const fresh = pgModel();
          if (fresh.nav.length >= PG_NAV_MAX) return bad("The menu holds " + PG_NAV_MAX + " items. Take one off first.");
          fresh.nav.push({ label, href: "#f-" + Math.random().toString(36).slice(2, 8), folder: true });
          if (await pgWriteMenu(fresh.nav, "Folder added. Drag pages into it.")) close();
        });
      };
      add.addEventListener("click", go);
      lab.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
      const cancel = el("button", "dc-modal-cancel", "Cancel"); cancel.type = "button"; cancel.addEventListener("click", close);
      foot.append(cancel, add);
    } else {
      const kids = e.it.children || [];
      const names = kids.map((k) => k.label);
      box.appendChild(el("p", "pc-note", names.length ? seoList(names) + (names.length === 1 ? " is" : " are") + " in it." : "Nothing is in it yet. Drag pages into it, or pick it under Show under in a page’s settings."));
      lab.addEventListener("change", () => {
        const label = lab.value.trim().slice(0, 40); if (!label) { lab.value = e.it.label; return; }
        pgTurn(async () => {
          if (!(await dcSavePendingEdits())) return;
          const fresh = pgModel(), cur = pgEntry(fresh, ref); if (!cur || cur.it.label === label) return;
          cur.it.label = label;
          if (await pgWriteMenu(fresh.nav, "Saved. Publish to apply.")) paint();
        });
      });
      const rm = el("button", "dc-modal-cancel danger", "Remove folder"); rm.type = "button";
      rm.addEventListener("click", () => {
        pgTurn(async () => {
          if (!(await dcSavePendingEdits())) return;
          const fresh = pgModel(), cur = pgEntry(fresh, ref); if (!cur) return;
          fresh.nav.splice(fresh.nav.indexOf(cur.it), 1, ...(cur.it.children || []));
          if (await pgWriteMenu(fresh.nav, kids.length ? "Folder removed. Its pages are at the top of the menu now." : "Folder removed.")) close();
        });
      });
      const done = el("button", "dc-modal-cancel pg-done", "Done"); done.type = "button"; done.addEventListener("click", close);
      foot.append(rm, done);
      box.appendChild(el("p", "hint", "Removing it keeps its pages: they move to the top of the menu."));
    }
    box.appendChild(foot);
  };
  paint();
  pgFocusFirst(box);
}
// ── Oct 2026 workflow audit, change 2: the overview is the site's one home ──
// Health (website-health.html), the page map (content-tree.html) and the site's
// story (timeline.html) were separate pages showing this site's data a second
// way; they are cards on this board now, and those URLs forward here. Each read
// is best-effort and after the board paints: a failure hides its card, never
// the board.
let HB_TREE = null, HB_HEALTH = null, HB_TIMELINE = null, HB_DOMAIN, HB_ACTIVITY_ALL = false;
const HB_TREE_FLAG = { publish_failed: "bad", missing_required: "warn", needs_review: "warn" };
function hbTreePage(pg) {
  if (!HB_TREE || !Array.isArray(HB_TREE.pages)) return null;
  return HB_TREE.pages.find((t) => t.path === pg.path) || null;
}
// Item 84: each tab reads only its own, the first time it opens: the page markers for Pages,
// the health check and the address for Search, what happened for Versions. The Overview,
// which shows none of them, used to read all four at start-up.
function hbLoadBoardExtras(view) {
  if (view === "pages" && !HB_ASKED.tree) {
    HB_ASKED.tree = true;
    api("GET", "/content-tree").then((r) => { HB_TREE = r.data || null; renderPagesList(); dcSyncPageSwitch(); }).catch(() => {});
  }
  if (view === "search" && !HB_ASKED.health) {
    HB_ASKED.health = true;
    api("GET", "/website-health").then((r) => { HB_HEALTH = r.data || null; renderHealthCard(); }).catch(() => {});
    ueStored().then(() => renderHealthCard());   // item 150: what the last "Usable by everyone" check found
    api("GET", "/foundations/domain").then((r) => { HB_DOMAIN = (r && r.data) || null; renderDomainCard(); }).catch(() => { HB_DOMAIN = undefined; });
  }
  if (view === "history" && !HB_ASKED.timeline) {
    HB_ASKED.timeline = true;
    api("GET", "/website-timeline").then((r) => { HB_TIMELINE = r.data || null; renderActivity(); }).catch(() => {});
  }
}
// Item 84: the Files list's pasted menus and the Business tab's "already live elsewhere" card
// are read when their tab first opens.
const TAB_ASKED = {};
// Edit mode's cards (Styles, the template gallery, the sections list, the forms) read four
// things between them. They're mounted the first time Edit mode opens; after that a reload
// redraws them as before.
let EDIT_CARDS = false;
function renderDomainCard() {
  const card = $("domainCard"); if (!card) return;
  if (HB_DOMAIN === undefined) { card.hidden = true; return; }
  const d = HB_DOMAIN && HB_DOMAIN.custom_domain ? HB_DOMAIN : null;
  card.innerHTML = ""; card.hidden = false;
  const head = el("div", "hb-card-h"); head.appendChild(el("h2", null, "Your domain")); card.appendChild(head);
  const temp = siteLiveUrl ? siteLiveUrl() : null;
  const btn = el("button", "pillbtn sm hb-act"); btn.type = "button";
  if (!d) {
    card.appendChild(el("div", "note", "Your site is on its built-in address" + (temp ? " (" + temp.replace(/^https:\/\//, "") + ")" : "") + ". Put it on your own name, like yourbusiness.com."));   // item 164 (finding 18)
    card.appendChild(askOwner("note", "Ask the account owner to connect it."));
    btn.dataset.needs = "configure"; btn.textContent = "Connect your domain"; btn.addEventListener("click", () => openFoundationsDesk({ domain: true }));
  } else if (d.health === "ok") {
    // item 134: the same rule as the desk — "live and secure" only when every check passes
    // Nov 12 review, finding 16: no checklist means the checks didn't run, so no green tick
    const checked = Array.isArray(d.checklist);
    const left = checked ? d.checklist.filter((c) => c && !c.ok) : [];
    card.appendChild(el("div", "note", !checked ? "We couldn’t check " + d.custom_domain + " just now." : left.length ? d.custom_domain + " is connected. Still to finish: " + left.map((c) => String(c.words || "")).join("; ") + "." : "✓ " + d.custom_domain + " is live and secure."));
    btn.textContent = !checked ? "Check again" : left.length ? "See what’s left" : "Domain & email"; btn.addEventListener("click", () => openFoundationsDesk());
  } else {
    // builder item 194 (findings 19 and 21): both names before "nothing for you to do", and a sub-name has one record
    const more = (Array.isArray(d.names) ? d.names : []).some((n) => n && n.points === false);
    const one = Array.isArray(d.records) && d.records.length === 1;
    card.appendChild(el("div", "note", d.health === "ssl_pending"
      ? (more ? d.custom_domain + " is connected, with one more record to add." : d.custom_domain + " is connected. The padlock is being switched on. Nothing for you to do.")
      : d.custom_domain + " — almost there: " + (one ? "one record" : "two records") + " to add where your domain’s settings are kept."));
    btn.textContent = d.health === "ssl_pending" ? (more ? "See the record" : "Check on it") : one ? "See the record" : "See the two records"; btn.addEventListener("click", () => openFoundationsDesk());
  }
  card.appendChild(btn);
}
// item 183: Website health with a memory. The Health check's own problems (what is wrong right now)
// and the daily check's (lib/health_score.ts, kept by day since migration 0170) share one count,
// one list and seven plain headings; the line and "since last week" are the daily check's memory.
// A client reads this card, so it says how many things there are to look at, never a score (Law 13).
const HM_HEADINGS = [["reach", "Can people reach it"], ["speed", "Speed"], ["google", "Google can read it"], ["everyone", "Everyone can use it"], ["words", "Words and pictures"], ["links", "Links"], ["business", "Business details"]];
const HM_CAT = { website_status: "reach", security: "reach", publishing: "reach", speed: "speed", visibility: "google", content: "words", connections: "business" };
// where each kind of problem is fixed
function hmFix(type) {
  if (/^(seo|links)\./.test(type)) return ["Open Pages", "#pages"];
  if (/^(accessibility\.img_alt|media\.|performance\.image)/.test(type)) return ["Open Files", "#media"];
  if (/^(business_info|local_presence|knowledge)\.|^trust\.(contact|hours)/.test(type)) return ["Business details", "#business"];
  if (/^(infrastructure|website)\.|^trust\.ssl/.test(type)) return ["Domain & email", "#domain"];
  return null;
}
const hmDay = (d) => { const t = new Date(String(d || "").slice(0, 10) + "T00:00:00Z"); return isNaN(t) ? "" : t.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };
// the weekly line: one point a week, the count above each point, the day under it
function hmLine(points) {
  const W = 360, H = 130, L = 26, R = 22, T = 18, B = 22, max = Math.max(4, ...points.map((p) => Number(p.n) || 0));
  const x = (i) => L + (points.length < 2 ? 0 : i * (W - L - R) / (points.length - 1)), y = (n) => T + (1 - n / max) * (H - T - B);
  const grid = [0, 0.5, 1].map((f) => { const yy = (T + f * (H - T - B)).toFixed(1); return `<line class="gr" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="0" y="${(Number(yy) + 3.5).toFixed(1)}">${Math.round(max * (1 - f))}</text>`; }).join("");
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(Number(p.n) || 0).toFixed(1)}`).join(" ");
  const dots = points.map((p, i) => `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(Number(p.n) || 0).toFixed(1)}" r="3.5"/><text class="v" x="${x(i).toFixed(1)}" y="${(y(Number(p.n) || 0) - 8).toFixed(1)}" text-anchor="middle">${Number(p.n) || 0}</text><text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(hmDay(p.day))}</text>`).join("");
  const label = "Things to look at, by week: " + points.map((p) => `${hmDay(p.day)} ${Number(p.n) || 0}`).join(", ");
  return `<svg class="hm-line" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}${points.length > 1 ? `<polyline class="ln" points="${pts}"/>` : ""}${dots}</svg>`;
}
function hmSince(m) {
  const box = el("div", "hm-since");
  box.appendChild(el("h3", null, "Since " + hmDay(m.since.day)));
  const fixed = m.since.fixed || [], added = m.since.added || [];
  if (!fixed.length && !added.length) box.appendChild(el("div", null, "Nothing fixed and nothing new."));
  const part = (cls, word, list) => {
    if (!list.length) return;
    box.appendChild(el("span", "k " + cls, list.reduce((a, c) => a + (Number(c.n) || 1), 0) + " " + word));
    const ul = el("ul");
    list.slice(0, 4).forEach((c) => ul.appendChild(el("li", null, (cls === "fixed" ? "✓ " : "! ") + c.title + (c.resources && c.resources.length ? " · " + c.resources.slice(0, 2).join(", ") : ""))));
    box.appendChild(ul);
  };
  part("fixed", "FIXED", fixed); part("new", "NEW", added);
  return box;
}
async function hmPdf(btn) {
  btn.disabled = true;
  try {
    const { data } = await sb.auth.getSession();
    const r = await fetch(FN + "/website-health/pdf", { headers: { "Authorization": "Bearer " + ENV.anon, "x-dds-user-jwt": data?.session?.access_token || "", "x-dds-scope-site": (new URLSearchParams(location.search).get("client") || ""), ...REGION_HEADER } });
    if (!r.ok) throw new Error("bad");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = (/filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "") || [])[1] || ("website-health-" + new Date().toISOString().slice(0, 10) + ".pdf");
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  } catch (_) { toast("The PDF didn’t come through. Try again in a moment.", true); }
  finally { btn.disabled = false; }
}
function renderHealthCard() {
  const card = $("healthCard"); if (!card) return;
  const h = HB_HEALTH; if (!h || !Array.isArray(h.categories)) { card.hidden = true; return; }
  card.innerHTML = ""; card.hidden = false;
  const m = h.memory && typeof h.memory === "object" ? h.memory : null;
  // what is wrong right now (the go-live list is its own), then what the daily check found
  const needs = [];
  h.categories.forEach((c) => { if (c.key !== "golive") (c.checks || []).forEach((k) => { if (k.state === "attention") needs.push({ ...k, heading: HM_CAT[c.key] || "reach" }); }); });
  const found = m && Array.isArray(m.issues) ? m.issues : [];
  const total = needs.length + found.length;
  card.classList.toggle("hm-wide", !!m);
  const head = el("div", "hb-card-h"); head.appendChild(el("h2", null, "Website health"));
  const acts = el("div", "hm-hacts");
  const chip = el("span", "hb-chip " + (total ? "warn" : h.overall === "new" ? "" : "good")); chip.appendChild(el("i", "d"));
  chip.appendChild(document.createTextNode(total ? (total + " to look at") : h.overall === "new" ? "Getting started" : "All good"));
  acts.appendChild(chip);
  if (m) { const pdf = el("button", "pillbtn sm", "Download PDF"); pdf.type = "button"; pdf.addEventListener("click", () => hmPdf(pdf)); acts.appendChild(pdf); }
  head.appendChild(acts); card.appendChild(head);
  card.appendChild(el("div", "note", h.summary || h.headline || ""));
  // list item 151: the two figures an owner asks first, how much it's been up and how fast
  // it loads, shown whether or not they need a look; and a new site's go-live list
  const facts = [], factBy = {};
  h.categories.forEach((c) => (c.checks || []).forEach((k) => { if (c.key === "speed" || /^Online \d/.test(k.title)) { facts.push(k.title); factBy[c.key === "speed" ? "speed" : "reach"] = k.title; } }));
  if (facts.length) card.appendChild(el("div", "note hb-facts", facts.join(" · ")));
  if (m && m.kept && m.now) {
    const row = el("div", "hm-row");
    const count = el("div", "hm-count");
    count.appendChild(el("b", null, String(total)));
    count.appendChild(el("span", null, total === 1 ? "thing to look at" : "things to look at"));
    if (m.then) {
      const d = (Number(m.now.n) || 0) - (Number(m.then.n) || 0), when = hmDay(m.then.day);
      count.appendChild(el("span", "hm-chg " + (d < 0 ? "up" : d > 0 ? "down" : ""), d === 0 ? "The same as " + when : d < 0 ? (-d) + " fewer than " + when : d + " more than " + when));
    }
    row.appendChild(count);
    const line = el("div");
    if (Array.isArray(m.points) && m.points.length > 1) {
      line.innerHTML = hmLine(m.points);
      line.appendChild(el("p", "hm-cap", "Found by the daily check, one point a week"));
    } else line.appendChild(el("p", "hm-cap", "The line fills in week by week."));
    row.appendChild(line);
    if (m.since) row.appendChild(hmSince(m));
    card.appendChild(row);
  } else if (m && !m.kept) {
    card.appendChild(el("div", "note", "Each day’s check is kept from today, so the line fills in week by week."));
  }
  const golive = h.categories.find((c) => c.key === "golive");
  if (golive) {
    card.appendChild(el("h3", "hb-sub-h", "Before you go live"));
    const ul = el("ul", "hb-checks hb-golive");
    golive.checks.forEach((k) => {
      const li = el("li"); li.dataset.done = k.state === "ok" ? "1" : "0";
      li.appendChild(el("b", null, (k.state === "ok" ? "✓ " : "") + k.title)); li.appendChild(document.createTextNode(k.why || ""));
      if (k.state !== "ok" && k.action_label && k.action_href) { li.appendChild(document.createTextNode(" ")); const a = el("a", null, k.action_label); a.href = k.action_href; li.appendChild(a); }
      ul.appendChild(li);
    });
    card.appendChild(ul);
  }
  if (m) {
    const tiles = el("div", "hm-tiles");
    HM_HEADINGS.forEach(([key, title]) => {
      const n = found.filter((x) => x.heading === key).length + needs.filter((x) => x.heading === key).length;
      const t = el("div", "hm-tile" + (n ? " look" : "")); t.dataset.heading = key;
      t.appendChild(el("b", null, title));
      t.appendChild(el("span", "s", n ? n + " to look at" : "✓ All good"));
      if (factBy[key]) t.appendChild(el("span", "f", factBy[key]));
      tiles.appendChild(t);
    });
    card.appendChild(tiles);
  }
  if (total) {
    const wrap = el("div", m ? "hm-list" : null);
    if (m) wrap.appendChild(el("h3", null, "To look at"));
    const ul = el("ul", "hb-checks");
    needs.forEach((k) => {
      const li = el("li"); li.appendChild(el("b", null, k.title)); li.appendChild(document.createTextNode(k.why || ""));
      if (k.action_label && k.action_href) { li.appendChild(document.createTextNode(" ")); const a = el("a", null, k.action_label); a.href = k.action_href; li.appendChild(a); }
      ul.appendChild(li);
    });
    found.forEach((x) => {
      const li = el("li", x.severity === "critical" ? "hm-crit" : null);
      const b = el("b"); b.appendChild(el("span", "hm-tag", (HM_HEADINGS.find((hh) => hh[0] === x.heading) || [, "Website"])[1])); b.appendChild(document.createTextNode(x.title + (x.n > 1 ? " · " + x.n + " places" : "")));
      li.appendChild(b);
      li.appendChild(document.createTextNode([x.resources && x.resources.length ? x.resources.slice(0, 3).join(", ") + "." : "", x.next_action || ""].filter(Boolean).join(" ")));
      const fx = hmFix(x.type);
      if (fx) { li.appendChild(document.createTextNode(" ")); const a = el("a", null, fx[0]); a.href = fx[1]; li.appendChild(a); }
      ul.appendChild(li);
    });
    wrap.appendChild(ul); card.appendChild(wrap);
  } else if (h.ok_count) {
    card.appendChild(el("div", "note", `✓ ${h.ok_count} check${h.ok_count === 1 ? "" : "s"} pass.`));
  }
  const usable = ueHealthBlock(); if (usable) card.appendChild(usable);   // item 150: the same list, from the last check
}
// ── Builder list item 150: "Usable by everyone" ─────────────────────────────
// (Figma "A · Accessibility check, with a fix list".) The editor reads each page of the draft
// as it is drawn (a11y-check.js, loaded when first needed) and lists what the owner can fix,
// each row opening the card that fixes it. What only a person can judge is three ticks, kept
// with the site, as is the last check's count, which Site health shows. The Publish card
// says how many are left and never waits on them.
const UE = { script: null, busy: null, result: null, hash: null, at: null, stored: null, storedP: null, faint: null };
const UE_ICON = { photo: "image", faint: "contrast", name: "page", link: "link", heading: "heading", field: "clipboard" };
function ueLoadScript() {
  if (window.DDSA11Y) return Promise.resolve();
  if (!UE.script) UE.script = new Promise((res, rej) => {
    const sc = document.createElement("script"); sc.src = "/a11y-check.js?v=1";
    sc.onload = () => res(); sc.onerror = () => { UE.script = null; sc.remove(); rej(new Error("The check didn’t load. Try again in a moment.")); };
    document.head.appendChild(sc);
  });
  return UE.script;
}
function ueStored() {
  if (!UE.storedP) UE.storedP = api("GET", "/site/usable").then((r) => (UE.stored = (r && r.data) || { ticks: {}, last: null })).catch(() => { UE.storedP = null; return UE.stored; });
  return UE.storedP;
}
// One page of the draft, drawn out of sight and read. Its own scripts never run.
function ueReadPage(html) {
  return new Promise((resolve) => {
    const f = document.createElement("iframe"); f.className = "ue-frame"; f.title = "Reading the draft"; f.tabIndex = -1;
    f.setAttribute("aria-hidden", "true"); f.setAttribute("sandbox", "allow-same-origin");
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      let found = null;
      try { found = window.DDSA11Y.checkDocument(f.contentDocument, f.contentWindow); } catch (_) { /* a page that can't be read is said so, not guessed */ }
      f.remove(); resolve(found);
    };
    f.addEventListener("load", () => setTimeout(finish, 50));
    setTimeout(finish, 6000);   // slow photos don't hold the list up
    f.srcdoc = html; document.body.appendChild(f);
  });
}
const ueHash = () => S.draftHash || REVIEWED || "";
function ueRun(force) {
  if (!force && UE.result && UE.hash && UE.hash === ueHash()) return Promise.resolve(UE.result);
  if (UE.busy) return UE.busy;
  UE.busy = (async () => {
    await ueLoadScript();
    try { await dcSavePendingEdits(); } catch (_) { /* the draft as last saved is read */ }
    const pages = [];
    for (const pg of dcPageList().slice(0, 40)) {
      let findings = null;
      try { findings = await ueReadPage(await apiHtml("/preview?version=draft&page=" + encodeURIComponent(pg.slug ? "/" + pg.slug + "/" : "/"))); } catch (_) { /* counted as a page that couldn't be read */ }
      pages.push({ slug: pg.slug, title: pg.title, findings });
    }
    const r = window.DDSA11Y.summarize(pages);
    UE.result = r; UE.hash = ueHash(); UE.at = new Date();
    if (r.unread < pages.length) api("PUT", "/site/usable", { last: { fix: r.fix, passed: r.passed, worst: r.worst } }).then((x) => { if (x && x.data) { UE.stored = x.data; renderHealthCard(); } }).catch(() => {});
    return r;
  })().finally(() => { UE.busy = null; });
  return UE.busy;
}
const ueToCheck = () => { const t = (UE.stored && UE.stored.ticks) || {}; return (window.DDSA11Y ? window.DDSA11Y.TICKS : []).filter(([k]) => !t[k]).length; };
function ueClose() { const d = $("ueSheet"); if (d && d.open) d.close(); }
function openUsable(force) {
  let dlg = $("ueSheet");
  if (!dlg) {
    dlg = el("dialog", "ue-sheet"); dlg.id = "ueSheet"; dlg.setAttribute("aria-labelledby", "ueTitle");
    const head = el("div", "ue-head");
    const h = el("h2", null, "Usable by everyone"); h.id = "ueTitle"; head.appendChild(h);
    const done = el("button", "pillbtn", "Done"); done.type = "button"; done.id = "ueDone"; done.addEventListener("click", ueClose); head.appendChild(done);
    dlg.appendChild(head);
    const body = el("div", "ue-body"); body.id = "ueBody"; dlg.appendChild(body);
    dlg.addEventListener("keydown", (e) => { if (e.key === "Escape") e.stopPropagation(); });   // Escape closes this card, not what's under it
    dlg.addEventListener("click", (e) => { if (e.target === dlg) ueClose(); });
    dlg.addEventListener("close", () => { const back = dlg._back; dlg._back = null; if (back && back.isConnected) { try { back.focus(); } catch (_) {} } });
    document.body.appendChild(dlg);
  }
  if (!dlg.open) { dlg._back = document.activeElement; dlg.showModal(); }
  const body = $("ueBody");
  body.textContent = "";
  const wait = el("p", "ue-when", "Reading your draft, page by page…"); wait.setAttribute("role", "status"); body.appendChild(wait); body.appendChild(el("div", "shimmer"));
  Promise.all([ueRun(force), ueStored()]).then(([r]) => { if (dlg.open) ueRender(r); }).catch((err) => {
    if (!dlg.open) return;
    body.textContent = "";
    const p2 = el("p", "ue-when", (err && err.message) || "The check didn’t finish. Try again in a moment."); p2.setAttribute("role", "alert"); body.appendChild(p2);
    const again = el("button", "pillbtn ue-again", "Try again"); again.type = "button"; again.addEventListener("click", () => openUsable(true)); body.appendChild(again);
  });
}
function ueRender(r) {
  const body = $("ueBody"); if (!body) return;
  const A = window.DDSA11Y;
  body.textContent = "";
  const at = (UE.at || new Date()).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
  body.appendChild(el("p", "ue-when", "Checked on your draft at " + at + ". Your live site changes when you publish."));
  const chips = el("div", "ue-chips"); chips.id = "ueChips";
  const paintChips = () => {
    chips.textContent = "";
    chips.appendChild(el("span", "hb-chip " + (r.fix ? "warn" : "good"), r.fix ? r.fix + " to fix" : "Nothing to fix"));
    const n = ueToCheck(); if (n) chips.appendChild(el("span", "hb-chip", n + " for you to check"));
    chips.appendChild(el("span", "hb-chip good", r.passed + " passed"));
  };
  paintChips(); body.appendChild(chips);
  if (r.rows.length) {
    body.appendChild(el("h3", "ue-h", "To fix"));
    const ul = el("ul", "ue-list");
    r.rows.forEach((row) => {
      const li = el("li", "ue-row"); li.dataset.kind = row.kind;
      const ic = el("span", "ue-ic"); ic.setAttribute("aria-hidden", "true"); ic.innerHTML = uiIcon(UE_ICON[row.kind] || "page", 16); li.appendChild(ic);
      const t = el("div", "ue-t");
      t.appendChild(el("b", null, row.title));
      if (row.where) t.appendChild(el("span", "ue-where", row.where));
      t.appendChild(el("span", "ue-why", row.why));
      const b = el("button", "pillbtn", row.fix); b.type = "button"; b.setAttribute("aria-label", row.fix + ": " + row.title + (row.where ? ", " + row.where : ""));
      b.addEventListener("click", () => ueFix(row)); t.appendChild(b);
      li.appendChild(t); ul.appendChild(li);
    });
    body.appendChild(ul);
  } else if (!r.unread) {
    body.appendChild(el("h3", "ue-h", "To fix"));
    body.appendChild(el("div", "ue-none", "Nothing to fix on any page of your draft."));
  }
  if (r.unread) body.appendChild(el("p", "ue-when", r.unread === 1 ? "One page couldn’t be read just now. Check again in a moment." : r.unread + " pages couldn’t be read just now. Check again in a moment."));
  body.appendChild(el("h3", "ue-h", "Only you can check"));
  const ticks = (UE.stored && UE.stored.ticks) || {};
  A.TICKS.forEach(([key, words]) => {
    const lab = el("label", "ue-tick"); const box = el("input"); box.type = "checkbox"; box.checked = !!ticks[key]; box.dataset.tick = key;
    box.addEventListener("change", () => {
      const want = box.checked;
      api("PUT", "/site/usable", { ticks: { [key]: want } }).then((x) => { if (x && x.data) UE.stored = x.data; else UE.stored = { ...(UE.stored || {}), ticks: { ...ticks, [key]: want } }; paintChips(); renderHealthCard(); })
        .catch((err) => { box.checked = !want; toast(nice(err), true); });
    });
    lab.appendChild(box); lab.appendChild(el("span", null, words)); body.appendChild(lab);
  });
  const foot = el("div", "ue-foot");
  const again = el("button", "pillbtn ue-again"); again.type = "button"; again.id = "ueAgain"; again.innerHTML = uiIcon("refresh", 16); again.appendChild(document.createTextNode("Check again"));
  again.addEventListener("click", () => openUsable(true)); foot.appendChild(again);
  const live = typeof siteLiveUrl === "function" ? siteLiveUrl() : null;
  if (live) { const a = el("a", null, "Your accessibility statement"); a.href = live.replace(/\/+$/, "") + "/accessibility/"; a.target = "_blank"; a.rel = "noopener"; foot.appendChild(a); }
  body.appendChild(foot);
}
// A row's button: the page it's on, then the card that fixes it.
async function ueFix(row) {
  ueClose();
  go("design");
  if (!(await dcSwitchPage(row.slug))) return;
  if (row.kind === "name") { pgOpenSettings({ href: "/" + row.slug + "/" }); return; }
  if (row.src == null) { if (row.kind === "faint") { openSettingsPanel("styles"); stylesTab("colours"); } return; }
  if (!BLOCKS_WORK || !BLOCKS_WORK[row.src]) { toast("That section has moved since the check. Check again to find it.", true); return; }
  if (row.kind === "faint") { UE.faint = { slug: DC_PAGE, bi: row.src, fg: row.fg, bg: row.bg, min: row.min || 4.5 }; eeEditBlock(row.src, "style"); return; }
  eeEditBlock(row.src, "content");
}
// The Publish card's row: how many are left, and the way to them. It never stops a publish.
function ueRitualRow() {
  const ul = $("ritBlockers") && $("ritBlockers").querySelector("ul.blocklist"); if (!ul) return;
  const li = el("li", "ok ue-rit"); li.id = "ueRit";
  const mark = el("i", "rit-ck ok ue-rit-ic"); mark.setAttribute("aria-hidden", "true"); mark.innerHTML = uiIcon("usable", 16); li.appendChild(mark);
  const msg = el("span", "rit-msg"); msg.appendChild(document.createTextNode("Usable by everyone"));
  const sub = el("small", null, "Checking your draft…"); msg.appendChild(sub); li.appendChild(msg);
  const rev = el("button", "textact", "Review"); rev.type = "button"; rev.setAttribute("aria-label", "Review what would make the site usable by everyone");
  rev.addEventListener("click", () => { closeRitual(); openUsable(); }); li.appendChild(rev);
  ul.appendChild(li);
  Promise.all([ueRun(), ueStored()]).then(([r]) => {
    if (!li.isConnected) return;
    sub.textContent = window.DDSA11Y.publishLine(r.fix, ueToCheck());
    mark.className = "rit-ck ue-rit-ic " + (r.fix ? "bad" : "ok");
  }).catch(() => { if (li.isConnected) sub.textContent = "The check didn’t finish. Review runs it again."; });
}
// Site health shows the same list, from the last check
function ueHealthBlock() {
  const st = UE.stored; if (!st) return null;
  const box = el("div", "ue-health"); box.id = "ueHealth";
  const h = el("div", "ue-health-h"); h.appendChild(el("h3", null, "Usable by everyone"));
  const last = st.last;
  if (last) h.appendChild(el("span", "hb-chip " + (last.fix ? "warn" : "good"), last.fix ? last.fix + " to fix" : "Nothing to fix"));
  box.appendChild(h);
  box.appendChild(el("div", "note", !last ? "Photos without a description, faint words, buttons that only say “Click here”. Not checked yet." : last.fix ? "Worst first: " + last.worst : "Nothing to fix when the draft was last checked."));
  const b = el("button", "pillbtn sm", last ? "Open the check in the editor" : "Check now"); b.type = "button"; b.addEventListener("click", () => openUsable(!last)); box.appendChild(b);
  return box;
}
function renderActivity() {
  const sec = $("activitySec"), list = $("activityList"), more = $("activityMore"); if (!sec || !list) return;
  const t = HB_TIMELINE;
  const evs = t && Array.isArray(t.groups) ? t.groups.filter((g) => g.key !== "upcoming").reduce((a, g) => a.concat(g.events || []), []) : [];
  if (!evs.length) { sec.hidden = true; return; }
  sec.hidden = false; list.innerHTML = "";
  evs.slice(0, HB_ACTIVITY_ALL ? 30 : 5).forEach((e) => {
    const row = el("div", "hb-row act");
    row.appendChild(el("span", "ic", e.icon || "•"));
    const tx = el("div", "t"); tx.appendChild(el("b", null, e.title));
    tx.appendChild(el("span", null, [e.actor, e.when].filter(Boolean).join(" · ") + (e.description ? " — " + e.description : "")));
    row.appendChild(tx);
    if (e.href) { const acts = el("div", "acts"); const a = el("a", "pillbtn sm", "Open"); a.href = e.href; a.setAttribute("aria-label", "Open — " + e.title); acts.appendChild(a); row.appendChild(acts); }
    list.appendChild(row);
  });
  if (more) {
    more.hidden = evs.length <= 5;
    more.textContent = HB_ACTIVITY_ALL ? "Show less" : "See all";
    more.setAttribute("aria-expanded", HB_ACTIVITY_ALL ? "true" : "false");
    more.onclick = () => { HB_ACTIVITY_ALL = !HB_ACTIVITY_ALL; renderActivity(); more.focus(); };
  }
}
// #health and #activity land on the card that replaced a retired page
function hbScrollTo(id, tries = 8) {
  // The route has already opened the tab the card sits on (Search, Versions). This used to open
  // the Overview first, from when the cards were there, so an old #health or #activity link
  // showed its tab for a moment and then left it. The card's read may still be on its way
  // (item 84), so it looks again for a couple of seconds.
  const n = $(id);
  if (n && !n.hidden) { n.scrollIntoView({ behavior: "smooth", block: "start" }); if (n.hasAttribute("tabindex")) n.focus({ preventScroll: true }); return; }
  if (tries > 0) setTimeout(() => hbScrollTo(id, tries - 1), 250);
}
// the four tiles — each one a door to where the number is dealt with
let HB_SEARCH = null, HB_ASKED = {};
// the rail: Design — the site's colors, type and template, as it is dressed now
let HB_LOOKS_ASKED = false;
// the rail: Photos — three thumbnails and the count

/* ── today: the board + the concierge's letters ── */
// Item 84: a full load hands in health and the changes count already on their way with its
// first wave (`first`). Coming back to the Overview reads them again only if this page has
// saved something since: the changes count follows every save on its own.
let TODAY_READ_AT = -1;   // WRITES_ANSWERED when health and the changes count were last read
async function loadToday(first) {
  loadSiteStage();
  if (!first && S.health && TODAY_READ_AT === WRITES_ANSWERED && !DRAFT_WRITES_OUT) return;
  try {
    const at = WRITES_ANSWERED;
    const [h, c] = await (first || Promise.all([api("GET", "/health"), readChanges()]));   // M9: seed the optimistic-lock version
    S.health = h.data; S.changes = c.data; TODAY_READ_AT = at;
    renderFactsProse();
    renderPublishButton(); renderBizWaiting(); renderTodoLine(); renderStageStatus(); dcSyncPageSwitch();
  } catch (err) { toast(nice(err), true); }
}
// ── The Overview is the site ─────────────────────────────────────────────────
// The draft, as the render engine draws it, in view mode: links and forms are
// guarded, nothing is editable here. Edit site opens the same page to build on.
let SS_LOADED = false, SS_STALE = true, SS_SEQ = 0, SS_PATH = "/";
let SS_PENDING = false;   // item 84: a draw on its way; asked again meanwhile, it isn't drawn twice
const SS_FRAME = $("siteFrame") ? frameWriter($("siteFrame")) : null;   // item 100: a quick second draw can't be lost
function loadSiteStage(force) {
  const frame = $("siteFrame"); if (!frame || !$("view-today").classList.contains("on")) return;
  if (SS_LOADED && !SS_STALE && !force) return;
  if (SS_PENDING && !force) return;
  const seq = ++SS_SEQ;
  SS_PENDING = true;
  apiHtml("/preview?version=draft&page=" + encodeURIComponent(SS_PATH)).finally(() => { if (seq === SS_SEQ) SS_PENDING = false; }).then((html) => {
    if (seq !== SS_SEQ) return;
    SS_LOADED = true; SS_STALE = false;
    SS_FRAME.write(frameWall(html));   // item 190
    const note = $("ssNote"); if (note) { note.hidden = true; note.textContent = ""; }
    document.documentElement.classList.remove("ss-noplan");
  }).catch((err) => {
    if (seq !== SS_SEQ) return;
    const note = $("ssNote"); if (!note) return;
    note.hidden = false; note.textContent = "";
    if (err && err.status === 403) {
      document.documentElement.classList.add("ss-noplan");
      const nm = S.identity && S.identity.business_name;
      note.appendChild(el("div", "ssn-h", (nm ? nm + (/s$/i.test(nm) ? "’" : "’s") + " website" : "This website") + " lives somewhere else."));
      note.appendChild(el("div", "ssn-p", "Its visitors and search standing are here."));
      const row = el("div", "ssn-acts");
      const go2 = (label, fn) => { const b = el("button", "pillbtn", label); b.type = "button"; b.addEventListener("click", fn); row.appendChild(b); };
      go2("Visitors", () => openSiteTab("analytics"));
      go2("Search and health", () => go("search"));
      go2("Their address", () => { location.hash = "#monitor"; });
      note.appendChild(row);
    } else {
      note.appendChild(el("div", "ssn-h", "Your site couldn’t be drawn just now."));
      note.appendChild(el("div", "ssn-p", "Nothing is lost. It will show up on your next visit, or open Preview above."));
    }
  });
}
function stageStale() { SS_STALE = true; if ($("view-today") && $("view-today").classList.contains("on")) loadSiteStage(); }
function renderStageStatus() {
  const st = $("ssStatus"); if (!st) return;
  const live = siteLiveUrl(); const c = S.changes || {};
  const n = c.count || 0;
  // item 261: the server's word (Live, Offline, Not answering, Paused, Not live yet), then the count
  const word = S.live && S.live.words ? S.live.words : live ? "Live" : "Not live yet";
  const isLive = S.live ? !!S.live.is_live : !!live;
  st.textContent = isLive && n ? `Live · ${n} change${n === 1 ? "" : "s"} waiting` : word;
  st.classList.toggle("live", isLive);
  dcSyncLiveChip();
}
// One line for what's left before the site can go live. Nothing to finish, no line.
let SETUP_LEFT = 0, SETUP_TOTAL = 0;
function renderTodoLine() {
  const b = $("ssTodo"), t = $("ssTodoText"); if (!b || !t) return;
  if (S.site && S.site.edition === "monitor") { b.hidden = true; return; }
  renderSetup();
  const blockers = Number((S.changes || {}).blockers || 0);
  const box = $("todoBlockers");
  if (box) {
    box.hidden = !blockers; box.textContent = "";
    if (blockers) {
      box.appendChild(el("h2", null, "Before you can go live"));
      box.appendChild(el("div", "note", `${blockers} thing${blockers === 1 ? "" : "s"} to finish. The publish page lists each one, with a way straight to it.`));
      const go2 = el("button", "pillbtn", "See what’s blocking"); go2.type = "button"; go2.addEventListener("click", () => { closeTodoPanel(); openRitual(); });
      box.appendChild(go2);
    }
  }
  if (blockers) t.textContent = `${blockers} thing${blockers === 1 ? "" : "s"} to finish before you can go live`;
  else if (SETUP_LEFT) t.textContent = `Set up your site · ${SETUP_TOTAL - SETUP_LEFT} of ${SETUP_TOTAL}`;
  b.hidden = !(blockers || SETUP_LEFT);
}
function openTodoPanel() { const p = $("todoPanel"); if (p) { p.classList.add("on"); renderTodoLine(); renderSiteStatus(); refreshSiteStatus(); p.setAttribute("aria-hidden", "false"); const c = $("btnTodoClose"); if (c) c.focus(); } }
function closeTodoPanel() { const p = $("todoPanel"); if (p && p.classList.contains("on")) { p.classList.remove("on"); p.setAttribute("aria-hidden", "true"); } }
// Tabs open on their title. What a tab is for sits behind one small help button.
(function initTabHelp() {
  document.querySelectorAll(".view > h1.doc + .docsub").forEach((sub) => {
    const view = sub.parentElement;
    sub.id = sub.id || view.id + "-help"; sub.hidden = true;
    const b = el("button", "tabhelp", "?"); b.type = "button";
    b.title = "What’s this page for?"; b.setAttribute("aria-label", "What’s this page for?");
    b.setAttribute("aria-expanded", "false"); b.setAttribute("aria-controls", sub.id);
    b.addEventListener("click", () => { sub.hidden = !sub.hidden; b.setAttribute("aria-expanded", String(!sub.hidden)); });
    sub.previousElementSibling.after(b);
  });
})();
(function initSiteStage() {
  const seg = $("ssDevSeg"), wrap = $("ssFrameWrap");
  if (seg && wrap) seg.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    seg.querySelectorAll("button").forEach((x) => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
    wrap.className = "ss-frame" + (b.dataset.ssdev === "desktop" ? "" : " dev-" + b.dataset.ssdev);
  });
  const todo = $("ssTodo"); if (todo) todo.addEventListener("click", openTodoPanel);
  const tc = $("btnTodoClose"); if (tc) tc.addEventListener("click", closeTodoPanel);
  const add = $("btnPagesAdd"); if (add) add.addEventListener("click", () => { go("design"); setTimeout(() => dcAddPage(), 300); });
  const addLink = $("btnPagesAddLink"); if (addLink) addLink.addEventListener("click", () => pgOpenLink(null));
  const addFolder = $("btnPagesAddFolder"); if (addFolder) addFolder.addEventListener("click", () => pgOpenFolder(null));
  const auto = $("btnNavAuto"); if (auto) auto.addEventListener("click", pgResetNav);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeTodoPanel(); });
  const frame = $("siteFrame");
  if (frame) frame.addEventListener("load", () => {
    try {
      const doc = frame.contentDocument; if (!doc || !doc.body) return;
      // the bar above says whether this is live, so the preview ribbon has nothing to add
      const st = doc.createElement("style"); st.textContent = "#presence-preview-badge{display:none!important}"; (doc.head || doc.documentElement).appendChild(st);
      doc.addEventListener("submit", (e) => e.preventDefault(), true);
      // links walk the site, here in the frame. Anything leading off the site does nothing.
      doc.addEventListener("click", (e) => {
        const a = e.target && e.target.closest && e.target.closest("a[href]"); if (!a) return;
        const href = a.getAttribute("href") || "";
        if (href.charAt(0) === "#") return;   // a jump on the same page works as it would for a visitor
        e.preventDefault();
        if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href)) return;
        const path = "/" + href.split(/[?#]/)[0].replace(/^\/+/, "").replace(/index\.html$/, "");
        const name = (a.textContent || "").trim();
        SS_PATH = path === "//" ? "/" : path;
        const pg = $("ssPage"); if (pg) pg.textContent = SS_PATH === "/" ? "Home" : (name.slice(0, 40) || SS_PATH);
        loadSiteStage(true);
      }, true);
    } catch (_) { /* a frame we can't read is still a picture of the site */ }
  });
})();

function renderFactsProse() {
  const w = $("factsWrap"); const f = S.health && S.health.facts;
  const title = $("siteTitle"); if (title) title.textContent = (S.identity && S.identity.business_name) || "Your website";
  const live = siteLiveUrl(); const lb = $("btnLive"); if (lb) { lb.hidden = !live; if (live) lb.href = live; }
  const whisperNode = $("topWhisper");
  Array.from(w.children).forEach((n) => { if (n !== whisperNode) n.remove(); });
  if (!f) return;
  // a quiet celebration the first time a custom domain appears (presentation-only; state remembered locally)
  try {
    const key = "presence-domain-" + ((S.site && S.site.id) || "x");
    const had = localStorage.getItem(key);
    const has = f.domain.state !== "none" && f.domain.state !== "attention" ? f.domain.label : "";
    if (has && had === "none") toast(`${f.domain.label} is yours now — your own address on the internet.`);
    localStorage.setItem(key, has || "none");
  } catch { /* celebration is optional */ }
  const parts = [];
  const address = (f.website.state !== "none" && f.website.detail) || (f.domain.state !== "none" ? f.domain.label : "");
  if (address) { const a = el("a", null, address); a.href = live || ("https://" + address); a.target = "_blank"; a.rel = "noopener"; parts.push(a); }
  const chip = el("span", "hb-chip"); chip.id = "siteLiveChip"; chip.appendChild(el("i", "d"));
  if (f.website.state === "live") { chip.classList.add("good"); chip.appendChild(document.createTextNode("Live")); }
  else if (f.website.state === "attention") { chip.classList.add("warn"); chip.appendChild(document.createTextNode("Being looked at")); }
  else chip.appendChild(document.createTextNode("Not live yet"));
  parts.push(chip);
  if (f.last_publish.label !== "—") { const lp = el("span", null, "Last published " + String(f.last_publish.label).replace(/^[A-Za-z]{3}, /, "")); lp.title = hbCap(f.last_publish.detail); parts.push(lp); }
  parts.forEach((n, i) => { if (i) w.insertBefore(el("span", "dot", "·"), whisperNode); w.insertBefore(n, whisperNode); });
  if (parts.length) w.insertBefore(el("span", "dot", "·"), whisperNode);
  if ($("view-pages").classList.contains("on")) renderPagesList();   // item 84: opening Pages draws it
}
function renderRecent() {
  const c = S.changes;
  // Guard c.changes like renderBizWaiting does — a /changes answer without a
  // changes[] list must render "nothing waiting", never throw mid-paint.
  const rows = (c?.changes || []);
  const hasAny = rows.length && !(S.health && S.health.first_run);
  $("recentWrap").hidden = !hasAny;
  const list = $("recentList"); list.innerHTML = "";
  if (!hasAny) return;
  const pageFor = (section) => hbStandardPages().find((pg) => pg.sections.indexOf(section) >= 0);
  rows.slice(0, 8).forEach((ch) => {
    const row = el("div", "hb-row");
    const ic = el("span", "ic"); ic.innerHTML = HB_ICON.pencil; row.appendChild(ic);
    const pg = pageFor(ch.section);
    const t = el("div", "t"); t.appendChild(el("b", null, ch.sentence));
    t.appendChild(el("span", null, hbCap(sectionWord(ch.section)) + (c.blockers ? "" : " · ready to publish")));
    row.appendChild(t);
    const acts = el("div", "acts");
    const pv = el("button", "pillbtn sm ghost", "Preview"); pv.type = "button";
    pv.addEventListener("click", () => { PV.page = pg ? pg.path : "/"; openPreview("draft"); });
    acts.appendChild(pv);
    if (ch.section !== "site") {
      const ed = el("button", "pillbtn sm ghost", "Edit"); ed.type = "button";
      ed.addEventListener("click", () => { if (pg) hbOpenPage(pg); else go(ch.section === "media" ? "media" : "business"); });
      acts.appendChild(ed);
    }
    row.appendChild(acts);
    list.appendChild(row);
  });
  if (rows.length > 8) { const r = el("div", "hb-row quiet"); const t = el("div", "t"); t.appendChild(el("span", null, `…and ${rows.length - 8} more — the publish page reads out everything.`)); r.appendChild(t); list.appendChild(r); }
  const q = el("div", "hb-row quiet"); const qt = el("div", "t");
  qt.appendChild(el("span", null, "Nothing goes live until you press Publish. "));
  const sch = el("a", null, "Schedule it for later"); sch.href = "#schedule"; sch.addEventListener("click", (e) => { e.preventDefault(); openRitual({ schedule: true }); }); qt.appendChild(sch); qt.appendChild(el("span", null, " — pick a time and it goes live on its own."));
  q.appendChild(qt); list.appendChild(q);
}
const sectionWord = (s) => ({ offerings: VOCAB.label.toLowerCase(), faqs: "questions", testimonials: "testimonials", updates: "updates", business: "business", media: "files", site: "your site" }[s] || s);
function renderPublishButton() {
  const c = S.changes;
  const locked = !!(S.publishLock && S.publishLock.on);   // item 214: it opens the card that says why
  const label = locked ? "Locked" : c && c.count > 0 ? `Publish ${c.count} change${c.count === 1 ? "" : "s"}` : "Publish";
  $("btnPublish").textContent = label;
  // nothing to publish → the button steps back to quiet; the filled style is for a real next action
  $("btnPublish").classList.toggle("inked", !locked && !!(c && (c.count > 0 || c.first_publish)));
  $("btnPublish").classList.toggle("locked", locked);
  $("btnPublish").title = locked ? "Publishing is locked" : "";
  $("dockPublish").textContent = locked ? "Locked" : c && c.count > 0 ? `Publish·${c.count}` : "Publish";
  // builder item 220: the pills a Designer sees in Publish's place say how much waits
  const waiting = c && c.count > 0;
  if ($("btnWaitPub")) $("btnWaitPub").textContent = waiting ? "Waiting to be published" : "All saved in the draft";
  if ($("dockWait")) $("dockWait").textContent = waiting ? `Waiting·${c.count}` : "Saved";
  if ($("dcBtnWait")) $("dcBtnWait").textContent = waiting ? `${c.count} change${c.count === 1 ? "" : "s"} wait to be published` : "All saved in the draft";
  const barPub = $("dcBtnPublish");   // Edit mode's own copy of the same button
  if (barPub) {
    const tight = window.matchMedia && matchMedia("(max-width:760px)").matches && c && c.count > 0;   // a phone's bar is short of room
    if (locked) { barPub.innerHTML = uiIcon("lock", 14); barPub.appendChild(document.createTextNode("Locked")); barPub.setAttribute("aria-label", "Publishing is locked"); }
    else { barPub.textContent = tight ? `Publish·${c.count}` : label; barPub.setAttribute("aria-label", label); }
    barPub.classList.toggle("inked", $("btnPublish").classList.contains("inked"));
    barPub.classList.toggle("locked", locked);
  }
  dcSyncLiveChip();
}
// A read names the version the draft had when it got there, someone else's changes and
// all. The page holds the version its own state is built on: the one it loaded with,
// then whatever each of its writes left. So a read's version is only taken when the page
// holds none, or along with a full load (refreshAll sets DRAFT_SEED). One of our writes
// answered since the read left has moved the draft on, and one still out is about to, so
// that version would refuse our next write as someone else's change: leave it, and read
// again.
async function readChanges() {
  const answered = WRITES_ANSWERED;
  const c = await api("GET", "/changes");
  if (c.data && c.data.draft_hash && (DRAFT_SEED || !S.draftHash)) {
    if (answered === WRITES_ANSWERED && !DRAFT_WRITES_OUT) { S.draftHash = c.data.draft_hash; DRAFT_SEED = false; }
    else scheduleChangesRefresh();
  }
  return c;
}
function scheduleChangesRefresh() {
  debounce("changes", async () => {
    try { const c = await readChanges(); S.changes = c.data; renderPublishButton(); renderBizWaiting(); renderTodoLine(); renderStageStatus(); dcSyncPageSwitch();
      if ($("view-pages").classList.contains("on")) { renderRecent(); renderPagesList(); } }
    catch { /* quiet */ }
  }, 1200);
}
/* the diff engine's own sentences, spoken where the edit happens (B-03) */
function renderBizWaiting() {
  const w = $("bizWaiting"); if (!w) return;
  const rows = (S.changes?.changes || []).filter((ch) => ch.section === "business");
  w.innerHTML = "";
  if (!rows.length) return;
  rows.forEach((ch) => w.appendChild(el("p", "consequence", "When you publish: " + ch.sentence.charAt(0).toLowerCase() + ch.sentence.slice(1))));
  w.style.marginTop = "-22px"; w.style.marginBottom = "34px";
}
const siteKey = () => (S.site && S.site.id) || "";
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* private window: the full welcome just shows again */ } };

/* ── the proofing desk (identical /preview calls) ── */
const PV = { ver: "draft", dev: "desktop", page: "/", publishId: null, template: "", launchId: null };
// ── Phase CP-1 (FD-T8): try another look — preview-only until "Use this look" ──
let LOOKS = null;   // { current: {slug}, templates: [{slug,name,version}] }
// Trying a template on starts from the gallery in Styles. The preview only says so and
// offers the one decision.
function paintStageTemplate() {
  const seg = $("lookSeg"); if (!seg) return;
  seg.textContent = "";
  if (!PV.template) return;
  const t = ((LOOKS && LOOKS.templates) || []).find((x) => x.slug === PV.template);
  seg.appendChild(el("span", null, "Trying " + (t ? t.name : "a template")));
  const use = el("button", null, "Use this template"); use.dataset.needs = "owner"; use.type = "button"; use.style.fontWeight = "700";
  use.addEventListener("click", async () => { closePreview(); if (t) await applyTemplateFromGallery(t); });
  seg.appendChild(use);
}
async function openPreview(ver, opts) {
  if (ver) PV.ver = ver;
  PV.publishId = null; PV.launchId = null;
  PV.template = (opts && opts.template) || "";
  if (PV.template) PV.ver = "draft";
  paintStageTemplate();
  $("verSeg").style.display = PV.template ? "none" : "";
  syncStageChrome();
  openStage();
  lsSet("presence-previewed:" + siteKey(), "1");   // per site: one client's proof doesn't tick another's step
  await loadPreview();
}
async function openLaunchPreview(launchId) {   // FD-T7: preview a staged launch
  PV.launchId = launchId; PV.publishId = null; PV.template = ""; paintStageTemplate();
  $("verSeg").style.display = "none";
  openStage();
  await loadPreview();
}
async function openPublishPreview(publishId) {
  PV.publishId = publishId; PV.launchId = null; PV.template = ""; paintStageTemplate();
  $("verSeg").style.display = "none";
  openStage();
  await loadPreview();
}
function openStage() { lastFocus = document.activeElement; $("stage").classList.add("on"); document.body.style.overflow = "hidden"; $("btnStageClose").focus(); }
function closePreview() { PV.template = ""; $("stage").classList.remove("on"); document.body.style.overflow = ""; PV_SEQ++; pvWrite(""); if (lastFocus && lastFocus.focus) { lastFocus.focus(); lastFocus = null; } }
$("btnStageClose").addEventListener("click", closePreview);
// Escape closes the stage and nothing beneath it: it is the topmost layer, but the Design
// panels' capture handler and the shell's (an expanded sidebar section reads as an open
// menu and grabs focus) would otherwise eat the key or pull focus off the opener.
window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !$("stage").classList.contains("on")) return;
  if (document.querySelector("dialog[open]")) return;   // a card over the preview (item 158's code) answers its own Escape
  e.stopPropagation(); closePreview();
}, true);
$("btnEditSite").addEventListener("click", () => {
  go("design");
  const slug = SS_PATH.replace(/\//g, "");
  if ($("view-design").classList.contains("on") && slug && typeof dcPageObj === "function" && dcPageObj(slug)) dcSwitchPage(slug);
});
$("btnPreview").addEventListener("click", () => { if (document.documentElement.classList.contains("site-home")) PV.page = SS_PATH || "/"; openPreview("draft"); });
// Every page of the site, in the menu's order, the ones off the menu after it.
function renderPageWords() {
  const host = $("pageWords"), m = pgModel(), seen = new Set(); host.textContent = "";
  m.menu.filter((e) => e.pg).map((e) => [e.pg.path, e.it.label]).concat(m.unlinked.map((p) => [p.path, p.title])).forEach(([page, name]) => {
    if (seen.has(page)) return; seen.add(page);
    const b = el("button", null, name); b.type = "button"; b.dataset.page = page; host.appendChild(b);
  });
}
function syncStageChrome() {
  renderPageWords();
  const press = (b, on) => { b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); };
  document.querySelectorAll("#verSeg button").forEach((b) => press(b, b.dataset.ver === PV.ver));
  document.querySelectorAll("#devSeg button").forEach((b) => press(b, b.dataset.dev === PV.dev));
  document.querySelectorAll("#pageWords button").forEach((b) => press(b, b.dataset.page === PV.page));
  $("proofFrame").classList.toggle("phone", PV.dev === "mobile");
}
$("verSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; PV.ver = b.dataset.ver; syncStageChrome(); loadPreview(); });
$("devSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; PV.dev = b.dataset.dev; syncStageChrome(); });
$("pageWords").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; PV.page = b.dataset.page; syncStageChrome(); loadPreview(); });
window.addEventListener("message", (e) => {
  if (e.source !== $("previewFrame").contentWindow) return;   // item 190: only the Preview page speaks here
  if (e.data && e.data.presenceNav) { PV.page = e.data.presenceNav; syncStageChrome(); loadPreview(); }
  if (e.data && e.data.presenceRetry && $("stage").classList.contains("on")) loadPreview();   // the proof's own Try again (experience review #13)
});
// Item 100: two writes to a frame a few milliseconds apart could leave it on the first. A
// draft that came back quickly stayed on "Loading your draft…" for good, the page itself sitting
// unused in srcdoc: the loading line finished loading after the page was written, and the
// browser dropped the page. The Overview's frame did the same between two quick draws. So a
// frame's writes go through frameWriter: each is numbered, and a frame that finishes loading an
// older one is given the newest again (twice in a row at most, so nothing can loop).
// Item 190: Preview's frame has no origin (frameWall below), so its page can't be read from
// here; it says which write it shows in a message. The others are read directly, as before.
function frameWriter(frame) {
  const w = { count: 0, doc: "", redos: 0 };
  const sb = frame.getAttribute("sandbox"), sealed = sb !== null && !/\ballow-same-origin\b/.test(sb);
  const stamp = (n) => (sealed ? `<script>parent.postMessage({ ddsProof: ${n} }, "*")<\/script>` : `<!--dds-proof ${n}-->`);
  w.write = (doc) => { w.doc = doc ? doc + stamp(++w.count) : ""; w.redos = 0; frame.srcdoc = w.doc; };
  const shows = (shown) => {
    if (!w.doc) return;
    if (shown === w.count) w.redos = 0;
    else if (shown && shown < w.count && w.redos++ < 2) frame.srcdoc = w.doc;
  };
  if (sealed) window.addEventListener("message", (e) => { if (e.source === frame.contentWindow && e.data && Number.isInteger(e.data.ddsProof)) shows(e.data.ddsProof); });
  else frame.addEventListener("load", () => {
    const d = frame.contentDocument;
    if (!w.doc || !d) return;
    const walk = d.createTreeWalker(d, NodeFilter.SHOW_COMMENT); let n, shown = 0;
    while ((n = walk.nextNode())) { const m = /^dds-proof (\d+)$/.exec(n.data); if (m) shown = +m[1]; }
    shows(shown);
  });
  return w;
}
// ── Item 190 (review file 06, finding 1): the editor's page frames are walled off from the app ──
// A page the editor draws is the site's own HTML, which a Developer seat can shape (custom HTML,
// cleaned on the server by lib/dev_html.ts). Drawn in a frame of the app's own origin, a script
// that got through would run as whoever has the editor open. So:
// · Edit's canvas (#designPreview) and the Overview (#siteFrame) stay same-origin, because the
//   editor works inside them (its section tools are drawn in the page and it listens there), but
//   every page they draw carries a rule that runs none of its own scripts: no <script>, no on…
//   attribute, no javascript: link. The editor's listeners are the app's own code and still run.
//   (A sandbox without allow-scripts walls a page off as well in Chromium, but WebKit then drops
//   the editor's listeners too, so the iPad and iPhone couldn't edit.)
// · Preview (#previewFrame) is a visitor's view, so the page's own scripts run there (the phone
//   menu, the hours line, a pop-up), in a frame with no origin, which can't reach the app at all
//   and speaks to it only by message.
const FRAME_RULE = `<meta http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'">`;
function frameWall(html) {
  const s = String(html || "");
  const h = /<head\b[^>]*>/i.exec(s);
  if (h) return s.slice(0, h.index + h[0].length) + FRAME_RULE + s.slice(h.index + h[0].length);
  const d = /^\s*<!doctype[^>]*>/i.exec(s);   // before anything else, but after the doctype, so the page keeps its mode
  return d ? d[0] + FRAME_RULE + s.slice(d[0].length) : FRAME_RULE + s;
}
// An answer to an older ask (another page or version picked meanwhile, or Preview closed) is
// dropped, as the Overview's are.
const PV_FRAME = frameWriter($("previewFrame"));
let PV_SEQ = 0;
function pvWrite(doc) { PV_FRAME.write(doc); }
async function loadPreview() {
  const seq = ++PV_SEQ;
  pvWrite(`<div style="font-family:Georgia,serif;font-style:italic;color:#8a8172;padding:48px;text-align:center">Loading your ${PV.publishId ? "saved version" : PV.ver === "live" ? "live site" : "draft"}…</div>`);
  try {
    const q = (PV.launchId ? `launch_id=${PV.launchId}&page=${encodeURIComponent(PV.page)}` : PV.publishId ? `publish_id=${PV.publishId}&page=${encodeURIComponent(PV.page)}` : `version=${PV.ver}&page=${encodeURIComponent(PV.page)}`) + (PV.template ? `&template=${encodeURIComponent(PV.template)}` : "");
    let html = await apiHtml(`/preview?${q}`);
    if (seq !== PV_SEQ) return;
    html = html.replace("</body>", `<script>document.addEventListener("click",function(e){var a=e.target.closest("a");if(!a)return;var h=a.getAttribute("href")||"";if(h.indexOf("/")===0){e.preventDefault();var p=h.split("#")[0];if(p.slice(-1)!=="/"&&p.indexOf(".")<0)p+="/";parent.postMessage({presenceNav:p},"*")}else if(h.indexOf("http")===0){e.preventDefault();window.open(h,"_blank","noopener")}});<\/script></body>`);
    pvWrite(html);
  } catch (err) {
    if (seq !== PV_SEQ) return;
    // a plain line and one Try again — never raw JSON, never "Proofing…" forever
    pvWrite(`<div style="font-family:Georgia,serif;color:#574d68;padding:56px 24px;text-align:center;max-width:420px;margin:0 auto;font-size:17px;line-height:1.6;font-style:italic">${esc(err && err.notHtml ? "We couldn’t load that page just now." : nice(err))}<p style="margin-top:18px"><button type="button" onclick="parent.postMessage({presenceRetry:1},'*')" style="font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-style:normal;color:#5b3fa0;background:#fff;border:1px solid #5b3fa0;border-radius:8px;padding:12px 18px;min-height:44px;cursor:pointer">Try again</button></p></div>`);
  }
}

// ══ Which section is which, for the Edit canvas ═══════════════════════════════
// Item 100: this also gave the Preview screen (#previewFrame) a hover toolbar of its
// own (Edit, ↑, ↓, Hide) and sent a click on a section off to edit it. Preview is a
// visitor's view now; the map and the actions below serve Edit mode's canvas.
//
// Mapping (G13, server-stamped): renderSiteBlocks stamps every block section
// with `data-dds-src` (its TRUE stored-list index — the render's own resolve
// provenance), `data-dds-sid` (the canonical G11 section id) + `data-dds-key`
// (its exact render key), and the templates stamp `data-dds-core` on core
// sections. The INDEX join reads data-dds-src directly: the sidecar's sids are
// computed over the STORED list while the stamps are over the RESOLVED list, so
// on a page where a resolve step changed the list (a linked section resolving
// in, a deleted-media/empty-reviews block dropping out) the per-type #N sids
// diverge and the sid join would hit the wrong same-type block. The /settings
// section_meta sidecar ({sid,key,src_index} per stored block) stays as the
// DEGRADE path — a render without src stamps (a stale deployed function) falls
// back to the sid join, and anything unstamped takes the core fallback below:
// chrome still appears, all editing routes through the panel.
const DDS_CORE_VIEW = { hero: "business", about: "business", offerings: "offerings", faqs: "faqs", testimonials: "testimonials" };
// sid → BLOCKS_WORK index for the page on the canvas, built ONLY from the
// server's section_meta sidecar. Rebuilt on every /settings response and every
// chrome injection; locally PERMUTED by dcMove's optimistic reorder (the same
// index math the save will confirm) so the tree stays correct mid-flight.
let DDS_SIDMAP = null;
// G13 fix: local remap over the DOM's data-dds-src stamps — null = identity.
// The canvas DOM only re-stamps on reload, so after ANY local list edit the
// stamped indices are stale against BLOCKS_WORK; every splice site (dcMove via
// dcPermuteIndex, delete / cut / duplicate / paste / add via
// dcShiftIndex) composes its shift into this map through dcComposeSrcMap, and
// dcInjectCanvas resets it when the fresh render (fresh stamps) lands.
// eeClassify applies it before bounds-check; -1 = that section was deleted.
let DDS_SRCMAP = null;
function ddsMetaFor(page) {
  const m = S.sectionMeta; if (!m) return null;
  return page ? (m.pages || {})[page] || null : m.blocks || null;
}
function ddsRebuildSidMap() {
  const meta = ddsMetaFor(DC_PAGE || "");
  if (!meta) { DDS_SIDMAP = null; return; }
  const map = {};
  meta.forEach((e) => { if (e && e.sid) map[e.sid] = e.src_index; });
  DDS_SIDMAP = map;
}
// ── actions (all REUSE the existing editor logic) ──
function eeEditBlock(bi, tab) {                  // open this one section's editor, on one of its tabs
  if (typeof bi === "number" && bi < 0) return;   // item 314: nothing was added (a built-in page)
  STK_ITEM = null;   // item 57: the section's card, not one of its blocks'
  closePreview(); go("design");
  if (!$("blocksCard")) mountBlocksCard();
  const blk = BLOCKS_WORK && BLOCKS_WORK[bi];
  if (blk && blk.type === "form") { openSettingsPanel("forms"); return; }   // forms have their own builder
  const def = blk && BLOCK_DEFS.find((d) => d.type === blk.type);
  BLOCK_SOLO = bi;
  INS_TAB = (tab === "style" || tab === "layout" || tab === "when") ? tab : "content";
  openSettingsPanel("section", (def && def.name) || "Section");
  BLOCK_FOCUS = bi; renderBlocksCard();          // consumes BLOCK_FOCUS → scroll + focus
  dcRevealAbove(bi);
}
// A phone's section card is half a screen (Figma 65:382): the section it edits is scrolled to
// just under the bar, so it stays in view above the card.
function dcRevealAbove(bi) {
  if (window.innerWidth > 760) return;
  try {
    const doc = dcFrameDoc(), main = doc && doc.getElementById("main"); if (!main) return;
    const hit = dcBlockSections(main).find((x) => x.bi === bi); if (!hit) return;
    const frame = $("designPreview").getBoundingClientRect(), card = $("settingsPanel");
    const room = card.offsetTop - frame.top;   // where the card's top rests (its layout box, not the sliding one), in the frame's terms
    const top = hit.el.getBoundingClientRect().top;
    if (top >= 8 && top <= room - 96) return;   // its top is already in view, with some of it showing
    doc.defaultView.scrollBy({ top: top - 12, behavior: pdReducedMotion() ? "auto" : "smooth" });
  } catch (_) {}
}
// Which editor a clicked section belongs to — G13: read the SERVER STAMPS.
// A block section carries data-dds-src (its TRUE stored-list index, render
// provenance) → that IS the BLOCKS_WORK index, remapped through DDS_SRCMAP
// while a local move awaits its reload. Without it (an old deployed function's
// render) the data-dds-sid → sidecar join is the fallback — correct except on
// a resolve-divergent page, which is exactly why src is primary. A core section
// carries data-dds-core → its panel tab + hide key. Anything unstamped (a stale
// render, structural chrome) takes today's fallback — the design studio panel —
// never a dead click.
function eeClassify(el) {
  const src = el.getAttribute && el.getAttribute("data-dds-src");
  if (src != null && /^\d+$/.test(src)) {
    let bi = parseInt(src, 10);
    if (DDS_SRCMAP && Object.prototype.hasOwnProperty.call(DDS_SRCMAP, bi)) bi = DDS_SRCMAP[bi];
    if (bi >= 0 && bi < (BLOCKS_WORK || []).length) return { kind: "block", bi: bi };
    // out of range (stale stamp vs the working list) → fall through to the sid join
  }
  const sid = el.getAttribute && el.getAttribute("data-dds-sid");
  if (sid) {
    const bi = DDS_SIDMAP && Object.prototype.hasOwnProperty.call(DDS_SIDMAP, sid) ? DDS_SIDMAP[sid] : -1;
    if (bi >= 0 && bi < (BLOCKS_WORK || []).length) return { kind: "block", bi: bi };
    return { kind: "core", view: "design", key: null };   // stamped but sidecar not loaded yet → panel
  }
  const core = el.getAttribute && el.getAttribute("data-dds-core");
  if (core) return { kind: "core", view: DDS_CORE_VIEW[core] || "design", key: Object.prototype.hasOwnProperty.call(DDS_CORE_VIEW, core) ? core : null };
  return { kind: "core", view: "design", key: null };   // unstamped → the structure studio
}
// Item 100: the Preview screen is a visitor's view. It used to carry its own hover
// toolbar (Edit, ↑, ↓, Hide) with a second move engine, and a click on a section left
// Preview to edit it. Editing lives in Edit mode's canvas alone.

/* ── the publish ritual (identical /changes + /publish + /publishes) ── */
// Slice B: the Page ▾ menu's "Publish later" deep-links INTO the ritual (it stays
// the single publish door) — openRitual({schedule:true}) scrolls to and opens the
// G5 schedule block once it renders. Plain calls (and the button's click Event)
// leave the flag off.
// Studio audit change 2 — the ritual speaks AS THE STUDIO when an operator is
// scoped into a client (?client= → the shell's context carries scope.name).
// Returns the client's name, or "" for the owner's own room (whose copy stays
// byte-identical — cms.spec pins it).
function scopedClientName() {
  try {
    if (!new URLSearchParams(location.search).get("client")) return "";
    const c = window.__ddsContext, sc = c && c.scope;
    return (sc && sc.name) ? String(sc.name) : "";
  } catch (_) { return ""; }
}
// Builder item 83: ?client= is also how someone with places in two businesses opens their second
// one. That is their own business, not a studio inside a client, so the editor speaks to its owner
// and shows the owner's own setup list, welcome and plan notice, as at their first one. The context
// says which, as the shell's ddsScopeInfo reads it: a scope is a studio inside a client, a business on
// the person's list is their own; else the businesses the shell remembers, else the address, as before.
function studioInClient() {
  const id = new URLSearchParams(location.search).get("client");
  if (!id) return false;
  const c = S.ctx || window.__ddsContext;
  if (c && c.scope && c.scope.site_id) return true;
  if (c && Array.isArray(c.businesses) && c.businesses.some((b) => b && b.site_id === id)) return false;
  return window.ddsScopeInfo && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? !!window.ddsScopeInfo() : true;   // the shell reads only a real site id
}
// "Marlow’s Kitchen’s" — a name already ending in s takes the bare apostrophe.
function possessive(name) { return /s$/i.test(name) ? name + "’" : name + "’s"; }
function openRitual(opts) {
  if (window.ddsLacks && window.ddsLacks("publish")) { openWaitNote(); return; }   // builder item 220: their seat can't publish

  // threaded as a PARAMETER, not module state: a one-shot flag could be consumed
  // by a stale in-flight loadRitual (open → Escape → reopen) or leak armed when
  // the /changes read fails. (#btnPublish passes its click Event — the === true
  // guard keeps that falsy.)
  lastFocus = document.activeElement;
  $("ritualWrap").classList.toggle("as-card", !!(opts && opts.card === true));   // from the bar: a card beside the page, the same words
  $("ritualWrap").classList.add("on"); document.body.style.overflow = "hidden";
  $("btnRitualBack").focus();
  loadRitual(!!(opts && opts.schedule === true));
  if (window.ddsHint) setTimeout(() => window.ddsHint("publish-atomic", "Publishing goes live all at once — never halfway — and every version is kept, so anything can come back."), 400);
}
// The publish page names what's holding things up, each with a way straight to it.
// `field` is validateSnapshot's path; an older function without blocker_list keeps
// the one-sentence fallback above.
function blockerTarget(field) {
  const [head, sub] = String(field || "").split(".");
  const view = { identity: "business", location: "business", locations: "business", redirects: "business", offerings: "offerings", faqs: "faqs", testimonials: "testimonials", posts: "updates", copied: "design" }[head] || "business";
  let focus = null;
  if (head === "identity" && sub) focus = "f-" + sub;
  else if (head === "location") focus = sub === "hours" ? "hoursGrid" : "f-" + (sub || "address_line1");
  return { view, focus };
}
function renderBlockerList(list) {
  const rows = Array.isArray(list) ? list.filter((b) => b && b.message) : [];
  if (!rows.length) return;
  const seen = new Set();
  const uniq = rows.filter((b) => { if (seen.has(b.message)) return false; seen.add(b.message); return true; });
  const box = $("ritBlockers"); box.innerHTML = "";
  box.appendChild(el("p", "blockprose", uniq.length === 1 ? "One thing to finish before this can publish:" : `${uniq.length} things to finish before this can publish:`));
  const ul = el("ul", "blocklist");
  uniq.forEach((b) => {
    const copied = b.field === "copied", studio = copied && studioInClient();
    // items 145, 196 and 216: Keep is the studio's (below); a client is told who can keep them
    const li = el("li"); li.appendChild(ritMark(false)); li.appendChild(el("span", "rit-msg", copied && !studio ? b.message + " Or ask your studio to keep them as they are." : b.message));
    const fix = el("button", "textact", copied ? "Change them" : "Fix"); fix.type = "button";
    fix.setAttribute("aria-label", (copied ? "Change them: " : "Fix: ") + b.message);
    fix.addEventListener("click", () => {
      if (blockerOpen(b)) return;   // item 196: the first copied section, or a page's missing password
      const t = copied ? { view: "design", focus: null } : blockerTarget(b.field);   // item 216: copied sections are changed on the page
      closeRitual(); go(t.view);
      if (t.focus) setTimeout(() => {
        const n = $(t.focus); if (!n) return;
        n.scrollIntoView({ block: "center" });
        const tgt = n.matches("input,textarea,select") ? n : n.querySelector("input,textarea,select,button");
        if (tgt) tgt.focus();
      }, 80);
    });
    li.appendChild(fix);
    // items 145 and 216: the studio has looked at what a template, Duplicate or a saved page copied, and it may publish as it is
    if (studio && S.site) {
      const keep = el("button", "textact", "Keep them as they are"); keep.type = "button";
      keep.addEventListener("click", async () => {
        if (!(await askYes("Keep the copied sections and photos as they are? They can then publish without changes.", { ok: "Keep them" }))) return;
        try { await api("POST", "/agency/sites/" + encodeURIComponent(S.site.id) + "/copied", { keep: true }); toast("Kept as they are. They can publish now."); loadRitual(false); }
        catch (err) { toast(nice(err), true); }
      });
      li.appendChild(keep);
    }
    ul.appendChild(li);
  });
  box.appendChild(ul);
}
// Item 196 (review finding 32): the copied-words item's Fix opened Business details, which has
// nothing to do with copied sections; it opens the first of them now. A page's missing password
// opens that page's settings, where it is set.
function blockerOpen(b) {
  const f = String(b.field || "");
  if (f === "copied" && b.at && Number.isInteger(b.at.index)) {
    const slug = String(b.at.page || ""), i = b.at.index;
    closeRitual(); go("design");
    Promise.resolve(slug === DC_PAGE || dcSwitchPage(slug)).then((ok) => {
      if (!ok) return;
      if (!BLOCKS_WORK) BLOCKS_WORK = currentBlocks();   // Edit opened just now: its list, as the section card would load it
      if (BLOCKS_WORK[i]) eeEditBlock(i);
    });
    return true;
  }
  if (f.indexOf("page_lock.") === 0) {
    closeRitual(); go("design");
    setTimeout(() => pgOpenSettings({ href: "/" + f.slice(10) + "/" }), 80);
    return true;
  }
  return false;
}
// the checklist's marks: amber for a real blocker, green for what is in place (item 35)
function ritMark(ok) { const i = el("i", "rit-ck " + (ok ? "ok" : "bad")); i.innerHTML = uiIcon(ok ? "check" : "x", 12); i.setAttribute("aria-hidden", "true"); return i; }
function renderReadyList() {
  const box = $("ritBlockers"); if (!box) return;
  box.appendChild(el("div", "rit-h rit-ok", "Before it goes live"));
  const ul = el("ul", "blocklist rit-ok");
  const li = el("li", "ok"); li.appendChild(ritMark(true)); li.appendChild(el("span", "rit-msg", "Everything needed is in place"));
  ul.appendChild(li); box.appendChild(ul);
}
// the live row: where the site is, and when it last went up
function renderRitualLive() {
  const lv = $("ritLive"); if (!lv) return;
  const u = typeof siteLiveUrl === "function" ? siteLiveUrl() : null, at = S.site && S.site.last_published_at;
  if (!u || !at) { lv.hidden = true; return; }
  lv.textContent = ""; lv.appendChild(el("i"));
  lv.appendChild(document.createTextNode("Live · " + u.replace(/^https?:\/\//, "") + " · " + new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" })));
  lv.hidden = false;
}
function closeRitual() { $("ritualWrap").classList.remove("on"); $("ritualWrap").classList.remove("as-card"); document.body.style.overflow = ""; if (lastFocus && lastFocus.focus) { lastFocus.focus(); lastFocus = null; } loadToday(); }
$("btnRitualBack").addEventListener("click", closeRitual);
$("btnPublish").addEventListener("click", openRitual);
async function loadRitual(toSchedule) {
  $("ritTitle").textContent = "One moment.";
  $("ritSub").textContent = "Reading over your draft…";
  $("ritBody").innerHTML = `<div class="shimmer"></div>`; $("ritBlockers").innerHTML = ""; $("ritActions").innerHTML = "";
  try {
    // A save can land while this is out. Read again: what's reviewed should include it, and
    // the version from before it would refuse the next save as someone else's change.
    // Publish names the version reviewed here (If-Match), and only Publish does: it can hold
    // someone else's change the page hasn't loaded, so the page's next save doesn't take it.
    // What was just typed, and any save still waiting in line, goes in first: otherwise the
    // review leaves it out, and Publish names a version that save is about to move.
    await dcSavePendingEdits();
    // Item 78: so are an hours change and the closed note still in their 0.6s wait, and any
    // settings write in line; without them the review left the hours out, or Publish named
    // a version they were about to move and was refused as someone else's change.
    await Promise.all([debounceFlush("hours"), debounceFlush("closednote"), SETTINGS_WRITES]);
    await DRAFT_LINE;
    let c, answered;
    do { answered = WRITES_ANSWERED; c = (await api("GET", "/changes")).data; } while (answered !== WRITES_ANSWERED);
    S.changes = c; REVIEWED = (c && c.draft_hash) || null;
    if (REVIEWED && !S.draftHash && !DRAFT_WRITES_OUT) S.draftHash = REVIEWED;   // as readChanges, when the page holds none
    renderPublishButton();
    renderRitualLive();
    // Item 214: while publishing is locked, the card says so and why, instead of offering Publish
    const lock = await readPublishLock();
    if (lock && lock.on) { renderRitualLocked(c, lock); return; }
    const body = $("ritBody"); body.innerHTML = "";
    const forClient = scopedClientName();
    if (forClient) {
      // the operator's voice: THEIR site, THEIR customers, YOUR decision
      if (c.first_publish) {
        $("ritTitle").textContent = `This is the moment ${possessive(forClient)} website goes live.`;
        $("ritSub").textContent = "Here’s what goes up — read it the way their customers will:";
      } else if (c.count === 0) {
        $("ritTitle").textContent = `${forClient} is up to date.`;
        $("ritSub").textContent = "Every word in the draft is already on their website. There’s nothing waiting.";
      } else {
        $("ritTitle").textContent = `Here’s what changes on ${possessive(forClient)} site`;
        $("ritSub").textContent = `${c.count === 1 ? "One change" : c.count + " changes"}, read exactly as their customers will experience ${c.count === 1 ? "it" : "them"}. Their live site stays as it is until you decide.`;
      }
    } else if (c.first_publish) {
      $("ritTitle").textContent = "This is the moment your website goes live.";
      $("ritSub").textContent = "Here’s what goes up — read it the way customers will:";
    } else if (c.count === 0) {
      $("ritTitle").textContent = "You’re up to date.";
      $("ritSub").textContent = "Every word you’ve written is already on your website. There’s nothing waiting.";
    } else {
      $("ritTitle").textContent = "Here’s what changes.";
      $("ritSub").textContent = `${c.count === 1 ? "One change" : c.count + " changes"}, read exactly as customers will experience ${c.count === 1 ? "it" : "them"}. Your live site stays as it is until the moment you decide.`;
    }
    if (c.count > 0 || c.first_publish) {
      body.appendChild(el("div", "rit-h", "What changes"));
      const j = el("div", "journal");
      c.changes.forEach((ch) => {
        const row = el("div", "jrow");
        row.appendChild(el("span", "jsec", hbCap(sectionWord(ch.section))));
        row.appendChild(el("span", null, ch.sentence));
        j.appendChild(row);
      });
      body.appendChild(j);
    }
    const acts = $("ritActions"); acts.innerHTML = "";
    if (c.blockers > 0) {
      $("ritBlockers").innerHTML = `<p class="blockprose">Publishing waits until ${c.blockers === 1 ? "one small thing is" : c.blockers + " small things are"} complete — usually a missing business fact. <a class="textact" href="#" id="ritFix">Look in Business</a> — your draft is safe, and this page will be ready when you are.</p>`;
      $("ritFix").addEventListener("click", (e) => { e.preventDefault(); closeRitual(); go("business"); });
      renderBlockerList(c.blocker_list);
    } else if (c.count > 0 || c.first_publish) {
      $("ritBlockers").innerHTML = "";
      renderReadyList();
      ueRitualRow();   // item 150: how many things are left to fix; it never stops a publish
      const btn = el("button", "pubbtn", c.first_publish ? "Publish my site" : `Publish ${c.count === 1 ? "this change" : "these " + c.count + " changes"}`);
      btn.addEventListener("click", () => runPublish(btn, c.first_publish));
      acts.appendChild(btn);
      const ny = el("button", "notyet", "Not yet — keep them in the draft");
      ny.addEventListener("click", closeRitual);
      acts.appendChild(ny);
      if ($("ritualWrap").classList.contains("as-card")) {   // the card keeps the page menu's draft link at hand
        const share = el("button", "notyet", "Share a draft link"); share.type = "button"; share.title = "Copy a private, expiring link to this draft — no sign-in needed to view";
        share.addEventListener("click", () => shareDraftLink());
        acts.appendChild(share);
      }
      const promise = el("p", null, "Publishing replaces your live site all at once — never partially, never halfway. Every version is kept, and any of them can come back.");
      promise.style.cssText = "font-family:var(--serif);font-style:italic;font-size:12.5px;color:var(--ink-2);text-align:center;margin-top:22px;line-height:1.7";
      acts.appendChild(promise);
    }
    // G5: pending scheduled changes (+ "publish later" when publishable)
    renderRitualSchedule(acts, c.blockers === 0 && (c.count > 0 || c.first_publish), toSchedule === true);
  } catch (err) {
    $("ritSub").textContent = nice(err);
  }
}
function pipeHtml(stage) { // stage: 0 sealing, 1 deploying, 2 live, -1 failed at deploy
  const steps = [
    ["Snapshot sealed — this exact version is kept forever", stage >= 1 ? "done" : "run"],
    ["Rendered — every page drawn fresh from your words", stage >= 1 ? "done" : "wait"],
    ["Carrying it to your website…", stage === 1 ? "run" : stage >= 2 ? "done" : "wait"],
    ["Live", stage >= 2 ? "done" : "wait"],
  ];
  if (stage === -1) steps[2] = ["The carry didn’t complete — your live site is unchanged", "wait"];
  return `<div class="pipe">` + steps.map(([t, k]) => `<div class="pstep ${k}"><i>${k === "done" ? uiIcon("check", 11) : ""}</i>${t}</div>`).join("") + `</div>`;
}
async function runPublish(btn, firstPublish) {
  btn.disabled = true; btn.textContent = "Publishing…";
  $("ritBody").innerHTML = pipeHtml(1);
  $("ritSub").textContent = "All at once, never halfway — your site is never partially updated.";
  try {
    const r = await api("POST", "/publish", undefined, REVIEWED || S.draftHash);
    if (r.data.status === "live") { showReceipt(firstPublish); warnWaitingPublish(); return; }
    pollPublish(0, firstPublish);
  } catch (err) {
    $("ritBody").innerHTML = pipeHtml(-1);
    $("ritTitle").textContent = "That didn’t go through.";
    // Item 196 (review finding 31): the server says why (publish again in about N seconds, the site
    // is paused, another publish is running), and that shows now. Try again waits as long as it
    // was asked to, and isn't offered when only the studio can change the answer.
    const code = (err && err.stale) ? "stale_draft" : (err && err.body && err.body.error) || "";
    const why = code === "stale_draft" ? "Your draft changed since you looked it over. Take another look, then publish."
      : code && code !== "validation_failed" && err.body && err.body.message ? nice(err) : "";
    $("ritSub").textContent = why ? why + " Your live site is unchanged." : "Your live site is unchanged and nothing was lost. The version is kept — try again whenever you’re ready.";
    if (err.body && err.body.fields) {
      $("ritBlockers").innerHTML = `<p class="blockprose">${(err.body.fields || []).map((f) => esc(typeof f === "string" ? f : f.message || "")).join("<br>")}</p>`;
    }
    $("ritActions").innerHTML = "";
    if (code !== "site_paused" && code !== "lifecycle_blocked") {
      const retry = el("button", "pubbtn", code === "stale_draft" ? "Take another look" : "Try again");
      retry.addEventListener("click", () => loadRitual());
      const wait = code === "cooldown" ? Math.min(120, Math.max(1, Number(err.body.retry_after) || 60)) : 0;
      if (wait) { retry.disabled = true; setTimeout(() => { retry.disabled = false; }, wait * 1000); }
      $("ritActions").appendChild(retry);
    }
    const ny = el("button", "notyet", "Back to your website");
    ny.addEventListener("click", closeRitual);
    $("ritActions").appendChild(ny);
  }
}
// Builder item 249: a publish set for later holds the site as it was when it was scheduled. Once
// something newer has gone live, sending it would put the older site back (the scheduler refuses
// that at the set time), so the moment a publish goes live over a waiting one, ask: update it to
// what's live now, or cancel it? Escape leaves it alone. Updating cancels the old row and schedules
// today's draft for the same time, with the same note.
async function warnWaitingPublish() {
  let waiting = [];
  try { waiting = (((await api("GET", "/schedule")).data || {}).scheduled || []).filter((s) => s.kind === "publish"); } catch (_) { return; }
  for (const s of waiting) {
    const when = new Date(s.scheduled_for).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    const update = await window.ddsConfirm({ title: "A publish is still waiting for " + when, text: "It holds your site as it was when you scheduled it, which is older than what just went live. Update it to today’s version, or cancel it?", yes: "Update it", no: "Cancel it" });
    try {
      await api("POST", `/schedule/${s.id}/cancel`);
      if (update) { await api("POST", "/schedule", { scheduled_for: s.scheduled_for, kind: "publish", note: s.summary && s.summary !== "Scheduled publish" ? s.summary : "" }); toast("Updated — today’s version publishes at " + when + "."); }
      else toast("Canceled — nothing will happen at that time.");
    } catch (err) { toast(nice(err), true); }
  }
}
async function pollPublish(n, firstPublish) {
  if (n > 30) { $("ritSub").textContent = "This is taking longer than usual — it’s still working, and Versions will show how it ends. You can safely step away."; return; }
  await new Promise((r) => setTimeout(r, 4000));
  try {
    const pubs = (await api("GET", "/publishes")).data;
    const top = pubs[0];
    if (top && top.status === "live") { showReceipt(firstPublish); warnWaitingPublish(); return; }
    if (top && top.status === "failed") {
      $("ritBody").innerHTML = pipeHtml(-1);
      $("ritTitle").textContent = "That didn’t go through.";
      $("ritSub").textContent = "Your live site is unchanged and nothing was lost. We’ve been notified — try again in a minute.";
      $("ritActions").innerHTML = "";
      const retry = el("button", "pubbtn", "Try again");
      retry.addEventListener("click", () => loadRitual());
      $("ritActions").appendChild(retry);
      return;
    }
  } catch { /* keep polling */ }
  pollPublish(n + 1, firstPublish);
}
function showReceipt(firstPublish) {
  const count = S.changes ? S.changes.count : 0;
  const now = new Date();
  if (S.site) S.site.last_published_at = now.toISOString();   // the welcome list's last step and the status badge read this
  S.previewStatus = null;
  const name = (S.identity && S.identity.business_name) || "Your business";
  const forClient = scopedClientName();
  $("ritTitle").textContent = ""; $("ritSub").textContent = ""; $("ritBlockers").innerHTML = "";
  // the receipt: the owner's own publish keeps its words ("every word came from
  // you"); an operator's publish is honest about whose hand it was — published
  // FOR the client, their words untouched by the claim.
  const stampLine = forClient ? `Published for ${esc(forClient)}` : (firstPublish ? "You’re on the internet." : "Published");
  const keptLine = forClient
    ? (firstPublish ? esc(forClient) + " has a home now.<br>This first version is kept safe, always." : "This version is kept safe, always.")
    : (firstPublish
      ? esc(name) + " has a home now — and every word of it came from you.<br>This first version is kept safe, always."
      : "Every word on your site came from you.<br>This version is kept safe, always.");
  $("ritBody").innerHTML = `
    <div class="receipt">
      <div class="stamp">${uiIcon("check", 22)}</div>
      <div class="rp">${stampLine}</div>
      <div class="rd">${now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${count && !firstPublish ? ` · ${count} change${count > 1 ? "s" : ""}` : ""}</div>
      <div class="rl">${keptLine}</div>
    </div>`;
  $("ritActions").innerHTML = "";
  // The peak moment needs a DOOR: see the live site, share the link. Without
  // this the receipt says "you're on the internet" and offers no way to visit.
  const liveUrl = S.site && (S.site.custom_domain ? `https://${S.site.custom_domain}` : (S.site.netlify_site_id ? `https://presence-${String(S.site.id).replace(/-/g, "").slice(0, 12)}.netlify.app` : null));
  if (liveUrl) {
    const see = document.createElement("a");
    see.href = liveUrl; see.target = "_blank"; see.rel = "noopener";
    see.textContent = "See your live site →";
    see.style.cssText = "display:inline-block;margin-top:26px;margin-right:10px;background:var(--plum,#5b3fa0);color:var(--fill-ink,#fff);font-weight:600;padding:11px 22px;border-radius:999px;text-decoration:none";
    $("ritActions").appendChild(see);
    const cp = el("button", "notyet", "Copy the link");
    cp.style.marginTop = "26px"; cp.style.marginRight = "10px";
    cp.addEventListener("click", () => { try { navigator.clipboard.writeText(liveUrl).then(() => toast("Link copied — share it anywhere.")); } catch (_) { toast(liveUrl); } });
    $("ritActions").appendChild(cp);
  }
  const done = el("button", "notyet", "Back to your website");
  done.style.marginTop = "26px";
  done.addEventListener("click", closeRitual);
  $("ritActions").appendChild(done);
  scheduleChangesRefresh();
}

/* ── G5: publish later — the ordinary publish flow gains a "publish at" (and an
   optional "take offline at") on the EXISTING /schedule machinery (the same
   table + cron that runs scheduled launches). The draft is frozen at schedule
   time, so what you reviewed is exactly what goes up. ── */
function dtLocalDefault(hoursFromNow) {
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date(Date.now() + (hoursFromNow || 24) * 3600000); d.setMinutes(0, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseDtLocal(v) { if (!v) return null; const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
async function renderRitualSchedule(host, publishable, toSchedule) {
  const wrap = el("div"); wrap.id = "ritSchedule"; wrap.style.cssText = "margin-top:26px;text-align:center";
  host.appendChild(wrap);
  // pending scheduled changes (list + cancel) — honest view of what will happen on its own
  let pending = [];
  try { pending = ((await api("GET", "/schedule")).data || {}).scheduled || []; } catch (_) { /* keep the ritual calm */ }
  if (pending.length) {
    const box = el("div"); box.style.cssText = "margin:0 auto 14px;max-width:440px;text-align:left";
    box.appendChild(Object.assign(el("div", null, "Scheduled — will happen on its own"), { style: "font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-2,#666);margin-bottom:6px" }));
    pending.forEach((s) => {
      const row = el("div"); row.style.cssText = "display:flex;align-items:center;gap:10px;border:1px solid var(--line,#e5e5e5);border-radius:10px;padding:8px 12px;margin-top:6px";
      const kindWord = s.kind === "offline" ? "Take the site offline" : s.kind === "revert" ? "Return to an earlier version" : "Publish";
      const t = el("div"); t.style.cssText = "flex:1;font-size:12.5px";
      t.innerHTML = `<strong>${esc(kindWord)}</strong> · ${esc(new Date(s.scheduled_for).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }))}${s.summary ? `<br><span style="color:var(--ink-2,#666)">${esc(s.summary)}</span>` : ""}`;
      row.appendChild(t);
      const x = el("button", null, "Cancel"); x.type = "button";
      x.style.cssText = "font:inherit;font-size:12px;padding:4px 12px;border-radius:999px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
      x.addEventListener("click", async () => { try { await api("POST", `/schedule/${s.id}/cancel`); toast("Canceled — nothing will happen at that time."); loadRitual(); } catch (err) { toast(nice(err), true); } });
      row.appendChild(x);
      box.appendChild(row);
    });
    wrap.appendChild(box);
  }
  if (!publishable) {
    // the Page ▾ deep-link must always land SOMEWHERE honest: with nothing
    // pending and nothing publishable, say why the picker isn't here instead
    // of silently dropping the user into a generic ritual.
    if (toSchedule && !pending.length) {
      wrap.appendChild(Object.assign(el("div", "hint", S.changes && S.changes.blockers > 0
        ? "Scheduling opens once the item above is taken care of."
        : "Nothing is scheduled, and there's nothing new to publish — make an edit first, then pick a time here."),
        { style: "max-width:380px;margin:0 auto" }));
    }
    if (toSchedule) { try { wrap.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {} }
    return;
  }
  // The schedule panel is always on the page (Oct 2026 audit, gap 1): from the
  // menu, Website → Publish → Schedule it is three clicks. It RESTS until it
  // holds focus (Schedule it outlined, publish-now the filled button) and ARMS
  // while it does (Schedule it filled, publish-now steps back) — one filled
  // button at every moment. #schedule / "Publish later" open it armed, with
  // the date field focused.
  const panel = el("div", "sched-panel"); panel.style.cssText = "margin:18px auto 0;max-width:440px;text-align:left;border:1px solid var(--line,#e5e5e5);border-radius:12px;padding:14px 16px";
  panel.appendChild(Object.assign(el("div", null, "Or publish later"), { style: "font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink-2,#666);margin-bottom:10px" }));
  const mkRow = (labelText, defValue, withToggle) => {
    const r = el("div"); r.style.cssText = "margin-top:" + (withToggle ? "12px" : "0");
    const lab = el("label", null, labelText); lab.style.cssText = "display:block;font-size:12px;font-weight:600;margin-bottom:4px";
    const inp = el("input"); inp.type = "datetime-local"; inp.value = defValue;
    inp.id = withToggle ? "schedOffAt" : "schedAt"; lab.htmlFor = inp.id;   // a real label↔field pair (screen readers name the field)
    inp.style.cssText = "font:inherit;font-size:12.5px;padding:6px 9px;border-radius:8px;border:1px solid var(--line,#ddd);width:100%;box-sizing:border-box";
    r.appendChild(lab); r.appendChild(inp); panel.appendChild(r);
    return { row: r, inp };
  };
  const pub = mkRow("Publish these changes at", dtLocalDefault(24), false);
  panel.appendChild(Object.assign(el("div", null, "Your draft is frozen the moment you schedule — exactly what you reviewed goes up, even if you keep editing."), { style: "font-size:12px;color:var(--ink-2,#666);margin-top:6px;line-height:1.6" }));
  // the optional "unpublish at" leg — same table, same cron, kind=offline
  const offWrap = el("div"); offWrap.style.marginTop = "12px";
  const offToggle = el("label"); offToggle.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer";
  const offCb = el("input"); offCb.type = "checkbox";
  offToggle.appendChild(offCb); offToggle.appendChild(document.createTextNode("Also take the site offline later (optional)"));
  offWrap.appendChild(offToggle); panel.appendChild(offWrap);
  let off = null;
  offCb.addEventListener("change", () => {
    if (offCb.checked && !off) {
      off = mkRow("Take the site offline at", dtLocalDefault(24 * 8), true);
      off.row.appendChild(Object.assign(el("div", null, "Visitors will see a simple “temporarily offline” page from then on. Nothing is deleted — publishing brings everything back."), { style: "font-size:12px;color:var(--ink-2,#666);margin-top:4px;line-height:1.6" }));
    } else if (off) { off.row.style.display = offCb.checked ? "" : "none"; }
  });
  // optional note (it was on the retired Scheduled page) — POST /schedule takes it as before
  const noteRow = el("div"); noteRow.style.marginTop = "12px";
  const noteLab = el("label", null, "A note for yourself (optional)"); noteLab.style.cssText = "display:block;font-size:12px;font-weight:600;margin-bottom:4px";
  const noteIn = el("input"); noteIn.type = "text"; noteIn.maxLength = 200; noteIn.placeholder = "e.g. Holiday hours"; noteIn.id = "schedNote";
  noteIn.style.cssText = "font:inherit;font-size:12.5px;padding:6px 9px;border-radius:8px;border:1px solid var(--line,#ddd);width:100%;box-sizing:border-box";
  noteLab.htmlFor = "schedNote"; noteRow.appendChild(noteLab); noteRow.appendChild(noteIn); panel.appendChild(noteRow);
  const btns = el("div"); btns.style.cssText = "display:flex;gap:8px;margin-top:14px";
  const okb = el("button", "schedgo", "Schedule it"); okb.type = "button";
  let pubScheduled = false;
  // one filled button per screen: while the panel holds focus, scheduling is the
  // job on screen (Schedule it filled, publish-now quiet); when focus leaves it
  // for something else, publish-now is the filled button again. pointerdown
  // covers WebKit, which does not focus a clicked button.
  const pubNow = document.querySelector("#ritActions .pubbtn");
  const arm = () => { panel.classList.add("armed"); if (pubNow) pubNow.classList.add("quiet"); };
  const rest = () => { panel.classList.remove("armed"); if (pubNow) pubNow.classList.remove("quiet"); };
  panel.addEventListener("focusin", arm);
  panel.addEventListener("pointerdown", arm);
  panel.addEventListener("focusout", (e) => { if (e.relatedTarget && !panel.contains(e.relatedTarget)) rest(); });
  if (pubNow) pubNow.addEventListener("pointerdown", rest);
  okb.addEventListener("click", async () => {
    const when = parseDtLocal(pub.inp.value);
    if (!when) { toast("Pick a date and time.", true); return; }
    if (when.getTime() <= Date.now()) { toast("Pick a time in the future.", true); return; }
    let offWhen = null;
    if (offCb.checked && off && off.row.style.display !== "none") {
      offWhen = parseDtLocal(off.inp.value);
      if (!offWhen) { toast("Pick a time for going offline, or untick it.", true); return; }
      if (offWhen.getTime() <= when.getTime()) { toast("The offline time needs to be after the publish time.", true); return; }
    }
    okb.disabled = true; okb.textContent = "Scheduling…";
    try {
      // builder item 249: once the publish is scheduled, a second press (after the offline leg
      // failed) sets only the offline time, never a second publish
      if (!pubScheduled) { await api("POST", "/schedule", { scheduled_for: when.toISOString(), kind: "publish", note: noteIn.value.trim() }); pubScheduled = true; }
      if (offWhen) await api("POST", "/schedule", { scheduled_for: offWhen.toISOString(), kind: "offline" });
      toast(offWhen ? "Scheduled — it publishes, then comes down, on its own." : "Scheduled — it publishes on its own.");
      loadRitual();
    } catch (err) {
      okb.disabled = false; okb.textContent = pubScheduled ? "Set the offline time" : "Schedule it";
      if (pubScheduled) { pub.inp.disabled = true; toast("The publish is scheduled. The offline time didn’t save — try it again, or untick it.", true); }
      else toast(nice(err), true);
    }
  });
  btns.appendChild(okb); panel.appendChild(btns);
  wrap.appendChild(panel);
  // #schedule / Page ▾ → "Publish later": land ON the panel, armed, ready to pick
  if (toSchedule) { try { wrap.scrollIntoView({ behavior: "smooth", block: "center" }); } catch (_) {} arm(); pub.inp.focus(); }
}

/* ── G6: share the draft — one tap mints a signed, expiring, read-only link to
   the current draft (captured into the private preview through the one preview
   machinery) and copies it. No sign-in needed to view; it expires on its own. ── */
let SHARE_DRAFT_BUSY = false;   // slice B: the dc-bar button is gone — this guard is the double-fire protection now
// one private link to the draft as it stands now: read-only, no sign-in, 7 days
async function mintDraftLink() {
  const r = (await api("POST", "/preview/share-link", { capture: true, ttl_seconds: 7 * 86400 })).data;
  return { url: r.url, until: r.expires_at ? new Date(r.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "" };
}
async function shareDraftLink() {
  if (SHARE_DRAFT_BUSY) return;
  SHARE_DRAFT_BUSY = true;
  toast("Preparing your draft link…");   // the menu closes on click — say work is happening
  try {
    const { url, until } = await mintDraftLink();
    let copied = false;
    try { await navigator.clipboard.writeText(url); copied = true; } catch (_) { /* clipboard can be blocked */ }
    if (copied) toast(`Draft link copied — read-only, works until ${until}. Text it to anyone.`);
    else { askText(`Your read-only draft link, until ${until}. Copy it:`, { value: url, ok: "Done" }); }   // the clipboard was refused: the link, selected, to copy by hand
  } catch (err) { toast(nice(err), true); }
  SHARE_DRAFT_BUSY = false;
}

/* ── Item 158: open the draft on your phone. A phone frame on a laptop is not a phone: Preview's
   "On my phone" (and the Page menu's "Open on my phone…") shows the same private link as a code
   the phone's camera opens (qr.js draws it), so the draft opens in the phone's own browser the
   way a visitor would see it. On a phone there is nothing to scan: the button opens the link in
   a new tab. The link shows the draft as it was when the code was made, so the card says to
   press the button again after more changes. ── */
const onAPhone = () => window.matchMedia("(max-width: 760px) and (pointer: coarse)").matches;
let QR_LOAD = null;
function loadQr() {
  if (window.DDSQR) return Promise.resolve(window.DDSQR);
  if (!QR_LOAD) QR_LOAD = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "/qr.js?v=1";   // bump ?v= whenever qr.js changes
    s.onload = () => window.DDSQR ? res(window.DDSQR) : rej(new Error("missing"));
    s.onerror = () => rej(new Error("load"));
    document.head.appendChild(s);
  }).catch((e) => { QR_LOAD = null; throw e; });   // a failed load can be tried again
  return QR_LOAD;
}
let PHONE_OPEN = false;
async function openOnPhone() {
  if (PHONE_OPEN) return;
  if (onAPhone()) {
    const tab = window.open("", "_blank");   // opened while the press still counts, so the phone's browser allows it
    try {
      const { url } = await mintDraftLink();
      if (tab) { try { tab.opener = null; } catch (_) {} tab.location.href = url; return; }
    } catch (err) { if (tab) tab.close(); toast(nice(err), true); return; }
    // the browser said no to a new tab: fall through to the card, whose link is a plain one to tap
  }
  PHONE_OPEN = true;
  const back = document.activeElement;
  const dlg = el("dialog", "op-sheet"); dlg.setAttribute("aria-labelledby", "opTitle");
  const head = el("div", "op-head"), hx = el("div"), h = el("h2", null, "Open it on your phone"); h.id = "opTitle";
  hx.append(h, el("p", null, onAPhone() ? "Your draft, in your browser, the way a visitor would see it." : "Point your phone’s camera at the code."));
  const x = el("button", "op-x"); x.type = "button"; x.setAttribute("aria-label", "Close"); x.innerHTML = uiIcon("x", 18);
  head.append(hx, x);
  const box = el("div", "op-code"); box.appendChild(el("p", "op-wait", "Making your link…"));
  const what = el("p", "op-what", "Your draft opens on the phone the way a visitor would see it, as a page you can scroll and tap. After more changes, press On my phone here again and reload the page there.");
  const note = el("p", "op-note"); note.hidden = true;
  const acts = el("div", "op-acts");
  const copy = el("button", "op-copy"); copy.type = "button"; copy.disabled = true; copy.innerHTML = uiIcon("copy", 16) + "<span>Copy the link</span>";
  const done = el("button", "op-done", "Done"); done.type = "button";
  acts.append(copy, done);
  dlg.append(head, box, what, note, acts);
  document.body.appendChild(dlg);
  let shut = false;
  const close = () => { if (shut) return; shut = true; PHONE_OPEN = false; try { dlg.close(); } catch (_) {} dlg.remove(); if (back && back.isConnected) { try { back.focus({ preventScroll: true }); } catch (_) {} } };
  x.addEventListener("click", close); done.addEventListener("click", close);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  dlg.showModal(); done.focus();
  const make = async () => {
    box.textContent = ""; box.appendChild(el("p", "op-wait", "Making your link…")); copy.disabled = true;
    try {
      const [link, Q] = await Promise.all([mintDraftLink(), onAPhone() ? Promise.resolve(null) : loadQr()]);
      if (shut) return;
      box.textContent = "";
      if (Q) box.innerHTML = Q.svg(link.url, "A code that opens your draft on a phone");
      else { const a = el("a", "op-done op-open", "Open in my browser"); a.href = link.url; a.target = "_blank"; a.rel = "noopener"; box.appendChild(a); }
      note.textContent = `It’s a private link to your draft, not your live site: read-only, no sign-in, and it works until ${link.until}. Anyone with the link can see the draft.`;
      note.hidden = false; copy.disabled = false;
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(link.url); toast("Link copied"); }
        catch (_) { askText("Copy the link to your draft:", { value: link.url, ok: "Done" }); }
      };
    } catch (err) {
      if (shut) return;
      box.textContent = "";
      const p = el("p", "op-err", nice(err)); p.setAttribute("role", "alert");
      const again = el("button", "op-copy", "Try again"); again.type = "button"; again.addEventListener("click", make);
      box.append(p, again);
    }
  };
  make();
}
(function onPhoneButton() {
  const b = $("btnOnPhone"); if (!b) return;
  const paint = () => { const ph = onAPhone(); b.innerHTML = uiIcon(ph ? "share" : "qr", 16) + "<span></span>"; b.lastChild.textContent = ph ? "Open in my browser" : "On my phone"; };
  queueMicrotask(paint);   // its icon comes from BI_PATHS, set further down this script
  try { window.matchMedia("(max-width: 760px) and (pointer: coarse)").addEventListener("change", paint); } catch (_) {}
  b.addEventListener("click", () => openOnPhone());
})();

/* ── history journal (identical /publishes + /restore-to-draft) ── */
// FD-T7: Launches — stage a redesign as a named release, preview/approve, then go
// live in one step (all through the existing publish pipeline). Live keeps running.
async function renderLaunches() {
  const box = $("launchBox"); if (!box) return;
  let launches = [];
  try { launches = (await api("GET", "/launches")).data || []; } catch (_) { box.innerHTML = ""; return; }
  if (!Array.isArray(launches)) launches = [];
  box.innerHTML = "";
  const card = el("div", "field"); card.style.marginBottom = "18px";
  card.appendChild(el("label", null, "Launches"));
  card.appendChild(el("div", "hint", "Stage a redesign as a named launch, preview and approve it, then go live in one step. Your current site keeps running until you launch."));
  const stage = el("button", null, "Stage a launch from your current draft"); stage.type = "button";
  stage.style.cssText = "font:inherit;font-size:12.5px;margin:8px 0;padding:7px 14px;border-radius:999px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  stage.addEventListener("click", async () => {
    const name = await askText("Name this launch", { placeholder: "e.g. Spring refresh", ok: "Stage" });
    if (name === null) return;
    try { await api("POST", "/launches", { name }); toast("Launch staged — preview and approve it below"); renderLaunches(); }
    catch (err) { toast(nice(err), true); }
  });
  card.appendChild(stage);
  const act = async (path, okmsg, body) => { try { await api("POST", path, body || {}); toast(okmsg); renderLaunches(); scheduleChangesRefresh(); } catch (err) { toast(nice(err), true); } };
  launches.filter((l) => l.status !== "canceled" && l.status !== "rolled_back" && l.status !== "checkpoint").forEach((l) => {
    const row = el("div"); row.style.cssText = "border:1px solid var(--line,#e5e5e5);border-radius:10px;padding:10px 12px;margin-top:8px";
    const top = el("div"); top.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap";
    top.appendChild(Object.assign(el("strong", null, l.name), { style: "font-size:13.5px" }));
    top.appendChild(Object.assign(el("span", null, l.status_label + (l.scheduled_for ? " · " + new Date(l.scheduled_for).toLocaleString() : "")), { style: "font-size:12px;color:var(--soft,#666)" }));
    row.appendChild(top);
    const acts = el("div"); acts.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px";
    const mk = (label, fn, primary) => { const b = el("button", null, label); b.type = "button"; b.style.cssText = "font:inherit;font-size:12px;padding:5px 12px;border-radius:999px;cursor:pointer;border:" + (primary ? "2px solid var(--plum,#5b3fa0);background:var(--plum-tint,#faf7ff);color:var(--plum-deep,#3a2470)" : "1px solid var(--line,#ddd);background:transparent"); b.addEventListener("click", fn); acts.appendChild(b); };
    mk("Preview", () => openLaunchPreview(l.id));
    if (l.status === "draft") { mk("Approve", () => act(`/launches/${l.id}/decide`, "Approved", { decision: "approve" }), true); acts.lastChild.dataset.needs = "approve"; }   // builder item 220
    if (l.status === "draft" || l.status === "approved") mk("Update from draft", () => act(`/launches/${l.id}/recapture`, "Refreshed from your current draft"));
    if (l.status === "approved") {
      mk("Launch now", async () => { if (await askYes("Launch “" + l.name + "”? This replaces your live site with the staged version.", { ok: "Launch" })) act(`/launches/${l.id}/promote`, "Launching — this usually takes under a minute"); }, true);
      acts.lastChild.dataset.needs = "publish";   // builder item 220: a Designer goes live only when their seat says so
      mk("Schedule", () => {
        // W7: a friendly native date+time picker instead of hand-typed ISO text.
        if (row.querySelector(".sched-inline")) { const ex = row.querySelector(".sched-inline input"); if (ex) ex.focus(); return; }
        const wrap = el("div"); wrap.className = "sched-inline"; wrap.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:8px";
        const inp = el("input"); inp.type = "datetime-local";
        const pad = (n) => String(n).padStart(2, "0");
        const d = new Date(Date.now() + 86400000); d.setHours(9, 0, 0, 0);   // default: tomorrow 9:00 local
        inp.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        inp.style.cssText = "font:inherit;font-size:12px;padding:5px 8px;border-radius:8px;border:1px solid var(--line,#ddd)";
        const ok = el("button", null, "Confirm"); ok.type = "button"; ok.style.cssText = "font:inherit;font-size:12px;padding:5px 12px;border-radius:999px;cursor:pointer;border:2px solid var(--plum,#5b3fa0);background:var(--plum-tint,#faf7ff);color:var(--plum-deep,#3a2470)";
        const no = el("button", null, "Cancel"); no.type = "button"; no.style.cssText = "font:inherit;font-size:12px;padding:5px 12px;border-radius:999px;cursor:pointer;border:1px solid var(--line,#ddd);background:transparent";
        ok.addEventListener("click", () => { const v = inp.value; if (!v) { toast("Pick a date and time.", true); return; } const dt = new Date(v); if (isNaN(dt.getTime())) { toast("Couldn’t read that time.", true); return; } if (dt.getTime() <= Date.now()) { toast("Pick a time in the future.", true); return; } act(`/launches/${l.id}/schedule`, "Scheduled", { scheduled_for: dt.toISOString() }); });
        no.addEventListener("click", () => wrap.remove());
        wrap.appendChild(inp); wrap.appendChild(ok); wrap.appendChild(no); row.appendChild(wrap); inp.focus();
      });
      acts.lastChild.dataset.needs = "publish";
    }
    if (l.status === "published") { mk("Roll back", async () => { if (await askYes("Roll back “" + l.name + "” to the previous version?", { ok: "Roll back" })) act(`/launches/${l.id}/rollback`, "Rolling back…"); }); acts.lastChild.dataset.needs = "publish"; }
    if (l.status === "draft" || l.status === "approved" || l.status === "scheduled") mk("Cancel", () => act(`/launches/${l.id}/cancel`, "Canceled"));
    row.appendChild(acts);
    card.appendChild(row);
  });
  box.appendChild(card);
}
// FD-T20/T21: Draft → Preview → Live management. Reuses /preview/* + the render
// pipeline (the public preview URL) + the one publish pipeline (promote).
async function renderPreviewPanel() {
  const box = $("previewBox"); if (!box) return;
  let st = null;
  try { st = (await api("GET", "/preview/status")).data; } catch (_) { box.innerHTML = ""; return; }
  if (!st || !st.draft) { box.innerHTML = ""; return; }   // an unexpected shape must not break the whole History view
  S.previewStatus = st;   // shared cache — the Page ▾ menu renders its offline item from this
  box.innerHTML = "";
  const card = el("div", "field"); card.style.marginBottom = "18px";
  card.appendChild(el("label", null, "Private preview"));
  card.appendChild(el("div", "hint", "Edit your Draft, publish it to a private Preview to review or share, then promote to Live. Your live site never changes until you promote."));
  const grid = el("div"); grid.style.cssText = "display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px";
  const stateCard = (title, lines) => { const c = el("div"); c.style.cssText = "border:1px solid var(--line,#e5e5e5);border-radius:10px;padding:10px 12px"; c.appendChild(Object.assign(el("div", null, title), { style: "font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--soft,#666)" })); lines.filter(Boolean).forEach((l) => c.appendChild(Object.assign(el("div", null, l), { style: "font-size:12.5px;margin-top:4px" }))); return c; };
  // the same number the Publish button and the overview show (/changes), not the
  // raw edit count: 14 edits to one new site is one change waiting to go live
  const dc = S.changes && typeof S.changes.count === "number" ? S.changes.count : (st.draft.unpublished_changes || 0);
  // one offline label, used by the Live card AND the status row below — the
  // same wording must never drift two lines apart in the same panel
  const offLabel = st.live.offline_since ? "⏸ Offline since " + new Date(st.live.offline_since).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "";
  grid.appendChild(stateCard("Draft", [dc + " unpublished change" + (dc === 1 ? "" : "s")]));
  grid.appendChild(stateCard("Preview", st.preview.exists ? ["Updated " + new Date(st.preview.updated_at).toLocaleString(), st.preview.has_password ? "Password-protected" : "Open link"] : ["Not created yet"]));
  grid.appendChild(stateCard("Live", st.live.published
    ? (st.live.offline_since
      ? [offLabel, "Visitors see a “temporarily offline” page"]
      : ["Published " + new Date(st.live.last_published_at).toLocaleDateString(), st.live.summary || ""])
    : ["Not live yet"]));
  card.appendChild(grid);
  const acts = el("div"); acts.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-top:12px";
  const mk = (label, fn, primary) => { const b = el("button", null, label); b.type = "button"; b.style.cssText = "font:inherit;font-size:12px;padding:6px 13px;border-radius:999px;cursor:pointer;border:" + (primary ? "2px solid var(--plum,#5b3fa0);background:var(--plum-tint,#faf7ff);color:var(--plum-deep,#3a2470)" : "1px solid var(--line,#ddd);background:transparent"); b.addEventListener("click", fn); acts.appendChild(b); };
  const act = async (path, okMsg, body) => { try { await api("POST", path, body || {}); toast(okMsg); renderPreviewPanel(); scheduleChangesRefresh(); } catch (err) { toast(nice(err), true); } };
  mk("Update preview from draft", () => act("/preview/publish", "Preview updated. Share it, or publish it when ready"), true);
  if (st.preview.exists) {
    mk("Open preview", () => { if (st.preview.url) window.open(st.preview.url, "_blank", "noopener"); });
    mk("Copy link", () => { if (st.preview.url && navigator.clipboard) { navigator.clipboard.writeText(st.preview.url); toast("Preview link copied"); } });
    mk("Preview in editor", () => openPreview("preview"));
    mk(st.preview.has_password ? "Change / remove password" : "Password-protect", async () => { const pw = await askText(st.preview.has_password ? "Change preview password" : "Set a preview password", { password: true, ok: "Update", hint: st.preview.has_password ? "Leave blank to remove the password." : "Anyone with the link will need this to view the preview." }); if (pw !== null) act("/preview/settings", "Preview access updated", { password: pw }); });
    acts.lastChild.dataset.needs = "configure";
    mk("Reset link", async () => { if (await askYes("Reset the preview link? The old link stops working.", { ok: "Reset link", danger: true })) act("/preview/settings", "Preview link reset", { regenerate_token: true }); });
    acts.lastChild.dataset.needs = "configure";
    if (st.live.published) mk("Compare with Live", () => openPreview("live"));
    mk("Publish this preview", async () => { if (await askYes("Publish the preview to your live site? This publishes exactly what’s in the preview.", { ok: "Publish" })) act("/preview/promote", "Publishing. This usually takes under a minute"); }, true);
    acts.lastChild.dataset.needs = "publish";   // builder item 220
  }
  card.appendChild(acts);
  // ── G10 → slice B (hard move): the take-offline / bring-back ACTION now lives
  // in the Page ▾ menu (siteTakeOffline/siteBringOnline below). The version
  // journal keeps a read-only status line — site-level state still belongs in
  // History as information. While the site is live, nothing shows here.
  if (st.live.published && st.live.offline_since) {
    const offRow = el("div"); offRow.id = "offlineStatusRow";
    offRow.style.cssText = "margin-top:14px;padding-top:12px;border-top:1px dashed var(--line,#e5e5e5);font-size:12.5px;color:var(--ink-2,#666)";
    offRow.textContent = offLabel + " — visitors see a “temporarily offline” page; everything is kept.";
    card.appendChild(offRow);
  }
  box.appendChild(card);
}
// ── G10 actions (slice B home: the Page ▾ menu) — the SAME confirm flow and the
// SAME POST /site/offline · /site/online routes the History row used; History
// now only reports the state (read-only line above). One shared choreography:
// call → toast → invalidate the Page ▾ status cache → refresh History only if
// it's actually on screen (loadHistory rebuilds it from scratch on open anyway).
async function siteSetState(path, okMsg) {
  try {
    await api("POST", path); toast(okMsg);
    S.previewStatus = null;
    const hv = $("view-history"); if (hv && hv.classList.contains("on")) renderPreviewPanel();
    scheduleChangesRefresh();
  } catch (err) { toast(nice(err), true); }
}
async function siteTakeOffline() {
  const name = (S.identity && S.identity.business_name) || "your site";
  if (!(await askYes(`Take ${name} OFFLINE now?\n\n• Visitors immediately stop seeing your website.\n• They’ll see a simple, branded “temporarily offline” page instead.\n• Search engines are told not to index it.\n\nNothing is deleted — every version is kept, and publishing (or “Bring back online”) restores everything.`, { ok: "Take it offline", danger: true }))) return;
  return siteSetState("/site/offline", "Your site is offline. Publish, or use “Bring back online”, to return.");
}
async function siteBringOnline() {
  return siteSetState("/site/online", "Bringing your site back — this usually takes under a minute");
}
// ── Checkpoints — name + save the current draft as a safety point ────────────
// Reuses the named-snapshot substrate (checkpoints are stored like launches);
// preview reuses the launch-preview door, "bring into draft" reuses the shared
// restore-to-draft engine. The live site is never touched.
// ── Recently deleted pages (builder list item 154) ──────────────────────────
// Restoring a version or a checkpoint never brings a page back (the draft writer
// leaves pages alone), so every deleted page is kept 30 days on the server, exactly
// as it was. Put back adds that one page to the draft; nothing else changes, and the
// live site waits for a publish. Shown only when there is something to put back.
async function renderDeletedPages() {
  // its own box, just above "More tools", so it never touches the view's static markup
  let box = $("deletedPagesBox");
  if (!box) {
    const more = $("versionMore"); if (!more || !more.parentNode) return;
    box = document.createElement("div"); box.id = "deletedPagesBox";
    more.parentNode.insertBefore(box, more);
  }
  let rows = [];
  try { const d = (await api("GET", "/pages/deleted")).data; rows = Array.isArray(d) ? d : []; } catch (_) { box.innerHTML = ""; return; }
  box.innerHTML = "";
  if (!rows.length) return;
  const card = el("div", "field"); card.style.margin = "18px 0";
  card.appendChild(el("label", null, "Recently deleted pages"));
  card.appendChild(el("div", "hint", "Kept for 30 days. Putting one back adds it to your pages as it was; nothing else changes, and your live site waits until you publish."));
  rows.forEach((p) => {
    const row = el("div"); row.style.cssText = "display:flex;align-items:center;gap:10px;flex-wrap:wrap;border-top:1px solid var(--line,#e5e5e5);padding:10px 0;margin-top:8px";
    const words = el("div"); words.style.cssText = "flex:1;min-width:0";
    words.appendChild(Object.assign(el("strong", null, p.title || p.slug), { style: "display:block;font-size:13.5px" }));
    const d = new Date(p.deleted_at);
    const left = p.days_left === 1 ? "1 day left" : (p.days_left || 0) + " days left";
    words.appendChild(Object.assign(el("span", null, "Deleted " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " + (p.sections === 1 ? "1 section" : (p.sections || 0) + " sections") + " · " + left), { style: "font-size:12px;color:var(--soft,#666)" }));
    row.appendChild(words);
    const back = el("button", null, "Put back"); back.type = "button";
    back.setAttribute("aria-label", "Put back the page " + (p.title || p.slug));
    back.style.cssText = "font:inherit;font-size:12px;padding:6px 14px;border-radius:999px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer;min-height:36px";
    back.addEventListener("click", async () => {
      if (back.disabled) return;
      back.disabled = true; back.textContent = "Putting back…";
      try {
        // Item 197 (review finding 40): it ran beside the editor's saves, so it could cross one still
        // waiting. It goes after them now, in the same line, and says when the menu doesn't show it.
        if (!(await dcSavePendingEdits())) { back.disabled = false; back.textContent = "Put back"; return; }
        const r = (await settingsTurn(() => api("POST", `/pages/deleted/${p.id}/restore`, {}))).data || {};
        const href = "/" + (r.slug || p.slug) + "/", nav = (S.settings && S.settings.nav) || [];
        const listed = !pgHasCustomNav() || nav.some((it) => it && (it.href === href || (it.children || []).some((k) => k && k.href === href)));
        toast("“" + (r.title || p.title) + "” is back in your pages" + (r.moved ? " as /" + r.slug + "/" : "") + (listed ? "" : ". It isn’t in your menu yet: add it from Pages."));
        await refreshAll(); renderDeletedPages();
      } catch (err) { toast(nice(err), true); back.disabled = false; back.textContent = "Put back"; }
    });
    row.appendChild(back);
    card.appendChild(row);
  });
  box.appendChild(card);
}
// Saved checkpoints: named copies of the draft that were never live. Item 125 puts them in the
// Versions list with the publishes, newest first, a hollow dot against a publish's filled one;
// the studio's Save a checkpoint sits at the list's top (a client's list just shows them).
async function renderCheckpoints() {
  try { S.checkpoints = (await api("GET", "/publishes/checkpoints")).data || []; } catch (_) { S.checkpoints = []; }
  const b = $("btnSaveCheckpoint"); if (b) b.hidden = !S.isStudio;
  if (S.publishesRead) renderVersionList();
}
(function initSaveCheckpoint() {
  const b = $("btnSaveCheckpoint"); if (!b) return;
  b.addEventListener("click", async () => {
    const name = await askText("Name this checkpoint", { placeholder: "e.g. Before spring redesign", ok: "Save" });
    if (name === null) return;
    try { await api("POST", "/publishes/checkpoints", { name }); toast("Checkpoint saved"); renderCheckpoints(); }
    catch (err) { toast(nice(err), true); }
  });
})();
// ── Compare any two versions + Timewarp ──────────────────────────────────────
// Compare feeds two kept versions to the SAME plain-language change engine the
// publish sheet uses; Timewarp resolves a date to the version that was live then
// and opens it in the existing read-only preview. Depends on S.publishes (set by
// loadHistory before this runs).
async function showVersionCompare(out, a, b) {
  out.innerHTML = `<div class="shimmer"></div>`;
  try {
    const d = (await api("GET", `/publishes/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`)).data;
    if (d.identical) { out.innerHTML = `<div class="hint">These two versions are identical. Nothing changed between them.</div>`; return; }
    out.innerHTML = "";
    out.appendChild(el("div", "hint", `${d.count} change${d.count === 1 ? "" : "s"} from ${fromToWord(d.from)} to ${fromToWord(d.to)}:`));
    const j = el("div", "journal");
    d.changes.forEach((ch) => { const jr = el("div", "jrow"); jr.appendChild(el("span", "jsec", sectionWord(ch.section))); jr.appendChild(el("span", null, ch.sentence)); j.appendChild(jr); });
    out.appendChild(j);
  } catch (err) { out.innerHTML = `<div class="hint">${esc(nice(err))}</div>`; }
}
function versionOptionLabel(p) {
  const d = new Date(p.at);
  const when = d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(" ", "");
  return (p.label ? "“" + p.label + "” · " : "") + when + (p.kind === "restore" ? " · restored" : "");
}
function fromToWord(side) {
  if (side.ref === "draft") return "your working draft";
  if (side.label) return "“" + side.label + "”";
  if (side.at) return new Date(side.at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return "that version";
}
function renderVersionTools() {
  const box = $("versionToolsBox"); if (!box) return;
  box.innerHTML = "";
  const versions = (S.publishes || []).filter((p) => p.status === "live" && p.restorable);
  const card = el("div", "field"); card.style.marginBottom = "18px";
  card.appendChild(el("label", null, "Compare & look back"));
  card.appendChild(el("div", "hint", "See what changed between any two versions, or see your site as it looked on a chosen date."));

  // Compare
  const cmp = el("div"); cmp.style.cssText = "margin-top:10px";
  if (versions.length < 1) {
    cmp.appendChild(el("div", "hint", "Once you’ve published a version, you can compare it with your working draft here."));
  } else {
    const opts = [{ v: "draft", t: "Your working draft" }].concat(versions.map((p) => ({ v: p.id, t: versionOptionLabel(p) })));
    const mkSel = (aria, def) => {
      const s = el("select"); s.setAttribute("aria-label", aria);
      s.style.cssText = "font:inherit;font-size:12.5px;padding:6px 9px;border:1px solid var(--line,#ddd);border-radius:8px;max-width:100%";
      opts.forEach((o) => { const op = el("option", null, o.t); op.value = o.v; s.appendChild(op); });
      s.value = def; return s;
    };
    const from = mkSel("Compare from version", versions[0] ? versions[0].id : "draft");
    const to = mkSel("Compare to version", "draft");
    const rowc = el("div"); rowc.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap";
    rowc.appendChild(Object.assign(el("span", null, "From"), { style: "font-size:12.5px" })); rowc.appendChild(from);
    rowc.appendChild(Object.assign(el("span", null, "to"), { style: "font-size:12.5px" })); rowc.appendChild(to);
    const go = el("button", null, "Compare"); go.type = "button";
    go.style.cssText = "font:inherit;font-size:12px;padding:6px 14px;border-radius:999px;cursor:pointer;border:2px solid var(--plum,#5b3fa0);background:var(--plum-tint,#faf7ff);color:var(--plum-deep,#3a2470)";
    rowc.appendChild(go); cmp.appendChild(rowc);
    const out = el("div"); out.style.cssText = "margin-top:10px"; cmp.appendChild(out);
    go.addEventListener("click", async () => {
      if (from.value === to.value) { out.innerHTML = `<div class="hint">Those are the same version. Pick two different ones.</div>`; return; }
      showVersionCompare(out, from.value, to.value);
    });
  }
  card.appendChild(cmp);

  // Timewarp
  const tw = el("div"); tw.style.cssText = "margin-top:14px;padding-top:12px;border-top:1px solid var(--line,#eee)";
  tw.appendChild(el("div", "hint", "See your site as it looked on a chosen date:"));
  const roww = el("div"); roww.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px";
  const dt = el("input"); dt.type = "date"; dt.setAttribute("aria-label", "Date to look back to");
  dt.style.cssText = "font:inherit;font-size:12.5px;padding:6px 9px;border:1px solid var(--line,#ddd);border-radius:8px";
  const today = new Date(); const pad = (n) => String(n).padStart(2, "0");
  dt.max = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const twGo = el("button", null, "See it"); twGo.type = "button";
  twGo.style.cssText = "font:inherit;font-size:12px;padding:6px 14px;border-radius:999px;cursor:pointer;border:1px solid var(--line,#ddd);background:transparent";
  roww.appendChild(dt); roww.appendChild(twGo); tw.appendChild(roww);
  twGo.addEventListener("click", async () => {
    if (!dt.value) { toast("Pick a date first.", true); return; }
    try { const d = (await api("GET", `/publishes/timewarp?date=${encodeURIComponent(dt.value)}`)).data; toast(d.message); openPublishPreview(d.publish_id); }
    catch (err) { toast(nice(err), true); }
  });
  card.appendChild(tw);
  box.appendChild(card);
}
async function loadHistory() {
  readPublishLock();      // item 214: the lock row under the heading, and whether Publish again can go
  renderPreviewPanel();   // FD-T20/T21: Draft → Preview → Live sits at the top
  renderCheckpoints();    // named draft safety points
  renderLaunches();   // FD-T7: staged launches sit above the version journal
  renderDeletedPages();   // item 154: pages deleted in the last 30 days, one at a time back
  const more = $("versionMore");
  if (more && !more.dataset.set) { more.dataset.set = "1"; more.open = !!S.isStudio; }
  const list = $("pubList");
  list.innerHTML = `<div class="loadline"><div class="lq">Loading versions…</div><div class="shimmer"></div></div>`;
  S.publishesRead = false;
  try {
    const got = await api("GET", "/publishes"), pubs = got.data;
    S.publishes = pubs; S.versionsErr = null;
    S.stars = new Set(got.stars || []);   // item 158: the versions starred
    renderVersionTools();   // compare any two versions + Timewarp (needs S.publishes)
  } catch (err) { S.publishes = null; S.versionsErr = nice(err); }
  S.publishesRead = true;   // saved checkpoints may land before or after: whichever is last draws the list
  renderVersionList();
}
// Who published it, in the words of whoever is reading: a studio working inside a
// client's site and the client see the same row from opposite sides.
function versionWho(p) {
  const scoped = studioInClient();
  if (p.by_kind === "client") return scoped ? "the client" : "you";
  if (p.by_kind === "operator" || p.by_kind === "staff") return scoped ? "your team" : "your studio";
  return "";
}
const VERSIONS_SHOWN = 10;
const verWhen = (at) => { const d = new Date(at); return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); };
// the date cell leads with what the row is: Published (a filled dot), Saved (a hollow one, never live)
function verDate(kind, word, at) { const w = el("span", "hdate"); w.appendChild(el("span", "ver-kind " + kind, word)); w.appendChild(document.createTextNode(verWhen(at))); return w; }
// Item 158: a star on any kept version, a publish or a checkpoint, and the list can show
// all of them, the publishes only, or only the starred ones.
function verStar(p) {
  const on = !!(S.stars && S.stars.has(p.id));
  const b = el("button", "ver-star"); b.type = "button";
  b.innerHTML = uiIcon("star", 14) + (on ? "Starred" : "Star");   // one icon set (builder item 34), not typed stars
  b.setAttribute("aria-pressed", String(on)); b.title = on ? "Take the star off this version" : "Star this version, to find it again";
  b.addEventListener("click", async () => {
    const next = !on;
    try {
      const d = (await api("PUT", "/publishes/stars", { id: p.id, starred: next })).data || {};
      S.stars = new Set(d.stars || []);
      renderVersionList();
      // the press keeps its place; a row the filter now hides hands it to the filter
      const nb = $("pubList").querySelector('[data-ver="' + p.id + '"] .ver-star') || $("pubList").querySelector('[data-ver-show="' + (S.verShow || "all") + '"]'); if (nb) nb.focus();
      toast(next ? "Starred" : "Star taken off");
    } catch (err) { toast(nice(err), true); }
  });
  return b;
}
function renderVersionList() {
  const list = $("pubList"); if (!list) return;
  const pubs = S.publishes || [];
  const every = [...pubs, ...(S.checkpoints || []).map((c) => ({ ...c, saved: true, at: c.at || c.created_at }))].sort((a, b) => new Date(b.at) - new Date(a.at));
  const show = S.verShow || "all", stars = S.stars || new Set();
  const all = every.filter((p) => show === "all" || (show === "published" ? !p.saved : stars.has(p.id)));
  list.innerHTML = "";
  if (every.length) {
    const seg = el("div", "ver-show"); seg.setAttribute("role", "group"); seg.setAttribute("aria-label", "Show versions");
    const starredN = every.filter((p) => stars.has(p.id)).length;
    [["all", "All"], ["published", "Published"], ["starred", "Starred (" + starredN + ")"]].forEach(([k, label]) => {
      const b = el("button", null, label); b.type = "button"; b.dataset.verShow = k; b.setAttribute("aria-pressed", String(show === k));
      b.addEventListener("click", () => { S.verShow = k; renderVersionList(); const nb = $("pubList").querySelector('[data-ver-show="' + k + '"]'); if (nb) nb.focus(); });
      seg.appendChild(b);
    });
    list.appendChild(seg);
    if (!all.length) list.appendChild(el("div", "hint", show === "starred" ? "No starred versions yet. Star the ones you’ll want again: a big launch, a season’s look." : "Nothing to show here yet."));
  }
  if (S.versionsErr) list.insertAdjacentHTML("beforeend", `<div class="estate"><div class="eq">Your versions couldn’t load just now.</div><div class="eh">${esc(S.versionsErr)}</div></div>`);
  if (!every.length) { if (!S.versionsErr) list.innerHTML = `<div class="estate"><div class="eq">No versions yet.</div><div class="eh">Each time you publish, a version is saved here. You can look at any of them or restore one.</div></div>`; return; }
  if (!all.length) return;   // item 158: the filter shows nothing; its own line says so
  const liveId = (pubs.find((p) => p.status === "live") || {}).id;
  const shown = S.versionsAll ? all : all.slice(0, VERSIONS_SHOWN);
  shown.forEach((p) => {
    if (p.saved) { list.appendChild(versionSavedRow(p)); return; }
    const row = el("div", "hentry" + (p.status === "failed" ? " hfail" : "")); row.dataset.ver = p.id;
    row.appendChild(p.status === "failed" ? verDate("fail", "Not published", p.at) : verDate("pub", "Published", p.at));
    const body = el("div", "hbody");
    const sum = el("div", "hsum");
    if (p.status === "failed") { const h = el("span", "hollow"); h.innerHTML = uiIcon("x", 13); sum.appendChild(h); }
    // Phase AA (FD-7): a named version leads with its name
    if (p.label) { const lb = el("strong", null, "“" + p.label + "” — "); sum.appendChild(lb); }
    sum.appendChild(document.createTextNode(p.status === "failed" ? "A publish didn’t go through." : p.summary));
    if (p.id === liveId) sum.appendChild(el("span", "ver-live", "Live now"));
    body.appendChild(sum);
    const who = versionWho(p);
    body.appendChild(el("div", "hmeta",
      p.status === "failed" ? "Your site was unchanged and nothing was lost."
      : p.status === "publishing" ? "Still publishing."
      : (p.kind === "restore" && !/^Published again/.test(p.summary || "") ? "A restored version · " : "") + (who ? "Published by " + who : p.by_kind === "system" ? "Published on schedule" : "Published")));   // item 239: the scheduler sent it
    row.appendChild(body);
    const acts = el("div", "hacts");
    if (p.status === "live") acts.appendChild(verStar(p));   // item 158
    if (p.status === "live") {
      // Phase AA (FD-7): name (or rename) any kept version — inline, no dialog
      const nameBtn = el("button", "quietact", p.label ? "Rename" : "Name it");
      nameBtn.addEventListener("click", () => {
        if (row.querySelector(".labeledit")) return;
        const inp = el("input", "labeledit");
        inp.type = "text"; inp.value = p.label || ""; inp.maxLength = 60;
        inp.placeholder = "e.g. Spring menu"; inp.setAttribute("aria-label", "Version name");
        inp.style.cssText = "width:100%;margin-top:6px;padding:6px 9px;font:inherit;font-size:12.5px;border:1px solid var(--line,#ddd);border-radius:8px";
        const commit = async () => {
          const val = inp.value.trim();
          if (val === (p.label || "")) { inp.remove(); return; }
          try { await api("POST", `/publishes/${p.id}/label`, { label: val }); p.label = val; loadHistory(); toast(val ? "Version named" : "Name removed"); }
          catch (err) { toast(nice(err), true); inp.remove(); }
        };
        inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); commit(); } if (ev.key === "Escape") inp.remove(); });
        inp.addEventListener("blur", commit);
        body.appendChild(inp); inp.focus(); inp.select();
      });
      acts.appendChild(nameBtn);
    }
    if (p.status === "live" && p.restorable) {
      const view = el("button", "quietact", "View");
      view.addEventListener("click", () => openPublishPreview(p.id));
      acts.appendChild(view);
      const cmp = el("button", "quietact", "Compare");
      cmp.setAttribute("aria-expanded", "false");
      const out = el("div", "hcompare"); out.hidden = true;
      cmp.addEventListener("click", () => {
        out.hidden = !out.hidden; cmp.setAttribute("aria-expanded", String(!out.hidden));
        if (!out.hidden && !out.dataset.done) { out.dataset.done = "1"; showVersionCompare(out, p.id, "draft"); }
      });
      acts.appendChild(cmp);
      if (p.id !== liveId) {   // item 214: an earlier publish goes live again in one step
        const again = el("button", "textact", "Publish again"); again.dataset.needs = "publish";
        const locked = !!(S.publishLock && S.publishLock.on);
        again.disabled = locked; if (locked) again.title = "Publishing is locked";
        again.addEventListener("click", () => openPublishAgain(p));
        acts.appendChild(again);
      }
      const res = el("button", "quietact", "Restore to draft");
      res.addEventListener("click", () => {
        S.restoreTarget = p;
        $("resSheetSub").textContent = `“${p.summary}”, published ${fmtDate(p.at)}.`;
        openSheet("restoreScrim");
      });
      acts.appendChild(res);
      row.appendChild(acts);
      row.appendChild(out);
    } else {
      if (p.status === "live") { acts.appendChild(el("span", "hghost", "Kept for your records")); row.appendChild(acts); }
    }
    list.appendChild(row);
  });
  if (shown.length < all.length) {
    const older = el("button", "addline", `Show ${all.length - shown.length} older version${all.length - shown.length === 1 ? "" : "s"}`);
    older.addEventListener("click", () => { S.versionsAll = true; renderVersionList(); });
    list.appendChild(older);
  }
}
// A saved checkpoint in the list: View, Restore (the same sheet as a publish) and, with the
// right to delete, Remove.
function versionSavedRow(c) {
  const row = el("div", "hentry ver-saved"); row.dataset.ver = c.id;
  row.appendChild(verDate("save", "Saved", c.at));
  const body = el("div", "hbody");
  body.appendChild(el("div", "hsum", "“" + c.name + "”"));
  body.appendChild(el("div", "hmeta", "A checkpoint of your draft. It was never on your live site."));
  row.appendChild(body);
  const acts = el("div", "hacts");
  acts.appendChild(verStar(c));   // item 158
  const view = el("button", "quietact", "View"); view.addEventListener("click", () => openLaunchPreview(c.id)); acts.appendChild(view);
  const res = el("button", "quietact", "Restore to draft");   // item 214: beside Publish again, it says where it goes
  res.addEventListener("click", () => { S.restoreTarget = c; $("resSheetSub").textContent = `“${c.name}”, saved ${fmtDate(c.at)}.`; openSheet("restoreScrim"); });
  acts.appendChild(res);
  const rm = el("button", "quietact", "Remove"); rm.dataset.needs = "delete";
  rm.addEventListener("click", async () => {
    if (!(await askYes("Remove checkpoint “" + c.name + "”? This can’t be undone.", { ok: "Remove", danger: true }))) return;
    try { await api("DELETE", `/publishes/checkpoints/${c.id}`); toast("Checkpoint removed"); renderCheckpoints(); }
    catch (err) { toast(nice(err), true); }
  });
  acts.appendChild(rm);
  row.appendChild(acts);
  return row;
}
// A restore brings back the sections, pages and menu too (item 187), so the editor works from
// what just loaded: the page it was on if that version has it, Home if not, and no Undo steps,
// which were all of the draft the restore set aside. A save from the copy it held, or an Undo,
// would put the old sections back.
function workFromRestored() {
  if (dcPageMissing()) dcOpenPage("");
  DC_UNDO = []; DC_REDO = [];
  BLOCKS_WORK = currentBlocks(); DC_HIST_LAST = histSnap(); BLOCK_FOCUS = null; updateUndoButtons();
  renderBlocksCard(); renderPagesBar(); refreshDesignPreview();
}
// ── Item 214: Publish again, and Lock publishing ─────────────────────────────
// Publish again puts an earlier publish back on the live site in one step (POST /restore
// deploys that kept version through the one pipeline); the draft is left as it is. Lock
// publishing holds the live site as it is, a launch freeze or a client in dispute: while it is
// on, nothing goes live by any route and the bar's Publish says Locked. The server keeps the
// lock and checks it on every way of going live (lib/publish_lock.ts); the page reads it on
// boot, whenever Versions or Publish opens, and after each change.
const lockDay = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
function openPublishAgain(p) {
  S.againTarget = p;
  $("againSub").textContent = "“" + (p.label || p.summary) + "”, published " + lockDay(p.at) + ", goes on your live site again now, all at once, in place of today’s version.";
  openSheet("againScrim");
}
$("btnAgainGo").addEventListener("click", async () => {
  const p = S.againTarget; if (!p) return;
  const btn = $("btnAgainGo");
  btn.disabled = true; btn.textContent = "Publishing…";
  try {
    const r = await api("POST", "/restore", { publish_id: p.id });
    closeSheet("againScrim");
    toast(r && r.data && r.data.status === "live" ? "That version is live again." : "That version is going live. It usually takes under a minute.");
    if (S.site) S.site.last_published_at = new Date().toISOString();
    loadHistory(); scheduleChangesRefresh();
  } catch (err) { toast(nice(err), true); }
  btn.disabled = false; btn.textContent = "Publish this version";
});
async function readPublishLock(known) {   // known: the lock the start-up read brought (item 37)
  try { S.publishLock = known !== undefined ? known : (await api("GET", "/site/publish-lock")).data || null; }
  catch (_) { /* a hiccup, or a server from before: no lock is shown, and the server still refuses */ }
  renderPublishButton(); renderPublishLock();
  if (S.publishesRead) renderVersionList();
  return S.publishLock || null;
}
async function setPublishLock(on, words) {
  const body = { on }; if (words !== undefined) body.words = words;
  S.publishLock = (await api("PUT", "/site/publish-lock", body)).data || null;
  renderPublishButton(); renderPublishLock();
  if (S.publishesRead) renderVersionList();
  return S.publishLock;
}
function renderPublishLock() {
  const box = $("pubLock"); if (!box) return;
  box.textContent = ""; box.className = "";
  const l = S.publishLock; if (!l) return;
  const by = l.by_kind === "client" ? (studioInClient() ? "the client" : "you") : (studioInClient() ? "your team" : "your studio");
  if (!l.can_change) {
    if (!l.on) return;   // a client whose studio looks after the site: nothing to say until it's locked
    box.className = "pub-lock on";
    box.appendChild(el("p", null, (l.by_kind === "client" ? "Publishing was locked on " + lockDay(l.at) + "." : "Your studio locked publishing on " + lockDay(l.at) + "." + (l.words ? " Their note: “" + l.words + "”" : "")) + " Ask them if something needs to go live."));
    return;
  }
  box.className = "pub-lock" + (l.on ? " on" : "");
  const row = pgSwitch(l.on ? "Publishing is locked" : "Lock publishing", l.on);
  const cb = row.querySelector("input"); cb.setAttribute("role", "switch");
  cb.addEventListener("change", async () => {
    const on = cb.checked; cb.disabled = true;
    try {
      await setPublishLock(on);
      const nb = $("pubLock").querySelector("input[role=switch]"); if (nb) nb.focus();   // drawn again: the keyboard stays on the switch
      toast(on ? "Publishing is locked. Nothing goes live until it’s unlocked." : "Unlocked. Publishing works again.");
    } catch (err) { cb.checked = !on; cb.disabled = false; toast(nice(err), true); }
  });
  box.appendChild(row);
  box.appendChild(el("p", null, l.on ? "Since " + lockDay(l.at) + ", by " + by + ". Nothing goes live until it’s unlocked; edits keep saving to the draft."
    : "Nothing goes live until it’s unlocked: for a launch freeze, or while something is being sorted out. Edits keep saving to the draft."));
  if (!l.on) return;
  const inp = el("input"); inp.type = "text"; inp.maxLength = 140; inp.value = l.words || ""; inp.id = "pubLockWords"; inp.placeholder = "For example: launch freeze until Friday";
  inp.addEventListener("change", async () => {
    try { await setPublishLock(true, inp.value); toast("Saved"); } catch (err) { toast(nice(err), true); }
  });
  box.appendChild(pgField(studioInClient() ? "What your client sees" : "A note with the lock", inp));
}
// The publish card while publishing is locked: why, and the one way on for whoever may unlock.
function renderRitualLocked(c, l) {
  const n = c && c.count > 0 ? c.count : 0, body = $("ritBody"), acts = $("ritActions");
  body.innerHTML = ""; acts.innerHTML = ""; $("ritBlockers").innerHTML = "";
  $("ritTitle").textContent = "Publishing is locked.";
  if (l.can_change) {
    $("ritSub").textContent = "Locked since " + lockDay(l.at) + "." + (l.words ? (studioInClient() ? " Your client reads: “" + l.words + "”" : " Your note: “" + l.words + "”") : "");
    body.appendChild(el("p", "rit-locked", !n ? "Nothing is waiting in the draft." : n === 1 ? "1 change is waiting in the draft. Unlock to publish it, or leave it locked and it waits." : n + " changes are waiting in the draft. Unlock to publish them, or leave it locked and they wait."));
    const un = el("button", "pubbtn", "Unlock publishing");
    un.addEventListener("click", async () => {
      un.disabled = true;
      try { await setPublishLock(false); toast("Unlocked. Publishing works again."); loadRitual(); }
      catch (err) { un.disabled = false; toast(nice(err), true); }
    });
    acts.appendChild(un);
  } else {
    $("ritSub").textContent = l.by_kind === "client" ? "Publishing was locked on " + lockDay(l.at) + "." : "Your studio locked publishing on " + lockDay(l.at) + "." + (l.words ? " Their note: “" + l.words + "”" : "");
    body.appendChild(el("p", "rit-locked", (!n ? "Your draft is safe." : n === 1 ? "Your change is safe in your draft and goes live once it’s unlocked." : "Your " + n + " changes are safe in your draft and go live once it’s unlocked.") + " Ask your studio if something needs to go live sooner."));
    const pub = el("button", "pubbtn", !n ? "Publish" : n === 1 ? "Publish this change" : "Publish these " + n + " changes");
    pub.disabled = true; pub.title = "Publishing is locked";
    acts.appendChild(pub);
  }
  const back = el("button", "notyet", "Back to your website"); back.addEventListener("click", closeRitual); acts.appendChild(back);
}
$("btnRestoreGo").addEventListener("click", async () => {
  const p = S.restoreTarget; if (!p) return;
  const btn = $("btnRestoreGo");
  btn.disabled = true; btn.textContent = "Restoring…";
  try {
    // an edit still waiting to save would land after the restore, over what it brings back
    if (!(await dcSavePendingEdits())) { btn.disabled = false; btn.textContent = "Restore to my draft"; return; }
    const r = p.saved ? await api("POST", `/publishes/checkpoints/${p.id}/restore`, {}) : await api("POST", "/restore-to-draft", { publish_id: p.id });
    closeSheet("restoreScrim");
    toast(r.data.message);
    btn.disabled = false; btn.textContent = "Restore to my draft";
    await refreshAll();
    workFromRestored();
    go("today");
  } catch (err) {
    btn.disabled = false; btn.textContent = "Restore to my draft";
    // Builder item 254: a restore that stopped part-way says so, and offers to put the draft back
    // from the safety copy taken first
    const b = err && err.body;
    if (b && b.error === "restore_partial" && b.safety_snapshot_id) {
      closeSheet("restoreScrim");
      toastAction(nice(err), b.put_back || "Put my draft back", async () => {
        try { const r = await api("POST", "/restore-to-draft", { snapshot_id: b.safety_snapshot_id }); toast(r.data.message); await refreshAll(); workFromRestored(); }
        catch (e2) { toast(nice(e2), true); }
      }, 60000);
      return;
    }
    toast(nice(err), true);
  }
});

/* ── initial load (identical fetches) ── */
function fillSingles() {
  const i = S.identity || {};
  [["f-business_name","business_name"],["f-tagline","tagline"],["f-short_description","short_description"],["f-description","description"],["f-phone","phone"],["f-email","email"],["f-story","story"],["f-booking_url","booking_url"],["f-ordering_url","ordering_url"],["f-service_area","service_area"],["f-seo_title","seo_title"],["f-seo_description","seo_description"]]
    .forEach(([id, k]) => { $(id).value = i[k] || ""; });
  if ($("f-industry")) $("f-industry").value = (S.settings && S.settings.industry_key) || "generic";
  industryHint();
  if ($("f-gsv")) $("f-gsv").value = (S.settings && S.settings.google_site_verification) || "";
  if ($("f-bsv")) $("f-bsv").value = (S.settings && S.settings.bing_site_verification) || "";
  renderVisitSwitch();
  renderAiCrawlSwitch();
  const l = S.location || {};
  [["f-address_line1","address_line1"],["f-city","city"],["f-region","region"],["f-postal_code","postal_code"],["f-locphone","phone"]]
    .forEach(([id, k]) => { $(id).value = l[k] || ""; });
  renderGoesSwitch();
  renderHours();
  PLACE2 = undoClone(l.second_location) || null;
  renderPlace2();
  paintBizShows();
  paintBizShort();
  renderSearchPreview();
}
// Item 37: the site and the editor's six lists, and whether publishing is locked, in ONE read
// (GET /site?with=…); each part is what its own read answers, refused where that read would be.
// A server from before answers the site alone, with no parts: then each is read on its own, as
// before, and so is a part the answer leaves out. OPENED_LOCK: the lock that read brought, if any.
const OPEN_PARTS = ["offerings", "faqs", "testimonials", "posts", "media", "settings", "publish_lock"];
let OPENED_LOCK;
async function openReads(soft, tagged) {
  OPENED_LOCK = undefined;
  const one = await api("GET", "/site?with=" + OPEN_PARTS.join(",")).catch(() => null);
  const parts = one && one.parts;
  const part = (name, path) => {
    const p = parts && parts[name];
    if (!p) return soft(api("GET", path));
    if ("data" in p) return Promise.resolve({ data: p.data });
    const err = new Error(p.error || "read_failed"); err.status = p.status;
    return soft(Promise.reject(err));
  };
  if (parts && parts.publish_lock && "data" in parts.publish_lock) OPENED_LOCK = parts.publish_lock.data || null;
  return Promise.all([
    parts ? Promise.resolve(one) : tagged("site", api("GET", "/site")),
    part("offerings", "/offerings"), part("faqs", "/faqs"), part("testimonials", "/testimonials"), part("posts", "/posts"),
    part("media", "/media"), part("settings", "/settings"),
  ]);
}
const SHELL_LOADED = document.readyState === "loading" ? new Promise((r) => document.addEventListener("DOMContentLoaded", r, { once: true })) : Promise.resolve();
async function refreshAll() {
  // The website-content reads are TOLERANT: a plan without the website feature
  // (e.g. a Customers-only plan opening #settings) must still get this page —
  // a locked area renders empty, it never takes Settings down with it.
  // Tolerate a LOCKED area (403) AND a transient/one-off server error (5xx) on the
  // non-critical content reads — one flaky endpoint must never blank the whole
  // editor. Only /site is truly required. `tagged` prefixes an error with which
  // call failed so a real failure is diagnosable, not a generic "couldn't load".
  DRAFT_SEED = true;   // everything is read again below, so the next read's version is the page's
  const soft = (p) => p.catch((e) => (e && (e.status === 403 || e.status >= 500) ? { data: [] } : Promise.reject(e)));
  const tagged = (name, p) => p.catch((e) => { if (e && typeof e.message === "string") e.message = "[" + name + "] " + e.message; throw e; });
  // Item 84: the Overview's own two reads go out with the first wave, not after it.
  const todayFirst = Promise.all([api("GET", "/health"), readChanges()]);
  todayFirst.catch(() => {});   // loadToday reports a failure
  // PERF: reuse the shell's /portal/context (window.ddsContext) — fall back to our own read.
  // Item 84: this script runs before the deferred shell.js, so window.ddsContext usually
  // didn't exist yet and the page read the context a second time. The shell has run by
  // DOMContentLoaded; its handoff waits for its own read, or gives up after 2.5 s.
  const ctxP = SHELL_LOADED.then(() => (window.ddsContext ? window.ddsContext().then((d) => ({ data: d })) : Promise.reject())).catch(() => api("GET", "/portal/context").catch(() => null));
  const [[siteR, off, faq, tes, pos, med, set], ctxR] = await Promise.all([openReads(soft, tagged), ctxP]);
  S.site = siteR.data.site; S.identity = siteR.data.identity; S.location = siteR.data.location;
  S.locationFields = Array.isArray(siteR.data.location_fields) ? siteR.data.location_fields : [];   // item 334: what the database can save
  S.live = siteR.data.live || null;   // item 261: the one live rule, from the server
  S.offerings = off.data || []; S.faqs = faq.data || []; S.testimonials = tes.data || []; S.posts = pos.data || [];
  S.media = med.data || []; S.settings = set.data || {};
  // Phase SKU: the FEATURE edition — so the standalone CMS workspace shows only
  // website + drafting surfaces, never the Business-OS "brains" it doesn't include.
  // null = no entitlement recorded → all features (studio_os default, unchanged).
  S.features = (ctxR && ctxR.data && ctxR.data.edition_features) || null;
  S.ctx = (ctxR && ctxR.data) || null;
  S.isStudio = !!(ctxR && ctxR.data && ctxR.data.is_agency);   // the studio sees every version tool; a client sees the list
  document.documentElement.classList.toggle("is-studio", S.isStudio);
  applyEditionGating();
  carryScopeOnLinks();
  applyVocab();
  readPublishLock(OPENED_LOCK);   // item 214: the bar's Publish says Locked while publishing is locked
  fillSingles(); await loadToday(todayFirst);
 
  renderOfferings(); renderFaqs(); renderTes(); renderPosts(); renderMediaGrid($("mediaGrid"), true);
  // Item 80: these cards mount once. On a reload (Load the latest, a restore, an accepted
  // draft) the ones already on screen are drawn again from what just loaded, in place,
  // so a restored announcement or section order shows; never while someone types in one.
  remountInPlace("annCard", mountAnnouncementCard);
  remountSectionsCard();
  if (EDIT_CARDS) remountInPlace("designCard", mountDesignCard);   // item 84: not before Edit mode first opens
  else if ($("view-design").classList.contains("on")) mountEditCards();
  if ($("view-search").classList.contains("on")) mountSearchCard();
}
// Draw a once-mounted card again from what's loaded, where it was (a placeholder holds its
// spot while a mount that reads first is out); absent, mount it fresh. If the new one
// can't be drawn, the old one goes back.
function remountInPlace(id, mount, force) {   // force: an Undo redraws it even under the caret
  const old = $(id);
  if (!force && old && old.contains(document.activeElement)) return;
  const mark = old ? document.createComment(id) : null;
  if (old) old.replaceWith(mark);
  return Promise.resolve(mount()).catch(() => {}).then(() => {
    if (!mark || !mark.parentNode) return;
    const nu = $(id);
    mark.replaceWith(nu && nu !== old ? nu : old);
  });
}
// ── Phase SD: Search & visibility — human questions, our plumbing ──
// ── Per-page search/share builders, for each page's settings panel on the Pages tab
// (built-in pages by name, the owner's own as "page:<slug>"). ──
// The show-on-Google toggle: one pages_noindex entry (checked = shows).
function seoNoindexRow(key, pageName, rowLabel) {
  const rowEl = pgSwitch(rowLabel || pageName, !new Set((S.settings && S.settings.pages_noindex) || []).has(key));
  const cb = rowEl.querySelector("input"); cb.id = "nx-" + key.replace(/[^a-z0-9_-]/gi, "-");
  cb.addEventListener("change", async () => {
    const show = cb.checked;
    const noindex = () => { const nh = new Set((S.settings && S.settings.pages_noindex) || []); show ? nh.delete(key) : nh.add(key); return { pages_noindex: [...nh] }; };
    try { await settingsPut(noindex); toast(cb.checked ? pageName + " will show on Google — publish to apply" : pageName + " will be hidden from Google — publish to apply"); scheduleChangesRefresh(); }
    catch (err) { toast(nice(err), true); cb.checked = !cb.checked; }
  });
  return rowEl;
}
// One page's search wording + share appearance (page_seo overrides): search
// headline/description, share (og/twitter) headline/description, share image.
// Item 120: each field has its name above it, and the headline and description count
// their letters beside the name as they're typed.
function seoFieldsBox(key, label, showLabel) {
  const cur = ((S.settings && S.settings.page_seo) || {})[key] || {};
  const box = el("div"); box.style.cssText = "margin:8px 0 12px";
  if (showLabel !== false) box.appendChild(Object.assign(el("div", null, label), { style: "font-size:12px;font-weight:600;margin-bottom:3px" }));
  const ti = el("input"); ti.type = "text"; ti.maxLength = 120; ti.placeholder = "Blank shows the good default"; ti.value = cur.title || "";
  const di = el("input"); di.type = "text"; di.maxLength = 320; di.placeholder = "Blank shows the good default"; di.value = cur.description || "";
  const sti = el("input"); sti.type = "text"; sti.maxLength = 60; sti.placeholder = "Same as the search headline"; sti.value = cur.share_title || "";
  const sdi = el("input"); sdi.type = "text"; sdi.maxLength = 160; sdi.placeholder = "Same as the search description"; sdi.value = cur.share_description || "";
  const sim = el("select");
  sim.setAttribute("aria-label", "Share picture for " + label);
  const noneOpt = el("option", null, "Your site’s usual picture"); noneOpt.value = ""; sim.appendChild(noneOpt);
  (S.media || []).filter((m) => m.thumb).forEach((m) => { const o = el("option", null, (m.alt_text || "photo").slice(0, 60)); o.value = m.id; sim.appendChild(o); });
  sim.value = cur.share_image || "";
  if (sim.value !== (cur.share_image || "")) sim.value = "";   // the stored photo is gone → fall back
  ti.setAttribute("aria-label", "Search headline for " + label); di.setAttribute("aria-label", "Search description for " + label);
  // How THIS page reads on Google — blank fields show the default the template
  // renders (seoPageDefault mirrors the templates' seoOv shapes).
  const safe = key.replace(/[^a-z0-9_-]/gi, "-");
  const prev = srpBuild("srp-" + safe); prev.root.classList.add("srp-page");
  const cntT = el("div", "cnt"), cntD = el("div", "cnt"); cntT.id = "cnt-" + safe + "-title"; cntD.id = "cnt-" + safe + "-description";
  const paint = () => {
    const w = seoHomeWords();
    const def = seoPageDefault(key, { name: w.name, siteDescription: w.description, offeringLabel: VOCAB.label, pageTitle: label });
    const path = key.indexOf("page:") === 0 ? "/" + key.slice(5) + "/" : ({ offerings: VOCAB.path, about: "/about/", faq: "/faq/", updates: "/updates/", contact: "/contact/" })[key] || "/";
    srpFill(prev, { name: w.name, host: seoCrumb(seoHost(), path), hostMuted: !siteLiveUrl(), title: ti.value.trim() || def.title, description: di.value.trim() || def.description });
    seoCounterInto(cntT, "title", ti.value, "Empty — Google shows “" + seoCut(def.title, SEO_TITLE_MAX) + "”");
    seoCounterInto(cntD, "description", di.value, def.description ? "Empty — Google shows “" + seoCut(def.description, 70) + "”" : "Empty — and so is your description, so add one");
    // a count sits beside the field's name; with nothing typed, the line saying what Google shows instead goes under it
    [[ti, cntT], [di, cntD]].forEach(([inp, cnt]) => {
      const row = inp.parentNode && inp.parentNode.querySelector(".pg-lrow"); if (!row) return;
      if (inp.value) { if (cnt.parentNode !== row) row.appendChild(cnt); }
      else if (cnt.previousSibling !== inp) inp.after(cnt);
    });
  };
  [ti, di].forEach((inp) => inp.addEventListener("input", paint));
  const save = async () => {
    const entry = {};
    if (ti.value.trim()) entry.title = ti.value.trim();
    if (di.value.trim()) entry.description = di.value.trim();
    if (sti.value.trim()) entry.share_title = sti.value.trim();
    if (sdi.value.trim()) entry.share_description = sdi.value.trim();
    if (sim.value) entry.share_image = sim.value;
    const seo = () => { const map = { ...((S.settings && S.settings.page_seo) || {}) }; if (!Object.keys(entry).length) delete map[key]; else map[key] = entry; return { page_seo: map }; };
    try { await settingsPut(seo); toast("Saved — publish to apply"); scheduleChangesRefresh(); }
    catch (err) { toast(nice(err), true); }
  };
  [ti, di, sti, sdi, sim].forEach((inp) => inp.addEventListener("change", save));
  // a name above each field; the two Google reads count beside theirs
  const counted = (name, input, cnt) => {
    const f = el("div", "field"); if (!input.id) input.id = "pgf-" + Math.random().toString(36).slice(2, 8);
    const row = el("div", "pg-lrow"); const l = el("label", null, name); l.setAttribute("for", input.id);
    row.appendChild(l); if (cnt) row.appendChild(cnt);
    f.append(row, input); return f;
  };
  box.append(counted("Search headline", ti, cntT), counted("Search description", di, cntD), prev.root,
    el("div", "pg-sub", "When it’s shared"), counted("Share headline", sti), counted("Share description", sdi), counted("Share picture", sim));
  paint(); return box;
}
// ── Benchmark item 4 (docs/design/BENCHMARK-2026-10.md): how the page reads on
// Google. The helpers from here to seoPageDefault are PURE (no DOM, no S) and
// pinned 1:1 by tests/presence/seo_setup_test.mjs, which extracts them from
// this file by name — keep them free of page state. ──
const SEO_TITLE_MAX = 60, SEO_DESC_MIN = 50, SEO_DESC_MAX = 160;
// "Burbank, Glendale; Pasadena" → ["Burbank", "Glendale", "Pasadena"] (deduped, case-insensitive)
function seoSplit(s) {
  return String(s || "").split(/[,;\n]+/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean)
    .filter((x, i, a) => a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
}
// ["a"] → "a" · ["a","b"] → "a and b" · ["a","b","c"] → "a, b and c"
function seoList(items) {
  const a = (items || []).filter(Boolean);
  if (!a.length) return "";
  if (a.length === 1) return a[0];
  return a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
}
// Cut the way Google cuts: at a word, then " ..." — only when over the cap.
function seoCut(s, max) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  let cut = t.slice(0, max - 4);
  const sp = cut.lastIndexOf(" ");
  if (sp > max * 0.6) cut = cut.slice(0, sp);
  return cut.replace(/[\s,;:—–-]+$/, "") + " ...";
}
// The counter under a field: title ≤60 is fine (green), over is amber ("may be
// cut off"); a description reads best at 50–160, short is amber, over is amber.
function seoCounter(kind, value, emptyText) {
  const n = String(value || "").length;
  if (!n) return { n: 0, state: "", text: emptyText || "Empty" };
  if (kind === "title") {
    if (n > SEO_TITLE_MAX) return { n, state: "warn", text: n + " of " + SEO_TITLE_MAX + " — may be cut off" };
    return { n, state: "good", text: n + " of " + SEO_TITLE_MAX };
  }
  if (n > SEO_DESC_MAX) return { n, state: "warn", text: n + " of " + SEO_DESC_MAX + " — may be cut off" };
  if (n < SEO_DESC_MIN) return { n, state: "warn", text: n + " of " + SEO_DESC_MAX + " — a little short, " + SEO_DESC_MIN + "–" + SEO_DESC_MAX + " reads best" };
  return { n, state: "good", text: n + " of " + SEO_DESC_MAX };
}
// The three questions → a headline, a description and a "where you work" line.
// Headline shapes, longest first; the first that fits Google's 60 wins:
//   "Name — word in Place" · "Name — word" · "Name — Place" · "Name"
// Description: "Name: word, word and word in Place and Place." + the tagline when
// there is one, + a plain closing line only when it would otherwise read short.
function seoSuggest(a) {
  const name = String((a && a.name) || "").replace(/\s+/g, " ").trim();
  const places = seoSplit(a && a.places).slice(0, 3);
  const words = seoSplit(a && a.words).slice(0, 3);
  const tagline = String((a && a.tagline) || "").replace(/\s+/g, " ").trim();
  const w1 = words[0] || "", p1 = places[0] || "";
  const shapes = [];
  if (name && w1 && p1) shapes.push(name + " — " + w1 + " in " + p1);
  if (name && w1) shapes.push(name + " — " + w1);
  if (name && p1) shapes.push(name + " — " + p1);
  if (name) shapes.push(name);
  const title = shapes.find((t) => t.length <= SEO_TITLE_MAX) || seoCut(name, SEO_TITLE_MAX);
  let description = "";
  if (name && words.length && places.length) description = name + ": " + seoList(words) + " in " + seoList(places) + ".";
  else if (name && words.length) description = name + ": " + seoList(words) + ".";
  else if (name && places.length) description = name + " serves " + seoList(places) + ".";
  else if (name) description = name + ".";
  if (description && tagline) description += " " + tagline.replace(/[.!?]*$/, ".");
  if (description && description.length < SEO_DESC_MIN) description += " Get in touch to find out more.";
  if (description.length > SEO_DESC_MAX) description = seoCut(description, SEO_DESC_MAX);
  const service_area = places.length ? "Serving " + seoList(places) : "";
  return { title, description, service_area, places, words };
}
// What a built-in or owner-made page reads like when its own wording is blank —
// the shapes every template renders (templates/*/render.ts, the seoOv calls).
function seoPageDefault(key, c) {
  const name = (c && c.name) || "", site = (c && c.siteDescription) || "";
  const label = (c && c.offeringLabel) || "Services";
  const map = {
    offerings: [label + " — " + name, label + " from " + name + "."],
    about: ["About — " + name, site],
    faq: ["FAQ — " + name, "Answers to common questions about " + name + "."],
    updates: ["Updates — " + name, "News and updates from " + name + "."],
    contact: ["Contact & Hours — " + name, "Address, phone, and hours for " + name + "."],
  };
  const d = map[key] || [((c && c.pageTitle) || "Page") + " — " + name, site];
  return { title: d[0], description: d[1] };
}
// "marlows.example" + "/about/" → "marlows.example › about" (how Google writes the address line)
function seoCrumb(host, path) {
  const segs = String(path || "").split("/").filter(Boolean);
  return [host].concat(segs).join(" › ");
}
// ── the DOM half: preview nodes, the live home preview, the setup, the task list ──
function seoHost() { const u = siteLiveUrl(); return u ? u.replace(/^https?:\/\//, "").replace(/\/$/, "") : "yourdomain.com"; }
function srpBuild(id) {
  const root = el("div", "srp"); if (id) root.id = id;
  const site = el("div", "srp-site"); const fav = el("span", "srp-fav", "?"); fav.setAttribute("aria-hidden", "true");
  const col = el("div"); const name = el("div", "srp-name"); const url = el("div", "srp-url"); col.append(name, url); site.append(fav, col);
  const title = el("p", "srp-title"); const desc = el("p", "srp-desc");
  root.append(site, title, desc);
  return { root, fav, name, url, title, desc };
}
function srpFill(n, v) {
  const name = String(v.name || "").trim();
  n.fav.textContent = (name.charAt(0) || "?").toUpperCase();
  n.name.textContent = name || "Your business";
  n.url.textContent = v.host || ""; n.url.classList.toggle("muted", !!v.hostMuted);
  n.title.textContent = v.title ? seoCut(v.title, SEO_TITLE_MAX) : "Your page title"; n.title.classList.toggle("empty", !v.title);
  n.desc.textContent = v.description ? seoCut(v.description, SEO_DESC_MAX) : "Add a description so Google has something to show here."; n.desc.classList.toggle("empty", !v.description);
}
function seoCounterInto(node, kind, value, emptyText) {
  const n = typeof node === "string" ? $(node) : node; if (!n) return;
  const c = seoCounter(kind, value, emptyText);
  n.textContent = c.text; n.className = "cnt" + (c.state ? " " + c.state : "");
}
// The words the home page carries right now — typed values first, so the
// preview follows the keyboard, not the last save.
function seoHomeWords() {
  const val = (id) => { const n = $(id); return n ? String(n.value || "").trim() : ""; };
  const i = S.identity || {};
  const name = val("f-business_name") || i.business_name || "";
  const t = val("f-seo_title"), d = val("f-seo_description"), short = val("f-short_description") || i.short_description || "";
  const bizDesc = short || val("f-description") || i.description || "";   // item 127: Google gets the short description before the long one
  return { name, title: t || name, description: d || bizDesc, titleOwn: !!t, descOwn: !!d, short: !!short };
}
let SRP_HOME = null;
function renderSearchPreview() {
  if (!$("srp")) return;
  if (!SRP_HOME) SRP_HOME = { fav: $("srpFav"), name: $("srpName"), url: $("srpUrl"), title: $("srpTitle"), desc: $("srpDesc") };
  const w = seoHomeWords();
  srpFill(SRP_HOME, { name: w.name, host: seoHost(), hostMuted: !siteLiveUrl(), title: w.title, description: w.description });
  seoCounterInto("cnt-seo_title", "title", $("f-seo_title").value, "Empty — Google shows your business name");
  seoCounterInto("cnt-seo_description", "description", $("f-seo_description").value, w.short ? "Empty — Google shows your short description" : w.description ? "Empty — Google shows your description" : "Empty — and so is your description, so add one here");
  if (!$("seoSetup").hidden) renderSeoSetupOut();
  renderSeoTasks();
}
// ── the three-question setup ──
function seoSetupAnswers() {
  const val = (id) => { const n = $(id); return n ? n.value : ""; };
  return { name: val("sw-name"), places: val("sw-places"), words: val("sw-words"), tagline: val("f-tagline") };
}
function openSeoSetup() {
  const p = $("seoSetup"); if (!p) return;
  const i = S.identity || {}, loc = S.location || {};
  const val = (id) => { const n = $(id); return n ? String(n.value || "").trim() : ""; };
  $("sw-name").value = val("f-business_name") || i.business_name || "";
  const area = val("f-service_area").replace(/^serving\s+/i, "").replace(/\s+and\s+/gi, ", ");
  $("sw-places").value = area || loc.city || "";
  $("sw-words").value = ((SV && SV.phrases && SV.phrases.list) || []).map((x) => x.phrase).join(", ");   // item 160: the phrases kept
  const own = !!(val("f-seo_title") || val("f-seo_description"));
  $("swReplaceWrap").hidden = !own; $("swReplace").checked = false;
  p.hidden = false; renderSeoSetupOut();
  $("sw-name").focus();
}
function closeSeoSetup() { const p = $("seoSetup"); if (p) p.hidden = true; const b = $("btnSeoSetup"); if (b) b.focus(); }
let SRP_SETUP = null;
// What Save will write, shown as the search result it becomes.
function renderSeoSetupOut() {
  if (!$("swOut")) return;
  if (!SRP_SETUP) SRP_SETUP = { fav: $("swFav"), name: $("swName"), url: $("swUrl"), title: $("swTitle"), desc: $("swDesc") };
  const s = seoSuggest(seoSetupAnswers());
  const val = (id) => { const n = $(id); return n ? String(n.value || "").trim() : ""; };
  const replace = $("swReplace").checked;
  const title = (val("f-seo_title") && !replace) ? val("f-seo_title") : s.title;
  const description = (val("f-seo_description") && !replace) ? val("f-seo_description") : s.description;
  srpFill(SRP_SETUP, { name: val("sw-name") || s.title, host: seoHost(), hostMuted: !siteLiveUrl(), title, description });
  const area = val("f-service_area");
  $("swArea").textContent = area ? "Where you work stays “" + area + "”." : s.service_area ? "Where you work becomes “" + s.service_area + "”." : "Add a place and your “Where you work” line is written too.";
}
async function saveSeoSetup() {
  const btn = $("swSave"); const a = seoSetupAnswers(); const s = seoSuggest(a);
  const name = String(a.name || "").replace(/\s+/g, " ").trim();
  if (!name) { toast("Give your business a name first.", true); $("sw-name").focus(); return; }
  const val = (id) => { const n = $(id); return n ? String(n.value || "").trim() : ""; };
  const replace = $("swReplace").checked;
  const i = S.identity || {};
  const body = {};
  if (name !== String(i.business_name || "")) body.business_name = name;
  if ((replace || !val("f-seo_title")) && s.title) body.seo_title = s.title;
  if ((replace || !val("f-seo_description")) && s.description) body.seo_description = s.description;
  if (s.service_area && !val("f-service_area")) body.service_area = s.service_area;
  // item 160: the words are kept as what people type to find you, up to three
  const had = ((SV && SV.phrases && SV.phrases.list) || []).map((x) => x.phrase);
  const words = String(a.words || "").split(",").map((x) => x.replace(/\s+/g, " ").trim().toLowerCase()).filter(Boolean).filter((x, n, all) => all.indexOf(x) === n).slice(0, 3);
  const phrases = words.length && words.join("|") !== had.join("|") ? words : null;
  if (!Object.keys(body).length && !phrases) { toast("Nothing to change — your search setup already says this."); closeSeoSetup(); return; }
  btn.disabled = true; btn.textContent = "Saving…"; whisper("save-identity", "saving"); whisper("topWhisper", "saving");
  try {
    const r = Object.keys(body).length ? await api("PUT", "/identity", body) : null;
    if (phrases) svPhrasesTake((await api("PUT", "/visibility/phrases", { phrases })).data);
    const saved = (r && r.data && typeof r.data.business_name === "string") ? r.data : {};
    S.identity = { ...i, ...body, ...saved };
    const ids = { business_name: "f-business_name", seo_title: "f-seo_title", seo_description: "f-seo_description", service_area: "f-service_area" };
    Object.keys(body).forEach((k) => { const n = $(ids[k]); if (n) n.value = S.identity[k] || body[k]; });
    if (body.business_name && $("siteTitle")) $("siteTitle").textContent = S.identity.business_name;
    whisper("save-identity", "saved"); whisper("topWhisper", "saved");
    toast("Saved — publish to apply"); scheduleChangesRefresh();
    closeSeoSetup(); renderSearchPreview();
  } catch (err) { whisper("save-identity", ""); whisper("topWhisper", "failed"); toast(nice(err), true); }
  btn.disabled = false; btn.textContent = "Save";
}
// ── what's left: the tasks, each a door ──
let SEO_CONN = null, SV_LISTING = null;   // connection statuses from GET /visibility; null = not known
let SV = null;   // the Search tab's read
function seoTaskRows() {
  const conn = hasFeature("connected") ? [
    { done: SEO_CONN === "connected", label: SEO_CONN === "pending" ? "Finish connecting Google Search Console" : "Connect Google Search Console", href: "#svConsoleCard", card: "svConsoleCard" },
    { done: SV_LISTING === "connected", label: "Connect your Google listing", href: "#svListingCard", card: "svListingCard" },
  ] : [];
  // A watch plan has nothing to word or publish here: its site lives elsewhere.
  if (S.site && S.site.edition === "monitor") return [{ done: !!(SV && SV.address), label: "Tell us your website’s address", href: "#monitor" }, ...conn];
  const w = seoHomeWords();
  const f = S.health && S.health.facts;
  const rows = [
    { done: w.titleOwn, label: "Add a search headline", focus: "f-seo_title" },
    { done: w.descOwn, label: "Add a search description", focus: "f-seo_description" },
  ];
  if (f && f.domain) rows.push({ done: f.domain.state === "ok", label: f.domain.state === "attention" ? "Finish connecting your domain" : "Connect your domain", href: "#domain" });
  rows.push(...conn);
  const draft = !!(f && f.website && f.website.state === "none");
  const n = (S.changes && S.changes.count) || 0;
  rows.push({ done: !draft && !n, label: draft ? "Publish your website" : "Publish your changes", href: "#publish" });
  return rows;
}
function renderSeoTasks() {
  if (SV && Array.isArray(SV.tasks)) { renderSvTodo(); return; }   // item 124: the server's ranked list
  const host = $("seoTasks"); if (!host) return;
  host.innerHTML = "";
  const rows = seoTaskRows();
  const left = rows.filter((r) => !r.done).length;
  host.appendChild(el("p", "hint", left ? `${rows.length - left} of ${rows.length} done` : "Everything here is done. Google has what it needs."));
  const ul = el("ul", "sv-check");
  rows.forEach((r) => {
    const li = el("li", r.done ? "done" : "");
    if (r.done) li.appendChild(el("span", null, r.label));
    else {
      const a = el("a", null, r.label); a.href = r.href || "#search";
      if (r.focus) a.addEventListener("click", (e) => { e.preventDefault(); const n = $(r.focus); if (n) { n.scrollIntoView({ behavior: "smooth", block: "center" }); n.focus({ preventScroll: true }); } });
      else if (r.card) a.addEventListener("click", (e) => { e.preventDefault(); const n = $(r.card); if (n) n.scrollIntoView({ behavior: "smooth", block: "center" }); });
      li.appendChild(a);
    }
    ul.appendChild(li);
  });
  host.appendChild(ul);
}

// ── the Search tab's board: the score, then one card per question ──
// One read (GET /visibility). A page deploys on merge and the function only when the
// deploy runs, so an answer of "no such route" reads as still arriving, and the
// checklist and wording below keep working either way.
const svWhen = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
const svMonth = (p) => { const m = /^(\d{4})-(\d{2})$/.exec(String(p || "")); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, 1)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" }) : ""; };
const svNum = (n) => Number(n || 0).toLocaleString("en-US");
const svPct = (v) => Math.max(0, Math.min(100, Number(v) || 0));
const svTone = (n) => (n >= 80 ? "var(--sage)" : n >= 60 ? "var(--amber)" : "var(--clay)");
function svRing(score) {
  const n = typeof score === "number" ? score : null;
  const C = 301.59;   // 2πr at r=48
  const arc = n === null ? "" : `<circle cx="56" cy="56" r="48" fill="none" stroke="${svTone(n)}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(svPct(n) / 100 * C).toFixed(1)} ${C}"/>`;
  return `<div class="sv-ring" role="img" aria-label="${n === null ? "No score yet" : `Search score: ${n} out of 100`}"><svg viewBox="0 0 112 112" aria-hidden="true" focusable="false"><circle cx="56" cy="56" r="48" fill="none" stroke="var(--hair)" stroke-width="9"/>${arc}</svg><span class="n" aria-hidden="true">${n === null ? "—" : n}</span></div>`;
}
function svTable(caption, first, rows) {
  if (!rows.length) return "";
  return `<table class="sv-table"><caption>${esc(caption)}</caption><thead><tr><th scope="col">${esc(first)}</th><th scope="col">Clicks</th><th scope="col">Seen</th></tr></thead><tbody>${rows.map((r) => `<tr><td title="${esc(r.name)}">${esc(r.name)}</td><td>${svNum(r.clicks)}</td><td>${svNum(r.impressions)}</td></tr>`).join("")}</tbody></table>`;
}
// Start a connection from this tab and come back to it. The same hand-off as
// connections.html, which the return page (connections-callback.html) reads.
async function svConnect(key, label, btn, problemHost) {
  const old = btn.textContent;
  btn.disabled = true; btn.textContent = "One moment…"; problemHost.textContent = "";
  try {
    const r = await api("POST", `/connections/${key}/connect`, {});
    localStorage.setItem("dds-pending-connection", key);
    localStorage.setItem("dds-pending-label", label);
    const c = new URLSearchParams(location.search).get("client");
    if (c) localStorage.setItem("dds-pending-scope", c); else localStorage.removeItem("dds-pending-scope");
    localStorage.setItem("dds-pending-return", withClient("/presence.html#search"));
    location.href = r.data.authorize_url;
  } catch (e) {
    btn.disabled = false; btn.textContent = old;
    problemHost.textContent = e.message;   // the server names what's missing; the owner is the one reading it
  }
}
function svConnectButton(key, label, text) {
  const wrap = el("div");
  const b = el("button", "pillbtn inked", text); b.type = "button";
  const problem = el("p", "sv-problem"); problem.setAttribute("role", "alert");
  b.addEventListener("click", () => svConnect(key, label, b, problem));
  wrap.append(b, problem);
  return wrap;
}
function svDoor(href, text) { const a = el("a", "pillbtn", text); a.href = href; return a; }

function renderSvScore() {
  const host = $("svScore"); if (!host) return;
  const s = SV && SV.score;
  const state = SV ? SV.state : "unknown";
  host.innerHTML = `<div class="sv-score">${svRing(s ? s.overall : null)}<div class="sv-body" id="svScoreBody"></div></div>`;
  const body = $("svScoreBody");
  if (!SV) { body.append(el("h3", null, "Still arriving"), el("p", null, "Your search score appears here in a moment. Your checklist and wording below already work.")); return; }
  if (s) {
    body.append(el("h3", null, s.label));
    if (s.summary) body.append(el("p", null, s.summary));
    const grid = el("div", "sv-pillars");
    grid.setAttribute("role", "list");
    s.pillars.forEach((p) => {
      const name = el("span", null, p.name); name.setAttribute("role", "listitem");
      const bar = el("div", "sv-bar"); bar.setAttribute("aria-hidden", "true");
      const fill = el("i"); fill.style.width = svPct(p.score) + "%"; bar.appendChild(fill);
      grid.append(name, bar, el("span", "sv-pn", p.score === null ? "Not measured" : String(p.score)));
    });
    body.appendChild(grid);
    (s.notes || []).forEach((n) => body.appendChild(el("p", "hint", n)));
    body.appendChild(el("p", "hint", `Checked ${svWhen(s.checked_at)}${SV.address ? ` · ${SV.address.domain}` : ""}`));
  } else if (state === "draft") {
    body.append(el("h3", null, "Publish first"), el("p", null, "The score comes from reading your live pages the way Google does, and a draft has nothing to read yet."));
  } else if (state === "no_domain") {
    body.append(el("h3", null, "Where is your website?"), el("p", null, "Tell us its address and it can be checked, wherever it’s hosted."));
  } else {
    body.append(el("h3", null, "No check yet"), el("p", null, "Run the check to get your score. It reads your live pages the way Google does and takes about a minute. Nothing on your site changes."));
  }
  const actions = el("div", "sv-actions");
  if (state === "ready") {
    const b = el("button", "pillbtn inked", s ? "Check again" : "Check my site"); b.type = "button"; b.id = "btnSvCheck";
    b.addEventListener("click", () => svRunCheck(b));
    actions.appendChild(b);
    if (s && s.report_url) { const a = el("a", null, "See the full report"); a.href = s.report_url; a.target = "_blank"; a.rel = "noopener"; actions.appendChild(a); }
  } else if (state === "draft") {
    actions.appendChild(svDoor("#publish", "Publish your site"));
    const alt = el("a", null, "Already live somewhere else?"); alt.href = "#monitor"; actions.appendChild(alt);
  } else if (state === "no_domain") {
    actions.appendChild(svDoor("#monitor", "Add your website’s address"));
  }
  body.appendChild(actions);
  const status = el("p", "sv-status"); status.id = "svCheckStatus"; status.setAttribute("role", "status"); body.appendChild(status);
}
async function svRunCheck(btn) {
  btn.disabled = true;
  const status = $("svCheckStatus");
  status.className = "sv-status"; status.textContent = "Reading your pages. This takes about a minute…";
  try {
    const r = await api("POST", "/visibility/check", {});
    SV.score = r.data.score;
    renderSvScore(); renderSvFix();
    toast("Your search score is up to date.");
  } catch (e) {
    btn.disabled = false;
    status.className = "sv-problem"; status.textContent = e.message;
  }
}
function renderSvFix() {
  const card = $("svFixCard"), host = $("svFix"); if (!card || !host) return;
  const s = SV && SV.score;
  card.hidden = !(s && s.issues.length) || !!(SV && Array.isArray(SV.tasks));   // item 124: they're in the to-do list
  if (card.hidden) return;
  host.innerHTML = "";
  s.issues.forEach((f) => {
    const d = el("details", "sv-issue");
    const sum = el("summary");
    sum.append(el("span", null, f.title), el("span", "sv-pri" + (f.priority === "Fix now" ? " now" : f.priority === "Important" ? " soon" : ""), f.priority));
    d.appendChild(sum);
    if (f.what) d.appendChild(el("p", null, f.what));
    if (f.why) d.appendChild(el("p", null, f.why));
    if (f.fix) { const p = el("p"); p.appendChild(el("b", null, "The fix: ")); p.appendChild(document.createTextNode(f.fix)); d.appendChild(p); }
    host.appendChild(d);
  });
  if (s.issue_count > s.issues.length && s.report_url) {
    const a = el("a", null, `See all ${s.issue_count} in the full report`); a.href = s.report_url; a.target = "_blank"; a.rel = "noopener"; a.style.cssText = "font-size:13px;color:var(--plum);display:inline-block;margin-top:8px";
    host.appendChild(a);
  }
}
function renderSvConsole() {
  const card = $("svConsoleCard"), host = $("svConsole"); if (!card || !host) return;
  card.hidden = !hasFeature("connected");
  if (card.hidden || !SV) return;
  const c = SV.console; host.innerHTML = "";
  if (c.has_data) {
    const delta = c.prior_clicks ? Math.round(((c.clicks - c.prior_clicks) / c.prior_clicks) * 100) : null;
    const nums = el("div", "sv-nums");
    nums.innerHTML = `<div><b>${svNum(c.clicks)}</b><span>clicks to your site</span></div><div><b>${svNum(c.impressions)}</b><span>times you were seen</span></div>`;
    host.appendChild(nums);
    const when = el("p", "hint");
    when.innerHTML = `In ${esc(svMonth(c.period))}${delta === null ? "" : delta === 0 ? " · the same clicks as the month before" : ` · <span class="${delta > 0 ? "sv-up" : "sv-down"}">${delta > 0 ? "up" : "down"} ${Math.abs(delta)}%</span> on the month before`}`;
    host.appendChild(when);
    host.insertAdjacentHTML("beforeend", svTable("What people searched", "Search", (c.top_terms || []).map((t) => ({ name: t.term, clicks: t.clicks, impressions: t.impressions }))));
    host.insertAdjacentHTML("beforeend", svTable("Your pages on Google", "Page", (c.top_pages || []).map((p) => ({ name: p.path, clicks: p.clicks, impressions: p.impressions }))));
  } else if (c.unavailable) {
    host.appendChild(el("p", "hint", "Search numbers are catching their breath. Check back shortly."));
  }
  if (c.reason) host.appendChild(el("p", "sv-why", c.reason));
  if (c.has_data && c.status === "connected") return;
  if (c.status === "connected") {
    if (!c.reason) host.appendChild(el("p", null, "Connected. Google reports on whole past months, so numbers land once the site has been live through one. Nothing to do."));
    return;
  }
  if (c.readiness === "draft") { host.appendChild(el("p", null, "Publish first. Google can’t measure a site it has never been able to visit.")); return; }
  if (c.readiness === "no_domain") { host.appendChild(el("p", null, "Tell us your website’s address first. Google reports on a domain, whoever hosts it.")); return; }
  if (!c.reason) host.appendChild(el("p", null, "See what people search to find you and which pages they land on. Read-only, approved on Google’s own screen, and yours to disconnect any time."));
  host.appendChild(svConnectButton("google_search_console", "how you show up in Google Search", c.status === "expired" || c.status === "error" ? "Reconnect Search Console" : "Connect Search Console"));
}
function renderSvListing() {
  const card = $("svListingCard"), host = $("svListing"); if (!card || !host) return;
  card.hidden = !hasFeature("connected");
  if (card.hidden || !SV) return;
  const l = SV.listing, d = l.data; host.innerHTML = "";
  SV_LISTING = l.status;
  if (d && (d.rating != null || d.review_count != null || d.calls != null || d.listing_name)) {
    if (d.listing_name) { const p = el("p", null); p.style.margin = "0 0 8px"; p.appendChild(el("b", null, d.listing_name)); if (d.listing_address) p.appendChild(document.createTextNode(" · " + d.listing_address)); host.appendChild(p); }
    const nums = el("div", "sv-nums");
    const tile = (v, k) => { if (v == null) return; const t = el("div"); t.append(el("b", null, v), el("span", null, k)); nums.appendChild(t); };
    tile(d.rating != null ? d.rating + "★" : null, d.review_count != null ? `${svNum(d.review_count)} review${d.review_count === 1 ? "" : "s"}` : "rating");
    tile(d.calls != null ? svNum(d.calls) : null, "calls from Google");   // item 381: Google's own count, not the taps on the site's number
    tile(d.direction_requests != null ? svNum(d.direction_requests) : null, "direction requests");
    tile(d.website_clicks != null ? svNum(d.website_clicks) : null, "website clicks");
    host.appendChild(nums);
    if (d.calls != null || d.direction_requests != null) host.appendChild(el("p", "hint", "Google counts these calls, direction requests and website clicks from your listing, over the last 30 days."));
    if (d.unreplied_reviews) host.appendChild(el("p", "sv-why", `${svNum(d.unreplied_reviews)} of your latest reviews ${d.unreplied_reviews === 1 ? "has" : "have"} no reply yet.`));
    if (d.hours_set === false) host.appendChild(el("p", "sv-why", "Your listing has no opening hours. People often check those first."));
    if (d.listing_maps_uri) { const a = el("a", null, "Open on Google Maps"); a.href = d.listing_maps_uri; a.target = "_blank"; a.rel = "noopener"; a.style.cssText = "font-size:13px;color:var(--plum)"; host.appendChild(a); }
  }
  if (l.reason) host.appendChild(el("p", "sv-why", l.reason));
  if (l.status === "connected") {
    if (/^Choose which/.test(l.reason || "")) host.appendChild(svDoor(withClient("/connections.html"), "Choose your listing"));
    else if (!d && !l.reason) host.appendChild(el("p", null, "Connected. Your listing’s numbers are on their way."));
    return;
  }
  host.appendChild(el("p", null, "Your rating, your reviews, and how many people called or asked for directions."));
  host.appendChild(el("p", "hint", "Google’s screen will say “manage your business listings”, the only permission it offers. Studio OS only reads yours."));
  host.appendChild(svConnectButton("google_business_profile", "your Google listing", l.status === "expired" || l.status === "error" ? "Reconnect your listing" : "Connect your listing"));
}
function renderSvAi() {
  const host = $("svAi"); if (!host) return;
  host.innerHTML = "";
  if (!SV) { host.appendChild(el("p", "hint", "This shows once your search score does.")); return; }
  const a = SV.ai;
  if (a) {
    const nums = el("div", "sv-nums");
    const t = el("div"); t.append(el("b", null, `${a.overall}`), el("span", null, `out of 100${a.label ? " · " + a.label : ""}`)); nums.appendChild(t);
    host.appendChild(nums);
    if (a.pillars.length) {
      const grid = el("div", "sv-pillars");
      a.pillars.forEach((p) => {
        const bar = el("div", "sv-bar"); bar.setAttribute("aria-hidden", "true");
        const fill = el("i"); fill.style.width = svPct(p.score) + "%"; bar.appendChild(fill);
        grid.append(el("span", null, p.name), bar, el("span", "sv-pn", p.score === null ? "Not measured" : String(p.score)));
      });
      host.appendChild(grid);
    }
    // list item 153: who the assistants named instead, and the websites their answers drew on
    if ((a.competitors || []).length) {
      const p = el("p", "sv-ai-list"); p.append(el("b", null, "Named instead of you: "), a.competitors.map((c) => `${c.name} (${c.times} time${c.times === 1 ? "" : "s"})`).join(", "));
      host.appendChild(p);
    }
    if ((a.sources || []).length) {
      const p = el("p", "sv-ai-list"); p.append(el("b", null, "Websites the answers drew on: "), a.sources.map((x) => `${x.own ? "your website" : x.name} (${x.cited})`).join(", "));
      host.appendChild(p);
    }
    host.appendChild(el("p", "hint", `Checked ${svWhen(a.checked_at)}${a.business_name ? ` for ${a.business_name}${a.city ? ` in ${a.city}` : ""}` : ""}.`));
  } else {
    host.appendChild(el("p", null, "Do ChatGPT-style assistants name you when someone asks for a business like yours? The free AI Visibility Check runs the questions and scores the answers."));
    if (SV.address) host.appendChild(el("p", "hint", `Enter ${SV.address.domain} as your website there and the result shows up here.`));
  }
  const actions = el("div", "sv-actions");
  const run = el("a", a ? null : "pillbtn", a ? "Run it again" : "Run the free check"); run.href = SV.ai_check_url; run.target = "_blank"; run.rel = "noopener";
  actions.appendChild(run);
  if (a && a.report_url) { const r = el("a", null, "See the result"); r.href = a.report_url; r.target = "_blank"; r.rel = "noopener"; actions.appendChild(r); }
  host.appendChild(actions);
}
async function loadSearch() {
  renderSeoTasks();
  try {
    SV = (await api("GET", "/visibility")).data;
    SEO_CONN = SV.console.status; SV_LISTING = SV.listing.status;
  } catch (_) { SV = null; }
  if (!$("view-search").classList.contains("on")) return;
  renderSvScore(); renderSvFix(); renderSvConsole(); renderSvListing(); renderSvAi(); renderSeoTasks();
  renderSvTools(); renderSvNums(); renderSvMovers();   // item 124
  renderSvDrop(); renderSvNear();   // item 219
  renderSvPhrases();   // item 160
  if (SV && SV.follow && SV.console && SV.console.status === "connected") loadSvFollow(); else { SV_FOLLOW = null; renderSvFollow(); }   // item 181
  loadSvAiWatch();   // item 182
  loadRankGrid();   // item 185
}
(function wireSeoPreview() {
  ["f-seo_title", "f-seo_description", "f-business_name", "f-description"].forEach((id) => { const n = $(id); if (n) n.addEventListener("input", renderSearchPreview); });
  ["sw-name", "sw-places", "sw-words"].forEach((id) => { const n = $(id); if (n) n.addEventListener("input", renderSeoSetupOut); });
  const rp = $("swReplace"); if (rp) rp.addEventListener("change", renderSeoSetupOut);
  const open = $("btnSeoSetup"); if (open) open.addEventListener("click", openSeoSetup);
  const save = $("swSave"); if (save) save.addEventListener("click", saveSeoSetup);
  const cancel = $("swCancel"); if (cancel) cancel.addEventListener("click", closeSeoSetup);
})();
async function mountSearchCard() {
  const host = $("searchCardSlot") || $("view-business"); if (!host || $("searchCard")) return;
  const card = el("div", "field"); card.id = "searchCard"; card.style.marginTop = "18px";
  card.appendChild(el("label", null, "Search & visibility"));
  const status = el("div", "hint", "Checking your search setup…"); card.appendChild(status);
  host.appendChild(card);
  let h = null;
  try { h = (await api("GET", "/search/health")).data; } catch (e) { status.textContent = (e && e.status === 403) ? "Search insights aren’t part of your plan yet — everything else here still works." : "The search check couldn’t run just now."; return; }
  status.remove();
  // 1. the health sentences
  const line = (ok2, good, fix) => {
    const p = el("div", null, ""); p.style.cssText = "display:flex;gap:8px;align-items:baseline;padding:3px 0;font-size:13px";
    const mk2 = el("span", null, ok2 ? "" : "•"); if (ok2) mk2.innerHTML = uiIcon("check", 13);
    p.appendChild(Object.assign(mk2, { style: "color:" + (ok2 ? "var(--sage)" : "var(--amber)") + ";font-weight:700" }));
    p.appendChild(el("span", null, ok2 ? good : fix));
    card.appendChild(p);
  };
  line(true, "Google can read your site: the sitemap, each page’s details and your business listing are built in.");   // item 95: no schema word
  // the not-yet case is a task above (with the door); the sentence speaks when it is true
  if (h.seo_fields.title && h.seo_fields.description) line(true, "Your search headline and description are set.");
  // This reads presence_settings.google_site_verification (routes/search.ts:41) —
  // the HTML meta ownership tag, which is a DIFFERENT thing from a Search Console
  // connection. Saying "connected" here claimed something untrue and contradicted
  // the Connections page, which correctly showed it as not connected.
  // Item 95: the code is only the ownership tag; connecting is how searches show here, so the
  // missing step names the Connect button, and says nothing once Search Console is connected.
  if (h.verification.google) line(true, "Your Google verification code is saved.");
  else if (SEO_CONN !== "connected") line(false, "", "To see how people find you on Google, connect Google Search Console with the button above.");
  if (h.verification.bing) line(true, "Bing is connected too (that powers Copilot search).");
  (h.links || []).forEach((l) => { if (l.ok === false) line(false, "", "Your " + l.kind.replace("social:", "") + " link isn’t answering — check " + l.url.slice(0, 40) + "…"); });
  if ((h.links || []).length && (h.links || []).every((l) => l.ok !== false)) line(true, "All your outside links (booking, social, redirects) are answering.");
  // 2. a page's search wording, share image and "show on Google" live in its settings on the Pages tab
  const each = el("div", "hint"); each.style.marginTop = "12px";
  each.appendChild(document.createTextNode("To change how one page shows on Google, or to hide it, use its settings button on the "));
  const toPages = el("a", null, "Pages tab"); toPages.href = "#pages"; toPages.style.textDecoration = "underline"; toPages.addEventListener("click", (e) => { e.preventDefault(); go("pages"); });
  each.append(toPages, document.createTextNode("."));
  card.appendChild(each);
  // 4. redirects manager (moved a page? send visitors to the new spot)
  const rd = el("details"); rd.style.cssText = "margin-top:8px";
  rd.appendChild(Object.assign(el("summary", null, "Moved from an old website? Forward old page addresses"), { style: "cursor:pointer;font-size:12.5px;font-weight:600" }));
  rd.appendChild(redirectsManager());
  card.appendChild(rd);
}
// Forwards: an old address that sends visitors to a page on this site. The Search card has it,
// and so does the Pages card's Not found page.
function redirectsManager() {
  const box = el("div");
  const list = el("div", "hint", "Loading…"); box.appendChild(list);
  const form = el("div"); form.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:6px";
  const fi = el("input"); fi.placeholder = "/old-page/"; const tiR = el("input"); tiR.placeholder = "/services/ or https://…";
  fi.setAttribute("aria-label", "Old address"); tiR.setAttribute("aria-label", "Where it goes now");
  [fi, tiR].forEach((inp) => { inp.type = "text"; inp.style.cssText = "flex:1;min-width:120px;padding:7px 9px;font:inherit;font-size:12.5px;border:1px solid var(--line,#ddd);border-radius:8px"; });
  const add = el("button", null, "Forward it"); add.type = "button";
  add.style.cssText = "font:inherit;font-size:12px;padding:6px 12px;border-radius:999px;border:1px solid var(--line,#ddd);background:transparent;cursor:pointer";
  form.append(fi, tiR, add); box.appendChild(form);
  box.appendChild(el("div", "hint", "Anyone visiting the old address lands on the new one — and Google follows along. Applies when you publish."));
  let showAll = false;
  async function loadRedirects() {
    try {
      const r = await api("GET", "/redirects"); const all = r.data || [];
      list.innerHTML = all.length ? "" : "No forwards yet.";
      const rows = showAll ? all : all.slice(0, 20);   // item 156: an imported site can have hundreds
      rows.forEach((row) => {
        const line2 = el("div"); line2.style.cssText = "display:flex;gap:8px;align-items:center;font-size:12.5px;padding:3px 0";
        line2.appendChild(el("span", null, row.from_path + " → " + row.to_path));
        const x = icoBtn("x", "Remove this forward", null, 14); x.dataset.needs = "delete";
        x.style.cssText = "border:none;background:none;cursor:pointer;color:var(--ink-2,#888)";
        x.addEventListener("click", async () => { try { await api("DELETE", "/redirects/" + row.id); loadRedirects(); toast("Forward removed — publish to apply"); scheduleChangesRefresh(); } catch (err) { toast(nice(err), true); } });
        line2.appendChild(x); list.appendChild(line2);
      });
      if (all.length > rows.length) {
        const more = el("button", "rdx-more", `Show all ${all.length} forwards`); more.type = "button";
        more.addEventListener("click", () => { showAll = true; loadRedirects(); });
        list.appendChild(more);
      }
    } catch (_) { list.textContent = "Forwards couldn’t load just now."; }
  }
  add.addEventListener("click", async () => {
    try { await api("POST", "/redirects", { from_path: fi.value, to_path: tiR.value }); fi.value = ""; tiR.value = ""; loadRedirects(); toast("Forward added — publish to apply"); scheduleChangesRefresh(); }
    catch (err) { toast(nice(err), true); }
  });
  box.appendChild(redirectsImport(() => { showAll = false; loadRedirects(); }));
  loadRedirects();
  return box;
}
// Item 156: a whole list of old addresses at once, when a client moves from another website.
// Paste the lines (or choose a spreadsheet saved as CSV), or read the old site's own page
// list for suggestions; Check the list says what each line will do, and nothing is saved
// until Bring them in. The server keeps publishing's rules: 500 at most, no chains, no loops.
let RDX_SEQ = 0;
function redirectsImport(onDone) {
  const n = ++RDX_SEQ;
  const wrap = el("div");
  const open = el("button", "rdx-open", "Bring in a whole list…"); open.type = "button";
  open.setAttribute("aria-expanded", "false"); open.setAttribute("aria-controls", "rdx-" + n);
  const panel = el("div", "rdx"); panel.id = "rdx-" + n; panel.hidden = true;
  panel.appendChild(el("div", "hint", "Moving a client from another website? Bring in all their old addresses at once: one per line, the old address and then where it goes now. A spreadsheet saved as CSV works too, and so does reading the old site’s own list of pages."));
  const oldRow = el("div", "rdx-row");
  const oldSite = el("input"); oldSite.type = "text"; oldSite.placeholder = "oldsite.com"; oldSite.setAttribute("aria-label", "The old website’s address");
  const read = el("button", "rdx-b", "Read its pages"); read.type = "button";
  oldRow.append(oldSite, read);
  const ta = el("textarea"); ta.rows = 6; ta.setAttribute("aria-label", "Addresses to bring in, one per line");
  ta.placeholder = "/about-us  /about/\n/our-menu  /menu/\nhttps://oldsite.com/contact-us  /contact/";
  const fileRow = el("div", "rdx-row");
  const fl = el("label", "rdx-file", "Choose a spreadsheet (CSV)"); const file = el("input"); file.type = "file"; file.accept = ".csv,text/csv,text/plain"; fl.appendChild(file);
  const check = el("button", "rdx-b", "Check the list"); check.type = "button";
  fileRow.append(fl, check);
  const out = el("div"); out.setAttribute("role", "status");
  const go = el("button", "rdx-b rdx-go", "Bring them in"); go.type = "button"; go.hidden = true;
  panel.append(oldRow, ta, fileRow, out, go);
  wrap.append(open, panel);
  let checked = null;   // the text the shown plan is for; editing it asks for a new check
  const reset = () => { checked = null; out.textContent = ""; go.hidden = true; };
  open.addEventListener("click", () => { const on = panel.hidden; panel.hidden = !on; open.setAttribute("aria-expanded", String(on)); if (on) ta.focus(); });
  ta.addEventListener("input", reset);
  file.addEventListener("change", async () => {
    const f = file.files && file.files[0]; if (!f) return;
    if (f.size > 512 * 1024) { toast("That file is too big. A list of up to 1,000 lines fits.", true); file.value = ""; return; }
    ta.value = await f.text(); file.value = ""; reset(); ta.focus();
  });
  read.addEventListener("click", async () => {
    const v = oldSite.value.trim(); if (!v) { oldSite.focus(); return; }
    read.disabled = true; read.textContent = "Reading…";
    try {
      const d = (await api("GET", "/redirects/suggest?from=" + encodeURIComponent(v))).data || {};
      const lines = d.lines || [];
      ta.value = lines.map((l) => l.from + "  " + l.to).join("\n");
      reset();
      const unsure = lines.length - (d.sure || 0);
      out.appendChild(el("div", "rdx-sum", `Found ${d.found} pages on ${d.host}. ${lines.length ? `${lines.length} need a forward${unsure ? `; ${unsure} ${unsure === 1 ? "has" : "have"} no close match here and go to your home page, so check ${unsure === 1 ? "it" : "them"}` : ""}. Change any line, then Check the list.` : "Each one already has the same address here, so none needs a forward."}`));
    } catch (err) { toast(nice(err), true); }
    read.disabled = false; read.textContent = "Read its pages";
  });
  const say = (v, r) => v === "add" ? (r.note ? "New. " + r.note : "New") : v === "replace" ? r.note : v === "same" ? "Already there" : "Skipped: " + r.reason;
  check.addEventListener("click", async () => {
    const text = ta.value; if (!text.trim()) { ta.focus(); return; }
    check.disabled = true;
    try {
      const plan = (await api("POST", "/redirects", { list: text, dry_run: true })).data || {};
      out.textContent = ""; checked = text;
      const lines = (plan.rows || []).length;
      const parts = [plan.add ? `${plan.add} new forward${plan.add === 1 ? "" : "s"}` : "", plan.replace ? `${plan.replace} replace${plan.replace === 1 ? "s" : ""} one you had` : "", plan.same ? `${plan.same} already there` : "", plan.skipped ? `${plan.skipped} skipped` : ""].filter(Boolean);
      out.appendChild(el("div", "rdx-sum", `${lines} line${lines === 1 ? "" : "s"}: ${parts.join(", ") || "nothing to bring in"}. Nothing is saved until you bring them in.${(plan.repoint || []).length ? ` ${plan.repoint.length} older forward${plan.repoint.length === 1 ? "" : "s"} will go straight to the final page.` : ""}`));
      const tw = el("div", "rdx-tw"), tb = el("table", "rdx-table");
      tb.innerHTML = "<thead><tr><th scope=\"col\">Line</th><th scope=\"col\">Old address</th><th scope=\"col\">Goes to</th><th scope=\"col\">What happens</th></tr></thead>";
      const body = el("tbody");
      (plan.rows || []).forEach((r) => {
        const tr = el("tr", r.verdict);
        [String(r.line), r.from, r.to, say(r.verdict, r)].forEach((t) => tr.appendChild(el("td", null, t || "")));
        body.appendChild(tr);
      });
      tb.appendChild(body); tw.appendChild(tb); out.appendChild(tw);
      const k = (plan.add || 0) + (plan.replace || 0);
      go.hidden = !k; go.textContent = `Bring in ${k} forward${k === 1 ? "" : "s"}`;
    } catch (err) { toast(nice(err), true); }
    check.disabled = false;
  });
  go.addEventListener("click", async () => {
    if (checked === null || checked !== ta.value) { reset(); toast("The list changed: check it again first.", true); return; }
    go.disabled = true;
    try {
      const plan = (await api("POST", "/redirects", { list: checked })).data || {};
      toast(`${plan.add || 0} forward${plan.add === 1 ? "" : "s"} brought in${plan.replace ? `, ${plan.replace} replaced` : ""} — publish to apply`);
      ta.value = ""; reset(); panel.hidden = true; open.setAttribute("aria-expanded", "false");
      scheduleChangesRefresh(); onDone();
    } catch (err) { toast(nice(err), true); }
    go.disabled = false;
  });
  return wrap;
}
// ── items 124 and 181 (Nov 2026): the Search tab's tools row, this month's numbers, the ranked
// to-do list, the pages that moved most, and the searches a client follows. GET /visibility
// brings tools, tasks and movers (routes/search_tab.ts); GET/PUT /visibility/follow the searches.
// A server without them (before the deploy) leaves the old checklist and cards as they were.
// a change on the month before: "▲ 18%" in green, "▼ 12%" in red; places on Google go up when the number falls
function svChg(now, before, kind) {
  if (now == null || before == null) return "";
  let d, txt, sr;
  if (kind === "place" || kind === "count") {
    // a place on Google goes up when its number falls; a count (questions named) goes up when it grows
    d = kind === "place" ? Math.round(before) - Math.round(now) : Math.round(now) - Math.round(before);
    if (!d) return `<span class="sv-chg">Same</span>`;
    txt = (d > 0 ? "▲ " : "▼ ") + Math.abs(d); sr = (d > 0 ? "up " : "down ") + Math.abs(d) + (kind === "place" ? " place" + (Math.abs(d) === 1 ? "" : "s") : "");
  } else {
    if (!before) return now ? `<span class="sv-chg">New</span>` : "";
    d = Math.round(((now - before) / before) * 100);
    if (!d) return `<span class="sv-chg">Same</span>`;
    txt = (d > 0 ? "▲ " : "▼ ") + Math.abs(d) + (kind === "pct" ? "%" : ""); sr = (d > 0 ? "up " : "down ") + Math.abs(d) + (kind === "pct" ? "%" : "");
  }
  return `<span class="sv-chg ${d > 0 ? "up" : "down"}"><span aria-hidden="true">${txt}</span><span class="sr-only">${esc(sr)}</span></span>`;
}
// a sheet for one tool: a heading, a line under it, the body and a close button
function svDialog(title, sub, onClose) {
  const dlg = el("dialog", "sv-dlg"); const inner = el("div", "sv-dlg-in");
  const head = el("div", "sv-dlg-h"); const hx = el("div"); const h = el("h2", null, title); h.id = "svDlgT" + Date.now(); hx.appendChild(h);
  if (sub) hx.appendChild(el("p", null, sub));
  const x = el("button", "sv-dlg-x", "✕"); x.type = "button"; x.setAttribute("aria-label", "Close");
  head.append(hx, x); inner.appendChild(head);
  const body = el("div"); inner.appendChild(body); dlg.appendChild(inner); dlg.setAttribute("aria-labelledby", h.id);
  document.body.appendChild(dlg);
  let done = false;
  const close = () => { if (done) return; done = true; try { dlg.close(); } catch (_) {} if (onClose) onClose(); dlg.remove(); };
  x.addEventListener("click", close);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });
  dlg.showModal();
  return { dlg, body, close };
}
const SV_TOOLS = [["redirects", "Old addresses", "↪"], ["verification", "Verification", "✓"], ["sitemap", "Sitemap", "#"], ["llms", "llms.txt", "✎"], ["hide", "Hide from search", "◐"]];
function renderSvTools() {
  const host = $("svTools"); if (!host) return;
  const t = SV && SV.tools; host.hidden = !t;
  if (!t) return;
  const ready = t.ready !== false, hidden = ready && t.hidden === true;
  const words = {
    redirects: t.redirects == null ? "Forwards" : t.redirects ? `${t.redirects} forwarded` : "None yet",
    verification: t.verification && t.verification.google ? (t.verification.bing ? "Google and Bing saved" : "Google code saved") : t.verification && t.verification.bing ? "Bing code saved" : "None added",
    sitemap: t.sitemap ? "Made for you" : "After you publish",
    llms: !ready ? "Coming soon" : t.llms && t.llms.set ? "Written for AI tools" : "Not written yet",
    hide: !ready ? "Coming soon" : hidden ? "On: hidden from search" : "Off: Google can list it",
  };
  host.innerHTML = "";
  SV_TOOLS.forEach(([k, label, ic]) => {
    const b = el("button", "sv-tool" + (k === "hide" && hidden ? " warn" : "")); b.type = "button"; b.dataset.tool = k;
    const i = el("span", "ic", ic); i.setAttribute("aria-hidden", "true"); b.appendChild(i);
    const tx = el("span", "tx"); tx.appendChild(el("b", null, label)); tx.appendChild(el("small", null, words[k])); b.appendChild(tx);
    if (!ready && (k === "llms" || k === "hide")) b.disabled = true;
    b.addEventListener("click", () => svOpenTool(k));
    host.appendChild(b);
  });
}
function svOpenTool(k) {
  const t = (SV && SV.tools) || {};
  if (k === "redirects") {
    const d = svDialog("Old page addresses", "When a page moves, or an old website used other addresses, send visitors and Google to the new place.", () => loadSearch());
    d.body.appendChild(redirectsManager());
    return;
  }
  if (k === "verification") {
    // the codes' own fields, moved into the sheet and put back after (their saving is wired where they live)
    const det = $("f-gsv") && $("f-gsv").closest("details"); if (!det) return;
    const mark = document.createComment("verification codes");
    det.before(mark);
    const d = svDialog("Verification", "Codes that prove to Google and Bing that this site is yours. Optional: connecting Search Console proves it for you.", () => { mark.replaceWith(det); det.open = false; loadSearch(); });
    d.body.appendChild(det); det.open = true;
    return;
  }
  if (k === "sitemap") {
    const d = svDialog("Sitemap", "A list of every page Google can show, made for you each time you publish.");
    if (t.sitemap) {
      const p = el("p"); const a = el("a", null, "Open the sitemap"); a.href = t.sitemap; a.target = "_blank"; a.rel = "noopener"; p.append(a, document.createTextNode(" · " + t.sitemap.replace(/^https?:\/\//, ""))); d.body.appendChild(p);
      d.body.appendChild(el("p", "hint", "Pages you hide from Google (each page’s settings on the Pages tab) are left out of it. Google finds it on its own; Search Console shows when it last read it."));
    } else d.body.appendChild(el("p", "hint", "Your sitemap is made when you publish. Publish the site and it will be here."));
    return;
  }
  if (k === "llms") {
    const d = svDialog("llms.txt", "A short file AI tools read to understand your business. Change anything; it goes live when you publish.");
    const ta = el("textarea"); ta.id = "svLlms"; ta.maxLength = (t.llms && t.llms.max) || 4000; ta.setAttribute("aria-label", "Your llms.txt"); ta.spellcheck = false;
    const cnt = el("div", "hint"); const paint = () => { cnt.textContent = `${(t.llms && t.llms.url) ? "Live at " + t.llms.url.replace(/^https?:\/\//, "") + " after you publish · " : ""}${svNum(ta.value.length)} of ${svNum(ta.maxLength)} characters`; };
    ta.addEventListener("input", paint);
    d.body.append(ta, cnt);
    const acts = el("div", "acts");
    const save = el("button", "pillbtn sm inked", "Save"); save.type = "button"; save.dataset.needs = "configure";
    const again = el("button", "pillbtn sm", "Start again from my details"); again.type = "button"; again.dataset.needs = "configure";
    acts.append(save, again);
    if (S.settings && S.settings.llms_txt) { const off = el("button", "pillbtn sm", "Take it down"); off.type = "button"; off.dataset.needs = "configure"; off.addEventListener("click", async () => { try { await settingsPut({ llms_txt: null }); toast("Taken down. It leaves the site when you publish."); scheduleChangesRefresh(); d.close(); loadSearch(); } catch (err) { toast(nice(err), true); } }); acts.appendChild(off); }
    d.body.appendChild(acts);
    const draft = async () => { try { const r = await api("GET", "/visibility/llms-draft"); ta.value = (r.data && r.data.text) || ""; paint(); } catch (err) { toast(nice(err), true); } };
    again.addEventListener("click", draft);
    save.addEventListener("click", async () => {
      save.disabled = true;
      try { await settingsPut({ llms_txt: ta.value.trim() || null }); toast("Saved. It goes live when you publish."); scheduleChangesRefresh(); d.close(); loadSearch(); }
      catch (err) { toast(nice(err), true); } finally { save.disabled = false; }
    });
    if (S.settings && S.settings.llms_txt) { ta.value = S.settings.llms_txt; paint(); } else draft();
    setTimeout(() => ta.focus(), 30);
    return;
  }
  if (k === "hide") {
    const d = svDialog("Hide from search", "Asks Google, Bing and other search engines not to list any page of this site. Anyone with the address can still open it.");
    const lab = el("label", "sv-switch"); lab.dataset.needs = "configure";
    const cb = el("input"); cb.type = "checkbox"; cb.id = "svHideSwitch"; cb.checked = !!(S.settings && S.settings.search_hidden);
    lab.append(cb, document.createTextNode(" Hide this site from search engines"));
    d.body.appendChild(lab);
    d.body.appendChild(el("p", "hint", "It takes effect when you publish. To hide one page only, use that page’s settings on the Pages tab."));
    cb.addEventListener("change", async () => {
      const now = cb.checked;
      try { await settingsPut({ search_hidden: now }); toast(now ? "Hidden from search when you publish." : "Search engines can list it again when you publish."); scheduleChangesRefresh(); loadSearch(); }
      catch (err) { cb.checked = !now; toast(nice(err), true); }
    });
  }
}
function renderSvNums() {
  const host = $("svNums"); if (!host) return;
  const c = SV && SV.console;
  const tiles = [];
  if (c && c.has_data) {
    const m = svMonth(c.period).slice(0, 3);
    tiles.push(`<div class="sv-stat"><span class="l">Google clicks · ${esc(m)}</span><span class="v"><b>${svNum(c.clicks)}</b>${svChg(c.clicks, c.prior_clicks, "pct")}</span><span class="s">against the month before</span></div>`);
    tiles.push(`<div class="sv-stat"><span class="l">Times seen on Google</span><span class="v"><b>${svNum(c.impressions)}</b>${svChg(c.impressions, c.prior_impressions, "pct")}</span><span class="s">against the month before</span></div>`);
  }
  if (SV_AIW && SV_AIW.ready && SV_AIW.latest) {   // item 182
    const ms = SV_AIW.months || [], now = ms[ms.length - 1], prev = ms.length > 1 ? ms[ms.length - 2] : null;
    if (now) tiles.push(`<div class="sv-stat"><span class="l">Named in AI answers</span><span class="v"><b>${now.named} of ${now.asked}</b>${prev ? svChg(now.named, prev.named, "count") : ""}</span><span class="s">questions · checked ${esc(svWhen(SV_AIW.latest.checked_at))}</span></div>`);
  }
  if (SV && SV.follow && c && c.status === "connected") {
    const best = SV_FOLLOW && SV_FOLLOW.terms ? SV_FOLLOW.terms.filter((t) => t.now && t.now.position != null).sort((a, b) => a.now.position - b.now.position)[0] : null;
    tiles.push(`<div class="sv-stat"><span class="l">Searches you follow</span><span class="v"><b>${SV.follow.count}</b></span><span class="s">${best ? `best: #${Math.round(best.now.position)} for “${esc(best.term)}”` : `up to ${SV.follow.max}`}</span></div>`);
  }
  host.hidden = !tiles.length;
  host.innerHTML = tiles.join("");
}
// ── item 219: why visits fell, and the searches almost on page one ──
// GET /visibility brings both (routes/search_tab.ts): `drop` when last month's visits fell enough to
// say why, from where they came from and the search that lost the most; `near_miss` the searches
// Google showed the site for at places 8 to 20, each with the page and one thing to fix there.
function renderSvDrop() {
  const card = $("svDropCard"); if (!card) return;
  const d = SV && SV.drop;
  card.hidden = !d;
  if (!d) { card.textContent = ""; return; }
  const parts = (d.parts || []).slice(0, 4), max = Math.max(1, ...parts.map((p) => Math.abs(p.change)));
  card.innerHTML = `<div><h3 id="svDropH"><span class="sv-drop-dot" aria-hidden="true">▼</span>Visits fell ${esc(d.pct)}% in ${esc(d.month_label)}</h3><p>${esc(d.sentence)}</p>${d.search ? `<button type="button" class="sv-linkbtn" id="svDropSee">See the searches ›</button>` : ""}</div>`
    + (parts.length ? `<div><p class="sv-drop-k">Where the visits came from, ${esc(d.month_label)} against ${esc(d.prior_label)}</p><ul>${parts.map((p) => `<li><span>${esc(p.name)}</span><svg class="bar" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true"><rect class="${p.change < 0 ? "down" : "up"}" width="${Math.max(3, Math.round(Math.abs(p.change) / max * 100))}" height="8" rx="4"/></svg><span class="c ${p.change < 0 ? "down" : "up"}">${p.change > 0 ? "+" : "−"}${svNum(Math.abs(p.change))}</span><span class="w">${svNum(p.now)} (was ${svNum(p.was)})</span></li>`).join("")}</ul></div>` : "");
  const see = $("svDropSee"); if (see) see.addEventListener("click", () => { const n = $("svConsoleCard"); if (n) { n.hidden = false; n.scrollIntoView({ behavior: "smooth", block: "center" }); } });
}
const SV_NEAR_GO = { hidden: "Improve the page", title: "Improve the page", description: "Improve the page", already: "Ask for reviews", check: "Open the page" };
function renderSvNear() {
  const card = $("svNearCard"), host = $("svNear"); if (!card || !host) return;
  const nm = SV && SV.near_miss, list = (nm && nm.list) || [];
  card.hidden = !list.length;
  if (!list.length) { host.textContent = ""; return; }
  $("svNearN").textContent = list.length === 1 ? "1 search" : `${list.length} searches`;
  $("svNearSrc").textContent = `From Search Console · ${svMonth(nm.period)}`;
  const live = SV.address && SV.address.url ? SV.address.url.replace(/\/$/, "") : "";
  host.innerHTML = `<p class="hint">Google shows this site at places ${esc(nm.from)} to ${esc(nm.to)} for these searches: the bottom of page one or the top of page two. One fix on the right page can bring each one up.</p>
    <table class="sv-near-t"><caption class="sr-only">Searches almost on page one, with the page Google shows and one thing to fix</caption>
    <thead><tr><th scope="col">Search</th><th scope="col">Place · ${esc(svMonth(nm.period).slice(0, 3))}</th><th scope="col">Seen</th><th scope="col">Clicks</th><th scope="col">The page Google shows</th><th scope="col">One thing to fix</th><th scope="col"><span class="sr-only">Do it</span></th></tr></thead>
    <tbody>${list.map((x, i) => `<tr><td class="q">${esc(x.term)}</td><td class="pl"><b>#${esc(Math.round(x.place))}</b>${x.prior_place == null ? `<span class="sv-chg">New</span>` : svChg(x.place, x.prior_place, "place")}</td><td class="sn">${svNum(x.seen)}</td><td class="ck">${svNum(x.clicks)}</td><td class="pg"><span class="sv-near-ph">Google shows </span>${esc(x.path)}${x.path === "/" ? " (Home)" : ""}</td><td class="fx">${esc(x.words)}</td><td class="act">${x.fix === "check" && !live ? "" : `<button type="button" class="sv-near-go" data-near="${i}" aria-label="${esc(SV_NEAR_GO[x.fix] || "Open")}: ${esc(x.term)}">${esc(SV_NEAR_GO[x.fix] || "Open")}</button>`}</td></tr>`).join("")}</tbody></table>
    <p class="hint">Place is Google’s average for the month; page one is places 1 to 10. The fix is checked against the page’s own title and description on Google, never guessed.</p>`;
  host.querySelectorAll("[data-near]").forEach((b) => b.addEventListener("click", () => svNearGo(list[Number(b.getAttribute("data-near"))], live)));
}
function svNearGo(x, live) {
  if (!x) return;
  if (x.fix === "already") return go("reviews");
  if (x.fix === "check" || !x.key) { if (live) window.open(live + x.path, "_blank", "noopener"); return; }
  if (x.key === "home") { const n = $(x.fix === "description" ? "f-seo_description" : "f-seo_title"); if (n) { n.scrollIntoView({ behavior: "smooth", block: "center" }); n.focus({ preventScroll: true }); } return; }
  pgOpenSettings({ href: x.path });   // that page's own title and description on Google, and whether Google may show it
}
const SV_GO_WORD = { phrases: "Pick a page", publish: "Publish", "tool:hide": "Open", health: "See it", "connect:console": "Connect", domain: "Connect", wording: "Write", pages: "Open Pages", review: "Read it", "connect:listing": "Connect", files: "Open Files", "tool:llms": "Write", follow: "Follow", monitor: "Add it" };
function svTodoGo(t) {
  const g = String(t.go || "");
  const toCard = (id) => { const n = $(id); if (n) { n.hidden = false; n.scrollIntoView({ behavior: "smooth", block: "center" }); } };
  if (g === "publish") return openRitual();
  if (g === "domain") return openFoundationsDesk({ domain: true });
  if (g === "monitor") { location.hash = "monitor"; return; }
  if (g === "wording") { const n = $(t.key === "description" ? "f-seo_description" : "f-seo_title"); if (n) { n.scrollIntoView({ behavior: "smooth", block: "center" }); n.focus({ preventScroll: true }); } return; }
  if (g === "pages") return go("pages");
  if (g === "files") return go("media");
  if (g === "health") return hbScrollTo("healthCard");
  if (g === "review") return toCard("svScore");
  if (g === "connect:console") return toCard("svConsoleCard");
  if (g === "connect:listing") return toCard("svListingCard");
  if (g === "follow") return svOpenFollow();
  if (g === "phrases") { const ph = String(t.key).replace(/^phrase:/, ""); SV_PH_PICK = { phrase: ph, key: null, title: svPhraseTitle(ph) }; renderSvPhrases(); return toCard("svPhrasesCard"); }
  if (g.startsWith("tool:")) return svOpenTool(g.slice(5));
}
/* ── item 160: what people type to find you ── */
// The two or three phrases the business wants to be found for, each checked against every
// page's search headline (lib/search_phrases.ts). GET /visibility brings them; a change
// saves the list and answers with the new view, and the checklist's phrase tasks follow it.
// A missing one gets Add it to a page: pick the page that is about it, and its search
// headline gets the phrase, saved to the draft like any other wording.
let SV_PH_PICK = null;   // { phrase, key, title } while "Which page is about it?" is open
function svPhraseTitle(phrase) {
  const name = String((S.identity && S.identity.business_name) || "").trim();
  const lead = phrase.charAt(0).toUpperCase() + phrase.slice(1);
  const t = name && !phrase.toLowerCase().includes(name.toLowerCase()) ? `${lead} — ${name}` : lead;
  return t.length > SEO_TITLE_MAX ? lead : t;
}
function svPhrasesTake(view) {
  if (!SV || !view) return;
  SV.phrases = view;
  if (Array.isArray(SV.tasks) && Array.isArray(view.tasks)) {
    // the phrase tasks sit where the server ranks them, after the headline's own
    const rest = SV.tasks.filter((t) => !String(t.key).startsWith("phrase:"));
    const at = rest.findIndex((t) => t.key === "title") + 1;
    const all = at > 0 ? [...rest.slice(0, at), ...view.tasks, ...rest.slice(at)] : rest.concat(view.tasks);
    const rank = { critical: 0, high: 1, medium: 2 };
    SV.tasks = all.map((t, n) => [t, n]).sort((a, b) => Number(a[0].done) - Number(b[0].done) || (rank[a[0].priority] ?? 3) - (rank[b[0].priority] ?? 3) || a[1] - b[1]).map(([t]) => t);
  }
  renderSvPhrases(); renderSeoTasks();
}
async function svPhrasesSave(list, btn) {
  if (btn) btn.disabled = true;
  try { svPhrasesTake((await api("PUT", "/visibility/phrases", { phrases: list })).data); return true; }
  catch (err) { if (btn) btn.disabled = false; toast(nice(err), true); return false; }
}
function renderSvPhrases() {
  const card = $("svPhrasesCard"), host = $("svPhrases"); if (!card || !host) return;
  const v = SV && SV.phrases;
  card.hidden = !v;
  if (!v) return;
  const list = v.list || [], max = v.max || 3;
  if (SV_PH_PICK && !list.some((x) => x.phrase === SV_PH_PICK.phrase && !x.found)) SV_PH_PICK = null;
  $("svPhrasesN").textContent = `${list.length} of ${max}`;
  host.innerHTML = "";
  host.appendChild(el("p", "sv-ph-intro", "Two to four words each, the way a customer would type them into Google. We check that each one is in the search headline of one of your pages, the line Google shows in bold."));
  list.forEach((x) => {
    const row = el("div", "sv-ph-row"); row.dataset.phrase = x.phrase;
    const q = el("span", "sv-ph-q"); q.innerHTML = uiIcon("search", 13); q.appendChild(document.createTextNode(x.phrase)); row.appendChild(q);
    const st = el("span", "sv-ph-st " + (x.found ? "ok" : "no")); st.innerHTML = uiIcon(x.found ? "check" : "clock", 12);
    st.appendChild(document.createTextNode(x.found ? `In your ${x.found.label} page’s search headline` : "Not in any page’s search headline yet"));
    row.appendChild(st);
    if (!x.found) {
      const add = el("button", "sv-ph-add", "Add it to a page"); add.type = "button";
      add.addEventListener("click", () => { SV_PH_PICK = { phrase: x.phrase, key: null, title: svPhraseTitle(x.phrase) }; renderSvPhrases(); const first = host.querySelector(".sv-ph-page"); if (first) first.focus(); });
      row.appendChild(add);
    }
    const off = el("button", "sv-ph-x"); off.type = "button"; off.innerHTML = uiIcon("x", 14); off.setAttribute("aria-label", `Take “${x.phrase}” off`);
    off.addEventListener("click", () => svPhrasesSave(list.map((y) => y.phrase).filter((y) => y !== x.phrase), off));
    row.appendChild(off);
    host.appendChild(row);
    if (SV_PH_PICK && SV_PH_PICK.phrase === x.phrase) host.appendChild(svPhrasePicker(v, x));
  });
  if (list.length >= max) return;
  const form = el("form", "sv-ph-new");
  const inp = el("input"); inp.type = "text"; inp.maxLength = 60; inp.id = "svPhraseNew";
  inp.placeholder = ["Add a phrase, the way a customer would type it", "Add a second phrase", "Add a third phrase"][list.length] || "Add a phrase";
  inp.setAttribute("aria-label", inp.placeholder);
  const addBtn = el("button", "pillbtn", "Add"); addBtn.type = "submit";
  form.append(inp, addBtn);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const words = inp.value.trim(); if (!words) { inp.focus(); return; }
    if (await svPhrasesSave([...list.map((y) => y.phrase), words], addBtn)) { const n = $("svPhraseNew"); if (n) n.focus(); }
  });
  host.appendChild(form);
  const ideas = (v.ideas || []).filter((i) => !list.some((y) => y.phrase === i));
  if (!ideas.length) return;
  const row = el("div", "sv-ph-ideas"); row.appendChild(el("span", null, "✦ Ideas from your services and area:"));
  ideas.forEach((i) => { const c = el("button", "sv-ph-idea", "+ " + i); c.type = "button"; c.setAttribute("aria-label", `Add “${i}”`); c.addEventListener("click", () => svPhrasesSave([...list.map((y) => y.phrase), i], c)); row.appendChild(c); });
  host.appendChild(row);
}
function svPhrasePicker(v, x) {
  const box = el("div", "sv-ph-pick"); box.setAttribute("role", "group"); box.setAttribute("aria-labelledby", "svPhPickH");
  const h = el("h4", null, `Which page is about “${x.phrase}”?`); h.id = "svPhPickH"; box.appendChild(h);
  (v.pages || []).forEach((pg) => {
    const b = el("button", "sv-ph-page"); b.type = "button"; b.setAttribute("aria-pressed", SV_PH_PICK.key === pg.key ? "true" : "false");
    b.append(el("b", null, pg.label), el("span", null, "Now: " + pg.title));
    b.addEventListener("click", () => { SV_PH_PICK.key = pg.key; renderSvPhrases(); const n = $("svPhraseTitle"); if (n) n.focus(); });
    box.appendChild(b);
  });
  if (SV_PH_PICK.key) {
    const out = el("div", "sv-ph-out");
    const lab = el("label", null, "New search headline"); lab.setAttribute("for", "svPhraseTitle");
    const inp = el("input"); inp.type = "text"; inp.id = "svPhraseTitle"; inp.maxLength = 120; inp.value = SV_PH_PICK.title;
    inp.addEventListener("input", () => { SV_PH_PICK.title = inp.value; });
    out.append(lab, inp); box.appendChild(out);
  }
  const acts = el("div", "sv-ph-acts");
  const use = el("button", "pillbtn inked", "Use this headline"); use.type = "button"; use.disabled = !SV_PH_PICK.key;
  use.addEventListener("click", () => svPhraseUse(use));
  const not = el("button", "pillbtn", "Not now"); not.type = "button";
  not.addEventListener("click", () => { SV_PH_PICK = null; renderSvPhrases(); });
  acts.append(use, not); box.appendChild(acts);
  box.appendChild(el("p", "hint", "It saves to your draft and reaches Google when you publish."));
  return box;
}
async function svPhraseUse(btn) {
  const pick = SV_PH_PICK; if (!pick || !pick.key) return;
  const title = String(pick.title || "").replace(/\s+/g, " ").trim();
  if (!title) { const n = $("svPhraseTitle"); if (n) n.focus(); return; }
  btn.disabled = true; btn.textContent = "Saving…";
  try {
    if (pick.key === "home") {
      await api("PUT", "/identity", { seo_title: title });
      S.identity = { ...(S.identity || {}), seo_title: title };
      const f = $("f-seo_title"); if (f) f.value = title;
      renderSearchPreview();
    } else {
      await settingsPut(() => { const map = { ...((S.settings && S.settings.page_seo) || {}) }; map[pick.key] = { ...(map[pick.key] || {}), title }; return { page_seo: map }; });
    }
    scheduleChangesRefresh();
    SV_PH_PICK = null;
    toast("Saved — publish to apply");
    svPhrasesTake((await api("GET", "/visibility/phrases")).data);
  } catch (err) { btn.disabled = false; btn.textContent = "Use this headline"; toast(nice(err), true); }
}
const SV_TODO = { show: "all", done: false };
const SV_PRI_WORD = { critical: "Critical", high: "High", medium: "Medium" };
function renderSvTodo() {
  const host = $("seoTasks"); if (!host) return;
  const h = $("svChecklistH"); if (h) h.textContent = "To do";
  // the home page's wording is read as it's typed, so the list follows the fields below
  const w = seoHomeWords();
  const tasks = SV.tasks.map((t) => (t.key === "title" ? { ...t, done: !!w.titleOwn } : t.key === "description" ? { ...t, done: !!w.descOwn } : t));
  const open = tasks.filter((t) => !t.done), done = tasks.filter((t) => t.done);
  if (SV_TODO.show !== "all" && !open.some((t) => t.priority === SV_TODO.show)) SV_TODO.show = "all";
  host.innerHTML = "";
  const top = el("div", "sv-todo-h");
  top.appendChild(el("span", "sv-todo-n", `${open.length} open · ${done.length} done`));
  const chips = el("div", "sv-todo-f"); chips.setAttribute("role", "group"); chips.setAttribute("aria-label", "Show");
  [["all", "All"], ["critical", "Critical"], ["high", "High"], ["medium", "Medium"]].forEach(([k, label]) => {
    const n = k === "all" ? open.length : open.filter((t) => t.priority === k).length;
    if (k !== "all" && !n) return;
    const b = el("button", "sv-fchip", `${label} · ${n}`); b.type = "button"; b.dataset.show = k; b.setAttribute("aria-pressed", SV_TODO.show === k ? "true" : "false");
    b.addEventListener("click", () => { SV_TODO.show = k; renderSvTodo(); const nb = host.querySelector(`[data-show="${k}"]`); if (nb) nb.focus(); });
    chips.appendChild(b);
  });
  top.appendChild(chips);
  if (done.length) {
    const tg = el("button", "sv-linkbtn", SV_TODO.done ? "Hide done" : "Show done"); tg.type = "button"; tg.setAttribute("aria-expanded", SV_TODO.done ? "true" : "false");
    tg.addEventListener("click", () => { SV_TODO.done = !SV_TODO.done; renderSvTodo(); const nb = host.querySelector(".sv-linkbtn"); if (nb) nb.focus(); });
    top.appendChild(tg);
  }
  host.appendChild(top);
  if (!open.length) host.appendChild(el("p", "hint", "Everything here is done. Google has what it needs."));
  const ul = el("ul", "sv-todo");
  open.filter((t) => SV_TODO.show === "all" || t.priority === SV_TODO.show).concat(SV_TODO.done ? done : []).forEach((t) => {
    const li = el("li", t.done ? "done" : ""); li.dataset.task = t.key;
    const dot = el("span", "sv-dot " + (t.done ? "done" : t.priority === "critical" ? "crit" : "open")); dot.setAttribute("aria-hidden", "true"); li.appendChild(dot);
    const tx = el("div", "sv-todo-t");
    const b = el("b"); b.appendChild(el("span", "sr-only", t.done ? "Done: " : "To do: ")); b.appendChild(document.createTextNode(t.title)); tx.appendChild(b);
    if (t.sub && !t.done) tx.appendChild(el("span", null, t.sub));
    li.appendChild(tx);
    li.appendChild(el("span", "sv-pri " + t.priority, SV_PRI_WORD[t.priority] || t.priority));
    if (!t.done && t.go) { const go2 = el("button", "sv-go", (SV_GO_WORD[t.go] || "Open") + " ›"); go2.type = "button"; go2.setAttribute("aria-label", `${SV_GO_WORD[t.go] || "Open"}: ${t.title}`); go2.addEventListener("click", () => svTodoGo(t)); li.appendChild(go2); }
    ul.appendChild(li);
  });
  host.appendChild(ul);
}
function renderSvMovers() {
  const card = $("svMoversCard"), host = $("svMovers"); if (!card || !host) return;
  const m = SV && SV.movers;
  const rows = m ? [...(m.up || []), ...(m.down || [])] : [];
  card.hidden = !rows.length;
  if (!rows.length) return;
  const max = Math.max(1, ...rows.map((r) => Math.abs(Number(r.delta) || 0)));
  host.innerHTML = `<p class="hint">Clicks from Google, ${esc(svMonth(m.period))} against ${esc(svMonth(m.prior_period))}</p><ul class="sv-mv">${rows.map((r) => {
    const d = Number(r.delta) || 0;
    return `<li><div class="r"><span class="p">${esc(r.path)}</span><span class="c">${svNum(r.clicks)} click${r.clicks === 1 ? "" : "s"}</span><span class="sv-chg ${d > 0 ? "up" : "down"}"><span aria-hidden="true">${d > 0 ? "▲" : "▼"} ${Math.abs(d)}</span><span class="sr-only">${d > 0 ? "up" : "down"} ${Math.abs(d)} on the month before</span></span></div><svg class="bar" viewBox="0 0 100 5" preserveAspectRatio="none" aria-hidden="true"><rect class="${d < 0 ? "down" : "up"}" width="${Math.max(2, Math.round(Math.abs(d) / max * 100))}" height="5" rx="2.5"/></svg></li>`;
  }).join("")}</ul>`;
}
// ── item 181: searches to follow ──
let SV_FOLLOW = null, SV_FOL_PICK = 0;
async function loadSvFollow() {
  try { SV_FOLLOW = (await api("GET", "/visibility/follow")).data; } catch (_) { SV_FOLLOW = null; }
  renderSvFollow(); renderSvNums();
}
const svFolMonth = (p) => svMonth(p).slice(0, 3);
function svSpark(months) {
  const pts = months.filter((m) => m.position != null);
  if (pts.length < 2) return "";
  const W = 84, H = 24, mx = Math.max(...pts.map((m) => m.position)), mn = Math.min(...pts.map((m) => m.position));
  const xy = pts.map((m, i) => `${(2 + i * (W - 4) / (pts.length - 1)).toFixed(1)},${(3 + (m.position - mn) / Math.max(1, mx - mn) * (H - 6)).toFixed(1)}`).join(" ");
  return `<svg class="sv-spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${xy}"/></svg>`;
}
function svFollowChart(t) {
  const months = t.months || [];
  if (!months.length) return `<p class="hint">Google hasn’t shown the site for “${esc(t.term)}” in a whole month yet. Its line starts the first month it does.</p>`;
  const W = 440, H = 210, L = 30, R = 14, T = 22, B = 26;
  const pos = months.map((m) => m.position).filter((v) => v != null);
  const worst = Math.max(10, ...pos), clicksMax = Math.max(1, ...months.map((m) => m.clicks || 0));
  const x = (i) => L + (months.length < 2 ? (W - L - R) / 2 : i * (W - L - R) / (months.length - 1));
  const y = (p) => T + (p - 1) / Math.max(1, worst - 1) * (H - T - B - 40);
  const grid = [1, Math.round((1 + worst) / 2), worst].map((p) => `<line class="gr" x1="${L}" x2="${W - R}" y1="${y(p).toFixed(1)}" y2="${y(p).toFixed(1)}"/><text x="0" y="${(y(p) + 3.5).toFixed(1)}">#${p}</text>`).join("");
  const bars = months.map((m, i) => { const h = (m.clicks || 0) / clicksMax * 36; return `<rect class="bar" x="${(x(i) - 7).toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="14" height="${h.toFixed(1)}" rx="3"/>`; }).join("");
  const withPos = months.map((m, i) => ({ m, i })).filter((o) => o.m.position != null);
  const line = withPos.length > 1 ? `<polyline class="ln" points="${withPos.map((o) => `${x(o.i).toFixed(1)},${y(o.m.position).toFixed(1)}`).join(" ")}"/>` : "";
  const dots = withPos.map((o) => `<circle class="pt" cx="${x(o.i).toFixed(1)}" cy="${y(o.m.position).toFixed(1)}" r="4"/><text class="v" x="${x(o.i).toFixed(1)}" y="${(y(o.m.position) - 9).toFixed(1)}" text-anchor="middle">${Math.round(o.m.position)}</text>`).join("");
  const labels = months.map((m, i) => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(svFolMonth(m.period))}</text>`).join("");
  const aria = `“${t.term}”, place on Google by month: ` + months.map((m) => `${svFolMonth(m.period)} ${m.position == null ? "not seen" : "#" + Math.round(m.position)}, ${m.clicks} click${m.clicks === 1 ? "" : "s"}`).join("; ");
  return `<svg class="sv-fchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${grid}${bars}${line}${dots}${labels}</svg>`;
}
function renderSvFollow() {
  const card = $("svFollowCard"), host = $("svFollow"); if (!card || !host) return;
  const f = SV_FOLLOW;
  card.hidden = !(f && f.connected);
  if (card.hidden) return;
  const n = $("svFollowN"); if (n) n.textContent = `${f.terms.length} of ${f.max}`;
  const btn = $("btnSvFollow"); if (btn) { btn.disabled = f.terms.length >= f.max; btn.onclick = svOpenFollow; }
  host.innerHTML = "";
  if (!f.terms.length) {
    host.appendChild(el("p", "hint", "Pick up to ten searches that matter to this business. Each month you’ll see where the site showed up on Google for them, and how many clicked."));
  } else {
    if (SV_FOL_PICK >= f.terms.length) SV_FOL_PICK = 0;
    const wrap = el("div", "sv-fol");
    const mo = svFolMonth(f.month || "");
    wrap.innerHTML = `<div><table><caption class="sr-only">Searches you follow</caption><thead><tr><th scope="col">Search</th><th scope="col">Place${mo ? " · " + esc(mo) : ""}</th><th scope="col">Clicks${mo ? " · " + esc(mo) : ""}</th><th scope="col" class="mo">Six months</th><th scope="col"><span class="sr-only">Stop following</span></th></tr></thead><tbody>${f.terms.map((t, i) => `<tr class="${i === SV_FOL_PICK ? "on" : ""}" data-i="${i}"><td><button type="button" class="term" data-pick="${i}" aria-pressed="${i === SV_FOL_PICK}">${esc(t.term)}</button></td><td><span class="row">${t.now && t.now.position != null ? `<b>#${Math.round(t.now.position)}</b>${svChg(t.now.position, t.prior && t.prior.position, "place")}` : `<span class="hint">Not seen</span>`}</span></td><td><span class="row"><b>${svNum(t.now ? t.now.clicks : 0)}</b>${t.now && t.prior ? svChg(t.now.clicks, t.prior.clicks, "pct") : ""}</span></td><td class="mo">${svSpark(t.months || []) || `<span class="hint">From ${esc(svFolMonth(String(t.added_at || "").slice(0, 7)) || "now")}</span>`}</td><td><button type="button" class="x" data-unfollow="${i}" aria-label="Stop following ${esc(t.term)}">✕</button></td></tr>`).join("")}</tbody></table></div>`;
    const chart = el("div");
    chart.innerHTML = `<p class="hint">“${esc(f.terms[SV_FOL_PICK].term)}”: its place on Google by month (higher up is better), and clicks as bars. From Search Console, a whole month at a time.</p>${svFollowChart(f.terms[SV_FOL_PICK])}`;
    wrap.appendChild(chart);
    host.appendChild(wrap);
    host.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => { SV_FOL_PICK = Number(b.dataset.pick); renderSvFollow(); const nb = host.querySelector(`[data-pick="${SV_FOL_PICK}"]`); if (nb) nb.focus(); }));
    host.querySelectorAll("[data-unfollow]").forEach((b) => b.addEventListener("click", () => { const i = Number(b.dataset.unfollow); svFollowSave(f.terms.filter((_, j) => j !== i).map((t) => t.term), "Stopped following “" + f.terms[i].term + "”."); }));
  }
  if (f.suggestions && f.suggestions.length && f.terms.length < f.max) {
    const sug = el("div", "sv-sugs"); sug.appendChild(el("span", null, "People also found you with:"));
    f.suggestions.slice(0, 4).forEach((s) => { const b = el("button", "sv-sug", "+ " + s.term); b.type = "button"; b.addEventListener("click", () => svFollowSave(f.terms.map((t) => t.term).concat(s.term), "Following “" + s.term + "”.")); sug.appendChild(b); });
    host.appendChild(sug);
  }
}
async function svFollowSave(terms, said) {
  try {
    const r = await api("PUT", "/visibility/follow", { terms });
    SV_FOLLOW = r.data; if (SV && SV.follow) SV.follow.count = (r.data.terms || []).length;
    renderSvFollow(); renderSvNums(); toast(said || "Saved.");
    if (r.data && r.data.added && r.data.added.length) setTimeout(loadSvFollow, 6000);   // a new search's past months arrive after the answer
    return true;
  } catch (err) { toast(nice(err), true); return false; }
}
function svOpenFollow() {
  const f = SV_FOLLOW || { terms: [], suggestions: [], max: 10 };
  const d = svDialog("Follow a search", `Up to ${f.max}. Each month we read where the site showed up on Google for it, and how many clicked.`);
  const inp = el("input"); inp.type = "text"; inp.maxLength = 100; inp.placeholder = "realtor near me"; inp.setAttribute("aria-label", "A search to follow");
  d.body.appendChild(inp);
  if (f.suggestions && f.suggestions.length) {
    d.body.appendChild(el("p", "hint", "From what people searched last month"));
    const ul = el("ul", "sv-mv");
    f.suggestions.forEach((s) => {
      const li = el("li"); li.appendChild(el("span", "p", s.term)); li.appendChild(el("span", "c", `${svNum(s.impressions)} times seen · ${svNum(s.clicks)} click${s.clicks === 1 ? "" : "s"}`));
      const b = el("button", "sv-go", "Follow"); b.type = "button"; b.setAttribute("aria-label", "Follow " + s.term);
      b.addEventListener("click", async () => { if (await svFollowSave(f.terms.map((t) => t.term).concat(s.term), "Following “" + s.term + "”.")) d.close(); });
      li.appendChild(b); ul.appendChild(li);
    });
    d.body.appendChild(ul);
  }
  d.body.appendChild(el("p", "hint", "A search nobody has used yet shows from the month it first appears. Google gives an average place for the month, not a daily rank."));
  const acts = el("div", "acts"); const go2 = el("button", "pillbtn sm inked", "Follow it"); go2.type = "submit"; acts.appendChild(go2); d.body.appendChild(acts);
  const follow = async () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } if (await svFollowSave(f.terms.map((t) => t.term).concat(v), "Following “" + v.toLowerCase() + "”.")) d.close(); };
  go2.addEventListener("click", follow);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); follow(); } });
  setTimeout(() => inp.focus(), 30);
}
// ── item 182: AI answers over time. GET /visibility/ai: the client's questions, the monthly
// switch (it lives on Settings › Monthly report: it costs money), a point a month, and what
// Claude said at the latest check. Before migration 0172 (ready: false) the card stays away and
// the latest free-tool result below speaks as before.
let SV_AIW = null;
async function loadSvAiWatch() {
  try { SV_AIW = (await api("GET", "/visibility/ai")).data; } catch (_) { SV_AIW = null; }
  renderSvAiWatch(); renderSvNums();
}
const svAiMonth = (p) => svMonth(p).slice(0, 3);
function svAiChart(months) {
  if (months.length < 2) return "";
  const W = 380, H = 160, L = 22, R = 14, T = 20, B = 24, max = Math.max(4, ...months.map((m) => m.asked || 0));
  const x = (i) => L + i * (W - L - R) / (months.length - 1), y = (n) => T + (1 - n / max) * (H - T - B);
  const grid = [max, Math.round(max / 2), 0].map((n) => `<line class="gr" x1="${L}" x2="${W - R}" y1="${y(n).toFixed(1)}" y2="${y(n).toFixed(1)}"/><text x="0" y="${(y(n) + 3.5).toFixed(1)}">${n}</text>`).join("");
  const pts = months.map((m, i) => `${x(i).toFixed(1)},${y(m.named || 0).toFixed(1)}`).join(" ");
  const dots = months.map((m, i) => `<circle class="pt" cx="${x(i).toFixed(1)}" cy="${y(m.named || 0).toFixed(1)}" r="4"/><text class="v" x="${x(i).toFixed(1)}" y="${(y(m.named || 0) - 9).toFixed(1)}" text-anchor="middle">${m.named || 0}</text><text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(svAiMonth(m.month))}</text>`).join("");
  const aria = "Questions where Claude named you, by month: " + months.map((m) => `${svAiMonth(m.month)} ${m.named} of ${m.asked}`).join(", ");
  return `<svg class="sv-fchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${grid}<polyline class="ln" points="${pts}"/>${dots}</svg>`;
}
function svMark(named) {
  const k = named === true ? "yes" : named === false ? "no" : "unknown";
  return `<span class="sv-mark ${k}"><span aria-hidden="true">${named === true ? "✓" : named === false ? "✕" : "–"}</span><span class="sr-only">${named === true ? "named you" : named === false ? "didn’t name you" : "not asked yet"}</span></span>`;
}
function renderSvAiWatch() {
  const card = $("svAiWatch"), host = $("svAiW"); if (!card || !host) return;
  const a = SV_AIW;
  card.hidden = !(a && a.ready);
  const oldH = $("svAiH"); if (oldH) oldH.textContent = card.hidden ? "In AI answers" : "Latest AI check";
  if (card.hidden) return;
  const name = (S.identity && S.identity.business_name) || "you";
  const meta = $("svAiWMeta");
  if (meta) meta.textContent = a.watch.enabled ? `${a.latest ? "Checked " + svWhen(a.latest.checked_at) + " · " : ""}next check ${a.watch.next} · every month` : "Monthly checks are off";
  const add = $("btnSvAiQ"); if (add) { add.onclick = svOpenAiQuestions; }
  const latest = a.latest, months = a.months || [];
  const prev = months.length > 1 ? months[months.length - 2] : null;
  const engines = latest && latest.engines.length ? latest.engines : a.engines;
  const resultOf = (q) => latest ? (latest.results || []).find((r) => String(r.q).toLowerCase() === String(q).toLowerCase()) : null;
  const scope = new URLSearchParams(location.search).get("client");
  const settingsHref = "/settings.html" + (scope ? "?client=" + encodeURIComponent(scope) : "") + "#report";
  const left = latest
    ? `<div class="sv-ai-big"><b>${latest.results ? latest.results.filter((r) => (r.answers || []).some((x) => x.named === true)).length : 0} of ${(latest.results || []).length}</b>${prev ? svChg(months[months.length - 1].named, prev.named, "count").replace(/<span class="sv-chg/, `<span title="against ${esc(svMonth(prev.month))}" class="sv-chg`) : ""}</div><p class="hint">questions where ${esc(engines.map((e) => e.name).join(" or "))} named ${esc(name)}</p>${svAiChart(months)}`
    : `<div class="sv-ai-big"><b>—</b></div><p class="hint">${a.watch.enabled ? "The first check runs soon, then on the 1st of each month." : "No monthly check yet."}</p>`;
  const rows = (a.questions || []).map((q, i) => {
    const r = resultOf(q.text);
    return `<tr><td>${esc(q.text)}</td>${engines.map((e) => `<td class="m">${svMark(r ? ((r.answers || []).find((x) => x.engine === e.id) || {}).named ?? null : null)}</td>`).join("")}<td class="w">${r ? `<button type="button" class="sv-go" data-said="${i}" aria-label="What ${esc(engines.map((e) => e.name).join(" and "))} said: ${esc(q.text)}">What they said ›</button>` : ""}</td></tr>`;
  }).join("");
  host.innerHTML = `<div class="sv-ai"><div class="sv-ai-l">${left}</div><div class="sv-ai-r"><table class="sv-ai-t"><caption class="sr-only">The questions asked each month</caption><thead><tr><th scope="col">Question</th>${engines.map((e) => `<th scope="col" class="m">${esc(e.name)}</th>`).join("")}<th scope="col"><span class="sr-only">Answers</span></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="hint">${a.questions.length} question${a.questions.length === 1 ? "" : "s"}${a.defaults ? ", the AI check’s own to start; change them any time" : ""}. Only Claude is asked today; ChatGPT and Gemini join this table once their keys are added, each about the same again.</p></div></div>
    <p class="hint">${a.watch.enabled ? `Checks run on the 1st of each month. ${esc(a.watch.cost)}.` : `Monthly checks cost money, so they’re off until the studio switches them on. ${esc(a.watch.cost)}.`} <a href="${esc(settingsHref)}" data-needs="configure">Monthly report settings</a></p>`;
  host.querySelectorAll("[data-said]").forEach((b) => b.addEventListener("click", () => svAiSaid(a.questions[Number(b.dataset.said)].text)));
}
function svAiSaid(q) {
  const a = SV_AIW; const r = a && a.latest ? (a.latest.results || []).find((x) => String(x.q).toLowerCase() === String(q).toLowerCase()) : null;
  if (!r) return;
  const d = svDialog(q, `Asked ${svWhen(a.latest.checked_at)}. Each assistant answered with a web search, the way a customer would ask it.`);
  (r.answers || []).forEach((x) => {
    const box = el("div", "sv-said");
    box.innerHTML = `<div class="who">${svMark(x.named)} <b>${esc(x.name)}</b> <span class="${x.named ? "yes" : "no"}">${x.named === true ? "Named you" : x.named === false ? "Didn’t name you" : "Didn’t answer in time"}</span></div>${x.excerpt ? `<p>“${esc(x.excerpt)}”</p>` : ""}${x.others && x.others.length ? `<p class="hint">Named ${x.named ? "beside" : "instead of"} you: ${esc(x.others.join(", "))}</p>` : ""}`;
    d.body.appendChild(box);
  });
}
function svOpenAiQuestions() {
  const a = SV_AIW || { questions: [], max: 10 };
  let list = (a.questions || []).map((q) => q.text);
  const d = svDialog("Questions to ask each month", `Up to ${a.max}. A question that names the business tests what the assistant knows; the rest test whether it suggests the business.`);
  const ul = el("ul", "sv-mv"); d.body.appendChild(ul);
  const msg = el("p", "hint"); msg.setAttribute("role", "status");
  const inp = el("input"); inp.type = "text"; inp.maxLength = 200; inp.placeholder = "Who is a good realtor in Burbank?"; inp.setAttribute("aria-label", "A question to ask");
  const acts = el("div", "acts"); const addB = el("button", "pillbtn sm inked", "Add the question"); addB.type = "button"; acts.appendChild(addB);
  const save = async (next, said) => {
    try {
      const r = await api("PUT", "/visibility/ai/questions", { questions: next });
      list = (r.data && r.data.questions) || next; paint(); msg.textContent = said + " " + ((r.data && r.data.cost) || "");
      loadSvAiWatch();
      return true;
    } catch (err) { toast(nice(err), true); return false; }
  };
  const paint = () => {
    ul.innerHTML = "";
    list.forEach((q, i) => {
      const li = el("li"); li.appendChild(el("span", "p", q));
      const x = el("button", "sv-fol-x", "✕"); x.type = "button"; x.setAttribute("aria-label", "Remove: " + q); x.disabled = list.length <= 1;
      x.addEventListener("click", () => save(list.filter((_, j) => j !== i), "Removed."));
      li.appendChild(x); ul.appendChild(li);
    });
    addB.disabled = list.length >= a.max; inp.disabled = list.length >= a.max;
  };
  paint();
  d.body.append(inp, acts, msg);
  const addIt = async () => { const v = inp.value.trim(); if (!v) { inp.focus(); return; } if (await save(list.concat(v), "Added.")) { inp.value = ""; inp.focus(); } };
  addB.addEventListener("click", addIt);
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addIt(); } });
  setTimeout(() => inp.focus(), 30);
}
// ── item 185: the map rank grid. GET /visibility/maps (routes/rank_grid.ts): the setting, each
// search's newest scan and the history. The studio (platform staff, or a studio scoped in) sets it
// up, scans and sees what each scan cost; a client sees their own grid once it is on, never a cost,
// a rival or the setup. Names come from Google as they are shown (GET /visibility/maps/names) and
// are never stored; this page keeps them only while it is open.
let RG = null, RG_PICK = null, RG_SHOW = null, RG_BUSY = false;   // the data; the search shown; a past scan shown instead
const RG_NAMES = new Map();   // place id → { name, address, maps }, for this visit only
async function loadRankGrid() {
  try { RG = (await api("GET", "/visibility/maps")).data; } catch (_) { RG = null; }
  if (RG && RG_PICK && !(RG.phrases || []).includes(RG_PICK)) RG_PICK = null;
  if (RG_SHOW && !(RG && RG.history || []).some((h) => h.id === RG_SHOW.id)) RG_SHOW = null;
  renderRankGrid();
}
const rgBand = (v) => (v == null ? "gap" : v === 0 ? "out" : v <= 3 ? "top3" : v <= 10 ? "top10" : "top20");
const rgOrd = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th");
const rgPlace = (v) => (v == null ? "no answer from Google" : v === 0 ? "not in the top 20" : rgOrd(v));
const rgMiles = (v) => (v === 0.5 ? "half a mile" : `${v % 1 ? v.toFixed(1) : v} mile${v === 1 ? "" : "s"}`);
const rgCost = (usd) => { if (!(usd > 0)) return "Free"; const c = usd * 100; if (c < 0.75) return "half a cent"; if (c < 1.25) return "1 cent"; if (c < 100) { const r = Math.round(c * 2) / 2; return `${r % 1 ? Math.floor(r) + "½" : r} cents`; } return "$" + usd.toFixed(2); };
// where a spot is, as lib/rank_grid.ts's spotWords and gridPoints have it (row 0 north, column 0 west)
function rgSpotWords(i, size, spacing) {
  const r = Math.floor(i / size), c = i % size, mid = (size - 1) / 2, parts = [];
  if (r !== mid) parts.push(`${rgMiles(Math.abs(r - mid) * spacing)} ${r < mid ? "north" : "south"}`);
  if (c !== mid) parts.push(`${rgMiles(Math.abs(c - mid) * spacing)} ${c < mid ? "west" : "east"}`);
  return parts.length ? parts.join(", ") : "The business’s own spot";
}
function rgSpotAt(center, i, size, spacing) {
  const r = Math.floor(i / size), c = i % size, mid = (size - 1) / 2, step = spacing * 1609.344;
  const lat = center.lat + (mid - r) * step / 111320, lng = center.lng + (c - mid) * step / (111320 * Math.cos(center.lat * Math.PI / 180));
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}
const rgName = () => (S.identity && S.identity.business_name) || "the business";
// did the newest scan centre on the business-details address, because Google hides the business's own?
const RG_HIDDEN = () => Object.values((RG && RG.latest) || {}).some((s) => s && s.requests && s.requests.from === "address");
async function rgNames(ids) {
  const want = [...new Set(ids.filter((id) => id && !RG_NAMES.has(id)))].slice(0, 6);
  if (!want.length || !RG || !RG.studio) return;
  try {
    const r = (await api("GET", "/visibility/maps/names?ids=" + encodeURIComponent(want.join(",")))).data;
    (r.names || []).forEach((n) => RG_NAMES.set(n.id, n));
  } catch (_) { /* names stay "a business on Google"; the Maps link still opens it */ }
}
const rgNameOf = (id) => { const n = RG_NAMES.get(id); return (n && n.name) || "A business on Google"; };
const rgMapsOf = (id) => { const n = RG_NAMES.get(id); return (n && n.maps) || "https://www.google.com/maps/place/?q=place_id:" + encodeURIComponent(id); };
function rgMap(scan, studio, past) {
  const n = scan.size, mid = Math.floor(n * n / 2);
  const map = el("div", "rg-map n" + n);
  const rings = [1, 2, 3].filter((k) => k <= (n - 1) / 2).map((k) => `<circle cx="50" cy="50" r="${(100 / (n + 1)) * k}"/>`).join("");
  map.innerHTML = `<svg class="rg-rings" viewBox="0 0 100 100" aria-hidden="true">${rings}</svg>`;
  const dots = el("div", "rg-dots n" + n); dots.setAttribute("role", "group");
  dots.setAttribute("aria-label", `Where ${rgName()} comes up for “${scan.phrase}”, spot by spot from the north-west corner`);
  scan.ranks.forEach((v, i) => {
    // the studio's spots open their top 3: the whole cell is the button, the dot sits in it
    const word = `${rgSpotWords(i, n, scan.spacing)}: ${rgPlace(v)}`, open = studio && !past;
    const cell = el(open ? "button" : "div", "rg-cell");
    const dot = el("span", `rg-dot ${rgBand(v)}${i === mid ? " home" : ""}`, v == null ? "?" : v === 0 ? "20+" : String(v));
    if (open) { cell.type = "button"; cell.dataset.spot = String(i); cell.setAttribute("aria-label", word); cell.title = word; dot.setAttribute("aria-hidden", "true"); cell.addEventListener("click", () => rgOpenSpot(scan, i)); }
    else { dot.setAttribute("role", "img"); dot.setAttribute("aria-label", word); dot.title = word; }
    cell.appendChild(dot); dots.appendChild(cell);
  });
  map.appendChild(dots);
  map.appendChild(el("span", "rg-north", "N ↑"));
  const sc = el("span", "rg-scale", rgMiles(scan.spacing).replace(/^half a mile$/, "½ mile")); sc.appendChild(el("i")); map.appendChild(sc);
  map.appendChild(el("span", "rg-across", `${(n - 1) * scan.spacing} miles across`));
  return map;
}
function rgTiny(ranks, n, home) {
  const t = el("span", "rg-tiny n" + n); t.setAttribute("aria-hidden", "true");
  ranks.forEach((v, i) => t.appendChild(el("i", home && i === Math.floor(n * n / 2) ? "home" : (v === undefined ? "" : rgBand(v)))));
  return t;
}
function rgChart(rows) {
  if (!rows.length) return "";
  const W = 300, H = 150, B = 22, T = 18, max = Math.max(1, ...rows.map((r) => r.top3)) * 1.15, bw = 28, gap = (W - rows.length * bw) / Math.max(1, rows.length);
  const bars = rows.map((r, i) => { const h = Math.max(3, (r.top3 / max) * (H - B - T)), x = gap / 2 + i * (bw + gap); return `<rect class="${i === rows.length - 1 ? "now" : ""}" x="${x.toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="4"/><text class="v" x="${(x + bw / 2).toFixed(1)}" y="${(H - B - h - 5).toFixed(1)}" text-anchor="middle">${r.top3}</text><text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(svMonth(r.month).slice(0, 3))}</text>`; }).join("");
  const aria = "Spots in the top 3, month by month: " + rows.map((r) => `${svMonth(r.month)} ${r.top3}`).join(", ");
  return `<svg class="rg-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">${bars}</svg>`;
}
function renderRankGrid() {
  const card = $("rgCard"), body = $("rgBody"); if (!card || !body) return;
  const g = RG, studio = !!(g && g.studio);
  card.hidden = !g || (!studio && (!g.enabled || !g.ready));
  if (card.hidden) return;
  const meta = $("rgMeta"), left = $("rgLeft"), bSet = $("btnRgSettings"), bScan = $("btnRgScan");
  bSet.hidden = !studio; bSet.onclick = rgOpenSettings;
  bScan.hidden = !studio || !g.enabled; bScan.onclick = rgScanNow;
  left.textContent = ""; meta.textContent = "";
  body.innerHTML = "";
  if (studio && !g.ready) { body.appendChild(el("p", "rg-empty", "The map rank grid needs a one-time database update before it can scan. Everything else on this page works.")); return; }
  if (!g.enabled) {   // the studio's view while it is off
    const off = el("div", "rg-off");
    off.appendChild(rgTiny(Array(49).fill(undefined), 7, true));
    const tx = el("div");
    tx.appendChild(el("p", null, `See where ${rgName()} comes up on Google Maps from 49 spots around the business, once a month, so you can show the client the streets where they win and where they don’t.`));
    const acts = el("div", "acts");
    const go2 = el("button", "pillbtn inked", "Set it up"); go2.type = "button"; go2.addEventListener("click", rgOpenSettings); acts.appendChild(go2);
    acts.appendChild(el("span", "hint", g.key ? `About ${g.prices ? g.prices.scan_words : "half a cent"} a scan. Only you see the cost; the client sees nothing while it is off.` : "Google isn’t connected for the platform yet: it needs the Places key first."));
    tx.appendChild(acts); off.appendChild(tx); body.appendChild(off);
    meta.textContent = "Off";
    return;
  }
  const phrases = g.phrases || [];
  if (!RG_PICK || !phrases.includes(RG_PICK)) RG_PICK = phrases.find((p) => g.latest && g.latest[p]) || phrases[0] || null;
  const latest = RG_PICK && g.latest ? g.latest[RG_PICK] : null;
  const scan = RG_SHOW && RG_SHOW.phrase === RG_PICK ? RG_SHOW : latest;
  meta.textContent = studio
    ? `${latest ? "Scanned " + svWhen(latest.scanned_at) + " · " : ""}${g.due ? "next scan due now" : "next scan " + g.next} · every month`
    : (latest ? `Checked by your studio on ${svWhen(latest.scanned_at)}` : "");
  if (studio && g.today) {
    const leftN = Math.max(0, g.today.cap - g.today.used);
    left.textContent = `${leftN} of ${g.today.cap} scans left today`;
    bScan.disabled = RG_BUSY || !leftN || !g.key || !g.place || !RG_PICK;
    bScan.title = !g.key ? "Google isn’t connected for the platform yet" : !g.place ? "Confirm the business on Google first" : !leftN ? "Three a day per client: the next can run tomorrow" : "";
  }
  if (phrases.length > 1 || studio) {
    const tabs = el("div", "rg-tabs"); tabs.setAttribute("role", "group"); tabs.setAttribute("aria-label", "Searches");
    phrases.forEach((p) => {
      const s = g.latest && g.latest[p];
      const b = el("button", "rg-tab"); b.type = "button"; b.setAttribute("aria-pressed", p === RG_PICK ? "true" : "false"); b.dataset.phrase = p;
      b.appendChild(document.createTextNode(p));
      if (s && studio) b.appendChild(el("span", "n", ` · ${s.top3} in the top 3`));
      b.addEventListener("click", () => { RG_PICK = p; RG_SHOW = null; renderRankGrid(); const nb = body.querySelector(`.rg-tab[aria-pressed="true"]`); if (nb) nb.focus(); });
      tabs.appendChild(b);
    });
    if (studio && phrases.length < 3) { const add = el("button", "rg-tab", "+ Add a search"); add.type = "button"; add.addEventListener("click", rgOpenSettings); tabs.appendChild(add); }
    body.appendChild(tabs);
  }
  if (!scan) {
    body.appendChild(el("p", "rg-empty", RG_PICK ? `No scan of “${RG_PICK}” yet. ${studio ? (g.due ? "The first scan is due now and usually runs within 15 minutes, then on the 1st of each month." : `Scan now runs one; the monthly scan runs on ${g.next}.`) : ""}` : "Add a search to scan in the grid’s settings."));
    return;
  }
  const past = scan !== latest;
  if (past) {
    const p = el("div", "rg-past"); p.appendChild(el("span", null, `Showing the scan of ${svWhen(scan.scanned_at)}.`));
    const back = el("button", "sv-linkbtn", "Back to the newest"); back.type = "button"; back.addEventListener("click", () => { RG_SHOW = null; renderRankGrid(); }); p.appendChild(back);
    body.appendChild(p);
  }
  const wrap = el("div", "rg-body");
  wrap.appendChild(rgMap(scan, studio, past));
  const side = el("div", "rg-side");
  const big = el("div", "rg-big"); big.appendChild(el("b", null, `${scan.top3} of ${scan.total}`));
  if (!past && scan.change && scan.change.top3) big.insertAdjacentHTML("beforeend", `<span class="sv-chg ${scan.change.top3 > 0 ? "up" : "down"}"><span aria-hidden="true">${scan.change.top3 > 0 ? "▲" : "▼"} ${Math.abs(scan.change.top3)} since ${esc(svWhen(scan.change.since).replace(/, \d{4}$/, ""))}</span><span class="sr-only">${scan.change.top3 > 0 ? "up" : "down"} ${Math.abs(scan.change.top3)} since the scan before</span></span>`);
  side.appendChild(big);
  side.appendChild(el("p", "rg-lead", `spots where ${studio ? rgName() : "you"} come${studio ? "s" : ""} up in the top 3 on Google Maps for “${scan.phrase}”`));
  const two = el("div", "rg-two");
  two.innerHTML = `<div><span>Average place</span><b>${scan.avg == null ? "–" : esc(String(scan.avg))}</b><small>where it shows</small></div><div><span>Not in the top 20</span><b>${scan.out} spot${scan.out === 1 ? "" : "s"}</b><small>of ${scan.total}${scan.read < scan.total ? `; Google didn’t answer at ${scan.total - scan.read}` : ""}</small></div>`;
  side.appendChild(two);
  const leg = el("div", "rg-legend");
  leg.innerHTML = [["top3", "Top 3"], ["top10", "4 to 10"], ["top20", "11 to 20"], ["out", "Not in the top 20"]].map(([k, w]) => `<span><i class="${k}"></i>${w}</span>`).join("");
  side.appendChild(leg);
  if (studio && !past && (scan.rivals || []).length) {
    const box = el("div", "rg-rivals"); box.appendChild(el("h4", null, "Ahead of you most often"));
    const ol = el("ol"); box.appendChild(ol);
    const paint = () => {
      ol.innerHTML = "";
      scan.rivals.forEach((r, i) => {
        const li = el("li"); li.appendChild(el("span", "rg-num", String(i + 1)));
        const t = el("div", "t"); t.appendChild(el("b", null, rgNameOf(r.id))); t.appendChild(el("span", null, `#1 at ${r.first} spot${r.first === 1 ? "" : "s"} · top 3 at ${r.top3}`)); li.appendChild(t);
        const a = el("a", "rg-maps", "Google Maps ↗"); a.href = rgMapsOf(r.id); a.target = "_blank"; a.rel = "noopener"; a.setAttribute("aria-label", `${rgNameOf(r.id)} on Google Maps`); li.appendChild(a);
        ol.appendChild(li);
      });
    };
    paint();
    rgNames(scan.rivals.map((r) => r.id)).then(paint);
    box.appendChild(el("p", "rg-note", "Names from Google Maps, fresh each time you open this: Google’s rules don’t let us keep them."));
    side.appendChild(box);
  }
  wrap.appendChild(side);
  body.appendChild(wrap);
  // the history: a bar a month, and the scans before this one
  const mine = (g.history || []).filter((h) => h.phrase === scan.phrase);
  // a bar a month: that month's monthly scan, the same day each month; a month with only Scan now uses its newest
  const months = [];
  mine.forEach((h) => {
    const m = String(h.scanned_at).slice(0, 7), at = months.find((x) => x.month === m);
    if (!at) months.push({ month: m, top3: h.top3, kind: h.kind });
    else if (at.kind !== "monthly" && h.kind === "monthly") { at.top3 = h.top3; at.kind = "monthly"; }
  });
  const before = mine.filter((h) => h.id !== scan.id).slice(0, 4);
  if (months.length > 1 || before.length) {
    const hist = el("div", "rg-hist");
    const c = el("div"); c.appendChild(el("h4", null, "Spots in the top 3, month by month"));
    c.insertAdjacentHTML("beforeend", rgChart(months.slice(0, 6).reverse()));
    c.appendChild(el("p", "rg-note", `“${scan.phrase}”, each month’s monthly scan. Out of ${scan.total} spots.`));
    hist.appendChild(c);
    const m = el("div");
    const mh = el("div", "rg-hist-h"); mh.appendChild(el("h4", null, `Earlier scans of “${scan.phrase}”`));
    if (studio) { const all = el("button", "sv-linkbtn", "Every scan ›"); all.type = "button"; all.addEventListener("click", rgOpenHistory); mh.appendChild(all); }
    m.appendChild(mh);
    const row = el("div", "rg-minis");
    before.forEach((h) => {
      const b = el("button", "rg-mini"); b.type = "button"; b.setAttribute("aria-pressed", RG_SHOW && RG_SHOW.id === h.id ? "true" : "false");
      b.setAttribute("aria-label", `Show the scan of ${svWhen(h.scanned_at)}: ${h.top3} of ${h.total} in the top 3`);
      b.appendChild(rgTiny(h.ranks, h.size)); b.appendChild(el("b", null, svWhen(h.scanned_at).replace(/, \d{4}$/, "")));
      b.appendChild(el("span", null, `${h.kind === "now" ? "Scan now" : "Monthly"} · ${h.top3} in top 3`));
      b.addEventListener("click", () => { RG_SHOW = { ...h, spacing: h.spacing || scan.spacing, read: h.ranks.filter((v) => v != null).length, out: h.ranks.filter((v) => v === 0).length, change: null }; renderRankGrid(); });
      row.appendChild(b);
    });
    if (!before.length) row.appendChild(el("p", "rg-note", "The scans before this one will sit here."));
    m.appendChild(row); hist.appendChild(m);
    body.appendChild(hist);
  }
  if (studio && !past && scan.cost_words) {
    const cost = el("div", "rg-cost");
    cost.appendChild(el("span", "rg-tag", "Only the studio sees this"));
    const req = scan.requests || {}, asked = req.ids_only || scan.total;
    cost.appendChild(el("span", null, req.from === "address"
      ? `This scan cost ${scan.cost_words} at Google’s prices: ${asked} searches that only list places, free, and a look-up of the address in the business details, as Google hides this business’s address. Google’s first 5,000 of those a month are free.`
      : `This scan cost ${scan.cost_words} at Google’s prices: ${asked} searches that only list places, free, and one look-up of where the business is${g.prices ? ", " + rgCost(g.prices.scan_usd) : ""}. Google’s first 10,000 look-ups a month are free.`));
    body.appendChild(cost);
  }
}
async function rgScanNow() {
  const btn = $("btnRgScan"); if (!RG || RG_BUSY || !RG_PICK) return;
  const phrase = RG_PICK; RG_BUSY = true; btn.disabled = true;
  const meta = $("rgMeta"); const was = meta.textContent;
  meta.textContent = `Scanning “${phrase}” from ${(RG.size || 7) ** 2} spots…`;
  try {
    const s = (await api("POST", "/visibility/maps/scan", { phrase })).data;
    RG_SHOW = null;
    toast(`Scanned “${phrase}”: in the top 3 at ${s.top3} of ${s.total} spots.`);
  } catch (err) { meta.textContent = was; toast(nice(err), true); }
  RG_BUSY = false;
  await loadRankGrid();
}
function rgOpenSpot(scan, i) {
  const v = scan.ranks[i], ids = (scan.tops && scan.tops[i]) || [];
  const d = svDialog(rgSpotWords(i, scan.size, scan.spacing), `Searching “${scan.phrase}” here, ${rgName()} is ${v === 0 ? "not in the top 20" : v == null ? "unknown: Google didn’t answer here" : rgOrd(v)}.`);
  const ul = el("ul", "rg-spot"); d.body.appendChild(el("b", "hint", "The top 3 from here")); d.body.appendChild(ul);
  const paint = () => {
    ul.innerHTML = "";
    if (!ids.length) ul.appendChild(el("li", null, "Google didn’t answer for this spot."));
    ids.slice(0, 3).forEach((id, k) => {
      const li = el("li"); li.appendChild(el("span", "rg-dot top3", String(k + 1)));
      li.appendChild(el("span", "t", id === scan.place_id ? `${rgName()} (this business)` : rgNameOf(id)));
      const a = el("a", "rg-maps", "Maps ↗"); a.href = rgMapsOf(id); a.target = "_blank"; a.rel = "noopener"; a.setAttribute("aria-label", `${id === scan.place_id ? rgName() : rgNameOf(id)} on Google Maps`); li.appendChild(a);
      ul.appendChild(li);
    });
  };
  paint(); rgNames(ids.filter((id) => id !== scan.place_id)).then(paint);
  if (scan.center) {
    const at = rgSpotAt(scan.center, i, scan.size, scan.spacing);
    const a = el("a", "pillbtn sm", "Open this spot in Google Maps ↗"); a.href = `https://www.google.com/maps/search/${encodeURIComponent(scan.phrase)}/@${at.lat},${at.lng},14z`; a.target = "_blank"; a.rel = "noopener";
    const acts = el("div", "acts"); acts.appendChild(a); d.body.appendChild(acts);
  }
  d.body.appendChild(el("p", "hint", "Names from Google Maps, as you open this. A real phone here can differ a little: Google also weighs the person’s own searches."));
}
function rgOpenHistory() {
  const g = RG || {}, rows = g.history || [];
  const d = svDialog(`Every scan · ${rgName()}`, "Kept for good. Spot locations are cleared after 30 days, as Google asks.");
  const t = el("table", "rg-table");
  t.innerHTML = `<caption class="sr-only">Every scan of the map rank grid</caption><thead><tr><th scope="col">When</th><th scope="col">Search</th><th scope="col">How</th><th scope="col">Top 3</th><th scope="col">Average</th><th scope="col">Cost</th></tr></thead><tbody>${rows.map((h, i) => `<tr><td><button type="button" data-h="${i}">${esc(svWhen(h.scanned_at))}</button></td><td>${esc(h.phrase)}</td><td>${h.kind === "now" ? "Scan now" : "Monthly"}</td><td>${h.top3} of ${h.total}</td><td>${h.avg == null ? "–" : esc(String(h.avg))}</td><td>${esc(h.cost_words || "")}</td></tr>`).join("")}</tbody>`;
  d.body.appendChild(t);
  t.querySelectorAll("[data-h]").forEach((b) => b.addEventListener("click", () => {
    const h = rows[Number(b.dataset.h)]; RG_PICK = h.phrase;
    const latest = g.latest && g.latest[h.phrase];
    RG_SHOW = latest && latest.id === h.id ? null : { ...h, spacing: h.spacing || g.spacing, read: h.ranks.filter((v) => v != null).length, out: h.ranks.filter((v) => v === 0).length, change: null };
    d.close(); renderRankGrid();
  }));
  const month = new Date().toISOString().slice(0, 7), mine = rows.filter((h) => String(h.scanned_at).slice(0, 7) === month);
  d.body.appendChild(el("p", "hint", `This month: ${mine.length} scan${mine.length === 1 ? "" : "s"}, ${rgCost(mine.reduce((a, h) => a + (h.cost_usd || 0), 0))} at Google’s prices. Pick a date to show that scan on the card.`));
}
function rgBizBox(host, g, onChange) {
  host.innerHTML = "";
  const src = { listing: "From their Google listing", pasted: "From the place id pasted for reviews", search: "Found by name and address" };
  const box = el("div", "rg-biz"); host.appendChild(box);
  const show = (id) => { const n = RG_NAMES.get(id); box.querySelector("b").textContent = (n && n.name) || "A business on Google"; box.querySelector(".addr").textContent = (n && n.address) || ""; };
  if (g.place || g.suggested) {
    const p = g.place || g.suggested;
    box.appendChild(el("b", null, "…")); box.appendChild(el("span", "addr", "")); box.appendChild(el("span", "hint", "From Google Maps"));
    const row = el("div", "row"); box.appendChild(row);
    row.appendChild(el("span", "rg-src", (g.place ? "✓ " : "") + (src[p.source] || "On Google")));
    const a = el("a", "rg-maps", "Google Maps ↗"); a.href = p.maps; a.target = "_blank"; a.rel = "noopener"; row.appendChild(a);
    if (g.place) { const nb = el("button", "sv-linkbtn", "Not this one?"); nb.type = "button"; nb.addEventListener("click", () => rgOpenFind(onChange)); row.appendChild(nb); }
    else {
      const yes = el("button", "pillbtn sm inked", "Yes, that’s them"); yes.type = "button";
      yes.addEventListener("click", async () => { yes.disabled = true; try { await api("PUT", "/visibility/maps/place", { place_id: p.id, source: p.source }); toast("Matched on Google."); onChange(); } catch (err) { yes.disabled = false; toast(nice(err), true); } });
      const other = el("button", "sv-linkbtn", "Find it another way"); other.type = "button"; other.addEventListener("click", () => rgOpenFind(onChange));
      row.appendChild(yes); row.appendChild(other);
    }
    if (g.place && RG_HIDDEN()) box.appendChild(el("span", "hint", "Google hides this business’s address, so the grid centres on the address in its business details."));
    rgNames([p.id]).then(() => show(p.id));
  } else {
    box.appendChild(el("span", null, "Not matched yet. Find the business on Google by its name and address, once."));
    const f = el("button", "pillbtn sm inked", "Find the business on Google"); f.type = "button"; f.addEventListener("click", () => rgOpenFind(onChange));
    const row = el("div", "row"); row.appendChild(f); box.appendChild(row);
  }
}
function rgOpenSettings() {
  const g = RG || {};
  if (!g.studio) return;
  const draft = { enabled: !!g.enabled, phrases: (g.phrases || []).slice(), size: g.size || 7, spacing: g.spacing || 1 };
  const d = svDialog(`Map rank grid · ${rgName()}`, "Only the studio sees and changes this. The client sees the grid, never the cost.", () => loadRankGrid());
  const sw = el("label", "sv-switch"); const cb = el("input"); cb.type = "checkbox"; cb.id = "rgSwitch"; cb.checked = draft.enabled;
  const swt = el("span"); swt.appendChild(el("b", null, "Scan every month")); swt.appendChild(el("span", "hint", ` On the 1st, every search below. Off: nothing runs and nothing is spent.`));
  sw.append(cb, swt); d.body.appendChild(sw);
  cb.addEventListener("change", () => { draft.enabled = cb.checked; });
  const bizSec = el("div", "rg-dlg-sec"); bizSec.appendChild(el("b", null, "The business on Google"));
  const bizHost = el("div"); bizSec.appendChild(bizHost); d.body.appendChild(bizSec);
  const refreshBiz = async () => { try { RG = (await api("GET", "/visibility/maps")).data; } catch (_) {} rgBizBox(bizHost, RG || {}, refreshBiz); };
  rgBizBox(bizHost, g, refreshBiz);
  const phSec = el("div", "rg-dlg-sec"); d.body.appendChild(phSec);
  const phHead = el("b"); phSec.appendChild(phHead);
  const chips = el("div", "rg-chips"); phSec.appendChild(chips);
  const add = el("div", "rg-add"); const inp = el("input"); inp.type = "text"; inp.maxLength = 60; inp.placeholder = "plumber"; inp.setAttribute("aria-label", "A search to scan, the way a customer would type it");
  const addB = el("button", "pillbtn sm", "Add"); addB.type = "button"; add.append(inp, addB); phSec.appendChild(add);
  phSec.appendChild(el("p", "hint", "The way a customer would type it. A town in the search pins it to that town, as it would for them."));
  const paintPh = () => {
    phHead.textContent = `Searches to scan · ${draft.phrases.length} of 3`;
    chips.innerHTML = "";
    draft.phrases.forEach((p, i) => { const c = el("span", "rg-chip", p); const x = el("button", null, "✕"); x.type = "button"; x.setAttribute("aria-label", `Take “${p}” off`); x.addEventListener("click", () => { draft.phrases.splice(i, 1); paintPh(); paintCost(); }); c.appendChild(x); chips.appendChild(c); });
    add.hidden = draft.phrases.length >= 3;
  };
  const addIt = () => { const v = inp.value.replace(/\s+/g, " ").trim(); if (v.length < 2) { inp.focus(); return; } if (!draft.phrases.some((p) => p.toLowerCase() === v.toLowerCase())) draft.phrases.push(v); inp.value = ""; paintPh(); paintCost(); inp.focus(); };
  addB.addEventListener("click", addIt); inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addIt(); } });
  const gridSec = el("div", "rg-dlg-sec"); gridSec.appendChild(el("b", null, "The grid")); d.body.appendChild(gridSec);
  const seg = (label, opts, key) => {
    const row = el("div", "rg-segrow"); if (label) row.appendChild(el("span", null, label));
    const s = el("div", "rg-seg"); s.setAttribute("role", "group"); s.setAttribute("aria-label", label || "Grid size");
    opts.forEach(([v, w]) => { const b = el("button", null, w); b.type = "button"; b.dataset.v = String(v); b.setAttribute("aria-pressed", draft[key] === v ? "true" : "false"); b.addEventListener("click", () => { draft[key] = v; s.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === String(v) ? "true" : "false")); paintCost(); }); s.appendChild(b); });
    row.appendChild(s); return row;
  };
  gridSec.appendChild(seg("", [[5, "5 × 5 · 25 spots"], [7, "7 × 7 · 49 spots"]], "size"));
  gridSec.appendChild(seg("Between spots", [[0.5, "½ mile"], [1, "1 mile"], [2, "2 miles"]], "spacing"));
  const across = el("p", "hint"); gridSec.appendChild(across);
  const costBox = el("div", "rg-costbox"); d.body.appendChild(costBox);
  const paintCost = () => {
    across.textContent = `Covers ${(draft.size - 1) * draft.spacing} miles across, centred on the business.`;
    const one = g.prices ? g.prices.scan_usd : 0.005, n = Math.max(1, draft.phrases.length);
    const hiddenUsd = g.prices && typeof g.prices.hidden_usd === "number" ? g.prices.hidden_usd : null;
    const each = RG_HIDDEN() && hiddenUsd != null ? hiddenUsd : one;
    costBox.innerHTML = `<b>What it costs</b>Each scan: ${draft.size * draft.size} searches that only list places, free, and one look-up of where the business is, ${esc(rgCost(one))}${hiddenUsd != null ? `, or ${esc(rgCost(hiddenUsd))} for a business that hides its address on Google` : ""}. ${n === 1 ? "One search" : n + " searches"} a month: ${esc(rgCost(each * n))}. Google’s price list, read ${esc(g.prices ? svWhen(g.prices.as_of + "T12:00:00Z") : "Nov 12, 2026")}.`;
  };
  paintPh(); paintCost();
  if (!g.key) d.body.appendChild(el("p", "sv-problem", "Google isn’t connected for the platform yet: the Places key is needed before anything can scan."));
  const acts = el("div", "acts"); const save = el("button", "pillbtn sm inked", "Save"); save.type = "button"; const cancel = el("button", "pillbtn sm", "Cancel"); cancel.type = "button";
  acts.append(save, cancel); d.body.appendChild(acts);
  cancel.addEventListener("click", () => d.close());
  save.addEventListener("click", async () => {
    save.disabled = true;
    try { await api("PUT", "/visibility/maps", draft); toast(draft.enabled && !g.enabled ? "Saved. The grid is on; its first scan usually runs within 15 minutes." : "Saved."); d.close(); }
    catch (err) { save.disabled = false; toast(nice(err), true); }
  });
}
function rgOpenFind(onDone) {
  const d = svDialog(`Which one is ${rgName()}?`, "We search Google for the name and address. Pick the business; we keep only Google’s id for it.");
  const row = el("div", "rg-add"); const inp = el("input"); inp.type = "text"; inp.maxLength = 160; inp.placeholder = "Business name, street, town"; inp.setAttribute("aria-label", "The business’s name and address");
  const go2 = el("button", "pillbtn sm", "Search"); go2.type = "button"; row.append(inp, go2); d.body.appendChild(row);
  const list = el("div", "rg-dlg-sec"); list.setAttribute("role", "group"); list.setAttribute("aria-label", "What Google found"); d.body.appendChild(list);
  const note = el("p", "hint"); note.setAttribute("role", "status"); d.body.appendChild(note);
  const acts = el("div", "acts"); const use = el("button", "pillbtn sm inked", "Use this one"); use.type = "button"; use.disabled = true;
  const none = el("button", "pillbtn sm", "None of these"); none.type = "button"; acts.append(use, none); d.body.appendChild(acts);
  const paste = el("details"); paste.appendChild(el("summary", "hint", "Have a place id from Google? Paste it instead"));
  const pin = el("input"); pin.type = "text"; pin.maxLength = 600; pin.placeholder = "ChIJ…"; pin.setAttribute("aria-label", "A Google place id");
  const pgo = el("button", "pillbtn sm", "Use this id"); pgo.type = "button"; const prow = el("div", "rg-add"); prow.append(pin, pgo); paste.appendChild(prow); d.body.appendChild(paste);
  let picked = null;
  const usePlace = async (place_id, source, btn) => {
    btn.disabled = true;
    try { await api("PUT", "/visibility/maps/place", { place_id, source }); toast("Matched on Google."); d.close(); if (onDone) onDone(); }
    catch (err) { btn.disabled = false; toast(nice(err), true); }
  };
  const search = async () => {
    go2.disabled = true; note.textContent = "Searching Google…"; list.innerHTML = ""; picked = null; use.disabled = true;
    try {
      const r = (await api("POST", "/visibility/maps/find", { query: inp.value.trim() })).data;
      if (!inp.value.trim()) inp.value = r.query;
      (r.found || []).forEach((f) => {
        f.address && RG_NAMES.set(f.id, { id: f.id, name: f.name, address: f.address, maps: f.maps });
        const b = el("button", "rg-cand"); b.type = "button"; b.setAttribute("aria-pressed", "false");
        const t = el("span", "t"); t.appendChild(el("b", null, f.name)); t.appendChild(el("span", null, [f.address, f.kind].filter(Boolean).join(" · "))); b.appendChild(t);
        b.addEventListener("click", () => { picked = f.id; list.querySelectorAll(".rg-cand").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false")); use.disabled = false; });
        const a = el("a", "rg-maps", "Maps ↗"); a.href = f.maps; a.target = "_blank"; a.rel = "noopener"; a.setAttribute("aria-label", `${f.name} on Google Maps`); a.addEventListener("click", (e) => e.stopPropagation());
        const line = el("div", "rg-segrow"); line.append(b, a); list.appendChild(line);
      });
      note.textContent = (r.found || []).length ? `From Google Maps. This search cost about ${r.cost_words} at Google’s prices.` : "Google found nothing for that. Try the name and the town only.";
    } catch (err) { note.textContent = ""; toast(nice(err), true); }
    go2.disabled = false;
  };
  go2.addEventListener("click", search); inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
  use.addEventListener("click", () => { if (picked) usePlace(picked, "search", use); });
  none.addEventListener("click", () => d.close());
  pgo.addEventListener("click", () => { const v = pin.value.trim(); if (v) usePlace(v, "pasted", pgo); else pin.focus(); });
  search();
}
// ── Phase UX (FD-R2): the workspace speaks the business's language ──
// A plumber's SITE says "Services" (T3 vocabulary) — the workspace must too.
// Words follow the template first (restaurant-classic always renders a menu),
// then the industry. Also fixes the preview page-word: it pointed at /menu/,
// a page that doesn't exist on business-classic sites.
const OFFER_WORDS = {
  food:      { label: "Menu",     path: "/menu/",     sub: "Click any line to change it. Anything you take off stays saved here.", addLine: "＋ Start a new section of the menu", putBack: "Put it back on the menu", takeOff: "Take it off the menu", offTag: "off the menu", addBtn: "Add to the menu", one: "dish", many: "dishes", firstCat: "Mains", example: "Burrata &amp; Peaches …… $16", empty: "Your menu is waiting for its first line. Add a dish and it reads just like this.", pricePh: "$18 · MP", catHint: "Desserts, Drinks, Specials…", added: "On the draft menu" },
  retail:    { label: "Products", path: "/products/", sub: "Click any product to change it. Anything you hide stays saved here.", addLine: "＋ Start a new product group", putBack: "Put it back on your site", takeOff: "Hide it from your site", offTag: "hidden", addBtn: "Add this product", one: "product", many: "products", firstCat: "Products", example: "Linen apron …… $38", empty: "Your products are waiting for the first one. Add one and it reads just like this.", pricePh: "$38", catHint: "New arrivals, Gifts, Sale…", added: "Added to your draft" },
  fitness:   { label: "Classes",  path: "/classes/",  sub: "Click any class to change it. Anything you hide stays saved here.", addLine: "＋ Start a new class group", putBack: "Put it back on your site", takeOff: "Hide it from your site", offTag: "hidden", addBtn: "Add this class", one: "class", many: "classes", firstCat: "Classes", example: "Morning flow …… $20", empty: "Your classes are waiting for the first one. Add one and it reads just like this.", pricePh: "$20 a class", catHint: "Yoga, Strength, Kids…", added: "Added to your draft" },
  community: { label: "Programs", path: "/programs/", sub: "Click any program to change it. Anything you hide stays saved here.", addLine: "＋ Start a new program group", putBack: "Put it back on your site", takeOff: "Hide it from your site", offTag: "hidden", addBtn: "Add this program", one: "program", many: "programs", firstCat: "Programs", example: "After-school tutoring …… Free", empty: "Your programs are waiting for the first one. Add one and it reads just like this.", pricePh: "Free", catHint: "Youth, Families, Seniors…", added: "Added to your draft" },
  generic:   { label: "Services", path: "/services/", sub: "Click any service to change it. Anything you hide stays saved here.", addLine: "＋ Start a new service category", putBack: "Put it back on your site", takeOff: "Hide it from your site", offTag: "hidden", addBtn: "Add this service", one: "service", many: "services", firstCat: "Services", example: "Leak repair …… from $95", empty: "Your services are waiting for the first one. Add one and it reads just like this.", pricePh: "From $95", catHint: "Repairs, Installations, Maintenance…", added: "Added to your draft" },
};
let VOCAB = OFFER_WORDS.food;   // matches the pre-load default markup
function vocabWords() {
  // template_slug is the template itself; `template` is "<slug> <version>", sent since item 63.
  // Before that the page looked only for `template` and a restaurant site with no business
  // type read "Services" (found Nov 8 while building item 46).
  const tpl = (S.site && (S.site.template_slug || S.site.template)) || "";
  if (tpl.indexOf("restaurant-classic") === 0) return OFFER_WORDS.food;
  const k = (S.settings && S.settings.industry_key) || "generic";
  if (["restaurant", "coffee_shop", "cafe", "bar", "food_truck"].includes(k)) return OFFER_WORDS.food;
  if (k === "retail") return OFFER_WORDS.retail;
  if (["fitness", "gym", "yoga"].includes(k)) return OFFER_WORDS.fitness;
  if (["nonprofit", "church"].includes(k)) return OFFER_WORDS.community;
  return OFFER_WORDS.generic;
}
const vocabCap = (w) => String(w || "").charAt(0).toUpperCase() + String(w || "").slice(1);
function applyVocab() {
  VOCAB = vocabWords();
  document.querySelectorAll('.navitem[data-view="offerings"]').forEach((n) => { n.textContent = VOCAB.label; });   // main tab + sections sheet stay in sync
  const h = document.querySelector("#view-offerings h1.doc"); if (h) h.textContent = VOCAB.label;
  const sub = document.querySelector("#view-offerings .docsub"); if (sub) sub.textContent = VOCAB.sub;
}
let DESIGN_TOKENS = {};
// FD-T9: Brand Kit — one source of truth. Sets the site logo + brand colour +
// type, PUTs /dev/brand-kit (server derives the SAME dev tokens), then the
// granular Design Studio below fine-tunes. No second theme engine on the client.
function normHexJs(x) { let h = String(x || "").trim().toLowerCase().replace(/^#/, ""); if (/^[0-9a-f]{3}$/.test(h)) h = h.replace(/(.)/g, "$1$1"); return /^[0-9a-f]{6}$/.test(h) ? "#" + h : null; }
// Templates that keep their own colours (see the template's CSS): the palettes and the
// Background choice are written for light pages.
const FIXED_COLOR_TEMPLATES = new Set(["slate"]);
// ── Phase T-BLOCKS (FD-T15): content blocks — structured sections you turn on + fill.
//    Writes the SAME /settings blocks array the server validates + the template renders
//    (one storage, one pipeline). Local working copy → explicit Save, so a half-filled
//    block isn't stripped mid-edit. Media blocks (FD-T17) render read-only notes here. ──
const BLOCK_DEFS = [
  // item 57: a section built from blocks (a heading, words, photos, buttons…) stacked top to bottom
  { type: "stack", name: "Blocks", stackSimple: true, hint: "Build your own section: a heading, words, photos, buttons and more, stacked top to bottom." },
  { type: "features", name: "Features / highlights", field: "items", hint: "One per line:  Title | short description | icon   (pick a line icon from the grid below, or type an emoji)", icons: true,
    parse: (p) => ({ title: p[0] || "", text: p[1] || "", icon: p[2] || "" }), fmt: (o) => { const c = [o.title, o.text || "", o.icon || ""]; while (c.length && !c[c.length - 1]) c.pop(); return c.join(" | "); } },
  { type: "stats", name: "Numbers that build trust", field: "items", hint: "One per line:  Value | Label   (e.g.  15 | Years in business)",
    parse: (p) => ({ value: p[0] || "", label: p[1] || "" }), fmt: (o) => [o.value, o.label].filter(Boolean).join(" | ") },
  { type: "team", name: "Team", field: "members", structured: "team", hint: "Add each person, with an optional photo from your library.",
    parse: (p) => ({ name: p[0] || "", role: p[1] || "", bio: p[2] || "" }), fmt: (o) => [o.name, o.role, o.bio].filter(Boolean).join(" | ") },
  { type: "process", name: "How it works", field: "steps", hint: "One per line:  Step | detail",
    parse: (p) => ({ step: p[0] || "", detail: p[1] || "" }), fmt: (o) => [o.step, o.detail].filter(Boolean).join(" | ") },
  { type: "pricing", name: "Pricing / packages", field: "tiers", hint: "One tier per line:  Name | price | feature; feature; feature",
    parse: (p) => ({ name: p[0] || "", price_text: p[1] || "", features: (p[2] || "").split(";").map((s) => s.trim()).filter(Boolean) }),
    fmt: (o) => [o.name, o.price_text, (o.features || []).join("; ")].filter(Boolean).join(" | ") },
  { type: "certifications", name: "Certifications / licenses", field: "items", hint: "One per line:  Name | issuer",
    parse: (p) => ({ name: p[0] || "", issuer: p[1] || "" }), fmt: (o) => [o.name, o.issuer].filter(Boolean).join(" | ") },
  { type: "service_areas", name: "Areas we serve", areasSimple: true, hint: "One area per line" },
  { type: "cta", name: "Call-to-action banner", ctaSimple: true, hint: "" },
  // FD-T17 media blocks — pick from your photo library (one media pipeline).
  { type: "gallery", name: "Photo gallery", mediaKind: "gallery", hint: "A grid of photos from your library." },
  { type: "before_after", name: "Before & after", mediaKind: "ba", hint: "Pairs of photos that show your work." },
  { type: "video", name: "Video", mediaKind: "video", hint: "A poster image that links out to your video — nothing external loads on your site." },
  { type: "partners", name: "Trusted by (logo strip)", mediaKind: "gallery", hint: "Logos of brands you work with — instant credibility. Pick them from your files." },
  { type: "reviews", name: "Review rating badge", reviewsSimple: true, hint: "" },
  { type: "reviews_wall", name: "Reviews wall (native)", reviewsWallSimple: true, hint: "Show the real reviews customers leave on your site — with honest star ratings that help you show up in search. Collect + approve them in the Reviews tab." },
  { type: "appointment", name: "Booking button", apptSimple: true, hint: "" },
  { type: "booking", name: "Online booking (native)", bookingSimple: true, hint: "Take real appointments right on your site. Set up your services + hours in the Bookings tab; this section shows the booking widget." },
  // Growth blocks (r2) — every one links OUT; nothing external ever loads on the site.
  { type: "newsletter", name: "Newsletter sign-up", newsletterSimple: true, hint: "" },
  { type: "social", name: "Social links", field: "links", hint: "One per line:  network | link   (e.g.  instagram | https://instagram.com/yourbusiness — icons appear automatically)",
    parse: (p) => ({ network: p[0] || "", url: p[1] || "" }), fmt: (o) => [o.network, o.url].filter(Boolean).join(" | ") },
  { type: "events", name: "Upcoming events", field: "items", hint: "One per line:  Name | date | time | detail | link | place   (a date like 2026-07-26 shows as “Jul 26”; time, detail, link and place are optional. An event with no place is at your business address. Past events come off the site by themselves.)",
    parse: (p) => ({ name: p[0] || "", date: p[1] || "", time: p[2] || "", detail: p[3] || "", url: p[4] || "", place: p[5] || "" }),
    fmt: (o) => { const a = [o.name || "", o.date || "", o.time || "", o.detail || "", o.url || "", o.place || ""]; while (a.length > 2 && !a[a.length - 1]) a.pop(); return a.join(" | "); } },
  { type: "map", name: "Map & directions", mapSimple: true, hint: "" },
  // Text & layout staples (r3) — the everyday building blocks.
  { type: "richtext", name: "Text box", proseSimple: true, hint: "" },
  { type: "image", name: "Image", imageSimple: true, hint: "" },
  { type: "image_text", name: "Image + text", imageTextSimple: true, hint: "" },
  { type: "accordion", name: "Accordion (expandable)", structured: "accordion", hint: "Add each expandable panel — a short label and the details inside." },
  { type: "tabs", name: "Tabs", structured: "tabs", hint: "Tabbed sections — a row of tabs, each revealing its own text and optional image. Great for services, plans, or FAQs by category. Keyboard-friendly and stacks on phones." },
  { type: "carousel", name: "Carousel", structured: "carousel", hint: "A swipeable slideshow of images with optional captions. Scrolls smoothly on phones and by keyboard — no code, no plugins." },
  { type: "progress", name: "Progress bars", structured: "progress", hint: "Labeled bars that fill to a percentage — great for skills, capacity, or “how it’s going”. Add each label and its level." },
  { type: "buttons", name: "Buttons", structured: "buttons", hint: "Up to three clear action links." },
  { type: "divider", name: "Divider / space", dividerSimple: true, hint: "" },
  // Layout & utility (r4). Columns + Cards are MULTI-INSTANCE (like forms) — add several.
  { type: "columns", name: "Columns", structured: "columns", multi: true, hint: "Side-by-side columns on a responsive grid — choose 1–6, set each one’s width (or drag the dividers on the page), each with text, an optional image and a button. They stack on phones." },
  { type: "cards", name: "Feature cards", structured: "cards", multi: true, hint: "A grid of cards — image, title, a line of text and an optional link." },
  { type: "download", name: "Download", downloadSimple: true, hint: "Offer a file from your library (e.g. a PDF or price list) as a clear Download link." },
  { type: "toc", name: "Table of contents", tocSimple: true, hint: "Auto-built “On this page” jump list from your section headings — nothing to fill in." },
  // AEM-parity staples (r5).
  { type: "title", name: "Title / heading", titleSimple: true, hint: "A standalone heading, with an optional subtitle beneath it." },
  { type: "link_list", name: "Link list", field: "links", hint: "One per line:  Label | https://link",
    parse: (p) => ({ label: p[0] || "", url: p[1] || "" }), fmt: (o) => [o.label, o.url].filter(Boolean).join(" | ") },
  { type: "table", name: "Table", tableSimple: true, hint: "A simple table — headers on the first line, then rows. Scrolls sideways on phones." },
  { type: "spotlight", name: "Spotlight", spotlightSimple: true, hint: "A prominent highlight band — an eyebrow, a heading, a line or two, and a button." },
];
let BLOCKS_WORK = null;
let BLOCK_FOCUS = null;      // FD-T-LIB: index of a just-added block to scroll to + focus
// One-per-page in the builder (mirrors site_blocks.ts SINGLETON). EVERY other block
// type may be added more than once — stack as many text boxes, image+text rows,
// feature grids etc. as you like; the server keeps them all.
const BLOCK_SINGLETON = new Set(["toc", "reviews_wall"]);
// ── Multi-page: which page the canvas is editing. "" = the Home page (settings.blocks);
// a slug = a custom page (settings.pages[]). currentBlocks() returns the CURRENT page's
// blocks so the whole editor (BLOCKS_WORK, save, preview) is page-aware. ──
let DC_PAGE = "";
function dcPagesArr() { return Array.isArray(S.settings && S.settings.pages) ? S.settings.pages : []; }
function dcPageObj(slug) { return dcPagesArr().find((p) => p && p.slug === slug) || null; }
function dcPageList() { return [{ slug: "", title: "Home" }, ...dcPagesArr().map((p) => ({ slug: p.slug, title: p.title || p.slug }))]; }
// ── Builder item 314: every page on the canvas ──
// The template's own pages (About, FAQ, Updates, Contact and the Menu page) open on the canvas
// like Home. DC_PAGE names one as "~" + its key: it has no sections of its own, so nothing is
// written for it; its words come from the Business, Questions, Reviews and Updates tabs, typed
// on the page (ideStart) or in the card the pencil opens beside the page (eeEditCore).
const dcBuiltinKey = (slug) => (typeof slug === "string" && slug.charAt(0) === "~" ? slug.slice(1) : null);
function dcBuiltinPage(slug) { const k = dcBuiltinKey(slug === undefined ? DC_PAGE : slug); return k && typeof hbStandardPages === "function" ? hbStandardPages().find((p) => p.key === k && p.view !== "design") || null : null; }
function dcBuiltinForPath(path) { const p = typeof hbStandardPages === "function" ? hbStandardPages().find((x) => x.view !== "design" && x.path === path) : null; return p ? "~" + p.key : null; }
function dcPagePath() { const b = dcBuiltinPage(); return b ? b.path : DC_PAGE ? "/" + DC_PAGE + "/" : "/"; }
function dcPageMissing() { return !!DC_PAGE && !dcBuiltinPage() && !dcPageObj(DC_PAGE); }
function dcBuiltinFrom(view) { return { business: "your business details", offerings: "the items on your " + ((typeof VOCAB === "object" && VOCAB && VOCAB.label) || "Menu") + " tab", faqs: "your questions and answers", testimonials: "your reviews", updates: "your updates" }[view] || "your details"; }
function currentBlocks() {
  if (dcBuiltinPage()) return [];   // item 314: a built-in page has no sections of its own
  if (DC_PAGE) { const p = dcPageObj(DC_PAGE); return Array.isArray(p && p.blocks) ? p.blocks.map((b) => ({ ...b })) : []; }
  return Array.isArray(S.settings && S.settings.blocks) ? S.settings.blocks.map((b) => ({ ...b })) : [];
}
// ── Multi-page: the Pages bar (Home + custom pages) — click a page to author it ──
const DC_PAGE_RESERVED = new Set(["", "index", "home", "404", "about", "contact", "faq", "faqs", "services", "service", "menu", "products", "classes", "updates", "blog", "news", "post", "posts", "thanks", "thank-you", "privacy", "accessibility", "search", "sitemap", "robots", "assets", "img"]);
// Builder item 320: a section step remembers its page (undoSectionsRec), so opening another
// page keeps it; Undo switches back to that page first. Only the saved-list baseline resets.
function dcResetHistory() { DC_HIST_LAST = null; if (typeof updateUndoButtons === "function") updateUndoButtons(); }
// ── Editable GLOBAL top menu (header + footer are global — ONE edit changes every
//    page). A small structured editor: order items, rename them, point each at one of
//    your pages or an external link, and give any item a dropdown of child links.
//    Saved to settings.nav; the server validates (safe links only) and every template
//    renders it. Empty / "Reset to automatic" → the site builds the menu from pages. ──
function dcCleanNav(nav) {
  return Array.isArray(nav) ? nav.map((it) => {
    const o = { label: String(it.label || "").trim().slice(0, 40), href: String(it.href || "").trim() };
    if (it.folder === true) o.folder = true;   // item 48: a heading with no page; its href only names it here
    const kids = (Array.isArray(it.children) ? it.children : []).map((k) => ({ label: String(k.label || "").trim().slice(0, 40), href: String(k.href || "").trim() })).filter((k) => k.label && k.href && !k.folder).slice(0, 8);
    if (kids.length) o.children = kids;
    return o;
  }).filter((it) => it.label && it.href).slice(0, 12) : [];
}
// Blocks that can't render until the owner picks a file — added EMPTY (a validator
// would drop a placeholder with no media), so the add flow opens their editor/picker
// instead of saving straight away.
const MEDIA_FILL_TYPES = new Set(["image", "gallery", "carousel", "video", "before_after", "partners", "download", "form"]);
// ── Undo / Redo (AEM parity) — an in-session history of the block list ──────────
// Every save records the PREVIOUS persisted state so it can be restored. Pure
// frontend: undo/redo simply re-persist a prior BLOCKS_WORK snapshot through the
// same saveBlocks path (server re-validates), so nothing can drift out of the moat.
let DC_UNDO = [], DC_REDO = [], DC_HIST_LAST = null, DC_HIST_SILENT = false;
function histSnap() { try { return JSON.stringify(BLOCKS_WORK || []); } catch (_) { return null; } }
// Item 320: a section step: the page's list as it was saved, and which page. The same "before"
// twice in a row (a save that failed and was sent again) is one step, not two.
const undoSectionsRec = (snap, page) => ({ kind: "sections", page: page == null ? DC_PAGE : page, snap });
const undoSectionsSame = (rec, snap, page) => !!rec && rec.kind === "sections" && rec.page === (page == null ? DC_PAGE : page) && rec.snap === snap;
function dcHistoryRecord() {   // called at the start of a USER save (pre-change state → undo)
  if (DC_HIST_SILENT) return;
  if (histSnap() === DC_HIST_LAST) return;   // nothing changed: not a step worth undoing
  if (DC_HIST_LAST != null && !undoSectionsSame(DC_UNDO[DC_UNDO.length - 1], DC_HIST_LAST)) { DC_UNDO.push(undoSectionsRec(DC_HIST_LAST)); while (DC_UNDO.length > 60) DC_UNDO.shift(); }
  DC_REDO = [];
}
function dcHistoryCommit() { DC_HIST_LAST = histSnap(); updateUndoButtons(); }
function updateUndoButtons() {
  const u = $("btnUndo"), r = $("btnRedo");
  if (u) u.disabled = !DC_UNDO.length;
  if (r) r.disabled = !DC_REDO.length;
  // the same two buttons on every other tab, once there's something to undo
  const u2 = $("btnUndoTop"), r2 = $("btnRedoTop"), any = DC_UNDO.length || DC_REDO.length;
  if (u2) { u2.hidden = !any; u2.disabled = !DC_UNDO.length; }
  if (r2) { r2.hidden = !any; r2.disabled = !DC_REDO.length; }
}
function dcApplyHistory(snapJson) {
  dcSoloEnd();
  let arr; try { arr = JSON.parse(snapJson); } catch (_) { return; }
  BLOCKS_WORK = arr; DC_HIST_LAST = snapJson;
  DC_HIST_SILENT = true;
  dcCaptureScroll(); renderBlocksCard();
  Promise.resolve(saveBlocks()).finally(() => {
    DC_HIST_SILENT = false; updateUndoButtons();
    if ($("formsCard") && JSON.stringify(FORMS_WORK) === FORMS_BASE) formsLoad();   // a form is a section: the card shows what's saved now
  });
}
// ── One undo history for the whole editor ───────────────────────────────────
// Every content write goes through api(), so that's where a step is recorded: what
// the write is about to replace, and what it writes. Section edits stay as block-list
// snapshots (the strings in DC_UNDO); everything else is one of these records. The
// history lasts for the visit; past versions live in History.
const UNDO_LIST_FIELDS = {
  offerings: ["name", "category", "description", "price_text", "media_id", "is_visible", "sort_order"],
  faqs: ["question", "answer", "is_visible", "sort_order"],
  testimonials: ["quote", "author", "source", "quote_date", "is_visible", "sort_order"],
  posts: ["title", "slug", "body_md", "excerpt", "hero_media_id", "status", "published_at", "noindex", "tags"],
};
let UNDO_QUIET = 0;      // >0: this write is an undo, or sections recording their own snapshot
let UNDO_BEFORE = null;  // for callers that update S before the write goes out
const undoClone = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
function undoPick(src, keys) {
  const o = {}; keys.forEach((k) => { o[k] = undoClone(src ? src[k] : undefined); });
  // a site with no settings row has no menu or section order to read yet, and the stored ones can't be null
  ["nav", "sections_order", "sections_hidden"].forEach((k) => { if (o[k] === null) o[k] = []; });
  return o;
}
// A write to the page list carries every page's sections, and sections change outside
// these steps: their saves are quiet and their snapshots go with the page. So a step keeps
// only what it changed, and taking it back applies that to the list as it is by then.
// Other pages' words stay, and so does a page made since. An address going back rides
// `prev_slug` like any rename, so the server's forwards follow the page.
const undoPageMeta = ({ blocks, prev_slug, ...meta }) => undoClone(meta);
// Stored JSON comes back with its keys reordered, so sections compare by content.
const undoSections = (p) => JSON.stringify(p.blocks || [], (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));
function undoPagesPlan({ pages, ...rest }) {
  const was = dcPagesArr(), kept = new Set(), changes = [];
  const whole = (p, before, after) => ({ before, after, page: undoClone(p), sections: undoSections(p) });
  pages.forEach((p) => {
    const old = was.find((x) => x.slug === (p.prev_slug || p.slug));
    if (!old) { changes.push(whole(p, null, undoPageMeta(p))); return; }
    kept.add(old);
    const before = undoPageMeta(old), after = undoPageMeta(p);
    if (JSON.stringify(before) !== JSON.stringify(after)) changes.push({ before, after });
  });
  was.forEach((p) => { if (!kept.has(p)) changes.push(whole(p, undoPageMeta(p), null)); });
  return { kind: "pages", route: "/settings", changes,
    order: { before: was.map((p) => p.slug), after: pages.map((p) => p.slug) },
    rest: { before: undoPick(S.settings, Object.keys(rest)), after: undoClone(rest) } };
}
// Taking a page off is a delete, so if it holds words the step didn't put there it gets a
// delete's question and safety point, and Redo brings it back as it was. False = they said no.
async function undoPagesAsk(rec, from, to) {
  for (const c of rec.changes) {
    const p = !c[to] && dcPageObj(c[from].slug);
    if (!p || undoSections(p) === c.sections) continue;
    const title = p.title || p.slug;
    if (!(await askYes("Undo will remove the page “" + title + "” and what’s been added to it. Your live site is unchanged until you publish.", { ok: "Undo and remove it", danger: true }))) return false;
    try { await api("POST", "/publishes/checkpoints", { name: ("Before removing “" + title + "”").slice(0, 80) }); } catch (_) {}
  }
  return true;
}
// The write that moves a page step from one side to the other, built from the saved list.
function undoPagesBody(rec, from, to) {
  const list = dcPagesArr().slice();
  for (const c of rec.changes) {
    const at = c[from] ? list.findIndex((p) => p.slug === c[from].slug) : -1;
    if (c[to] && list.some((p, i) => p.slug === c[to].slug && i !== at)) throw new Error("Another page uses that address now. Rename it, then try again.");
    if (c[from] && at < 0) continue;
    if (!c[to]) { c.page = list[at]; list.splice(at, 1); }
    else if (!c[from]) list.push({ ...c[to], blocks: c.page.blocks });
    else list[at] = { ...c[to], blocks: list[at].blocks, ...(c[from].slug !== c[to].slug ? { prev_slug: c[from].slug } : {}) };
  }
  // only the pages this step knows about move, and they share the places they already hold
  const want = rec.order[to], placed = list.filter((p) => want.includes(p.slug)).sort((a, b) => want.indexOf(a.slug) - want.indexOf(b.slug));
  return { ...rec.rest[to], pages: list.map((p) => (want.includes(p.slug) ? placed.shift() : p)) };
}
function undoPlan(method, route, body) {
  if (UNDO_QUIET) return null;
  const path = String(route).split("?")[0];
  if (method === "PUT" && body) {
    if (path === "/settings" && Array.isArray(body.pages)) return undoPagesPlan(body);
    const state = { "/identity": S.identity, "/location": S.location, "/settings": S.settings, "/bookings/settings": typeof BK !== "undefined" ? BK.settings : null }[path];
    if (state !== undefined) {
      const before = UNDO_BEFORE || undoPick(state, Object.keys(body));
      UNDO_BEFORE = null;
      return { kind: "put", route: path, before, after: undoClone(body) };
    }
    if (path === "/dev/customization" && body.theme_tokens) return { kind: "put", route: path, before: { theme_tokens: undoClone(DESIGN_TOKENS) }, after: { theme_tokens: undoClone(body.theme_tokens) } };
    if (path === "/site/template" && S.site) return { kind: "put", route: path, before: { slug: S.site.template_slug }, after: undoClone(body) };
    return null;
  }
  const m = /^\/(offerings|faqs|testimonials|posts)(?:\/([^/]+))?$/.exec(path);
  if (!m) return null;
  const col = m[1], id = m[2], row = id && (S[col] || []).find((x) => x.id === id);
  if (method === "PATCH" && row) return { kind: "patch", col, id, before: undoPick(row, Object.keys(body || {})), after: undoClone(body) };
  // Undoing an add removes the row, which a role without delete can't do: no step beats an Undo that gets refused.
  if (method === "POST" && !id) return window.ddsLacks && window.ddsLacks("delete") ? null : { kind: "create", col, id: null, row: undoClone(body) };
  if (method === "DELETE" && row) return { kind: "remove", col, id, row: undoPick(row, UNDO_LIST_FIELDS[col]) };
  return null;
}
function undoCommit(rec, j) {
  if (rec.kind === "create") { rec.id = j && j.data && j.data.id; if (!rec.id) return; }
  const now = Date.now(), top = DC_UNDO[DC_UNDO.length - 1], keys = rec.after ? Object.keys(rec.after) : [];
  // typing in one field is one step, not one per pause
  if (top && typeof top === "object" && rec.kind === "put" && top.kind === "put" && top.route === rec.route && keys.length === 1
      && Object.keys(top.after).length === 1 && keys[0] in top.after && now - top.at < 4000) {
    top.after = rec.after; top.at = now;
  } else {
    rec.at = now; DC_UNDO.push(rec); while (DC_UNDO.length > 60) DC_UNDO.shift();
  }
  DC_REDO = []; updateUndoButtons();
}
const UNDO_RENDER = { offerings: () => renderOfferings(), faqs: () => renderFaqs(), testimonials: () => renderTes(), posts: () => renderPosts() };
// One at a time, in order: quick presses must not cross on the wire, and a restored
// row's new id has to land before the next step uses it.
let UNDO_CHAIN = Promise.resolve();
function undoRun(rec, dir) {
  const step = UNDO_CHAIN.then(() => undoStep(rec, dir));
  UNDO_CHAIN = step.catch(() => {});
  return step;
}
async function undoStep(rec, dir) {
  const back = dir === "undo";
  whisper("topWhisper", "saving");
  try {
    if (rec.kind === "pages") {
      const from = back ? "after" : "before", to = back ? "before" : "after";
      // Saves reach the list first and the question comes before the write, so neither sits
      // inside a turn. The list itself is built when the turn comes, from what the last write left.
      if (!(await dcSavePendingEdits()) || !(await undoPagesAsk(rec, from, to))) { whisper("topWhisper", ""); return false; }
      await settingsTurn(() => {
        const vals = undoPagesBody(rec, from, to);
        UNDO_QUIET++; const call = api("PUT", rec.route, vals); UNDO_QUIET--;
        return call.then((r) => undoSync(rec, vals, r));
      });
      if (dcPageMissing()) { await dcSavePendingEdits(); dcOpenPage(""); renderPagesBar(); renderBlocksCard(); }   // the page on screen is gone, and anything typed during that write went with it, not onto Home
    } else if (rec.kind === "put") {
      const vals = back ? rec.before : rec.after;
      const put = () => { UNDO_QUIET++; const call = api("PUT", rec.route, vals); UNDO_QUIET--; return call.then((r) => undoSync(rec, vals, r)); };
      await (rec.route === "/settings" ? settingsTurn(put) : put());
    } else {
      UNDO_QUIET++;
      let call;
      if (rec.kind === "patch") call = api("PATCH", `/${rec.col}/${rec.id}`, back ? rec.before : rec.after);
      else if ((rec.kind === "create") === back) call = api("DELETE", `/${rec.col}/${rec.id}`);   // undoing an add, or redoing a removal
      else call = api("POST", `/${rec.col}`, rec.row);
      UNDO_QUIET--;
      const r = await call;
      const rows = S[rec.col] || (S[rec.col] = []);
      if (rec.kind === "patch") { const row = rows.find((x) => x.id === rec.id); if (row) Object.assign(row, r.data || (back ? rec.before : rec.after)); }
      else if ((rec.kind === "create") === back) S[rec.col] = rows.filter((x) => x.id !== rec.id);
      else { if (r.data) { rows.push(r.data); rec.id = r.data.id; } }
      UNDO_RENDER[rec.col]();
    }
    whisper("topWhisper", "saved"); scheduleChangesRefresh(); refreshDesignPreview();
    return true;
  } catch (err) { whisper("topWhisper", "failed"); toast(nice(err), true); return false; }
}
async function undoSync(rec, vals, r) {
  if (rec.route === "/identity") { S.identity = { ...(S.identity || {}), ...vals }; fillSingles(); }
  else if (rec.route === "/location") { S.location = { ...(S.location || {}), ...vals }; fillSingles(); }
  else if (rec.route === "/bookings/settings") { BK.settings = { ...BK.settings, ...vals }; if ($("view-bookings").classList.contains("on")) loadBookings(); }
  else if (rec.route === "/dev/customization") { DESIGN_TOKENS = vals.theme_tokens || {}; if (EDIT_CARDS) remountInPlace("designCard", () => mountDesignCard(false), true); }   // item 85: the tokens are in hand
  else if (rec.route === "/site/template") { const s = await api("GET", "/site"); S.site = s.data.site; S.live = s.data.live || S.live; LOOKS = null; applyVocab(); if ($("designGallery")) mountTemplateGallery(); const c = $("designCard"); if (c) c.remove(); mountDesignCard(); }
  else if (rec.route === "/settings") {
    S.settings = (r && r.data) || { ...S.settings, ...vals };
    const moved = rec.kind === "pages" && DC_PAGE && vals.pages.find((p) => p.prev_slug === DC_PAGE);
    if (moved) DC_PAGE = moved.slug;   // the next write finds this page under its address
    if (!blocksDirty()) { BLOCKS_WORK = currentBlocks(); DC_HIST_LAST = histSnap(); }   // words typed during that write stay, and save next
    if ($("blocksCard")) renderBlocksCard();
    renderPagesBar();
    if ($("formsCard")) formsLoad();
    // item 85: in place (they used to drop to the bottom of the Styles panel), and the colors
    // and fonts card from the tokens it holds: a settings step doesn't change them
    remountSectionsCard();
    if (EDIT_CARDS) remountInPlace("designCard", () => mountDesignCard(false), true);
    fillSingles();
    if ($("ann-text")) { $("ann-text").value = S.settings.announcement_text || ""; $("ann-url").value = S.settings.announcement_url || ""; $("ann-until").value = (S.settings.announcement_expires_at || "").slice(0, 10); }
  }
}
// Item 320: a section step taken on another page opens that page first, then runs again.
function undoOnItsPage(rec, again, word) {
  if (rec.kind !== "sections" || rec.page === DC_PAGE) return false;
  if (typeof dcSwitchPage !== "function") return false;
  const title = rec.page ? ((dcBuiltinPage(rec.page) || dcPageObj(rec.page) || {}).title || rec.page) : "Home";
  toast("That change was on " + title + ". Opening it to " + word + " it there.");
  dcSwitchPage(rec.page).then((ok) => { if (ok && DC_PAGE === rec.page) again(); });
  return true;
}
function dcUndo() {
  // an edit still waiting for its save is the newest step, so it's the one to take back
  if (blocksDirty()) { clearTimeout(BLOCKS_SAVE_T); BLOCKS_SAVE_T = null; dcHistoryRecord(); dcHistoryCommit(); }
  if (!DC_UNDO.length) { toast("Nothing to undo"); return; }
  const top = DC_UNDO[DC_UNDO.length - 1];
  if (undoOnItsPage(top, dcUndo, "undo")) return;
  DC_UNDO.pop();
  if (top.kind !== "sections") {
    DC_REDO.push(top); updateUndoButtons();
    undoRun(top, "undo").then((ok) => { if (ok) toast("Undone"); else { DC_REDO.pop(); DC_UNDO.push(top); updateUndoButtons(); } });
    return;
  }
  DC_REDO.push(undoSectionsRec(DC_HIST_LAST != null ? DC_HIST_LAST : histSnap()));
  dcApplyHistory(top.snap); toast("Undone");
}
function dcRedo() {
  if (blocksDirty() || !DC_REDO.length) { toast("Nothing to redo"); return; }   // a new edit outranks the redo list
  const top = DC_REDO[DC_REDO.length - 1];
  if (undoOnItsPage(top, dcRedo, "redo")) return;
  DC_REDO.pop();
  if (top.kind !== "sections") {
    DC_UNDO.push(top); updateUndoButtons();
    undoRun(top, "redo").then((ok) => { if (ok) toast("Redone"); else { DC_UNDO.pop(); DC_REDO.push(top); updateUndoButtons(); } });
    return;
  }
  DC_UNDO.push(undoSectionsRec(DC_HIST_LAST != null ? DC_HIST_LAST : histSnap()));
  dcApplyHistory(top.snap); toast("Redone");
}
// ── One save rule: every section edit saves itself ──────────────────────────
// A change is whatever makes the working list differ from what was last saved, so
// no edit path can forget to save and an unchanged list writes nothing.
let BLOCKS_SAVE_T = null, BLOCKS_SAVING = false;
function blocksDirty() {
  if (!BLOCKS_WORK || DC_HIST_LAST == null) return false;
  if (BLOCKS_WORK.some((b) => b && b._clEdit)) return false;   // a saved-section edit commits with "Update everywhere"
  return histSnap() !== DC_HIST_LAST;
}
function blocksSaveSoon(ms) {
  clearTimeout(BLOCKS_SAVE_T);
  // a field being typed into (LIVE_TYPING) saves when it's left, not halfway through a word;
  // a page change or Preview still saves it at once (dcSavePendingEdits calls blocksSaveNow)
  BLOCKS_SAVE_T = setTimeout(() => { if (LIVE_TYPING && document.activeElement === LIVE_TYPING) blocksSaveSoon(ms); else blocksSaveNow(); }, ms === undefined ? 700 : ms);
}
// Item 26: a section edited in its panel redraws on the canvas while its save waits. The
// server draws just that section from the page's list as it stands (POST /preview/section)
// and it takes the old one's place; the save's own redraw follows as before. Only for an
// edit to one or two sections: an add, a delete or a move leaves the stamps on the other
// sections stale, so it waits for the full redraw.
let LIVE_T = null, LIVE_SEQ = 0, LIVE_PROBE = false, LIVE_TYPING = null;
let LIVE_WANTED = false;   // the panel has edits the canvas should show; a list save clears it
// Item 85: each section as the live redraw last drew it, by index. Null: the canvas shows the
// saved list, as after a full redraw.
let LIVE_DRAWN = null;
const LIVE_TYPE_OK = new Set(["stack", "title", "richtext", "cta", "booking", "appointment", "newsletter", "spotlight", "table", "image_text", "video", "map",
  "features", "stats", "process", "pricing", "certifications", "events", "social", "link_list", "service_areas"]);
async function blocksSaveNow() {
  clearTimeout(BLOCKS_SAVE_T); BLOCKS_SAVE_T = null;
  // An in-place commit has its own ~1.2s debounce and saves this same list when it
  // fires. Saving here too wrote the list twice and repainted the canvas twice.
  if (BLOCKS_SAVING || IPE_SAVE_T != null || IPE_SAVE_PENDING || IPE_SAVE_INFLIGHT) { blocksSaveSoon(); return true; }
  if (!blocksDirty()) return true;
  // G27 §5: unreadable colors still get their one question; "no" puts the list back
  if (!(await ovConfirmContrastAck())) { BLOCKS_WORK = JSON.parse(DC_HIST_LAST); renderBlocksCard(); return false; }
  if (BLOCKS_SAVING) { blocksSaveSoon(); return true; }   // a save that shared the question went first (item 33)
  dcCaptureScroll();   // the save's repaint keeps the canvas where the person is now
  BLOCKS_SAVING = true;
  try { return await saveBlocks(); } finally { BLOCKS_SAVING = false; }
}
let BLOCKS_PUT = null;   // the list save on its way; a page change waits it out (dcSavePendingEdits)
let BLOCKS_PUT_WAITING = false;   // its turn hasn't come, so it will carry anything asked for now
function saveBlocks() {
  clearTimeout(BLOCKS_SAVE_T); BLOCKS_SAVE_T = null;   // this save carries whatever was pending
  whisper("topWhisper", "saving");
  if (BLOCKS_PUT_WAITING) return BLOCKS_PUT;
  BLOCKS_PUT_WAITING = true;
  const put = settingsTurn(putBlocks).finally(() => { if (BLOCKS_PUT === put) BLOCKS_PUT = null; });
  BLOCKS_PUT = put;
  return put;
}
// Runs when its turn comes, so it writes the list and the pages as they stand by then.
async function putBlocks() {
  BLOCKS_PUT_WAITING = false;
  clearTimeout(BLOCKS_SAVE_T); BLOCKS_SAVE_T = null;   // the save before it may have asked for one more
  if (dcBuiltinPage()) { whisper("topWhisper", "saved"); return true; }   // item 314: nothing of its own to write
  dcHistoryRecord();   // snapshot the previously-persisted state for undo (skipped during undo/redo)
  const sentSnap = histSnap(), sentPage = DC_PAGE;   // what this save carries, and for which page
  whisper("topWhisper", "saving");
  try {
    // CL-LINK: a saved-section edit-in-progress (_clEdit) is NOT page content — it
    // belongs to the library. If the owner saves the page mid-edit, keep the linked
    // placement (revert the temp editable block to its link) and discard the uncommitted
    // source edit, so a linked spot is never lost or accidentally flattened to a copy.
    const blocksToSave = BLOCKS_WORK.map((b) => (b && b._clEdit ? { type: "linked", ref: b._clEdit } : b));
    let r;
    if (DC_PAGE) {
      // editing a custom page → write its sections into settings.pages[slug].blocks
      const pages = dcPagesArr().map((p) => (p && p.slug === DC_PAGE ? { ...p, blocks: blocksToSave } : p));
      UNDO_QUIET++; const put = api("PUT", "/settings", { pages }); UNDO_QUIET--;   // sections keep their own snapshots in the history
      r = await put;
      S.settings = r.data || { ...S.settings, pages };
    } else {
      UNDO_QUIET++; const put = api("PUT", "/settings", { blocks: blocksToSave }); UNDO_QUIET--;
      r = await put;
      S.settings = r.data || { ...S.settings, blocks: BLOCKS_WORK };
    }
    // Typing doesn't stop for a save. If the list moved while this one was on its way,
    // those edits are newer than what just came back: keep them, and save them next.
    if (DC_PAGE !== sentPage) { /* the list on screen belongs to another page now */ }
    else if (histSnap() !== sentSnap) { DC_HIST_LAST = sentSnap; updateUndoButtons(); blocksSaveSoon(); }
    else { BLOCKS_WORK = currentBlocks(); dcHistoryCommit(); LIVE_WANTED = false; }   // the new persisted state becomes the history baseline
    // G13 §3: never rebuild the panel under a focused input — its uncommitted
    // text (panel inputs commit on change = blur) would be destroyed mid-typing.
    // The input's own blur/change re-renders; every other save re-renders here.
    const ae = document.activeElement;
    if (!(ae && ae.closest && ae.closest("#blocksCard"))) renderBlocksCard();
    if (typeof renderBlockTray === "function" && $("designTray") && $("designTray").childElementCount) renderBlockTray();   // reflect which types are now on the page
    whisper("topWhisper", "saved"); scheduleChangesRefresh(); refreshDesignPreview(); stageStale();
    return true;   // review fix 8: callers may announce "Saved" only on a real resolve
  } catch (err) {
    whisper("topWhisper", "failed");
    // Item 195 (review finding 28): a save refused for a locked section is refused again while
    // the list still holds that change, so every later edit on the page was refused too, until a
    // reload threw them all away. The page goes back to how it was last saved; the refusal says why.
    // Item 318: the page moved the moment the change was made, so a save the server REFUSES
    // (its answer, not a dropped line or a lapse, which are sent again) puts the list and the
    // page back the way they were saved, and says so. A stale draft keeps its Load the latest.
    const refused = !!(err && !err.stale && !err.offline && !err.noSession && !err.timeout && Number(err.status) >= 400 && Number(err.status) < 500 && err.status !== 401);
    if (refused && DC_PAGE === sentPage) { lockRefusedPutBack(); toast(nice(err) + " The page is back the way it was saved.", true); }
    // G7 "someone else is editing": a refused-stale save gets a calm LOAD-LATEST
    // action (with who, when the server knows) instead of a dead-end error.
    else if (!(err && err.stale)) toast(nice(err), true);   // a stale one already offers Load the latest (offerLoadLatest)
    return false;
  }
}
// The refused save's undo step never landed, so it goes too.
function lockRefusedPutBack() {
  if (DC_HIST_LAST != null && undoSectionsSame(DC_UNDO[DC_UNDO.length - 1], DC_HIST_LAST)) DC_UNDO.pop();
  BLOCKS_WORK = currentBlocks(); BLOCK_FOCUS = null; LIVE_WANTED = false; LIVE_DRAWN = null;
  dcHistoryCommit();
  dcCaptureScroll(); renderBlocksCard(); refreshDesignPreview();
}
// ── G27 reversal · per-element style overrides — "Style this section" ────────
// (docs/design/per-element-overrides-design.md §5-6). Writes the block's optional
// `style` object into BLOCKS_WORK; the server re-validates via parseStyle
// (deny-by-default: 6-hex colors, the site's TWO faces only, exact enumerations,
// contrast_ack strict-true). Keys are deleted when back at default and the whole
// object is deleted when empty, so an untouched section stays byte-identical.
// Saved by the existing "Save sections" → PUT /settings path — no new endpoint.
// Client color math: a small port of brand_kit.ts mix/luminance/contrastRatio
// (same WCAG formulas, so editor and server can never disagree).
function ovRgb(hex) { const h = hex.replace("#", ""); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function ovLum(hex) { const f = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }; const [r, g, b] = ovRgb(hex); return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
function ovContrast(a, b) { const la = ovLum(a), lb = ovLum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
// The governing contrast pairs (§5): text_color × effective background (bg_color
// if set, else the site's bg token, else white — advisory, stated in the copy),
// and white × accent (buttons render white text on the accent).
function ovStylePairs(st) {
  const pairs = [];
  if (!st) return pairs;
  const effBg = st.bg_color || normHexJs((DESIGN_TOKENS || {}).bg || "") || "#ffffff";
  if (st.text_color) pairs.push({ key: "text_color", name: "Text", color: st.text_color, fixAgainst: effBg, siteBg: !st.bg_color, ratio: ovContrast(st.text_color, effBg) });
  if (st.accent) pairs.push({ key: "accent", name: "Buttons", color: st.accent, fixAgainst: "#ffffff", siteBg: false, ratio: ovContrast("#ffffff", st.accent) });
  return pairs;
}
// §5 ACK FLOW — ONE extra confirm at "Save sections" when any section still has a
// failing, un-acknowledged pair. Confirming records contrast_ack: true on those
// blocks (cleared again by any later color change, so the check re-arms); cancel
// returns to the editor with nothing saved. Never a hard block, per Eric.
function ovContrastFailing() {
  const failing = [];
  const names = [];
  BLOCKS_WORK.forEach((b, i) => {
    const st = b && b.style; if (!st || st.contrast_ack === true) return;
    const bad = ovStylePairs(st).filter((p) => p.ratio < 4.5);
    if (!bad.length) return;
    failing.push(i);
    bad.forEach((p) => names.push("section " + (i + 1) + " — " + (p.key === "accent" ? "white button text on your accent" : "text on its background") + " is contrast " + p.ratio.toFixed(1) + " (needs 4.5)"));
  });
  return { failing, names };
}
// Item 33: the question is a styled dialog now, so the page keeps running while it is up. A
// save that comes along meanwhile shares this answer instead of asking again.
let OV_ACK_ASKING = null;
async function ovConfirmContrastAck() {
  const { failing, names } = ovContrastFailing();
  if (!failing.length) return true;
  if (!OV_ACK_ASKING) OV_ACK_ASKING = askYes("This text may be unreadable for many visitors — " + names.join("; ") + ". Use it anyway?", { ok: "Use it anyway", cancel: "Change it" }).finally(() => { OV_ACK_ASKING = null; });
  if (!(await OV_ACK_ASKING)) return false;
  ovContrastFailing().failing.forEach((i) => { BLOCKS_WORK[i] = { ...BLOCKS_WORK[i], style: { ...BLOCKS_WORK[i].style, contrast_ack: true } }; });   // read again: the list can move while it is up
  return true;
}
let FORMS_WORK = null;
let FORMS_BASE = "[]";    // FORMS_WORK as last loaded or saved, to spot unsaved edits on a page switch

// ── Slice D (AC-4) — the modes bar: Edit · Preview · Comments · Timewarp ─────
// One segmented control (#dcModeSeg), the same idiom as the device segment and
// fully ORTHOGONAL to it (device = viewport emulation, mode = interaction).
// Mode is page-session state — never persisted. Edit is today's canvas exactly;
// Preview is the same current-page frame with every piece of editing chrome
// withheld (the injector is simply not called on load — no toolbar, no insert
// gaps, no FAB); Comments is the G11 toggle RE-HOMED (the exact cmToggle()
// ON/OFF paths — byte-identical machinery, new position, label stays
// "Comments"); Timewarp reuses History's GET /publishes/timewarp + the same
// /preview?publish_id= render, read-only, with an in-canvas banner. Zero
// backend change. Same-mode clicks are no-ops — except Comments, which keeps its
// G11 toggle memory: clicking it while on returns to Edit (the OFF path).
let DC_MODE = "edit";
let PANEL_MODE = "styles";   // what the settings panel is showing right now
let BLOCK_SOLO = null;       // the one section being edited (an index into BLOCKS_WORK)
// Anything that shifts the section list on the canvas invalidates BLOCK_SOLO's index.
function dcSoloEnd() { if (PANEL_MODE === "section") closeSettingsPanel(); }
// ── Item 122: the phone bar, Call, Directions, Hours and Email along the bottom of every page
// on a phone. One choice, Off, Light or Dark, is the style setting phone_bar (lib/phone_bar.ts
// on the server, which draws it); Off removes the setting. A button shows only when the
// business details have something behind it, worked out here the same way, so the card says
// which ones the bar will have and what's missing.
function pbNow() { const t = DESIGN_TOKENS && DESIGN_TOKENS.phone_bar; return t === "light" || t === "dark" ? t : ""; }
// ── the inspector (the floating studio, part two): one section, four tabs. Content holds the
// fields; Style its colours and type; Layout its arrangement; When its dates and where it shows.
let INS_TAB = "content";
const EDGE_PATHS = { wave: "M0 0H100V5C87.5 11 62.5 -1 50 5C37.5 11 12.5 -1 0 5Z", slant: "M0 0H100L0 10Z", curve: "M0 0H100Q50 20 0 0Z", peak: "M0 0H100L50 10Z",
  zigzag: "M0 0H100V3" + Array.from({ length: 20 }, (_, i) => "L" + (100 - 5 * (i + 1)) + " " + (i % 2 ? 3 : 10)).join("") + "Z" };
// ── the floating studio: the Pages card, the Live chip, the phone's More ──
// The Pages card (part three) is a card beside the dock, like Add: every page in the order of
// the menu (renderPagesCard), the page settings behind each gear (pcPane), and the header and
// footer, the not-found page and search below. It opens from the bar's page switcher, the
// dock's Pages and a press on the site's menu on the canvas.
let PAGES_OPEN = false, PAGES_DOWN = null, PAGES_FROM = null;
// One page's settings, or one of the rows under the list, shown inside the card in place of
// the list; "All pages" comes back. It answers like pgModal: { box, close }.
let PC_PANE = null;
function pcPane(id, label) {
  if (PC_PANE) PC_PANE.close(false);
  const list = $("pcList"), wrap = $("pcPane"), box = wrap.querySelector(".pc-pane-body");
  const opener = document.activeElement;
  box.textContent = ""; box.id = id; box.setAttribute("role", "group"); box.setAttribute("aria-label", label);
  list.hidden = true; wrap.hidden = false;
  $("pagesCard").classList.add("pane-open");
  const sc = $("pcBody"); if (sc) sc.scrollTop = 0;
  const me = { box };
  me.close = (refocus) => {
    if (PC_PANE !== me) return;
    if (document.activeElement && box.contains(document.activeElement)) document.activeElement.blur();   // a field saves on change, and blur is what fires it
    PC_PANE = null;
    box.textContent = ""; box.removeAttribute("id"); box.removeAttribute("aria-label");
    wrap.hidden = true; list.hidden = false;
    $("pagesCard").classList.remove("pane-open");
    if (refocus !== false) {
      const back = opener && opener.isConnected && list.contains(opener) ? opener : list.querySelector(".pc-row.on .pc-open");
      try { if (back) back.focus({ preventScroll: true }); } catch (_) {}
    }
  };
  PC_PANE = me;
  return me;
}
// Out of Edit mode to another tab, everything saved first, as Exit does.
function pcLeaveTo(view) { closePagesCard(false); exitEditMode(view); }
// Item 125: tooltips name their keys, in this computer's words (⌘ on a Mac or an iPad, Ctrl elsewhere).
const KEY_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
(function keyTitles() {
  const k = (mac, pc) => (KEY_MAC ? mac : pc);
  ["btnUndo", "btnUndoTop"].forEach((id) => { const b = $(id); if (b) b.title = "Undo (" + k("⌘Z", "Ctrl+Z") + ")"; });
  ["btnRedo", "btnRedoTop"].forEach((id) => { const b = $(id); if (b) b.title = "Redo (" + k("⇧⌘Z", "Ctrl+Shift+Z") + ")"; });
  [["btnPagesClose", "Done (Esc)"], ["btnTrayClose", "Done (Esc): the page gets the whole screen"], ["btnCommentsClose", "Close (Esc)"]].forEach(([id, t]) => { const b = $(id); if (b) b.title = t; });
})();
// The bar's Undo, Redo, Publish and Done, and Ctrl/⌘+Z, work on every tab: one undo history for
// the whole editor. The rest of Edit mode's buttons are wired by its own part (initDesignPanels).
(function initEditorBar() {
  const on = (id, fn) => { const b = $(id); if (b) b.addEventListener("click", fn); };
  on("btnUndo", dcUndo); on("btnRedo", dcRedo);
  on("btnUndoTop", dcUndo); on("btnRedoTop", dcRedo);
  on("btnEditExit", () => exitEditMode()); on("dcBtnPublish", () => openRitual({ card: true }));
  on("btnWaitPub", () => openWaitNote()); on("dcBtnWait", () => openWaitNote());   // builder item 220
  on("waitNoteOk", () => closeWaitNote()); on("waitNotePreview", () => { closeWaitNote(); openPreview("draft"); });   // the floating studio: a card at the right, the page stays in view
  // Ctrl/⌘+Z = undo, Ctrl/⌘+Shift+Z (or Ctrl+Y) = redo — only while editing the design
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if ($("stage").classList.contains("on") || $("ritualWrap").classList.contains("on")) return;   // nothing to undo behind these
    if (document.querySelector("dialog[open], .scrim.on")) return;   // item 171 (E6): not while a question or a sheet is up
    const dv = $("view-design");
    if (dv && dv.classList.contains("on") && DC_MODE === "timewarp") return;   // view modes are read-only — no blind undo
    const t = e.target; if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || "")) return;   // don't hijack field editing
    const k = (e.key || "").toLowerCase();
    if (k === "z" && !e.shiftKey) { e.preventDefault(); dcUndo(); }
    else if ((k === "z" && e.shiftKey) || k === "y") { e.preventDefault(); dcRedo(); }
  });
})();

// ── #3 — persistent, searchable, categorized add-block tray ──────────────────
// A plain-language palette of the EXISTING BLOCK_DEFS, grouped by the same purpose
// taxonomy as the "Add a section" library (SECTION_GROUPS). Click = append; drag =
// drop at a position (see the drop-lines in #4). Nothing here is a new block type.
// ── The builder's one icon set: the shell's 24-grid, 2px-stroke family. Emoji render
// differently on every OS and read as unfinished beside the rest of the product. ──
const BI_PATHS = {
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 16l-5-5L5 20"/>',
  gallery: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
  compare: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/><path d="M8 10l-2 2 2 2"/><path d="M16 10l2 2-2 2"/>',
  imagetext: '<rect x="3" y="5" width="9" height="14" rx="1"/><path d="M15 8h6M15 12h6M15 16h4"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.8a3.5 3.5 0 0 1 0 6.4"/><path d="M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/>',
  spark: '<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  cards: '<rect x="3" y="4" width="18" height="7" rx="1"/><rect x="3" y="13" width="18" height="7" rx="1"/>',
  star: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/>',
  badge: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  price: '<path d="M12 2v20"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
  steps: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
  megaphone: '<path d="M3 10v4l13 5V5z"/><path d="M7 15.5V19a2 2 0 0 0 4 0v-2"/><path d="M19 9a3 3 0 0 1 0 6"/>',
  button: '<rect x="3" y="8" width="18" height="8" rx="4"/><path d="M8 12h8"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  download: '<path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  text: '<path d="M4 6h16M4 11h16M4 16h10"/>',
  columns: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
  chevrons: '<path d="M4 7h16M4 12h16M4 17h16"/><path d="M17 5l2 2-2 2"/>',
  tabs: '<path d="M3 9h18v11H3z"/><path d="M3 9V5h7v4"/><path d="M10 5h6v4"/>',
  carousel: '<rect x="7" y="5" width="10" height="14" rx="1"/><path d="M3 8v8M21 8v8"/>',
  progress: '<rect x="3" y="9" width="18" height="6" rx="3"/><path d="M6 12h7"/>',
  divider: '<path d="M3 12h18"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/>',
  heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 10v10M15 10v10"/>',
  section: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>',
  clipboard: '<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4a3 3 0 0 1 6 0"/>',
  page: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/>',
  home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 14h10l1-14"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 6.2A9.6 9.6 0 0 1 22 12a15 15 0 0 1-3.2 4"/><path d="M6.6 6.6A15 15 0 0 0 2 12s3.5 6 10 6a9.6 9.6 0 0 0 4.4-1"/>',
  message: '<path d="M21 12a8 8 0 0 1-8 8H8l-5 3 1.5-4.5A8 8 0 1 1 21 12z"/>',
  // the floating studio (Nov 2026): the dock, the section pill and its menu
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  more: '<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>',
  grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  // item 150: the fix list's own icons
  contrast: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 8h6.5M12 12h9M12 16h6.5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  usable: '<circle cx="12" cy="4.5" r="1.8"/><path d="M4.5 8.5l7.5 1.5 7.5-1.5"/><path d="M12 10v5"/><path d="M12 15l-3.5 6M12 15l3.5 6"/>',
  up: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  down: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
  // item 57: Blocks, Layers and the block toolbar
  layers: '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
  spacer: '<path d="M12 5v14"/><path d="M8 8l4-4 4 4"/><path d="M8 16l4 4 4-4"/>',
  form: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  alignl: '<path d="M4 6h16M4 12h10M4 18h14"/>',
  alignc: '<path d="M4 6h16M7 12h10M5 18h14"/>',
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M14 21h.01M17 21h4v-4"/>',
};
function uiIcon(name, size) {
  const s = size || 16;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${BI_PATHS[name] || BI_PATHS.section}</svg>`;
}
const PF_S = { col: "all", seq: 0, key: null, allow: null, stock: { state: null, results: [] } };
function pdReducedMotion() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (_) { return false; } }
let DC_DRAWN = false;

// ─────────────────────────────────────────────────────────────────────────────
// AEM-STYLE LIVE CANVAS — the design preview IS the editor
// ─────────────────────────────────────────────────────────────────────────────
// #designPreview is a SAME-ORIGIN srcdoc of the real render engine (draft). We
// reach into its document and layer editing chrome ON the live page, so building
// is WYSIWYG: drag a section from the tray onto the page (drop-lines appear
// between sections), grab a section to reorder it in place, and edit / duplicate /
// hide / delete right where it lives. Columns get a 2↔3 responsive-grid switch.
//
// THE MOAT: every action mutates the SAME BLOCKS_WORK list + saveBlocks() the
// side rail uses — a single list index or a column count, NEVER an x/y coordinate,
// z-index, or overlap. The served render (site_blocks.ts) is untouched: columns
// still stack to one column below 620px, order is still the list order. Structured
// blocks, always auto-responsive, always accessible. Nothing here changes output.
let DC_SCROLL = null;   // preserve the canvas scroll position across the save→reload cycle
function dcFrameDoc() { const f = $("designPreview"); try { return f && !f.inert ? f.contentDocument : null; } catch (_) { return null; } }   // none while the page just left is still up (dcOpenPage)
function dcCaptureScroll() { const d = dcFrameDoc(); DC_SCROLL = (d && d.defaultView) ? d.defaultView.scrollY : null; }
// ── Item 158: right-click on a section, a few keys, and the list of them ──
// One list of what can be done to a section feeds the right-click menu and the keys, so the
// two never disagree; each action carries its key when it has one. On a Windows computer
// Ctrl stands for ⌘ and Alt for ⌥. A null in the list is a line between groups.
const DCK = KEY_MAC ? { mod: "⌘", alt: "⌥", shift: "⇧", del: "⌫" } : { mod: "Ctrl", alt: "Alt", shift: "Shift", del: "Delete" };

// ── the session (one at a time; parent-scope state like every canvas control) ──
let IPE = null;                 // { doc, el, sec, path, md, orig, prev, busy, base, dirty }
let IPE_SAVE_T = null, IPE_SAVE_PENDING = false;
// Review fix 10 (finding 11): a committed edit inside the 1.2s debounce
// window — or a PUT still in flight, or a session holding unsaved typing —
// must not die silently with a closed tab. The browser shows its own generic
// prompt; nothing is blocked outright.
let IPE_SAVE_INFLIGHT = false;
window.addEventListener('beforeunload', (e) => {
  if (IPE_SAVE_T != null || IPE_SAVE_PENDING || IPE_SAVE_INFLIGHT || (IPE && IPE.dirty) || BLOCKS_SAVING || SETTINGS_TURNS || DRAFT_WRITES_OUT || blocksDirty()
    || (IDE && IDE.el.textContent !== IDE.orig) || IDE_SAVING || detailsPending() || blogPending() || partsPending()) { e.preventDefault(); e.returnValue = ''; }
});
// Builder item 251: a post's unsaved words (waiting, on their way, or failed) count too
function blogPending() { const bs = window.DDSBlogStudio && window.DDSBlogStudio.current && window.DDSBlogStudio.current(); return !!(bs && bs.dirty && bs.dirty()); }
let IDE = null;
let IDE_SAVING = null;   // words just typed, on their way to the server; the canvas holds its redraw till they land
function dcBlockSections(main) {
  const out = [];
  Array.prototype.forEach.call(main.querySelectorAll(":scope > section, :scope > nav.block-toc"), (el2) => {
    const c = eeClassify(el2); if (c && c.kind === "block") out.push({ el: el2, bi: c.bi });
  });
  return out;
}
const STK_TURNS = new Set(["richtext", "title", "image", "buttons", "video", "divider"]);   // the simple sections Add block turns into blocks
const STK_FILL = new Set(["image", "video", "map"]);   // a new one waits for its card: it draws nothing until then
let STK_ITEM = null;    // the block whose card is open, in BLOCK_SOLO's Blocks section
// ── Phase Z: search-engine verification codes — a field, not a technical task ──
[["f-gsv", "google_site_verification"], ["f-bsv", "bing_site_verification"]].forEach(([id, key]) => {
  $(id).addEventListener("change", async () => {
    // accept a pasted full meta tag too — extract the content value kindly
    let v = $(id).value.trim();
    const m = v.match(/content=["']([^"']+)["']/); if (m) { v = m[1]; $(id).value = v; }
    try {
      const body = {}; body[key] = v;
      await settingsPut(body);
      toast(v ? "Saved — publish, then verify at the search engine" : "Cleared");
      scheduleChangesRefresh();
    } catch (err) { toast(nice(err), true); }
  });
});
// ── Phase O: industry selector — drives the template's vocabulary + schema ──
// Item 93: a site starts as "General / other", whose words are plain (Services). While it
// is, the hint asks for the closest kind, since that choice sets the words and the looks.
function industryHint() {
  const h = $("industryHint"), sel = $("f-industry"); if (!h || !sel) return;
  h.textContent = sel.value === "generic"
    ? "Which is closest? It sets the words your site and this editor use, like Menu, Services or Classes."
    : "Sets the words your site uses, like Menu or Services, and tells Google what you are. Applies when you next publish.";
}
$("f-industry").addEventListener("change", async () => {
  const sel = $("f-industry"), was = vocabWords();
  industryHint();
  try {
    await settingsPut({ industry_key: sel.value });
    toast("Saved — your site uses the right words when you next publish");
    applyVocab(); renderPagesBar(); renderOfferings();   // item 93: the editor's own words follow at once
    await pgFollowOffering(was);
    scheduleChangesRefresh();
  } catch (err) { toast(nice(err), true); }
});
// ── Phase V (FD-N4): the announcement bar — a simple site-wide notice, no code ──
function mountAnnouncementCard() {
  // Only for plans that HAVE a website to announce on (and that can publish).
  if (!hasFeature("website") || (S.site && S.site.edition === "monitor")) return;
  const host = $("view-updates"); if (!host || $("annCard")) return;
  const card = el("div"); card.id = "annCard";
  card.innerHTML = `<h5 class="rune">Announcement bar</h5>
    <div class="field"><label for="ann-text">Message</label>
    <input type="text" id="ann-text" maxlength="140" placeholder="e.g. Closed July 4th, back Monday">
    <div class="hint">One short notice at the top of every page of your website. Leave empty for none.</div>
    <div style="display:flex;gap:10px;margin-top:10px;flex-wrap:wrap;align-items:center">
      <input type="url" id="ann-url" aria-label="Announcement link (optional)" placeholder="Link (optional)" style="flex:1;min-width:160px">
      <label for="ann-until" style="margin:0;font-size:12px">Until</label>
      <input type="date" id="ann-until">
    </div>
    <div class="hint">It appears when you next publish, and comes off after the date you choose.</div></div>`;
  host.appendChild(card);
  $("ann-text").value = S.settings.announcement_text || "";
  $("ann-url").value = S.settings.announcement_url || "";
  $("ann-until").value = (S.settings.announcement_expires_at || "").slice(0, 10);
  const annBody = () => {
    const until = $("ann-until").value;
    return { announcement_text: $("ann-text").value.trim(), announcement_url: $("ann-url").value.trim(), announcement_expires_at: until ? until + "T23:59:59Z" : null };
  };
  let annSaved = JSON.stringify(annBody());
  const annSave = async () => {
    const body = annBody(), sig = JSON.stringify(body);
    if (sig === annSaved) return;
    whisper("topWhisper", "saving");
    try { await settingsPut(body); annSaved = sig; whisper("topWhisper", "saved"); scheduleChangesRefresh(); }
    catch (err) { whisper("topWhisper", "failed"); toast(nice(err), true); }
  };
  ["ann-text", "ann-url", "ann-until"].forEach((id) => $(id).addEventListener("change", annSave));
  // Builder list item 148: the pop-up's card sits under this one (popup-card.js, loaded on first use),
  // drawn again from what's loaded like this one, never while someone types in it
  const oldPop = $("popCard"); if (oldPop && oldPop.contains(document.activeElement)) return; if (oldPop) oldPop.remove();
  loadPopupCard().then((m) => m.mount(host, { popup: S.settings.popup || null, pages: dcPageList().filter((p) => p.slug), offeringLabel: VOCAB.label,
    save: (popup) => settingsPut({ popup }), whisper: (st) => whisper("topWhisper", st), toast, changed: scheduleChangesRefresh })).catch(() => {});
}
// Bump ?v= whenever popup-card.js changes: browsers keep a .js file for a day.
let POPUP_CARD = null;
function loadPopupCard() {
  if (window.DDSPopupCard) return Promise.resolve(window.DDSPopupCard);
  if (!POPUP_CARD) POPUP_CARD = new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "/popup-card.js?v=1";
    s.onload = () => window.DDSPopupCard ? res(window.DDSPopupCard) : rej(new Error("missing"));
    s.onerror = () => rej(new Error("load"));
    document.head.appendChild(s);
  }).catch((e) => { POPUP_CARD = null; throw e; });
  return POPUP_CARD;
}
// ── L2: the commercial capacity notice — one calm card, never a number ──
// P2-F G3 — every notice kind gets a home. Website-attention items (publish
// failed, connection expired, website enquiry) ride the SAME calm card as the
// lifecycle/billing notices, each with a deep link to where it's resolved — so
// nothing dead-ends. Priority: website-attention first, then lifecycle, then capacity.
const NOTICE_ACTION = {
  publish_failed:   { label: "Open your website",       href: "presence.html#publish" },
  connection_expired:{ label: "Open Connections",       href: "connections.html" },   // reconnecting isn't always the step: the notice says which is
  website_enquiry:  { label: "View enquiries",          href: "inbox.html#enquiries" },
  lead_followup:    { label: "View enquiries",          href: "inbox.html#enquiries" },
  domain_expiry:    { label: "Manage domain",           href: "presence.html#domain" },
  search_setup:     { label: "Finish search setup",     href: "presence.html#search" },
  renewal_reminder: { label: "Open Your plan",          href: "settings.html#billing" },
  winddown_reminder:{ label: "Download everything",     href: "presence.html#foundations" },   // the export button lives in the technical desk
  win_back:         { label: "Open Your plan",          href: "settings.html#billing" },
  trial_ending:     { label: "Open Your plan",          href: "settings.html#billing" },
  trial_ended:      { label: "Open Your plan",          href: "settings.html#billing" },
  payment_trouble:  { label: "Update payment",          href: "settings.html#billing" },
  account_lapsed:   { label: "Update payment",          href: "settings.html#billing" },
  capacity:         { label: "Open Your plan",          href: "settings.html#billing" },
};
// Only alerts about this website or this account reach the website page. Everything
// else, sales above all, stays in the bell, Home and Pipeline: a deposit or a signed
// agreement here read as if that client had a site on this page.
const NOTICE_PRIORITY = ["publish_failed", "connection_expired", "website_enquiry", "payment_trouble", "account_lapsed", "trial_ended", "trial_ending", "domain_expiry", "renewal_reminder", "winddown_reminder", "search_setup", "win_back", "capacity"];
// The four client-portal notice kinds (migration 0116) belong to the BELL, not
// to this card. They are in neither table above, so the `notices[0]` fallback
// below happily rendered "New message from Acme Bakery" as a plum "outgrown your
// plan" card with a plan button. Client chatter is never a
// plan problem — exclude it from this card's candidates entirely.
const PLAN_CARD_EXCLUDE = ["client_message", "client_upload", "client_request", "client_approval", "deal_signed", "deal_followup", "deal_ready", "proposal_accepted", "lead_followup"];
async function renderPlanNotice() {
  let notices = [];
  try { const r = await api("GET", "/commerce/notices"); notices = ((r.data && r.data.notices) || []).filter((x) => PLAN_CARD_EXCLUDE.indexOf(x && x.kind) < 0); }
  catch (_) { return; }
  let n = null;
  for (const k of NOTICE_PRIORITY) { n = notices.find((x) => x.kind === k); if (n) break; }
  if (!n) return;
  const host = $("welcomeWrap");
  if (!host) return;
  // builder item 199: plans are changed in Settings → Your plan; the old price page is gone
  const act = NOTICE_ACTION[n.kind] || { label: "Open Your plan", href: "settings.html#billing" };
  const card = el("div", "deskopt");
  card.style.borderColor = "var(--plum-line,#d9cbf3)";
  card.style.background = "var(--plum-tint,#faf7ff)";
  card.appendChild(el("div", "dol", n.headline));
  card.appendChild(el("div", "dop", n.body));
  const acts = el("div", "doa");
  const up = el("a", "textact", act.label);
  up.href = act.href; up.style.textDecoration = "none";
  acts.appendChild(up);
  // R-fix F3: this Dismiss used to swallow the server's refusal (catch(_){}) and
  // call card.remove() unconditionally — so on a protected notice (a pending
  // deletion, a down site, a failed publish, an unpaid invoice: NOTICE_PRIORITY
  // can surface all of them) the operator watched the card disappear and found it
  // back on the next load. Two honest changes: the button is not drawn at all for
  // a row the server would refuse, and when it IS drawn the card only goes if the
  // dismiss actually landed — a refusal is said out loud, never mimed.
  if (n.dismissible !== false) {
    const dismiss = el("button", "quietact", "Dismiss");
    dismiss.addEventListener("click", async () => {
      dismiss.disabled = true;
      try { await api("POST", "/commerce/notices/dismiss", { id: n.id }); }
      catch (err) { dismiss.disabled = false; toast(nice(err), true); return; }
      card.remove();
    });
    acts.appendChild(dismiss);
  }
  card.appendChild(acts);
  host.hidden = false;
  host.insertBefore(card, host.firstChild);
}

// ── The welcome list: "Set up your site", eight steps that tick themselves ──
// Worked out here from what the builder already has (the business details, the
// settings, the offerings), so it needs no read of its own, ticks the moment a save
// lands (every save refreshes the to-do line), and shows for a client's site too.
// Only hiding the list is the owner's own: the server keeps that, and refuses it
// under a client view.
let SETUP_DISMISSED = null;   // null until the owner's hide is read; a client view never reads it
let SETUP_SEEN = null;        // the steps done when the owner last saw the list, so one done since ticks in front of them
function setupScoped() { return studioInClient(); }
function setupSteps() {
  const idn = S.identity || {}, loc = S.location || {}, set = S.settings || {}, site = S.site || {};
  const live = S.previewStatus && S.previewStatus.live;
  const has = (v) => !!String(v == null ? "" : v).trim();
  const field = (id) => () => {
    go("business");
    const n = $(id); if (!n) return;
    n.scrollIntoView({ block: "center" });
    const f = n.matches("input,textarea,select") ? n : (n.querySelector("input:not([disabled])") || n.querySelector("input"));
    if (f) f.focus({ preventScroll: true });
  };
  const words = (typeof vocabWords === "function" ? vocabWords() : VOCAB) || OFFER_WORDS.generic;
  return [
    { key: "details", title: "Add your business name and how to reach you", hint: "A phone number or an email, so customers can get in touch.",
      done: has(idn.business_name) && (has(idn.phone) || has(idn.email)), go: field(has(idn.business_name) ? "f-phone" : "f-business_name") },
    { key: "address", title: "Say where to find you", hint: "Your street address, or the area you serve.",
      done: has(loc.address_line1) || has(loc.city) || has(idn.service_area), go: field("f-address_line1") },
    { key: "hours", title: "Add your opening hours", hint: "Shown on your site, so nobody turns up to a locked door.",
      done: Array.isArray(loc.hours) && loc.hours.some((d) => d && !d.closed && Array.isArray(d.intervals) && d.intervals.length > 0), go: field("hoursGrid") },
    { key: "offerings", title: "Add your " + String(words.label || "services").toLowerCase(), hint: "What you offer, with prices if you like.",
      done: (S.offerings || []).length > 0, go: () => go("offerings") },
    { key: "logo", title: "Add your logo", hint: "In Files, upload it, then choose Set as logo.",
      done: !!set.logo_media_id, go: () => go("media") },
    { key: "picture", title: "Choose a welcome picture", hint: "The big photo at the top of your home page. In Files, choose Set as hero image.",
      done: !!set.cover_media_id, go: () => go("media") },
    { key: "domain", title: "Connect your web address", hint: "A name you own, like yourbusiness.com.",
      done: has(site.custom_domain) || !!(typeof HB_DOMAIN !== "undefined" && HB_DOMAIN && HB_DOMAIN.custom_domain), go: () => openFoundationsDesk({ domain: true }) },
    { key: "publish", title: "Publish your website", hint: "Check every change, then put it live.",
      done: !!(site.last_published_at || (live && live.published)), go: () => openRitual() },
  ];
}
// Draws the list into the panel and sets SETUP_LEFT for the to-do line. Hidden on a
// monitored site (nothing here to build), on the studio's own practice site, and
// once the owner hides it or every step is done.
function renderSetup() {
  const wrap = $("setupCard");
  const off = () => { SETUP_LEFT = 0; SETUP_TOTAL = 0; if (wrap) { wrap.hidden = true; wrap.textContent = ""; } };
  if (!wrap || !S.site || S.site.edition === "monitor") return off();
  const scoped = setupScoped();
  const ctx0 = window.__ddsContext || S.ctx;
  if (!scoped && !new URLSearchParams(location.search).get("client") && ctx0 && ctx0.is_agency && !(ctx0.scope && ctx0.scope.name)) return off();   // a studio's own site is a practice site (one of its own businesses, item 83, is not)
  if (!scoped && SETUP_DISMISSED !== false) return off();   // hidden by the owner, or not known yet
  const steps = setupSteps();
  const done = steps.filter((x) => x.done).length, total = steps.length;
  const doneNow = new Set(steps.filter((x) => x.done).map((x) => x.key));
  if (!SETUP_SEEN) SETUP_SEEN = doneNow;   // done before the page opened: nothing to tick
  const seen = SETUP_SEEN;
  const panel = $("todoPanel"); if (panel && panel.classList.contains("on")) SETUP_SEEN = doneNow;
  SETUP_LEFT = total - done; SETUP_TOTAL = total;
  if (!SETUP_LEFT) { wrap.hidden = true; wrap.textContent = ""; return; }
  wrap.textContent = ""; wrap.hidden = false;
  const head = el("div", "hb-card-h");
  head.appendChild(el("h2", null, "Set up your site"));
  head.appendChild(el("span", "meta", `${done} of ${total} done`));
  wrap.appendChild(head);
  const bar = el("div", "hb-progress"); const fill = el("i"); fill.style.width = Math.round(100 * done / total) + "%"; bar.appendChild(fill);
  bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", String(total)); bar.setAttribute("aria-valuenow", String(done)); bar.setAttribute("aria-label", "Setup progress");
  wrap.appendChild(bar);
  const tasks = el("div", "hb-tasks");
  for (const st of steps) {
    const row = el(st.done ? "div" : "button", "hb-task" + (st.done ? " done" : "") + (st.done && !seen.has(st.key) ? " just" : ""));
    row.dataset.step = st.key;
    if (!st.done) row.type = "button";
    const cb = el("span", "cb"); if (st.done) cb.innerHTML = uiIcon("check", 12); row.appendChild(cb);
    const t = el("span", "t"); t.appendChild(el("b", null, st.title));
    if (!st.done) t.appendChild(el("span", null, st.hint));
    row.appendChild(t);
    if (!st.done) row.addEventListener("click", () => { closeTodoPanel(); st.go(); });
    tasks.appendChild(row);
  }
  wrap.appendChild(tasks);
  if (!scoped) {
    const hide = el("button", "quietact", "Hide this list"); hide.type = "button"; hide.style.marginTop = "8px";
    hide.addEventListener("click", async () => {
      SETUP_DISMISSED = true; renderTodoLine();
      try { await api("POST", "/commerce/first-run/dismiss"); } catch (_) {}
    });
    wrap.appendChild(hide);
  }
}
// The owner's own list: read whether they hid it. A client view never asks (the
// server refuses the route under a scope) and shows the client's list as it stands.
async function renderFirstRun() {
  if (setupScoped()) return;
  try { const r = await api("GET", "/commerce/first-run"); SETUP_DISMISSED = !!(r.data && r.data.dismissed); }
  catch (_) { return; }   // unknown stays hidden: better no list than one the owner already hid
  renderTodoLine();
}
// ── The site's status, at the top of the panel: Public, Private or Offline, the
// address, and the one button that fits: Publish, Take offline, or Bring back online.
function renderSiteStatus() {
  const box = $("siteStatusCard"); if (!box) return;
  if (!S.site || S.site.edition === "monitor") { box.hidden = true; return; }
  const live = S.previewStatus && S.previewStatus.live;
  const published = !!((live && live.published) || S.site.last_published_at);
  const offline = !!(published && live && live.offline_since);
  const locked = !!(published && !offline && live && live.password_since);   // list item 175: a visitor password
  const soon = !!(!published && live && live.coming_soon_since);   // item 158: a Coming soon page stands in until the first publish
  const url = siteLiveUrl();
  box.textContent = ""; box.hidden = false;
  const row = el("div", "ts-row");
  const badge = el("span", "ts-badge " + (offline ? "off" : locked ? "pw" : published ? "public" : soon ? "soon" : "private"), offline ? "Offline" : locked ? "Password" : published ? "Public" : soon ? "Coming soon" : "Private");
  badge.id = "siteStatusBadge";
  row.appendChild(badge);
  if (((published && !offline) || soon) && url) {
    const a = el("a", "ts-url", url.replace(/^https?:\/\//, "")); a.href = url; a.target = "_blank"; a.rel = "noopener";
    row.appendChild(a);
  }
  box.appendChild(row);
  box.appendChild(el("div", "note", offline
    ? "Visitors see a short “temporarily offline” page. Nothing was deleted."
    : locked ? "Visitors type the password before they see any page."
    : published ? "Anyone can visit your site." : soon ? "Visitors see your Coming soon page. Publish puts your real site there instead." : "Only you can see it. It goes public when you publish."));
  let btn;
  if (!published) {
    btn = el("button", "pillbtn inked", soon ? "Publish my site" : "Publish");
    btn.addEventListener("click", () => { closeTodoPanel(); openRitual(); });
  } else if (offline) {
    btn = el("button", "pillbtn inked", "Bring back online"); btn.dataset.needs = "configure";
    btn.addEventListener("click", async () => { btn.disabled = true; await siteBringOnline(); refreshSiteStatus(true); });
  } else {
    btn = el("button", "pillbtn", "Take offline…"); btn.dataset.needs = "configure";
    btn.addEventListener("click", async () => { await siteTakeOffline(); refreshSiteStatus(true); });
  }
  btn.type = "button"; btn.id = "siteStatusBtn";
  box.appendChild(btn);
  if (!published && S.site.netlify_site_id) {   // item 158: before the first publish, the address can show a Coming soon page
    const cs = el("button", "pillbtn", soon ? "Change the page…" : "Put up a Coming soon page…");
    cs.type = "button"; cs.id = "siteSoonBtn"; cs.dataset.needs = "configure";
    cs.addEventListener("click", () => openComingSoon());
    box.appendChild(cs);
  }
  if (published && !offline) {
    const pw = el("button", "pillbtn ghost", locked ? "Change or remove password…" : "Add a visitor password…");
    pw.type = "button"; pw.id = "sitePasswordBtn"; pw.dataset.needs = "configure";
    pw.addEventListener("click", async () => { if (await siteSetPassword(locked)) refreshSiteStatus(true); });
    box.appendChild(pw);
  }
}
// List item 175: a password on the whole live site. The server puts it on only once the
// site itself asks strangers for it, and says so plainly when it doesn't.
async function siteSetPassword(locked) {
  const pw = await askText(locked ? "Change the visitor password" : "Add a visitor password", { password: true, ok: "Save",
    hint: locked ? "Leave it blank to take the password off, so anyone can visit again." : "Visitors type this before they see any page of your site. Share it with the people you want to let in." });
  if (pw === null || (!locked && !pw.trim())) return false;
  try { const r = await api("POST", "/site/password", { password: pw }); toast((r.data && r.data.message) || "Saved"); return true; }
  catch (err) { toast(nice(err), true); return false; }
}
// Builder list item 158: a Coming soon page, before the first publish. The sheet holds one line,
// the phone and email from Business details (each with its switch) and an optional list box;
// Put it up puts the page at the site's address (the draft is untouched), and the first
// publish replaces it. While it's up, the same sheet changes it.
async function openComingSoon() {
  if (document.querySelector("dialog.cs-sheet")) return;
  let cur = null;
  try { cur = (await api("GET", "/site/coming-soon")).data || null; } catch (err) { toast(nice(err), true); return; }
  const cs = (cur && cur.coming_soon) || {}, contact = (cur && cur.contact) || {}, up = !!cs.up_at;
  const back = document.activeElement;
  const dlg = el("dialog", "op-sheet cs-sheet"); dlg.setAttribute("aria-labelledby", "csTitle");
  const form = el("form"); form.noValidate = true;
  const h = el("h2", null, "A Coming soon page"); h.id = "csTitle";
  const head = el("div", "op-head"), hx = el("div"); hx.append(h, el("p", null, "Visitors to your address see this until you publish your site.")); head.appendChild(hx);
  const lab = el("label", "cs-lbl", "One line"); lab.htmlFor = "csLine";
  const line = el("input", "cs-in"); line.id = "csLine"; line.type = "text"; line.maxLength = 140; line.value = cs.line || ""; line.placeholder = "Opening December 1 on Main Street.";
  const err = el("p", "op-err cs-err"); err.id = "csLineErr"; err.hidden = true; line.setAttribute("aria-describedby", err.id);
  form.append(head, lab, line, err);
  const sw = (id, label, sub, on, off) => {
    const row = el("label", "cs-row"); row.htmlFor = id;
    const t = el("span", "cs-row-t"); t.append(el("b", null, label), el("span", null, sub));
    const box = el("input", "cs-sw"); box.type = "checkbox"; box.id = id; box.setAttribute("role", "switch"); box.checked = !!on && !off; box.disabled = !!off;
    row.append(t, box); form.appendChild(row); return box;
  };
  const ph = sw("csPhone", "Show the phone number", contact.phone ? `${contact.phone}, from Business details` : "Add a phone number in Business details first", cs.phone !== false, !contact.phone);
  const em = sw("csEmail", "Show the email address", contact.email || "Add an email address in Business details first", cs.email !== false, !contact.email);
  const li = sw("csList", "Let people join your list", "They hear first when you open", cs.list === true, false);
  form.appendChild(el("p", "op-note", "Search engines are told it’s temporary, so they don’t list it. Your real site replaces it the moment you publish; nothing in your draft changes."));
  const acts = el("div", "op-acts");
  const go = el("button", "op-done", up ? "Save the page" : "Put it up"); go.type = "submit"; go.dataset.needs = "configure";
  const cancel = el("button", "op-copy", "Cancel"); cancel.type = "button";
  acts.append(go, cancel); form.appendChild(acts);
  dlg.appendChild(form); document.body.appendChild(dlg);
  let shut = false;
  const close = () => { if (shut) return; shut = true; try { dlg.close(); } catch (_) {} dlg.remove(); if (back && back.isConnected) { try { back.focus({ preventScroll: true }); } catch (_) {} } };
  cancel.addEventListener("click", close);
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!line.value.trim()) { err.textContent = "Write one line first, like when you open."; err.hidden = false; line.setAttribute("aria-invalid", "true"); line.focus(); return; }
    err.hidden = true; line.removeAttribute("aria-invalid");
    go.disabled = true; go.textContent = up ? "Saving…" : "Putting it up…";
    try {
      const r = await api("POST", "/site/coming-soon", { line: line.value.trim(), phone: ph.checked, email: em.checked, list: li.checked });
      toast((r.data && r.data.message) || "Your Coming soon page is up.");
      close(); refreshSiteStatus(true);
    } catch (e2) { toast(nice(e2), true); go.disabled = false; go.textContent = up ? "Save the page" : "Put it up"; }
  });
  dlg.showModal(); line.focus();
}
// Whether the live site is offline comes from the same read the Page menu uses;
// a site never published has nothing to ask about, unless it may show a Coming soon page.
let SITE_STATUS_ASKING = false;
function refreshSiteStatus(force) {
  if (SITE_STATUS_ASKING || !S.site || S.site.edition === "monitor") return;
  if (!force && S.previewStatus) return;
  if (!force && !S.site.last_published_at && !S.site.netlify_site_id) return;   // never published and no address: nothing to ask (item 158: one with an address may show a Coming soon page)
  SITE_STATUS_ASKING = true;
  api("GET", "/preview/status")
    .then((r) => { S.previewStatus = r.data || null; renderSiteStatus(); renderTodoLine(); })
    .catch(() => {})
    .finally(() => { SITE_STATUS_ASKING = false; });
}

(async function boot() {
  try {
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) {
      showGate("Your room is just past the front desk", "It uses your usual sign-in. Sign in, and you’ll land right back here.", true);
      return;
    }
    $("gate").hidden = true; $("app").hidden = false;
    routeHashEarly();   // the asked-for view is on screen before a single read lands
    // Item 84: the Overview is the site's picture, and drawing it needs none of the reads below;
    // it waited behind all eight. The Overview's own load finds it on its way.
    loadSiteStage();
    await refreshAll();
    // The plan card and the welcome are the owner's (same rule as the billing and
    // deletion cards in refreshAll). A drilled-in operator gets the client's notices
    // from the bell and Today, and the server refuses both routes under a scope.
    if (!studioInClient()) {
      renderFirstRun();
      renderPlanNotice();
    }
    // deep links: presence.html?view=business|offerings|…|preview|publish
    const v = new URLSearchParams(location.search).get("view");
    if (v === "preview") openPreview("draft");
    else if (v === "publish") openRitual();
    else if (v && $("view-" + v)) go(v);
    routeHash();   // CP-2.6: #hash deep-links (palette/nav) — hash wins when present
    // item 38: Edit mode's part loads once the page has settled, so Edit site is ready when pressed
    (window.requestIdleCallback || ((f) => setTimeout(f, 300)))(() => { ddsPart("edit").catch(() => {}); }, { timeout: 3000 });
  } catch (err) {
    if (err.status === 404) showGate("Almost ready", "Your room is being prepared — your studio is on it. Check back soon, or write to support@davisdigitalstudio.com.", true);
    else if (err.status === 403) showGate("Paused for now", String(err.message || "").replace(/^\[[\w-]+\] /, ""), true);   // item 95: refreshAll tags which read failed, for the log
    else if (err.message !== "no-session") { try { console.error("[presence boot]", err.status, err.message, err.body); } catch (_) {} showGate("Nothing was lost", "Your words are safe and your live site is untouched — this page just couldn’t load. Try again in a moment, or write to support@davisdigitalstudio.com.", true, true); }
  }
})();
