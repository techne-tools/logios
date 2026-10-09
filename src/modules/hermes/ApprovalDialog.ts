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
   * Enqueue a dialog show request.
   * Resolves when the user approves or denies the queued change.
   */
  private enqueueDialog(change: PendingFileChange): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const run = () => {
        this.isShowingDialog = true;
        this.showDialog(change)
          .then((result) => {
            resolve(result);
          })
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
   * Get a pending file change by ID.
   */
  public getPendingChange(id: string): PendingFileChange | undefined {
    return this.pendingChanges.get(id);
  }
}
