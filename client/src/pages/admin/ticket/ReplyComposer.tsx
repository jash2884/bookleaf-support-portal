import { useEffect, useState } from "react";
import { ApiError } from "../../../api/http";
import { useAddMessage, useDraft, useRegenerateDraft } from "../../../api/queries";
import type { AdminTicket, Draft, TicketStatus } from "../../../api/types";
import { Spinner } from "../../../components/ui";
import { relative } from "../../../lib/format";

const FALLBACK_REASON: Record<string, string> = {
  disabled: "no API key configured",
  circuit_open: "AI paused after repeated errors",
  rate_limited: "AI rate limit reached",
  timeout: "AI took too long to respond",
  auth_error: "AI credentials rejected",
  api_error: "AI service error",
  refusal: "AI declined this request",
  truncated: "AI response was cut off",
  invalid_output: "AI returned an unusable response",
};

/**
 * Reply editor pre-filled with the AI draft. The admin is always in control:
 * the draft is just the starting text, edits are never overwritten by a newer
 * draft, and the commitments the draft makes are listed as a checklist.
 */
export function ReplyComposer({ ticket }: { ticket: AdminTicket }) {
  const [mode, setMode] = useState<"reply" | "note">("reply");
  const closed = ticket.status === "CLOSED";

  const draftQuery = useDraft(ticket.id, !closed);
  const regenerate = useRegenerateDraft(ticket.id);
  const send = useAddMessage<AdminTicket>(ticket.id);

  const [text, setText] = useState("");
  const [loaded, setLoaded] = useState<Draft | null>(null); // draft currently in the editor
  const [incoming, setIncoming] = useState<Draft | null>(null); // newer draft held back because the admin has edits
  const [afterStatus, setAfterStatus] = useState<TicketStatus | "">("");
  const [done, setDone] = useState<Record<number, boolean>>({});
  const [note, setNote] = useState("");

  const apply = (d: Draft) => {
    setText(d.body);
    setLoaded(d);
    setIncoming(null);
    setDone({});
  };

  const draft = draftQuery.data?.data ?? null;
  useEffect(() => {
    if (!draft || draft.id === loaded?.id) return;
    const untouched = text.trim() === "" || (loaded !== null && text === loaded.body);
    if (untouched) apply(draft);
    else setIncoming(draft);
    // Only react to a *different* draft arriving.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id]);

  async function sendReply() {
    await send.mutateAsync({ body: text.trim(), visibility: "PUBLIC", draftId: loaded?.id, status: afterStatus || undefined });
    setText("");
    setLoaded(null);
    setAfterStatus("");
  }

  async function addNote() {
    await send.mutateAsync({ body: note.trim(), visibility: "INTERNAL" });
    setNote("");
  }

  const generating = draftQuery.isFetching && !loaded;
  const edited = loaded !== null && text !== loaded.body;

  return (
    <section className="card composer composer-admin">
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === "reply"} className={`tab ${mode === "reply" ? "active" : ""}`} onClick={() => setMode("reply")}>
          Reply to author
        </button>
        <button role="tab" aria-selected={mode === "note"} className={`tab ${mode === "note" ? "active" : ""}`} onClick={() => setMode("note")}>
          Internal note
        </button>
      </div>

      {mode === "note" ? (
        <>
          <textarea rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to the BookLeaf team only. Notes also give the AI context for future drafts." />
          <div className="form-actions">
            <button className="btn btn-secondary" disabled={!note.trim() || send.isPending} onClick={() => void addNote()}>
              {send.isPending ? "Saving…" : "Add internal note"}
            </button>
          </div>
        </>
      ) : closed ? (
        <div className="notice">This ticket is closed. Reopen it (status in the sidebar) to reply to the author.</div>
      ) : (
        <>
          <div className="draft-bar">
            {generating ? (
              <Spinner label="Drafting a reply from BookLeaf policy and this author's account…" />
            ) : loaded ? (
              loaded.isFallback ? (
                <span className="draft-meta warn">
                  Template draft — {FALLBACK_REASON[loaded.fallbackReason ?? ""] ?? "AI unavailable"}. Review the details before sending.
                </span>
              ) : (
                <span className="draft-meta">
                  <span className="sparkle" aria-hidden>✦</span> AI draft · {loaded.model} · {relative(loaded.createdAt)}
                  {edited && " · edited"}
                </span>
              )
            ) : draftQuery.data?.status === "not_needed" ? (
              <span className="draft-meta muted">You replied last, so no draft was generated.</span>
            ) : draftQuery.isError ? (
              <span className="draft-meta warn">Couldn't load an AI draft — write your reply below.</span>
            ) : null}
            <span className="draft-actions">
              {edited && (
                <button className="btn btn-ghost btn-sm" onClick={() => loaded && setText(loaded.body)}>
                  Revert to draft
                </button>
              )}
              <button
                className="btn btn-ghost btn-sm"
                disabled={regenerate.isPending || generating}
                onClick={() => regenerate.mutate(undefined, { onSuccess: (res) => res.data && apply(res.data) })}
              >
                {regenerate.isPending ? <Spinner label="Drafting…" /> : loaded ? "Regenerate" : "Draft with AI"}
              </button>
            </span>
          </div>

          {incoming && (
            <div className="notice notice-info">
              A newer draft is available (the author added a message).{" "}
              <button className="link-btn" onClick={() => apply(incoming)}>Replace my text with it</button>
            </div>
          )}

          <textarea
            className="reply-editor"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={generating ? "" : "Write your reply to the author…"}
            aria-label="Reply to author"
          />

          {loaded && loaded.internalActions.length > 0 && (
            <div className="commitments">
              <div className="small"><strong>This reply commits the team to:</strong></div>
              <ul>
                {loaded.internalActions.map((a, i) => (
                  <li key={i}>
                    <label>
                      <input type="checkbox" checked={Boolean(done[i])} onChange={(e) => setDone({ ...done, [i]: e.target.checked })} /> {a}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="form-actions">
            <label className="inline-field small">
              After sending:
              <select value={afterStatus} onChange={(e) => setAfterStatus(e.target.value as TicketStatus | "")}>
                <option value="">{ticket.status === "OPEN" ? "Move to In progress" : "Keep current status"}</option>
                <option value="RESOLVED">Mark resolved</option>
                <option value="IN_PROGRESS">Mark in progress</option>
                <option value="CLOSED">Close ticket</option>
              </select>
            </label>
            <button className="btn btn-primary" disabled={!text.trim() || send.isPending} onClick={() => void sendReply()}>
              {send.isPending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </>
      )}

      {(send.error || regenerate.error) && (
        <div className="notice notice-error">{((send.error ?? regenerate.error) as ApiError).message ?? "Something went wrong"}</div>
      )}
    </section>
  );
}
