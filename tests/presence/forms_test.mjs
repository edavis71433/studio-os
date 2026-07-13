// ── Custom form builder — pure logic (Phase FB / MVP) ────────────────────────
//   deno run --allow-read tests/presence/forms_test.mjs
// The safety gate (normalizeFormDefinition), the whitelisted rule engine
// (evaluateRules), the runtime gate (validateFormValues), and the XSS-safe
// render (renderForm). All pure — no DB, no network.
import {
  normalizeFormDefinition, evaluateRules, validateFormValues, renderForm,
  FORM_PRESETS, getFormPreset, FORM_FIELD_TYPES,
} from '../../supabase/functions/presence/lib/forms.ts';

const results = [];
const ok = (n, p) => { results.push({ n, p }); console.log(`${p ? 'PASS' : 'FAIL'}  ${n}`); };

// ═══ normalizeFormDefinition — the safety gate ═══
const good = normalizeFormDefinition({
  title: 'Contact', kind: 'contact',
  fields: [{ key: 'name', label: 'Your name', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'email', required: true }],
});
ok('normalize: a well-formed form is accepted, id slugged', good.ok && good.form.id === 'contact' && good.form.fields.length === 2);
ok('normalize: empty field list refused', !normalizeFormDefinition({ title: 'x', fields: [] }).ok && !normalizeFormDefinition({ title: 'x' }).ok);
ok('normalize: capped at 30 fields', !normalizeFormDefinition({ title: 'x', fields: Array.from({ length: 31 }, (_, i) => ({ label: `f${i}`, type: 'text' })) }).ok);
ok('normalize: a labelless field refused', !normalizeFormDefinition({ title: 'x', fields: [{ type: 'text' }] }).ok);
ok('normalize: unknown field type REJECTED (whitelist)', !normalizeFormDefinition({ title: 'x', fields: [{ label: 'Hack', type: 'script' }] }).ok);
ok('normalize: reserved file type rejected (deferred)', !normalizeFormDefinition({ title: 'x', fields: [{ label: 'CV', type: 'file' }] }).ok);
ok('normalize: choice type without choices refused', !normalizeFormDefinition({ title: 'x', fields: [{ label: 'Pick', type: 'select' }] }).ok
  && normalizeFormDefinition({ title: 'x', fields: [{ label: 'Pick', type: 'select', choices: ['a', 'b'] }] }).ok);
const dup = normalizeFormDefinition({ title: 'x', fields: [{ key: 'k', label: 'A', type: 'text' }, { key: 'k', label: 'B', type: 'text' }] });
ok('normalize: duplicate keys de-collided', dup.ok && dup.form.fields[0].key !== dup.form.fields[1].key);
const rd = normalizeFormDefinition({ title: 'x', redirect_url: 'javascript:alert(1)', fields: [{ label: 'A', type: 'text' }] });
ok('normalize: unsafe redirect_url dropped', rd.ok && rd.form.redirect_url === undefined);
const rd2 = normalizeFormDefinition({ title: 'x', redirect_url: 'https://example.com/thanks', fields: [{ label: 'A', type: 'text' }] });
ok('normalize: safe https redirect_url kept', rd2.ok && rd2.form.redirect_url === 'https://example.com/thanks');
const rule = normalizeFormDefinition({
  title: 'x', fields: [{ key: 'reason', label: 'Reason', type: 'select', choices: ['a', 'other'] }, { key: 'detail', label: 'Detail', type: 'text' }],
  rules: [{ when: { field: 'reason', op: 'equals', value: 'other' }, then: { action: 'show', target: 'detail' } },
          { when: { field: 'reason', op: 'equals', value: 'x' }, then: { action: 'evil', target: 'detail' } },     // bad action dropped
          { when: { field: 'ghost', op: 'equals', value: 'y' }, then: { action: 'show', target: 'detail' } }],     // unknown field dropped
});
ok('normalize: only whitelisted rules referencing real keys survive', rule.ok && rule.form.rules.length === 1);
ok('normalize: FORM_FIELD_TYPES has all 11 types', FORM_FIELD_TYPES.length === 11);

// ═══ evaluateRules — pure conditional logic (each op) ═══
const defR = normalizeFormDefinition({
  title: 'x', fields: [
    { key: 'reason', label: 'Reason', type: 'select', choices: ['general', 'other'] },
    { key: 'detail', label: 'Detail', type: 'text' },
    { key: 'urgent', label: 'Urgent', type: 'text', required: true },
    { key: 'count', label: 'Count', type: 'number' },
    { key: 'follow', label: 'Follow', type: 'text' },
  ],
  rules: [
    { when: { field: 'reason', op: 'equals', value: 'other' }, then: { action: 'require', target: 'detail' } },
    { when: { field: 'reason', op: 'notEquals', value: 'other' }, then: { action: 'hide', target: 'detail' } },
    { when: { field: 'detail', op: 'isEmpty' }, then: { action: 'optional', target: 'urgent' } },
    { when: { field: 'count', op: 'gt', value: 5 }, then: { action: 'show', target: 'follow' } },
    { when: { field: 'count', op: 'lt', value: 5 }, then: { action: 'hide', target: 'follow' } },
    { when: { field: 'detail', op: 'contains', value: 'help' }, then: { action: 'require', target: 'follow' } },
  ],
}).form;
const r1 = evaluateRules(defR, { reason: 'other' });
ok('rules: equals → require detail', r1.required.has('detail'));
const r2 = evaluateRules(defR, { reason: 'general' });
ok('rules: notEquals → hide detail', !r2.visible.has('detail'));
ok('rules: isEmpty → make urgent optional', !evaluateRules(defR, { detail: '' }).required.has('urgent'));
ok('rules: notEmpty base-required stays when detail filled', evaluateRules(defR, { detail: 'z', reason: 'other' }).required.has('urgent'));
ok('rules: gt → show follow', evaluateRules(defR, { count: '9' }).visible.has('follow'));
ok('rules: lt → hide follow', !evaluateRules(defR, { count: '2' }).visible.has('follow'));
ok('rules: contains → require follow', evaluateRules(defR, { detail: 'please help', count: '9' }).required.has('follow'));
ok('rules: a hidden field can never be required', (() => { const r = evaluateRules(defR, { count: '1', detail: 'help' }); return !r.visible.has('follow') && !r.required.has('follow'); })());

// ═══ validateFormValues — runtime gate ═══
const cForm = normalizeFormDefinition({
  title: 'Contact', kind: 'contact', fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'topics', label: 'Topics', type: 'checkbox', multiple: true, choices: ['sales', 'support'] },
    { key: 'agree', label: 'I agree', type: 'consent', required: true },
    { key: 'score', label: 'Score', type: 'rating', max: 5 },
  ],
}).form;
ok('validate: missing required name refused', !validateFormValues(cForm, { email: 'a@b.com', agree: 'yes' }).ok);
ok('validate: bad email refused', !validateFormValues(cForm, { name: 'A', email: 'nope', agree: 'yes' }).ok);
ok('validate: missing consent refused', !validateFormValues(cForm, { name: 'A', email: 'a@b.com' }).ok);
const okv = validateFormValues(cForm, { name: 'Ann', email: 'a@b.com', topics: ['sales', 'support'], agree: 'yes', score: '4' });
ok('validate: a complete submission passes + derives contact', okv.ok && okv.sub.email === 'a@b.com' && okv.sub.name === 'Ann');
ok('validate: checkbox stored as joined subset', okv.ok && okv.sub.values.topics === 'sales, support');
ok('validate: rating within scale kept', okv.ok && okv.sub.values.score === '4');
ok('validate: rating out of scale refused', !validateFormValues(cForm, { name: 'A', email: 'a@b.com', agree: 'yes', score: '9' }).ok);
ok('validate: checkbox value outside choices dropped', (() => { const r = validateFormValues(cForm, { name: 'A', email: 'a@b.com', agree: 'yes', topics: ['sales', 'HACK'] }); return r.ok && r.sub.values.topics === 'sales'; })());
ok('validate: no contact at all → need_contact', (() => { const f = normalizeFormDefinition({ title: 'x', fields: [{ key: 'msg', label: 'Msg', type: 'textarea', required: true }] }).form; return validateFormValues(f, { msg: 'hi' }).error === 'need_contact'; })());

// hidden-field server re-check: a value for a rule-hidden field must be ignored.
const hForm = normalizeFormDefinition({
  title: 'x', kind: 'contact', fields: [
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'reason', label: 'Reason', type: 'select', choices: ['general', 'other'] },
    { key: 'secret', label: 'Secret', type: 'text', required: true },
  ],
  rules: [{ when: { field: 'reason', op: 'notEquals', value: 'other' }, then: { action: 'hide', target: 'secret' } }],
}).form;
const hv = validateFormValues(hForm, { email: 'a@b.com', reason: 'general', secret: 'smuggled' });
ok('validate: rule-hidden field value is ignored (not smuggled), and not required', hv.ok && !('secret' in hv.sub.values));
ok('validate: same hidden-required field, when shown, IS enforced', !validateFormValues(hForm, { email: 'a@b.com', reason: 'other' }).ok);

// ═══ renderForm — XSS-safe, labeled, accessible ═══
const xForm = normalizeFormDefinition({
  title: '<script>t</script>', kind: 'contact', fields: [
    { key: 'name', label: '<img src=x onerror=alert(1)>', type: 'text', required: true, help: '"quote" & <b>' },
    { key: 'pick', label: 'Pick', type: 'radio', choices: ['<b>bold</b>', 'ok'] },
  ],
}).form;
const html = renderForm(xForm, { formEndpoint: 'https://api.example.com/forms/x/submit' });
ok('render: raw label markup is escaped', !html.includes('<img src=x') && html.includes('&lt;img src=x'));
ok('render: choice markup is escaped', !html.includes('<b>bold</b>') && html.includes('&lt;b&gt;bold'));
ok('render: labels + required + honeypot present', html.includes('<label') && html.includes('required') && html.includes('name="_hp"') && html.includes('name="form_id"'));
ok('render: action points at the endpoint', html.includes('action="https://api.example.com/forms/x/submit"'));
ok('render: no rules → no inline script', !html.includes('<script'));
const sForm = normalizeFormDefinition({
  title: 'x', fields: [{ key: 'reason', label: 'Reason', type: 'select', choices: ['a', 'other'] }, { key: 'detail', label: 'Detail', type: 'text' }],
  rules: [{ when: { field: 'reason', op: 'equals', value: 'other' }, then: { action: 'show', target: 'detail' } }],
}).form;
const sHtml = renderForm(sForm, { formEndpoint: 'https://x/submit' });
ok('render: rules → a scoped inline enhancer, no external origin', sHtml.includes('<script>') && !/src=/.test(sHtml.split('<script>')[1] || '') && sHtml.includes('presence-form-'));

// ═══ FB-2: multi-step + prefill (presentation-only; server still validates all) ═══
// A single-step form (no steps, or every field on the same step) carries NO `step`
// key and renders byte-identically to a plain form — the byte-stability guarantee.
const single = normalizeFormDefinition({ title: 'x', fields: [{ label: 'A', type: 'text' }, { label: 'B', type: 'text', step: 1 }] }).form;
ok('multistep: a one-step form strips every step key (byte-stable)', single.fields.every((f) => f.step === undefined));
ok('multistep: single-step render has no ff-steps wrapper', !renderForm(single, {}).includes('ff-steps'));

const ms = normalizeFormDefinition({
  title: 'Apply', kind: 'quote', step_titles: ['About you', 'Details'],
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true, step: 1 },
    { key: 'email', label: 'Email', type: 'email', required: true, step: 1 },
    { key: 'why', label: 'Why', type: 'textarea', step: 3 },   // gap (no step 2) → remapped to 2
  ],
}).form;
ok('multistep: gappy steps remapped to contiguous 1..N', ms.fields[0].step === 1 && ms.fields[1].step === 1 && ms.fields[2].step === 2);
ok('multistep: step number capped', normalizeFormDefinition({ title: 'x', fields: [{ label: 'A', type: 'text', step: 1 }, { label: 'B', type: 'text', step: 9999 }] }).form.fields[1].step === 2);
ok('multistep: step_titles kept + trimmed to used steps', Array.isArray(ms.step_titles) && ms.step_titles.length === 2 && ms.step_titles[0] === 'About you');
const msHtml = renderForm(ms, { formEndpoint: 'https://x/submit' });
ok('multistep: render wraps steps + progress enhancer, no external origin', msHtml.includes('ff-steps') && msHtml.includes('data-steps="2"') && msHtml.includes('.ff-steps') && !/<script[^>]*src=/.test(msHtml));
ok('multistep: step titles escaped into the page', msHtml.includes('About you') && msHtml.includes('data-step="1"') && msHtml.includes('data-step="2"'));
// steps are presentation-only: validation must be identical to a flat form.
ok('multistep: server validates ALL fields regardless of step', !validateFormValues(ms, { email: 'a@b.com' }).ok && validateFormValues(ms, { name: 'Ann', email: 'a@b.com' }).ok);

// prefill: an opt-in whitelist; consent can NEVER be prefilled; a hostile value can't inject.
const pf = normalizeFormDefinition({
  title: 'x', fields: [
    { key: 'email', label: 'Email', type: 'email', prefill: true },
    { key: 'msg', label: 'Msg', type: 'textarea', required: true },
    { key: 'agree', label: 'Agree', type: 'consent', required: true, prefill: true },
  ],
}).form;
ok('prefill: opt-in flag kept on a normal field', pf.fields[0].prefill === true);
ok('prefill: consent is never prefillable (dropped)', pf.fields[2].prefill === undefined);
const pfHtml = renderForm(pf, { formEndpoint: 'https://x/submit' });
ok('prefill: emits a scoped first-party enhancer naming only whitelisted keys', pfHtml.includes('URLSearchParams') && pfHtml.includes('var K=["email"]'));
ok('prefill: sets values via DOM property, never innerHTML', !/innerHTML/.test(pfHtml) && !/<script[^>]*src=/.test(pfHtml));
ok('prefill: no prefill fields → no prefill script', !renderForm(single, {}).includes('URLSearchParams'));

// ═══ presets ═══
ok('presets: four starters, each normalizes cleanly', FORM_PRESETS.length === 4 && FORM_PRESETS.every((p) => normalizeFormDefinition(p.def).ok));
ok('presets: getFormPreset finds by key', getFormPreset('booking')?.name === 'Booking intake' && !getFormPreset('nope'));

const passed = results.filter((r) => r.p).length;
console.log(`\n════ FORMS (Phase FB pure): ${passed}/${results.length} ${passed === results.length ? 'PASSED' : 'FAILED'} ════`);
if (passed !== results.length) Deno.exit(1);
