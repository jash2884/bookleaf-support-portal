/**
 * Author-written text is untrusted. We wrap it in XML-style tags and escape
 * angle brackets so a ticket can't close our tags and smuggle in instructions.
 */
export function escapeForPrompt(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Keep long messages from dominating the context window (and the bill). */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}… [truncated ${text.length - maxChars} chars]`;
}

export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
