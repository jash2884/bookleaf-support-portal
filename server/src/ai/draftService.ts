import type { AiDraft } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { notFound } from "../lib/errors.js";
import { ticketReference } from "../domain/taxonomy.js";
import { ticketEvents } from "../realtime/eventBus.js";
import { aiGateway } from "./index.js";
import type { AiFailureReason } from "./llmGateway.js";
import { renderAccountFacts, TICKET_CONTEXT_INCLUDE } from "./accountFacts.js";
import { buildDraftRequest, DraftSchema, type ConversationEntry, type DraftOutput } from "./prompts/draftPrompt.js";
import { templateDraft } from "./fallback/templateDraft.js";

export const TEMPLATE_MODEL = "template";

export type DraftStatus = "cached" | "generated" | "not_needed";
export interface DraftResult {
  status: DraftStatus;
  draft: AiDraft | null;
}

const inFlight = new Map<string, Promise<AiDraft>>();

/**
 * Returns the reply draft for a ticket, generating one only when it's useful:
 *
 * - a cached draft is reused while no new author message has arrived since it
 *   was written (one LLM call per author message, not per page view);
 * - nothing is generated when BookLeaf spoke last (we're waiting on the author);
 * - a template draft made during an outage is upgraded once the AI is back.
 *
 * `regenerate: true` (the admin's "Regenerate" button) always produces a new one.
 */
export async function getReplyDraft(
  ticketId: string,
  agent: { id: string; name: string },
  opts: { regenerate?: boolean } = {},
): Promise<DraftResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      messages: { where: { visibility: "PUBLIC" }, select: { sender: { select: { role: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!ticket) throw notFound("Ticket");

  const publicCount = ticket.messages.length;
  const latest = await prisma.aiDraft.findFirst({ where: { ticketId }, orderBy: { createdAt: "desc" } });

  if (!opts.regenerate) {
    const aiUsable = aiGateway.enabled && aiGateway.circuitState !== "open";
    const fresh = latest && latest.basedOnMessageCount === publicCount;
    if (fresh && (latest.model !== TEMPLATE_MODEL || !aiUsable)) return { status: "cached", draft: latest };

    const lastSpeaker = ticket.messages.at(-1)?.sender.role ?? "AUTHOR"; // the description counts as the author's
    if (lastSpeaker === "ADMIN") return { status: "not_needed", draft: null };
  }

  // Two admins opening the same ticket at once share one generation.
  let pending = inFlight.get(ticketId);
  if (!pending) {
    pending = generateDraft(ticketId, agent, publicCount).finally(() => inFlight.delete(ticketId));
    inFlight.set(ticketId, pending);
  }
  return { status: "generated", draft: await pending };
}

async function generateDraft(ticketId: string, agent: { name: string }, publicCount: number): Promise<AiDraft> {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    include: {
      ...TICKET_CONTEXT_INCLUDE,
      messages: { include: { sender: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" } },
    },
  });

  const now = new Date();
  const category = ticket.category ?? "GENERAL_INQUIRY";
  const conversation: ConversationEntry[] = [
    { from: "author", name: ticket.author.user.name, body: ticket.description, at: ticket.createdAt },
    ...ticket.messages.map(
      (m): ConversationEntry => ({
        from: m.visibility === "INTERNAL" ? "internal_note" : m.sender.role === "AUTHOR" ? "author" : "agent",
        name: m.sender.name,
        body: m.body,
        at: m.createdAt,
      }),
    ),
  ];

  const { system, user } = buildDraftRequest({
    ticketRef: ticketReference(ticket.number),
    category,
    agentName: agent.name,
    subject: ticket.subject,
    accountFacts: renderAccountFacts(ticket, now, "full"),
    conversation,
  });

  const ai = await aiGateway.structured({
    task: "DRAFT",
    ticketId,
    model: env.AI_DRAFT_MODEL,
    effort: env.AI_DRAFT_EFFORT,
    maxTokens: 4096,
    system,
    user,
    schema: DraftSchema,
    timeoutMs: env.AI_TIMEOUT_MS,
  });

  const output: DraftOutput = ai.ok ? ai.data : templateDraft(ticket, category, agent.name, now);
  const fallbackReason: AiFailureReason | null = ai.ok ? null : ai.reason;

  const draft = await prisma.aiDraft.create({
    data: {
      ticketId,
      body: output.reply.trim(),
      internalActions: output.internal_actions.map((a) => a.trim()).filter(Boolean).slice(0, 8),
      model: ai.ok ? ai.model : TEMPLATE_MODEL,
      fallbackReason,
      basedOnMessageCount: publicCount,
    },
  });
  ticketEvents.publish({ type: "ticket.draft", ticketId, authorId: ticket.authorId, audience: "admins" });
  return draft;
}

/** API shape for a draft; `isFallback` tells the UI to show the "AI unavailable" banner. */
export function toDraftDto(draft: AiDraft | null) {
  if (!draft) return null;
  return {
    id: draft.id,
    body: draft.body,
    internalActions: draft.internalActions,
    model: draft.model,
    isFallback: draft.model === TEMPLATE_MODEL,
    fallbackReason: draft.fallbackReason,
    createdAt: draft.createdAt,
  };
}
