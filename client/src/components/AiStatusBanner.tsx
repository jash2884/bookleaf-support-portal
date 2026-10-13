import { useAiStatus } from "../api/queries";

/** Tells admins when AI features are running on fallbacks, so they know to double-check. */
export function AiStatusBanner() {
  const { data } = useAiStatus();
  if (!data || data.mode === "online") return null;
  return (
    <div className="notice notice-warn" role="status">
      {data.mode === "offline" ? (
        <>
          <strong>AI assistance is off.</strong> No API key is configured, so tickets are classified by keyword rules and replies start from
          policy templates. Everything else works normally.
        </>
      ) : (
        <>
          <strong>AI is temporarily unavailable.</strong> Recent calls failed, so new tickets use rule-based triage and template drafts.
          It will retry automatically in about a minute.
        </>
      )}
    </div>
  );
}
