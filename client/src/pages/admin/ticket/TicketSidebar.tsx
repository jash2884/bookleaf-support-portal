import { useAuth } from "../../../auth/AuthProvider";
import { useAgents, useUpdateTicket } from "../../../api/queries";
import type { AdminTicket, TicketStatus } from "../../../api/types";
import { CATEGORY_LABEL, date, dateTime, inr, PRIORITY_LABEL, relative, STATUS_LABEL } from "../../../lib/format";

const ACTIVITY_LABEL: Record<string, string> = {
  created: "Ticket created",
  triaged: "Triaged",
  status_changed: "Status changed",
  category_overridden: "Category overridden",
  priority_overridden: "Priority overridden",
  assigned: "Assigned",
  unassigned: "Unassigned",
  reopened_by_author: "Reopened by author's reply",
};

export function TicketSidebar({ ticket }: { ticket: AdminTicket }) {
  const { user } = useAuth();
  const agents = useAgents();
  const update = useUpdateTicket(ticket.id);
  const agentName = (id: string | null) => (id ? agents.data?.find((a) => a.id === id)?.name ?? "someone" : "nobody");

  const describe = (a: AdminTicket["activity"][number]) => {
    const pretty = (v: string | null) =>
      v === null ? "—" : (STATUS_LABEL as Record<string, string>)[v] ?? (PRIORITY_LABEL as Record<string, string>)[v] ?? (CATEGORY_LABEL as Record<string, string>)[v] ?? v;
    if (a.type === "assigned" || a.type === "unassigned") return `${ACTIVITY_LABEL[a.type]} → ${agentName(a.toValue)}`;
    if (a.type === "triaged" || a.type === "created") return `${ACTIVITY_LABEL[a.type]}${a.toValue ? `: ${a.toValue}` : ""}`;
    return `${ACTIVITY_LABEL[a.type] ?? a.type}: ${pretty(a.fromValue)} → ${pretty(a.toValue)}`;
  };

  return (
    <aside className="workspace-side">
      <section className="card side-card">
        <h3>Ticket</h3>
        <label className="field">
          <span>Status</span>
          <select value={ticket.status} disabled={update.isPending} onChange={(e) => update.mutate({ status: e.target.value as TicketStatus })}>
            {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Assignee</span>
          <select value={ticket.assignee?.id ?? ""} disabled={update.isPending} onChange={(e) => update.mutate({ assigneeId: e.target.value || null })}>
            <option value="">Unassigned</option>
            {agents.data?.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        {ticket.assignee?.id !== user?.id && (
          <button className="btn btn-secondary btn-sm btn-block" disabled={update.isPending} onClick={() => update.mutate({ assigneeId: user!.id })}>
            Assign to me
          </button>
        )}
        <dl className="kv small">
          <div><dt>Opened</dt><dd>{dateTime(ticket.createdAt)}</dd></div>
          <div><dt>First reply</dt><dd>{ticket.firstResponseAt ? dateTime(ticket.firstResponseAt) : <span className={ticket.slaBreached ? "text-danger" : "muted"}>Not yet</span>}</dd></div>
          <div><dt>Waiting on</dt><dd>{ticket.waitingOn === "bookleaf" ? "BookLeaf" : "Author"}</dd></div>
          {ticket.resolvedAt && <div><dt>Resolved</dt><dd>{dateTime(ticket.resolvedAt)}</dd></div>}
        </dl>
      </section>

      <section className="card side-card">
        <h3>Author</h3>
        <p className="author-name">
          <strong>{ticket.author.name}</strong> <span className="muted small">{ticket.author.code}</span>
        </p>
        <p className="small muted">
          {ticket.author.email}
          <br />
          {ticket.author.phone} · {ticket.author.city}
          <br />
          Author since {date(ticket.author.joinedDate)}
        </p>
        <ul className="author-books">
          {ticket.author.books.map((b) => (
            <li key={b.id} className={b.id === ticket.book?.id ? "current" : undefined}>
              <div className="small"><strong>{b.title}</strong>{b.id === ticket.book?.id && <span className="pill">this ticket</span>}</div>
              <div className="muted small">{b.status}</div>
              {b.isPublished && (
                <div className="small book-money">
                  {b.totalCopiesSold} sold · paid {inr(b.royaltyPaid)} · <span className={b.royaltyPending > 0 ? "text-warn" : ""}>pending {inr(b.royaltyPending)}</span>
                  <br />
                  Last payout: {b.lastRoyaltyPayoutDate ? date(b.lastRoyaltyPayoutDate) : "never"}
                  {b.id === ticket.book?.id && <> · {b.availableOn.join(", ") || "not listed"}</>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="card side-card">
        <h3>Activity</h3>
        <ol className="activity small">
          {ticket.activity.map((a) => (
            <li key={a.id}>
              <span>{describe(a)}</span>
              <span className="muted"> · {a.actor} · {relative(a.createdAt)}</span>
            </li>
          ))}
        </ol>
      </section>
    </aside>
  );
}
