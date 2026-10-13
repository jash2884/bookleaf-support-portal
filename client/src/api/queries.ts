import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./http";
import type {
  AdminTicket,
  AdminTicketListItem,
  Agent,
  AiStatus,
  AuthorTicket,
  AuthorTicketListItem,
  BooksResponse,
  DraftResponse,
  Metrics,
  Pagination,
  TicketCategory,
  TicketPriority,
  TicketStatus,
} from "./types";

export const keys = {
  me: ["me"] as const,
  books: ["books"] as const,
  ticketLists: ["tickets"] as const,
  tickets: (params: Record<string, unknown>) => ["tickets", params] as const,
  ticket: (id: string) => ["ticket", id] as const,
  draft: (id: string) => ["draft", id] as const,
  metrics: ["metrics"] as const,
  agents: ["agents"] as const,
  aiStatus: ["ai-status"] as const,
};

function toQuery(params: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    qs.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

// ---------- Books ----------

export const useBooks = () => useQuery({ queryKey: keys.books, queryFn: () => api<BooksResponse>("/books") });

// ---------- Tickets ----------

export interface TicketFilters {
  status?: TicketStatus[];
  priority?: TicketPriority[];
  category?: TicketCategory[];
  assignee?: string;
  from?: string;
  to?: string;
  q?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
}

export function useTicketList<T extends AuthorTicketListItem | AdminTicketListItem>(filters: TicketFilters = {}) {
  return useQuery({
    queryKey: keys.tickets(filters as Record<string, unknown>),
    queryFn: () => api<{ data: T[]; pagination: Pagination }>(`/tickets${toQuery(filters as Record<string, unknown>)}`),
    placeholderData: keepPreviousData, // keep the table steady while filters change
  });
}

export function useTicket<T extends AuthorTicket | AdminTicket>(id: string) {
  return useQuery({ queryKey: keys.ticket(id), queryFn: () => api<{ data: T }>(`/tickets/${id}`).then((r) => r.data) });
}

/** After any ticket write: refresh that ticket and every list that might include it. */
function useInvalidateTicket() {
  const qc = useQueryClient();
  return (id: string) => {
    void qc.invalidateQueries({ queryKey: keys.ticket(id) });
    void qc.invalidateQueries({ queryKey: keys.ticketLists });
    void qc.invalidateQueries({ queryKey: keys.metrics });
  };
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (form: FormData) => api<{ data: AuthorTicket }>("/tickets", { method: "POST", body: form }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.ticketLists }),
  });
}

export function useAddMessage<T extends AuthorTicket | AdminTicket>(ticketId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateTicket();
  return useMutation({
    mutationFn: (body: { body: string; visibility?: "PUBLIC" | "INTERNAL"; draftId?: string; status?: TicketStatus }) =>
      api<{ data: T }>(`/tickets/${ticketId}/messages`, { method: "POST", json: body }).then((r) => r.data),
    onSuccess: (ticket) => {
      qc.setQueryData(keys.ticket(ticketId), ticket);
      invalidate(ticketId);
    },
  });
}

export function useUpdateTicket(ticketId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateTicket();
  return useMutation({
    mutationFn: (patch: Partial<{ status: TicketStatus; category: TicketCategory; priority: TicketPriority; assigneeId: string | null }>) =>
      api<{ data: AdminTicket }>(`/tickets/${ticketId}`, { method: "PATCH", json: patch }).then((r) => r.data),
    onSuccess: (ticket) => {
      qc.setQueryData(keys.ticket(ticketId), ticket);
      invalidate(ticketId);
    },
  });
}

export function useRetriage(ticketId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateTicket();
  return useMutation({
    mutationFn: () => api<{ data: AdminTicket }>(`/tickets/${ticketId}/triage`, { method: "POST" }).then((r) => r.data),
    onSuccess: (ticket) => {
      qc.setQueryData(keys.ticket(ticketId), ticket);
      invalidate(ticketId);
    },
  });
}

// ---------- AI drafts ----------

export function useDraft(ticketId: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.draft(ticketId),
    queryFn: () => api<DraftResponse>(`/tickets/${ticketId}/draft`),
    enabled,
    staleTime: Infinity, // the server decides when a draft is stale; we refetch on realtime events
    retry: false,
  });
}

export function useRegenerateDraft(ticketId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<DraftResponse>(`/tickets/${ticketId}/draft`, { method: "POST" }),
    onSuccess: (res) => qc.setQueryData(keys.draft(ticketId), res),
  });
}

// ---------- Admin ----------

export const useAgents = () => useQuery({ queryKey: keys.agents, queryFn: () => api<{ data: Agent[] }>("/admin/agents").then((r) => r.data), staleTime: 5 * 60_000 });

export const useMetrics = () => useQuery({ queryKey: keys.metrics, queryFn: () => api<{ data: Metrics }>("/admin/metrics").then((r) => r.data) });

export const useAiStatus = () =>
  useQuery({ queryKey: keys.aiStatus, queryFn: () => api<{ data: AiStatus }>("/admin/ai-status").then((r) => r.data), refetchInterval: 60_000 });
