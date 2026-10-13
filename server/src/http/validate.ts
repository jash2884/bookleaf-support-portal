import type { z } from "zod";
import { AppError } from "../lib/errors.js";

/**
 * Parse untrusted input against a schema, or throw a 400 that tells the client
 * exactly which fields are wrong:
 *   { error: { code: "VALIDATION_ERROR", message, details: [{ path, message }] } }
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown, where: "body" | "query" | "params" = "body"): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const details = result.error.issues.map((i) => ({ path: [where, ...i.path].join("."), message: i.message }));
  throw new AppError(400, "VALIDATION_ERROR", `Invalid request ${where}: ${details[0]?.path} — ${details[0]?.message}`, details);
}

/** Typed access to a route parameter (Express 5 loses param types behind middleware chains). */
export function pathParam(req: { params: Record<string, unknown> }, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) throw new AppError(400, "VALIDATION_ERROR", `Missing path parameter: ${name}`);
  return value;
}
