// ── What's new (builder list item 128) ──
//   deno run --allow-read tests/presence/whats_new_128_test.mjs
// whats-new.json is what the panel shows: each entry written once, with its readers, a
// picture taken on sample data and a link inside the app. This checks every entry, the
// rules whats-new.js reads them by (who sees what, the weeks, safe links), and where the
// shell and the portal put the door.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

globalThis.window = globalThis;
await import('../../whats-new.js');
const W = globalThis.DDSWhatsNew;
const data = JSON.parse(read('whats-new.json'));
const list = data.entries;

// ═══ every entry ═══
{
  ok('whats-new.json reads, with entries', Array.isArray(list) && list.length > 0);
  const ids = list.map((e) => e.id);
  ok('each entry has its own id, a plain name', new Set(ids).size === ids.length && ids.every((id) => /^[a-z0-9-]{3,40}$/.test(id)));
  ok('each has a real day, newest first in the file', list.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && !Number.isNaN(Date.parse(e.date + 'T00:00:00Z'))) && list.every((e, n) => n === 0 || list[n - 1].date >= e.date));
  ok('each names its readers from the three kinds', list.every((e) => Array.isArray(e.who) && e.who.length && e.who.every((w) => ['studio', 'owner', 'client'].includes(w))));
  ok('a studio reads every entry', list.every((e) => e.who.includes('studio')));
  ok('each has a title and one sentence', list.every((e) => e.title && e.sentence && e.title.length <= 70 && e.sentence.length <= 200));
  const pics = new Set();
  for (const e of list) {
    const m = /^\/thumbs\/whats-new\/([a-z0-9-]+)\.jpg$/.exec(e.picture || '');
    let there = false; try { there = !!m && Deno.statSync(new URL(e.picture.slice(1), ROOT)).size > 4000; } catch { /* missing */ }
    ok(`${e.id}: its picture is in thumbs/whats-new and was taken (a real photo, not empty)`, there, e.picture);
    if (m) pics.add(`${m[1]}.jpg`);
    ok(`${e.id}: its picture says what it shows`, typeof e.alt === 'string' && e.alt.length > 20);
    ok(`${e.id}: Show me goes to a page in the app`, typeof e.show === 'string' && /^\/(?!\/)[\w./#?=&%-]*$/.test(e.show));
    if (e.who.includes('client')) {
      const c = e.client || {};
      ok(`${e.id}: a client reads it in words written for clients`, !!e.client && !!c.title && !!c.sentence && !/studio os/i.test(JSON.stringify(c)) && !/\b(Sites|Pipeline|Edit site)\b/.test(c.title + ' ' + c.sentence));
      ok(`${e.id}: …and its own link, if any, stays in the portal`, !c.show || /^\/client\.html/.test(c.show));
    }
  }
  const files = [...Deno.readDirSync(new URL('thumbs/whats-new/', ROOT))].map((f) => f.name).filter((n) => !n.startsWith('.'));
  ok('every picture in thumbs/whats-new belongs to an entry', files.every((f) => pics.has(f)), files.filter((f) => !pics.has(f)).join(', '));
}

// ═══ the panel's rules ═══
{
  const ids = (who) => W.entriesFor(data, who).map((e) => e.id);
  ok('a studio sees every entry, newest first', ids('studio').length === list.length && ids('studio')[0] === list[0].id);
  ok('a business running its own site sees only the entries that touch it', ids('owner').every((id) => list.find((e) => e.id === id).who.includes('owner')) && !ids('owner').includes('sites-numbers'));
  const client = W.entriesFor(data, 'client');
  ok('a client sees only the client entries, in their own words and links', client.length === list.filter((e) => e.who.includes('client')).length
    && client.every((e) => { const src = list.find((x) => x.id === e.id); return e.title === src.client.title && e.show === (src.client.show || ''); }));
  ok('…and never a studio’s link: an entry with no client link has no Show me', W.entriesFor({ entries: [{ id: 'x', date: '2026-11-12', who: ['studio', 'client'], title: 'S', sentence: 'S.', show: '/sites.html', client: { title: 'C', sentence: 'C.' } }] }, 'client')[0].show === '');
  ok('…and an entry with no client words is not shown to a client at all', W.entriesFor({ entries: [{ id: 'y', date: '2026-11-12', who: ['client'], title: 'S', sentence: 'S.' }] }, 'client').length === 0);
  const made = { entries: [
    { id: 'a', date: '2026-11-10', who: ['owner'], title: 'A', sentence: 'One.', show: 'https://evil.example/' },
    { id: 'b', date: '2026-11-12', who: ['owner'], title: 'B', sentence: 'Two.', show: '//evil.example' },
    { id: 'c', date: 'soon', who: ['owner'], title: 'C', sentence: 'Three.' },
    { id: 'd', date: '2026-11-11', who: ['owner'], title: '', sentence: 'No title.' },
    { id: 'e', date: '2026-11-09', who: ['owner'], title: 'E', sentence: 'Five.', show: 'javascript:alert(1)' },
  ] };
  const got = W.entriesFor(made, 'owner');
  ok('newest first; a bad day or an empty title is left out', got.map((e) => e.id).join() === 'b,a,e');
  ok('a link that leaves the app is dropped, never followed', got.every((e) => e.show === ''));
  const wk = (d, t) => W.weekOf(d, t).label;
  ok('weeks run Monday to Sunday and say how long ago', wk('2026-11-12', '2026-11-12') === 'This week · Nov 9 to 15' && wk('2026-11-09', '2026-11-15') === 'This week · Nov 9 to 15'
    && wk('2026-11-08', '2026-11-12') === 'Last week · Nov 2 to 8' && wk('2026-10-29', '2026-11-12') === '2 weeks ago · Oct 26 to Nov 1');
  ok('the same week has one key, so its entries sit under one heading', W.weekOf('2026-11-09', '2026-11-20').key === W.weekOf('2026-11-15', '2026-11-20').key);
}

// ═══ where the doors are ═══
{
  const shell = read('shell.js');
  ok('the shell: the button sits beside the bell, for a studio and a business, never a client', /id="dds-bell"[^\n]*\n\s*\(whatsNewWho\(\) \? '<button class="dds-ic" id="dds-new"/.test(shell)
    && /if \(!CTX \|\| CTX\.is_client_portal \|\| isReviewerCtx\(\)\) return '';/.test(shell) && /return CTX\.is_agency \? 'studio' : 'owner';/.test(shell));
  ok('…loads the panel only when it is needed, and the dot after the page has settled', /s\.src = '\/whats-new\.js\?v=1';/.test(shell) && /requestIdleCallback[^\n]*paintWhatsNewDot/.test(shell));
  ok('…and the account menu has it too, for the narrowest phones', /id="dds-new-row">What’s new/.test(shell) && /#dds-new\{display:none\}|#dds-new{display:none}|,#dds-new\{display:none\}/.test(read('shell.css').replace(/\s/g, '')));
  const portal = read('client.html');
  ok('the portal: New in your portal tops the Help tab, between its heading and the kit', /portalHeader\('Help','Quick answers from your studio\.'\)\+whatsNewDoorHtml\(\)\+kitHtml\(kr\)/.test(portal)
    && /W\.open\(\{who:'client'/.test(portal));
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
