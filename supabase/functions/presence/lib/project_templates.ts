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
