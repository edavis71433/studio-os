-- ── Saved proposal & contract templates ─────────────────────────────────────
-- The repeat-operator time-saver every peer tool (Dubsado/HoneyBook) ships: save a
-- proposal's line items or a contract's text once, reuse it on every new deal.
-- Contract bodies may carry {{client_name}} / {{deal_title}} placeholders, filled
-- at create time from the deal. Site-scoped; deny-all RLS; function-mediated.

create table if not exists public.presence_sales_templates (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null,
  kind text not null check (kind in ('proposal','contract')),
  name text not null default 'Template',
  title text not null default '',
  body text not null default '',            -- contract text (may contain placeholders)
  line_items jsonb not null default '[]',   -- proposal line items
  created_by text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists presence_sales_templates_site_idx
  on public.presence_sales_templates (site_id, kind) where deleted_at is null;

alter table public.presence_sales_templates enable row level security;  -- deny-all; function-mediated
