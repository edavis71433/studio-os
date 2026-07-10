-- ── P2-E W1: AI image metering (close the cost-invisible Visual Studio path) ──
-- The usage ledger counted text ops + tokens but had NO image representation, so
-- gpt-image-1 spend (the most expensive AI op) was structurally $0 in every cost
-- report. Add an images counter to the rollup + per-event detail, and extend the
-- atomic meter RPC to increment it. Same ledger — no second AI accounting system.

alter table public.presence_ai_usage add column if not exists images int not null default 0;
alter table public.presence_ai_usage_events add column if not exists images int;

-- extend the atomic meter to carry images (drop + recreate to change the signature;
-- p_images defaults to 0 so every existing text caller is unaffected).
drop function if exists public.presence_ai_meter(uuid,uuid,text,text,text,text,int,int);
create or replace function public.presence_ai_meter(
  p_client_id uuid,
  p_site_id uuid,
  p_period text,
  p_agent text,
  p_kind text,
  p_model text,
  p_input_tokens int,
  p_output_tokens int,
  p_images int default 0
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.presence_ai_usage
    (client_id, period, generative_ops, assistive_ops, input_tokens, output_tokens, images, last_at)
  values (
    p_client_id, p_period,
    case when p_kind = 'generative' then 1 else 0 end,
    case when p_kind = 'assistive'  then 1 else 0 end,
    coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0), coalesce(p_images, 0), now()
  )
  on conflict (client_id, period) do update set
    generative_ops = public.presence_ai_usage.generative_ops + (case when p_kind = 'generative' then 1 else 0 end),
    assistive_ops  = public.presence_ai_usage.assistive_ops  + (case when p_kind = 'assistive'  then 1 else 0 end),
    input_tokens   = public.presence_ai_usage.input_tokens   + coalesce(p_input_tokens, 0),
    output_tokens  = public.presence_ai_usage.output_tokens  + coalesce(p_output_tokens, 0),
    images         = public.presence_ai_usage.images         + coalesce(p_images, 0),
    last_at = now(),
    updated_at = now();

  insert into public.presence_ai_usage_events
    (site_id, client_id, agent, kind, model, input_tokens, output_tokens, images)
  values (p_site_id, p_client_id, p_agent, p_kind, p_model, p_input_tokens, p_output_tokens, coalesce(p_images, 0));
end;
$$;
revoke all on function public.presence_ai_meter(uuid,uuid,text,text,text,text,int,int,int) from public;
grant execute on function public.presence_ai_meter(uuid,uuid,text,text,text,text,int,int,int) to service_role;

-- rollback:
--   drop function if exists public.presence_ai_meter(uuid,uuid,text,text,text,text,int,int,int);
--   (recreate the 8-arg version from 0037); alter table presence_ai_usage drop column images;
