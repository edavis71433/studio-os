-- rollback: delete from public.presence_surveys s where s.title = 'Project questionnaire'
--             and not exists (select 1 from public.presence_survey_responses r where r.survey_id = s.id);
--
-- ── The starter questionnaire for projects that have none (builder list item 179) ──
-- WHY
--   The client's "Send back your project questionnaire" to-do opened a file box,
--   because no project had a questionnaire to answer. New projects get five starter
--   questions when their checklist is seeded (lib/service_bridge.ts). This gives the
--   same five to every project whose questionnaire step is still open and which has
--   no questionnaire of its own. Data only: no table or column changes.
-- SAFE TO RE-RUN: a project that already holds a questionnaire (deleted ones count,
-- a studio that threw it away meant it) is skipped.

insert into public.presence_surveys (site_id, project_id, title, questions, status, client_visible)
select t.site_id, t.project_id, 'Project questionnaire',
       '[{"key":"what_you_do","label":"What does your business do, in a sentence or two?","type":"text"},
         {"key":"customers","label":"Who are your customers?","type":"text"},
         {"key":"first_action","label":"What should a visitor do first on your site? Call, book, buy, write to you?","type":"text"},
         {"key":"sites_you_like","label":"Any websites you like? Tell us which, and what you like about them.","type":"text"},
         {"key":"must_have","label":"Anything the site must have, or must avoid?","type":"text"}]'::jsonb,
       'active', true
from public.presence_tasks t
where t.source = 'checklist:questionnaire_returned'
  and t.status <> 'done'
  and t.deleted_at is null
  and not exists (
    select 1 from public.presence_surveys s
    where s.project_id = t.project_id and s.site_id = t.site_id
      and s.title ~* '(questionnaire|intake|brief)'
  );
