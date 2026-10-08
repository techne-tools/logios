<!--
Source: Based on Zotero plugin development guidelines, windingwind's zotero-plugin-template docs, and the zotero-hermes codebase
-->

# Plugin Guidelines

## Architecture Overview

Zotero plugins use:

- **XUL/XHTML**: Native UI framework (Firefox-based)
- **TypeScript**: Core logic (bundled via esbuild)
- **React 19**: For complex interactive components (chat UI)
- **zotero-plugin-toolkit**: Helper library for UI, menus, preferences
- **zotero-plugin-scaffold**: Build system with hot reload

## Plugin Lifecycle

### Startup Sequence

1. `src/index.ts` — Sets browser globals for React in Zotero sandbox, instantiates `Addon`
2. `src/addon.ts` — Configures addon data with typed module registry
3. `src/hooks.ts` `onStartup()` — Waits for Zotero promises, initializes all Hermes modules, sets up UI for all existing windows
4. `onMainWindowLoad()` — Inserts FTL, registers toolbar button, creates sidebar, mounts React

### Shutdown Sequence

1. `onShutdown()` — Unregisters sidebar from all windows, cleans up toolkit, closes dialogs
2. `onMainWindowUnload()` — Per-window cleanup of sidebar and React roots

## Security

### Avoid innerHTML

Building DOM from AI-generated content using `innerHTML` poses XSS risks:

```typescript
// BAD — security risk
container.innerHTML = aiGeneratedContent;

// GOOD — use DOM API
const div = doc.createElement("div");
div.textContent = aiGeneratedContent;
container.appendChild(div);
```

### API Key Storage

- Store API keys in Zotero Preferences via `<html:input type="password">`
- Never log API keys to console or debug output
- Use the `PreferencesManager` for typed get/set access
- Keys are stored in Zotero's secure preference storage

### Approval System

All file/note modifications require user approval — use the `ApprovalDialog`:

```typescript
const approved = await approvalDialog.addPendingChange({
  id: "change_1",
  path: "/path/to/file",
  content: "new content",
  action: "update",
});
if (!approved) return; // User denied the change
```

## Guard Against Stale References

Always check `addon.data.alive` in async callbacks:

```typescript
const callback = {
  notify: async (event, type, ids, extraData) => {
    if (!addon?.data.alive) return; // CRITICAL — prevents errors after shutdown
    addon.hooks.onNotify(event, type, ids, extraData);
  },
};
```

## Window Management

Zotero can have multiple windows. Always iterate all windows:

```typescript
// Register in all existing windows
const mainWindows = Zotero.getMainWindows();
await Promise.all(mainWindows.map((win) => onMainWindowLoad(win)));

// Cleanup from all windows on shutdown
for (const win of Zotero.getMainWindows()) {
  unregisterHermesSidebar(win);
}
```

## React in Zotero Sandbox

### Critical: Use Native DOM Events

React synthetic `onChange` is unreliable in Zotero's sandboxed Firefox. Use native DOM event listeners instead:

```typescript
// In React component:
useEffect(() => {
  const textarea = inputRef.current;
  if (!textarea) return;
  const handler = (e: Event) => {
    setInput((e.target as HTMLTextAreaElement).value);
  };
  textarea.addEventListener("input", handler);
  return () => textarea.removeEventListener("input", handler);
}, []);
```

### Mount/Unmount Lifecycle

```typescript
// Mount
const root = createRoot(container);
root.render(<HermesChatViewComponent addon={addon} />);
container._unmount = () => root.unmount();
container.dataset.mounted = "true";

// Unmount (on window unload or sidebar toggle)
if (container?._unmount) {
  container._unmount();
}
```

## Performance

- Use `requestAnimationFrame` for stream buffering (see `useStreamBuffer.ts`)
- Debounce rapid input events
- Batch Zotero item operations when possible
- Limit context items to prevent excessive token usage
- Lazy load React components
- Use `addon.log()` for debug, not for production hot paths

## ACP/Subprocess Communication

```typescript
// Spawn via Firefox Subprocess.sys.mjs
const { Subprocess } = ChromeUtils.importESModule(
  "resource://gre/modules/Subprocess.sys.mjs",
);
this.childProcess = await Subprocess.call({
  command: "/bin/zsh",
  arguments: ["-c", `"${hermesPath}" acp`],
  stdin: "pipe",
  stdout: "pipe",
  stderr: "pipe",
  environment: { PYTHONUNBUFFERED: "1" },
  environmentAppend: true,
});
```

## Version Compatibility

- Target Zotero 9.0.0+ (current: 10.x, Firefox 140 ESR)
- Set `strict_min_version` in `addon/manifest.json`
- Use `zotero-types` for type definitions matching target version
- Test with Zotero beta releases
- Manifest: `strict_max_version: "10.*"`

### Large Libraries

Handle libraries with 10,000+ items:

```typescript
// Batch operations
const batchSize = 100;
for (let i = 0; i < items.length; i += batchSize) {
  const batch = items.slice(i, i + batchSize);
  await processBatch(batch);
}
```

### Virtual Lists

For long lists, use virtual scrolling:

```typescript
// Only render visible items
const visibleItems = items.slice(startIndex, endIndex);
```

## Security

### Input Validation

Always validate user input:

```typescript
function sanitizeInput(input: string): string {
  return input.replace(/[<>]/g, ""); // Remove HTML tags
}
```

### Secure Storage

Use Zotero preferences for sensitive data:

```typescript
// Store
Zotero.Prefs.set("extensions.zotero.hermes.apiKey", encryptedKey, true);

// Retrieve
const key = Zotero.Prefs.get("extensions.zotero.hermes.apiKey", true);
```

## Debugging

### Console Logging

```typescript
Zotero.debug("[Hermes] Message"); // Only in debug builds
console.log("[Hermes] Message"); // Always visible
```

### Error Handling

```typescript
try {
  await riskyOperation();
} catch (error) {
  Zotero.logError(error);
  new Zotero.ProgressWindow("Error")
    .createLine({ text: error.message, type: "error" })
    .show();
}
```

## Resources

- [Zotero Plugin Dev Guide](https://windingwind.github.io/doc-for-zotero-plugin-dev/)
- [Zotero Types](https://github.com/windingwind/zotero-types)
- [Zotero Plugin Toolkit](https://github.com/windingwind/zotero-plugin-toolkit)
- [Zotero Source Code](https://github.com/zotero/zotero)
