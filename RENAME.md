# RENAME.md — `zotero-hermes` → `Logios`

**The identity rename is partly done.** The GitHub repos are renamed
(`techne-tools/logios`, fork `prismatic7/logios`) and commit `62b01bf` on
`main` renamed the docs, package name, and URLs. This file is the brief for
finishing it — and, more importantly, for what must **not** be renamed.

Read this whole file before running any find-and-replace.

---

## Already done (commit `62b01bf`)

- `package.json`: `name: "logios"`, `addonName: "Logios"`
- Titles in `README.md`, `PRODUCT.md`, `DESIGN.md`, `ARCHITECTURE.md`,
  `TODO.md`, `CHANGELOG.md`
- repo / bugs / homepage URLs → `techne-tools/logios`
- `.agent.md` + `.agent/**` agent identity → `logios-dev`

## Still to rename (identity only)

1. `.agent/skills/zotero-ops/SKILL.md`
   - line ~8: "Zotero Hermes plugin project" → "Logios plugin project"
   - lines ~212, ~216: release URLs → `techne-tools/logios`
2. `addon/content/preferences.xhtml` (line ~163): the `placeholder` value → `Logios`
3. `.nodeterm/project.json`: `"zotero-hermes"` → `"logios"`
4. Any remaining prose/heading that reads "Zotero Hermes" → "Logios"

---

## DO NOT RENAME — load-bearing

### 1. The storage-path token — this is persistent data on disk

In these places `zotero-hermes` is a **directory name on the user's disk**,
not a label:

- `src/utils/zoteroPaths.ts` — `dir.append("zotero-hermes")`
- `src/modules/hermes/HermesClient.ts` — `name: "zotero-hermes"` and the
  `<profile>/zotero-hermes/workspace/` comment
- `src/modules/hermes/ExportManager.ts` — `baseDir.append("zotero-hermes")`
- `<profile>/zotero-hermes/...` references in `ARCHITECTURE.md`,
  `CHANGELOG.md`, `TODO.md`, and the unit tests

Live data sits there right now:

```
~/Library/Application Support/Zotero/Profiles/ho4rwgql.default/zotero-hermes/
    conversations/   hermes/   audit-log.json   diagnostic.log
```

Renaming the token orphans saved conversations, exports, and the agent
workspace. If the directory is ever renamed, it needs a **migration**
(detect the old dir → move → keep both paths resolving), not a
find-and-replace.

### 2. Addon identity — existing installs and stored prefs depend on it

From `package.json` (`config`):

| key             | value                      | why frozen                         |
| --------------- | -------------------------- | ---------------------------------- |
| `addonID`       | `hermes@techne-tools.org`  | the update path keys off this      |
| `addonRef`      | `hermes`                   | code/prefs namespace               |
| `addonInstance` | `HermesAgent`              | runtime instance id                |
| `prefsPrefix`   | `extensions.zotero.hermes` | every stored preference lives here |

Changing any of these breaks updates for everyone already installed and
drops their preferences.

Note these are all `hermes`, **not** `zotero-hermes` — they are already
correct and need no action.

### 3. Runtime DOM id

- `zotero-hermes-tb-chat-toggle` (in `src/hooks.ts`) — leave as-is.

### 4. Code namespaces (Hermes-the-agent, not the plugin)

- `src/modules/hermes/`, `HermesClient`, `HermesApiClient`, `ChatManager`,
  `hermes acp`

---

## Also leave alone

- `.scaffold/**` — build output, regenerates; stale strings there are normal.
- `.worktrees/**` and `~/.bb/worktrees/**` — separate checkouts carrying
  in-flight feature work; not part of this rename.
- `addon/manifest.json` — uses `__addonID__` / `__addonName__` placeholders;
  nothing literal to change.

---

## Re-audit when done

```
grep -rn 'zotero-hermes' . \
  --exclude-dir=node_modules --exclude-dir=.git \
  --exclude-dir=.scaffold --exclude-dir=.worktrees \
  | grep -v 'zotero-hermes-tb-chat-toggle'
```

Every remaining hit should be one of the load-bearing items in the
"DO NOT RENAME" section. If a hit is in a heading, a doc title, or a URL,
it was missed.
