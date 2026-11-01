# Runbook: build a server from scratch

Builds the **staging** application server and the **backup** server (ADR-0006). Production
is built the same way later with `DEPLOYMENT_ENV=production` and a real SMS provider.
Allow about two hours the first time. Everything here uses synthetic data only.

You need: two Hostinger KVM VPSes in an **India** data centre with Ubuntu 24.04 LTS, a
domain whose DNS you control, your SSH public key, and admin access to the GitHub
repository.

Commands run as root on the server unless noted. `<…>` marks values you choose.

## 1. Both servers: base hardening

```bash
apt-get update && apt-get -y full-upgrade
apt-get -y install unattended-upgrades ufw fail2ban rsync acl cryptsetup
dpkg-reconfigure -plow unattended-upgrades
adduser --disabled-password --gecos '' ops && usermod -aG sudo ops
install -d -m 700 -o ops -g ops /home/ops/.ssh   # then put your public key in authorized_keys
```

In `/etc/ssh/sshd_config.d/kenisha.conf`:

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers ops deploy kenisha-backup
```

`systemctl reload ssh` — **test a second SSH session as `ops` before closing the first.**

Firewall:

```bash
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp   # application server only
ufw enable
```

Set the server clock to UTC: `timedatectl set-timezone UTC`.

## 2. Both servers: encrypted data volume

Hostinger VPS disks are not encrypted for you. Create an encrypted volume for all data.
Use a second disk if the plan has one; otherwise a file-backed volume (shown):

```bash
fallocate -l <40G> /var/kenisha.img
cryptsetup luksFormat /var/kenisha.img          # passphrase: store OFFLINE
cryptsetup open /var/kenisha.img kenisha_data
mkfs.ext4 /dev/mapper/kenisha_data
mkdir -p /srv && mount /dev/mapper/kenisha_data /srv
```

After every reboot the operator unlocks it (`cryptsetup open …` then `mount …`) before
starting the stack. This is deliberate: a copied disk image is unreadable without the
passphrase. Record the volume in the operations log.

## 3. Application server

### Docker and directories

Install Docker Engine from Docker's official apt repository (docs.docker.com, "Install
Docker Engine on Ubuntu"). Then:

```bash
install -d -m 755 /opt/kenisha /opt/kenisha/bin /opt/kenisha/caddy
install -d -m 700 /etc/kenisha
install -d /srv/kenisha/postgres /srv/kenisha/pgbackrest /srv/kenisha/caddy/data /srv/kenisha/caddy/config
chown 999:999 /srv/kenisha/postgres /srv/kenisha/pgbackrest   # postgres user in the image
```

Copy from the repository (same commit you will deploy):

| From                                                  | To                              | Mode |
| ----------------------------------------------------- | ------------------------------- | ---- |
| `deploy/compose.yml`                                  | `/opt/kenisha/compose.yml`      | 0644 |
| `deploy/caddy/Caddyfile`                              | `/opt/kenisha/caddy/Caddyfile`  | 0644 |
| `deploy/scripts/deploy.sh`                            | `/opt/kenisha/bin/deploy.sh`    | 0755 |
| `deploy/scripts/pg-backup.sh`                         | `/opt/kenisha/bin/pg-backup.sh` | 0755 |
| `deploy/env/release.env.example`                      | `/opt/kenisha/release.env`      | 0644 |
| `deploy/env/{api,migrate,postgres,redis}.env.example` | `/etc/kenisha/*.env`            | 0600 |

`echo 'REGISTRY=ghcr.io/<github-owner-lowercase>' > /opt/kenisha/registry.env`

### DNS

Create `A` records for `staging-app.<domain>` and `staging-api.<domain>` pointing to the
server's IP. Put the host names and an operations email in `/opt/kenisha/release.env`.

### Secrets

Generate every value **on the server**; never paste them into chat, tickets or GitHub.

```bash
openssl rand -base64 33   # one per password: kenisha_app, kenisha_platform, kenisha_migrator,
                          # postgres superuser, redis, pgBackRest cipher passphrase
```

For the four API secrets, run `pnpm --filter @kenisha/api auth:secrets` on a trusted
machine with the repository, copy the lines into `/etc/kenisha/api.env`, then clear the
terminal. Write the pgBackRest passphrase and the LUKS passphrase into your offline store
**now**: backups cannot be restored without them.

### Registry access

Create a GitHub fine-grained token with **read-only** access to packages, then:
`docker login ghcr.io -u <github-user>` (paste the token). Nothing else on the server can
write to the registry.

### First start

```bash
cd /opt/kenisha
# Pull the images of the commit to run and write their digests into release.env:
/opt/kenisha/bin/deploy.sh <commit-sha>     # expected to fail at "migrate" the first time
```

The first run is expected to fail at the migration step, because the database roles do
not exist yet (its attempt to roll back to the template release also fails; nothing was
running, so nothing is lost). Create the roles once with the project's own bootstrap script (the same
code as `pnpm db:bootstrap` locally). Write a temporary `/etc/kenisha/bootstrap.env`
(0600) with the superuser URL and the three role URLs from your other env files:

```
NODE_ENV=production
DATABASE_ADMIN_URL=postgresql://kenisha_admin:<superuser password>@postgres:5432/kenisha
MIGRATION_DATABASE_URL=<as in migrate.env>
APP_DATABASE_URL=<DATABASE_URL from api.env>
PLATFORM_DATABASE_URL=<PLATFORM_DATABASE_URL from api.env>
```

```bash
source /opt/kenisha/release.env
docker run --rm --network kenisha_internal --env-file /etc/kenisha/bootstrap.env \
  --read-only --tmpfs /tmp -w /repo/packages/database "$MIGRATE_IMAGE" \
  node_modules/.bin/tsx scripts/bootstrap-roles.ts
shred -u /etc/kenisha/bootstrap.env      # it holds the superuser password
```

Then run `deploy.sh <commit-sha>` again: it migrates, starts everything and waits for
readiness.

Check: `https://staging-app.<domain>/api/v1/health/ready` returns `"status":"ok"`, and
[SSL Labs](https://www.ssllabs.com/ssltest/) rates the host A or better with HSTS.

Create the first Super Admin from a trusted machine with an SSH tunnel to PostgreSQL, or
by running `platform:create-admin` inside a one-off container — see
[secret-rotation.md](secret-rotation.md) for handling the printed authenticator secret.

### Backups (pgBackRest)

```bash
docker compose --env-file release.env exec -T -u postgres postgres pgbackrest --stanza=kenisha stanza-create
docker compose --env-file release.env exec -T -u postgres postgres pgbackrest --stanza=kenisha check
/opt/kenisha/bin/pg-backup.sh full
```

Root's crontab (`crontab -e`):

```
15 2 * * 0   /opt/kenisha/bin/pg-backup.sh full >> /var/log/kenisha-backup.log 2>&1
15 2 * * 1-6 /opt/kenisha/bin/pg-backup.sh diff >> /var/log/kenisha-backup.log 2>&1
```

### Read-only access for the backup server

```bash
adduser --disabled-password --gecos '' kenisha-backup
setfacl -R -m u:kenisha-backup:rX /srv/kenisha/pgbackrest
setfacl -R -d -m u:kenisha-backup:rX /srv/kenisha/pgbackrest
```

In `/home/kenisha-backup/.ssh/authorized_keys` (one line; the key is created on the backup
server in section 4):

```
command="/usr/bin/rrsync -ro /srv/kenisha/pgbackrest",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,restrict <backup server's public key>
```

### Deployments from GitHub

```bash
adduser --disabled-password --gecos '' deploy
echo 'deploy ALL=(root) NOPASSWD: /opt/kenisha/bin/deploy.sh' > /etc/sudoers.d/kenisha-deploy
chmod 440 /etc/sudoers.d/kenisha-deploy
```

Create a key pair **on your machine** (`ssh-keygen -t ed25519 -f kenisha-deploy`). In
`/home/deploy/.ssh/authorized_keys`:

```
command="sudo /opt/kenisha/bin/deploy.sh \"$SSH_ORIGINAL_COMMAND\"",restrict <kenisha-deploy.pub>
```

In GitHub: Settings → Environments → **New environment `staging`** → _Required
reviewers: you_. Add environment secrets `DEPLOY_HOST` (server IP), `DEPLOY_SSH_KEY`
(private key) and `DEPLOY_KNOWN_HOSTS` (`ssh-keyscan <ip>` output, checked against the
server's real host key). Delete the private key from your machine afterwards.

Deploy: Actions → **Deploy** → _Run workflow_ with a commit SHA whose **Images** workflow
passed → approve.

## 4. Backup server

```bash
install -d -m 700 /etc/kenisha-backup /opt/kenisha-backup /srv/kenisha-backup
ssh-keygen -t ed25519 -N '' -f /root/.ssh/kenisha_pull   # public key goes to the app server
ssh-keyscan <app server ip> >> /root/.ssh/known_hosts      # verify the fingerprint
```

Install Docker (for restore tests) as on the application server, and `docker login
ghcr.io` with a read-only token. Copy `deploy/scripts/backup-pull.sh` and
`restore-test.sh` to `/opt/kenisha-backup/` (0755). `/etc/kenisha-backup/backup.env`
(0600):

```
APP_HOST=<app server ip>
SSH_KEY=/root/.ssh/kenisha_pull
POSTGRES_IMAGE=ghcr.io/<owner>/kenisha-postgres@sha256:<digest from the app server's release.env>
CIPHER_FILE=/etc/kenisha-backup/cipher-pass
```

Put the pgBackRest passphrase in `/etc/kenisha-backup/cipher-pass` (0600). Root's crontab:

```
*/5 * * * * /opt/kenisha-backup/backup-pull.sh >> /var/log/kenisha-backup-pull.log 2>&1
30 4 1 * *  /opt/kenisha-backup/restore-test.sh
```

Run `backup-pull.sh` once by hand, then `restore-test.sh`, and check
`/var/log/kenisha-restore-tests.log` says `PASS`. Only port 22 is open on this server.

## 5. Record

In the operations log: server IPs, data-centre location, OS version, the first commit
deployed, the date of the first successful restore test, and where the LUKS and pgBackRest
passphrases are stored offline (never the values).
