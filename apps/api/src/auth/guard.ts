import type { FastifyReply, FastifyRequest } from "fastify";
import { unauthorized } from "../errors";
import { resolveSession, SESSION_COOKIE } from "./session";

export type AuthContext = { sessionId: string; userId: string; workspaceId: string };

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

/** preHandler: requires a valid session; sets `request.auth`. */
export async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
  const auth = await resolveSession(request.cookies[SESSION_COOKIE]);
  if (!auth) throw unauthorized();
  request.auth = auth;
}

/** `request.auth` for handlers behind requireAuth. */
export function authOf(request: FastifyRequest): AuthContext {
  if (!request.auth) throw unauthorized();
  return request.auth;
}
