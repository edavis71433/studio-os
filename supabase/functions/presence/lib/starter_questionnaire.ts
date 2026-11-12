// ── Builder list item 179: the questionnaire every website project starts with ──
// The checklist's "Send back your project questionnaire" step used to point at a
// form the studio emailed by hand. A new project now gets these five questions as
// a survey, so the client's to-do opens the questions themselves. The studio can
// replace it with its own; any survey whose title says questionnaire counts.
// Pure data, no imports.
import type { Question } from './intake.ts';

export const STARTER_QUESTIONNAIRE_TITLE = 'Project questionnaire';

/** Does this survey title name a project questionnaire? The portal uses the same test. */
export function isQuestionnaireTitle(title: unknown): boolean {
  return /questionnaire|intake|brief/i.test(String(title ?? ''));
}

export function starterQuestions(): Question[] {
  return [
    { key: 'what_you_do', label: 'What does your business do, in a sentence or two?', type: 'text' },
    { key: 'customers', label: 'Who are your customers?', type: 'text' },
    { key: 'first_action', label: 'What should a visitor do first on your site? Call, book, buy, write to you?', type: 'text' },
    { key: 'sites_you_like', label: 'Any websites you like? Tell us which, and what you like about them.', type: 'text' },
    { key: 'must_have', label: 'Anything the site must have, or must avoid?', type: 'text' },
  ];
}
