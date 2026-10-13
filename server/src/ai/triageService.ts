import type { DecisionSource } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";
import { bookPayoutStatus } from "../domain/royalty.js";
import { ticketEvents } from "../realtime/eventBus.js";
import { aiGateway } from "./index.js";
import { renderAccountFacts, TICKET_CONTEXT_INCLUDE, type TicketWithContext } from "./accountFacts.js";
import { buildTriageRequest, TriageSchema, type TriageOutput } from "./prompts/triagePrompt.js";
import { ruleBasedTriage } from "./fallback/ruleBasedTriage.js";

const inFlight = new Map<string, Promise<void>>();

/**
 * Classify a ticket (category + priority + summary). Runs off the request path:
 * ticket creation commits first, then triage happens in the background, so an
 * AI outage can never block an author from raising a ticket.
 *
 * Concurrent calls for the same ticket share one run (creation hook + sweeper).
 */
export function triageTicket(ticketId: string, opts: { force?: boolean } = {}): Promise<void> {
  const existing = inFlight.get(ticketId);
  if (existing) return existing;
  const run = runTriage(ticketId, opts)
    .catch((err) => logger.error({ err, ticketId }, "Triage failed"))
    .finally(() => inFlight.delete(ticketId));
  inFlight.set(ticketId, run);
  return run;
}

async function runTriage(ticketId: string, { force = false }: { force?: boolean }) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: TICKET_CONTEXT_INCLUDE });
  if (!ticket || (!force && ticket.triageState !== "PENDING")) return;

  const now = new Date();
  const { system, user } = buildTriageRequest({
    subject: ticket.subject,
    description: ticket.description,
    bookTitle: ticket.book?.title ?? null,
    accountFacts: renderAccountFacts(ticket, now, "brief"),
  });

  const ai = await aiGateway.structured({
    task: "TRIAGE",
    ticketId,
    model: env.AI_TRIAGE_MODEL,
    effort: "low", // classification doesn't benefit from deep reasoning; keeps latency and cost down
    maxTokens: 2048, // headroom for adaptive thinking + a ~100-token JSON answer
    system,
    user,
    schema: TriageSchema,
    timeoutMs: env.AI_TIMEOUT_MS,
  });

  const result: TriageOutput = ai.ok ? ai.data : ruleBasedTriage(ruleInput(ticket, now));
  const source: DecisionSource = ai.ok ? "AI" : "RULES";

  await prisma.$transaction(async (tx) => {
    // Re-read inside the transaction: an admin may have overridden while we waited on the model.
    const current = await tx.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: { categorySource: true, prioritySource: true },
    });
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        triageState: ai.ok ? "AI" : "FALLBACK",
        aiCategory: result.category,
        aiPriority: result.priority,
        aiConfidence: Math.min(1, Math.max(0, result.confidence)),
        aiSummary: result.summary.slice(0, 200),
        aiRationale: result.rationale.slice(0, 1000),
        triagedAt: now,
        // Never clobber an admin's manual override.
        ...(current.categorySource !== "ADMIN" && { category: result.category, categorySource: source }),
        ...(current.prioritySource !== "ADMIN" && { priority: result.priority, prioritySource: source }),
      },
    });
    await tx.ticketActivity.create({
      data: {
        ticketId,
        type: "triaged",
        toValue: `${result.category} · ${result.priority} (${ai.ok ? "AI" : `rules — AI ${ai.reason}`})`,
      },
    });
  });

  ticketEvents.publish({ type: "ticket.updated", ticketId, authorId: ticket.authorId, audience: "admins" });
}

function ruleInput(ticket: TicketWithContext, now: Date) {
  const authorPending = ticket.author.books.reduce((s, b) => s + b.royaltyPending.toNumber(), 0);
  const book = ticket.book;
  return {
    subject: ticket.subject,
    description: ticket.description,
    bookStage: book?.stage ?? null,
    royaltyPossiblyOverdue: book
      ? bookPayoutStatus(
          { royaltyPending: book.royaltyPending.toNumber(), lastRoyaltyPayoutDate: book.lastRoyaltyPayoutDate, publicationDate: book.publicationDate },
          authorPending,
          now,
        ).possiblyOverdue
      : false,
  };
}

/**
 * Safety net: picks up tickets still PENDING (server restarted mid-triage,
 * seeded demo data, or a crash). Runs at boot and then periodically.
 */
export function startTriageSweeper(intervalMs = 60_000): () => void {
  const sweep = async () => {
    try {
      const pending = await prisma.ticket.findMany({
        where: { triageState: "PENDING" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
        take: 25,
      });
      for (const { id } of pending) await triageTicket(id);
    } catch (err) {
      logger.error({ err }, "Triage sweep failed");
    }
  };
  void sweep();
  const timer = setInterval(sweep, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
