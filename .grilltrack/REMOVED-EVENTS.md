# Events removed from events.jsonl

GrillTrack's ledger is append-only and never hand-edited, with this one recorded exception.

## 19 Oct 2026: event 870bbc5d (decision_reopened, 9 Oct 2026)

- **What:** the `decision_reopened` event for `registry-private-pdf-qualification`, recorded 2026-10-09T17:18:55Z, was deleted from `events.jsonl` (it was line 96).
- **Why:** TruffleHog's Privacy.com key detector reads a word in that event's reason text next to its generated event ID as a leaked API key. It is a false positive, but ClawSweeper's input scanner refused every Ship PR that appended to this file, because its reviewed exception (openclaw/clawsweeper#1833) is tied to one exact version of the whole file.
- **Approved by:** Ronald, 19 Oct 2026, in dinkuskit/ship#43.
- **Effect:** `ledger.json` is unchanged and still records that decision's reopening in its history; `grilltrack validate` passes. Only the raw event line is gone.
