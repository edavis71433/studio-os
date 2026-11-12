-- 0179 — The studio can ask a client to approve the website draft (builder list item 179, part two).
-- The client portal shows the draft itself, page by page, with Approve, Ask for a
-- change and notes pinned to one part of a page. The ask is an ordinary approval on
-- the client's project, of a new kind: 'website'. Its subject_id is the exact
-- snapshot of the client's site the studio sent (presence_snapshots.id, captured at
-- the ask), and content_hash binds the decision to it, like every other approval.
--
-- One constraint widened; nothing existing changes. Until this runs, the function
-- answers a website ask with "isn't switched on yet" and every other ask as before.
alter table public.presence_approvals drop constraint if exists presence_approvals_subject_type_check;
alter table public.presence_approvals add constraint presence_approvals_subject_type_check
  check (subject_type in ('deliverable','task','project','custom','website'));

-- rollback (only while no 'website' approvals exist):
--   alter table public.presence_approvals drop constraint if exists presence_approvals_subject_type_check;
--   alter table public.presence_approvals add constraint presence_approvals_subject_type_check
--     check (subject_type in ('deliverable','task','project','custom'));
