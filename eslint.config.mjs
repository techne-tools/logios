// @ts-check Let TS check this config file

import zotero from "@zotero-plugin/eslint-config";

export default [
  ...zotero({
    overrides: [
      {
        files: ["**/*.ts"],
        rules: {
          // Zotero sandbox globals (`addon`, `ztoolkit`, `_globalThis`) are
          // declared, not imported, and some hooks take arguments that the
          // plugin deliberately ignores.
          "@typescript-eslint/no-unused-vars": "off",
        },
      },
      {
        // Test files legitimately group related suites in one file.
        files: ["test/**/*.ts"],
        rules: {
          "mocha/max-top-level-suites": "off",
        },
      },
    ],
  }),
  {
    // Vendored third-party PDF.js types — not our code, not linted.
    ignores: [".refs/**"],
  },
];
