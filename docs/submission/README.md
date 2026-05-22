# Obsidian community-plugin submission

Everything needed to open the submission PR against
[`obsidianmd/obsidian-releases`](https://github.com/obsidianmd/obsidian-releases).

| File                                                      | What it is                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`SUBMISSION.md`](SUBMISSION.md)                          | Step-by-step submission flow, with troubleshooting for the validator errors. |
| [`community-plugins-entry.json`](community-plugins-entry.json) | The exact JSON object to append to `community-plugins.json` in the fork.     |
| [`pr-description.md`](pr-description.md)                  | The body to paste into the PR description (all checklist boxes ticked).      |

**Short version:** fork `obsidian-releases`, append the JSON snippet to
`community-plugins.json`, open a PR with the description from
`pr-description.md`. The submission validator will fetch
`manifest.json` from our default branch and verify it matches our
latest GitHub Release tag. Both already line up.

If the validator throws **"Could not find or validate a manifest
(manifest.json) in the repository"** - the most likely cause is a
typo in the `repo` field of the JSON snippet. See the troubleshooting
table in `SUBMISSION.md`.
