# Deployment (no Docker)

SocialPilot runs as two long-lived Node processes, the **API** and the **worker**, plus static files for the **web app**. The worker is what keeps scheduled and queued work running 24/7, so deploy to a machine that stays on.

## 1. Database: Supabase

1. Create a Supabase project.
2. Project Settings → Database → Connection string:
   - `DATABASE_URL`: the **Session pooler** URI (port **5432**).
   - `DIRECT_URL`: the **Direct connection** URI if the server has IPv6, otherwise the same session-pooler URI.
   - Don't use the transaction pooler (port 6543). The pg-boss queue and `LISTEN/NOTIFY` events need session connections.
3. Optional storage: create a **private** bucket named `socialpilot`, then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API). The service-role key stays on the server; it is never sent to the browser.

## 2. Server

Any Linux VPS (or a Windows machine that stays on) with Node.js 20.11+.

```bash
git clone <your repo> socialpilot
```

```bash
cd socialpilot
```

```bash
npm ci
```

Create `.env` from `.env.example`. Use new values for `ENCRYPTION_KEY` and `SESSION_SECRET`, and set `NODE_ENV=production`, `WEB_ORIGIN=https://your-domain`, and the Supabase URLs. **Back up `ENCRYPTION_KEY`**: without it, stored provider keys and tokens can't be decrypted.

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run build
```

### Process manager (pm2)

```bash
npm install -g pm2
```

```bash
pm2 start "npm run start -w @sp/api" --name socialpilot-api
```

```bash
pm2 start "npm run start -w @sp/worker" --name socialpilot-worker
```

```bash
pm2 save
```

```bash
pm2 startup
```

Run **one** worker process (the default `WORKER_MODE=single`). On start, it immediately retries jobs that a crashed worker left half-done. If you ever run several workers, set `WORKER_MODE=multi` on each. Abandoned jobs are then retried after 10 minutes instead.

On Windows, `pm2` works too; alternatively register the two commands as services with NSSM.

### Reverse proxy (Caddy example)

Serve `apps/web/dist` and proxy `/api` (including the SSE stream) to the API on `127.0.0.1:4000`:

```
your-domain.com {
  encode gzip
  handle /api/* {
    reverse_proxy 127.0.0.1:4000 {
      flush_interval -1
    }
  }
  handle {
    root * /srv/socialpilot/apps/web/dist
    try_files {path} /index.html
    file_server
  }
}
```

The API sets the session cookie as `Secure` when `NODE_ENV=production`, so serve the site over HTTPS (Caddy does this automatically).

## 3. Backups and recovery

- Supabase runs daily backups on paid plans. On the free plan, schedule a `pg_dump` from the server (a cron job or a Windows Task Scheduler entry):
  ```bash
  pg_dump "$DIRECT_URL" --format=custom --file=socialpilot-$(date +%F).dump
  ```
- Restore with `pg_restore --clean --dbname "$DIRECT_URL" <file>`.
- Keep `.env`, and especially `ENCRYPTION_KEY`, in a password manager.

## 4. Updating

```bash
git pull
```

```bash
npm ci
```

```bash
npm run db:migrate
```

```bash
npm run build
```

```bash
pm2 restart socialpilot-api socialpilot-worker
```

Tasks that were running during the restart are resumed automatically by the worker.
