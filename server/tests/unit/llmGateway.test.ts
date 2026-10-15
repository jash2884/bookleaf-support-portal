import { describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import * as z from "zod/v4";
import { CircuitBreaker } from "../../src/ai/circuitBreaker.js";
import { LlmGateway, type AiCallRecord } from "../../src/ai/llmGateway.js";
import { AnthropicProvider } from "../../src/ai/providers/anthropicProvider.js";

const Schema = z.object({ answer: z.string() });

function request() {
  return {
    task: "TRIAGE" as const,
    ticketId: "t1",
    model: "claude-haiku-5-5",
    effort: "low" as const,
    maxTokens: 512,
    system: [{ text: "system", cache: true }],
    user: "hello",
    schema: Schema,
    timeoutMs: 1000,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    model: "claude-haiku-5-5",
    stop_reason: "end_turn",
    parsed_output: { answer: "ok" },
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 },
    ...overrides,
  };
}

function setup(parse: (...args: unknown[]) => Promise<unknown>) {
  const records: AiCallRecord[] = [];
  const client = { messages: { parse: vi.fn(parse) } } as unknown as Pick<Anthropic, "messages">;
  const breaker = new CircuitBreaker(2, 60_000);
  const gateway = new LlmGateway(new AnthropicProvider(client), breaker, async (r) => void records.push(r));
  return { gateway, breaker, records, parse: (client.messages.parse as unknown as ReturnType<typeof vi.fn>) };
}

describe("LlmGateway (Anthropic provider)", () => {
  it("returns parsed output and records tokens and cost", async () => {
    const { gateway, records } = setup(async () => response());
    const result = await gateway.structured(request());
    expect(result).toEqual({ ok: true, data: { answer: "ok" }, model: "claude-haiku-5-5" });
    expect(records[0]).toMatchObject({ outcome: "SUCCESS", inputTokens: 1000, outputTokens: 100, cacheReadTokens: 2000 });
    // 1000 × $0.10/M + 2000 × $0.01/M (cache read) + 100 × $0.50/M
    expect(records[0]!.costUsd).toBeCloseTo(0.00017, 8);
  });

  it("sends the structured output format and effort to the SDK", async () => {
    const { gateway, parse } = setup(async () => response());
    await gateway.structured(request());
    const params = parse.mock.calls[0]![0] as { output_config: { effort: string; format: unknown }; system: unknown[] };
    expect(params.output_config.effort).toBe("low");
    expect(params.output_config.format).toBeDefined();
    expect(params.system).toEqual([{ type: "text", text: "system", cache_control: { type: "ephemeral" } }]);
  });

  it("degrades without calling the API when no key is configured", async () => {
    const records: AiCallRecord[] = [];
    const gateway = new LlmGateway(null, new CircuitBreaker(), async (r) => void records.push(r));
    expect(await gateway.structured(request())).toEqual({ ok: false, reason: "disabled" });
    expect(records[0]).toMatchObject({ outcome: "SKIPPED", errorType: "disabled" });
  });

  it("classifies rate limits and opens the circuit after repeated failures", async () => {
    const { gateway, parse, breaker } = setup(async () => {
      throw new Anthropic.RateLimitError(429, { type: "error" }, "rate limited", new Headers());
    });
    expect(await gateway.structured(request())).toEqual({ ok: false, reason: "rate_limited" });
    expect(await gateway.structured(request())).toEqual({ ok: false, reason: "rate_limited" });
    expect(breaker.state).toBe("open");

    // While open, calls are skipped immediately — no request reaches the provider.
    expect(await gateway.structured(request())).toEqual({ ok: false, reason: "circuit_open" });
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it("maps timeouts and server errors", async () => {
    const timeout = setup(async () => {
      throw new Anthropic.APIConnectionTimeoutError();
    });
    expect(await timeout.gateway.structured(request())).toEqual({ ok: false, reason: "timeout" });

    const server = setup(async () => {
      throw new Anthropic.InternalServerError(529, { type: "error" }, "overloaded", new Headers());
    });
    expect(await server.gateway.structured(request())).toEqual({ ok: false, reason: "api_error" });
  });

  it("treats refusals and truncation as failures without tripping the breaker", async () => {
    const refused = setup(async () => response({ stop_reason: "refusal", parsed_output: null }));
    expect(await refused.gateway.structured(request())).toEqual({ ok: false, reason: "refusal" });
    expect(refused.breaker.state).toBe("closed");

    const cut = setup(async () => response({ stop_reason: "max_tokens", parsed_output: null }));
    expect(await cut.gateway.structured(request())).toEqual({ ok: false, reason: "truncated" });
  });

  it("rejects output that doesn't match the schema", async () => {
    const { gateway } = setup(async () => response({ parsed_output: { wrong: 1 } }));
    expect(await gateway.structured(request())).toEqual({ ok: false, reason: "invalid_output" });
  });

  it("never throws if usage logging fails", async () => {
    const client = { messages: { parse: async () => response() } } as unknown as Pick<Anthropic, "messages">;
    const gateway = new LlmGateway(new AnthropicProvider(client), new CircuitBreaker(), async () => {
      throw new Error("db down");
    });
    await expect(gateway.structured(request())).resolves.toMatchObject({ ok: true });
  });
});

describe("CircuitBreaker", () => {
  it("lets one trial call through after the cooldown and closes on success", () => {
    let now = 0;
    const breaker = new CircuitBreaker(1, 1000, () => now);
    breaker.recordFailure();
    expect(breaker.tryAcquire()).toBe(false);
    now = 1500;
    expect(breaker.tryAcquire()).toBe(true); // half-open trial
    expect(breaker.tryAcquire()).toBe(false); // only one trial at a time
    breaker.recordSuccess();
    expect(breaker.state).toBe("closed");
  });

  it("re-opens if the trial call fails", () => {
    let now = 0;
    const breaker = new CircuitBreaker(3, 1000, () => now);
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    now = 1001;
    expect(breaker.tryAcquire()).toBe(true);
    breaker.recordFailure();
    expect(breaker.state).toBe("open");
  });
});
