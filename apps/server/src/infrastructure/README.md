# Infrastructure

Technical building blocks with no product knowledge. Modules depend on these, never the other
way round.

| Folder       | Provides                                                        |
| ------------ | --------------------------------------------------------------- |
| `clock/`     | The injectable source of "now", and pauses that stop on signal  |
| `database/`  | The SQL gateway, migrations and row validation                  |
| `http/`      | Request context, request logging and the shared error responses |
| `jobs/`      | The lease and the leader terms that keep work to one worker     |
| `telemetry/` | Structured logging                                              |
