// ── What to do now at each deal stage (sales item 124, Nov 2026) ─────────────
// Salesforce shows "Guidance for Success" under a deal's stage bar: a few lines on
// what to do at that stage. Here each of the six stages carries a short note the
// studio writes once and sees on every deal at that stage, under the stage bar on
// the record and on Pipeline's deal. Each starts with a starter note; a studio's
// own replaces it, and "Put back the starter note" brings it back. Kept as one
// reserved JSON row beside the stage names and chances (lib/reserved_store.ts),
// holding only the notes the studio changed, so a better starter note reaches
// everyone who never touched theirs. Pure.

export const NOTE_STAGES = ['lead', 'qualified', 'proposal', 'contract', 'won', 'lost'] as const;
export type NoteStage = typeof NOTE_STAGES[number];
/** One note: up to eight lines (a line is one step), each up to 160 characters. */
export const NOTE_MAX_LINES = 8, NOTE_MAX_LINE = 160;

export const STAGE_NOTE_DEFAULTS: Record<NoteStage, string> = {
  lead: 'Reply the same day. A quick call beats an email.\nAsk what they need, by when, and roughly what they want to spend.\nLook at their current website before you talk.',
  qualified: 'Agree what is in and what is not: pages, photos and words.\nConfirm the budget and the day they will decide.\nSend the proposal while it is fresh.',
  proposal: 'Follow up two days after it goes out. A quick call beats another email.\nAsk what they’d change: the price, the timing or the pages?\nThe day they say yes, send the agreement and ask for the deposit.',
  contract: 'Check they’ve signed, and nudge them after two days.\nAsk for the deposit as soon as it is signed.\nBook the kickoff call.',
  won: 'Send the welcome and the kickoff details.\nCollect their words, photos and logins.\nPut the launch date in their project.',
  lost: 'Note why it didn’t fit.\nSet a reminder to check back in three months.',
};

export const isNoteStage = (s: unknown): s is NoteStage => (NOTE_STAGES as readonly string[]).includes(String(s));

/** A note as typed, cleaned: one step a line, blank lines and stray bullets gone, at most
 *  eight lines of 160 characters. '' when nothing is left. */
export function cleanNote(raw: unknown): string {
  return String(raw ?? '').replace(/\r\n?/g, '\n').split('\n')
    .map((l) => l.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/^\s*(?:[-*•·]|\d+[.)])\s+/, '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX_LINE))
    .filter(Boolean).slice(0, NOTE_MAX_LINES).join('\n');
}

/** Only real changes survive: a known stage, a note with something in it, not the
 *  starter note again. */
export function normalizeStageNotes(raw: unknown): Partial<Record<NoteStage, string>> {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const out: Partial<Record<NoteStage, string>> = {};
  for (const k of NOTE_STAGES) {
    const v = cleanNote(r[k]);
    if (v && v !== STAGE_NOTE_DEFAULTS[k]) out[k] = v;
  }
  return out;
}

/** Every stage's note: the studio's own where it wrote one, the starter note elsewhere. */
export function stageNotes(custom: unknown): Record<NoteStage, string> {
  return { ...STAGE_NOTE_DEFAULTS, ...normalizeStageNotes(custom) };
}

/** One stage's note changed on what is kept now: an empty note, or the starter note,
 *  puts the starter back. */
export function withStageNote(current: unknown, stage: NoteStage, text: unknown): Partial<Record<NoteStage, string>> {
  const next: Record<string, unknown> = { ...normalizeStageNotes(current) };
  const v = cleanNote(text);
  if (!v || v === STAGE_NOTE_DEFAULTS[stage]) delete next[stage]; else next[stage] = v;
  return normalizeStageNotes(next);
}
