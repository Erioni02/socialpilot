# Architecture

```
apps/
  web/        React 19 + Vite + Tailwind v4 + TanStack Query (SPA; SSE for live updates)
  api/        Fastify 5 HTTP API (auth, project-scoped routes, OAuth callbacks, SSE, signed public media)
  worker/     Durable job runner + scheduler loop (publishing, syncs, agents, media, audits, automations)
packages/
  shared/     Isomorphic: enums, zod schemas, permission policy, capability registry, catalogs, pricing, UTM
  core/       Server utils: config/.env, AES-256-GCM crypto, PKCE, SSRF-safe fetch, redaction, errors, logger
  db/         Prisma schema, migrations, client, seed data
  ai/         Provider adapters: Anthropic (official SDK), OpenAI, Gemini, Replicate, Stability; JSON helper
  social/     Platform adapters: Instagram, TikTok, X (OAuth, metrics, posts, publish, comments, replies)
  integrations/ Website analyzer, PageSpeed, GitHub, Vercel, GA4, Plausible, Discover sources
  engine/     Business logic shared by API and worker: projects, policy gate, integrations, media (Sharp/FFmpeg),
              content, publishing, approvals, inbox, analytics, website code, Discover, agents, automations, jobs
```

## Data model highlights

`Project` owns everything: integrations, campaigns, posts (with `PostVersion` and per-platform `PostTarget`), assets (with `AssetVersion`), tasks (with `TaskStep`), approvals, inbox items, metric snapshots, website audits, code changes, opportunities, briefings, automations (with runs), notes and AI usage. Every project-scoped route loads the project with `ownerId = session user`, so cross-project access returns 404.

Secrets are never stored in plain text. `ProviderCredential.secretEnc` and `Integration.credentialsEnc` are AES-256-GCM encrypted with `ENCRYPTION_KEY`. API responses expose only hints.

## Jobs and scheduling

- `Job` rows in Postgres are the source of truth (status, attempts, backoff, dedupe key, result, error).
- Without Redis, workers claim jobs with `FOR UPDATE SKIP LOCKED`. With `REDIS_URL`, BullMQ dispatches job IDs and the worker claims the same row atomically.
- Stale `active` jobs (worker crash) are re-queued after 20 minutes. Overdue waiting jobs are re-dispatched to Redis. Work survives restarts.
- The scheduler tick runs every 30s and dispatches due post targets and due automations. Every 5 minutes it also schedules integration syncs (6h), inbox syncs (15 min), Discover refresh (hourly) and proactive token refresh. It cleans up periodically.

## Publishing safety

1. Scheduling creates `PostTarget` rows. Unsupported operations or disconnected accounts become `manual` handoffs with an explanation.
2. A publish job atomically moves a target `scheduled → publishing` (`updateMany where status = scheduled`). A second worker can't claim it.
3. Adapters persist provider state (Instagram container IDs, X thread IDs, TikTok publish IDs) through a checkpoint callback. Retries resume instead of re-posting.
4. Async platforms (TikTok) are polled until confirmed. Unconfirmed after 30 minutes means failed, with a duplicate warning.
5. Agent and automation posts honor daily post limits and publishing hours. The emergency stop and project pause defer publishing without failing it.

## Agents

`engine/agents/runner.ts` runs a tool-use loop. Claude uses the official SDK with streaming, adaptive thinking at `effort: medium`, the server-side refusal fallback, and append-only history so thinking blocks are preserved. OpenAI uses Chat Completions tools.

- Tools (`engine/agents/tools.ts`) are zod-validated and each declares a `permission` and an optional `paid` flag. `executeTool` re-reads the project for every call, so permission changes and the emergency stop apply mid-task. It then runs `guard()` (autonomy level ceiling ∩ granular toggle ∩ approvals) and redacts output.
- Outbound tools (schedule/publish, reply, merge, deploy) return `pendingApproval` unless the policy allows autonomy (level 4 with that approval explicitly disabled).
- Third-party content (web pages, comments, repo files, news) is wrapped in `<untrusted_content>`. The system prompt tells the model to treat it as data. No tool can change permissions, read env secrets or run shell commands.
- Budget: each model or media call checks daily/monthly project limits and the per-task budget before spending. Usage is recorded in `AiUsage`.
- Every step (plan, tool call, result, message, error, summary) is persisted in `TaskStep` and streamed to the UI over SSE.

## Permission model

`packages/shared/src/permissions.ts`:

- **Levels:** 1 Assistant (read), 2 Creator (+create, edit assets, spend, code proposals), 3 Marketing operator (+schedule, publish, reply, always with approval), 4 Controlled autopilot (+merge, deploy; approvals can be turned off one by one).
- Raising autonomy needs the typed phrase `ENABLE LEVEL N`. Disabling approvals needs `DISABLE APPROVALS`. Allowing auto-publish in an automation needs `ALLOW AUTO PUBLISH`. All changes are audit-logged.

## Real-time

The engine emits small events through Postgres `NOTIFY`. Each API instance `LISTEN`s and fans them out over `/api/events` (SSE), filtered to the user's projects. The web app maps event types to React Query invalidations.

## Security checklist

Argon2id passwords; random session tokens (sha256-hashed in the DB, httpOnly + SameSite cookies). CSRF requires the `x-socialpilot-csrf` header plus an origin allowlist. Helmet (CSP in production). Rate limits (global, stricter on auth). Zod validation everywhere. SSRF protection: DNS resolution with private-range blocking on every redirect hop, size and time caps. Uploads are checked by magic bytes against an allowlist and get server-generated storage keys. Public media uses HMAC-signed expiring links. Repo access blocks secret paths, workflow files and lockfiles. Secrets are redacted in logs, audit details and model inputs. Webhooks aren't used: platforms are polled, so there is no unauthenticated webhook surface.
