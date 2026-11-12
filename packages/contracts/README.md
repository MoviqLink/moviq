# @moviq/contracts

The shapes that cross a boundary: HTTP responses and errors, and the way instants are written.
Each contract is a Zod schema, and its TypeScript type is derived from it, so the server can
build a value with the type and a client can validate what it receives with the schema.

- `src/` holds the schemas, exported from `src/index.ts`.
- `tests/` checks what each schema accepts and refuses.

Built with `tsc -b` to `dist/`, which is what Node loads in production. TypeScript, ESLint, the
tests and development read the sources directly through the `moviq-source` export condition, so
nothing needs building first.
