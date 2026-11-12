# @moviq/web

The MovIQ web app, built with React and Vite. `#/` opens planning with Sara, `#/trip/<id>` a trip
watched live on a MapLibre map with its alternatives and PayPal, and `#/ops` the control room: a
private area where the team sees every data source, the product features they feed, the job
queue, the worker's lease and the log of sensitive actions. AG Grid Community draws the
data-dense tables.

| Path                    | What it holds                                           |
| ----------------------- | ------------------------------------------------------- |
| `src/app`               | Start-up, routing by address and the error boundary     |
| `src/features/plan`     | Planning with Sara (`#/`, `#/plan`)                     |
| `src/features/trip`     | The trip watched live, with PayPal (`#/trip/<id>`)      |
| `src/features/ops`      | The control room                                        |
| `src/features/merchant` | The demo merchants' panel (`#/merchant`)                |
| `src/shared`            | API client, i18n, theme, time, routing, styles and UI   |
| `public`                | Static files served as they are                         |
| `tests`                 | Unit tests and the API fixtures they and the review use |

## Rules

- The web never calls a data provider: everything goes through our API, on the same origin, with
  the session cookie. Every answer is validated against `@moviq/contracts` before it is shown.
- The operations token is sent once to open a session and is never stored in the browser.
- English and Spanish carry the same keys; light, dark and automatic themes share one set of tokens.
- Nothing moves in a loop: ages and countdowns change their numbers once a second, nothing else.

## Scripts

```sh
npm run dev -w @moviq/web        # http://127.0.0.1:5190, /api proxied to http://127.0.0.1:8080
npm run build -w @moviq/web      # type check, then dist/
npm run typecheck -w @moviq/web
npx vitest run apps/web/tests    # from the repository root
```
