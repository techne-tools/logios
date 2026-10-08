---
name: project
description: Project-specific architecture, maintenance tasks, and unique conventions for the Logios plugin. Load when performing project-wide maintenance or working with the core architecture.
---

# Project Context

This skill provides the unique context and architectural details for the Logios plugin repository.

## Purpose

To provide guidance on project-specific structures and tasks that differ from general Zotero development patterns.

## When to Use

Load this skill when:

- Understanding the repository's unique architecture.
- Performing recurring maintenance tasks.
- Following project-specific coding conventions.

## Project Overview

- **Primary Stack**: TypeScript, XUL/XHTML, React (for chat), zotero-plugin-toolkit
- **Key Directories**:
  - `src/modules/hermes/` - Core Hermes integration
  - `addon/content/hermes/` - UI assets
  - `src/hooks.ts` - Zotero lifecycle hooks
  - `src/addon.ts` - Plugin instance

## Core Architecture

### Plugin Structure

```
Logios Plugin
├── Core Layer
│   ├── HermesClient.ts      # ACP protocol communication
│   ├── ChatManager.ts       # Conversation state
│   └── NoteManager.ts       # Note operations
├── UI Layer
│   ├── sidebar.xhtml        # Main sidebar container
│   ├── sidebar.css          # Styling
│   └── Chat Components      # React-based chat UI
├── Integration Layer
│   ├── hooks.ts             # Zotero lifecycle
│   └── addon.ts             # Plugin instance
└── Utilities
    ├── locale.ts            # Localization
    └── ztoolkit.ts          # Toolkit helpers
```

### Data Flow

```
User Input → Chat UI → ChatManager → HermesClient → Hermes Agent
                                              ↓
Zotero Items ← NoteManager ← ChatManager ← Response
```

## Project-Specific Conventions

### Naming

- **Classes**: PascalCase (e.g., `HermesClient`, `ChatManager`)
- **Methods**: camelCase (e.g., `sendPrompt`, `saveToNote`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `MAX_RECONNECT_ATTEMPTS`)
- **Files**: PascalCase for classes, camelCase for utilities

### Patterns

- Use `ztoolkit.UI.createElement()` for XUL elements
- Use React only for complex interactive components
- Prefer async/await over callbacks
- Always handle errors with user-friendly messages

### Module Boundaries

- `HermesClient.ts` - Only ACP protocol communication
- `ChatManager.ts` - Only conversation state
- `NoteManager.ts` - Only note CRUD operations
- `ItemManager.ts` (planned) - Only item metadata

## Plugin Installation

**CRITICAL**: Zotero plugins are installed as `.xpi` files:

```
Tools → Add-ons → Install Add-on From File → Select .xpi
```

The plugin must be built first:

```bash
npm run build
```

## Key Files

- `addon/manifest.json` - Plugin metadata and version compatibility
- `package.json` - Dependencies and build scripts
- `zotero-plugin.config.ts` - Build configuration
- `src/hooks.ts` - Main entry point for plugin lifecycle

## Maintenance Tasks

### Regular Updates

- Update zotero-types when Zotero releases new versions
- Update zotero-plugin-toolkit for new features
- Check Hermes Agent compatibility

### Testing Checklist

- [ ] Build succeeds without errors
- [ ] Plugin loads in Zotero 9.0.0+ (current: 10.x)
- [ ] Sidebar opens correctly
- [ ] Chat messages display properly
- [ ] Notes can be saved/loaded
- [ ] Connection to Hermes works
- [ ] Error handling works

## Hermes Integration Points

### ACP Protocol

- Uses NDJSON over stdio
- Supports streaming responses
- Handles session management
- Supports tool calls

### API Mode (Future)

- REST API with SSE streaming
- Requires API key
- Supports remote servers

### Security Model

- All modifications require approval
- API keys stored in Zotero prefs
- Local execution preferred
- MCP servers from trusted sources only

## References

- [Obsidian Hermes Plugin](https://github.com/prismatic7/obsidian-hermes) - Reference implementation
- [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) - Base template
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) - Agent documentation
