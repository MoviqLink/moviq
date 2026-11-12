# Control room

The private area for the team (`#/ops`). The server checks every permission; the screens only
reflect them (a viewer sees actions disabled with the reason).

- `OpsApp.tsx`: asks the API for the session and shows the sign-in form, the console or the
  connection notice.
- `api.ts`: the control room endpoints, each answer validated against its contract.
- `useResource.ts`: loads a resource for a screen, refreshes it every 15 s, keeps the last good
  answer with its time and sends a lapsed session back to sign-in.
- `routes.ts`, `session.ts`: addresses of the screens and the open session.
- `model/`: pure rules (age, severity, state looks), `ui/`: pieces the screens share,
  `views/`: the screens. `ops.css` lays them out.

Tested in `apps/web/tests` (`age`, `severity`, `routes`, `ops-api`, `ops-money`).
