# Write-up: approach, trade-offs, path to production

**The problem:** BookLeaf's author queries are handled manually and slowly. The goal was a portal where authors can self-serve and raise tickets, and where the ops team can answer faster and more consistently with AI doing the first pass.

## What I prioritised

1. **A ticket loop that never depends on the AI.** Authors can raise a ticket, admins can reply, and the author sees the reply live. Triage runs in the background after the ticket is saved. Drafts are suggestions in an editor. Every AI path has a deterministic fallback (rule-based triage, policy templates filled with real account data), and a circuit breaker stops a provider outage from slowing down every request.
2. **Grounded AI output.** The most damaging thing a support draft can do is state a wrong payout date or amount. So payout dates, the ₹1,000 rollover and "payout cycles missed" are computed in code and unit-tested, then passed to the model as facts. The prompts load only the knowledge-base sections relevant to the ticket's category, BookLeaf's own sample responses calibrate tone, and output is schema-validated. Each draft also lists the commitments it makes ("trigger stock re-sync"), so promises in an email turn into tasks.
3. **Access control by construction.** Authors' queries are scoped to their own records (other authors' resources return 404). Author responses are built from an allow-list. The realtime stream carries only "ticket X changed" and data is re-fetched through the same API, so internal notes and AI metadata have no path to an author.
4. **Things an ops team actually needs:** urgency-then-age ordering, an "overdue" flag per priority, "waiting on BookLeaf / author", assign-to-me, send-and-resolve in one step, the author's full royalty picture next to the ticket, and a page showing whether the AI is earning its cost (spend, fallbacks, override rate, draft adoption).

## Trade-offs I made

- **Modular monolith with an in-process event bus**, not services and a message broker. It's one deployable and one origin (so no CORS, and the auth cookie also covers SSE). The bus and the triage sweeper sit behind small interfaces that map onto Postgres `LISTEN/NOTIFY` or a job queue when the app runs on more than one instance.
- **Category → KB-section retrieval instead of embeddings.** The KB is about 1.5k tokens and lines up with the six categories, so vector search would add infrastructure without improving recall. The retrieval function is the single place to change when the KB grows.
- **Lazy, cached drafts rather than generating one for every ticket.** This saves tokens on tickets nobody opens and when BookLeaf spoke last. The cost is a few seconds' wait the first time an admin opens a ticket. Pre-generating drafts for Critical tickets would be a cheap improvement.
- **Opus 5.5 (low effort) for drafts, Haiku 5.5 for triage.** I spent where the text reaches authors. Both are configurable, and the override-rate and draft-adoption metrics are there to justify moving drafts to Haiku if quality holds.
- **Scope cuts:** attachments go to local disk, there are no email notifications, single-token JWT sessions, and fixed response-time targets.

## Taking it to production

- **Measure before tuning:** build a labelled evaluation set from historical tickets (category and priority accuracy, LLM-as-judge plus agent ratings for drafts), version the prompts, and use agents' edits to drafts as a feedback signal.
- **Better facts:** connect a per-platform, per-quarter royalty ledger and the production tracker so drafts can cite line items and real stage dates. Add finance and production escalation workflows behind `internal_actions`.
- **Reliability and scale:** a durable job queue for triage, pub/sub for SSE fan-out across instances, object storage for attachments, OpenTelemetry tracing, and daily AI cost budgets with alerts.
- **Communication:** email and WhatsApp notifications, SLA breach alerts, CSAT after resolution, and self-serve answers surfaced *before* a ticket is filed, which deflects the most common royalty and status questions.
- **Security and privacy:** SSO for staff, audit logs, and continued data minimization. Prompts already exclude author email and phone numbers. Retention policies for tickets and AI logs.
