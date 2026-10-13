/**
 * USD per million tokens (Anthropic first-party list prices). Used only to put
 * an approximate cost on each logged call so ops can see spend per ticket.
 */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
};

const CACHE_WRITE_MULTIPLIER = 1.25; // 5-minute cache write
const CACHE_READ_MULTIPLIER = 0.1;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const price = PRICES[model];
  if (!price) return 0;
  const perToken = (perMillion: number) => perMillion / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.cacheWriteTokens * perToken(price.input) * CACHE_WRITE_MULTIPLIER +
    usage.cacheReadTokens * perToken(price.input) * CACHE_READ_MULTIPLIER +
    usage.outputTokens * perToken(price.output)
  );
}
