import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keys } from "../api/queries";

type ConnectionState = "connecting" | "live" | "offline";

/**
 * Subscribes to /api/events (Server-Sent Events) and turns each "ticket X
 * changed" notification into React Query invalidations, so whichever screens
 * show that ticket refetch it through the normal API. EventSource reconnects
 * on its own; on reconnect we refresh everything in case we missed events.
 */
export function useTicketEvents(enabled: boolean): ConnectionState {
  const qc = useQueryClient();
  const [state, setState] = useState<ConnectionState>("connecting");

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events");
    let hasConnected = false;

    source.addEventListener("ready", () => {
      setState("live");
      if (hasConnected) {
        void qc.invalidateQueries({ queryKey: keys.ticketLists });
        void qc.invalidateQueries({ queryKey: ["ticket"] });
      }
      hasConnected = true;
    });

    source.addEventListener("ticket", (e) => {
      const { type, ticketId } = JSON.parse((e as MessageEvent<string>).data) as { type: string; ticketId: string };
      void qc.invalidateQueries({ queryKey: keys.ticketLists });
      void qc.invalidateQueries({ queryKey: keys.ticket(ticketId) });
      void qc.invalidateQueries({ queryKey: keys.metrics });
      // A new author message makes the cached draft stale; a new draft should be shown.
      if (type === "ticket.message" || type === "ticket.draft") void qc.invalidateQueries({ queryKey: keys.draft(ticketId) });
    });

    source.onerror = () => setState(source.readyState === EventSource.CLOSED ? "offline" : "connecting");

    return () => source.close();
  }, [enabled, qc]);

  return enabled ? state : "offline";
}
