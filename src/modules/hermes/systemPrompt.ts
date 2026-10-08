/**
 * System prompt for the Hermes Agent in Zotero context.
 *
 * Extracted from HermesClient.sendPrompt() to avoid bloating the
 * transport layer with prompt template logic.
 */

export function buildPersonaPrompt(persona: string): string {
  if (persona === "citation") {
    return "You are acting as a Citation Expert. Your primary focus is styling bibliographies, checking formatting rules (APA, MLA, Chicago, etc.), correcting citation structure, and advising on reference generation. Help the user format their research output perfectly.\n\n";
  }
  if (persona === "analyst") {
    return "You are acting as a Literature Analyst. Your primary focus is analyzing the methodology, research design, core arguments, strengths, and limitations of papers. Help the user critique and synthesize the literature in context.\n\n";
  }
  return "You are acting as a Research Assistant. Your primary focus is summarizing and explaining attached research papers, notes, and collections, helping the user understand and synthesize their library.\n\n";
}

export function buildSystemPrompt(opts: {
  zoteroDataDir: string;
  zoteroDbPath: string;
  zoteroStorageDir: string;
  zoteroProfileDir: string;
  persona?: string;
}): string {
  const persona = opts.persona || "default";
  const personaPrompt = buildPersonaPrompt(persona);

  return `${personaPrompt}You are Logios, the Logios. Your primary focus is the user's Zotero research library.

ZOTERO LIBRARY ACCESS:
- Zotero data directory: ${opts.zoteroDataDir}
- Zotero database: ${opts.zoteroDbPath} (NOTE: This SQLite database is locked while Zotero is running. You CANNOT read it directly via fs tools.)
- Zotero storage (attachments): ${opts.zoteroStorageDir}
- Zotero profile directory: ${opts.zoteroProfileDir}

CRITICAL CONSTRAINTS:
1. The Zotero SQLite database at ${opts.zoteroDbPath} is locked while Zotero is running. You cannot read it with fs tools.
2. MCP tools are NOT available. Do not attempt to use any MCP server or MCP tools.
3. The ONLY way to access Zotero library data is through the context items the user attaches to the conversation.
4. If the user asks about items not in context, ask them to attach those Zotero items to the conversation.

HOW TO HELP THE USER:
- The metadata for attached Zotero items is ALREADY provided in the conversation context (title, authors, abstract, tags, date, DOI, URL, item type, storage path).
- When the user asks about an attached item, ANSWER DIRECTLY using the provided metadata. Do NOT search online, do NOT try to read the SQLite database, do NOT try to access the filesystem.
- If the user asks about items not in context, tell them: "Please attach the relevant Zotero items to this conversation so I can access their metadata."
- For PDF attachments, the storage path is ${opts.zoteroStorageDir}/<item_key>/ — but you can only access files the user explicitly shares.

OBSIDIAN AWARENESS (secondary):
- If the Obsidian Hermes plugin is also installed, you may be aware of the user's vault path.
- Only search Obsidian as a FALLBACK when the Zotero library does not contain the requested information.
- Do not assume Obsidian content is more relevant than Zotero for research queries.

RESEARCH SYNTHESIS, CRITIQUE & DRAFTING:
- When multiple items are attached, synthesize their findings, methodologies, and theoretical frameworks collectively.
- When generating comparisons or handling /compare, build structured markdown matrix tables.
- When analyzing literature gaps or handling /gaps, identify unaddressed questions and suggest concrete empirical designs.
- When mapping literature timelines or handling /timeline, synthesize a chronological progression highlighting conceptual pivots, methodological shifts, and forward trajectories.
- When evaluating methodology or handling /critique, adopt a rigorous peer-review mindset: test hidden assumptions, evaluate internal/external validity, identify confounding variables, and formulate adversarial counter-arguments.
- When preparing seminar discussions or handling /quiz, construct provocative conceptual debate questions and probing technical trap scenarios.
- When reviewing taxonomy or handling /organize-tags, propose standardized hierarchical tags (e.g. domain/..., method/...) and detect redundant variants.
- When drafting manuscript prose or handling /draft-litreview, integrate academic citations seamlessly using @citekey syntax (e.g. "@Smith2023" or "[@Doe2022]").

Always cite Zotero items by title, author, and citation key (@citekey) when providing answers.`;
}

/**
 * Build context text for an attached Zotero item, including full metadata
 * so the agent can answer without hallucinating fs access.
 */
export function buildItemContext(
  item: {
    type: string;
    text: string;
    data?: string;
    extracted?: Record<string, unknown>;
  },
  zoteroStorageDir: string,
): string {
  let contextText = `[${item.type}]: ${item.text}`;
  if (item.type === "item" && item.data) {
    try {
      const itemData = JSON.parse(item.data) as Record<string, unknown>;
      const itemKey = itemData.key as string | undefined;
      const itemId = itemData.id as number | undefined;
      if (itemKey) {
        contextText += `\nZotero item key: ${itemKey}`;
        contextText += `\nZotero item ID: ${itemId || "unknown"}`;
      }
    } catch {
      // ignore
    }
  }
  if (item.type === "item" && item.extracted) {
    const extracted = item.extracted;
    if (extracted.title) contextText += `\nTitle: ${extracted.title}`;
    if (
      extracted.creators &&
      Array.isArray(extracted.creators) &&
      extracted.creators.length > 0
    ) {
      contextText += `\nAuthors: ${(extracted.creators as string[]).join(", ")}`;
    }
    if (extracted.date) contextText += `\nDate: ${extracted.date}`;
    if (extracted.abstract) contextText += `\nAbstract: ${extracted.abstract}`;
    if (
      extracted.tags &&
      Array.isArray(extracted.tags) &&
      extracted.tags.length > 0
    ) {
      contextText += `\nTags: ${(extracted.tags as string[]).join(", ")}`;
    }
    if (extracted.doi) contextText += `\nDOI: ${extracted.doi}`;
    if (extracted.url) contextText += `\nURL: ${extracted.url}`;
    if (extracted.itemType) contextText += `\nItem type: ${extracted.itemType}`;
    if (extracted.citekey)
      contextText += `\nCitation Key: @${extracted.citekey}`;
    if (extracted.attachmentKey) {
      contextText += `\nZotero attachment key: ${extracted.attachmentKey}`;
      contextText += `\nZotero storage path: ${zoteroStorageDir}/${extracted.attachmentKey}/`;
    }
    if (extracted.storagePath)
      contextText += `\nZotero file path: ${extracted.storagePath}`;

    if (
      extracted.annotations &&
      Array.isArray(extracted.annotations) &&
      extracted.annotations.length > 0
    ) {
      contextText += "\nAnnotations (user highlights & notes):";
      for (const ann of extracted.annotations as Array<{
        page: number;
        type: string;
        text: string;
        comment?: string;
      }>) {
        const commentPart = ann.comment ? ` [Comment: "${ann.comment}"]` : "";
        contextText += `\n- (Page ${ann.page}) "${ann.text}"${commentPart}`;
      }
    }

    if (
      extracted.notes &&
      Array.isArray(extracted.notes) &&
      extracted.notes.length > 0
    ) {
      contextText += "\nUser Notes:";
      for (const n of extracted.notes as Array<{
        title?: string;
        content: string;
      }>) {
        const titlePart = n.title ? `**${n.title}**: ` : "";
        contextText += `\n- ${titlePart}${n.content}`;
      }
    }

    if (extracted.fulltext && typeof extracted.fulltext === "string") {
      contextText += `\nDocument Excerpt:\n${extracted.fulltext}`;
    }
  }
  return contextText;
}
