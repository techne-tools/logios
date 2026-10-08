# Spec — Hermes for Zotero: Next Phase (11 features)

Date: 2026-10-08. Measures against `DESIGN.md` (north star) and `PRODUCT.md`
(intent, validated roadmap: 1. stability → 2. collection synthesis → 3. reader
panel). Feature list = the gap analysis the operator approved in conversation.

## Global constraints (apply to every workstream)

- **Sandbox**: Zotero 10 / Firefox 140 ESR. No `dangerouslySetInnerHTML`, no
  `DOMParser`, native `addEventListener` via refs, `stateRef` pattern for
  native callbacks.
- **Local-first**: ACP/stdio primary; API mode opt-in. No cloud, no telemetry.
- **Human-in-the-loop**: every Zotero write goes through `runWrite` /
  `ApprovalDialog`; every outcome to `AuditLog`. Trash, never erase.
- **Secrets** (DESIGN.md, corrected 2026-10-04): credentials never in Zotero
  prefs, never in logs/audit, never in the codebase.
- **Fail visibly, never silently.**
- **Tests**: `NODE_ENV=test npm test -- --no-watch`; run in background, read
  log, kill process. Mocha/chai in the Zotero sandbox under `test/`.
- **Project skills**: implementers load `.agent/skills/zotero-dev` /
  `zotero-ref` before touching `src/modules/hermes/`.

## 1. Stability infrastructure (roadmap #1)

**Intent**: the plugin can be real-world-tested without embarrassment: tests
prove the core flows, memory stays bounded, UI panels cost nothing until used.

- **In-memory message cap.** `ChatManager` loads/keeps at most the most recent
  `MAX_MEMORY_MESSAGES = 300` messages. Persisted conversation JSON is
  untouched (history stays complete on disk). A marker message notes truncation
  when the user views an older chat.
- **Lazy mounting.** `HermesChatView` mounts heavy panels off their toggles:
  `SidePanels` (conversations drawer), TokenDashboard, reasoning panes render
  only when opened/toggled. Conditional mounting, NOT code splitting (esbuild
  `bundle: true` + sandbox make chunks risky).
- **Integration tests** (new, in `test/`):
  1. end-to-end chat flow (mock client: send → stream → message persisted to
     conversation JSON),
  2. metadata update through `updateItemMetadataGated` (approve → applied +
     audited; reject → nothing),
  3. message-cap behaviour (300-message conversation loads capped, file not
     truncated),
  4. approval-dialog failure forces `runWrite` refusal.
- **Benchmarks**: log-only (no timing asserts) — `extractItemData` × 100
  synthetic items; `ChatManager.setMessages` × 1000. Output to
  `Zotero.debug`, gated behind a benchmark test that runs on demand.

**Success**: `npm test -- --no-watch` green; suite covers the four flows above.

## 2. Secrets vault (doc-code conflict fix)

**Intent**: `DESIGN.md` says vault-never-prefs; today the Hermes API key sits
in `extensions.zotero.hermes.apiKey` (plaintext profile pref). Close the gap.

- **New `src/utils/SecretVault.ts`**: `setSecret(name, value)`,
  `getSecret(name): string | null`, `deleteSecret(name)`, `listSecrets(): string[]`.
  Storage: `<profile>/zotero-hermes/hermes-secrets.json` (ruling amended 2026-10-08: inside the
  existing `zotero-hermes/` profile subdir (same dir as all other plugin data: conversations, workspace), which `zoteroPaths` `ensureHermesDir` already manages —
  the original `<profile>/hermes-secrets.json` root path was spec-authored, not
  operator-set), created `0o600`, written via `putContentsAsync` (async variants
  unless unavailable in the runtime). Values held in-memory for the session. Never logged.
- **Migration** (one-time, `startup hook`): if pref `apiKey` non-empty →
  write vault **first**, verify `getSecret` returns it, then clear the pref,
  then audit-log `permission` entry "migrated apiKey to vault". If vault
  read fails later, `HermesApiClient` falls back to the pref before clearing
  is complete — no silent break of API mode.
- **Readers switch**: `HermesApiClient.getApiKey()` and
  `src/modules/preferenceScript.ts` (connection test) → `getSecret("apiKey")`
  with pref fallback.
- **Prefs UI**: API key field writes to vault; displays masked
  (`••••last4`); "Clear" button = `deleteSecret`.

**Success**: after startup on a migrated profile, pref is empty, vault file
exists `-rw-------`, API mode health check still passes.

## 3. Approval-batch UX

**Intent**: bulk flows (`/bulk-metadata`, tag merges) can enqueue many changes;
the current one-dialog-per-change modal doesn't scale.

- `ApprovalDialog` gains a queue surface: when >1 pending change, render a list
  (action, target, diff) with per-change Approve/Deny plus **Approve All / Deny
  All**. Same modal placement (`<dialog>` in main window). Sandbox-safe:
  native event listeners, no synthetic events.
- New public API: `addPendingChanges(changes: PendingFileChange[]): Promise<boolean[]>`
  — resolves in order, individually dismissible; `addPendingChange` unchanged
  (writeGate compatibility). Each decision audited as its own `permission` entry.

**Success**: a 50-item bulk edit enqueues once; user approves in one pass or
line-by-line; audit log shows 50 decisions.

## 4. Per-tool permission UI polish

**Intent**: replace the coarse Citations/Annotations/Tags toggles with the
actual tool list from `availableCommands`.

- Tool chips in the Feature Toggles area, built from the
  `available_commands` update (names already streamed to the client). Clicking
  a chip toggles it inside/outside the conversation's `allowedTools` set
  (existing schema — `null` = unrestricted, `[]` = block all, list = allow
  list). Persisted with the conversation JSON via `ChatManager`.
- No backend change: `HermesClient`/`HermesApiClient` already transmit the
  restriction text from `allowedTools`.

**Success**: restricting to `["web_search"]` transmits the allow-list
restriction; `[]` still transmits block-all; UI chips survive conversation
resume.

## 5. Collection-level synthesis (roadmap #2)

**Intent**: reasoning across a whole collection, not 25 attached items.

- **New `src/modules/hermes/SynthesisManager.ts`** — pure, testable units:
  - `splitIntoBatches(ids: string[], size = 10): string[][]`,
  - `buildBatchPrompt(batch, focus): string` (per-item one-paragraph summary),
  - `foldPrompt(summaries, focus): string` (comparative synthesis),
  - in-memory cache: `Map<itemId|version, summary>`, LRU cap 200.
- **New slash command `/synthesize [focus]`**: streams over the selected
  collection — per-batch agent turn (summaries cached), then a fold turn.
  One turn per batch, so Stop works between batches; a failed batch records
  its failure and the fold proceeds over successful batches; final render
  lists per-batch status honestly (never "synthesis complete" with 3 failed
  batches unmentioned).
- Read-only: no `runWrite` path. Items enter context via `buildItemContext`.
- Limits: batch size 10; cache session-only.

**Success**: `/synthesize` on a 30-item collection = 3 batch turns + 1 fold;
cancel after batch 2 leaves cache that batch 3 skips on resume; failure of
batch 2 is named in the output.

## 6. Reader-tab sidebar panel (roadmap #3)

**Intent**: chat beside the PDF, not just the library pane.

- **Feasibility spike first** (sandbox reality): inject a collapsible side
  panel into the reader chrome via `Zotero.Reader.registerEventListener`
  ("render" hook), mount the existing `HermesChatView` (same component, own
  conversation instance) at half/quarter width. Pure-DOM host element; React
  root mounted inside; native listeners only.
- If reader injection is blocked by the sandbox → report finding, fall back
  to the library-pane sidebar which already works (spike output = answer,
  nothing kept).
- The panel shares the same ChatManager/ConversationManager storage; the
  reader context (selection, page, item) auto-attaches when the user prompts
  from this surface.

**Success (if feasible)**: opening a PDF tab shows the chat panel toggle;
asking about a selection from the panel attaches that page's context.

## 7. Sidecar tier (additive; degrade-graceful)

**Intent**: capability the plugin genuinely cannot host — embeddings, OCR,
unattended batch — per the Sidecar Boundary in DESIGN.md.

- **Oracle design review required before code.** Skeleton to emerge from that
  review, provisionally: `src/modules/hermes/sidecar/SidecarManager.ts` —
  `isAvailable(): Promise<boolean>` (probe `hermes sidecar --version`),
  `embed(texts)` / `ocr(pdfPath)` / `scheduleBatch(job)`; every method
  fail-soft (resolve-false/-null on absence). Callers degrade: embed absent →
  lexical `fulltextContent` search only; OCR absent → item surfaces "no text
  layer" honestly.
- Pref `enableSidecar` default **false**. Plugin stays fully useful absent.
- Nothing that works in-process moves to the sidecar.

**Success**: with sidecar absent, every existing flow works unchanged; with it
present, semantic search results carry provenance (item + score + path taken).

## 8. Inline writing integration

**Intent**: close research→writing without copy-paste from `/cite`.

- V1 bounds: citation insertion into Zotero notes at **top or bottom** only
  (in-sandbox cursor positioning is the spike question deferred to ghost-text).
- Flow: assistant proposes citations via existing `action:` pills → new pill
  `insert-citation:` → `runWrite` gate targeting `NoteManager.writeNote`
  (diff = exact insertion, position named) → audited.
- Existing citekey/CSL generation from `/cite` is reused; nothing new in
  bibliography logic.

**Success**: user flows a `/cite` answer into a note in ≤3 clicks, all gated
and logged.

## 9. Ghost-text note completion (Tier 1 backlog)

**Intent**: inline suggestions in the note editor.

- **Spike only this phase**: determine what hooks exist in Zotero 10's note
  editor (event interception, overlay feasibility) and whether suggestions can
  render without the sandbox-crashing patterns. Output = feasibility report +
  recommendation; **no implementation either way**. If infeasible → drop from
  roadmap with the finding recorded in TODO.md.

## 10. Release tooling

**Intent**: prove the update channel works before real users.

- Verify end-to-end locally: tag → release workflow → `update.json`/`update-beta.json`
  (the `-`-branch in `zotero-plugin.config.ts`) → Firefox/Zotero update
  mechanism reads valid JSON. Dry-run `npm run release`; document the runbook
  steps in `.agent/skills/zotero-ops/SKILL.md` (release section already
  exists — keep current, add channel-verification checklist).
- Bump `esbuild target` bookkeeping rides the version bump (firefox140, per
  Zotero 10 gotcha list).

**Success**: a beta tag on a scratch build yields `update-beta.json` listing
that build; a clean `release/` channel read confirms stable path.

## 11. Documentation

**Intent**: unblocks roadmap #1 (real-world testing) with words.

- `docs/user-guide.md`: install, connect (ACP vs API + secrets vault),
  attach/context, slash command reference, approval & audit model, personas,
  troubleshooting. `docs/faq.md`: top ~15 questions (binary not found,
  health-check fail, approval dialog, Obsidian path…). Grounded in
  `PRODUCT.md` + the actual command catalogue; **no invented features**.
- Both reviewed against copy rules: grounded, normal wording.

## Open questions (operator discretion)

1. Sidecar runtime: `hermes sidecar` subcommand vs standalone script?
   (Oracle review resolves.)
2. Reader panel: inject into reader chrome vs Zotero primary-pane tab?
   (Designer spike resolves.)
3. Ghost text: feasible in sandbox at all? (Spike resolves.)