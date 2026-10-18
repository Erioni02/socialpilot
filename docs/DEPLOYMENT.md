# Deployment

## Docker Compose (recommended)

```bash
cp .env.example .env
```

In `.env`, set:

- `ENCRYPTION_KEY` and `SESSION_SECRET` (each from `pnpm gen:key` or `openssl rand -base64 32`)
- `APP_URL=https://social.example.com`
- `API_PUBLIC_URL=https://social.example.com`
- `PUBLIC_BASE_URL=https://social.example.com`
- `POSTGRES_PASSWORD=<strong password>`
- `ALLOW_REGISTRATION=false` (after creating your account)

Then start the stack:

```bash
docker compose up -d --build
```

Services: `postgres` (17), `redis` (7, AOF persistence), `api` (applies migrations on start, serves the web app and API on :4000) and `worker` (always on; runs jobs and the scheduler). Put a TLS reverse proxy in front of port 4000, such as Caddy, Nginx or a cloud load balancer. With a single domain, `APP_URL` and `API_PUBLIC_URL` are the same.

Keep the worker running 24/7. Autopilot, scheduled publishing, token refresh and syncs all happen there. You can run several worker replicas: job claiming is atomic.

## Without Docker

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm db:generate
```

```bash
pnpm build
```

```bash
pnpm db:migrate
```

Then run `node apps/api/dist/index.js` and `node apps/worker/dist/index.js` under a process manager (systemd, pm2). FFmpeg must be on PATH, or set `FFMPEG_PATH` and `FFPROBE_PATH`.

## Backups and recovery

- **Database:** schedule `pg_dump -Fc socialpilot > socialpilot-$(date +%F).dump` (for example daily via cron), copy dumps off-host, and test restores with `pg_restore -d socialpilot_restore <file>`.
- **Media:** back up the `storage` volume (`STORAGE_DIR`). Asset versions are immutable files, so incremental backups (restic, rsync) work well.
- **Secrets:** back up `ENCRYPTION_KEY` securely. Without it, stored OAuth tokens and API keys can't be decrypted, and you would have to reconnect integrations.
- **Redis** holds only dispatch state. It can be lost: the worker re-dispatches overdue jobs from Postgres.

## Website deploy safety

SocialPilot never pushes to your default branch. Code changes go to `socialpilot/*` branches as pull requests. Merging needs your confirmation (or an approval for agents), and production promotion on Vercel goes through approvals by default. To roll back, use **Website → Deployments → Roll back** (Vercel instant rollback) or revert the merge commit shown after a merge.

## Upgrading

```bash
git pull
```

```bash
docker compose up -d --build
```

Migrations run automatically when the API starts.
