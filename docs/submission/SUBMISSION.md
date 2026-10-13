# Submitting Easy TikZ to the Obsidian Community Plugins directory

End-to-end checklist for getting the plugin listed under **Settings → Community plugins → Browse**.

## Prerequisites - already done

- [x] `manifest.json` at the repo root with all required fields
  (`id`, `name`, `version`, `minAppVersion`, `description`, `author`,
  `authorUrl`, `isDesktopOnly`)
- [x] `versions.json` mapping every released version to its `minAppVersion`
- [x] `LICENSE.md` (MIT)
- [x] `README.md` with install / usage / permissions
- [x] GitHub Releases workflow that attaches `main.js`, `manifest.json`,
      `styles.css` as raw assets (not zipped) on every tag push
- [x] Latest release tag (`4.0.0` at the time of writing) matches the
      `version` field in `manifest.json` - without a leading `v`
- [x] `minAppVersion` is `1.13.0` in `manifest.json`, and `versions.json`
      maps `4.0.0` (and `3.19.6`) to `1.13.0`, so users on older Obsidian
      versions keep `3.19.5`

Verify the latest release one more time before opening the PR:

```bash
gh release view --repo Saiki77/easy-tikz --json tagName,assets \
    --jq '.tagName, [.assets[].name]'
# Expect (the tag is the `version` of manifest.json on the default branch):
# "4.0.0"
# ["main.js","manifest.json","styles.css"]
```

If the default branch is ahead of the last tag (a `## [Unreleased]`
section in `CHANGELOG.md`, features the README describes that the last
release does not have), tag the next version first: the validator
compares the latest release with `manifest.json` on the default branch,
and a reviewer installs the latest release.

The latest published `manifest.json` must be reachable at the raw URL:

```bash
curl -sS https://raw.githubusercontent.com/Saiki77/easy-tikz/HEAD/manifest.json \
    | python3 -m json.tool
```

That URL is what Obsidian's submission validator fetches; if it errors,
the PR validator surfaces it as **"Could not find or validate a manifest
(manifest.json) in the repository."**

## Step-by-step - open the submission PR

1. Fork [`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases).
2. Pull your fork locally, create a branch named after the plugin id:
   ```bash
   git clone https://github.com/<your-user>/obsidian-releases.git
   cd obsidian-releases
   git checkout -b add-easy-tikz
   ```
3. Open `community-plugins.json` and append (as the **last** entry, comma
   on the preceding entry) the contents of
   [`community-plugins-entry.json`](community-plugins-entry.json):
   ```json
   {
       "id": "easy-tikz",
       "name": "Easy TikZ",
       "author": "Saiki77",
       "description": "Visually design TikZ and pgfplots graphs with a live SVG preview. Supports 2D functions, 3D surfaces, tangents, extrema, and one-click code insertion.",
       "repo": "Saiki77/easy-tikz"
   }
   ```
   The reviewer bot checks alphabetical-by-`id` ordering loosely; just
   append at the end and the maintainers sort if needed.
4. Commit + push + open the PR against `obsidianmd/obsidian-releases:master`.
   Use the PR template - body from
   [`pr-description.md`](pr-description.md).

## When the validator runs

The bot runs a workflow that:

1. Parses your `community-plugins.json` diff.
2. For each new entry, fetches `https://raw.githubusercontent.com/<repo>/HEAD/manifest.json`.
3. Validates required fields.
4. Confirms the latest GitHub release tag matches `manifest.version`.
5. Confirms `main.js`, `manifest.json`, `styles.css` are attached as raw
   release assets (not inside a zip).

If any step fails it leaves a comment like *"Could not find or validate
a manifest (manifest.json) in the repository."* - fix the underlying
issue, push another commit to the PR branch, and the workflow re-runs.

## Common rejections, and how each one looks

| Reviewer / validator says…                                          | What's wrong                                                                                       | Fix                                                                                                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Could not find or validate a manifest (manifest.json)…"            | The `repo` field in `community-plugins.json` is wrong, or `manifest.json` isn't on the default branch | Fix the `repo` field, or push `manifest.json` to the default branch.                                                                               |
| "Latest GitHub release tag does not match `manifest.version`."      | You tagged `v1.2.0` (with the `v`) or your `version` field is out of sync                          | Re-tag without the `v` prefix; ensure `manifest.version` equals the tag name exactly.                                                              |
| "Release is missing one of: main.js, manifest.json, styles.css."    | Your release attached a zip, or skipped `styles.css`                                               | Re-run the release workflow so the three files are individual release assets. (Our workflow already does this - `release.yml`.)                    |
| "Plugin id contains 'obsidian' or 'plugin'."                        | Naming convention. We're fine - `easy-tikz`.                                                       | n/a                                                                                                                                                |
| "Plugin name starts with 'Obsidian'."                               | Naming convention. We're fine - `Easy TikZ`.                                                       | n/a                                                                                                                                                |
| Manual: "`fundingUrl` link is broken / unrelated to the author."    | A real human reviewer hit a broken link.                                                           | Remove the field or fix the URL.                                                                                                                   |
| Manual: "`minAppVersion` is older than the version that ships APIs you use." | The plugin uses an API the declared min version doesn't have.                                      | Bump `minAppVersion` to the floor that actually works. Ours is **1.13.0** since 3.19.6: the settings tab uses the declarative settings API and sliders rely on 1.13's always-visible inline value (4.x also uses `color-mix()` CSS and `setIcon`, which 1.4 already had). Keep `versions.json` in step, so older Obsidian versions are offered 3.19.5. |

## Release artifacts checklist

Before opening the PR, verify each one of these exists in the repo or
the latest release:

| File                | Where                                  | Purpose                                                            |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `manifest.json`     | repo root + latest release asset       | Plugin metadata. Validator fetches both.                            |
| `versions.json`     | repo root                              | Maps every version to its `minAppVersion`. Built-in updater reads this. |
| `main.js`           | latest release asset                   | Compiled plugin entry point. Built by `npm run build`.              |
| `styles.css`        | latest release asset (built from `src/`) | Plugin styling. `npm run build` joins `src/styles.css` and every `src/ui/*.css` into `styles.css` (`scripts/build-css.mjs`). |
| `LICENSE.md`        | repo root                              | MIT.                                                                |
| `README.md`         | repo root                              | Install / usage / permissions. Its pictures and videos are in `docs/media`, its guides in `docs/guides`. |
| `CHANGELOG.md`      | repo root                              | Per-version history. Not required by Obsidian but expected.         |
| `.github/workflows/release.yml` | repo root                  | Automates the release on tag push.                                  |

## Updating later

To ship a new version after the plugin is listed:

1. Run the checks on what you are about to release: `npm run build`,
   `npm test`, and `npm run media:smoke -- --root`, which loads the
   built plugin in a real Obsidian (see `scripts/media/README.md`).
2. In `CHANGELOG.md`, rename `## [Unreleased]` to the new version
   heading (`## [4.0.1] - YYYY-MM-DD`): the release workflow takes the
   release notes from the section of that version.
3. Run `npm version 4.0.1`. It sets the version in `package.json`,
   `manifest.json` and `versions.json` (`version-bump.mjs` maps the new
   version to the current `minAppVersion`, `1.13.0`), commits them with
   the changelog and creates the tag `4.0.1`, without a `v` (see `.npmrc`).
4. Push the branch and the tag (`git push origin main 4.0.1`).
5. The release workflow stops when the tag and the version in
   `manifest.json` differ; otherwise it attaches
   `main.js`/`manifest.json`/`styles.css` to the GitHub Release.
6. Obsidian's auto-updater picks up the new release without any further
   PR - `community-plugins.json` only needs the initial entry.
