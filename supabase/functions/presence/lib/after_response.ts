// Supabase's edge runtime keeps a function alive for a promise handed to
// EdgeRuntime.waitUntil after the response is sent; a bare fire-and-forget can be
// cut off when the worker winds down. Anywhere else (tests, a local run) there is
// no such hook and the promise simply runs. Same pattern as unlock-report.
export function runAfterResponse(p: Promise<unknown>): void {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p);
}

/** Builder item 209: the same hand-off for work the caller would otherwise wait on. On the edge
 *  runtime it returns at once and the work finishes after the response; anywhere else (tests, a
 *  local run) it waits, so the work has landed when the caller goes on. Never throws. */
export async function afterResponseOrNow(p: Promise<unknown>): Promise<void> {
  const safe = p.catch(() => null);
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (rt?.waitUntil) { rt.waitUntil(safe); return; }
  await safe;
}
