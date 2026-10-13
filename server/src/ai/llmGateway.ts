import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type * as z from "zod/v4";
import type { AiCallOutcome, AiTask } from "@prisma/client";
import { CircuitBreaker, type CircuitState } from "./circuitBreaker.js";
import { estimateCostUsd, type TokenUsage } from "./pricing.js";

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

export type AiResult<T> = { ok: true; data: T; model: string } | { ok: false; reason: AiFailureReason };

export interface AiCallRecord extends TokenUsage {
  task: AiTask;
  ticketId?: string;
  model: string;
  outcome: AiCallOutcome;
  costUsd: number;
  latencyMs: number;
  errorType?: string;
}

export interface StructuredRequest<S extends z.ZodType> {
  task: AiTask;
  ticketId?: string;
  model: string;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  /** Stable, cacheable instructions first; per-request content goes in `user`. */
  system: Anthropic.TextBlockParam[];
  user: string;
  schema: S;
  timeoutMs: number;
}

type MessagesClient = Pick<Anthropic, "messages">;

/**
 * The only place the application talks to the LLM provider. It owns:
 * - structured output (Zod schema → JSON schema → validated object),
 * - timeouts and the circuit breaker,
 * - classifying failures so callers can degrade gracefully,
 * - recording tokens / cost / latency for every call.
 *
 * It never throws: callers get a discriminated result and decide on a fallback.
 */
export class LlmGateway {
  constructor(
    private readonly client: MessagesClient | null,
    private readonly breaker: CircuitBreaker,
    private readonly record: (entry: AiCallRecord) => Promise<void>,
  ) {}

  get enabled() {
    return this.client !== null;
  }

  get circuitState(): CircuitState {
    return this.breaker.state;
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<AiResult<z.infer<S>>> {
    const meta = { task: req.task, ticketId: req.ticketId, model: req.model };
    if (!this.client) return this.skip(meta, "disabled");
    if (!this.breaker.tryAcquire()) return this.skip(meta, "circuit_open");

    const started = Date.now();
    try {
      const response = await this.client.messages.parse(
        {
          model: req.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: "user", content: req.user }],
          output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
        },
        { timeout: req.timeoutMs, maxRetries: 1 },
      );

      const usage: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
      const record = { ...meta, ...usage, latencyMs: Date.now() - started, costUsd: estimateCostUsd(req.model, usage) };

      // A refusal, truncation or malformed output says nothing about provider
      // health, so it releases the breaker slot instead of counting as a failure.
      const failure: AiFailureReason | null =
        response.stop_reason === "refusal"
          ? "refusal"
          : response.stop_reason === "max_tokens"
            ? "truncated"
            : response.parsed_output
              ? null
              : "invalid_output";
      if (failure) {
        this.breaker.release();
        await this.log({ ...record, outcome: "ERROR", errorType: failure });
        return { ok: false, reason: failure };
      }

      this.breaker.recordSuccess();
      await this.log({ ...record, outcome: "SUCCESS" });
      return { ok: true, data: response.parsed_output as z.infer<S>, model: response.model };
    } catch (error) {
      const reason = classifyError(error);
      if (reason === "invalid_output") this.breaker.release();
      else this.breaker.recordFailure();
      await this.log({ ...meta, ...NO_USAGE, latencyMs: Date.now() - started, outcome: "ERROR", errorType: reason });
      return { ok: false, reason };
    }
  }

  private async skip(meta: Pick<AiCallRecord, "task" | "ticketId" | "model">, reason: AiFailureReason): Promise<AiResult<never>> {
    await this.log({ ...meta, ...NO_USAGE, latencyMs: 0, outcome: "SKIPPED", errorType: reason });
    return { ok: false, reason };
  }

  private async log(entry: AiCallRecord) {
    try {
      await this.record(entry);
    } catch {
      // Usage logging must never break the request path.
    }
  }
}

const NO_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 };

/** Most specific SDK error classes first (all extend Anthropic.APIError). */
export function classifyError(error: unknown): AiFailureReason {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
  if (error instanceof Anthropic.RateLimitError) return "rate_limited";
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "auth_error";
  if (error instanceof Anthropic.APIError) return "api_error"; // 4xx/5xx/connection errors
  return "invalid_output"; // e.g. JSON/schema parse failure inside the SDK helper
}
