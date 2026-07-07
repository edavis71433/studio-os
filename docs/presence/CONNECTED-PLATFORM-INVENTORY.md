# Connected Platform Inventory (L4.0)

**Generated from `connected/providers.ts` — do not hand-edit.** Regenerate whenever the registry changes so the inventory can never drift into one-off truth. Every provider has the same single-page profile; every one begins **read-only** (`status: planned` until its read-only adapter ships in L4.1+).

**21 providers** · status: 21 planned · reachable by edition: monitor=6, Presence=19, managed=20, agency=21, enterprise=21

Editions below are **technical capability only** (pricing is not set here). Support is always a contiguous range from a provider's floor upward.


## Search

### Google Search Console — *"how you show up in Google Search"*
- **Purpose:** See which searches bring people to you, and whether Google can find your pages.
- **Read capabilities:** the searches that lead to you; how often you appear and get clicked; pages Google has trouble reading
- **Future write capabilities:** submit a sitemap; ask Google to re-check a page
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `webmasters.readonly`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** monitor, Presence, managed, agency, enterprise
- **Rate posture:** generous daily quota; observed on a gentle schedule
- **Status:** Planned

### Bing Webmaster Tools — *"how you show up in Bing"*
- **Purpose:** The same visibility picture for Bing and the assistants that use it.
- **Read capabilities:** search terms and clicks on Bing; indexing status
- **Future write capabilities:** submit a sitemap
- **Authentication:** A read-only key you paste in — nothing else.
- **Required permissions (least privilege):** `webmaster.read`
- **Customer approval:** You paste a read-only key you control.
- **Supported editions:** monitor, Presence, managed, agency, enterprise
- **Rate posture:** modest quota; low-frequency reads
- **Status:** Planned

## Local listings

### Google Business Profile — *"your Google listing"*
- **Purpose:** Keep your Google listing — hours, phone, photos, reviews — correct and current.
- **Read capabilities:** your listing details and hours; reviews and their replies; how many people called or asked directions
- **Future write capabilities:** update hours and details; reply to a review; publish a post
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `business.manage`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** monitor, Presence, managed, agency, enterprise
- **Rate posture:** per-minute limits; batched, backed-off
- **Status:** Planned

### Apple Business Connect — *"your place on Apple Maps"*
- **Purpose:** Make sure people on iPhones and Siri find the right you.
- **Read capabilities:** your Apple place card details; whether it is claimed and verified
- **Future write capabilities:** update the place card
- **Authentication:** A one-time check that you own the listing.
- **Required permissions (least privilege):** `place.read`
- **Customer approval:** You prove ownership once; nothing else is asked.
- **Supported editions:** monitor, Presence, managed, agency, enterprise
- **Rate posture:** low-frequency; verification-gated
- **Status:** Planned

## Analytics

### Google Analytics — *"your visitor numbers"*
- **Purpose:** Understand how many people visit and what they look at — in plain numbers.
- **Read capabilities:** visitors and page views; your busiest pages; where visitors come from
- **Future write capabilities:** — (observe-only by design)
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `analytics.readonly`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** monitor, Presence, managed, agency, enterprise
- **Rate posture:** token-bucket quota; cached reads
- **Status:** Planned

### Google Tag Manager — *"your website tags"*
- **Purpose:** See what measurement tags are on your site, and keep them tidy.
- **Read capabilities:** which tags and trackers are installed
- **Future write capabilities:** add or remove a measurement tag
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `tagmanager.readonly`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** low-frequency config reads
- **Status:** Planned

## Social

### Meta Business — *"your Facebook & Instagram business"*
- **Purpose:** One connection to the Facebook and Instagram side of your business.
- **Read capabilities:** which pages and accounts you manage
- **Future write capabilities:** — (observe-only by design)
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `business_management`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** app-level rate limits; pooled
- **Status:** Planned

### Facebook Page — *"your Facebook page"*
- **Purpose:** Keep an eye on your Facebook page and, later, post to it from here.
- **Read capabilities:** recent posts and how they did; page followers
- **Future write capabilities:** publish a post
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `pages_read_engagement`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** per-page limits; backed-off
- **Status:** Planned

### Instagram — *"your Instagram"*
- **Purpose:** See how your Instagram is doing and, later, share to it from here.
- **Read capabilities:** recent posts and reach
- **Future write capabilities:** publish a post
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `instagram_basic`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** per-user hourly limits
- **Status:** Planned

### LinkedIn — *"your LinkedIn page"*
- **Purpose:** For businesses whose customers live on LinkedIn.
- **Read capabilities:** company page posts and followers
- **Future write capabilities:** post an update
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `r_organization_social`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** daily throttles; low-frequency
- **Status:** Planned

### YouTube — *"your YouTube channel"*
- **Purpose:** See how your videos are doing.
- **Read capabilities:** videos and their view counts; channel subscribers
- **Future write capabilities:** — (observe-only by design)
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `youtube.readonly`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** daily quota units; cached
- **Status:** Planned

## Reviews

### Yelp — *"your Yelp reviews"*
- **Purpose:** Watch your Yelp rating and what people are saying.
- **Read capabilities:** your rating and review count; recent reviews
- **Future write capabilities:** — (observe-only by design)
- **Authentication:** A read-only key you paste in — nothing else.
- **Required permissions (least privilege):** `business.read`
- **Customer approval:** You paste a read-only key you control.
- **Supported editions:** monitor, Presence, managed, agency, enterprise
- **Rate posture:** daily call cap; low-frequency
- **Status:** Planned

### Trustpilot — *"your Trustpilot reviews"*
- **Purpose:** Keep an eye on your Trustpilot standing.
- **Read capabilities:** rating and recent reviews
- **Future write capabilities:** reply to a review
- **Authentication:** A read-only key you paste in — nothing else.
- **Required permissions (least privilege):** `reviews.read`
- **Customer approval:** You paste a read-only key you control.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** plan-based quota
- **Status:** Planned

## Scheduling

### Google Calendar — *"your appointments"*
- **Purpose:** So your website can show real availability and, later, take bookings.
- **Read capabilities:** your free/busy availability; upcoming appointments
- **Future write capabilities:** create a booking
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `calendar.readonly`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** per-minute limits; incremental sync
- **Status:** Planned

### Calendly — *"your booking page"*
- **Purpose:** Bring your Calendly bookings into one place.
- **Read capabilities:** scheduled meetings; your event types
- **Future write capabilities:** — (observe-only by design)
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `scheduled_events.read`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** webhook + polling; gentle
- **Status:** Planned

## CRM

### HubSpot — *"your customer list"*
- **Purpose:** For businesses that keep their customers in HubSpot.
- **Read capabilities:** contacts and their stages; recent deals
- **Future write capabilities:** add a contact
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `crm.objects.contacts.read`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** managed, agency, enterprise
- **Rate posture:** per-account rate limits
- **Status:** Planned

### Salesforce — *"your customer records"*
- **Purpose:** For larger organizations running on Salesforce.
- **Read capabilities:** accounts and contacts
- **Future write capabilities:** create a lead
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `api`, `refresh_token`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** agency, enterprise
- **Rate posture:** org API call limits; batched
- **Status:** Planned

## Email marketing

### Mailchimp — *"your email list"*
- **Purpose:** See how your emails land and, later, grow your list from your site.
- **Read capabilities:** audience size; recent campaign open and click rates
- **Future write capabilities:** add a subscriber
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `audiences.read`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** connection cap; batched
- **Status:** Planned

### Klaviyo — *"your email marketing"*
- **Purpose:** For shops running email and SMS on Klaviyo.
- **Read capabilities:** list sizes; campaign performance
- **Future write capabilities:** add a profile
- **Authentication:** A read-only key you paste in — nothing else.
- **Required permissions (least privilege):** `lists.read`, `metrics.read`
- **Customer approval:** You paste a read-only key you control.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** token-bucket per key
- **Status:** Planned

## Payments

### Stripe (your account) — *"your payments"*
- **Purpose:** See your own sales and, later, send a payment link from your site.
- **Read capabilities:** recent payments and payouts; active subscriptions
- **Future write capabilities:** create a payment link
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `read_only`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** generous; read-mostly
- **Status:** Planned

### Square — *"your Square sales"*
- **Purpose:** Bring your Square sales and catalog into view.
- **Read capabilities:** recent sales; your item catalog
- **Future write capabilities:** update an item price
- **Authentication:** Secure sign-in you approve on the provider’s own screen — Studio OS never sees your password.
- **Required permissions (least privilege):** `PAYMENTS_READ`, `ITEMS_READ`
- **Customer approval:** You approve access on the provider’s sign-in screen, and can revoke it any time.
- **Supported editions:** Presence, managed, agency, enterprise
- **Rate posture:** per-app QPS; batched
- **Status:** Planned

---

*Ownership is identical for every provider: the customer owns the account and the authorization; Studio OS holds delegated, encrypted, least-privilege, revocable tokens — never a password, never ownership. Disconnecting is one tap, any time, free, and never touches the customer's data at the provider.*
