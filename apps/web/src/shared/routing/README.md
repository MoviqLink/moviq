# Routing

`hash.ts` reads the address after `#/` as path segments and re-renders on navigation. Each
feature turns its segments into screens (see `features/ops/routes.ts`). `hrefs.ts` holds the
traveller's addresses, so the planner links to a trip without importing it, and says which place
of the navigation (Sara, Explore or My trips) an address belongs to.
