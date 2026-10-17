import { BasicTool } from "zotero-plugin-toolkit";
import Addon from "./addon";
import { config } from "../package.json";

// The bundle runs in a sandbox whose global object has no browser globals, and
// React reaches for `window` as soon as a UI module is imported. Fill them in
// before any module that imports React is evaluated.
const mainWindow = Zotero.getMainWindow();
if (mainWindow) {
  const sandboxGlobal = globalThis as any;
  const browserGlobals: Record<string, unknown> = {
    window: mainWindow,
    document: mainWindow.document,
    navigator: mainWindow.navigator,
    console: mainWindow.console,
  };
  for (const [name, value] of Object.entries(browserGlobals)) {
    if (typeof sandboxGlobal[name] === "undefined") {
      sandboxGlobal[name] = value;
    }
  }
}

const basicTool = new BasicTool();

// @ts-expect-error - Plugin instance is not typed
if (!basicTool.getGlobal("Zotero")[config.addonInstance]) {
  _globalThis.addon = new Addon();
  defineGlobal("ztoolkit", () => _globalThis.addon.data.ztoolkit);
  // @ts-expect-error - Plugin instance is not typed
  Zotero[config.addonInstance] = addon;
}

// Expose a sandbox global as a live getter rather than a snapshot, so callers
// that resolve it late get the current value — `ztoolkit` is rebuilt per window.
function defineGlobal(name: Parameters<BasicTool["getGlobal"]>[0]): void;
function defineGlobal(name: string, getter: () => any): void;
function defineGlobal(name: string, getter?: () => any) {
  Object.defineProperty(_globalThis, name, {
    get() {
      return getter ? getter() : basicTool.getGlobal(name);
    },
  });
}
