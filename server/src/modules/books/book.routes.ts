import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";
import { notFound } from "../../lib/errors.js";
import { currentUser } from "../../http/auth.js";
import { parseInput, pathParam } from "../../http/validate.js";
import { nextPayout, PAYOUT_THRESHOLD_INR } from "../../domain/royalty.js";
import { serializeBook } from "./book.serializer.js";

export const bookRouter = Router();

const ListQuery = z.object({ authorId: z.string().optional() });

/**
 * GET /books — authors get their own catalogue plus a royalty summary;
 * admins get every book (optionally filtered by author).
 */
bookRouter.get("/", async (req, res) => {
  const user = currentUser(req);
  const query = parseInput(ListQuery, req.query, "query");
  const where: Prisma.BookWhereInput =
    user.role === "AUTHOR" ? { authorId: user.authorId! } : query.authorId ? { authorId: query.authorId } : {};

  const books = await prisma.book.findMany({ where, orderBy: [{ publicationDate: { sort: "desc", nulls: "first" } }, { title: "asc" }] });
  const data = books.map(serializeBook);

  const sum = (pick: (b: (typeof data)[number]) => number | null) => data.reduce((s, b) => s + (pick(b) ?? 0), 0);
  const pending = sum((b) => b.royaltyPending);
  const payout = nextPayout(new Date());

  res.json({
    data,
    summary: {
      totalBooks: data.length,
      publishedBooks: data.filter((b) => b.isPublished).length,
      totalCopiesSold: sum((b) => b.totalCopiesSold),
      totalRoyaltyEarned: sum((b) => b.totalRoyaltyEarned),
      royaltyPaid: sum((b) => b.royaltyPaid),
      royaltyPending: pending,
      payout: {
        threshold: PAYOUT_THRESHOLD_INR,
        meetsThreshold: pending >= PAYOUT_THRESHOLD_INR,
        nextPayoutBy: payout.deadline.toISOString().slice(0, 10),
        nextPayoutQuarter: payout.quarter,
      },
    },
  });
});

bookRouter.get("/:bookId", async (req, res) => {
  const user = currentUser(req);
  const book = await prisma.book.findUnique({ where: { id: pathParam(req, "bookId") } });
  // 404 (not 403) for other authors' books: don't confirm that the id exists.
  if (!book || (user.role === "AUTHOR" && book.authorId !== user.authorId)) throw notFound("Book");
  res.json({ data: serializeBook(book) });
});
