import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/http";
import { useBooks, useCreateTicket } from "../../api/queries";
import { PageHeader } from "../../components/ui";
import { date, fileSize, inr } from "../../lib/format";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function NewTicketPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const books = useBooks();
  const create = useCreateTicket();

  const [bookId, setBookId] = useState(params.get("bookId") ?? "general");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const selected = books.data?.data.find((b) => b.id === bookId);

  function validate() {
    const e: Record<string, string> = {};
    if (subject.trim().length < 5) e.subject = "Subject must be at least 5 characters";
    if (description.trim().length < 20) e.description = "Please describe the issue in at least 20 characters";
    if (file && file.size > MAX_FILE_BYTES) e.attachment = "Attachment must be 5 MB or smaller";
    if (file && !ACCEPTED.includes(file.type)) e.attachment = "Attachments must be JPG, PNG, WEBP or PDF";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const form = new FormData();
    if (bookId !== "general") form.set("bookId", bookId);
    form.set("subject", subject.trim());
    form.set("description", description.trim());
    if (file) form.set("attachment", file);
    try {
      const ticket = await create.mutateAsync(form);
      navigate(`/tickets/${ticket.id}`, { state: { created: true } });
    } catch (err) {
      if (err instanceof ApiError) setErrors({ ...err.fieldErrors(), form: err.message });
      else setErrors({ form: "Could not submit your ticket. Please try again." });
    }
  }

  return (
    <>
      <PageHeader title="Get help" subtitle="Tell us what's going on and the BookLeaf team will get back to you here." />

      <div className="two-col">
        <form className="card form" onSubmit={submit} noValidate>
          <label className="field">
            <span>Which book is this about?</span>
            <select value={bookId} onChange={(e) => setBookId(e.target.value)} disabled={books.isLoading}>
              <option value="general">General / Account level</option>
              {books.data?.data.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title} {b.isPublished ? "" : "(in production)"}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Subject</span>
            <input
              value={subject}
              maxLength={150}
              placeholder="e.g. Royalty for last quarter not received"
              onChange={(e) => setSubject(e.target.value)}
              aria-invalid={Boolean(errors.subject)}
            />
            {errors.subject && <small className="field-error">{errors.subject}</small>}
          </label>

          <label className="field">
            <span>Describe the issue</span>
            <textarea
              rows={8}
              value={description}
              maxLength={5000}
              placeholder="Include what you expected, what happened, and any dates or amounts involved."
              onChange={(e) => setDescription(e.target.value)}
              aria-invalid={Boolean(errors.description)}
            />
            <small className="field-hint">{description.length} / 5000</small>
            {errors.description && <small className="field-error">{errors.description}</small>}
          </label>

          <label className="field">
            <span>
              Attachment <span className="muted">(optional)</span>
            </span>
            <input type="file" accept={ACCEPTED.join(",")} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <small className="field-hint">
              {file ? `${file.name} · ${fileSize(file.size)}` : "Screenshots or photos help — e.g. a misprinted page. JPG, PNG, WEBP or PDF up to 5 MB."}
            </small>
            {errors.attachment && <small className="field-error">{errors.attachment}</small>}
          </label>

          {errors.form && <div className="notice notice-error" role="alert">{errors.form}</div>}

          <div className="form-actions">
            <Link to="/tickets" className="btn btn-ghost">Cancel</Link>
            <button className="btn btn-primary" disabled={create.isPending}>
              {create.isPending ? "Submitting…" : "Submit ticket"}
            </button>
          </div>
        </form>

        <aside className="side">
          {selected && (
            <div className="card side-card">
              <h3>{selected.title}</h3>
              <p className="muted small">{selected.status}</p>
              {selected.isPublished ? (
                <dl className="mini-figures">
                  <div><dt>Copies sold</dt><dd>{selected.totalCopiesSold}</dd></div>
                  <div><dt>Royalty pending</dt><dd>{inr(selected.royaltyPending)}</dd></div>
                  <div><dt>Last payout</dt><dd>{selected.lastRoyaltyPayoutDate ? date(selected.lastRoyaltyPayoutDate) : "Not yet paid"}</dd></div>
                </dl>
              ) : (
                <p className="small">Currently in <strong>{selected.production.currentLabel}</strong> (step {selected.production.step} of {selected.production.totalSteps}).</p>
              )}
            </div>
          )}
          <div className="card side-card">
            <h3>What happens next</h3>
            <ol className="steps small">
              <li>Your ticket goes straight to the BookLeaf support team.</li>
              <li>Urgent issues such as missing royalties or ISBN errors are prioritised automatically.</li>
              <li>Our reply appears on the ticket the moment it's sent.</li>
            </ol>
          </div>
        </aside>
      </div>
    </>
  );
}
