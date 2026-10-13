import { describe, expect, it } from "vitest";
import { bookPayoutStatus, nextPayout, payoutDeadlinesBetween, quarterEnd } from "../../src/domain/royalty.js";
import { parseBookStatus, remainingStages } from "../../src/domain/bookStage.js";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe("royalty payout schedule", () => {
  it("finds the end of the quarter", () => {
    expect(iso(quarterEnd(d("2026-02-10")))).toBe("2026-03-31");
    expect(iso(quarterEnd(d("2026-10-13")))).toBe("2026-12-31");
  });

  it("next payout is the previous quarter's deadline until it passes (quarter end + 45 days)", () => {
    // Q3 ended 30 Sep → paid by 14 Nov.
    expect(iso(nextPayout(d("2026-10-13")).deadline)).toBe("2026-11-14");
    expect(nextPayout(d("2026-10-13")).quarter).toBe("Q3 2026 (Jul–Sep)");
    // After 14 Nov the next one is Q4's: 31 Dec + 45 days.
    expect(iso(nextPayout(d("2026-11-20")).deadline)).toBe("2027-02-14");
  });

  it("counts payout deadlines that passed since a date", () => {
    // Deadlines after 15 Oct 2025: 14 Feb, 15 May, 14 Aug 2026 (14 Nov not yet reached).
    expect(payoutDeadlinesBetween(d("2025-10-15"), d("2026-10-13"))).toBe(3);
    expect(payoutDeadlinesBetween(d("2026-10-01"), d("2026-10-13"))).toBe(0);
  });

  it("flags a pending balance as possibly overdue only above the ₹1,000 threshold", () => {
    const book = { royaltyPending: 850, lastRoyaltyPayoutDate: null, publicationDate: d("2024-11-05") };
    expect(bookPayoutStatus(book, 850, d("2026-10-13")).possiblyOverdue).toBe(false); // rolls over
    expect(bookPayoutStatus({ ...book, royaltyPending: 2546 }, 2546, d("2026-10-13")).possiblyOverdue).toBe(true);
  });

  it("is never overdue when nothing is pending", () => {
    const book = { royaltyPending: 0, lastRoyaltyPayoutDate: d("2025-12-01"), publicationDate: d("2024-01-10") };
    expect(bookPayoutStatus(book, 5000, d("2026-10-13")).possiblyOverdue).toBe(false);
  });
});

describe("book status parsing", () => {
  it("maps dataset status strings onto the production pipeline", () => {
    expect(parseBookStatus("Published & Live")).toBe("PUBLISHED");
    expect(parseBookStatus("In Production - Cover Design")).toBe("COVER_DESIGN");
    expect(parseBookStatus("In Production - Typesetting")).toBe("TYPESETTING");
    expect(() => parseBookStatus("Lost in space")).toThrow();
  });

  it("lists the remaining stages", () => {
    expect(remainingStages("PRINTING")).toEqual(["DISTRIBUTION_SETUP", "PUBLISHED"]);
  });
});
