// ── Concierge grounding (M9.4) — ALL I/O lives here ─────────────────────────
// The grounding pack is the concierge's ENTIRE world of facts: the active
// moments, the recommendations behind them, the judgments behind those, and
// the plain-language evidence behind those. Every sentence the concierge
// speaks must trace into this pack; nothing outside it exists.
// Engines untouched: this module only READS what M9.0–M9.3 stored.
import { svc } from '../lib/db.ts';
import type { SiteRow } from '../lib/site.ts';
import { buildBusinessMemory, type BusinessMemory } from '../lib/business_memory.ts';

export interface Grounding {
  businessName: string;
  businessMemory?: BusinessMemory;   // PT-9: what the AI "remembers" — assembled from existing data
  moments: Array<{
    id: string; key: string; moment_type: string; headline: string; summary: string;
    tone: string; supporting_recommendation_ids: string[];
  }>;
  recommendations: Array<{
    hash: string; rule: string; title: string; description: string; reason: string;
    expected_benefit: string; estimated_effort: string; estimated_risk: string;
    undoability: string; action: string; timing: string; requires_ai: boolean;
    value_dimensions: string[]; supporting_judgment_ids: string[];
  }>;
  judgments: Array<{ hash: string; rule: string; reasoning: string; category: string; confidence: number; evidence_ids: string[] }>;
  evidence: Array<{ id: string; type: string; human: string; confidence: number }>;
}

/** PT-9: assemble the AI Business Memory from data the platform already holds —
 *  ONE place, reused by grounding (concierge) and the /coach/memory endpoint.
 *  Never a second memory store; pure assembly over existing rows. */
export async function loadBusinessMemory(site: SiteRow): Promise<BusinessMemory> {
  const [identQ, offQ] = await Promise.all([
    svc(`presence_identity?site_id=eq.${site.id}&select=business_name,description,service_area,settings&limit=1`),
    svc(`presence_offerings?site_id=eq.${site.id}&select=id&limit=200`),
  ]);
  const ident = identQ.json?.[0] || {};
  const settings = ident.settings || {};
  return buildBusinessMemory({
    industry: settings.industry || null,
    voiceTone: settings.voice?.tone || settings.voice_tone || null,
    identityDescription: ident.description || null,
    serviceArea: ident.service_area || null,
    goals: Array.isArray(settings.goals) ? settings.goals : null,
    siteStatus: site.status,
    lastPublishedAt: site.last_published_at || null,
    offeringsCount: Array.isArray(offQ.json) ? offQ.json.length : 0,
    live: site.status === 'live',
  }, new Date().toISOString());
}

export async function buildGrounding(site: SiteRow): Promise<Grounding> {
  const identQ = await svc(`presence_identity?site_id=eq.${site.id}&select=business_name&limit=1`);
  const businessName = identQ.json?.[0]?.business_name || 'your business';
  const businessMemory = await loadBusinessMemory(site).catch(() => undefined);

  const momentsQ = await svc(`presence_moments?site_id=eq.${site.id}&status=eq.active&select=id,moment_key,moment_type,headline,summary,tone,supporting_recommendation_ids&order=importance.desc&limit=3`);
  const moments = (momentsQ.json ?? []).map((m: Record<string, unknown>) => ({
    id: m.id, key: m.moment_key, moment_type: m.moment_type, headline: m.headline,
    summary: m.summary, tone: m.tone,
    supporting_recommendation_ids: Array.isArray(m.supporting_recommendation_ids) ? m.supporting_recommendation_ids : [],
  })) as Grounding['moments'];

  // the recommendations the moments cite (latest batch rows carry them)
  const recHashes = [...new Set(moments.flatMap((m) => m.supporting_recommendation_ids))];
  let recommendations: Grounding['recommendations'] = [];
  if (recHashes.length) {
    const inList = recHashes.slice(0, 40).map((h) => `"${h}"`).join(',');
    const rQ = await svc(`presence_recommendations?site_id=eq.${site.id}&recommendation_hash=in.(${inList})&select=recommendation_hash,rule,title,description,reason,expected_benefit,estimated_effort,estimated_risk,undoability,action,timing,requires_ai,value_dimensions,supporting_judgment_ids,created_at&order=created_at.desc&limit=80`);
    const seen = new Set<string>();
    for (const r of (rQ.json ?? [])) {
      if (seen.has(r.recommendation_hash)) continue;
      seen.add(r.recommendation_hash);
      recommendations.push({
        hash: r.recommendation_hash, rule: r.rule, title: r.title, description: r.description,
        reason: r.reason, expected_benefit: r.expected_benefit, estimated_effort: r.estimated_effort,
        estimated_risk: r.estimated_risk, undoability: r.undoability, action: r.action, timing: r.timing,
        requires_ai: !!r.requires_ai, value_dimensions: r.value_dimensions ?? [],
        supporting_judgment_ids: r.supporting_judgment_ids ?? [],
      });
    }
  }

  // the judgments behind those recommendations
  const jHashes = [...new Set(recommendations.flatMap((r) => r.supporting_judgment_ids))];
  let judgments: Grounding['judgments'] = [];
  if (jHashes.length) {
    const inList = jHashes.slice(0, 40).map((h) => `"${h}"`).join(',');
    const jQ = await svc(`presence_judgments?site_id=eq.${site.id}&judgment_hash=in.(${inList})&select=judgment_hash,rule,reasoning,category,confidence,evidence_ids,created_at&order=created_at.desc&limit=80`);
    const seen = new Set<string>();
    for (const j of (jQ.json ?? [])) {
      if (seen.has(j.judgment_hash)) continue;
      seen.add(j.judgment_hash);
      judgments.push({ hash: j.judgment_hash, rule: j.rule, reasoning: j.reasoning, category: j.category, confidence: Number(j.confidence), evidence_ids: (j.evidence_ids ?? []).slice(0, 20) });
    }
  }

  // the plain-language evidence behind those judgments
  const eIds = [...new Set(judgments.flatMap((j) => j.evidence_ids))].slice(0, 40);
  let evidence: Grounding['evidence'] = [];
  if (eIds.length) {
    const inList = eIds.map((id) => `"${id}"`).join(',');
    const eQ = await svc(`presence_evidence?id=in.(${inList})&select=id,type,human,confidence&limit=60`);
    evidence = (eQ.json ?? []).map((e: Record<string, unknown>) => ({ id: e.id, type: e.type, human: e.human, confidence: Number(e.confidence) })) as Grounding['evidence'];
  }

  return { businessName, businessMemory, moments, recommendations, judgments, evidence };
}
