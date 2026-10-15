import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { AiFailureReason, LlmProvider, ProviderRequest, ProviderResponse } from "./types.js";

type MessagesClient = Pick<Anthropic, "messages">;

/** Claude via the official Anthropic SDK: structured output + explicit prompt-cache breakpoints. */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;

  constructor(private readonly client: MessagesClient) {}

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    const response = await this.client.messages.parse(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system.map((b) => ({ type: "text" as const, text: b.text, ...(b.cache && { cache_control: { type: "ephemeral" as const } }) })),
        messages: [{ role: "user", content: req.user }],
        output_config: { effort: req.effort, format: zodOutputFormat(req.schema) },
      },
      { timeout: req.timeoutMs, maxRetries: 1 },
    );

    return {
      output: response.parsed_output,
      stop: response.stop_reason === "refusal" ? "refusal" : response.stop_reason === "max_tokens" ? "truncated" : "complete",
      model: response.model,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }

  /** Most specific SDK error classes first (all extend Anthropic.APIError). */
  classifyError(error: unknown): AiFailureReason {
    if (error instanceof Anthropic.APIConnectionTimeoutError) return "timeout";
    if (error instanceof Anthropic.RateLimitError) return "rate_limited";
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "auth_error";
    if (error instanceof Anthropic.APIError) return "api_error"; // other 4xx/5xx/connection errors
    return "invalid_output"; // e.g. JSON/schema parse failure inside the SDK helper
  }
}
