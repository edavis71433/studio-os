# Davis Digital Studio — Owner Setup Runbooks

The things only you can do. None of these are code. They are what separate a side
project from a business clients trust. Ordered by priority. I am not a lawyer or
accountant, so treat the legal/tax steps as a checklist to confirm with a pro, not
as legal advice.

---

## 1. LLC + DBA (do this first, it protects your personal assets)

Why it matters: as a sole proprietor, if a client ever claims your work cost them
money and sues, it reaches your personal bank account and assets. An LLC is a cheap
wall between the business and you.

Steps (California):
1. Go to bizfileOnline.sos.ca.gov (CA Secretary of State).
2. File Articles of Organization for an LLC. Filing fee is around $70.
3. Get an EIN (free) from irs.gov, search "apply for EIN online." Takes 10 minutes.
4. File the Statement of Information within 90 days (required, ~$20).
5. Be aware: California charges an $800/year minimum franchise tax on LLCs. Budget for it.
6. DBA / Fictitious Business Name: if "Davis Digital Studio" is not your legal LLC name,
   file a DBA with LA County (lavote.gov, Fictitious Business Name). You usually must
   also publish it in a local newspaper for 4 weeks (the filing service often handles this).
   Without the DBA you may not be able to deposit checks made out to "Davis Digital Studio."
7. Open a separate business bank account in the LLC name. Never mix personal and business money.

Time: an afternoon. Cost: roughly $150 to set up plus the $800/yr CA tax.

---

## 2. Business insurance (E&O + general liability)

Why it matters: even with an LLC, a professional liability (Errors & Omissions) policy
covers you if a client claims your work caused them a loss. For a solo web studio it's
often surprisingly cheap.

Steps:
1. Get quotes from providers that do tech/freelancer policies: Hiscox, Next Insurance,
   Thimble, and Coverwallet all quote online in minutes.
2. Ask for: Professional Liability (E&O) and General Liability, often bundled.
3. Typical solo web design E&O runs a few hundred dollars a year. Confirm the coverage
   limit fits your project sizes.
4. Keep the certificate handy; some larger clients ask for proof of insurance.

Time: 30 minutes for quotes. Cost: roughly $300 to $600/year.

---

## 3. Google Business Profile for Davis Digital Studio

Why it matters: you SELL Google visibility. A studio with no Google presence and zero
reviews is the number one "is this person real" hesitation a prospect has. Fixing this
also gives you a process you can later sell to clients.

Steps:
1. Go to google.com/business and create a profile for Davis Digital Studio.
2. Service-area business: since you're remote/LA, set it as a service-area business so
   you don't have to show a home address. Set your service area to LA + remote/US.
3. Category: "Website designer" (and add "Marketing agency" / "Internet marketing service").
4. Add: logo, a few portfolio images, hours, phone, your site URL, a short description
   in your voice.
5. Verify (Google will mail a code or offer video verification).
6. Get your first reviews: at each client launch (Bacchus, Maurice), send them your
   direct review link and ask. Two or three real reviews changes everything.

Direct review link: in your GBP dashboard, "Ask for reviews" gives you a short link.
Save it; it's the one you paste into the testimonial email.

Time: 30 minutes to set up, plus verification wait.

---

## 4. Stripe Invoicing (upgrade from raw payment links)

Why it matters: raw Stripe payment links have no invoice number, no amount tied to a
specific invoice, and no automatic "paid" status. Stripe's native Invoicing emails a
real invoice, takes the payment, sends the receipt, and marks it paid automatically.
It reads far more established and removes manual reconciliation.

Steps:
1. In your Stripe dashboard, go to Invoices (or Billing → Invoices).
2. Create a customer for each client (name, email).
3. Create an invoice: line items (e.g. "Deposit, 50%"), amount, due date.
4. Turn on automatic receipts and payment reminders in Settings.
5. Send the invoice. Stripe emails it; the client pays in the invoice itself.
6. In the portal, instead of a per-invoice Stripe payment link, you can link to the
   Stripe-hosted invoice URL, or just let Stripe's own emails carry it.
7. Set invoice numbering so they run in sequence (DDS-0001, DDS-0002...).

Time: 20 minutes to set up the first one, faster after.

---

## 5. Real e-signature for contracts (before the deposit)

Why it matters: a checkbox in the portal is a weak record. A signed agreement before
the deposit, stored with a timestamp, is what protects you in a dispute. The portal
acknowledgment can stay as a secondary record.

Steps:
1. Pick a free/cheap e-sign tool: Dropbox Sign (formerly HelloSign), PandaDoc, or
   Docusign all have free or low tiers that cover a solo studio's volume.
2. Upload your DEFAULT_CONTRACT (you already have the text in the admin panel) as a
   template with signature and date fields.
3. New client flow: send the agreement to e-sign FIRST. Only after it's signed do you
   send the deposit invoice and create the portal.
4. Save the signed PDF (the tool stores it; keep your own copy too).

Time: 30 minutes to set up the template once.

---

## 6. Uptime monitoring on every client site

Why it matters: a client's site going down before you notice is a trust disaster. You
should know before they do. This is squarely your KP wheelhouse, so it's easy and cheap.

Steps:
1. Sign up at uptimerobot.com (free tier covers up to 50 monitors).
2. Add a monitor for each live client site (HTTP(s) check, 5-minute interval).
3. Set alert contacts to your email (and optionally SMS).
4. Add this as a line in your launch checklist so every new site gets monitored.

Time: 5 minutes per site.

---

## 7. Client infrastructure register

Why it matters: a lapsed domain can lose a client their entire site, sometimes
permanently. You need one place that records who owns what and when it renews. This is
exactly your KP domain-governance instinct, scaled down.

Make a simple sheet with one row per client:
- Client name
- Domain(s) and registrar
- Domain expiry date + auto-renew on/off
- Who owns the registrar account (client or you)
- SSL provider and renewal (or "auto via host")
- Hosting / platform
- Where credentials are stored (a password manager, never a plain sheet)
- Date the project launched

Set a calendar reminder 30 days before each domain expiry. State clearly in your
contract that domain ownership and renewal are the client's responsibility unless they
buy ongoing support.

Time: 10 minutes to build, 2 minutes per client.

---

## 8. Password manager for client credentials

Why it matters: storing client logins in a spreadsheet or notes is a breach waiting to
happen and looks unprofessional if you're ever fumbling for access.

Steps:
1. Use a real password manager (Bitwarden has a solid free tier, 1Password is excellent paid).
2. Make a folder/collection per client.
3. Store: platform logins, registrar, analytics, any third-party tools.
4. Never put credentials in the client infrastructure sheet itself; the sheet just notes
   WHERE they live.

Time: ongoing, a minute per credential.
