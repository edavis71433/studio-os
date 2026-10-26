// In-memory stand-in for everything the Free Tools functions call out to:
// PostgREST (the tool_* tables, audit_leads, suppressed_emails, the rate_hit and
// tool_spend_today RPCs), Resend, Turnstile, and the send-lead-alert hop.
// Installed as globalThis.fetch so the real handlers run unmodified with no
// network. Used by free_tools_test.mjs (CI) and the local browser check.

export const SB = 'https://fake-project.supabase.co';

export function makeFake(opts = {}) {
  const state = {
    tables: { tool_reports: [], tool_leads: [], audit_leads: [], tool_usage_log: [], tool_scan_cache: [], suppressed_emails: [] },
    rate: new Map(),
    emails: [],
    spend: opts.spend ?? 0,
    failResend: false,
    resendDelayMs: 0,
    calls: [],
  };
  const handlers = { leadAlert: null };

  const reply = (body, status = 200) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  // PostgREST filters this fake understands: col=eq.v, col=gt.v
  function filtersOf(params) {
    const out = [];
    for (const [k, v] of params) {
      if (['select', 'limit', 'order', 'on_conflict'].includes(k)) continue;
      const m = /^(eq|gt)\.(.*)$/s.exec(v);
      if (m) out.push([k, m[1], m[2]]);
    }
    return out;
  }
  const matches = (row, filters) => filters.every(([k, op, v]) => op === 'eq' ? String(row[k]) === v : String(row[k]) > v);

  async function rest(url, init) {
    const method = (init?.method || 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    const body = init?.body ? JSON.parse(init.body) : null;

    if (path === 'rpc/rate_hit') {
      const key = `${body.p_bucket}@${body.p_window}`;
      const n = (state.rate.get(key) || 0) + 1;
      state.rate.set(key, n);
      return reply(n <= body.p_max);
    }
    if (path === 'rpc/tool_spend_today') {
      const logged = state.tables.tool_usage_log.reduce((a, r) => a + Number(r.cost_usd || 0), 0);
      return reply(state.spend + logged);
    }

    const table = state.tables[path];
    if (!table) return reply({ message: `unknown table ${path}` }, 404);
    const filters = filtersOf(url.searchParams);

    if (method === 'GET') {
      const limit = Number(url.searchParams.get('limit') || 1000);
      const cols = (url.searchParams.get('select') || '*').split(',');
      const project = (r) => cols.includes('*') ? structuredClone(r) : Object.fromEntries(cols.map((c) => [c, structuredClone(r[c])]));
      return reply(table.filter((r) => matches(r, filters)).slice(0, limit).map(project));
    }
    if (method === 'POST') {
      const conflict = url.searchParams.get('on_conflict');
      const row = { id: crypto.randomUUID(), created_at: new Date().toISOString(), ...body };
      if (conflict) {
        const keys = conflict.split(',');
        const i = table.findIndex((r) => keys.every((k) => r[k] === row[k]));
        if (i >= 0) { table[i] = { ...table[i], ...body }; return reply(null, 201); }
      }
      table.push(row);
      return reply([structuredClone(row)], 201);
    }
    if (method === 'PATCH') {
      table.filter((r) => matches(r, filters)).forEach((r) => Object.assign(r, body));
      return reply(null, 204);
    }
    return reply({ message: 'unsupported' }, 405);
  }

  async function fakeFetch(input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    state.calls.push(`${(init?.method || 'GET').toUpperCase()} ${url.host}${url.pathname}`);
    if (url.origin === SB && url.pathname.startsWith('/rest/v1/')) return rest(url, init);
    if (url.origin === SB && url.pathname === '/functions/v1/send-lead-alert') {
      const req = new Request(url, { method: 'POST', headers: init?.headers, body: init?.body });
      return handlers.leadAlert ? handlers.leadAlert(req) : reply({ error: 'no handler' }, 500);
    }
    if (url.host === 'api.resend.com') {
      if (state.resendDelayMs) await new Promise((r) => setTimeout(r, state.resendDelayMs));
      if (state.failResend) return reply({ message: 'down' }, 500);
      state.emails.push(JSON.parse(init.body));
      return reply({ id: `em_${state.emails.length}` });
    }
    if (url.host === 'challenges.cloudflare.com') {
      const token = init.body.get('response');
      return reply({ success: token === 'good-token' });
    }
    throw new Error(`fake fetch: unexpected ${url.href}`);
  }

  return { state, handlers, fetch: fakeFetch };
}

export function setFakeEnv() {
  Deno.env.set('SUPABASE_URL', SB);
  Deno.env.set('SERVICE_ROLE_KEY', 'service-key-for-tests');
  Deno.env.set('RESEND_KEY', 're_test');
  Deno.env.set('TURNSTILE_SECRET', '1x0000000000000000000000000000000AA');
  Deno.env.set('DAILY_SPEND_CAP_USD', '10');
}
