import type Addon from "../../addon";
import type { PendingFileChange } from "./types";

/**
 * Approval dialog for file modifications suggested by Hermes Agent.
 * Intercepts file write/delete operations and requires user approval.
 *
 * CONCURRENCY SAFETY: showDialog() is serialised through a queue so that
 * concurrent calls (e.g. two rapid /savechat commands) never overwrite each
 * other's dialog element or leak Promises.
 */
export class ApprovalDialog {
  private readonly addon: Addon;
  private pendingChanges = new Map<string, PendingFileChange>();

  // Queue serialisation — at most one modal is open at a time.
  private isShowingDialog = false;
  private dialogQueue: Array<() => void> = [];

  constructor(addon: Addon) {
    this.addon = addon;
  }

  /**
   * Add a pending file change and show approval dialog.
   * If a dialog is already open, this call is queued until the current one resolves.
   */
  public async addPendingChange(change: PendingFileChange): Promise<boolean> {
    this.pendingChanges.set(change.id, change);
    const approved = await this.enqueueDialog(change);
    if (!approved) {
      this.pendingChanges.delete(change.id);
    }
    this.addon.data?.hermes?.auditLog?.record(
      "permission",
      change.path,
      approved ? "success" : "blocked",
      { action: change.action, id: change.id },
    );
    return approved;
  }

  /**
   * Enqueue a batch of pending file changes and show ONE multi-change modal.
   *
   * Resolves with one boolean per change, in the same order the changes were
   * passed (index i of the result answers index i of `changes`), so the caller
   * can correlate each decision back to its change.
   *
   * Decision semantics:
   *  - `Approve All` / `Deny All` answer every undecided row at once.
   *  - Only rows the user decided are answered; any row left undecided when the
   *    dialog is dismissed (Escape, the close button, or a render failure) is
   *    answered `false` — never silently applied.
   *  - A change whose decision was not individually delivered when the modal
   *    fails to render is audited `blocked` and its slot resolves `false`; the
   *    batch as a whole still settles (it never hangs a caller).
   *
   * Each change gets its own `permission` audit entry, exactly as the
   * single-change path does, so the audit trail is per-change either way.
   */
  public async addPendingChanges(
    changes: PendingFileChange[],
  ): Promise<boolean[]> {
    if (changes.length === 0) return [];
    for (const change of changes) {
      this.pendingChanges.set(change.id, change);
    }

    let decisions: boolean[];
    try {
      decisions = await this.enqueue(() => this.showBatchDialog(changes));
    } catch (error) {
      // The modal never rendered: nothing was applied. Audit every change as
      // blocked (mirroring the single-change contract) then rethrow so the
      // caller's own catch records the failure too.
      for (const change of changes) {
        this.pendingChanges.delete(change.id);
        this.addon.data?.hermes?.auditLog?.record(
          "permission",
          change.path,
          "blocked",
          { action: change.action, id: change.id, batch: true },
        );
      }
      throw error;
    }

    changes.forEach((change, i) => {
      const approved = decisions[i] === true;
      if (!approved) {
        this.pendingChanges.delete(change.id);
      }
      this.addon.data?.hermes?.auditLog?.record(
        "permission",
        change.path,
        approved ? "success" : "blocked",
        { action: change.action, id: change.id, batch: true },
      );
    });

    return decisions;
  }

  /**
   * Enqueue a dialog show request.
   * Resolves when the user approves or denies the queued change.
   */
  private enqueueDialog(change: PendingFileChange): Promise<boolean> {
    return this.enqueue(() => this.showDialog(change));
  }

  /**
   * Enqueue any dialog show task behind the serialisation queue.
   *
   * At most one modal is open at a time, so a batch approval and a single
   * approval can never clobber each other's dialog element or leak a Promise.
   * If a task throws, the queue still dequeues the next task (`finally`), so a
   * failed batch never wedges a queued single change.
   */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        this.isShowingDialog = true;
        task()
          .then(resolve)
          .catch((error) => {
            // A dialog that fails to render must fail the approval, not hang it
            // forever. Without this the outer promise never settles, so
            // `runWrite` awaits indefinitely and the mutation is neither applied
            // nor audited.
            reject(error);
          })
          .finally(() => {
            this.isShowingDialog = false;
            // Dequeue the next waiting dialog, if any.
            const next = this.dialogQueue.shift();
            if (next) next();
          });
      };

      if (this.isShowingDialog) {
        this.dialogQueue.push(run);
      } else {
        run();
      }
    });
  }

  /**
   * Show approval dialog for a file change.
   * Uses createElement (not innerHTML) to avoid XUL sandbox crashes.
   * Always creates a fresh <dialog> element; never reuses a stale one.
   */
  private async showDialog(change: PendingFileChange): Promise<boolean> {
    return new Promise((resolve) => {
      const doc = Zotero.getMainWindow().document;

      // Always create a fresh dialog element — never reuse a stale one from a
      // previous call (the old code cached this.dialogElement and overwrote it
      // on concurrent calls, leaking the prior Promise).
      const dialogElement = doc.createElement("dialog");
      dialogElement.className = "hermes-approval-dialog";
      doc.documentElement?.appendChild(dialogElement);

      const actionText =
        change.action === "create"
          ? "Create"
          : change.action === "delete"
            ? "Delete"
            : "Modify";

      const contentDiv = doc.createElement("div");
      contentDiv.className = "hermes-approval-content";

      const heading = doc.createElement("h3");
      heading.textContent = "File Change Approval";
      contentDiv.appendChild(heading);

      const para = doc.createElement("p");
      const strong = doc.createElement("strong");
      strong.textContent = `${actionText}: `;
      para.appendChild(strong);
      const code = doc.createElement("code");
      code.textContent = change.path;
      para.appendChild(code);
      contentDiv.appendChild(para);

      const previewDiv = doc.createElement("div");
      previewDiv.className = "hermes-approval-preview";
      const pre = doc.createElement("pre");
      pre.textContent = change.newContent?.slice(0, 2000) || "(empty)";
      previewDiv.appendChild(pre);
      contentDiv.appendChild(previewDiv);

      const actionsDiv = doc.createElement("div");
      actionsDiv.className = "hermes-approval-actions";

      const approveBtn = doc.createElement("button");
      approveBtn.className = "hermes-btn-approve";
      approveBtn.textContent = "Approve";
      actionsDiv.appendChild(approveBtn);

      const denyBtn = doc.createElement("button");
      denyBtn.className = "hermes-btn-deny";
      denyBtn.textContent = "Deny";
      actionsDiv.appendChild(denyBtn);

      contentDiv.appendChild(actionsDiv);
      dialogElement.appendChild(contentDiv);

      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        try {
          dialogElement.remove();
        } catch {
          // ignore if already removed
        }
        resolve(result);
      };

      approveBtn.addEventListener("click", () => {
        finish(true);
      });

      denyBtn.addEventListener("click", () => {
        finish(false);
      });

      // Handle Escape key or native dialog dismissal so the promise never hangs
      dialogElement.addEventListener("cancel", (e) => {
        e.preventDefault();
        finish(false);
      });

      dialogElement.addEventListener("close", () => {
        finish(false);
      });

      dialogElement.showModal();
    });
  }

  /**
   * Show ONE modal listing every change in the batch, each with its own
   * Approve/Deny, plus an Approve All / Deny All footer.
   *
   * Resolves with a boolean per change in input order. Uses createElement (not
   * innerHTML) and native listeners only — the same sandbox constraints as
   * `showDialog`. Always creates a fresh element; never reuses a stale one.
   */
  private async showBatchDialog(
    changes: PendingFileChange[],
  ): Promise<boolean[]> {
    return new Promise((resolve) => {
      const doc = Zotero.getMainWindow().document;

      const dialogElement = doc.createElement("dialog");
      dialogElement.className = "hermes-approval-dialog hermes-approval-dialog-batch";
      doc.documentElement?.appendChild(dialogElement);

      const results: Array<boolean | undefined> = changes.map(() => undefined);

      const contentDiv = doc.createElement("div");
      contentDiv.className = "hermes-approval-content";

      const heading = doc.createElement("h3");
      heading.textContent = `Approve ${changes.length} file change${
        changes.length === 1 ? "" : "s"
      }`;
      contentDiv.appendChild(heading);

      const listDiv = doc.createElement("div");
      listDiv.className = "hermes-approval-batch-list";

      changes.forEach((change, index) => {
        const actionText =
          change.action === "create"
            ? "Create"
            : change.action === "delete"
              ? "Delete"
              : "Modify";

        const row = doc.createElement("div");
        row.className = "hermes-approval-batch-row";

        const rowHeader = doc.createElement("p");
        const strong = doc.createElement("strong");
        strong.textContent = `${actionText}: `;
        rowHeader.appendChild(strong);
        const code = doc.createElement("code");
        code.textContent = change.path;
        rowHeader.appendChild(code);
        row.appendChild(rowHeader);

        const previewDiv = doc.createElement("div");
        previewDiv.className = "hermes-approval-preview";
        const pre = doc.createElement("pre");
        pre.textContent = change.newContent?.slice(0, 2000) || "(empty)";
        previewDiv.appendChild(pre);
        row.appendChild(previewDiv);

        const rowActions = doc.createElement("div");
        rowActions.className = "hermes-approval-batch-row-actions";

        const approveBtn = doc.createElement("button");
        approveBtn.className = "hermes-btn-approve";
        approveBtn.textContent = "Approve";
        approveBtn.addEventListener("click", () => {
          results[index] = true;
          settleIfDone();
        });
        rowActions.appendChild(approveBtn);

        const denyBtn = doc.createElement("button");
        denyBtn.className = "hermes-btn-deny";
        denyBtn.textContent = "Deny";
        denyBtn.addEventListener("click", () => {
          results[index] = false;
          settleIfDone();
        });
        rowActions.appendChild(denyBtn);

        row.appendChild(rowActions);
        listDiv.appendChild(row);
      });

      contentDiv.appendChild(listDiv);

      const actionsDiv = doc.createElement("div");
      actionsDiv.className = "hermes-approval-actions";

      const approveAllBtn = doc.createElement("button");
      approveAllBtn.className = "hermes-btn-approve-all";
      approveAllBtn.textContent = "Approve All";
      approveAllBtn.addEventListener("click", () => {
        for (let i = 0; i < results.length; i++) {
          if (results[i] === undefined) results[i] = true;
        }
        settleIfDone();
      });
      actionsDiv.appendChild(approveAllBtn);

      const denyAllBtn = doc.createElement("button");
      denyAllBtn.className = "hermes-btn-deny-all";
      denyAllBtn.textContent = "Deny All";
      denyAllBtn.addEventListener("click", () => {
        for (let i = 0; i < results.length; i++) {
          if (results[i] === undefined) results[i] = false;
        }
        settleIfDone();
      });
      actionsDiv.appendChild(denyAllBtn);

      contentDiv.appendChild(actionsDiv);
      dialogElement.appendChild(contentDiv);

      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        try {
          dialogElement.remove();
        } catch {
          // ignore if already removed
        }
        // Undecided rows resolve false — a change is never applied without an
        // explicit decision.
        resolve(results.map((r) => r === true));
      };

      // Only settle once every row has an explicit decision.
      const settleIfDone = () => {
        if (results.every((r) => r !== undefined)) {
          finish();
        }
      };

      // Escape or native dismissal: undecided rows count as denied, never
      // applied (mirrors the single-change dialog).
      dialogElement.addEventListener("cancel", (e) => {
        e.preventDefault();
        finish();
      });

      dialogElement.addEventListener("close", () => {
        finish();
      });

      dialogElement.showModal();
    });
  }

  /**
   * Get a pending file change by ID.
   */
  public getPendingChange(id: string): PendingFileChange | undefined {
    return this.pendingChanges.get(id);
  }
}
