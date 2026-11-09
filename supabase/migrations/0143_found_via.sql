-- 0143 — "How did they find you?" (sales review item 69, Nov 2026)
-- One pick on a contact (the person, shown on the customer record) and on a deal:
-- Google, Referral, Word of mouth, Social, Repeat client, Website, Other.
-- '' = not recorded. The code tolerates this migration not being applied yet:
-- every write that carries found_via retries without it, every read falls back.
alter table public.presence_contacts add column if not exists found_via text not null default '';
alter table public.presence_deals add column if not exists found_via text not null default '';

-- rollback:
--   alter table public.presence_contacts drop column if exists found_via;
--   alter table public.presence_deals drop column if exists found_via;
