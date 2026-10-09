# Design review: the sidecar tier (Task 8)

**Date:** 2026-10-09
**Gate:** `@oracle` design review required before sidecar code (plan Task 8,
step 1; spec §7).
**Verdict: DEFER.** Do not build a sidecar tier now. Nothing in it survives the
boundary rules; two of its three capabilities are already served in-process.
**Consequence:** Task 8 is closed without code. The real gap — D0, in-process
lexical **full-text** search — is exposed instead (`/find`).

---

## Method

Two independent passes, run in parallel, each told to verify CLI facts with real
commands rather than trust the spec:

1. **Architect** — design the host mechanism, probe, failure contracts, and
   first tier.
2. **Red team** — falsify the need outright: for each capability, is there a
   cheaper in-process answer?

Their findings were then re-checked by hand before being recorded. Where the two
disagreed, the disagreement is stated below rather than averaged away.

## The spec's premise is measurably false

Spec §7 specifies `isAvailable()` probing **`hermes sidecar --version`** — and
**`hermes` has no `sidecar` command at all**:

```
$ hermes sidecar --version
hermes: 'sidecar' is not a `hermes` command.   (rc=2)
$ hermes --help | grep -icE 'embed|ocr|vector|semantic'
0
```

[measured] There is no Hermes embedding surface and no Hermes OCR surface. A
`SidecarManager` written against that probe would always resolve `false`: the
tier would be theatre. This alone means the skeleton in spec §7 cannot ship.

## Per-capability audit

| Capability                          | Spec says "sidecar" | What the review found                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OCR of scanned PDFs**             | sidecar             | **Falsified as a sidecar need.** tesseract 5.5.3, ocrmypdf 17.13.0, pdftotext are already installed [measured: `tesseract --version`, `ocrmypdf --version`, `which`] and reach the plugin through the same `Subprocess.sys.mjs` path it already uses for `hermes acp` (`HermesClient.ts:177-191`). No daemon required.                                                                                                                      |
| **Long unattended batch**           | sidecar             | **Falsified.** `SynthesisManager.ts` already batches, folds, cancels between batches, and caches resumable summaries in-process [measured]. Multi-hour scheduling already exists as `hermes cron` [measured: `hermes cron --help`]. The daemon buys no new capability.                                                                                                                                                                      |
| **Embeddings / semantic retrieval** | sidecar             | **Survives — but the need is unmeasured, and the capability already exists in the user's stack.** A Firefox 140 sandbox cannot host an embedding model cheaply [inferred, not benchmarked]. But the user's agent already runs an external memory provider (`noema`, active) and a qdrant-backed memory MCP (`hermes-memory`, enabled) [measured: `hermes memory status`, `hermes mcp list`]. A plugin-owned index would duplicate, not add. |

## Where the two reviewers disagreed

The **architect** proposed a _loopback HTTP capability service_ as the host:
a small server the user installs, probed with `Zotero.HTTP.request`. That is a
reasonable mechanism **if** the capability were worth hosting — but the red team
falsified the OCR and batch cases with installed-binary evidence, leaving only
semantic retrieval. A loopback service for a _stateless_ OCR call is exactly the
"daemon for tidiness" DESIGN.md rule 1 forbids; and a loopback service does not
solve semantic retrieval's real cost (a durable index synced to a mutable
library), which is the daemon lifecycle rule 1 warns about.

The architect's one genuinely useful finding was incidental and is recorded
separately: the ACP adapter honours **per-session MCP servers**
(`acp_adapter/server.py:170/427/616`) and **the plugin leaves that field empty**
(`HermesClient.ts:827 mcpServers: []`). That is a real, in-process way to expose
Zotero data _to the agent_, and it must not be mislabelled "the sidecar tier".

## Decision

1. **No `SidecarManager`, no daemon, no pref.** Task 8 closes without code.
   Building fail-soft plumbing ahead of a chosen host is the architectural
   preference rule 1 forbids.
2. **Correct spec §7** — the fictional probe is replaced with this finding.
3. **Build D0 instead.** The plan's first tier was "lexical full-text search, no
   sidecar". It was never _exposed_: `/search` queries metadata only
   (`quicksearch-titleCreatorYear`), while Zotero's in-process `fulltextContent`
   condition — the same index the reader's search box uses — sat unused. That is
   the honest, infrastructure-free gap, and it now ships as `/find`.
4. **Gate any future index on a measured recall failure.** If semantic retrieval
   is ever warranted, route it through the ACP agent's existing memory surface
   using the already-unused `mcpServers` field, not a new process.

## What would reopen this

- A logged, reproducible recall failure on the real library: a query that should
  match a known item returns nothing via `/find`, and a semantic retry fixes it.
- Evidence that the Zotero sandbox forbids spawning external binaries — which
  would move OCR back into the "unhostable" column.
- A portability decision that the shipped plugin must not depend on the user's
  own Hermes memory stack — which would make a bounded, single-purpose local
  index (not a general daemon) warranted.

## Open risks (unverified, do not act on)

- The process holding TCP **9119** is unconfirmed (`lsof` → PID 1556 under
  `~/.hermes/tools`), yet `hermes serve --status` reports no serve process
  running. Identity unverified; nothing binds to it.
- `Zotero.Server.Endpoints` (port 23119) as an agent-facing tool surface is
  carried from `docs/PLAN-library-operations.md` and was **not** re-verified.
- The ACP per-session MCP path is proven in the adapter source but untested
  end-to-end from inside the Zotero sandbox.
