// ── The one UUID pattern (item 105) ──────────────────────────────────────────
// Forty files each carried their own copy of this regular expression. They now
// import it from here, under whatever local name they already used.
//   UUID_RE        any case: the usual guard before an id goes into a query.
//   UUID_LOWER_RE  lower case only, as Postgres prints ids; the files that were
//                  written that way keep it, so no route accepts anything new.
// Neither carries the g flag, so sharing one object between files keeps no state.
export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const UUID_RE = new RegExp(`^${UUID_PATTERN}$`, 'i');
export const UUID_LOWER_RE = new RegExp(`^${UUID_PATTERN}$`);
