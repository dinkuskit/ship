---
"@dinkuskit/ship": minor
---

The Shipping page reuses its 5-minute Ship pass across clicks instead of trading the store key at DinkusKit.com on every click. The pass is kept in the plugin's own KV and used while it has at least 30 seconds left; a kept pass Ship no longer accepts is dropped and the call retried once on a fresh one.
