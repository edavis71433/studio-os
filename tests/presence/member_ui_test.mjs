// ── A member's pages offer only what their role can use (MC-3) ───────────────
// MC-2 made the server refuse a member's delete and configure writes, so a staff seat
// could still press Delete and be told no. Pages now mark those controls data-needs;
// shell.js names what the caller lacks and shell.css hides them. This reads the page
// source against the real role lists, so a new delete or configure call fails here
// until its control is marked. tests/e2e/member-roles.spec.ts drives the same controls
// in a browser for each kind of person.
//
//   deno run --allow-read tests/presence/member_ui_test.mjs
const P = '../../supabase/functions/presence';
const { memberWriteNeeds, contentWriteNeeds, siteCan } = await import(`${P}/lib/site_roles.ts`);

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const count = (text, s) => text.split(s).length - 1;

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const fill = (route) => route.replaceAll(':id2', ID).replaceAll(':id', ID);
const needOf = (name) => { const [m, r] = name.split(' '); return contentWriteNeeds(fill(r), m) ?? memberWriteNeeds(fill(r), m); };

// ═══ every call a page makes to a delete or configure route, and what marks its control ═══
// [route, page, the call as the page writes it, the marks on its control]
const CONTROLS = [
  ['DELETE /assets/:id', 'files.html', `api('/assets/'+id,'DELETE')`, ['data-needs="delete" onclick="del(']],
  ['DELETE /bookings/types/:id', 'presence.html', `api("DELETE", "/bookings/types/" + t.id)`, ['el("button", null, "Remove"); del.dataset.needs = "delete"']],
  ['DELETE /content-library/:id', 'presence.html', `api("DELETE", "/content-library/" + it.id)`, ['el("button", null, "×"); del.dataset.needs = "delete"']],
  ['DELETE /knowledge/docs/:id', 'presence.html', 'api("DELETE", `/knowledge/docs/${d.id}`)', ['el("button", "quietact", "Remove"); del.dataset.needs = "delete"']],
  ['DELETE /media/:id', 'presence.html', 'api("DELETE", `/media/${m.id}`)', ['el("button", "del", "✕"); del.dataset.needs = "delete"']],
  ['DELETE /publishes/checkpoints/:id', 'presence.html', 'api("DELETE", `/publishes/checkpoints/${c.id}`)', ['acts.lastChild.dataset.needs = "delete"']],
  ['DELETE /redirects/:id', 'presence.html', `api("DELETE", "/redirects/" + row.id)`, ['x.dataset.needs = "delete"']],
  ['POST /comments/:id/delete', 'presence.html', `"/comments/" + c.id + "/delete"`, ['d.dataset.needs = "delete"']],
  ['DELETE /sales/contacts/:id', 'contacts.html', `api('/sales/contacts/'+encodeURIComponent(id),'DELETE')`, ['class="rowact danger" data-needs="delete" data-del=', 'class="danger" data-needs="delete" data-del=']],
  ['DELETE /sales/contacts/:id', 'contacts.html', `api('/sales/contacts/'+encodeURIComponent(id)+'?confirm=1','DELETE')`, []],
  ['DELETE /sales/contacts/:id', 'crm.html', `apiAg('/sales/contacts/'+cid,'DELETE')`, ['id="ec-del" data-needs="delete"']],
  ['DELETE /sales/contacts/:id', 'crm.html', `apiAg('/sales/contacts/'+cid+'?confirm=1','DELETE')`, []],
  ['DELETE /sales/deals/:id', 'pipeline.html', `api('/sales/deals/'+id,'DELETE')`, ['<div class="sec" data-needs="delete"']],
  ['DELETE /sales/proposals/:id', 'pipeline.html', `api('/sales/proposals/'+b.dataset.delProp,'DELETE')`, ['data-needs="delete" data-del-prop=']],
  ['DELETE /sales/contracts/:id', 'pipeline.html', `api('/sales/contracts/'+b.dataset.delCon,'DELETE')`, ['data-needs="delete" data-del-con=']],
  ['DELETE /sales/templates/:id', 'pipeline.html', `api('/sales/templates/'+b.dataset.delTpl,'DELETE')`, ['data-needs="delete" data-del-tpl=']],
  ['POST /sales/invoices/:id/void', 'pipeline.html', `api('/sales/invoices/'+b.dataset.voidInv+'/void','POST',{})`, ['data-needs="delete" data-void-inv="${esc(i.id)}"', 'data-needs="delete" data-void-inv="${v.id}"']],
  ['POST /sales/invoices/:id/void', 'crm.html', `apiAg('/sales/invoices/'+b.getAttribute('data-void-inv')+'/void','POST',{})`, ['data-void-inv="${esc(v.id)}" data-needs="delete"']],
  ['POST /sales/deals/:id/retainer/cancel', 'pipeline.html', `api('/sales/deals/'+id+'/retainer/cancel','POST',{})`, ['id="cancelRetainer" data-needs="delete"']],
  ['POST /sales/deals/:id/retainer/cancel', 'crm.html', `apiAg('/sales/deals/'+d.id+'/retainer/cancel','POST',{})`, [`data-ret-cancel="1" data-needs="delete"`]],
  // the content path answers from contentWriteNeeds
  ['DELETE /offerings/:id', 'presence.html', 'api("DELETE", `/offerings/${o.id}`)', ['data-act="del" data-needs="delete"']],
  ['DELETE /faqs/:id', 'presence.html', 'api("DELETE", `/${collection}/${entity.id}`)', ['data-act="del" data-needs="delete"']],
  ['DELETE /testimonials/:id', 'presence.html', 'api("DELETE", `/${collection}/${entity.id}`)', ['data-act="del" data-needs="delete"']],
  ['DELETE /posts/:id', 'presence.html', 'api("DELETE", `/posts/${p.id}`)', ['data-act="del" data-needs="delete"']],
  // Undo: undoing an add removes the row, so a role without delete isn't offered that step
  ['DELETE /offerings/:id', 'presence.html', 'api("DELETE", `/${rec.col}/${rec.id}`)', ['window.ddsLacks && window.ddsLacks("delete") ? null : { kind: "create"']],

  ['POST /foundations/domain', 'presence.html', `api("POST", "/foundations/domain", { domain })`, ['choose.dataset.needs = "configure"', 'havePanel.dataset.needs = "configure"', 'needPanel.dataset.needs = "configure"', 'btn.dataset.needs = "configure"; btn.textContent = "Connect your domain"']],
  ['DELETE /foundations/domain', 'presence.html', `api("DELETE", "/foundations/domain")`, ['rm.dataset.needs = "configure"']],
  ['POST /foundations/prepare', 'presence.html', `api("POST", "/foundations/prepare", { goal: "email_auth" })`, ['acts.dataset.needs = "configure"', 'after.dataset.needs = "configure"']],
  ['POST /preview/settings', 'presence.html', `act("/preview/settings", "Preview access updated"`, ['"Preview access updated", { password: pw }); });\n    acts.lastChild.dataset.needs = "configure";']],
  ['POST /preview/settings', 'presence.html', `act("/preview/settings", "Preview link reset"`, ['"Preview link reset", { regenerate_token: true }); });\n    acts.lastChild.dataset.needs = "configure";']],
  ['POST /site/offline', 'presence.html', `siteSetState("/site/offline"`, ['offBtn.dataset.needs = "configure"']],
  ['POST /site/online', 'presence.html', `siteSetState("/site/online"`, ['offBtn.dataset.needs = "configure"']],
  ['PUT /bookings/settings', 'presence.html', `api("PUT", "/bookings/settings", payload)`, ['c1.dataset.needs = "configure"', 'c2.dataset.needs = "configure"']],
  ['PUT /sales/contacts/fields', 'contacts.html', `api('/sales/contacts/fields','PUT',{fields})`, ['id="manageFields" data-needs="configure"']],
];
// nothing in a page calls these: they answer scripts and the operator's tools
const NO_CONTROL = {
  'DELETE /projects/:id/deliverables/:id2': /\/deliverables\/[^\n]*DELETE|DELETE[^\n]*\/deliverables\//,
  'DELETE /foundations/zone': /\/foundations\/zone/,
  'DELETE /foundations/zone/records': /\/foundations\/zone/,
  'POST /foundations/zone': /\/foundations\/zone/,
  'POST /foundations/zone/records': /\/foundations\/zone/,
  'PUT /foundations/zone/records': /\/foundations\/zone/,
  'PUT /foundations/dns': /\/foundations\/dns/,
  'POST /foundations/dns/rollback': /\/foundations\/dns/,
};
const PAGES = [...Deno.readDirSync(ROOT)].filter((f) => f.isFile && /\.(html|js)$/.test(f.name)).map((f) => f.name);
const SOURCE = Object.fromEntries(PAGES.map((p) => [p, read(p)]));

// ═══ 1. the table tells the truth, against the lists the server enforces ═══
{
  for (const [route, page, call, marks] of CONTROLS) {
    const need = needOf(route);
    ok(`${route} on ${page}: staff can't, so it needs its control marked`, (need === 'delete' || need === 'configure') && !siteCan('business_staff', need), String(need));
    ok(`${route} on ${page}: the page makes this call`, SOURCE[page].includes(call), call);
    for (const m of marks) ok(`${route} on ${page}: its control is marked`, SOURCE[page].includes(m), m);
  }
  ok('the row delete and the card delete on Contacts both carry the mark', count(SOURCE['contacts.html'], 'data-needs="delete" data-del=') === 2);
  ok('the three builder "Remove for good" buttons all carry the mark', count(SOURCE['presence.html'], 'data-act="del" data-needs="delete"') === 3 && !SOURCE['presence.html'].includes('data-act="del">'));
  ok('both saved-template lists carry the mark', count(SOURCE['pipeline.html'], 'data-needs="delete" data-del-tpl=') === 2);
  ok('no unmarked Void or template remove is left on the deal page', !/<button class="btn ghost( sm)?" data-(void-inv|del-tpl|del-prop|del-con)=/.test(SOURCE['pipeline.html']));
}

// ═══ 2. every decided route is either offered, and marked, or not offered at all ═══
{
  const decided = read('tests/presence/member_capability_test.mjs');
  const listed = (name) => [...decided.split('const DECIDED = {')[1].split(`\n  ${name}: [`)[1].split('\n  ],')[0].matchAll(/'((?:DELETE|POST|PUT|PATCH) [^']+)'/g)].map((m) => m[1]);
  const routes = [...listed('delete'), ...listed('configure')];
  ok('the decided delete and configure lists were read', routes.length === 31, String(routes.length));
  const covered = new Set(CONTROLS.map(([r]) => r));
  const open = routes.filter((r) => !covered.has(r) && !NO_CONTROL[r]);
  ok('every decided delete and configure route is accounted for here', open.length === 0, open.join(', '));
  for (const [route, rx] of Object.entries(NO_CONTROL)) {
    const pages = PAGES.filter((p) => rx.test(SOURCE[p]));
    ok(`${route}: no page calls it`, pages.length === 0, pages.join(', '));
  }
}

// ═══ 3. tripwire: a new call fails until its control is marked and it is listed here ═══
{
  const known = (page) => [
    ...CONTROLS.filter((c) => c[1] === page).map((c) => c[2]),
    // these answer to other capabilities: connect, and the studio-only note routes
    'api("DELETE", "/monitor/connection")', `api('/crm/notes/'+b.getAttribute('data-delnote'),'DELETE')`,
  ];
  // both spellings the pages use: api("DELETE", route) and api(route, 'DELETE')
  const deletes = /\bapi\(\s*"DELETE"\s*,[^)\n]*\)|\b(?:api|apiAg)\(['`][^;\n]*?,\s*'DELETE'\)/g;
  const sent = (page) => SOURCE[page].match(deletes) || [];
  for (const page of PAGES) {
    const fresh = sent(page).filter((call) => !known(page).includes(call));
    ok(`${page}: every DELETE it sends is decided`, fresh.length === 0, fresh.join(' | '));
  }
  ok('tripwire: the DELETE scan found the calls it is meant to find', sent('pipeline.html').length === 4 && sent('presence.html').length === 12 && sent('contacts.html').length === 2 && sent('crm.html').length === 4 && sent('files.html').length === 1);

  const CONFIG = /\/(?:foundations\/(?:domain|prepare)|preview\/settings|site\/(?:offline|online)|bookings\/settings|sales\/contacts\/fields)\b/;
  const writes = new RegExp(`(?:api\\(\\s*["'](?:POST|PUT|DELETE)["']\\s*,\\s*["'\`]|act\\(["']|siteSetState\\(["'])${CONFIG.source}|api\\(["'\`]${CONFIG.source}["'\`]\\s*,\\s*["'](?:POST|PUT|DELETE)["']`, 'g');
  let seen = 0;
  for (const page of PAGES) {
    for (const call of SOURCE[page].match(writes) || []) {
      seen++;
      if (!known(page).some((k) => k.includes(call))) ok(`${page}: this configure write is listed`, false, call);
    }
  }
  ok('tripwire: the configure scan found every call in the table', seen === 9, String(seen));
}

// ═══ 4. settings: one row, two kinds of field ═══
{
  const settingsNeed = (...f) => contentWriteNeeds('/settings', 'PUT', f);
  for (const f of ['industry_key', 'google_site_verification', 'bing_site_verification']) ok(`PUT /settings ${f} is configure`, settingsNeed(f) === 'configure');
  for (const f of ['auto_ack_enquiries', 'invoice_reminders', 'deal_nudges', 'invoice_remind_after_days', 'deal_nudge_days', 'stage_stale_days']) ok(`PUT /settings ${f} is configure`, settingsNeed(f) === 'configure');
  ok('the rest the builder saves stays edit, so staff keep it', settingsNeed('category_order', 'pages_noindex', 'page_seo', 'hero_layout', 'nav_style', 'pages', 'nav', 'blocks', 'sections_order', 'sections_hidden', 'announcement_text', 'announcement_url', 'announcement_expires_at', 'logo_media_id', 'cover_media_id', 'og_media_id') === 'edit');

  const builder = SOURCE['presence.html'], settings = SOURCE['settings.html'];
  ok('builder: the industry field is marked', builder.includes('<div class="field" data-needs="configure"><label for="f-industry">'));
  ok('builder: the verification codes are marked', /<details data-needs="configure"[^>]*>\s*<summary[^>]*>Verification codes/.test(builder));
  ok('settings: the industry field is marked', settings.includes('<div data-needs="configure"><label for="f-industry">'));
  ok('settings: the automations card and its section are marked', settings.includes(`studioOnly: true, needs: 'configure' }`) && settings.includes('id="automations" aria-labelledby="autoHead" hidden data-needs="configure"'));
  ok('settings: saving the profile sends no industry for a role without configure', /const mayConfigure = !\(window\.ddsLacks && window\.ddsLacks\('configure'\)\);\s*if \(mayConfigure && /.test(settings));
}

// ═══ 5. what asks for the owner by role, not by capability ═══
{
  const site = read('supabase/functions/presence/routes/site.ts');
  ok('PUT /site/template still refuses everyone but the owner and platform staff', site.includes(`if (!isOperator && role !== 'business_owner') return json({ error: 'forbidden'`));
  ok('…and is open on the member list, so the handler is what refuses', memberWriteNeeds('/site/template', 'PUT') === 'open');
  const builder = SOURCE['presence.html'];
  ok('both ways to change the template are marked', builder.includes('<div id="designGallery" hidden data-needs="owner">') && builder.includes('"Use this look"); use.dataset.needs = "owner"'));
  ok('the template calls are the two that were marked', count(builder, 'api("PUT", "/site/template"') === 2);
  ok('Styles holds only what staff can\'t use: its button is marked, and the panel says so if reached another way', builder.includes('id="btnSettingsOpen" data-needs="configure"') && builder.includes('id="stylesAsk" hidden data-if-lacks="configure"') && builder.includes('#settingsPanel:not([data-mode="styles"]) #stylesAsk{display:none !important}'));
  ok('account deletion is marked', builder.includes('d.id = "deleteCard"; d.dataset.needs = "owner"'));
  ok('the Sharing link in the rail is marked', builder.includes('<a href="/sharing.html" data-needs="owner">'));
  ok('the plan card and its section are marked: /commerce only knows the caller\'s own account', SOURCE['settings.html'].includes("ownerOnly: true, needs: 'owner' }") && SOURCE['settings.html'].includes('id="billing" aria-labelledby="billingHead" hidden data-needs="owner"'));
}

// ═══ 6. the mechanism ═══
{
  const shell = SOURCE['shell.js'];
  const css = read('shell.css');
  ok('shell: owners, a studio scoped in and platform staff lack nothing, and neither does a context with no list', shell.includes(`if (ctx.site_role === 'business_owner' || ctx.scope || ctx.is_operator || !Array.isArray(caps)) return;`));
  ok('shell: it marks limits from the context it just read, before drawing', shell.includes('CTX = r.body.data; markRoleLimits(CTX); render();'));
  for (const need of ['delete', 'configure', 'owner']) ok(`css: data-needs="${need}" goes away when it is lacking`, css.includes(`html[data-dds-lacks~="${need}"] [data-needs="${need}"]`));
  ok('css: it beats a page that shows the control itself', /\[data-needs="owner"\]\{display:none!important\}/.test(css));
  ok('css: a note beats the builder\'s [hidden] rule only for someone lacking it', css.includes('html[data-dds-lacks~="configure"] [data-if-lacks="configure"][hidden]{display:block!important}'));
  ok('builder: a note starts hidden, so nobody else ever sees it', SOURCE['presence.html'].includes('n.hidden = true; n.dataset.ifLacks = "configure"'));
  const marked = PAGES.filter((p) => /data-needs|dataset\.needs|needs: '/.test(SOURCE[p]) && p !== 'shell.js');
  ok('the six pages with marked controls are the ones expected', JSON.stringify(marked.sort()) === JSON.stringify(['contacts.html', 'crm.html', 'files.html', 'pipeline.html', 'presence.html', 'settings.html']), marked.join(', '));
  for (const p of marked) ok(`${p} loads the shell script and its stylesheet`, SOURCE[p].includes('src="/shell.js"') && SOURCE[p].includes('href="/shell.css"'));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ MEMBER UI: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
Deno.exit(0);
