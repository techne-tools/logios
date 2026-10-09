# Spike: reader-chat panel feasibility (Zotero 10)

**Date:** 2026-10-09
**Question (spec §6, open question 6.2):** can the plugin mount a collapsible
chat panel _inside the PDF reader chrome_ via `Zotero.Reader.registerEventListener`
("render" hook)?
**Verdict:** **Not feasible.** The reader exposes no panel hook, and no stable
extension point for arbitrary DOM. Keep the shipped toolbar/context-menu →
library-sidebar integration.

---

## What was checked

Against the installed **Zotero 10.0.6** bundle
(`/Applications/Zotero.app/Contents/Resources/app/omni.ja`):

- `chrome/content/zotero/xpcom/reader.js` — the `Reader` class: listener
  registry, event dispatch, reader instantiation, sidebar state.
- `chrome/content/zotero/reader.xhtml` — the reader window markup.
- `resource/reader/reader.js` — the reader iframe bundle (what actually emits
  the events).

## Findings

### 1. `registerEventListener` is a fixed seven-slot dispatcher

```js
registerEventListener(type, handler, pluginID = undefined) {
  this._registeredListeners.push({ pluginID, type, handler });
}
_dispatchEvent(event) {
  for (let listener of this._registeredListeners) {
    if (listener.type === event.type) listener.handler(event);
  }
}
```

The accepted `type` values come from `ReaderEventMap` (zotero-types
`types/xpcom/reader.d.ts:74`), and they are exhaustive:

| slot                            | what it is                        |
| ------------------------------- | --------------------------------- |
| `renderTextSelectionPopup`      | popup over an existing highlight  |
| `renderSidebarAnnotationHeader` | a header in the annotation list   |
| `renderToolbar`                 | the reader toolbar                |
| `createColorContextMenu`        | right-click menu (colour)         |
| `createViewContextMenu`         | right-click menu (view/selection) |
| `createAnnotationContextMenu`   | right-click menu (annotation)     |
| `createThumbnailContextMenu`    | right-click menu (thumbnail)      |
| `createSelectorContextMenu`     | right-click menu (selector)       |

There is **no panel, canvas, or generic-container hook.** The plan's "render
hook" does not exist as a thing you can subscribe to.

### 2. `append()` is slot-bound and must be synchronous

The reader iframe emits a `CustomEvent('customEvent')`; `Reader` forwards it:

```js
this._customEventHandler = (event) => {
  let data = event.detail.wrappedJSObject;
  let append = data.append;
  data.append = (...args) =>
    append(
      ...Components.utils.cloneInto(args, this._iframeWindow, {
        wrapReflectors: true,
        cloneFunctions: true,
      }),
    );
  data.reader = this;
  Zotero.Reader._dispatchEvent(data);
};
```

And in the iframe bundle the append target is a **fixed React ref**:

```js
let append = (...args) => {
  if (finished)
    throw new Error(
      "Append must be called directly and synchronously in the event",
    );
  let section = document.createElement("div");
  section.className = "section";
  section.append(...args);
  sectionRef.current.append(section); // <-- fixed container
};
let event = new CustomEvent("customEvent", {
  detail: { type: `render${type}`, doc: document, append, params: props },
});
```

Two consequences: the node lands in whichever container Zotero designated for
that slot, and it must be created **inline** (the `finished` flag throws
otherwise — no `await`, no deferred mount).

### 3. No plugin sidebar API

The reader sidebar (`Zotero_Tabs.getSidebarState('reader')`, `setSidebarWidth`,
`setSidebarOpen`) is Zotero's own annotation pane. It has no section/plugin
registration surface.

### 4. What the plugin already does

`registerReaderActions()` (`src/hooks.ts:298`) already registers
`renderTextSelectionPopup` (a "⚡ Hermes" button) and `createViewContextMenu`
("Explain Selection" / "Critique Argument"). Each calls `runReaderAction()`,
which attaches the reader's item, builds a prompt (`buildReaderPrompt`), opens
the library sidebar and dispatches it. This is the sandbox-safe ceiling.

## Why a panel would need private internals

Mounting our own `HermesChatView` root in the reader would mean addressing
`reader._tabContainer` / `reader._iframeWindow` / the reader iframe DOM
directly. Those are underscore-private, undocumented, and have already changed
across Zotero majors (the reader was reimplemented for Zotero 7). Building on
them would be a permanent maintenance debt against a surface the host does not
support — and would break silently on the next reader rewrite.

## Recommendation

**Do not build a reader-chrome panel.** Keep the shipped integration:

- selection-popup button + context-menu actions → library-sidebar chat;
- the sidebar can sit beside the reader in a split layout, which delivers the
  "chat beside the PDF" intent without fighting the host.

Record the finding in `TODO.md` (done) and close spec §6 / open question 6.2
(done). If "chat beside the PDF" later needs a genuinely reader-anchored
surface, the honest options are (a) an upstream feature request to expose a
reader sidebar section API, or (b) revisit only if Zotero publishes one.
