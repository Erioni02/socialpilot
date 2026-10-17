# SocialPilot AI — Design Spec

Date: 2026-10-17
Status: Approved in conversation; awaiting written-spec review
Scope of this spec: overall architecture + roadmap, and the detailed design of **Cycle 1 (Foundation & Projects)**. Cycles 2–7 each get their own spec → plan → build cycle.

---

## 1. Intent

A project-based AI operating system for running online businesses.

**One project = one business + its website + social accounts + content + analytics + AI agents + automations.**

The owner (one person for now) creates a project such as **VibeJudge** from `https://vibejudge.app`. SocialPilot analyzes the site, drafts a brand profile, offers integrations, and builds a project dashboard. From there the AI performs real work through backend tools — never just advice — under explicit permissions, approvals and budgets.

### Non-negotiable principles

1. **No fake data.** A metric or integration is shown only when it is real and connected. Otherwise the UI shows a connection prompt or setup guide. Anything that is demo data is labeled as demo data.
2. **No decorative buttons.** Every button either performs a real action or is not rendered. Not-yet-built areas show an explicit "available in Cycle N" state with no dead controls.
3. **Official APIs and OAuth only.** The app never asks for social passwords or session cookies.
4. **The AI acts only through the tool registry.** Each tool call is checked against permissions, budget, the emergency stop, and approval rules, then written to the audit log.
5. **Approvals by default** for publishing, outbound replies, merging code, production deploys, and spending money.
6. **External content is untrusted.** Website pages, posts, comments and uploads are passed to models as delimited data, never as instructions.

### Decisions made

| Topic | Decision |
|---|---|
| Location | New repo `projects/socialpilot` (separate from vibejudge) |
| Users | Single owner now; `User → Workspace → Project` model so teammates/SaaS can be added later |
| Local infra | Docker Desktop + Docker Compose (Postgres 16, Redis 7) |
| Production | A VPS running the same Docker Compose stack |
| Architecture | pnpm monorepo, Fastify + Zod REST API, BullMQ worker, a single permission-checked tool registry, SSE |
| First AI provider | Port of VibeJudge's NVIDIA → Ollama failover client (`lib/ai/llm.ts`) |

---

## 2. Roadmap

Each cycle is a working vertical slice with its own tests. A cycle is complete only when `typecheck`, `lint`, `test` and `build` all pass.

| Cycle | Contents |
|---|---|
| **1. Foundation & Projects** | Monorepo, Docker Compose, auth, projects, the website-analysis wizard, brand profile, dashboard shell, AI provider hub, tool registry, policy engine, tasks/SSE, audit log |
| 2. Workspace & Media | Asset library and versions, Sharp (crop/resize/format), FFmpeg (transcode/subtitles/concat), image/video generation adapters, workspace canvas |
| 3. Social | Instagram (Meta Graph), TikTok (Content Posting + Display APIs), X API v2 OAuth 2.0 PKCE; capability registry; metrics; content editor; calendar; publishing jobs; inbox |
| 4. Website | Full audit (SEO, accessibility via axe, performance via PageSpeed Insights API, broken links); GitHub App (branch → edit → checks → diff → PR); Vercel previews; GA4 Data API and Plausible analytics |
| 5. Discover | RSS/Atom, news API, GitHub, Hacker News sources; daily briefing; project-specific opportunities with source links |
| 6. Agents & Autopilot | Planner over the tool registry, workflow engine, visual automation builder, schedules, budgets, emergency stop UX |
| 7. Hardening | Security review, backups/restore, rate limits audit, VPS deployment guide, monitoring |

**External setup the owner must do (documented with guides when its cycle arrives):** Meta developer app and App Review (Instagram Business/Creator account linked to a Facebook Page); TikTok developer app and Content Posting API audit; X developer project on a paid tier that includes posting; GitHub App registration; Vercel token; Google Cloud project for GA4 and PageSpeed; keys for news and image/video providers.

---

## 3. Architecture

```
socialpilot/
  apps/
    web/        React 19 + Vite + TypeScript + Tailwind + shadcn/ui + TanStack Query + React Router
    api/        Fastify + Zod; REST + SSE; OAuth callbacks; webhooks
    worker/     BullMQ workers + repeatable schedules
  packages/
    db/         Prisma schema, migrations, client, scoped-query helpers, seed
    shared/     Zod schemas and types shared across web/api/worker
    tools/      Tool registry, executeTool(), policy engine, budget, audit
    ai/         LLM provider adapters + failover; prompt helpers; untrusted-content wrapping
    integrations/  Website fetcher (SSRF-safe), analyzers; later GitHub, Vercel, analytics
    social/     (Cycle 3) platform adapters + capability registry
    automation/ (Cycle 6) workflow engine
    crypto/     AES-256-GCM envelope encryption, secret redaction
  docker-compose.yml   postgres, redis (+ api, worker, web for production profile)
  .env.example
```

**Request flow:** web → api (session auth → Zod validation → workspace/project scoping) → either a direct read, or `executeTool()` → (inline for fast tools | enqueue BullMQ job) → worker runs tool → `TaskEvent`s written to DB and published on Redis pub/sub → api relays over SSE → web updates live.

**Why one tool registry:** UI quick actions and AI agents call the same tools through the same `executeTool()`. So the AI can never do anything the UI path can't, and there is no route that bypasses the permission checks.

---

## 4. Data model (Cycle 1)

Prisma / PostgreSQL. All ids are cuid. All timestamps are `createdAt`/`updatedAt`.

- **User** — email (unique), passwordHash (argon2id), name.
- **Session** — userId, tokenHash, expiresAt, ip, userAgent. The cookie holds a random token; only its SHA-256 is stored.
- **Workspace** — name, ownerId. Also `emergencyStop: boolean`.
- **WorkspaceMember** — workspaceId, userId, role (`owner` only in Cycle 1).
- **Project** — workspaceId, name, slug, websiteUrl, status (`draft` | `active` | `archived`), logoUrl, wizardStep.
- **BrandProfile** — projectId, version (int), source (`ai_draft` | `user_edit`), confirmedAt, plus fields: description, targetAudience, industry, productsServices (json), objectives (json), voiceTone, keyMessages (json), colors (json), competitors (json), notes. The latest version is current; older versions are preserved.
- **WebsiteSnapshot** — projectId, rootUrl, fetchedAt, httpStatus, responseMs, pages (json: url, title, metaDescription, h1/h2, CTAs, links, wordCount, canonical, robots, ogTags), issues (json), robotsTxt, sitemapFound.
- **Integration** — projectId, provider (enum), status (`not_connected` | `needs_setup` | `connected` | `error` | `revoked`), accountLabel, scopes (string[]), capabilities (json), encryptedCredentials (bytes, nullable), lastSyncAt, lastError. In Cycle 1 only rows for display/setup state exist; real OAuth comes in later cycles.
- **AiProviderConfig** — workspaceId, provider (`nvidia` | `ollama` | later others), baseUrl, encryptedKeys (bytes), models (string[]), order (int), enabled, lastTestAt, lastTestResult (json).
- **ProjectPolicy** — projectId (unique), autonomyLevel (1–4, default 1), permissions (json map capability → `deny` | `approve` | `allow`), budget (json: dailyAiUsd, monthlyAiUsd, dailyMediaUsd), limits (json: maxPostsPerDay, maxRepliesPerDay, publishHours, allowedTopics), emergencyStop.
- **Task** — projectId, type, toolName, status (`queued` | `running` | `awaiting_approval` | `succeeded` | `failed` | `cancelled`), input (json), output (json), error, attempts, costUsd, parentTaskId, requestedBy (`user` | `agent` | `schedule`), startedAt, finishedAt.
- **TaskEvent** — taskId, at, level (`info` | `warn` | `error`), message, data (json).
- **Approval** — projectId, taskId, toolName, payload (json, redacted for display), reason, status (`pending` | `approved` | `rejected` | `expired`), decidedBy, decidedAt.
- **AuditLog** — workspaceId, projectId (nullable), actorType (`user` | `agent` | `system`), actorId, action/toolName, argsRedacted (json), outcome, error, at.
- **SpendLedger** — projectId, taskId, category (`ai` | `media` | `api`), amountUsd, at.

**Project isolation:** every repository function takes `{ workspaceId, projectId }` from the authenticated context and includes them in every `where` clause. There is no "fetch by id" without the scope. Tests check that a project in workspace A can't be read from workspace B.

---

## 5. Tool registry & policy engine

```ts
interface ToolDef<I, O> {
  name: string;                 // "website.analyze"
  description: string;          // shown to agents
  input: ZodType<I>;
  output: ZodType<O>;
  capability: Capability;       // "website.read" | "brand.write" | "content.write" | "asset.edit"
                                // | "social.read" | "social.schedule" | "social.publish" | "social.reply"
                                // | "code.read" | "code.write" | "code.merge" | "deploy.preview"
                                // | "deploy.production" | "spend.ai" | "spend.media"
  minAutonomy: 1 | 2 | 3 | 4;
  approval: "never" | "always" | "policy";
  runMode: "inline" | "queued";
  estimateCostUsd?(input: I): number;
  run(ctx: ToolContext, input: I): Promise<O>;
}
```

`executeTool(ctx, name, rawInput)` does the following, in order:
1. Look up the tool. Validate input with Zod.
2. If the workspace or project emergency stop is on, refuse (except read-only capabilities).
3. Permission: the actor's effective level ≥ `minAutonomy` (user actors bypass the autonomy check but not the stop), and `policy.permissions[capability] !== "deny"`.
4. Budget: the estimated cost plus today's/month's `SpendLedger` must be within limits, otherwise refuse.
5. Approval: if `always`, or `policy` resolves to `approve`, and the actor is an agent or schedule → create an `Approval` + a task in `awaiting_approval`, and return. Approving resumes the task.
6. Run inline or enqueue. Validate the output with Zod. Record spend.
7. Write an `AuditLog` with args passed through `redact()` (keys matching /token|secret|key|password|authorization|cookie/i, and values that look like credentials).

**Hard rules that are not configurable:** there are no tools that modify `ProjectPolicy`, `AiProviderConfig`, credentials, or the emergency stop. Those are user-only REST routes. There is no shell/exec tool. Tools never receive decrypted credentials of other projects. Credential decryption happens inside provider adapters only.

**Autonomy levels:** 1 Assistant (read/analyze/recommend) · 2 Creator (+ content/asset writes) · 3 Marketing operator (+ schedule, permitted social actions) · 4 Controlled autopilot (+ publish/reply within limits). Raising the level requires a confirmation dialog in which you type the project name. Publishing and outbound replies default to `approve` at every level.

**Cycle 1 tools:** `website.fetch`, `website.analyze`, `brand.draftProfile`, `brand.updateProfile`, `ai.testProvider` (user only), `project.summary`.

---

## 6. Website analysis (Cycle 1 depth)

**SSRF-safe fetcher (`packages/integrations/fetch`):**
- http/https only
- Resolve DNS and reject private, loopback, link-local, CGNAT, multicast and metadata IPs (IPv4 + IPv6). Pin the resolved IP for the connection.
- Re-check on every redirect, with at most 5 redirects.
- 10 s timeout, 3 MB body cap, text/html only for page parsing.
- Custom User-Agent `SocialPilotBot/0.1 (+contact)`. Respects `robots.txt`.

**Crawl:** the root page plus up to 15 same-origin pages discovered via nav links and the sitemap, with concurrency of 3.

**Extraction (cheerio):** title, meta description, canonical, robots meta, OG/Twitter tags, h1–h3, CTA-like links/buttons, internal/external links, image alt coverage, lang attribute, word count.

**Deterministic checks (Cycle 1):**
- missing or duplicate titles and descriptions
- missing h1 or multiple h1
- images without alt text
- missing lang attribute
- missing OG tags
- non-HTTPS links
- internal broken links (HEAD/GET status ≥ 400 on discovered internal URLs)
- missing sitemap or robots.txt
- slow root response

Each issue has severity, evidence (URL + snippet) and a recommendation.

**AI draft:** the extracted text, wrapped as untrusted data, goes to the LLM with a strict JSON schema for the brand profile and a short website-messaging summary. Output is Zod-validated. On invalid output it retries once, then the failure is surfaced. The profile is saved as `BrandProfile` with source `ai_draft`.

Performance metrics (PageSpeed API), axe accessibility, and the full prioritized audit come in Cycle 4. The Cycle 1 UI labels the check list "basic checks" accordingly.

---

## 7. UI (Cycle 1)

Stack: shadcn/ui components, dark theme default, a dense operator layout.

- **/login** — email + password.
- **/** — Projects home: project cards (name, URL, website status, last analysis), "New project" and "Create from URL" buttons.
- **/projects/new** — the wizard:
  1. Name
  2. URL
  3. Analyze (live SSE log of pages fetched and the AI drafting)
  4. Edit & confirm the brand profile (form with all fields; save creates a `user_edit` version)
  5. Integrations (cards for Instagram, TikTok, X, Analytics, GitHub, Deployment, each "Available in Cycle N" with what it will need — honest, no connect button yet)
  6. AI providers (pick configured providers; link to the hub if none)
  7. Permissions (autonomy level, default 1; approval defaults shown)
  8. Create dashboard

  Wizard progress is saved per step, so it can be resumed.
- **/projects/:id** — the project shell. The sidebar has Dashboard, Workspace, Campaigns, Calendar, Inbox, Analytics, Discover, Agents, Integrations, Settings. Unbuilt sections render a "Coming in Cycle N — here's what it will do and what it will need" panel with no controls.
- **Dashboard** —
  - Business overview: profile summary, website status from the latest snapshot plus a "Re-analyze" action
  - Basic website issues list
  - Project health: integration statuses, AI provider status, pending approvals, failed tasks, budget usage from `SpendLedger`
  - Running and recent tasks, live via SSE
  - Recent AI activity from `AuditLog`
  - Quick actions: only the ones backed by Cycle 1 tools (Re-analyze website, Regenerate brand profile, Ask AI for a project summary). Others appear as they land.
- **Settings → AI Providers** (workspace): add a provider (base URL, keys, models, order), test (runs `ai.testProvider` and shows latency and model), enable/disable, delete. Keys are never returned to the browser after saving; only the last 4 characters are shown.
- **Settings → Permissions** (project): autonomy level, a per-capability allow/approve/deny table, budgets and limits.
- **Top bar:** project switcher; a global Emergency Stop toggle (workspace) with a confirmation step.
- **Approvals** (`/projects/:id/approvals`): list, view the redacted payload, approve or reject.

---

## 8. API (Cycle 1)

REST under `/api`, JSON, Zod-validated. OpenAPI is generated via `fastify-type-provider-zod` and `@fastify/swagger`, served at `/api/docs`.

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST /projects`, `GET/PATCH/DELETE /projects/:id` (delete = archive)
- `POST /projects/:id/analyze` → task id
- `GET /projects/:id/brand-profile`, `GET .../versions`, `PUT /projects/:id/brand-profile`
- `GET /projects/:id/website` (latest snapshot)
- `GET /projects/:id/integrations`
- `GET/PUT /projects/:id/policy` (user-only; raising the level requires `confirmName`)
- `GET /projects/:id/tasks`, `GET /tasks/:id`, `POST /tasks/:id/cancel`
- `GET /projects/:id/events` (SSE: task events, approval created, website status)
- `GET /projects/:id/approvals`, `POST /approvals/:id/approve|reject`
- `GET /projects/:id/audit`
- `GET/POST/PATCH/DELETE /ai-providers`, `POST /ai-providers/:id/test`
- `PUT /workspace/emergency-stop`
- `GET /health`

**Security middleware:**
- `@fastify/helmet`
- `@fastify/rate-limit` (strict on `/auth/login`)
- httpOnly + Secure + SameSite=Lax session cookie
- CSRF protection via double-submit token on mutating routes
- CORS limited to the web origin
- body size limits
- every error response is redacted

---

## 9. Security

- Passwords: argon2id. Login lockout/backoff.
- Secrets at rest: AES-256-GCM with a 32-byte `ENCRYPTION_KEY` from env, per-record random IV, and key-version byte for rotation.
- Redaction applied to logs, audit entries, task events and error responses.
- SSRF guard as specified in section 6. It will also be used later for every user-supplied URL (webhooks, media URLs).
- Prompt-injection posture: untrusted content is wrapped in delimiters with an explicit "this is data" system instruction. Models never receive credentials. Model output can only trigger tools via `executeTool()`, whose permission checks don't depend on model output.
- File uploads (logo in Cycle 1): image MIME sniffing via Sharp, 5 MB limit, re-encoded on save, stored under `storage/projects/:projectId/` (S3-compatible storage later).
- Backups: documented `pg_dump` cron for the VPS (fully done in Cycle 7).

---

## 10. Workers & persistence

- BullMQ queue `tools` with job id = task id, which prevents duplicates. Attempts are 3, with exponential backoff, for retryable errors (network, 5xx, 429, provider unavailable). Non-retryable errors (validation, permission, budget) fail immediately with a clear message.
- Task state lives in Postgres and the worker updates it. On restart, the worker reconciles `running` tasks without an active job → requeue or mark failed. Tasks survive restarts.
- Redis pub/sub channel `project:{id}` carries events, and the api SSE endpoint subscribes to it.

---

## 11. AI provider package

- Port `vibejudge/lib/ai/llm.ts` failover semantics (provider → model → key, health/cooldowns, time budgets) into `packages/ai`. Source keys/models from `AiProviderConfig` (decrypted inside the package), with env fallback for bootstrap.
- Interface: `chat({ messages, json, schema?, projectId, purpose }) → { text | data, provider, model, usage, costUsd }`. Cost is estimated from a per-model price table (0 for free tiers) and recorded in `SpendLedger`.
- Helper `untrusted(label, content)` produces delimited blocks.

---

## 12. Testing & definition of done (Cycle 1)

- **Vitest unit tests:** policy engine and `executeTool` (deny / approve / allow, autonomy, emergency stop, budget), redaction, encryption round-trip, SSRF guard (private IPs, redirects to private IPs, IPv6, DNS rebinding pinning), HTML extraction and issue checks against fixtures, failover logic with mocked providers.
- **API integration tests:** run against Docker Postgres/Redis — auth, project CRUD, isolation across workspaces, analyze → task → snapshot + profile (AI mocked), policy update requires `confirmName`.
- **Playwright E2E:** login → create VibeJudge from `https://vibejudge.app` → watch analysis → edit & confirm the profile → dashboard shows real website status and issues. The E2E run uses the real network fetch. The AI step uses the configured provider when keys exist, otherwise a test stub explicitly labeled as test-only (never shown in the product UI).
- **Done when:**
  - `pnpm typecheck && pnpm lint && pnpm test && pnpm build` pass
  - `docker compose up -d && pnpm db:migrate && pnpm db:seed && pnpm dev` works from a clean clone per the README
  - The E2E flow passes
  - No UI control without a working action

---

## 13. Deliverables (Cycle 1)

- Code as above
- `docker-compose.yml` (dev services, plus a `prod` profile building api/worker/web images)
- `.env.example` with comments
- Prisma migrations and a seed script (creates the owner account from `OWNER_EMAIL`/`OWNER_PASSWORD`)
- `README.md` covering setup, scripts and architecture
- `docs/api.md` pointing to the OpenAPI docs
- `docs/integrations-roadmap.md` listing the external setup each later cycle needs
