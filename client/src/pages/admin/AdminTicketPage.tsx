import { Link, useParams } from "react-router-dom";
import { useTicket } from "../../api/queries";
import type { AdminTicket } from "../../api/types";
import { AiStatusBanner } from "../../components/AiStatusBanner";
import { ErrorNotice, PageHeader, PageLoader, PriorityBadge, StatusBadge } from "../../components/ui";
import { Thread, type ThreadEntry } from "../../components/Thread";
import { dateTime } from "../../lib/format";
import { TriageCard } from "./ticket/TriageCard";
import { ReplyComposer } from "./ticket/ReplyComposer";
import { TicketSidebar } from "./ticket/TicketSidebar";

const ORIGIN_LABEL = { AI_DRAFT_UNEDITED: "AI draft · sent as-is", AI_DRAFT_EDITED: "AI draft · edited", MANUAL: null } as const;

export function AdminTicketPage() {
  const { ticketId = "" } = useParams();
  const { data: ticket, isLoading, error, refetch } = useTicket<AdminTicket>(ticketId);

  if (isLoading) return <PageLoader />;
  if (error || !ticket) return <ErrorNotice error={error} onRetry={() => void refetch()} />;

  const entries: ThreadEntry[] = [
    {
      id: "original",
      kind: "author",
      senderName: ticket.author.name,
      body: ticket.description,
      createdAt: ticket.createdAt,
      attachments: ticket.attachments,
    },
    ...ticket.messages.map((m): ThreadEntry => {
      const origin = ORIGIN_LABEL[m.origin];
      return {
        id: m.id,
        kind: m.visibility === "INTERNAL" ? "internal" : m.sender.role === "ADMIN" ? "bookleaf" : "author",
        senderName: m.sender.role === "ADMIN" ? `${m.sender.name} · BookLeaf` : m.sender.name,
        body: m.body,
        createdAt: m.createdAt,
        meta: origin ? <span className="origin-tag">{origin}</span> : undefined,
      };
    }),
  ];

  return (
    <>
      <p className="crumbs"><Link to="/admin/tickets">← Ticket queue</Link></p>
      <PageHeader
        title={ticket.subject}
        subtitle={
          <>
            {ticket.reference} · {ticket.author.name} · {ticket.book?.title ?? "General / Account"} · Opened {dateTime(ticket.createdAt)}
          </>
        }
        actions={
          <>
            <PriorityBadge priority={ticket.priority} source={ticket.prioritySource} />
            <StatusBadge status={ticket.status} />
            {ticket.slaBreached && <span className="overdue">Response overdue</span>}
          </>
        }
      />
      <AiStatusBanner />

      <div className="workspace">
        <div className="workspace-main">
          <TriageCard ticket={ticket} />
          <section aria-label="Conversation">
            <h2 className="section-title">Conversation</h2>
            <Thread entries={entries} />
          </section>
          <ReplyComposer ticket={ticket} />
        </div>
        <TicketSidebar ticket={ticket} />
      </div>
    </>
  );
}
