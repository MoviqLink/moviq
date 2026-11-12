# 0004 · TypeScript 6 while typed linting needs it

**Context.** TypeScript 7 (the native compiler) is out, but `typescript-eslint` supports
TypeScript up to 6.0. Type-aware lint rules (floating promises, unsafe `any`, exhaustive switches)
are part of the quality gate.

**Decision.** Use TypeScript 6.0 with strict options and `erasableSyntaxOnly`, which keeps the
code compatible with TypeScript 7.

**Consequences.** Moving to TypeScript 7 is a version bump once typed linting supports it.
