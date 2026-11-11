// ── Builder list item 149: two cards in the Bookings view, under "Your hours" ──
// "Your own calendar": the owner pastes their Google, Outlook or Apple calendar's private
// address and the times it shows them busy are kept off their booking page (the server
// reads the address before it keeps it, and says plainly when it can't). "Changes and
// cancellations": whether customers may move or cancel a booking themselves from their
// emails, up to the notice a new booking needs; on unless switched off. Both save through
// the Bookings view's own PUT /bookings/settings, with a body of just what changed.
// Loaded on first use by presence.html (loadBookingExtras); bump its ?v= there when this
// file changes.
(function () {
  const SAY_ERROR = {
    gone: 'We can’t read your calendar any more: its address may have been reset. Paste the new one.',
    unreachable: 'Your calendar didn’t answer when we last tried. Times aren’t checked against it until it does.',
    not_calendar: 'That address opens a web page, not a calendar. Paste the private address in iCal format.',
    too_big: 'Your calendar takes too long to read. A calendar with just your appointments works best.',
  };
  function ago(iso) {
    const ms = Date.now() - Date.parse(iso || '');
    if (!Number.isFinite(ms)) return '';
    const min = Math.round(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  /** One line on how the calendar stands. */
  function calendarLine(c) {
    if (!c || !c.on) return 'Not connected. Bookings only avoid each other and your hours.';
    if (c.ok === false) return SAY_ERROR[c.error] || SAY_ERROR.unreachable;
    const n = Number(c.busy) || 0;
    return `Connected to ${c.host || 'your calendar'}. ${n ? `${n} busy time${n === 1 ? '' : 's'} ahead ${n === 1 ? 'is' : 'are'} kept off your booking page.` : 'Nothing ahead is marked busy.'}${c.read_at ? ` Checked ${ago(c.read_at)}.` : ''}`;
  }
  function noticeWords(hours) {
    const h = Number(hours) || 0;
    if (!h) return 'Up until the time of the booking.';
    return `Up to ${h} hour${h === 1 ? '' : 's'} before, the same notice a new booking needs (your “Least notice”).`;
  }

  /** Draw both cards after `after` (the "Your hours" card) and return them.
   *  o: { settings, save(body) → Promise, card(title, sub) → element, toast(msg, bad), nice(err) } */
  function mount(after, o) {
    if (!after || !after.parentNode) return [];
    const s = o.settings || {};
    let cal = s.calendar || { on: false };

    // ── your own calendar ──
    const c1 = o.card('Your own calendar', 'Keep the times you’re busy in Google, Outlook or Apple Calendar off your booking page. We only read when you’re busy, never what the event is.');
    c1.id = 'bkCalendar';
    const body = document.createElement('div');
    body.innerHTML = `<p class="hint" id="bkCalSay" role="status" style="margin:0 0 10px"></p>
<label for="bkCalUrl" style="display:block;font-size:13px;font-weight:600;margin-bottom:4px">Your calendar’s private address</label>
<input type="url" id="bkCalUrl" autocomplete="off" spellcheck="false" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" style="width:100%;padding:8px 10px;border:1px solid var(--line,#ddd);border-radius:8px;font:inherit;box-sizing:border-box">
<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
  <button type="button" id="bkCalSave" style="padding:8px 16px;border:none;border-radius:999px;background:var(--plum,#5b3fa0);color:var(--fill-ink,#fff);font:inherit;cursor:pointer">Connect</button>
  <button type="button" id="bkCalOff" style="padding:7px 14px;border:1px solid var(--line,#ddd);border-radius:999px;background:var(--sheet,#fff);font:inherit;font-size:13px;cursor:pointer">Disconnect</button>
</div>
<details style="margin-top:12px"><summary style="cursor:pointer;font-size:13px;font-weight:600">Where do I find it?</summary>
<ul style="margin:8px 0 0;padding-left:18px;font-size:13px;display:grid;gap:6px">
  <li><b>Google Calendar</b> (on a computer): Settings, then your calendar under “Settings for my calendars”, then Integrate calendar. Copy “Secret address in iCal format”.</li>
  <li><b>Outlook</b>: Settings, Calendar, Shared calendars, Publish a calendar. Pick your calendar and “Can view when I’m busy”, press Publish, and copy the ICS link.</li>
  <li><b>Apple (iCloud)</b>: on icloud.com, open Calendar, press the share button beside your calendar, turn on Public Calendar and copy the link. Anyone with that link can see the calendar, so keep it to yourself.</li>
</ul></details>`;
    c1.appendChild(body);
    const say = body.querySelector('#bkCalSay'), url = body.querySelector('#bkCalUrl'), connect = body.querySelector('#bkCalSave'), off = body.querySelector('#bkCalOff');
    const paint = () => {
      say.textContent = calendarLine(cal);
      say.style.color = cal && cal.on && cal.ok === false ? 'var(--clay,#b42318)' : '';
      off.hidden = !(cal && cal.on);
      connect.textContent = cal && cal.on ? 'Use this address instead' : 'Connect';
      url.placeholder = cal && cal.on ? 'Paste a new address to change it' : 'https://calendar.google.com/calendar/ical/…/basic.ics';
    };
    paint();
    const saveCalendar = async (value) => {
      connect.disabled = off.disabled = true;
      const was = connect.textContent;
      if (value) { connect.textContent = 'Reading your calendar…'; say.textContent = ''; }
      try {
        const r = await o.save({ calendar_url: value });
        cal = (r && r.data && r.data.calendar) || { on: !!value };
        url.value = '';
        o.toast(value ? 'Your calendar is connected.' : 'Your calendar is disconnected.');
      } catch (err) {
        say.textContent = o.nice(err);
        say.style.color = 'var(--clay,#b42318)';
        connect.disabled = off.disabled = false;
        connect.textContent = was;
        return;
      }
      connect.disabled = off.disabled = false;
      paint();
    };
    connect.addEventListener('click', () => {
      const v = url.value.trim();
      if (!v) { say.textContent = 'Paste your calendar’s private address first.'; url.focus(); return; }
      saveCalendar(v);
    });
    url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); connect.click(); } });
    off.addEventListener('click', () => saveCalendar(''));

    // ── changes and cancellations ──
    const c2 = o.card('Changes and cancellations', '');
    c2.id = 'bkChanges';
    const row = document.createElement('label');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;font-size:13px;font-weight:600';
    row.innerHTML = '<input type="checkbox" id="bkSelfManage" style="width:auto"> <span>Let customers pick another time or cancel from their booking emails</span>';
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.style.margin = '8px 0 0';
    hint.textContent = `${noticeWords(s.lead_time_hours)} You’re told straight away, and a canceled time is free for others again.`;
    c2.append(row, hint);
    const box = row.querySelector('input');
    box.checked = s.self_manage !== false;
    box.addEventListener('change', async () => {
      const want = box.checked;
      try {
        await o.save({ self_manage: want });
        o.toast(want ? 'Customers can change or cancel from their emails.' : 'Customers will reply to their email to change a booking.');
      } catch (err) { box.checked = !want; o.toast(o.nice(err), true); }
    });

    after.after(c1, c2);
    return [c1, c2];
  }

  window.DDSBookingExtras = { mount, calendarLine, noticeWords };
})();
