import { expect } from "chai";
import {
  buildCitationDiff,
  buildCitationInsertion,
  decodeHtmlEntities,
  escapeCitationText,
  positionLabel,
} from "../src/modules/hermes/citationInsert";

/**
 * The pure half of citation insertion.
 *
 * These assertions are the safety net for the write path: `writeNote` sends
 * note bodies straight to `note.setNote()` with no escaping of its own, so the
 * escaping and end-position logic here is what keeps a citation containing
 * "&", "<", ">" or quotes from corrupting the user's note.
 */
describe("citationInsert", function () {
  describe("escapeCitationText", function () {
    it("escapes the five HTML-significant characters", function () {
      expect(escapeCitationText("Smith & Jones <2020> \"q\" 'r'")).to.equal(
        "Smith &amp; Jones &lt;2020&gt; &quot;q&quot; &#39;r&#39;",
      );
    });

    it("escapes & first so later replacements are not double-escaped", function () {
      // The classic ordering bug: escaping "<" before "&" would leave "&lt;"
      // intact and then turn its "&" into "&amp;lt;".
      expect(escapeCitationText("<")).to.equal("&lt;");
      expect(escapeCitationText("&lt;")).to.equal("&amp;lt;");
    });

    it("leaves a plain author-year citation untouched", function () {
      expect(escapeCitationText("(Schafer, 1977)")).to.equal("(Schafer, 1977)");
    });
  });

  describe("decodeHtmlEntities", function () {
    it("is the inverse of escapeCitationText for the five characters", function () {
      const raw = "Smith & Jones <2020> \"q\" 'r'";
      expect(decodeHtmlEntities(escapeCitationText(raw))).to.equal(raw);
    });

    it("decodes an escaped ampersand that would otherwise reach the note verbatim", function () {
      // CSL bibliography HTML arrives as "Smith &amp; Jones"; left undecoded it
      // inserts the literal "&amp;" (and re-escaping compounds it to "&amp;amp;").
      expect(decodeHtmlEntities("Smith &amp; Jones")).to.equal("Smith & Jones");
    });

    it("decodes &amp; LAST so a doubly-escaped entity collapses one level", function () {
      // "&amp;lt;" is the text "&lt;", not "<".
      expect(decodeHtmlEntities("&amp;lt;")).to.equal("&lt;");
    });

    it("round-trips through escape -> decode -> escape unchanged", function () {
      const raw = "A & B <c> \"d\" 'e'";
      const once = escapeCitationText(raw);
      expect(escapeCitationText(decodeHtmlEntities(once))).to.equal(once);
    });
  });

  describe("buildCitationInsertion", function () {
    it("yields just the paragraph when the note is empty", function () {
      const plan = buildCitationInsertion("", "(Schafer, 1977)", "bottom");
      expect(plan.newContent).to.equal("<p>(Schafer, 1977)</p>");
      expect(plan.insertion).to.equal("<p>(Schafer, 1977)</p>");
    });

    it("treats a whitespace-only note as empty (no leading blank line)", function () {
      const plan = buildCitationInsertion("   \n  ", "x", "top");
      expect(plan.newContent).to.equal("<p>x</p>");
    });

    it("appends at the bottom, preserving the existing body verbatim", function () {
      const existing = "<p>Draft paragraph.</p>";
      const plan = buildCitationInsertion(existing, "(Lee, 2024)", "bottom");
      expect(plan.newContent).to.equal(
        "<p>Draft paragraph.</p>\n<p>(Lee, 2024)</p>",
      );
    });

    it("prepends at the top, preserving the existing body verbatim", function () {
      const existing = "<p>Draft paragraph.</p>";
      const plan = buildCitationInsertion(existing, "(Lee, 2024)", "top");
      expect(plan.newContent).to.equal(
        "<p>(Lee, 2024)</p>\n<p>Draft paragraph.</p>",
      );
    });

    it("escapes the citation body", function () {
      const plan = buildCitationInsertion("", "Smith & Jones", "bottom");
      expect(plan.newContent).to.equal("<p>Smith &amp; Jones</p>");
    });

    it("trims surrounding whitespace from the citation", function () {
      const plan = buildCitationInsertion("", "  (Lee, 2024)  ", "bottom");
      expect(plan.newContent).to.equal("<p>(Lee, 2024)</p>");
    });

    it("refuses an empty citation rather than writing an empty paragraph", function () {
      expect(() => buildCitationInsertion("body", "   ", "bottom")).to.throw(
        /empty citation/i,
      );
    });

    it("names the position it echoed back", function () {
      expect(buildCitationInsertion("", "x", "top").position).to.equal("top");
      expect(buildCitationInsertion("", "x", "bottom").position).to.equal(
        "bottom",
      );
    });
  });

  describe("positionLabel", function () {
    it("renders both positions as prose", function () {
      expect(positionLabel("top")).to.equal("top of the note");
      expect(positionLabel("bottom")).to.equal("bottom of the note");
    });
  });

  describe("buildCitationDiff", function () {
    it("carries the exact insertion text and the named position", function () {
      const plan = buildCitationInsertion("", "(Lee, 2024)", "bottom");
      const diff = buildCitationDiff(plan, { target: 'a note under "X"' });
      expect(diff).to.include("Insert citation at the bottom of the note");
      expect(diff).to.include('Target: a note under "X"');
      expect(diff).to.include("<p>(Lee, 2024)</p>");
    });

    it("includes the style when one is named", function () {
      const plan = buildCitationInsertion("", "(Lee, 2024)", "top");
      const diff = buildCitationDiff(plan, {
        target: "n",
        styleName: "APA 7th",
      });
      expect(diff).to.include("Style: APA 7th");
    });

    it("omits the style line when none is named", function () {
      const plan = buildCitationInsertion("", "(Lee, 2024)", "top");
      const diff = buildCitationDiff(plan, { target: "n" });
      expect(diff.join("\n")).to.not.include("Style:");
    });
  });
});
