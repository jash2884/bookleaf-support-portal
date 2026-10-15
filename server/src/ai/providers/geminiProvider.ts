import { ApiError, FinishReason, ThinkingLevel, type GoogleGenAI } from "@google/genai";
import * as z from "zod/v4";
import type { AiFailureReason, LlmProvider, ProviderRequest, ProviderResponse } from "./types.js";

type ModelsClient = Pick<GoogleGenAI, "models">;

const THINKING: Record<ProviderRequest["effort"], ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

const BLOCKED: Array<FinishReason | undefined> = [
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
];

/**
 * Gemini via Google's official SDK.
 * - Structured output: the zod schema is converted to JSON Schema and enforced with `responseJsonSchema`.
 * - Caching: Gemini caches repeated prompt prefixes implicitly, so keeping the static
 *   system instruction first (as the prompt builders already do) is all that's needed;
 *   cache hits are reported in `cachedContentTokenCount`.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini" as const;

  constructor(private readonly client: ModelsClient) {}

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(req.schema) as Record<string, unknown>;

    const response = await this.client.models.generateContent({
      model: req.model,
      contents: req.user,
      config: {
        systemInstruction: req.system.map((b) => b.text).join("\n\n"),
        responseMimeType: "application/json",
        responseJsonSchema: jsonSchema,
        maxOutputTokens: req.maxTokens,
        thinkingConfig: { thinkingLevel: THINKING[req.effort] },
        // One retry on 429/5xx (the SDK default is 5, too slow for a request path).
        httpOptions: { timeout: req.timeoutMs, retryOptions: { attempts: 2 } },
      },
    });

    const finish = response.candidates?.[0]?.finishReason;
    const usage = response.usageMetadata;
    const cached = usage?.cachedContentTokenCount ?? 0;

    let output: unknown = null;
    try {
      output = response.text ? JSON.parse(response.text) : null;
    } catch {
      output = null; // gateway reports invalid_output
    }

    return {
      output,
      stop: response.promptFeedback?.blockReason || BLOCKED.includes(finish) ? "refusal" : finish === FinishReason.MAX_TOKENS ? "truncated" : "complete",
      model: response.modelVersion ?? req.model,
      usage: {
        inputTokens: Math.max(0, (usage?.promptTokenCount ?? 0) - cached),
        // Thinking tokens are billed as output.
        outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
    };
  }

  classifyError(error: unknown): AiFailureReason {
    if (error instanceof ApiError) {
      if (error.status === 429) return "rate_limited";
      if (error.status === 401 || error.status === 403) return "auth_error";
      if (error.status === 408 || error.status === 504) return "timeout";
      return "api_error";
    }
    if (error instanceof Error && /abort|timeout|timed out/i.test(`${error.name} ${error.message}`)) return "timeout";
    return "api_error"; // network failures etc.
  }
}
