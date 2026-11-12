# API client

- `client.ts`: same-origin requests with the session cookie, no HTTP cache and a 10 s limit
  (60 s, `MODEL_TIMEOUT_MS`, for the requests that wait on Sara's AI model). A 2xx body must
  match its schema; anything else becomes an `ApiRequestError`. It speaks GET, POST, PUT and
  DELETE; `answers` names the error statuses whose body is an expected answer, validated the same.
- `errors.ts`: the failure kinds (`network`, `http` with the contract code and request id,
  `contract`, `aborted`).
- `latest.ts`: starting a request cancels the previous one, so an old answer never wins.

Tested in `apps/web/tests/client.test.ts`.
