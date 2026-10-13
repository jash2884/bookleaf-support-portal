import type { BookStage, TicketCategory, TicketPriority } from "@prisma/client";
import { PRIORITIES } from "../../domain/taxonomy.js";
import type { TriageOutput } from "../prompts/triagePrompt.js";

/**
 * Deterministic keyword classifier used when the LLM is unavailable (no key,
 * outage, rate limit, circuit open). It is deliberately conservative: it would
 * rather over-prioritise than bury an urgent ticket, and it marks its output
 * with low confidence so admins know to double-check.
 */

const CATEGORY_SIGNALS: Record<Exclude<TicketCategory, "GENERAL_INQUIRY">, Array<[RegExp, number]>> = {
  ISBN_METADATA: [
    [/\bisbn\b/i, 5],
    [/\bmetadata\b/i, 3],
    [/wrong (title|author|book|name)/i, 2],
  ],
  ROYALTY_PAYMENTS: [
    [/royalt/i, 4],
    [/payout|payment|paid|unpaid/i, 2],
    [/bank|account details|transfer/i, 1],
    [/₹|\brs\.?\s?\d|\binr\b|earnings?/i, 1],
  ],
  PRINTING_QUALITY: [
    [/print(ing)? quality|misprint|blurr?y|misalign|binding|smudge/i, 4],
    [/defect|damaged|torn|faded|colou?r (issue|problem|inconsisten)/i, 3],
    [/author copies|reprint/i, 2],
  ],
  DISTRIBUTION_AVAILABILITY: [
    [/unavailable|not available|out of stock|can(no|')?t (buy|order|find|be found)|missing (on|from)/i, 4],
    [/not (showing|listed|live|found)|listing|stock sync/i, 2],
    [/amazon|flipkart|bookleaf store/i, 1],
  ],
  BOOK_STATUS_PRODUCTION: [
    [/typesetting|cover design|proofread|editing stage|in production/i, 4],
    [/when will .*(done|ready|published|live)|stuck|status of my book|delay/i, 2],
  ],
};

const CRITICAL_SIGNALS = /lawyer|legal action|\bsue\b|consumer court|fraud|scam|hacked|data breach/i;
const LONG_WAIT_SIGNALS = /(\d+|six|several|many) months|over a year|more than a year|never (been )?paid|not (received|got) (a single|any)/i;
const URGENCY_SIGNALS = /urgent|asap|immediately|deadline|launch|event|signing|this week/i;

export interface RuleTriageInput {
  subject: string;
  description: string;
  bookStage: BookStage | null;
  /** From the royalty domain: pending ≥ threshold with ≥1 missed payout cycle. */
  royaltyPossiblyOverdue: boolean;
}

export function ruleBasedTriage(input: RuleTriageInput): TriageOutput {
  const text = `${input.subject}\n${input.description}`;

  // A lone weak signal (e.g. "Amazon" in a bio question) is not enough to leave GENERAL_INQUIRY.
  let category: TicketCategory = "GENERAL_INQUIRY";
  let best = 1;
  const matched: string[] = [];
  for (const [cat, signals] of Object.entries(CATEGORY_SIGNALS) as Array<[TicketCategory, Array<[RegExp, number]>]>) {
    const score = signals.reduce((sum, [re, weight]) => (re.test(text) ? sum + weight : sum), 0);
    if (score > best) {
      best = score;
      category = cat;
    }
  }
  if (category !== "GENERAL_INQUIRY") matched.push(`keywords → ${category}`);

  // A status question about a book that is still in production is a production query.
  if (input.bookStage && input.bookStage !== "PUBLISHED" && category === "GENERAL_INQUIRY") {
    category = "BOOK_STATUS_PRODUCTION";
    matched.push("book is in production");
  }

  let priority: TicketPriority = baselinePriority(category);
  if (category === "ROYALTY_PAYMENTS" && input.royaltyPossiblyOverdue) {
    priority = LONG_WAIT_SIGNALS.test(text) ? "CRITICAL" : "HIGH";
    matched.push("account shows overdue pending royalty");
  }
  // A deadline raises urgency, but CRITICAL stays reserved for money/legal/security.
  if (URGENCY_SIGNALS.test(text) && (priority === "MEDIUM" || priority === "LOW")) {
    priority = bump(priority);
    matched.push("urgency/deadline language");
  }
  if (CRITICAL_SIGNALS.test(text)) {
    priority = "CRITICAL";
    matched.push("legal/security language");
  }

  return {
    category,
    priority,
    confidence: best >= 4 ? 0.6 : 0.35,
    summary: input.subject.length > 90 ? `${input.subject.slice(0, 87)}…` : input.subject,
    rationale: `Rule-based triage (AI unavailable): ${matched.length ? matched.join("; ") : "no strong signals, defaulted"}.`,
  };
}

function baselinePriority(category: TicketCategory): TicketPriority {
  switch (category) {
    case "ISBN_METADATA": // KB: ISBN errors are high priority
    case "PRINTING_QUALITY":
    case "DISTRIBUTION_AVAILABILITY":
      return "HIGH";
    case "ROYALTY_PAYMENTS":
    case "BOOK_STATUS_PRODUCTION":
      return "MEDIUM";
    default:
      return "LOW";
  }
}

function bump(priority: TicketPriority): TicketPriority {
  const i = PRIORITIES.indexOf(priority);
  return PRIORITIES[Math.max(0, i - 1)]!;
}
