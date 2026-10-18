# Queue shadow smoke (throwaway)

This PR exists only to generate one real ClawSweeper sender run while both the
queue Worker (`queue.ztoned.com`) and this repo variable
`CLAWSWEEPER_DO_QUEUE_MODE` are in `shadow`. Expected: the relay performs a
signed queue admit, then delivers the review request through the existing
Actions dispatch exactly as before. This PR will be closed unmerged after the
comparison; do not merge.
