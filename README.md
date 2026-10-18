# SocialPilot

A project-based AI operating system for running online businesses. **One project = one business + its website + social accounts + content + analytics + AI agents + automations.**

Create a project from a URL (e.g. `https://vibejudge.app`). SocialPilot crawls the public site and proposes a business profile. You link your Instagram, TikTok and X accounts by pasting their URLs (read-only analytics; SocialPilot never posts), and connect GA4 or Plausible, GitHub and Vercel. From there, AI agents do real work through controlled backend tools: study what performs, research sourced trends, generate and edit media, prepare finished posts on the Ready to post page for you to publish, audit the website and open pull requests. Your approval rules apply throughout.

## What's in the box

| Area | What it does |
|---|---|
| Projects & wizard | Multiple isolated projects. 8-step setup: name → URL → live website analysis → editable profile → integrations → AI providers → permissions → launch. |
| Command center | Website status (live check and latest audit), real analytics, followers, upcoming and published posts, inbox, trends, opportunities, running tasks, health and budget. A connect prompt appears wherever data is missing. |
| Integrations | Social accounts linked by URL (no OAuth, no posting) with account and post analytics. GA4 (Google OAuth), GitHub, Plausible and Vercel connections with encrypted tokens and connection tests. |
| AI Workspace | Media library with versions. Real Sharp edits (crop, resize, presets, format, brand overlays). AI edit, background removal and variations through OpenAI/Replicate/Stability. Video generation through Replicate. FFmpeg trim, reframe, subtitles (SRT or Whisper), concat, thumbnails and compression. Storyboards. Command bar for agents. |
| Content & campaigns | Multi-platform post editor with per-platform variants, threads, previews, AI assist (rewrite, translate, hooks, hashtags, CTA), quality and brand checks, and version history. AI campaign plans that become real drafts and images. |
| Ready to post & calendar | Timezone-aware planning; at the planned time each post appears on Ready to post with platform-ready media, caption and checklist. You post it and paste the link; its performance is then tracked automatically. |
| Inbox | Instagram comments and X mentions/replies, AI or keyword classification, escalation, reply drafts, approved replies, opt-in auto-replies, and a feedback summary. |
| Analytics | Social metrics, GA4/Plausible web analytics (kept separate), UTM campaign attribution and PageSpeed history. Insights keep measured facts separate from AI hypotheses. |
| Website | Evidence-based audit (SEO, accessibility, performance, links, conversion, security, PageSpeed). Repository browser. AI or manual code changes with diffs, pushed to new branches as PRs, with checks and preview URLs. Merges and production promotions are approval-gated, with rollback. |
| Discover | Real items from Hacker News, GitHub, RSS (TechCrunch, The Verge, Hugging Face, OpenAI, Google AI, GitHub Blog and more), NewsAPI and Product Hunt. Daily briefing and project-specific opportunities grounded in source items, validated server-side. |
| Agents | 12 project-scoped agent roles share a tool registry of more than 45 tools. Each tool has server-side permission checks, budget enforcement, prompt-injection hygiene, a persisted plan and step log, cancellation, and approvals for outbound actions. |
| Autopilot | Visual automation builder with cron triggers (the "every morning" workflow ships as a template), daily limits, publishing hours, topic rules, and a global emergency stop. |
| Security | Argon2 auth, httpOnly sessions, CSRF header and origin checks, AES-256-GCM secrets, project isolation, audit log, redaction, rate limits, SSRF-safe fetching, upload sniffing, signed public media URLs, protected repo paths, and typed confirmations before raising autonomy or disabling approvals. |

## Quick start (local, no Docker)

Requirements: Node 20+ (22 recommended), pnpm 9, FFmpeg on PATH (for video).

```bash
pnpm install
```

```bash
cp .env.example .env
```

Then set `ENCRYPTION_KEY` and `SESSION_SECRET` in `.env`. Generate each one with:

```bash
pnpm gen:key
```

Start PostgreSQL 17 (embedded, data stored in `./.data/pg`) and keep it running in its own terminal:

```bash
pnpm db:start
```

```bash
pnpm db:migrate
```

Start the API (:4000), worker and web app (:5173):

```bash
pnpm dev
```

Open http://localhost:5173 and create the owner account. Then go to **Settings → AI providers** and add an Anthropic (default model `claude-opus-5-5`) or OpenAI key to enable agents.

Without Redis, the worker uses a durable Postgres-backed queue. Set `REDIS_URL` to dispatch through BullMQ. Postgres stays the source of truth for job state in both modes.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | API + worker + web with reload |
| `pnpm build` | Production builds (web → `apps/web/dist`, API/worker → `dist`) |
| `pnpm start` | Run the built API (also serves the web app) and worker |
| `pnpm test` | Vitest suites (unit + DB integration against `socialpilot_test`) |
| `pnpm typecheck` | Type-check every package |
| `pnpm db:migrate` / `db:migrate:dev` | Apply / create Prisma migrations |
| `npx tsx scripts/dev/smoke.ts` | End-to-end smoke test against a running API |

## What you must authorize

The integration code, OAuth flows and configuration UI are complete. Each platform needs developer credentials, and some need app review or a paid tier. See [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) for linking social accounts by URL and the step-by-step setup for GA4, GitHub, Plausible and Vercel, including the exact redirect URIs. Nothing is shown as connected until a real OAuth exchange and connection test succeed.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): packages, data model, jobs, agents, security model
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md): provider setup and platform limitations
- [docs/API.md](docs/API.md): HTTP API reference
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md): Docker Compose, TLS, backups, scaling
- [docs/FRONTEND_CONVENTIONS.md](docs/FRONTEND_CONVENTIONS.md): UI conventions
