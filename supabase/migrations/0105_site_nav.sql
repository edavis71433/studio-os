-- ── Editable global navigation ───────────────────────────────────────────────
-- `nav` holds a validated array of top-nav items, each { label, href, children? },
-- where href is a SAFE internal path ("/", "/{slug}/") or an https/mailto/tel URL and
-- children form a single-level dropdown. The header/footer are GLOBAL — every page
-- renders through the template's shell() — so this one value drives the nav on every
-- page. Authoritative validation (label/href sanitizing, safe-href only, caps, one
-- dropdown level) lives in lib/serializer.ts at serialize time; this column is just
-- structured storage on the existing settings row. Empty = the template default nav
-- (byte-identical to before).
alter table public.presence_settings
  add column if not exists nav jsonb not null default '[]';
comment on column public.presence_settings.nav is 'Editable global top nav [{label,href,children?}]. href is a safe internal path or https/mailto/tel; validated + capped at serialize time (lib/serializer.ts). Empty = template default nav.';
-- rollback: alter table public.presence_settings drop column if exists nav;
