import { useState, type FormEvent } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ApiError } from "../../api/http";
import { useAddMessage, useTicket } from "../../api/queries";
import type { AuthorTicket } from "../../api/types";
import { ErrorNotice, PageHeader, PageLoader, StatusBadge } from "../../components/ui";
import { Thread, type ThreadEntry } from "../../components/Thread";
import { date } from "../../lib/format";

const STATUS_HELP: Record<AuthorTicket["status"], string> = {
  OPEN: "We've received your ticket and the team will reply here.",
  IN_PROGRESS: "The BookLeaf team is working on this.",
  RESOLVED: "We've marked this as resolved. Reply below if you still need help and we'll reopen it.",
  CLOSED: "This ticket is closed.",
};

export function AuthorTicketPage() {
  const { ticketId = "" } = useParams();
  const location = useLocation();
  const justCreated = (location.state as { created?: boolean } | null)?.created;
  const { data: ticket, isLoading, error, refetch } = useTicket<AuthorTicket>(ticketId);
  const reply = useAddMessage<AuthorTicket>(ticketId);
  const [body, setBody] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);

  if (isLoading) return <PageLoader />;
  if (error || !ticket) return <ErrorNotice error={error} onRetry={() => void refetch()} />;

  const entries: ThreadEntry[] = [
    { id: "original", kind: "author", senderName: "You", body: ticket.description, createdAt: ticket.createdAt, attachments: ticket.attachments },
    ...ticket.messages.map((m) => ({
      id: m.id,
      kind: m.sender.isBookLeaf ? ("bookleaf" as const) : ("author" as const),
      senderName: m.sender.isBookLeaf ? m.sender.name : "You",
      body: m.body,
      createdAt: m.createdAt,
    })),
  ];

  async function send(e: FormEvent) {
    e.preventDefault();
    setReplyError(null);
    try {
      await reply.mutateAsync({ body: body.trim() });
      setBody("");
    } catch (err) {
      setReplyError(err instanceof ApiError ? err.message : "Could not send your reply.");
    }
  }

  return (
    <>
      <p className="crumbs"><Link to="/tickets">← My tickets</Link></p>
      <PageHeader
        title={ticket.subject}
        subtitle={
          <>
            {ticket.reference} · {ticket.book?.title ?? "General / Account"} · Opened {date(ticket.createdAt)}
          </>
        }
        actions={<StatusBadge status={ticket.status} />}
      />

      {justCreated && (
        <div className="notice notice-success">Thanks — your ticket {ticket.reference} has been received. You'll see our reply here as soon as it's sent.</div>
      )}
      <p className="muted status-help">{STATUS_HELP[ticket.status]}</p>

      <Thread entries={entries} />

      {ticket.status === "CLOSED" ? (
        <div className="notice">
          This ticket is closed. <Link to={`/tickets/new${ticket.book ? `?bookId=${ticket.book.id}` : ""}`}>Raise a new ticket</Link> if you need more help.
        </div>
      ) : (
        <form className="card composer" onSubmit={send}>
          <label className="field">
            <span>Reply to BookLeaf</span>
            <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add more detail or answer our question…" />
          </label>
          {replyError && <div className="notice notice-error">{replyError}</div>}
          <div className="form-actions">
            {ticket.status === "RESOLVED" && <span className="muted small">Sending a reply will reopen this ticket.</span>}
            <button className="btn btn-primary" disabled={!body.trim() || reply.isPending}>
              {reply.isPending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
