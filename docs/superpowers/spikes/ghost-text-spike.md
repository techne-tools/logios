# Ghost-text feasibility spike (Task 10)

**Date:** 2026-10-09
**Method:** read-only audit of the installed Zotero **10.0.6** bundle
(`/Applications/Zotero.app/Contents/Resources/app/omni.ja`). Every claim below
cites the source file and the member inspected. No code was written.
**Verdict: INFEASIBLE as a supported feature.** Drop ghost text from the
roadmap. The honest alternative already ships this wave (citation insertion at
top/bottom).

> This file replaces an earlier speculative draft. That draft asserted ghost
> text was "likely" feasible and recommended `setInterval`-polling heuristics.
> It had no evidence against the editor internals and contradicted the sibling
> reader-panel spike. It is superseded by the bundle audit below.

---

## What the note editor actually is

The note editor is **not** a DOM element a plugin can decorate. It is:

1. A XUL custom element (`NoteEditor extends XULElement`) at
   `chrome/content/zotero/elements/noteEditor.js`, which creates:
2. An **`<iframe type="content" src="resource://zotero/note-editor/editor.html">`**
   (`noteEditor.js:52`) — a _separate, content-privileged document_.
3. Inside that iframe: a **React + ProseMirror** app
   (`resource/note-editor/editor.html` loads `react.js`, `react-dom.js`,
   `editor.js`; `editor.js` is 972 KB and contains the ProseMirror engine).

The chrome side (`Zotero.EditorInstance`, `xpcom/editorInstance.js`) talks to the
editor body **only** through a private `postMessage` protocol:

```js
_postMessage(message) {
  this._iframeWindow.postMessage({ instanceID: this.instanceID, message }, '*');
}
```

(`editorInstance.js:424`). Actions are a closed set the parent defines —
`init`, `focus`, `insertHTML`, `updateIncrementally`, `setFont`, `setStyle`,
`contextMenuAction`, … (`editorInstance.js:225–994`). There is no
"text changed", "cursor moved", or "get selection" action.

## The four things that would be needed — none exist

| Requirement for ghost text                    | Supported surface? | Evidence                                                                                                                                                                                                                            |
| --------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read the caret / selection position**       | ❌ No              | No `Zotero.Notes` member and no `EditorInstance` method returns a cursor offset or range. `saveSync()` reads the whole document (`editorInstance.js:373`); nothing reads the caret.                                                 |
| **Render an overlay in the editor**           | ❌ No              | The editor has no plugin slot. The only plugin-facing UI registration in this area is `Zotero.ItemPaneManager.registerSection` (`pluginAPI/itemPaneManager.js:548`), which adds a pane **on an item** — not inside the note editor. |
| **Subscribe to keystrokes / content changes** | ❌ No              | The iframe owns its own event loop. The parent receives only the postMessage actions above; there is no public change or key event.                                                                                                 |
| **Insert text at the cursor**                 | ❌ No              | `insertHTML` exists but is parent→iframe only and takes `pos: null` for "at end of document" (`editorInstance.js:397, 664`); it is not exposed to plugins and cannot target an arbitrary caret.                                     |

## The one surface that looked promising — and why it isn't

`Zotero.Notes.registerEditorInstance(instance)` **does** exist
(`data/notes.js:236`), and `Zotero.Notes.getByTabID(tabID)` returns an instance.
But both are **Zotero-internal plumbing**, not a plugin API:

- `registerEditorInstance` is called by `EditorInstance.init()` **on itself**
  (`editorInstance.js:80`) to populate Zotero's own `_editorInstances` array;
  a plugin has nothing to register. There is no "iterate open editors" or
  "on editor opened" hook.
- The returned object's usable members are underscore-private:
  `_iframeWindow` (the content-privileged iframe window), `_postMessage`,
  `_editorInstance`. Reaching through `_iframeWindow.wrappedJSObject` to run DOM
  surgery on a live **ProseMirror** instance is (a) unsupported, (b)
  version-fragile across Zotero releases, and (c) liable to desync the editor's
  internal document model — the same failure class the repo's sandbox rules
  exist to prevent.

`Zotero.Notes`' full public member list (`data/notes.js`) is: `open`,
`getByTabID`, `copyEmbeddedImages`, `deleteUnusedEmbeddedImages`,
`ensureEmbeddedImagesAreAvailable`, `getExportableNote`, `hasSchemaVersion`,
`noteToTitle`, `replaceAllItemKeys`, `replaceItemKey`, `setSidebarWidth`,
`toggleSidebar`, `setContextPaneOpen`, `setBottomPlaceholderHeight`,
`updateUser`, `registerEditorInstance`, `unregisterEditorInstance`. **None is a
hook into the editing surface.**

## Recommendation

**Drop ghost text from the roadmap.** Record the finding in TODO.md and resolve
spec open question 3. The plan explicitly allows this outcome ("If infeasible →
drop from roadmap with the finding recorded in TODO.md").

**Do not** implement the polling/heuristic approach the earlier draft proposed —
`setInterval` scanning for a "note editor" element cannot see inside the content
iframe, and DOM-surgery on ProseMirror is the fragile path above.

**What to offer instead** (already in place or trivially reachable, no cursor API
needed):

- **Deliberate insertion** — the `/cite` "Insert at top / bottom of note" pills
  (Wave 4, Task 9) put a citation into a note, gated and audited, without needing
  to read the caret.
- **Completion as a command** — a future `/complete`-style action could generate
  a suggested continuation and _append it_ to the note (an end-position write,
  exactly the Task 9 mechanism). This delivers "the agent helps me finish this
  note" without pretending to be inline ghost text.

If a genuine inline editor API appears in a future Zotero, reopen this spike —
the gating question is whether the editor exposes a **public** caret/selection
and insertion surface, not whether the iframe is reachable.

## Open risk (unverified)

The earlier draft's claim that Zotero's editor is "Firefox/XUL-based, not
CodeMirror" is correct in spirit but imprecise: it is **ProseMirror** (a
different engine) inside a React app inside a content iframe. The practical
consequence — no plugin DOM hook — is the same, but any future work must target
ProseMirror's model, not a generic contenteditable.
