/** The pipeline's stages, in one place (sales item 146). The database allows exactly these
 *  (migration 0074): the first stage is `lead`, never `new`. Every job and page that asks
 *  "is this deal still open?" reads OPEN_DEAL_STAGES, so no list can drift from the rest. */
export const OPEN_DEAL_STAGES = ['lead', 'qualified', 'proposal', 'contract'] as const;
export const CLOSED_DEAL_STAGES = ['won', 'lost'] as const;
export const DEAL_STAGES = [...OPEN_DEAL_STAGES, ...CLOSED_DEAL_STAGES] as const;
export type DealStage = typeof DEAL_STAGES[number];
export function isOpenDealStage(stage: unknown): boolean {
  return (OPEN_DEAL_STAGES as readonly string[]).includes(String(stage || ''));
}
/** The PostgREST filter for the open stages: `stage=in.(lead,qualified,proposal,contract)`. */
export const OPEN_DEAL_STAGES_FILTER = `stage=in.(${OPEN_DEAL_STAGES.join(',')})`;
