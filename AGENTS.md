# Agent notes

Read `README.md` and `RELEASING.md` first.

## Direction and research

Read the organization [vision](https://github.com/dinkuskit/.github/blob/main/VISION.md)
and [scope and planning](https://github.com/dinkuskit/.github/blob/main/ROADMAP.md)
with the [charter](docs/CHARTER.md) and current decisions. Wider independent-tool
direction does not change Ship's current Commerce connection and order intake,
provider boundary or explicit label-purchase approval.

For material product or architecture questions and relevant grills, use the
maintained [emdash-commerce research guidance](https://github.com/saariuslystoned/SaariusSkills/blob/23f2bb1208b3baa7aedaa87faec00395f9bdd061/skills/emdash-commerce/SKILL.md)
and its selective REA reference. Keep research, accepted design, active work
and verified behavior distinct; reuse existing issues or proposals rather than
turning findings into an automatic implementation program.

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

## Delegated audits

- `api-oracle` ([saari-co/api-oracle](https://github.com/saari-co/api-oracle)) runs
  delegated background audits, CI triage, and architecture checkpoints on API
  credits. Prefer `oracle ask <lane>` for work a brief can carry, and read and
  rate the briefs it announces. It gates nothing and does not replace
  ClawSweeper review.
