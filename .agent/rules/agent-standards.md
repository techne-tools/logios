# Logios — Agent Standards

These rules apply to every AI agent working in this repository. They are
the contract between the repo and the harness. When a rule and a task
conflict, flag the conflict — do not silently pick a side.

## 1. Sandbox Constraints (non-negotiable)

Zotero plugins run in a **Firefox 140 ESR sandbox** (Zotero 10; was 115 ESR in Zotero 9):

- **Synthetic event boundaries** — `onChange` and `onKeyDown` on text inputs do
  not fire reliably in Mozilla privileged chrome contexts. Use native
  `addEventListener` via refs for text inputs and keyboard shortcuts (`Cmd+F`).
  Standard button `onClick` within the React tree is supported.
- **No `dangerouslySetInnerHTML`** — crashes the sandbox with security
  errors. Use `MarkdownRenderer.tsx` (pure React element creation).
- **No `DOMParser`** — also crashes. Manual string parsing only.
- **Clipboard** — use Firefox XPCOM `nsIClipboardHelper`, not the Web
  Clipboard API.

## 2. Security Rules

- **Never hardcode user-specific paths** (e.g. `/Users/<name>/...`). Resolve
  Zotero data/profile directories at runtime.
- **Never spawn subprocesses through a shell.** Use `Subprocess.call` with an
  argument array. A configured path with metacharacters must not be able to
  inject commands.
- **Never log secrets** — API keys, tokens, or raw prompt text. Truncate
  arguments; log only command name + elapsed time + result type.
- **All Zotero writes** (notes, annotations, tags) must route through
  `ApprovalDialog`. The agent proposes; the user disposes.
- **Escape user-controlled content** before interpolating into HTML (note
  titles, exported content).

## 3. Code Quality Rules

- **TypeScript strict mode** — no `@ts-expect-error` without a comment
  explaining why. Prefer narrowing `any` over spreading it.
- **No `/* eslint-disable */`** without a comment justifying it. The views
  were restored from a stub in 2026-08-11; keep them lint-clean.
- **No dead code** — if a feature is removed (e.g. MCP), remove its methods
  and prefs too.
- **Tests** — new logic in `src/utils/` and `src/modules/hermes/` should
  carry unit tests in `test/`. Run `NODE_ENV=test npm test` before pushing.
- **Build** — `NODE_ENV=test npm run build` must pass (zotero-plugin build +
  `tsc --noEmit`).

## 4. Worktree Discipline

- **Never run tests against a dirty main tree.** Use a git worktree.
- **Branch from the last building commit**, not clean main (clean main can be
  build-broken). Use `--base <sha>` with the dispatch script.
- **Copy the gitignored `.env`** into the worktree (scaffold needs it).
- **`NODE_ENV=test` is mandatory** for `npm ci` — ambient
  `NODE_ENV=production` makes npm omit devDependencies.
- **Never stash a dirty tree to run tests** — the build regenerates
  `typings/prefs.d.ts` and blocks the pop. Commit to a task branch first.

## 5. Governance Docs

- **DESIGN.md** = design north star (target state)
- **PRODUCT.md** = product intent
- **ARCHITECTURE.md** = current code reality
- **AGENTS.md** = agent guide + development notes

When docs and code disagree, **flag the conflict** — do not silently pick a
side. Keep verifiable claims (test counts, file lists) in these docs current
at review time.
