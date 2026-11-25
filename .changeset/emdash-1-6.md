---
"@dinkuskit/ship": patch
---

Build and test against EmDash 1.6.0 (blocks 1.6.0, plugin CLI 0.13.7, plugin types 0.6.1). The runtime peer moves to exact `emdash` 1.6.0. The Ship plugin builds byte for byte the same (`dist/plugin.mjs` 43,930 bytes, SHA-256 `1ff87e06…`), so stores on EmDash 1.5 and 1.6 run the same Ship, and the hosted Ship service does not change.
