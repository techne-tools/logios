# Next Steps — Hermes Next Phase

**Date:** 2026-10-09

> **Correction.** An earlier version of this file described "remaining type
> errors that prevent test execution" and listed Wave 1 as all-incomplete.
> That framing was wrong on both counts: there were no blocking type errors
> (see `docs/PROGRESS.md`), and Wave 1 is now consolidated. Superseded.

Plan and spec (authoritative):
`docs/superpowers/plans/2026-10-08-hermes-next-phase-plan.md`,
`docs/superpowers/specs/2026-10-08-hermes-next-phase-design.md`.

## Immediate

1. **Rewrite the Task 3 integration tests.** `test/writeGates.integration.test.ts`
   and `test/chatFlow.integration.test.ts` currently assert only that a
   `ChatManager` holds messages; they never construct an `ApprovalDialog`, call
   `runWrite`, or reach `ItemManager.updateItemMetadataGated`. Either wire them
   to the real gate or fold the coverage into the existing unit suites.
2. **Close the typecheck hole.** Add `test/` to a typecheck gate (a dedicated
   `tsconfig.test.json`, or `include` `test/` from the root project) so the
   next "phantom syntax error" is a real compiler error at the gate.

## Short term

3. **Wave 2 lanes** (briefs exist; no code yet):
   - Task 4 — approval-batch UX (`ApprovalDialog.addPendingChanges`).
   - Task 5 — per-tool permission chips (`available_commands` → `allowedTools`).
   - Task 6 — collection-level synthesis (`SynthesisManager`, `/synthesize`).
4. **Wave 3** — big surfaces (reader panel, sidecar), design-gated.

## Verification requirements

- `npm run build` — must be green.
- `NODE_ENV=test npm test -- --no-watch` — must be fully green before merge.
- `npm run lint:check` — prettier + eslint.

## Housekeeping

- `docs/PROGRESS.md` and this file were corrected on 2026-10-09; earlier
  versions contained inaccurate status claims.
- Test artifacts (`.backup`, `.broken`, `.v2`, `.original`, `.bak`) and stray
  scratch files were removed from the working tree.
