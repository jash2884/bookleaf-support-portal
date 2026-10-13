// DTOs returned by the API (see server/openapi.yaml).

export type Role = "AUTHOR" | "ADMIN";
export type TicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
export type TicketPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
export type TicketCategory =
  | "ROYALTY_PAYMENTS"
  | "ISBN_METADATA"
  | "PRINTING_QUALITY"
  | "DISTRIBUTION_AVAILABILITY"
  | "BOOK_STATUS_PRODUCTION"
  | "GENERAL_INQUIRY";
export type DecisionSource = "AI" | "RULES" | "ADMIN";
export type TriageState = "PENDING" | "AI" | "FALLBACK";

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
}

export interface Book {
  id: string;
  code: string;
  title: string;
  isbn: string;
  genre: string;
  status: string;
  stage: string;
  isPublished: boolean;
  production: { step: number; totalSteps: number; currentLabel: string; remaining: string[] };
  publicationDate: string | null;
  mrp: number | null;
  royaltyPerCopy: number | null;
  totalCopiesSold: number;
  totalRoyaltyEarned: number;
  royaltyPaid: number;
  royaltyPending: number;
  lastRoyaltyPayoutDate: string | null;
  printPartner: string | null;
  availableOn: string[];
}

export interface BooksResponse {
  data: Book[];
  summary: {
    totalBooks: number;
    publishedBooks: number;
    totalCopiesSold: number;
    totalRoyaltyEarned: number;
    royaltyPaid: number;
    royaltyPending: number;
    payout: { threshold: number; meetsThreshold: boolean; nextPayoutBy: string; nextPayoutQuarter: string };
  };
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Attachment {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface AuthorTicketListItem {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  book: { id: string; title: string } | null;
  replyCount: number;
  lastReplyFromBookLeaf: boolean;
  createdAt: string;
  lastActivityAt: string;
}

export interface AuthorTicket {
  id: string;
  reference: string;
  subject: string;
  description: string;
  status: TicketStatus;
  book: { id: string; title: string } | null;
  createdAt: string;
  lastActivityAt: string;
  resolvedAt: string | null;
  attachments: Attachment[];
  messages: Array<{ id: string; body: string; createdAt: string; sender: { name: string; isBookLeaf: boolean } }>;
}

export interface AdminTicketListItem {
  id: string;
  reference: string;
  subject: string;
  status: TicketStatus;
  category: TicketCategory | null;
  categoryLabel: string | null;
  categorySource: DecisionSource | null;
  priority: TicketPriority | null;
  prioritySource: DecisionSource | null;
  summary: string | null;
  triageState: TriageState;
  author: { id: string; code: string; name: string };
  book: { id: string; title: string } | null;
  assignee: { id: string; name: string } | null;
  waitingOn: "bookleaf" | "author";
  replyCount: number;
  ageHours: number;
  slaBreached: boolean;
  createdAt: string;
  lastActivityAt: string;
}

export interface AdminMessage {
  id: string;
  body: string;
  visibility: "PUBLIC" | "INTERNAL";
  origin: "MANUAL" | "AI_DRAFT_UNEDITED" | "AI_DRAFT_EDITED";
  createdAt: string;
  sender: { id: string; name: string; role: Role };
}

export interface AdminTicket {
  id: string;
  reference: string;
  subject: string;
  description: string;
  status: TicketStatus;
  category: TicketCategory | null;
  categorySource: DecisionSource | null;
  priority: TicketPriority | null;
  prioritySource: DecisionSource | null;
  triage: {
    state: TriageState;
    category: TicketCategory | null;
    priority: TicketPriority | null;
    confidence: number | null;
    summary: string | null;
    rationale: string | null;
    triagedAt: string | null;
  };
  assignee: { id: string; name: string } | null;
  waitingOn: "bookleaf" | "author";
  slaBreached: boolean;
  createdAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  lastActivityAt: string;
  book: Book | null;
  author: {
    id: string;
    code: string;
    name: string;
    email: string;
    phone: string | null;
    city: string | null;
    joinedDate: string;
    books: Book[];
  };
  attachments: Attachment[];
  messages: AdminMessage[];
  activity: Array<{ id: string; type: string; fromValue: string | null; toValue: string | null; actor: string; createdAt: string }>;
}

export interface Draft {
  id: string;
  body: string;
  internalActions: string[];
  model: string;
  isFallback: boolean;
  fallbackReason: string | null;
  createdAt: string;
}

export interface DraftResponse {
  status: "cached" | "generated" | "not_needed";
  data: Draft | null;
}

export interface AiStatus {
  mode: "online" | "degraded" | "offline";
  triageModel: string;
  draftModel: string;
  circuit: string;
}

interface AiTaskMetrics {
  calls: number;
  errors: number;
  skipped: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  avgLatencyMs: number;
}

export interface Metrics {
  queue: {
    byStatus: Partial<Record<TicketStatus, number>>;
    unresolvedByPriority: Record<TicketPriority | "UNTRIAGED", number>;
    unassigned: number;
    slaBreached: number;
  };
  ai: {
    status: AiStatus;
    windowDays: number;
    triage: AiTaskMetrics;
    draft: AiTaskMetrics;
    triageQuality: { aiTriagedTickets: number; categoryOverrides: number; priorityOverrides: number };
    draftAdoption: { sentUnedited: number; sentEdited: number; manual: number };
  };
}

export interface Agent {
  id: string;
  name: string;
  email: string;
}
