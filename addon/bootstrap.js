/**
 * Zotero addon entry point. Zotero loads this file itself, outside the bundle,
 * so it stays plain JS with no imports and no transpilation.
 *
 * The lifecycle contract these functions implement — install, startup,
 * per-window load/unload, shutdown, uninstall, plus the chrome registration
 * call — is documented at
 * https://www.zotero.org/support/dev/zotero_7_for_developers
 */

var chromeHandle;

var console = ChromeUtils.importESModule(
  "resource://gre/modules/Console.sys.mjs",
).console;

function install(data, reason) {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  var addonManager = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  var manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = addonManager.registerChrome(manifestURI, [
    ["content", "__addonRef__", rootURI + "content/"],
  ]);

  // Sandbox for the bundled script. Anything it has to expose to other scopes
  // hangs off `_globalThis`; see src/index.ts.
  const sandbox = { rootURI };
  sandbox._globalThis = sandbox;

  // React and the bundle expect browser globals; the sandbox has none.
  const mainWindow = Zotero.getMainWindow();
  if (mainWindow) {
    sandbox.window = mainWindow;
    sandbox.document = mainWindow.document;
    sandbox.navigator = mainWindow.navigator;
  }

  // Route the bundle's console.* calls to Zotero's debug output.
  const toDebug =
    (level) =>
    (msg, ...args) =>
      Zotero.debug(`[Hermes-${level}] ${msg} ${args.join(" ")}`);
  sandbox.console = {
    log: toDebug("log"),
    warn: toDebug("warn"),
    error: toDebug("error"),
    info: toDebug("info"),
    group: () => {},
    groupCollapsed: () => {},
    groupEnd: () => {},
    trace: () => {},
  };

  // Zotero caches subscript loads, so a rebuilt bundle would otherwise keep
  // running the previous build until the whole application restarts.
  Services.scriptloader.loadSubScript(
    `${rootURI}/content/scripts/__addonRef__.js?cacheBuster=${Date.now()}`,
    sandbox,
  );

  try {
    await Zotero.__addonInstance__.hooks.onStartup();
  } catch (e) {
    Zotero.debug(`[Hermes] Bootstrap startup error: ${e}`);
    Zotero.debug(`[Hermes] Stack: ${e.stack}`);
    throw e;
  }
}

async function onMainWindowLoad({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowLoad(window);
}

async function onMainWindowUnload({ window }, reason) {
  await Zotero.__addonInstance__?.hooks.onMainWindowUnload(window);
}

async function shutdown({ id, version, resourceURI, rootURI }, reason) {
  // Application is going down: nothing left to unregister.
  if (reason === APP_SHUTDOWN) {
    return;
  }

  await Zotero.__addonInstance__?.hooks.onShutdown();

  if (chromeHandle) {
    chromeHandle.destruct();
    chromeHandle = null;
  }
}

async function uninstall(data, reason) {}
