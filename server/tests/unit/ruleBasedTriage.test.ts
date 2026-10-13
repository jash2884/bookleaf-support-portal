import { describe, expect, it } from "vitest";
import { ruleBasedTriage, type RuleTriageInput } from "../../src/ai/fallback/ruleBasedTriage.js";

const triage = (subject: string, description: string, extra: Partial<RuleTriageInput> = {}) =>
  ruleBasedTriage({ subject, description, bookStage: "PUBLISHED", royaltyPossiblyOverdue: false, ...extra });

// The brief's own sample queries: the offline classifier should land them where a human would.
describe("rule-based triage (AI fallback)", () => {
  it.each([
    ["Royalty", "I published my book 4 months ago and still haven't received any royalty. What's going on?", "ROYALTY_PAYMENTS"],
    ["Royalty too low", "My royalty amount seems too low. I sold 200 copies but only received ₹3,000.", "ROYALTY_PAYMENTS"],
    ["ISBN", "My book is showing a different ISBN on Amazon than what's on the physical copy.", "ISBN_METADATA"],
    ["Print quality", "I received my author copies and the print quality is terrible. The images are blurry and pages are misaligned.", "PRINTING_QUALITY"],
    ["Unavailable", "My book is published but it's showing as 'Currently Unavailable' on Amazon.", "DISTRIBUTION_AVAILABILITY"],
    ["Typesetting", "It's been 3 weeks and my book is still in typesetting. When will it be done?", "BOOK_STATUS_PRODUCTION"],
    ["Description", "Can I update the description of my book on Amazon after it's already live?", "GENERAL_INQUIRY"],
  ])("%s → %s", (subject, description, expected) => {
    expect(triage(subject, description).category).toBe(expected);
  });

  it("follows the KB: ISBN errors are high priority", () => {
    expect(triage("ISBN problem", "Wrong ISBN on my listing").priority).toBe("HIGH");
  });

  it("escalates royalties that the account data shows as overdue", () => {
    const longWait = triage("No royalty", "I haven't received any royalty for 6 months", { royaltyPossiblyOverdue: true });
    expect(longWait.priority).toBe("CRITICAL");
    const notOverdue = triage("Royalty question", "How is my royalty calculated?", { royaltyPossiblyOverdue: false });
    expect(notOverdue.priority).toBe("MEDIUM");
  });

  it("keeps a bio update low priority even when a platform is named", () => {
    const r = triage("Author bio", "Can I update my author bio on Amazon and Flipkart?");
    expect(r).toMatchObject({ category: "GENERAL_INQUIRY", priority: "LOW" });
  });

  it("treats a general question about an unpublished book as a production query", () => {
    expect(triage("Question", "Any news?", { bookStage: "COVER_DESIGN" }).category).toBe("BOOK_STATUS_PRODUCTION");
  });

  it("marks legal threats critical and admits low confidence", () => {
    const r = triage("Payment", "If this is not fixed I will take legal action");
    expect(r.priority).toBe("CRITICAL");
    expect(r.confidence).toBeLessThan(0.7);
    expect(r.rationale).toMatch(/Rule-based/);
  });
});
