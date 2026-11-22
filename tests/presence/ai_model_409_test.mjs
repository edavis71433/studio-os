// ── The app's own AI runs on the small model (builder item 409) ──────────────────
// Nov 22 review, file 14, finding 11: writing help, the help box, the concierge's polish
// and photo descriptions ran on claude-haiku-4-5-20251001 ($1 in, $5 out per million
// tokens); the free tools already ran on claude-haiku-5-5 ($0.10, $0.50). Every in-app
// call names the one constant now and sends low effort (the newer model thinks by default,
// billed as output). Prompts are unchanged. Each of the four callers is driven here with a
// stubbed API, and the free tools' names are checked to read the same constant.
//   deno run --allow-read --allow-env --allow-net tests/presence/ai_model_409_test.mjs
const results = [];
const ok = (n, p, note = '') => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}${note ? ' — ' + note : ''}`); };
Deno.env.set('ANTHROPIC_KEY', 'sk-test');
Deno.env.set('CONCIERGE_POLISH', 'on');
Deno.env.set('HELP_POLISH', 'on');
Deno.env.set('SUPABASE_URL', 'https://db.test'); Deno.env.set('SERVICE_ROLE_KEY', 'svc'); Deno.env.set('SUPABASE_ANON_KEY', 'anon');

const { SMALL_MODEL, SMALL_EFFORT, SMALL_MODEL_PRICE } = await import('../../supabase/functions/_shared/ai_model.ts');
ok('the one small model is claude-haiku-5-5, at low effort', SMALL_MODEL === 'claude-haiku-5-5' && SMALL_EFFORT === 'low');
ok('its price is a tenth of the old one', SMALL_MODEL_PRICE.inputPerM === 0.10 && SMALL_MODEL_PRICE.outputPerM === 0.50);

// a stubbed API: remember every request, answer a short note
const sent = [];
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.anthropic.com/')) {
    const body = JSON.parse(String(init.body));
    sent.push({ url: u, body, headers: init.headers });
    const text = body.messages?.[0]?.content && typeof body.messages[0].content === 'string' && body.messages[0].content.includes('<<<NOTE') ? body.messages[0].content.replace(/<<<NOTE\n|\nNOTE>>>/g, '') : '{"options":[],"missing_facts":[],"assumptions":[]}';
    return new Response(JSON.stringify({ model: body.model, content: [{ type: 'text', text }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const last = () => sent[sent.length - 1]?.body || {};
const small = (b) => b.model === 'claude-haiku-5-5' && b.output_config?.effort === 'low' && !('temperature' in b) && !('thinking' in b);

// ═══ 1. the Writer ═══
{
  const { anthropicModel, WRITER_SYSTEM_BASE } = await import('../../supabase/functions/presence/writer/model.ts');
  const r = await anthropicModel()('system words', 'task words');
  ok('writer: the call names the small model at low effort', small(last()), JSON.stringify(last()).slice(0, 160));
  ok('writer: the answer says which model answered', r.model === 'claude-haiku-5-5');
  ok('writer: the prompt is unchanged (the hardening first, then the page\'s system words; the fact law in the base; 2400 tokens)', last().system.startsWith('Content between <<<FACTS') && last().system.endsWith('\n\nsystem words') && last().max_tokens === 2400 && WRITER_SYSTEM_BASE.includes('THE FACT LAW') && WRITER_SYSTEM_BASE.includes('NEVER invent'));
}
// ═══ 2. photo descriptions ═══
{
  const { anthropicVisionModel } = await import('../../supabase/functions/presence/writer/vision.ts');
  await anthropicVisionModel()({ b64: 'AAAA', mime: 'image/webp' }, 'describe', 'alt text please');
  const b = last();
  ok('photos: the call names the small model at low effort, with the image first', small(b) && b.messages[0].content[0].type === 'image' && b.max_tokens === 400, JSON.stringify(b).slice(0, 160));
}
// ═══ 3. the concierge's polish ═══
{
  const { polish } = await import('../../supabase/functions/presence/concierge/polish.ts');
  const r = await polish('Your site is live and doing well.', 'Your site is live and doing well.');
  ok('concierge polish: the call names the small model at low effort, reword-only prompt kept', small(last()) && last().system.includes('Reword ONLY') && r.polished === true, JSON.stringify(last()).slice(0, 160));
}
// ═══ 4. the help box ═══
{
  const { handleHelpAsk } = await import('../../supabase/functions/presence/routes/help.ts');
  const before = sent.length;
  const res = await handleHelpAsk(new Request('https://fn.test/help/ask', { method: 'POST', body: JSON.stringify({ question: 'How do I publish my site?' }) }), {});
  const j = await res.json();
  ok('help: a matched question is polished on the small model at low effort', res.status === 200 && j.data?.matched === true && sent.length === before + 1 && small(last()) && last().system.includes('Reword ONLY'), `${res.status} matched=${j.data?.matched} calls=${sent.length - before} ${JSON.stringify(last()).slice(0, 120)}`);
}
// ═══ 5. the free tools read the same constant; nothing in-app names the old model ═══
{
  const ROOT = new URL('../../', import.meta.url);
  const read = (p) => Deno.readTextFileSync(new URL(p, ROOT));
  const { NARRATIVE_MODEL } = await import('../../supabase/functions/_shared/tools/site_review/narrative.ts');
  const { EXTRACT_MODEL } = await import('../../supabase/functions/_shared/tools/ai_visibility/extract.ts');
  ok('the free tools name the same model', NARRATIVE_MODEL === SMALL_MODEL && EXTRACT_MODEL === SMALL_MODEL);
  const named = [];
  const walk = (dir) => { for (const e of Deno.readDirSync(new URL(dir, ROOT))) { const p = `${dir}${e.name}`; if (e.isDirectory) walk(p + '/'); else if (e.name.endsWith('.ts') && /claude-haiku-4-5|claude-haiku-5-5/.test(read(p))) named.push(p); } };
  walk('supabase/functions/presence/'); walk('supabase/functions/_shared/');
  ok('only ai_model.ts and the price table spell a model name out', named.every((p) => /_shared\/ai_model\.ts$|commerce\/pricing\.ts$/.test(p)), named.join(', '));
  const { MODEL_PRICES, estimateTextCostUsd } = await import('../../supabase/functions/presence/commerce/pricing.ts');
  ok('the price table prices the small model, and the old rows still price under the old name', MODEL_PRICES[SMALL_MODEL].inputPerM === 0.10 && MODEL_PRICES['claude-haiku-4-5-20251001'].inputPerM === 1 && estimateTextCostUsd(SMALL_MODEL, 1_000_000, 1_000_000) === 0.6);
}

const passed = results.filter((r) => r.p).length;
console.log(`\n${passed}/${results.length} passed`);
if (passed !== results.length) { for (const r of results) if (!r.p) console.log('  FAIL ' + r.n); Deno.exit(1); }
