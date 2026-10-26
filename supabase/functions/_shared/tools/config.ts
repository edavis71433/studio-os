// ── Free Tools: shared settings (Free Tools Build Spec, Oct 2026) ────────────
// Site Review and AI Visibility Check run on one foundation: the same tables
// (migration 0136), the same guards, the same report template, the same unlock
// flow. Every number the spec fixes lives here so the two tools can't drift.

export type ToolId = 'site_review' | 'ai_visibility';
export const TOOLS: ToolId[] = ['site_review', 'ai_visibility'];
export const isTool = (t: unknown): t is ToolId => TOOLS.includes(t as ToolId);

export const TOOL_NAMES: Record<ToolId, string> = {
  site_review: 'Site Review',
  ai_visibility: 'AI Visibility Check',
};

export const CALENDLY_URL = 'https://calendly.com/eric-davisdigitalstudio/30min';
export const ERIC_EMAIL = 'eric@davisdigitalstudio.com';
export const FROM = `Eric Davis <${ERIC_EMAIL}>`;

// Where the hosted report lives. Overridable so a staging or local run links
// to its own page instead of production.
export const TOOLS_BASE_URL = (Deno.env.get('TOOLS_BASE_URL') || 'https://tools.davisdigitalstudio.com').replace(/\/$/, '');
export const reportUrl = (id: string) => `${TOOLS_BASE_URL}/report/${id}`;

// Rate limits: 3 scans per IP per hour and 10 per day; 2 runs per email per
// tool per week (counted at unlock, since the teaser comes before the email).
// Unlocks per IP are capped too, so the form can't be used to spray email.
export const LIMITS = {
  scansPerHour: 3,
  scansPerDay: 10,
  unlocksPerEmailPerToolPerWeek: 2,
  unlocksPerIpPerDay: 12,
};

// Cache: Site Review 24 hours per URL; AI Visibility 7 days per business + city.
export const CACHE_HOURS: Record<ToolId, number> = { site_review: 24, ai_visibility: 24 * 7 };

// Daily spend cap in dollars across both tools ($10 to start, per Eric).
export const dailySpendCapUsd = () => {
  const n = Number(Deno.env.get('DAILY_SPEND_CAP_USD') || '10');
  return Number.isFinite(n) && n >= 0 ? n : 10;
};

export const RESTING_MESSAGE = "The tools are resting for today. Book a call and I'll run it by hand.";

// What a locked report shows before the email (spec: "Teaser vs full").
//   Site Review: overall score, four pillar scores, summary, two findings.
//   AI Visibility: overall score, "appeared in X of N answers", the top
//   competitor's name, summary.
export const TEASER: Record<ToolId, { findings: number; pillars: boolean; highlights: boolean }> = {
  site_review: { findings: 2, pillars: true, highlights: false },
  ai_visibility: { findings: 0, pillars: false, highlights: true },
};

export const CLOSING: Record<ToolId, string> = {
  site_review: 'Want me to go through the rest of your site? Book a free 30 minute call.',
  ai_visibility: 'Want to show up where your competitors do? Book a free 30 minute call.',
};

// CORS: the main site and the tools subdomain only. TOOLS_EXTRA_ORIGINS
// (comma-separated) lets a staging or local run add its own origin without a
// code change.
const TOOL_ORIGINS = [
  'https://davisdigitalstudio.com',
  'https://www.davisdigitalstudio.com',
  'https://tools.davisdigitalstudio.com',
  ...(Deno.env.get('TOOLS_EXTRA_ORIGINS') || '').split(',').map((o) => o.trim()).filter(Boolean),
];

export function toolsCors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': TOOL_ORIGINS.includes(origin) ? origin : TOOL_ORIGINS[0],
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}

export function toolsJson(req: Request, payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...toolsCors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
