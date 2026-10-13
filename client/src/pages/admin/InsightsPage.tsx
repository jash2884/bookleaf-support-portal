import { useMetrics } from "../../api/queries";
import type { Metrics } from "../../api/types";
import { AiStatusBanner } from "../../components/AiStatusBanner";
import { ErrorNotice, PageHeader, PageLoader, Stat } from "../../components/ui";

const pct = (part: number, whole: number) => (whole === 0 ? "—" : `${Math.round((part / whole) * 100)}%`);
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const tokens = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString());

export function InsightsPage() {
  const { data, isLoading, error, refetch } = useMetrics();
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorNotice error={error} onRetry={() => void refetch()} />;

  const { ai, queue } = data;
  const totalCost = ai.triage.costUsd + ai.draft.costUsd;
  const adoption = ai.draftAdoption;
  const replies = adoption.sentEdited + adoption.sentUnedited + adoption.manual;

  return (
    <>
      <PageHeader
        title="AI & queue insights"
        subtitle={`How the AI assistant is performing and what it costs — last ${ai.windowDays} days. Triage: ${ai.status.triageModel} · Drafts: ${ai.status.draftModel}`}
      />
      <AiStatusBanner />

      <h2 className="section-title">Quality</h2>
      <div className="stats">
        <Stat
          label="Category overrides"
          value={pct(ai.triageQuality.categoryOverrides, ai.triageQuality.aiTriagedTickets)}
          hint={`${ai.triageQuality.categoryOverrides} of ${ai.triageQuality.aiTriagedTickets} AI-triaged tickets corrected by an admin`}
        />
        <Stat
          label="Priority overrides"
          value={pct(ai.triageQuality.priorityOverrides, ai.triageQuality.aiTriagedTickets)}
          hint={`${ai.triageQuality.priorityOverrides} of ${ai.triageQuality.aiTriagedTickets} AI-triaged tickets`}
        />
        <Stat
          label="Replies started from AI draft"
          value={pct(adoption.sentEdited + adoption.sentUnedited, replies)}
          hint={`${adoption.sentUnedited} sent as-is · ${adoption.sentEdited} edited · ${adoption.manual} written manually`}
        />
      </div>

      <h2 className="section-title">Cost & reliability</h2>
      <div className="stats">
        <Stat label="AI spend" value={usd(totalCost)} hint={`Triage ${usd(ai.triage.costUsd)} · Drafts ${usd(ai.draft.costUsd)}`} />
        <TaskStat label="Triage calls" t={ai.triage} />
        <TaskStat label="Draft calls" t={ai.draft} />
        <Stat
          label="Prompt cache reads"
          value={tokens(ai.triage.cacheReadTokens + ai.draft.cacheReadTokens)}
          hint={`of ${tokens(ai.triage.inputTokens + ai.draft.inputTokens + ai.triage.cacheReadTokens + ai.draft.cacheReadTokens + ai.triage.cacheWriteTokens + ai.draft.cacheWriteTokens)} input tokens (billed at 10%)`}
        />
      </div>

      <h2 className="section-title">Queue</h2>
      <div className="stats">
        {(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const).map((s) => (
          <Stat key={s} label={s.replace("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())} value={queue.byStatus[s] ?? 0} />
        ))}
      </div>

      <div className="card prose small">
        <h3>How AI cost is kept down</h3>
        <ul>
          <li>Triage uses a small, fast model at low effort with structured output; replies use a stronger model only when a draft is actually needed.</li>
          <li>Drafts are generated lazily when an admin opens a ticket, cached, and only regenerated after the author sends a new message.</li>
          <li>Each prompt carries only the knowledge-base sections for the ticket's category, the relevant book's facts and a trimmed conversation history.</li>
          <li>The static instructions are prompt-cached, and a circuit breaker stops calls during an outage instead of paying for timeouts.</li>
        </ul>
      </div>
    </>
  );
}

function TaskStat({ label, t }: { label: string; t: Metrics["ai"]["triage"] }) {
  const fallbacks = t.errors + t.skipped;
  return (
    <Stat
      label={label}
      value={t.calls}
      tone={fallbacks > 0 ? "warn" : undefined}
      hint={`${fallbacks} fell back · avg ${t.avgLatencyMs ? `${(t.avgLatencyMs / 1000).toFixed(1)}s` : "—"} · ${tokens(t.inputTokens)} in / ${tokens(t.outputTokens)} out`}
    />
  );
}
