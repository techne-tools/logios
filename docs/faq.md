# Hermes FAQ

## General

**Q: What is Hermes?**  
A: Hermes is a Zotero plugin that puts the Hermes Agent in a sidebar conversation with your research library. You can attach items, ask questions, and get answers grounded in your actual metadata, notes, and tags.

**Q: Is Hermes free and open source?**  
A: Yes, Hermes is released under the MIT license. Source code is available on GitHub.

**Q: Does Hermes work with Zotero 9 and Zotero 10?**  
A: Yes, Hermes is compatible with both Zotero 9 (Firefox 115 ESR) and Zotero 10 (Firefox 140 ESR).

## Installation & Setup

**Q: Where do I get the Hermes binary for ACP mode?**  
A: The `hermes` binary is built from the `hermes` repository and must be installed separately. Refer to the hermes project for installation instructions. Once installed, ensure it is discoverable in your system PATH or set the binary path in Preferences → Hermes → Binary Path.

**Q: I get "Binary not found" when starting Hermes in ACP mode. What do I do?**  
A: Verify that the `hermes` executable is installed and accessible. Check your system PATH or set the binary path explicitly in Preferences → Hermes → Binary Path.

**Q: How do I configure API mode?**  
A: In Zotero, go to Preferences → Hermes. Set the connection mode to "API", then provide the gateway URL and your API key.

**Q: Where is my API key stored?**  
A: API keys are currently stored in Zotero preferences. Work is underway to migrate to an encrypted vault for improved security, but this feature is not yet implemented in this release.

**Q: I see references to a secrets vault in the documentation. Is it available?**  
A: The encrypted secrets vault feature is planned but not yet implemented in this release. API keys are currently stored in standard Zotero preferences.

**Q: What is the purpose of the `.env` file mentioned in development notes?**  
A: The `.env` file reference in development notes relates to internal development tooling and is not required for end users. The plugin does not currently load environment variables from a `.env` file for configuration.

## Usage

**Q: How do I attach items to the conversation?**  
A: Select items in the Zotero library pane and run `/context`, or select a collection and run `/collection [limit]` to attach items from that collection.

**Q: Why don't I see the Context Bar after attaching items?**  
A: The Context Bar appears automatically when items are attached. If you don't see it, ensure you have actually attached items (run `/context` with selected items) and that the chat view is visible.

**Q: How do I save my conversation?**  
A: Run `/savechat` to save the current conversation as a Zotero note linked to the first attached item (if any). You can also export via `/export`.

**Q: Can I export directly to my Obsidian vault?**  
A: Yes. Set your Obsidian vault path in Preferences → Hermes → Obsidian Vault Path, then run `/export` to save directly to the vault with YAML frontmatter and Zotero deep links.

**Q: How do I switch agent personas?**  
A: Use `/persona [name]` where name is one of `researcher` (default), `citation`, or `analyst`. Run `/persona` without arguments to see the current persona.

**Q: What do the different personas do?**  
A:

- `researcher`: General-purpose research assistance.
- `citation`: Optimized for citation and bibliography tasks.
- `analyst`: Focused on literature analysis, gap finding, and synthesis.

**Q: Why do I see an approval dialog when running `/metadata` or `/tag`?**  
A: All write operations to your Zotero library require explicit user approval via the approval dialog. This ensures you remain in control of your data and provides an audit trail.

**Q: Where can I see the audit log?**  
A: The audit log is internal to Hermes and used for troubleshooting. It is not exposed in the UI but can be accessed by developers for debugging. Approved and blocked operations are recorded.

## Troubleshooting

**Q: Hermes shows "Health-check failed" in the status bar. What does this mean?**  
A: The health-check verifies that Hermes can communicate with its backend (local binary for ACP mode or gateway for API mode).

- For ACP mode: Ensure the `hermes` binary is installed and discoverable in your PATH or configured in preferences.
- For API mode: Check the gateway URL and network connectivity, and verify the API key is valid.

**Q: I changed my Zotero profile but Hermes seems to be using the old one.**  
A: Hermes binds to the active Zotero profile at startup. To switch profiles, restart Zotero with the desired profile active, then restart Hermes (toggle the plugin off/on or restart Zotero).

**Q: My Obsidian exports are not working. What should I check?**  
A:

1. Verify the Obsidian vault path is set correctly in Preferences → Hermes → Obsidian Vault Path.
2. Ensure the vault path points to a valid directory.
3. Check that the directory is writable.
4. Try exporting with `/export` (file picker) to rule out vault configuration issues.

**Q: Where are Hermes secrets stored?**  
A: Currently, API keys are stored in Zotero preferences. The encrypted vault for secrets storage is planned but not yet implemented.

**Q: I see "No Zotero Found" in the logs. What does this mean?**  
A: This typically indicates development environment misconfiguration and is not relevant to end users. End users should focus on ensuring the Hermes binary is properly installed and configured via preferences.

**Q: How do I enable debug logging?**  
A: Debug logging is gated behind a preference for performance and privacy. Enable it in Preferences → Hermes → Enable Debug Logging. Be cautious, as debug logs may contain sensitive information.

**Q: Why does the `send` button change to a stop button?**  
A: While Hermes is generating a response (streaming), the send button becomes a stop button to allow you to cancel the ongoing request. Click it to abort the current stream.

**Q: I attached an item but Hermes doesn't seem to know about it.**  
A: Confirm that the item is attached by checking the Context Bar. Hermes only uses explicitly attached items for context. It does not automatically scan your library.

**Q: Can Hermes read my PDF attachments?**  
A: Hermes can extract text from PDF attachments that are in your Zotero storage and have a text layer. For scanned PDFs without text, OCR is not available in the main plugin (would require the sidecar).

**Q: How do I reset Hermes to its default state?**  
A: You can clear the conversation with `/clear`, detach all items (there is no explicit detach; attaching new items replaces the context), or reset preferences via the Preferences pane. For a full reset, disable and re-enable the plugin (which clears in-memory state).
