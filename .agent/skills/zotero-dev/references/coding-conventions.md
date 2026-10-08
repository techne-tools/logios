<!--
Source: Based on TypeScript best practices, Zotero plugin conventions, and the zotero-hermes codebase
-->

# Coding Conventions

## TypeScript Guidelines

- **Use `strict: true`** in `tsconfig.json`
- **Avoid `any` type**: Use proper types, `unknown`, or type assertions. `any` defeats type safety.
- **Keep entry points minimal**: `src/index.ts` and `src/addon.ts` should only handle lifecycle and module registration. Delegate feature logic to separate modules.
- **Split large files**: If a file exceeds ~300 lines, break it into smaller, focused modules.
- **Bundle everything**: esbuild target `firefox140` bundles into a single output file.
- **No Node/Electron APIs** — Zotero runs on Firefox 140 ESR (Zotero 10).
- **Prefer `async/await`** over promise chains; handle errors gracefully with user-friendly messages.

## Naming Conventions

| Element             | Convention       | Example                                                  |
| ------------------- | ---------------- | -------------------------------------------------------- |
| **Classes**         | PascalCase       | `HermesClient`, `ChatManager`, `ApprovalDialog`          |
| **Methods**         | camelCase        | `sendPrompt()`, `getSelectedItems()`, `writeToStdin()`   |
| **Constants**       | UPPER_SNAKE_CASE | `MAX_RECONNECT_ATTEMPTS`, `PROTOCOL_VERSION`             |
| **Files (classes)** | PascalCase       | `HermesClient.ts`, `ChatManager.ts`                      |
| **Files (utils)**   | camelCase        | `locale.ts`, `ztoolkit.ts`                               |
| **Interfaces**      | PascalCase       | `ChatSessionUpdate`, `PromptContextItem`, `AttachedItem` |

## Module Organization

```
src/
├── index.ts              # Entry — sets browser globals, instantiates Addon
├── addon.ts              # Addon class — typed registry, logging, config
├── hooks.ts              # Lifecycle — startup/shutdown/window events
├── modules/
│   └── hermes/           # Core integration modules
│       ├── types.ts              # SHARED type interfaces (ChatClient, ChatSessionUpdate, PendingFileChange, PromptContextItem)
│       ├── HermesClient.ts       # ACP/stdio subprocess (implements ChatClient)
│       ├── HermesApiClient.ts    # REST + SSE streaming (implements ChatClient)
│       ├── ChatManager.ts        # Conversation state bridge
│       ├── ConversationManager.ts # JSON file persistence
│       ├── NoteManager.ts        # Note CRUD
│       ├── ItemManager.ts        # Item metadata extraction
│       ├── AnnotationManager.ts  # PDF annotation reading
│       ├── CitationManager.ts    # CSL citation generation
│       ├── TagManager.ts         # Tag operations
│       ├── SlashCommands.ts      # /slash command registry
│       ├── ApprovalDialog.ts     # File change approval UI
│       └── PreferencesManager.ts # Zotero prefs wrapper
├── views/
│   ├── HermesChatView.tsx        # React chat UI (600+ lines)
│   └── useStreamBuffer.ts        # rAF-buffered streaming hook
└── utils/
    ├── uuid.ts                   # generateMessageId() — mirrors obsidian-hermes/src/utils/uuid.ts
    ├── stripAnsi.ts              # ANSI escape code stripping — mirrors obsidian-hermes
    ├── DebugLogger.ts            # Toggleable debug logging — mirrors obsidian-hermes/src/DebugLogger.ts
    ├── AuditLog.ts               # Persistent audit log — mirrors obsidian-hermes/src/AuditLog.ts
    ├── locale.ts                 # Fluent/Fluent localization
    ├── prefs.ts                  # Preference helpers
    └── ztoolkit.ts               # Toolkit initialization
```

## Module Boundaries

Each module has a single, well-defined responsibility:

| Module                | Responsible For                                    | Does NOT Handle          |
| --------------------- | -------------------------------------------------- | ------------------------ |
| `HermesClient`        | ACP protocol stdio (implements `ChatClient`)       | Conversation state, UI   |
| `HermesApiClient`     | REST API with SSE (implements `ChatClient`)        | Conversation state, UI   |
| `ChatManager`         | Bridging messages ↔ ConversationManager            | Protocol, file I/O       |
| `ConversationManager` | JSON file persistence                              | UI, protocol             |
| `NoteManager`         | Note read/write/search                             | Approval UI, prompts     |
| `ItemManager`         | Item metadata extraction                           | Note CRUD, annotations   |
| `AnnotationManager`   | Annotation extraction from items                   | Item metadata, citations |
| `CitationManager`     | CSL citation/bibliography gen                      | Annotations, tags        |
| `TagManager`          | Tag CRUD                                           | Annotations, topics      |
| `ApprovalDialog`      | Pending file change approval                       | File I/O, protocol       |
| `PreferencesManager`  | Preference get/set with defaults                   | UI, protocol             |
| `DebugLogger`         | Gated debug logging (toggle via `enableDebugMode`) | Audit history            |
| `AuditLog`            | Persistent action log (JSON file)                  | Live debugging           |

## React Conventions

- Use **React 19 `createRoot()`** (not legacy `ReactDOM.render`)
- Mount roots in XUL `<div>` containers
- Use **native DOM event listeners** when React synthetic events are unreliable (Zotero sandbox)
- Store unmount functions on the container element: `container._unmount = () => root.unmount()`
- Use `useRef` for DOM access and stream buffers instead of state
- Use `requestAnimationFrame` for buffered stream updates (see `useStreamBuffer.ts`)
- Clean up subscriptions in `useEffect` return callbacks

## Error Handling

- Wrap async operations in try/catch with user-friendly error messages
- Log errors via `addon.log()` for debugging
- Use `AbortController` for fetch/stream cancellation
- Implement retry logic with exponential backoff for transient failures
- Guard stale callbacks: `if (!addon?.data.alive) return;`
- Network errors should trigger reconnect logic, not crash the UI

## Import Order

```typescript
// 1. External libraries
import { createRoot } from "react-dom/client";
import { useState, useEffect, useRef, useCallback } from "react";

// 2. Project modules
import { HermesClient } from "../modules/hermes/HermesClient";
import { ChatManager } from "../modules/hermes/ChatManager";

// 3. Utilities
import { getString, initLocale } from "../utils/locale";

// 4. Config
import { config } from "../../package.json";
import pkg from "../../package.json";
```

public async sendMessage(
text: string,
context?: ContextItem[],
): Promise<void> {
// Implementation
}

````

#### Inline Comments

Explain complex logic:

```typescript
// Calculate exponential backoff with jitter
// This prevents thundering herd on reconnection
const delay =
  Math.min(baseDelay * Math.pow(2, attempt), maxDelay) + Math.random() * 1000;
````

### Testing Conventions

#### Test Structure

```typescript
describe("HermesClient", () => {
  describe("connect", () => {
    it("should establish connection when binary exists", async () => {
      // Arrange
      const client = new HermesClient();

      // Act
      await client.connect();

      // Assert
      expect(client.isConnected()).toBe(true);
    });

    it("should throw when binary not found", async () => {
      // Arrange
      const client = new HermesClient();

      // Act & Assert
      await expect(client.connect()).rejects.toThrow("Binary not found");
    });
  });
});
```

#### Mock Naming

Use descriptive mock names:

```typescript
const mockHermesBinary = vi.fn().mockReturnValue("/usr/bin/hermes");
const mockZoteroPrefs = vi.fn().mockReturnValue({ apiKey: "test" });
```

### Performance Guidelines

#### Lazy Initialization

```typescript
class HeavyComponent {
  private _instance: ExpensiveObject | null = null;

  get instance(): ExpensiveObject {
    if (!this._instance) {
      this._instance = new ExpensiveObject();
    }
    return this._instance;
  }
}
```

#### Memoization

```typescript
const getItemMetadata = memoize(async (itemID: number) => {
  const item = await Zotero.Items.getAsync(itemID);
  return {
    title: item.getDisplayTitle(),
    authors: item.getCreators(),
  };
});
```

### Security Guidelines

#### Input Validation

```typescript
function validateItemID(id: unknown): number {
  if (typeof id !== "number" || id <= 0) {
    throw new Error("Invalid item ID");
  }
  return id;
}
```

#### Output Sanitization

```typescript
function sanitizeHtml(content: string): string {
  return content
    .replace(/script/gi, "")
    .replace(/on\w+\s*=/gi, "")
    .replace(/javascript:/gi, "");
}
```

## Code Style

### Formatting

- Use 2 spaces for indentation
- Max line length: 100 characters
- Use trailing commas in multi-line objects
- Use semicolons

### Linting

Follow ESLint configuration:

```json
{
  "extends": ["@zotero-plugin/eslint-config"],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "warn"
  }
}
```

### Git Conventions

- Use conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- Write descriptive commit messages
- Reference issue numbers when applicable

Example:

```
feat: add item context attachment to chat

- Allow users to attach selected Zotero items to chat messages
- Extract metadata (title, authors, abstract) from items
- Display attached items in chat UI

Closes #42
```
