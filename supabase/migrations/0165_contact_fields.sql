-- 0165 — A contact holds more (sales item 89, Nov 2026)
-- A contact kept a name, an email, a phone, a company and up to five fields of your
-- own. A local business has a street address (it goes on invoices and into local
-- search work), people have a job title and a second number, and "restaurant",
-- "past client" or "referral partner" had nowhere to go. Four new columns, all
-- empty by default; nothing existing changes. The code tolerates this migration not
-- being applied yet: reads fall back to the older columns, and a save that carries
-- the new fields saves the rest and says these need a quick database update.
alter table public.presence_contacts add column if not exists job_title text not null default '';
alter table public.presence_contacts add column if not exists phone2 text not null default '';
-- { street, city, state, zip, country } — lib/contact_fields.ts normalizeAddress
alter table public.presence_contacts add column if not exists address jsonb not null default '{}';
-- lower-case words, each once, at most twelve — lib/contact_fields.ts normalizeTags
alter table public.presence_contacts add column if not exists tags text[] not null default '{}';
-- "everyone tagged restaurant": the list filters by one tag (tags @> '{restaurant}')
create index if not exists presence_contacts_tags_idx
  on public.presence_contacts using gin (tags) where deleted_at is null;
comment on column public.presence_contacts.address is
  'Sales item 89: the contact''s address as { street, city, state, zip, country }; {} = none. Function-mediated (lib/contact_fields.ts).';
comment on column public.presence_contacts.tags is
  'Sales item 89: the contact''s tags, lower-case, each once, at most twelve; Contacts filters by one (presence_contacts_tags_idx).';

-- rollback:
--   drop index if exists public.presence_contacts_tags_idx;
--   alter table public.presence_contacts drop column if exists tags, drop column if exists address,
--     drop column if exists phone2, drop column if exists job_title;
