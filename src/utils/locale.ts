import { config } from "../../package.json";
import { FluentMessageId } from "../../typings/i10n";

export { initLocale, getString };

const FTL_FILES = [`${config.addonRef}-addon.ftl`];

/**
 * Point `addon.data.locale` at this addon's Fluent bundle. Called once per
 * window load, because the bundle is window-scoped.
 */
function initLocale() {
  const LocalizationConstructor =
    typeof Localization === "undefined"
      ? addon.data.ztoolkit.getGlobal("Localization")
      : Localization;

  addon.data.locale = {
    current: new LocalizationConstructor(FTL_FILES, true),
  };
}

/**
 * Look up a Fluent message by its key.
 *
 * A two-argument call may pass either a branch name or an options object:
 *
 * ```js
 * getString("pref-title");
 * getString("pref-title", "label");
 * getString("pref-title", { args: { count: 2 } });
 * ```
 *
 * A key with no matching message returns the prefixed key itself, so a
 * missing translation shows up in the UI instead of rendering blank.
 */
function getString(localString: FluentMessageId): string;
function getString(localString: FluentMessageId, branch: string): string;
function getString(
  localeString: FluentMessageId,
  options: { branch?: string | undefined; args?: Record<string, unknown> },
): string;
function getString(...inputs: any[]) {
  if (inputs.length === 1) {
    return resolveString(inputs[0]);
  }
  if (inputs.length === 2) {
    return typeof inputs[1] === "string"
      ? resolveString(inputs[0], { branch: inputs[1] })
      : resolveString(inputs[0], inputs[1]);
  }
  throw new Error("Invalid arguments");
}

interface Pattern {
  value: string | null;
  attributes: Array<{
    name: string;
    value: string;
  }> | null;
}

function resolveString(
  localeString: FluentMessageId,
  options: { branch?: string | undefined; args?: Record<string, unknown> } = {},
): string {
  const { branch, args } = options;
  const messageId = `${config.addonRef}-${localeString}`;
  const pattern = addon.data.locale?.current.formatMessagesSync([
    { id: messageId, args },
  ])[0] as Pattern | undefined;

  if (!pattern) {
    return messageId;
  }

  if (branch && pattern.attributes) {
    return (
      pattern.attributes.find((attr) => attr.name === branch)?.value ||
      messageId
    );
  }

  return pattern.value || messageId;
}
