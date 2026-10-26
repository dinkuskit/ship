# Direction and research alignment proof — 2026-10-26

Repository: `dinkuskit/ship`. Source base: `7517fb46c82cf2986161eacbec1a4449ce3c66b9`.
Branch: `codex/rea-alignment-20261026`; the PR head carries this proof.
Owner: core alignment writer; review and merge remain separate.

## Scope and sources

This change updates documentation and research entrypoints. Product behavior,
provider authority, accepted locks and decision ledgers are unchanged. It does
not install user-global skills, deploy, publish a release or authorize a merge.

Source fidelity was checked against the organization
[vision](https://github.com/dinkuskit/.github/blob/36aab690a7ef66dc119aab70e258ea979c54841a/VISION.md)
and [scope and planning](https://github.com/dinkuskit/.github/blob/36aab690a7ef66dc119aab70e258ea979c54841a/ROADMAP.md),
then this repository's charter, current source and linked decisions. New public
text contains no private research paths or copied research artifacts. Existing
status limitations are retained; this documentation is not runtime proof.

## Verification

- `git diff --check`: passed.
- New local Markdown targets resolve; linked organization sources were read at
  the revision above. The diff is limited to the declared docs, bootstrap,
  proof and, where required, an empty changeset.

- Empty changeset parsed by the repository changeset validator.
- No bootstrap was added. Current Commerce-first connection, Commerce order
  intake and explicitly reviewed label purchase remain documented.
