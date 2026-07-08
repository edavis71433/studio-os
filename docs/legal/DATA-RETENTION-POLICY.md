# Data Retention Policy

How long Studio OS Presence keeps each kind of data. Verified against the implementation ([Data Governance & Privacy Audit](../presence/DATA-GOVERNANCE-PRIVACY-AUDIT.md) §12).

| Data | Retention | Notes |
|---|---|---|
| Business content (identity, offerings, FAQs, posts, etc.) | **Until you delete it** | Deleting marks it removed; see below |
| Media (photos) | **Until you delete it** | Deleting removes the image file from storage; the metadata row is retained marked-deleted |
| Brand profile, knowledge documents | **Until you delete them** | |
| Published site versions & snapshots | **Retained indefinitely** | Powers "every version kept" + restore (an ownership guarantee) |
| Audit / change log | **Retained indefinitely** (append-only) | Records field names, never values; supports traceability |
| Connected-service tokens & cached read data | **Deleted immediately on disconnect** | Read cache is one-deep (prior overwritten) |
| AI drafts / visual generations (unapproved) | Ephemeral / until discarded | Approved outputs become your content |
| Signup verification token | Single-use / short-lived | |
| Billing records (invoices, subscription state) | Retained per **[[OWNER: tax/accounting law, e.g. 7 years]]** | Legal-retention exception |
| Account (on deletion request) | Removed within **[[OWNER: e.g. 30]]** days | See [Account Deletion Policy](ACCOUNT-DELETION-POLICY.md) |

## Principles
- **No automatic purge/TTL** deletes your working data — it stays until you or we (on your instruction) delete it. This is deliberate: your presence should not silently disappear.
- **Soft-delete:** deleting content marks the record removed; media *files* are removed from storage on delete. A background purge of long-soft-deleted rows is a planned enhancement — until then, soft-deleted rows persist. *(Owner: state whether soft-deleted metadata is included in an erasure request — recommended: yes, on account deletion.)*
- **Legal holds:** we may retain limited data where required by law (e.g. billing/tax), even after deletion.
- **Backups:** platform backups (point-in-time recovery) may retain copies for the backup window before rolling off.

**[[OWNER: confirm the exact windows above with counsel and your accounting requirements.]]**
