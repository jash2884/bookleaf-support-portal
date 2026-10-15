import type * as z from "zod/v4";
import type { TokenUsage } from "../pricing.js";

/** Why an AI call produced no usable output. Callers fall back on any of these. */
export type AiFailureReason =
  | "disabled" // no API key configured
  | "circuit_open" // recent failures; skipping calls during cooldown
  | "rate_limited"
  | "timeout"
  | "auth_error"
  | "api_error"
  | "refusal"
  | "truncated"
  | "invalid_output";

/** A chunk of system prompt. `cache: true` marks the end of a stable, cacheable prefix. */
export interface PromptBlock {
  text: string;
  cache?: boolean;
}

export interface ProviderRequest {
  model: string;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  /** Stable instructions first (cacheable); per-request content goes in `user`. */
  system: PromptBlock[];
  user: string;
  schema: z.ZodType;
  timeoutMs: number;
}

export interface ProviderResponse {
  /** Parsed JSON as returned by the model; the gateway validates it against the schema. */
  output: unknown;
  stop: "complete" | "refusal" | "truncated";
  model: string;
  usage: TokenUsage;
}

/**
 * One LLM vendor. Adapters translate the request into the vendor's API and map
 * its stop reasons, usage and errors onto ours. Everything else — circuit
 * breaking, validation, logging, fallbacks — lives in the gateway, so swapping
 * vendors doesn't change application behaviour.
 */
export interface LlmProvider {
  readonly name: "anthropic" | "gemini";
  generate(req: ProviderRequest): Promise<ProviderResponse>;
  /** Map a thrown error onto a failure reason. */
  classifyError(error: unknown): AiFailureReason;
}
