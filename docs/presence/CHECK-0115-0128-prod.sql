-- ===========================================================================
--  CHECK - which of migrations 0115 to 0128 reached production (READ ONLY)
-- ===========================================================================
--  Paste into Supabase -> SQL Editor and press Run. It changes nothing: it only
--  reads the database's own description of itself. One row per migration;
--  `applied` is true when production has what that migration adds.
--
--  Why (list item 76): nine of these have no apply pack and no record of being
--  applied. Several widen a list of allowed values that a best-effort write
--  depends on, so a missing one fails SILENTLY (a portal action that never
--  notifies the studio, a voided invoice with no trace on the deal).
--  Send the result back; each `false` row gets its own apply pack.
--
--  0120 and 0123 both make the same index (0120 also gave older projects the
--  delivery checklist), so they read the same here.
-- ===========================================================================

with notices as (select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'presence_plan_notices_kind_check'),
     deals   as (select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'presence_deal_events_kind_check'),
     cols    as (select table_name || '.' || column_name as c from information_schema.columns where table_schema = 'public'),
     idx     as (select indexname from pg_indexes where schemaname = 'public')
select '0115 support requests know their client' as migration,
       ('presence_support_requests.client_id' in (select c from cols) and 'presence_project_messages.external_id' in (select c from cols)) as applied
union all select '0116 portal actions notify the studio',          coalesce((select def from notices) like '%client_approval%', false)
union all select '0117 removing an unsent draft is recorded',      coalesce((select def from deals) like '%contract_deleted%', false)
union all select '0118 a voided invoice is recorded',              coalesce((select def from deals) like '%invoice_voided%', false)
union all select '0119 money on a voided invoice raises a notice', coalesce((select def from notices) like '%invoice_void_paid%', false)
union all select '0120 older projects got the delivery checklist', exists(select 1 from idx where indexname = 'presence_tasks_project_checklist_uq')
union all select '0123 one delivery checklist per project',        exists(select 1 from idx where indexname = 'presence_tasks_project_checklist_uq')
union all select '0127 retainer and deal to-do notices',           coalesce((select def from notices) like '%deal_task_due%', false)
union all select '0128 connections keep their settings',           'presence_connections.config' in (select c from cols);
