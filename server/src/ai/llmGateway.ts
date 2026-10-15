import type * as z from "zod/v4";
import type { AiCallOutcome, AiTask } from "@prisma/client";
import { CircuitBreaker, type CircuitState } from "./circuitBreaker.js";
import { estimateCostUsd, type TokenUsage } from "./pricing.js";
import type { AiFailureReason, LlmProvider, PromptBlock } from "./providers/types.js";

export type { AiFailureReason, PromptBlock } from "./providers/types.js";

export type AiResult<T> = { ok: true; data: T; model: string } | { ok: false; reason: AiFailureReason };

export interface AiCallRecord extends TokenUsage {
  task: AiTask;
  ticketId?: string;
  model: string;
  outcome: AiCallOutcome;
  costUsd: number;
  latencyMs: number;
  errorType?: string;
  /** Provider error message, for logs only (not persisted). */
  errorDetail?: string;
}

export interface StructuredRequest<S extends z.ZodType> {
  task: AiTask;
  ticketId?: string;
  model: string;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  /** Stable, cacheable instructions first; per-request content goes in `user`. */
  system: PromptBlock[];
  user: string;
  schema: S;
  timeoutMs: number;
  /** Tried in order when the primary model is overloaded, rate-limited or times out. */
  fallbackModels?: string[];
}

/** Failures worth retrying on a different model (capacity problems, not bad requests). */
const CAPACITY_FAILURES: AiFailureReason[] = ["rate_limited", "api_error", "timeout"];

/**
 * The only place the application talks to an LLM. Independent of the vendor
 * (see providers/), it owns:
 * - schema validation of the model's output,
 * - the circuit breaker,
 * - classifying failures so callers can degrade gracefully,
 * - recording tokens / cost / latency for every call.
 *
 * It never throws: callers get a discriminated result and decide on a fallback.
 */
export class LlmGateway {
  constructor(
    private readonly provider: LlmProvider | null,
    private readonly breaker: CircuitBreaker,
    private readonly record: (entry: AiCallRecord) => Promise<void>,
  ) {}

  get enabled() {
    return this.provider !== null;
  }

  get providerName() {
    return this.provider?.name ?? null;
  }

  get circuitState(): CircuitState {
    return this.breaker.state;
  }

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<AiResult<z.infer<S>>> {
    const meta = { task: req.task, ticketId: req.ticketId, model: req.model };
    if (!this.provider) return this.skip(meta, "disabled");
    if (!this.breaker.tryAcquire()) return this.skip(meta, "circuit_open");

    const models = [req.model, ...(req.fallbackModels ?? []).filter((m) => m !== req.model)];
    let reason: AiFailureReason = "api_error";
    for (const [i, model] of models.entries()) {
      const result = await this.attempt(this.provider, { ...req, model });
      if (result.ok) {
        this.breaker.recordSuccess();
        return result;
      }
      reason = result.reason;
      // Only capacity problems justify trying another model; a refusal or bad output won't improve.
      if (!CAPACITY_FAILURES.includes(reason) || i === models.length - 1) break;
    }

    // A refusal, truncation or malformed output says nothing about provider
    // health, so it releases the breaker slot instead of counting as a failure.
    if (CAPACITY_FAILURES.includes(reason) || reason === "auth_error") this.breaker.recordFailure();
    else this.breaker.release();
    return { ok: false, reason };
  }

  /** One call to one model: validate, log, never throw. */
  private async attempt<S extends z.ZodType>(provider: LlmProvider, req: StructuredRequest<S>): Promise<AiResult<z.infer<S>>> {
    const meta = { task: req.task, ticketId: req.ticketId, model: req.model };
    const started = Date.now();
    try {
      const response = await provider.generate(req);
      const record = { ...meta, ...response.usage, latencyMs: Date.now() - started, costUsd: estimateCostUsd(req.model, response.usage) };

      const parsed = response.stop === "complete" ? req.schema.safeParse(response.output) : null;
      if (!parsed?.success) {
        const failure: AiFailureReason = response.stop === "refusal" ? "refusal" : response.stop === "truncated" ? "truncated" : "invalid_output";
        await this.log({ ...record, outcome: "ERROR", errorType: failure });
        return { ok: false, reason: failure };
      }

      await this.log({ ...record, outcome: "SUCCESS" });
      return { ok: true, data: parsed.data as z.infer<S>, model: response.model };
    } catch (error) {
      const reason = provider.classifyError(error);
      const errorDetail = error instanceof Error ? error.message.slice(0, 300) : String(error);
      await this.log({ ...meta, ...NO_USAGE, latencyMs: Date.now() - started, outcome: "ERROR", errorType: reason, errorDetail });
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
