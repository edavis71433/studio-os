# Security Statement

How Studio OS Presence protects your data. Every measure below is implemented and test-covered; see the [Security](../presence/SECURITY.md) doc and the [Data Governance & Privacy Audit](../presence/DATA-GOVERNANCE-PRIVACY-AUDIT.md).

## Access control & isolation
- **Deny-all by default.** Every data table enforces row-level security with no open policies; all access is mediated by the application and scoped to your own workspace. One customer can never see another's data.
- **Tenant, organization, and agency isolation** are enforced from your signed-in identity, not from anything a caller can spoof.
- **Least privilege.** Operator and customer actions are separated; operator surfaces require staff authorization; service-role access never grants operator privileges by itself.

## Authentication & authorization
- Signed-in access via verified session tokens; every request is authenticated and authorized before it touches data.
- Approval-gated changes: anything that changes the world outside your draft (publishing, connected writes, infrastructure, org rollouts) requires an explicit, recorded approval, enforced in the database and executed exactly once.

## Encryption
- **In transit:** HTTPS across the application and published sites.
- **Sensitive secrets:** connected-service tokens are encrypted with **AES-256-GCM** and stored separately from your other data; they are never returned to any client, and the encryption fails closed (no key → no plaintext, never a fake success).
- **At rest:** database and file storage encryption managed by our hosting provider (Supabase).

## Auditability
- An **append-only audit log** records every change as *which fields changed* — never their values — providing traceability without exposing content.

## Data handling
- **No payment-card data** is stored (Stripe processes payments).
- **AI** receives only business facts or text prompts — never credentials or your photos.
- **Media** published to your site has location/EXIF metadata stripped.

## Resilience & recovery
- Point-in-time backups (verify quarterly); versioned publishing with restore; the customer export is an independent backstop. See [Deployment & Operations](../presence/DEPLOYMENT-AND-OPERATIONS.md).

## Testing & verification
- Automated test suites (pure + live-staging integration) cover the security boundaries; a set of machine-enforced invariants prevents architectural regressions.

## Responsible disclosure
Report a suspected vulnerability to **[[OWNER: security@…]]**. We will acknowledge and remediate; please give us reasonable time before public disclosure.

## Pending (stated honestly)
A **formal third-party penetration test and accessibility audit are recommended and pending** before public launch. The structural controls above are in place and verified in code; the independent live assessments are a scheduled pre-launch step.
