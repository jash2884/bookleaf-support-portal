import type { TicketCategory } from "@prisma/client";
import { describeStage, remainingStages, STAGE_LABEL } from "../../domain/bookStage.js";
import { bookPayoutStatus, formatDate, formatInr, nextPayout, PAYOUT_THRESHOLD_INR } from "../../domain/royalty.js";
import type { TicketWithContext } from "../accountFacts.js";
import type { DraftOutput } from "../prompts/draftPrompt.js";
import { firstName } from "../promptUtils.js";

/**
 * Policy-correct template replies used when the LLM is unavailable. They are
 * filled with the same computed account facts the AI sees, so even the offline
 * draft is specific (amounts, dates, stages) rather than a generic holding reply.
 * The admin always reviews and edits before sending.
 */
export function templateDraft(ticket: TicketWithContext, category: TicketCategory, agentName: string, now: Date): DraftOutput {
  const author = firstName(ticket.author.user.name);
  const book = ticket.book;
  const title = book ? `"${book.title}"` : "your account";
  const body = BODIES[category]({ ticket, title, now });
  const reply = `Hi ${author},\n\n${body.paragraphs.join("\n\n")}\n\nWarm regards,\n${firstName(agentName)}\nBookLeaf Author Support`;
  return { reply, internal_actions: body.actions };
}

interface Ctx {
  ticket: TicketWithContext;
  title: string;
  now: Date;
}
type Body = { paragraphs: string[]; actions: string[] };

const n = (d: { toNumber(): number } | null) => d?.toNumber() ?? 0;

const BODIES: Record<TicketCategory, (ctx: Ctx) => Body> = {
  ROYALTY_PAYMENTS: ({ ticket, title, now }) => {
    const book = ticket.book;
    const authorPending = ticket.author.books.reduce((s, b) => s + n(b.royaltyPending), 0);
    const payout = nextPayout(now);
    if (book && book.stage !== "PUBLISHED") {
      return {
        paragraphs: [
          `Thank you for checking in about royalties for ${title}. The book is currently ${describeStage(book.stage)}, so it isn't on sale yet and no royalties have accrued so far.`,
          `Once it is published and live, royalties are calculated quarterly and paid within 45 days of each quarter ending, directly to the bank account linked in your dashboard. We'll keep you updated at each production stage.`,
        ],
        actions: [],
      };
    }
    const paragraphs = [
      `Thank you for reaching out about your royalties${book ? ` for ${title}` : ""} — I completely understand how important it is to have clarity here.`,
    ];
    if (book) {
      paragraphs.push(
        `Here is where things stand: ${book.totalCopiesSold} copies sold, ${formatInr(n(book.totalRoyaltyEarned))} earned in total, ${formatInr(n(book.royaltyPaid))} paid so far and ${formatInr(n(book.royaltyPending))} pending. ${
          book.lastRoyaltyPayoutDate ? `Your last payout was on ${formatDate(book.lastRoyaltyPayoutDate)}.` : "We have not made a payout for this book yet."
        }`,
      );
    }
    const actions: string[] = [];
    if (authorPending < PAYOUT_THRESHOLD_INR) {
      paragraphs.push(
        `Your total pending royalty across your books is ${formatInr(authorPending)}, which is below our ₹1,000 minimum payout threshold, so it rolls over to the next quarter rather than being lost. It will be paid out in the first payout cycle after your balance reaches ₹1,000.`,
      );
    } else if (book && bookPayoutStatus({ royaltyPending: n(book.royaltyPending), lastRoyaltyPayoutDate: book.lastRoyaltyPayoutDate, publicationDate: book.publicationDate }, authorPending, now).possiblyOverdue) {
      paragraphs.push(
        `Royalties are paid within 45 days of each quarter ending, and looking at your account, this pending amount should already have reached you. I'm sorry — that's on us. I've escalated this to our finance team and we will confirm the payout status and date within 48 hours.`,
      );
      actions.push(`Escalate overdue royalty (${formatInr(n(book.royaltyPending))}) for ${title} to finance; confirm bank details and payout date`);
    } else {
      paragraphs.push(
        `Royalties are calculated quarterly and paid within 45 days of the quarter ending. Your next payout is due by ${formatDate(payout.deadline)} (for ${payout.quarter}), by bank transfer to the account linked in your dashboard.`,
      );
    }
    paragraphs.push(
      `For transparency, royalties are 80% of the net profit per copy (MRP minus printing, platform commission and shipping). I'm happy to send you a detailed line-by-line breakdown — just reply here and I'll share it.`,
    );
    return { paragraphs, actions };
  },

  ISBN_METADATA: ({ title }) => ({
    paragraphs: [
      `Thank you for flagging this about ${title}. An ISBN or metadata mismatch is a serious data issue, and I'm sorry you've had to deal with it.`,
      `I've escalated this to our production team as a high-priority issue. We will verify the ISBN records across every platform and come back to you with a resolution within 48 hours.`,
      `If you have a screenshot of the listing or a photo of the printed ISBN, please attach it here — it will help the team move faster.`,
    ],
    actions: [`Escalate ISBN/metadata issue for ${title} to production (48-hour SLA)`],
  }),

  PRINTING_QUALITY: ({ title }) => ({
    paragraphs: [
      `I'm really sorry to hear about the print quality issues with ${title} — that is not the standard we hold ourselves to, and I understand how disappointing it is.`,
      `Could you please reply with a few photos of the affected pages or copies? Once our team has verified the defect, we'll arrange a free reprint, which takes 5–7 business days.`,
    ],
    actions: [`Review defect photos for ${title} and approve free reprint`],
  }),

  DISTRIBUTION_AVAILABILITY: ({ ticket, title }) => {
    const platforms = ticket.book?.availableOn.length ? ` It is set up for distribution on ${ticket.book.availableOn.join(", ")}.` : "";
    return {
      paragraphs: [
        `Thank you for letting us know that ${title} is showing as unavailable — I understand how frustrating that is when readers are trying to buy it.${platforms}`,
        `This is usually a stock sync issue between our warehouse and the platform. I'm triggering a re-sync with our distribution team now, and the listing should be live again within 24–48 hours. I'll follow up to confirm once it's back.`,
      ],
      actions: [`Trigger stock re-sync for ${title}; confirm listing is live in 48 hours`],
    };
  },

  BOOK_STATUS_PRODUCTION: ({ ticket, title }) => {
    const book = ticket.book;
    if (!book || book.stage === "PUBLISHED") {
      return {
        paragraphs: [
          `Thank you for checking in about ${title}.${book ? ` It is ${describeStage(book.stage)}.` : ""}`,
          `I'm looking into the details with our production team and will get back to you with a specific update within 48 hours.`,
        ],
        actions: [`Confirm production/listing status for ${title} with production team`],
      };
    }
    const next = remainingStages(book.stage).map((s) => STAGE_LABEL[s]);
    return {
      paragraphs: [
        `Thank you for checking in on ${title} — I know how exciting (and how long) this stage can feel.`,
        `Your book is currently in ${STAGE_LABEL[book.stage]}. After this it moves through ${next.join(" → ")}. The stages that most often take longer are Cover Design and Proofreading, where we go back and forth on approvals and revisions.`,
        `I've asked the production team for a firm date for this stage and will share an updated timeline with you within 48 hours.`,
      ],
      actions: [`Get updated ${STAGE_LABEL[book.stage]} completion date for ${title} from production`],
    };
  },

  GENERAL_INQUIRY: ({ ticket, title }) => {
    const metadata = /bio|description|blurb|keywords?|metadata/i.test(`${ticket.subject} ${ticket.description}`);
    return {
      paragraphs: [
        `Thank you for getting in touch about ${title}.`,
        metadata
          ? `Yes, you can update this after publication. Reply here with the updated text (or use the metadata update option in your dashboard) and we'll submit it to the platforms. Changes typically reflect within 3–5 business days.`
          : `I'm looking into this with the relevant team and will get back to you with a clear answer within 48 hours.`,
      ],
      actions: metadata ? ["Submit metadata update to platforms once the author sends the new text"] : [],
    };
  },
};
