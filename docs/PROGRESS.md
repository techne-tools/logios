# Wave 1 Consolidation — Progress

**Date:** 2026-10-09
**Branch:** `feat/wave1-consolidation` (based on `main` @ `aac5917`)

> **Correction.** An earlier version of this file claimed that
> `test/chatFlow.integration.test.ts` and `test/writeGates.integration.test.ts`
> contained "persisting syntax errors" that were then "fixed". **No such syntax
> errors ever existed.** Every test file parses cleanly (`esbuild` parse of all
> 22 `test/*.test.ts` → OK). The errors reported were an artefact of two
> environment problems, described below. The old claims are superseded by this
> file.

## What was actually wrong

1. **`test/` is outside every typecheck gate.** The root `tsconfig.json`
   includes only `["src", "typings", ".refs/zotero-pdfjs-types/types"]`, and
   `test/tsconfig.json` merely extends it without adding `test/`. So
   `npm run build` (`zotero-plugin build && tsc --noEmit`) passes while the
   test tree is validated only at runtime. This is why hand-run `tsc` against
   the test files produced a wall of unrelated `TS2593`/`TS2304` noise that read
   like broken syntax.
2. **A non-existent test flag.** Test runs used `npm test -- --no-wait`.
   The scaffold's real flag is `--no-watch`. An unknown option makes the run
   abort before executing anything.

## What was consolidated

Three Wave-1 implementer lanes (worktrees `next-phase/{d,s,t}`) had each
produced committed work, none merged, with a second divergent copy left
uncommitted in the `main` working tree. They are now materialised as committed
files on `feat/wave1-consolidation`.

| Task                 | Deliverable                                                                                                  | Source of truth used                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| 1 — user guide + FAQ | `docs/user-guide.md`, `docs/faq.md`                                                                          | `next-phase/d` @ `6c5cb5e`                             |
| 2 — secrets vault    | `src/utils/SecretVault.ts`, `hooks.ts` migration, `HermesApiClient`, `preferenceScript`, `preferences.xhtml` | **`main` working tree**, not `next-phase/s`            |
| 3 — stability        | `ChatManager` message cap, `HermesChatView` lazy mount, benchmark + integration tests, `docs/perf-notes.md`  | `main` working tree (= `next-phase/t` for these files) |

**Why `main`'s tree won for Task 2, not the lane branch.** The
`next-phase/s` tip regressed the vault: it appended the filename to a
directory `nsIFile` (`hermesDir.append(this.secretFileName)`, which throws
`NS_ERROR_FILE_IS_DIRECTORY`) and dropped the `Object.entries(parsed)` reload
fix, leaving the disk-reload path dead. `main`'s copy is the currently-passing
implementation. The `next-phase/*` branches are preserved, unmerged, for
reference.

## Verified state at consolidation

| Check                                  | Result                                         |
| -------------------------------------- | ---------------------------------------------- |
| `npm run build`                        | green                                          |
| `tsc --noEmit` (src project)           | exit 0                                         |
| `NODE_ENV=test npm test -- --no-watch` | see `docs/NEXT_STEPS.md` for the current count |

The consolidation commit itself is not the end of Wave 1: the Task 3
integration tests were stubs that never exercised the write gate, and are
rewritten separately. See `docs/NEXT_STEPS.md`.
