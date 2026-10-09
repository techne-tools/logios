# AGENTS

This project uses specialized AI agent skills for development.

<skills_system priority="1">

## Available Skills

<!-- SKILLS_TABLE_START -->
<usage>
When users ask you to perform tasks, check if any of the available skills below can help complete the task more effectively. Skills provide specialized capabilities and domain knowledge.

How to use skills:

- Read skill: `cat ./.agent/skills/<skill-name>/SKILL.md`
- The skill content will load with detailed instructions on how to complete the task
- Skills are stored locally in ./.agent/skills/ directory

Usage notes:

- Only use skills listed in <available_skills> below
- Do not invoke a skill that is already loaded in your context
- Each skill invocation is stateless
  </usage>

<available_skills>

<skill>
<name>zotero-dev</name>
<description>Core development patterns for Zotero plugins. Load when implementing features, editing src/modules/hermes/, handling Zotero API calls, or managing plugin lifecycle.</description>
<location>project</location>
</skill>

<skill>
<name>zotero-ops</name>
<description>Operations, build workflows, syncing, versioning, and release management for Zotero projects. Load when running builds, preparing releases, or troubleshooting deployment.</description>
<location>project</location>
</skill>

<skill>
<name>zotero-ref</name>
<description>Technical references, API documentation, and Zotero-specific knowledge. Load when checking API details, manifest requirements, or UI/UX standards.</description>
<location>project</location>
</skill>

<skill>
<name>project</name>
<description>Project-specific architecture, maintenance tasks, and unique conventions for this repository. Load when performing project-wide maintenance or working with the core architecture.</description>
<location>project</location>
</skill>

</available_skills>

<!-- SKILLS_TABLE_END -->

</skills_system>

---

## Governance Docs (read first)

These documents govern all work in this repo. Read them before planning or
implementing:

| Doc                               | Role                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `DESIGN.md`                       | **Design north star** — target state. Every design decision is measured against it.          |
| `PRODUCT.md`                      | **Product intent** — what the plugin is for, who it serves, what it is not.                  |
| `ARCHITECTURE.md`                 | **Current code reality** — how the code is actually structured today.                        |
| `.agent/rules/agent-standards.md` | **Agent contract** — sandbox constraints, security rules, code quality, worktree discipline. |

**Conflict rule:** when docs and code disagree, FLAG the conflict — do not
silently pick a side. Keep verifiable claims (test counts, file lists) in
these docs current at review time.

## Development Notes

### Zotero Sandbox Constraints (Critical)

Zotero plugins run in a **Firefox 140 ESR sandbox** (Zotero 10; was 115 ESR
under Zotero 9) with severe React limitations:

1. **Synthetic input events fail** — `onChange` and `onKeyDown` on text inputs do not fire reliably
   - **Pattern**: Use native `addEventListener` via refs for text inputs and window accelerators
   - **Example**: `textareaRef.current.addEventListener("input", handler)` instead of `onChange`
   - Standard button `onClick` handlers inside the React tree dispatch normally

2. **State ref pattern** — Native callbacks can't access React state closures
   - **Pattern**: `stateRef` mirrors all React state; native handlers read from `stateRef.current`
   - **Example**: `const st = stateRef.current; if (st.isTyping) return;`

3. **No `dangerouslySetInnerHTML`** — Crashes the sandbox with security errors
   - **Pattern**: Use `MarkdownRenderer.tsx` — pure React element creation from parsed markdown
   - **No `DOMParser` either** — also crashes; manual string parsing only

4. **Clipboard access** — Use Firefox XPCOM `nsIClipboardHelper`
   - **Pattern**: `(Components as any).classes["@mozilla.org/widget/clipboardhelper;1"].getService(...)`

### Key Architectural Decisions

#### Dual-Mode Connection

- **ACP (stdio)** — Spawns `hermes acp` subprocess, JSON-RPC 2.0 over stdio/NDJSON
- **API (HTTP)** — REST client to `hermes gateway`, SSE streaming, OpenAI-compatible format
- Both implement `ChatClient` interface; UI is agnostic

#### Stream Subscription Pattern

- `useEffect` subscribes to `client.onUpdate()` and `client.onError()`
- Minimal deps array to avoid re-subscription loops
- Callbacks use refs (`streamingMessageIdRef`, `reasoningMessageIdRef`) for mutable state

#### Buffered Streaming

- `useStreamBuffer` collects rapid chunks and flushes via `setTimeout(flushBuffer, 50)`
- Replaced `requestAnimationFrame` (unreliable in sandbox) with `setTimeout`
- Reasoning messages inserted BEFORE assistant message via `splice(assistantIndex, 0, reasoningMsg)`

#### Typing Indicator Safety

- 60-second timeout started when `sendPrompt` is called
- Reset on every non-terminal update chunk; restarted in `handleUpdate`
- Terminal events: `stop`, `usage`, `session_info`, `error`
- Prevents stuck "Hermes is thinking" when stream never terminates

#### Stop Button Wiring

- The send button doubles as a stop button — it shows `StopIcon` while `isTyping` is true
- Its native `click` handler reads `stateRef.current.isTyping` (not React state) to decide:
  - If typing → calls `client.cancel()` to abort the in-flight stream
  - If idle → calls `sendMessage()` as normal
- `cancel()` is implemented on both `HermesClient` (kills subprocess stdin) and `HermesApiClient` (aborts `AbortController`)

### Item Context Resolution

**Critical**: Zotero parent items and attachments have **different keys**.

- Parent item (book, article) has key `ABC123`
- PDF attachment is a **child item** with its own key `XYZ789`
- Storage folder is `~/Zotero/storage/XYZ789/` (attachment key, NOT parent key)
- `ItemManager.extractItemData()` is **async** — it `await`s `item.getBestAttachment()` to resolve the real attachment (the Zotero API returns a Promise; the old sync cast was silently broken)
- Passes `attachmentKey` and `storagePath` in context so agent finds the correct folder

### Agent Context Format

When items are attached, the agent receives:

```
[item]: Technical gadgetry: technological development in the aesthetic economy
Title: Technical gadgetry: technological development in the aesthetic economy
Authors: John Doe, Jane Smith
Date: 2024
Abstract: This paper explores...
Tags: technology, aesthetics, economy
DOI: 10.1234/example
URL: https://example.com/paper
Item type: journalArticle
Zotero attachment key: XYZ789
Zotero storage path: /Users/<user>/Zotero/storage/XYZ789/
Zotero file path: /Users/<user>/Zotero/storage/XYZ789/filename.pdf
```

The system instruction explicitly tells the agent:

- "The metadata for attached Zotero items is ALREADY provided"
- "ANSWER DIRECTLY using the provided metadata"
- "Do NOT search online, do NOT try to read the SQLite database"

This prevents hallucinations about database access or online searches.

### MCP Removal

MCP (Model Context Protocol) server integration was attempted but consistently failed:

- Connection refused errors
- "Invalid params" format mismatches
- Wrapper scripts didn't resolve the issue

**Decision**: Removed MCP dependency entirely. Agent uses provided metadata directly.

- `createSession()` sends `mcpServers: []`
- System instruction explicitly states MCP is unavailable
- All Zotero data comes from attached context items

### Worktree Development (Test-Fix Workflows)

When fixing tests or doing isolated work, use a **git worktree** — never run tests against a dirty main tree. These gotchas were harvested from the 2026-08-11 markdown parser fix (see FLEET.md Q10–Q13):

1. **Branch from the last building commit, not clean main** — clean `main` can be build-broken (e.g. `src/hooks.ts` importing a symbol that only exists on an in-flight branch). Verify the base ref builds before creating the worktree, or re-point with `git reset --hard <building-commit>`.

2. **Copy the gitignored `.env`** — the scaffold loads it via dotenv; without it you get "No Zotero Found." It contains:

   ```
   ZOTERO_PLUGIN_ZOTERO_BIN_PATH = /Applications/Zotero.app/Contents/MacOS/zotero
   ZOTERO_PLUGIN_PROFILE_PATH = /Users/<user>/Library/Application Support/Zotero/Profiles/<profile>.default
   ```

3. **`NODE_ENV=test` is mandatory for `npm ci`** — ambient `NODE_ENV=production` (Hermes TUI quirk) makes npm 11 omit devDependencies (only 6 packages installed otherwise). Always prefix: `NODE_ENV=test npm ci --no-audit --no-fund`.

4. **Headless Zotero teardown lingers** — the suite result appears in the log BEFORE the process exits. Run tests backgrounded, read the log for the result, then kill the process. Don't wait for exit.

5. **Never stash a dirty tree to run tests** — the test build regenerates `typings/prefs.d.ts` (tracked, ~10 deletions), which blocks a stash pop. Commit to a task branch first, then run tests.

6. **opencode sandbox blocks `/tmp` writes** — dispatch briefs must say "work only inside this worktree, no /tmp paths". Also: exit 0 is UNVERIFIED — gate on `git diff` + TASK.md status, not just the exit code.

### Test Runner Gotchas (2026-08-12 — unit test suite)

These cost a full debugging session. Read before writing tests that touch the `Zotero` global:

1. **`zotero-plugin test` runs in WATCH mode by default** — the process never exits after tests finish. Always run `npm test -- --no-watch` (or `--exit-on-finish`) for CI/verification runs. Without it, the suite "hangs" after the last test.

2. **NEVER replace the `Zotero` global in tests** — the test runner's reporter calls `Zotero.HTTP.request` to stream results back to the server, and `Zotero.Utilities.Internal.quit` to exit. Replacing `globalThis.Zotero` with a mock breaks the reporter: every `send()` throws, the server never receives the "end" event, and the suite hangs forever with no error output. **Pattern**: spread-overlay the real object and override only what you need:

   ```ts
   const realZotero = (globalThis as any).Zotero;
   (globalThis as any).__realZotero = realZotero;
   (globalThis as any).Zotero = { ...realZotero, getProfileDirectory: () => ... };
   // restore in after(): (globalThis as any).Zotero = (globalThis as any).__realZotero;
   ```

3. **`Components` is a read-only global in the Firefox sandbox** — you cannot reassign `globalThis.Components`. The real one already provides `nsIFile.DIRECTORY_TYPE`, so don't mock it.

4. **Some `Zotero.File` properties are read-only** (e.g. `putContents`, `getContents`) — direct assignment throws. Use the spread-overlay pattern above instead.

5. **Chai assertion errors lose their message in the reporter** — the scaffold's reporter serializes `data.error` via JSON, and chai's `message` is non-enumerable, so failures show as `Expected: undefined / Received: undefined`. To debug, wrap the test body in try/catch and call `(window as any).debug?.(err.stack)` (the scaffold defines `window.debug` which POSTs to the server).

6. **Mock `Zotero.File.pathToFile` must throw on empty path** — `ConversationManager` relies on that throw to skip persistence when no profile/data dir exists. A mock that silently accepts `""` will write files with empty paths and break the "no persist" test.

7. **`nsIFile.isDirectory` is a boolean PROPERTY, not a method** — `dirFile.isDirectory` (no parens). Calling it as `isDirectory()` throws "is not a function" at runtime. The M1 regression test (loadAllConversations with a populated dir) caught this in the original implementation — it had never run against a populated directory before.

### Files Modified in Recent Session (5 June 2026)

| File                                 | Change                                                                |
| ------------------------------------ | --------------------------------------------------------------------- |
| `src/views/HermesChatView.tsx`       | Typing timeout fix, copy buttons, metadata context passing            |
| `src/modules/hermes/HermesClient.ts` | Full metadata in context, MCP removal, system instruction update      |
| `src/modules/hermes/ItemManager.ts`  | Attachment key resolution, `storagePath`/`attachmentKey` fields       |
| `src/modules/hermes/types.ts`        | `extracted` field on `PromptContextItem`                              |
| `src/utils/MarkdownRenderer.tsx`     | Table rendering support                                               |
| `README.md`                          | Complete rewrite with features, architecture, sandbox constraints     |
| `TODO.md`                            | Updated Phase 2 completion status, added bug fix session log          |
| `AGENTS.md`                          | Added development notes, sandbox constraints, architectural decisions |

### Zotero 10 Compatibility (10 September 2026)

Zotero 10.0.2 runs on **Mozilla 140.15.0esr** (was 115 ESR in Zotero 9). The
plugin was blocked by `strict_max_version: "9.*"` (`appDisabled: True` in
extensions.json). Fixes landed on branch `feat/zotero-10-compat`:

| File                                | Change                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `addon/manifest.json`               | `strict_max_version` → `10.*`                                                             |
| `zotero-plugin.config.ts`           | esbuild target `firefox115` → `firefox140`                                                |
| `package.json`                      | scaffold `^0.9.2`, zotero-types `^4.1.3`, toolkit `^5.2.0`                                |
| `src/utils/ztoolkit.ts`             | `ZoteroToolkit` import → `zotero-plugin-toolkit/ztoolkit` subpath (5.2.0 breaking change) |
| `src/modules/hermes/NoteManager.ts` | `getAsync` now returns `Item \| false` in zotero-types 4.1.3 — widen declared type        |

Gotchas learned:

1. **Zotero 10 = Firefox 140 ESR** — esbuild 0.28 supports `firefox140`; the
   old `firefox115` target still compiles but is stale. Raise it with the
   version bump.
2. **toolkit 5.2.0 moved `ZoteroToolkit` to `/ztoolkit`** — root export removed
   (breaking change, 2026-07-21). Other tools (`BasicTool`, `UITool`,
   `DialogHelper`, `ColumnOptions`, `unregister`) stay at root.
3. **zotero-types 4.1.3 tightened `Zotero.Items.getAsync`** to `Item | false`
   (changelog: "missing `| false` returns"). Guard code that already checked
   `if (!note)` needs the declared variable type widened to compile.
4. **scaffold 0.9.2 (2026-09-08) fixes the chai error-serialization gotcha** —
   the fail reporter now serializes `error.message`/`stack` explicitly. The
   `window.debug` workaround in gotcha #5 above is no longer needed for
   debugging failures.
5. **`npm ci` fails after version bumps** — lock file must be regenerated with
   `NODE_ENV=test npm install` first (EUSAGE: "lock file's X does not satisfy Y").
6. **Test run consumes the built XPI** — `zotero-plugin test` installs the
   addon dir directly and the `.scaffold/build/*.xpi` disappears. Rebuild with
   `NODE_ENV=production npm run build` before installing into a profile.

## Fleet conventions

Stricter-than (never looser than) fleet-wide conventions apply everywhere in the fleet:

@../fleet-conventions.md
