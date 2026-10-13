import type { TicketCategory, TicketPriority, TicketStatus } from "@prisma/client";

/** Category definitions are shared by the LLM prompt, the rule-based fallback and the UI. */
export const CATEGORY_INFO: Record<TicketCategory, { label: string; description: string }> = {
  ROYALTY_PAYMENTS: {
    label: "Royalty & Payments",
    description: "Royalty amounts, missing/late payouts, payout schedule, bank details, royalty calculations.",
  },
  ISBN_METADATA: {
    label: "ISBN & Metadata Issues",
    description: "Wrong/duplicate ISBN, ISBN mismatch between platforms and print, title/author/description metadata errors.",
  },
  PRINTING_QUALITY: {
    label: "Printing & Quality",
    description: "Misprints, binding defects, blurry images, colour problems, damaged author copies, print turnaround.",
  },
  DISTRIBUTION_AVAILABILITY: {
    label: "Distribution & Availability",
    description: "Book unavailable/not listed on Amazon, Flipkart or BookLeaf Store, stock sync, adding new platforms.",
  },
  BOOK_STATUS_PRODUCTION: {
    label: "Book Status & Production Updates",
    description: "Where a book is in production (cover design, typesetting, proofreading...), delays, go-live timing.",
  },
  GENERAL_INQUIRY: {
    label: "General Inquiry",
    description: "Account questions, author bio/profile updates, packages, how-to questions, anything else.",
  },
};

export const CATEGORIES = Object.keys(CATEGORY_INFO) as TicketCategory[];

export const PRIORITIES: TicketPriority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

/** Lower rank = more urgent. Used for queue ordering. */
export const PRIORITY_RANK: Record<TicketPriority, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export const STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"];

/** Statuses that still need work from the BookLeaf team. */
export const UNRESOLVED_STATUSES: TicketStatus[] = ["OPEN", "IN_PROGRESS"];

/**
 * Target first-response times per priority (hours). Drives the "overdue" flag in
 * the admin queue so the oldest urgent tickets stand out.
 */
export const RESPONSE_TARGET_HOURS: Record<TicketPriority, number> = {
  CRITICAL: 4,
  HIGH: 24,
  MEDIUM: 48,
  LOW: 72,
};

export const ticketReference = (n: number) => `BL-${n}`;
