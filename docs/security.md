# Security

## Credentials

- Credentials come only from the environment. `.env` is ignored by git, and the delivery check
  (`npm run check:delivery`) fails if any environment file other than `.env.example` is tracked,
  or if `.env.example` holds a credential with a value.
- Every credential is wrapped in a `Secret` as soon as it is read. Printing, logging or
  serialising a `Secret` shows `[redacted]`; code calls `reveal()` only where the value is used.
- The logger redacts any field whose name looks sensitive (`…token`, `…key`, `secret`,
  `password`, `authorization`, `cookie`, `credential`), at any depth.
- The logger also receives every credential in the configuration and removes their values from
  any text it writes, error messages and stacks included. Credentials with a recognisable shape
  (passwords in URLs, sensitive query parameters, `Authorization` values, long `Bearer` tokens,
  OpenAI keys) are removed even when the logger was not told about them.
- Errors from providers are stored and shown to operators only after the same sanitising, cut to
  500 characters; an unexpected failure is stored as a plain sentence, its details only in the
  worker log.
- Configuration errors name the variable and the rule, never the value.

## Control room access

- Operations tokens are compared in constant time and exchanged for a session; the session id
  lives only in an `HttpOnly`, `SameSite=Strict` cookie, and only its SHA-256 is stored.
- Read-only access (`OPS_VIEWER_TOKEN`) cannot change anything; actions need `ADMIN_TOKEN`.
- Actions are refused when the request comes from another origin, and need a reason that is
  recorded with the actor in the audit log.
- Sign-in attempts are limited to ten a minute.

## Fail closed

Unsafe combinations stop the process before it opens its port (see
[operations](operations.md#configuration)): live payments need production, an operations token
and PayPal credentials, and can never run with the public demo.

## Requests

- Request bodies over 64 KiB are refused with `413 too_large` before they are read, streamed
  bodies included.
- Each request carries a request id, echoed in `x-request-id` and in every error body, so a
  report can be traced without exposing internals.
- Unexpected errors are logged in full and answered with a stable, plain message.
- Query strings are not logged, because they may carry personal data.

## What leaves for providers

- Sara uses the OpenAI API with data sharing turned on: OpenAI may use what is sent to train its
  models. Only the words needed to understand the trip are sent, with emails, phone numbers,
  booking references, seats, names, card or ticket numbers, coordinates and identifiers removed
  first; a message that still looks personal is not sent (see the
  [assistant](../apps/server/src/modules/assistant/README.md)).
- PayPal receives the amount and an opaque payment id, never the journey or the traveller. The
  buyer's name and email in PayPal's answers are discarded, never stored.
- Every provider request uses a generic browser identity, with nothing about the project or the
  people using it.

## Repository hygiene

The delivery check also refuses absolute paths of a machine, unfinished-work markers and known
secret formats (private keys, OpenAI and AWS keys) in any delivered file.

## Merchant demo access

`MERCHANT_ACCESS_TOKEN` is a private, randomly generated key (32 to 256 characters) for the
shared demo merchant panel. An unset key disables sign-in with HTTP 503. A missing or incorrect
key gives HTTP 401 and creates no session. The key is never embedded in the web build or saved
in browser storage; it is entered on the sign-in screen and sent only in the request body.

Successful sign-in issues an HttpOnly, SameSite=Strict cookie (Secure in production). The database
stores a hash of that cookie and a hash binding it to the current credential. Migration 0014
leaves old, unprotected sessions unbound; they cannot be reused. Rotating or removing the key
invalidates all existing merchant sessions. The configuration includes the key in log redaction.
This key authorizes the demonstration merchants collectively; real independent merchant accounts
require individual authentication and are outside this demo's access model.

## Request protection

Browser mutations require the exact request origin, or `PUBLIC_ORIGIN` when deployed behind TLS
termination. Cross-site Fetch Metadata is refused even without Origin. Non-browser API clients
may omit Origin and still need their normal authorization. PayPal callbacks use signature
verification instead of browser-origin checks. An origin check is not an authentication method.

The API applies fixed 60-second request windows before parsing bodies or invoking providers:

| Scope                                                                  | Requests per minute |
| ---------------------------------------------------------------------- | ------------------- |
| Entire API process                                                     | 6,000               |
| Transport peer                                                         | 1,200               |
| Mutations per peer, excluding PayPal callbacks                         | 120                 |
| Sign-in attempts per peer, across both panels                          | 10                  |
| AI, planning and offer requests per peer                               | 60                  |
| Those expensive requests per device session (or peer without a cookie) | 12                  |

A refusal returns HTTP 429, `rate_limited` and `Retry-After` in seconds. Changing a cookie cannot
bypass the peer budget. The peer comes from the Node connection, never an untrusted forwarding
header. Addresses and cookie values are hashed; maps hold at most 10,000 keys each, expire in
insertion order, and never evict an active entry to grant another allowance. No database writes
or background timer are needed for these limits.

These are per-process guards, reset on restart. Behind a proxy, users share that proxy's peer
budget; production must retain an edge limit for real client addresses, and multiple replicas
need a shared edge budget. The database-backed daily AI token budget remains an additional guard.
