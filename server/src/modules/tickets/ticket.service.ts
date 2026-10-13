import type { Prisma, ReplyOrigin, TicketStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import type { AuthUser } from "../../http/auth.js";
import { ticketEvents } from "../../realtime/eventBus.js";
import { triageTicket } from "../../ai/triageService.js";
import { TEMPLATE_MODEL } from "../../ai/draftService.js";
import {
  TICKET_DETAIL_INCLUDE,
  TICKET_LIST_INCLUDE,
  toAdminDetail,
  toAdminListItem,
  toAuthorDetail,
  toAuthorListItem,
} from "./ticket.serializer.js";
import type { AddMessageBody, ListTicketsQuery, UpdateTicketBody } from "./ticket.schemas.js";

const CLOSED_STATES: TicketStatus[] = ["RESOLVED", "CLOSED"];

/** Loads a ticket the actor may see, or 404s (never 403) so ids can't be probed. */
async function loadVisibleTicket(actor: AuthUser, ticketId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId }, include: TICKET_DETAIL_INCLUDE });
  if (!ticket || (actor.role === "AUTHOR" && ticket.authorId !== actor.authorId)) throw notFound("Ticket");
  return ticket;
}

function present(actor: AuthUser, ticket: Awaited<ReturnType<typeof loadVisibleTicket>>) {
  return actor.role === "ADMIN" ? toAdminDetail(ticket) : toAuthorDetail(ticket);
}

export async function getTicket(actor: AuthUser, ticketId: string) {
  return present(actor, await loadVisibleTicket(actor, ticketId));
}

export async function listTickets(actor: AuthUser, query: ListTicketsQuery) {
  const where: Prisma.TicketWhereInput = {};
  const and: Prisma.TicketWhereInput[] = [];

  if (actor.role === "AUTHOR") where.authorId = actor.authorId!;
  if (query.status?.length) where.status = { in: query.status };

  if (actor.role === "ADMIN") {
    if (query.category?.length) where.category = { in: query.category };
    if (query.priority?.length) where.priority = { in: query.priority };
    if (query.assignee === "me") where.assigneeId = actor.id;
    else if (query.assignee === "unassigned") where.assigneeId = null;
    else if (query.assignee) where.assigneeId = query.assignee;
  }

  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from && { gte: query.from }),
      // `to` is an inclusive calendar day.
      ...(query.to && { lt: new Date(query.to.getTime() + 86_400_000) }),
    };
  }

  if (query.q) {
    const contains = { contains: query.q, mode: "insensitive" as const };
    const ref = /^bl-?(\d+)$/i.exec(query.q);
    and.push({
      OR: [
        { subject: contains },
        { description: contains },
        { book: { title: contains } },
        ...(actor.role === "ADMIN" ? [{ author: { user: { name: contains } } }] : []),
        ...(ref ? [{ number: Number(ref[1]) }] : []),
      ],
    });
  }
  if (and.length) where.AND = and;

  // Authors care about recent activity; the ops queue cares about urgency then age.
  const sort = actor.role === "AUTHOR" && query.sort === "urgency" ? "updated" : query.sort;
  const orderBy: Prisma.TicketOrderByWithRelationInput[] = {
    // Postgres orders enums by declaration: CRITICAL < HIGH < MEDIUM < LOW. Untriaged first.
    urgency: [{ priority: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    oldest: [{ createdAt: "asc" }],
    newest: [{ createdAt: "desc" }],
    updated: [{ lastActivityAt: "desc" }],
  }[sort] as Prisma.TicketOrderByWithRelationInput[];

  const [rows, total] = await prisma.$transaction([
    prisma.ticket.findMany({
      where,
      include: TICKET_LIST_INCLUDE,
      orderBy,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.ticket.count({ where }),
  ]);

  return {
    data: actor.role === "ADMIN" ? rows.map(toAdminListItem) : rows.map(toAuthorListItem),
    pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
  };
}

export interface NewAttachment {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

export async function createTicket(
  actor: AuthUser,
  input: { bookId: string | null; subject: string; description: string },
  attachment: NewAttachment | null,
) {
  if (actor.role !== "AUTHOR" || !actor.authorId) throw forbidden("Only authors can raise tickets");

  if (input.bookId) {
    const book = await prisma.book.findFirst({ where: { id: input.bookId, authorId: actor.authorId }, select: { id: true } });
    if (!book) throw badRequest("Selected book was not found in your account", [{ path: "body.bookId", message: "Unknown book" }]);
  }

  const ticket = await prisma.ticket.create({
    data: {
      authorId: actor.authorId,
      bookId: input.bookId,
      subject: input.subject,
      description: input.description,
      attachments: attachment ? { create: attachment } : undefined,
      activities: { create: { actorId: actor.id, type: "created" } },
    },
  });

  ticketEvents.publish({ type: "ticket.created", ticketId: ticket.id, authorId: actor.authorId, audience: "everyone" });

  // Fire-and-forget: the author gets their confirmation immediately; the
  // classification arrives a moment later via the realtime channel.
  void triageTicket(ticket.id);

  return getTicket(actor, ticket.id);
}

export async function updateTicket(actor: AuthUser, ticketId: string, body: UpdateTicketBody) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw notFound("Ticket");

  if (body.assigneeId) {
    const assignee = await prisma.user.findFirst({ where: { id: body.assigneeId, role: "ADMIN" }, select: { id: true } });
    if (!assignee) throw badRequest("Tickets can only be assigned to BookLeaf team members", [{ path: "body.assigneeId", message: "Not an admin user" }]);
  }

  const data: Prisma.TicketUncheckedUpdateInput = {};
  const activities: Prisma.TicketActivityCreateManyInput[] = [];
  const log = (type: string, fromValue: string | null, toValue: string | null) =>
    activities.push({ ticketId, actorId: actor.id, type, fromValue, toValue });

  if (body.status && body.status !== ticket.status) {
    Object.assign(data, statusChange(ticket.status, body.status));
    log("status_changed", ticket.status, body.status);
  }
  if (body.category && (body.category !== ticket.category || ticket.categorySource !== "ADMIN")) {
    data.category = body.category;
    data.categorySource = "ADMIN";
    log("category_overridden", ticket.category, body.category);
  }
  if (body.priority && (body.priority !== ticket.priority || ticket.prioritySource !== "ADMIN")) {
    data.priority = body.priority;
    data.prioritySource = "ADMIN";
    log("priority_overridden", ticket.priority, body.priority);
  }
  if (body.assigneeId !== undefined && body.assigneeId !== ticket.assigneeId) {
    data.assigneeId = body.assigneeId;
    log(body.assigneeId ? "assigned" : "unassigned", ticket.assigneeId, body.assigneeId);
  }

  if (activities.length) {
    await prisma.$transaction([
      prisma.ticket.update({ where: { id: ticketId }, data }),
      prisma.ticketActivity.createMany({ data: activities }),
    ]);
    // Authors only hear about changes they can see (status), not triage/assignment.
    const audience = data.status ? "everyone" : "admins";
    ticketEvents.publish({ type: "ticket.updated", ticketId, authorId: ticket.authorId, audience });
  }

  return getTicket(actor, ticketId);
}

function statusChange(from: TicketStatus, to: TicketStatus): Prisma.TicketUncheckedUpdateInput {
  const now = new Date();
  return {
    status: to,
    lastActivityAt: now,
    resolvedAt: CLOSED_STATES.includes(to) ? (CLOSED_STATES.includes(from) ? undefined : now) : null,
  };
}

export async function addMessage(actor: AuthUser, ticketId: string, body: AddMessageBody, raw: Record<string, unknown>) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket || (actor.role === "AUTHOR" && ticket.authorId !== actor.authorId)) throw notFound("Ticket");

  const now = new Date();
  const data: Prisma.TicketUncheckedUpdateInput = {};
  const activities: Prisma.TicketActivityCreateManyInput[] = [];
  let visibility = body.visibility;
  let origin: ReplyOrigin = "MANUAL";
  let draftId: string | null = null;

  if (actor.role === "AUTHOR") {
    if (raw.visibility === "INTERNAL" || raw.status !== undefined || raw.draftId !== undefined) {
      throw forbidden("Authors can only post replies to their ticket");
    }
    if (ticket.status === "CLOSED") throw conflict("This ticket is closed. Please raise a new ticket if you still need help.");
    visibility = "PUBLIC";
    if (ticket.status === "RESOLVED") {
      // An author replying to a resolved ticket means it isn't resolved.
      Object.assign(data, statusChange(ticket.status, "OPEN"));
      activities.push({ ticketId, actorId: actor.id, type: "reopened_by_author", fromValue: "RESOLVED", toValue: "OPEN" });
    }
  } else {
    if (body.draftId) {
      const draft = await prisma.aiDraft.findFirst({ where: { id: body.draftId, ticketId }, select: { id: true, body: true, model: true } });
      if (!draft) throw badRequest("Draft does not belong to this ticket", [{ path: "body.draftId", message: "Unknown draft" }]);
      draftId = draft.id;
      // Offline template drafts don't count towards AI draft adoption.
      if (draft.model !== TEMPLATE_MODEL) {
        origin = normalise(draft.body) === normalise(body.body) ? "AI_DRAFT_UNEDITED" : "AI_DRAFT_EDITED";
      }
    }
    if (visibility === "PUBLIC" && !ticket.firstResponseAt) data.firstResponseAt = now;

    // A public reply on an OPEN ticket moves it to IN_PROGRESS unless the admin chose a status.
    const nextStatus = body.status ?? (visibility === "PUBLIC" && ticket.status === "OPEN" ? "IN_PROGRESS" : undefined);
    if (nextStatus && nextStatus !== ticket.status) {
      Object.assign(data, statusChange(ticket.status, nextStatus));
      activities.push({ ticketId, actorId: actor.id, type: "status_changed", fromValue: ticket.status, toValue: nextStatus });
    }
  }

  if (visibility === "PUBLIC") data.lastActivityAt = now;

  await prisma.$transaction([
    prisma.ticketMessage.create({
      data: { ticketId, senderId: actor.id, body: body.body, visibility, origin, draftId, createdAt: now },
    }),
    prisma.ticket.update({ where: { id: ticketId }, data }),
    prisma.ticketActivity.createMany({ data: activities }),
  ]);

  ticketEvents.publish({
    type: "ticket.message",
    ticketId,
    authorId: ticket.authorId,
    audience: visibility === "PUBLIC" ? "everyone" : "admins",
  });

  return getTicket(actor, ticketId);
}

const normalise = (s: string) => s.replace(/\s+/g, " ").trim();

export async function getAttachment(actor: AuthUser, ticketId: string, attachmentId: string) {
  const attachment = await prisma.attachment.findFirst({
    where: { id: attachmentId, ticketId },
    include: { ticket: { select: { authorId: true } } },
  });
  if (!attachment || (actor.role === "AUTHOR" && attachment.ticket.authorId !== actor.authorId)) throw notFound("Attachment");
  return attachment;
}
