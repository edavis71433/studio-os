// ── Wave 2 — the benchmark's bigger bets (items 7, 8, 10, 12): the pure rules,
// and the source pins that keep the shell, the pages and the routes on the
// same contract ───────────────────────────────────────────────────────────────
const F = await import('../../supabase/functions/presence/lib/inbox_feed.ts');
const A = await import('../../supabase/functions/presence/concierge/answer.ts');
const X = await import('../../supabase/functions/presence/commerce/example_data.ts');
const read = (p) => Deno.readTextFileSync(new URL('../../' + p, import.meta.url));
const shell = read('shell.js');
const css = read('shell.css');
const workspace = read('supabase/functions/presence/routes/workspace.ts');
const concierge = read('supabase/functions/presence/routes/concierge.ts');
const commerce = read('supabase/functions/presence/routes/commerce.ts');
const provision = read('supabase/functions/presence/commerce/provision.ts');
const today = read('today.html');
const help = read('help.html');
const inbox = read('inbox.html');
let pass = 0, fail = 0; const failed = [];
const ok = (n, c) => { if (c) { pass++; console.log('PASS ', n); } else { fail++; failed.push(n); console.log('FAIL ', n); } };
const eq = (n, a, b) => ok(`${n} (got ${JSON.stringify(a)})`, JSON.stringify(a) === JSON.stringify(b));

// ═══ 10 · keyboard beyond ⌘K (shell.js only) ═══
ok('10: `/` opens the palette (the ⌘K input)', /e\.key === '\/'\) \{ if \(modalOpen\(\)\) return; e\.preventDefault\(\); openPalette\(\); \}/.test(shell));
ok('10: `?` toggles the shortcuts sheet', /e\.key === '\?'\) \{ if \(modalOpen\(\)\) return; e\.preventDefault\(\); toggleShortcuts\(\); \}/.test(shell));
ok('10: `n` fires the page’s New action and never with shift', /e\.key === 'n' && !e\.shiftKey/.test(shell));
ok('10: keys are ignored while typing (input · textarea · select · contenteditable)', /tag === 'INPUT' \|\| tag === 'TEXTAREA' \|\| tag === 'SELECT' \|\| !!t\.isContentEditable/.test(shell));
ok('10: keys are ignored with a modifier held and when signed out', /if \(e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey \|\| !CTX\) return;/.test(shell));
ok('10: [data-new] wins; else the first "+ / New / Add" button, a filled one first', /document\.querySelector\('\[data-new\]'\)/.test(shell) && /NEW_RE = \/\^\(\\\+\|new\\b\|add\\b\)\/i/.test(shell) && /\(primary\|filled\)/.test(shell));
ok('10: the sheet LISTS the Inbox’s own keys (↑↓ · Enter · Esc) rather than rebuilding them', /INBOX_KEYS = \[\['↑ ↓', 'Move between conversations'\], \['Enter', 'Open the conversation'\], \['Esc', 'Close a menu or sheet'\]\]/.test(shell) && /normalizePath\(location\.pathname\) === '\/inbox'\) html \+= /.test(shell));
ok('10: the sheet is a shell layer (closes with the others, on Escape, on outside click)', /closeDrawer\(\); closeShortcuts\(\);/.test(shell) && /if \(keys && keys\.classList\.contains\('open'\)\) closeShortcuts\(\);/.test(shell) && /closeHelp\(\); closeShortcuts\(\); \}\);/.test(shell));
ok('10: inbox.html marks its New enquiry button data-new', /id="newEnq" data-new>/.test(inbox));
ok('10: shell.css styles the sheet (.dds-keys kbd)', /\.dds-keys kbd\{/.test(css));

// ═══ 8 · the bell grows up ═══
eq('8: a money notice is a needs-you ask', F.noticeTier('payment_trouble'), 'needs_you');
eq('8: a paid invoice is an update', F.noticeTier('invoice_paid'), 'update');
eq('8: the studio publishing for a client is an update', F.noticeTier('studio_published'), 'update');
eq('8: a reviewer’s decision is an update', F.noticeTier('approval_decided'), 'update');
eq('8: an unknown kind is an ask (never silently demoted)', F.noticeTier('something_new'), 'needs_you');
ok('8: priority = money + approvals', F.noticePriority('payment_trouble', '') && F.noticePriority('account_lapsed', '2026-10') && F.noticePriority('invoice_void_paid', 'voidpaid:x') && F.noticePriority('retainer_status', 'retainer:d:past_due:w1') && F.noticePriority('approval_overdue', 'approval:p:a'));
ok('8: an unpaid-invoice reminder is priority; an ordinary deal follow-up is not', F.noticePriority('deal_followup', 'invremind:aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa') && !F.noticePriority('deal_followup', 'deal:d1:w1'));
ok('8: a lead nudge is an ask, not priority', F.noticeTier('lead_followup') === 'needs_you' && !F.noticePriority('lead_followup', 'lead:l1'));
// the badge counts asks only — the ONE intentional contract change
const bell = (notices) => F.studioBellCount({ notices, newEnquiries: 0, proposedPlans: 0, proposedWrites: 0, filesPending: 0, openFeedback: 0, openSupport: 0, clientEvents: [], lastSeenAt: null });
eq('8: the badge counts needs-you notices', bell([{ kind: 'publish_failed' }, { kind: 'domain_expiry' }]), 2);
eq('8: an update notice renders but never rings the badge', bell([{ kind: 'publish_failed' }, { kind: 'invoice_paid' }, { kind: 'studio_published' }]), 1);
eq('8: the client_* throttle rows stay out of the count', bell([{ kind: 'client_message' }, { kind: 'invoice_paid' }]), 0);
ok('8: UPDATE_NOTICE_KINDS is the exact set', [...F.UPDATE_NOTICE_KINDS].sort().join() === ['invoice_paid', 'studio_published', 'welcome_back', 'win_back', 'approval_decided', 'booking_reminder'].sort().join());
// the feed tags every row kind
ok('8: workspace.ts tags notices with tier + priority from the pure rules', /tier: noticeTier\(n\.kind\), priority: noticePriority\(n\.kind, n\.period\)/.test(workspace));
ok('8: approvals are needs_you + priority', /\.map\(\(p\) => \(\{ \.\.\.p, tier: 'needs_you', priority: true \}\)\)/.test(workspace));
ok('8: moments are updates', /\.map\(\(m: any\) => \(\{ \.\.\.m, tier: 'update', priority: false \}\)\)/.test(workspace));
ok('8: the four synthetic rows are needs_you', (workspace.match(/dismissible: false, tier: 'needs_you', priority: false/g) || []).length === 4);
ok('8: a conversation is an ask only while the client waits; a support row while open', /tier: \(r\.type === 'support' \? \(r\.status === 'open' \|\| r\.status === 'in_progress'\) : !!r\.needs_reply\) \? 'needs_you' : 'update'/.test(workspace));
ok('8: an enquiry is an ask while new', /tier: String\(f\.status \|\| 'new'\) === 'new' \? 'needs_you' : 'update'/.test(workspace));
// the shell draws it
ok('8: three tabs — All · Needs you · Updates (a real tablist)', /role="tablist" aria-label="Notification views"/.test(shell) && /data-tab="all"/.test(shell) && /data-tab="needs_you"/.test(shell) && /data-tab="update"/.test(shell));
ok('8: Mark read and Clear are two different buttons', /id="dds-bell-read"/.test(shell) && /id="dds-bell-clear"/.test(shell) && /addEventListener\('click', markBellRead\)/.test(shell) && /addEventListener\('click', clearBell\)/.test(shell));
ok('8: Clear follows Today’s rule — a real notice id AND dismissible — through the existing dismiss route', /clearable: NOTICE_ID_RE\.test\(String\(n\.id \|\| ''\)\) && n\.dismissible !== false/.test(shell) && /window\.ddsApi\('\/commerce\/notices\/dismiss', \{ method: 'POST', body: \{ id: r\.id \} \}\)/.test(shell));
ok('8: approvals and moments are never clearable by hand', (shell.match(/priority: true, clearable: false/g) || []).length === 1 && /tier: 'update', priority: false, clearable: false/.test(shell));
ok('8: priority rows sit on top, then asks, then updates', /var ka = \(a\.priority \? 0 : 2\) \+ \(a\.tier === 'needs_you' \? 0 : 1\)/.test(shell));
ok('8: a priority row carries the stronger left accent', /\.dds-bell-pop \.row\.pri\{border-left-color:var\(--dds-p\)/.test(css));
ok('8: Mark read is the operator’s local mark — the badge quiets until the server’s count CHANGES', /return \(m && typeof m\.count === 'number' && m\.count === n\) \? 0 : n;/.test(shell) && /bellInner\(badgeCount\(\)\)/.test(shell));
ok('8: the heading and the Inbox footer stay (shell.spec pins them; the Inbox is still the one place)', /<h4>Needs a look<\/h4>/.test(shell) && /See everything in your Inbox →/.test(shell));
ok('MOAT: no new notification store — the bell still reads /portal/feed only', /api\('\/portal\/feed'\)/.test(shell) && !/presence_bell/.test(workspace));

// ═══ 7 · AI shows its sources and drafts replies ═══
eq('7: labels = the topic headline, then the evidence, deduped, ≤ 4', A.sourceLabels({ headline: 'Your hours are missing' }, [{ human: 'No opening hours were found on the Contact page.' }, { human: 'Your hours are missing' }, { human: 'b' }, { human: 'c' }, { human: 'd' }]), ['Your hours are missing', 'No opening hours were found on the Contact page.', 'b', 'c']);
eq('7: no topic and no evidence → no chips (nothing invented)', A.sourceLabels(null, []), []);
ok('7: a long evidence line is trimmed with an ellipsis', A.sourceLabels(null, [{ human: 'x'.repeat(80) }])[0].length <= 60 && A.sourceLabels(null, [{ human: 'x'.repeat(80) }])[0].endsWith('…'));
ok('7: the route ships source_labels on both branches (over the ceiling too)', (concierge.match(/source_labels: a\.source_labels/g) || []).length === 2);
ok('7: today.html paints chips from source_labels and the honest low-confidence line', /d\.source_labels\) \? d\.source_labels\.filter\(Boolean\)\.slice\(0, 4\)/.test(today) && /class="src"/.test(today) && /Part of this is judgment rather than measurement/.test(today));
ok('7: help.html does the same', /d\.source_labels\) \? d\.source_labels\.filter\(Boolean\)\.slice\(0, 4\)/.test(help) && /Part of this is judgment rather than measurement/.test(help));
ok('7: both pages read the route’s `answer` (the old `text` key kept as a fallback)', /d\.answer \|\| d\.text/.test(today) && /d\.answer \|\| d\.text/.test(help));
ok('7: Draft a reply is on all three Inbox composers', /id="msgDraft">Draft a reply/.test(inbox) && /id="supDraft">Draft a reply/.test(inbox) && /id="leadDraft">Draft a reply/.test(inbox));
ok('7: the draft comes from the EXISTING /writer/rewrite (action write)', /api\('\/writer\/rewrite','POST',\{action:'write',field:'answer',prompt:/.test(inbox));
ok('7: the draft lands in the textarea for editing — never submitted', /ta\.value=v\?\(v\+'\\n\\n'\+text\):text;/.test(inbox) && !/draftReply[\s\S]{0,1200}\.submit\(\)/.test(inbox) && !/draftReply[\s\S]{0,1200}'\/forms\/inbox\//.test(inbox));
ok('7: the quiet "drafted by AI" note stays until the user edits', /note\.textContent='Drafted by AI — edit before sending\.';/.test(inbox) && /ta\.addEventListener\('input',\(\)=>\{const n=ta\.parentNode\.querySelector\('\.ai-note'\);if\(n\)n\.remove\(\);\},\{once:true\}\);/.test(inbox));
ok('7: Send stays the one filled button in each composer (Draft is a plain button)', !/class="primary"[^>]*id="(msgDraft|supDraft|leadDraft)"/.test(inbox) && !/id="(msgDraft|supDraft|leadDraft)"[^>]*class="primary"/.test(inbox));

// ═══ 12 · sample data on a new trial ═══
const rows = X.exampleRows('site-1', new Date('2026-10-20T12:00:00Z'), 'ct-1');
ok('12: every example row says so in its name', rows.contact.name.startsWith('Example: ') && rows.contact.company === 'Example: Marlow’s Kitchen' && rows.deal.title.startsWith('Example: ') && rows.submission.name.startsWith('Example: '));
ok('12: the rows are marked with EXISTING columns (no migration): email · source · fields.example', rows.contact.email === X.EXAMPLE_EMAIL && X.EXAMPLE_EMAIL.endsWith('.example') && rows.deal.source === 'example' && rows.submission.fields.example === true && rows.submission.source_page === 'example');
ok('12: the deal joins the contact and has a next step', rows.deal.contact_id === 'ct-1' && rows.deal.stage === 'proposal' && rows.deal.next_step === 'Send the proposal' && rows.deal.next_step_at === '2026-10-22' && rows.deal.expected_close === '2026-11-10');
ok('12: the enquiry is a NEW quote request (so the Inbox and the bell have something to show)', rows.submission.form_kind === 'quote' && rows.submission.status === 'new' && rows.submission.spam === false);
ok('12: the seed is idempotent — an existing example contact means do nothing', /if \(!have\.ok \|\| \(Array\.isArray\(have\.json\) && have\.json\.length\)\) return \{ seeded: false \};/.test(read('supabase/functions/presence/commerce/example_data.ts')));
ok('12: provisioning reports whether THIS run created the site row', /created\?: boolean;/.test(provision) && /hosted: needsHosting, netlifyUrl, created \};/.test(provision));
ok('12: the seed runs only on a just-created site — trial and webhook paths alike — and never blocks', (commerce.match(/if \(prov\.created && prov\.siteId\) await seedExampleData\(prov\.siteId\)\.catch\(\(\) => \{\}\);/g) || []).length === 2);
ok('12: the remove route deletes exactly the marked rows on THIS site', /presence_deals\?site_id=eq\.\$\{siteId\}&source=eq\.\$\{EXAMPLE_SOURCE\}/.test(read('supabase/functions/presence/commerce/example_data.ts')) && /presence_form_submissions\?site_id=eq\.\$\{siteId\}&fields->>example=eq\.true/.test(read('supabase/functions/presence/commerce/example_data.ts')) && /presence_contacts\?site_id=eq\.\$\{siteId\}&email=eq\./.test(read('supabase/functions/presence/commerce/example_data.ts')));
ok('12: both routes are authed', /route === '\/commerce\/example-data' && method === 'GET'\) \{\n    if \(!authed\)/.test(commerce) && /route === '\/commerce\/example-data\/remove' && method === 'POST'\) \{\n    if \(!authed\)/.test(commerce));
ok('12: Today reads it (never for a drilled-in operator) and removes in two steps', /apiGet\('\/commerce\/example-data'\)\.catch\(\(\)=>null\)/.test(today) && /id="removeExample" data-remove-example/.test(today) && /id="removeExampleYes"/.test(today) && /id="removeExampleNo"/.test(today) && /apiPost\('\/commerce\/example-data\/remove', \{\}\)/.test(today));
ok('12: the card hides on a failed read or when nothing is left', /if\(!ex \|\| !ex\.present\) return '';/.test(today));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) { console.log('FAILURES'); failed.forEach((f) => console.log(' -', f)); Deno.exit(1); }
