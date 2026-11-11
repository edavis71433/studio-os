# Sign-in and password emails (sales item 92)

Supabase sends these six emails itself (sign-in link and code, password reset,
invitation, sign-up confirmation, change of email, verification code). Their
words live in the Supabase dashboard, not in the code, so these files are the
record of what they should say. A test (`tests/presence/auth_emails_test.mjs`)
keeps them honest.

Read on Nov 11 2026 before rewording: the sign-in link and the three plain ones
had no look and vague words ("expires shortly"); the reset and invitation emails
named "your project portal", signed off with Eric's own address, and the
invitation said "I'll send a fresh one". Every one went out from the sender name
**Eric Davis**, whoever the client's studio was.

## Applying them (production, after Eric's OK)

Dashboard: project davis-digital-studio → Authentication → Emails → Templates.
For each one, paste the subject and the file's whole contents into Body
(Source), then Save changes.

| Template in the dashboard | Subject | File |
| --- | --- | --- |
| Magic link or OTP | `Your sign-in link` | `magic_link.html` |
| Reset password | `Reset your password` | `reset_password.html` |
| Invite user | `Set your password to get started` | `invite.html` |
| Confirm sign up | `Confirm your email address` | `confirm_signup.html` |
| Change email address | `Confirm your new email address` | `change_email.html` |
| Reauthentication | `{{ .Token }} is your verification code` | `reauthentication.html` |

Then Authentication → Emails → SMTP Settings: **Sender name** `Eric Davis` →
`Davis Digital Studio`, Save. The sender address stays as it is.

## Why they read the way they do

- The portal's sign-in page offers the link first and the 6-digit code second
  (portal.html), so the sign-in email does too; the code needs `{{ .Token }}`.
- Reset and invitation lead with the code and ask people to type
  davisdigitalstudio.com/set-password (it forwards to the app's set-password
  page): some email apps open links in advance and use them up.
- No studio's name: one template serves every studio's clients, so the words name
  nobody, and the footer is the platform's postal line, as on the product's own
  emails.
