# Hermes Next Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 11-feature next phase (stability → synthesis → reader panel
→ secrets/approval/tool-perm UX → sidecar/writing/ghost-text → release/docs).

**Architecture:** Work runs in 4 waves of parallel lanes with disjoint write
scopes. Wave 1 = independent foundations (stability, secrets vault, docs).
Wave 2 = UX and feature lanes that build on wave-1 stability (approval batch
UX, tool-permission UI, synthesis). Wave 3 = big UI surface (reader panel)
and the sidecar boundary (design-gated). Wave 4 = writing integration,
ghost-text spike, release verification. UI lanes route to @designer;
headless lanes to @fixer; sidecar design gated by @oracle.

**Tech Stack:** TypeScript, React 19, Firefox 140 ESR sandbox APIs (XPCOM,
`Subprocess.sys.mjs`), esbuild via zotero-plugin-scaffold, Mocha/chai in-Zotero
test harness.

**Spec:** `docs/superpowers/specs/2026-10-08-hermes-next-phase-design.md` —
executors read both. Exact paths/values below come from the spec.

## Global Constraints

- Zotero 10 = Firefox 140 ESR sandbox: NO `dangerouslySetInnerHTML`, NO
  `DOMParser`; text inputs and window accelerators use native
  `addEventListener` via refs; native callbacks read `stateRef.current`.
- All Zotero writes go through `runWrite` (`src/utils/writeGate.ts`); every
  outcome audited via `AuditLog.record`. Trash, never erase.
- Secrets never in prefs (post-migration), never in logs or audit or code.
- Tests: `NODE_ENV=test npm test -- --no-watch` — always `--no-watch` (watch
  mode never exits); run backgrounded, read log for result, then kill.
- `npm ci` requires `NODE_ENV=test npm ci --no-audit --no-fund`.
- No code splitting/chunks: conditional mounting only (esbuild `bundle: true`).
- Plugin stays useful with sidecar absent (degrade-graceful, every sidecar
  call fail-soft).
- Implementers load `.agent/skills/zotero-dev` before editing
  `src/modules/hermes/`; ops work loads `zotero-ops`.
- Branch per wave using `using-git-worktrees`; base each wave on the last
  green commit, not clean main.

## Review Focus

Failure modes the spec implies but may escape task tests — each pinned by a
test in the owning task:

1. **Vault migration loses the key** — pref cleared before vault write is
   durable → API mode silently loses auth. Expect: migrate only after
   verified read-back; test pins in Task 2 (migrate-after-verify).
2. **Batch approval dialog fails mid-queue** → remaining changes must NOT be
   auto-applied; every undecided change records `blocked` audit. Test pins in
   Task 4.
3. **Synthesis partial failure presented as full success** — a failed batch
   must be named in the final output, fold proceeds over successes only.
   Test pins in Task 6.
4. **Message cap truncates persisted history** — cap is in-memory only; the
   conversation JSON keeps all messages. Test pins in Task 3.
5. **Auth headers or secrets in debug output** — enable debug mode, poll a
   request, expect no `Bearer`, no secret string in log/audit. Test pins in
   Task 2.

---

## Wave 1 — Foundations (3 parallel lanes, disjoint files)

### Task 1: User guide + FAQ

**Files:**

- Create: `docs/user-guide.md`, `docs/faq.md`

**Interfaces:**

- Produces: docs grounded in PRODUCT.md feature table and the actual
  `BUILT_IN_COMMANDS` list — no invented features.

- [ ] Cross-check the command list: `/help` catalogue in `SlashCommands.ts`
      is the source of truth (26 commands per inventory).
- [ ] Write `docs/user-guide.md`: install → connect (ACP/API + vault) →
      attach context → slash reference (table) → approval/audit model →
      personas → troubleshooting sections from sandbox gotchas.
- [ ] Write `docs/faq.md`: 15 Q&As (binary not found, health check fail,
      profile scoping warning, Obsidian path, key storage location…).
- [ ] Verify each doc claim against code (spot-check 10 random claims).
- [ ] Commit: `git commit -m "docs: user guide and FAQ"`.

### Task 2: Secrets vault

**Files:**

- Create: `src/utils/SecretVault.ts`, `test/secretVault.test.ts`
- Modify: `src/modules/hermes/HermesApiClient.ts` (`getApiKey`),
  `src/modules/preferenceScript.ts` (connection test), preferences UI API-key
  field in `addon/content/preferences.xhtml` + its logic in
  `src/modules/preferenceScript.ts`, `src/index.ts` (startup migration call)
- Test: `test/secretVault.test.ts`

**Interfaces:**

- Consumes: `Zotero.Prefs`, `Zotero.File.putContentsAsync/getContents`, profile
  dir resolution pattern from `src/utils/zoteroPaths.ts`.
- Produces: `SecretVault.setSecret(name, value): Promise<void>`,
  `.getSecret(name): Promise<string | null>`,
  `.deleteSecret(name): Promise<void>`, `.listSecrets(): Promise<string[]>`.
  Canonical secret name: `"apiKey"`.

- [ ] Write failing tests: set→get roundtrip; file created with `0o600`
      permissions; unknown name → `null`; delete removes; value never
      appears in `Zotero.debug` output (spy).
- [ ] Run: `NODE_ENV=test npm test -- --no-watch test/secretVault.test.ts`
      → FAIL (module not defined).
- [ ] Implement `SecretVault` — storage `<profile>/hermes-secrets.json`
      (path resolved at runtime via `zoteroPaths`), chmod `0o600` on create.
- [ ] Implement migration in startup hook (`src/index.ts`):
      read pref `apiKey`; if non-empty → `setSecret("apiKey", …)` → verify
      `getSecret` returns it → then `Zotero.Prefs.clear(prefKey)` → audit
      `record("permission", "migrated apiKey to vault", "success")`.
- [ ] Switch `HermesApiClient.getApiKey()` and `preferenceScript` connection
      test to vault-first with pref fallback.
- [ ] Prefs UI: key field writes vault, shows `••••<last4>`, adds Clear
      button → `deleteSecret`.
- [ ] Write failure-mode tests (Review Focus 1 & 5): simulated vault-write
      failure leaves pref intact and migration audited as `blocked`; debug
      log contains no `Bearer` and no secret when polling a request.
- [ ] Run full suite → PASS; commit: `feat: secret vault with prefs migration`.

### Task 3: Stability infrastructure

**Files:**

- Create: `test/chatFlow.integration.test.ts`, `test/writeGates.integration.test.ts`,
  `test/benchmark.test.ts`
- Modify: `src/modules/hermes/ChatManager.ts` (cap), `src/views/HermesChatView.tsx`
  (conditional mounting of SidePanels / TokenDashboard / reasoning panes)

**Interfaces:**

- Consumes: existing `ChatManager` API and `ConversationManager.loadConversation`;
  mock `ChatClient` pattern from existing unit tests.
- Produces: `ChatManager` exposes `MAX_MEMORY_MESSAGES: 300` (exported
  constant); messages beyond cap dropped from memory on
  `loadFromConversation`, marker message appended ("earlier messages in saved
  conversation"); persisted file untouched.

- [ ] Write failing tests (Review Focus 4 pinned here): 300-cap load keeps
      **most recent** 300 + marker; conversation JSON on disk still has 1000;
      `setMessages(1000)` never exceeds cap in memory.
- [ ] Implement cap in `ChatManager` (single trim point: `loadFromConversation`
      and `setMessages`).
- [ ] Write failing integration test: mock client end-to-end — new
      conversation, sendPrompt → stream chunks → `stop` → messages persisted
      (read file back); disconnect/reconnect preserves history.
- [ ] Write failing integration test: `updateItemMetadataGated` with a mock
      adapter — approve path applies + audits `file_change success`; reject
      path applies nothing, audits `permission` blocked; approval-dialog
      `throw` → `runWrite` returns `failed`, apply never called
      (pin to `writeGate` contract).
- [ ] Run suite → PASS; commit: `feat: message cap, lazy mounting, integration tests`.
- [ ] Conditional mounting in `HermesChatView`: SidePanels/TokenDashboard
      render only when their toggle is on; default off costs zero mounts.
- [ ] Benchmark task: `test/benchmark.test.ts` — times `extractItemData`
      × 100 synthetic items and `setMessages` × 1000 through the mock; logs
      to `Zotero.debug`, no timing asserts; runs only when env
      `HERMES_BENCH=1`.
- [ ] Run bench once, record numbers in `docs/perf-notes.md`; commit.

**Wave 1 exit:** full suite green (`NODE_ENV=test npm test -- --no-watch`,
run backgrounded, read log); branches merged; `npm run build` + `tsc --noEmit`
clean.

---

## Wave 2 — Feature lanes (3 parallel lanes, built on wave 1)

### Task 4: Approval-batch UX (@designer)

**Files:**

- Modify: `src/modules/hermes/ApprovalDialog.ts` (add queue API + multi-change
  modal), dialog markup/styles for the approval dialog
- Test: `test/approvalDialogBatch.test.ts`

**Interfaces:**

- Consumes: `PendingFileChange` shape from `src/modules/hermes/types.ts`;
  `runWrite` calls `addPendingChange` per change (unchanged).
- Produces: `ApprovalDialog.addPendingChanges(changes): Promise<boolean[]>`
  resolving in queue order; single-change dialog unchanged (writeGate
  compatibility preserved — tests from Task 3 must stay green).

- [ ] Design pass first (designer): read current dialog flow, choose list UI
      (per-change Approve/Deny, Approve All / Deny All, per-change diff,
      sandbox-safe native listeners only), present to user before code.
- [ ] Failing tests: enqueue 3 → resolve 3 distinct answers in order;
      `Approve All` → 3×true; dialog `throw` mid-queue → undecided entries
      audited `blocked` and never applied (Review Focus 2); each decision
      writes its own `permission` audit entry.
- [ ] Implement; existing single-change tests stay green.
- [ ] Full suite → PASS; commit: `feat: batch approval queue`.

### Task 5: Per-tool permission UI (@designer)

**Files:**

- Modify: feature-toggles area in `HermesChatView` / `InputArea` (chips built
  from `available_commands`)
- Test: `test/toolPerms.test.ts`

**Interfaces:**

- Consumes: `available_commands` updates already streamed to the client;
  conversation `allowedTools` schema (`null` / `[]` / list) — no schema
  change.
- Produces: chip set reflecting allowed tools; toggling updates
  conversation state and persists via `ChatManager`.

- [ ] Failing tests: chips enumerate `availableCommands` names; selecting
      exactly `["web_search"]` produces an `allowedTools` array of one;
      deselect-all produces `[]` (not `null`); `null` = chip-free
      unrestricted default; state resumes from persisted conversation.
- [ ] Implement chips (native listeners); transmit path already exists — do
      not touch `HermesClient`/`HermesApiClient`.
- [ ] Full suite → PASS; commit: `feat: per-tool permission chips`.

### Task 6: Collection-level synthesis (@fixer, after 3s design check)

**Files:**

- Create: `src/modules/hermes/SynthesisManager.ts`, `test/synthesis.test.ts`
- Modify: `src/modules/hermes/SlashCommands.ts` (`/synthesize`), types if a
  new context type is required

**Interfaces:**

- Consumes: `ItemManager.attachCollection` (existing), client
  `sendPrompt(text, contextItems, options)` streaming, `buildItemContext`.
- Produces (exact signatures): `splitIntoBatches(ids: string[], size = 10):
string[][]`; `buildBatchPrompt(batch: string[], focus: string): string`;
  `foldPrompt(summaries: string[], focus: string): string`; cache
  `getSummary(id: string): string | null` / `putSummary(id: string, summary:
string): void` (LRU, cap 200).

- [ ] Failing unit tests: 30 ids → 3 batches of exact ids; batch prompt
      names each item and `focus`; fold prompt contains all summaries;
      LRU evicts at 201 entries; failed-batch summary list marks failure.
- [ ] Implement units pure (no Zotero imports) so tests run without live Zotero.
- [ ] Wire `/synthesize [focus]`: per-batch `sendPrompt` turn with per-item
      summarize instruction, cache hits skip batch, fold turn last; Stop
      cancels between batches (cancel hook per turn); final message lists
      per-batch status; failed batches named and excluded from fold
      (Review Focus 3 — test in `synthesis.test.ts` with a mock client that
      fails batch 2).
- [ ] Full suite → PASS; commit: `feat: /synthesize collection-level synthesis`.

**Wave 2 exit:** suite green; designer lanes reconciled for copy quality
(orchestrator pass per fleet discipline) without altering design intent.

---

## Wave 3 — Big surfaces (design-gated)

### Task 7: Reader-tab sidebar panel (@designer, spike-first)

**Files (contingent on spike):**

- Modify: `src/hooks.ts` (reader registration), one new
  `src/views/components/ReaderPanel.ts` host wrapper
- Spec section: 6

- [x] Spike: inject a host `box` into reader chrome via
      `Zotero.Reader.registerEventListener` render hook in a scratch branch;
      mount/unmount React root; verify sandbox-safe (native listeners only).
      Report feasibility.
      → **2026-10-09: INFEASIBLE.** No panel hook exists — the dispatcher fires
      only for the seven `ReaderEventMap` slots, and `append()` is bound to a
      fixed React container that must be filled synchronously. Report:
      `docs/superpowers/spikes/reader-panel-spike.md`.
- [ ] On feasible: implement toggle + mounting the existing `HermesChatView`
      instance scoped to the reader context; auto-attach selection/page/item
      on prompt from this surface sharing ConversationManager storage.
      → **Not applicable (lane stops).**
- [x] Infeasible: record finding in TODO.md + spec open-question; stop lane.
- [ ] Verify: open PDF tab → toggle chat panel → selection prompt attaches
      reader context; conversation persists and reopens in library sidebar too.
      → **Not applicable.** Existing behaviour kept: reader toolbar/context
      actions → library sidebar.
- [x] Commit: `feat: reader chat panel` (or `docs+todo: reader injection infeasible`).
      → `docs: reader-panel panel infeasible — keep toolbar/context-menu → sidebar`.

### Task 8: Sidecar tier (design first via @oracle) — **CLOSED: DEFERRED, NO CODE**

**Files (post-design):** none. The design review concluded the tier must not be
built; see the review doc.

- [x] @oracle reviews Sidecar Boundary design (subcommand vs standalone,
      probe handshakes, failure contracts) — decision recorded in spec.
      → **DEFER.** The spec's own probe (`hermes sidecar --version`) targets a
      command that does not exist; OCR and batch are already served in-process;
      semantic retrieval's need is unmeasured and already met by the user's agent
      stack. Review: `docs/superpowers/reviews/2026-10-09-sidecar-design-review.md`.
- [x] Implement `SidecarManager` fail-soft API …
      → **Not applicable (no host, no `SidecarManager`).** Writing fail-soft
      plumbing ahead of a chosen host is the architectural preference DESIGN.md
      rule 1 forbids.
- [x] Provenance: any sidecar-derived result surfaces source path in tool
      metadata.
      → **Not applicable.**
- [x] Commit: `feat: sidecar manager (fail-soft)`.
      → **Superseded by the D0 task below.**

### Task 8b: D0 — in-process full-text search (`/find`) — **DONE**

**Files:** `src/modules/hermes/ItemManager.ts` (`searchFullText`),
`src/modules/hermes/SlashCommands.ts` (`/find`), `test/itemManager.test.ts`,
`test/slashCommands.test.ts`. Spec section: 7b.

- [x] `ItemManager.searchFullText(query, limit=25)`: `fulltextContent` `contains`
      search, attachment→parent mapping, de-dup, drop note children, fail-soft.
- [x] `/find [phrase]` with `add-context:` pills and an honest no-text-layer note.
- [x] Tests: 8 (manager) + 3 (command); suite 315 → **326 passed / 0 failed**.
- [x] Commit: `feat: /find in-process full-text search (D0 tier)`.

---

## Wave 4 — Writing path + release

### Task 9: Inline writing integration

**Files:**

- Modify: `src/modules/hermes/SlashCommands.ts` (`insert-citation:` pill
  handling), `src/views/components/ChatMessageItem.tsx` (pill renderer)
- Test: `test/citationPill.test.ts`

> **AMENDED 2026-10-09 (doc-vs-code conflicts, flagged not silently resolved):**
>
> 1. **Pill renderer lives in `MarkdownRenderer.tsx`, not `ChatMessageItem.tsx`.**
>    All `action:`/`add-context:`/`apply-tag:` pills are rendered as safe-URL
>    inline links by `src/utils/MarkdownRenderer.tsx` (the sandbox-safe path —
>    `ChatMessageItem.tsx` holds the message *toolbar* buttons, not markdown
>    pills). `insert-citation:` was added to `isSafeUrl` + the action-pill class
>    list there, and the click interception joined the existing handler in
>    `HermesChatView.tsx`.
> 2. **Test files split by layer, not one `citationPill.test.ts`.**
>    `test/citationInsert.test.ts` (pure escaping/composition) +
>    `test/noteManagerCitation.test.ts` (the gated write path). The gate is
>    asserted against the real `runWrite` with a recording dialog/audit, matching
>    `writeGates.integration.test.ts`'s convention.
> 3. **Position choice is two pills, not a two-step prompt** — one click fewer,
>    same explicit top/bottom decision. See below.

- [x] Failing tests: `insert-citation` pill on a message with citations →
      opens position choice (top/bottom) → `runWrite` gate on
      `NoteManager.writeNote` path, diff = exact insertion text + position →
      approve applies, reject records blocked.
      → Superseded on target: implemented as TWO pills (top / bottom) rather than
      a two-step position prompt — fewer clicks, same explicit choice. The gate
      is `NoteManager.insertCitationIntoNote`, which routes `runWrite` to a
      `setNote`+`saveTx` apply (the same mutation `writeNote` performs).
- [x] Implement pill flow; reuse `/cite` CSL output unchanged.
- [x] Commit: `feat: insert-citation pill (gated)`.

### Task 10: Ghost-text feasibility spike (report only) — **DONE: DROPPED**

**Files:**

- Create: `docs/superpowers/spikes/ghost-text-spike.md`

- [x] Investigate Zotero 10 note editor hook points (events, overlays,
      sandbox limits) — read-only; produce feasibility report +
      recommendation; update TODO.md + spec open question 3. No code.
      → **INFEASIBLE.** The editor is a content-privileged iframe running
      React + ProseMirror behind a private `postMessage` bridge; no public
      caret/selection, overlay, change-event, or cursor-insertion surface.
      Ghost text dropped from the roadmap.

### Task 11: Release channel verification

**Files:**

- Modify: `.agent/skills/zotero-ops/SKILL.md` (release runbook + channel
  checklist)

- [x] Dry-run locally: `npm run build && npm run release` (scratch);
      confirm `update.json` vs `update-beta.json` branch (version contains
      `-` → beta) and xpi link template resolve.
      → `npm run build` verified the branch: `0.6.0` → `update.json` baked into
      the manifest; `update_hash` matches the built XPI. Live `release` tag
      serves `update.json` (HTTP 200). `npm run release` not run — it creates a
      GitHub release, which the tag push already does in CI (running it by hand
      collides with the workflow).
- [x] Document runbook steps + channel-verification checklist; commit:
      `docs: release runbook`.
      → Added "Release Channel Verification" to `.agent/skills/zotero-ops/SKILL.md`.

**Wave 4 exit:** full suite + build clean; spec conflicts resolved or
flagged (governance rule) in the spec file.
