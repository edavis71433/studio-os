-- ── Developer Mode (Phase B) — the safe per-site customization layer ─────────
-- ONE additive table. Developer Mode customizes PRESENTATION as DATA (theme
-- tokens + sanitized custom CSS/HTML), gated by the `use_developer_mode`
-- capability. It never stores or executes code — the values are sanitized before
-- they land, and render-LOGIC stays a build-time SDK activity. Deny-all RLS,
-- function-mediated. Isolation/approval/audit unchanged.
create table if not exists public.presence_dev_customizations (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.presence_sites(id) on delete cascade,
  theme_tokens jsonb not null default '{}',    -- validated allow-listed tokens only
  custom_css text not null default '',          -- sanitized CSS (no @import/expression/js url)
  custom_html text not null default '',         -- sanitized inert markup (no script/handlers)
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id)
);
comment on table public.presence_dev_customizations is
  'Phase B. Developer Mode per-site presentation customization (theme tokens + sanitized CSS/HTML). Values are sanitized in the function before insert — never code. Deny-all RLS; function-mediated. Publishing/versioning/approval/isolation unchanged.';
create index if not exists presence_dev_customizations_idx on public.presence_dev_customizations (site_id);

alter table public.presence_dev_customizations enable row level security;  -- deny-all

do $$ begin
  create trigger presence_dev_customizations_touch before update on public.presence_dev_customizations
    for each row execute function public.presence_touch_updated_at();
exception when others then null; end $$;

-- rollback:
--   drop table if exists public.presence_dev_customizations;
