import type { Book } from "@prisma/client";
import { describeStage, remainingStages, STAGE_LABEL, STAGE_ORDER } from "../../domain/bookStage.js";

const money = (d: { toNumber(): number } | null) => (d === null ? null : d.toNumber());
const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function serializeBook(book: Book) {
  return {
    id: book.id,
    code: book.code,
    title: book.title,
    isbn: book.isbn,
    genre: book.genre,
    status: describeStage(book.stage),
    stage: book.stage,
    isPublished: book.stage === "PUBLISHED",
    production: {
      step: STAGE_ORDER.indexOf(book.stage) + 1,
      totalSteps: STAGE_ORDER.length,
      currentLabel: STAGE_LABEL[book.stage],
      remaining: remainingStages(book.stage).map((s) => STAGE_LABEL[s]),
    },
    publicationDate: isoDate(book.publicationDate),
    mrp: money(book.mrp),
    royaltyPerCopy: money(book.royaltyPerCopy),
    totalCopiesSold: book.totalCopiesSold,
    totalRoyaltyEarned: money(book.totalRoyaltyEarned),
    royaltyPaid: money(book.royaltyPaid),
    royaltyPending: money(book.royaltyPending),
    lastRoyaltyPayoutDate: isoDate(book.lastRoyaltyPayoutDate),
    printPartner: book.printPartner,
    availableOn: book.availableOn,
  };
}

export type BookDto = ReturnType<typeof serializeBook>;
