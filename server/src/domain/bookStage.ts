import type { BookStage } from "@prisma/client";

/** Production pipeline in order (BookLeaf knowledge base → "Production Stages"). */
export const STAGE_ORDER: BookStage[] = [
  "MANUSCRIPT_RECEIVED",
  "EDITING",
  "COVER_DESIGN",
  "TYPESETTING",
  "PROOFREADING",
  "ISBN_ASSIGNMENT",
  "PRINTING",
  "DISTRIBUTION_SETUP",
  "PUBLISHED",
];

export const STAGE_LABEL: Record<BookStage, string> = {
  MANUSCRIPT_RECEIVED: "Manuscript Received",
  EDITING: "Editing",
  COVER_DESIGN: "Cover Design",
  TYPESETTING: "Typesetting",
  PROOFREADING: "Proofreading",
  ISBN_ASSIGNMENT: "ISBN Assignment",
  PRINTING: "Printing",
  DISTRIBUTION_SETUP: "Distribution Setup",
  PUBLISHED: "Published & Live",
};

/**
 * Maps the free-text status used in the source data ("Published & Live",
 * "In Production - Cover Design") onto the pipeline enum.
 */
export function parseBookStatus(raw: string): BookStage {
  const value = raw.trim().toLowerCase();
  if (value.startsWith("published")) return "PUBLISHED";
  const stage = STAGE_ORDER.find((s) => value.includes(STAGE_LABEL[s].toLowerCase()));
  if (!stage) throw new Error(`Unrecognised book status: "${raw}"`);
  return stage;
}

/** Human-readable status, matching how BookLeaf describes it to authors. */
export function describeStage(stage: BookStage): string {
  return stage === "PUBLISHED" ? STAGE_LABEL.PUBLISHED : `In Production – ${STAGE_LABEL[stage]}`;
}

export function remainingStages(stage: BookStage): BookStage[] {
  return STAGE_ORDER.slice(STAGE_ORDER.indexOf(stage) + 1);
}
