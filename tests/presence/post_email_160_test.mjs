// ── A blog post goes out as an email update (builder list item 160, part one) ──
//   deno run --allow-read --allow-env --allow-net tests/presence/post_email_160_test.mjs
// GET /posts/:id/email-draft starts Send an update from a live post: its title, cover,
// summary and a link to it. The email itself goes through the one send path (the
// business as the sender, the Unsubscribe line), and a link on a line of its own is now
// a button. Through a fetch fake; nothing is sent anywhere.
const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const results = [];
const ok = (n, p, note = '') => { results.push(p); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note && !p ? ' — ' + note : ''}`); };

Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SERVICE_ROLE_KEY', 'svc-key');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-key');

const { buildEmailHtml } = await import('../../supabase/functions/presence/lib/broadcast.ts');
const { renderMarkdown } = await import('../../supabase/functions/presence/lib/markdown.ts');
const PHOTO = '11111111-2222-4333-8444-555555555555';

// ── the email body ──
{
  const html = buildEmailHtml('Our patio opens Friday.\n\n[Read the whole post](https://marlows.example/updates/summer-patio/)', {}, { accent: '#8a3b4c' });
  ok('a link on a line of its own is a button with its words, in the studio’s colour', html.includes('<p class="cta"><a href="https://marlows.example/updates/summer-patio/" rel="noopener" style="display:inline-block;margin-top:6px;background:#8a3b4c;') && html.includes('>Read the whole post</a></p>'));
  ok('…after the words before it', html.indexOf('<p>Our patio opens Friday.</p>') < html.indexOf('Read the whole post'));
  ok('its words are escaped', buildEmailHtml('[<b>Go</b> & see](https://x.example/)', {}).includes('>&lt;b&gt;Go&lt;/b&gt; &amp; see</a>'));
  for (const body of ['A [link](https://x.example) in a sentence', '[not https](http://x.example/)', '[mail us](mailto:a@x.example)', '[bad](javascript:alert(1))'])
    ok(`anything else renders exactly as before: ${JSON.stringify(body)}`, buildEmailHtml(body, {}) === renderMarkdown(body));
  const img = buildEmailHtml(`![Patio](media:${PHOTO} "Chef Ana plating")`, {}, { images: { [PHOTO]: 'https://example.supabase.co/functions/v1/presence/email/img/x' } });
  ok('a post’s photo line with a caption still shows its photo in an email', img.includes('<img src="https://example.supabase.co/functions/v1/presence/email/img/x" alt="Patio"'));
  const page = read('broadcasts.html');
  ok('the live preview draws a link line as a button too', /LINK_LINE=/.test(page) && /mail-cta/.test(page));
}

// ── GET /posts/:id/email-draft ──
const site = { id: '00000000-0000-4000-8000-000000000001', client_id: '00000000-0000-4000-8000-000000000002', status: 'live', custom_domain: 'marlows.example', netlify_site_id: 'n1' };
const POST = '00000000-0000-4000-8000-0000000000a1';
let post = null, liveIds = [];
const realFetch = globalThis.fetch;
const res = (v, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
globalThis.fetch = async (input) => {
  const q = new URL(String(input instanceof Request ? input.url : input)), table = q.pathname.split('/').pop();
  if (table === 'presence_posts') return res(post ? [post] : []);
  if (table === 'presence_publishes') return res([{ snapshot_id: 'snap1' }]);
  if (table === 'presence_snapshots') { ok('the live check reads only the live version’s posts', q.searchParams.get('select') === 'posts:content->posts'); return res([{ posts: liveIds.map((id) => ({ id })) }]); }
  if (table === 'presence_media') return res([{ alt_text: 'The patio with heaters' }]);
  return res([]);
};
{
  const { handlePostEmailDraft } = await import('../../supabase/functions/presence/routes/blog.ts');
  const call = async () => { const r = await handlePostEmailDraft(site, POST, {}); return { status: r.status, body: await r.json() }; };
  post = { id: POST, title: 'Summer patio is open', slug: 'summer-patio-is-open', body_md: 'Our patio opens Friday.', excerpt: '', hero_media_id: PHOTO, status: 'published' };
  liveIds = [POST];
  let r = await call();
  ok('a live post: its title is the subject', r.status === 200 && r.body.data.live === true && r.body.data.subject === 'Summer patio is open');
  ok('…its cover, its first lines and the link to it, the link on its own line', r.body.data.body === `![The patio with heaters](media:${PHOTO})\n\nOur patio opens Friday.\n\n[Read the whole post](https://marlows.example/updates/summer-patio-is-open/)`);
  liveIds = [];
  r = await call();
  ok('a post published in the draft but not live yet can’t be sent: the link wouldn’t open', r.body.data.live === false && /Publish it first/.test(r.body.data.message) && !('body' in r.body.data));
  post = { ...post, status: 'scheduled' };
  r = await call();
  ok('a scheduled post says it can go once it’s live', r.body.data.live === false && /once it’s live/.test(r.body.data.message));
  post = null;
  r = await call();
  ok('a post that isn’t there is a 404', r.status === 404);
  const bad = await handlePostEmailDraft(site, 'nope', {});
  ok('a bad id is refused before any read', bad.status === 400);
}
globalThis.fetch = realFetch;

// ── the send path, unchanged: the business is the sender and Unsubscribe is there ──
{
  const b = read('supabase/functions/presence/lib/broadcast.ts');
  ok('every update goes out as the business, and not as a critical send (so it carries Unsubscribe)', /\{ siteId: b\.site_id, asBusiness: true \}/.test(b) && !/critical: true/.test(b.split('export async function dispatchBroadcast')[1]?.split('export ')[0] || ''));
}

const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
if (failed) Deno.exit(1);
