# Tests shared by the whole repository

| Folder      | What it holds                                                                       |
| ----------- | ----------------------------------------------------------------------------------- |
| `fixtures/` | Small captures of real provider responses, used by source tests and end-to-end runs |
| `e2e/`      | End-to-end journeys with Playwright against the real API and worker                 |

Unit and integration tests live next to each workspace (`apps/*/tests`, `packages/*/tests`,
`tools/tests`).
