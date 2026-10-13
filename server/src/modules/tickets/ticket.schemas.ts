import { z } from "zod";
import { TicketCategory, TicketPriority, TicketStatus } from "@prisma/client";

/** Accepts `?status=OPEN&status=IN_PROGRESS` or `?status=OPEN,IN_PROGRESS`. */
const multi = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined ? undefined : (Array.isArray(v) ? v : [v]).flatMap((x) => String(x).split(",")).filter(Boolean)), z.array(item).optional());

export const ListTicketsQuery = z.object({
  status: multi(z.enum(TicketStatus)),
  category: multi(z.enum(TicketCategory)),
  priority: multi(z.enum(TicketPriority)),
  /** "me", "unassigned" or an admin user id. */
  assignee: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(["urgency", "oldest", "newest", "updated"]).default("urgency"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListTicketsQuery = z.infer<typeof ListTicketsQuery>;

export const CreateTicketBody = z.object({
  /** Empty / "general" means "General / Account level". */
  bookId: z
    .string()
    .optional()
    .transform((v) => (v && v !== "general" ? v : null)),
  subject: z.string().trim().min(5, "Subject must be at least 5 characters").max(150, "Subject must be 150 characters or fewer"),
  description: z
    .string()
    .trim()
    .min(20, "Please describe the issue in at least 20 characters")
    .max(5000, "Description must be 5,000 characters or fewer"),
});

export const UpdateTicketBody = z
  .object({
    status: z.enum(TicketStatus).optional(),
    category: z.enum(TicketCategory).optional(),
    priority: z.enum(TicketPriority).optional(),
    assigneeId: z.string().nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Provide at least one field to update" });
export type UpdateTicketBody = z.infer<typeof UpdateTicketBody>;

export const AddMessageBody = z.object({
  body: z.string().trim().min(1, "Message cannot be empty").max(10_000),
  /** Admins only. Authors' messages are always PUBLIC. */
  visibility: z.enum(["PUBLIC", "INTERNAL"]).default("PUBLIC"),
  /** Admins only: the AI draft this reply started from, for adoption tracking. */
  draftId: z.string().optional(),
  /** Admins only: set the ticket status in the same action ("Send & resolve"). */
  status: z.enum(TicketStatus).optional(),
});
export type AddMessageBody = z.infer<typeof AddMessageBody>;
