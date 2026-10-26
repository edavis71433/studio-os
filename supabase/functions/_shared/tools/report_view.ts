// ── Free Tools: what the browser may see of a report ─────────────────────────
// Pure (no I/O) so the teaser rule is unit-tested. A locked report is cut down
// HERE, on the server: the full findings never leave the function until the
// report is unlocked, so "view source" can't skip the email form.

import { CALENDLY_URL, CLOSING, TEASER, TOOL_NAMES, isTool, type ToolId } from './config.ts';

export type Finding = {
  title: string;
  what_we_found: string;
  why_it_matters: string;
  fix: string;
  priority: 'Fix now' | 'Important' | 'Later';
  pillar?: string;
};
export type Pillar = { key: string; name: string; score: number | null; weight?: number; note?: string };
export type Table = { title: string; note?: string; columns: string[]; rows: (string | number | null)[][] };

/** 80 and up Strong, 60 to 79 Needs work, under 60 Fix now. */
export function scoreLabel(score: number | null | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  if (score >= 80) return 'Strong';
  if (score >= 60) return 'Needs work';
  return 'Fix now';
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});

export function publicReport(row: Record<string, unknown>) {
  const tool: ToolId = isTool(row.tool) ? row.tool : 'site_review';
  const unlocked = row.unlocked === true;
  const input = obj(row.input);
  const scores = obj(row.scores);
  const findings = obj(row.findings);
  const items = arr<Finding>(findings.items);
  const rule = TEASER[tool];
  const overall = typeof scores.overall === 'number' ? Math.round(scores.overall) : null;

  return {
    id: String(row.id || ''),
    tool,
    tool_name: TOOL_NAMES[tool],
    unlocked,
    created_at: row.created_at || null,
    business: {
      name: String(input.business_name || '') || null,
      url: String(input.url || '') || null,
      city: String(input.city || '') || null,
      type: String(input.business_type || '') || null,
    },
    overall,
    label: scoreLabel(overall),
    pillars: unlocked || rule.pillars ? arr<Pillar>(scores.pillars) : [],
    highlights: unlocked || rule.highlights ? arr<{ label: string; value: string }>(scores.highlights) : [],
    notes: arr<string>(scores.notes),
    summary: String(findings.summary || ''),
    findings: unlocked ? items : items.slice(0, rule.findings),
    findings_total: items.length,
    top_three: unlocked ? arr<string>(findings.top_three) : [],
    tables: unlocked ? arr<Table>(findings.tables) : [],
    closing: { text: CLOSING[tool], url: CALENDLY_URL },
  };
}
