// ── Route groups that load on first use (builder list item 107) ─────────────
// A cold start used to evaluate every route file the router imports. The groups
// most requests never reach (operators, the scheduler, AI tools, the technical
// desk, occasional pages) now load the first time one of their routes is asked
// for, and stay loaded for the life of the worker:
//
//   const { handleA, handleB } = lazyRoutes(() => import(ROUTE_FILE));
//
// where ROUTE_FILE is the group's path written out, ./routes/system.ts for one. (Not
// written as a real import here: the local `supabase functions serve` follows import
// paths even in comments, and stops at one that doesn't exist.)
// Each name stands in for the handler with its own parameters: it loads the file
// and calls the real export, so the router's calls read exactly as before. Keep
// the specifier a string literal inside import(): that is what puts the file in
// the deploy bundle and in `deno check`. lib/render.ts uses the same stand-in for
// the eight templates' drawing code.

type Lazy<M> = {
  [K in keyof M]: M[K] extends (...args: infer A) => infer R ? (...args: A) => Promise<Awaited<R>> : never;
};

export function lazyRoutes<M extends object>(load: () => Promise<M>): Lazy<M> {
  let mod: Promise<M> | null = null;
  // A failed load is not kept: the next request tries again.
  const loaded = () => mod ??= load().catch((e) => { mod = null; throw e; });
  return new Proxy({} as Lazy<M>, {
    get: (_target, name) => {
      if (typeof name !== 'string' || name === 'then') return undefined;
      return async (...args: unknown[]) => {
        const m = await loaded() as Record<string, (...a: unknown[]) => unknown>;
        return await m[name](...args);
      };
    },
  });
}
