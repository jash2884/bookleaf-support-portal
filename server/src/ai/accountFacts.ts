import type { Prisma } from "@prisma/client";
import { describeStage, remainingStages, STAGE_LABEL } from "../domain/bookStage.js";
import {
  bookPayoutStatus,
  formatDate,
  formatInr,
  nextPayout,
  PAYOUT_THRESHOLD_INR,
} from "../domain/royalty.js";

/** Everything the AI layer needs to know about a ticket's author and book. */
export const TICKET_CONTEXT_INCLUDE = {
  author: { include: { user: { select: { name: true } }, books: true } },
  book: true,
} satisfies Prisma.TicketInclude;

export type TicketWithContext = Prisma.TicketGetPayload<{ include: typeof TICKET_CONTEXT_INCLUDE }>;
type BookRow = TicketWithContext["author"]["books"][number];

const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

function bookFacts(book: BookRow, authorPending: number, now: Date, detail: "brief" | "full"): string[] {
  const facts: string[] = [`Book: "${book.title}" (ISBN ${book.isbn}, ${book.genre})`];
  facts.push(`Status: ${describeStage(book.stage)}`);

  if (book.stage !== "PUBLISHED") {
    const next = remainingStages(book.stage).map((s) => STAGE_LABEL[s]);
    facts.push(`Not yet published, so no sales or royalties yet. Remaining stages: ${next.join(" → ")}`);
    return facts;
  }

  if (book.publicationDate) facts.push(`Published: ${formatDate(book.publicationDate)}`);
  const pending = num(book.royaltyPending) ?? 0;
  facts.push(
    `Sales: ${book.totalCopiesSold} copies; MRP ${formatInr(num(book.mrp) ?? 0)}; author royalty ${formatInr(num(book.royaltyPerCopy) ?? 0)}/copy`,
    `Royalty: earned ${formatInr(num(book.totalRoyaltyEarned) ?? 0)}, paid ${formatInr(num(book.royaltyPaid) ?? 0)}, pending ${formatInr(pending)}`,
    `Last royalty payout: ${book.lastRoyaltyPayoutDate ? formatDate(book.lastRoyaltyPayoutDate) : "never paid"}`,
  );

  const status = bookPayoutStatus(
    { royaltyPending: pending, lastRoyaltyPayoutDate: book.lastRoyaltyPayoutDate, publicationDate: book.publicationDate },
    authorPending,
    now,
  );
  if (status.cyclesSinceLastPayout !== null && pending > 0) {
    facts.push(
      `Quarterly payout deadlines passed since ${book.lastRoyaltyPayoutDate ? "last payout" : "publication"}: ${status.cyclesSinceLastPayout}` +
        (status.possiblyOverdue ? " — pending balance looks OVERDUE; needs finance verification" : ""),
    );
  }

  if (detail === "full") {
    facts.push(
      `Available on: ${book.availableOn.length ? book.availableOn.join(", ") : "not listed on any platform"}`,
      `Print partner: ${book.printPartner ?? "not assigned"}`,
    );
  }
  return facts;
}

/**
 * Renders the account snapshot as a compact bullet list. `brief` is used for
 * triage (priority signals only); `full` for drafting replies.
 *
 * Only the book the ticket is about is described in detail — sending the
 * author's whole catalogue on every call would cost tokens and invite the
 * model to talk about the wrong book.
 */
export function renderAccountFacts(ticket: TicketWithContext, now: Date, detail: "brief" | "full"): string {
  const books = ticket.author.books;
  const authorPending = books.reduce((sum, b) => sum + (num(b.royaltyPending) ?? 0), 0);
  const lines: string[] = [
    `Author: ${ticket.author.user.name} (${ticket.author.city ?? "city unknown"}; BookLeaf author since ${formatDate(ticket.author.joinedDate)})`,
  ];

  if (ticket.book) {
    lines.push(...bookFacts(ticket.book, authorPending, now, detail));
  } else {
    lines.push("Ticket is about: General / account level (no specific book selected)");
    if (detail === "full" || books.length <= 3) {
      lines.push(
        `Author's books: ${books.map((b) => `"${b.title}" (${describeStage(b.stage)})`).join("; ") || "none"}`,
      );
    }
  }

  const payout = nextPayout(now);
  lines.push(
    `Author's total pending royalty (all books): ${formatInr(authorPending)} — ${
      authorPending >= PAYOUT_THRESHOLD_INR
        ? "meets the ₹1,000 payout threshold"
        : "below the ₹1,000 threshold, so it rolls over to the next quarter"
    }`,
  );
  if (detail === "full") {
    lines.push(`Next scheduled payout: by ${formatDate(payout.deadline)} (settles ${payout.quarter})`);
    lines.push(`Today's date: ${formatDate(now)}`);
  }
  return lines.map((l) => `- ${l}`).join("\n");
}
