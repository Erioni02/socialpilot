# API overview

The complete, always-current reference is the OpenAPI page served by the API:

- http://localhost:5173/api/docs (through the web dev server), or
- http://127.0.0.1:4000/api/docs (directly); the raw schema is at `/api/docs/json`.

## Conventions

- JSON in and out. Errors are always `{ "error": { "code": "...", "message": "..." } }`, with secrets redacted.
- Auth: `POST /api/auth/login` sets an httpOnly `sp_session` cookie and a readable `sp_csrf` cookie. Every POST/PUT/PATCH/DELETE (except login) must send the `x-csrf-token` header with the `sp_csrf` value.
- Everything is scoped to your workspace. Another workspace's ids return `404`.
- Status codes: `400` validation, `401` not signed in, `402` budget exceeded, `403` permission, emergency stop or CSRF, `404` not found or not yours, `409` conflict (e.g. approval already decided), `413` upload too large, `422` a tool ran and failed, `429` rate limited.

## Main flows

| Flow | Calls |
|---|---|
| Create a project from a URL | `POST /api/projects {name}` → `PATCH /api/projects/:id {websiteUrl}` → `POST /api/projects/:id/analyze` → follow `GET /api/projects/:id/events` (SSE) or poll `GET /api/tasks/:taskId` |
| Brand profile | `GET /api/projects/:id/brand-profile`, `GET …/versions`, `PUT …/brand-profile {…fields, confirm?}` (each save is a new version) |
| Website results | `GET /api/projects/:id/website` (latest snapshot: pages, basic-check issues, broken links) |
| Quick actions | `POST /api/projects/:id/tools/brand.draftProfile`, `POST /api/projects/:id/tools/project.summary` |
| Tasks | `GET /api/projects/:id/tasks`, `GET /api/tasks/:id` (with events), `POST /api/tasks/:id/cancel` |
| Approvals | `GET /api/projects/:id/approvals`, `POST /api/approvals/:id/approve` / `reject` |
| Policy | `GET/PUT /api/projects/:id/policy` (raising `autonomyLevel` needs `confirmName` equal to the project name), `GET /api/projects/:id/spend` |
| AI providers | `GET/POST /api/ai-providers`, `PATCH/DELETE /api/ai-providers/:id`, `POST /api/ai-providers/:id/test`, `GET /api/ai-providers/catalog` (keys are write-only) |
| Emergency stop | `PUT /api/workspace/emergency-stop {enabled}` |
| Audit | `GET /api/projects/:id/audit` |
| Logo | `POST /api/projects/:id/logo` (multipart, image ≤ 5 MB), `GET /api/projects/:id/logo` |

## SSE events (`GET /api/projects/:id/events`)

Each message's `data` is one of:

```json
{ "type": "task.updated", "task": { "id": "...", "toolName": "website.analyze", "status": "running", "...": "..." } }
{ "type": "task.event", "taskId": "...", "event": { "message": "Fetched /pricing (200)", "level": "info", "at": "..." } }
{ "type": "approval.created", "approvalId": "...", "taskId": "..." }
```
