/**
 * The UI pieces the plugin actually uses. The template shipped a set of
 * example factories (notifiers, keyboard shortcuts, command palette, dialogs);
 * none of them are in use here, so only the stylesheet hook remains.
 */

export class UIExampleFactory {
  /** Attach the addon stylesheet to a window. */
  static registerStyleSheet(win: _ZoteroTypes.MainWindow) {
    const doc = win.document;
    const stylesheet = ztoolkit.UI.createElement(doc, "link", {
      properties: {
        rel: "stylesheet",
        type: "text/css",
        href: `chrome://${addon.data.config.addonRef}/content/zoteroPane.css`,
      },
    });
    doc.documentElement?.appendChild(stylesheet);
  }
}
