import type { ReactNode } from "react";
import type { DecisionSource, TicketPriority, TicketStatus } from "../api/types";
import { ApiError } from "../api/http";
import { PRIORITY_LABEL, STATUS_LABEL } from "../lib/format";

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge status-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>;
}

export function PriorityBadge({ priority, source }: { priority: TicketPriority | null; source?: DecisionSource | null }) {
  if (!priority) return <span className="badge priority-pending">Classifying…</span>;
  const title =
    source === "ADMIN" ? "Set by an admin" : source === "RULES" ? "Rule-based (AI was unavailable)" : source === "AI" ? "Set by AI triage" : undefined;
  return (
    <span className={`badge priority-${priority.toLowerCase()}`} title={title}>
      {PRIORITY_LABEL[priority]}
      {source === "ADMIN" && <span className="badge-mark" aria-label="admin override">✎</span>}
    </span>
  );
}

export function SourceTag({ source }: { source: DecisionSource | null }) {
  if (!source) return null;
  const label = { AI: "AI", RULES: "Rules", ADMIN: "Admin" }[source];
  return <span className={`source-tag source-${source.toLowerCase()}`}>{label}</span>;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden />
      {label && <span>{label}</span>}
    </span>
  );
}

export function PageLoader() {
  return (
    <div className="page-loader">
      <Spinner label="Loading…" />
    </div>
  );
}

export function ErrorNotice({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : "Something went wrong.";
  return (
    <div className="notice notice-error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button className="btn btn-ghost btn-sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13ZM13 4h5.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H13V4Z" />
        </svg>
      </div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "warn" | "danger" | "good" }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}
