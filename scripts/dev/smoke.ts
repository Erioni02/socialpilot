/**
 * End-to-end smoke test against a running API (pnpm dev:api + pnpm dev:worker).
 * Creates a throwaway local test user, a project from a website URL, runs the real website analysis,
 * and exercises content, assets (Sharp), Discover and policy endpoints.
 * Usage: npx tsx scripts/dev/smoke.ts [https://vibejudge.app]
 */
import { randomBytes } from "node:crypto";
import sharp from "../../packages/engine/node_modules/sharp/lib/index.js";

const API = process.env.SMOKE_API ?? "http://localhost:4000/api";
const site = process.argv[2] ?? "https://vibejudge.app";
let cookie = "";

async function call<T = any>(method: string, path: string, body?: unknown, raw?: BodyInit): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { "x-socialpilot-csrf": "1", ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return json as T;
}

const ok = (msg: string) => console.log(`✔ ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const email = `smoke-${randomBytes(4).toString("hex")}@example.test`;
await call("POST", "/auth/register", { email, password: randomBytes(12).toString("base64url"), name: "Smoke Test" });
ok(`registered local test user ${email}`);

const { project } = await call("POST", "/projects", { name: "VibeJudge", websiteUrl: site });
ok(`created project ${project.id} (${project.slug})`);

const { auditId } = await call("POST", `/projects/${project.id}/analyze`, {});
let analysis: any;
for (let i = 0; i < 60; i++) {
  analysis = await call("GET", `/projects/${project.id}/analysis/${auditId}`);
  if (["completed", "failed"].includes(analysis.status)) break;
  await sleep(2000);
}
if (analysis.status !== "completed") throw new Error(`analysis ${analysis.status}: ${analysis.error}`);
ok(`website analysis: ${analysis.pagesCrawled} pages, ${analysis.summary.issues} issues, profile method=${analysis.profile?.method}`);
await call("POST", `/projects/${project.id}/apply-profile`, {
  description: analysis.profile.description,
  keywords: analysis.profile.keywords,
  profileSource: analysis.profile.method,
  brand: { colors: analysis.profile.colors, fonts: analysis.profile.fonts, voice: "", tone: [], guidelines: "", doNotSay: [], hashtags: [] },
});
ok("applied proposed profile");

const dash = await call("GET", `/projects/${project.id}/dashboard`);
ok(`dashboard: website up=${dash.website?.status?.up} (${dash.website?.status?.responseMs}ms), social accounts=${dash.social.length}, readiness.ai.text=${dash.readiness.ai.text}`);

const png = await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#3355ff" } }).png().toBuffer();
const form = new FormData();
form.append("folder", "/smoke");
form.append("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "smoke.png");
const { asset } = await call("POST", `/projects/${project.id}/assets/upload`, undefined, form);
ok(`uploaded asset ${asset.id}`);
await call("POST", `/projects/${project.id}/assets/${asset.id}/image-op`, { op: "preset", preset: "instagram_square" });
for (let i = 0; i < 30 && (await call("GET", `/projects/${project.id}/assets/${asset.id}`)).asset.status === "processing"; i++) await sleep(500);
await call("POST", `/projects/${project.id}/assets/${asset.id}/image-op`, { op: "brand", overlayText: "Your CV is lying to you", textPosition: "bottom", border: 0 });
let detail: any;
for (let i = 0; i < 30; i++) {
  detail = await call("GET", `/projects/${project.id}/assets/${asset.id}`);
  if (detail.asset.versions.length >= 3 && detail.asset.status === "ready") break;
  await sleep(1000);
}
ok(`asset versions: ${detail.asset.versions.map((v: any) => `${v.version}:${v.operation}:${v.width}x${v.height}`).join(", ")}`);

const { post } = await call("POST", `/projects/${project.id}/posts`, { title: "Smoke post", body: "Is your CV lying to you? Get an honest roast in 30 seconds.", platforms: ["x", "instagram"], mediaAssetIds: [asset.id], hashtags: ["cv", "jobsearch"], cta: "Try it free", link: site });
const q = await call("POST", `/projects/${project.id}/posts/${post.id}/quality`, { ai: false });
ok(`quality check ok=${q.ok}: ${q.checks.map((c: any) => `${c.level}:${c.id}`).join(", ")}`);
await call("PATCH", `/projects/${project.id}/posts/${post.id}`, { body: "Is your CV lying to you? Find out in 30 seconds." });
const pd = await call("GET", `/projects/${project.id}/posts/${post.id}`);
ok(`post versions: ${pd.post.versions.length}; X preview: ${JSON.stringify(pd.previews.x.text).slice(0, 120)}`);

const sched = await call("POST", `/projects/${project.id}/posts/${post.id}/schedule`, { scheduledAt: new Date(Date.now() + 86400_000).toISOString(), timezone: "UTC" });
ok(`scheduled: ${sched.targets.map((t: any) => `${t.platform}=${t.status}`).join(", ")}`);
await call("POST", `/projects/${project.id}/posts/${post.id}/unschedule`, {});
ok("unscheduled");

try {
  await call("PUT", `/projects/${project.id}/policy`, { autonomyLevel: 4 });
  throw new Error("autonomy raise without confirmation should fail");
} catch (e) {
  if (!String(e).includes("428")) throw e;
  ok("raising autonomy without confirmation is rejected (428)");
}

await call("POST", "/discover/refresh", {});
let items: any[] = [];
for (let i = 0; i < 45; i++) {
  items = (await call("GET", `/discover/items?hours=168&limit=50`)).items;
  if (items.length >= 10) break;
  await sleep(2000);
}
ok(`discover: ${items.length} real items, e.g. "${items[0]?.title}" (${items[0]?.sourceName}) ${items[0]?.url}`);
const brief = await call("GET", `/discover/briefing?projectId=${project.id}`);
ok(`briefing method=${brief.briefing.method}, sections=${brief.briefing.content.sections?.length}`);
const opps = await call("POST", `/projects/${project.id}/opportunities/generate`, { count: 3 }).catch((e) => ({ error: String(e) }));
ok(`opportunities: ${"opportunities" in opps ? `${opps.opportunities.length} (${opps.opportunities[0]?.method})` : opps.error}`);

const task = await call("POST", `/projects/${project.id}/tasks`, { instruction: "Audit the website and draft 3 posts", agentType: "general" });
for (let i = 0; i < 20; i++) {
  const t = await call("GET", `/projects/${project.id}/tasks/${task.task.id}`);
  if (["completed", "failed"].includes(t.task.status)) {
    ok(`agent task ended ${t.task.status}: ${t.task.error ?? t.task.summary}`);
    break;
  }
  await sleep(1500);
}
const integ = await call("GET", `/projects/${project.id}/integrations`);
ok(`integrations catalog: ${integ.catalog.map((c: any) => `${c.id}${c.appConfigured ? "" : "(needs app)"}`).join(", ")}`);
console.log("\nSmoke test finished.");
