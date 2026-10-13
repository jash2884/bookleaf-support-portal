import { Router } from "express";
import { prisma } from "../../lib/prisma.js";
import { aiStatus } from "../../ai/index.js";
import { RESPONSE_TARGET_HOURS, UNRESOLVED_STATUSES } from "../../domain/taxonomy.js";

/** Admin-only endpoints (mounted behind requireRole("ADMIN")). */
export const adminRouter = Router();

/** GET /admin/agents — BookLeaf team members (assignee picker, filters). */
adminRouter.get("/agents", async (_req, res) => {
  const agents = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } });
  res.json({ data: agents });
});

/** GET /admin/ai-status — whether AI is online, degraded (circuit open) or offline (no key). */
adminRouter.get("/ai-status", (_req, res) => {
  res.json({ data: aiStatus() });
});

/**
 * GET /admin/metrics — queue health plus AI cost / reliability / quality signals:
 * - override rate: how often admins correct the AI's category or priority;
 * - draft adoption: how often replies are sent from an AI draft (edited or not).
 */
adminRouter.get("/metrics", async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [byStatus, unresolved, aiCalls, triaged, replies] = await Promise.all([
    prisma.ticket.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.ticket.findMany({
      where: { status: { in: UNRESOLVED_STATUSES } },
      select: { priority: true, assigneeId: true, createdAt: true, firstResponseAt: true },
    }),
    prisma.aiCallLog.groupBy({
      by: ["task", "outcome"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, cacheReadTokens: true, cacheWriteTokens: true, costUsd: true },
      _avg: { latencyMs: true },
    }),
    prisma.ticket.findMany({
      where: { triageState: "AI" },
      select: { category: true, aiCategory: true, categorySource: true, priority: true, aiPriority: true, prioritySource: true },
    }),
    prisma.ticketMessage.groupBy({
      by: ["origin"],
      where: { visibility: "PUBLIC", sender: { role: "ADMIN" } },
      _count: { _all: true },
    }),
  ]);

  const now = Date.now();
  const byPriority = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, UNTRIAGED: 0 };
  let slaBreached = 0;
  for (const t of unresolved) {
    byPriority[t.priority ?? "UNTRIAGED"]++;
    const target = RESPONSE_TARGET_HOURS[t.priority ?? "MEDIUM"] * 3_600_000;
    if (!t.firstResponseAt && now - t.createdAt.getTime() >= target) slaBreached++;
  }

  const overridden = (field: "category" | "priority") =>
    triaged.filter((t) =>
      field === "category"
        ? t.categorySource === "ADMIN" && t.category !== t.aiCategory
        : t.prioritySource === "ADMIN" && t.priority !== t.aiPriority,
    ).length;

  const tasks = ["TRIAGE", "DRAFT"] as const;
  const ai = Object.fromEntries(
    tasks.map((task) => {
      const rows = aiCalls.filter((r) => r.task === task);
      const count = (outcome: string) => rows.find((r) => r.outcome === outcome)?._count._all ?? 0;
      const sum = (k: "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens") =>
        rows.reduce((s, r) => s + (r._sum[k] ?? 0), 0);
      const success = rows.find((r) => r.outcome === "SUCCESS");
      return [
        task.toLowerCase(),
        {
          calls: count("SUCCESS"),
          errors: count("ERROR"),
          skipped: count("SKIPPED"),
          inputTokens: sum("inputTokens"),
          outputTokens: sum("outputTokens"),
          cacheReadTokens: sum("cacheReadTokens"),
          cacheWriteTokens: sum("cacheWriteTokens"),
          costUsd: Number(rows.reduce((s, r) => s + (r._sum.costUsd?.toNumber() ?? 0), 0).toFixed(4)),
          avgLatencyMs: Math.round(success?._avg.latencyMs ?? 0),
        },
      ];
    }),
  );

  const replyCount = (origin: string) => replies.find((r) => r.origin === origin)?._count._all ?? 0;

  res.json({
    data: {
      queue: {
        byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
        unresolvedByPriority: byPriority,
        unassigned: unresolved.filter((t) => !t.assigneeId).length,
        slaBreached,
      },
      ai: {
        status: aiStatus(),
        windowDays: 30,
        ...ai,
        triageQuality: {
          aiTriagedTickets: triaged.length,
          categoryOverrides: overridden("category"),
          priorityOverrides: overridden("priority"),
        },
        draftAdoption: {
          sentUnedited: replyCount("AI_DRAFT_UNEDITED"),
          sentEdited: replyCount("AI_DRAFT_EDITED"),
          manual: replyCount("MANUAL"),
        },
      },
    },
  });
});
