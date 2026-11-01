# Runbook: incident response and breach notification

For any suspected security incident: unauthorised access, a leaked secret, data sent to the
wrong hospital, a lost device with access, malware on a server, or a vulnerability report.

> **Legal review needed.** Notification duties below follow the Digital Personal Data
> Protection Act 2023 and its Rules as understood at the time of writing. Legal counsel must
> confirm deadlines, recipients and templates before the first real hospital goes live, and
> review the contracts with hospitals (who is data fiduciary, who is processor).

## Roles

| Role                   | Who (fill in before go-live) | Responsibility                                            |
| ---------------------- | ---------------------------- | --------------------------------------------------------- |
| Incident lead          |                              | Runs the response, decides severity, keeps the timeline   |
| Technical lead         |                              | Containment, investigation, fixes                         |
| Communications / legal |                              | Notifications to hospitals, the Board and affected people |
| Product owner          |                              | Approves notifications and customer communication         |

Anyone who suspects an incident reports it to the incident lead **at once** — never in a
public issue, chat channel or with a customer before the lead decides.

## Severity

| Level | Examples                                                                                                  | Start within  |
| ----- | --------------------------------------------------------------------------------------------------------- | ------------- |
| SEV-1 | Personal or health data exposed outside its hospital; cross-tenant access; signing key or database leaked | Immediately   |
| SEV-2 | Account takeover of one user; secret leaked without evidence of use; exploitable vulnerability reported   | 4 hours       |
| SEV-3 | Suspicious activity without data access; vulnerability without known exploit                              | 1 working day |

## Response steps

1. **Open a record** (private): time detected, who reported it, what is known. Keep a
   timeline of every action from now on. Never copy patient data into the record — use IDs.
2. **Contain.** Choose what fits:
   - end a user's sessions: the Hospital Admin disables the account (ends every session at
     once), or the user signs out everywhere (`POST /auth/logout-all`);
   - suspend a hospital (Super Admin console) — ends all its sessions at once;
   - revoke a break-glass grant (hospital console);
   - rotate a leaked secret immediately ([secret-rotation.md](secret-rotation.md), "if leaked");
   - take the API offline if cross-tenant data access is suspected and not yet understood.
3. **Preserve evidence** before changing more: database audit tables (`audit_events`,
   `platform_audit_events`), session rows (kept 90 days after they end), server and proxy
   logs, and a database snapshot. Do not delete anything.
4. **Investigate:** what happened, since when, which hospitals, which records and people.
   The audit logs record actor, action, target ID, IP and time for every sign-in and
   administrative change.
5. **Fix** the cause, with a regression test; deploy.
6. **Notify** (below).
7. **Review** within two weeks: what failed, what to change. Update the
   [threat model](../threat-model.md) and this runbook.

## Notification (personal data breach)

Under the DPDP Act a personal data breach must be reported to the **Data Protection Board of
India** and to **each affected person**. As we understand the DPDP Rules (counsel to
confirm), an initial report is due without delay and a detailed report within **72 hours**
of becoming aware.

- Kenisha is expected to act as a data **processor** for hospitals: tell the affected
  hospitals first, without delay, with what is known; agree with each who notifies patients.
- Contracts with hospitals must state these duties before go-live.
- For markets outside India, add the local rules (GDPR: supervisory authority within 72
  hours; HIPAA: breach notification rule) before launching there.

### What a notification contains

- What happened and when it was discovered.
- What kinds of data were involved (never the data itself).
- Likely consequences for the people affected.
- What has been done and what people should do (for example: watch for messages claiming
  to be from the hospital; never share a login code).
- A contact for questions.

Templates: to be prepared with counsel before go-live.

## Vulnerability reports from outside

Acknowledge within 2 working days, assess severity as above, fix, and tell the reporter
when it is resolved. Never threaten good-faith reporters.
