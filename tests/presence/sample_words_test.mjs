// ── Sample words for a new site's preview ────────────────────────────────────
// A new site's home page drew an empty band and a lone "About us". The draft
// preview fills empty business words with samples that say they're samples; a
// publish never sees them, and anything the owner wrote is left alone.
//
//   deno run --allow-read --allow-env tests/presence/sample_words_test.mjs
import { renderSnapshot } from '../../supabase/functions/presence/lib/render.ts';
import { withSampleWords, SAMPLE_WORDS } from '../../supabase/functions/presence/lib/sample_words.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
const TEMPLATES = ['business-classic', 'editorial', 'restaurant-classic', 'aurora', 'atelier', 'harbor', 'meadow', 'slate'];

let pass = 0, fail = 0;
const ok = (n, c) => { if (c) pass++; else { fail++; console.log('  FAIL → ' + n); } };

for (const slug of TEMPLATES) {
  const fx = JSON.parse(read(`supabase/functions/presence/templates/${slug}/1.0.0/fixture.json`));
  const empty = structuredClone(fx);
  empty.content.identity = { business_name: '', description: '', phone: '', email: '' };
  empty.content.locations = [];
  empty.content.offerings = []; empty.content.testimonials = []; empty.content.faqs = []; empty.content.posts = []; empty.content.redirects = [];
  if (empty.content.settings) { empty.content.settings.blocks = []; delete empty.content.settings.pages; }
  const before = JSON.stringify(empty);
  const shown = withSampleWords(empty);
  ok(`[${slug}] the input snapshot is left as it was`, JSON.stringify(empty) === before);
  const home = renderSnapshot(shown, { baseUrl: 'https://x.test' })['index.html'];
  ok(`[${slug}] an empty draft's home page reads with the sample name`, home.includes(SAMPLE_WORDS.business_name));
  ok(`[${slug}] and the sample description under About`, home.includes(SAMPLE_WORDS.description));
  const plain = renderSnapshot(empty, { baseUrl: 'https://x.test' })['index.html'];
  ok(`[${slug}] the render a publish uses has no sample words`, !plain.includes(SAMPLE_WORDS.business_name) && !plain.includes('This is sample text'));
  ok(`[${slug}] with no address or phone there is no empty strip under the welcome`, !plain.includes('class="strip"'));
  ok(`[${slug}] with no description there is no bare "About us" heading`, !plain.includes('data-dds-core="about"'));
  const full = renderSnapshot(fx, { baseUrl: 'https://x.test' })['index.html'];
  ok(`[${slug}] a site with an address keeps its strip and its About`, full.includes('class="strip"') && full.includes('data-dds-core="about"'));
}

// only empty fields are filled
{
  const fx = JSON.parse(read('supabase/functions/presence/templates/business-classic/1.0.0/fixture.json'));
  const s = structuredClone(fx);
  s.content.identity = { ...s.content.identity, business_name: 'Marlow’s Kitchen', tagline: '  ', description: 'Real words', story: '' };
  const out = withSampleWords(s).content.identity;
  ok('a written name stays', out.business_name === 'Marlow’s Kitchen');
  ok('a written description stays', out.description === 'Real words');
  ok('a blank tagline gets the sample', out.tagline === SAMPLE_WORDS.tagline);
  ok('an empty story gets the sample', out.story === SAMPLE_WORDS.story);
  const full = structuredClone(fx);
  full.content.identity = { ...full.content.identity, business_name: 'A', tagline: 'B', description: 'C', story: 'D' };
  ok('a site with every word written comes back as the same object', withSampleWords(full) === full);
}

// only the draft preview fills them, and the badge keeps the real name
{
  const route = read('supabase/functions/presence/routes/preview.ts');
  const draftBranch = route.slice(route.indexOf('} else {'), route.indexOf('// Phase CP-1'));
  ok('the draft branch fills sample words', draftBranch.includes('snapshot = withSampleWords(snapshot);'));
  ok('nothing else in the preview route does', route.split('withSampleWords(').length === 2);
  ok('the preview badge names the draft by its real name', route.includes("const bizName = ownName ?? "));
  const publish = read('supabase/functions/presence/routes/publish.ts');
  ok('the publish route never uses them', !publish.includes('sample_words'));
}

const done = fail === 0;
console.log(`${done ? 'PASS' : 'FAIL'}  sample words — ${pass} assertions${done ? ', 0 failures' : ', ' + fail + ' FAILURES'}`);
console.log(`\n════ SAMPLE WORDS: ${done ? '1/1 PASSED' : 'FAILED'} ════`);
if (!done) Deno.exit(1);
