<!--
Source: Based on the logios codebase, Zotero preference system, and zotero-plugin-toolkit
-->

# Commands & Settings

## Preferences System

Zotero plugins use the browser-standard `pref()` system (in `addon/prefs.js`) and XUL preference bindings (in `addon/content/preferences.xhtml`).

### Default Preference Values (`addon/prefs.js`)

```javascript
pref("extensions.zotero.hermes.binaryPath", "");
pref("extensions.zotero.hermes.connectionMode", "stdio");
pref("extensions.zotero.hermes.apiUrl", "");
pref("extensions.zotero.hermes.apiKey", "");
pref("extensions.zotero.hermes.autoSave", true);
pref("extensions.zotero.hermes.showReasoning", true);
pref("extensions.zotero.hermes.enableCitations", true);
pref("extensions.zotero.hermes.enableAnnotations", true);
pref("extensions.zotero.hermes.enableTags", true);
```

### Preferences XHTML Binding (`addon/content/preferences.xhtml`)

```xml
<!-- Connection mode selector with conditional field visibility -->
<menulist id="zotero-prefpane-__addonRef__-connection-mode"
          preference="extensions.zotero.hermes.connectionMode">
  <menupopup>
    <menuitem label="ACP (stdio subprocess)" value="stdio" />
    <menuitem label="API Server (HTTP)" value="api" />
  </menupopup>
</menulist>

<!-- Binary path (visible in stdio mode) -->
<hbox align="center" id="__addonRef__-binary-path-row">
  <html:input type="text"
    id="zotero-prefpane-__addonRef__-binary-path"
    preference="extensions.zotero.hermes.binaryPath" />
</hbox>

<!-- API URL/Key (visible in API mode) -->
<hbox align="center" id="__addonRef__-api-url-row">
  <html:input type="text"
    id="zotero-prefpane-__addonRef__-api-url"
    preference="extensions.zotero.hermes.apiUrl" />
</hbox>
<hbox align="center" id="__addonRef__-api-key-row">
  <html:input type="password"
    id="zotero-prefpane-__addonRef__-api-key"
    preference="extensions.zotero.hermes.apiKey" />
</hbox>
```

### Conditional Field Visibility (`src/modules/preferenceScript.ts`)

```typescript
function updateConnectionModeUI(): void {
  const modeDropdown = doc.querySelector(
    `#zotero-prefpane-${config.addonRef}-connection-mode`,
  ) as any;
  const binaryRow = doc.getElementById(`${config.addonRef}-binary-path-row`);
  const apiUrlRow = doc.getElementById(`${config.addonRef}-api-url-row`);
  const apiKeyRow = doc.getElementById(`${config.addonRef}-api-key-row`);

  const mode = modeDropdown?.value || "stdio";

  if (mode === "api") {
    binaryRow.style.display = "none";
    apiUrlRow.style.display = "";
    apiKeyRow.style.display = "";
  } else {
    binaryRow.style.display = "";
    apiUrlRow.style.display = "none";
    apiKeyRow.style.display = "none";
  }
}
```

## PreferencesManager Pattern (`src/modules/hermes/PreferencesManager.ts`)

```typescript
export class PreferencesManager {
  private readonly defaults: Record<string, any> = {
    "extensions.zotero.hermes.binaryPath": "",
    "extensions.zotero.hermes.connectionMode": "stdio",
    "extensions.zotero.hermes.apiUrl": "",
    "extensions.zotero.hermes.apiKey": "",
    "extensions.zotero.hermes.autoSave": true,
    "extensions.zotero.hermes.showReasoning": true,
  };

  constructor(addon: any) {
    this.addon = addon;
    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    for (const [key, value] of Object.entries(this.defaults)) {
      if (Zotero.Prefs.get(key) === undefined) {
        Zotero.Prefs.set(key, value);
      }
    }
  }

  public get<T>(key: string, defaultValue?: T): T {
    const fullKey = key.startsWith("extensions.zotero.hermes.")
      ? key
      : `extensions.zotero.hermes.${key}`;
    const value = Zotero.Prefs.get(fullKey);
    return value !== undefined ? (value as T) : (defaultValue as T);
  }

  public set<T extends string | number | boolean>(key: string, value: T): void {
    const fullKey = key.startsWith("extensions.zotero.hermes.")
      ? key
      : `extensions.zotero.hermes.${key}`;
    Zotero.Prefs.set(fullKey, value);
  }

  public getConnectionMode(): string {
    return this.get<string>("connectionMode", "stdio");
  }

  public getHermesPath(): string {
    return this.get<string>("binaryPath", "");
  }
}
```

## Using Preferences at Runtime

```typescript
// Via PreferencesManager
const prefs = new PreferencesManager(addon);
const mode = prefs.getConnectionMode(); // "stdio" | "api"
const path = prefs.getHermesPath(); // e.g. "/usr/local/bin/hermes"
const showReasoning = prefs.get("showReasoning", true);

// Direct Zotero API
const binaryPath = Zotero.Prefs.get(
  "extensions.zotero.hermes.binaryPath",
  true,
) as string;
Zotero.Prefs.set("extensions.zotero.hermes.connectionMode", "api", true);
```

## Stable Preference Keys

- Use stable preference keys; avoid renaming once released
- Pattern: `extensions.zotero.<addonRef>.<key>` — from `config.prefsPrefix` in `package.json`
- Migrate old preference keys with backwards-compatible fallbacks
- Boolean defaults should match the XHTML `<checkbox>` default state
  </groupbox>

```

### Localization

```

# addon/locale/en-US/hermes-preferences.ftl

pref-title = Hermes Agent Settings
pref-connection-title = Connection
pref-connection-local = Local (ACP)
pref-connection-remote = Remote (API)
pref-hermes-path = Hermes Binary Path
pref-api-url = API URL
pref-api-key = API Key
pref-chat-title = Chat Settings
pref-show-reasoning = Show reasoning steps
pref-show-tool-use = Show tool usage
pref-typing-sound = Enable typing sound
pref-security-title = Security
pref-require-approval = Require approval for all changes

````

### Preferences Event Handler

```typescript
// src/hooks.ts
async function onPrefsEvent(type: string, data: { window: Window }) {
  switch (type) {
    case "load":
      initializePreferences(data.window);
      break;
    case "save":
      await savePreferences(data.window);
      break;
    default:
      return;
  }
}

function initializePreferences(win: Window): void {
  const doc = win.document;

  // Setup test connection button
  const testBtn = doc.getElementById("test-connection-btn");
  testBtn?.addEventListener("command", async () => {
    const result = await testConnection();
    showConnectionResult(win, result);
  });
}
````

## Dynamic Commands

### Context-Aware Commands

Show different commands based on selection:

```typescript
function getContextCommands(): MenuItem[] {
  const items = Zotero.getActiveZoteroPane().getSelectedItems();

  if (items.length === 0) {
    return [{ label: "Open Hermes Chat", action: () => openChat() }];
  }

  if (items.length === 1 && items[0].isPDFAttachment()) {
    return [
      { label: "Summarize PDF", action: () => summarizePDF(items[0]) },
      {
        label: "Extract Annotations",
        action: () => extractAnnotations(items[0]),
      },
    ];
  }

  return [
    { label: "Summarize Selected", action: () => summarizeItems(items) },
    { label: "Compare Papers", action: () => compareItems(items) },
  ];
}
```

### Command Palette

Implement a command palette for quick access:

```typescript
function showCommandPalette(): void {
  const commands = [
    { id: "open-chat", label: "Open Hermes Chat", shortcut: "Alt+H" },
    {
      id: "attach-items",
      label: "Attach Selected Items",
      shortcut: "Shift+Ctrl+A",
    },
    { id: "summarize", label: "Summarize Selected", shortcut: "" },
    { id: "settings", label: "Open Settings", shortcut: "" },
  ];

  // Show palette UI
  const palette = new CommandPalette(commands);
  palette.show();
}
```

## Settings Migration

### Version-Based Migration

```typescript
async function migrateSettings(): Promise<void> {
  const currentVersion = addon.data.config.version;
  const lastVersion = Zotero.Prefs.get(
    "extensions.zotero.hermes.lastVersion",
    true,
  ) as string;

  if (!lastVersion) {
    // First install - initialize defaults
    initializeDefaultSettings();
    return;
  }

  if (compareVersions(lastVersion, "0.2.0") < 0) {
    // Migrate from pre-0.2.0
    await migrateToV020();
  }

  if (compareVersions(lastVersion, "0.3.0") < 0) {
    // Migrate from pre-0.3.0
    await migrateToV030();
  }

  // Update last version
  Zotero.Prefs.set(
    "extensions.zotero.hermes.lastVersion",
    currentVersion,
    true,
  );
}

async function migrateToV020(): Promise<void> {
  // Example: Rename preference
  const oldValue = Zotero.Prefs.get("extensions.zotero.hermes.oldPref", true);
  if (oldValue !== undefined) {
    Zotero.Prefs.set("extensions.zotero.hermes.newPref", oldValue, true);
    Zotero.Prefs.clear("extensions.zotero.hermes.oldPref", true);
  }
}
```

## Best Practices

### 1. Validate Settings

Always validate settings before use:

```typescript
function getValidatedSetting(
  key: string,
  validator: (value: unknown) => boolean,
): unknown {
  const value = Zotero.Prefs.get(key, true);
  if (!validator(value)) {
    console.warn(`Invalid setting ${key}, using default`);
    return getDefaultValue(key);
  }
  return value;
}
```

### 2. Handle Missing Settings

Provide sensible defaults:

```typescript
function getConnectionMode(): "local" | "remote" {
  const mode = Zotero.Prefs.get(
    "extensions.zotero.hermes.connectionMode",
    true,
  ) as string;
  if (mode === "local" || mode === "remote") {
    return mode;
  }
  return "local"; // Default
}
```

### 3. Secure Sensitive Data

Never log or expose sensitive settings:

```typescript
function logSettings(): void {
  const safeSettings = {
    connectionMode: getConnectionMode(),
    showReasoning: getShowReasoning(),
    // Don't include: apiKey, hermesBinaryPath
  };
  console.log("Settings:", safeSettings);
}
```
