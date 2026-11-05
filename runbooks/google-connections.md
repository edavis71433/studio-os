# Switching on the Google connections

Search Console and Google Business Profile are built, but they can't run until Google knows about the studio's app. This is a one-time setup. Nothing here touches a client's website.

Allow about 30 minutes of clicking, plus waiting on Google: **listing access takes days or weeks**, and a public app needs Google's verification.

## 1. Create the Google app

1. Go to <https://console.cloud.google.com> and create a project, for example `Studio OS connections`.
2. Note its **project number** on the project's home page. Step 4 asks for it.

## 2. Consent screen: what people see when they approve

1. Open **Google Auth Platform**, then **Branding**. Use the name `Davis Digital Studio`, your support email, and `davisdigitalstudio.com` as the authorized domain. Link your privacy policy: `https://davisdigitalstudio.com/privacy`.
2. Under **Audience**, choose **External**.
3. Under **Data Access**, add these two scopes:
   - `https://www.googleapis.com/auth/webmasters.readonly`
   - `https://www.googleapis.com/auth/business.manage`
4. Back under **Audience**, publish the app to **In production**. While it says "Testing", Google signs everyone out after 7 days and allows only 100 listed test accounts.
5. Google will ask to verify the app because of those scopes. Until it's verified, people see an "unverified app" warning.

## 3. The app's sign-in credentials

1. Open **Clients**, then **Create client**, and choose **Web application**.
2. Under **Authorized redirect URIs**, add exactly this:

   ```
   https://app.davisdigitalstudio.com/connections-callback.html
   ```

   Use the `app.` address. The plain `davisdigitalstudio.com` address redirects and loses the sign-in code, so connections would fail.
3. Save the client ID and client secret for step 6.

## 4. Ask Google for listing access (Business Profile only)

Google keeps these APIs at a quota of zero until it approves the project. It requires a Business Profile that has been verified and active for **60+ days**, with a website listed on it. Your own studio's profile, or one you manage for a client, both count.

1. Make sure you have an Organization account in Business Profile: <https://support.google.com/business/answer/7663063>.
2. Fill in the form: <https://support.google.com/business/contact/api_default>, giving the project number from step 1.
3. Wait for approval. To check, look at the quotas for the Business Profile APIs in the Cloud console: **0** per minute means not yet, **300** means approved.

Until then a connected listing says "Google hasn't approved the studio's access to listings yet". That's expected and isn't an error.

## 5. Switch on the APIs

Under **APIs & Services**, then **Library**, enable:

- **Google Search Console API**, which works straight away.

After listing access is approved, also enable:

- **My Business Account Management API**
- **My Business Business Information API**
- **Google My Business API** (the reviews)
- **Business Profile Performance API**

## 6. Give Supabase the credentials

In Supabase, open **Edge Functions**, then **Secrets**, and add the following. The same client ID and secret go in both pairs.

```
CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_ID
CONNECTED_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET
CONNECTED_GOOGLE_BUSINESS_PROFILE_CLIENT_ID
CONNECTED_GOOGLE_BUSINESS_PROFILE_CLIENT_SECRET
```

`CONNECTION_ENC_KEY` must exist too (44 characters, base64). Without it, connections refuse to store anything.

## 7. Try it on your own site

1. Open your site in the builder, then the **Search** tab.
2. Press **Connect Search Console** and approve with the Google account that owns the site in Search Console.
3. Your numbers should appear within about a minute of coming back. If the account can't see the site, the card names what it can see.
4. Press **Connect your listing**. Google's screen will say "manage your business listings". That's the only permission Google offers for listings, and Studio OS only reads.

## If something goes wrong

| What you see | What it means | What to do |
| --- | --- | --- |
| "isn't switched on yet" and names secrets | Step 6 isn't done | Add the named secrets |
| Google says `redirect_uri_mismatch` | Step 3's address doesn't match exactly | Copy it again, including `app.` and `.html` |
| "Google hasn't approved…" | Step 4 is still waiting | Nothing; check the quota |
| "listing service isn't switched on" | Step 5 isn't done | Enable the four listing APIs |
| "That Google account can't see…" | Wrong Google account | Disconnect, then connect with the account that owns the site |
| Asked to reconnect after a week | The app is still in "Testing" | Publish it (step 2.4), then reconnect |
