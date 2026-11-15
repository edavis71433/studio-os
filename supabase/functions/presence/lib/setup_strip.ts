// ── The setup strip on Home (sales item 105, Nov 2026) ─────────────────────────
// Salesforce shows "Finish these 3 steps" until they're done, and it can be hidden.
// Ours sits under the greeting on Home: the few things a studio sets up once, each
// checked against the real thing (nothing is ticked by hand), each with the one
// button that does it. It goes by itself once every step is done, and Hide puts it
// away for the whole studio (a reserved row, lib/reserved_store.ts). A step whose
// check couldn't be read is left off rather than shown as not done. Pure.

export type SetupKey = 'business' | 'logo' | 'services' | 'contact' | 'deal' | 'goal';
export interface SetupStep { key: SetupKey; title: string; why: string; act: string; href: string; done: boolean }

export const SETUP_STEPS: ReadonlyArray<Omit<SetupStep, 'done'>> = [
  { key: 'business', title: 'Your business details', why: 'Your name and address on invoices and emails', act: 'Add them', href: '/settings.html#studio' },
  { key: 'logo', title: 'Your logo', why: 'On emails, invoices and the client portal', act: 'Choose it', href: '/files.html' },
  { key: 'services', title: 'Services and prices', why: 'Proposals fill themselves in', act: 'Add a service', href: '/pipeline.html?services=1' },
  { key: 'contact', title: 'Your first contact', why: 'Add one, or bring in a list', act: 'Add a contact', href: '/contacts.html?add=1' },
  { key: 'deal', title: 'Your first deal', why: 'Pipeline follows it to Won', act: 'Add a deal', href: '/pipeline.html' },
  { key: 'goal', title: 'A monthly goal', why: 'Home and Pipeline track it for you', act: 'Set a goal', href: '/settings.html#goal' },   // sales item 94
];

/** The steps, in order, from what was found: true done, false not yet, null (or missing)
 *  couldn't be checked, so that step is left off. */
export function setupSteps(facts: Partial<Record<SetupKey, boolean | null>>): SetupStep[] {
  const out: SetupStep[] = [];
  for (const s of SETUP_STEPS) {
    const f = facts[s.key];
    if (f === true || f === false) out.push({ ...s, done: f });
  }
  return out;
}

/** Whether Home shows the strip: something is left to do and nobody hid it. */
export function setupShows(steps: SetupStep[], hidden: boolean): boolean {
  return !hidden && steps.some((s) => !s.done);
}

/** The stored choice: hidden, by whom and when. Anything else reads as not hidden. */
export function setupHidden(stored: unknown): boolean {
  return !!stored && typeof stored === 'object' && (stored as { hidden?: unknown }).hidden === true;
}
