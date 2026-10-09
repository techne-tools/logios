import { expect } from "chai";
import {
  DEFAULT_BATCH_SIZE,
  formatBatchReport,
  foldPrompt,
  buildBatchPrompt,
  LruCache,
  MAX_CACHED_SUMMARIES,
  SynthesisManager,
  splitIntoBatches,
  type SynthesisClient,
} from "../src/modules/hermes/SynthesisManager";
import type { ChatSessionUpdate } from "../src/modules/hermes/types";

/**
 * A scriptable SynthesisClient. `sendPrompt` records the prompt and, on the
 * next tick, either streams a summary + stop, or emits an error for a nominated
 * batch index (0-based, counting only the batch turns before the fold).
 */
function makeMockClient(opts: { failPrompt?: number } = {}) {
  const sent: string[] = [];
  let promptIndex = -1;
  const callbacks: Array<(u: ChatSessionUpdate) => void> = [];

  const client: SynthesisClient = {
    cancel: async () => {},
    onUpdate: (cb) => {
      callbacks.push(cb);
      return () => {
        const i = callbacks.indexOf(cb);
        if (i > -1) callbacks.splice(i, 1);
      };
    },
    sendPrompt: async (text) => {
      sent.push(text);
      promptIndex += 1;
      const here = promptIndex;
      const emit = (u: ChatSessionUpdate) =>
        callbacks.slice().forEach((cb) => cb(u));
      setTimeout(() => {
        if (opts.failPrompt !== undefined && here === opts.failPrompt) {
          emit({ type: "error", content: `prompt ${here} failed` });
        } else {
          emit({ type: "message", content: `summary-for-prompt-${here}` });
          emit({ type: "stop" });
        }
      }, 0);
    },
  };

  return { client, sent };
}

const IDS_30 = Array.from({ length: 30 }, (_, i) => `ITEM-${i + 1}`);

describe("SynthesisManager units", function () {
  describe("splitIntoBatches", function () {
    it("splits 30 ids into 3 batches of 10, preserving order", function () {
      const batches = splitIntoBatches(IDS_30);
      expect(batches).to.have.length(3);
      expect(batches[0]).to.deep.equal(IDS_30.slice(0, 10));
      expect(batches[1]).to.deep.equal(IDS_30.slice(10, 20));
      expect(batches[2]).to.deep.equal(IDS_30.slice(20, 30));
      // Every id appears exactly once, in order.
      expect(batches.flat()).to.deep.equal(IDS_30);
    });

    it("puts the remainder in a final short batch", function () {
      const batches = splitIntoBatches(IDS_30, 12);
      expect(batches.map((b) => b.length)).to.deep.equal([12, 12, 6]);
      expect(batches.flat()).to.deep.equal(IDS_30);
    });

    it("returns no batches for an empty id list", function () {
      expect(splitIntoBatches([])).to.deep.equal([]);
    });

    it("defaults to batches of DEFAULT_BATCH_SIZE", function () {
      expect(splitIntoBatches(IDS_30)[0]).to.have.length(DEFAULT_BATCH_SIZE);
    });

    it("rejects a non-positive or non-integer size rather than silently batching", function () {
      expect(() => splitIntoBatches(IDS_30, 0)).to.throw(/positive integer/);
      expect(() => splitIntoBatches(IDS_30, -3)).to.throw(/positive integer/);
      expect(() => splitIntoBatches(IDS_30, 2.5)).to.throw(/positive integer/);
    });
  });

  describe("buildBatchPrompt", function () {
    it("names every item in the batch", function () {
      const batch = ["@a2020", "@b2021", "@c2022"];
      const prompt = buildBatchPrompt(batch, "");
      for (const id of batch) expect(prompt).to.contain(id);
    });

    it("includes the focus when one is given", function () {
      const prompt = buildBatchPrompt(["@a2020"], "acoustic ecology");
      expect(prompt).to.contain("acoustic ecology");
    });

    it("omits the focus clause when the focus is blank", function () {
      const prompt = buildBatchPrompt(["@a2020"], "   ");
      expect(prompt).to.not.contain("Focus each summary on");
    });
  });

  describe("foldPrompt", function () {
    it("contains every batch summary", function () {
      const summaries = ["first summary", "second summary", "third summary"];
      const prompt = foldPrompt(summaries, "");
      for (const s of summaries) expect(prompt).to.contain(s);
    });

    it("includes the focus when given", function () {
      expect(foldPrompt(["s"], "affect")).to.contain("affect");
    });
  });

  describe("LruCache", function () {
    it("returns null for a missing key", function () {
      expect(new LruCache<string>(2).get("nope")).to.equal(null);
    });

    it("evicts the least-recently-used entry at capacity", function () {
      const cache = new LruCache<string>(2);
      cache.put("a", "1");
      cache.put("b", "2");
      cache.put("c", "3"); // evicts a
      expect(cache.get("a")).to.equal(null);
      expect(cache.get("b")).to.equal("2");
      expect(cache.get("c")).to.equal("3");
    });

    it("promotes on get so the read entry survives the next eviction", function () {
      const cache = new LruCache<string>(2);
      cache.put("a", "1");
      cache.put("b", "2");
      cache.get("a"); // a is now most-recently-used
      cache.put("c", "3"); // evicts b instead
      expect(cache.get("a")).to.equal("1");
      expect(cache.get("b")).to.equal(null);
    });

    it("evicts at 201 entries against a 200-entry cap", function () {
      const cache = new LruCache<number>(MAX_CACHED_SUMMARIES);
      for (let i = 0; i < 201; i++) cache.put(`k${i}`, i);
      expect(cache.size).to.equal(MAX_CACHED_SUMMARIES);
      expect(cache.get("k0")).to.equal(null);
      expect(cache.get("k200")).to.equal(200);
    });

    it("rejects a non-positive capacity", function () {
      expect(() => new LruCache<string>(0)).to.throw(/positive integer/);
    });
  });

  describe("formatBatchReport", function () {
    it("names a failed batch and says it is excluded from the fold", function () {
      const report = formatBatchReport({
        batches: [
          { ids: ["a"], status: "success", summary: "s1" },
          { ids: ["b"], status: "failed", error: "prompt 1 failed" },
          { ids: ["c"], status: "success", summary: "s3" },
        ],
        folded: "folded text",
        cancelled: false,
      });
      expect(report).to.contain("Batch 2");
      expect(report).to.contain("failed");
      expect(report).to.contain("prompt 1 failed");
      expect(report).to.contain("excluded");
    });

    it("reports a clean run without failure wording", function () {
      const report = formatBatchReport({
        batches: [{ ids: ["a"], status: "success", summary: "s" }],
        folded: "x",
        cancelled: false,
      });
      expect(report).to.contain("Synthesis complete:");
      expect(report).to.not.contain("failed");
    });

    it("reports cancellation with the batch count reached", function () {
      const report = formatBatchReport({
        batches: [
          { ids: ["a"], status: "success", summary: "s" },
          { ids: ["b"], status: "cancelled" },
        ],
        cancelled: true,
      });
      expect(report).to.contain("cancelled");
      expect(report).to.contain("1 of 2");
    });
  });
});

describe("SynthesisManager.synthesize", function () {
  it("summarises each batch then folds once", async function () {
    const { client, sent } = makeMockClient();
    const manager = new SynthesisManager();

    const outcome = await manager.synthesize(IDS_30, "focus", client);

    // 3 batch turns + 1 fold turn.
    expect(sent).to.have.length(4);
    expect(outcome.batches.map((b) => b.status)).to.deep.equal([
      "success",
      "success",
      "success",
    ]);
    expect(outcome.folded, "a fold was produced").to.be.a("string");
    // The fold prompt carries every batch summary.
    for (let i = 0; i < 3; i++) {
      expect(sent[3]).to.contain(`summary-for-prompt-${i}`);
    }
    expect(outcome.cancelled).to.equal(false);
  });

  it("marks a failed batch, excludes it from the fold, and names it in the report", async function () {
    // Batch #2 (prompt index 1) fails; batch #1 and #3 succeed.
    const { client, sent } = makeMockClient({ failPrompt: 1 });
    const manager = new SynthesisManager();

    const outcome = await manager.synthesize(IDS_30, "", client);

    expect(outcome.batches.map((b) => b.status)).to.deep.equal([
      "success",
      "failed",
      "success",
    ]);
    expect(outcome.batches[1].error).to.contain("prompt 1 failed");

    const fold = sent[sent.length - 1];
    expect(
      fold,
      "failed batch's summary is absent from the fold",
    ).to.not.contain("summary-for-prompt-1");
    expect(fold).to.contain("summary-for-prompt-0");
    expect(fold).to.contain("summary-for-prompt-2");

    expect(formatBatchReport(outcome)).to.contain("Batch 2");
  });

  it("skips a batch whose summary is already cached", async function () {
    const { client, sent } = makeMockClient();
    const manager = new SynthesisManager();

    // Pre-seed the cache for batch #1's ids (10 ids, sorted join is the key).
    const firstBatch = splitIntoBatches(IDS_30)[0];
    const cachedKey = [...firstBatch].sort().join("\u0000");
    manager.putSummary(cachedKey, "cached summary");

    const outcome = await manager.synthesize(IDS_30, "", client);

    // Only 2 batch turns (batches #2, #3) + 1 fold.
    expect(sent).to.have.length(3);
    expect(outcome.batches[0].status).to.equal("cached");
    expect(outcome.batches[0].summary).to.equal("cached summary");
    expect(sent[sent.length - 1]).to.contain("cached summary");
  });

  it("cancels between batches without folding", async function () {
    const { client, sent } = makeMockClient();
    const manager = new SynthesisManager();

    let batchesDone = 0;
    const outcome = await manager.synthesize(IDS_30, "", client, {
      shouldCancel: () => batchesDone++ >= 1, // cancel once the first batch has started
    });

    expect(outcome.cancelled).to.equal(true);
    expect(outcome.folded).to.be.undefined;
    expect(outcome.batches.some((b) => b.status === "cancelled")).to.equal(
      true,
    );
    // No fold prompt was sent.
    expect(sent).to.not.contain(foldPrompt(["x"], ""));
    expect(sent[sent.length - 1]).to.not.contain("Fold them into a");
  });
});
