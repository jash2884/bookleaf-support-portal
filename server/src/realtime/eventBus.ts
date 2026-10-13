import { EventEmitter } from "node:events";

/**
 * In-process pub/sub for ticket changes, fanned out to browsers over SSE.
 *
 * Events are deliberately thin — "ticket X changed" — and never carry ticket
 * data. Clients refetch through the REST API, which applies the same role-based
 * serialisation as every other request, so the realtime channel can't leak
 * internal notes or AI metadata to authors.
 *
 * Scaling note: with more than one server instance this becomes Postgres
 * LISTEN/NOTIFY or Redis pub/sub behind the same publish/subscribe interface.
 */
export type TicketEventType = "ticket.created" | "ticket.updated" | "ticket.message" | "ticket.draft";

export interface TicketEvent {
  type: TicketEventType;
  ticketId: string;
  /** Owning author's id: authors only receive events for their own tickets. */
  authorId: string;
  /** "admins" = internal change (triage, internal note, draft) the author must not be notified about. */
  audience: "everyone" | "admins";
}

class TicketEventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(0); // one listener per open SSE connection
  }

  publish(event: TicketEvent) {
    this.emitter.emit("ticket", event);
  }

  subscribe(listener: (event: TicketEvent) => void): () => void {
    this.emitter.on("ticket", listener);
    return () => this.emitter.off("ticket", listener);
  }
}

export const ticketEvents = new TicketEventBus();
