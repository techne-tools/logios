import { expect } from "chai";
import {
  parseSlashCommand,
  getSlashCommands,
} from "../src/modules/hermes/SlashCommands";

/**
 * Minimal addon stub for command *guard* paths and argument parsing.
 *
 * The commands are thin wrappers; the value worth testing here is what they do
 * with arguments and what they pass down to the managers — not the managers
 * themselves (each has its own suite). Stubs therefore record their inputs.
 */
function makeAddon(overrides: Record<string, any> = {}) {
  const captured: { bulkUpdates?: any; annotationPatch?: any } = {};
  const addon: any = {
    log: () => {},
    data: {
      hermes: {
        items: {
          getAttachedItems: () => overrides.attached ?? [],
          getSelectedCollection: () => overrides.collection ?? null,
          attachCollection: async () => overrides.collectionItems ?? [],
          searchFullText: async () => overrides.fullTextItems ?? [],
          bulkUpdateMetadata: async (_ids: number[], updates: any) => {
            captured.bulkUpdates = updates;
            return { status: "success", updated: _ids.length, failed: 0 };
          },
        },
        lookups: {
          lookupDoi: async () => overrides.doiRecord ?? null,
          findDoiByTitle: async () => overrides.doiRecord ?? null,
          findCitingWorks: async () => overrides.citingWorks ?? [],
        },
        annotations: {
          updateAnnotationById: async (_ref: any, patch: any) => {
            captured.annotationPatch = patch;
            return { status: "success" };
          },
          searchAnnotations: async () => overrides.annotations ?? [],
        },
        citations: {
          getCurrentStyle: () => overrides.styleID ?? "style-apa",
          getCurrentStyleName: () => overrides.styleTitle ?? "APA 7th",
          getStyleByIDOrName: () => overrides.styleID ?? "style-apa",
          // `in` rather than `??` so a test can pass an explicit null/"" to
          // exercise the null-citation and empty-bibliography branches.
          generateCitationWithStyle: () =>
            "citation" in overrides ? overrides.citation : "(Lee, 2024)",
          generateBibliographyWithStyle: () =>
            "bibliography" in overrides
              ? overrides.bibliography
              : "Lee, S. (2024). A paper.",
          getCitationSnippets: () => ({
            citekey: "lee2024",
            pandoc: "[@lee2024]",
            latex: "\\cite{lee2024}",
            typst: "@lee2024",
          }),
        },
        preferences: {
          get: (_key: string, fallback: any) =>
            overrides.prefs?.[_key] ?? fallback,
        },
      },
    },
  };
  return { addon, captured };
}

function command(name: string) {
  const cmd = getSlashCommands().find((c) => c.name === name);
  if (!cmd) throw new Error(`command not registered: ${name}`);
  return cmd;
}

describe("SlashCommands", function () {
  it("should return null for non-slash input", function () {
    expect(parseSlashCommand("hello world")).to.be.null;
  });

  it("should parse known slash commands", function () {
    const result = parseSlashCommand("/clear");
    expect(result).to.not.be.null;
    expect(result?.command.name).to.equal("clear");
  });

  it("should parse slash commands with arguments", function () {
    const result = parseSlashCommand("/search foo bar");
    expect(result).to.not.be.null;
    expect(result?.command.name).to.equal("search");
    expect(result?.args).to.equal("foo bar");
  });

  it("should handle unknown commands by returning a passthrough", function () {
    const result = parseSlashCommand("/unknown arg");
    expect(result).to.not.be.null;
    expect(result?.command.name).to.equal("unknown");
    expect(result?.args).to.equal("arg");
  });

  it("should have export command registered", function () {
    const commands = getSlashCommands();
    const exportCmd = commands.find((c) => c.name === "export");
    expect(exportCmd).to.exist;
    expect(exportCmd?.description).to.include("Markdown");
  });

  it("should have collection, compare, gaps, and draft-litreview registered", function () {
    const commands = getSlashCommands();
    const names = commands.map((c) => c.name);
    expect(names).to.include("collection");
    expect(names).to.include("compare");
    expect(names).to.include("gaps");
    expect(names).to.include("draft-litreview");
  });

  it("should have Round 3 commands registered: canvas, organize-tags, timeline, critique, and quiz", function () {
    const commands = getSlashCommands();
    const names = commands.map((c) => c.name);
    expect(names).to.include("canvas");
    expect(names).to.include("organize-tags");
    expect(names).to.include("timeline");
    expect(names).to.include("critique");
    expect(names).to.include("quiz");
  });

  it("registers the Workstream A+B commands (B4)", function () {
    const names = getSlashCommands().map((c) => c.name);
    expect(names).to.include("doi");
    expect(names).to.include("cites");
    expect(names).to.include("bulk-metadata");
    expect(names).to.include("bulk-field");
    expect(names).to.include("anno-edit");
    expect(names).to.include("anno-search");
  });

  describe("/doi", function () {
    it("looks up a bare DOI and renders the record", async function () {
      const { addon } = makeAddon({
        doiRecord: {
          doi: "10.21810/aer.v1i1.5379",
          title: "Political Acoustic Ecology",
          itemType: "journalArticle",
          creators: [{ firstName: "W.", lastName: "Scheidel" }],
          date: "2023",
          source: "crossref",
        },
      });
      const out = (await command("doi").execute(
        addon,
        "10.21810/aer.v1i1.5379",
      )) as string;
      expect(out).to.include("Political Acoustic Ecology");
      expect(out).to.include("10.21810/aer.v1i1.5379");
      expect(out).to.include("crossref");
    });

    it("refuses a non-DOI with no attached item to fall back on", async function () {
      const { addon } = makeAddon({ attached: [] });
      const out = (await command("doi").execute(addon, "not-a-doi")) as string;
      expect(out).to.include("does not look like a DOI");
    });

    it("reports when CrossRef finds no record for a well-formed DOI", async function () {
      const { addon } = makeAddon({ doiRecord: null });
      const out = (await command("doi").execute(
        addon,
        "10.1234/nope",
      )) as string;
      expect(out).to.include("No record found");
    });
  });

  describe("/cites", function () {
    it("requires an attached item", async function () {
      const { addon } = makeAddon({ attached: [] });
      const out = (await command("cites").execute(addon, "")) as string;
      expect(out).to.include("No item attached");
    });

    it("tells the user to find a DOI when the item has none", async function () {
      const { addon } = makeAddon({ attached: [{ title: "No DOI Paper" }] });
      const out = (await command("cites").execute(addon, "")) as string;
      expect(out).to.include("has no DOI");
    });
  });

  describe("/bulk-metadata and /bulk-field", function () {
    it("requires a selected collection", async function () {
      const { addon } = makeAddon({ collection: null });
      const out = (await command("bulk-metadata").execute(
        addon,
        "language=en",
      )) as string;
      expect(out).to.include("No collection selected");
    });

    it("parses field=value pairs and forwards them to the manager", async function () {
      const { addon, captured } = makeAddon({
        collection: { name: "Sonic Studies" },
        collectionItems: [{ id: 1 }, { id: 2 }],
      });
      const out = (await command("bulk-metadata").execute(
        addon,
        'language=en, publisher="My Press"',
      )) as string;
      expect(captured.bulkUpdates).to.deep.equal({
        language: "en",
        publisher: "My Press",
      });
      expect(out).to.include("2");
    });

    it("rejects an empty patch", async function () {
      const { addon } = makeAddon({
        collection: { name: "X" },
        collectionItems: [{ id: 1 }],
      });
      const out = (await command("bulk-metadata").execute(
        addon,
        "   ",
      )) as string;
      expect(out).to.include("Usage:");
    });

    it("/bulk-field operates on attached items", async function () {
      const { addon, captured } = makeAddon({
        attached: [{ id: 7 }, { id: 8 }],
      });
      await command("bulk-field").execute(addon, "language=en");
      expect(captured.bulkUpdates).to.deep.equal({ language: "en" });
    });
  });

  describe("/anno-edit", function () {
    it("maps text/comment/color/page onto the manager patch", async function () {
      const { addon, captured } = makeAddon();
      await command("anno-edit").execute(
        addon,
        "ABCD1234 comment=Fixed, color=#a28ae5, page=12",
      );
      expect(captured.annotationPatch).to.deep.equal({
        comment: "Fixed",
        color: "#a28ae5",
        pageLabel: "12",
      });
    });

    it("accepts the British spelling `colour`", async function () {
      const { addon, captured } = makeAddon();
      await command("anno-edit").execute(addon, "ABCD1234 colour=#ffd400");
      expect(captured.annotationPatch).to.deep.equal({ color: "#ffd400" });
    });

    it("requires a key and a patch", async function () {
      const { addon } = makeAddon();
      expect(await command("anno-edit").execute(addon, "")).to.include(
        "Usage:",
      );
      expect(await command("anno-edit").execute(addon, "ABCD1234")).to.include(
        "Missing patch",
      );
    });
  });

  describe("/anno-search", function () {
    it("requires a query", async function () {
      const { addon } = makeAddon();
      const out = (await command("anno-search").execute(addon, "")) as string;
      expect(out).to.include("Usage:");
    });

    it("reports a clean miss", async function () {
      const { addon } = makeAddon({ annotations: [] });
      const out = (await command("anno-search").execute(
        addon,
        "nothing",
      )) as string;
      expect(out).to.include("No annotations match");
    });

    it("lists matches with page and key", async function () {
      const { addon } = makeAddon({
        annotations: [
          {
            id: "K1",
            itemID: 1,
            page: 3,
            type: "highlight",
            text: "sonic boom",
          },
        ],
      });
      const out = (await command("anno-search").execute(
        addon,
        "sonic",
      )) as string;
      expect(out).to.include("sonic boom");
      expect(out).to.include("p.3");
      expect(out).to.include("K1");
    });
  });

  describe("/find", function () {
    function hit(id: number, title: string, creators: any[] = []) {
      return {
        id,
        getDisplayTitle: () => title,
        getCreators: () => creators,
        getField: () => "",
      };
    }

    it("requires a query", async function () {
      const { addon } = makeAddon();
      const out = (await command("find").execute(addon, "")) as string;
      expect(out).to.include("Usage:");
    });

    it("reports a clean miss and names the OCR limit", async function () {
      const { addon } = makeAddon({ fullTextItems: [] });
      const out = (await command("find").execute(addon, "nothing")) as string;
      expect(out).to.include("No PDFs contain");
      expect(out).to.include("no text layer");
    });

    it("lists full-text hits with an add-context pill", async function () {
      const { addon } = makeAddon({
        fullTextItems: [hit(7, "The Soundscape", [{ lastName: "Schafer" }])],
      });
      const out = (await command("find").execute(
        addon,
        "acoustic ecology",
      )) as string;
      expect(out).to.include("The Soundscape");
      expect(out).to.include("Schafer");
      expect(out).to.include("add-context:7");
    });
  });

  describe("/cite", function () {
    after(function () {
      if ((globalThis as any).__realZotero) {
        (globalThis as any).Zotero = (globalThis as any).__realZotero;
        delete (globalThis as any).__realZotero;
      }
    });

    function stubItems(item: any) {
      const realZotero = (globalThis as any).Zotero;
      if (!(globalThis as any).__realZotero) {
        (globalThis as any).__realZotero = realZotero;
      }
      (globalThis as any).Zotero = {
        ...realZotero,
        Items: { getAsync: async () => item },
      };
    }

    it("emits top and bottom insert-citation pills carrying the CSL text", async function () {
      const { addon } = makeAddon({
        attached: [{ id: 7, title: "The Soundscape" }],
        citation: "(Schafer, 1977)",
      });
      stubItems({ id: 7 });

      const out = (await command("cite").execute(addon, "")) as string;
      // Parentheses are percent-encoded in addition to encodeURIComponent's own
      // escapes — parseInline tolerates only ONE level of nested parens, so a
      // citation like "(Smith, 2020, p. 5 (n. 3))" would otherwise break the link.
      const expectedPayload = encodeURIComponent("(Schafer, 1977)")
        .replace(/\(/g, "%28")
        .replace(/\)/g, "%29");
      expect(out).to.include(`insert-citation:top:${expectedPayload}`);
      expect(out).to.include(`insert-citation:bottom:${expectedPayload}`);
      expect(out).to.include("Insert at top of open note");
      // The CSL text itself still renders in the answer.
      expect(out).to.include("(Schafer, 1977)");
    });

    it("encodes parentheses so a doubly-nested citation still yields a parseable link", async function () {
      const { addon } = makeAddon({
        attached: [{ id: 7, title: "X" }],
        citation: "(Smith, 2020, p. 5 (n. 3))",
      });
      stubItems({ id: 7 });

      const out = (await command("cite").execute(addon, "")) as string;
      // The href must contain no raw "(" or ")" from the payload.
      const m = out.match(/\[Insert at top of open note\]\(([^)]*)\)/);
      expect(m).to.not.be.null;
      const href = m![1];
      expect(href).to.not.match(/[()]/);
      expect(
        decodeURIComponent(href.replace("insert-citation:top:", "")),
      ).to.equal("(Smith, 2020, p. 5 (n. 3))");
    });

    it("falls back to decoded bibliography text, never the literal 'None'", async function () {
      const { addon } = makeAddon({
        attached: [{ id: 7, title: "X" }],
        citation: null,
        bibliography: "Smith &amp; Jones. (2020). <i>A title</i>.",
      });
      stubItems({ id: 7 });

      const out = (await command("cite").execute(addon, "")) as string;
      // Tags stripped, entities decoded: "&amp;" must not survive into the payload.
      expect(out).to.include("Smith & Jones. (2020). A title.");
      expect(out).to.not.include("insert-citation:top:None");
      expect(out).to.not.include("&amp;amp;");
    });

    it("emits no pills when there is neither a citation nor a bibliography", async function () {
      const { addon } = makeAddon({
        attached: [{ id: 7, title: "X" }],
        citation: null,
        bibliography: "",
      });
      stubItems({ id: 7 });

      const out = (await command("cite").execute(addon, "")) as string;
      expect(out).to.not.include("insert-citation:");
      expect(out).to.include("No citation text to insert");
    });
  });
});
