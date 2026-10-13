import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { forbidden, unauthorized } from "../lib/errors.js";

export const SESSION_COOKIE = "bl_session";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  /** Present for authors only. */
  authorId: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface TokenPayload {
  sub: string;
  role: Role;
}

export function signSession(user: { id: string; role: Role }): string {
  return jwt.sign({ role: user.role } satisfies Omit<TokenPayload, "sub">, env.JWT_SECRET, {
    subject: user.id,
    expiresIn: `${env.JWT_TTL_HOURS}h`,
  });
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // not readable from JS → not stealable via XSS
    sameSite: "lax", // not sent on cross-site POSTs → CSRF mitigation
    secure: env.isProduction,
    maxAge: env.JWT_TTL_HOURS * 3_600_000,
    path: "/",
  });
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice(7);
  const cookie = req.cookies?.[SESSION_COOKIE];
  return typeof cookie === "string" && cookie.length > 0 ? cookie : null;
}

/**
 * Accepts either a Bearer token (API clients, Swagger) or the httpOnly session
 * cookie (the web app, including EventSource which can't set headers).
 * The user is re-loaded on each request so deleted users / role changes take
 * effect immediately rather than when the token expires.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next(unauthorized());

  let payload: TokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch {
    return next(unauthorized("Session expired or invalid — please sign in again"));
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, role: true, author: { select: { id: true } } },
  });
  if (!user) return next(unauthorized("Account no longer exists"));

  req.user = { id: user.id, email: user.email, name: user.name, role: user.role, authorId: user.author?.id ?? null };
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

/** Narrowing helper for handlers mounted behind `authenticate`. */
export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
