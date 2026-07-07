-- ── AI Visual Studio (V1) ───────────────────────────────────────────────────
-- Brand-aware image generation for the customer's own presence: hero, social,
-- and Open Graph assets, plus general graphics — generated in variations,
-- editable, and NEVER entering the media library until the customer approves
-- one. This is the same ritual that stands between every AI draft and the world:
-- a generation is a PROPOSED plan; approval promotes the chosen variation into
-- `presence_media` with honest `ai_approved` provenance. Unapproved variations
-- are ephemeral draft artifacts.
--
-- `requires_approval` is a CHECK constant — approval-before-use is a law, not a
-- setting — matching presence_connection_writes and presence_infra_plans. This
-- table rides the shared Approved-Plan spine (lib/approved_plan.ts): the
-- `claimed_at` column is the atomic single-winner claim for the promote step.
create table if not exists public.presence_visual_plans (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  kind text not null check (kind in (
    'hero', 'social_square', 'social_portrait', 'social_story', 'open_graph', 'general'
  )),
  title text not null,
  summary text not null,                           -- what this makes, plain words
  brief text not null,                             -- the customer's own description
  prompt text not null default '',                 -- the composed brand-aware generation brief
  brand_snapshot jsonb not null default '{}',      -- palette/voice used, for honesty + reproducibility
  risk text not null default '',
  reversible boolean not null default true,        -- an unused draft is discardable; a stored asset is removable
  rollback text not null default '',
  requires_approval boolean not null default true check (requires_approval = true),
  variations jsonb not null default '[]',          -- [{ id, storage_path, width, height, model, created_at }]
  chosen_variation text,                           -- the variation id the customer approved
  alt_text text,                                   -- required before an asset can be stored (accessibility)
  media_id uuid references public.presence_media(id) on delete set null,  -- the library row created on approval
  provenance text not null default 'ai' check (provenance in ('ai', 'ai_approved')),
  model text,                                       -- which image model produced the variations (honesty)
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'abandoned', 'stored', 'failed')),
  claimed_at timestamptz,                          -- atomic claim for the promote-into-library step
  decided_at timestamptz,
  stored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.presence_visual_plans is
  'AI Visual Studio. Brand-aware image generations as approval-gated plans: proposed → approved → (atomic claim) → stored into presence_media with ai_approved provenance. Unapproved variations are ephemeral drafts and never enter the library. Deny-all RLS (function-mediated, service-role only). Live generation is gated on an owner-set image-model key.';
create index if not exists presence_visual_plans_idx
  on public.presence_visual_plans (site_id, status, created_at);

alter table public.presence_visual_plans enable row level security;  -- deny-all (no policies)

do $$ begin
  create trigger presence_visual_plans_touch before update on public.presence_visual_plans
    for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- rollback:
--   drop table if exists public.presence_visual_plans;
