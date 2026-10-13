import { Link } from "react-router-dom";
import { useBooks } from "../../api/queries";
import type { Book } from "../../api/types";
import { EmptyState, ErrorNotice, PageHeader, PageLoader, Stat } from "../../components/ui";
import { date, inr } from "../../lib/format";

export function BooksPage() {
  const { data, isLoading, error, refetch } = useBooks();
  if (isLoading) return <PageLoader />;
  if (error || !data) return <ErrorNotice error={error} onRetry={() => void refetch()} />;

  const { summary } = data;
  const { payout } = summary;

  return (
    <>
      <PageHeader
        title="My books"
        subtitle="Sales and royalties across your BookLeaf titles."
        actions={<Link to="/tickets/new" className="btn btn-primary">Ask a question</Link>}
      />

      {data.data.length === 0 ? (
        <EmptyState title="No books yet">Once your manuscript is with us, your book will appear here with its production status.</EmptyState>
      ) : (
        <>
          <div className="stats">
            <Stat label="Copies sold" value={summary.totalCopiesSold.toLocaleString("en-IN")} hint={`${summary.publishedBooks} of ${summary.totalBooks} books published`} />
            <Stat label="Royalty earned" value={inr(summary.totalRoyaltyEarned)} hint="Lifetime, all books" />
            <Stat label="Paid to you" value={inr(summary.royaltyPaid)} />
            <Stat
              label="Pending royalty"
              value={inr(summary.royaltyPending)}
              tone={summary.royaltyPending > 0 && !payout.meetsThreshold ? "warn" : undefined}
              hint={
                summary.royaltyPending === 0
                  ? "Nothing pending"
                  : payout.meetsThreshold
                    ? `Next payout by ${date(payout.nextPayoutBy)}`
                    : `Below the ${inr(payout.threshold)} minimum — rolls over to next quarter`
              }
            />
          </div>

          <p className="callout">
            Royalties are calculated every quarter and paid within 45 days of the quarter ending, by bank transfer to the account
            linked to your dashboard. Balances under {inr(payout.threshold)} roll over to the next quarter.
          </p>

          <div className="book-list">
            {data.data.map((book) => (
              <BookCard key={book.id} book={book} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function BookCard({ book }: { book: Book }) {
  return (
    <article className="card book-card">
      <header className="book-head">
        <div>
          <h2>{book.title}</h2>
          <p className="muted small">
            {book.genre} · ISBN {book.isbn}
            {book.publicationDate && <> · Published {date(book.publicationDate)}</>}
          </p>
        </div>
        <span className={`badge ${book.isPublished ? "book-live" : "book-production"}`}>{book.status}</span>
      </header>

      {book.isPublished ? (
        <>
          <dl className="figures">
            <Figure label="MRP" value={inr(book.mrp)} />
            <Figure label="Copies sold" value={book.totalCopiesSold.toLocaleString("en-IN")} />
            <Figure label="Royalty earned" value={inr(book.totalRoyaltyEarned)} />
            <Figure label="Royalty paid" value={inr(book.royaltyPaid)} />
            <Figure label="Royalty pending" value={inr(book.royaltyPending)} highlight={book.royaltyPending > 0} />
            <Figure label="Last payout" value={book.lastRoyaltyPayoutDate ? date(book.lastRoyaltyPayoutDate) : "Not yet paid"} />
          </dl>
          {book.availableOn.length > 0 && (
            <p className="chips">
              {book.availableOn.map((p) => (
                <span key={p} className="chip">{p}</span>
              ))}
            </p>
          )}
        </>
      ) : (
        <div className="production">
          <div className="production-label">
            <span>
              Step {book.production.step} of {book.production.totalSteps}: <strong>{book.production.currentLabel}</strong>
            </span>
            <span className="muted small">Next: {book.production.remaining.slice(0, 2).join(" → ")}…</span>
          </div>
          <div className="progress" role="progressbar" aria-valuenow={book.production.step} aria-valuemin={1} aria-valuemax={book.production.totalSteps}>
            <span style={{ width: `${(book.production.step / book.production.totalSteps) * 100}%` }} />
          </div>
          <p className="muted small">Sales and royalties will appear here once the book is published and live.</p>
        </div>
      )}

      <footer className="book-foot">
        <Link to={`/tickets/new?bookId=${book.id}`} className="btn btn-ghost btn-sm">
          Ask about this book →
        </Link>
      </footer>
    </article>
  );
}

function Figure({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={highlight ? "figure figure-highlight" : "figure"}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
