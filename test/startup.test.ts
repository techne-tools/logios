import { assert } from "chai";
import { config } from "../package.json";

describe("startup", function () {
  it("registers the plugin instance on the Zotero global", function () {
    const zoteroGlobal = Zotero as unknown as Record<string, unknown>;
    assert.isNotEmpty(zoteroGlobal[config.addonInstance]);
  });
});
