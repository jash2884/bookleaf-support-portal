import Anthropic from "@anthropic-ai/sdk";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { CircuitBreaker } from "./circuitBreaker.js";
import { LlmGateway, type AiCallRecord } from "./llmGateway.js";

/** Persist every AI call for the cost/reliability dashboard. */
async function recordAiCall(entry: AiCallRecord) {
  if (entry.outcome !== "SUCCESS") logger.warn({ ai: entry }, "AI call did not succeed; fallback used");
  await prisma.aiCallLog.create({
    data: {
      task: entry.task,
      ticketId: entry.ticketId,
      model: entry.model,
      outcome: entry.outcome,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      cacheReadTokens: entry.cacheReadTokens,
      cacheWriteTokens: entry.cacheWriteTokens,
      costUsd: entry.costUsd,
      latencyMs: entry.latencyMs,
      errorType: entry.errorType,
    },
  });
}

// The API key is read from the environment on the server only. No key → the
// gateway runs in "disabled" mode and every caller uses its fallback path.
const client = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;

export const aiGateway = new LlmGateway(client, new CircuitBreaker(3, 60_000), recordAiCall);

export function aiStatus() {
  const mode = !aiGateway.enabled ? "offline" : aiGateway.circuitState === "closed" ? "online" : "degraded";
  return {
    mode,
    triageModel: env.AI_TRIAGE_MODEL,
    draftModel: env.AI_DRAFT_MODEL,
    circuit: aiGateway.circuitState,
  } as const;
}
