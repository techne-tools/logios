import { ZoteroToolkit } from "zotero-plugin-toolkit/ztoolkit";
import { config } from "../../package.json";

export { createZToolkit };

function createZToolkit() {
  const toolkit = new ZoteroToolkit();
  applyToolkitConfig(toolkit);
  return toolkit;
}

/**
 * Configuration for a fresh toolkit instance.
 *
 * `basicOptions.debug` is deliberately left alone: reading it drags in the
 * debug bridge, which is deprecated and not worth loading in production.
 */
function applyToolkitConfig(toolkit: ReturnType<typeof createZToolkit>) {
  const development = __env__ === "development";

  toolkit.basicOptions.log.prefix = `[${config.addonName}]`;
  toolkit.basicOptions.log.disableConsole = !development;
  toolkit.basicOptions.api.pluginID = config.addonID;

  // Element logging is noise outside development.
  toolkit.UI.basicOptions.ui.enableElementJSONLog = development;
  toolkit.UI.basicOptions.ui.enableElementDOMLog = development;

  toolkit.ProgressWindow.setIconURI(
    "default",
    `chrome://${config.addonRef}/content/icons/favicon.png`,
  );
}
