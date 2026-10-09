---
name: zotero-ops
description: Operations, build workflows, syncing, versioning, and release management for Zotero projects. Load when running builds, preparing releases, or troubleshooting deployment.
---

# Zotero Operations Skill

This skill provides operational guidance for the Logios plugin project
(repo `techne-tools/logios`; formerly "Zotero Hermes").

## Purpose

To ensure smooth build processes, proper versioning, and reliable releases.

## Scope

This skill covers:

- Build and deployment workflows
- Performance optimization
- Quick command reference
- Release checklist
- Security and privacy practices
- Testing strategies
- Troubleshooting

## Build Workflow

### Development

```bash
# Start development server with hot reload
npm start

# Build for testing
npm run build

# Run tests
npm test
```

### Release

Releases are **tag-driven through CI**. `.github/workflows/release.yml`
triggers on any pushed `v*` tag and calls the shared
`zotero-plugin-dev/workflows/.github/workflows/release-plugin.yml@main`,
which builds the plugin, runs `npm run release` (creates the GitHub release,
uploads `hermes-agent-for-zotero.xpi` + `update.json`) and posts the comment.

```bash
# 1. version + changelog on main
npm version patch --no-git-tag-version     # package.json + package-lock.json
#    promote CHANGELOG [Unreleased] -> [<ver>] — YYYY-MM-DD, then:
npx prettier --write CHANGELOG.md          # whole-repo prettier is the gate

# 2. gates (see Release Checklist), then land the version commit.
#    main is PROTECTED — required checks are build, lint, test — so the release
#    commit lands through a PR. Do NOT push to main directly.
git switch -c release/v<x.y.z>
git commit -m "release: v<x.y.z>"
git push -u origin release/v<x.y.z>
gh pr create --base main --head release/v<x.y.z> \
  --title "release: v<x.y.z>" --body-file /path/to/body.md
gh pr checks <n> --watch --interval 15     # must be exit 0 on all three jobs
gh pr merge <n> --merge

# 3. tag the MERGE commit on main; the tag push runs the release workflow
git switch main && git pull --ff-only origin main
git tag -a v<x.y.z> -m "Release v<x.y.z>" && git push origin v<x.y.z>
gh run watch <databaseId> --exit-status    # do not just fire the tag
```

Two traps in that sequence, both silent:

- **`gh pr create --body "$(cat <<'EOF' … EOF)"` fails** with
  `bad substitution: no closing ')'` — the heredoc inside a command
  substitution does not survive the shell wrapper. Write the body to a file and
  pass `--body-file`.
- **A PR can open with no checks attached.** Symptom: `gh pr checks <n>` reports
  "no checks reported on the branch" and `gh run list --branch <head>` is empty,
  while `gh pr view <n>` shows `mergeStateStatus: BLOCKED`. The
  `pull_request` workflow never fired; push any further commit (an empty one
  works) to fire `synchronize` and the checks appear. Merge is refused until the
  required checks report on the head commit, so `--watch` on a checkless PR
  exits non-zero immediately.

**Do NOT run `gh release create` by hand.** The workflow creates the release
itself; a pre-existing release makes it fail with
`422 Validation Failed: already_exists` (field `tag_name`). If that happens,
delete only the release (`gh release delete <tag> --yes`, keeping the tag) and
re-run the workflow by re-pushing the tag:
`git push origin :refs/tags/<tag> && git push origin <tag>`.
The workflow has no `workflow_dispatch` trigger, so a tag re-push is the only
way to re-run it without a new commit.

Version note: `package.json` may already sit above the last tag (e.g. tagged
v0.3.2 but package at 0.3.3 — 0.3.3 was released without a tag). Compute the
bump from `package.json`, and note the tag you create may skip a number.

## Dependency Sync After an Upstream Pull

A fast-forward pull that lands a dependency bump leaves `node_modules` **stale**
— the tree still compiles, but against the _old_ majors, so the local gates can
pass while describing a stack the lockfile no longer pins. Always reinstall and
re-run the gates after pulling.

```bash
git pull --ff-only origin main

# NODE_ENV=test alone is NOT sufficient on npm 11 when NODE_ENV is already
# exported as `production`: npm silently omits devDependencies (no tsc, no
# eslint, no .bin entries) and still prints "added N packages" + success.
# --include=dev is the explicit override.
NODE_ENV=test npm ci --include=dev --no-audit --no-fund

# prove the devDeps resolved against the lockfile — do not trust the summary
node -e "const r=n=>require('./node_modules/'+n+'/package.json').version;\
console.log(r('react'), r('zotero-plugin-toolkit'))"
```

Then re-run all three CI gates — they are **separate jobs**, so a green build
says nothing about lint or tests:

```bash
npm run build        # zotero-plugin build && tsc --noEmit
npm run lint:check   # prettier --check . && eslint .   (whole repo, not src test)
npm test -- --no-watch
```

Prefer `npm ci` on a clean lockfile — it will not silently rewrite
`package-lock.json`. If it fails with EUSAGE ("lock file's X does not satisfy
Y"), the bump did not regenerate the lockfile: `rm -rf node_modules` then
`NODE_ENV=test npm install` once.

**Verify off the dirty tree, in a throwaway worktree.** The build regenerates
tracked `typings/prefs.d.ts` on whichever branch it runs on, so never run it
against dirty main:

```bash
git worktree add --detach "$TMPDIR/zh-verify" <sha>
cp .env "$TMPDIR/zh-verify/.env"                    # scaffold needs it
cp -cR node_modules "$TMPDIR/zh-verify/node_modules" # APFS clone: instant, no extra blocks
# ... run the gates there ...
git worktree remove --force "$TMPDIR/zh-verify"
```

A pull can also refuse to fast-forward on a **typegen-only** modification such
as `typings/i10n.d.ts`, where the working copy is byte-identical to the
incoming one. Confirm the equivalence, back the file up, then `git checkout --`
it before retrying.

## Quick Reference

### Common Commands

| Command            | Purpose                    |
| ------------------ | -------------------------- |
| `npm start`        | Dev server with hot reload |
| `npm run build`    | Production build           |
| `npm test`         | Run test suite             |
| `npm run lint:fix` | Fix linting issues         |
| `npm run release`  | Create GitHub release      |

### File Locations

| File                  | Purpose             |
| --------------------- | ------------------- |
| `addon/manifest.json` | Plugin manifest     |
| `addon/content/`      | UI assets           |
| `src/modules/hermes/` | Core Hermes modules |
| `src/hooks.ts`        | Lifecycle hooks     |
| `.scaffold/build/`    | Build output        |

## Release Checklist

> **Verify with the gate's OWN scope, before you commit — not after.**
> `lint:check` is `prettier --check . && eslint .` (whole repo). A narrower
> local check (`prettier --check src test`) passes while CI fails. Two releases
> were burned on this: once on CHANGELOG.md emphasis, once on a skill file.
> Corollary: **never commit while a gate you just ran is red**, even if the
> commit is docs-only and "CI only sees committed content". Either fix it in
> the same commit, or do not commit.
>
> **After `prettier --write`, gate the COMMITTED blob, not the working tree.**
> `--write` fixes the file on disk; if you then commit a narrower file set, the
> fix stays unstaged and CI checks the unformatted blob you actually pushed —
> while your local `prettier --check .` passes, because it reads the working
> tree. A green local check therefore proves nothing about what you pushed.
> Before pushing, confirm the formatted file is _in_ the commit:
>
> ```bash
> git status --short                    # nothing relevant left dirty/unstaged
> git show HEAD:<path> > /tmp/blob && npx prettier --check --stdin-filepath <path> < /tmp/blob
> ```
>
> Symptom: CI `lint` red on a file that passes locally. This bit Wave 2 Task 4:
> a one-line wrap fixed during the _next_ task's lint step was committed only in
> my working tree, so `ApprovalDialog.ts` failed CI while passing locally.
>
> **The mirror image is also real: local RED while CI is green.** A working copy
> accumulates untracked scratch — `.opencode/`, `.superpowers/`, and
> `.worktrees/` (which holds whole checkouts). `prettier --check .` walks all of
> them, so `npm run lint:check` can report ~25 unformatted files that a clean
> checkout, and therefore CI, has never seen. Do not reformat them and do not
> treat the red as blocking; gate the scope CI actually checks:
>
> ```bash
> printf '%s\n.opencode\n.superpowers\n.worktrees\n' "$(cat .prettierignore)" > /tmp/pi
> npx prettier --check . --ignore-path /tmp/pi   # exit 0 == CI's verdict
> npx eslint .                                    # eslint is unaffected
> ```
>
> `git ls-files -z | xargs -0 npx prettier --check` is **not** a substitute:
> given explicit paths, prettier errors on tracked `.ftl` files it has no parser
> for, so it fails for the wrong reason.

- [ ] Version bumped in package.json
      (`npm version <patch|minor|major> --no-git-tag-version` — pick the
      level from the CHANGELOG: a new feature is a minor, a fix a patch,
      a breaking preference/manifest change a major)
- [ ] CHANGELOG.md `[Unreleased]` promoted to `[<ver>] — YYYY-MM-DD`
- [ ] **`npx prettier --check .`** — the repo's `lint:check` is whole-repo, not
      `src test`. CHANGELOG.md and other markdown are included; unformatted
      markdown (e.g. `*emphasis*` instead of `_emphasis_`) turns CI red.
- [ ] `npx tsc --noEmit` and `./node_modules/.bin/eslint .` clean — note the
      `.` for eslint too, not `src test`
- [ ] `npm test` — the suite must exit 0 with **0 failures** on the committed
      tree. (History: CI's `test` job was red on main from 2026-09-10 to
      2026-10-04 because of the `Profile.dir` string bug plus two bogus test
      doubles. That is fixed; do not re-normalise a red test job.) Failures
      are compared as a SET, not a count.
- [ ] Commit `release: v<x.y.z>`, tag `v<x.y.z>`, push both — the tag push
      triggers the release workflow; do not `gh release create` by hand
- [ ] Watch the workflow to green, do not just fire the tag:
      `gh run watch <databaseId> --exit-status`
- [ ] Verify the published release ships the XPI:
      `gh release view <tag> --json assets --jq '.assets[].name'`
- [ ] **Verify the published XPI's hash matches the `update.json` it
      advertises** — a mismatch breaks auto-update silently for every
      installed user. See Post-Release Verification.
- [ ] **Doc-drift sweep after any dependency major or host-version bump** —
      see Post-Release Verification.
- [ ] Submodule `.refs/zotero-pdfjs-types` restored if it accumulated noise
- [ ] README updated (version badge included — it does not track package.json
      automatically)

## Post-Release Verification

A green workflow is not a verified release. These two checks catch failures
that CI cannot see, and both are silent when they break.

### 1. The advertised hash must match the published XPI

The plugin's `update_url` points at the **rolling `release` tag**, not the
version tag — `update.json` is rewritten there by each release, and Zotero
rejects an XPI whose hash does not match it. Nothing in the build compares the
two, so a mismatch means auto-update fails for every installed user while the
release page looks perfect.

`update_hash` is `sha512:` followed by the **hex** digest — do not run it
through `base64 -d`.

```bash
tag=v<x.y.z>
d=$(mktemp -d)

# the artifact users will actually download
curl -sL -o "$d/pub.xpi" \
  "https://github.com/techne-tools/logios/releases/download/$tag/logios.xpi"

# what update.json advertises (strip the "sha512:" prefix -> hex)
advertised=$(curl -sL \
  "https://github.com/techne-tools/logios/releases/download/release/update.json" \
  | jq -r '.addons["hermes@techne-tools.org"].updates[0].update_hash' \
  | sed 's/^sha512://')

# the artifact's actual digest
actual=$(shasum -a 512 "$d/pub.xpi" | awk '{print $1}')

echo "advertised: $advertised"
echo "actual    : $actual"
if [ -z "$advertised" ] || [ -z "$actual" ]; then
  echo "FAIL — could not read one of the hashes (check the tag and the release assets)"
elif [ "$advertised" = "$actual" ]; then
  echo "MATCH"
else
  echo "MISMATCH — auto-update is broken for installed users"
fi
```

The two hex strings must be **identical**. Also confirm the XPI contains the
version you think it does — the manifest is templated at build time:

```bash
unzip -p "$d/pub.xpi" manifest.json \
  | jq '{version, max: .applications.zotero.strict_max_version}'
```

### 2. Doc-drift sweep after a dependency major or host-version bump

Every dependency bump that changes a major gets recorded in the CHANGELOG while
the prose in the repo keeps describing the old one. Nothing in CI catches this,
so it rides along into the next release (v0.5.0 shipped with React 18 and
Firefox 115 ESR still asserted in six files after the React 19 merge).

```bash
# stack facts that appear in prose
grep -rn 'React 18\|React 19\|115 ESR\|140 ESR' \
  --include='*.md' --include='*.ts' --include='*.tsx' . \
  | grep -v node_modules | grep -v '^\./\.refs/'

# the previous version number, outside the historical CHANGELOG entries
grep -rn '0\.<prev>\.0' --include='*.md' . \
  | grep -v node_modules | grep -v CHANGELOG
```

**Where the stale copies live** (all committed, all hand-maintained):

| File                                    | Holds                                                   |
| --------------------------------------- | ------------------------------------------------------- |
| `README.md`                             | version badge, architecture diagram, host-version notes |
| `ARCHITECTURE.md`                       | the stack line (`UI: React N`, ESR version)             |
| `TODO.md`                               | header `Current Version` + `Updated` date               |
| `.agent.md`                             | file map descriptions, Development Stack block          |
| `.agent/rules/agent-standards.md`       | the sandbox-constraint preamble                         |
| `.agent/skills/zotero-dev/references/*` | React conventions, stack lists                          |

Historical CHANGELOG entries and `docs/PLAN-*.md` **should** keep their old
versions — they are dated records, not current state. Do not "fix" them.

## Release Channel Verification

**Why**: the plugin's `update_url` is baked at build time and points at the
**rolling `release` tag**, not the version tag. Zotero polls it to auto-update.
A wrong channel filename means updates silently never arrive; nothing in CI
checks it.

### How the channel is selected

`zotero-plugin.config.ts` chooses the filename from the version string:

```ts
updateURL: `https://github.com/{{owner}}/{{repo}}/releases/download/release/${
  pkg.version.includes("-") ? "update-beta.json" : "update.json"
}`,
```

- `0.7.0` → `update.json` (stable)
- `0.7.0-beta.1`, `1.0.0-rc.2` → `update-beta.json` (pre-release)

**Which manifests a release publishes.** Verified against the scaffold
(`zotero-plugin-scaffold/dist/shared/scaffold-src-*.mjs`): `update-beta.json` is
written unconditionally, `update.json` **only** when the version is not a
pre-release; the uploader then deletes and re-uploads exactly the manifests it
generated, so anything it did not generate is left in place.

- **Stable release** — generates and uploads **both** `update.json` and
  `update-beta.json`.
- **Pre-release** — generates and uploads **only** `update-beta.json`. An
  existing `update.json` on the `release` tag is **preserved**, not rewritten.
- **First-ever pre-release** (no stable release yet) — the `release` tag carries
  `update-beta.json` only, and there is **no** `update.json` at all until the
  first stable release. Installed stable users therefore do not see the
  pre-release.

Only the _filename_ selects the channel; for the same version the two files hold
identical content.

### Dry-run (no publish) — proves the channel logic locally

```bash
NODE_ENV=production npm run build

# channel filename the config would bake for this version
node -e 'const v=require("./package.json").version;
  console.log(v, "->", v.includes("-") ? "update-beta.json" : "update.json")'

# what the built XPI actually advertises
unzip -p .scaffold/build/logios.xpi manifest.json \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["applications"]["zotero"]["update_url"])'

# the generated manifests and the hash they advertise
ls .scaffold/build/          # logios.xpi  update.json  update-beta.json
cat .scaffold/build/update.json
```

Expect: the filename in `update_url` matches the version's channel, and the
hex digest in the generated manifest's `update_hash` — after stripping its
`sha512:` prefix — equals the hex digest printed by

```bash
shasum -a 512 .scaffold/build/logios.xpi | awk '{print $1}'
```

Compare the **digest only**: `shasum` also prints the filename, and the manifest
value carries the `sha512:` prefix, so neither side is compared verbatim.

### Channel-verification checklist (after the workflow goes green)

- [ ] Rolling `release` tag carries the manifests the channel implies:
      `gh release view release --repo techne-tools/logios --json assets --jq '[.assets[].name]'`
      (stable → `update.json` + `update-beta.json`; pre-release → `update-beta.json`,
      with `update.json` present only once a stable release exists)
- [ ] `update.json` is served (200) from the tag the `update_url` names:

      ```bash
      curl -sSL -o /dev/null -w '%{http_code}\n' \
        https://github.com/techne-tools/logios/releases/download/release/update.json
      ```

- [ ] The advertised `version` in the live manifest equals `package.json`
- [ ] `update_hash` matches the published XPI (see Post-Release Verification §1)
- [ ] For a pre-release: `update-beta.json` carries the new version, and
      `update.json` — if present — still carries the last stable version

**Verified 2026-10-09 for v0.7.0** — stable channel; `release` tag carries
`update-beta.json` + `update.json`; both return HTTP 200 and advertise `0.7.0`,
and the advertised `update_hash` matches the `logios.xpi` published on the
`v0.7.0` tag. The published tag and `release`-tag manifests differ in
`update_hash` (the workflow rebuilds), so always re-run the hash check after a
release rather than trusting the local build's hash.

## Testing Strategy

### Unit Tests

- Test individual modules in isolation
- Mock Zotero API calls
- Use vitest for test runner

### Integration Tests

- Test full chat flow
- Test note operations
- Test item context attachment

### Manual Testing

- Test in Zotero 9.0.0+ (current: 10.x, Mozilla 140 ESR)
- Test on Windows/macOS/Linux
- Test with large libraries (10,000+ items)

## Troubleshooting

### Common Issues

**Build fails with TypeScript errors**

- Check zotero-types version compatibility
- Verify tsconfig.json settings
- Run `npm run lint:fix`

**Plugin not loading in Zotero**

- Check manifest.json version compatibility
- Verify addon ID is unique
- Check browser console for errors

**Plugin not showing after an addon ID change**

`extensions.json` in the profile is authoritative — dropping an XPI into
`extensions/` is NOT enough; Zotero will not auto-discover it. To swap an
addon ID:

1. Quit Zotero.
2. Remove the stale entry from `extensions.json` (back it up first).
3. Write a new entry mirroring the known-good structure: `id`, `path`,
   `rootURI` (`jar:file://` with `%40` for `@`, `%20` for spaces, slashes
   preserved), `targetApplications` (zotero@zotero.org, min/max), `active:
true`, `userDisabled: false`, `installTelemetryInfo: {source:
"app-profile", method: "sideload"}`.
4. Restart Zotero and verify the plugin bootstrapped — its prefs
   (`extensions.zotero.<ref>.*`) only appear if startup code ran.

**Submodule noise before release**

`.refs/zotero-pdfjs-types` accumulates ~100 files of generated `.d.ts`
noise on every build. Restore it before committing a release so the
release doesn't record a dirty pointer:
`git -C .refs/zotero-pdfjs-types checkout -- .`

**ACP connection fails**

- Verify Hermes binary path
- Check permissions on binary
- Test with `hermes acp` manually

## Performance Optimization

### Bundle Size

- Use tree shaking
- Lazy load heavy components
- Minimize dependencies

### Runtime Performance

- Virtualize long lists
- Debounce input handlers
- Use requestAnimationFrame for animations

## Security Practices

- Never commit API keys
- Use Zotero's secure preference storage
- Validate all user inputs
- Sanitize AI-generated content before rendering
