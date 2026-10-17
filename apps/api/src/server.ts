import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { prisma } from "@sp/db";
import Fastify, { type FastifyInstance } from "fastify";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { authRoutes } from "./auth/routes";
import { csrfGuard, errorHandler } from "./security";

export type ServerOptions = { logger?: boolean; loginRateLimit?: number; webOrigin?: string; registerRoutes?: (app: FastifyInstance) => Promise<void> };

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export async function buildServer(opts: ServerOptions = {}): Promise<FastifyInstance> {
  const production = process.env.NODE_ENV === "production";
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: 1024 * 1024,
    trustProxy: production
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(errorHandler);
  app.decorateRequest("auth", null);
  // Treat an empty JSON body as "no body" (fetch wrappers often send the header on body-less POSTs).
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 1024 * 1024 }, (_request, body, done) => {
    const text = String(body);
    if (!text.trim()) return done(null, undefined);
    try {
      done(null, JSON.parse(text));
    } catch {
      done(Object.assign(new Error("Request body is not valid JSON"), { statusCode: 400, code: "invalid_json" }), undefined);
    }
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, { origin: opts.webOrigin ?? process.env.WEB_ORIGIN ?? "http://localhost:5173", credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });
  await app.register(swagger, {
    openapi: { info: { title: "SocialPilot API", version: "0.1.0", description: "Every action goes through the permission-checked tool registry." } },
    transform: jsonSchemaTransform
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.addHook("preHandler", csrfGuard);

  await app.register(
    async (api) => {
      api.get("/health", { schema: { tags: ["system"] } }, async () => {
        const db = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false);
        return { ok: db, db };
      });
      await api.register(authRoutes({ loginRateLimit: opts.loginRateLimit ?? 5, secureCookies: production }));
      if (opts.registerRoutes) await opts.registerRoutes(api);
    },
    { prefix: "/api" }
  );

  return app;
}
