# Identity

`ops-sessions.ts`: access to the control room. An operations token (`ADMIN_TOKEN` for full
access, `OPS_VIEWER_TOKEN` for read-only access) is compared in constant time and exchanged for
a session. Only a hash of the session id is stored, so a copy of the database cannot be used to
sign in. Sessions last 12 hours.

Tested through the API in `tests/ops-api.test.ts`.

`traveller-sessions.ts`: travellers start as an anonymous device session; nothing personal is
stored. `readTraveller` only reads it; `ensureTraveller` creates one on the first request that
creates something (a plan, a journey, a payment), so plain visits leave nothing behind. The cookie
is `HttpOnly` and `SameSite=Lax`, lasts 30 days, and only its hash is stored. Tested in
`tests/traveller-sessions.test.ts`.
