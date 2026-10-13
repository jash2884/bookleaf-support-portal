import { z } from "zod";

/**
 * All configuration is read from the environment once, validated, and exported
 * as a typed object. Secrets (JWT, Anthropic key) never leave the server.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_TTL_HOURS: z.coerce.number().int().positive().default(12),
  CORS_ORIGIN: z.string().optional(),
  UPLOAD_DIR: z.string().default("uploads"),

  ANTHROPIC_API_KEY: z.string().optional(),
  AI_TRIAGE_MODEL: z.string().default("claude-haiku-5-5"),
  AI_DRAFT_MODEL: z.string().default("claude-opus-5-5"),
  AI_DRAFT_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  // Fail fast at boot rather than at the first request that needs a missing value.
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = {
  ...parsed.data,
  // Treat an empty string the same as "not configured".
  ANTHROPIC_API_KEY: parsed.data.ANTHROPIC_API_KEY?.trim() || undefined,
  isProduction: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
};

export type Env = typeof env;
