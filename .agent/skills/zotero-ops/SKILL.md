---
name: zotero-ops
description: Operations, build workflows, syncing, versioning, and release management for Zotero projects. Load when running builds, preparing releases, or troubleshooting deployment.
---

# Zotero Operations Skill

This skill provides operational guidance for the Zotero Hermes plugin project.

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

# 2. gates (see Release Checklist) then commit + tag + push
git commit -m "release: v<x.y.z>"
git tag -a v<x.y.z> -m "Release v<x.y.z>"
git push origin main && git push origin v<x.y.z>
# 3. the tag push runs the release workflow — watch it
gh run list --workflow=release.yml --limit 1
```

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
  "https://github.com/techne-tools/zotero-hermes/releases/download/$tag/hermes-agent-for-zotero.xpi"

# what update.json advertises (strip the "sha512:" prefix -> hex)
advertised=$(curl -sL \
  "https://github.com/techne-tools/zotero-hermes/releases/download/release/update.json" \
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
