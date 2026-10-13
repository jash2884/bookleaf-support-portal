import type { TicketCategory } from "@prisma/client";

/**
 * The BookLeaf knowledge base, split into sections so each prompt carries only
 * what the ticket's category needs (cost awareness) and every reply cites the
 * same source of truth.
 *
 * Retrieval is a deterministic category → sections map rather than embeddings:
 * the KB is ~1.5k tokens and the categories line up 1:1 with KB sections, so
 * vector search would add infrastructure and failure modes without improving
 * recall. When the KB grows to hundreds of articles, swap `sectionsFor` for a
 * vector/BM25 retriever — the prompt builders don't need to change.
 */

export type KbSectionId =
  | "royalty"
  | "isbn"
  | "printing"
  | "distribution"
  | "production"
  | "metadata";

/** Always included, part of the cached system prefix. */
export const COMPANY_OVERVIEW = `
- BookLeaf Publishing is a self-publishing company operating in India and the US.
- Packages: Standard Free (no upfront cost) and Bestseller Breakthrough (premium, paid; marketing and distribution add-ons).
- BookLeaf handles cover design, typesetting, ISBN assignment, printing, distribution and royalty management.
- In-house printing facility and warehouse in Delhi. Print partners: Repro India and Epitome Books.`.trim();

export const TONE_GUIDELINES = `
- Always empathetic and professional. Authors are our partners, not customers to be managed.
- Acknowledge the author's concern before jumping to solutions.
- Be specific: use actual numbers, dates and statuses from the account facts rather than vague reassurances.
- If something is BookLeaf's fault (delayed royalties, ISBN error), own it directly. No corporate deflection.
- If the issue needs escalation or investigation, give a clear timeline ("Our team will look into this and get back to you within 48 hours"), never an open-ended promise.
- Always end with a clear next step for the author and/or the BookLeaf team.`.trim();

export const KB_SECTIONS: Record<KbSectionId, { title: string; body: string }> = {
  royalty: {
    title: "Royalty Policy",
    body: `
- 80/20 split: 80% of the net profit per book goes to the author, 20% to BookLeaf.
- Net profit = MRP minus printing cost, platform commission (Amazon/Flipkart) and shipping charges.
- Royalties are calculated quarterly and paid within 45 days of the quarter ending.
- Minimum payout threshold: ₹1,000. Accumulated royalties below this roll over to the next quarter.
- Payouts are made by bank transfer to the account linked in the author's dashboard.
- Authors can view a detailed royalty breakdown in their dashboard, with sales figures per platform.`.trim(),
  },
  isbn: {
    title: "ISBN Policy",
    body: `
- Every book published through BookLeaf receives a unique ISBN assigned by BookLeaf, registered under BookLeaf's publisher imprint.
- An author who wants an ISBN under their own imprint must obtain it independently.
- An ISBN error (duplicate, wrong book linked, mismatch between listing and print) is a high-priority issue and is escalated to the production team.`.trim(),
  },
  printing: {
    title: "Printing & Quality",
    body: `
- In-house printing handles most orders; overflow or specific formats go to Repro India or Epitome Books.
- Standard print turnaround: 5–7 business days from order confirmation.
- Quality issues (misprints, binding defects, colour inconsistency): BookLeaf arranges a free reprint after verification. The author may need to share photos of the defective copy.`.trim(),
  },
  distribution: {
    title: "Distribution & Availability",
    body: `
- Books are listed on Amazon India, Flipkart, Amazon US, Amazon UK and the BookLeaf Store.
- New listings typically go live within 7–10 business days after publication is complete.
- A book showing as unavailable on a platform usually indicates a stock sync issue; BookLeaf can trigger a re-sync, live again within 24–48 hours.`.trim(),
  },
  production: {
    title: "Production Stages",
    body: `
- Stages: Manuscript Received → Editing (if opted) → Cover Design → Typesetting → Proofreading → ISBN Assignment → Printing → Distribution Setup → Published & Live.
- Authors are updated by email at each stage.
- Delays typically happen at Cover Design (waiting for author approval) and Proofreading (revision rounds).
- Never blame the author for a delay, even when it is on their side; frame next steps collaboratively.`.trim(),
  },
  metadata: {
    title: "Metadata Updates",
    body: `
- Book metadata (description, author bio, keywords) can be updated after a book is live, via the dashboard or by emailing the BookLeaf team.
- Changes typically reflect on platforms within 3–5 business days.`.trim(),
  },
};

const CATEGORY_SECTIONS: Record<TicketCategory, KbSectionId[]> = {
  ROYALTY_PAYMENTS: ["royalty"],
  ISBN_METADATA: ["isbn", "metadata"],
  PRINTING_QUALITY: ["printing"],
  DISTRIBUTION_AVAILABILITY: ["distribution"],
  BOOK_STATUS_PRODUCTION: ["production", "distribution"],
  // The catch-all category can be about anything, so it gets the whole KB.
  GENERAL_INQUIRY: ["metadata", "royalty", "isbn", "printing", "distribution", "production"],
};

/** Calibration examples from BookLeaf's own playbook ("Sample Query → Response"). */
const EXAMPLES: Record<TicketCategory, Array<{ query: string; approach: string }>> = {
  ROYALTY_PAYMENTS: [
    {
      query: "I published my book 4 months ago and still haven't received any royalty. What's going on?",
      approach:
        "Acknowledge the frustration. Explain the quarterly cycle and 45-day payout window. Check whether bank details are linked. Give the specific next payout date. If the payment is genuinely overdue, escalate with a 48-hour resolution timeline.",
    },
    {
      query: "My royalty amount seems too low. I sold 200 copies but only received ₹3,000.",
      approach:
        "Explain the net profit calculation (MRP minus printing, platform commission, shipping). Offer a detailed line-by-line royalty breakdown. Don't be defensive — offer transparency.",
    },
  ],
  ISBN_METADATA: [
    {
      query: "My book is showing a different ISBN on Amazon than what's on the physical copy.",
      approach:
        "Treat as high priority. Acknowledge it is a serious data issue. Confirm escalation to the production team immediately. Give a 48-hour resolution timeline.",
    },
  ],
  PRINTING_QUALITY: [
    {
      query: "I received my author copies and the print quality is terrible. The images are blurry and pages are misaligned.",
      approach:
        "Apologise sincerely. Ask for photos of the defective copies. Confirm BookLeaf will arrange a free reprint once verified, with a 5–7 business day reprint timeline.",
    },
  ],
  DISTRIBUTION_AVAILABILITY: [
    {
      query: "My book is published but it's showing as 'Currently Unavailable' on Amazon.",
      approach:
        "Explain this is typically a stock sync issue. Confirm we're triggering a re-sync with the distribution team. Set the expectation: 24–48 hours to go live again.",
    },
  ],
  BOOK_STATUS_PRODUCTION: [
    {
      query: "It's been 3 weeks and my book is still in typesetting. When will it be done?",
      approach:
        "Use the actual production status. If delayed, be honest about why (e.g. waiting on proof approval). Give a specific updated timeline. Don't blame the author even if the delay is on their side — frame it collaboratively.",
    },
  ],
  GENERAL_INQUIRY: [
    {
      query: "Can I update the description of my book on Amazon after it's already live?",
      approach:
        "Yes — metadata updates can be submitted through the dashboard or by emailing the BookLeaf team; changes typically reflect within 3–5 business days.",
    },
  ],
};

export function sectionsFor(category: TicketCategory): KbSectionId[] {
  return CATEGORY_SECTIONS[category];
}

/** Renders the category-specific KB block (policies + calibration examples) for the draft prompt. */
export function renderCategoryKnowledge(category: TicketCategory): string {
  const sections = sectionsFor(category)
    .map((id) => `### ${KB_SECTIONS[id].title}\n${KB_SECTIONS[id].body}`)
    .join("\n\n");
  const examples = EXAMPLES[category]
    .map((e) => `- Author asks: "${e.query}"\n  How BookLeaf handles it: ${e.approach}`)
    .join("\n");
  return `<knowledge_base>\n${sections}\n</knowledge_base>\n\n<calibration_examples>\n${examples}\n</calibration_examples>`;
}
