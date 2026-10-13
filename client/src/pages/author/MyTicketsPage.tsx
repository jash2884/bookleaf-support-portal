import { useState } from "react";
import { Link } from "react-router-dom";
import { useTicketList } from "../../api/queries";
import type { AuthorTicketListItem, TicketStatus } from "../../api/types";
import { EmptyState, ErrorNotice, PageHeader, PageLoader, StatusBadge } from "../../components/ui";
import { relative } from "../../lib/format";

const TABS: Array<{ id: string; label: string; status?: TicketStatus[] }> = [
  { id: "active", label: "Active", status: ["OPEN", "IN_PROGRESS"] },
  { id: "done", label: "Resolved", status: ["RESOLVED", "CLOSED"] },
  { id: "all", label: "All" },
];

export function MyTicketsPage() {
  const [tab, setTab] = useState("active");
  const status = TABS.find((t) => t.id === tab)?.status;
  const { data, isLoading, error, refetch } = useTicketList<AuthorTicketListItem>({ status, pageSize: 50 });

  return (
    <>
      <PageHeader
        title="My tickets"
        subtitle="Replies from the BookLeaf team appear here instantly — no need to refresh."
        actions={<Link to="/tickets/new" className="btn btn-primary">New ticket</Link>}
      />

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <PageLoader />
      ) : error || !data ? (
        <ErrorNotice error={error} onRetry={() => void refetch()} />
      ) : data.data.length === 0 ? (
        <EmptyState
          title={tab === "active" ? "No open tickets" : "No tickets here"}
          action={<Link to="/tickets/new" className="btn btn-primary">Raise a ticket</Link>}
        >
          Questions about royalties, your ISBN, printing or where your book is in production? We're here to help.
        </EmptyState>
      ) : (
        <ul className="card list">
          {data.data.map((t) => (
            <li key={t.id}>
              <Link to={`/tickets/${t.id}`} className="list-row">
                <div className="list-main">
                  <div className="list-title">
                    {t.subject}
                    {t.lastReplyFromBookLeaf && (t.status === "OPEN" || t.status === "IN_PROGRESS") && <span className="pill pill-brand">BookLeaf replied</span>}
                  </div>
                  <div className="muted small">
                    {t.reference} · {t.book?.title ?? "General / Account"} · {t.replyCount} {t.replyCount === 1 ? "reply" : "replies"}
                  </div>
                </div>
                <div className="list-side">
                  <StatusBadge status={t.status} />
                  <span className="muted small">Updated {relative(t.lastActivityAt)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
