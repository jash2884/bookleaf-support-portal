import { Router } from "express";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { unauthorized } from "../../lib/errors.js";
import { env } from "../../config/env.js";
import { authenticate, currentUser, SESSION_COOKIE, setSessionCookie, signSession } from "../../http/auth.js";
import { parseInput } from "../../http/validate.js";

const LoginBody = z.object({
  email: z.email().transform((e) => e.toLowerCase().trim()),
  password: z.string().min(1, "Password is required").max(200),
});

// Throttle brute-force attempts per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.isTest ? 1000 : 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many sign-in attempts. Try again in a few minutes." } },
});

// Constant-time-ish response for unknown emails (don't reveal which accounts exist).
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 10);

export const authRouter = Router();

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { email, password } = parseInput(LoginBody, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !valid) throw unauthorized("Incorrect email or password");

  const token = signSession(user);
  setSessionCookie(res, token);
  res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role }, token });
});

authRouter.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.status(204).end();
});

authRouter.get("/me", authenticate, (req, res) => {
  const { id, email, name, role } = currentUser(req);
  res.json({ user: { id, email, name, role } });
});
