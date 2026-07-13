// ── Custom form builder — typed, structured, safe (Phase FB / MVP) ───────────
// THE MOAT: an owner builds any form (contact / quote / application / booking-
// intake) out of TYPED, WHITELISTED fields — never a code box. Every form this
// module can produce renders responsive + accessible + XSS-safe AUTOMATICALLY,
// and its conditional logic is a WHITELISTED DECLARATIVE rule model evaluated by
// a pure function (no expressions, no eval, no scripting). That is the whole
// difference from a custom-code trapdoor.
//
// Reuse-first: this GENERALIZES the survey `Question` spine (lib/intake.ts) —
// same normalization style (cap, slug unique keys, per-type validation) — and
// reuses the escape/safe-href helpers (lib/markdown.ts) that the render pipeline
// already trusts. Form definitions are stored as JSON on the site (inside the
// existing `presence_settings.blocks` array, as blocks of type 'form'), exactly
// like structured content blocks — NO new table, NO new pipeline.
//
// Pure: no I/O, no clock, no randomness. The runtime (routes/commercial.ts) adds
// honeypot + rate-limit + IP-hash + spam on top; submissions still land in
// presence_form_submissions and flow to the leads inbox + CRM + follow-up nudge.
//
// DEFERRED (reserved, NOT half-built): `file` upload (public upload needs a
// dedicated safe path), multi-step forms, prefill, and a PDF-of-record. The
// `file` type name is reserved below so a later phase can add it without a
// schema shift; it is intentionally rejected today.

import { esc, attr, safeHref } from './markdown.ts';

// ── field types ──────────────────────────────────────────────────────────────
export type FormFieldType =
  | 'text' | 'textarea' | 'email' | 'phone' | 'number'
  | 'select' | 'radio' | 'checkbox' | 'date' | 'consent' | 'rating';
export const FORM_FIELD_TYPES: readonly FormFieldType[] = [
  'text', 'textarea', 'email', 'phone', 'number',
  'select', 'radio', 'checkbox', 'date', 'consent', 'rating',
];
// Reserved for a future dedicated safe-upload path — NOT accepted today.
export const RESERVED_FIELD_TYPES: readonly string[] = ['file'];
const CHOICE_TYPES: readonly FormFieldType[] = ['select', 'radio', 'checkbox'];

export interface FormField {
  key: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  choices?: string[];          // select / radio / checkbox
  min?: number | string;       // number (numeric) · date (YYYY-MM-DD) · rating (scale floor)
  max?: number | string;       // number (numeric) · date (YYYY-MM-DD) · rating (scale ceiling)
  multiple?: boolean;          // checkbox — allow more than one choice
  help?: string;
  placeholder?: string;
  // Multi-step (Phase FB-2): the page/step this field belongs to. Presentation-only
  // grouping — the server validates ALL visible fields regardless of step, so steps
  // add no validation surface. Present ONLY on a genuinely multi-step form (a single-
  // step form carries no `step` key, so its render stays byte-identical).
  step?: number;
  // Prefill (Phase FB-2): this field MAY be filled from a matching URL query param
  // (?<key>=…). A WHITELIST — only fields the owner opted in can ever be prefilled,
  // and the value is written via the DOM `.value`/`.checked` property (never HTML),
  // so a hostile query string can't inject markup.
  prefill?: boolean;
}

// ── whitelisted declarative rules (no expressions, no eval) ──────────────────
export type RuleOp = 'equals' | 'notEquals' | 'isEmpty' | 'notEmpty' | 'contains' | 'gt' | 'lt';
export const RULE_OPS: readonly RuleOp[] = ['equals', 'notEquals', 'isEmpty', 'notEmpty', 'contains', 'gt', 'lt'];
export type RuleActionKind = 'show' | 'hide' | 'require' | 'optional';
export const RULE_ACTIONS: readonly RuleActionKind[] = ['show', 'hide', 'require', 'optional'];
export interface RuleCondition { field: string; op: RuleOp; value?: string | number }
export interface RuleAction { action: RuleActionKind; target: string }
export interface FieldRule { when: RuleCondition; then: RuleAction }

// ── form-level ────────────────────────────────────────────────────────────────
export type FormKind = 'contact' | 'quote' | 'booking';   // maps to presence_form_submissions.form_kind
export interface FormDefinition {
  type: 'form';
  id: string;
  title: string;
  kind: FormKind;
  fields: FormField[];
  rules: FieldRule[];
  confirmation_text?: string;
  redirect_url?: string;
  submit_label?: string;
  step_titles?: string[];      // optional per-step heading (index 0 = step 1) — multi-step only
}

// ── caps (bounded, never unbounded) ──────────────────────────────────────────
const MAX_FIELDS = 30;
const MAX_RULES = 40;
const MAX_CHOICES = 30;
const MAX_STEPS = 12;
const CAP = { title: 120, label: 200, help: 300, placeholder: 100, choice: 120, confirm: 500, submit: 40, id: 40 };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const s = (x: unknown, n: number): string => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const slug = (x: unknown, n: number): string =>
  String(x ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, n);
const arr = (x: unknown): any[] => (Array.isArray(x) ? x : []);
const numOrUndef = (x: unknown): number | undefined => { const n = Number(x); return Number.isFinite(n) ? n : undefined; };

// ═════════ normalizeFormDefinition — THE SAFETY GATE ═════════
// Clones the normalizeQuestions pattern: caps field count, slugs unique keys,
// validates per type. Choice types need choices; an unknown type is REJECTED
// (whitelist enforcement — an owner can only ever produce whitelisted fields).
// Returns a fully-normalized, render-ready definition or a plain-language error.
export function normalizeFormDefinition(raw: unknown):
  { ok: true; form: FormDefinition } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'A form needs at least one field.' };
  const r = raw as any;

  const title = s(r.title, CAP.title) || 'Contact form';
  const kind: FormKind = (r.kind === 'quote' || r.kind === 'booking') ? r.kind : 'contact';
  let id = slug(r.id, CAP.id) || slug(title, CAP.id) || 'form';

  const rawFields = arr(r.fields);
  if (rawFields.length === 0) return { ok: false, error: 'A form needs at least one field.' };
  if (rawFields.length > MAX_FIELDS) return { ok: false, error: `A form can have at most ${MAX_FIELDS} fields.` };

  const fields: FormField[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawFields.length; i++) {
    const f = rawFields[i] || {};
    const label = s(f.label, CAP.label);
    if (!label) return { ok: false, error: `Field ${i + 1} needs a label.` };

    // whitelist: an explicit type MUST be one we know — never fall through to code.
    const rawType = f.type == null ? 'text' : String(f.type);
    if (!(FORM_FIELD_TYPES as readonly string[]).includes(rawType)) {
      return { ok: false, error: RESERVED_FIELD_TYPES.includes(rawType)
        ? `The “${rawType}” field type isn’t available yet.`
        : `“${rawType}” isn’t a field type you can add.` };
    }
    const type = rawType as FormFieldType;

    let key = slug(f.key, CAP.id) || slug(label, CAP.id) || `field_${i + 1}`;
    while (seen.has(key)) key = `${key}_${i}`;
    seen.add(key);

    const field: FormField = { key, label, type };
    if (f.required) field.required = true;
    const help = s(f.help, CAP.help); if (help) field.help = help;
    const placeholder = s(f.placeholder, CAP.placeholder); if (placeholder) field.placeholder = placeholder;
    // FB-2 multi-step: an integer step ≥ 1 (capped). Non-numeric/absent → step 1.
    const st = numOrUndef(f.step);
    if (st !== undefined && st >= 1) field.step = Math.min(MAX_STEPS, Math.trunc(st));
    // FB-2 prefill: opt-in whitelist (consent is never prefillable — a checkbox that
    // legally records agreement must be a deliberate act, never pre-ticked by a link).
    if (f.prefill && type !== 'consent') field.prefill = true;

    if (CHOICE_TYPES.includes(type)) {
      const choices = arr(f.choices).map((c) => s(c, CAP.choice)).filter(Boolean).slice(0, MAX_CHOICES);
      if (!choices.length) return { ok: false, error: `“${label}” needs at least one choice.` };
      field.choices = choices;
      if (type === 'checkbox' && f.multiple) field.multiple = true;
    } else if (type === 'number') {
      const mn = numOrUndef(f.min); if (mn !== undefined) field.min = mn;
      const mx = numOrUndef(f.max); if (mx !== undefined) field.max = mx;
    } else if (type === 'date') {
      const mn = s(f.min, 10); if (ISO_DATE_RE.test(mn)) field.min = mn;
      const mx = s(f.max, 10); if (ISO_DATE_RE.test(mx)) field.max = mx;
    } else if (type === 'rating') {
      const mx = numOrUndef(f.max); field.max = (mx && mx >= 2 && mx <= 10) ? Math.trunc(mx) : 5;
    }
    fields.push(field);
  }
  if (seen.size === 0) return { ok: false, error: 'A form needs at least one field.' };

  // FB-2 multi-step normalization: remap the step numbers ACTUALLY used to a
  // contiguous 1..N (so "Step X of N" is always honest and a gap never leaves an
  // empty page). A form that ends up with a single step carries NO `step` key on
  // any field — its render then stays byte-identical to a plain form.
  const usedSteps = [...new Set(fields.map((f) => f.step ?? 1))].sort((a, b) => a - b);
  const multiStep = usedSteps.length > 1;
  if (multiStep) {
    const remap = new Map(usedSteps.map((v, i) => [v, i + 1]));
    for (const f of fields) f.step = remap.get(f.step ?? 1)!;
  } else {
    for (const f of fields) delete f.step;
  }

  // rules: keep only whitelisted ops/actions that reference real sibling keys.
  const rules: FieldRule[] = [];
  for (const rr of arr(r.rules).slice(0, MAX_RULES)) {
    const wf = slug(rr?.when?.field, CAP.id);
    const op = String(rr?.when?.op || '');
    const action = String(rr?.then?.action || '');
    const target = slug(rr?.then?.target, CAP.id);
    if (!seen.has(wf) || !seen.has(target)) continue;
    if (!(RULE_OPS as readonly string[]).includes(op)) continue;
    if (!(RULE_ACTIONS as readonly string[]).includes(action)) continue;
    const when: RuleCondition = { field: wf, op: op as RuleOp };
    if (op !== 'isEmpty' && op !== 'notEmpty') when.value = s(rr?.when?.value, 200);
    rules.push({ when, then: { action: action as RuleActionKind, target } });
  }

  const form: FormDefinition = { type: 'form', id, title, kind, fields, rules };
  // FB-2 per-step headings — only meaningful (and only kept) on a multi-step form.
  if (multiStep) {
    const titles = arr(r.step_titles).slice(0, usedSteps.length).map((t) => s(t, CAP.label));
    if (titles.some(Boolean)) form.step_titles = titles;
  }
  const confirm = s(r.confirmation_text, CAP.confirm); if (confirm) form.confirmation_text = confirm;
  const submit = s(r.submit_label, CAP.submit); if (submit) form.submit_label = submit;
  const redirect = safeHref(String(r.redirect_url ?? '')); if (redirect) form.redirect_url = redirect;   // https/mailto/tel only
  return { ok: true, form };
}

// ═════════ evaluateRules — the PURE conditional-logic engine ═════════
// References ONLY sibling field values (a declarative when → then). No formula
// strings, no eval. Returns which fields are visible + which are required AFTER
// the rules apply. The runtime re-runs this server-side so hidden-field values
// can never be smuggled in, and the inline enhancer runs the SAME algorithm.
export type FormValues = Record<string, string | string[] | boolean | number | null | undefined>;

function asText(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(',');
  if (v === true) return 'true'; if (v === false || v == null) return '';
  return String(v);
}
function isEmptyVal(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  if (v === false || v == null) return true;
  return String(v).trim() === '';
}
function conditionHolds(cond: RuleCondition, values: FormValues): boolean {
  const raw = values[cond.field];
  const target = cond.value == null ? '' : String(cond.value);
  switch (cond.op) {
    case 'isEmpty': return isEmptyVal(raw);
    case 'notEmpty': return !isEmptyVal(raw);
    case 'equals': return asText(raw) === target || (Array.isArray(raw) && raw.map(String).includes(target));
    case 'notEquals': return !(asText(raw) === target || (Array.isArray(raw) && raw.map(String).includes(target)));
    case 'contains':
      return Array.isArray(raw) ? raw.map(String).includes(target) : asText(raw).toLowerCase().includes(target.toLowerCase());
    case 'gt': { const a = Number(asText(raw)), b = Number(target); return Number.isFinite(a) && Number.isFinite(b) && a > b; }
    case 'lt': { const a = Number(asText(raw)), b = Number(target); return Number.isFinite(a) && Number.isFinite(b) && a < b; }
    default: return false;
  }
}

export function evaluateRules(def: { fields: FormField[]; rules?: FieldRule[] }, values: FormValues):
  { visible: Set<string>; required: Set<string> } {
  const keys = def.fields.map((f) => f.key);
  const visible = new Set<string>(keys);
  const required = new Set<string>(def.fields.filter((f) => f.required).map((f) => f.key));
  for (const rule of def.rules || []) {
    if (!conditionHolds(rule.when, values)) continue;
    const t = rule.then.target;
    switch (rule.then.action) {
      case 'show': visible.add(t); break;
      case 'hide': visible.delete(t); break;
      case 'require': required.add(t); break;
      case 'optional': required.delete(t); break;
    }
  }
  // a field the rules hid can't also be required
  for (const k of [...required]) if (!visible.has(k)) required.delete(k);
  return { visible, required };
}

// ═════════ validateFormValues — the runtime gate for a submission ═════════
// Per-field required/type validation DRIVEN BY THE DEFINITION. Re-runs
// evaluateRules so hidden fields are ignored (not smuggled) and only rule-
// required fields are enforced. Honeypot/rate-limit/IP-hash/spam stay in the
// route. Returns cleaned string answers (the submissions `fields` bag) plus the
// derived contact bits so the lead still reaches the inbox + CRM.
export interface CleanFormSubmission {
  values: Record<string, string>;
  name: string; email: string; phone: string; message: string;
}
export function validateFormValues(def: FormDefinition, raw: FormValues):
  { ok: true; sub: CleanFormSubmission } | { ok: false; error: string; field?: string } {
  const byKey = new Map(def.fields.map((f) => [f.key, f]));
  const { visible, required } = evaluateRules(def, raw);
  const out: Record<string, string> = {};

  for (const field of def.fields) {
    if (!visible.has(field.key)) continue;             // hidden → ignore any value entirely
    const rawVal = raw[field.key];
    const req = required.has(field.key);

    if (field.type === 'checkbox') {
      const picked = (Array.isArray(rawVal) ? rawVal : (rawVal == null || rawVal === '' ? [] : [rawVal])).map((x) => String(x));
      const allowed = new Set(field.choices || []);
      const chosen = picked.filter((p) => allowed.has(p));
      if (req && chosen.length === 0) return { ok: false, error: `Please choose ${field.label}.`, field: field.key };
      if (chosen.length) out[field.key] = chosen.join(', ');
      continue;
    }
    if (field.type === 'consent') {
      const on = rawVal === true || ['on', 'yes', 'true', '1', 'checked'].includes(String(rawVal ?? '').toLowerCase());
      if (req && !on) return { ok: false, error: `Please confirm: ${field.label}.`, field: field.key };
      if (on) out[field.key] = 'Yes';
      continue;
    }

    const val = String(rawVal ?? '').trim();
    if (!val) {
      if (req) return { ok: false, error: `${field.label} is required.`, field: field.key };
      continue;
    }
    switch (field.type) {
      case 'email':
        if (!EMAIL_RE.test(val)) return { ok: false, error: `That email doesn’t look right.`, field: field.key };
        out[field.key] = val.slice(0, 200); break;
      case 'phone':
        if (!/\d/.test(val)) return { ok: false, error: `That phone number doesn’t look right.`, field: field.key };
        out[field.key] = val.slice(0, 40); break;
      case 'number': {
        const n = Number(val);
        if (!Number.isFinite(n)) return { ok: false, error: `${field.label} must be a number.`, field: field.key };
        if (typeof field.min === 'number' && n < field.min) return { ok: false, error: `${field.label} must be at least ${field.min}.`, field: field.key };
        if (typeof field.max === 'number' && n > field.max) return { ok: false, error: `${field.label} must be at most ${field.max}.`, field: field.key };
        out[field.key] = String(n); break;
      }
      case 'date':
        if (!ISO_DATE_RE.test(val)) return { ok: false, error: `Please pick a valid date for ${field.label}.`, field: field.key };
        if (typeof field.min === 'string' && val < field.min) return { ok: false, error: `${field.label} is too early.`, field: field.key };
        if (typeof field.max === 'string' && val > field.max) return { ok: false, error: `${field.label} is too late.`, field: field.key };
        out[field.key] = val; break;
      case 'select': case 'radio':
        if (!(field.choices || []).includes(val)) return { ok: false, error: `Please choose a valid option for ${field.label}.`, field: field.key };
        out[field.key] = val; break;
      case 'rating': {
        const n = Math.trunc(Number(val));
        const scale = typeof field.max === 'number' ? field.max : 5;
        if (!Number.isFinite(n) || n < 1 || n > scale) return { ok: false, error: `Please rate ${field.label}.`, field: field.key };
        out[field.key] = String(n); break;
      }
      case 'textarea': out[field.key] = val.slice(0, 4000); break;
      default: out[field.key] = val.slice(0, 500); break;    // text
    }
    if (!byKey.has(field.key)) continue;
  }

  // derive contact/message so the lead still reaches the inbox + CRM unchanged.
  const firstOf = (types: FormFieldType[]) => def.fields.find((f) => types.includes(f.type) && visible.has(f.key) && out[f.key]);
  const emailF = firstOf(['email']); const phoneF = firstOf(['phone']);
  const nameF = def.fields.find((f) => f.type === 'text' && /name/i.test(f.key + f.label) && out[f.key])
    || def.fields.find((f) => f.type === 'text' && visible.has(f.key) && out[f.key]);
  const msgF = firstOf(['textarea']);
  const email = emailF ? out[emailF.key] : '';
  const phone = phoneF ? out[phoneF.key] : '';
  const name = nameF ? out[nameF.key] : '';
  // a human-readable message: the long-text answer, else a compact digest of all answers.
  const message = (msgF ? out[msgF.key] : '') ||
    def.fields.filter((f) => visible.has(f.key) && out[f.key] && f.type !== 'consent')
      .map((f) => `${f.label}: ${out[f.key]}`).join('\n');

  if (!email && !phone) return { ok: false, error: 'need_contact', field: emailF?.key || phoneF?.key };
  if (Object.keys(out).length === 0) return { ok: false, error: 'empty' };
  return { ok: true, sub: { values: out, name, email, phone, message } };
}

// ═════════ renderForm — typed fields → accessible, responsive, safe HTML ═════════
// Every label/help/choice is escaped through the same helpers the render
// pipeline trusts. Controls are LABELED, required-aware (`required`+aria), and
// grouped (fieldset/legend for radio/checkbox). Conditional logic DEGRADES
// GRACEFULLY: all fields render server-side; a MINIMAL first-party inline script
// (consistent with the injected analytics beacon posture — same 'unsafe-inline'
// CSP, zero external origins) applies show/hide/require. With JS off every field
// is visible and the server validates. No external origins, ever.
export interface FormRenderCtx { esc: (s: string) => string; attr: (s: string) => string; safeHref: (s: string) => string | null; formEndpoint?: string; sourcePage?: string }

// Self-contained, scoped styles emitted WITH the form (so the shared template
// stylesheet — and every golden — stays byte-stable when no form is present).
// Reuses the template's form.card input styling; adds only group/help/consent
// niceties. Zero external assets.
const FORM_CSS = `<style>.presence-form{max-width:560px}.presence-form .ff{margin:0}.presence-form .ff[hidden]{display:none}.presence-form .ff-req{color:#b42318}.presence-form .ff-help{display:block;font-size:.85rem;color:var(--soft,#666);margin-top:4px}.presence-form fieldset.ff-group{border:1px solid var(--line,#ddd);border-radius:9px;padding:12px 14px;margin-bottom:14px}.presence-form .ff-group legend{font-weight:600;font-size:.94rem;padding:0 6px}.presence-form .ff-opt{display:flex;align-items:center;gap:8px;font-weight:400;margin-top:6px}.presence-form .ff-opt input{width:auto;margin:0}.presence-form .ff-rating .ff-opt{display:inline-flex;margin-right:14px}.presence-form .ff-consent label{display:flex;align-items:flex-start;gap:8px;font-weight:400}.presence-form .ff-consent input{width:auto;margin-top:4px}.presence-form .hp{position:absolute;left:-9999px;height:1px;overflow:hidden}.presence-form .ff-step[hidden]{display:none}.presence-form .ff-step-title{font-weight:600;font-size:1.02rem;margin:0 0 10px}.presence-form .ff-progress{font-size:.85rem;color:var(--soft,#666);font-weight:600;margin:0 0 8px}.presence-form .ff-bar{display:block;height:5px;border-radius:999px;background:var(--line,#e5e5e5);overflow:hidden;margin:0 0 16px}.presence-form .ff-bar-in{display:block;height:100%;width:0;background:var(--accent,#5b3fa0);transition:width .2s ease}.presence-form .ff-nav{display:flex;gap:10px;margin-top:2px}</style>`;

export function renderForm(def: FormDefinition, ctx?: FormRenderCtx): string {
  const E = ctx?.esc || esc; const A = ctx?.attr || attr;
  const dom = `presence-form-${def.id}`;
  const fid = (k: string) => `f-${def.id}-${k}`;

  const fieldHtml = (f: FormField): string => {
    const id = fid(f.key);
    const reqAttr = f.required ? ' required aria-required="true"' : '';
    const reqMark = f.required ? ` <span class="ff-req" aria-hidden="true">*</span>` : '';
    const helpId = f.help ? `${id}-help` : '';
    const describe = f.help ? ` aria-describedby="${A(helpId)}"` : '';
    const help = f.help ? `<span class="ff-help" id="${A(helpId)}">${E(f.help)}</span>` : '';
    const ph = f.placeholder ? ` placeholder="${A(f.placeholder)}"` : '';
    const labelTop = `<label for="${A(id)}">${E(f.label)}${reqMark}</label>`;
    let control = '';

    switch (f.type) {
      case 'textarea':
        control = `${labelTop}<textarea id="${A(id)}" name="${A(f.key)}" rows="5" maxlength="4000"${reqAttr}${describe}${ph}></textarea>`;
        break;
      case 'select':
        control = `${labelTop}<select id="${A(id)}" name="${A(f.key)}"${reqAttr}${describe}>` +
          `<option value="">Choose…</option>` +
          (f.choices || []).map((c) => `<option value="${A(c)}">${E(c)}</option>`).join('') + `</select>`;
        break;
      case 'radio':
        return `<fieldset class="ff ff-group" data-field="${A(f.key)}">` +
          `<legend>${E(f.label)}${reqMark}</legend>${help}` +
          (f.choices || []).map((c, i) => `<label class="ff-opt"><input type="radio" name="${A(f.key)}" value="${A(c)}"${i === 0 ? reqAttr : ''}> ${E(c)}</label>`).join('') +
          `</fieldset>`;
      case 'checkbox':
        return `<fieldset class="ff ff-group" data-field="${A(f.key)}">` +
          `<legend>${E(f.label)}${reqMark}</legend>${help}` +
          (f.choices || []).map((c) => `<label class="ff-opt"><input type="checkbox" name="${A(f.key)}" value="${A(c)}"> ${E(c)}</label>`).join('') +
          `</fieldset>`;
      case 'consent':
        return `<div class="ff ff-consent" data-field="${A(f.key)}">` +
          `<label><input type="checkbox" id="${A(id)}" name="${A(f.key)}" value="yes"${reqAttr}${describe}> ${E(f.label)}${reqMark}</label>${help}</div>`;
      case 'rating': {
        const scale = typeof f.max === 'number' ? f.max : 5;
        const opts = Array.from({ length: scale }, (_, i) => i + 1).map((n, i) =>
          `<label class="ff-opt ff-star"><input type="radio" name="${A(f.key)}" value="${n}"${i === 0 ? reqAttr : ''}> ${n}</label>`).join('');
        return `<fieldset class="ff ff-group ff-rating" data-field="${A(f.key)}"><legend>${E(f.label)}${reqMark}</legend>${help}${opts}</fieldset>`;
      }
      case 'email':
        control = `${labelTop}<input type="email" id="${A(id)}" name="${A(f.key)}" maxlength="200" autocomplete="email"${reqAttr}${describe}${ph}>`;
        break;
      case 'phone':
        control = `${labelTop}<input type="tel" id="${A(id)}" name="${A(f.key)}" maxlength="40" autocomplete="tel"${reqAttr}${describe}${ph}>`;
        break;
      case 'number': {
        const mn = typeof f.min === 'number' ? ` min="${f.min}"` : '';
        const mx = typeof f.max === 'number' ? ` max="${f.max}"` : '';
        control = `${labelTop}<input type="number" id="${A(id)}" name="${A(f.key)}"${mn}${mx}${reqAttr}${describe}${ph}>`;
        break;
      }
      case 'date': {
        const mn = typeof f.min === 'string' ? ` min="${A(f.min)}"` : '';
        const mx = typeof f.max === 'string' ? ` max="${A(f.max)}"` : '';
        control = `${labelTop}<input type="date" id="${A(id)}" name="${A(f.key)}"${mn}${mx}${reqAttr}${describe}>`;
        break;
      }
      default:   // text
        control = `${labelTop}<input type="text" id="${A(id)}" name="${A(f.key)}" maxlength="500"${reqAttr}${describe}${ph}>`;
    }
    return `<div class="ff" data-field="${A(f.key)}"><p>${control}${help}</p></div>`;
  };

  // FB-2 multi-step: the distinct step numbers, in order. Multi-step ONLY when the
  // definition genuinely carries >1 step (normalize strips the key otherwise), so a
  // plain form renders byte-identically (no ff-steps wrapper, no step enhancer).
  const stepNums = [...new Set(def.fields.map((f) => f.step).filter((n): n is number => typeof n === 'number'))].sort((a, b) => a - b);
  const multi = stepNums.length > 1;

  let fieldsHtml: string;
  if (multi) {
    const groups = stepNums.map((n) => {
      const inner = def.fields.filter((f) => (f.step ?? 1) === n).map(fieldHtml).join('');
      const t = def.step_titles?.[n - 1];
      const title = t ? `<p class="ff-step-title">${E(t)}</p>` : '';
      return `<div class="ff-step" data-step="${n}">${title}${inner}</div>`;
    }).join('');
    fieldsHtml = `<div class="ff-steps" data-steps="${stepNums.length}">${groups}</div>`;
  } else {
    fieldsHtml = def.fields.map(fieldHtml).join('');
  }

  const action = ctx?.formEndpoint ? ` action="${A(ctx.formEndpoint)}"` : '';
  const submit = E(def.submit_label || 'Send');
  const body =
    FORM_CSS +
    `<form id="${A(dom)}" class="card presence-form" method="post"${action} novalidate>` +
    `<input type="hidden" name="form_id" value="${A(def.id)}">` +
    `<input type="hidden" name="form_kind" value="${A(def.kind)}">` +
    `<input type="hidden" name="source_page" value="${A(ctx?.sourcePage || '/')}">` +
    `<p class="hp" aria-hidden="true"><label for="${A(dom)}-hp">Leave this field empty</label>` +
    `<input id="${A(dom)}-hp" name="_hp" tabindex="-1" autocomplete="off"></p>` +
    fieldsHtml +
    `<p style="font-size:.85rem;color:var(--soft)">Please don’t include sensitive personal, financial, or medical information.</p>` +
    `<button class="btn" type="submit">${submit}</button></form>`;

  const prefillKeys = def.fields.filter((f) => f.prefill).map((f) => f.key);
  return body + ruleScript(def, dom) + stepScript(dom, multi) + prefillScript(dom, prefillKeys);
}

/** FB-2 multi-step enhancer: PROGRESSIVE — the static HTML shows every step (so with
 *  JS off the whole form is a single scrollable page the server still validates). This
 *  scoped, first-party inline script (same zero-external-origin posture as the rule
 *  enhancer) reveals one step at a time, adds a progress bar + Back/Next, validates the
 *  current step before advancing, and hides the submit until the last step. */
function stepScript(dom: string, multi: boolean): string {
  if (!multi) return '';
  const js =
    `(function(){var F=document.getElementById(${JSON.stringify(dom)});if(!F)return;` +
    `var W=F.querySelector('.ff-steps');if(!W)return;` +
    `var steps=[].slice.call(W.querySelectorAll('.ff-step'));var total=steps.length;if(total<2)return;` +
    `var submit=F.querySelector('button[type=submit]');var cur=0;` +
    `var prog=document.createElement('p');prog.className='ff-progress';prog.setAttribute('aria-live','polite');` +
    `var bar=document.createElement('span');bar.className='ff-bar';bar.setAttribute('aria-hidden','true');` +
    `var barIn=document.createElement('span');barIn.className='ff-bar-in';bar.appendChild(barIn);` +
    `var nav=document.createElement('div');nav.className='ff-nav';` +
    `var back=document.createElement('button');back.type='button';back.className='btn btn-outline';back.textContent='Back';` +
    `var next=document.createElement('button');next.type='button';next.className='btn';next.textContent='Next';` +
    `nav.appendChild(back);nav.appendChild(next);` +
    `W.parentNode.insertBefore(prog,W);W.parentNode.insertBefore(bar,W);W.parentNode.insertBefore(nav,W.nextSibling);` +
    `function valid(i){var el=steps[i].querySelectorAll('input,select,textarea');for(var j=0;j<el.length;j++){var e=el[j];var w=e.closest?e.closest('[data-field]'):null;if(w&&w.hidden)continue;if(e.disabled)continue;if(e.checkValidity&&!e.checkValidity()){if(e.reportValidity)e.reportValidity();return false;}}return true;}` +
    `function show(i,f){cur=Math.max(0,Math.min(total-1,i));for(var k=0;k<total;k++)steps[k].hidden=(k!==cur);` +
    `back.style.display=cur===0?'none':'';var last=cur===total-1;next.style.display=last?'none':'';if(submit)submit.style.display=last?'':'none';` +
    `prog.textContent='Step '+(cur+1)+' of '+total;barIn.style.width=Math.round(((cur+1)/total)*100)+'%';` +
    `if(f){var g=steps[cur].querySelector('input,select,textarea');if(g&&g.focus){try{g.focus();}catch(_){}}}}` +
    `back.addEventListener('click',function(){show(cur-1,true);});` +
    `next.addEventListener('click',function(){if(valid(cur))show(cur+1,true);});` +
    `show(0,false);})();`;
  return `<script>${js.replace(/</g, '\\u003c')}</script>`;
}

/** FB-2 prefill enhancer: fills WHITELISTED fields from a matching URL query param
 *  (?<key>=…). Values are written via the DOM `.value`/`.checked` property — never
 *  HTML — so a hostile query string can only ever set a plain value, never inject
 *  markup. Scoped to this form; zero external origins; a no-op with no prefill fields. */
function prefillScript(dom: string, keys: string[]): string {
  if (!keys.length) return '';
  const js =
    `(function(){var F=document.getElementById(${JSON.stringify(dom)});if(!F)return;` +
    `var K=${JSON.stringify(keys)};var q;try{q=new URLSearchParams(location.search);}catch(_){return;}` +
    `for(var i=0;i<K.length;i++){var k=K[i];if(!q.has(k))continue;var v=(q.get(k)||'').slice(0,500);` +
    `var el=F.querySelectorAll('[name=\"'+k+'\"]');` +
    `for(var j=0;j<el.length;j++){var e=el[j];` +
    `if(e.type==='checkbox'||e.type==='radio'){if(e.value===v)e.checked=true;}` +
    `else if(e.tagName==='SELECT'){for(var o=0;o<e.options.length;o++){if(e.options[o].value===v){e.selectedIndex=o;break;}}}` +
    `else{e.value=v;}}}})();`;
  return `<script>${js.replace(/</g, '\\u003c')}</script>`;
}

/** The minimal inline enhancer: applies the SAME whitelisted rules client-side.
 *  Zero external origins; scoped to this form; a no-op when there are no rules. */
function ruleScript(def: FormDefinition, dom: string): string {
  if (!def.rules || def.rules.length === 0) return '';
  const rules = JSON.stringify(def.rules);
  const baseReq = JSON.stringify(def.fields.filter((f) => f.required).map((f) => f.key));
  const js =
    `(function(){var F=document.getElementById(${JSON.stringify(dom)});if(!F)return;` +
    `var R=${rules},BR=${baseReq};` +
    `function gv(k){var e=F.querySelectorAll('[name=\"'+k+'\"]');if(!e.length)return '';` +
    `if(e[0].type==='checkbox'){var a=[];for(var i=0;i<e.length;i++)if(e[i].checked)a.push(e[i].value);return e.length>1?a:(a.length?a[0]:'');}` +
    `if(e[0].type==='radio'){for(var j=0;j<e.length;j++)if(e[j].checked)return e[j].value;return '';}return e[0].value;}` +
    `function T(v){return Array.isArray(v)?v.map(String).join(','):(v==null?'':String(v));}` +
    `function empt(v){return Array.isArray(v)?v.length===0:(v==null||String(v).trim()==='');}` +
    `function hold(c){var v=gv(c.field),t=c.value==null?'':String(c.value);` +
    `switch(c.op){case 'isEmpty':return empt(v);case 'notEmpty':return !empt(v);` +
    `case 'equals':return T(v)===t||(Array.isArray(v)&&v.map(String).indexOf(t)>=0);` +
    `case 'notEquals':return !(T(v)===t||(Array.isArray(v)&&v.map(String).indexOf(t)>=0));` +
    `case 'contains':return Array.isArray(v)?v.map(String).indexOf(t)>=0:T(v).toLowerCase().indexOf(t.toLowerCase())>=0;` +
    `case 'gt':return +T(v)> +t;case 'lt':return +T(v)< +t;}return false;}` +
    `function apply(){var vis={},req={};var w=F.querySelectorAll('[data-field]');` +
    `for(var i=0;i<w.length;i++){var k=w[i].getAttribute('data-field');vis[k]=true;}` +
    `for(var b=0;b<BR.length;b++)req[BR[b]]=true;` +
    `for(var r=0;r<R.length;r++){if(!hold(R[r].when))continue;var a=R[r].then;` +
    `if(a.action==='show')vis[a.target]=true;else if(a.action==='hide')vis[a.target]=false;` +
    `else if(a.action==='require')req[a.target]=true;else if(a.action==='optional')req[a.target]=false;}` +
    `for(var m=0;m<w.length;m++){var wf=w[m],key=wf.getAttribute('data-field'),show=vis[key]!==false;` +
    `wf.hidden=!show;var ins=wf.querySelectorAll('input,select,textarea');` +
    `for(var n=0;n<ins.length;n++){if(!show){ins[n].required=false;}else if(req[key]){if(ins[n].type!=='checkbox'||ins.length===1)ins[n].required=(n===0||ins[n].type!=='radio')?true:ins[n].required;}}}}` +
    `F.addEventListener('input',apply);F.addEventListener('change',apply);apply();})();`;
  return `<script>${js.replace(/</g, '\\u003c')}</script>`;
}

// ═════════ starter presets — the owner never faces a blank canvas ═════════
// Four ready-made forms (raw defs → normalizeFormDefinition on save). Plain
// language, sensible required fields, one always-reachable contact field each.
export interface FormPreset { key: string; name: string; note: string; def: unknown }
export const FORM_PRESETS: FormPreset[] = [
  {
    key: 'contact', name: 'Contact form', note: 'Name, email or phone, and a message — the classic.',
    def: {
      type: 'form', id: 'contact', title: 'Contact us', kind: 'contact', submit_label: 'Send message',
      confirmation_text: 'Thanks — we’ll be in touch soon.',
      fields: [
        { key: 'name', label: 'Your name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone (optional)', type: 'phone' },
        { key: 'message', label: 'How can we help?', type: 'textarea', required: true },
      ],
    },
  },
  {
    key: 'quote', name: 'Quote request', note: 'Ask what they need and their budget before you reply.',
    def: {
      type: 'form', id: 'quote', title: 'Request a quote', kind: 'quote', submit_label: 'Request a quote',
      confirmation_text: 'Got it — we’ll send your quote shortly.',
      fields: [
        { key: 'name', label: 'Your name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone', type: 'phone' },
        { key: 'service', label: 'What do you need?', type: 'select', required: true, choices: ['General enquiry', 'A new project', 'Ongoing work', 'Something else'] },
        { key: 'budget', label: 'Rough budget', type: 'select', choices: ['Not sure yet', 'Under $1,000', '$1,000–$5,000', '$5,000+'] },
        { key: 'details', label: 'Tell us more', type: 'textarea', required: true },
      ],
    },
  },
  {
    key: 'application', name: 'Application', note: 'Collect applicants — role, experience, and consent to contact.',
    def: {
      type: 'form', id: 'application', title: 'Apply now', kind: 'quote', submit_label: 'Submit application',
      confirmation_text: 'Thanks for applying — we’ll review and get back to you.',
      fields: [
        { key: 'name', label: 'Full name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone', type: 'phone', required: true },
        { key: 'position', label: 'Position you’re applying for', type: 'text', required: true },
        { key: 'experience', label: 'Relevant experience', type: 'textarea', required: true },
        { key: 'start_date', label: 'Earliest start date', type: 'date' },
        { key: 'consent', label: 'I agree to be contacted about my application.', type: 'consent', required: true },
      ],
    },
  },
  {
    key: 'booking', name: 'Booking intake', note: 'Take a booking request — date, party size, and details.',
    def: {
      type: 'form', id: 'booking', title: 'Request a booking', kind: 'booking', submit_label: 'Request booking',
      confirmation_text: 'Thanks — we’ll confirm your booking soon.',
      fields: [
        { key: 'name', label: 'Your name', type: 'text', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone', type: 'phone', required: true },
        { key: 'date', label: 'Preferred date', type: 'date', required: true },
        { key: 'party_size', label: 'How many people?', type: 'number', min: 1, max: 100 },
        { key: 'notes', label: 'Anything we should know?', type: 'textarea' },
      ],
    },
  },
];
export function getFormPreset(key: string): FormPreset | undefined {
  return FORM_PRESETS.find((p) => p.key === key);
}
