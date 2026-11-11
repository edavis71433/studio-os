-- 0163 — Reviews that go to Google (sales review item 115, extending item 93).
-- One pasted fact: the business's Google place id, so a review request can send
-- the customer to the Google review box
-- (https://search.google.com/local/writereview?placeid=…) instead of the site's
-- own review page. When the site's Google Business Profile connection has real
-- listing data, the link Google itself hands back (metadata.newReviewUri) wins
-- and this column is never needed — it is the paste-once fallback while
-- Google's approval of the platform's listing access is still pending.
alter table presence_identity add column if not exists google_place_id text;
