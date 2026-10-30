## Summary

<!-- What does this change and why? Link the milestone/issue. -->

## Checklist

- [ ] `pnpm check` passes locally
- [ ] Tests added or updated (unit and, for API changes, e2e)
- [ ] No secrets, credentials or real patient data in code, tests, fixtures or logs
- [ ] New environment variables documented in `docs/environment.md` and `.env.example`
- [ ] Schema changes ship as a new migration with `tenant_id` + RLS policies
- [ ] Tenant-scoped queries cannot read or write another tenant's data
- [ ] Architectural changes have an approved ADR in `docs/architecture/adr/`
