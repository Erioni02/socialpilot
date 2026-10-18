# Frontend conventions (apps/web)

Stack: React 19, TypeScript, Vite 7, Tailwind CSS v4 (tokens in `src/index.css`), React Router 7, TanStack Query 5, Phosphor icons (`@phosphor-icons/react`, use `weight="bold"` or `"fill"`), Radix primitives wrapped in `src/components/ui/index.tsx`, `sonner` toasts, `recharts` for charts, `date-fns`.

## Design language (warm, editorial minimalism)
- Canvas `bg-canvas` (#F7F6F3), cards `bg-surface` with `border border-line rounded-xl`. No heavy shadows, no gradients, no emojis, no bright fills on large areas.
- Text: `text-ink` (headings), `text-ink-2` (body), `text-muted` (secondary), `text-faint`.
- Page titles use `PageHeader` (serif). Section labels use `SectionTitle` (small caps style) from `components/common`.
- Status/tags use `Badge` / `StatusBadge` (pastel tones: gray, red, blue, green, yellow, purple).
- Body font size is 13–14px. Keep dense but airy layouts; tables use `Table/Th/Td`.
- Primary buttons are black (`variant="primary"`); secondary is bordered; destructive uses `danger`.
- Wrap each page in `<PageContainer>` (or `<PageContainer wide>` for workspaces) from `components/layout/AppShell`.

## Data rules (critical)
- Only show real data from the API. When an integration/key is missing, show `SetupCallout` with a link/button to the place to fix it (e.g. `/projects/:id/integrations`, `/settings`). Never render fake numbers or placeholder metrics. If the API returns `method: "heuristic"`/`"ranked"`, label it clearly.
- Distinguish measured metrics vs AI hypotheses in the UI (labels like “Measured” vs “AI hypothesis”).
- Every important button must call a real endpoint. No decorative buttons.
- Outbound actions (publish, reply, merge, deploy) show confirmation (`ConfirmDialog`) and explain approval rules.

## API usage
- `import { api, p, assetUrl } from "@/lib/api"`. `p(projectId, "/posts")` → `/projects/:id/posts`. All routes are under `/api` (the helper adds it). Errors throw `ApiError` (`status`, `message`, `code`, `details`); show them with `toastError(e)` from `@/lib/utils`. `code === "setup_required"` means configuration is missing.
- Use TanStack Query. Query keys MUST start with these names so live server events refresh them (see `src/hooks/useEvents.ts`): `projects, project, dashboard, tasks, task, posts, post, calendar, assets, asset, audits, audit, analysis, integrations, analytics, inbox, approvals, notifications, campaigns, campaign, opportunities, discover, code-changes, code-change, deployments, automations, automation-runs, jobs`. Example: `useQuery({ queryKey: ["posts", projectId, filters], queryFn: () => api.get(p(projectId, "/posts")) })`.
- Long operations return `{ jobId }` (generation, edits, plans). The SSE stream invalidates the related keys when work finishes; also show “processing” states using asset `status`.
- Helpers in `components/common.tsx`: `useMeta()` (catalogs, capability registry, permission & agent labels), `useMe()`, `useProject(projectId)` (project, readiness, policy, effective permissions), `CommandBar` (creates agent tasks), `PlatformIcon`, `CapabilityPill`, `SectionTitle`, `DiffView`.
- Utilities in `@/lib/utils`: `cn, ago, fmtDate, fmtNum, fmtUsd, fmtBytes, toastError, titleCase, copy, PLATFORM_LABEL`.

## API reference
The source of truth is `apps/api/src/routes/*.ts` (read them for exact request/response shapes):
- `auth.ts` – auth, emergency stop. `system.ts` – `/meta`, `/system/status`, `/providers` (AI/data keys, OAuth developer apps), notifications, audit log.
- `projects.ts` – projects CRUD, `/analyze` + `/analysis/:auditId` (wizard), `/apply-profile`, `/dashboard`, `/policy` (raising autonomy needs `confirmation` phrase; 428 response includes `details.phrase`), `/paused`, `/ai-config`, `/budget`, notes, agent configs, jobs, activity.
- `integrations.ts` – catalog with setup guides + connections, OAuth connect (`{ url }` → `window.location.href = url`), key-based connect (`{ fields }`), public profile URL, test, sync, config (GitHub repo, GA4 property, TikTok privacy), disconnect, GitHub repos, GA4 properties.
- `media.ts` – assets list/upload (multipart `file`, `folder`, `campaignId`), detail with versions, file URL, patch, delete, restore, `image-op`, `video-op` (409 `asset_busy` while processing), `generate-image`, `generate-video`.
- `content.ts` – campaigns (+ `/plan`, `/materialize`, `/schedule-plan`), posts CRUD, quality, status, schedule, publish-now, unschedule, restore, duplicate, target retry / manual-published, `/content/assist`, calendar, queues.
- `engagement.ts` – inbox (sync, draft, reply, status, summary), analytics (social, web, campaigns, pagespeed, insights), discover (items, sources, refresh, briefing), opportunities (generate, status, to-post, to-campaign).
- `operations.ts` – audits, repo files, code changes (propose, ai, push, refresh, merge, close), deployments (+logs, promote), tasks (create, detail with steps, cancel), approvals (decide), automations (CRUD, run, runs, templates).

## Ownership
Each page file is owned by one implementer. Put page-specific components in the same file or in `src/components/<area>/`. Do not edit `src/components/ui/index.tsx`, `src/components/common.tsx`, `src/lib/*`, `src/main.tsx` or another owner's page; if you need a primitive that doesn't exist, build it locally in your area folder.
Run `npx tsc -p tsconfig.json` in `apps/web` before finishing; your files must have zero type errors.
