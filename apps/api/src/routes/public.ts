import type { FastifyInstance } from "fastify";
import { prisma } from "@socialpilot/db";
import { streamObject, verifyPublicUrl } from "@socialpilot/engine";

export default async function publicRoutes(app: FastifyInstance) {
  /** Signed, expiring public URLs used only by platforms that must download media (Instagram, TikTok). */
  app.get("/public/media/*", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req, reply) => {
    const key = (req.params as Record<string, string>)["*"];
    const { exp, sig } = req.query as Record<string, string>;
    if (!key || !exp || !sig || !verifyPublicUrl(key, exp, sig)) return reply.code(403).send({ error: "Invalid or expired link" });
    const v = await prisma.assetVersion.findFirst({ where: { storageKey: key } });
    if (!v) return reply.code(404).send({ error: "Not found" });
    reply.header("content-type", v.mimeType).header("content-length", String(v.sizeBytes)).header("cache-control", "public, max-age=3600");
    return reply.send(streamObject(key));
  });
}
