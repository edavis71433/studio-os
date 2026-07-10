// ── Communication routes: structural security (P2-D-3) ───────────────────────
//   deno run --allow-read tests/presence/project_comms_routes_test.mjs
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

const c = read('supabase/functions/presence/routes/project_comms.ts');
const idx = read('supabase/functions/presence/index.ts');
const mig = read('supabase/migrations/0077_p2d_communication.sql');
const wsp = read('supabase/functions/presence/routes/workspace.ts');
const lib = read('supabase/functions/presence/lib/notifications.ts');

// tenant scoping
for (const t of ['presence_project_messages', 'presence_activity_reads', 'presence_project_events', 'presence_projects']) {
  const uses = c.match(new RegExp(`${t}\\?[^\\\`]*`, 'g')) || [];
  const unscoped = uses.filter((u) => !/site_id=eq\.\$\{site\.id\}|on_conflict=site_id/.test(u)); // on_conflict upsert carries site_id in the body
  ok(`tenant: every ${t} query is site-scoped (${uses.length} uses)`, unscoped.length === 0, unscoped[0] || '');
}

// internal vs client separation
ok('sep: the client read filters to audience=client (internal never sent)', /if \(!studio\) path \+= `&audience=eq\.client`/.test(c));
ok('sep: a non-studio poster is FORCED to the client audience', /studio && isAudience\(b\.audience\) \? b\.audience : 'client'/.test(c));
ok('sep: a client-audience message feeds the activity log (client_visible)', /projectEvent\(site\.id, projectId, 'message', principal, audience === 'client'/.test(c));

// notifications are a DERIVED view, not a second store
ok('notif: derived from presence_project_events (no notification store written on read)', /presence_project_events\?site_id=eq\.\$\{site\.id\}/.test(c) && !/insert.*notification/i.test(c));
ok('notif: the client only sees events on client-visible projects', /client_visible=is\.true&select=id[\s\S]*?project_id=in\.\(\$\{vis\.join/.test(c));
ok('notif: read/unread computed against a per-reader last-seen', /isRead\(e\.created_at, lastSeen\)/.test(c) && /presence_activity_reads\?site_id=eq\.\$\{site\.id\}&reader=eq\./.test(c));
ok('notif: mark-read upserts the last-seen marker (idempotent per site+reader)', /presence_activity_reads\?on_conflict=site_id,reader[\s\S]*?merge-duplicates/.test(c));
ok('notif: reader key is the principal (per-user last-seen)', /readerKey = \(p: Principal\) => String\(p\.userId \|\| p\.email/.test(c));

// attachments reuse the media store, validated in-site
ok('attach: attachment_media_id validated to belong to the site', /presence_media\?id=eq\.\$\{attachment\}&site_id=eq\.\$\{site\.id\}/.test(c));
ok('migration: message attachment references presence_media', /attachment_media_id uuid references public\.presence_media/.test(mig));

// reviewer boundary: client reads + replies + notifications
ok('bridge: the client thread + notifications are served via /client/* (not the reviewer path)', idx.includes('handleClientMessages(') && idx.includes('handleClientNotifications('));
ok('B3: support activity folds into notifications (project-less tickets still notify)', /presence_support_requests\?site_id=eq\.\$\{site\.id\}[\s\S]*?support_message/.test(c));

// wiring + migration + pure lib
ok('wiring: messages + notifications routes dispatched', idx.includes('handleMessages(') && idx.includes('handleNotifications(') && idx.includes('handleNotificationsRead('));
ok('migration: message table site-scoped + audience CHECK + RLS', /audience text not null default 'client' check \(audience in \('internal','client'\)\)/.test(mig) && /alter table public\.presence_project_messages enable row level security/.test(mig));
ok('migration: activity read-marker unique per site+reader', /presence_activity_reads_uq[\s\S]*?\(site_id, reader\)/.test(mig));
ok('migration: message kind added to the activity vocabulary', /'approval_decided','message'/.test(mig));
ok('migration: rollback present', /drop table if exists public\.presence_project_messages;/.test(mig));
ok('lib: notifications.ts is pure (no imports)', !/^import /m.test(lib));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ COMMUNICATION ROUTES (P2-D-3): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
