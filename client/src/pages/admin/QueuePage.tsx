import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAgents, useMetrics, useTicketList, type TicketFilters } from "../../api/queries";
import type { AdminTicketListItem, TicketCategory, TicketPriority, TicketStatus } from "../../api/types";
import { AiStatusBanner } from "../../components/AiStatusBanner";
import { EmptyState, ErrorNotice, PageHeader, PageLoader, PriorityBadge, Stat, StatusBadge } from "../../components/ui";
import { age, CATEGORY_LABEL, PRIORITY_LABEL } from "../../lib/format";

const STATUS_VIEWS: Array<{ id: string; label: string; status: TicketStatus[] }> = [
  { id: "active", label: "Active", status: ["OPEN", "IN_PROGRESS"] },
  { id: "open", label: "Open", status: ["OPEN"] },
  { id: "in_progress", label: "In progress", status: ["IN_PROGRESS"] },
  { id: "resolved", label: "Resolved", status: ["RESOLVED"] },
  { id: "closed", label: "Closed", status: ["CLOSED"] },
  { id: "all", label: "All", status: [] },
];
const PRIORITIES: TicketPriority[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const PAGE_SIZE = 20;

export function QueuePage() {
  // Filters live in the URL: shareable, bookmarkable, and survive the back button.
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const view = params.get("view") ?? "active";
  const priorities = (params.get("priority")?.split(",").filter(Boolean) ?? []) as TicketPriority[];
  const page = Number(params.get("page") ?? 1);

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k);
    if (!("page" in patch)) next.delete("page");
    setParams(next, { replace: true });
  };

  // Debounce free-text search so we don't query on every keystroke.
  const [search, setSearch] = useState(params.get("q") ?? "");
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get("q") ?? "") !== search) update({ q: search || null });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const filters: TicketFilters = {
    status: STATUS_VIEWS.find((v) => v.id === view)?.status,
    priority: priorities,
    category: params.get("category") ? [params.get("category") as TicketCategory] : undefined,
    assignee: params.get("assignee") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    q: params.get("q") ?? undefined,
    sort: params.get("sort") ?? "urgency",
    page,
    pageSize: PAGE_SIZE,
  };

  const list = useTicketList<AdminTicketListItem>(filters);
  const metrics = useMetrics();
  const agents = useAgents();
  const q = metrics.data?.queue;
  const hasFilters = ["priority", "category", "assignee", "from", "to", "q"].some((k) => params.get(k));

  return (
    <>
      <PageHeader title="Ticket queue" subtitle="Most urgent first, then oldest. New tickets and replies appear live." />
      <AiStatusBanner />

      {q && (
        <div className="stats">
          <Stat label="Critical / High open" value={`${q.unresolvedByPriority.CRITICAL} / ${q.unresolvedByPriority.HIGH}`} tone={q.unresolvedByPriority.CRITICAL > 0 ? "danger" : undefined} hint="Unresolved tickets" />
          <Stat label="Response target missed" value={q.slaBreached} tone={q.slaBreached > 0 ? "warn" : "good"} hint="No first reply within target for its priority" />
          <Stat label="Unassigned" value={q.unassigned} hint="Active tickets nobody owns" />
          <Stat label="Active tickets" value={(q.byStatus.OPEN ?? 0) + (q.byStatus.IN_PROGRESS ?? 0)} hint={`${q.byStatus.OPEN ?? 0} open · ${q.byStatus.IN_PROGRESS ?? 0} in progress`} />
        </div>
      )}

      <div className="card filters">
        <div className="tabs" role="tablist">
          {STATUS_VIEWS.map((v) => (
            <button key={v.id} role="tab" aria-selected={view === v.id} className={`tab ${view === v.id ? "active" : ""}`} onClick={() => update({ view: v.id === "active" ? null : v.id })}>
              {v.label}
            </button>
          ))}
        </div>

        <div className="filter-row">
          <div className="chip-group" aria-label="Priority filter">
            {PRIORITIES.map((p) => {
              const on = priorities.includes(p);
              return (
                <button
                  key={p}
                  className={`chip-toggle priority-${p.toLowerCase()} ${on ? "on" : ""}`}
                  aria-pressed={on}
                  onClick={() => update({ priority: (on ? priorities.filter((x) => x !== p) : [...priorities, p]).join(",") || null })}
                >
                  {PRIORITY_LABEL[p]}
                </button>
              );
            })}
          </div>

          <select aria-label="Category" value={params.get("category") ?? ""} onChange={(e) => update({ category: e.target.value || null })}>
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <select aria-label="Assignee" value={params.get("assignee") ?? ""} onChange={(e) => update({ assignee: e.target.value || null })}>
            <option value="">Anyone</option>
            <option value="me">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
            {agents.data?.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <label className="date-filter">
            From <input type="date" value={params.get("from") ?? ""} onChange={(e) => update({ from: e.target.value || null })} />
          </label>
          <label className="date-filter">
            To <input type="date" value={params.get("to") ?? ""} onChange={(e) => update({ to: e.target.value || null })} />
          </label>

          <select aria-label="Sort" value={params.get("sort") ?? "urgency"} onChange={(e) => update({ sort: e.target.value === "urgency" ? null : e.target.value })}>
            <option value="urgency">Most urgent</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
            <option value="updated">Recently active</option>
          </select>

          <input className="search" type="search" placeholder="Search subject, author, book or BL-12…" value={search} onChange={(e) => setSearch(e.target.value)} />

          {hasFilters && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSearch("");
                setParams(view === "active" ? {} : { view }, { replace: true });
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {list.isLoading ? (
        <PageLoader />
      ) : list.error || !list.data ? (
        <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.data.length === 0 ? (
        <EmptyState title={hasFilters ? "No tickets match these filters" : "Queue is clear"}>
          {hasFilters ? "Try widening the filters." : "Nothing needs attention right now."}
        </EmptyState>
      ) : (
        <>
          <div className="card table-wrap">
            <table className="queue">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Ticket</th>
                  <th className="hide-sm">Category</th>
                  <th>Status</th>
                  <th className="hide-sm">Waiting on</th>
                  <th>Age</th>
                  <th className="hide-sm">Assignee</th>
                </tr>
              </thead>
              <tbody>
                {list.data.data.map((t) => (
                  <tr key={t.id} className={t.slaBreached ? "row-breached" : undefined} onClick={() => navigate(`/admin/tickets/${t.id}`)}>
                    <td>
                      <PriorityBadge priority={t.priority} source={t.prioritySource} />
                    </td>
                    <td className="ticket-cell">
                      <Link to={`/admin/tickets/${t.id}`} onClick={(e) => e.stopPropagation()}>
                        <span className="ref">{t.reference}</span> {t.subject}
                      </Link>
                      {t.summary && t.summary !== t.subject && <div className="summary">{t.summary}</div>}
                      <div className="muted small">
                        {t.author.name} · {t.book?.title ?? "General / Account"}
                      </div>
                    </td>
                    <td className="hide-sm small">{t.category ? CATEGORY_LABEL[t.category] : <span className="muted">—</span>}</td>
                    <td>
                      <StatusBadge status={t.status} />
                    </td>
                    <td className="hide-sm small">{t.waitingOn === "bookleaf" ? <strong>BookLeaf</strong> : <span className="muted">Author</span>}</td>
                    <td className="small nowrap">
                      {age(t.ageHours)}
                      {t.slaBreached && <span className="overdue" title="No first reply within the response target for this priority">Overdue</span>}
                    </td>
                    <td className="hide-sm small">{t.assignee?.name ?? <span className="muted">Unassigned</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {list.data.pagination.totalPages > 1 && (
            <div className="pagination">
              <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
                ← Previous
              </button>
              <span className="muted small">
                Page {page} of {list.data.pagination.totalPages} · {list.data.pagination.total} tickets
              </span>
              <button className="btn btn-ghost btn-sm" disabled={page >= list.data.pagination.totalPages} onClick={() => update({ page: String(page + 1) })}>
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
