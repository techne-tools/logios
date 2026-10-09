import type Addon from "../../addon";
import {
  runWrite,
  type WriteContext,
  type WriteResult,
} from "../../utils/writeGate";
import {
  buildCitationDiff,
  buildCitationInsertion,
  type InsertPosition,
} from "./citationInsert";

/**
 * Manages Zotero note operations for Hermes Agent.
 */
export class NoteManager {
  private readonly addon: Addon;
  private readonly approvalDialog: any;

  constructor(addon: Addon, approvalDialog?: any) {
    this.addon = addon;
    this.approvalDialog = approvalDialog;
  }

  /**
   * The approval-gate + audit sink, mirroring `ItemManager.writeContext()`.
   * Declared structurally so a light test double works.
   */
  private writeContext(): WriteContext {
    const hermes = this.addon.data?.hermes as any;
    return {
      approvalDialog: hermes?.approvalDialog ?? this.approvalDialog ?? null,
      auditLog: hermes?.auditLog ?? null,
      log: (message: string, ...data: unknown[]) =>
        this.addon.log?.(message, ...data),
    };
  }

  /**
   * Insert a citation into a note under the approval gate.
   *
   * WHY A SECOND NOTE WRITE PATH
   * ----------------------------
   * `writeNote` gates + audits internally but throws when the user rejects,
   * which cannot distinguish a rejection from a failure. The citation pill needs
   * the full `WriteResult`, so this resolves the target, builds the exact
   * insertion, routes the apply through the gate, and returns the outcome. The
   * mutation itself is still `setNote` + `saveTx` — identical to `writeNote`.
   *
   * Target resolution:
   *   - `noteID` given → that note must exist and be a note, else throw. A
   *     missing *named* target is a caller bug, not a user decision (same rule as
   *     `ItemManager.updateItemMetadataGated`).
   *   - `noteID` null → `parentItemID` must be supplied; a fresh child note is
   *     created under it. With neither, there is nothing to write to.
   */
  public async insertCitationIntoNote(opts: {
    citation: string;
    position: InsertPosition;
    noteID?: number | null;
    parentItemID?: number | null;
    styleName?: string;
  }): Promise<WriteResult & { noteID?: number }> {
    const { citation, position, styleName } = opts;
    const noteID = opts.noteID ?? null;
    const parentItemID = opts.parentItemID ?? null;

    if (noteID === null && parentItemID === null) {
      return {
        status: "failed",
        error: "No target note or parent item to insert a citation into.",
      };
    }

    // Resolve the target up front so the approval prompt names it accurately.
    let targetLabel: string;
    let existing = "";
    let note: Zotero.Item | null = null;

    if (noteID !== null) {
      note = (await Zotero.Items.getAsync(noteID)) || null;
      if (!note || note.itemType !== "note") {
        throw new Error(`Note with ID ${noteID} not found.`);
      }
      existing = note.getNote() || "";
      targetLabel = "the note being edited";
    } else {
      const parent = (await Zotero.Items.getAsync(parentItemID!)) || null;
      if (!parent) {
        throw new Error(`Item with ID ${parentItemID} not found.`);
      }
      targetLabel = `a note under "${parent.getDisplayTitle()}"`;
    }

    const plan = buildCitationInsertion(existing, citation, position);
    const changes = buildCitationDiff(plan, { target: targetLabel, styleName });

    const outcome = await runWrite<number>(this.writeContext(), {
      action: "Insert citation",
      target: targetLabel,
      changes,
      changeAction: noteID === null ? "create" : "modify",
      metadata: { noteID, parentItemID, position, styleName },
      apply: async () => {
        if (note) {
          note.setNote(plan.newContent);
          await note.saveTx();
          return note.id;
        }
        // Creating a child note: writeNote owns the parent/lib resolution and
        // its own audit; skipApproval is false here already, and we are inside
        // an approved apply(), so its internal dialog must not re-prompt.
        const created = await this.writeNoteWithoutGate(
          plan.newContent,
          parentItemID!,
        );
        return created;
      },
    });

    if (outcome.status === "success") {
      return { status: "success", noteID: outcome.value };
    }
    return { status: outcome.status, error: outcome.error };
  }

  /**
   * Create a child note under `parentItemID` with NO approval prompt.
   *
   * Only for use inside an already-approved `runWrite.apply()` — the caller has
   * taken the user's decision, so re-prompting would be a double gate. Kept
   * private and narrowly scoped so it cannot be reached from a UI path.
   */
  private async writeNoteWithoutGate(
    content: string,
    parentItemID: number,
  ): Promise<number> {
    const note = new Zotero.Item("note");
    let libraryID = Zotero.Libraries.userLibraryID;
    const parent = (await Zotero.Items.getAsync(parentItemID)) || null;
    if (parent) {
      libraryID = parent.libraryID;
      note.parentItemID = parentItemID;
    }
    note.libraryID = libraryID;
    note.setNote(content);
    await note.saveTx();
    return note.id;
  }

  /** Read the body of the note currently open in the note editor, if any. */
  public async readEditingNote(): Promise<{
    noteID: number;
    content: string;
    parentItemID: number | null;
  } | null> {
    const note = this.resolveEditingNote();
    if (!note) return null;
    return {
      noteID: note.id,
      content: note.getNote() || "",
      parentItemID: note.parentItemID || null,
    };
  }

  /**
   * Best-effort resolution of the note the user is editing.
   *
   * Zotero exposes no plugin API for "the note editor's current note", so this
   * is a heuristic: an open Reader/note tab whose item is a note. Returns null
   * when nothing suitable is open; callers then ask for a target explicitly
   * rather than guessing (see the Task 10 spike finding).
   */
  private resolveEditingNote(): Zotero.Item | null {
    try {
      const win: any = Zotero.getMainWindow();
      const tabs = win?.Zotero_Tabs;
      if (!tabs || typeof tabs.getSelectedType !== "function") return null;
      if (tabs.getSelectedType() !== "reader") return null;
      const selected = tabs.getSelectedID?.();
      const reader = selected
        ? Zotero.Reader?.getByTabID?.(selected)
        : undefined;
      const itemID = reader?.itemID;
      if (!itemID) return null;
      const item = Zotero.Items.get(itemID);
      if (item && item.itemType === "note") return item;
      return null;
    } catch {
      return null;
    }
  }

  public async readNote(noteID: number): Promise<string | null> {
    const note = await Zotero.Items.getAsync(noteID);
    if (!note || note.itemType !== "note") {
      return null;
    }
    return note.getNote();
  }

  public async writeNote(
    noteID: number | null,
    content: string,
    title?: string,
    parentItemID?: number,
  ): Promise<number> {
    const isNew = !noteID;

    // Resolve details for the approval dialog
    let parentTitle = "Standalone Note";
    if (parentItemID) {
      try {
        const parentItem = await Zotero.Items.getAsync(parentItemID);
        if (parentItem) {
          parentTitle = parentItem.getDisplayTitle();
        }
      } catch (err) {
        this.addon.log(
          `NoteManager: failed to get parent item ${parentItemID}`,
          err,
        );
      }
    }
    const displayName = title
      ? `"${title}" under "${parentTitle}"`
      : `Note under "${parentTitle}"`;

    if (this.approvalDialog) {
      const changeId = `note-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const approved = await this.approvalDialog.addPendingChange({
        action: isNew ? "create" : "modify",
        id: changeId,
        newContent: content,
        path: displayName,
        status: "pending",
        timestamp: Date.now(),
      });
      if (!approved) {
        throw new Error("Note creation cancelled by user.");
      }
    }

    let note: Zotero.Item | false;
    if (noteID) {
      note = await Zotero.Items.getAsync(noteID);
      if (!note || note.itemType !== "note") {
        throw new Error(`Note with ID ${noteID} not found`);
      }
    } else {
      note = new Zotero.Item("note");
      let libraryID = Zotero.Libraries.userLibraryID;
      if (parentItemID) {
        try {
          const parentItem = await Zotero.Items.getAsync(parentItemID);
          if (parentItem) {
            libraryID = parentItem.libraryID;
            note.parentItemID = parentItemID;
          }
        } catch (err) {
          this.addon.log(
            `NoteManager: failed to resolve parent item library ${parentItemID}`,
            err,
          );
        }
      }
      note.libraryID = libraryID;
    }

    // Format content: Zotero notes are HTML/rich text. We can prefix with a title header if specified.
    // The title is escaped before interpolation to prevent HTML injection.
    let noteContent = content;
    if (title) {
      const escapedTitle = title
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      if (
        !content.includes(`<h1>${escapedTitle}</h1>`) &&
        !content.includes(`<h2>${escapedTitle}</h2>`)
      ) {
        noteContent = `<h1>${escapedTitle}</h1>\n${content}`;
      }
    }

    note.setNote(noteContent);
    await note.saveTx();

    this.addon.data?.hermes?.auditLog?.record(
      "file_change",
      displayName,
      "success",
      { action: isNew ? "create" : "modify", noteID: note.id, parentItemID },
    );

    return note.id;
  }

  public async searchNotes(query: string): Promise<Zotero.Item[]> {
    const s = new Zotero.Search();
    s.addCondition("itemType", "is", "note");
    const ids = await s.search();
    if (!ids || ids.length === 0) return [];
    const notes = await Zotero.Items.getAsync(ids);

    if (!query) return notes;

    const queryLower = query.toLowerCase();
    const scoredNotes = notes.map((note) => {
      const noteText = (note.getNote() || "").toLowerCase();
      let score = 0;

      // Substring match
      if (noteText.includes(queryLower)) {
        score += 100;
      }

      // Word match scoring
      const queryWords = queryLower.split(/\s+/).filter(Boolean);
      let matchCount = 0;
      for (const word of queryWords) {
        if (noteText.includes(word)) {
          score += 10;
          matchCount++;
        }
      }
      if (matchCount === queryWords.length) {
        score += 20;
      }

      return { note, score };
    });

    return scoredNotes
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((item) => item.note);
  }
}
