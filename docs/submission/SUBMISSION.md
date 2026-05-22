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
- [x] Latest release tag (`3.19.0` at the time of writing) matches the
      `version` field in `manifest.json` - without a leading `v`

Verify the latest release one more time before opening the PR:

```bash
gh release view --repo Saiki77/easy-tikz --json tagName,assets \
    --jq '.tagName, [.assets[].name]'
# Expect:
# "3.19.0"
# ["main.js","manifest.json","styles.css"]
```

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
| Manual: "`minAppVersion` is older than the version that ships APIs you use." | The plugin uses an API the declared min version doesn't have.                                      | Bump `minAppVersion` to the floor that actually works. We use `color-mix()` CSS (Chromium 111 → Obsidian ≥ 1.4) and `setIcon` etc.; **1.4.0** is the safe floor we set. |

## Release artifacts checklist

Before opening the PR, verify each one of these exists in the repo or
the latest release:

| File                | Where                                  | Purpose                                                            |
| ------------------- | -------------------------------------- | ------------------------------------------------------------------ |
| `manifest.json`     | repo root + latest release asset       | Plugin metadata. Validator fetches both.                            |
| `versions.json`     | repo root                              | Maps every version to its `minAppVersion`. Built-in updater reads this. |
| `main.js`           | latest release asset                   | Compiled plugin entry point. Built by `npm run build`.              |
| `styles.css`        | latest release asset (copied from `src/`) | Plugin styling. Our build copies `src/styles.css → styles.css`.    |
| `LICENSE.md`        | repo root                              | MIT.                                                                |
| `README.md`         | repo root                              | Install / usage / permissions.                                      |
| `CHANGELOG.md`      | repo root                              | Per-version history. Not required by Obsidian but expected.         |
| `.github/workflows/release.yml` | repo root                  | Automates the release on tag push.                                  |

## Updating later

To ship a new version after the plugin is listed:

1. Bump `package.json`, `manifest.json`, `versions.json`, and
   `CHANGELOG.md` (we have a script for this in `version-bump.mjs`,
   wired up under `npm version`).
2. Tag and push (`git tag 3.20.0 && git push origin 3.20.0`).
3. The release workflow attaches `main.js`/`manifest.json`/`styles.css`
   to the GitHub Release.
4. Obsidian's auto-updater picks up the new release without any further
   PR - `community-plugins.json` only needs the initial entry.
