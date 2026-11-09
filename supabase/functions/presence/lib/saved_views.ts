// ── Saved list views and picked lists (sales review items 31 and 39, Nov 2026) ─
// Pure normalizers for two small studio-level settings:
//   • saved views on Customers, Contacts and Pipeline: a name, the fixed view it
//     starts from, the search text, the columns shown and the sort.
//   • picked lists for Send an update: a name and the people (email + name)
//     chosen from a list, so an update can go to them now and again later.
// Both are stored as reserved JSON rows (lib/reserved_store.ts). Everything that
// arrives from a page goes through these first: bounded, de-duplicated, typed.

export const VIEW_LISTS = ['customers', 'contacts', 'pipeline'] as const;
export type ViewList = typeof VIEW_LISTS[number];
export interface SavedView { id: string; name: string; base: string; q: string; cols: string[]; sort: { key: string; dir: 1 | -1 } | null }
export type SavedViews = Record<ViewList, SavedView[]>;
export const MAX_VIEWS = 20;
export const MAX_COLS = 12;

export interface Person { email: string; name: string }
export interface PickedList { id: string; name: string; people: Person[]; created_at: string }
export const MAX_LISTS = 50;
export const MAX_PEOPLE = 500;

const ID_RE = /^[A-Za-z0-9-]{6,40}$/;
const KEY_RE = /^[a-z0-9_]{1,40}$/;
const EMAIL_RE = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]{2,}$/;
const str = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
export const newId = () => crypto.randomUUID();

export function isViewList(v: unknown): v is ViewList { return typeof v === 'string' && (VIEW_LISTS as readonly string[]).includes(v); }

export function normalizeView(raw: unknown): SavedView | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = str(r.name, 60);
  if (!name) return null;
  const id = typeof r.id === 'string' && ID_RE.test(r.id) ? r.id : newId();
  const base = KEY_RE.test(String(r.base || '')) ? String(r.base) : '';
  const cols = Array.isArray(r.cols) ? [...new Set(r.cols.map((c) => String(c)).filter((c) => KEY_RE.test(c)))].slice(0, MAX_COLS) : [];
  const s = r.sort as Record<string, unknown> | null | undefined;
  // final pass (Nov 8, batch D): "desc" and "asc" are understood — "desc" read as NaN and sorted ascending
  const desc = s && (String(s.dir).trim().toLowerCase() === 'desc' || Number(s.dir) < 0);
  const sort = s && KEY_RE.test(String(s.key || '')) ? { key: String(s.key), dir: (desc ? -1 : 1) as 1 | -1 } : null;
  return { id, name, base, q: str(r.q, 80), cols, sort };
}

/** One list's views: valid ones only, unique ids and names (the later duplicate name wins), capped. */
export function normalizeViewList(raw: unknown): SavedView[] {
  const out: SavedView[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const n = normalizeView(v);
    if (!n) continue;
    const at = out.findIndex((x) => x.id === n.id || x.name.toLowerCase() === n.name.toLowerCase());
    if (at >= 0) out.splice(at, 1);
    out.push(n);
  }
  return out.slice(-MAX_VIEWS);
}

export function normalizeViews(raw: unknown): SavedViews {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  return { customers: normalizeViewList(r.customers), contacts: normalizeViewList(r.contacts), pipeline: normalizeViewList(r.pipeline) };
}

/** People: a valid email each, lower-cased, de-duplicated, capped. */
export function normalizePeople(raw: unknown): Person[] {
  const seen = new Set<string>();
  const out: Person[] = [];
  for (const p of Array.isArray(raw) ? raw : []) {
    const email = str((p as any)?.email, 160).toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: str((p as any)?.name, 120) });
    if (out.length >= MAX_PEOPLE) break;
  }
  return out;
}

export function normalizeLists(raw: unknown): PickedList[] {
  const out: PickedList[] = [];
  for (const l of Array.isArray(raw) ? raw : []) {
    if (!l || typeof l !== 'object') continue;
    const id = typeof (l as any).id === 'string' && ID_RE.test((l as any).id) ? (l as any).id : '';
    const name = str((l as any).name, 80);
    const people = normalizePeople((l as any).people);
    if (!id || !name || !people.length || out.some((x) => x.id === id)) continue;
    const at = Date.parse(String((l as any).created_at || ''));
    out.push({ id, name, people, created_at: Number.isFinite(at) ? new Date(at).toISOString() : new Date(0).toISOString() });
  }
  return out.slice(-MAX_LISTS);   // the newest fifty (lists are appended)
}
