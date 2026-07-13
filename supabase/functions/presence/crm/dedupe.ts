// ── Fuzzy near-duplicate detection for contacts — PURE logic ─────────────────
// The exact-email dedupe (routes/sales.ts) catches "jane@x.com" twice. It does
// NOT catch "Jane Doe / (555) 123-4567" typed again as "Jayne Doe" with the same
// number, or "Doe, Jane" from a CSV. This adds a GENTLE second signal: when a
// new contact's name+phone looks like an existing one, surface a
// "Is this the same person as {X}?" prompt for the owner to confirm or ignore.
//
// It NEVER auto-merges and NEVER blocks a save on its own — it only reports
// possible matches. The route decides whether to pause for confirmation.
//
// PURE: no network, no clock, no randomness. Tested in isolation
// (tests/presence/contacts_detail_test.mjs).

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'sir', 'mx']);
const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/** Normalize a person/company name for comparison: strip accents-ish punctuation,
 *  drop honorifics/suffixes, sort the remaining tokens so word order and
 *  "Last, First" formatting don't matter. Returns a canonical space-joined key. */
export function normalizeName(input: unknown): string {
  const base = String(input ?? '')
    .toLowerCase()
    .replace(/['’`]/g, '')            // drop apostrophes so O'Brien → obrien (not two tokens)
    .replace(/[^a-z0-9\s]/g, ' ')     // other punctuation → space (handles "Doe, Jane")
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return '';
  const tokens = base.split(' ').filter((t) => t && !HONORIFICS.has(t) && !SUFFIXES.has(t));
  if (!tokens.length) return base;                            // name was only an honorific — keep it
  return tokens.sort().join(' ');
}

/** Digits only. */
export function phoneDigits(input: unknown): string {
  return String(input ?? '').replace(/\D/g, '');
}

/** A comparable phone key: the last 10 digits (US-style significant part), or all
 *  digits when shorter. Empty when there's no phone. Country-prefix tolerant. */
export function phoneKey(input: unknown): string {
  const d = phoneDigits(input);
  if (!d) return '';
  return d.length > 10 ? d.slice(-10) : d;
}

/** Levenshtein edit distance (iterative, O(n·m) with a single row). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + cost);
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** Similarity of two names in [0,1] after normalization (1 = identical canonical
 *  form). Empty-vs-anything is 0. */
export function nameSimilarity(a: unknown, b: unknown): number {
  const na = normalizeName(a), nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const dist = levenshtein(na, nb);
  const max = Math.max(na.length, nb.length);
  return max ? 1 - dist / max : 0;
}

export interface DupCandidate { id?: string; name?: string; phone?: string; email?: string }
export interface DupResult { match: boolean; score: number; reasons: string[] }

// Tunables — a typo like Jane→Jayne is ~0.87; distinct names ("Jane Doe" vs
// "John Smith") sit far below. Two DIFFERENT phone numbers is treated as a
// strong "these are probably different people" signal that suppresses a
// name-only match, which is what keeps false positives down.
const NAME_STRONG = 0.82;
const NAME_LOOSE = 0.6;

/** Decide whether two contacts are a possible duplicate, with a score + the
 *  plain reasons (for the "Is this the same person?" prompt). Symmetric.
 *  Exact-email equality is a certain match (score 1). */
export function isPossibleDuplicate(a: DupCandidate, b: DupCandidate): DupResult {
  const reasons: string[] = [];
  const emailA = String(a.email ?? '').trim().toLowerCase();
  const emailB = String(b.email ?? '').trim().toLowerCase();
  if (emailA && emailB && emailA === emailB) return { match: true, score: 1, reasons: ['same email'] };

  const pa = phoneKey(a.phone), pb = phoneKey(b.phone);
  const phoneMatch = !!pa && pa === pb;
  const phoneConflict = !!pa && !!pb && pa !== pb;
  const sim = nameSimilarity(a.name, b.name);

  let score = 0;
  // Same phone number + at least a loosely similar name → very likely the same.
  if (phoneMatch) {
    if (sim >= NAME_LOOSE || !normalizeName(a.name) || !normalizeName(b.name)) {
      reasons.push('same phone number');
      if (sim >= NAME_LOOSE) reasons.push(sim >= NAME_STRONG ? 'same name' : 'similar name');
      score = 0.7 + Math.min(0.3, sim * 0.3);
      return { match: true, score: Number(score.toFixed(3)), reasons };
    }
  }
  // Very similar name AND no conflicting phone → surface it (a typo'd re-entry).
  if (sim >= NAME_STRONG && !phoneConflict) {
    reasons.push(sim >= 0.999 ? 'same name' : 'similar name');
    if (phoneMatch) reasons.push('same phone number');
    score = 0.6 + (sim - NAME_STRONG) * (0.35 / (1 - NAME_STRONG));
    return { match: true, score: Number(Math.min(0.95, score).toFixed(3)), reasons };
  }
  return { match: false, score: Number(sim.toFixed(3)), reasons };
}

export interface DupMatch { id?: string; name?: string; email?: string; phone?: string; score: number; reasons: string[] }

/** Find the existing contacts a candidate might duplicate, best first. Skips the
 *  candidate's own row (by id) and caps the result. Never mutates its inputs. */
export function findPossibleDuplicates(candidate: DupCandidate, existing: DupCandidate[], limit = 5): DupMatch[] {
  const out: DupMatch[] = [];
  for (const other of (Array.isArray(existing) ? existing : [])) {
    if (!other) continue;
    if (candidate.id && other.id && candidate.id === other.id) continue;
    const r = isPossibleDuplicate(candidate, other);
    if (r.match) out.push({ id: other.id, name: other.name, email: other.email, phone: other.phone, score: r.score, reasons: r.reasons });
  }
  out.sort((x, y) => y.score - x.score);
  return out.slice(0, Math.max(1, limit));
}
