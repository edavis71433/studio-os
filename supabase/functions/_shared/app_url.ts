// ── The app's own address, for every link the server builds (builder item 388) ──
// Links in emails, the pages Stripe sends a payer back to, and sign-in links are built
// from SITE_URL, which production sets to the app's address. If that setting were ever
// lost, 27 places fell back to the main site (its pages are on Squarespace now, and
// almost all of these answer "not found") and 6 to an address that doesn't exist. Every
// one of them now asks appBase(): SITE_URL as production sets it, then APP_URL, then the
// app's address. Shared, so the old server builds its few links the same way.

/** The app's address when no setting names one. */
export const APP_HOST = 'https://app.davisdigitalstudio.com';

/** The address every link starts with, never ending in a slash. */
export function appBase(): string {
  const set = (Deno.env.get('SITE_URL') || '').trim() || (Deno.env.get('APP_URL') || '').trim();
  return (set || APP_HOST).replace(/\/+$/, '');
}
