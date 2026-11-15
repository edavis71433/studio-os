// ── A few at a time (item 208) ───────────────────────────────────────────────
// Run `fn` over `items` with at most `n` in flight, keeping each answer in the item's
// place. A publish makes its photos and sends its files this way: one at a time was slow
// on a first publish, and hundreds at once can trip the other side's limits.
export async function fewAtATime<T, R>(items: readonly T[], n: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}
