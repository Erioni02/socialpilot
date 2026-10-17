# SocialPilot

A project-based AI business and marketing manager. **One project = one business + its website + social accounts + content + analytics + AI agents + automations.**

Cycle 1 (this release) delivers the foundation. You create a project from a website URL. SocialPilot crawls the site, runs basic SEO and accessibility checks, and has the AI draft a brand profile that you edit and confirm. You then land on a dashboard that shows only real data. All of this runs through a permission-checked tool registry, with approvals, budgets, an audit log, an emergency stop, and background jobs that survive restarts. Social accounts, media, website code, Discover and autopilot arrive in later cycles; see [docs/integrations-roadmap.md](docs/integrations-roadmap.md).

No Docker is needed. Everything runs as normal Node.js processes on Windows, macOS or Linux.

## Requirements

- **Node.js 20.11 or newer** (tested with 22), which includes npm
- **A PostgreSQL database**, either:
  - **Supabase** (recommended for anything you keep), or
  - **the built-in local database**: `npm run db:local` downloads and runs PostgreSQL as a plain process. No installer, no Docker.
- Optional: API keys for NVIDIA and/or Ollama Cloud for the AI features. They can be added in `.env` or in the app.

## First-time setup (Windows PowerShell or any terminal)

```bash
npm install
```

```bash
copy .env.example .env
```

(On macOS/Linux use `cp .env.example .env`.) Then open `.env` and set the following:

1. `ENCRYPTION_KEY` and `SESSION_SECRET`. Generate each with:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```
2. `OWNER_EMAIL` and `OWNER_PASSWORD` (at least 12 characters). This is your login.
3. The database:
   - **Local:** keep the default `DATABASE_URL` and `DIRECT_URL` (`postgresql://sp:sp@localhost:5432/socialpilot`).
   - **Supabase:** in Project Settings → Database → Connection string, use the **Session pooler** URI (port 5432) for `DATABASE_URL`. For `DIRECT_URL`, use the **Direct connection** URI, or the same session-pooler URI if your network has no IPv6. Don't use the transaction pooler (port 6543): the job queue and live updates need a session connection.
4. Optional AI keys: `NVIDIA_API_KEYS`, `OLLAMA_API_KEYS` (comma-separated).

If you use the local database, start it in its own terminal and leave it running:

```bash
npm run db:local
```

Then create the tables and your owner account:

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

## Run it

Start the API, the background worker and the web app together:

```bash
npm run dev
```

Open http://localhost:5173 and sign in with `OWNER_EMAIL` / `OWNER_PASSWORD`.

To run them in separate terminals instead:

```bash
npm run dev:api
```

```bash
npm run dev:worker
```

```bash
npm run dev:web
```

| Process | URL / role |
|---|---|
| Web (Vite + React) | http://localhost:5173 (proxies `/api` to the API) |
| API (Fastify) | http://127.0.0.1:4000, docs at http://localhost:5173/api/docs |
| Worker (pg-boss) | Runs queued tool jobs; keeps working while you're offline |
| Local DB (optional) | `npm run db:local`, PostgreSQL 17 on port 5432, data in `.data/postgres` |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | API + worker + web with auto-reload |
| `npm run db:local` | Local PostgreSQL without Docker (keep it running) |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Create or update the owner account (safe to re-run; also resets the password from `.env`) |
| `npm run db:generate` | Regenerate the Prisma client. Run this if `npm install` printed "prisma generate was skipped" (Windows locks the engine while servers run) |
| `npm test` | All unit and integration tests. They need the database running and use the separate `socialpilot_test` database |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run build` | Production build of the web app (`apps/web/dist`) |
| `npm run e2e` | Playwright end-to-end test against the real stack (first time: `npx playwright install chromium`) |
| `npm start` | API + worker without auto-reload, for servers |

For tests with Supabase, set `TEST_DATABASE_URL` to a **separate** database. The test helpers refuse to wipe any database whose name doesn't end in `_test`.

## Architecture

```
apps/web      React 19, Vite, Tailwind, shadcn/ui, TanStack Query; live updates over SSE
apps/api      Fastify + Zod REST API, session auth, CSRF, rate limits, OpenAPI docs, SSE
apps/worker   pg-boss worker: runs queued tools, reconciles interrupted jobs on start
packages/db           Prisma schema + migrations, workspace-scoped access, owner seed
packages/tools        Tool registry, policy engine, budgets, executeTool(), audit, queue, events
packages/ai           NVIDIA → Ollama failover (provider → model → key), untrusted-content wrapping
packages/integrations SSRF-safe fetcher, page extraction, basic checks, crawler
packages/crypto       AES-256-GCM secret encryption, secret redaction
packages/shared       Zod schemas and types shared by all of the above
scripts/local-db.mjs  Embedded PostgreSQL for local development
```

**The safety model.** Every action, whether from a UI button or the AI, goes through `executeTool()` in this order:

1. input validation
2. the emergency stop (workspace and project)
3. permission and autonomy level
4. budget
5. approval, or run/enqueue
6. a redacted audit log entry

No tool can change permissions, read secrets, or run shell commands. Raising autonomy requires typing the project name. Publishing, replies, merges, production deploys and media spend need approval by default. Website text is passed to models as delimited untrusted data. User-supplied URLs are fetched with SSRF protection (public addresses only, re-checked on every redirect, DNS pinned).

**Background work without Redis.** Jobs live in Postgres (pg-boss), and live events use Postgres `LISTEN/NOTIFY`. Tasks survive restarts. On startup the worker retries jobs that a crashed worker left half-done.

**Storage.** Uploads (project logos for now) go to Supabase Storage when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, otherwise to `STORAGE_DIR` on disk. They're always served through the authenticated API.

## Deploying

See [docs/deployment.md](docs/deployment.md): a Node server (Linux VPS or Windows) running the API and worker under a process manager, the built web app behind a reverse proxy, and Supabase for the database. No containers.

## More docs

- [docs/api.md](docs/api.md): API overview (the full reference is the live OpenAPI page at `/api/docs`)
- [docs/integrations-roadmap.md](docs/integrations-roadmap.md): what each integration needs from you, and when it arrives
- [docs/superpowers/specs/2026-10-17-socialpilot-design.md](docs/superpowers/specs/2026-10-17-socialpilot-design.md): design spec
