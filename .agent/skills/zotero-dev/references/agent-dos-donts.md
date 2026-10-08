<!--
Source: Based on Zotero plugin development best practices, windingwind's zotero-plugin-toolkit, and the logios codebase
-->

# Agent Do/Don't

## Do ✅

### 1. Use TypeScript Strict Mode

Always use TypeScript with strict mode enabled:

```typescript
// Good — typed properly
function getItem(id: number): Promise<Zotero.Item> {
  return Zotero.Items.getAsync(id);
}

// Bad — avoids type safety
function getItem(id: any) {
  return Zotero.Items.getAsync(id);
}
```

### 2. Guard Against Stale References After Shutdown

Always check `addon.data.alive` in async callbacks:

```typescript
// Good — guards against shutdown
const callback = {
  notify: async (event, type, ids, extraData) => {
    if (!addon?.data.alive) return;
    addon.hooks.onNotify(event, type, ids, extraData);
  },
};

// Bad — may fire after shutdown
const callback = {
  notify: async (event, type, ids, extraData) => {
    addon.hooks.onNotify(event, type, ids, extraData);
  },
};
```

### 3. Clean Up on Shutdown

Unregister all observers, remove UI elements, and clean up React roots:

```typescript
// In onShutdown()
function onShutdown(): void {
  const mainWindows = Zotero.getMainWindows();
  for (const win of mainWindows) {
    unregisterHermesSidebar(win);
  }
  addon.data.ztoolkit?.unregisterAll();
  addon.data.alive = false;
  delete Zotero[addon.data.config.addonInstance];
}
```

### 4. Run Build After Changes

Always run `npm run build` after making changes to catch build errors early. Only check for npm installation if the build fails.

### 5. Use .refs for Reference Tracking

- Clone external repos into `.refs/<name>/`
- Use read-only commands like `git fetch` and `git log` to check for updates
- **Never automatically pull** — always ask the user first

### 6. Use the Dual-Mode Client Pattern

Both clients share the same public interface so the UI doesn't need to know which is active:

```typescript
// Either client works — same sendPrompt, onUpdate, onError interface
const client =
  connectionMode === "api"
    ? new HermesApiClient(addon)
    : new HermesClient(addon);
```

### 7. Use rAF-Buffered Streaming for UI Updates

Don't update React state on every stream chunk — buffer via `useStreamBuffer`:

```typescript
// Good — uses rAF buffering from useStreamBuffer.ts
const { appendContent, flushNow } = useStreamBuffer(setMessages, showReasoning);

// Handle stream chunks
const handleUpdate = (update: ChatSessionUpdate) => {
  if (update.type === "message" && update.content) {
    appendContent(update.content);
  } else if (update.type === "stop") {
    flushNow();
  }
};
```

### 8. Write Idempotent Code

Ensure reload/unload doesn't leak listeners or intervals:

```typescript
// Good — checks if already registered
if (syncBtn && !doc.getElementById("zotero-hermes-tb-chat-toggle")) {
  // Only create if doesn't exist
  const btn = doc.createXULElement("toolbarbutton");
  // ...
}
```

### 9. Use Native DOM Events in Zotero Sandbox

React synthetic events are unreliable in Zotero's sandboxed Firefox:

```typescript
// Good — uses native DOM input event
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

### 10. Release Preparation Checklist

When user asks "is my plugin ready for release?":

- [ ] Version bumped in `package.json`
- [ ] All tests passing
- [ ] Linting clean (`npm run lint:check`)
- [ ] Build succeeds (`npm run build`)
- [ ] XPI file generated in `.scaffold/build/`
- [ ] `manifest.json` version matches
- [ ] `update.json` / `update-beta.json` configured

## Don't ❌

### 1. Don't Auto-Commit or Auto-Push

Never automatically commit, push, or perform any git operations. All git operations must be left to the user.

### 2. Don't Pull Without Asking

When checking for updates to repos in `.refs`, use `git fetch` and `git log` to check what's new, but **never automatically pull** — always ask the user first.

### 3. Don't Use innerHTML

Building DOM from AI-generated content using `innerHTML` poses XSS security risks:

```typescript
// BAD — security risk
container.innerHTML = aiGeneratedContent;

// GOOD — use DOM API
const div = doc.createElement("div");
div.textContent = aiGeneratedContent;
container.appendChild(div);
```

### 4. Don't Add eslint-disable Comments Without Understanding Why

Read the error message, understand the root cause, and fix it properly.

### 5. Don't Make Network Calls Without Disclosure

Introduce network calls only with an obvious user-facing reason and documentation. Ship features that require cloud services only with clear disclosure and explicit opt-in.

### 6. Don't Store Secrets in Plain Text

- Store API keys in Zotero Preferences (not in files or localStorage)
- Use `password` input type in preferences XHTML
- Never log API keys to console or debug output

### 7. Don't Block the UI Thread

Use async/await for all Zotero API calls, and show progress for long operations.

### 8. Don't Hardcode User-Specific Paths

Use Zotero's profile directory and path utilities:

```typescript
// BAD
const path = "~/.hermes/config.json";

// GOOD
const profileDir = Zotero.getProfileDirectory();
profileDir.append("zotero-hermes");
```

## Fixing Linting Errors

**DO**:

1. Read the error message carefully — note the exact line and column
2. Understand what the error is actually complaining about
3. Fix the root cause, not the symptom
4. Test with `npm run lint:check` after each fix
5. Verify `npm run build` still works

**DON'T**:

- Add eslint-disable comments without understanding why
- Try the same fix multiple times without understanding why it failed
- Suppress errors as a shortcut

**When Stuck**:

1. Read the error message — what line/column is it complaining about?
2. Understand the type signature — what does the function expect?
3. Fix the actual type mismatch, not just suppress the warning
4. If you've tried the same thing 3 times, stop and re-read the error message

### 7. Don't Break Compatibility

Maintain backward compatibility:

```typescript
// Good - Check version
if (Zotero.version < "9.0.0") {
  showError("Zotero 9+ required");
  return;
}
```

### 8. Don't Skip Testing

Always test edge cases:

```typescript
// Test empty input
// Test very long input
// Test special characters
// Test concurrent operations
// Test offline mode
```

## Security Best Practices

### 1. Approval System

All AI-suggested modifications require user approval:

```typescript
async function modifyNote(
  note: Zotero.Item,
  newContent: string,
): Promise<void> {
  const approved = await showApprovalDialog(note, newContent);
  if (!approved) {
    return;
  }
  note.setNote(newContent);
  await note.saveTx();
}
```

### 2. Input Sanitization

Sanitize all user input and AI output:

```typescript
function sanitizeContent(content: string): string {
  // Remove potentially dangerous HTML
  return content.replace(/script/gi, "").replace(/on\w+\s*=/gi, "");
}
```

### 3. Secure Storage

Store sensitive data securely:

```typescript
// Good - Use Zotero's encrypted prefs
Zotero.Prefs.set("hermes.apiKey", encrypt(key), true);

// Bad - Never do this
const file = Zotero.File.pathToFile("api-key.txt");
Zotero.File.putContents(file, key);
```

## Performance Guidelines

### 1. Lazy Loading

Load heavy components only when needed:

```typescript
let heavyComponent: HeavyComponent | null = null;

function getHeavyComponent(): HeavyComponent {
  if (!heavyComponent) {
    heavyComponent = new HeavyComponent();
  }
  return heavyComponent;
}
```

### 2. Debouncing

Debounce rapid UI updates:

```typescript
let timeout: number | null = null;

function onInput(value: string): void {
  if (timeout) {
    clearTimeout(timeout);
  }
  timeout = window.setTimeout(() => {
    processInput(value);
  }, 300);
}
```

### 3. Virtual Lists

For long lists, render only visible items:

```typescript
const visibleItems = allItems.slice(
  scrollTop / itemHeight,
  (scrollTop + containerHeight) / itemHeight,
);
```

## Code Review Checklist

Before submitting code:

- [ ] TypeScript types are correct
- [ ] Error handling is comprehensive
- [ ] Resources are cleaned up
- [ ] User input is validated
- [ ] AI output is sanitized
- [ ] Tests are written and passing
- [ ] Documentation is updated
- [ ] No memory leaks
- [ ] Performance is acceptable
- [ ] Security is verified
