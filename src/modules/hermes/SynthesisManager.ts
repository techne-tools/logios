/**
 * Collection-level synthesis.
 *
 * WHY THIS EXISTS
 * ---------------
 * `/compare` and friends hand the whole attached set to the agent in one turn.
 * That does not scale: a 60-item collection overflows the context window and
 * the model silently truncates, so the "synthesis" quietly covers only the head
 * of the collection. `/synthesize` instead summarises in bounded batches, then
 * folds the per-batch summaries into one synthesis.
 *
 * The batch/fold/cache units are **pure** (no Zotero imports) so they test
 * without a live Zotero. The orchestration takes a minimal client interface,
 * injected, so a mock client can drive the failure and cache paths.
 */

import type { ChatSessionUpdate, PromptContextItem } from "./types";

/** Items per summarisation batch. Kept small enough to stay well inside context. */
export const DEFAULT_BATCH_SIZE = 10;

/** Maximum per-batch summaries retained in the LRU cache. */
export const MAX_CACHED_SUMMARIES = 200;

/**
 * Process-wide cancel signal for an in-flight `/synthesize` run.
 *
 * The sidebar's Stop button aborts the *in-flight* stream via `client.cancel()`,
 * but a multi-batch synthesis is a sequence of turns — stopping between them
 * needs a flag the loop can poll. The view trips `request()`; the command clears
 * it at the start of each run so a stale flag cannot abort the next one.
 */
export const synthesisCancel = {
  requested: false,
  request(): void {
    this.requested = true;
  },
  clear(): void {
    this.requested = false;
  },
};

/**
 * The slice of `ChatClient` the synthesis loop needs. Declared structurally so
 * tests can pass a stub without a live transport.
 */
export interface SynthesisClient {
  cancel(): Promise<void>;
  onUpdate(callback: (update: ChatSessionUpdate) => void): () => void;
  sendPrompt(
    text: string,
    contextItems?: PromptContextItem[],
    options?: { allowedTools?: string[] | null },
  ): Promise<void>;
}

/** Outcome of one batch turn. */
export interface BatchOutcome {
  ids: string[];
  status: "success" | "failed" | "cached" | "cancelled";
  /** Present when status is `success` or `cached`. */
  summary?: string;
  /** Present when status is `failed`. */
  error?: string;
}

export interface SynthesisOutcome {
  batches: BatchOutcome[];
  /** The folded synthesis, when at least one batch produced a summary. */
  folded?: string;
  cancelled: boolean;
}

/**
 * Split ids into consecutive batches of at most `size`.
 *
 * Order is preserved and every id appears exactly once. A non-positive size is
 * a programming error, not a silent empty result.
 */
export function splitIntoBatches(
  ids: string[],
  size: number = DEFAULT_BATCH_SIZE,
): string[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error(
      `splitIntoBatches: size must be a positive integer, got ${size}`,
    );
  }
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    batches.push(ids.slice(i, i + size));
  }
  return batches;
}

/**
 * Build the prompt for one batch: an instruction to summarise each named item,
 * the item list, and the optional focus.
 */
export function buildBatchPrompt(batch: string[], focus: string): string {
  const trimmedFocus = focus.trim();
  const focusLine = trimmedFocus
    ? `\nFocus each summary on: "${trimmedFocus}".`
    : "";
  const items = batch.map((id, i) => `${i + 1}. ${id}`).join("\n");
  return (
    `Summarise each of the following ${batch.length} item(s) individually, in one ` +
    `paragraph each. Label every paragraph with the item's identifier exactly as ` +
    `given. Do not merge items or omit any.\n\n${items}${focusLine}`
  );
}

/**
 * Build the final fold prompt from the per-batch summaries. Failed batches are
 * excluded by the caller before this is called.
 */
export function foldPrompt(summaries: string[], focus: string): string {
  const trimmedFocus = focus.trim();
  const focusLine = trimmedFocus ? ` with a focus on "${trimmedFocus}"` : "";
  const body = summaries
    .map((summary, i) => `--- Batch ${i + 1} ---\n${summary}`)
    .join("\n\n");
  return (
    `Below are per-batch summaries of a research collection. Fold them into a ` +
    `single coherent synthesis${focusLine}. Identify cross-cutting themes, ` +
    `points of agreement and disagreement, and open questions. Cite items by ` +
    `their given identifiers.\n\n${body}`
  );
}

/**
 * Least-recently-used cache with a fixed capacity. `get` promotes an entry;
 * insertion past capacity evicts the least recently used.
 */
export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(
        `LruCache: capacity must be a positive integer, got ${capacity}`,
      );
    }
  }

  public get(key: string): V | null {
    if (!this.map.has(key)) return null;
    const value = this.map.get(key) as V;
    // Re-insert to mark as most recently used.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  public has(key: string): boolean {
    return this.map.has(key);
  }

  public put(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  public get size(): number {
    return this.map.size;
  }
}

/**
 * Render a human-readable per-batch report, naming every failed batch. This is
 * what the user sees, and what stops a partial failure from reading as success.
 */
export function formatBatchReport(outcome: SynthesisOutcome): string {
  if (outcome.batches.length === 0) return "Nothing to synthesise.";
  const lines = outcome.batches.map((batch, i) => {
    const label = `Batch ${i + 1} (${batch.ids.length} item${batch.ids.length === 1 ? "" : "s"})`;
    if (batch.status === "failed") {
      return `- ${label}: **failed** — ${batch.error || "unknown error"}`;
    }
    if (batch.status === "cached") return `- ${label}: cached`;
    if (batch.status === "cancelled") return `- ${label}: cancelled`;
    return `- ${label}: summarised`;
  });

  const failed = outcome.batches.filter((b) => b.status === "failed").length;
  let header: string;
  if (outcome.cancelled) {
    const done = outcome.batches.filter(
      (b) => b.status === "success" || b.status === "cached",
    ).length;
    header = `Synthesis cancelled after ${done} of ${outcome.batches.length} batch(es).`;
  } else if (failed > 0) {
    header = `Synthesis complete with ${failed} failed batch(es). Failed batches are excluded from the fold:`;
  } else {
    header = "Synthesis complete:";
  }

  const status = `${header}\n${lines.join("\n")}`;
  return outcome.folded ? `${status}\n\n${outcome.folded}` : status;
}

/**
 * Drives batched synthesis over a chat client.
 *
 * A batch is skipped entirely when its summary is already cached. Failed
 * batches are recorded and excluded from the fold — a failure never silently
 * degrades the synthesis.
 */
export class SynthesisManager {
  private readonly cache = new LruCache<string>(MAX_CACHED_SUMMARIES);

  public getSummary(id: string): string | null {
    return this.cache.get(id);
  }

  public putSummary(id: string, summary: string): void {
    this.cache.put(id, summary);
  }

  /** Canonical cache key for a batch — order-insensitive within the batch. */
  private static batchKey(ids: string[]): string {
    return [...ids].sort().join("\u0000");
  }

  /**
   * Run a single streamed turn, collecting assistant text until the turn stops.
   * Resolves with `error` set if the turn reports one.
   */
  private runTurn(
    client: SynthesisClient,
    prompt: string,
  ): Promise<{ text: string; error?: string }> {
    return new Promise((resolve) => {
      let text = "";
      let settled = false;
      let unsubscribe: () => void = () => {};
      const finish = (result: { text: string; error?: string }) => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(result);
      };
      unsubscribe = client.onUpdate((update) => {
        if (update.type === "message" && update.content) {
          text += update.content;
        } else if (update.type === "error") {
          finish({ text, error: update.content || "stream error" });
        } else if (update.type === "stop") {
          finish({ text });
        }
      });
      void client.sendPrompt(prompt);
    });
  }

  /**
   * Synthesise `ids` in batches of `size`, then fold. `shouldCancel` is polled
   * between batches so a Stop request ends the run without a partial fold.
   */
  public async synthesize(
    ids: string[],
    focus: string,
    client: SynthesisClient,
    opts: { size?: number; shouldCancel?: () => boolean } = {},
  ): Promise<SynthesisOutcome> {
    const batches = splitIntoBatches(ids, opts.size ?? DEFAULT_BATCH_SIZE);
    const outcomes: BatchOutcome[] = [];
    let cancelled = false;

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

      if (opts.shouldCancel?.()) {
        cancelled = true;
        // Everything from here on, including this batch, is cancelled.
        for (let j = i; j < batches.length; j++) {
          outcomes.push({ ids: batches[j], status: "cancelled" });
        }
        break;
      }

      const key = SynthesisManager.batchKey(batch);
      const cached = this.getSummary(key);
      if (cached !== null) {
        outcomes.push({ ids: batch, status: "cached", summary: cached });
        continue;
      }

      const turn = await this.runTurn(client, buildBatchPrompt(batch, focus));
      if (turn.error) {
        outcomes.push({ ids: batch, status: "failed", error: turn.error });
        continue;
      }
      this.putSummary(key, turn.text);
      outcomes.push({ ids: batch, status: "success", summary: turn.text });
    }

    const summaries = outcomes
      .filter((b) => b.status === "success" || b.status === "cached")
      .map((b) => b.summary as string);

    let folded: string | undefined;
    if (!cancelled && summaries.length > 0) {
      const fold = await this.runTurn(client, foldPrompt(summaries, focus));
      folded = fold.error ? undefined : fold.text;
    }

    return { batches: outcomes, folded, cancelled };
  }
}
