// ── Generated legal & trust pages (Phase Q / FD-M3) ──────────────────────────
// Every published site gets a Privacy Policy and an Accessibility Statement,
// GENERATED from structured business facts — the owner never writes legal HTML.
// The honest foundation: Studio OS sites set no cookies and carry no third-party
// embeds or outside analytics (maps are links), so no consent banner is required.
// Two real data flows are described as they are: the contact form, and the site's
// own first-party visit counter (lib/visits.ts trackerScript, routes/collect.ts),
// which the owner can switch off (item 61); the page reads the same switch the
// publish step does. Deterministic: the effective date is the snapshot date (the
// only clock a renderer may read).
//
// Terms of Service are deliberately NOT auto-generated in V1: terms make
// business-specific legal promises (refunds, liability, jurisdiction) that a
// platform must not invent on a customer's behalf. Queued as FD-Q1 (guided,
// owner-approved terms). Both templates render these bodies through their own
// shell, so look-and-feel stays per-template while the words stay one source.
import { esc } from './markdown.ts';
import type { SnapshotContent } from './render_types.ts';

function contactLine(c: SnapshotContent): string {
  const i = c.identity; const l = c.locations?.[0];
  const bits = [
    l ? [l.address_line1, l.city, `${l.region} ${l.postal_code}`].filter(Boolean).join(', ') : '',
    (l?.phone || i.phone || '').trim(),
    i.email,
  ].filter(Boolean).map((x) => esc(String(x)));
  return bits.join(' · ');
}

/** The Privacy Policy body (inside <main>): facts-true, plain words. */
export function privacyBody(c: SnapshotContent, effectiveDate: string, hasForm: boolean): string {
  const name = esc(c.identity.business_name);
  return `<section class="block wrap"><h1>Privacy policy</h1>
<p class="post-meta">Effective ${esc(effectiveDate)}</p>
<h2>Who we are</h2>
<p>This website belongs to ${name}.${contactLine(c) ? ` You can reach us at: ${contactLine(c)}.` : ''}</p>
<h2>What this website collects</h2>
${hasForm
    ? `<p>If you send us a message through the contact form, we receive what you type — your name, an email address or phone number, and your message. We use it for one thing: getting back to you. We don’t sell it, share it for marketing, or add you to lists you didn’t ask for.</p>`
    : `<p>This website has no forms and collects nothing you type.</p>`}
${c.settings?.visit_counter === false
    ? `<h2>Cookies and visit counts</h2>
<p>This website sets <strong>no cookies</strong>, stores nothing on your device, and does not count or track visits. There is nothing to consent to, which is why there is no cookie banner.</p>`
    : `<h2>Cookies and visit counts</h2>
<p>This website sets <strong>no cookies</strong> and stores nothing on your device, which is why there is no cookie banner.</p>
<p>It counts its own visits, without any outside analytics or advertising company. When a page opens, it notes which page, the name of the website you came from, any campaign tag in the link, and your kind of device, browser and country. When you tap a phone number, an email address, a button, a download or a link to another website, it notes which kind of link it was and, for a button, a phone number or an email address, the words on it. When you leave a page, it notes how long the page was open. It never keeps your IP address; it keeps a scrambled code made from it that changes every day, so a visit can be counted once without saying who you are. If your browser asks websites not to track you, nothing is counted. Only ${name} and the studio that runs this website see these counts, and they are never sold or shared for advertising.</p>`}
<h2>Hosting</h2>
<p>The site is served as static pages by our hosting provider, which may keep standard, short-lived server logs (such as IP addresses) for security and reliability.</p>
<h2>Your choices</h2>
<p>If you’ve sent us a message and would like to see, correct, or delete it, contact us using the details above and we’ll take care of it.</p>
</section>`;
}

/** The Accessibility Statement body — promises the TEMPLATE actually keeps. */
export function accessibilityBody(c: SnapshotContent): string {
  const name = esc(c.identity.business_name);
  return `<section class="block wrap"><h1>Accessibility</h1>
<p>${name} wants everyone to be able to use this website. It’s built so that:</p>
<ul style="margin:14px 0 14px 22px">
<li>every page has clear headings and can be navigated by keyboard;</li>
<li>every photograph has a written description;</li>
<li>text keeps readable contrast, and sizes adapt to your device;</li>
<li>the site respects your system’s reduced-motion preference;</li>
<li>links and buttons say what they do.</li>
</ul>
<p>If anything on this site is hard for you to use, please tell us${contactLine(c) ? ` — ${contactLine(c)}` : ''} — and we’ll fix it.</p>
</section>`;
}

/** Item 62: where a browser visitor lands when their message didn't send. The reason
 *  rides in the address's #fragment and CSS :target shows its line, so the page stays
 *  script-free; with no reason, or a browser without :has(), the general line shows.
 *  It points the visitor at the browser's Back button, which returns to the form with
 *  what they typed still in it; a link to a fresh contact page would lose it. No click
 *  handler either: published pages carry none (render_test's hostile check). */
export const NOT_SENT_REASONS = ['need_contact', 'empty', 'bad_email', 'try_again'] as const;
/** The page's line for a failed submission's error code; anything else gets the general line. */
export function notSentReason(error: string): string {
  return (NOT_SENT_REASONS as readonly string[]).includes(error) ? error : 'check';
}
export function notSentInner(): string {
  return `<h1>Your message didn’t send.</h1>
<style>.ns-why{display:none}.ns-why:target{display:block}.ns-lines:has(.ns-why:target) .ns-general{display:none}</style>
<div class="ns-lines">
<p class="tagline ns-general">Check that you left an email or a phone number and a short message, then send it again.</p>
<p class="tagline ns-why" id="ns-need_contact">Leave an email or a phone number so we can reply, then send it again.</p>
<p class="tagline ns-why" id="ns-empty">Add a short message, then send it again.</p>
<p class="tagline ns-why" id="ns-bad_email">That email address doesn’t look right. Check it, then send it again.</p>
<p class="tagline ns-why" id="ns-try_again">Something went wrong on our side. Please send it again in a minute.</p>
</div>
<p>Use your browser’s Back button to return to the form: what you wrote is still there.</p>
<div class="cta-row"><a class="btn" href="/contact/">Contact page</a></div>`;
}

/** The footer links every template renders (Privacy · Accessibility). */
export function legalFooterLinks(): string {
  return `<a href="/privacy/">Privacy</a> · <a href="/accessibility/">Accessibility</a>`;
}
