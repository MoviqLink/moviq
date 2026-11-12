/** Longest error line the control room shows; PayPal's own lines are far shorter. */
const MAX_LENGTH = 240;

const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  // Credentials: an Authorization value, or a secret written as a key and its value.
  [/\b(?:bearer|basic)\s+[\w.~+/=-]+/gi, '[secret]'],
  [
    /\b(client_secret|access_token|refresh_token|password|secret|token|api_key)\b\s*[=:]\s*\S+/gi,
    '$1=[secret]',
  ],
  // Email addresses: a payer's or a merchant's.
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  // Card numbers: 13 to 19 digits, with or without spaces or dashes between groups.
  [/\b\d(?:[ -]?\d){12,18}\b/g, '[card]'],
];

/**
 * A ledger's error line made safe to show: no card numbers, email addresses or secrets, on one
 * line and of bounded length. PayPal's operation, outcome, HTTP status, issue and debug id stay.
 */
export function safeDetail(detail: string | null): string | null {
  if (detail === null) return null;
  let safe = detail.replace(/\s+/g, ' ').trim();
  for (const [pattern, replacement] of REDACTIONS) safe = safe.replace(pattern, replacement);
  if (safe === '') return null;
  return safe.length > MAX_LENGTH ? `${safe.slice(0, MAX_LENGTH - 1)}…` : safe;
}
