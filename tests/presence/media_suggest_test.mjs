// ── AI-proposed alt text + tags + caption (propose-then-approve) ─────────────
//   deno run --allow-read --allow-env --allow-net tests/presence/media_suggest_test.mjs
// Pure: no DB, no network. The model call is MOCKED (injected VisionFn). Asserts
// the deterministic shaping — parse a model reply into {alt,tags,caption}, clamp
// lengths, sanitize hostile output, cap/dedupe tags, reject junk — and the honest
// gating (no ANTHROPIC_KEY → the vision caller is null → the feature is dark).
import {
  parseSuggestion, sanitizeSuggestion, suggestFromImage, bytesToB64,
  SUGGEST_MAX_ALT, SUGGEST_MAX_CAPTION, SUGGEST_MAX_TAGS, SUGGEST_SYSTEM, SUGGEST_USER,
} from '../../supabase/functions/presence/lib/media_suggest.ts';
import { anthropicVisionModel } from '../../supabase/functions/presence/writer/vision.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); if (!p) console.log(`FAIL  ${n}`); };

// ── parse: pull the JSON object out of a model reply ─────────────────────────
{
  const clean = parseSuggestion('{"alt":"A wood-fired pizza on a plate","tags":["pizza","food","dinner"],"caption":"Fresh from the oven"}');
  ok('parses a plain JSON reply', !!clean && clean.alt === 'A wood-fired pizza on a plate');
  ok('parsed tags come through lowercased + trimmed', !!clean && clean.tags.join(',') === 'pizza,food,dinner');
  ok('parsed caption comes through', !!clean && clean.caption === 'Fresh from the oven');

  const fenced = parseSuggestion('```json\n{"alt":"A blue door","tags":["door"],"caption":"x"}\n```');
  ok('parses a fenced ```json block', !!fenced && fenced.alt === 'A blue door');

  const wrapped = parseSuggestion('Sure! Here is the JSON:\n{"alt":"A cat asleep","tags":["cat"],"caption":""}\nHope that helps.');
  ok('parses JSON wrapped in prose', !!wrapped && wrapped.alt === 'A cat asleep');

  ok('non-JSON reply → null', parseSuggestion('I cannot help with that.') === null);
  ok('empty reply → null', parseSuggestion('') === null);
  ok('malformed JSON → null', parseSuggestion('{"alt": ,,}') === null);
}

// ── sanitize: bound + scrub every field (never trust model output) ───────────
{
  const longAlt = 'a'.repeat(400);
  const s = sanitizeSuggestion({ alt: longAlt, tags: [], caption: 'b'.repeat(400) });
  ok('alt is clamped to the max length', !!s && s.alt.length <= SUGGEST_MAX_ALT);
  ok('caption is clamped to the max length', !!s && s.caption.length <= SUGGEST_MAX_CAPTION);

  const htmlish = sanitizeSuggestion({ alt: 'A plate <script>alert(1)</script> of pasta', tags: ['food'], caption: '<b>hi</b>' });
  ok('HTML/markup is stripped from alt', !!htmlish && !/[<>]/.test(htmlish.alt) && !htmlish.alt.includes('script'));
  ok('HTML/markup is stripped from caption', !!htmlish && !/[<>]/.test(htmlish.caption));

  const ctrl = sanitizeSuggestion({ alt: 'A red' + String.fromCharCode(7) + 'barn' + String.fromCharCode(31) + 'at dusk', tags: [], caption: '' });
  ok('control characters are stripped from alt', !!ctrl && !/[\x00-\x1f]/.test(ctrl.alt) && ctrl.alt === 'A red barn at dusk');

  const preamble = sanitizeSuggestion({ alt: 'a photo of a mountain lake', tags: [], caption: '' });
  ok('drops the "a photo of" preamble', !!preamble && preamble.alt === 'A mountain lake');
  const preamble2 = sanitizeSuggestion({ alt: 'Image showing a busy market', tags: [], caption: '' });
  ok('drops the "image showing" preamble', !!preamble2 && preamble2.alt === 'A busy market');

  const dupCap = sanitizeSuggestion({ alt: 'A quiet street', tags: [], caption: 'a quiet street' });
  ok('a caption that just echoes the alt is dropped', !!dupCap && dupCap.caption === '');
}

// ── tags: lowercase, cleaned, deduped, capped ────────────────────────────────
{
  const many = sanitizeSuggestion({ alt: 'A busy kitchen', tags: ['One', 'two', 'THREE', 'four', 'five', 'six', 'seven', 'eight'], caption: '' });
  ok('tag count is capped', !!many && many.tags.length <= SUGGEST_MAX_TAGS);
  ok('tags are lowercased', !!many && many.tags.every((t) => t === t.toLowerCase()));

  const dirty = sanitizeSuggestion({ alt: 'A garden', tags: ['Pasta!!', 'pasta', '  herbs  ', '<i>x</i>', 'a'], caption: '' });
  ok('tag punctuation/markup stripped + deduped', !!dirty && dirty.tags.includes('pasta') && dirty.tags.filter((t) => t === 'pasta').length === 1);
  ok('over-short (1 char) tags are dropped', !!dirty && !dirty.tags.includes('a'));

  const strTags = sanitizeSuggestion({ alt: 'A shop front', tags: 'retail, storefront; signage', caption: '' });
  ok('a comma/semicolon string of tags is accepted', !!strTags && strTags.tags.includes('storefront'));
}

// ── junk rejection: no usable alt → not a suggestion ─────────────────────────
{
  ok('empty alt → null', sanitizeSuggestion({ alt: '', tags: ['x'], caption: 'y' }) === null);
  ok('whitespace/markup-only alt → null', sanitizeSuggestion({ alt: '<br>  ', tags: [], caption: '' }) === null);
  ok('non-object input → null', sanitizeSuggestion(null) === null && sanitizeSuggestion('nope') === null);
}

// ── orchestration: suggestFromImage with a MOCK model (no network) ───────────
{
  const bytes = new Uint8Array([1, 2, 3, 4, 5]);
  let sawImage = null, sawSystem = null, sawUser = null;
  const mockOk = async (image, system, user) => {
    sawImage = image; sawSystem = system; sawUser = user;
    return { ok: true, text: '{"alt":"A latte with leaf art","tags":["coffee","latte","cafe"],"caption":"Morning cup"}', model: 'mock', input_tokens: 500, output_tokens: 40 };
  };
  const r = await suggestFromImage(mockOk, bytes, 'image/webp');
  ok('suggestFromImage returns a clean proposal', r.ok && r.suggestion.alt === 'A latte with leaf art');
  ok('the mock received the base64 image + declared mime', sawImage && sawImage.mime === 'image/webp' && sawImage.b64 === bytesToB64(bytes));
  ok('the tight prompt is passed to the model', sawSystem === SUGGEST_SYSTEM && sawUser === SUGGEST_USER);
  ok('usage tokens are surfaced for metering', r.usage && r.usage.input_tokens === 500 && r.usage.output_tokens === 40);

  const mockFail = async () => ({ ok: false, text: '', model: 'mock', error: 'boom' });
  const rf = await suggestFromImage(mockFail, bytes, 'image/webp');
  ok('a model failure is a plain error result (no throw)', !rf.ok && rf.error === 'boom');

  const mockJunk = async () => ({ ok: true, text: 'no json here', model: 'mock' });
  const rj = await suggestFromImage(mockJunk, bytes, 'image/webp');
  ok('an unparseable reply → error (never a fabricated suggestion)', !rj.ok && rj.error === 'unparseable');

  const rEmpty = await suggestFromImage(mockOk, new Uint8Array(), 'image/webp');
  ok('an empty image is refused before any model call', !rEmpty.ok && rEmpty.error === 'no_image');
}

// ── gating: no ANTHROPIC_KEY → the vision caller is null (honest "unavailable") ─
{
  const hadKey = Deno.env.get('ANTHROPIC_KEY');
  Deno.env.delete('ANTHROPIC_KEY');
  ok('without ANTHROPIC_KEY the vision model is null (feature is dark)', anthropicVisionModel() === null);
  Deno.env.set('ANTHROPIC_KEY', 'test-key-not-used-no-network');
  ok('with a key present a caller function is returned', typeof anthropicVisionModel() === 'function');
  if (hadKey === undefined) Deno.env.delete('ANTHROPIC_KEY'); else Deno.env.set('ANTHROPIC_KEY', hadKey);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n════ MEDIA SUGGEST: ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
