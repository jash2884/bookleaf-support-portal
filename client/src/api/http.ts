/** Error shape returned by the API: { error: { code, message, details? } } */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }

  /** Field-level messages keyed by field name (e.g. "subject"), for inline form errors. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const d of this.details ?? []) {
      const field = d.path.split(".").slice(1).join(".");
      if (field && !out[field]) out[field] = d.message;
    }
    return out;
  }
}

type RequestOptions = Omit<RequestInit, "body"> & { json?: unknown; body?: BodyInit };

/**
 * Thin fetch wrapper. Auth rides on the httpOnly session cookie, so no token is
 * ever stored in JS-accessible storage.
 */
export async function api<T>(path: string, { json, headers, ...init }: RequestOptions = {}): Promise<T> {
  const h = new Headers(headers);
  let body = init.body;
  if (json !== undefined) {
    h.set("Content-Type", "application/json");
    body = JSON.stringify(json);
  }

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers: h, body, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Can't reach the server. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code ?? "HTTP_ERROR",
      data?.error?.message ?? `Request failed (${res.status})`,
      data?.error?.details,
    );
  }
  return data as T;
}
