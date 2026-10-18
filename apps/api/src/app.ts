import Fastify, { type FastifyError } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import path from "node:path";
import { ZodError } from "zod";
import { Prisma } from "@socialpilot/db";
import { AppError, config, isProd, ProviderError, redactString, ROOT_DIR, SsrfError } from "@socialpilot/core";
import authPlugin from "./plugins/auth";
import authRoutes from "./routes/auth";
import systemRoutes from "./routes/system";
import projectRoutes from "./routes/projects";
import integrationRoutes from "./routes/integrations";
import mediaRoutes from "./routes/media";
import contentRoutes from "./routes/content";
import readyRoutes from "./routes/ready";
import engagementRoutes from "./routes/engagement";
import operationsRoutes from "./routes/operations";
import eventRoutes from "./routes/events";
import publicRoutes from "./routes/public";
import intelRoutes from "./routes/intel";

export async function buildApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: opts.logger ? { level: config.LOG_LEVEL, redact: ["req.headers.cookie", "req.headers.authorization"] } : false,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    contentSecurityPolicy: isProd
      ? {
          directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            mediaSrc: ["'self'", "blob:"],
            connectSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            frameSrc: ["https:"],
            objectSrc: ["'none'"],
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: "same-site" },
  });
  await app.register(cors, { origin: [new URL(config.APP_URL).origin], credentials: true });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute", keyGenerator: (req) => (req as any).user?.id ?? req.ip });
  await app.register(multipart, { limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 10 } });
  await app.register(authPlugin);

  app.setErrorHandler((err: FastifyError | Error, req, reply) => {
    if (err instanceof AppError) return reply.code(err.statusCode).send({ error: err.message, code: err.code, details: err.details });
    if (err instanceof ZodError) return reply.code(400).send({ error: "Invalid input", code: "bad_request", details: err.issues.slice(0, 10) });
    if (err instanceof SsrfError) return reply.code(400).send({ error: err.message, code: "blocked_url" });
    if (err instanceof ProviderError) return reply.code(502).send({ error: redactString(err.message), code: "provider_error", provider: err.provider });
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") return reply.code(404).send({ error: "Not found", code: "not_found" });
    const status = (err as FastifyError).statusCode ?? 500;
    if (status < 500) return reply.code(status).send({ error: err.message, code: (err as FastifyError).code ?? "error" });
    req.log?.error?.(err);
    if (!opts.logger) console.error(err);
    return reply.code(500).send({ error: isProd ? "Internal server error" : redactString(err.message), code: "internal" });
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      await api.register(systemRoutes);
      await api.register(projectRoutes);
      await api.register(integrationRoutes);
      await api.register(mediaRoutes);
      await api.register(contentRoutes);
      await api.register(readyRoutes);
      await api.register(engagementRoutes);
      await api.register(operationsRoutes);
      await api.register(eventRoutes);
      await api.register(intelRoutes);
    },
    { prefix: "/api" },
  );
  await app.register(publicRoutes);

  // Serve the built web app in production (single origin).
  const webDist = path.join(ROOT_DIR, "apps/web/dist");
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/public/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Not found", code: "not_found" });
    });
  }
  return app;
}
