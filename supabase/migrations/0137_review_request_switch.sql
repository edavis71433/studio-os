-- rollback: alter table public.presence_settings
--   drop column if exists review_requests, drop column if exists review_request_after_days;
--
-- ── A fourth switch: ask for a review after a project is done (list item 29) ──
-- APPLY THIS BEFORE (OR WITH) DEPLOYING THE FUNCTION. The function degrades
-- honestly until it lands: the settings read and write retry without these
-- columns (routes/content.ts), so Settings and every other settings save keep
-- working and the new switch reads as off; the sweep's settings read 400s and
-- it is a clean no-op (commerce/lifecycle.runReviewRequests).
--
-- WHAT CHANGES
--   presence_settings.review_requests (boolean, default false): when a project
--     on this site has been "complete" for review_request_after_days days, the
--     project's client gets one email asking for a review, with this site's
--     review page link — the same email as a hand-sent request (routes/reviews.ts
--     sendReviewAsk). Once per project: the notice ledger is the gate (kind
--     deal_followup, period 'reviewask:<project id>'), as for invoice reminders.
--     Every client is asked, whatever they answered on the satisfaction survey:
--     asking only the happy ones breaks Google's rules on reviews. A project
--     whose day passed more than two weeks ago is never asked about, so turning
--     the switch on doesn't email every client from the past.
--   presence_settings.review_request_after_days (integer 1–90, default 3): the
--     wait after the project is marked complete, so the review ask doesn't land
--     with the satisfaction survey that goes out on completion.
alter table public.presence_settings
  add column if not exists review_requests boolean not null default false,
  add column if not exists review_request_after_days integer not null default 3;

comment on column public.presence_settings.review_requests is
  'List item 29: email a project''s client one review request review_request_after_days after the project is marked complete (off by default). Sentence: routes/reviews.ts sendReviewAsk.';
comment on column public.presence_settings.review_request_after_days is
  'Days after a project is marked complete before its review request. 1–90, default 3.';
