<!--
Source: Based on the logios codebase, windingwind's zotero-plugin-template, and daily development workflows
-->

# Common Tasks

## Build & Test Commands

```bash
# Development server with hot reload
npm start

# Production build
npm run build

# Run tests (Mocha + Chai)
npm test

# Lint check only
npm run lint:check

# Auto-fix linting
npm run lint:fix

# Update dependencies
npm run update-deps
```

Quick workflow: **code → `npm run build` → install `.xpi` in Zotero → test**.

## Add a New Hermes Module

### 1. Create the module file

```typescript
// src/modules/hermes/MyNewModule.ts
export class MyNewModule {
  private readonly addon: any;

  constructor(addon: any) {
    this.addon = addon;
  }

  public async doSomething(): Promise<string> {
    try {
      // Use addon.data.hermes to access other modules
      const items = this.addon.data.hermes.items.getSelectedItems();
      this.addon.log("MyNewModule: doSomething called");
      return "Done";
    } catch (error) {
      this.addon.log(`MyNewModule error: ${(error as Error).message}`);
      throw error;
    }
  }
}
```

### 2. Register in `src/hooks.ts` onStartup()

```typescript
import { MyNewModule } from "./modules/hermes/MyNewModule";

// In onStartup(), after other module initializations:
addon.log("Step N: Creating MyNewModule...");
const myModule = new MyNewModule(addon);
addon.data.hermes.myModule = myModule;
```

### 3. Add type to `src/addon.ts`

```typescript
hermes?: {
  // ... existing modules ...
  myModule: import("./modules/hermes/MyNewModule").MyNewModule;
};
```

## Work with Zotero Items

```typescript
// Get selected items from active pane
const zoteroPane = Zotero.getActiveZoteroPane();
const items: Zotero.Item[] = zoteroPane?.getSelectedItems() || [];

// Get item by ID
const item = await Zotero.Items.getAsync(itemID);

// Get all items in user library
const allItems = await Zotero.Items.getAll(Zotero.Libraries.userLibraryID);

// Extract metadata (from ItemManager.ts)
const title = item.getDisplayTitle();
const creators = item
  .getCreators()
  .map((c: any) => (c.firstName ? `${c.firstName} ${c.lastName}` : c.name));
const tags = item.getTags().map((t: any) => t.tag);
const abstract = item.getField("abstractNote") as string;
const url = item.getField("url") as string;
const doi = item.getField("DOI") as string;
const date = item.getField("date") as string;
```

## Work with Notes

```typescript
// Read note content
const note = await Zotero.Items.getAsync(noteID);
const content = note.getNote();

// Create a new note
const newNote = new Zotero.Item("note");
newNote.libraryID = Zotero.Libraries.userLibraryID;
newNote.setNote("New content here");
await newNote.saveTx();

// Get parent item from a note
const parent = await Zotero.Items.getAsync(note.parentItemID);
```

## Work with Annotations

```typescript
// Get annotations for an item
const item = await Zotero.Items.getAsync(itemID);
const annotations = await item.getAnnotations();

// Access annotation properties
for (const ann of annotations) {
  const text = ann.annotationText;
  const comment = ann.annotationComment;
  const color = ann.annotationColor;
  const type = ann.annotationType; // "highlight" | "underline" | "strikeout"
  const page = ann.annotationPageLabel;
}
```

## React Component in Zotero

```typescript
// Mount React 19 in XUL container
import { createRoot } from "react-dom/client";

const container = doc.createElement("div");
container.id = "hermes-react-root";
container.style.cssText = "width: 100%; height: 100%; display: flex; flex-direction: column;";

const root = createRoot(container);
root.render(<HermesChatViewComponent addon={addon} />);

// Store unmount for cleanup
container._unmount = () => root.unmount();
container.dataset.mounted = "true";
```

## ACP Communication

```typescript
// Send JSON-RPC request via stdio
const request = {
  jsonrpc: "2.0",
  id: `msg_${counter}`,
  method: "session/prompt",
  params: {
    sessionId: "...",
    prompt: [{ type: "text", text: "Hello" }],
  },
};
this.writeToStdin(JSON.stringify(request) + "\n");

// Handle streaming notification
// {"jsonrpc":"2.0","method":"session/update","params":{"content":"..."}}
// Subscribe via onUpdate callback:
client.onUpdate((update) => {
  if (update.type === "message") console.log(update.content);
});
```

## API Client Request

```typescript
const response = await fetch(`${apiUrl}/v1/chat/completions`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "hermes-agent",
    messages: [{ role: "user", content: "Hello" }],
    stream: true,
  }),
});
```

## Add a Slash Command

```typescript
// In src/modules/hermes/SlashCommands.ts
const BUILT_IN_COMMANDS: SlashCommand[] = [
  {
    name: "mycommand",
    description: "Description of what it does",
    execute: async (addon, args) => {
      const items = addon.data.hermes.items.getSelectedItems();
      return `Found ${items.length} items`;
    },
  },
  // ... existing commands: clear, context, help, export
];
```

## Register Toolbar Button

```typescript
const btn = doc.createXULElement("toolbarbutton") as any;
btn.setAttribute("id", "zotero-hermes-tb-chat-toggle");
btn.setAttribute("tooltiptext", "Toggle Hermes Chat");
btn.setAttribute("aria-pressed", "false");
btn.style.listStyleImage =
  "url('chrome://hermes/content/icons/hermes-sidenav.svg')";

const separator = doc.createElement("div") as any;
separator.className = "zotero-tb-separator";

// Insert before sync button
(syncBtn.parentNode as any).insertBefore(btn, syncBtn);
(syncBtn.parentNode as any).insertBefore(separator, syncBtn);

btn.addEventListener("click", () => toggleHermesSidebar(win));
```

## Localization

```typescript
// Initialize locale
import { initLocale } from "./utils/locale";
initLocale();

// Get string by FTL key
import { getString } from "./utils/locale";
const label = getString("pref-connection-title");

// With dynamic arguments
const greeting = getString("welcome-message", {
  args: { name: "Hermes" },
});

// With branch (variant)
const branchText = getString("addon-static-example", {
  branch: "branch-example",
});
```

## Debug Logging

```typescript
// Via addon.log (wraps Zotero.debug)
addon.log("Step 4: Creating Hermes client...");
addon.log("Connection failed", error);

// Via console (falls back to Zotero.debug if undefined)
console.log("[Hermes] Debug message");

// For production, use Zotero.debug directly
Zotero.debug("[Hermes] startup complete");
```

## Create XUL Element with ztoolkit

```typescript
const button = ztoolkit.UI.createElement(doc, "button", {
  id: "hermes-send-btn",
  class: "hermes-btn-primary",
  properties: { label: "Send" },
  listeners: { command: () => handleSend() },
});
```

## Register Notifier

```typescript
const notifierID = Zotero.Notifier.registerObserver(
  {
    notify: async (event, type, ids, extraData) => {
      if (!addon?.data.alive) return;
      addon.hooks.onNotify(event, type, ids, extraData);
    },
  },
  ["tab", "item", "file"],
);

// Cleanup
Zotero.Notifier.unregisterObserver(notifierID);
```

### Using Debugger

1. Open Zotero's Browser Console (Tools → Developer → Browser Console)
2. Set breakpoints in source code
3. Use `debugger;` statement in code

### Common Issues

**Plugin not loading**

- Check manifest.json version compatibility
- Verify addon ID is unique
- Check browser console for errors

**UI not appearing**

- Check element IDs match between XUL and code
- Verify CSS is loaded
- Check for JavaScript errors

**API calls failing**

- Verify Zotero is initialized
- Check async/await usage
- Look for permission issues

## Performance Optimization

### Profiling

```typescript
// Measure function execution time
const start = performance.now();
await heavyOperation();
const end = performance.now();
console.log(`Operation took ${end - start}ms`);
```

### Memory Leaks

```typescript
// Check for leaks
const initialMemory = performance.memory?.usedJSHeapSize;
// ... run operation
const finalMemory = performance.memory?.usedJSHeapSize;
console.log(`Memory delta: ${finalMemory - initialMemory} bytes`);
```

## Release Process

### 1. Update Version

```bash
npm version patch  # or minor, major
```

### 2. Update Changelog

```markdown
## [0.1.1] - 2026-06-01

### Added

- New feature description

### Fixed

- Bug fix description
```

### 3. Build and Test

```bash
npm run build
npm test
```

### 4. Create Release

```bash
npm run release
```

### 5. Verify

- Check GitHub release page
- Download and test XPI file
- Verify update URL works

## Troubleshooting

### Build Errors

```bash
# Clean build
rm -rf .scaffold/build
npm run build

# Update dependencies
npm update

# Check TypeScript errors
npx tsc --noEmit
```

### Runtime Errors

1. Check Browser Console for stack traces
2. Verify Zotero version compatibility
3. Check for missing dependencies
4. Review recent changes

### Performance Issues

1. Profile with Browser DevTools
2. Check for memory leaks
3. Optimize hot paths
4. Consider lazy loading
