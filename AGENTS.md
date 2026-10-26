# Agent notes

Read `README.md` and `RELEASING.md` first.

## Reference article

`docs/website/reference/ship.md` is the Ship article on dinkuskit.com/docs
(GrillTrack decision `website-docs-from-plugin-releases-086` in
dinkuskit/dinkuskit). Change it in the same PR as any behavior, screen, route
or setup step it describes. Keep `version_scope: "Ship {{version}}"` and the
`{{version}}` and `{{release_date}}` placeholders: a stable release fills
them in and publishes the article, so main may describe changes that are not
released yet. Guides that span plugins live in dinkuskit/dinkuskit
`docs/updates/`; link that PR under **Docs impact**.

Reviewers, ClawSweeper included, record every PR's docs as one of:

- **Docs: up to date**: the PR updates the article to match, or the article
  already describes the change correctly.
- **Docs: missing**: the PR changes something the article describes, or should
  describe, without updating it. Report it as a P3 finding naming the section;
  it does not block the merge.
- **Docs: not applicable**: nothing an owner or developer sees changes (tests,
  CI, internal refactors).
