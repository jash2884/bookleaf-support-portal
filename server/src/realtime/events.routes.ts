import { Router } from "express";
import { currentUser } from "../http/auth.js";
import { ticketEvents } from "./eventBus.js";

export const eventsRouter = Router();

/**
 * GET /events — Server-Sent Events stream of ticket changes.
 *
 * SSE over WebSockets: updates only flow server → browser, it's plain HTTP
 * (works through proxies, uses the session cookie for auth) and EventSource
 * reconnects automatically. Each event is just `{ type, ticketId }`; the client
 * refetches the affected queries through the normal, access-controlled API.
 */
eventsRouter.get("/", (req, res) => {
  const user = currentUser(req);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no", // disable proxy buffering (nginx / Render)
  });
  res.write("retry: 5000\n\n");
  res.write("event: ready\ndata: {}\n\n");

  const unsubscribe = ticketEvents.subscribe((event) => {
    if (user.role === "AUTHOR" && (event.audience !== "everyone" || event.authorId !== user.authorId)) return;
    res.write(`event: ticket\ndata: ${JSON.stringify({ type: event.type, ticketId: event.ticketId })}\n\n`);
  });

  // Comment line every 25s keeps idle connections alive through load balancers.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
