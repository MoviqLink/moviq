# Telemetry

`logger.ts` writes one JSON object per line: time in UTC, level, message and fields. Errors are
expanded with their code and cause, and cycles cannot break a log line. Secrets are kept out
three ways:

- fields with sensitive names are redacted at any depth (a lease's `fencingToken` is a counter
  and stays visible);
- the values of the credentials in use, passed as `secrets`, are removed from every text,
  error messages and stacks included;
- credentials with a recognisable shape are removed even when unknown: passwords in URLs,
  sensitive query parameters, `Authorization` values, long `Bearer` tokens and OpenAI keys.

Fields cannot replace `time`, `level` or `msg` (they are kept as `field.level` and so on), an
object that appears twice is written twice, and only an object that contains itself is marked
`[circular]`.

Tested in `tests/logger.test.ts`.
