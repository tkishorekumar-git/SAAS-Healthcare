# Automated security scanning

Every push and pull request runs the **Security scans** job in
[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) (ADR-0005). The tools run from
pinned container images; nothing is installed into the repository. Any finding fails the
build.

| Scan                | Tool (pinned)      | Covers                                      | Configuration                                |
| ------------------- | ------------------ | ------------------------------------------- | -------------------------------------------- |
| Secrets             | gitleaks v8.21.2   | The **whole git history**, every file       | [`.gitleaks.toml`](../../.gitleaks.toml)     |
| Dependencies (npm)  | OSV-Scanner v1.9.2 | `pnpm-lock.yaml`                            | [`osv-scanner.toml`](../../osv-scanner.toml) |
| Dependencies (Dart) | OSV-Scanner v1.9.2 | `apps/mobile/pubspec.lock` (Flutter job)    | same                                         |
| Code                | Semgrep CE 1.95.0  | TypeScript, Node, React, secrets rule packs | [`.semgrepignore`](../../.semgrepignore)     |
| Container images    | Trivy              | Production images                           | Milestone 5b                                 |

Dependabot (weekly) proposes updates for npm, pub and GitHub Actions.

## When a scan fails

- **gitleaks:** treat it as a leaked secret even if the commit is old: rotate the secret
  first ([runbooks/secret-rotation.md](runbooks/secret-rotation.md)), then remove it. Rewriting
  history does not un-leak a pushed secret. Add an allow-list entry only for values that are
  provably not secrets (placeholders, synthetic test data), with a comment saying why.
- **OSV-Scanner:** update the dependency. If no fix exists or it is not exploitable here, add
  an entry to `osv-scanner.toml` with the advisory ID, a reason, and an `ignoreUntil` date at
  most 90 days away. The build fails again after that date.
- **Semgrep:** fix the code. For a false positive, add a `// nosemgrep: <rule-id>` comment on
  that line with a short reason. Never disable a whole rule pack.

## Running locally

Docker is needed for the same images CI uses (run from the repository root):

```bash
docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.21.2 git /repo --config /repo/.gitleaks.toml --redact
```

```bash
docker run --rm -v "$PWD:/src" ghcr.io/google/osv-scanner:v1.9.2 --config=/src/osv-scanner.toml --lockfile=/src/pnpm-lock.yaml
```

```bash
docker run --rm -e HOME=/tmp -v "$PWD:/src" -w /src semgrep/semgrep:1.95.0 semgrep scan --metrics=off --config p/typescript --config p/nodejs --config p/react --config p/secrets
```

### Optional pre-commit hook for secrets

To stop a secret before it is committed, save this as `.git/hooks/pre-commit` (not tracked
by git) and make it executable:

```bash
#!/bin/sh
exec docker run --rm -v "$PWD:/repo" ghcr.io/gitleaks/gitleaks:v8.21.2 git /repo --staged --config /repo/.gitleaks.toml --redact --no-banner
```

## Updating the pinned versions

Bump the image tags in `ci.yml` and this page together, in their own pull request, so a new
rule set's findings are reviewed on their own.
