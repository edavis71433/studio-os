// ── A small in-memory PostgREST for driving real handlers in Deno tests ─────
// Not a test itself (the sweep runs *_test.mjs only). Install it before the
// first import of the code under test:
//
//   import { installFakePostgrest } from './fake_pgrst.mjs';
//   const db = installFakePostgrest({ unique: { presence_agency_clients: [['site_id']] } });
//   db.tables.presence_sites = [ ... ];        // seed
//   ... drive a handler ...
//   db.writes('presence_sales_templates')      // what it wrote
//
// It understands the filters the presence function uses: eq / neq / is /
// in.(…) / like / ilike / gte / lte / gt / lt / cs.{…} (array contains), not.<op>, or=(…) with quoted
// values, and a jsonb path column (detail->>key); select is ignored (whole rows
// come back); order (every key, in turn), offset and limit apply. POST honours on_conflict + Prefer resolution=ignore|merge-
// duplicates, and the `unique` keys (with an optional row predicate, for a
// partial unique index, or a key function, for an expression index) answer 409 like the database. PATCH and DELETE apply
// to every matching row. A user JWT (anything but the service key) sees only
// `ownSite[token]` in presence_sites — row-level security, roughly.
export function installFakePostgrest(opts = {}) {
  const SERVICE = opts.service || 'svc-key';
  Deno.env.set('SUPABASE_URL', opts.url || 'https://db.test');
  Deno.env.set('SERVICE_ROLE_KEY', SERVICE);
  Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');
  const users = opts.users || {}, ownSite = opts.ownSite || {}, unique = opts.unique || {};
  const db = { tables: {}, log: [], fail: new Set(), failMethod: new Map() };
  // a clock that always moves: every write gets a later updated_at, like a touch trigger
  let clock = Date.parse('2026-11-08T12:00:00Z');
  const tick = () => new Date(clock += 1000).toISOString();

  const reply = (body, status = 200, headers = {}) => new Response(status === 204 ? null : (body === null ? '' : JSON.stringify(body)), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const unq = (v) => { v = String(v); return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1).replace(/\\(.)/g, '$1') : v; };
  const splitTop = (s) => { const out = []; let cur = '', depth = 0, q = false; for (let i = 0; i < s.length; i++) { const ch = s[i]; if (q) { cur += ch; if (ch === '\\') { cur += s[++i] ?? ''; continue; } if (ch === '"') q = false; continue; } if (ch === '"') { q = true; cur += ch; continue; } if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; } cur += ch; } if (cur) out.push(cur); return out; };
  // LIKE, as Postgres reads it: % (and PostgREST's *) is any run, _ is any one character,
  // and a backslash makes the next character itself ("jane\\_doe" is a literal underscore)
  const likeRe = (p, flags) => { let re = ''; const t = String(p); for (let i = 0; i < t.length; i++) { const ch = t[i]; if (ch === '\\' && i + 1 < t.length) { re += t[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); continue; } if (ch === '%' || ch === '*') re += '.*'; else if (ch === '_') re += '.'; else re += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); } return new RegExp('^' + re + '$', flags); };
  const test = (row, col, expr) => {
    const m = /^(not\.)?(eq|neq|is|in|like|ilike|gte|lte|gt|lt|cs)\.(.*)$/s.exec(expr);
    if (!m) return true;
    // a JSON path (detail->>message_id) reads inside a jsonb column, as text, like PostgREST
    const [, not, op, raw] = m; const jp = /^(\w+)->>(\w+)$/.exec(col); const v = jp ? (row[jp[1]] && typeof row[jp[1]] === 'object' && row[jp[1]][jp[2]] != null ? String(row[jp[1]][jp[2]]) : null) : row[col]; let r;
    if (op === 'eq') r = v !== null && v !== undefined && String(v) === unq(raw);
    else if (op === 'neq') r = String(v ?? '') !== unq(raw);
    else if (op === 'is') r = raw === 'null' ? (v === null || v === undefined) : String(v) === raw;
    else if (op === 'in') r = splitTop(raw.replace(/^\(|\)$/g, '')).map(unq).includes(String(v));
    else if (op === 'like') r = v != null && likeRe(unq(raw), 's').test(String(v));
    else if (op === 'ilike') r = v != null && likeRe(unq(raw), 'is').test(String(v));
    // cs.{a,"b c"}: an array column holding every one of those values (tags @> '{a,b c}')
    else if (op === 'cs') { const want = splitTop(raw.replace(/^\{|\}$/g, '')).map(unq).filter((x) => x !== ''); r = Array.isArray(v) && want.every((w) => v.map(String).includes(w)); }
    else if (op === 'gte') r = String(v ?? '') >= unq(raw); else if (op === 'lte') r = String(v ?? '') <= unq(raw);
    else if (op === 'gt') r = String(v ?? '') > unq(raw); else r = String(v ?? '') < unq(raw);
    return not ? !r : r;
  };
  const META = new Set(['select', 'order', 'limit', 'offset', 'on_conflict']);
  const filterRows = (rows, params) => rows.filter((row) => params.every(([k, v]) => {
    if (META.has(k)) return true;
    if (k === 'or') return splitTop(v.replace(/^\(|\)$/g, '')).some((c) => { const i = c.indexOf('.'); return test(row, c.slice(0, i), c.slice(i + 1)); });
    return test(row, k, v);
  }));
  // a unique key clash with an existing row (partial indexes via a `where` predicate)
  const clashOf = (table, rows, rec) => {
    for (const spec of unique[table] || []) {
      const cols = Array.isArray(spec) ? spec : spec.cols;
      const where = Array.isArray(spec) ? null : spec.where;
      // key: an expression index, e.g. (r) => r.site_id + '|' + r.email.toLowerCase() for (site_id, lower(email))
      const key = Array.isArray(spec) ? null : spec.key;
      if (where && !where(rec)) continue;
      const hit = rows.find((r) => (!where || where(r)) && (key ? key(r) === key(rec) : cols.every((c) => String(r[c]) === String(rec[c]))));
      if (hit) return hit;
    }
    return null;
  };

  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = (init.method || 'GET').toUpperCase();
    const h = new Headers(init.headers); const token = (h.get('Authorization') || '').replace(/^Bearer /, '');
    let body = null; try { body = init.body ? JSON.parse(String(init.body)) : null; } catch { body = null; }
    db.log.push({ method, url: decodeURIComponent(u.pathname + u.search), body });
    if (u.pathname === '/auth/v1/user') return users[token] ? reply(users[token]) : reply({}, 401);
    if (u.pathname.startsWith('/auth/v1/admin/users/')) { const id = u.pathname.split('/').pop(); const x = Object.values(users).find((y) => y.id === id); return x ? reply(x) : reply({}, 404); }
    if (!u.pathname.startsWith('/rest/v1/')) return reply({}, 404);
    const table = u.pathname.slice('/rest/v1/'.length);
    // a database before migration 0194: the visit-count functions aren't there, as PostgREST says it
    if (table === 'rpc/presence_visit_stats' || table === 'rpc/presence_sites_visitors') return reply({ code: 'PGRST202', message: `Could not find the function public.${table.slice(4)}` }, 404);
    if (db.fail.has(table) || db.failMethod.get(table) === method) return reply({ message: 'boom' }, 500);
    const params = [...u.searchParams.entries()];
    if (token !== SERVICE) {
      if (table === 'presence_sites' && method === 'GET') return reply(ownSite[token] ? (db.tables.presence_sites || []).filter((s) => s.id === ownSite[token]) : []);
      return reply([]);
    }
    const rows = (db.tables[table] ||= []);
    if (method === 'GET' || method === 'HEAD') {
      let out = filterRows(rows, params);
      const keys = (u.searchParams.get('order') || '').split(',').filter(Boolean).map((k) => k.split('.'));
      if (keys.length) out = [...out].sort((a, b) => { for (const [col, dir] of keys) { const x = String(a[col] ?? ''), y = String(b[col] ?? ''); if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1); } return 0; });
      const off = Math.max(0, Number(u.searchParams.get('offset') || 0)); if (off) out = out.slice(off);
      const lim = Number(u.searchParams.get('limit') || 0); if (lim) out = out.slice(0, lim);
      return method === 'HEAD' ? new Response(null, { status: 200, headers: { 'content-range': `*/${out.length}` } }) : reply(out.map((r) => ({ ...r })));
    }
    const prefer = h.get('Prefer') || ''; const rep = prefer.includes('return=representation');
    if (method === 'POST') {
      const conflictCols = (u.searchParams.get('on_conflict') || '').split(',').filter(Boolean);
      const out = [];
      // one statement, like the database: a many-row insert with one clash writes none of them
      // (sales item 122 sends a hundred people a request and falls back to one by one)
      const pending = [];
      for (const rec0 of (Array.isArray(body) ? body : [body])) {
        const now = tick();
        const rec = { id: rec0.id || crypto.randomUUID(), created_at: now, updated_at: now, deleted_at: null, ...rec0 };
        const pool = [...rows, ...pending];
        const clash = conflictCols.length ? pool.find((r) => conflictCols.every((k) => String(r[k]) === String(rec[k]))) : clashOf(table, pool, rec);
        if (clash) {
          if (prefer.includes('ignore-duplicates')) continue;
          if (prefer.includes('merge-duplicates') && rows.includes(clash)) { Object.assign(clash, rec0); out.push(clash); continue; }
          return reply({ code: '23505', message: 'duplicate key value violates unique constraint' }, 409);
        }
        pending.push(rec); out.push(rec);
      }
      rows.push(...pending);
      return rep ? reply(out.map((r) => ({ ...r })), 201) : reply(null, 201);
    }
    if (method === 'PATCH') {
      const hit = filterRows(rows, params);
      for (const r of hit) { Object.assign(r, body); if ('updated_at' in r) r.updated_at = tick(); }
      return rep ? reply(hit.map((r) => ({ ...r }))) : reply(null, 204);
    }
    if (method === 'DELETE') { const hit = new Set(filterRows(rows, params)); db.tables[table] = rows.filter((r) => !hit.has(r)); return reply(null, 204); }
    return reply({}, 405);
  };

  db.writes = (table) => db.log.filter((c) => c.method !== 'GET' && c.method !== 'HEAD' && c.url.startsWith(`/rest/v1/${table}`));
  db.reads = (frag) => db.log.filter((c) => c.method === 'GET' && c.url.includes(frag));
  db.reset = (tables = {}) => { db.tables = structuredClone(tables); db.log = []; db.fail = new Set(); db.failMethod = new Map(); };
  return db;
}
