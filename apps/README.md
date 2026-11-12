# Apps

Deployable applications. Each one has its own `package.json` and depends on `packages/` only.

| App           | What it is                                                                                      |
| ------------- | ----------------------------------------------------------------------------------------------- |
| `server`      | The `api` and `worker` processes, one codebase                                                  |
| `web`         | The React web: Sara, the trip and its roadmap, the dashboard, the live map and the control room |
| `recorder-cf` | The 24-hour recorder on Cloudflare (free plan) and its nightly statistics                       |

Main server modules: `assistant`, `journeys`, `payments`, `tickets`, `wallet`, `data-platform`,
`live`, `city-layers`, `identity` and `operations`. Main web features: `agents`, `dashboard`,
`wallet`, `tickets`, `roadmap` (the trip as a Bryntum Gantt timeline), `triplog` (My trips and
Calendar, with sample history), `explore` (the live map), `demo` (Traveller and Business entry) and
`ops` (the control room).
