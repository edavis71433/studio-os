# Davis Digital Studio — Master Improvement Checklist

Everything still open to make the BUSINESS feel as solid as the website already looks.
Ordered by priority. The code is in good shape now; this is the operations layer, which
is the part clients actually judge you on.

Legend: [code] needs a code/repo change · [setup] something only you can do ·
[doc] a template/checklist (most are now written in this pack).

---

## DO THIS WEEK (prevents the most damage)

- [ ] [code] Commit your DEPLOYED clever-api function into your repo, and confirm the
      repo's portal + admin panel are byte-for-byte what's live. This is the single
      highest-value item. Every hard bug this month came from the repo file not matching
      the deployed reality. Make the repo the source of truth and this whole class of
      problem disappears.
- [ ] [setup] File the LLC + DBA. Protects your personal assets. (Runbook #1)
- [ ] [setup] Get E&O / general liability insurance quotes and bind a policy. (Runbook #2)
- [ ] [setup] Create your Google Business Profile. You sell Google visibility; you need
      your own. (Runbook #3)

## BEFORE THE NEXT CLIENT LAUNCHES

- [ ] [setup] Switch to Stripe native Invoicing (auto receipts, invoice numbers, auto
      "paid"). (Runbook #4)
- [ ] [setup] Set up a real e-sign tool and send the contract BEFORE the deposit. (Runbook #5)
- [ ] [doc] Lock your revision count and support-window scope in writing, in the proposal
      and the portal. (Template pack #4 and #8)
- [ ] [doc] Have the content checklist ready to send at kickoff. Missing client content is
      the #1 reason projects run long. (Template pack #3)
- [ ] [setup] Sign up for UptimeRobot, ready to add each site at launch. (Runbook #6)
- [ ] [setup] Set up a password manager for client credentials. (Runbook #8)
- [ ] [setup] Start the client infrastructure register (domains, renewals, hosting). (Runbook #7)

## AT EACH CLIENT (the repeatable flow)

Use the template pack in order:
1. Welcome email same day they say yes (#1)
2. E-sign contract, then deposit invoice
3. Create portal, post kickoff message (#2)
4. Send content checklist with a due date (#3)
5. Build; use approval requests at each milestone (#5); nudge if content is late (#6)
6. Run the full launch checklist before going live (LAUNCH-CHECKLIST.md)
7. Launch announcement (#7); add to uptime monitor + infra register
8. Testimonial + Google review request 3-5 days later (#9)
9. Offboarding/handoff doc when final invoice clears (#10)

## SOON, NOT URGENT

- [ ] [code] Add a simple post-deploy smoke test you run after every function deploy
      (load admin, open a client, confirm data loads). Would have caught the blank
      dashboard before you did.
- [ ] [code] Improve portal error handling so a failed data load shows "couldn't load,
      retry" instead of an empty section (original QA item #6).
- [ ] [doc] Publish the Bacchus case study (assets are already in the repo).
- [ ] [doc] Write a short SEO handoff template so SEO work is visible to clients.
- [ ] [setup] Confirm CA sales-tax treatment for your service bundles with a tax pro.

## NOT WORTH WORRYING ABOUT YET

These are real at scale and a distraction at 2-5 clients. Revisit later.
- A custom CRM (a Google Sheet pipeline is correct until ~15+ active leads)
- A blog / content marketing engine (referrals + GBP matter far more first)
- Team/multi-user accounts (you're solo)
- Heavy automation (do each flow by hand a few times first, then automate the boring parts)
- A second product line (lock in build + audit + retainer first)

---

## The one habit that matters most

You are the whole company. The reason to templatize ruthlessly now is so onboarding
client #5 takes thirty minutes, not a lost weekend. Cap your active builds (2-3 at a
time as a solo), protect the calendar, and keep the repo matching what's deployed. The
website already looks professional. These systems are what make the business feel that
way too.
