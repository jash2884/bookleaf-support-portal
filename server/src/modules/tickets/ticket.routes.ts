import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { env } from "../../config/env.js";
import { currentUser, requireRole } from "../../http/auth.js";
import { parseInput, pathParam } from "../../http/validate.js";
import { getReplyDraft, toDraftDto } from "../../ai/draftService.js";
import { triageTicket } from "../../ai/triageService.js";
import { attachmentUpload, removeUpload, resolveUpload } from "./attachments.js";
import { AddMessageBody, CreateTicketBody, ListTicketsQuery, UpdateTicketBody } from "./ticket.schemas.js";
import * as tickets from "./ticket.service.js";

export const ticketRouter = Router();

const perUser = (limit: number, windowMinutes: number) =>
  rateLimit({
    windowMs: windowMinutes * 60_000,
    limit: env.isTest ? 10_000 : limit,
    keyGenerator: (req) => req.user?.id ?? "anonymous",
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many requests — please slow down and try again shortly." } },
  });

/** GET /tickets — authors: own tickets; admins: the full queue with filters. */
ticketRouter.get("/", async (req, res) => {
  const query = parseInput(ListTicketsQuery, req.query, "query");
  res.json(await tickets.listTickets(currentUser(req), query));
});

/** POST /tickets — authors raise a ticket (JSON or multipart with one `attachment`). */
ticketRouter.post("/", requireRole("AUTHOR"), perUser(20, 60), attachmentUpload.single("attachment"), async (req, res) => {
  const file = req.file;
  try {
    const input = parseInput(CreateTicketBody, req.body);
    const attachment = file
      ? { fileName: file.originalname.slice(0, 200), mimeType: file.mimetype, sizeBytes: file.size, storageKey: file.filename }
      : null;
    res.status(201).json({ data: await tickets.createTicket(currentUser(req), input, attachment) });
  } catch (err) {
    if (file) await removeUpload(file.filename); // don't leave orphaned files behind
    throw err;
  }
});

ticketRouter.get("/:ticketId", async (req, res) => {
  res.json({ data: await tickets.getTicket(currentUser(req), pathParam(req, "ticketId")) });
});

/** PATCH /tickets/:id — admins change status, override category/priority, assign. */
ticketRouter.patch("/:ticketId", requireRole("ADMIN"), async (req, res) => {
  const body = parseInput(UpdateTicketBody, req.body);
  res.json({ data: await tickets.updateTicket(currentUser(req), pathParam(req, "ticketId"), body) });
});

/** POST /tickets/:id/messages — author reply, admin reply, or admin internal note. */
ticketRouter.post("/:ticketId/messages", async (req, res) => {
  const body = parseInput(AddMessageBody, req.body);
  res.status(201).json({ data: await tickets.addMessage(currentUser(req), pathParam(req, "ticketId"), body, req.body ?? {}) });
});

/** GET /tickets/:id/draft — current AI reply draft (generated lazily, cached). */
ticketRouter.get("/:ticketId/draft", requireRole("ADMIN"), async (req, res) => {
  const { status, draft } = await getReplyDraft(pathParam(req, "ticketId"), currentUser(req));
  res.json({ status, data: toDraftDto(draft) });
});

/** POST /tickets/:id/draft — force a fresh draft ("Regenerate"). */
ticketRouter.post("/:ticketId/draft", requireRole("ADMIN"), perUser(60, 60), async (req, res) => {
  const { status, draft } = await getReplyDraft(pathParam(req, "ticketId"), currentUser(req), { regenerate: true });
  res.status(201).json({ status, data: toDraftDto(draft) });
});

/** POST /tickets/:id/triage — re-run AI classification (e.g. after an outage). */
ticketRouter.post("/:ticketId/triage", requireRole("ADMIN"), perUser(60, 60), async (req, res) => {
  const user = currentUser(req);
  await tickets.getTicket(user, pathParam(req, "ticketId")); // 404 if missing
  await triageTicket(pathParam(req, "ticketId"), { force: true });
  res.json({ data: await tickets.getTicket(user, pathParam(req, "ticketId")) });
});

ticketRouter.get("/:ticketId/attachments/:attachmentId", async (req, res) => {
  const attachment = await tickets.getAttachment(currentUser(req), pathParam(req, "ticketId"), pathParam(req, "attachmentId"));
  // Always download (never render inline) so an uploaded file can't execute in our origin.
  res.download(resolveUpload(attachment.storageKey), attachment.fileName);
});
