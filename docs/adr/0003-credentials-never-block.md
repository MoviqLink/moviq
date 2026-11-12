# 0003 · Credentials never block the build or the start-up

**Context.** External services need keys that arrive at different times, but contracts,
persistence and tests should not wait for them.

**Decision.** Integration credentials are optional. Each integration resolves to `configured`,
`missing` or `incomplete`, with the names of the missing variables. The server starts without
any of them and its features report themselves as unavailable rather than faking results. The
quality gate runs without keys, using test doubles fed with captured real responses; each
integration is validated against the real service, with its key, in a separate live test run.

**Consequences.** Safety rules still fail closed: live payments refuse to start without their
credentials. An integration is only considered done once its live test passes with a real key.
