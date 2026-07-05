# Supabase email templates — invite & password reset

Right now Supabase sends its **generic default** invite/reset emails ("You have been invited"). For a brand-new client, that cold email is their very first impression, so it's worth replacing with branded copy. This is a dashboard change, not code.

## Where to paste these

In Supabase: **Authentication → Emails** (or **Email Templates**). You'll see tabs for each email type. Update two:
- **Invite user**
- **Reset password** (sometimes labeled "Recovery")

Paste the HTML below into the **Message body** of each. Keep Supabase's `{{ .ConfirmationURL }}` variable exactly as-is — that's the link that carries them to your set-password page.

Set the **Subject** lines to:
- Invite: `You're invited to your Davis Digital Studio project portal`
- Reset: `Reset your Davis Digital Studio password`

---

## 1. INVITE EMAIL

```html
<div style="max-width:520px;margin:0 auto;font-family:'Helvetica Neue',Arial,sans-serif;padding:32px 24px;">
  <div style="font-family:Georgia,serif;font-size:19px;color:#1a1523;margin-bottom:24px;">
    Davis<span style="color:#5b3fa0;">Digital</span> Studio
  </div>
  <div style="background:#faf8f5;border-radius:16px;padding:30px 26px;">
    <h1 style="font-family:Georgia,serif;font-size:23px;font-weight:400;color:#1a1523;margin:0 0 14px;">
      Welcome — your project portal is ready
    </h1>
    <p style="font-size:14.5px;color:#5e5270;line-height:1.65;margin:0 0 14px;">
      Hi there,
    </p>
    <p style="font-size:14.5px;color:#5e5270;line-height:1.65;margin:0 0 14px;">
      This is where we'll work together. Your portal is one private place for your
      project — the brief, files, approvals, messages, invoices, and your timeline —
      so nothing gets lost in email.
    </p>
    <p style="font-size:14.5px;color:#5e5270;line-height:1.65;margin:0 0 22px;">
      Click below to set your password and take a look. It only takes a minute.
    </p>
    <div style="text-align:center;margin-bottom:22px;">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#5b3fa0;color:#fff;font-size:14px;font-weight:600;padding:13px 30px;border-radius:100px;text-decoration:none;">
        Set my password &amp; get started
      </a>
    </div>
    <p style="font-size:12.5px;color:#9089a0;line-height:1.6;margin:0;">
      This link expires after a while for your security. If it's expired by the time
      you click, just reply to this email and I'll send a fresh one.
    </p>
  </div>
  <p style="font-size:12px;color:#9089a0;line-height:1.6;margin:20px 0 0;text-align:center;">
    Davis Digital Studio · Los Angeles · eric@davisdigitalstudio.com
  </p>
</div>
```

---

## 2. RESET PASSWORD EMAIL

```html
<div style="max-width:520px;margin:0 auto;font-family:'Helvetica Neue',Arial,sans-serif;padding:32px 24px;">
  <div style="font-family:Georgia,serif;font-size:19px;color:#1a1523;margin-bottom:24px;">
    Davis<span style="color:#5b3fa0;">Digital</span> Studio
  </div>
  <div style="background:#faf8f5;border-radius:16px;padding:30px 26px;">
    <h1 style="font-family:Georgia,serif;font-size:23px;font-weight:400;color:#1a1523;margin:0 0 14px;">
      Reset your password
    </h1>
    <p style="font-size:14.5px;color:#5e5270;line-height:1.65;margin:0 0 14px;">
      You asked to reset the password for your project portal. Click below to choose
      a new one.
    </p>
    <div style="text-align:center;margin:22px 0;">
      <a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#5b3fa0;color:#fff;font-size:14px;font-weight:600;padding:13px 30px;border-radius:100px;text-decoration:none;">
        Choose a new password
      </a>
    </div>
    <p style="font-size:12.5px;color:#9089a0;line-height:1.6;margin:0;">
      If you didn't request this, you can safely ignore this email — your password
      won't change. This link expires after a short time.
    </p>
  </div>
  <p style="font-size:12px;color:#9089a0;line-height:1.6;margin:20px 0 0;text-align:center;">
    Davis Digital Studio · Los Angeles · eric@davisdigitalstudio.com
  </p>
</div>
```

---

## Note on sender address
By default these come from Supabase's mail server. If you want them to come from `noreply@davisdigitalstudio.com` (more trustworthy, less likely to hit spam), you'd set up custom SMTP in Supabase → Authentication → SMTP Settings, pointing at Resend (which you already use). That's optional and a separate step — the templates above work either way.
