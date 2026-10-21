---
"@dinkuskit/ship": minor
---

The Shipping page reuses its Ship pass for later clicks for up to a minute instead of trading the store key at DinkusKit.com on every click, so a burst of clicks shares one trade and a labelling session stays clear of the pass rate limit. The pass is kept in the plugin's own KV beside a fingerprint of the key it was traded with, so a newly pasted key takes effect at once, and a key replaced or a Ship turned off at DinkusKit.com stops clicks within a minute. A kept pass Ship no longer accepts is dropped and the call retried once on a fresh one.
