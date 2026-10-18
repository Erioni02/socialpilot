import { prisma } from "@socialpilot/db";
import { createLogger } from "@socialpilot/core";
import { CAPABILITY_REGISTRY, type SocialPlatform } from "@socialpilot/shared";
import { socialAdapter } from "@socialpilot/social";
import { dispatchDueTargets } from "./content/publishing";
import { dispatchDueAutomations } from "./automation/service";
import { dispatchPostTracking } from "./content/manual";
import { enqueue } from "./infra/queue";
import { getCredentials } from "./integrations/service";
import { getAppCredentials } from "./infra/credentials";
import { decryptJson, encryptJson } from "@socialpilot/core";

const log = createLogger("scheduler");

const bucket = (ms: number) => Math.floor(Date.now() / ms);

async function scheduleSyncs() {
  const integrations = await prisma.integration.findMany({ where: { status: { in: ["connected", "error"] }, provider: { in: ["instagram", "tiktok", "x", "ga4", "plausible"] } } });
  for (const i of integrations) {
    if (!i.lastSyncAt || Date.now() - i.lastSyncAt.getTime() > 6 * 3600_000) {
      await enqueue("sync.integration", { integrationId: i.id }, { projectId: i.projectId, dedupeKey: `sync:${i.id}:${bucket(6 * 3600_000)}`, maxAttempts: 2 });
    }
    if (i.kind === "social" && i.status === "connected") {
      const cap = CAPABILITY_REGISTRY[i.provider as SocialPlatform];
      if (cap?.list_comments.supported || cap?.list_mentions.supported) {
        await enqueue("inbox.sync", { integrationId: i.id }, { projectId: i.projectId, dedupeKey: `inbox:${i.id}:${bucket(15 * 60_000)}`, maxAttempts: 1 });
      }
    }
  }
}

/** Keeps OAuth tokens fresh while the user is offline (Instagram long-lived tokens are refreshed a week before expiry). */
async function refreshTokens() {
  const soon = await prisma.integration.findMany({
    where: { status: "connected", tokenExpiresAt: { not: null, lt: new Date(Date.now() + 7 * 86400_000) } },
  });
  for (const i of soon) {
    try {
      const expiresInMs = i.tokenExpiresAt!.getTime() - Date.now();
      if (i.provider === "instagram" && expiresInMs > 30 * 60_000) {
        const project = await prisma.project.findUniqueOrThrow({ where: { id: i.projectId } });
        const app = await getAppCredentials(project.ownerId, "instagram");
        const creds = decryptJson<any>(i.credentialsEnc);
        if (!creds?.accessToken) continue;
        const next = await socialAdapter("instagram").refresh!(app ?? { clientId: "", clientSecret: "" }, { accessToken: creds.accessToken, scopes: i.scopes });
        await prisma.integration.update({ where: { id: i.id }, data: { credentialsEnc: encryptJson({ ...creds, accessToken: next.accessToken }), tokenExpiresAt: next.expiresAt ?? null } });
      } else if (expiresInMs < 60 * 60_000) {
        await getCredentials({ ...i, tokenExpiresAt: new Date(Date.now()) });
      }
    } catch (e) {
      log.warn(`token refresh failed for ${i.provider} ${i.id}: ${(e as Error).message}`);
    }
  }
}

async function cleanup() {
  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.job.deleteMany({ where: { status: { in: ["completed", "cancelled"] }, finishedAt: { lt: new Date(Date.now() - 14 * 86400_000) } } });
}

let lastSlow = 0;
let lastCleanup = 0;
let lastTracking = 0;

/** Called every 30 seconds by the worker. All state lives in Postgres, so restarts lose nothing. */
export async function schedulerTick() {
  try {
    await dispatchDueTargets();
    await dispatchDueAutomations();
    if (Date.now() - lastSlow > 5 * 60_000) {
      lastSlow = Date.now();
      await scheduleSyncs();
      await refreshTokens();
      await enqueue("discover.refresh", {}, { dedupeKey: `discover:${bucket(60 * 60_000)}`, maxAttempts: 1 });
    }
    // Social Pulse every 20 minutes (free sources; paid feeds only for users who opted in, within their cap),
    // plus free snapshots of watched profiles/posts.
    await enqueue("intel.pulse", {}, { dedupeKey: `pulse:${bucket(20 * 60_000)}`, maxAttempts: 1 });
    await enqueue("intel.refresh", {}, { dedupeKey: `intel:${bucket(20 * 60_000)}`, maxAttempts: 1 });
    // Public metrics for manually posted content, on a decaying cadence (20 min while fresh → daily).
    if (Date.now() - lastTracking > 5 * 60_000) {
      lastTracking = Date.now();
      await dispatchPostTracking();
    }
    if (Date.now() - lastCleanup > 6 * 3600_000) {
      lastCleanup = Date.now();
      await cleanup();
    }
  } catch (e) {
    log.error("tick failed", { error: String(e) });
  }
}
