import { expect } from "chai";
import {
  FALLBACK_TOOLS,
  humaniseToolName,
  isToolAllowed,
  resolveAllowedTools,
  toggleTool,
  toolChips,
} from "../src/views/components/toolPerms";

const commands = [
  { name: "web_search", description: "Search the web" },
  { name: "read_file", description: "Read a file" },
  { name: "terminal", description: "Run a shell command" },
];
const allToolNames = commands.map((c) => c.name);

/**
 * Per-tool permission chips — pure logic.
 *
 * The chip component cannot be mounted in the Zotero sandbox, so these tests
 * target the decision functions that drive it. The three-state `allowedTools`
 * contract (`null` unrestricted / `[]` block-all / list) is the thing worth
 * pinning down: collapsing `[]` to `null` would silently re-enable every tool
 * the user just disabled.
 */
describe("tool permission chips", function () {
  describe("chip set", function () {
    it("enumerates every advertised command name", function () {
      const names = toolChips(commands).map((c) => c.name);
      expect(names).to.deep.equal(["web_search", "read_file", "terminal"]);
    });

    it("falls back to the three known tools before commands arrive", function () {
      expect(toolChips(undefined).map((c) => c.name)).to.deep.equal(
        FALLBACK_TOOLS,
      );
      expect(toolChips([]).map((c) => c.name)).to.deep.equal(FALLBACK_TOOLS);
    });

    it("humanises labels and dedupes repeated names", function () {
      const chips = toolChips([
        { name: "web_search", description: "" },
        { name: "web_search", description: "dup" },
        { name: "read_file", description: "" },
      ]);
      expect(chips.map((c) => c.name)).to.deep.equal([
        "web_search",
        "read_file",
      ]);
      expect(chips[0].label).to.equal("Web Search");
      expect(chips[1].label).to.equal("Read Files");
      expect(humaniseToolName("write_file")).to.equal("Write Files");
    });
  });

  describe("allowedTools state transitions", function () {
    const all = allToolNames;

    it("selecting exactly ['web_search'] yields an array of one", function () {
      // Start from unrestricted, uncheck the other two.
      let next = toggleTool(null, "read_file", false, all);
      next = toggleTool(next, "terminal", false, all);
      expect(next).to.deep.equal(["web_search"]);
    });

    it("deselecting the last tool yields [] (block all), not null", function () {
      const onlyOne = ["web_search"];
      const next = toggleTool(onlyOne, "web_search", false, all);
      expect(next).to.deep.equal([]);
      expect(next).to.not.equal(null);
    });

    it("null means unrestricted: every chip reads as allowed", function () {
      expect(isToolAllowed(null, "web_search")).to.equal(true);
      expect(isToolAllowed(null, "anything_at_all")).to.equal(true);
    });

    it("[] means block all: no chip reads as allowed", function () {
      expect(isToolAllowed([], "web_search")).to.equal(false);
      expect(isToolAllowed([], "read_file")).to.equal(false);
    });

    it("a list allows exactly its members", function () {
      expect(isToolAllowed(["web_search"], "web_search")).to.equal(true);
      expect(isToolAllowed(["web_search"], "terminal")).to.equal(false);
    });
  });

  describe("restore from a persisted conversation", function () {
    it("preserves an explicit [] (block all) on load", function () {
      expect(resolveAllowedTools([])).to.deep.equal([]);
    });

    it("treats a missing field as unrestricted (null)", function () {
      expect(resolveAllowedTools(undefined)).to.equal(null);
      expect(resolveAllowedTools(null)).to.equal(null);
    });

    it("round-trips a selected subset", function () {
      expect(resolveAllowedTools(["web_search"])).to.deep.equal(["web_search"]);
    });
  });
});
