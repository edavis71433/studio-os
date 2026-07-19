# DNS one-stop shop — Eric's one-time setup (slice D1 runbook)

D1 shipped the Route 53 backend adapter + zone lifecycle **dormant and
fail-closed**: until the secrets below exist, every `/foundations/zone*`
route answers an honest 503 ("DNS management isn't switched on yet") and the
platform behaves exactly as before (guided DNS). Nothing else needs to be
deployed, migrated, or configured — the switch is the secrets.

Spec: docs/design/DNS-ONE-STOP-SHOP.md · Decisions: OPEN-PUNCHLIST.md ("DNS
ONE-STOP SHOP — DECISIONS LOCKED").

## Step 1 — AWS account + least-privilege IAM user

1. Sign in (or create) the AWS account → IAM → **Users → Create user**
   (e.g. `studio-os-dns`). No console access needed — API keys only.
2. Attach an **inline policy** with exactly this JSON (least-privilege
   Route 53; add `route53domains:*` later only when D5 resale starts):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "StudioOsManagedDns",
      "Effect": "Allow",
      "Action": [
        "route53:CreateReusableDelegationSet",
        "route53:GetReusableDelegationSet",
        "route53:ListReusableDelegationSets",
        "route53:CreateHostedZone",
        "route53:DeleteHostedZone",
        "route53:GetHostedZone",
        "route53:ListHostedZones",
        "route53:ListHostedZonesByName",
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets",
        "route53:GetChange"
      ],
      "Resource": "*"
    }
  ]
}
```

3. **Create access key** for the user (use-case: "application running
   outside AWS") → copy the key pair once.

## Step 2 — set the function secrets

Supabase → Edge Functions → secrets (same place as `NETLIFY_AUTH_TOKEN` /
`RESEND_INBOUND_SECRET`):

| Secret | Value |
| --- | --- |
| `AWS_ACCESS_KEY_ID` | the access key id |
| `AWS_SECRET_ACCESS_KEY` | the secret access key |
| `AWS_REGION` | `us-east-1` (Route 53 is global; signing always uses us-east-1 — this is stored for future regional services) |

The moment the two keys exist, the automatic adapter is live: the contract
(`platform/contract.ts dnsFor()`) selects Route 53 over guided, and the
`/foundations/zone*` routes wake up. There is no other switch.

## Step 3 — the delegation set + the FOUR glue records (one time, ever)

The **reusable delegation set** (the fixed group of four AWS nameservers all
customer zones share — what makes branded nameservers possible) is created
**automatically on first use**: the first `GET /foundations/zone` or
`POST /foundations/zone` after the secrets land creates it idempotently
(fixed caller reference `studio-os-dds-delegation-v1`; it is never created
twice).

**Where the glue values appear:** call `GET /foundations/zone` on any site
(even one with no domain yet). The response's **`platform` section** lists:

- `delegation_set_id` — the set's id
- `aws_nameservers` — the four AWS nameservers
- `glue[]` — one entry per branded name:
  `{ host: "ns1.davisdigitalstudio.com", aws_ns: "<the matching AWS ns>", ips: [<the glue A/AAAA values>], branded_ips: [<what ns1… answers today>] }`
- `branded_ready` — true once the branded names resolve correctly

**Do this once at YOUR registrar, for davisdigitalstudio.com:** create four
glue records (registrars call this "register a nameserver", "host records",
or "child nameservers"):

| Nameserver host | Points at |
| --- | --- |
| `ns1.davisdigitalstudio.com` | every IP in `glue[0].ips` |
| `ns2.davisdigitalstudio.com` | every IP in `glue[1].ips` |
| `ns3.davisdigitalstudio.com` | every IP in `glue[2].ips` |
| `ns4.davisdigitalstudio.com` | every IP in `glue[3].ips` |

(If the registrar's glue UI is limited, plain A/AAAA records for
`ns1`–`ns4` in davisdigitalstudio.com's own DNS work as well for our
white-label purpose.) Once `branded_ready` flips true, new zones are stamped
with `ns1–ns4.davisdigitalstudio.com` automatically and customers only ever
see your brand. Zones created before that keep working on the AWS names.

## What happens per customer (no action from you)

`POST /foundations/zone` on a site with a domain: DNSSEC DS pre-check
(blocks with guidance if DS present) → record scan over the fixed name list
→ pre-migration snapshot → zone created in the delegation set → scanned
records imported **before** anything is handed to the customer → site
records placed (apex A 75.2.60.5, www CNAME, `_dds-verify` TXT when a token
exists) → the customer changes nameservers at their registrar (the only
thing they ever do). `GET /foundations/zone` then walks
`dns_pending → ns_pending → ssl_pending → live`, re-triggering the Netlify
certificate the moment delegation is detected. Costs: $0.50/zone/mo for the
first 25 zones, $0.10 after, plus pennies of queries.

## Deferred (not this slice)

- **Name.com Core API** (D5 in-app domain resale): needs a Name.com account
  + API token — nothing to do until D5 starts.
- `route53domains` IAM permissions — only with D5.
- DNSSEC **signing** of customer zones: the adapter honestly declares
  `dnssec: 'guided'`; the DS pre-check + guidance is what D1 ships.
