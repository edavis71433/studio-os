// ── Plan my week (builder list item 176, Nov 2026) ───────────────────────────
// Wix Studio's "Plan your week": one page that looks across every client and
// says who needs the studio first over the next seven days. Ours starts from
// Home's own Needs you list (the same rows, the same snoozes, so the two never
// disagree), puts a day on the ones that have one (an invoice's due date, a
// deal step's date), and adds what is coming but doesn't need you yet: to-dos
// and project steps, estimates that run out, recurring invoices that go out,
// monthly reports, and content forms that came back or never started.
//
// Then: one card per client, late things first, then today, then by day; the
// clients in the order they need you; the studio's own deals and to-dos last.
// Days only — nothing here has a time of day.
//
// Pure: no DB, no network, no clock (today is an input). agency/client_tools.ts
// reads the rows and calls these.

export interface WeekThing {
  key: string;                  // stable; the same thing from two sources shares it (money:<invoice>, deal:<deal>)
  kind: string;                 // a Needs you kind, or task · estimate · recurring · report · intake
  site_id: string | null;
  client_id: string | null;
  name: string;                 // the client, as the roster names them ('' = the studio's own)
  what: string;
  verb: string;
  href: string;
  day: string | null;           // YYYY-MM-DD it falls on; null = waiting already (counts as today)
  short: string;                // a few words for the client's line: "a late invoice"
}
export interface WeekItem { key: string; kind: string; what: string; verb: string; href: string; day: string | null; when: 'late' | 'today' | 'day'; late_days: number }
export interface WeekClient { key: string; site_id: string | null; client_id: string | null; name: string; own: boolean; first: boolean; why: string; items: WeekItem[] }
export interface WeekPlan { today: string; end: string; days: Array<{ day: string; count: number }>; late: number; total: number; clients: WeekClient[] }

export const WEEK_DAYS = 7;
const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;
const utc = (ymd: string) => { const m = YMD.exec(ymd); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; };
export const addDays = (ymd: string, n: number) => new Date(utc(ymd) + n * 86_400_000).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((utc(b) - utc(a)) / 86_400_000);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const dow = (ymd: string) => DOW[new Date(utc(ymd)).getUTCDay()] || '';
/** The calendar day of a date or timestamp, or null. */
export const dayOf = (v: unknown): string | null => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v || '')); return m && Number.isFinite(utc(m[1])) ? m[1] : null; };
/** The studio's "today" as the page sends it (its own clock), kept within a day of ours. */
export function todayFrom(raw: unknown, nowIso: string): string {
  const mine = nowIso.slice(0, 10), s = String(raw || '');
  return YMD.test(s) && Math.abs(daysBetween(mine, s)) <= 1 ? s : mine;
}
export const money = (cents: unknown) => '$' + (Math.round(Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ── the sources → things ──
const DOMAIN_WORDS: Record<string, string> = { domain: 'their domain to renew', padlock: 'their padlock to look at', publish: 'a publish that failed', conn: 'a connection to fix' };
/** Home's Needs you rows. `dates` puts a day on the ones that have one. */
export function thingsFromNeeds(rows: Array<{ key: string; kind: string; site_id: string | null; client_id: string | null; name: string; what: string; verb: string; href: string }>, dates: { invoiceDue: Record<string, string | null>; stepDue: Record<string, string | null> }, today: string): WeekThing[] {
  return (rows || []).filter((r) => r && r.key).map((r) => {
    let day: string | null = null;
    const id = r.key.split(':')[1] || '';
    if (r.kind === 'money') day = dayOf(dates.invoiceDue[id]);
    else if (r.kind === 'deal' && r.key.split(':').length === 2) day = dayOf(dates.stepDue[id]);
    const late = !!day && day < today;
    const short = r.kind === 'money' ? (late ? 'a late invoice' : day && day > today ? `an invoice due ${dow(day)}` : 'an invoice due today')
      : r.kind === 'enquiry' ? 'an enquiry to answer' : r.kind === 'support' ? 'a request to answer' : r.kind === 'message' ? 'a message to answer'
      : r.kind === 'deal' ? (late ? 'a deal step that’s late' : 'a deal waiting on you') : r.kind === 'broken' ? (DOMAIN_WORDS[r.key.split(':')[1] || ''] || 'a site problem')
      : r.kind === 'plan' ? 'a plan to apply' : r.kind === 'publish' ? 'changes to publish' : r.kind === 'account' ? 'an account item' : 'a notice to read';
    return { key: r.key, kind: r.kind, site_id: r.site_id || null, client_id: r.client_id || null, name: String(r.name || ''), what: String(r.what || ''), verb: String(r.verb || 'Open'), href: String(r.href || '/agency.html'), day, short };
  });
}

/** Dated to-dos: a deal's next step (keyed like Needs you's deal row), its to-dos, and the studio's project steps. */
export function thingsFromTasks(tasks: Array<{ kind: string; id: string; parent_id: string; title: string; due: string | null; context: string; href: string }>, owners: { deal: Record<string, { site_id: string | null; client_id: string | null }>; project: Record<string, { site_id: string | null; client_id: string | null }> }, today: string): WeekThing[] {
  const out: WeekThing[] = [];
  for (const t of tasks || []) {
    const day = dayOf(t.due);
    if (!t || !t.id || !day) continue;   // undated work is not this week's
    const who = (t.kind === 'project_task' ? owners.project[t.parent_id] : owners.deal[t.parent_id]) || { site_id: null, client_id: null };
    const late = day < today;
    const step = t.kind === 'project_task';
    out.push({
      key: t.kind === 'next_step' ? `deal:${t.id}` : `${step ? 'ptask' : 'task'}:${t.id}`, kind: 'task', site_id: who.site_id, client_id: who.client_id, name: '',
      what: `${t.kind === 'next_step' ? 'Next step' : step ? 'Project step' : 'To-do'}: ${t.title}${t.context && !who.site_id && !who.client_id ? ` · ${t.context}` : ''}`,
      verb: step ? 'Open project' : 'Open deal', href: t.href, day,
      short: late ? (step ? 'a late project step' : 'a late to-do') : `${step ? 'a project step' : 'a to-do'} ${day === today ? 'today' : dow(day)}`,
    });
  }
  return out;
}

export function thingsFromEstimates(rows: Array<{ id: string; deal_id: string; title?: string | null; subtotal_cents?: number | null; expires_at?: string | null; status?: string | null }>, deals: Record<string, { site_id: string | null; client_id: string | null; title?: string }>): WeekThing[] {
  return (rows || []).filter((e) => e && e.status === 'sent' && dayOf(e.expires_at)).map((e) => {
    const d = deals[e.deal_id] || { site_id: null, client_id: null }, day = dayOf(e.expires_at)!;
    const own = !d.site_id && !d.client_id;
    return { key: `estimate:${e.id}`, kind: 'estimate', site_id: d.site_id, client_id: d.client_id, name: '', what: `Estimate ${money(e.subtotal_cents)} runs out${own && d.title ? ` · ${d.title}` : ''}`, verb: 'Follow up', href: `/pipeline.html?deal=${encodeURIComponent(e.deal_id)}`, day, short: `an estimate runs out ${dow(day)}` };
  });
}

export function thingsFromRecurring(rows: Array<{ id: string; deal_id: string; title?: string | null; amount_cents?: number | null; next_on?: string | null; status?: string | null }>, deals: Record<string, { site_id: string | null; client_id: string | null; title?: string }>): WeekThing[] {
  return (rows || []).filter((r) => r && r.status === 'active' && dayOf(r.next_on)).map((r) => {
    const d = deals[r.deal_id] || { site_id: null, client_id: null }, day = dayOf(r.next_on)!;
    const own = !d.site_id && !d.client_id;
    return { key: `recurring:${r.id}`, kind: 'recurring', site_id: d.site_id, client_id: d.client_id, name: '', what: `${String(r.title || '').trim() || 'A recurring invoice'} goes out (${money(r.amount_cents)})${own && d.title ? ` · ${d.title}` : ''}`, verb: 'Check it', href: `/pipeline.html?deal=${encodeURIComponent(r.deal_id)}`, day, short: `an invoice goes out ${dow(day)}` };
  });
}

/** Monthly reports (item 58) go out on the 1st (to the 3rd) for the month before, once. */
export function thingsFromReports(settings: Array<{ site_id: string; enabled: boolean; last_month: string | null }>, today: string): WeekThing[] {
  const end = addDays(today, WEEK_DAYS - 1);
  // the 1st inside the window, or today when this month's report is still due (the 2nd or 3rd)
  const firsts: string[] = [];
  for (let i = 0; i < WEEK_DAYS; i++) { const d = addDays(today, i); if (d.endsWith('-01')) firsts.push(d); }
  const dom = Number(today.slice(8, 10));
  if (dom >= 2 && dom <= 3) firsts.unshift(today.slice(0, 8) + '01');
  const out: WeekThing[] = [];
  for (const s of settings || []) {
    if (!s || !s.enabled) continue;
    for (const first of firsts) {
      const reported = addDays(first, -1).slice(0, 7);   // the month the report is about
      if (s.last_month && s.last_month >= reported) continue;
      const day = first < today ? today : first;
      if (day > end) continue;
      out.push({ key: `report:${s.site_id}:${reported}`, kind: 'report', site_id: s.site_id, client_id: null, name: '', what: 'Their monthly report goes out', verb: 'Preview', href: `/settings.html?client=${encodeURIComponent(s.site_id)}#report`, day, short: `their report goes out ${day === today ? 'today' : dow(day)}` });
    }
  }
  return out;
}

/** Content forms (item 176): answers that came back unread, or a form sent a week ago and never started. */
export function thingsFromIntake(forms: Array<{ site_id: string; status: string; answered: number; sent_at: string | null; seen_at: string | null; emailed_at: string | null; created_at: string | null }>, today: string): WeekThing[] {
  const out: WeekThing[] = [];
  for (const f of forms || []) {
    if (!f) continue;
    if (f.sent_at && (!f.seen_at || f.seen_at < f.sent_at)) {
      out.push({ key: `intake:${f.site_id}`, kind: 'intake', site_id: f.site_id, client_id: null, name: '', what: 'Their words and photos arrived', verb: 'Read them', href: `/sites.html#answers=${f.site_id}`, day: null, short: 'their words and photos arrived' });
      continue;
    }
    const since = dayOf(f.emailed_at || f.created_at);
    if (f.status === 'open' && !f.sent_at && !f.answered && since && daysBetween(since, today) >= 7) {
      out.push({ key: `intake:${f.site_id}`, kind: 'intake', site_id: f.site_id, client_id: null, name: '', what: 'They haven’t started the content form', verb: 'Send it again', href: `/sites.html#content=${f.site_id}`, day: null, short: 'the content form isn’t started' });
    }
  }
  return out;
}

// ── things → the plan ──
const KIND_RANK: Record<string, number> = { money: 0, broken: 1, enquiry: 2, support: 2, message: 2, intake: 3, deal: 4, task: 4, estimate: 5, recurring: 6, report: 7, publish: 8, plan: 8, account: 9, notice: 9 };

export function buildWeek(input: { today: string; things: WeekThing[]; names: Record<string, string>; siteOfClient?: Record<string, string>; snoozed?: Record<string, string> }): WeekPlan {
  const today = input.today, end = addDays(today, WEEK_DAYS - 1);
  const snoozed = input.snoozed || {};
  // one thing per key: a dated copy wins over an undated one (Needs you's invoice row gets its due date)
  const byKey = new Map<string, WeekThing>();
  for (const t of input.things || []) {
    if (!t || !t.key || snoozed[t.key]) continue;
    if (t.day && t.day > end) continue;   // after this week
    const had = byKey.get(t.key);
    if (!had) { byKey.set(t.key, t); continue; }
    const merged = { ...had, ...(t.day && !had.day ? { day: t.day, short: t.short } : {}) };
    // the richer words win: Needs you's row is written for people; a source row fills only what's missing
    if (!had.site_id && t.site_id) merged.site_id = t.site_id;
    if (!had.client_id && t.client_id) merged.client_id = t.client_id;
    byKey.set(t.key, merged);
  }
  const groups = new Map<string, WeekClient & { rank: number[] }>();
  const dayCount = new Map<string, number>();
  let late = 0;
  for (const t of byKey.values()) {
    const site = t.site_id || (t.client_id && input.siteOfClient ? input.siteOfClient[t.client_id] : null) || null;
    const gk = site ? `site:${site}` : t.client_id ? `client:${t.client_id}` : 'own';
    const name = site && input.names[site] ? input.names[site] : t.name && gk !== 'own' ? t.name : '';
    let g = groups.get(gk);
    if (!g) { g = { key: gk, site_id: site, client_id: t.client_id, name: gk === 'own' ? 'Not tied to a client' : (name || 'A client'), own: gk === 'own', first: false, why: '', items: [], rank: [] }; groups.set(gk, g); }
    const d = t.day && t.day < today ? daysBetween(t.day, today) : 0;
    const when: WeekItem['when'] = t.day && t.day < today ? 'late' : !t.day || t.day === today ? 'today' : 'day';
    if (when === 'late') late++;
    const bucket = when === 'late' ? 'late' : when === 'today' ? today : (t.day as string);
    dayCount.set(bucket, (dayCount.get(bucket) || 0) + 1);
    // in the studio's own card, say whose it is
    const what = gk === 'own' && t.name && !t.what.includes(t.name) ? `${t.name} — ${t.what}` : t.what;
    g.items.push({ key: t.key, kind: t.kind, what, verb: t.verb, href: t.href, day: t.day, when, late_days: d, _short: t.short } as WeekItem & { _short: string });
  }
  const order = (i: WeekItem) => [i.when === 'late' ? 0 : i.when === 'today' ? 1 : 2, -i.late_days, i.day || '', KIND_RANK[i.kind] ?? 9];
  const cmp = (a: Array<number | string>, b: Array<number | string>) => { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
  const clients = [...groups.values()].map((g) => {
    g.items.sort((a, b) => cmp(order(a), order(b)));
    const shorts = g.items.map((i) => (i as WeekItem & { _short: string })._short).filter(Boolean);
    const two = [...new Set(shorts)].slice(0, 2);
    g.why = g.own ? 'Your own deals, to-dos and messages' : two.length === 2 ? cap(`${two[0]}, and ${two[1]}`) : cap(two[0] || 'Something this week');
    const hasLate = g.items.some((i) => i.when === 'late'), hasToday = g.items.some((i) => i.when === 'today');
    const firstDay = g.items.find((i) => i.when === 'day')?.day || '9999-12-31';
    const maxLate = Math.max(0, ...g.items.map((i) => i.late_days));
    g.rank = [g.own ? 1 : 0, hasLate ? 0 : 1, -maxLate, hasToday ? 0 : 1, utc(firstDay) || 0, -g.items.length];
    g.items = g.items.map(({ _short: _s, ...i }: any) => i);
    return g;
  }).sort((a, b) => cmp(a.rank, b.rank) || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const top = clients.find((c) => !c.own);
  if (top && top.items.some((i) => i.when !== 'day')) top.first = true;
  const days = [{ day: 'late', count: dayCount.get('late') || 0 }];
  for (let i = 0; i < WEEK_DAYS; i++) { const d = addDays(today, i); days.push({ day: d, count: dayCount.get(d) || 0 }); }
  return { today, end, days, late, total: byKey.size, clients: clients.map(({ rank: _r, ...c }) => c) };
}

/** The plan as plain lines, for "Copy as a list". */
export function weekAsText(p: WeekPlan): string {
  const label = (i: WeekItem) => (i.when === 'late' ? `Late ${i.late_days} day${i.late_days === 1 ? '' : 's'}` : i.when === 'today' ? 'Today' : `${dow(i.day as string)} ${Number((i.day as string).slice(8, 10))}`);
  const lines = [`Plan for ${p.today} to ${p.end}`];
  for (const c of p.clients) {
    lines.push('', `${c.name}${c.first ? ' (first)' : ''} — ${c.why}`);
    for (const i of c.items) lines.push(`  • ${label(i)}: ${i.what}`);
  }
  return lines.join('\n');
}
