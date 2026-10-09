import { expect } from "chai";
import { ApprovalDialog } from "../src/modules/hermes/ApprovalDialog";
import type { PendingFileChange } from "../src/modules/hermes/types";
import type Addon from "../src/addon";

/**
 * Batch approval queue.
 *
 * The single-change dialog is covered by `writeGate.test.ts` and
 * `writeGates.integration.test.ts`; those must stay green. This suite covers
 * the ADDED multi-change path: one modal listing N changes, each with its own
 * Approve/Deny, plus Approve All / Deny All.
 *
 * Everything here is sandbox-safe: a fake DOM good enough for the
 * `createElement`-only path, native click/cancel dispatch, and the
 * spread-overlay trick for the `Zotero` global (never replace it — the test
 * reporter needs the real object; see AGENTS.md).
 */

interface FakeEl {
  tagName: string;
  className: string;
  textContent: string;
  style: Record<string, unknown>;
  children: FakeEl[];
  listeners: Record<string, Array<(e: unknown) => void>>;
  appendChild(child: FakeEl): FakeEl;
  remove(): void;
  addEventListener(type: string, cb: (e: unknown) => void): void;
  showModal(): void;
  click(): void;
  dispatch(type: string): void;
}

let createdEls: FakeEl[] = [];

function makeFakeDoc(): unknown {
  createdEls = [];
  const makeEl = (tag: string): FakeEl => {
    const el: FakeEl = {
      tagName: tag,
      className: "",
      textContent: "",
      style: {},
      children: [],
      listeners: {},
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      remove() {
        /* no-op */
      },
      addEventListener(type, cb) {
        (this.listeners[type] ||= []).push(cb);
      },
      showModal() {
        /* no-op — the test dispatches clicks directly */
      },
      click() {
        for (const cb of this.listeners["click"] || []) cb({});
      },
      dispatch(type) {
        for (const cb of this.listeners[type] || [])
          cb({ preventDefault() {} });
      },
    };
    createdEls.push(el);
    return el;
  };
  return {
    createElement: (tag: string) => makeEl(tag),
    documentElement: makeEl("html"),
  };
}

/** Elements whose className has `cls` as an exact class token, in creation order. */
function elsWithClass(cls: string): FakeEl[] {
  return createdEls.filter((e) => e.className.split(/\s+/).includes(cls));
}

/** Poll until at least `n` elements with this class exist (render is async). */
async function waitForEls(cls: string, n: number): Promise<FakeEl[]> {
  for (let i = 0; i < 100; i++) {
    const found = elsWithClass(cls);
    if (found.length >= n) return found;
    await new Promise((r) => setTimeout(r, 5));
  }
  return elsWithClass(cls);
}

interface AuditRecord {
  action: string;
  details: string;
  status: string;
  metadata?: Record<string, unknown>;
}

function change(
  id: string,
  path: string,
  action: PendingFileChange["action"] = "modify",
): PendingFileChange {
  return {
    action,
    id,
    newContent: `${id} — new content`,
    path,
    status: "pending",
    timestamp: Date.now(),
  };
}

/** An addon with a REAL ApprovalDialog and a recording audit sink. */
function makeAddon() {
  const audits: AuditRecord[] = [];
  const auditLog = {
    record: (
      action: string,
      details: string,
      status: string,
      metadata?: Record<string, unknown>,
    ) => {
      audits.push({ action, details, status, metadata });
    },
  };
  const addon: any = {
    data: { hermes: { auditLog, approvalDialog: null } },
    log: () => {},
  };
  const dialog = new ApprovalDialog(addon as Addon);
  addon.data.hermes.approvalDialog = dialog;
  return { addon: addon as Addon, audits, dialog };
}

/** Spread-overlay the Zotero global; never replace it (AGENTS.md). */
function withZotero(opts: { getMainWindow?: () => unknown }) {
  const real = (globalThis as any).Zotero;
  (globalThis as any).__realZoteroBatch = real;
  (globalThis as any).Zotero = {
    ...real,
    getMainWindow: opts.getMainWindow ?? real?.getMainWindow,
  };
}

function restoreZotero() {
  if ((globalThis as any).__realZoteroBatch) {
    (globalThis as any).Zotero = (globalThis as any).__realZoteroBatch;
    delete (globalThis as any).__realZoteroBatch;
  }
}

describe("ApprovalDialog — batch approval queue", function () {
  afterEach(function () {
    restoreZotero();
    createdEls = [];
  });

  it("resolves one answer per change, in the order they were queued", async function () {
    withZotero({ getMainWindow: () => ({ document: makeFakeDoc() }) });
    const { dialog, audits } = makeAddon();

    const pending = dialog.addPendingChanges([
      change("a", "Modify — Paper A"),
      change("b", "Modify — Paper B"),
      change("c", "Modify — Paper C"),
    ]);

    const approves = await waitForEls("hermes-btn-approve", 3);
    const denies = await waitForEls("hermes-btn-deny", 3);
    expect(approves.length, "three per-row Approve buttons").to.equal(3);
    expect(denies.length, "three per-row Deny buttons").to.equal(3);

    // Decide out of order of the buttons: approve row 0, deny row 1, approve row 2.
    approves[0].click();
    approves[2].click();
    denies[1].click();

    const result = await pending;
    expect(result).to.deep.equal([true, false, true]);

    // Each decision writes its own `permission` audit entry.
    expect(audits).to.have.length(3);
    expect(audits.every((a) => a.action === "permission")).to.equal(true);
    expect(audits.map((a) => a.status)).to.deep.equal([
      "success",
      "blocked",
      "success",
    ]);
    expect(audits.map((a) => a.details)).to.deep.equal([
      "Modify — Paper A",
      "Modify — Paper B",
      "Modify — Paper C",
    ]);
  });

  it("Approve All resolves every change true", async function () {
    withZotero({ getMainWindow: () => ({ document: makeFakeDoc() }) });
    const { dialog, audits } = makeAddon();

    const pending = dialog.addPendingChanges([
      change("a", "Modify — A"),
      change("b", "Modify — B"),
      change("c", "Modify — C"),
    ]);

    const approveAll = await waitForEls("hermes-btn-approve-all", 1);
    expect(approveAll.length).to.equal(1);
    approveAll[0].click();

    const result = await pending;
    expect(result).to.deep.equal([true, true, true]);
    expect(audits.map((a) => a.status)).to.deep.equal([
      "success",
      "success",
      "success",
    ]);
  });

  it("Deny All resolves every change false (never applied)", async function () {
    withZotero({ getMainWindow: () => ({ document: makeFakeDoc() }) });
    const { dialog, audits } = makeAddon();

    const pending = dialog.addPendingChanges([
      change("a", "Modify — A"),
      change("b", "Modify — B"),
    ]);

    const denyAll = await waitForEls("hermes-btn-deny-all", 1);
    denyAll[0].click();

    const result = await pending;
    expect(result).to.deep.equal([false, false]);
    expect(audits.every((a) => a.status === "blocked")).to.equal(true);
  });

  it("dismissing the modal leaves undecided changes denied, never applied", async function () {
    withZotero({ getMainWindow: () => ({ document: makeFakeDoc() }) });
    const { dialog, audits } = makeAddon();

    const pending = dialog.addPendingChanges([
      change("a", "Modify — A"),
      change("b", "Modify — B"),
      change("c", "Modify — C"),
    ]);

    const approves = await waitForEls("hermes-btn-approve", 3);
    // Decide row 0 only, then Escape the dialog.
    approves[0].click();
    const dialogEl = elsWithClass("hermes-approval-dialog-batch")[0];
    expect(dialogEl, "batch dialog element").to.exist;
    dialogEl.dispatch("cancel");

    const result = await pending;
    expect(result).to.deep.equal([true, false, false]);
    expect(audits.map((a) => a.status)).to.deep.equal([
      "success",
      "blocked",
      "blocked",
    ]);
  });

  it("when the modal fails to render, every change is audited blocked and nothing stays pending", async function () {
    // getMainWindow throws → showBatchDialog rejects → the batch never applies.
    withZotero({
      getMainWindow: () => {
        throw new Error("no main window");
      },
    });
    const { dialog, audits } = makeAddon();

    let rejected = false;
    try {
      await dialog.addPendingChanges([
        change("a", "Modify — A"),
        change("b", "Modify — B"),
        change("c", "Modify — C"),
      ]);
    } catch {
      rejected = true;
    }

    expect(rejected, "batch rejects when the dialog cannot render").to.equal(
      true,
    );
    expect(audits).to.have.length(3);
    expect(audits.every((a) => a.status === "blocked")).to.equal(true);
    // Nothing left pending for a later apply to pick up.
    expect(dialog.getPendingChange("a")).to.equal(undefined);
    expect(dialog.getPendingChange("b")).to.equal(undefined);
    expect(dialog.getPendingChange("c")).to.equal(undefined);
  });

  it("resolves an empty batch without opening a dialog", async function () {
    withZotero({ getMainWindow: () => ({ document: makeFakeDoc() }) });
    const { dialog, audits } = makeAddon();

    const result = await dialog.addPendingChanges([]);
    expect(result).to.deep.equal([]);
    expect(audits).to.have.length(0);
    expect(elsWithClass("hermes-approval-dialog").length).to.equal(0);
  });
});
