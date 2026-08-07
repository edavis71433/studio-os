import { Page } from '@playwright/test';

// ── iOS/WebKit focus semantics, emulated on Chromium ─────────────────────────
//
// WHY THIS EXISTS
// ---------------
// Eric hit a bug on a real iPhone that NO spec in this suite could reproduce:
// the studio menu opened, but tapping any item closed it and navigated nowhere
// — the tap fell through to whatever page content sat underneath.
//
// The cause is a difference in how the two engines treat focus on a tap:
//
//   Chromium  tap on <a> → the anchor is FOCUSED (focusout.relatedTarget = <a>)
//   WebKit    tap on <a> → nothing is focused; the previously focused element
//             is simply BLURRED (focusout.relatedTarget = null)
//
// Every panel in this app closes itself on `focusout` and — before the fix that
// shipped with this helper — read a null `relatedTarget` as "focus left the
// document, close". On iOS that fires between `pointerdown` and `click`, so the
// panel goes `display:none` and the anchor is un-rendered before the click can
// land on it. Observed trace on a real device:
//
//     pointerdown  tgt=a         drawerOpen=true
//     focusout     rel=null      <-- the guard fails, the panel closes
//     click        tgt=div.wrap  <-- lands on the PAGE, not the link
//     NAVIGATED = false
//
// Desktop never sees it (a click focuses the anchor, so relatedTarget is set),
// which is exactly why 30 spec files and zero `.tap()` calls missed it.
//
// WHAT THIS EMULATES
// ------------------
// The sandbox has no WebKit build, and `.tap()` alone does not reproduce the
// bug because Chromium still focuses the link. So we install ONE capture-phase
// `pointerdown` listener that blurs `document.activeElement` — which is
// precisely the observable half of WebKit's behaviour that the bug depends on.
// Running before any application listener, it makes the real page code see the
// same `focusout` with `relatedTarget === null` at the same moment iOS delivers
// it. Text-entry controls are left alone: iOS DOES focus those on tap, and
// blurring them would emulate a behaviour that does not exist.
//
// WHAT THIS IS NOT
// ----------------
// Not a WebKit substitute. It reproduces the null-relatedTarget focus race and
// nothing else (no WebKit layout, scrolling, or gesture behaviour). If a real
// WebKit binary ever becomes available in CI, run these same specs under it and
// delete the helper — the assertions are written against real behaviour, not
// against this shim.
//
// USAGE — install BEFORE page.goto(), alongside installApp():
//     await installApp(page);
//     await installIosFocusSemantics(page);
//     await page.goto('/today.html');

/** Selector for the controls iOS genuinely DOES focus on tap (text entry). */
const IOS_FOCUSES_ON_TAP = 'input,textarea,select,[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';

/**
 * Make this page deliver iOS Safari's focus behaviour on tap: a tap blurs the
 * focused element and focuses nothing, so panels see `focusout` with a null
 * `relatedTarget`. Must be called before the first navigation.
 */
export async function installIosFocusSemantics(page: Page): Promise<void> {
  await page.addInitScript((sel: string) => {
    document.addEventListener('pointerdown', () => {
      const active = document.activeElement as HTMLElement | null;
      if (!active || active === document.body || active === document.documentElement) return;
      if (active.matches && active.matches(sel)) return;   // iOS keeps focus on text entry
      if (typeof active.blur === 'function') active.blur();
    }, true);
    (window as unknown as { __IOS_FOCUS_SEMANTICS: boolean }).__IOS_FOCUS_SEMANTICS = true;
  }, IOS_FOCUSES_ON_TAP);
}
