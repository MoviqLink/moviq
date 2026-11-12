# Architecture decisions

One decision per file, numbered in the order they were taken. A decision is never edited to say
something else: a new one replaces it.

| ADR                                            | Decision                                                 |
| ---------------------------------------------- | -------------------------------------------------------- |
| [0001](0001-one-sql-client.md)                 | One SQL client, libSQL, for local and remote             |
| [0002](0002-two-processes-and-a-lease.md)      | `api` and `worker` share one codebase and a lease        |
| [0003](0003-credentials-never-block.md)        | Credentials never block the build or the start-up        |
| [0004](0004-typescript-6.md)                   | TypeScript 6 while typed linting needs it                |
| [0005](0005-serialised-local-writes.md)        | Writes are serialised per process and retried            |
| [0006](0006-leader-terms-and-fenced-writes.md) | Work runs in leader terms with fenced writes             |
| [0007](0007-snapshots-and-facts.md)            | One snapshot per version; states recomputed at read time |
