// ── Every name the server reads from its environment is accounted for (deep pass, Part 7.16) ──
//   deno run --allow-read tests/presence/secret_inventory_test.mjs
// /system/health shows the owner every secret and switch the platform reads (SECRET_GROUPS in
// routes/system.ts), and the two secrets documents say what each one is for. This walks the
// presence function's code (index.ts and every module it imports) for each name it reads and
// checks the name is on that list or is a setting with a default (SETTINGS below), and that
// every name on the list is described in a document. Names only: it reads source files, never the
// environment, so it can't print a value.
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const FN = 'supabase/functions/';

// The 18 names missing from SECRET_GROUPS and the 15 missing from both documents, found on
// Nov 8 2026, were added in the fix for item 111's findings, so every check here is strict.

/** Names that only tune a default: a limit, a timer, a version stamp or an address override. */
const SETTINGS = {
  ACCOUNT_DELETION_DAYS: 'days before a deletion request is carried out (30)',
  AI_CEILING_DISABLED: 'turns off the AI spending ceiling',
  AI_CEILING_MULT: 'scales the AI spending ceiling (1)',
  AI_UNLIMITED_CLIENTS: 'clients with no AI ceiling',
  ALLOWED_ORIGINS: 'extra origins the API answers',
  BROADCAST_DAILY_CAP: 'emails a broadcast sends per day',
  DAILY_SPEND_CAP_USD: 'the free tools’ daily AI spend ($10)',
  DEPLOY_POLL_MS: 'how long a publish waits on Netlify (30 s)',
  MAX_CONCURRENT_DEPLOYS: 'publishes at once',
  MAX_MEDIA_BYTES: 'a site’s file storage',
  MAX_MEDIA_FILES: 'a site’s file count',
  MEDIA_GC_ORPHAN_MS: 'when an unused upload is cleared',
  MEDIA_GC_RETENTION_MS: 'how long a deleted file is kept',
  PREVIEW_CACHE_MAX: 'drawn previews kept (64)',
  PREVIEW_CACHE_TTL_MS: 'how long a drawn preview is kept (5 min)',
  PRIVACY_VERSION: 'the privacy policy version people accept',
  RESEND_API_URL: 'the email service’s address (Resend’s; a scratch run points it at a stand-in)',
  TERMS_VERSION: 'the terms version people accept',
  SNAPSHOT_KEEP_RECENT: 'published versions kept',
  STOCK_PROVIDER: 'which stock photo service (pexels)',
  TOOLS_BASE_URL: 'the free tools’ address',
  TOOLS_EXTRA_ORIGINS: 'extra origins the free tools answer',
  TURNSTILE_VERIFY_URL: 'the bot check’s address',
  VISUAL_MODEL_URL: 'the image model’s address',
  VISUAL_MODEL_EDIT_URL: 'the image model’s edit address',
  VISUAL_MODEL_NAME: 'the image model',
};
/** Second names, read only right after the first: `Deno.env.get('FIRST') || Deno.env.get('SECOND')`. */
const SECOND_NAMES = { ANTHROPIC_API_KEY: 'ANTHROPIC_KEY', PSI_API_KEY: 'PSI_KEY' };
/** Reads whose name is built in code, and how this test finds their names. */
const BUILT = {
  'presence/lib/route53.ts': (src) => [...src.matchAll(/\benv\('([A-Z][A-Z0-9_]*)'\)/g)].map((m) => m[1]),
  'presence/lib/preview_cache.ts': (src) => [...src.matchAll(/\benvInt\('([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]),
  'presence/routes/system.ts': () => [],   // envPresent: the list's own names
  'presence/connected/auth.ts': () => [],   // CONNECTED_<PROVIDER_KEY>_CLIENT_ID / _CLIENT_SECRET, a family
  'presence/connected/execute.ts': () => [],   // CONNECTED_<PROVIDER_KEY>_WRITE, a family
};
const FAMILY = /^CONNECTED_[A-Z0-9_]+_(CLIENT_ID|CLIENT_SECRET|WRITE)$/;

// ── the presence function's modules: index.ts, and what each imports in turn ──
const modules = new Set(), lost = [];
for (const todo = [`${FN}presence/index.ts`]; todo.length;) {
  const f = todo.pop();
  if (modules.has(f)) continue;
  let src; try { src = read(f); } catch { lost.push(f); continue; }
  modules.add(f);
  const code = src.replace(/^\s*(?:\/\/|\/?\*).*$/gm, '');   // a comment's example import is not one
  for (const m of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)) {
    todo.push(new URL(m[1], new URL(f, ROOT)).href.slice(ROOT.href.length));
  }
}
ok('walks the presence function’s code', modules.size >= 300 && !lost.length && modules.has(`${FN}presence/routes/system.ts`) && modules.has(`${FN}_shared/cors.ts`),
  `${modules.size} modules${lost.length ? `; can’t follow ${lost.join(', ')}` : ''}`);

const LITERAL = /\bDeno\??\.env\??\.get\(\s*(['"`])([A-Z][A-Z0-9_]*)\1\s*\)/g;
const reads = new Map();   // name → the files that read it
const builtIn = [];
for (const f of modules) {
  const src = read(f), at = f.slice(FN.length);
  const names = [...src.matchAll(LITERAL)].map((m) => m[2]);
  const built = (src.match(/\bDeno\??\.env\??\.get\(/g) || []).length > names.length;
  if (built) { builtIn.push(at); if (BUILT[at]) names.push(...BUILT[at](src)); }
  for (const n of names) reads.set(n, [...new Set([...(reads.get(n) || []), at])]);
}
ok('finds the names it reads', reads.size >= 60 && reads.has('SUPABASE_URL') && reads.has('AWS_ACCESS_KEY_ID') && reads.has('PREVIEW_CACHE_MAX'), `${reads.size} names`);
{
  const unknown = builtIn.filter((f) => !BUILT[f]), stale = Object.keys(BUILT).filter((f) => !builtIn.includes(f));
  ok('every read whose name is built in code is one this test knows how to read', !unknown.length && !stale.length,
    [unknown.length ? `teach this test to read ${unknown.join(', ')}` : '', stale.length ? `no built read left in ${stale.join(', ')}` : ''].filter(Boolean).join('; '));
}

// ── the list /system/health shows ──
const sys = read(`${FN}presence/routes/system.ts`);
const groups = sys.slice(sys.indexOf('const SECRET_GROUPS'), sys.indexOf('\n};', sys.indexOf('const SECRET_GROUPS')));
const LISTED = new Set([...groups.matchAll(/\{ name: '([A-Z][A-Z0-9_]*)', required: (true|false)/g)].map((m) => m[1]));
const ALIASES = Object.fromEntries([...sys.matchAll(/if \(name === '([A-Z0-9_]+)'\) return !!\(Deno\.env\.get\('\1'\) \|\| Deno\.env\.get\('([A-Z0-9_]+)'\)\)/g)].map((m) => [m[2], m[1]]));
ok('reads the list /system/health shows, and the other names it accepts', LISTED.size >= 20 && LISTED.has('SCHEDULER_SECRET') && Object.keys(ALIASES).length >= 3, `${LISTED.size} listed; ${Object.keys(ALIASES).join(', ')}`);

{
  const wrong = Object.entries(SECOND_NAMES).filter(([second, first]) => modules.size && [...modules].some((f) => {
    const src = read(f), all = (src.match(new RegExp(`Deno\\.env\\.get\\('${second}'\\)`, 'g')) || []).length;
    return all !== (src.match(new RegExp(`Deno\\.env\\.get\\('${first}'\\) \\|\\| Deno\\.env\\.get\\('${second}'\\)`, 'g')) || []).length;
  }));
  ok('each second name is only ever read right after its first', !wrong.length, wrong.map(([s]) => s).join(', '));
}
{
  const covered = (n) => LISTED.has(n) || ALIASES[n] || SECOND_NAMES[n] || SETTINGS[n];
  const loose = [...reads.keys()].filter((n) => !covered(n)).sort();
  ok('every name the server reads is on the list /system/health shows, or is a setting', !loose.length,
    loose.map((n) => `${n} (${reads.get(n).slice(0, 2).join(', ')})`).join('; ') + (loose.length ? '. A secret or a switch goes in SECRET_GROUPS (routes/system.ts); a tuned default goes in SETTINGS here' : ''));
  // the names found missing on Nov 8 2026 stay on the list
  const NOV_8 = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'PEXELS_API_KEY', 'PREVIEW_LINK_SECRET', 'STATE_SIGNING_SECRET', 'RESEND_INBOUND_SECRET',
    'RESEND_INBOUND_DOMAIN', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'VISITS_SALT', 'TURNSTILE_SECRET', 'TOOLS_HASH_SALT', 'PSI_KEY',
    'CONCIERGE_POLISH', 'HELP_POLISH', 'APP_URL', 'PLATFORM_REPLY_TO'];
  ok('the 18 names found missing on Nov 8 are on the list', NOV_8.length === 18 && NOV_8.every((n) => LISTED.has(n)), NOV_8.filter((n) => !LISTED.has(n)).join(', '));
  const unread = [...Object.keys(SETTINGS), ...Object.keys(SECOND_NAMES)].filter((n) => !reads.has(n));
  ok('every name this test lists is still read', !unread.length, unread.join(', '));
  const both = Object.keys(SETTINGS).filter((n) => LISTED.has(n));
  ok('a setting is not also a secret', !both.length, both.join(', '));
}
{
  // The list covers the project, not only this function (Stripe's webhook has its own): each
  // listed name must be read by some function, or be one of the connection families.
  const everywhere = new Set();
  for (const e of Deno.readDirSync(new URL(FN, ROOT))) {
    if (!e.isDirectory) continue;
    const walk = (dir) => { for (const x of Deno.readDirSync(new URL(dir, ROOT))) {
      if (x.isDirectory) walk(`${dir}${x.name}/`);
      else if (/\.(ts|js|mjs)$/.test(x.name)) for (const m of read(`${dir}${x.name}`).matchAll(LITERAL)) everywhere.add(m[2]);
    } };
    walk(`${FN}${e.name}/`);
  }
  const dead = [...LISTED].filter((n) => !everywhere.has(n) && !reads.has(n) && !FAMILY.test(n));
  ok('every listed name is read by some function', everywhere.size > reads.size && !dead.length, dead.join(', '));
}

// ── the two secrets documents ──
{
  const docs = read('docs/presence/ENV-AND-SECRETS.md') + '\n' + read('docs/SECRETS-INVENTORY.md');
  const named = new Set([...docs.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((m) => m[1]));
  // "`X_CLIENT_ID` / `_SECRET`" names X_CLIENT_SECRET too
  for (const m of docs.matchAll(/`([A-Z][A-Z0-9_]*)`\s*\/\s*`(_[A-Z0-9_]+)`/g)) named.add(m[1].slice(0, m[1].lastIndexOf('_')) + m[2]);
  const families = docs.includes('`CONNECTED_<PROVIDER_KEY>_CLIENT_ID` / `_SECRET`') && docs.includes('`CONNECTED_<KEY>_WRITE');
  ok('the documents describe the connection families', families);
  const undescribed = [...LISTED].filter((n) => !named.has(n) && !(FAMILY.test(n) && families));
  ok('every secret and switch on the list is described in docs/presence/ENV-AND-SECRETS.md or docs/SECRETS-INVENTORY.md', LISTED.size > 0 && !undescribed.length, undescribed.join(', '));
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ SECRET INVENTORY: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
