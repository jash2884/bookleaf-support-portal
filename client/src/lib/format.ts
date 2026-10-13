import type { TicketCategory, TicketPriority, TicketStatus } from "../api/types";

export const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function relative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return date(iso);
}

export const age = (hours: number) => (hours < 1 ? "<1h" : hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`);

export const STATUS_LABEL: Record<TicketStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
};

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  ROYALTY_PAYMENTS: "Royalty & Payments",
  ISBN_METADATA: "ISBN & Metadata",
  PRINTING_QUALITY: "Printing & Quality",
  DISTRIBUTION_AVAILABILITY: "Distribution & Availability",
  BOOK_STATUS_PRODUCTION: "Book Status & Production",
  GENERAL_INQUIRY: "General Inquiry",
};

export const fileSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
