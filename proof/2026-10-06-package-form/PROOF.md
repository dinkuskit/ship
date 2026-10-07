# Installed synthetic package form proof

Base: `16f962eb8f3f373f0231a736a3f4ceb34bac94e6`.
Scope: explicitly isolated synthetic fixture; no Commerce order read, provider quote, purchase, or retry.

- `npm test`: 24 passed.
- `npm run verify:sandbox`: package install and exact host-installed byte match passed; sandbox execution, settings persistence, default Commerce fail-closed state, and host-attested Arabic RTL passed.
- Host: EmDash 1.0.1, sandbox-workerd 0.9.1, Node 22.23.1, workerd 1.20261001.1; localhost port 4351.
- Package SHA256: `1da5075245e442778ad54da49a749d5a0eaeb9188539fb8ea2ebdc5a074c3e6d`.
- Browser: Synthetic package proof → Open synthetic fixture → Make a postage label. Zero weight rejected visibly. 3.5 lb / 12 × 9 × 5 in accepted; destination and $48 paid total unchanged.
- Screenshots retained in task-owned ignored run: `runs/ignoredruns/order-sandbox-quotes-20261006/package-invalid.png` and `package-valid.png`.

Repairs: self-contained sandbox entry (runner does not include sibling modules), supported text_input fields, page-scoped fixture actions, retained valid package values, strict decimal parsing, longest-side length-plus-girth validation, and verifier separation of default versus fixture data.

Limits: no real-order shipping proof. Canonical Commerce order handoff and approved runtime credential binding remain missing. Unknown historical provider operation remains unretried. Review admission was fenced; no alternate or duplicate review dispatched. Not merge-ready.

## Accepted localization repair

Original comprehensive OpenClaw request `req-20261007T050244Z-139220227541`, head `dfe5eb8391cec819a62ceb72917817f63e039989`, qualified comprehensive/native P3/applied P3 and reported one P3 finding: dimension labels bypassed Arabic translation. Disposition: `required_fix`, accepted. Native receiver 37574388058 reported no findings for that old head; its trusted receiver source was `40f57db114a1f768aa7df99bce758883c72e2849` with source-pin guard and integration `9d90452b2b70db072888bd6830fdbc6208f35d36`. Historical reviews do not clear the repaired revision.

Repair adds only Length/Width/Height translation keys and uses them in the form. English remains default/fallback. Exact-label regressions cover English, Arabic, and unknown locale. Parent verified 27 passing tests and installed sandbox execution with explicit Arabic fixture-label assertions; package SHA256 `8d5810f7daa85cddd6b88d0cabbe47f129dad56af01466a7b6a1ade413eda9f5`. Cursor ACP job `0530900b-706d-47f3-a3e8-4dddefc69738` completed with cleanupReady; worker PID absent. Replacement CI and reviews required before maintainer gate.

## Accepted validation-message repair

Replacement OpenClaw epoch2 request `req-20261007T080228Z-204103219258` qualified comprehensive P3 at head `2ec6006e70ffb1f00352fcb704e8049cc92f82dd` and found one P3: English validator messages appended in Arabic UI. Accepted `required_fix`. Native receiver37591112762 qualified that historical head (receiver8b44db9, guarded engine9d90452, publication revision2 matched). These reviews remain historical.

UI-only error-code mapping now covers all four reachable validation categories plus a localized generic fallback. Validator rules unchanged. Parent verified29tests, Arabic/default/fallback invalid-input cases, installed sandbox Arabic zero-weight rejection, package byte match and persistence. PackageSHA256 `e8ade9525a83f78779365319fb81e474d94bcbe18a0f418172c8a8781153a948`. ACP LunaMedium job6ad83f90 completed/cleanupReady; PID6121 absent. Changed-head reviews required.
