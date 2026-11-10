import { test, expect, Page, Route } from '@playwright/test';
import { installApp, STUDIO_NAV, ALL_FEATURES, answerAsks, setAsksAnswer, askedSoFar } from './helpers/app';
import { ABOUT_BLOCKS, ABOUT_SECTION, aboutField, aboutIn, aboutSaveOut, addGallery, ANSWER_HEADERS, API, backToCanvas, BLOCKS, blocksIn, canvasReplaced, canvasScrollY, CONTACT, draftReads, draftVersion, duplicate, editAndWaitOut, editHome, FAR_DOWN, Field, FORM, FormBlocks, formSaveOut, Frame, GALLERY, hasTheirs, hideOut, holdPuts, holdReads, homeLine, lastPut, lastTwo, markCanvas, menuRows, META, mountCanvas, Mounted, mountPages, moveThenWrite, NORM_BLOCKS, NORM_META, NORM_SECTIONS, nudge, onPill, openAbout, openBusiness, OWN_MENU, OWN_PAGES, PAGE_HTML, Paged, PAGED, pageIn, pageMenu, panelEdit, pill, pillNames, previewHtml, redo, refusal, renameContact, SECTIONS, selectInBody, SETTINGS, slugs, stored, STORY, storyIn, STRIP, THEIRS, theirSection, typeDetail, typeOver, undo, WITH_CONTACT, WITH_FORM, writeOnAboutAndLeave } from './helpers/editor';

// ── G13 in-place canvas text editor — editing in place: enter, commit, cancel, the mini-bar, caps and modes ──
// Split from g13-editor.spec.ts (builder list item 109, Nov 2026): the fixtures and
// helpers live in helpers/editor.ts; the tests here are as they were.

test.describe('G13 in-place canvas text editor — editing in place: enter, commit, cancel, the mini-bar, caps and modes', () => {
  test('keyboard entry (Tab-reachable field + Enter) → edit → Enter commits: ONE debounced PUT carries the new string at the stored path', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const h2 = frame.locator('section.block-titleonly [data-dds-field="title"]');
    // the a11y entry path: every stamped field is keyboard-reachable; Enter
    // starts the session. (The topmost field sits under the shipped hover
    // toolbar on narrow viewports, so dblclick entry is pinned on the subtitle
    // and md tests below — the keyboard path must work EVERYWHERE.)
    await expect(h2).toHaveAttribute('tabindex', '0');
    await h2.focus();
    await page.keyboard.press('Enter');
    // the session: an editable, a11y-labelled textbox with a live announcement
    await expect(h2).toHaveAttribute('contenteditable', /true|plaintext-only/);
    await expect(h2).toHaveAttribute('role', 'textbox');
    await expect(frame.locator('#dds-ipe-live')).toContainText(/Editing/);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('A bolder heading');
    await page.keyboard.press('Enter');
    // the canvas reflects the edit immediately (the element holds it) and the
    // session chrome is fully restored
    await expect(h2).toHaveText('A bolder heading');
    await expect(h2).not.toHaveAttribute('contenteditable', /.+/);
    await expect(h2).not.toHaveAttribute('role', /.+/);
    // the debounced save lands as ONE PUT with the string at the right path
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    const blocks = puts[0].blocks as typeof BLOCKS;
    expect(blocks[0].title).toBe('A bolder heading');
    expect(blocks[0].subtitle).toBe('A quiet sub line');   // siblings untouched
    expect(blocks[1]).toEqual(BLOCKS[1]);                  // other blocks ride whole
  });

  test('double-click enters editing; Escape cancels: the DOM reverts and NO save fires; click-away with no change also saves nothing', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const sub = frame.locator('[data-dds-field="subtitle"]');
    await sub.dblclick();
    await expect(sub).toHaveAttribute('contenteditable', /.+/);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('junk that must vanish');
    await page.keyboard.press('Escape');
    await expect(sub).toHaveText('A quiet sub line');      // the original DOM is back
    await expect(sub).not.toHaveAttribute('contenteditable', /.+/);
    // an unchanged commit (blur without typing) is a no-op too
    const h2 = frame.locator('section.block-titleonly [data-dds-field="title"]');
    await h2.dblclick();
    await expect(h2).toHaveAttribute('contenteditable', /.+/);
    await frame.locator('section.block-cta').click();      // click away = commit (unchanged)
    await page.waitForTimeout(1800);                       // longer than the 1.2s debounce
    expect(puts.length).toBe(0);
  });

  test('a markdown field round-trips markdown SOURCE — never rendered HTML — and the mini-bar bolds via markdown', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const prose = frame.locator('[data-dds-field="body"]');
    await prose.dblclick();
    await expect(prose).toHaveAttribute('contenteditable', 'true');
    await expect(frame.locator('#dds-ipe-bar')).toBeVisible();   // md fields get B · I · Link
    await page.keyboard.press('End');
    await page.keyboard.insertText(' plus more');
    await page.keyboard.press('ControlOrMeta+Enter');            // md commit
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    const body = (puts[0].blocks as typeof BLOCKS)[1].body as string;
    expect(body).toContain('**world**');                   // existing markdown survives
    expect(body).toContain('plus more');                   // the edit landed
    expect(body).toContain('- first');                     // the list survives as source
    expect(body).not.toMatch(/<\/?[a-z]/);                 // NEVER HTML into storage
    expect((puts[0].blocks as typeof BLOCKS)[1].title).toBe('Our story');
  });

  test('mini-bar B stores markdown the REAL renderer parses back to the exact visual (never **a *b* c** fabrications)', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const prose = frame.locator('[data-dds-field="body"]');
    await prose.dblclick();
    await expect(prose).toHaveAttribute('contenteditable', 'true');
    await selectInBody(frame, 'Hello');
    await frame.locator('#dds-ipe-bar button[aria-label="Bold"]').click();
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    const body = (puts[0].blocks as typeof BLOCKS)[1].body as string;
    expect(body).toBe('**Hello** **world**\n\n- first\n- second');   // parseable source, byte-pinned
  });

  test('mini-bar B on an already-bold selection TOGGLES the run off (⌘/Ctrl+B routes through the same guarded wrap)', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const prose = frame.locator('[data-dds-field="body"]');
    await prose.dblclick();
    await expect(prose).toHaveAttribute('contenteditable', 'true');
    await selectInBody(frame, 'world');            // sits inside the rendered <strong>
    await page.keyboard.press('ControlOrMeta+b');  // the native-shortcut intercept
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    const body = (puts[0].blocks as typeof BLOCKS)[1].body as string;
    expect(body).toBe('Hello world\n\n- first\n- second');           // bold gone, nothing else touched
  });

  test('mini-bar B across a paragraph break is refused with an honest toast — no glue, no write', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const prose = frame.locator('[data-dds-field="body"]');
    await prose.dblclick();
    await expect(prose).toHaveAttribute('contenteditable', 'true');
    await frame.locator('[data-dds-field="body"]').evaluate((el) => {
      const doc = el.ownerDocument!;
      const p = el.querySelector('p')!.firstChild as Node;          // 'Hello '
      const li = el.querySelector('ul li')!.firstChild as Node;     // 'first'
      const r = doc.createRange(); r.setStart(p, 0); r.setEnd(li, 3);
      const s = doc.getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('ControlOrMeta+b');
    await expect(page.getByText(/crosses a paragraph break/)).toBeVisible();
    await page.keyboard.press('Escape');           // leave without committing anything
    await page.waitForTimeout(1500);
    expect(puts.length).toBe(0);
  });

  // ── G13 final review, CONFIRMED corruption #1: Chromium's surroundContents
  // leaves empty text nodes at its split points, so italicizing two halves of
  // one word in separate gestures leaves 'T("") EM[Hel] T("") EM[lo]' in the
  // DOM. Storage must hold ONE merged em — never the '*Hel**lo*' tear, which
  // re-renders as em(Hel) plus a LITERAL "*lo*" while the session showed the
  // whole word italic. ──
  test('italicizing "Hel" then "lo" in separate gestures stores ONE merged *Hello* — wrap residue never tears the em', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const prose = frame.locator('[data-dds-field="body"]');
    await prose.dblclick();
    await expect(prose).toHaveAttribute('contenteditable', 'true');
    await selectInBody(frame, 'Hel');
    await page.keyboard.press('ControlOrMeta+i');
    await selectInBody(frame, 'lo');               // the remnant text node left beside the first wrap
    await page.keyboard.press('ControlOrMeta+i');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    const body = (puts[0].blocks as typeof BLOCKS)[1].body as string;
    expect(body).not.toMatch(/\*Hel\*\*lo\*/);     // the confirmed corruption shape
    expect(body).toBe('*Hello* **world**\n\n- first\n- second');
  });

  // ── CONFIRMED corruption #2: the renderer trims each stored line and reads
  // '^[-*]\s+' as a bullet, so italicizing a space-leading run at a line
  // start must never store a line beginning '* ' — that would re-render a
  // paragraph as a fabricated UL (a BLOCK structure change). ──
  test('italicizing a space-leading run at a line start never stores a "* " line — no fabricated bullet list', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const prose = frame.locator('[data-dds-field="body"]');
    await prose.dblclick();
    await expect(prose).toHaveAttribute('contenteditable', 'true');
    // caret at the very start of the paragraph text, then a line + soft
    // break + a space-leading run — the typo shape
    await frame.locator('[data-dds-field="body"]').evaluate((el) => {
      const doc = el.ownerDocument!;
      const r = doc.createRange();
      r.setStart(el.querySelector('p')!.firstChild!, 0); r.collapse(true);
      const s = doc.getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.type('intro');
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type(' part');
    // select " part" INCLUDING its leading (non-breaking) space and italicize
    await frame.locator('[data-dds-field="body"]').evaluate((el) => {
      const doc = el.ownerDocument!;
      const w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n: Node | null; let prev: Node | null = null;
      while ((n = w.nextNode())) {
        const i = (n.nodeValue || '').indexOf('part');
        if (i >= 0) {
          const r = doc.createRange();
          if (i > 0) r.setStart(n, i - 1);                                        // the space sits in the same node
          else if (prev && (prev.nodeValue || '').length) r.setStart(prev, (prev.nodeValue as string).length - 1);   // …or in the previous one
          else r.setStart(n, i);
          r.setEnd(n, i + 4);
          const s = doc.getSelection()!; s.removeAllRanges(); s.addRange(r);
          return;
        }
        prev = n;
      }
      throw new Error('typed run not found');
    });
    await page.keyboard.press('ControlOrMeta+i');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    const body = (puts[0].blocks as typeof BLOCKS)[1].body as string;
    // the hazard: a trimmed stored line beginning '* ' re-renders as a UL.
    // (The REAL list in this fixture uses '- ', so the star check is exact.)
    expect(body.split('\n').some((l) => /^\*\s/.test(l.trim()))).toBe(false);
    expect(body).toContain('*part*');              // the italics the session showed survive
    expect(body).toContain('**world**');           // the rest of the body is untouched
  });

  test('caps: a plain field clamps at the validator cap (cta text 160) with a visible warning', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const cta = frame.locator('[data-dds-field="text"]');
    await cta.focus();
    await page.keyboard.press('Enter');
    await expect(cta).toHaveAttribute('contenteditable', /.+/);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('x'.repeat(200));
    await page.keyboard.press('Enter');
    await expect(page.getByText(/Trimmed to the field/)).toBeVisible();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    expect(((puts[0].blocks as typeof BLOCKS)[2].text as string).length).toBe(160);
  });

  // ── review finding 4: a zero-edit session must never write — not the render's
  // English fallback text, not the serializer's normalizations. ──
  test('REVIEW F4a: open a FALLBACK heading (no stored title) + leave with zero typing → NO PUT, no fallback text into storage', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const h2 = frame.locator('section.block-features [data-dds-field="title"]');
    // keyboard entry: the features section sits at the bottom, where the shipped
    // hover toolbar / add-FAB occlude pointer dblclicks on narrow viewports
    // (same reason the keyboard path exists at all — see the first test).
    await h2.focus();
    await page.keyboard.press('Enter');
    await expect(h2).toHaveAttribute('contenteditable', /.+/);
    await frame.locator('section.block-titleonly').click();   // blur commits
    await page.waitForTimeout(1800);                          // past the 1.2s debounce
    expect(puts.length).toBe(0);
  });

  test('REVIEW F4b: dblclick an md field whose serialization NORMALIZES (*→-, 7.→1.) + click away with zero typing → NO PUT', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page, {
      html: PAGE_HTML(NORM_SECTIONS),
      settings: { blocks: NORM_BLOCKS, section_meta: NORM_META },
    });
    const prose = frame.locator('[data-dds-field="body"]');
    await prose.dblclick();
    await expect(prose).toHaveAttribute('contenteditable', 'true');
    await frame.locator('section.block-titleonly').click();
    await page.waitForTimeout(1800);
    expect(puts.length).toBe(0);   // '- star one…1. seven' ≠ stored, but the USER changed nothing
  });

  test('REVIEW F8: the live region says Saving… at commit and Saved only once the PUT resolves', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const h2 = frame.locator('section.block-titleonly [data-dds-field="title"]');
    await h2.focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('Honest announce');
    await page.keyboard.press('Enter');
    await expect(frame.locator('#dds-ipe-live')).toContainText('Saving');   // the PUT is still ~1.2s away
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    await expect(frame.locator('#dds-ipe-live')).toContainText(/^Saved$/);  // announced only after the resolve (survives the repaint)
  });

  test('core sections are NOT editable this slice — double-click says which tab holds their words and offers the way', async ({ page }) => {
    const { frame } = await mountCanvas(page);
    await frame.locator('[data-dds-core="hero"]').dblclick();
    await expect(frame.locator('[contenteditable]')).toHaveCount(0); // nothing became editable
    await expect(page.locator('html')).toHaveClass(/dc-edit/);       // and no surprise jump out of Edit mode
    await page.locator('.toast').getByRole('button', { name: 'Edit them there' }).click();
    await expect(page.locator('#view-business')).toBeVisible();      // hero → the Business tab
  });

  test('an OLD-function render (no stamps) gets no in-place affordance — the panel editor still works', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page, {
      html: PAGE_HTML(SECTIONS).replace(STRIP, ''),
      settings: { blocks: BLOCKS },   // no section_meta either — the full stale-deploy shape
    });
    await frame.locator('section.block-titleonly h2').dblclick();
    await expect(frame.locator('[contenteditable]')).toHaveCount(0); // feature-detect: no editor
    await expect(page.locator('#settingsPanel')).toHaveClass(/on/);  // …but the panel path still opens
    await page.waitForTimeout(1500);
    expect(puts.length).toBe(0);
  });

  test('Edit mode is the gate: a read-only mode never edits in place', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    await page.evaluate(() => (window as any).dcSetMode('timewarp'));
    await expect(frame.locator('#main > section').first()).toBeVisible();  // the view-mode repaint landed
    await frame.locator('section.block-titleonly [data-dds-field="title"]').dblclick();
    await page.waitForTimeout(400);
    await expect(frame.locator('[contenteditable]')).toHaveCount(0);
    expect(puts.length).toBe(0);
  });

  test('the hover toolbar keeps working alongside: Duplicate after an in-place commit', async ({ page }) => {
    const { frame, puts } = await mountCanvas(page);
    const h2 = frame.locator('section.block-titleonly [data-dds-field="title"]');
    await h2.focus();
    await page.keyboard.press('Enter');
    await expect(h2).toHaveAttribute('contenteditable', /.+/);
    await markCanvas(frame);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.insertText('Edited first');
    await page.keyboard.press('Enter');
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(1);
    // the canvas reloaded after the save — the toolbar still drives section ops
    await canvasReplaced(frame);
    await frame.locator('section.block-richtext').hover();
    const dup = frame.locator('#dds-dc-bar button', { hasText: 'Duplicate' });
    await expect(dup).toBeVisible();
    await dup.click();
    await expect.poll(() => puts.length, { timeout: 6000 }).toBe(2);
    const last = puts[puts.length - 1].blocks as typeof BLOCKS;
    expect(last.length).toBe(5);                            // duplicated in place
    expect(last[0].title).toBe('Edited first');             // the in-place edit persisted through
    expect(last[2].type).toBe('richtext');
  });

});
