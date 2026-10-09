# Hermes User Guide

## Installation

1. Download the latest Hermes XPI from the [releases page](https://github.com/chris/zotero-hermes/releases).
2. In Zotero, go to Tools → Add-ons → Install Add-on From File.
3. Select the downloaded XPI and follow the prompts.
4. Restart Zotero to complete the installation.

## Connecting to Hermes

Hermes operates in two modes:

### ACP (Local) Mode
- Spawns a local `hermes` binary via stdio/NDJSON (JSON-RPC 2.0).
- Data remains on your machine; no external transmission.
- The binary path is configured via Preferences → Hermes → Binary Path or automatically discovered from your system PATH.

### API (Remote) Mode
- Connects to a remote `hermes gateway` via HTTP/SSE.
- Configure the gateway URL in Hermes preferences.
- Uses OpenAI-compatible format for compatibility with other clients.
- API key is stored in Zotero preferences (encrypted storage via vault is planned but not yet implemented).

## Attaching Context

Provide Hermes with items from your library to ground its responses:

1. Select one or more items in the Zotero library pane.
2. Run `/context` to attach the selected items.
   - Alternatively, select a collection and run `/collection [limit]` to attach items from that collection (default limit: 25).
3. Attached items appear in the Context Bar above the chat input.
4. Their metadata (title, authors, date, abstract, tags, etc.) is automatically included in the agent's context.

## Slash Command Reference

Hermes provides the following slash commands for library operations and agent control:

| Command | Description |
|---------|-------------|
| `/clear` | Clear the current conversation |
| `/context` | Add selected Zotero items to context |
| `/collection` | Attach all top-level items from the selected Zotero collection into context |
| `/help` | Show available slash commands |
| `/savechat` | Save current conversation as a Zotero note |
| `/export` | Export conversation as Markdown (Obsidian-ready) |
| `/compare` | Perform a structured comparative synthesis across attached items |
| `/gaps` | Identify literature gaps in attached literature |
| `/draft-litreview` | Draft a publication-ready literature review |
| `/search` | Search notes and library items and add them to context |
| `/annotations` | List PDF annotations for the attached item |
| `/cite` | Generate in-text citation and bibliography for the attached item |
| `/tag` | Suggest or apply tags for the attached item |
| `/persona` | Switch agent persona (researcher, citation, analyst) |
| `/metadata` | View or update metadata for attached item |
| `/canvas` | Export conversation and attached papers to an Obsidian Canvas graph |
| `/organize-tags` | Analyze library/item tags and propose a clean taxonomy |
| `/timeline` | Generate a chronological literature evolution map |
| `/critique` | Conduct a rigorous peer-review methodological critique |
| `/quiz` | Generate hard seminar discussion questions and exam traps |
| `/doi` | Look up a DOI via CrossRef/DataCite or find one from attached item's title |
| `/cites` | Reverse-citation lookup: which works cite the attached item's DOI |
| `/bulk-metadata` | Edit metadata across every item in the selected collection |
| `/bulk-field` | Edit metadata across every item attached to the conversation |
| `/anno-edit` | Edit annotations in place |
| `/anno-search` | Search annotations across the whole library |

> **Note**: Commands that modify Zotero data (metadata, tags, annotations) require approval via the approval dialog and are recorded in the audit log.

## Approval & Audit Model

All write operations to your Zotero library require explicit user approval:

- When a command attempts to modify data (e.g., `/metadata`, `/tag`, `/anno-edit`), Hermes presents an approval dialog showing the proposed changes.
- You can approve individual changes, approve all, or cancel.
- Approved changes are recorded in the audit log (`AuditLog`) with timestamp, operation type, and outcome.
- Rejected changes are logged as `blocked` and not applied.
- The approval model ensures you remain in control of your library at all times.

## Personas

Hermes offers specialized personas to tailor responses to your task:

- **researcher** (default): General research assistance, grounded in your library.
- **citation**: Focused on citation formatting, bibliography generation, and reference management.
- **analyst**: Emphasizes literature analysis, gap identification, and synthesis.

Switch personas with `/persona [name]` or view the current persona with `/persona`.

## Troubleshooting

### Sandbox Gotchas

- **Synthetic input events fail**: Text inputs and window accelerators use native `addEventListener` via refs instead of React `onChange`/`onKeyDown`.
- **State ref pattern**: Native callbacks read from `stateRef.current` to access React state.
- **No `dangerouslySetInnerHTML`**: Use `MarkdownRenderer.tsx` for pure React element creation from parsed markdown.
- **Clipboard access**: Uses Firefox XPCOM `nsIClipboardHelper`.

### Common Issues

- **Binary not found (ACP mode)**: Ensure the `hermes` binary is installed and discoverable in your PATH, or set the binary path in Preferences → Hermes → Binary Path.
- **Health-check fail**: Verify the Hermes gateway is reachable (API mode) or the local binary responds (ACP mode). Check preferences for correct configuration.
- **Profile scoping**: Hermes uses the active Zotero profile. Confirm you are running Zotero with the intended profile.
- **Obsidian path**: Set the Obsidian vault path in Preferences → Hermes → Obsidian Vault Path for seamless `/export` integration.
- **API key storage**: API keys are currently stored in Zotero preferences (planned migration to encrypted vault is in progress).

### Getting Help

- Run `/help` in the chat pane for a quick reference.
- Consult the [FAQ](./faq.md) for common questions.
- Check the Zotero console (Tools → Developer Tools → Console) for error messages.