import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { aiStatus } from "./ai/index.js";
import { startTriageSweeper } from "./ai/triageService.js";

const app = createApp();
const server = app.listen(env.PORT, () => {
  const ai = aiStatus();
  logger.info(`BookLeaf support API listening on http://localhost:${env.PORT}`);
  logger.info(
    ai.mode === "offline"
      ? "AI offline (no ANTHROPIC_API_KEY): rule-based triage and template drafts are active"
      : `AI online — triage: ${ai.triageModel}, drafts: ${ai.draftModel}`,
  );
});

const stopSweeper = startTriageSweeper();

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  stopSweeper();
  server.close();
  // SSE connections never end on their own; don't let them hold the process open.
  server.closeAllConnections();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
