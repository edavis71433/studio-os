// ── Builder list item 158, second part (Nov 2026) ────────────────────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/editor_comforts_158_two_test.mjs
// The right-click menu and its keys, the code to open the draft on a phone, and a Coming soon
// page before the first publish. (The code itself is checked in qr_test.mjs; the menu, the keys
// and the cards in a browser in tests/e2e/editor-comforts-158-two.spec.ts.)
for (const [k, v] of Object.entries({ SUPABASE_URL: 'http://stub.local', SERVICE_ROLE_KEY: 'SERVICE-KEY', SUPABASE_ANON_KEY: 'ANON-KEY', NETLIFY_AUTH_TOKEN: 'fake' })) Deno.env.set(k, v);
const P = '../../supabase/functions/presence';
const { normalizeComingSoon, comingSoonSince, renderComingSoonPage, comingSoonFileMap, COMING_SOON_LINE_MAX } = await import(`${P}/lib/coming_soon.ts`);
const { shapePreviewStatus } = await import(`${P}/lib/preview_env.ts`);
const { siteState } = await import(`${P}/agency/sites.ts`);
const { memberWriteNeeds } = await import(`${P}/lib/site_roles.ts`);
const { RESERVED_NAMES } = await import(`${P}/lib/reserved_store.ts`);
const { handleComingSoon } = await import(`${P}/routes/publish.ts`);

const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${p || !note ? '' : ' — ' + note}`); };
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const SITE = { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', status: 'ready', edition: 'presence', netlify_site_id: 'nf-site-1' };

// ═══ the right-click menu and the keys (presence.html) ═══
{
  const src = read('presence.html');
  const fn = (name) => { const at = src.indexOf(`function ${name}(`); return at < 0 ? '' : src.slice(at, src.indexOf('\n}\n', at) + 2); };
  const acts = fn('dcSectionActions');
  ok('one list of a section’s actions feeds the menu and the keys', !!acts && /dcSectionActions\(el2\)\.forEach/.test(src) && /dcSectionActions\(el2\)\.find\(\(a\) => a && a\.id === id\)/.test(src));
  ok('the menu holds the pill’s actions and More’s, in the drawing’s order', ['"Edit section"', '"Style"', '"Duplicate"', '"Copy"', '"Cut"', '"Paste below"', '"Move up"', '"Move down"', '"Hide on this page"', '"Lock this section"', '"Delete"'].every((w, i, all) => acts.includes(w) && (i === 0 || acts.indexOf(all[i - 1]) < acts.indexOf(w))));
  ok('Paste below appears only once a section is copied, and pastes under it', /if \(dcClipGet\(\)\) out\.push\(\{ id: "paste", label: "Paste below"[^\n]*dcPasteAt\(bi \+ 1\)/.test(acts));
  ok('only the studio locks; a locked section offers its words at most', /if \(S\.isStudio\) out\.push\(blkLock\(b\)/.test(acts) && /if \(lockedForMe\(b\)\) \{[\s\S]*?label: "Edit words"[\s\S]*?return out;/.test(acts));
  ok('Delete asks first (dcDelete’s own question)', /id: "del", label: "Delete"[^\n]*run: \(\) => dcDelete\(bi\)/.test(acts) && /async function dcDelete\(bi\)[\s\S]{0,400}askYes\(/.test(src));
  const key = fn('dcEditorKey');
  ok('keys never fire while typing in a box or in the page’s words', /dcTyping\(e\.target\)/.test(key) && /IPE \|\| IDE \|\| PDRAG/.test(key) && /const dcTyping = \(t\) => !!t && \(\/\^\(INPUT\|TEXTAREA\|SELECT\)\$\/\.test\(t\.tagName \|\| ""\) \|\| !!t\.isContentEditable\)/.test(src));
  ok('Enter and Delete reach the section only from the page itself, never from a focused control', /\(id === "edit" \|\| id === "del"\) && e\.target !== home\.body/.test(key));
  ok('Copy and Cut leave selected words to the browser', /\(id === "copy" \|\| id === "cut"\) && dcHasSelection\(\)/.test(key));
  ok('? opens the editor’s list in place of the shell’s, which never hears it', /e\.key === "\?"[\s\S]*?e\.stopImmediatePropagation\(\); dcKeysSheet\(\)/.test(key) && /document\.addEventListener\("keydown", \(e\) => dcEditorKey\(e, null\), true\);/.test(src));
  ok('on a Windows computer Ctrl and Alt stand for ⌘ and ⌥', /const DCK = KEY_MAC \? \{ mod: "⌘", alt: "⌥"[^}]*\} : \{ mod: "Ctrl", alt: "Alt"/.test(src));
  ok('each key reaches a screen reader through aria-keyshortcuts', /b\.setAttribute\("aria-keyshortcuts", dcKeysAria\(a\.keys\)\)/.test(src));
  ok('the touch More holds Move up, Move down and Paste below too', /more\.appendChild\(mkItem\("Paste below"/.test(src) && /more\.appendChild\(mkItem\("Move up"/.test(src) && /more\.appendChild\(mkItem\("Move down"/.test(src));
  ok('a press inside the page still undoes, redoes, closes and searches', /function dcFrameKeys\(doc\)[\s\S]*?k === "z" \|\| k === "y" \|\| k === "k"[\s\S]*?document\.dispatchEvent\(new KeyboardEvent/.test(src) && /dcFrameKeys\(doc\);/.test(src));
  ok('a card over the page answers its own Escape (both of the page’s Escape handlers step aside)', (src.match(/if \(document\.querySelector\("dialog\[open\]"\)\) return;   \/\/ a (card over the preview|question or card on top)/g) || []).length === 2);
}

// ═══ the draft on your phone (presence.html) ═══
{
  const src = read('presence.html');
  ok('the code is the same private link Share a draft link makes: read-only, 7 days', /async function mintDraftLink\(\)[\s\S]{0,200}api\("POST", "\/preview\/share-link", \{ capture: true, ttl_seconds: 7 \* 86400 \}\)/.test(src) && /const \{ url, until \} = await mintDraftLink\(\);/.test(src));
  ok('Preview’s bar has the button beside the device buttons', /<button data-dev="mobile">Phone<\/button>\s*<\/div>\s*<button type="button" class="stage-phone" id="btnOnPhone"><\/button>/.test(src));
  ok('the Page menu has Open on my phone… right after Share a draft link…', /mi\("Share a draft link…"[^\n]*\n  mi\(onAPhone\(\) \? "Open in my browser…" : "Open on my phone…"/.test(src));
  ok('qr.js loads only when a code is needed', /s\.src = "\/qr\.js\?v=1"/.test(src) && !/<script src="\/qr\.js/.test(src));
  ok('on a phone the link opens in a tab opened while the press still counts', /const tab = window\.open\("", "_blank"\);/.test(src) && /tab\.opener = null/.test(src));
  ok('the card never promises what the link can’t do: after more changes, press it again', src.includes('After more changes, press On my phone here again and reload the page there.'));
}

// ═══ a Coming soon page: the words ═══
{
  ok('kept on the site under its own name', RESERVED_NAMES.comingSoon === '__coming_soon__');
  const n = normalizeComingSoon({ line: '  Opening   December 1\n on Main Street.  ', phone: false, list: 'yes', up_at: 'nope' });
  ok('one line of plain words; phone and email on unless switched off; the list off unless switched on', n.line === 'Opening December 1 on Main Street.' && n.phone === false && n.email === true && n.list === false && n.up_at === null);
  ok('a line is kept to 140 characters', normalizeComingSoon({ line: 'x'.repeat(400) }).line.length === COMING_SOON_LINE_MAX && COMING_SOON_LINE_MAX === 140);
  ok('nothing stored reads as nothing put up', JSON.stringify(normalizeComingSoon(null)) === JSON.stringify({ line: '', phone: true, email: true, list: false, up_at: null }));
  ok('up means put up and never published since: the first publish replaces it', comingSoonSince({ line: 'x', up_at: '2026-11-12T10:00:00Z' }, false) === '2026-11-12T10:00:00Z' && comingSoonSince({ line: 'x', up_at: '2026-11-12T10:00:00Z' }, true) === null && comingSoonSince(null, false) === null);
}

// ═══ a Coming soon page: what visitors see ═══
{
  const ep = 'http://stub.local/functions/v1/presence/forms/aaaa/submit';
  const html = renderComingSoonPage({ businessName: 'Marlow’s <Kitchen>', accent: '#5a3a22', line: 'Opening December 1 on Main Street.', phone: '(818) 555-0147', email: 'hello@marlows.example', list: true, formEndpoint: ep, year: 2026 });
  ok('the name, Coming soon and the line, the name made safe', html.includes('<span class="cs-name">Marlow’s &lt;Kitchen&gt;</span>') && html.includes('<h1>Coming soon</h1>') && html.includes('<p class="cs-says">Opening December 1 on Main Street.</p>'));
  ok('a Call button dials the number; the email button writes to the address', html.includes('href="tel:8185550147"') && html.includes('<span>Call (818) 555-0147</span>') && html.includes('href="mailto:hello@marlows.example"'));
  ok('on a phone the buttons go full width and the email one says Email us', /@media \(max-width:560px\)\{[\s\S]*\.cs-btn\{width:100%\}[\s\S]*\.cs-narrow\{display:inline\}/.test(html) && html.includes('<span class="cs-narrow">Email us</span>'));
  ok('the site’s own colour, from the brand accent; anything that isn’t a colour falls back', html.includes('background:#5a3a22') && !renderComingSoonPage({ accent: 'red;}body{x' }).includes('red;}'));
  ok('search engines are told to leave it out', html.includes('<meta name="robots" content="noindex,nofollow">'));
  ok('the list box posts to the site’s form address as a signup, with the page’s sender', html.includes(`action="${ep}"`) && html.includes('name="form_kind" value="signup"') && html.includes("TKURL=EP.replace"));
  ok('the year and the name at the foot', html.includes('<footer>&copy; 2026 Marlow’s &lt;Kitchen&gt;</footer>'));
  const bare = renderComingSoonPage({ businessName: 'Marlow’s Kitchen', line: 'Soon.' });
  ok('switched off, no phone, no email and no list box', !bare.includes('tel:') && !bare.includes('mailto:') && !bare.includes('<form') && !bare.includes('<script'));
  const files = comingSoonFileMap(html);
  ok('it ships Take offline’s files: the page at every path, robots shut, noindex in the headers', files['index.html'] === html && files['404.html'] === html && files['robots.txt'] === 'User-agent: *\nDisallow: /\n' && /X-Robots-Tag: noindex, nofollow/.test(files['_headers']));
}

// ═══ a Coming soon page: the server ═══
{
  ok('putting it up is configure, like taking the site offline', memberWriteNeeds('/site/coming-soon', 'POST') === 'configure' && memberWriteNeeds('/site/offline', 'POST') === 'configure');
  const idx = read('supabase/functions/presence/index.ts');
  ok('GET and POST /site/coming-soon are routed', /route === '\/site\/coming-soon' && method === 'GET'\) return handleComingSoonRead/.test(idx) && /route === '\/site\/coming-soon' && method === 'POST'\) return handleComingSoon\(/.test(idx));
  const status = shapePreviewStatus({ draftChanges: 0, preview: null, live: null, baseUrl: 'https://app.example', comingSoonAt: '2026-11-12T10:00:00Z' });
  ok('the site’s status says when the Coming soon page went up', status.live.coming_soon_since === '2026-11-12T10:00:00Z' && shapePreviewStatus({ draftChanges: 0, preview: null, live: null, baseUrl: 'x' }).live.coming_soon_since === null);
  const pe = read('supabase/functions/presence/routes/preview_env.ts');
  ok('…read from the site, null once it has gone live', /const comingSoonAt = comingSoonSince\(cs, !!live\);/.test(pe));
  const base = { edition: 'presence', status: 'ready', last_published_at: null };
  ok('the Sites card says Coming soon, still not live underneath', JSON.stringify(siteState(base, null, true)) === JSON.stringify({ key: 'not_live', words: 'Coming soon' }) && siteState(base, null).words === 'Not live yet');
  ok('…and Live once it has gone live, whatever was put up', siteState({ ...base, status: 'live', last_published_at: '2026-11-12T00:00:00Z' }, null, true).key === 'live');

  // the route, against a pretend database and Netlify
  let live = [], calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url)); const method = (init.method || 'GET').toUpperCase();
    calls.push(`${method} ${u.hostname}${u.pathname}`);
    const reply = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (u.hostname !== 'stub.local') return reply({ message: 'not here' }, 404);   // Netlify: the deploy fails, and says so
    const table = u.pathname.replace('/rest/v1/', '');
    if (table === 'presence_publishes') return reply(/status=eq\.live/.test(decodeURIComponent(u.search)) ? live : []);
    if (table === 'presence_identity') return reply([{ business_name: 'Marlow’s Kitchen', phone: '555 0100', email: 'hi@marlows.example' }]);
    return reply([]);
  };
  const post = (body) => handleComingSoon(new Request('http://stub.local/x', { method: 'POST', body: JSON.stringify(body) }), SITE, { kind: 'user', userId: 'u1', email: 'owner@example.com' }, {});
  const noLine = await post({ line: '   ' });
  ok('no line, no page: it asks for one', noLine.status === 400 && (await noLine.json()).error === 'line_required');
  live = [{ id: 'p1' }];
  const isLive = await post({ line: 'Soon.' });
  ok('a site that has gone live doesn’t need one', isLive.status === 409 && (await isLive.json()).error === 'already_live');
  live = []; calls = [];
  const noHost = await handleComingSoon(new Request('http://stub.local/x', { method: 'POST', body: JSON.stringify({ line: 'Soon.' }) }), { ...SITE, netlify_site_id: null }, { kind: 'user', userId: 'u1' }, {});
  ok('no hosting yet: it says so and deploys nothing', noHost.status === 409 && (await noHost.json()).error === 'config' && !calls.some((c) => !c.includes('stub.local')));
  calls = [];
  const tried = await post({ line: 'Soon.' });
  const tb = await tried.json();
  ok('otherwise it deploys through Netlify, and a deploy that fails records nothing and says so', calls.some((c) => c.includes('api.netlify.com')) && tried.status === 502 && tb.error === 'deploy_failed' && !calls.some((c) => c.startsWith('POST stub.local/rest/v1/presence_sales_templates') || c.startsWith('PATCH stub.local/rest/v1/presence_sales_templates')));
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ EDITOR COMFORTS, PART TWO (item 158): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
