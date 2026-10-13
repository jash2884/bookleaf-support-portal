import type { Prisma } from "@prisma/client";
import { CATEGORY_INFO, RESPONSE_TARGET_HOURS, ticketReference, UNRESOLVED_STATUSES } from "../../domain/taxonomy.js";
import { serializeBook } from "../books/book.serializer.js";

/**
 * Two views of the same ticket. Role-based access is enforced here as well as
 * in the queries: the author view is built from an allow-list of fields, so new
 * internal columns (AI metadata, notes, assignee) can't leak by accident.
 */

export const TICKET_LIST_INCLUDE = {
  book: { select: { id: true, title: true } },
  author: { select: { id: true, code: true, user: { select: { name: true } } } },
  assignee: { select: { id: true, name: true } },
  messages: {
    where: { visibility: "PUBLIC" },
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { createdAt: true, sender: { select: { role: true } } },
  },
  _count: { select: { messages: { where: { visibility: "PUBLIC" } } } },
} satisfies Prisma.TicketInclude;
type TicketListRow = Prisma.TicketGetPayload<{ include: typeof TICKET_LIST_INCLUDE }>;

export const TICKET_DETAIL_INCLUDE = {
  book: true,
  author: { include: { user: { select: { name: true, email: true } }, books: { orderBy: { publicationDate: "desc" } } } },
  assignee: { select: { id: true, name: true } },
  messages: { orderBy: { createdAt: "asc" }, include: { sender: { select: { id: true, name: true, role: true } } } },
  attachments: { orderBy: { createdAt: "asc" } },
  activities: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true } } } },
} satisfies Prisma.TicketInclude;
type TicketDetailRow = Prisma.TicketGetPayload<{ include: typeof TICKET_DETAIL_INCLUDE }>;

const hoursSince = (d: Date) => Math.floor((Date.now() - d.getTime()) / 3_600_000);

/** Who needs to act next, based on the last author-visible message. */
function waitingOn(lastPublicSenderRole: "AUTHOR" | "ADMIN" | undefined) {
  return lastPublicSenderRole === "ADMIN" ? ("author" as const) : ("bookleaf" as const);
}

function slaBreached(t: { status: TicketListRow["status"]; priority: TicketListRow["priority"]; createdAt: Date; firstResponseAt: Date | null }) {
  if (!UNRESOLVED_STATUSES.includes(t.status) || t.firstResponseAt) return false;
  const target = RESPONSE_TARGET_HOURS[t.priority ?? "MEDIUM"];
  return hoursSince(t.createdAt) >= target;
}

function attachmentDto(ticketId: string, a: TicketDetailRow["attachments"][number]) {
  return {
    id: a.id,
    fileName: a.fileName,
    mimeType: a.mimeType,
    sizeBytes: a.sizeBytes,
    url: `/api/tickets/${ticketId}/attachments/${a.id}`,
  };
}

// ---------- Author view ----------

export function toAuthorListItem(t: TicketListRow) {
  const last = t.messages[0];
  return {
    id: t.id,
    reference: ticketReference(t.number),
    subject: t.subject,
    status: t.status,
    book: t.book,
    replyCount: t._count.messages,
    lastReplyFromBookLeaf: last?.sender.role === "ADMIN",
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt,
  };
}

export function toAuthorDetail(t: TicketDetailRow) {
  return {
    id: t.id,
    reference: ticketReference(t.number),
    subject: t.subject,
    description: t.description,
    status: t.status,
    book: t.book ? { id: t.book.id, title: t.book.title } : null,
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt,
    resolvedAt: t.resolvedAt,
    attachments: t.attachments.map((a) => attachmentDto(t.id, a)),
    messages: t.messages
      .filter((m) => m.visibility === "PUBLIC")
      .map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt,
        sender: m.sender.role === "ADMIN" ? { name: `${m.sender.name.split(" ")[0]} · BookLeaf Support`, isBookLeaf: true } : { name: m.sender.name, isBookLeaf: false },
      })),
  };
}

// ---------- Admin view ----------

function triageDto(t: TicketListRow | TicketDetailRow) {
  return {
    state: t.triageState,
    category: t.aiCategory,
    priority: t.aiPriority,
    confidence: t.aiConfidence,
    summary: t.aiSummary,
    rationale: t.aiRationale,
    triagedAt: t.triagedAt,
  };
}

export function toAdminListItem(t: TicketListRow) {
  return {
    id: t.id,
    reference: ticketReference(t.number),
    subject: t.subject,
    status: t.status,
    category: t.category,
    categoryLabel: t.category ? CATEGORY_INFO[t.category].label : null,
    categorySource: t.categorySource,
    priority: t.priority,
    prioritySource: t.prioritySource,
    summary: t.aiSummary,
    triageState: t.triageState,
    author: { id: t.author.id, code: t.author.code, name: t.author.user.name },
    book: t.book,
    assignee: t.assignee,
    waitingOn: waitingOn(t.messages[0]?.sender.role),
    replyCount: t._count.messages,
    ageHours: hoursSince(t.createdAt),
    slaBreached: slaBreached(t),
    createdAt: t.createdAt,
    lastActivityAt: t.lastActivityAt,
  };
}

export function toAdminDetail(t: TicketDetailRow) {
  const publicMessages = t.messages.filter((m) => m.visibility === "PUBLIC");
  return {
    id: t.id,
    reference: ticketReference(t.number),
    subject: t.subject,
    description: t.description,
    status: t.status,
    category: t.category,
    categorySource: t.categorySource,
    priority: t.priority,
    prioritySource: t.prioritySource,
    triage: triageDto(t),
    assignee: t.assignee,
    waitingOn: waitingOn(publicMessages.at(-1)?.sender.role),
    slaBreached: slaBreached(t),
    createdAt: t.createdAt,
    firstResponseAt: t.firstResponseAt,
    resolvedAt: t.resolvedAt,
    lastActivityAt: t.lastActivityAt,
    book: t.book ? serializeBook(t.book) : null,
    author: {
      id: t.author.id,
      code: t.author.code,
      name: t.author.user.name,
      email: t.author.user.email,
      phone: t.author.phone,
      city: t.author.city,
      joinedDate: t.author.joinedDate.toISOString().slice(0, 10),
      books: t.author.books.map(serializeBook),
    },
    attachments: t.attachments.map((a) => attachmentDto(t.id, a)),
    messages: t.messages.map((m) => ({
      id: m.id,
      body: m.body,
      visibility: m.visibility,
      origin: m.origin,
      createdAt: m.createdAt,
      sender: { id: m.sender.id, name: m.sender.name, role: m.sender.role },
    })),
    activity: t.activities.map((a) => ({
      id: a.id,
      type: a.type,
      fromValue: a.fromValue,
      toValue: a.toValue,
      actor: a.actor?.name ?? "System",
      createdAt: a.createdAt,
    })),
  };
}
