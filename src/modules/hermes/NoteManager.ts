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
   * Insert a trimmed, HTML-escaped citation paragraph at the top or bottom
   * of a note, using the configured approval dialog and audit sink.
   *
   * WHY A SECOND NOTE WRITE PATH
   * ----------------------------
   * `writeNote` gates + audits internally but throws when the user rejects,
   * which cannot distinguish a rejection from a failure. The citation pill needs
   * the full `WriteResult`, so this resolves the target, builds the exact
   * insertion, routes the apply through the gate, and returns the outcome. The
   * mutation itself is still `setNote` + `saveTx` — identical to `writeNote`.
   *
   * The target is ALWAYS a named note: the one open in the editor, resolved by
   * `readEditingNote()`. There is deliberately no "create a note" fallback — a
   * click with no editor open used to spawn a fresh child note under the
   * attached item, so repeated clicks produced duplicate notes. The caller
   * reports the missing-target case to the user instead.
   *
   * `styleName` labels the approval preview; it does not format the citation.
   * Returns `success` with the saved note ID, `rejected` without a mutation,
   * or `failed` with an error for approval or write failures. If no approval
   * dialog is configured, the write proceeds without prompting.
   *
   * @throws If `noteID` does not resolve to a note, or the citation is blank.
   * Errors reading the target before approval also propagate, as do errors
   * escaping the gate's audit or error-reporting calls.
   */
  public async insertCitationIntoNote(opts: {
    citation: string;
    position: InsertPosition;
    noteID: number;
    styleName?: string;
  }): Promise<WriteResult & { noteID?: number }> {
    const { citation, position, styleName, noteID } = opts;

    const note = (await Zotero.Items.getAsync(noteID)) || null;
    if (!note || note.itemType !== "note") {
      throw new Error(`Note with ID ${noteID} not found.`);
    }
    const existing = note.getNote() || "";

    // Name the target in the prompt so the user approves a specific note, not
    // an anonymous write.
    const parentID = note.parentItemID;
    let targetLabel = `note ${noteID}`;
    if (parentID) {
      const parent = (await Zotero.Items.getAsync(parentID)) || null;
      if (parent) targetLabel = `note under "${parent.getDisplayTitle()}"`;
    }

    const plan = buildCitationInsertion(existing, citation, position);
    const changes = buildCitationDiff(plan, { target: targetLabel, styleName });

    const outcome = await runWrite<number>(this.writeContext(), {
      action: "Insert citation",
      target: targetLabel,
      changes,
      changeAction: "modify",
      metadata: { noteID, position, styleName },
      apply: async () => {
        note.setNote(plan.newContent);
        await note.saveTx();
        return note.id;
      },
    });

    if (outcome.status === "success") {
      return { status: "success", noteID: outcome.value };
    }
    return { status: outcome.status, error: outcome.error };
  }

  /**
   * Read the note open in Zotero's note editor, if any.
   * Returns its ID, HTML body (empty when absent), and parent ID (null for a
   * standalone note), or null when no note editor is open or resolution fails.
   */
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
   * Resolve the note open in Zotero's note editor, if any.
   *
   * Zotero opens notes as TABS (`Zotero_Tabs.add({ type: 'note-unloaded' })` in
   * `data/notes.js`) and each tab's `EditorInstance` registers itself with
   * `Zotero.Notes.registerEditorInstance`, retrievable by tab id via
   * `Zotero.Notes.getByTabID(tabID)`. `EditorInstance.itemID` is the public
   * getter for the note.
   *
   * Two traps this avoids:
   *   - `Zotero_Tabs.selectedID` / `selectedType` are *properties*, not methods.
   *     Calling `getSelectedType()` throws and the catch would swallow it, so
   *     the resolver silently returned null forever.
   *   - A note tab and a reader tab are different `selectedType` values, so
   *     matching on "reader" and calling `Zotero.Reader.getByTabID` can never
   *     find a note. The tab id is used directly instead.
   *
   * Returns null when no note editor is open; callers must then tell the user
   * rather than guessing a target.
   */
  private resolveEditingNote(): Zotero.Item | null {
    try {
      const win: any = Zotero.getMainWindow();
      const tabs = win?.Zotero_Tabs;
      const tabID = tabs?.selectedID;
      if (!tabID) return null;

      const instance = (Zotero as any).Notes?.getByTabID?.(tabID);
      const itemID = instance?.itemID;
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
