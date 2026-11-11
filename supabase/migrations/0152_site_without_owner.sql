-- 0152 — A site can be made before its owner is invited (builder list item 135, Nov 2026 review)
-- "+ New site" on the Sites page makes a client record with no owner yet; Invite the
-- owner adds their email and their login later (agency/sites.ts). clients.email has
-- been NOT NULL since the baseline, and a client with no owner has no email, so the
-- column may now be empty (NULL). Its UNIQUE rule (clients_email_key) stays: many
-- rows may be NULL under it.
--
-- my_client_ids() — the rule that says which client records a signed-in person
-- belongs to — stops comparing an EMPTY email. A client row with no email (or no
-- contact email) used to compare '' with the signed-in person's address, so a sign-in
-- whose token carried an empty address would have matched every such row. Anyone
-- with a real address is matched exactly as before; the contact link is unchanged.
--
-- rollback: alter table public.clients alter column email set not null;  (only once no
--   row has an empty email), and restore my_client_ids() from 0000_baseline.sql.
alter table public.clients alter column email drop not null;

create or replace function public.my_client_ids() returns setof uuid
    language sql stable security definer
    as $$
  select cl.id
  from public.clients cl
  where
    -- linked via contact -> auth_user_id
    cl.contact_id in (
      select co.id from public.contacts co where co.auth_user_id = auth.uid()
    )
    -- OR linked by email on the client row itself, never on an empty address
    or (
      coalesce(auth.jwt() ->> 'email', '') <> ''
      and (
        lower(coalesce(cl.email, '')) = lower(auth.jwt() ->> 'email')
        or lower(coalesce(cl.contact_email, '')) = lower(auth.jwt() ->> 'email')
      )
    )
$$;
