import { redactText } from "@sp/crypto";
import { NotFoundError } from "@sp/db";
import { InvalidUrlError } from "@sp/shared";
import { ToolDeniedError, ToolFailedError, ValidationError } from "@sp/tools";
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { hasZodFastifySchemaValidationErrors } from "fastify-type-provider-zod";
import { timingSafeEqual } from "node:crypto";
import { CSRF_COOKIE } from "./auth/session";
import { HttpError } from "./errors";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT = new Set(["/api/auth/login"]);

/** Double-submit CSRF: mutating requests must echo the sp_csrf cookie in the x-csrf-token header. */
export async function csrfGuard(request: FastifyRequest, reply: FastifyReply) {
  if (!MUTATING.has(request.method) || CSRF_EXEMPT.has(request.routeOptions.url ?? "")) return;
  const cookie = request.cookies[CSRF_COOKIE] ?? "";
  const header = String(request.headers["x-csrf-token"] ?? "");
  const ok = cookie.length > 0 && cookie.length === header.length && timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
  if (!ok) return reply.code(403).send({ error: { code: "csrf", message: "Missing or invalid CSRF token. Reload the page and try again." } });
}

const DENIAL_STATUS: Record<string, number> = { budget: 402 };

export function errorHandler(this: FastifyInstance, error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  const send = (status: number, code: string, message: string) => reply.code(status).send({ error: { code, message: redactText(message) } });

  if (hasZodFastifySchemaValidationErrors(error)) {
    const issues = error.validation.map((v) => `${v.instancePath.replace(/^\//, "").replaceAll("/", ".") || "request"} ${v.message}`);
    return send(400, "validation", issues.join("; "));
  }
  if (error instanceof HttpError) return send(error.statusCode, error.code, error.message);
  if (error instanceof NotFoundError) return send(404, "not_found", error.message);
  if (error instanceof ValidationError || error instanceof InvalidUrlError) return send(400, "validation", error.message);
  if (error instanceof ToolDeniedError) return send(DENIAL_STATUS[error.reason] ?? 403, error.reason, error.message);
  if (error instanceof ToolFailedError) return send(422, "tool_failed", error.message);

  const status = (error as FastifyError).statusCode;
  if (status && status < 500) return send(status, (error as FastifyError).code?.toLowerCase() ?? "bad_request", error.message);
  request.log.error({ err: { message: redactText(error.message), stack: error.stack } }, "unhandled error");
  return send(500, "internal", "Something went wrong on our side. The error was logged.");
}
