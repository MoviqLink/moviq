# HTTP plumbing

- `context.ts`: gives every request an id and a logger bound to it, and logs one line when it
  ends (path only, never the query string).
- `errors.ts`: the not-found and unexpected-error responses, both in the shared error body of
  `@moviq/contracts`.

Tested in `tests/health.test.ts`.

- `origin.ts`: one exact-origin predicate for browser mutations and operations sessions.
- `window-limit.ts`: bounded, expiring request windows; refuses new keys at capacity.
- `rate-limit.ts`: API, peer, session and sensitive-action budgets with HTTP 429 and Retry-After.

The transport supplies peer addresses. Forwarded headers are not trusted. See
`docs/security.md` for limits and proxy/multiple-replica behavior. Regressions are in
`tests/http-protection.test.ts` and `tests/commerce/merchant-auth.test.ts`.

- `map-diagnostics.ts`: accepts bounded browser map failure categories, redacts URLs from
  diagnostic messages, and logs no request bodies or cookies. Regressions are in
  `tests/map-diagnostics.test.ts`; global origin, rate and body limits also apply.
