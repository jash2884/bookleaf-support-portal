import type { ReactNode } from "react";
import type { Attachment } from "../api/types";
import { dateTime, fileSize, relative } from "../lib/format";

export interface ThreadEntry {
  id: string;
  kind: "author" | "bookleaf" | "internal";
  senderName: string;
  body: string;
  createdAt: string;
  meta?: ReactNode;
  attachments?: Attachment[];
}

/** One conversation timeline for both portals. Internal notes only ever reach it from the admin view. */
export function Thread({ entries }: { entries: ThreadEntry[] }) {
  return (
    <ol className="thread">
      {entries.map((e) => (
        <li key={e.id} className={`message message-${e.kind}`}>
          <div className="message-head">
            <span className="avatar" aria-hidden>
              {e.kind === "author" ? e.senderName.charAt(0) : e.kind === "internal" ? "🔒" : "B"}
            </span>
            <strong>{e.senderName}</strong>
            {e.kind === "internal" && <span className="internal-tag">Internal note · not visible to author</span>}
            {e.meta}
            <time dateTime={e.createdAt} title={dateTime(e.createdAt)}>
              {relative(e.createdAt)}
            </time>
          </div>
          <div className="message-body">{e.body}</div>
          {e.attachments && e.attachments.length > 0 && (
            <ul className="attachments">
              {e.attachments.map((a) => (
                <li key={a.id}>
                  <a href={a.url} download>
                    📎 {a.fileName}
                  </a>{" "}
                  <span className="muted small">{fileSize(a.sizeBytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
