-- ── 0024 — M9.5A: the AI Writer's proposals ─────────────────────────────────
-- Additive only. One new table; nothing existing changes.
-- Constitutional home: 05 §7 (writing classes) + 03 §3 rung 2 (Draft — writes
-- only when asked, always reviewable). An ai_draft is a PROPOSAL: nothing in
-- it touches the site draft until the customer accepts an option, and
-- acceptance flows through the unmodified Draft Writer. Nothing publishes.
--
-- approval_required is schema-enforced true: a proposal that skips approval
-- cannot exist as data.
create table if not exists public.presence_ai_drafts (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  kind text not null check (kind in (
    'identity_copy','faqs','offering_descriptions','post','testimonial_request',
    'policy_doc','social_post','email_doc','page_copy','starter_site')),
  origin text not null default 'customer_request' check (origin in ('customer_request','recommendation')),
  prompt_summary text not null,                 -- what was asked, in one line
  instructions text not null default '',        -- the customer's own words (bounded)
  options jsonb not null default '[]',          -- [{label, tone, payload, self_check, fact_guard}] — 1..3 directions
  chosen_option int,                             -- set on acceptance
  confidence numeric not null default 0.8 check (confidence > 0 and confidence <= 1),
  missing_facts jsonb not null default '[]',     -- questions for the customer, never inventions
  evidence_used jsonb not null default '[]',     -- recommendation hashes when initiated from one
  assumptions jsonb not null default '[]',       -- explicit, reviewable; empty is the goal
  approval_required boolean not null default true check (approval_required = true),
  generated_assets jsonb not null default '[]',  -- always [] in v1 (no asset generation)
  version int not null default 1,
  status text not null default 'proposed' check (status in ('proposed','accepted','discarded','expired')),
  applied_summary text not null default '',      -- what acceptance did, in plain words
  model text not null default '',                -- which model wrote it (auditable)
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
comment on table public.presence_ai_drafts is
  'M9.5A. AI Writer proposals: structured draft content, 1-3 tone options, fact-guarded, voice-aware. Review-only until accepted; acceptance composes into the site draft through the unmodified Draft Writer. Document-only kinds (social/email/policy/page copy) never touch the draft.';

create index if not exists presence_ai_drafts_site_idx
  on public.presence_ai_drafts (site_id, status, created_at desc);

alter table public.presence_ai_drafts enable row level security;
create policy presence_ai_drafts_client_read on public.presence_ai_drafts
  for select to authenticated
  using (site_id in (select public.my_presence_site_ids()));
-- no client write policies: generation, acceptance, and discard go through
-- the presence function so the fact guard and provenance always run.

grant select on public.presence_ai_drafts to authenticated;
