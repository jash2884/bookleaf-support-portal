import { z } from "zod";

/**
 * All configuration is read from the environment once, validated, and exported
 * as a typed object. Secrets (JWT, LLM API keys) never leave the server.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  JWT_TTL_HOURS: z.coerce.number().int().positive().default(12),
  CORS_ORIGIN: z.string().optional(),
  UPLOAD_DIR: z.string().default("uploads"),

  /** "anthropic" | "gemini". If unset, the provider whose key is configured is used (Anthropic if both). */
  AI_PROVIDER: z.enum(["anthropic", "gemini"]).optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  /** Override the per-provider default models. */
  AI_TRIAGE_MODEL: z.string().optional(),
  AI_DRAFT_MODEL: z.string().optional(),
  /** Comma-separated models to try when the primary is overloaded / rate-limited. */
  AI_FALLBACK_MODELS: z.string().optional(),
  AI_DRAFT_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
});

/** Triage = high-volume classification (small, fast model); drafts = author-facing text (stronger model). */
const DEFAULT_MODELS = {
  anthropic: { triage: "claude-haiku-5-5", draft: "claude-opus-5-5", fallbacks: "" },
  // The free tier frequently returns 503 "high demand" for one model while another has capacity.
  gemini: { triage: "gemini-3.5-flash-lite", draft: "gemini-3.5-flash", fallbacks: "gemini-3.5-flash-lite,gemini-flash-latest" },
} as const;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  // Fail fast at boot rather than at the first request that needs a missing value.
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

// Treat an empty string the same as "not configured".
const anthropicKey = parsed.data.ANTHROPIC_API_KEY?.trim() || undefined;
const geminiKey = parsed.data.GEMINI_API_KEY?.trim() || undefined;
const provider = parsed.data.AI_PROVIDER ?? (anthropicKey ? "anthropic" : geminiKey ? "gemini" : "anthropic");

export const env = {
  ...parsed.data,
  ANTHROPIC_API_KEY: anthropicKey,
  GEMINI_API_KEY: geminiKey,
  AI_PROVIDER: provider,
  AI_TRIAGE_MODEL: parsed.data.AI_TRIAGE_MODEL?.trim() || DEFAULT_MODELS[provider].triage,
  AI_DRAFT_MODEL: parsed.data.AI_DRAFT_MODEL?.trim() || DEFAULT_MODELS[provider].draft,
  AI_FALLBACK_MODELS: (parsed.data.AI_FALLBACK_MODELS ?? DEFAULT_MODELS[provider].fallbacks)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean),
  isProduction: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
};

export type Env = typeof env;
