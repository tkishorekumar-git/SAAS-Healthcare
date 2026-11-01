# Runbook: data retention and erasure

What the platform keeps, for how long, and how people's rights under the Digital Personal
Data Protection Act 2023 (DPDP) are handled.

> **Legal review needed.** Clinical record retention is set by law and professional rules
> (for example the Clinical Establishments rules and medical council regulations; paediatric
> records usually longer, until well after the child reaches adulthood). **No clinical data
> is ever deleted automatically until legal counsel has confirmed the periods** and they are
> recorded here. That confirmation is required before Milestone 6 stores records.

## Authentication data (automated, Milestone 5a)

The API deletes these every hour (`AUTH_DATA_PURGE_INTERVAL_MINUTES`). PostgreSQL policies
make sure the clean-up can only touch rows already past retention.

| Data                             | Kept for                                       | Why                                    |
| -------------------------------- | ---------------------------------------------- | -------------------------------------- |
| One-time login codes (HMAC only) | 1 day after expiry                             | Rate-limit history for the current day |
| Sessions (IP, user agent, times) | 90 days after they end                         | Investigating account takeover         |
| Super Admin sessions             | 90 days after they end                         | Same                                   |
| Staff invitations (name, phone)  | 90 days after acceptance, cancellation, expiry | Support questions about invitations    |
| Known devices (hash only)        | 365 days after last use                        | New-device alerts                      |

## Kept until a decision with counsel

| Data                                | Current rule                                    |
| ----------------------------------- | ----------------------------------------------- |
| Audit logs (hospital and platform)  | Kept; never deleted by the application          |
| Staff accounts                      | Disabled, never deleted (audit references them) |
| Patient and guardian accounts       | Kept                                            |
| Hospitals (tenants)                 | Suspended, never deleted                        |
| Clinical records (from Milestone 6) | Kept                                            |

## Rights of data principals (DPDP Act)

Kenisha is expected to act for the hospital (processor); the hospital receives and decides
requests. Kenisha must give hospitals the tools to answer them.

| Right               | How it is handled today                                           | Tooling still needed            |
| ------------------- | ----------------------------------------------------------------- | ------------------------------- |
| Access / summary    | Hospital Admin can view staff records; patient view comes with M6 | Patient data export (M6)        |
| Correction          | Hospital Admin edits staff details; patient details in M6         | Patient profile editing (M6)    |
| Erasure             | Accounts can be disabled; erasure must respect legal retention    | Erasure workflow after counsel  |
| Grievance redressal | Hospital's grievance officer; Kenisha supports on request         | Contact published before launch |
| Nominate            | Not yet supported                                                 | Decide with counsel             |

## Erasure procedure (until tooling exists)

1. The hospital confirms the person's identity and that no legal retention duty applies.
2. A Kenisha engineer, with a written request from the Hospital Admin, runs a reviewed
   one-off migration-role script that removes or anonymises the person's rows in that
   tenant only. The script and its result (counts, IDs) are kept with the request.
3. Backups age out on their normal schedule (5b); the request record notes the date after
   which no backup contains the data.

## Backups

Defined in Milestone 5b (encrypted, off-site, restore-tested). Backup retention must not
exceed the longest legal retention period without a reason recorded here.
