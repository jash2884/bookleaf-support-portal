/**
 * Royalty payout schedule (BookLeaf knowledge base → "Royalty Policy"):
 * - royalties are calculated quarterly and paid within 45 days of quarter end;
 * - accumulated royalties below ₹1,000 roll over to the next quarter.
 *
 * Dates are computed here, in code, and handed to the LLM as facts. Asking a
 * model to do calendar arithmetic is a reliable way to get confidently wrong
 * payout dates in an author-facing email.
 */
export const PAYOUT_THRESHOLD_INR = 1000;
export const PAYOUT_WINDOW_DAYS = 45;

const DAY_MS = 86_400_000;

function utcDate(y: number, m: number, d: number) {
  return new Date(Date.UTC(y, m, d));
}

function startOfUtcDay(date: Date) {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Last calendar day of the quarter containing `date`. */
export function quarterEnd(date: Date): Date {
  const q = Math.floor(date.getUTCMonth() / 3);
  return utcDate(date.getUTCFullYear(), q * 3 + 3, 0);
}

export function quarterLabel(qEnd: Date): string {
  const q = Math.floor(qEnd.getUTCMonth() / 3) + 1;
  const months = ["Jan–Mar", "Apr–Jun", "Jul–Sep", "Oct–Dec"][q - 1];
  return `Q${q} ${qEnd.getUTCFullYear()} (${months})`;
}

export function payoutDeadline(qEnd: Date): Date {
  return new Date(qEnd.getTime() + PAYOUT_WINDOW_DAYS * DAY_MS);
}

/** The next payout deadline on or after `now`, with the quarter it settles. */
export function nextPayout(now: Date): { quarter: string; deadline: Date } {
  const today = startOfUtcDay(now);
  const currentQEnd = quarterEnd(today);
  const previousQEnd = utcDate(currentQEnd.getUTCFullYear(), currentQEnd.getUTCMonth() - 2, 0);
  const previousDeadline = payoutDeadline(previousQEnd);
  if (today.getTime() <= previousDeadline.getTime()) {
    return { quarter: quarterLabel(previousQEnd), deadline: previousDeadline };
  }
  return { quarter: quarterLabel(currentQEnd), deadline: payoutDeadline(currentQEnd) };
}

/** Number of payout deadlines that fell strictly after `from` and on/before `now`. */
export function payoutDeadlinesBetween(from: Date, now: Date): number {
  let count = 0;
  let qEnd = quarterEnd(from);
  // Walk quarter by quarter; bounded by the date range so this is cheap.
  for (;;) {
    const deadline = payoutDeadline(qEnd);
    if (deadline.getTime() > now.getTime()) break;
    if (deadline.getTime() > from.getTime()) count++;
    qEnd = utcDate(qEnd.getUTCFullYear(), qEnd.getUTCMonth() + 4, 0);
  }
  return count;
}

export interface RoyaltyBookInput {
  royaltyPending: number;
  lastRoyaltyPayoutDate: Date | null;
  publicationDate: Date | null;
}

export interface BookPayoutStatus {
  /** Payout cycles that closed since the last payout (or since publication if never paid). */
  cyclesSinceLastPayout: number | null;
  /** Pending ≥ threshold and at least one payout cycle passed without a payout. */
  possiblyOverdue: boolean;
}

export function bookPayoutStatus(
  book: RoyaltyBookInput,
  authorPendingTotal: number,
  now: Date,
): BookPayoutStatus {
  const since = book.lastRoyaltyPayoutDate ?? book.publicationDate;
  if (!since) return { cyclesSinceLastPayout: null, possiblyOverdue: false };
  const cycles = payoutDeadlinesBetween(since, now);
  return {
    cyclesSinceLastPayout: cycles,
    possiblyOverdue: book.royaltyPending > 0 && authorPendingTotal >= PAYOUT_THRESHOLD_INR && cycles >= 1,
  };
}

export const formatInr = (amount: number) =>
  `₹${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const formatDate = (date: Date) =>
  date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
