/**
 * Seeds the database from data/bookleaf_sample_data.json (10 authors, 18 books),
 * creates two admin accounts and a handful of realistic demo tickets.
 *
 * Idempotent: safe to run on every boot. Authors/books are upserted from the
 * dataset; users keep their existing password; demo tickets are only created
 * when the ticket table is empty. Demo tickets start in triage state PENDING, so
 * the triage worker classifies them through the normal AI pipeline on startup.
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { parseBookStatus } from "../domain/bookStage.js";

interface SampleBook {
  book_id: string;
  title: string;
  isbn: string;
  genre: string;
  publication_date: string | null;
  status: string;
  mrp: number | null;
  author_royalty_per_copy: number | null;
  total_copies_sold: number;
  total_royalty_earned: number;
  royalty_paid: number;
  royalty_pending: number;
  last_royalty_payout_date: string | null;
  print_partner: string | null;
  available_on: string[];
}

interface SampleAuthor {
  author_id: string;
  name: string;
  email: string;
  phone: string;
  city: string;
  joined_date: string;
  books: SampleBook[];
}

export const DEMO_AUTHOR_PASSWORD = process.env.SEED_AUTHOR_PASSWORD ?? "Author@123";
export const DEMO_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin@123";

export const DEMO_ADMINS = [
  { email: "admin@bookleaf.com", name: "Neha Iyer" },
  { email: "support@bookleaf.com", name: "Karan Mehta" },
];

const date = (value: string | null) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

async function loadDataset(): Promise<SampleAuthor[]> {
  const url = new URL("../../data/bookleaf_sample_data.json", import.meta.url);
  const json = JSON.parse(await readFile(url, "utf8")) as { authors: SampleAuthor[] };
  return json.authors;
}

function bookData(b: SampleBook) {
  return {
    title: b.title,
    isbn: b.isbn,
    genre: b.genre,
    stage: parseBookStatus(b.status),
    publicationDate: date(b.publication_date),
    mrp: b.mrp,
    royaltyPerCopy: b.author_royalty_per_copy,
    totalCopiesSold: b.total_copies_sold,
    totalRoyaltyEarned: b.total_royalty_earned,
    royaltyPaid: b.royalty_paid,
    royaltyPending: b.royalty_pending,
    lastRoyaltyPayoutDate: date(b.last_royalty_payout_date),
    printPartner: b.print_partner,
    availableOn: b.available_on,
  } satisfies Omit<Prisma.BookUncheckedCreateInput, "code" | "authorId">;
}

export async function seedDatabase(prisma: PrismaClient, opts: { demoTickets?: boolean } = {}) {
  const authors = await loadDataset();
  const authorHash = await bcrypt.hash(DEMO_AUTHOR_PASSWORD, 10);
  const adminHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 10);

  for (const admin of DEMO_ADMINS) {
    await prisma.user.upsert({
      where: { email: admin.email },
      update: {},
      create: { ...admin, role: "ADMIN", passwordHash: adminHash },
    });
  }

  for (const a of authors) {
    const user = await prisma.user.upsert({
      where: { email: a.email.toLowerCase() },
      update: { name: a.name },
      create: { email: a.email.toLowerCase(), name: a.name, role: "AUTHOR", passwordHash: authorHash },
    });
    const author = await prisma.author.upsert({
      where: { code: a.author_id },
      update: { phone: a.phone, city: a.city, joinedDate: date(a.joined_date)! },
      create: {
        code: a.author_id,
        userId: user.id,
        phone: a.phone,
        city: a.city,
        joinedDate: date(a.joined_date)!,
      },
    });
    for (const b of a.books) {
      await prisma.book.upsert({
        where: { code: b.book_id },
        update: bookData(b),
        create: { code: b.book_id, authorId: author.id, ...bookData(b) },
      });
    }
  }

  if (opts.demoTickets !== false && (await prisma.ticket.count()) === 0) {
    await seedDemoTickets(prisma);
  }

  return { authors: authors.length, books: authors.reduce((n, a) => n + a.books.length, 0) };
}

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);

/** Demo tickets modelled on the sample queries in the brief, mapped to real dataset records. */
async function seedDemoTickets(prisma: PrismaClient) {
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_ADMINS[0]!.email } });
  const authorByCode = async (code: string) => prisma.author.findUniqueOrThrow({ where: { code } });
  const bookByCode = async (code: string) => prisma.book.findUniqueOrThrow({ where: { code } });

  const demo: Array<{
    author: string;
    book: string | null;
    subject: string;
    description: string;
    ageHours: number;
    status?: "OPEN" | "IN_PROGRESS" | "RESOLVED";
    adminReply?: string;
    internalNote?: string;
  }> = [
    {
      author: "AUTH003",
      book: "BK005",
      subject: "No royalty received since my book was published",
      description:
        "Between Two Temples was published in July 2024 and my dashboard shows sales, but I have not received a single royalty payment so far. It has been more than a year. Can someone please tell me what is going on? My bank details were added when I signed up.",
      ageHours: 70,
    },
    {
      author: "AUTH002",
      book: "BK003",
      subject: "Different ISBN on Amazon US vs the printed copy",
      description:
        "The Amazon US listing for Code & Karma shows a different ISBN from the one printed on the back cover of my physical copies. A reader pointed this out. I'm worried sales are being attributed to the wrong book.",
      ageHours: 5,
    },
    {
      author: "AUTH010",
      book: "BK018",
      subject: "Howrah Nights showing 'Currently Unavailable' on Amazon",
      description:
        "My book is published but Amazon India shows it as 'Currently Unavailable' since last weekend. I've been sharing the link with readers and they can't buy it.",
      ageHours: 26,
    },
    {
      author: "AUTH007",
      book: "BK011",
      subject: "Author copies have blurry images and misaligned pages",
      description:
        "I received my author copies of The Algorithm of Love yesterday and the print quality is terrible. The chapter illustrations are blurry and several pages are misaligned. I was planning to use these at a book signing next month.",
      ageHours: 30,
    },
    {
      author: "AUTH009",
      book: "BK015",
      subject: "Raising Roots stuck in typesetting",
      description:
        "It's been 3 weeks and my book is still showing as in typesetting. When will it be done? I'd like to plan a launch.",
      ageHours: 50,
    },
    {
      author: "AUTH009",
      book: "BK016",
      subject: "Pending royalty of ₹850 not paid",
      description:
        "My dashboard shows ₹850 pending for The Nagpur Notebooks but nothing has been paid out yet. When will I receive this?",
      ageHours: 8,
    },
    {
      author: "AUTH001",
      book: "BK001",
      subject: "Royalty seems lower than copies sold",
      description:
        "Whispers of the Ganges has sold 342 copies but I've only received ₹8,400 so far. Could you explain how this was calculated?",
      ageHours: 96,
      status: "IN_PROGRESS",
      internalNote: "Asked finance for the per-platform statement for Q2/Q3 before replying.",
    },
    {
      author: "AUTH004",
      book: null,
      subject: "Can I update my author bio on Amazon?",
      description: "I'd like to update my author bio on Amazon and Flipkart to mention my new podcast. Is that possible after publishing?",
      ageHours: 150,
      status: "RESOLVED",
      adminReply:
        "Hi Vikram,\n\nThanks for reaching out, and congratulations on the podcast! Yes, you can update your author bio after publication. Send us the new bio by replying here (or via the metadata update form in your dashboard) and we'll submit it to Amazon and Flipkart. Changes typically reflect within 3–5 business days.\n\nWarm regards,\nNeha\nBookLeaf Author Support",
    },
  ];

  for (const t of demo) {
    const author = await authorByCode(t.author);
    const book = t.book ? await bookByCode(t.book) : null;
    const createdAt = hoursAgo(t.ageHours);
    const ticket = await prisma.ticket.create({
      data: {
        authorId: author.id,
        bookId: book?.id ?? null,
        subject: t.subject,
        description: t.description,
        status: t.status ?? "OPEN",
        assigneeId: t.status ? admin.id : null,
        createdAt,
        lastActivityAt: createdAt,
        resolvedAt: t.status === "RESOLVED" ? hoursAgo(t.ageHours - 20) : null,
        firstResponseAt: t.adminReply ? hoursAgo(t.ageHours - 20) : null,
      },
    });
    if (t.internalNote) {
      await prisma.ticketMessage.create({
        data: { ticketId: ticket.id, senderId: admin.id, body: t.internalNote, visibility: "INTERNAL", createdAt: hoursAgo(t.ageHours - 2) },
      });
    }
    if (t.adminReply) {
      await prisma.ticketMessage.create({
        data: { ticketId: ticket.id, senderId: admin.id, body: t.adminReply, createdAt: hoursAgo(t.ageHours - 20) },
      });
    }
  }
}

// Allow `node dist/db/seed.js` / `tsx src/db/seed.ts` to run the seed directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  seedDatabase(prisma)
    .then((r) => console.log(`Seed complete: ${r.authors} authors, ${r.books} books.`))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
