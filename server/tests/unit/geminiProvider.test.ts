import { describe, expect, it, vi } from "vitest";
import { ApiError, type GoogleGenAI } from "@google/genai";
import * as z from "zod/v4";
import { CircuitBreaker } from "../../src/ai/circuitBreaker.js";
import { LlmGateway, type AiCallRecord } from "../../src/ai/llmGateway.js";
import { GeminiProvider } from "../../src/ai/providers/geminiProvider.js";

const Schema = z.object({ category: z.enum(["ROYALTY", "OTHER"]), confidence: z.number() });

const request = () => ({
  task: "TRIAGE" as const,
  ticketId: "t1",
  model: "gemini-3.5-flash-lite",
  effort: "low" as const,
  maxTokens: 512,
  system: [{ text: "static instructions", cache: true }, { text: "category kb", cache: true }],
  user: "ticket text",
  schema: Schema,
  timeoutMs: 1000,
});

function setup(generate: (...args: unknown[]) => Promise<unknown>) {
  const records: AiCallRecord[] = [];
  const client = { models: { generateContent: vi.fn(generate) } } as unknown as Pick<GoogleGenAI, "models">;
  const gateway = new LlmGateway(new GeminiProvider(client), new CircuitBreaker(2, 60_000), async (r) => void records.push(r));
  return { gateway, records, generate: client.models.generateContent as unknown as ReturnType<typeof vi.fn> };
}

const reply = (overrides: Record<string, unknown> = {}) => ({
  text: '{"category":"ROYALTY","confidence":0.9}',
  modelVersion: "gemini-3.5-flash-lite",
  candidates: [{ finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 1200, cachedContentTokenCount: 1000, candidatesTokenCount: 20, thoughtsTokenCount: 80 },
  ...overrides,
});

describe("GeminiProvider", () => {
  it("sends a JSON schema, system instruction and thinking level; parses and validates the JSON", async () => {
    const { gateway, generate, records } = setup(async () => reply());
    const result = await gateway.structured(request());
    expect(result).toEqual({ ok: true, data: { category: "ROYALTY", confidence: 0.9 }, model: "gemini-3.5-flash-lite" });

    const { config } = generate.mock.calls[0]![0] as { config: Record<string, any> };
    expect(config.systemInstruction).toBe("static instructions\n\ncategory kb");
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseJsonSchema.properties.category.enum).toEqual(["ROYALTY", "OTHER"]);
    expect(config.responseJsonSchema.$schema).toBeUndefined();
    expect(config.thinkingConfig).toEqual({ thinkingLevel: "LOW" });

    // Cached prefix reported separately; thinking billed as output.
    expect(records[0]).toMatchObject({ outcome: "SUCCESS", inputTokens: 200, cacheReadTokens: 1000, outputTokens: 100 });
  });

  it("maps safety blocks to refusal and MAX_TOKENS to truncated", async () => {
    expect(await setup(async () => reply({ text: undefined, candidates: [{ finishReason: "SAFETY" }] })).gateway.structured(request())).toEqual({ ok: false, reason: "refusal" });
    expect(await setup(async () => reply({ text: "{", candidates: [{ finishReason: "MAX_TOKENS" }] })).gateway.structured(request())).toEqual({ ok: false, reason: "truncated" });
  });

  it("reports malformed JSON as invalid_output", async () => {
    expect(await setup(async () => reply({ text: "not json" })).gateway.structured(request())).toEqual({ ok: false, reason: "invalid_output" });
  });

  it("classifies quota, auth and server errors", async () => {
    const fail = (status: number) => async () => {
      throw new ApiError({ message: "x", status });
    };
    expect(await setup(fail(429)).gateway.structured(request())).toEqual({ ok: false, reason: "rate_limited" });
    expect(await setup(fail(403)).gateway.structured(request())).toEqual({ ok: false, reason: "auth_error" });
    expect(await setup(fail(503)).gateway.structured(request())).toEqual({ ok: false, reason: "api_error" });
  });

  it("retries an overloaded model on the next fallback model", async () => {
    let calls = 0;
    const { gateway, records, generate } = setup(async () => {
      if (calls++ === 0) throw new ApiError({ message: "high demand", status: 503 });
      return reply({ modelVersion: "gemini-3.5-flash-lite" });
    });
    const result = await gateway.structured({ ...request(), model: "gemini-3.5-flash", fallbackModels: ["gemini-3.5-flash-lite"] });
    expect(result).toMatchObject({ ok: true, model: "gemini-3.5-flash-lite" });
    expect((generate.mock.calls[1]![0] as { model: string }).model).toBe("gemini-3.5-flash-lite");
    expect(records.map((r) => [r.model, r.outcome])).toEqual([["gemini-3.5-flash", "ERROR"], ["gemini-3.5-flash-lite", "SUCCESS"]]);
  });

  it("doesn't switch models for a refusal", async () => {
    const { gateway, generate } = setup(async () => reply({ text: undefined, candidates: [{ finishReason: "SAFETY" }] }));
    await gateway.structured({ ...request(), fallbackModels: ["other-model"] });
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
