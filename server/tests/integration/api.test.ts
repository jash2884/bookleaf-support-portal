import { rm } from "node:fs/promises";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { seedDatabase } from "../../src/db/seed.js";
import { triageTicket } from "../../src/ai/triageService.js";
import { UPLOAD_ROOT } from "../../src/modules/tickets/attachments.js";
import { resetTestDatabase } from "./resetTestDatabase.js";

const app = createApp();
const tokens: Record<"priya" | "kavita" | "admin", string> = { priya: "", kavita: "", admin: "" };

async function login(email: string, password: string) {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

const as = (who: keyof typeof tokens) => ({
  get: (url: string) => request(app).get(url).set("Authorization", `Bearer ${tokens[who]}`),
  post: (url: string, body?: object) => request(app).post(url).set("Authorization", `Bearer ${tokens[who]}`).send(body),
  patch: (url: string, body: object) => request(app).patch(url).set("Authorization", `Bearer ${tokens[who]}`).send(body),
});

beforeAll(async () => {
  await resetTestDatabase(prisma);
  await seedDatabase(prisma, { demoTickets: false });
  tokens.priya = await login("priya.sharma@email.com", "Author@123");
  tokens.kavita = await login("kavita.deshmukh@email.com", "Author@123");
  tokens.admin = await login("admin@bookleaf.com", "Admin@123");
});

afterAll(async () => {
  await prisma.$disconnect();
  await rm(UPLOAD_ROOT, { recursive: true, force: true });
});

describe("auth", () => {
  it("rejects bad credentials with a specific error", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "priya.sharma@email.com", password: "wrong" });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("validates the login body", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(["body.email", "body.password"]);
  });

  it("protects every API route", async () => {
    for (const url of ["/api/books", "/api/tickets", "/api/events", "/api/admin/metrics"]) {
      expect((await request(app).get(url)).status).toBe(401);
    }
  });

  it("sets an httpOnly session cookie on login", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "admin@bookleaf.com", password: "Admin@123" });
    expect(String(res.headers["set-cookie"])).toMatch(/bl_session=.*HttpOnly/i);
  });
});

describe("books", () => {
  it("authors see only their own books, with royalty totals", async () => {
    const res = await as("priya").get("/api/books");
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { code: string }) => b.code).sort()).toEqual(["BK001", "BK002"]);
    expect(res.body.summary).toMatchObject({ totalCopiesSold: 531, royaltyPending: 3570, payout: { meetsThreshold: true } });
  });

  it("handles books in production and balances below the payout threshold", async () => {
    const res = await as("kavita").get("/api/books");
    const inProduction = res.body.data.find((b: { code: string }) => b.code === "BK015");
    expect(inProduction).toMatchObject({ isPublished: false, stage: "TYPESETTING", mrp: null, totalCopiesSold: 0 });
    expect(res.body.summary.payout.meetsThreshold).toBe(false); // ₹850 pending < ₹1,000
  });

  it("returns 404 (not 403) for another author's book", async () => {
    const kavitasBook = await prisma.book.findUniqueOrThrow({ where: { code: "BK015" } });
    expect((await as("priya").get(`/api/books/${kavitasBook.id}`)).status).toBe(404);
  });

  it("admins see every book", async () => {
    expect((await as("admin").get("/api/books")).body.data).toHaveLength(18);
  });
});

describe("ticket lifecycle", () => {
  let ticketId = "";
  let reference = "";

  it("validates new tickets field by field", async () => {
    const res = await as("priya").post("/api/tickets", { subject: "Hi", description: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path)).toEqual(["body.subject", "body.description"]);
  });

  it("rejects a book that belongs to another author", async () => {
    const kavitasBook = await prisma.book.findUniqueOrThrow({ where: { code: "BK015" } });
    const res = await as("priya").post("/api/tickets", { bookId: kavitasBook.id, subject: "Question", description: "This is long enough to pass validation." });
    expect(res.status).toBe(400);
  });

  it("only authors can raise tickets", async () => {
    const res = await as("admin").post("/api/tickets", { subject: "Question", description: "This is long enough to pass validation." });
    expect(res.status).toBe(403);
  });

  it("creates a ticket and returns the author view (no internal fields)", async () => {
    const book = await prisma.book.findUniqueOrThrow({ where: { code: "BK001" } });
    const res = await as("priya").post("/api/tickets", {
      bookId: book.id,
      subject: "No royalty for months",
      description: "I haven't received any royalty for 6 months for Whispers of the Ganges. What is going on?",
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ status: "OPEN", book: { title: "Whispers of the Ganges" } });
    for (const internal of ["priority", "category", "triage", "assignee", "activity"]) expect(res.body.data).not.toHaveProperty(internal);
    ticketId = res.body.data.id;
    reference = res.body.data.reference;
  });

  it("triages in the background, falling back to rules when AI is unavailable", async () => {
    await triageTicket(ticketId); // joins the run started by the create request
    const res = await as("admin").get(`/api/tickets/${ticketId}`);
    expect(res.body.data).toMatchObject({
      category: "ROYALTY_PAYMENTS",
      categorySource: "RULES",
      priority: "CRITICAL", // 6 months + account shows overdue pending royalty
      triage: { state: "FALLBACK" },
    });
    const log = await prisma.aiCallLog.findFirst({ where: { ticketId, task: "TRIAGE" } });
    expect(log).toMatchObject({ outcome: "SKIPPED", errorType: "disabled" });
  });

  it("hides the ticket from other authors", async () => {
    expect((await as("kavita").get(`/api/tickets/${ticketId}`)).status).toBe(404);
    expect((await as("kavita").get("/api/tickets")).body.data).toHaveLength(0);
  });

  it("forbids authors from admin actions", async () => {
    expect((await as("priya").patch(`/api/tickets/${ticketId}`, { status: "CLOSED" })).status).toBe(403);
    expect((await as("priya").get(`/api/tickets/${ticketId}/draft`)).status).toBe(403);
    expect((await as("priya").post(`/api/tickets/${ticketId}/messages`, { body: "x", visibility: "INTERNAL" })).status).toBe(403);
    expect((await as("priya").get("/api/admin/metrics")).status).toBe(403);
  });

  it("keeps internal notes away from the author", async () => {
    const note = await as("admin").post(`/api/tickets/${ticketId}/messages`, { body: "Finance: payout batch failed", visibility: "INTERNAL" });
    expect(note.status).toBe(201);
    const authorView = await as("priya").get(`/api/tickets/${ticketId}`);
    expect(JSON.stringify(authorView.body)).not.toContain("payout batch failed");
    const adminView = await as("admin").get(`/api/tickets/${ticketId}`);
    expect(adminView.body.data.messages[0]).toMatchObject({ visibility: "INTERNAL" });
  });

  it("preserves admin overrides when triage is re-run", async () => {
    const patched = await as("admin").patch(`/api/tickets/${ticketId}`, { priority: "LOW" });
    expect(patched.body.data).toMatchObject({ priority: "LOW", prioritySource: "ADMIN" });
    const rerun = await as("admin").post(`/api/tickets/${ticketId}/triage`);
    expect(rerun.body.data).toMatchObject({ priority: "LOW", prioritySource: "ADMIN", triage: { priority: "CRITICAL" } });
    await as("admin").patch(`/api/tickets/${ticketId}`, { priority: "HIGH" });
  });

  it("serves a cached reply draft, falling back to a policy template offline", async () => {
    const first = await as("admin").get(`/api/tickets/${ticketId}/draft`);
    expect(first.body).toMatchObject({ status: "generated", data: { isFallback: true, fallbackReason: "disabled" } });
    expect(first.body.data.body).toMatch(/^Hi Priya,/);
    expect(first.body.data.body).toContain("₹3,570");

    const second = await as("admin").get(`/api/tickets/${ticketId}/draft`);
    expect(second.body).toMatchObject({ status: "cached", data: { id: first.body.data.id } });
  });

  it("delivers admin replies to the author and moves the ticket forward", async () => {
    const draft = (await as("admin").get(`/api/tickets/${ticketId}/draft`)).body.data;
    const res = await as("admin").post(`/api/tickets/${ticketId}/messages`, { body: draft.body, draftId: draft.id });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("IN_PROGRESS");
    expect(res.body.data.firstResponseAt).not.toBeNull();
    expect(res.body.data.messages.at(-1).origin).toBe("MANUAL"); // template drafts don't count as AI adoption

    const authorView = await as("priya").get(`/api/tickets/${ticketId}`);
    expect(authorView.body.data.messages).toHaveLength(1);
    expect(authorView.body.data.messages[0].sender).toEqual({ name: "Neha · BookLeaf Support", isBookLeaf: true });

    // BookLeaf spoke last → no new draft is generated (cost control).
    expect((await as("admin").get(`/api/tickets/${ticketId}/draft`)).body).toEqual({ status: "not_needed", data: null });
  });

  it("reopens a resolved ticket when the author replies, and blocks replies once closed", async () => {
    await as("admin").patch(`/api/tickets/${ticketId}`, { status: "RESOLVED" });
    const reply = await as("priya").post(`/api/tickets/${ticketId}/messages`, { body: "Still not received, sorry!" });
    expect(reply.body.data.status).toBe("OPEN");

    await as("admin").patch(`/api/tickets/${ticketId}`, { status: "CLOSED" });
    const blocked = await as("priya").post(`/api/tickets/${ticketId}/messages`, { body: "Hello?" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe("CONFLICT");
  });

  it("assigns only to team members", async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@bookleaf.com" } });
    const author = await prisma.user.findUniqueOrThrow({ where: { email: "priya.sharma@email.com" } });
    expect((await as("admin").patch(`/api/tickets/${ticketId}`, { assigneeId: author.id })).status).toBe(400);
    const ok = await as("admin").patch(`/api/tickets/${ticketId}`, { assigneeId: admin.id });
    expect(ok.body.data.assignee).toEqual({ id: admin.id, name: "Neha Iyer" });
  });

  it("filters and searches the admin queue", async () => {
    const byRef = await as("admin").get(`/api/tickets?q=${reference}&status=CLOSED`);
    expect(byRef.body.data.map((t: { id: string }) => t.id)).toEqual([ticketId]);
    expect((await as("admin").get("/api/tickets?status=OPEN")).body.data).toHaveLength(0);
    expect((await as("admin").get("/api/tickets?priority=BOGUS")).status).toBe(400);
    expect((await as("admin").get("/api/tickets?assignee=me&status=CLOSED")).body.pagination.total).toBe(1);
  });

  it("reports metrics to admins", async () => {
    const res = await as("admin").get("/api/admin/metrics");
    expect(res.status).toBe(200);
    expect(res.body.data.ai.status.mode).toBe("offline");
    expect(res.body.data.ai.triage.skipped).toBeGreaterThan(0);
  });
});

describe("attachments", () => {
  it("accepts an image on ticket creation and only lets the owner download it", async () => {
    const res = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${tokens.priya}`)
      .field("subject", "Misprinted pages")
      .field("description", "Several pages in my author copies are misaligned, photo attached.")
      .attach("attachment", Buffer.from([0x89, 0x50, 0x4e, 0x47]), { filename: "page.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    const { url } = res.body.data.attachments[0];
    expect((await as("priya").get(url)).status).toBe(200);
    expect((await as("kavita").get(url)).status).toBe(404);
  });

  it("rejects unsupported file types", async () => {
    const res = await request(app)
      .post("/api/tickets")
      .set("Authorization", `Bearer ${tokens.priya}`)
      .field("subject", "Script attached")
      .field("description", "Trying to upload something that is not allowed here.")
      .attach("attachment", Buffer.from("<script>"), { filename: "x.html", contentType: "text/html" });
    expect(res.status).toBe(400);
  });
});

it("returns JSON 404s for unknown API routes", async () => {
  const res = await request(app).get("/api/nope");
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
});
