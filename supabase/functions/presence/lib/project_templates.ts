// ── Project starter templates (A4) ───────────────────────────────────────────
// A default milestone + task scaffold so a new build doesn't start from an empty
// project every time. Pure data + pure lookups; the /projects route does the
// inserts. Applied ONLY to a freshly-created project — it fills an empty project,
// it never overwrites or merges into an existing one.
//
// The scaffold is deliberately generic-agency (a website build, the studio's core
// job). Client-action steps are marked so they surface to the customer; everything
// else stays internal until the studio shares it.

export interface TemplateTask { title: string; client_action_required?: boolean }
export interface TemplateMilestone { title: string; tasks?: TemplateTask[] }
export interface ProjectTemplate { key: string; label: string; milestones: TemplateMilestone[] }

export const PROJECT_TEMPLATES: ProjectTemplate[] = [
  {
    key: 'website',
    label: 'Website build',
    milestones: [
      { title: 'Kickoff & brief', tasks: [
        { title: 'Share your logo, brand colours, and photos', client_action_required: true },
        { title: 'Confirm the pages and content you need', client_action_required: true },
        { title: 'Set up the workspace and outline the sitemap' },
      ] },
      { title: 'Design & first draft', tasks: [
        { title: 'Draft the homepage and key pages' },
        { title: 'Write first-pass copy and SEO' },
        { title: 'Share the draft for your review', client_action_required: true },
      ] },
      { title: 'Review & revisions', tasks: [
        { title: 'Gather your feedback', client_action_required: true },
        { title: 'Apply revisions' },
        { title: 'Final approval to publish', client_action_required: true },
      ] },
      { title: 'Launch', tasks: [
        { title: 'Connect the domain and go live' },
        { title: 'Post-launch check and handoff' },
      ] },
    ],
  },
];

export const templateByKey = (k: string): ProjectTemplate | null =>
  PROJECT_TEMPLATES.find((t) => t.key === k) || null;

/** Lightweight list for a picker — {key,label} only. */
export const templateChoices = (): Array<{ key: string; label: string }> =>
  PROJECT_TEMPLATES.map((t) => ({ key: t.key, label: t.label }));

// ── The studio's own project templates (sales item 106, borrowed from Wix's ──
// pipeline templates: "Project Tracker", "To Do Tasks"). Any project can be saved
// as a template — its milestones and steps, who does each, and when each is due
// counted in days from the project's start — and a new project starts from it,
// its dates set from its own start. Kept as one reserved JSON list per studio
// (lib/reserved_store.ts RESERVED_NAMES.projectTemplates), so no new table. The
// delivery checklist's own steps (source checklist:*) are left out: a project a
// won deal becomes gets those by itself. Pure.
export interface SavedTemplateTask { title: string; client_action_required?: boolean; due_days?: number | null }
export interface SavedProjectTemplate { id: string; name: string; milestones: Array<{ title: string; tasks: SavedTemplateTask[] }>; created_at: string }
export const MAX_SAVED_PROJECT_TEMPLATES = 20;
const MAX_STEPS = 80;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const cleanText = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const dayDiff = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000);

/** A project's milestones and steps as a template. Steps under no milestone gather
 *  under "Other steps"; order is the project's own. Pure. */
export function templateFromProject(o: { id: string; name: string; now: string; startDate?: string | null; milestones: any[]; tasks: any[] }): SavedProjectTemplate {
  const start = DATE_ONLY_RE.test(String(o.startDate || '')) ? String(o.startDate) : null;
  const byOrder = (a: any, b: any) => (Number(a?.sort_order) || 0) - (Number(b?.sort_order) || 0);
  const steps = (o.tasks || []).filter((t) => t && cleanText(t.title, 200) && !String(t.source || '').startsWith('checklist:') && !t.deleted_at).sort(byOrder).slice(0, MAX_STEPS);
  const task = (t: any): SavedTemplateTask => {
    const due = String(t.due_date || '').slice(0, 10);
    const d = start && DATE_ONLY_RE.test(due) ? dayDiff(start, due) : null;
    return { title: cleanText(t.title, 200), ...(t.client_action_required === true ? { client_action_required: true } : {}), ...(d !== null && d >= 0 && d <= 365 ? { due_days: d } : {}) };
  };
  const ms = (o.milestones || []).filter((m) => m && cleanText(m.title, 160) && !m.deleted_at).sort(byOrder);
  const out: SavedProjectTemplate['milestones'] = ms.map((m) => ({ title: cleanText(m.title, 160), tasks: steps.filter((t) => t.milestone_id === m.id).map(task) }));
  const loose = steps.filter((t) => !t.milestone_id || !ms.some((m) => m.id === t.milestone_id)).map(task);
  if (loose.length) out.push({ title: 'Other steps', tasks: loose });
  return { id: o.id, name: cleanText(o.name, 80) || 'Project template', milestones: out.filter((m) => m.tasks.length || m.title), created_at: o.now };
}

/** The saved list as stored, made safe to use. Pure. */
export function savedTemplates(json: unknown): SavedProjectTemplate[] {
  return (Array.isArray(json) ? json : []).filter((t: any) => t && typeof t.id === 'string' && /^[0-9a-f-]{36}$/.test(t.id) && Array.isArray(t.milestones))
    .slice(0, MAX_SAVED_PROJECT_TEMPLATES)
    .map((t: any) => ({ id: t.id, name: cleanText(t.name, 80) || 'Project template', created_at: String(t.created_at || ''),
      milestones: t.milestones.slice(0, 30).map((m: any) => ({ title: cleanText(m?.title, 160), tasks: (Array.isArray(m?.tasks) ? m.tasks : []).slice(0, MAX_STEPS).map((x: any) => ({ title: cleanText(x?.title, 200), ...(x?.client_action_required === true ? { client_action_required: true } : {}), ...(Number.isInteger(x?.due_days) && x.due_days >= 0 && x.due_days <= 365 ? { due_days: x.due_days } : {}) })).filter((x: SavedTemplateTask) => x.title) })) }));
}
/** How many steps a template holds — the picker's "12 steps". Pure. */
export const templateStepCount = (t: { milestones: Array<{ tasks?: unknown[] }> }): number => t.milestones.reduce((n, m) => n + (Array.isArray(m.tasks) ? m.tasks.length : 0), 0);
/** A step's due date from the project's start. Pure. */
export function dueFromStart(startYmd: unknown, days: unknown): string | null {
  const s = String(startYmd || '');
  if (!DATE_ONLY_RE.test(s) || !Number.isInteger(days)) return null;
  return new Date(Date.parse(s + 'T00:00:00Z') + (days as number) * 86_400_000).toISOString().slice(0, 10);
}
