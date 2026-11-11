// ── Builder list item 148: the pop-up's card, under the announcement bar's ────
// One calm pop-up per site, off until switched on: a heading, a few words, the "Join
// our list" box or one or two buttons; when it shows (after some seconds, or a scroll);
// where (every page, the home page, or the pages picked); how long it stays away once
// closed; phones yes or no; optional dates. Every change saves itself through the
// editor's own settingsPut (PUT /settings { popup }), and shows on the site at the next
// publish. The server makes it safe again at publish (lib/popup.ts normalizePopup).
// Loaded on first use by presence.html (loadPopupCard); bump its ?v= there when this
// file changes.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULT = { on: false, heading: '', text: '', action: 'signup', buttons: [{ label: '', url: '' }, { label: '', url: '' }], after: 'seconds', seconds: 8, scroll: 50, pages: 'all', picked: [], again: 'week', phones: true, from: '', until: '' };
  const BUILT_IN = [['home', 'Home'], ['offerings', 'Your offerings page'], ['about', 'About'], ['faq', 'Questions'], ['contact', 'Contact'], ['updates', 'Updates']];

  /** Draw the card into `host` and keep the saved setting in step with it.
   *  o: { popup, pages: [{slug,title}], offeringLabel, save(popup) → Promise, whisper(state), toast(msg,bad), changed() } */
  function mount(host, o) {
    if (!host || document.getElementById('popCard')) return null;
    const st = { ...DEFAULT, ...(o.popup && typeof o.popup === 'object' ? o.popup : {}) };
    st.buttons = [0, 1].map((i) => ({ label: (st.buttons && st.buttons[i] && st.buttons[i].label) || '', url: (st.buttons && st.buttons[i] && st.buttons[i].url) || '' }));
    st.picked = Array.isArray(st.picked) ? st.picked.slice() : [];
    const own = (o.pages || []).filter((p) => p && p.slug).map((p) => [`page:${p.slug}`, p.title || p.slug]);
    const builtIn = BUILT_IN.map(([k, l]) => [k, k === 'offerings' && o.offeringLabel ? `${o.offeringLabel} page` : l]);
    const card = document.createElement('div');
    card.id = 'popCard';
    card.style.marginTop = '22px';
    card.innerHTML = `<h5 class="rune">Pop-up</h5>
<div class="field">
  <label style="display:flex;align-items:center;gap:8px;font-weight:600"><input type="checkbox" id="pop-on" style="width:auto;margin:0"> Show a pop-up on your website</label>
  <div class="hint">One calm card that shows once a visitor has been on the page a little while. It’s off until you switch it on.</div>
  <div id="pop-body">
    <label for="pop-heading" style="margin-top:12px">Heading</label>
    <input type="text" id="pop-heading" maxlength="80" placeholder="e.g. 10% off your first visit">
    <label for="pop-text" style="margin-top:10px">A few words (optional)</label>
    <textarea id="pop-text" maxlength="240" rows="2" placeholder="e.g. Join our list and we’ll send the code."></textarea>
    <fieldset style="border:0;padding:0;margin:12px 0 0"><legend style="font-weight:600;font-size:13px">In it</legend>
      <label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="radio" name="pop-action" value="signup" style="width:auto;margin:0"> The “Join our list” box</label>
      <label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="radio" name="pop-action" value="buttons" style="width:auto;margin:0"> One or two buttons</label>
    </fieldset>
    <div id="pop-buttons" style="margin-top:6px">${[0, 1].map((i) => `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
      <input type="text" id="pop-b${i}-label" maxlength="40" aria-label="Button ${i + 1} words" placeholder="Button ${i + 1}${i ? ' (optional)' : ''}, e.g. ${i ? 'Call us' : 'Book now'}" style="flex:1;min-width:140px">
      <input type="text" id="pop-b${i}-url" maxlength="300" aria-label="Button ${i + 1} link" placeholder="${i ? 'tel:5551234567' : '/contact/ or #form-quote'}" style="flex:1;min-width:160px"></div>`).join('')}
      <div class="hint">A link can be one of your pages (/contact/), a web address, a phone (tel:…), an email (mailto:…), or one of your forms: #form- and its name, as the Forms card shows it.</div>
    </div>
    <fieldset style="border:0;padding:0;margin:12px 0 0"><legend style="font-weight:600;font-size:13px">When it shows</legend>
      <label style="display:flex;gap:8px;align-items:center;font-weight:400;flex-wrap:wrap"><input type="radio" name="pop-after" value="seconds" style="width:auto;margin:0"> After <input type="number" id="pop-seconds" min="3" max="60" style="width:70px" aria-label="Seconds"> seconds on a page</label>
      <label style="display:flex;gap:8px;align-items:center;font-weight:400;flex-wrap:wrap"><input type="radio" name="pop-after" value="scroll" style="width:auto;margin:0"> Once they’ve scrolled <input type="number" id="pop-scroll" min="10" max="90" step="5" style="width:70px" aria-label="Percent of the page"> % down a page</label>
    </fieldset>
    <label for="pop-pages" style="margin-top:12px">Where</label>
    <select id="pop-pages"><option value="all">Every page</option><option value="home">The home page only</option><option value="pick">These pages…</option></select>
    <div id="pop-picked" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px 14px">${[...builtIn, ...own].map(([k, l]) => `<label style="display:inline-flex;gap:6px;align-items:center;font-weight:400;font-size:13px"><input type="checkbox" value="${esc(k)}" style="width:auto;margin:0"> ${esc(l)}</label>`).join('')}</div>
    <label for="pop-again" style="margin-top:12px">Once someone closes it, not again for</label>
    <select id="pop-again"><option value="day">a day</option><option value="week">a week</option><option value="two_weeks">two weeks</option><option value="month">a month</option></select>
    <label style="display:flex;align-items:center;gap:8px;font-weight:400;margin-top:12px"><input type="checkbox" id="pop-phones" style="width:auto;margin:0"> Show it on phones too</label>
    <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;align-items:center">
      <label for="pop-from" style="margin:0;font-size:12px">From</label><input type="date" id="pop-from">
      <label for="pop-until" style="margin:0;font-size:12px">Until</label><input type="date" id="pop-until">
    </div>
    <div class="hint">Dates are optional. It shows from your next publish; someone who joins your list never sees it again.</div>
  </div>
</div>`;
    host.appendChild(card);
    const $ = (id) => card.querySelector('#' + id);
    const radios = (n) => [...card.querySelectorAll(`input[name="${n}"]`)];
    // fill
    $('pop-on').checked = !!st.on;
    $('pop-heading').value = st.heading || '';
    $('pop-text').value = st.text || '';
    radios('pop-action').forEach((r) => { r.checked = r.value === st.action; });
    [0, 1].forEach((i) => { $(`pop-b${i}-label`).value = st.buttons[i].label; $(`pop-b${i}-url`).value = st.buttons[i].url; });
    radios('pop-after').forEach((r) => { r.checked = r.value === st.after; });
    $('pop-seconds').value = st.seconds; $('pop-scroll').value = st.scroll;
    $('pop-pages').value = st.pages;
    card.querySelectorAll('#pop-picked input').forEach((c) => { c.checked = st.picked.includes(c.value); });
    $('pop-again').value = st.again;
    $('pop-phones').checked = st.phones !== false;
    $('pop-from').value = st.from || ''; $('pop-until').value = st.until || '';
    const read = () => ({
      on: $('pop-on').checked,
      heading: $('pop-heading').value.trim(),
      text: $('pop-text').value.trim(),
      action: (radios('pop-action').find((r) => r.checked) || {}).value || 'signup',
      buttons: [0, 1].map((i) => ({ label: $(`pop-b${i}-label`).value.trim(), url: $(`pop-b${i}-url`).value.trim() })).filter((b) => b.label || b.url),
      after: (radios('pop-after').find((r) => r.checked) || {}).value || 'seconds',
      seconds: Number($('pop-seconds').value) || 8,
      scroll: Number($('pop-scroll').value) || 50,
      pages: $('pop-pages').value,
      picked: [...card.querySelectorAll('#pop-picked input:checked')].map((c) => c.value),
      again: $('pop-again').value,
      phones: $('pop-phones').checked,
      from: $('pop-from').value || '',
      until: $('pop-until').value || '',
    });
    const show = () => {
      const v = read();
      $('pop-body').hidden = !v.on;
      $('pop-buttons').hidden = v.action !== 'buttons';
      $('pop-picked').hidden = v.pages !== 'pick';
    };
    // what an "on" pop-up still needs before it can show, said once, under the switch
    const missing = (v) => (!v.on ? '' : !v.heading ? 'Add a heading and it can show.' : v.action === 'buttons' && !v.buttons.some((b) => b.label && b.url) ? 'Give a button its words and a link and it can show.' : v.pages === 'pick' && !v.picked.length ? 'Pick at least one page, or it shows on every page.' : '');
    const say = document.createElement('div'); say.className = 'hint'; say.setAttribute('role', 'status'); say.id = 'pop-say';
    $('pop-body').before(say);
    let saved = JSON.stringify(read());
    const save = async () => {
      show();
      const v = read();
      say.textContent = missing(v);
      const sig = JSON.stringify(v);
      if (sig === saved) return;
      o.whisper && o.whisper('saving');
      try { await o.save(v); saved = sig; o.whisper && o.whisper('saved'); o.changed && o.changed(); }
      catch (err) { o.whisper && o.whisper('failed'); o.toast && o.toast((err && err.message) || 'That didn’t save. Try again in a moment.', true); }
    };
    card.addEventListener('change', save);
    show();
    say.textContent = missing(read());
    return card;
  }

  window.DDSPopupCard = { mount };
})();
