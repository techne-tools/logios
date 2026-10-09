/**
 * Per-tool permission chips — pure logic.
 *
 * The chip UI lives in `SidePanels.tsx`, but React components cannot be mounted
 * in the Zotero sandbox (no DOM), so the decisions that actually matter live
 * here as pure functions and are unit-tested directly in `toolPerms.test.ts`.
 *
 * The `allowedTools` conversation field has three states:
 *   null  → unrestricted (every chip shows checked; the agent may use any tool)
 *   []    → block all (no tool available)
 *   list  → exactly these tools are available
 *
 * "Block all" must persist as `[]`, never collapse to `null` (unrestricted) —
 * that inversion would silently re-enable every tool the user just disabled.
 */

/** The tools shown before the agent's `available_commands` list arrives. */
export const FALLBACK_TOOLS = ["read_file", "write_file", "terminal"];

export interface ToolChip {
  name: string;
  label: string;
}

/** Friendly labels for the well-known tools; others are humanised from the name. */
const KNOWN_LABELS: Record<string, string> = {
  read_file: "Read Files",
  write_file: "Write Files",
  terminal: "Terminal Commands",
};

/** `web_search` → `Web Search`, `read_file` → `Read Files` (known), etc. */
export function humaniseToolName(name: string): string {
  if (KNOWN_LABELS[name]) return KNOWN_LABELS[name];
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * The chips to render. Build them from the agent's advertised commands; fall
 * back to the three well-known tools so the panel is never empty in the gap
 * between connect and the `available_commands` update.
 */
export function toolChips(
  availableCommands?: Array<{ name: string; description: string }>,
): ToolChip[] {
  const names =
    availableCommands && availableCommands.length > 0
      ? availableCommands.map((c) => c.name)
      : FALLBACK_TOOLS;
  // Dedupe while preserving order (a repeated command name would render two
  // chips that share one checkbox value).
  const seen = new Set<string>();
  const unique = names.filter((n) => (seen.has(n) ? false : seen.add(n)));
  return unique.map((name) => ({ name, label: humaniseToolName(name) }));
}

/** Whether a tool is currently available, given the three-state `allowedTools`. */
export function isToolAllowed(
  allowedTools: string[] | null,
  tool: string,
): boolean {
  return allowedTools === null || allowedTools.includes(tool);
}

/**
 * Apply one chip toggle and return the new `allowedTools`.
 *
 * `allTools` is the full chip set (so that unchecked-state toggles can start
 * from "everything allowed" when the current state is `null`). Unchecking the
 * last remaining tool yields `[]` — block all — never `null`.
 */
export function toggleTool(
  current: string[] | null,
  tool: string,
  checked: boolean,
  allTools: string[],
): string[] {
  const base = current === null ? allTools.slice() : current.slice();
  if (checked) {
    return base.includes(tool) ? base : [...base, tool];
  }
  return base.filter((t) => t !== tool);
}

/**
 * Normalise a persisted `allowedTools` value on conversation load.
 *
 * `undefined` (older conversations that predate the field) → `null`
 * (unrestricted). An explicit `[]` (block all) is preserved as-is.
 */
export function resolveAllowedTools(
  persisted: string[] | null | undefined,
): string[] | null {
  return persisted ?? null;
}
