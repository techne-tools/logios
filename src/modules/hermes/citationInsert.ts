/**
 * Citation insertion into Zotero notes — the pure half.
 *
 * WHY THIS IS SEPARATE
 * --------------------
 * Zotero's note bodies are HTML, and the plugin's write path (`writeNote`) sends
 * content straight to `note.setNote()` without escaping it. A CSL citation can
 * legitimately contain `&` ("Smith & Jones"), `<` (rare, but a locator like
 * "see <5.2>"), or `>` — so the text must be escaped before it is interpolated
 * into the note body. That is a pure string job with no Zotero dependency, so it
 * lives here and is unit-tested directly rather than through the sandbox.
 *
 * The module answers one question: given what a note already contains and a
 * citation to place, produce (a) the exact text inserted and (b) the resulting
 * full note body. Nothing here decides *whether* to write — that is the approval
 * gate's job, and it stays in `NoteManager`.
 */

/** Where in the note the citation lands. v1 supports the two end positions. */
export type InsertPosition = "top" | "bottom";

export interface CitationInsertPlan {
  /** The exact escaped text placed in the note (what the diff shows). */
  insertion: string;
  /** The full resulting note body, ready for `note.setNote()`. */
  newContent: string;
  /** Echoed back so the caller can name the position in the prompt. */
  position: InsertPosition;
}

/**
 * Escape the five HTML-significant characters.
 *
 * `&` first, or the ampersands introduced by the later replacements get
 * double-escaped — the classic ordering bug.
 */
export function escapeCitationText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Build the resulting note body for a citation at `position`.
 * Trims and HTML-escapes the plain-text citation into a paragraph. Returns
 * that paragraph as `insertion`, the full HTML as `newContent`, and `position`.
 *
 * Rules:
 *   - An empty/blank existing body yields just the citation paragraph — no
 *     stray leading blank line.
 *   - A non-empty body keeps its content verbatim; the citation paragraph is
 *     joined with one added newline at the chosen end.
 *   - An empty (or whitespace-only) citation is a caller error: it throws,
 *     because silently writing an empty paragraph into the user's note is worse
 *     than refusing. The caller turns that into a visible message.
 */
export function buildCitationInsertion(
  existing: string,
  citation: string,
  position: InsertPosition,
): CitationInsertPlan {
  const trimmedCitation = citation.trim();
  if (!trimmedCitation) {
    throw new Error("Cannot insert an empty citation.");
  }

  const paragraph = `<p>${escapeCitationText(trimmedCitation)}</p>`;
  const body = existing ?? "";

  let newContent: string;
  if (body.trim().length === 0) {
    newContent = paragraph;
  } else if (position === "top") {
    newContent = `${paragraph}\n${body}`;
  } else {
    newContent = `${body}\n${paragraph}`;
  }

  return { insertion: paragraph, newContent, position };
}

/** Human-readable label for the position, used in the diff and messages. */
export function positionLabel(position: InsertPosition): string {
  return position === "top" ? "top of the note" : "bottom of the note";
}

/**
 * The diff lines shown in the approval dialog.
 *
 * The plan requires the diff to carry the exact insertion text *and* the named
 * position, so the user approves what they will actually get rather than a
 * summary of it.
 */
export function buildCitationDiff(
  plan: CitationInsertPlan,
  opts: { target: string; styleName?: string } = { target: "note" },
): string[] {
  const lines = [
    `Insert citation at the ${positionLabel(plan.position)}`,
    `Target: ${opts.target}`,
  ];
  if (opts.styleName) lines.push(`Style: ${opts.styleName}`);
  lines.push("", "Citation text:", plan.insertion);
  return lines;
}
