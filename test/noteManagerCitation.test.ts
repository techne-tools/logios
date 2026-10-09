import { expect } from "chai";
import { NoteManager } from "../src/modules/hermes/NoteManager";

/**
 * The gated citation write path.
 *
 * These tests drive `NoteManager.insertCitationIntoNote` against the REAL
 * `runWrite` with a recording approval dialog + audit log, so the ordering the
 * user depends on (approve → apply → record; reject → record blocked → no
 * mutation) is asserted end to end for the citation flow, not just in
 * `writeGate.test.ts`'s abstract stub.
 */

/** A recording write context: captures approvals, audits, and the saved note. */
function makeHarness(
  opts: {
    approve?: boolean;
    throwOnApprove?: boolean;
    note?: any;
    parent?: any;
  } = {},
) {
  const approvals: any[] = [];
  const audits: Array<{ action: string; details: string; status: string }> = [];
  let savedContent: string | null = null;

  const note = opts.note ?? {
    id: 42,
    itemType: "note",
    getNote: () => "<p>Existing body.</p>",
    setNote: (c: string) => {
      savedContent = c;
    },
    saveTx: async () => {},
  };

  const approvalDialog = {
    addPendingChange: async (change: any) => {
      approvals.push(change);
      if (opts.throwOnApprove) throw new Error("dialog exploded");
      return opts.approve ?? true;
    },
  };
  const auditLog = {
    record: (action: string, details: string, status: string) => {
      audits.push({ action, details, status });
    },
  };

  const addon: any = {
    log: () => {},
    data: { hermes: { approvalDialog, auditLog } },
  };

  return {
    manager: new NoteManager(addon),
    approvals,
    audits,
    note,
    parent: opts.parent,
    getSavedContent: () => savedContent,
  };
}

/** Overlay the real Zotero global, overriding only Items.getAsync. */
function stubGetAsync(map: Map<number, any>) {
  const realZotero = (globalThis as any).Zotero;
  if (!(globalThis as any).__realZotero) {
    (globalThis as any).__realZotero = realZotero;
  }
  (globalThis as any).Zotero = {
    ...realZotero,
    Items: { getAsync: async (id: number) => map.get(id) ?? null },
  };
}

describe("NoteManager.insertCitationIntoNote", function () {
  after(function () {
    if ((globalThis as any).__realZotero) {
      (globalThis as any).Zotero = (globalThis as any).__realZotero;
      delete (globalThis as any).__realZotero;
    }
  });

  it("fails soft when neither a note nor a parent is supplied", async function () {
    const { manager, approvals } = makeHarness();
    const result = await manager.insertCitationIntoNote({
      citation: "(Lee, 2024)",
      position: "bottom",
    });
    expect(result.status).to.equal("failed");
    expect(result.error).to.match(/no target/i);
    // No prompt should have been raised for a write that cannot happen.
    expect(approvals).to.have.length(0);
  });

  it("appends to an existing note, then records success", async function () {
    const { manager, approvals, audits } = makeHarness();
    const savedContentRef = { value: null as string | null };
    const note = {
      id: 42,
      itemType: "note",
      getNote: () => "<p>Existing body.</p>",
      setNote: (c: string) => {
        savedContentRef.value = c;
      },
      saveTx: async () => {},
    };
    stubGetAsync(new Map([[42, note]]));

    const result = await manager.insertCitationIntoNote({
      citation: "(Lee, 2024)",
      position: "bottom",
      noteID: 42,
      styleName: "APA 7th",
    });

    expect(result.status).to.equal("success");
    expect(result.noteID).to.equal(42);
    expect(savedContentRef.value).to.equal(
      "<p>Existing body.</p>\n<p>(Lee, 2024)</p>",
    );
    // One approval was requested, naming the position and the style.
    expect(approvals).to.have.length(1);
    expect(approvals[0].newContent).to.include("bottom of the note");
    expect(approvals[0].newContent).to.include("Style: APA 7th");
    expect(approvals[0].newContent).to.include("<p>(Lee, 2024)</p>");
    // Success recorded as a file_change.
    expect(audits.some((a) => a.status === "success")).to.equal(true);
  });

  it("does NOT mutate the note when the user rejects, and records blocked", async function () {
    let saved: string | null = null;
    const note = {
      id: 42,
      itemType: "note",
      getNote: () => "<p>Existing body.</p>",
      setNote: (c: string) => {
        saved = c;
      },
      saveTx: async () => {},
    };
    const { manager, audits } = makeHarness({ approve: false });
    stubGetAsync(new Map([[42, note]]));

    const result = await manager.insertCitationIntoNote({
      citation: "(Lee, 2024)",
      position: "top",
      noteID: 42,
    });

    expect(result.status).to.equal("rejected");
    expect(saved).to.be.null;
    expect(audits.some((a) => a.status === "blocked")).to.equal(true);
    expect(audits.some((a) => a.status === "success")).to.equal(false);
  });

  it("fails (never silently permits) when the approval dialog throws", async function () {
    let saved: string | null = null;
    const note = {
      id: 42,
      itemType: "note",
      getNote: () => "<p>Existing body.</p>",
      setNote: (c: string) => {
        saved = c;
      },
      saveTx: async () => {},
    };
    const { manager } = makeHarness({ throwOnApprove: true });
    stubGetAsync(new Map([[42, note]]));

    const result = await manager.insertCitationIntoNote({
      citation: "(Lee, 2024)",
      position: "bottom",
      noteID: 42,
    });

    expect(result.status).to.equal("failed");
    expect(saved).to.be.null;
  });

  it("throws when a named note id does not resolve to a note", async function () {
    const { manager } = makeHarness();
    stubGetAsync(new Map()); // nothing resolves

    let threw = false;
    try {
      await manager.insertCitationIntoNote({
        citation: "(Lee, 2024)",
        position: "bottom",
        noteID: 999,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).to.include("999");
    }
    expect(threw).to.equal(true);
  });

  it("throws when the parent item for a new note does not exist", async function () {
    const { manager } = makeHarness();
    stubGetAsync(new Map());

    let threw = false;
    try {
      await manager.insertCitationIntoNote({
        citation: "(Lee, 2024)",
        position: "bottom",
        parentItemID: 500,
      });
    } catch (err) {
      threw = true;
      expect((err as Error).message).to.include("500");
    }
    expect(threw).to.equal(true);
  });

  it("refuses an empty citation before prompting", async function () {
    const note = {
      id: 42,
      itemType: "note",
      getNote: () => "<p>Existing.</p>",
      setNote: () => {},
      saveTx: async () => {},
    };
    const { manager, approvals } = makeHarness();
    stubGetAsync(new Map([[42, note]]));

    let threw = false;
    try {
      await manager.insertCitationIntoNote({
        citation: "   ",
        position: "bottom",
        noteID: 42,
      });
    } catch {
      threw = true;
    }
    expect(threw).to.equal(true);
    expect(approvals).to.have.length(0);
  });
});
