import { expect } from "chai";
import { ItemManager } from "../src/modules/hermes/ItemManager";
import { ApprovalDialog } from "../src/modules/hermes/ApprovalDialog";
import type Addon from "../src/addon";

/**
 * Cross-module write-gate integration.
 *
 * WHY THIS FILE EXISTS (and what it is not)
 * -----------------------------------------
 * The unit suites already cover the pieces:
 *   - `writeGate.test.ts`     — runWrite ordering with a stub dialog.
 *   - `itemManager.test.ts`   — updateItemMetadataGated with a stub dialog
 *                               (denied path only).
 *   - `approvalDialog.test.ts`(if present) — dialog mechanics in isolation.
 *
 * What none of them exercise is the *real chain*: a real `ApprovalDialog`
 * instance, clicking its real buttons, driving `runWrite` through
 * `ItemManager.updateItemMetadataGated` to a real `item.saveTx()`, with one
 * audit sink observing both the dialog's permission entry and writeGate's
 * file_change entry. That is the safety path a user actually depends on, and
 * it is what this file asserts.
 *
 * A previous version of this file asserted nothing of the sort — it only
 * checked that a ChatManager held a few messages after `dispatchExternalPrompt`
 * (which returns a subscriber count, not a promise). It has been replaced.
 */

/** Let all pending microtasks (and the dialog's first macrotask) drain. */
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Poll until an element with the given class appears, or give up. The approval
 * dialog opens after `Zotero.Items.getAsync` resolves, so the button is not
 * present synchronously.
 */
async function waitForEl(
  className: string,
  tries = 50,
): Promise<FakeEl | undefined> {
  for (let i = 0; i < tries; i++) {
    const found = createdEls.find((e) => e.className === className);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 5));
  }
  return undefined;
}

/** Diagnostic: every element class/tag created so far (for failure messages). */
function createdSummary(): string {
  return createdEls.map((e) => e.className || e.tagName).join(", ") || "(none)";
}

/** Fake DOM node good enough for ApprovalDialog's createElement path. */
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
        /* no-op — the test clicks buttons directly */
      },
      click() {
        for (const cb of this.listeners["click"] || []) cb({});
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

function findEl(className: string): FakeEl | undefined {
  return createdEls.find((e) => e.className === className);
}

/** Minimal mock Zotero.Item — mirrors the shape used in itemManager.test.ts. */
function mockItem(overrides: Record<string, unknown> = {}) {
  const fields = new Map<string, string>(
    Object.entries((overrides.fields as Record<string, string>) || {}),
  );
  let creators = (overrides.creators as any[]) || [];
  let saved = false;
  return {
    id: (overrides.id as number) ?? 1,
    key: (overrides.key as string) ?? "ABC123",
    itemType: (overrides.itemType as string) ?? "journalArticle",
    getField: (name: string) => fields.get(name) || "",
    setField: (name: string, val: string) => {
      fields.set(name, val);
    },
    getCreators: () => creators,
    setCreators: (next: any[]) => {
      creators = next;
    },
    getTags: () => [],
    getBestAttachment: async () => false,
    getDisplayTitle: () => fields.get("title") || "Untitled",
    saveTx: async () => {
      saved = true;
    },
    isSaved: () => saved,
  } as unknown as Zotero.Item & { isSaved(): boolean };
}

interface AuditRecord {
  action: string;
  details: string;
  status: string;
  metadata?: Record<string, unknown>;
}

/**
 * An addon with a REAL ApprovalDialog and a recording audit sink. Both the
 * dialog and writeGate write to the same `auditLog`, so the test can assert on
 * the combined trail.
 */
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
  addon.data.hermes.approvalDialog = new ApprovalDialog(addon as Addon);
  return { addon: addon as Addon, audits };
}

/**
 * Spread-overlay the Zotero global (never replace it — the test reporter needs
 * the real object for HTTP streaming and shutdown; see AGENTS.md).
 */
function withZotero(opts: {
  items?: Map<number, unknown>;
  getMainWindow?: () => unknown;
}) {
  const real = (globalThis as any).Zotero;
  (globalThis as any).__realZoteroWG = real;
  (globalThis as any).Zotero = {
    ...real,
    Items: {
      ...(real?.Items || {}),
      getAsync: async (id: number) => opts.items?.get(id) ?? null,
    },
    getMainWindow: opts.getMainWindow ?? real?.getMainWindow,
  };
}

function restoreZotero() {
  if ((globalThis as any).__realZoteroWG) {
    (globalThis as any).Zotero = (globalThis as any).__realZoteroWG;
    delete (globalThis as any).__realZoteroWG;
  }
}

describe("Write Gates — ApprovalDialog + ItemManager integration", function () {
  afterEach(function () {
    restoreZotero();
    createdEls = [];
  });

  it("APPROVE: dialog opens, click Approve applies the mutation once, both audit trails agree", async function () {
    const { addon, audits } = makeAddon();
    const item = mockItem({ id: 20, fields: { title: "Before" } });
    withZotero({
      items: new Map([[20, item]]),
      getMainWindow: () => ({ document: makeFakeDoc() }),
    });

    const manager = new ItemManager(addon);
    const pending = manager.updateItemMetadataGated(20, { title: "After" });

    // The dialog opens after getAsync resolves — poll for its Approve button.
    const approve = await waitForEl("hermes-btn-approve");
    expect(
      approve,
      `approval dialog should be open; created: ${createdSummary()}`,
    ).to.exist;
    approve!.click();

    const result = await pending;

    expect(result.status).to.equal("success");
    expect(item.getField("title"), "field applied").to.equal("After");
    expect(item.isSaved(), "item saved once approved").to.equal(true);

    // The dialog recorded the permission grant; writeGate recorded the change.
    expect(
      audits.some((a) => a.action === "permission" && a.status === "success"),
      "dialog permission entry",
    ).to.equal(true);
    expect(
      audits.some((a) => a.action === "file_change" && a.status === "success"),
      "writeGate file_change entry",
    ).to.equal(true);
  });

  it("REJECT: click Deny leaves the item untouched, audits permission blocked, never saves", async function () {
    const { addon, audits } = makeAddon();
    const item = mockItem({ id: 21, fields: { title: "Before" } });
    withZotero({
      items: new Map([[21, item]]),
      getMainWindow: () => ({ document: makeFakeDoc() }),
    });

    const manager = new ItemManager(addon);
    const pending = manager.updateItemMetadataGated(21, { title: "After" });

    const deny = await waitForEl("hermes-btn-deny");
    expect(deny, `approval dialog should be open; created: ${createdSummary()}`)
      .to.exist;
    deny!.click();

    const result = await pending;

    expect(result.status).to.equal("rejected");
    expect(item.getField("title"), "nothing applied").to.equal("Before");
    expect(item.isSaved(), "never saved").to.equal(false);
    expect(
      audits.some((a) => a.action === "permission" && a.status === "blocked"),
      "rejection audited",
    ).to.equal(true);
    expect(
      audits.some((a) => a.action === "file_change"),
      "no file_change entry on a rejected write",
    ).to.equal(false);
  });

  it("THROW: a dialog that fails to render fails fast (no hang), apply is never called", async function () {
    const { addon, audits } = makeAddon();
    const item = mockItem({ id: 22, fields: { title: "Before" } });
    withZotero({
      items: new Map([[22, item]]),
      getMainWindow: () => {
        throw new Error("no main window");
      },
    });

    const manager = new ItemManager(addon);

    // Regression guard: before ApprovalDialog.enqueueDialog forwarded rejections
    // this promise never settled and the whole run hung.
    const result = await manager.updateItemMetadataGated(22, {
      title: "After",
    });

    expect(result.status).to.equal("failed");
    expect(result.error).to.contain("no main window");
    expect(item.getField("title"), "nothing applied").to.equal("Before");
    expect(item.isSaved()).to.equal(false);
    expect(
      audits.some((a) => a.action === "file_change"),
      "no file_change entry when apply never ran",
    ).to.equal(false);
  });
});
