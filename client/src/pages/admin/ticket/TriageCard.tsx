import { ApiError } from "../../../api/http";
import { useRetriage, useUpdateTicket } from "../../../api/queries";
import type { AdminTicket, TicketCategory, TicketPriority } from "../../../api/types";
import { SourceTag, Spinner } from "../../../components/ui";
import { CATEGORY_LABEL, PRIORITY_LABEL } from "../../../lib/format";

/**
 * Shows the AI's classification next to the effective values and lets the
 * admin override either one. Overrides are recorded (and kept separate from
 * the AI's answer) so override rate can be tracked as a quality signal.
 */
export function TriageCard({ ticket }: { ticket: AdminTicket }) {
  const update = useUpdateTicket(ticket.id);
  const retriage = useRetriage(ticket.id);
  const { triage } = ticket;
  const pending = triage.state === "PENDING";
  const error = update.error ?? retriage.error;

  return (
    <section className="card triage">
      <div className="triage-head">
        <h2>
          <span className="sparkle" aria-hidden>✦</span> Triage
        </h2>
        {triage.state === "AI" && <span className="muted small">Classified by AI{triage.confidence !== null && ` · ${Math.round(triage.confidence * 100)}% confident`}</span>}
        {triage.state === "FALLBACK" && <span className="muted small">AI was unavailable — classified by keyword rules</span>}
        <button className="btn btn-ghost btn-sm" onClick={() => retriage.mutate()} disabled={retriage.isPending || pending}>
          {retriage.isPending ? <Spinner label="Re-running…" /> : "Re-run AI triage"}
        </button>
      </div>

      {pending ? (
        <Spinner label="Classifying this ticket…" />
      ) : (
        <>
          {triage.summary && triage.summary !== ticket.subject && <p className="triage-summary">{triage.summary}</p>}
          <div className="triage-grid">
            <label className="field">
              <span>
                Category <SourceTag source={ticket.categorySource} />
              </span>
              <select
                value={ticket.category ?? ""}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ category: e.target.value as TicketCategory })}
              >
                {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                    {value === triage.category && ticket.categorySource === "ADMIN" ? " (AI suggestion)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>
                Priority <SourceTag source={ticket.prioritySource} />
              </span>
              <select
                value={ticket.priority ?? ""}
                disabled={update.isPending}
                onChange={(e) => update.mutate({ priority: e.target.value as TicketPriority })}
              >
                {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                    {p === triage.priority && ticket.prioritySource === "ADMIN" ? " (AI suggestion)" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {triage.rationale && <p className="muted small rationale">Why: {triage.rationale}</p>}
        </>
      )}
      {error && <div className="notice notice-error">{error instanceof ApiError ? error.message : "Update failed"}</div>}
    </section>
  );
}
