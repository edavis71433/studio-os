// ── Every name the server reads from its environment is accounted for (deep pass, Part 7.16) ──
//   deno run --allow-read tests/presence/secret_inventory_test.mjs
// /system/health shows the owner every secret and switch the platform reads (SECRET_GROUPS in
// routes/system.ts), and the two secrets documents say what each one is for. This walks the
// presence function's code (index.ts and every module it imports) for each name it reads and
// checks the name is on that list, is a setting with a default (SETTINGS below), or is a gap
// already found (NOT_LISTED, NOT_DOCUMENTED). Names only: it reads source files, never the
// environment, so it can't print a value.
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const FN = 'supabase/functions/';

// Gaps found on Nov 8 2026, left for their own fix. Adding a name to SECRET_GROUPS (or to a
// document) makes this test fail until the name comes off its list here.
/** Secrets and switches the server reads that /system/health doesn't list. */
const NOT_LISTED = {
  AWS_ACCESS_KEY_ID: 'managed domains (lib/route53.ts), with AWS_SECRET_ACCESS_KEY',
  AWS_SECRET_ACCESS_KEY: 'managed domains (lib/route53.ts)',
  PEXELS_API_KEY: 'the stock photo search',
  PREVIEW_LINK_SECRET: 'signs shared draft links (falls back to APPROVAL_SECRET, STATE_SIGNING_SECRET, SCHEDULER_SECRET)',
  STATE_SIGNING_SECRET: 'a fallback signing secret for draft and approval links',
  RESEND_INBOUND_SECRET: 'verifies email replies coming in',
  RESEND_INBOUND_DOMAIN: 'the reply address domain that brings replies to the Inbox',
  VAPID_PUBLIC_KEY: 'device notifications (Web Push)',
  VAPID_PRIVATE_KEY: 'device notifications (Web Push)',
  VAPID_SUBJECT: 'the contact sent with device notifications',
  VISITS_SALT: 'salts the visit counter’s visitor hashes (falls back to APPROVAL_SECRET)',
  TURNSTILE_SECRET: 'the free tools’ bot check',
  TOOLS_HASH_SALT: 'salts the free tools’ visitor hashes (falls back to the service key)',
  PSI_KEY: 'PageSpeed Insights for the free site review',
  CONCIERGE_POLISH: 'switches on the AI polish of concierge answers',
  HELP_POLISH: 'switches on the AI polish of help answers',
  APP_URL: 'the app’s own address (the OAuth return page, font files, email links)',
  PLATFORM_REPLY_TO: 'the reply-to address on platform mail',
};
/** Secrets and switches neither secrets document describes. */
const NOT_DOCUMENTED = ['AGENCY_SITE_ID', 'APPROVAL_SECRET', 'NURTURE_DRIP', 'OPERATOR_SECRET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'PEXELS_API_KEY',
  'PREVIEW_LINK_SECRET', 'RESEND_INBOUND_SECRET', 'RESEND_INBOUND_DOMAIN', 'VISITS_SALT', 'TURNSTILE_SECRET', 'TOOLS_HASH_SALT', 'HELP_POLISH', 'PLATFORM_REPLY_TO'];

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
  const covered = (n) => LISTED.has(n) || ALIASES[n] || SECOND_NAMES[n] || SETTINGS[n] || NOT_LISTED[n];
  const loose = [...reads.keys()].filter((n) => !covered(n)).sort();
  ok('every name the server reads is on the list, a setting, or a known gap', !loose.length,
    loose.map((n) => `${n} (${reads.get(n).slice(0, 2).join(', ')})`).join('; ') + (loose.length ? '. A secret or a switch goes in SECRET_GROUPS (routes/system.ts); a tuned default goes in SETTINGS here' : ''));
  const settled = Object.keys(NOT_LISTED).filter((n) => LISTED.has(n));
  ok('no known gap has been listed since', !settled.length, settled.length ? `now listed, take it off NOT_LISTED: ${settled.join(', ')}` : '');
  const unread = [...Object.keys(NOT_LISTED), ...Object.keys(SETTINGS), ...Object.keys(SECOND_NAMES)].filter((n) => !reads.has(n));
  ok('every name this test lists is still read', !unread.length, unread.join(', '));
  const both = Object.keys(SETTINGS).filter((n) => LISTED.has(n) || NOT_LISTED[n]);
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
{
  const missing = Object.keys(NOT_LISTED).filter((n) => !LISTED.has(n));
  console.log(`KNOWN  ${missing.length} names the server reads aren’t on the list /system/health shows: ${missing.join(', ')}`);
}

// ── the two secrets documents ──
{
  const docs = read('docs/presence/ENV-AND-SECRETS.md') + '\n' + read('docs/SECRETS-INVENTORY.md');
  const named = new Set([...docs.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map((m) => m[1]));
  // "`X_CLIENT_ID` / `_SECRET`" names X_CLIENT_SECRET too
  for (const m of docs.matchAll(/`([A-Z][A-Z0-9_]*)`\s*\/\s*`(_[A-Z0-9_]+)`/g)) named.add(m[1].slice(0, m[1].lastIndexOf('_')) + m[2]);
  const families = docs.includes('`CONNECTED_<PROVIDER_KEY>_CLIENT_ID` / `_SECRET`') && docs.includes('`CONNECTED_<KEY>_WRITE');
  ok('the documents describe the connection families', families);
  const secrets = [...new Set([...LISTED, ...Object.keys(NOT_LISTED)])];
  const undescribed = secrets.filter((n) => !named.has(n) && !(FAMILY.test(n) && families));
  const loose = undescribed.filter((n) => !NOT_DOCUMENTED.includes(n));
  ok('every secret and switch is described in a secrets document, or is a known gap', !loose.length, loose.join(', '));
  const settled = NOT_DOCUMENTED.filter((n) => !undescribed.includes(n));
  ok('no known gap has been described since', !settled.length, settled.length ? `now described, take it off NOT_DOCUMENTED: ${settled.join(', ')}` : '');
  ok('every known gap is a secret or a switch the server reads', NOT_DOCUMENTED.every((n) => secrets.includes(n)) && NOT_DOCUMENTED.length > 0, NOT_DOCUMENTED.filter((n) => !secrets.includes(n)).join(', '));
  console.log(`KNOWN  ${undescribed.length} of them aren’t described in docs/presence/ENV-AND-SECRETS.md or docs/SECRETS-INVENTORY.md: ${undescribed.join(', ')}`);
}

const failed = results.filter((r) => !r.p);
console.log(`\n════ SECRET INVENTORY: ${results.length - failed.length}/${results.length} PASSED ════`);
if (failed.length) { for (const f of failed) console.log(' FAIL: ' + f.n); Deno.exit(1); }
