# Tools

Checks that run inside `npm run verify`.

| Script              | Checks                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `licenses.ts`       | Production packages use allowed licences and `THIRD_PARTY_NOTICES.md` is up to date (`--write` regenerates it)                                                     |
| `check-delivery.ts` | README in every folder, no tracked `.env*` file, no machine paths (macOS, Linux, Windows), no unfinished-work markers, no secrets, code lines up to 120 characters |
| `data-sources.ts`   | `docs/data-sources.md` matches the catalogue of sources (`--write` regenerates it)                                                                                 |

The rules live in `license-rules.ts`, `delivery-rules.ts` and `data-sources-doc.ts` and are tested in `tests/`.
