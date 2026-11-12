import type { Secret } from '../../config/secret.js';

export const REDACTED = '[redacted]';

/** Credentials recognisable by their shape, removed even when nobody said they were secret. */
const SECRET_SHAPES: readonly (readonly [RegExp, string])[] = [
  [/(\bauthorization["']?\s*[:=]\s*["']?)(?:(?:Bearer|Basic)\s+)?[^\s"',;]+/gi, `$1${REDACTED}`],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g, `Bearer ${REDACTED}`],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
  [
    /([?&][a-z0-9_-]*(?:token|key|secret|password|signature|sig|auth)[a-z0-9_-]*=)[^&\s#"']+/gi,
    `$1${REDACTED}`,
  ],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, REDACTED],
];

/** Known values shorter than this are not credentials, and removing them would garble text. */
const MIN_SECRET_LENGTH = 8;

/**
 * Removes the values of the credentials in use, and credentials with a recognisable shape, from
 * any text. Used for logs and for every provider message stored or served.
 */
export function createTextSanitizer(secrets: readonly Secret[]): (text: string) => string {
  const known = secrets
    .map((secret) => secret.reveal())
    .filter((value) => value.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  return (text) => {
    let clean = text;
    for (const value of known) clean = clean.replaceAll(value, REDACTED);
    for (const [shape, replacement] of SECRET_SHAPES) clean = clean.replace(shape, replacement);
    return clean;
  };
}
